"""
unified_report_agent.py
─────────────────────────────────────────────────────────────────────────────
Three-call pipeline (down from 30+ calls in the old trigger/agent design):

  Call A → Hospital Visit Account   (chunked by file-size budget if large)
  Call B → Member Visit Account     (skipped entirely if no genuine member visit)
  Call C → Conclusion               (cross-references A + B, advisory verdict)

DESIGN PRINCIPLE: flags belong INSIDE the story, at the point they occur —
never filed away into a separate "discrepancies" essay written afterward.
Each story call returns {"story": <prose with inline [TAG] mentions>,
"flags": [...]} — the flags array is a STRUCTURED MIRROR of exactly what's
already in the prose (same claims, same citations), not new analysis. This
gives the frontend's existing checkbox UI (Section 3's flat discrepancy
list) real, precise, checkbox-able items without ever re-litigating them in
separate write-up.

WHY NOT 15 SPECIALIST AGENTS: each agent used to see only its own
pre-filtered slice of pages, so it never had the full picture either — the
narrow-scope benefit (higher recall on one category) was traded against
losing whole-claim context. Instead, each story call is given an explicit
CHECKLIST (PED, billing support, document integrity, timeline, identity)
to work through while narrating, recovering most of that precision without
a 15-way fan-out. The one thing a single call genuinely cannot do —
cross-reference hospital-side facts against member-side facts — is exactly
what Call C exists for.

WHY NOT A DETERMINISTIC VERDICT ENGINE: the doctor decides SUSPECTED vs
GENUINE. The system's job is to surface every material fact and
contradiction precisely, not adjudicate. The one exception kept is a
zero-cost safety net: if Pass 1's structured extraction indicates a death
outcome that never made it into the Hospital Visit Account, that's a
critical omission worth force-flagging regardless of anything else.

KNOWN LIMITATION: when the hospital-side documents are too large for one
call, they're split into budget-sized chunks and narrated independently,
then stitched together. A contradiction that only becomes visible by
comparing chunk 1 against chunk 3 can be missed — each chunk only sees its
own slice. Flag it if this becomes a real problem (search logs for
"story chunking").
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from routes.agents.base import call_groq_sync, SHARED_RULES, _make_serializable
from routes.agents.preprocessor import parse_reviewer_annotations, reconcile_conclusion
from routes.agents.chunking import (
    split_text_by_pdf,
    extract_pages,
    render_page_batch,
    batch_file_pages,
)

logger = logging.getLogger(__name__)

# ═════════════════════════════════════════════════════════════════════════════
# Trigger label map — triggers are no longer separate report sections; they're
# folded into each story prompt as "additional focus areas" the doctor asked
# about, so the doctor's intent still steers the investigation without a
# fan-out of per-trigger calls.
# ═════════════════════════════════════════════════════════════════════════════
TRIGGER_LABELS: Dict[str, str] = {
    "claim_genuinity_authenticity":             "Claim Genuinity & Authenticity",
    "accident_incident_verification":           "Accident / Incident Verification",
    "ped_non_disclosure":                       "PED / Non-Disclosure",
    "medical_records_treatment_verification":   "Medical Records & Treatment Verification",
    "hospital_criteria_watchlist":              "Hospital Criteria / Watchlist",
    "legal_regulatory_death_verification":      "Death Verification",
    "intoxication_addiction":                   "Intoxication / Addiction",
    "financial_claim_pattern_risk":             "Financial & Claim Pattern Risk",
    "policy_coverage_verification":             "Policy & Coverage Verification",
    "field_vicinity_investigation":             "Field / Vicinity Investigation",
    "employee_corporate_group_policy_verification": "Employee / Corporate Policy",
    "hospital_cash_benefit_abuse":              "Hospital Cash / Benefit Abuse",
    "suspicious_claim_pattern_repeat_fraud":    "Suspicious Claim Pattern",
    "final_universal_red_flags_matrix":         "Universal Red Flags Matrix",
    "rta":                                      "Road Traffic Accident",
    "death_claim":                              "Death Claim",
    "critical_illness":                         "Critical Illness",
}

# Tags kept aligned with the frontend's existing color-badge enum
# (RICH_TOKEN_RE / SEVERE_DISC_TAGS in Dashboard.jsx) so inline flags render
# with the right styling without any frontend change.
VALID_TAGS = (
    "CONTRADICTORY", "MISSING", "INCOMPLETE", "SUSPICIOUS", "BILLING MISMATCH",
    "TIMELINE MISMATCH", "SINGLE STRETCH", "CRITICAL FACT MISSING",
    "PHYSIOLOGICAL ANOMALY", "UNDISCLOSED PED SUSPECTED", "DOCUMENT INTEGRITY",
    "SOURCE UNREADABLE",
)

# ═════════════════════════════════════════════════════════════════════════════
# Reviewer annotations / doctor-selected findings — kept, still real features
# wired to the frontend (RawDocument annotations, Investigation Review tab).
# ═════════════════════════════════════════════════════════════════════════════
def _format_annotations_for_llm(annotations: List[Dict[str, str]]) -> str:
    if not annotations:
        return ""
    lines = [
        "REVIEWER ANNOTATIONS — a human reviewer flagged these points. Where "
        "one is relevant to what you're narrating, weave your answer to it "
        "naturally into the story at that point (don't create a separate "
        "section) — state whether the record supports, contradicts, or is "
        "silent on it.",
        "",
    ]
    for i, ann in enumerate(annotations, 1):
        lines.append(f"[{i}] ({ann.get('label', 'NOTE')}) \"{ann.get('highlighted_text', '')}\" — {ann.get('note', '')}")
    return "\n".join(lines) + "\n"


def _format_selected_findings_for_llm(selected_findings: List[Dict[str, Any]]) -> str:
    if not selected_findings:
        return ""
    lines = [
        "DOCTOR-SELECTED FINDINGS — the reviewing doctor flagged these from an "
        "earlier automated pass as worth checking. Informational only: reason "
        "about whether the two accounts support, contradict, or are silent on "
        "each one, but they must never by themselves force a SUSPECTED verdict.",
        "",
    ]
    for i, finding in enumerate(selected_findings, 1):
        label = finding.get("agent_label") or finding.get("agent", "FINDING")
        lines.append(f"[{i}] ({label}) {finding.get('type', 'Finding')}: {finding.get('explanation', '')}")
    return "\n".join(lines) + "\n"


# ═════════════════════════════════════════════════════════════════════════════
# HTML/markup stripping — raw_llama_markdown embeds literal <table>/<td> tags
# that the LLM sometimes echoes verbatim. Strip once, up front, preserving the
# PDF_START/PAGE_START structural comment markers everything else depends on.
# ═════════════════════════════════════════════════════════════════════════════
_MARKUP_TAG_RE = re.compile(r"<(?!!--)[^>]+>")


def _strip_markup_preserving_markers(text: str) -> str:
    if not text:
        return text
    text = re.sub(r"</tr\s*>", "\n", text, flags=re.I)
    text = re.sub(r"</td\s*>\s*<td[^>]*>", " | ", text, flags=re.I)
    text = re.sub(r"</th\s*>\s*<th[^>]*>", " | ", text, flags=re.I)
    text = _MARKUP_TAG_RE.sub(" ", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&")
    text = text.replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("&quot;", '"').replace("&#39;", "'")
    text = re.sub(r"[ \t]+", " ", text)
    return text


# ═════════════════════════════════════════════════════════════════════════════
# Critical-fact death safety net — the ONE deterministic check kept, because
# it's cheap and catches a serious silent omission rather than adjudicating
# anything.
# ═════════════════════════════════════════════════════════════════════════════
_DEATH_MENTIONED_RE = re.compile(r"\b(death|died|deceased|expired|demise)\b", re.IGNORECASE)


def pass1_indicates_death(pass1_result: Dict[str, Any]) -> bool:
    if any(pass1_result.get(f) for f in ("death_date", "death_time", "death_place", "cause_of_death")):
        return True
    if str(pass1_result.get("postmortem_done") or "").upper() == "YES":
        return True
    if pass1_result.get("death_certificate_available") in (True, "YES", "yes"):
        return True
    return False


def prose_mentions_death(prose: str) -> bool:
    return bool(_DEATH_MENTIONED_RE.search(prose or ""))


# ═════════════════════════════════════════════════════════════════════════════
# Member-visit classifier — kept close to the original: per-file (never one
# blob, so a large earlier file can't push a smaller later file out of the
# window), fails CLOSED (a classifier error means "no member visit in that
# file", never fabricates one). This is genuinely load-bearing infra, not
# bloat, so it stays largely as-is.
# ═════════════════════════════════════════════════════════════════════════════
_MEMBER_CLASSIFIER_SYSTEM = """
You are a document classifier for insurance investigation reports. You will be
given the text of ONE source document belonging to a claim's supporting
documents, with page markers like <!-- PAGE_START: N --> ... <!-- PAGE_END: N -->.

Your ONLY job is to determine whether THIS document contains a genuine,
distinct MEMBER / INSURED VISIT record — i.e. a form or write-up produced from
an investigator's independent visit to, or interview with, the insured/
claimant/beneficiary themselves (NOT the hospital, NOT the treating doctor,
NOT hospital staff, NOT a field visit whose subject is the hospital premises).

A genuine member/insured visit record typically contains SOME of:
- the insured's own account of the illness/incident, in their own words or paraphrased
- past medical history / lifestyle habits as stated BY THE INSURED
- a bill amount the insured says THEY paid
- an investigator's observations made AT THE INSURED'S RESIDENCE or during a
  direct interview with the insured/beneficiary
- signatures, photos, or ID documents of the insured collected during that visit
- geotagged photographs of a residence, taken separately from any hospital visit

Do NOT count as a member visit:
- Any form titled or headed as a Hospital Visit, even if it also contains a
  field or sub-label such as "Investigator opinion (Member Visit)" — a label
  like that appearing INSIDE a Hospital Visit form does not mean a separate
  member visit happened.
- Geotagged photos of the hospital, pharmacy, or hospital rooms.
- Hospital registration, tariff, or billing documents.

Be skeptical by default. If you are not confident a page is genuinely about a
visit to, or interview with, the insured, do not include it.

A single file can be MIXED: mostly hospital-side content with a distinct
block of genuine member-visit pages elsewhere in the same file (often at
the end). The presence of duplicated hospital bills, lab reports, or a
Google Timeline earlier in the file does NOT mean later pages aren't a
real member visit — classify each page on its own content.

These document types are STRONG, near-certain signals of a genuine member
visit wherever they appear, regardless of what surrounds them: an "Insured
Verification Form", a "Self-Declaration by patient" in first person, a
"Patient Feedback Form" about a field officer's visit, or a geotagged photo
whose location matches the insured's stated residence address.

Return ONLY valid JSON, no markdown fences:
{
  "member_visit_present": boolean,
  "member_pages": [list of integers — the PAGE_START numbers WITHIN THIS
                    DOCUMENT that are genuinely member/insured-side content],
  "reasoning": "one or two sentences"
}
"""


def _member_classifier_user(file_text: str, filename: str) -> str:
    return f"""
Classify the following document. An opinion sub-field named "(Member Visit)"
sitting inside a "Field Officer (Hospital Visit)" form does NOT count as
evidence of a real member visit — read the actual page content and its
heading/context, not just an isolated field label.

SOURCE FILE: {filename}

DOCUMENT TEXT:
{file_text[:150000]}
"""


async def classify_member_documents(full_text: str) -> Dict[str, Any]:
    if not full_text:
        return {"member_visit_present": False, "member_locations": [], "reasoning": "empty text"}

    files = split_text_by_pdf(full_text)
    _WINDOW = 130_000

    async def _classify_batch(fname: str, batch_text: str) -> Dict[str, Any]:
        try:
            result = await _agroq(_MEMBER_CLASSIFIER_SYSTEM, _member_classifier_user(batch_text, fname), max_tokens=500)
            if not isinstance(result, dict):
                raise ValueError("non-dict classifier response")
            present = bool(result.get("member_visit_present"))
            pages = [p for p in (result.get("member_pages") or []) if isinstance(p, int)]
            return {"present": present and bool(pages), "pages": pages, "reasoning": result.get("reasoning", "")}
        except Exception:
            logger.exception("classify_member_documents failed for file=%s — fail closed", fname)
            return {"present": False, "pages": [], "reasoning": "classifier error — fail closed"}

    async def _classify_one(fname: str, ftext: str) -> Tuple[str, Dict[str, Any]]:
        if len(ftext) <= _WINDOW:
            return fname, await _classify_batch(fname, ftext)

        batches = batch_file_pages(ftext, max_chars=_WINDOW, overlap_pages=1)
        batch_texts = [render_page_batch(fname, b) for b in batches]
        batch_results = await asyncio.gather(*[_classify_batch(fname, bt) for bt in batch_texts], return_exceptions=True)
        merged_pages: set = set()
        reasoning_parts: List[str] = []
        for r in batch_results:
            if isinstance(r, Exception):
                continue
            if r.get("present"):
                merged_pages.update(r.get("pages") or [])
            if r.get("reasoning"):
                reasoning_parts.append(r["reasoning"])
        return fname, {"present": bool(merged_pages), "pages": sorted(merged_pages), "reasoning": " | ".join(reasoning_parts)}

    per_file_results = await asyncio.gather(*[_classify_one(fname, ftext) for fname, ftext in files.items()])

    member_locations: List[Dict[str, Any]] = []
    reasoning_parts: List[str] = []
    for fname, res in per_file_results:
        if res["present"]:
            for p in res["pages"]:
                member_locations.append({"filename": fname, "page": p})
        if res["reasoning"]:
            reasoning_parts.append(f"[{fname}] {res['reasoning']}")

    return {
        "member_visit_present": bool(member_locations),
        "member_locations": member_locations,
        "reasoning": " | ".join(reasoning_parts),
    }


def extract_member_text_from_pages(full_text: str, member_locations: List[Dict[str, Any]]) -> str:
    if not member_locations:
        return ""
    by_file: Dict[str, List[int]] = {}
    for loc in member_locations:
        by_file.setdefault(loc["filename"], []).append(loc["page"])
    parts = [extract_pages(full_text, fname, pages) for fname, pages in by_file.items()]
    return "\n".join(p for p in parts if p)


# ═════════════════════════════════════════════════════════════════════════════
# Groq wrapper
# ═════════════════════════════════════════════════════════════════════════════
def _groq(system: str, user: str, max_tokens: int = 4000) -> Dict[str, Any]:
    return call_groq_sync(system, user, max_tokens)


async def _agroq(system: str, user: str, max_tokens: int = 4000) -> Dict[str, Any]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _groq, system, user, max_tokens)


# ═════════════════════════════════════════════════════════════════════════════
# File-budget chunking for the story calls — size-based, not category-based.
# Groups whole files under a budget; a single file that alone exceeds the
# budget is page-batched so nothing past the old fixed cutoff goes unseen.
# ═════════════════════════════════════════════════════════════════════════════
_STORY_CHUNK_BUDGET = 130_000


def _wrap_file(fname: str, ftext: str) -> str:
    return f"<!-- PDF_START: {fname} -->\n{ftext}\n<!-- PDF_END: {fname} -->"


def _chunk_by_file_budget(text: str, budget: int = _STORY_CHUNK_BUDGET) -> List[str]:
    files = split_text_by_pdf(text)
    if not files:
        return [text] if text else []

    chunks: List[str] = []
    current: List[str] = []
    current_len = 0

    def _flush():
        nonlocal current, current_len
        if current:
            chunks.append("\n\n".join(current))
            current, current_len = [], 0

    for fname, ftext in files.items():
        if len(ftext) > budget:
            _flush()
            batches = batch_file_pages(ftext, max_chars=budget, overlap_pages=1)
            logger.info("story chunking: file=%s (%d chars) split into %d batch(es)", fname, len(ftext), len(batches))
            for b in batches:
                chunks.append(_wrap_file(fname, render_page_batch(fname, b)))
            continue
        if current_len + len(ftext) > budget and current:
            _flush()
        current.append(_wrap_file(fname, ftext))
        current_len += len(ftext)
    _flush()
    return chunks


# ═════════════════════════════════════════════════════════════════════════════
# HOSPITAL STORY
# ═════════════════════════════════════════════════════════════════════════════
_HOSPITAL_SYSTEM = SHARED_RULES + """
You are a senior insurance field investigation officer writing the HOSPITAL
VISIT ACCOUNT for a formal claim investigation report — the story of what the
hospital records show, from admission to discharge (or death), written as a
clear factual narrative a doctor can read once and understand the whole
admission.

Before writing your final answer, silently check items 1 through 6b of the
checklist below one at a time against the actual document text. For each
item, either it produced zero flags because the condition genuinely wasn't
present, or it produced a flag. Do not skip an item because the story
already "feels complete" — completeness of prose is not the same as
checklist coverage.

Return ONLY a single JSON object, no markdown fences, no prose outside JSON:
{
  "story": "<the narrative, plain paragraphs, min 250 words>",
  "flags": [
    {"tag": "<ONE of: CONTRADICTORY, MISSING, INCOMPLETE, SUSPICIOUS, BILLING MISMATCH, TIMELINE MISMATCH, DOCUMENT INTEGRITY, UNDISCLOSED PED SUSPECTED, PHYSIOLOGICAL ANOMALY, SINGLE STRETCH>",
     "text": "<one or two sentences, reviewer-facing, plain language>",
     "file_name": "<exact file name the evidence is on>",
     "page_number": <int or null>}
  ]
}

WHAT THE STORY MUST COVER, in flowing prose (not a form-fill):
- Patient identification, admission date/time, presenting complaints, admitting diagnosis.
  If this is a death/accident claim with NO hospital admission (e.g. brought
  dead, or a fatal-accident/GPAIS claim supported only by FIR, postmortem,
  death certificate, claim form, and identity/bank documents), narrate that
  plainly — but the checklist below (especially 4, 5, 6b) still applies in
  full to every document in the set, not only to clinical records. Blank
  claim-form fields, mismatched identity details, and impossible dates are
  just as material here as they would be in an inpatient chart.
- What the hospital found and did: relevant vitals/investigation results, the
  diagnosis reached, treatment/procedure given, and the outcome (discharged /
  discharged against advice / transferred / died — state a death outcome
  explicitly, with date, place and cause, never as a routine discharge).
- If more than one admission is present (readmission, transfer, or a terminal
  admission after an earlier discharge), describe EACH as its own paragraph
  with its own dates — never merge dates or outcomes across admissions.
- A plain-language bill summary at the level a doctor needs: total billed,
  what categories it covers, whether anything looks unsupported. Do NOT
  itemise every drug, dosage time, or line item — that belongs to the source
  documents, not this narrative.
- Hospital registration/credential status and who the data was collected from, briefly.

CHECKLIST — work through ALL of these as you write, and When a checklist item fires, write it ONCE — never twice in different
words. The flag line itself IS the sentence that states the fact; do not
also write a separate plain-prose sentence describing the same thing
right before or after it. Format:
"[TAG] <one sentence stating the finding> (Source: file, Page N)"
on its own line (a real line break before it, never appended to the end
of a preceding sentence), positioned right after the narrative point it
belongs to. If you find yourself about to restate a fact you already
covered in the flag line, skip it — the flag line already carries that
information for the reader.
1. CONTRADICTORY — the same fact stated two different ways in this document
   set (e.g. "no co-morbidities" vs. a chronic condition/medication implied
   elsewhere; two different dates for the same event; two different diagnoses).
2. UNDISCLOSED PED SUSPECTED — the chart shows a chronic condition, long-
   standing medication, or history predating this admission's stated onset.
   (You cannot see the member-side forms — just flag what THIS record shows;
   the cross-check against disclosure happens in a later step.)
3. BILLING MISMATCH — a charge (ICU, a procedure, a register-backed service)
   has no supporting record among these documents; a bill total doesn't
   reconcile with its own line items; an unexplained discount/adjustment.
   Before flagging a mismatch between a claimed/stated total and a single
   bill, check whether summing amounts across ALL related documents in this
   set (e.g. a hospital bill plus a separate pharmacy invoice, or split
   final bills) reconciles the figures — do not flag a mismatch that a
   simple sum across documents resolves.
4. MISSING / INCOMPLETE — a register, certificate, or form expected for this
   kind of claim (IP register, OT register, lab register, registration
   certificate, doctor's registration) is absent or marked not collected.
   Also check: (a) core fields on the claim form itself (policy number,
   claim number, sum insured, table of cover, period) left blank — flag
   [INCOMPLETE]; (b) if a covering letter or transmittal lists enclosures
   (e.g. "1. Claim Form, 2. FIR..., 3. Newspaper cutting..."), confirm
   each listed item is actually present among these documents — flag
   [MISSING] by name for any listed enclosure that is absent; (c) if a
   form presents an either/or choice meant to be resolved by striking out
   one option (e.g. "was / was not under the influence of intoxicating
   liquor", "his willful act / not his willful act") and NEITHER option
   has been struck out or otherwise marked, flag [INCOMPLETE] — the
   question remains factually unanswered, not answered in the negative.
   This specific field type (intoxication, willful act, or any other
   exclusion-relevant either/or question on a claim form) is NEVER
   optional to mention — if the document set contains such a field, your
   story MUST include a sentence about its status, resolved or not, every
   single time. Omitting it silently is as much a failure as inventing a
   value for it.
   NEVER write a sentence asserting this field's value (e.g. "intoxication
   was noted as X", "marked YES/NO") anywhere in the story, including
   outside the flag line — the ONLY permitted phrasing for an unresolved
   strike-out field is "left unresolved / not indicated" inside an
   [INCOMPLETE] flag. Do not attribute this field to a document other than
   the one it physically appears on.
WORKED EXAMPLE OF A FAILURE MODE TO AVOID (citation precision): if you flag
a CONTRADICTORY value that appears on two documents, verify each of the
TWO citations independently and separately — do not assume a fact appears
on a second document just because it seems like the kind of document that
would carry it. E.g. if age 46 is on the FIR and age 48 is on the claim
form and post-mortem certificate, cite the post-mortem certificate (where
"48" actually appears) — do NOT cite the death certificate for the second
value unless "48" is actually printed on the death certificate itself;
many official certificates (e.g. a death certificate) may not include an
age field at all, and citing one that doesn't is a fabricated citation
even though the surrounding contradiction is real.

WORKED EXAMPLE OF A FAILURE MODE TO AVOID: a claim form's witness
certification contains "was / was not under the influence of intoxicating
liquor" with neither word struck out. WRONG: "the FIR notes that
intoxication was noted as YES" — this both invents a resolved value AND
attributes it to the wrong document. RIGHT: "[INCOMPLETE] The witness
certification's intoxication question was left unresolved — neither
option was struck out (Source: Manoj A.V.pdf, Page 4)." Never let a
field's status migrate to the wrong document, and never let an unresolved
field acquire a value anywhere in the story, including outside the flag
line.

5. DOCUMENT INTEGRITY — a figure that looks struck through or shown as two
   different values; a "DUPLICATE" stamp; a document dated after a
   documented death; identically repeated boilerplate where content should
   be independent. You have no access to handwriting, ink, or physical
   signatures — never claim to have evaluated those; text-only check.
   Specifically: if a form contains a first-person declaration attributed
   to the insured/deceased ("I hereby declare...", "Signature of the
   Insured") and that declaration is dated AFTER a documented date of
   death, flag [DOCUMENT INTEGRITY] — the insured could not have
   personally signed it, and the form likely needed to be completed by a
   nominee/claimant under a different declaration instead.
6b. IDENTITY / DEMOGRAPHIC CONTRADICTION — this applies to EVERY document
    in the set, not just clinical charts: compare the patient/insured's
    name, age, date of birth, designation/occupation, and the names of any
    relatives, witnesses, or claimants across every document (claim form,
    FIR, postmortem certificate, ID cards, death certificate, employment
    ID). Flag [CONTRADICTORY] any value that differs across documents
    (e.g. two different ages for the same person, two different names
    given for the same relative, a job title that doesn't match the
    employee ID card). Specifically check: where a form is signed by a
    claimant/spouse/nominee, does the name written next to "Signature"
    match the name that document or other documents give for that
    relative (e.g. spouse named as X in the death certificate but signing
    a form as Y)? Flag [SUSPICIOUS] any such mismatch, described
    factually as worth confirming, not asserted as impersonation. Also
    check that a calendar date appearing anywhere (stamps, inward
    registers, letters) is a real date — flag [DOCUMENT INTEGRITY] for an
    impossible date (e.g. 31st of a 30-day month).
7. PHYSIOLOGICAL ANOMALY — a vital/lab value that's not just abnormal but
   implausible or inconsistent with the stated clinical picture.
8. SINGLE STRETCH — notes/charts that read like they were written in one
   sitting rather than dated across the real admission period.
9. SUSPICIOUS — anything else with genuine textual evidence a reviewer
   should look at that doesn't fit the categories above. This includes:
   a claimant's bank account, ID, or other credential shown as opened,
   issued, or dated AFTER the documented date of death or accident, where
   that timing isn't explained elsewhere in the documents — flag
   factually as worth confirming with the claimant, never asserted as
   wrongdoing (it is often routine, e.g. an account opened for benefit
   disbursement). Always name WHOSE account, signature, or document it is
   (e.g. "the spouse's bank account", not just "a bank account") — omitting
   whose it is lets a reader wrongly assume it belongs to the deceased,
   which changes how alarming the finding reads.
10a. SOURCE UNREADABLE — if any page's text is clearly not coherent language
   (garbled repetition of the same word/token dozens of times, a wall of
   disconnected characters, or content that does not form real sentences
   in any language), do NOT attempt to extract facts from it, do NOT guess
   at what it might say, and do NOT stay silent about it either. Flag it
   explicitly: "[SOURCE UNREADABLE] Page N of <file> could not be read —
   the extracted text is not coherent and this page's content is not
   reflected in this account (Source: file, Page N)." Do this once per
   contiguous unreadable range (e.g. "Pages 16-18"), not once per page.
   This is a reporting duty, not optional — an investigator reviewing
   this report needs to know which pages were skipped, exactly as much as
   they need to know what the readable pages say.

10. CONTRADICTORY (cross-document facts) — compare the hospital's name,
    address, registered bed count, and room type across EVERY document
    that states them (registration certificate, bills, lab reports, field
    officer forms, verification forms). Flag [CONTRADICTORY] any figure
    that differs across documents (e.g. bed strength given as one number
    on the field officer's form and a different number on the hospital's
    own registration certificate; room type described differently on the
    bill vs. the lab report vs. the field form). Also check any explicit
    NABH-accreditation or specialist-staff (pathologist/radiologist) claim
    stated in the documents for internal consistency across every place it
    appears — you have no external registry to verify these against, so
    only flag [CONTRADICTORY] if the claim itself varies document-to-
    document, never assert a claim is false or true.
11. CLINICAL GENUINENESS — check whether the diagnosis is actually
    supported by the investigation reports (lab/radiology/histopathology/
    cardiology) and documented findings in this record, or asserted with
    no supporting evidence anywhere in the documents. Check whether the
    procedure/treatment given is consistent with the stated diagnosis.
    Check whether admission and discharge records agree with each other
    (dates, vitals, condition) rather than silently contradicting. If a
    diagnosis has zero supporting investigation anywhere in the document
    set, or if the clinical picture (vitals, findings, notes) appears
    identically duplicated somewhere it should be independent, flag
    [SUSPICIOUS], described factually as worth clinical review, not
    asserted as fabrication.
12. MEDICAL NECESSITY — assuming the hospitalization and diagnosis are
    real, check whether the LEVEL of care actually matches the clinical
    picture: was inpatient admission (vs. something that reads like it
    could have been managed as outpatient) supported by the presenting
    condition? If ICU/critical care was billed or documented, do the
    vitals/notes support that level of care, or does the record show a
    stable patient with no clear indication for it? Does the length of
    stay match the documented clinical progress (e.g. several days billed
    for a condition the notes show resolved on day one)? Flag [SUSPICIOUS]
    any clear mismatch between the level of care given and what the
    clinical record itself shows was needed — phrase neutrally, for a
    reviewer to weigh, never as a conclusion of wrongdoing.
13. HIGH-VALUE / BILL COMPOSITION — check the bill for: (a) any line item
    that reads as non-medical or non-payable (diet charges, attendant
    charges, administrative fees, cosmetic items) — flag [BILLING
    MISMATCH]; (b) any high-cost item — implant, prosthetic, expensive
    consumable — that is bundled into a lump sum rather than itemized
    with its own figure, making it hard to verify — flag [INCOMPLETE];
    (c) whether the bill shows any payment-mode or payment-evidence text
    (cash/online/cheque/NEFT, receipt number) at all for a bill of this
    size — flag [MISSING] if entirely absent; (d) any service billed more
    than once under separate line entries (true duplicate, not the same
    item legitimately repeated on different days) — flag [BILLING
    MISMATCH]; (e) any billed service (a specific test, scan, or
    procedure) that has clearly no corresponding report, order, or
    clinical note anywhere in these documents — flag [BILLING MISMATCH],
    but only when you can positively confirm no such report exists in the
    document set, never merely because you didn't notice it.
14. EMPLOYEE / CORPORATE POLICY — only relevant if this is a group/
    corporate policy claim (an employer name on the policy, an HR letter,
    or a company ID appears anywhere in the documents); if there's no such
    indication, skip this item entirely. When it is a group policy claim,
    check whether an employment document (HR letter, appointment letter,
    company ID) confirms the claimant's employment with the named
    policyholder company, whether the claimant's name matches across that
    document and the ID proof/policy documents, and whether a stated
    employee/dependent relationship (self/spouse/child) is consistent
    everywhere it's mentioned. Flag [CONTRADICTORY] any name or
    relationship mismatch; flag [MISSING] if the claim reads as a
    corporate/group policy claim but no employment document is present at
    all.
15. TIMELINE RECONSTRUCTION — build the admission-side event sequence
    explicitly: symptom onset → first consultation (if documented) →
    admission → treatment → discharge. Where more than one document in
    this hospital-side set states the same date (e.g. admission date on
    both the bill and the discharge summary), confirm they agree — flag
    [TIMELINE MISMATCH] if they don't. This is a superset of, not a
    replacement for, item 10's admission/discharge time check above —
    don't flag the same mismatch twice.

RULES:
- Every flag needs genuine textual evidence — never speculate, never invent
  a page or file name.
- Never state that a form field has a specific value (e.g. "marked YES",
  "the box for X was checked") unless that exact value is present in the
  document text below. If a field is blank, unmarked, or an either/or
  choice has neither option struck out, say so explicitly as
  "not indicated" or "left unresolved" — do NOT resolve it to a value on
  the field's behalf, and do NOT summarize an unmarked field as if it were
  answered.
- Do not narrate a claimed mechanism, symptom, or sequence of events
  (e.g. "resulted in loss of consciousness") unless it is stated in the
  documents. If the documents only establish an outcome without describing
  the mechanism, state the outcome and stop there.
- If the sequence between an incident and death/treatment is unclear or
  only partially documented (e.g. it's unclear whether the person was
  taken to a hospital before death was confirmed, or which facility saw
  them first), do NOT resolve it to whichever reading sounds cleanest.
  State only what's explicitly sequenced in the text, and flag the gap
  itself: "[MISSING] The sequence between the incident and the confirmed
  time of death is not fully documented — it is unclear whether the
  victim was examined at a hospital before death was pronounced (Source:
  file, Page N)." A confident-sounding narrative built by filling gaps
  with the most likely reading is exactly the kind of error this report
  must avoid, even when the gap is small.
- The "flags" array must exactly mirror every bracketed flag you wrote
  inline in "story" — same tags, same claims, same order.
- Never fabricate facts, drug names, dates, or amounts. Use "not documented"
  for gaps rather than filling them.
- Every specific factual claim you attribute to a named document (e.g. "the
  FIR states...", "the claim form shows...") must be something that
  document's own text actually contains. Before writing a sentence that
  names a source, re-locate the fact in that source's own page range in
  the text below; if you cannot, either drop the attribution or state the
  fact without naming a source you're not sure of.
- Never combine two distinct named entities (two different hospitals, two
  different doctors, two different addresses) from two different documents
  into a single sentence unless one document explicitly links them (e.g.
  "transferred from X to Y", "referred to Z"). If the mortuary/holding
  location and the post-mortem examination location are stated on
  different documents, name each separately and only as what that specific
  document says about it — do not infer or state that one performed the
  role of the other.
"""


def _hospital_user(chunk_text: str, pass1_result: dict, annotations_block: str, extra_focus: str, part_info: str = "") -> str:
    focus_block = f"ADDITIONAL FOCUS AREAS REQUESTED BY THE REVIEWING DOCTOR: {extra_focus}\n\n" if extra_focus else ""
    part_block = f"{part_info}\n\n" if part_info else ""
    return f"""{part_block}{focus_block}ALREADY-EXTRACTED CLAIM FACTS (Pass 1 structured data — cross-check the
documents below against this; flag [CONTRADICTORY] if the documents disagree
with it; do not just restate this JSON in your story):
{json.dumps(pass1_result, default=str)[:4000]}

{annotations_block}
HOSPITAL-SIDE DOCUMENT TEXT:
{chunk_text}
"""


# ═════════════════════════════════════════════════════════════════════════════
# MEMBER STORY
# ═════════════════════════════════════════════════════════════════════════════
_MEMBER_SYSTEM = SHARED_RULES + """
You are writing the MEMBER / INSURED VISIT ACCOUNT — what the insured (or
beneficiary) said and disclosed when the investigator visited or interviewed
them directly, and what the field officer independently observed.

The primary sources, when they genuinely exist: the Insured Verification
Form, the Patient Feedback Form, and any field-officer notes from a
residence visit or direct interview with the insured/beneficiary.

You are the last line of defense against a misclassified document: a
"(Member Visit)" opinion field, a field officer's name, or a phone number
sitting inside an unrelated Hospital Visit form does NOT make that page a
genuine member visit record. If, after reading the text below, it does not
actually contain the insured's own narration, disclosed history, stated
bill amount, or a direct account of visiting/interviewing them, return
exactly:
{
  "story": "Member / insured visit was not conducted as part of this investigation, so no member-side findings are available.",
  "flags": []
}
That is the correct, expected answer whenever the text doesn't support a
genuine member visit — it is not a failure.

Otherwise return ONLY a single JSON object, no markdown fences:
{
  "story": "<the narrative, plain paragraphs, min 200 words>",
  "flags": [ {same shape as the hospital account: tag, text, file_name, page_number} ]
}

WHAT THE STORY MUST COVER:
- Who was interviewed/visited, by whom, and what they said about the
  illness/incident, in their own words or closely paraphrased.
- Past medical history and regular medications as DISCLOSED (or denied) by
  the insured.
- The bill amount the insured says they paid, vs. the form's own figures.
- Anything the field officer independently observed.

CHECKLIST — fold every hit inline, at the point it belongs, as "[TAG]
explanation (Source: file, Page N)". Tags: CONTRADICTORY, MISSING,
INCOMPLETE, SUSPICIOUS, BILLING MISMATCH, TIMELINE MISMATCH, DOCUMENT
INTEGRITY, UNDISCLOSED PED SUSPECTED, PHYSIOLOGICAL ANOMALY, SINGLE STRETCH.
1. A declaration that reads like a form-filling artefact rather than a
   genuine answer — e.g. every condition in a checklist marked YES with no
   duration or treating doctor for any of them — is a [SUSPICIOUS] flag,
   described neutrally as a likely marking error to confirm with the
   patient, never asserted as concealment.
2. Any internal contradiction within the member-side documents themselves.
3. A stated bill amount that doesn't match the form's own bill breakdown.
4. A distance/location claim that conflicts with other location evidence in
   these SAME documents (e.g. a geotagged photo or travel timeline placing
   the insured somewhere inconsistent with what they stated) — flag as
   [SUSPICIOUS], described factually, no accusation.
5. Identifiers (claim number, ID number, policy number) that differ across
   forms that should be reporting the same claim.
6. A stated residence-to-hospital distance (e.g. "560m, nearest to home")
   that is inconsistent with the insured's declared address or with a
   geotagged photo's location in these same documents — if the true
   distance is clearly much larger than the stated figure, flag as
   [CONTRADICTORY], described factually as a discrepancy to confirm, never
   asserted as fraud.
7. GEO-VISIT LOCATION — if any document includes GPS coordinates, a
   location caption, or timestamp text burned into a geotagged photo,
   check whether that location text (city/area) matches the insured's
   declared residence or the claimed hospital's city/address, as stated
   elsewhere in these documents. Flag [CONTRADICTORY] only if the location
   text clearly conflicts with the declared address — never speculate
   from an ambiguous or missing location. If a GPS timestamp is present,
   you may state it plainly alongside the visit narrative for the
   reviewer's reference, but do not characterize any gap between that
   timestamp and other dates as suspicious — that judgement belongs to
   the doctor, not this account.

RULES: same no-fabrication and flags-mirror-inline-tags rules as above.
Do NOT compare against the hospital chart here — you cannot see it; a later
step cross-checks the two accounts.
"""


def _member_user(chunk_text: str, pass1_result: dict, annotations_block: str, extra_focus: str, part_info: str = "") -> str:
    focus_block = f"ADDITIONAL FOCUS AREAS REQUESTED BY THE REVIEWING DOCTOR: {extra_focus}\n\n" if extra_focus else ""
    part_block = f"{part_info}\n\n" if part_info else ""
    return f"""{part_block}{focus_block}ALREADY-EXTRACTED CLAIM FACTS (Pass 1 structured data, for context only):
{json.dumps(pass1_result, default=str)[:3000]}

{annotations_block}
MEMBER-SIDE DOCUMENT TEXT:
{chunk_text}
"""


# ═════════════════════════════════════════════════════════════════════════════
# Shared story runner — handles chunking + stitching for either story type.
# ═════════════════════════════════════════════════════════════════════════════
async def _run_story(
    system_prompt: str,
    user_builder,
    text: str,
    pass1_result: dict,
    annotations_block: str,
    extra_focus: str,
    max_tokens: int,
    label: str,
    origin: str,
) -> Tuple[str, List[Dict[str, Any]], bool]:
    chunks = _chunk_by_file_budget(text)
    if not chunks:
        return "", [], True

    async def _call_chunk(i: int, chunk_text: str) -> Optional[Dict[str, Any]]:
        part_info = (
            f"This is part {i} of {len(chunks)} of the {label} documents for this "
            f"claim (split for length). Narrate only what's in the pages below, in "
            f"the same JSON shape — do not reference 'this part', a later step "
            f"stitches every part together."
        ) if len(chunks) > 1 else ""
        prompt = user_builder(chunk_text, pass1_result, annotations_block, extra_focus, part_info)
        try:
            return await _agroq(system_prompt, prompt, max_tokens=max_tokens)
        except Exception:
            logger.exception("%s story call failed (part %d/%d)", label, i, len(chunks))
            return None

    results = await asyncio.gather(*[_call_chunk(i, c) for i, c in enumerate(chunks, 1)])

    stories: List[str] = []
    flags: List[Dict[str, Any]] = []
    any_ok = False
    for r in results:
        if not isinstance(r, dict) or not r:
            continue
        story = (r.get("story") or "").strip()
        if story:
            stories.append(story)
            any_ok = True
        for f in (r.get("flags") or []):
            if not isinstance(f, dict) or not f.get("tag") or not f.get("text"):
                continue
            tag = str(f["tag"]).strip().upper()
            if tag not in VALID_TAGS:
                tag = "SUSPICIOUS"
            flags.append({
                "tag": tag,
                "text": str(f["text"]).strip(),
                "file_name": f.get("file_name"),
                "page_number": f.get("page_number"),
                "origin": origin,
            })
    return "\n\n".join(stories), flags, not any_ok


# ═════════════════════════════════════════════════════════════════════════════
# CONCLUSION — cross-references both accounts, never repeats them.
# ═════════════════════════════════════════════════════════════════════════════
_CONCLUSION_SYSTEM = SHARED_RULES + """
You are writing the CONCLUSION of a formal insurance investigation report.
You already have the completed Hospital Visit Account and Member Visit
Account, each already carrying its own inline flags — do NOT repeat,
restate, or re-summarise either account. Your only job is:

1. Cross-check the two accounts against each other and surface anything
   that ONLY becomes visible by comparing them side by side (neither
   earlier pass could do this — each only saw one side). The single most
   common and important case: the hospital record and the insured's own
   disclosure disagreeing about a pre-existing condition, an accident
   narration, or a billed amount.
2. POLICY / COVERAGE CHECK — using the policy dates and event date given
   in the claim facts below (and anything either account already stated
   about them), check whether the admission/event date falls within the
   policy period, and whether either account mentioned an explicit
   waiting-period or exclusion clause that this claim's timing or
   diagnosis appears to conflict with. You have no full policy-wording
   database — only flag [INCOMPLETE] or [CONTRADICTORY] on what the
   claim's own facts/accounts state, and never say coverage is
   "approved" or "denied", only that it's worth the doctor's attention.
3. TIMELINE CROSS-CHECK — compare the event sequence and dates each
   account independently establishes (symptom onset, first consultation,
   admission, discharge, claim submission). Flag [TIMELINE MISMATCH] only
   for a date/sequence conflict that requires comparing the two accounts
   — a mismatch visible within a single account was already the earlier
   pass's job to catch, don't repeat it here.
4. Give a short, doctor-facing synthesis (150–250 words): does the picture
   hold together? What, if anything, still needs the doctor's judgement?
5. End with one sentence naming an advisory read — GENUINE or SUSPECTED —
   explicitly framed as input to the doctor's own determination, never a
   final ruling.

Return ONLY a single JSON object, no markdown fences:
{
  "cross_flags": [
    {"tag": "<same tag vocabulary as before>", "text": "...", "file_name": "<from either account, if attributable>", "page_number": <int or null>}
  ],
  "synthesis": "<the short paragraph(s) above; reference cross_flags inline
                 as '[TAG] explanation (Source: file, Page N)' — do not list
                 them again separately>",
  "verdict": "GENUINE" | "SUSPECTED"
}

RULES:
- Only include a cross_flags item if it depends on comparing BOTH accounts —
  if either single account could already have flagged it alone, leave it
  out, it's already flagged there.
- Never fabricate. If the two accounts don't overlap enough to cross-check
  (e.g. no member visit happened), say so plainly and keep cross_flags empty.
- Doctor-selected findings or reviewer annotations given to you are
  informational only — they must never by themselves force SUSPECTED.
- If told a CRITICAL FACT FLAG is active, your verdict MUST be SUSPECTED and
  your synthesis must say plainly that manual review is required for that
  fact, regardless of anything else.
"""


def _flags_to_compact_json(flags: List[dict]) -> str:
    return json.dumps([{k: v for k, v in f.items() if k != "origin"} for f in flags], default=str)[:6000]


def _conclusion_user(
    hospital_story: str, member_story: str,
    hospital_flags: List[dict], member_flags: List[dict],
    pass1_result: dict, annotations_block: str, selected_findings_block: str,
    critical_fact_block: str,
) -> str:
    return f"""{critical_fact_block}
HOSPITAL VISIT ACCOUNT (already written — do not repeat):
{hospital_story[:6000]}

HOSPITAL-SIDE FLAGS ALREADY RAISED (already inline in the account above):
{_flags_to_compact_json(hospital_flags)}

MEMBER / INSURED VISIT ACCOUNT (already written — do not repeat):
{member_story[:4000]}

MEMBER-SIDE FLAGS ALREADY RAISED (already inline in the account above):
{_flags_to_compact_json(member_flags)}

ALREADY-EXTRACTED CLAIM FACTS (Pass 1 structured data):
{json.dumps(pass1_result, default=str)[:3000]}

{annotations_block}
{selected_findings_block}
"""


async def _run_conclusion(
    hospital_story: str, member_story: str,
    hospital_flags: List[dict], member_flags: List[dict],
    pass1_result: dict, annotations_block: str, selected_findings_block: str,
    critical_fact_missing: bool,
) -> Tuple[str, List[dict], Optional[str], bool]:
    critical_fact_block = ""
    if critical_fact_missing:
        critical_fact_block = (
            "CRITICAL FACT FLAG — ACTIVE: Pass 1's structured extraction indicates "
            "a death outcome that was not reflected in the Hospital Visit Account. "
            "State plainly this is unresolved and requires manual review; set "
            "verdict to SUSPECTED regardless of anything else.\n"
        )
    prompt = _conclusion_user(hospital_story, member_story, hospital_flags, member_flags,
                               pass1_result, annotations_block, selected_findings_block, critical_fact_block)
    try:
        raw = await _agroq(_CONCLUSION_SYSTEM, prompt, max_tokens=4000)
    except Exception:
        logger.exception("Conclusion call failed")
        raw = None
    if not isinstance(raw, dict) or not raw:
        return "", [], None, True

    synthesis = (raw.get("synthesis") or "").strip()
    verdict_raw = str(raw.get("verdict") or "").strip().upper()
    verdict = verdict_raw if verdict_raw in ("GENUINE", "SUSPECTED") else None

    cross_flags: List[dict] = []
    for f in (raw.get("cross_flags") or []):
        if not isinstance(f, dict) or not f.get("tag") or not f.get("text"):
            continue
        tag = str(f["tag"]).strip().upper()
        if tag not in VALID_TAGS:
            tag = "SUSPICIOUS"
        cross_flags.append({
            "tag": tag, "text": str(f["text"]).strip(),
            "file_name": f.get("file_name"), "page_number": f.get("page_number"),
            "origin": "cross",
        })
    return synthesis, cross_flags, verdict, not synthesis


# ═════════════════════════════════════════════════════════════════════════════
# Flag merge / render helpers
# ═════════════════════════════════════════════════════════════════════════════
# Forces every "[TAG] ... (Source: file, Page N)" span onto its own line,
# regardless of whether the LLM wrote it mid-sentence or on its own line.
# The checkbox UI (Dashboard.jsx's DISC_TAG_LINE_RE / parseFlatDiscrepancyItems)
# only recognizes a flag that STARTS a line — relying on the prompt alone to
# guarantee that was unreliable, so it's enforced here deterministically.
_FLAG_SPAN_RE = re.compile(
    r"\[(" + "|".join(re.escape(t) for t in VALID_TAGS) + r")\]\s*.*?\(Source:[^)]*\)\.?",
    re.IGNORECASE,
)


def _normalize_flag_lines(text: str) -> str:
    if not text:
        return text
    out_lines: List[str] = []
    for line in text.split("\n"):
        matches = list(_FLAG_SPAN_RE.finditer(line))
        if not matches:
            out_lines.append(line)
            continue
        pos = 0
        for m in matches:
            before = line[pos:m.start()].strip()
            if before:
                out_lines.append(before)
            out_lines.append(m.group(0).strip())
            pos = m.end()
        after = line[pos:].strip()
        if after:
            out_lines.append(after)
    return "\n".join(out_lines)


def _dedupe_flags(flags: List[dict]) -> List[dict]:
    seen = set()
    out = []
    for f in flags:
        key = (f.get("tag"), (f.get("text") or "").strip().lower()[:50])
        if key in seen:
            continue
        seen.add(key)
        out.append(f)
    return out


def _render_flags_block(flags: List[dict]) -> str:
    lines = []
    for f in flags:
        cite = ""
        if f.get("file_name"):
            cite = f" (Source: {f['file_name']}" + (f", Page {f['page_number']})" if f.get("page_number") else ")")
        lines.append(f"[{f['tag']}] {f['text']}{cite}")
    return "\n".join(lines)


_SENTINEL = "Member / insured visit was not conducted as part of this investigation, so no member-side findings are available."


# ═════════════════════════════════════════════════════════════════════════════
# ORCHESTRATOR
# ═════════════════════════════════════════════════════════════════════════════
async def generate_unified_conclusion(
    triggers: List[str],
    text: str,
    pass1_result: Dict[str, Any],
    preprocessed: Dict[str, Any],
    additional_context: str = "",
    selected_findings: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    pass1_result = _make_serializable(pass1_result)
    text = _strip_markup_preserving_markers(text)
    annotations = parse_reviewer_annotations(additional_context)
    annotations_block = _format_annotations_for_llm(annotations)
    selected_findings_block = _format_selected_findings_for_llm(selected_findings or [])
    extra_focus = ", ".join(TRIGGER_LABELS.get(t, t) for t in (triggers or []))
    failed_sections: List[Dict[str, str]] = []

    death_indicated = pass1_indicates_death(pass1_result)

    hospital_task = _run_story(_HOSPITAL_SYSTEM, _hospital_user, text, pass1_result,
                                annotations_block, extra_focus, 7000, "hospital-side", "hospital")
    member_classification_task = classify_member_documents(text)
    (hospital_story, hospital_flags, hospital_failed), member_classification = await asyncio.gather(
        hospital_task, member_classification_task
    )

    if hospital_failed:
        failed_sections.append({"section": "hospital_story", "reason": "empty/unparseable response"})
        hospital_story = hospital_story or "[Hospital findings could not be generated. Please retry.]"
    hospital_story = _normalize_flag_lines(hospital_story)

    # Deterministic, zero-hallucination flags derived purely from Pass 1's
    # own structured chart-quality/billing fields (compute_auto_discrepancies
    # in preprocessor.py) — free precision the LLM story call can't guarantee
    # on its own (blank vitals chart, ICU billed without register, SpO2>100%
    # physiological impossibility, etc). Folded in as hospital-side flags.
    for line in (preprocessed.get("auto_discrepancies") or []):
        m = re.match(r"\[([A-Z /]+)\]\s*(.+)", line)
        if not m:
            continue
        tag = m.group(1).strip()
        hospital_flags.append({
            "tag": tag if tag in VALID_TAGS else "SUSPICIOUS",
            "text": m.group(2).strip(),
            "file_name": None, "page_number": None, "origin": "hospital",
        })

    member_present = member_classification.get("member_visit_present", False)
    member_story, member_flags = _SENTINEL, []
    if member_present:
        member_text = extract_member_text_from_pages(text, member_classification.get("member_locations") or [])
        member_story, member_flags, member_failed = await _run_story(
            _MEMBER_SYSTEM, _member_user, member_text, pass1_result,
            annotations_block, extra_focus, 5000, "member visit", "member",
        )
        if member_failed:
            failed_sections.append({"section": "member_story", "reason": "empty/unparseable response"})
        if not member_story or "not conducted" in member_story.lower():
            member_story, member_flags = _SENTINEL, []
        else:
            member_story = _normalize_flag_lines(member_story)

    critical_fact_missing = False
    if death_indicated and not prose_mentions_death(hospital_story):
        critical_fact_missing = True
        note_text = (
            "Pass 1 extraction indicates a death outcome (death date / cause of "
            "death / postmortem / death certificate) that was not reflected in "
            "the Hospital Visit Account above. Manual review is required to "
            "confirm outcome, date, place, and cause of death."
        )
        hospital_story += f"\n\n[CRITICAL FACT MISSING] {note_text}"
        hospital_flags.append({"tag": "CRITICAL FACT MISSING", "text": note_text, "file_name": None, "page_number": None, "origin": "hospital"})
        logger.warning("CRITICAL FACT CHECK: death indicated by Pass 1 but absent from hospital story")

    synthesis, cross_flags, llm_verdict, conclusion_failed = await _run_conclusion(
        hospital_story, member_story, hospital_flags, member_flags,
        pass1_result, annotations_block, selected_findings_block, critical_fact_missing,
    )
    if conclusion_failed:
        failed_sections.append({"section": "conclusion", "reason": "empty/unparseable response"})
        synthesis = synthesis or "The two accounts above did not yield enough material for an automated synthesis; please review both directly."

    # Section 3's DISCREPANCIES block is CROSS-ACCOUNT ONLY — hospital-side
    # and member-side flags are already inline (with their own checkboxes,
    # via the frontend's FlaggedSectionView) in Section 1 / Section 2
    # respectively. Repeating them here is exactly the "afterward, in the
    # conclusion" duplication that was supposed to be eliminated.
    cross_flags = _dedupe_flags(cross_flags)
    flags_block = _render_flags_block(cross_flags)

    # specialistFindings (a separate Investigation Review tab, not the
    # story itself) still covers every flag from every source.
    all_flags = _dedupe_flags(hospital_flags + member_flags + cross_flags)

    final_verdict = "SUSPECTED" if critical_fact_missing else (llm_verdict or "GENUINE")
    verdict_sentence = (
        "Hence based on the above discrepancies, this claim appears Suspected as an advisory read for the reviewing doctor — manual review is recommended before any decision."
        if final_verdict == "SUSPECTED" else
        "Hence based on the above findings, this claim appears Genuine as an advisory read for the reviewing doctor — this is not a final determination."
    )

    section3_parts = []
    if flags_block:
        section3_parts.append("DISCREPANCIES\n" + flags_block)
    if synthesis:
        section3_parts.append(synthesis)
    section3_parts.append(verdict_sentence)
    section3 = "\n\n".join(section3_parts)

    if critical_fact_missing:
        section3 = ("⚠ MANUAL REVIEW REQUIRED — a possible unreflected critical fact was "
                    "detected (see flag above) and could not be confirmed by this "
                    "automated pipeline.\n\n") + section3

    conclusion = (
        "SECTION 1 — HOSPITAL VISIT ACCOUNT\n\n"
        f"{hospital_story}\n\n\n"
        "SECTION 2 — MEMBER / INSURED VISIT ACCOUNT\n\n"
        f"{member_story}\n\n\n"
        "SECTION 3 — CONCLUSION\n\n"
        f"{section3}"
    )

    try:
        conclusion = reconcile_conclusion(conclusion, pass1_result, annotations)
    except Exception:
        logger.exception("reconcile_conclusion post-processing failed — using unreconciled text")

    status = "DEGRADED" if failed_sections else "COMPLETE"

    specialist_findings_structured = [
        {
            "agent": f.get("origin", "other"),
            "agentLabel": {"hospital": "Hospital", "member": "Member", "cross": "Cross-check"}.get(f.get("origin"), "Other"),
            "type": f["tag"],
            "explanation": f["text"],
            "location": {"hospital": "hospital_episode", "member": "member"}.get(f.get("origin"), "other"),
            "episodeIndex": None,
            "quotes": ([{"file_name": f.get("file_name"), "page_number": f.get("page_number"), "quote": None, "verified": False}]
                       if f.get("file_name") else []),
        }
        for f in all_flags
    ]

    logger.info(
        "generate_unified_conclusion | member_present=%s | critical_fact_missing=%s | "
        "llm_verdict=%s | final_verdict=%s | status=%s | failed_sections=%d | flags=%d | chars=%d",
        member_present, critical_fact_missing, llm_verdict, final_verdict, status,
        len(failed_sections), len(all_flags), len(conclusion),
    )
    return {
        "conclusion": conclusion,
        "status": status,
        "failed_sections": failed_sections,
        "verdict": final_verdict,
        "specialistFindings": specialist_findings_structured,
    }