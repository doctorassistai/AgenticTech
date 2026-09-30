"""
routes/agents/field_officer_report_agent.py
─────────────────────────────────────────────────────────────────────────────
Field-officer-aware conclusion generator. Runs instead of
unified_report_agent.generate_unified_conclusion() whenever a claim's
raw_llama_markdown contains [INV_TYPE/step_key] tags (see the branch point in
routes/conclusion.py::_process_generate_conclusion). unified_report_agent.py
itself is UNCHANGED — this is a new, parallel module, not a modification.

WHAT'S DIFFERENT FROM THE OLD PIPELINE, AND WHY:

- No more classify_member_documents() LLM guesser. The old pipeline had to
  *guess* from prose whether a page was "hospital" or "member" content. Here
  every page is already deterministically tagged with which investigator
  visit and checklist step it came from (field_investigation_parse_task.py),
  so classification is a lookup, not an inference. This is the single
  biggest simplification the tag-aware path buys.

- Sectioning is by CONTENT CATEGORY, not by inv_type. A single "Current
  Admission" section pulls together whichever inv_type(s) actually
  contributed current-admission documents (typically MV and/or HVI), each
  block explicitly labeled with whose copy it is, so the section's own
  prompt can cross-reference "member's copy says X, hospital's copy says Y"
  directly — this is exactly the discrepancy pattern (bill figure differs
  between the member's copy and the hospital's copy) that used to be
  structurally invisible when MV and HVI were narrated as two unrelated
  "stories" by two different LLM calls that never saw each other's pages.

- Completeness (what's missing) is NEVER inferred from prose here. Every
  section's checklist gaps come from
  investigation_checklist.compute_checklist_gaps(), which is the same
  function QC's own "what's missing" view is built from (see qc_review.py) —
  so the two can't drift. A step that was never submitted at all produces no
  markdown block, so a section built purely from parsed blocks would never
  even know that gap exists; compute_checklist_gaps() is computed from
  claim.investigations (the assignment + checklist side), independently of
  what got parsed, specifically to catch that case.

- Section count is dynamic per claim. A claim with no DIGI investigation
  simply has no DIGI section; a claim where PED/Prior History was never
  assigned still gets its gaps surfaced (as a no-content shell section) so
  "nothing was ever submitted for this" is stated explicitly rather than the
  section silently not existing.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional, Tuple

from routes.agents.base import call_groq, SHARED_RULES, _make_serializable
from routes.agents.chunking import split_text_by_pdf, batch_file_pages, render_page_batch
from routes.agents.preprocessor import parse_reviewer_annotations, reconcile_conclusion

from routes.agents.investigation_checklist import (
    parse_labeled_filename,
    categorize_step,
    label_for_inv_type,
    DOC_KEY_LABELS,
    build_investigations,
    compute_checklist_gaps,
    CATEGORY_CURRENT_ADMISSION,
    CATEGORY_PED_PRIOR_HISTORY,
    CATEGORY_VERIFICATION,
    CATEGORY_ADMINISTRATIVE,
    _normalize_doc_key,   # same normalizer QC's checklist labels use — reused
                           # here purely for display-label consistency, not
                           # for any behavior-affecting logic
)

# Reused, UNCHANGED, from the existing conclusion agent — these are generic
# helpers/constants that don't need to know anything about the tag-aware
# path (design decision: "reusing ... base.py's run_pass1/call_groq/
# SHARED_RULES (unchanged)" extends naturally to these small, self-contained
# pieces too, rather than forking copies that could drift).
from routes.agents.unified_report_agent import (
    TRIGGER_LABELS,
    VALID_TAGS,
    _format_annotations_for_llm,
    _format_selected_findings_for_llm,
    _strip_markup_preserving_markers,
    pass1_indicates_death,
    prose_mentions_death,
    _normalize_flag_lines,
    _dedupe_flags,
    _render_flags_block,
)

logger = logging.getLogger(__name__)


# ═════════════════════════════════════════════════════════════════════════════
# Section identity / display
# ═════════════════════════════════════════════════════════════════════════════
_SECTION_TITLES = {
    CATEGORY_CURRENT_ADMISSION: "Current Admission",
    CATEGORY_PED_PRIOR_HISTORY: "PED / Prior History",
    CATEGORY_ADMINISTRATIVE:    "Administrative / Identity",
}

# How each inv_type's contributed copy should be described when it lands in
# the (possibly multi-source) Current Admission section, so the section
# prompt can say "the member's copy" / "the hospital's copy" precisely
# rather than just echoing a raw inv_type code.
_COPY_OWNER_PHRASE = {
    "MV":   "the member/insured's own copy, collected by the investigator during the Member Visit",
    "HVI":  "the hospital's own copy, collected by the investigator directly from the hospital during the Hospital Visit",
    "BILL": "a copy collected specifically during bill verification",
}


def _display_label_for_step(step_key: str) -> str:
    normalized = _normalize_doc_key(step_key or "")
    return DOC_KEY_LABELS.get(normalized, normalized.replace("_", " ").title() or "Document")


def _home_section_key_and_category(inv_type: str) -> Tuple[str, str]:
    """Which section an inv_type's checklist gaps / investigator remarks
    belong to when there's no specific step_key to categorize (e.g. an
    inv_type that was assigned but has zero submitted documents at all)."""
    category = categorize_step(inv_type, "__no_step__")
    if category == CATEGORY_VERIFICATION:
        return f"verification:{inv_type}", category
    if category == CATEGORY_PED_PRIOR_HISTORY:
        return "ped_prior_history", category
    if category == CATEGORY_ADMINISTRATIVE:
        return "administrative", category
    return "current_admission", category


def _section_title(category: str, inv_type: Optional[str]) -> str:
    if category == CATEGORY_VERIFICATION and inv_type:
        return label_for_inv_type(inv_type)
    return _SECTION_TITLES.get(category, "Other")


# ═════════════════════════════════════════════════════════════════════════════
# Section assembly — group parsed [INV_TYPE/step_key] blocks by content
# category, fold in investigator remarks, and guarantee a "shell" section for
# every inv_type assigned on the claim even if it has zero parsed content
# (design decision #3: completeness must never depend on prose existing).
# ═════════════════════════════════════════════════════════════════════════════
def _ensure_section(sections: Dict[str, dict], key: str, category: str, inv_type: Optional[str]) -> dict:
    if key not in sections:
        sections[key] = {
            "key": key,
            "category": category,
            "title": _section_title(category, inv_type),
            "inv_types": set(),
            "blocks": [],   # [{block_name, text, inv_type, step_key}]
            "notes": [],    # investigator remarks (TEXT_KEYS), as prose lines
        }
    if inv_type:
        sections[key]["inv_types"].add(inv_type)
    return sections[key]


def build_sections(case_id: str, claim: dict, raw_llama_markdown: str) -> Tuple[List[dict], List[dict]]:
    """
    Returns (sections, checklist_gaps).
      sections: every section that either has content or belongs to an
        inv_type actually assigned on this claim, ready for _run_section().
      checklist_gaps: the full deterministic [MISSING] list from
        investigation_checklist.compute_checklist_gaps(), independent of
        which sections got built (used both to enrich section flags and,
        in the orchestrator, to sanity-check nothing was dropped).
    """
    # build_investigations() here is deliberately called with all_subs={} —
    # every claim's investigations[inv_type][].submission is populated by
    # /app/tasks/submit directly on the claim document (embedded fallback
    # path), so this needs no extra collection read to be complete, and
    # keeps this module a pure function of `claim` (no new service/DB
    # dependency, per design decision #9).
    investigations = build_investigations(case_id, claim, {})
    checklist_gaps = compute_checklist_gaps(investigations)

    files = split_text_by_pdf(raw_llama_markdown or "")
    sections: Dict[str, dict] = {}

    for block_name, block_text in files.items():
        parsed = parse_labeled_filename(block_name)
        if not parsed:
            continue  # untagged block — shouldn't appear once the branch
                       # point has already confirmed tags are present, but
                       # skip defensively rather than crash on a stray one
        inv_type, step_key = parsed["inv_type"], parsed["step_key"]
        category = categorize_step(inv_type, step_key)

        if category == CATEGORY_VERIFICATION:
            key = f"verification:{inv_type}"
        elif category == CATEGORY_PED_PRIOR_HISTORY:
            key = "ped_prior_history"
        elif category == CATEGORY_ADMINISTRATIVE:
            key = "administrative"
        else:
            key = "current_admission"

        sec = _ensure_section(sections, key, category, inv_type)
        sec["blocks"].append({
            "block_name": block_name,
            "text": block_text,
            "inv_type": inv_type,
            "step_key": step_key,
        })

    # Investigator remarks (TEXT_KEYS, e.g. mv_remarks/hv_observations/
    # tele_summary) — folded into each inv_type's home section as narrative
    # notes, never as a separate free-standing account (design decision #7).
    for inv_type, inv in investigations.items():
        remarks = (inv.get("submission") or {}).get("text_fields") or {}
        key, category = _home_section_key_and_category(inv_type)
        sec = _ensure_section(sections, key, category, inv_type)
        note_lines = [f"{k}: {v}" for k, v in remarks.items() if str(v).strip()]
        if note_lines:
            sec["notes"].append(
                f"Investigator notes from {label_for_inv_type(inv_type)} "
                f"({inv.get('investigatorName', 'investigator')}):\n" + "\n".join(note_lines)
            )

    # Guarantee a shell section for every inv_type actually assigned on the
    # claim, even with zero blocks and zero remarks, so its checklist gaps
    # (an investigation that was assigned but never touched at all) still
    # surface somewhere rather than vanishing because there's no markdown
    # to key off.
    for inv_type in investigations.keys():
        key, category = _home_section_key_and_category(inv_type)
        _ensure_section(sections, key, category, inv_type)

    return list(sections.values()), checklist_gaps


def _gaps_for_section(section: dict, checklist_gaps: List[dict]) -> List[dict]:
    matched = []
    for gap in checklist_gaps:
        if gap["category"] == CATEGORY_VERIFICATION:
            key = f"verification:{gap['inv_type']}"
        elif gap["category"] == CATEGORY_CURRENT_ADMISSION:
            key = "current_admission"
        elif gap["category"] == CATEGORY_PED_PRIOR_HISTORY:
            key = "ped_prior_history"
        else:
            key = "administrative"
        if key == section["key"]:
            matched.append(gap)
    return matched


# ═════════════════════════════════════════════════════════════════════════════
# File-budget chunking for a section's blocks — same pattern as
# unified_report_agent._chunk_by_file_budget, generalized to operate over an
# arbitrary set of ALREADY-SELECTED blocks (this section's blocks only)
# rather than every file in the combined text, and to carry a per-block
# SOURCE annotation through chunking/page-batching so a split block doesn't
# lose its "whose copy is this" context.
# ═════════════════════════════════════════════════════════════════════════════
_SECTION_CHUNK_BUDGET = 130_000


def _wrap_file(fname: str, ftext: str) -> str:
    return f"<!-- PDF_START: {fname} -->\n{ftext}\n<!-- PDF_END: {fname} -->"


def _source_line(inv_type: str, step_key: str) -> str:
    owner = _COPY_OWNER_PHRASE.get(inv_type, f"collected during {label_for_inv_type(inv_type)}")
    step_label = _display_label_for_step(step_key)
    return (
        f'SOURCE NOTE: the following document is "{step_label}", {owner} '
        f"(investigation type: {label_for_inv_type(inv_type)} / {inv_type})."
    )


def _chunk_section(blocks: List[dict], budget: int = _SECTION_CHUNK_BUDGET) -> List[str]:
    chunks: List[str] = []
    current: List[str] = []
    current_len = 0

    def _flush():
        nonlocal current, current_len
        if current:
            chunks.append("\n\n".join(current))
            current, current_len = [], 0

    for b in blocks:
        source_line = _source_line(b["inv_type"], b["step_key"])
        unit = f"{source_line}\n" + _wrap_file(b["block_name"], b["text"])
        if len(unit) > budget:
            _flush()
            pages = batch_file_pages(b["text"], max_chars=budget, overlap_pages=1)
            logger.info(
                "field_officer_report_agent: block=%s (%d chars) split into %d batch(es)",
                b["block_name"], len(b["text"]), len(pages),
            )
            for page_batch in pages:
                chunks.append(f"{source_line}\n" + render_page_batch(b["block_name"], page_batch))
            continue
        if current_len + len(unit) > budget and current:
            _flush()
        current.append(unit)
        current_len += len(unit)
    _flush()
    return chunks


# ═════════════════════════════════════════════════════════════════════════════
# Per-category system prompts
# ═════════════════════════════════════════════════════════════════════════════
_CURRENT_ADMISSION_SYSTEM = SHARED_RULES + """
You are a senior insurance field investigation officer writing the CURRENT
ADMISSION account for a formal claim investigation report. This section
covers the hospital admission/episode this claim is actually about, using
EVERY document collected about it regardless of which investigator visit
collected it — a Member Visit investigator's own copy of a discharge summary
and a Hospital Visit investigator's copy of the same document, collected
independently, both belong here side by side.

Each document below is preceded by a "SOURCE NOTE" line telling you exactly
whose copy it is (e.g. the member/insured's own copy vs. the hospital's own
copy) and which checklist item it was collected against. Use this deliberately:
the single most valuable thing this section can do that a single-source
account cannot is catch a figure or date that differs between the member's
copy and the hospital's copy of what should be the same fact — a bill total,
an admission date, a diagnosis. Always name explicitly WHICH copy each side
of a discrepancy came from (never just "one document said X" — say "the
member's copy of the discharge summary says X, while the hospital's copy of
the same document says Y").

Before writing your final answer, silently check items 1 through 16 of the
checklist below one at a time against the actual document text. Do not skip
an item because the story already "feels complete" — completeness of prose
is not the same as checklist coverage. If a category of document (e.g. any
hospital-side clinical record) simply isn't present in what's given below,
say so plainly rather than inventing content.

Return ONLY a single JSON object, no markdown fences, no prose outside JSON:
{
  "story": "<the narrative, plain paragraphs, min 250 words>",
  "flags": [
    {"tag": "<ONE of: CONTRADICTORY, MISSING, INCOMPLETE, SUSPICIOUS, BILLING MISMATCH, TIMELINE MISMATCH, DOCUMENT INTEGRITY, UNDISCLOSED PED SUSPECTED, PHYSIOLOGICAL ANOMALY, SINGLE STRETCH, CRITICAL FACT MISSING, SOURCE UNREADABLE>",
     "text": "<one or two sentences, reviewer-facing, plain language>",
     "file_name": "<exact block/file name the evidence is on>",
     "page_number": <int or null>}
  ]
}

WHAT THE STORY MUST COVER, in flowing prose (not a form-fill):
- Patient identification, admission date/time, presenting complaints,
  admitting diagnosis, and — if a death/accident claim with no inpatient
  admission (brought dead, fatal-accident/GPAIS claim) — narrate that
  plainly; the checklist below still applies in full to every document,
  clinical or not.
- What was found and done: vitals/investigation results, diagnosis reached,
  treatment/procedure given, outcome (discharged / against advice /
  transferred / died — state a death outcome explicitly with date, place,
  cause, never as a routine discharge).
- If more than one admission is present, describe EACH as its own
  paragraph with its own dates — never merge dates or outcomes.
- A plain-language bill summary: total billed, what it covers, whether it
  reconciles between the copies you have. Do NOT itemise every line item.
- Registration/credential status and who the data was collected from.

CHECKLIST — work through ALL of these as you write. When an item fires,
write it ONCE, as its own line: "[TAG] <one sentence> (Source: file, Page N)"
— never restate the same fact again in plain prose right before or after it.

1. MEMBER-VS-HOSPITAL COPY DISCREPANCY — when the SAME kind of document
   (same checklist step, e.g. two "discharge summary" blocks) was collected
   from more than one source, compare them line for line: bill totals,
   dates, diagnosis wording, vitals. Flag [CONTRADICTORY] any figure that
   differs, always naming which copy said what.
2. CONTRADICTORY (within or across sources) — the same fact stated two
   different ways anywhere in this section's documents.
3. UNDISCLOSED PED SUSPECTED — a chronic condition, long-standing
   medication, or history predating this admission's stated onset, as shown
   by THIS section's own records. (The dedicated PED/Prior History section
   handles the deeper history verification — just flag what these current-
   admission records themselves show.)
4. BILLING MISMATCH — a charge with no supporting record among these
   documents; a bill total that doesn't reconcile with its own line items
   or across the member's/hospital's copies; an unexplained discount. Sum
   amounts across ALL related documents (e.g. hospital bill + pharmacy
   invoice) before flagging a mismatch a simple sum would resolve.
5. MISSING / INCOMPLETE — an expected register/certificate/form is absent;
   core claim-form fields (policy number, claim number, sum insured) left
   blank; a covering letter's listed enclosures not all present (name the
   missing one); an either/or exclusion-relevant field (intoxication,
   willful act) where NEITHER option was struck out. This field type is
   NEVER optional to mention if present in the documents — every time.
   NEVER write a sentence asserting this field's resolved value anywhere,
   including outside the flag line — the only permitted phrasing for an
   unresolved strike-out field is "left unresolved / not indicated" inside
   an [INCOMPLETE] flag, attributed to the exact document it physically
   appears on.
6. DOCUMENT INTEGRITY — a struck-through/duplicated figure; a "DUPLICATE"
   stamp; a document dated after a documented death; a first-person
   declaration ("I hereby declare...") dated after a documented date of
   death (the insured couldn't have personally signed it). Text-only check
   — never claim to have evaluated handwriting/ink/physical signatures.
7. IDENTITY / DEMOGRAPHIC CONTRADICTION — compare name/age/DOB/occupation
   and any relative/witness/claimant names across every document in this
   section. Flag [CONTRADICTORY] any value that differs. Flag [SUSPICIOUS]
   (factually, not as an accusation) if a signature name doesn't match the
   name given for that relative elsewhere. Flag [DOCUMENT INTEGRITY] an
   impossible calendar date anywhere.
8. PHYSIOLOGICAL ANOMALY — a vital/lab value implausible or inconsistent
   with the stated clinical picture, not merely abnormal.
9. SINGLE STRETCH — notes/charts that read as written in one sitting
   rather than dated across the real admission period.
10. SUSPICIOUS — anything else with genuine textual evidence worth a
    reviewer's attention, including a claimant's bank account/ID/credential
    shown as opened/dated after the documented death/accident without
    explanation elsewhere — phrase factually, always name WHOSE
    account/document it is.
11. SOURCE UNREADABLE — a page whose extracted text is not coherent
    language (garbled repetition, disconnected characters). Do not guess at
    its content; flag once per contiguous unreadable range: "[SOURCE
    UNREADABLE] Page N of <file> could not be read (Source: file, Page N)."
12. CROSS-DOCUMENT FACILITY CONTRADICTION — hospital name/address/bed
    count/room type differing across documents in this section. Flag
    [CONTRADICTORY]; never assert an accreditation/specialist claim is
    false, only that it varies document-to-document.
13. CLINICAL GENUINENESS — is the diagnosis supported by investigation
    reports/findings in these documents, or asserted with no supporting
    evidence? Do admission/discharge records agree with each other? Flag
    [SUSPICIOUS] (worth clinical review, never asserted as fabrication).
14. MEDICAL NECESSITY — does the level of care (inpatient vs. what reads
    outpatient-manageable; ICU billed vs. what the vitals/notes support;
    length of stay vs. documented progress) match the clinical picture?
    Flag [SUSPICIOUS], phrased neutrally for the doctor to weigh.
15. BILL COMPOSITION — non-payable line items; a high-cost item bundled
    into a lump sum rather than itemized; no payment-mode/receipt evidence
    at all for a bill this size; a service billed twice under separate
    entries; a billed service with no corresponding report anywhere in
    these documents (only when you can positively confirm none exists).
16. TIMELINE RECONSTRUCTION — build symptom onset -> consultation ->
    admission -> treatment -> discharge explicitly from this section's own
    documents. Flag [TIMELINE MISMATCH] where two of THIS section's own
    documents disagree on the same date.

RULES:
- Never state a form field has a specific value unless that exact value is
  present in the text. A blank/unmarked field is "not indicated" —
  never resolved to a value on its behalf.
- Do not narrate a claimed mechanism or sequence not stated in the
  documents; if a sequence is unclear, flag the gap itself rather than
  filling it with the most likely reading.
- Every specific claim attributed to a named document must be re-locatable
  in that document's own text below — verify each citation independently,
  never assume a fact appears on a document "because it's the kind that
  would carry it."
- Never combine two distinct named entities (two hospitals, two doctors)
  from two different documents into one sentence unless a document
  explicitly links them.
- Never fabricate facts, drug names, dates, amounts. Use "not documented"
  for gaps.
- The "flags" array must exactly mirror every bracketed flag written inline
  in "story" — same tags, same claims, same order.
"""


def _current_admission_user(chunk_text: str, pass1_result: dict, annotations_block: str,
                             extra_focus: str, notes_block: str, part_info: str = "") -> str:
    focus_block = f"ADDITIONAL FOCUS AREAS REQUESTED BY THE REVIEWING DOCTOR: {extra_focus}\n\n" if extra_focus else ""
    part_block = f"{part_info}\n\n" if part_info else ""
    notes = f"{notes_block}\n\n" if notes_block else ""
    return f"""{part_block}{focus_block}ALREADY-EXTRACTED CLAIM FACTS (Pass 1 structured data — cross-check the
documents below against this; flag [CONTRADICTORY] if they disagree; do not
just restate this JSON in your story):
{json.dumps(pass1_result, default=str)[:4000]}

{annotations_block}
{notes}CURRENT-ADMISSION DOCUMENT TEXT (each preceded by a SOURCE NOTE telling you
whose copy it is):
{chunk_text}
"""


_PED_PRIOR_HISTORY_SYSTEM = SHARED_RULES + """
You are writing the PED / PRIOR HISTORY account for a formal insurance
investigation report. This section covers verification of a prior/earlier
admission or pre-existing condition — the Past Hospital Visit investigator's
interview-based verification, plus any "past OP papers" / "past IP papers" /
prior-consultation documents collected during the current-admission visits
(these are inherently about history predating the current claim, wherever
they physically landed).

Each document below is preceded by a SOURCE NOTE telling you which
investigation type and checklist step it came from — use it, but do not
re-litigate whether a document genuinely belongs here; that classification
is already deterministic (it's in the tag), unlike the old prose-guessing
approach this replaces.

If, after reading everything below, there is no genuine content here (the
section exists only because an investigation type was assigned but nothing
was ever submitted for it), return exactly:
{
  "story": "No PED / prior-history verification content is available — either this investigation was not assigned, or nothing was submitted for it yet.",
  "flags": []
}

Otherwise return ONLY a single JSON object, no markdown fences:
{
  "story": "<the narrative, plain paragraphs, min 200 words>",
  "flags": [ {same shape as above: tag, text, file_name, page_number} ]
}

WHAT THE STORY MUST COVER:
- Who was interviewed/visited for the prior admission verification, by
  whom, and what was found: the prior condition/admission, when, where,
  treating doctor, and outcome, as disclosed or independently observed.
- What any "past OP/IP papers" collected during the current visits
  themselves show about pre-existing history.
- Whether disclosure at the time (PED declaration, proposal-stage history)
  is addressed by any document here.

CHECKLIST — fold every hit inline as "[TAG] explanation (Source: file, Page N)".
Tags: CONTRADICTORY, MISSING, INCOMPLETE, SUSPICIOUS, DOCUMENT INTEGRITY,
UNDISCLOSED PED SUSPECTED, TIMELINE MISMATCH, SOURCE UNREADABLE.
1. UNDISCLOSED PED SUSPECTED — any condition/medication/history here that
   predates the current admission and was not disclosed at proposal or in
   the current-admission's own records (you cannot see those records here —
   just flag what THIS section's own documents show; the cross-check
   against the current admission happens at a later step).
2. CONTRADICTORY — internal contradictions within these documents
   themselves (two different onset dates, two different doctors for the
   same prior episode, etc.).
3. MISSING / INCOMPLETE — an expected verification element (interview
   record, prior discharge summary, doctor confirmation) not present.
4. DOCUMENT INTEGRITY / SUSPICIOUS — a declaration that reads like a
   form-filling artefact (every checklist condition marked YES with no
   duration/doctor for any) — flag [SUSPICIOUS], neutrally, as a likely
   marking error worth confirming, never as concealment.
5. TIMELINE MISMATCH — two dates within this section's own documents that
   don't agree for what should be the same prior event.
6. SOURCE UNREADABLE — same handling as the current-admission section.

RULES: same no-fabrication, no-value-invention, and flags-mirror-inline
rules as the current-admission section. Do NOT compare against the current
admission's own records here — you cannot see them; a later cross-check
step does that.
"""


def _ped_prior_history_user(chunk_text: str, pass1_result: dict, annotations_block: str,
                             extra_focus: str, notes_block: str, part_info: str = "") -> str:
    focus_block = f"ADDITIONAL FOCUS AREAS REQUESTED BY THE REVIEWING DOCTOR: {extra_focus}\n\n" if extra_focus else ""
    part_block = f"{part_info}\n\n" if part_info else ""
    notes = f"{notes_block}\n\n" if notes_block else ""
    return f"""{part_block}{focus_block}ALREADY-EXTRACTED CLAIM FACTS (Pass 1 structured data, for context only):
{json.dumps(pass1_result, default=str)[:3000]}

{annotations_block}
{notes}PED / PRIOR-HISTORY DOCUMENT TEXT:
{chunk_text}
"""


def _verification_system(inv_type: str) -> str:
    label = label_for_inv_type(inv_type)
    return SHARED_RULES + f"""
You are writing the {label.upper()} account for a formal insurance
investigation report — a bespoke verification pass done independently of
the hospital/member visits (e.g. a telephonic call, a digital verification,
or a specific trigger-driven check), same pattern as any other independent
verification account in this report.

If there is no genuine content here (the section exists only because this
investigation type was assigned but nothing was submitted for it), return
exactly:
{{
  "story": "No {label} content is available — either this investigation was not assigned, or nothing was submitted for it yet.",
  "flags": []
}}

Otherwise return ONLY a single JSON object, no markdown fences:
{{
  "story": "<the narrative, plain paragraphs, min 120 words>",
  "flags": [ {{"tag": "<ONE of: CONTRADICTORY, MISSING, INCOMPLETE, SUSPICIOUS, TIMELINE MISMATCH, DOCUMENT INTEGRITY, SOURCE UNREADABLE>", "text": "...", "file_name": "...", "page_number": <int or null>}} ]
}}

WHAT THE STORY MUST COVER: who/what was verified, by whom, when, and what
was found or confirmed — in the person's own words or closely paraphrased
where a transcript/recording is the source.

CHECKLIST — fold every hit inline as "[TAG] explanation (Source: file, Page N)".
1. CONTRADICTORY — this verification's own findings conflicting internally.
2. MISSING / INCOMPLETE — an expected element of this verification (a call
   summary, a confirmed name/date) not present.
3. TIMELINE MISMATCH — two dates within these documents that disagree.
4. DOCUMENT INTEGRITY — signs a recording/transcript was altered, or a
   document dated impossibly.
5. SOURCE UNREADABLE — a transcript/page that isn't coherent text; flag it,
   do not guess its content.
6. SUSPICIOUS — anything else with genuine textual evidence, phrased
   factually, never as an accusation.

RULES: same no-fabrication rules as the other sections. Never fabricate a
quote from a call/transcript; paraphrase faithfully.
"""


def _verification_user(chunk_text: str, pass1_result: dict, annotations_block: str,
                        extra_focus: str, notes_block: str, part_info: str = "") -> str:
    focus_block = f"ADDITIONAL FOCUS AREAS REQUESTED BY THE REVIEWING DOCTOR: {extra_focus}\n\n" if extra_focus else ""
    part_block = f"{part_info}\n\n" if part_info else ""
    notes = f"{notes_block}\n\n" if notes_block else ""
    return f"""{part_block}{focus_block}{annotations_block}
{notes}DOCUMENT TEXT:
{chunk_text}
"""


_ADMINISTRATIVE_SYSTEM = SHARED_RULES + """
You are writing the ADMINISTRATIVE / IDENTITY note for a formal insurance
investigation report — identity proofs, policy cards, photos, and similar
administrative material. This section is referenced LIGHTLY, not flag-heavy:
its job is a short factual account of what identity/administrative material
was collected, plus catching a genuine identity mismatch if one is visible
— not a deep investigative narrative.

If there is no genuine content here, return exactly:
{
  "story": "No administrative/identity documents are available for this claim.",
  "flags": []
}

Otherwise return ONLY a single JSON object, no markdown fences:
{
  "story": "<a short factual paragraph, 80-150 words unless flags require more>",
  "flags": [ {"tag": "<ONE of: CONTRADICTORY, DOCUMENT INTEGRITY, SUSPICIOUS, SOURCE UNREADABLE>", "text": "...", "file_name": "...", "page_number": <int or null>} ]
}

WHAT THE NOTE MUST COVER: which identity/policy documents were collected
and for whom, stated plainly and briefly.

CHECKLIST:
1. CONTRADICTORY — name/age/DOB/address differing across these identity
   documents for what should be the same person.
2. DOCUMENT INTEGRITY — an ID/policy document that looks altered,
   photocopied-of-a-photocopy to the point of illegibility, or otherwise
   suspect on its face (text-only assessment, never physical/ink claims).
3. SOURCE UNREADABLE — same handling as other sections.
4. SUSPICIOUS — only for genuine, specific evidence; do not manufacture
   concern over routine photo/ID quality.

Do not flag missing documents here — completeness is tracked separately and
deterministically; your only job is to describe what IS present and flag
genuine problems with it.

RULES: same no-fabrication rules as the other sections.
"""


def _administrative_user(chunk_text: str, annotations_block: str, notes_block: str, part_info: str = "") -> str:
    part_block = f"{part_info}\n\n" if part_info else ""
    notes = f"{notes_block}\n\n" if notes_block else ""
    return f"""{part_block}{annotations_block}
{notes}ADMINISTRATIVE / IDENTITY DOCUMENT TEXT:
{chunk_text}
"""


# ═════════════════════════════════════════════════════════════════════════════
# Generic section runner — handles chunking, the no-content shell case, and
# stitching multi-chunk results back together for any category.
# ═════════════════════════════════════════════════════════════════════════════
async def _run_section(
    section: dict,
    pass1_result: dict,
    annotations_block: str,
    extra_focus: str,
    checklist_gaps: List[dict],
) -> Dict[str, Any]:
    """Returns {"key","title","category","story","flags","failed"}."""
    key, category, title = section["key"], section["category"], section["title"]
    notes_block = "\n\n".join(section["notes"]) if section["notes"] else ""
    gaps = _gaps_for_section(section, checklist_gaps)

    if not section["blocks"] and not notes_block:
        # No content at all for this inv_type/category — deterministic
        # shell, no LLM call (nothing to narrate, and calling the model on
        # empty input only risks it inventing something to say).
        if gaps:
            gap_lines = "; ".join(g["label"] for g in gaps)
            story = (
                f"No documents or investigator notes were submitted for {title} "
                f"({', '.join(sorted(section['inv_types'])) or 'unassigned'}). "
                f"{len(gaps)} required item(s) remain outstanding: {gap_lines}."
            )
        else:
            story = f"No content was collected for {title}, and no checklist items were assigned to it."
        flags = [{
            "tag": g["tag"], "text": g["text"], "file_name": None, "page_number": None,
            "origin": key,
        } for g in gaps]
        return {"key": key, "title": title, "category": category, "story": story, "flags": flags, "failed": False}

    if category == CATEGORY_CURRENT_ADMISSION:
        system, user_builder = _CURRENT_ADMISSION_SYSTEM, _current_admission_user
        max_tokens = 7000
    elif category == CATEGORY_PED_PRIOR_HISTORY:
        system, user_builder = _PED_PRIOR_HISTORY_SYSTEM, _ped_prior_history_user
        max_tokens = 5000
    elif category == CATEGORY_VERIFICATION:
        inv_type = next(iter(section["inv_types"]), "")
        system, user_builder = _verification_system(inv_type), _verification_user
        max_tokens = 4000
    else:  # administrative
        system, user_builder = _ADMINISTRATIVE_SYSTEM, None
        max_tokens = 2500

    chunks = _chunk_section(section["blocks"]) if section["blocks"] else [""]

    async def _call_chunk(i: int, chunk_text: str) -> Optional[Dict[str, Any]]:
        part_info = (
            f"This is part {i} of {len(chunks)} of the {title} documents for this "
            f"claim (split for length). Narrate only what's in the pages below, in "
            f"the same JSON shape — a later step stitches every part together."
        ) if len(chunks) > 1 else ""
        if category == CATEGORY_ADMINISTRATIVE:
            prompt = _administrative_user(chunk_text, annotations_block, notes_block, part_info)
        else:
            prompt = user_builder(chunk_text, pass1_result, annotations_block, extra_focus, notes_block, part_info)
        try:
            return await call_groq(system, prompt, max_tokens=max_tokens)
        except Exception:
            logger.exception("%s section call failed (part %d/%d)", title, i, len(chunks))
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
                "tag": tag, "text": str(f["text"]).strip(),
                "file_name": f.get("file_name"), "page_number": f.get("page_number"),
                "origin": key,
            })

    failed = not any_ok
    combined_story = "\n\n".join(stories) if stories else f"[{title} content could not be generated. Please retry.]"
    combined_story = _normalize_flag_lines(combined_story)

    # Deterministic checklist gaps appended on top of whatever the LLM found
    # — never left for the LLM to notice on its own (design decision #3).
    for g in gaps:
        flags.append({"tag": g["tag"], "text": g["text"], "file_name": None, "page_number": None, "origin": key})

    return {"key": key, "title": title, "category": category, "story": combined_story, "flags": flags, "failed": failed}


# ═════════════════════════════════════════════════════════════════════════════
# Cross-section conclusion — Call-C generalized from a hardcoded 2 sections
# (hospital/member) to however many sections this claim actually has.
# ═════════════════════════════════════════════════════════════════════════════
_CROSS_SECTION_SYSTEM = SHARED_RULES + """
You are writing the CONCLUSION of a formal insurance investigation report.
You already have every section's account below, each already carrying its
own inline flags — do NOT repeat, restate, or re-summarise any of them.
Your only job is:

1. Cross-check the sections against EACH OTHER and surface anything that
   ONLY becomes visible by comparing sections side by side (no single
   section could have caught this — each only saw its own material). The
   most common and important case: the Current Admission account and the
   PED/Prior History account disagreeing about whether a condition was
   pre-existing, or a verification section contradicting either of them.
2. POLICY / COVERAGE CHECK — using the policy dates/event date in the claim
   facts below and anything any section already stated about them, check
   whether the admission/event date falls within the policy period, and
   whether any section mentioned a waiting-period/exclusion this claim's
   timing or diagnosis appears to conflict with. Only flag [INCOMPLETE] or
   [CONTRADICTORY] on what the sections/facts actually state — never say
   coverage is "approved" or "denied."
3. TIMELINE CROSS-CHECK — compare the event sequence each section
   independently establishes. Flag [TIMELINE MISMATCH] only for a
   conflict that requires comparing sections — a mismatch visible within
   one section was already that section's own job to catch.
4. A short, doctor-facing synthesis (150-250 words): does the picture hold
   together across every section? What still needs the doctor's judgement?
5. End with one sentence naming an advisory read — GENUINE or SUSPECTED —
   explicitly framed as input to the doctor's own determination.

Return ONLY a single JSON object, no markdown fences:
{
  "cross_flags": [
    {"tag": "<same tag vocabulary as before>", "text": "...", "file_name": "<from any section, if attributable>", "page_number": <int or null>}
  ],
  "synthesis": "<the short paragraph(s) above; reference cross_flags inline
                 as '[TAG] explanation (Source: file, Page N)' — do not list
                 them again separately>",
  "verdict": "GENUINE" | "SUSPECTED"
}

RULES:
- Only include a cross_flags item if it depends on comparing TWO OR MORE
  sections — if a single section could already have flagged it alone,
  leave it out, it's already flagged there.
- Never fabricate. If sections don't overlap enough to cross-check (e.g.
  only one section has real content), say so plainly and keep cross_flags
  empty.
- Doctor-selected findings or reviewer annotations given to you are
  informational only — they must never by themselves force SUSPECTED.
- If told a CRITICAL FACT FLAG is active, your verdict MUST be SUSPECTED
  and your synthesis must say plainly that manual review is required for
  that fact, regardless of anything else.
"""


def _flags_to_compact_json(flags: List[dict]) -> str:
    return json.dumps([{k: v for k, v in f.items() if k != "origin"} for f in flags], default=str)[:6000]


def _cross_section_user(
    sections: List[dict], pass1_result: dict, annotations_block: str,
    selected_findings_block: str, critical_fact_block: str,
) -> str:
    parts = [critical_fact_block]
    for sec in sections:
        parts.append(
            f"{sec['title'].upper()} ACCOUNT (already written — do not repeat):\n"
            f"{sec['story'][:4000]}\n\n"
            f"{sec['title'].upper()} FLAGS ALREADY RAISED (already inline above):\n"
            f"{_flags_to_compact_json(sec['flags'])}\n"
        )
    parts.append(
        f"ALREADY-EXTRACTED CLAIM FACTS (Pass 1 structured data):\n"
        f"{json.dumps(pass1_result, default=str)[:3000]}\n"
    )
    parts.append(annotations_block)
    parts.append(selected_findings_block)
    return "\n".join(parts)


async def _run_cross_section(
    sections: List[dict], pass1_result: dict, annotations_block: str,
    selected_findings_block: str, critical_fact_missing: bool,
) -> Tuple[str, List[dict], Optional[str], bool]:
    critical_fact_block = ""
    if critical_fact_missing:
        critical_fact_block = (
            "CRITICAL FACT FLAG — ACTIVE: Pass 1's structured extraction indicates "
            "a death outcome that was not reflected in any section's account below. "
            "State plainly this is unresolved and requires manual review; set "
            "verdict to SUSPECTED regardless of anything else.\n"
        )
    prompt = _cross_section_user(sections, pass1_result, annotations_block, selected_findings_block, critical_fact_block)
    try:
        raw = await call_groq(_CROSS_SECTION_SYSTEM, prompt, max_tokens=4000)
    except Exception:
        logger.exception("Cross-section conclusion call failed")
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
# ORCHESTRATOR
# ═════════════════════════════════════════════════════════════════════════════
# NOTE ON SIGNATURE: this takes `case_id` and `claim` in addition to
# everything generate_unified_conclusion() takes, because checklist-gap
# computation (design decision #3) needs claim.investigations, which the
# old pipeline never touched. routes/conclusion.py's branch point (module
# #4) needs to pass these two extra arguments on the tagged path.
async def generate_field_officer_conclusion(
    case_id: str,
    claim: Dict[str, Any],
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

    sections, checklist_gaps = build_sections(case_id, claim, text)
    # Stable, readable order: Current Admission, PED/Prior History,
    # verification sections (alphabetical by inv_type for determinism),
    # Administrative last.
    order_key = {CATEGORY_CURRENT_ADMISSION: 0, CATEGORY_PED_PRIOR_HISTORY: 1,
                 CATEGORY_VERIFICATION: 2, CATEGORY_ADMINISTRATIVE: 3}
    sections.sort(key=lambda s: (order_key.get(s["category"], 9), s["key"]))

    death_indicated = pass1_indicates_death(pass1_result)

    section_results = await asyncio.gather(*[
        _run_section(sec, pass1_result, annotations_block, extra_focus, checklist_gaps)
        for sec in sections
    ])

    for res in section_results:
        if res["failed"]:
            failed_sections.append({"section": res["key"], "reason": "empty/unparseable response"})

    # Fold Pass 1's own structural/billing auto-discrepancies (from
    # preprocessor.compute_auto_discrepancies) into the Current Admission
    # section's flags, same treatment as the old pipeline — these are
    # zero-hallucination, chart-quality-derived flags tied to the current
    # admission's own records.
    import re as _re
    current_admission_result = next((r for r in section_results if r["key"] == "current_admission"), None)
    if current_admission_result is not None:
        for line in (preprocessed.get("auto_discrepancies") or []):
            m = _re.match(r"\[([A-Z /]+)\]\s*(.+)", line)
            if not m:
                continue
            tag = m.group(1).strip()
            current_admission_result["flags"].append({
                "tag": tag if tag in VALID_TAGS else "SUSPICIOUS",
                "text": m.group(2).strip(),
                "file_name": None, "page_number": None, "origin": "current_admission",
            })

    # Generalized death safety-net: if Pass 1 indicates a death outcome but
    # NO section's story mentions it anywhere, force a critical flag. Attach
    # to Current Admission if it exists (most likely home for an outcome),
    # else the first section that exists, else note it stand-alone.
    critical_fact_missing = False
    all_story_text = " ".join(r["story"] for r in section_results)
    if death_indicated and not prose_mentions_death(all_story_text):
        critical_fact_missing = True
        note_text = (
            "Pass 1 extraction indicates a death outcome (death date / cause of "
            "death / postmortem / death certificate) that was not reflected in "
            "any section's account above. Manual review is required to confirm "
            "outcome, date, place, and cause of death."
        )
        target = current_admission_result or (section_results[0] if section_results else None)
        if target is not None:
            target["story"] += f"\n\n[CRITICAL FACT MISSING] {note_text}"
            target["flags"].append({
                "tag": "CRITICAL FACT MISSING", "text": note_text,
                "file_name": None, "page_number": None, "origin": target["key"],
            })
        logger.warning("CRITICAL FACT CHECK: death indicated by Pass 1 but absent from every section's story")

    synthesis, cross_flags, llm_verdict, conclusion_failed = await _run_cross_section(
        section_results, pass1_result, annotations_block, selected_findings_block, critical_fact_missing,
    )
    if conclusion_failed:
        failed_sections.append({"section": "conclusion", "reason": "empty/unparseable response"})
        synthesis = synthesis or "The sections above did not yield enough material for an automated synthesis; please review them directly."

    cross_flags = _dedupe_flags(cross_flags)
    flags_block = _render_flags_block(cross_flags)

    all_flags = _dedupe_flags(
        [f for r in section_results for f in r["flags"]] + cross_flags
    )

    final_verdict = "SUSPECTED" if critical_fact_missing else (llm_verdict or "GENUINE")
    verdict_sentence = (
        "Hence based on the above discrepancies, this claim appears Suspected as an advisory read for the reviewing doctor — manual review is recommended before any decision."
        if final_verdict == "SUSPECTED" else
        "Hence based on the above findings, this claim appears Genuine as an advisory read for the reviewing doctor — this is not a final determination."
    )

    conclusion_section_parts = []
    if flags_block:
        conclusion_section_parts.append("CROSS-SECTION DISCREPANCIES\n" + flags_block)
    if synthesis:
        conclusion_section_parts.append(synthesis)
    conclusion_section_parts.append(verdict_sentence)
    conclusion_section_text = "\n\n".join(conclusion_section_parts)

    if critical_fact_missing:
        conclusion_section_text = (
            "⚠ MANUAL REVIEW REQUIRED — a possible unreflected critical fact was "
            "detected (see flag above) and could not be confirmed by this "
            "automated pipeline.\n\n"
        ) + conclusion_section_text

    body_parts = []
    for i, res in enumerate(section_results, 1):
        body_parts.append(f"SECTION {i} — {res['title'].upper()}\n\n{res['story']}")
    body_parts.append(f"SECTION {len(section_results) + 1} — CONCLUSION\n\n{conclusion_section_text}")
    conclusion = "\n\n\n".join(body_parts)

    try:
        conclusion = reconcile_conclusion(conclusion, pass1_result, annotations)
    except Exception:
        logger.exception("reconcile_conclusion post-processing failed — using unreconciled text")

    status = "DEGRADED" if failed_sections else "COMPLETE"

    specialist_findings_structured = [
        {
            "agent": f.get("origin", "other"),
            "agentLabel": next(
                (r["title"] for r in section_results if r["key"] == f.get("origin")),
                "Cross-check" if f.get("origin") == "cross" else "Other",
            ),
            "type": f["tag"],
            "explanation": f["text"],
            "location": f.get("origin", "other"),
            "episodeIndex": None,
            "quotes": ([{"file_name": f.get("file_name"), "page_number": f.get("page_number"), "quote": None, "verified": False}]
                       if f.get("file_name") else []),
        }
        for f in all_flags
    ]

    logger.info(
        "generate_field_officer_conclusion | case=%s | sections=%s | critical_fact_missing=%s | "
        "llm_verdict=%s | final_verdict=%s | status=%s | failed_sections=%d | flags=%d | chars=%d",
        case_id, [s["key"] for s in sections], critical_fact_missing, llm_verdict, final_verdict, status,
        len(failed_sections), len(all_flags), len(conclusion),
    )
    return {
        "conclusion": conclusion,
        "status": status,
        "failed_sections": failed_sections,
        "verdict": final_verdict,
        "specialistFindings": specialist_findings_structured,
    }