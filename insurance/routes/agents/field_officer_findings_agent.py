"""
routes/agents/field_officer_findings_agent.py
─────────────────────────────────────────────────────────────────────────────
Field-officer-aware documentFindings generator. Parallel structure to
case_documents.py's _generate_document_findings map-reduce — same
map -> reduce -> verify shape, same finding schema, same 12 finding
`type`s (so the QC screen's existing rendering needs no changes) — but the
MAP phase groups by content category (Current Admission / PED-Prior-History
/ each verification inv_type / Administrative) via the shared tag parser
and investigation_checklist module, instead of a flat per-file list. This
is what lets a finding attribute to "Current Admission" or "PED / Prior
History" rather than just a bare filename, and is what lets the REDUCE
pass reason specifically about cross-category conflicts (e.g. a PED
mentioned in Current Admission's own records vs. what PED/Prior History's
interview actually found) instead of treating every fact as equally
unattributed.

This is a SEPARATE module from case_documents.py's findings pipeline, not
a modification of it — case_documents.py's own _generate_document_findings
keeps working exactly as today for claims without field-officer tags. The
branch point that decides which one runs for a given case lives wherever
findings generation is triggered (the Celery task that calls
case_documents._generate_document_findings today).

DELIBERATELY NOT INCLUDED: checklist completeness ([MISSING] gaps). Those
are already surfaced precisely and deterministically in QC's own
investigation checklist view (qc_review.py, via
investigation_checklist.compute_checklist_gaps) and in the conclusion's
flags (field_officer_report_agent.py) — duplicating them into
documentFindings would mean inventing a 13th finding `type` outside the
fixed vocabulary the frontend's QC screen already renders, for no real
benefit over the two places that already show it.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from typing import Any, Dict, List, Optional

from groq import Groq

from routes.agents.chunking import split_text_by_pdf
from routes.agents.investigation_checklist import (
    parse_labeled_filename,
    categorize_step,
    label_for_inv_type,
    CATEGORY_CURRENT_ADMISSION,
    CATEGORY_PED_PRIOR_HISTORY,
    CATEGORY_VERIFICATION,
    CATEGORY_ADMINISTRATIVE,
)

try:
    from services.groq_rate_limiter import reserve_tokens, estimate_tokens
except Exception:  # pragma: no cover - rate limiter is optional in test harnesses
    def reserve_tokens(*a, **k): return None
    def estimate_tokens(*a, **k): return 0

logger = logging.getLogger(__name__)

FINDINGS_MODEL = os.getenv("FINDINGS_MODEL", "openai/gpt-oss-120b")
FINDINGS_MAP_CHUNK_CHARS = int(os.getenv("FINDINGS_MAP_CHUNK_CHARS", "20000"))
FINDINGS_MAP_CONCURRENCY = int(os.getenv("FINDINGS_MAP_CONCURRENCY", "6"))
FINDINGS_MAP_MAX_TOKENS = int(os.getenv("FINDINGS_MAP_MAX_TOKENS", "32000"))
FINDINGS_REDUCE_MAX_TOKENS = int(os.getenv("FINDINGS_REDUCE_MAX_TOKENS", "65536"))

_groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))

_PAGE_BLOCK_RE = re.compile(r"<!--\s*PAGE_START:\s*(\d+)\s*-->([\s\S]*?)<!--\s*PAGE_END:\s*\1\s*-->")

_CATEGORY_TITLES = {
    CATEGORY_CURRENT_ADMISSION: "Current Admission",
    CATEGORY_PED_PRIOR_HISTORY: "PED / Prior History",
    CATEGORY_ADMINISTRATIVE:    "Administrative / Identity",
}


def _category_title(category: str, inv_type: Optional[str]) -> str:
    if category == CATEGORY_VERIFICATION and inv_type:
        return label_for_inv_type(inv_type)
    return _CATEGORY_TITLES.get(category, "Other")


# ═════════════════════════════════════════════════════════════════════════════
# MAP phase — per tagged block, per page-chunk, extract short verbatim facts,
# then tag every fact with its content_category/inv_type/step_key
# deterministically (from the tag itself — never asked of the LLM, since we
# already know it with certainty; asking would just be a chance for the
# model to get its own attribution wrong).
# ═════════════════════════════════════════════════════════════════════════════
def extract_tagged_pdf_blocks(markdown: str) -> List[dict]:
    """Like case_documents.py's _extract_pdf_blocks, but each block also
    carries its inv_type/step_key/content_category from the
    [INV_TYPE/step_key] tag. Blocks with no tag are skipped — the branch
    point that routes to this module already confirmed tags are present
    for this claim; an untagged block here would only be a stray."""
    blocks = []
    for file_name, file_text in split_text_by_pdf(markdown or "").items():
        parsed = parse_labeled_filename(file_name)
        if not parsed:
            continue
        category = categorize_step(parsed["inv_type"], parsed["step_key"])
        pages = [
            {"page_number": int(pm.group(1)), "text": pm.group(2).strip()}
            for pm in _PAGE_BLOCK_RE.finditer(file_text)
        ]
        if not pages:
            pages = [{"page_number": None, "text": file_text.strip()}]
        blocks.append({
            "file_name":              file_name,
            "inv_type":               parsed["inv_type"],
            "step_key":               parsed["step_key"],
            "content_category":       category,
            "content_category_title": _category_title(category, parsed["inv_type"]),
            "pages":                  pages,
        })
    return blocks


def _chunk_pages(pages: list, max_chars: int) -> list:
    chunks, current, current_len = [], [], 0
    for p in pages:
        p_len = len(p["text"])
        if current and current_len + p_len > max_chars:
            chunks.append(current)
            current, current_len = [], 0
        current.append(p)
        current_len += p_len
    if current:
        chunks.append(current)
    return chunks


def _parse_llm_jsonl(raw: str) -> list:
    """Newline-delimited JSON parsing — each line parsed independently so a
    mid-stream truncation only loses the incomplete trailing line, not
    everything (same approach as case_documents.py, reused verbatim since
    it's a generic robustness pattern, not findings-specific logic)."""
    if not raw:
        return []
    cleaned = raw.strip()
    cleaned = re.sub(r"^```(?:json|jsonl)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    results = []
    for line in cleaned.splitlines():
        line = line.strip().rstrip(",")
        if not line or line in ("[", "]", "{", "}"):
            continue
        try:
            obj = json.loads(line)
            if isinstance(obj, dict):
                results.append(obj)
        except Exception:
            continue
    return results


_OBSERVATION_PROMPT = """You are assisting an insurance-fraud investigator by reading a document \
and pulling out ONLY factual observations that could later matter for judging whether a \
health-insurance claim is genuine. Extract short, verbatim-quotable facts in these areas:

- Pre-existing disease / medication / diagnosis history and dates
- Billed / claimed / paid amounts, including bill/invoice numbers and grand totals
- Policy dates, hospital admission/discharge/procedure/death dates, and any other date relevant \
  to the sequence of events
- ANY date a form, declaration, consent, or verification document was signed or dated — these are \
  easy to overlook but critical: a form "signed" by the patient dated AFTER a documented death date \
  is a serious authenticity red flag. Capture the exact date and what document it's on.
- Statements of symptom/complaint DURATION or ONSET TIMING in the patient's, family's, or \
  hospital's own words (e.g. "for the last 3 weeks", "ONE WEEK", "first noticed on") — capture \
  these verbatim even if they seem like routine history-taking; duration on one document is often \
  compared against duration on another.
- Patient identity as written on this page: full name, age, date of birth, gender, address, \
  ID/Aadhaar number, relationship to policyholder, MRD/registration/reference number
- Treating doctor name, hospital/facility name, and hospital registration number as written on \
  this page
- Any figure that appears STRUCK THROUGH, corrected, overwritten, or altered on a financial or \
  verification form (OCR often preserves this as ~~strikethrough~~ or a crossed-out number)
- Any stamp, watermark, or label indicating a document is a "DUPLICATE" rather than an original
- Fields on verification/investigation forms explicitly marked "Not Collected", "NP", left blank, \
  or otherwise incomplete — these indicate gaps in the field investigation itself
- Specific, NAMED bank/UPI transactions that reference an insurer, insurance broker or aggregator \
  (e.g. "policybazaar", any insurance company name), another hospital, or another named \
  payee/patient not otherwise part of this claim — capture these individually with their date and \
  the payee name, even on a page full of routine transactions
- Anything that looks internally inconsistent on this page alone (e.g. two different amounts \
  for what should be the same bill)

Do NOT judge or conclude anything here — just extract short, verbatim-quotable facts. Do NOT \
skip identity, form-date, or doctor/facility details just because they look like routine \
letterhead/header/checkbox text — those are exactly the facts needed to catch identity, \
authenticity, or continuity-of-care problems later.

Return ONLY newline-delimited JSON (JSONL) — one complete JSON object per
line, no wrapping array, no commas between lines, no prose, no markdown
fences. Each line:
{{"page_number": <int or null>, "quote": "<verbatim short excerpt from the page below, under 15 words, copied exactly>", "category": "medication_history" | "diagnosis_history" | "policy_date" | "admission_date" | "discharge_date" | "death_date" | "document_date" | "billed_amount" | "claimed_amount" | "coverage_detail" | "identity_detail" | "doctor_facility_detail" | "timeline_date" | "duration_or_onset" | "altered_or_corrected_figure" | "notable_financial_transaction" | "administrative_gap" | "authenticity_marker" | "other", "detail": "<under 12 words of plain-language context for this quote>"}}

IMPORTANT — be selective ONLY on genuinely repetitive routine data: lab results with normal \
reference ranges, routine day-to-day bank transactions, and line-by-line pharmacy charges may be \
capped at 1-2 representative observations per page. This cap NEVER applies to: insurer/broker-named \
bank transactions, struck-through/altered figures, form signing dates, discharge/admission/death \
dates, duration-of-symptom statements, administrative "not collected" gaps, OR any identity/
demographic field or doctor/facility identifier — extract EVERY occurrence of these, even if an \
identical-looking value was already extracted from an earlier page.

If nothing relevant is on this page, output nothing.

FIELD-OFFICER CONTEXT: this content is from "{content_category_title}" ({inv_type_label} — \
checklist step: "{step_label}"). You don't need to repeat this in your output — it's attached to \
every observation automatically — but use it to judge what's routine vs. worth flagging in context
(e.g. a "not collected" gap matters more on a checklist step that was actually assigned).

FILE: {file_name}
PAGE RANGE: {page_range}

CONTENT:
{content}
"""


async def _extract_observations_for_chunk(block: dict, chunk_pages: list) -> list:
    page_numbers = [p["page_number"] for p in chunk_pages if p["page_number"] is not None]
    page_range = f"{min(page_numbers)}-{max(page_numbers)}" if page_numbers else "n/a"
    content = "\n\n".join(f"[PAGE {p['page_number']}]\n{p['text']}" for p in chunk_pages)
    prompt = _OBSERVATION_PROMPT.format(
        file_name=block["file_name"], page_range=page_range,
        content=content[:FINDINGS_MAP_CHUNK_CHARS],
        content_category_title=block["content_category_title"],
        inv_type_label=label_for_inv_type(block["inv_type"]),
        step_label=block["step_key"].replace("_", " ").title(),
    )

    completion = None
    attempt_tokens = FINDINGS_MAP_MAX_TOKENS
    for attempt_tokens in (FINDINGS_MAP_MAX_TOKENS, 16000, 8000):
        try:
            reserve_tokens(estimate_tokens(prompt, "", attempt_tokens))
            completion = await asyncio.to_thread(
                _groq_client.chat.completions.create,
                model=FINDINGS_MODEL, temperature=0, max_tokens=attempt_tokens,
                messages=[{"role": "user", "content": prompt}],
            )
            break
        except Exception as e:
            logger.warning(
                "Field-officer findings: observation extraction for %s (%s) failed at "
                "max_tokens=%d: %s", block["file_name"], page_range, attempt_tokens, e,
            )
            completion = None
    if completion is None:
        logger.error(
            "Field-officer findings: observation extraction failed for %s (%s) at every token size",
            block["file_name"], page_range,
        )
        return []

    raw = completion.choices[0].message.content
    parsed = _parse_llm_jsonl(raw)

    observations = []
    for item in parsed:
        if not isinstance(item, dict) or not item.get("quote"):
            continue
        observations.append({
            "file_name":              block["file_name"],
            "page_number":            item.get("page_number"),
            "quote":                  str(item["quote"]).strip(),
            "category":               item.get("category", "other"),
            "detail":                 item.get("detail", ""),
            # Attribution added deterministically from the tag — never
            # asked of the LLM, since we already know it with certainty.
            "content_category":       block["content_category"],
            "content_category_title": block["content_category_title"],
            "inv_type":               block["inv_type"],
            "step_key":               block["step_key"],
        })
    return observations


# ═════════════════════════════════════════════════════════════════════════════
# REDUCE phase — same finding taxonomy/severity/schema as
# case_documents.py's _reduce_observations_to_findings, but the facts each
# carry a content_category/inv_type/step_key now, and the prompt is told
# explicitly to use that attribution for cross-category reasoning.
# ═════════════════════════════════════════════════════════════════════════════
_REDUCE_PROMPT = """You are an insurance-fraud investigator reviewing a set of extracted \
facts pulled from ALL documents uploaded for one claim (hospital records, insured/member \
visit forms, bills, identity documents). Your job is to spot suspicious patterns across \
these facts using your own judgment — NOT to restate them, and NOT to flag something just \
because two facts differ slightly. Minor OCR/spelling noise (e.g. "Shylaja" vs "Sylaja" vs \
"Shyalaja", a name spelled slightly differently by different hospital staff, a bill number \
typo) is NOT suspicious on its own and must not be flagged. Only flag a genuine, material \
discrepancy that a real investigator would care about.

EACH FACT BELOW IS TAGGED with which content category it came from — "Current Admission" \
(the hospital episode this claim is actually about), "PED / Prior History" (verification of an \
earlier/different admission or pre-existing condition), a verification category (e.g. "Digi \
Verification", "Trigger Investigation"), or "Administrative / Identity". USE this attribution \
deliberately: a fact from Current Admission conflicting with a fact from PED / Prior History about \
the SAME condition is exactly the kind of undisclosed-PED signal that's easy to miss when facts \
aren't attributed — actively look for it. Likewise, a Current Admission fact contradicted by an \
Administrative/Identity fact (e.g. a different age or name) is worth surfacing precisely because \
they came from independently-collected sources.

Look specifically for these categories:

1. PED_SUSPECTED — a pre-existing disease/condition/medication that predates the policy \
   inception date or the stated onset of the current illness, and was not disclosed. Pay special \
   attention to a condition appearing in a "PED / Prior History" fact that is absent, or stated \
   differently, in a "Current Admission" fact for the same claim.

2. BILLING_MISMATCH — claimed amount, sum insured, or a specific bill figure that does not \
   reconcile with other billed/collected amounts found elsewhere in the documents.

3. POLICY_COVERAGE_ISSUE — anything suggesting the claim, treatment, or hospital falls \
   outside what the policy covers (e.g. non-network hospital claimed as cashless, treatment \
   excluded, waiting period not met).

4. IDENTITY_MISMATCH — a MATERIAL conflict in patient identity across two or more documents: \
   different date of birth, an age gap of more than ~2 years between records taken around the \
   same time, different gender, a different ID/Aadhaar number, or the claimant/patient name \
   appearing to refer to a genuinely different person (not just a spelling variant of the same \
   name). Use judgment — small spelling/OCR variants of the same name are NOT material and must \
   not be flagged here.

5. TIMELINE_INCONSISTENCY — dates that do not logically sequence: discharge dated before \
   admission, a procedure or treatment dated before the documented first symptom/onset, policy \
   inception dated after the first hospital visit for this illness, death date preceding \
   treatment dates, or similar impossible/implausible orderings.

6. DOCTOR_FACILITY_INCONSISTENCY — the treating doctor, hospital/facility name, or hospital \
   registration number varies in a way not explained by a legitimate referral/transfer, for what \
   is supposed to be the same admission or continuity of care.

7. DOCUMENT_AUTHENTICITY_ISSUE — anything suggesting a document was altered, backdated, or is not \
   what it claims to be. Specifically check: (a) any form/declaration/consent "signed" or dated by \
   the patient AFTER their documented death date — this is a critical finding, always flag it; \
   (b) struck-through, corrected, or overwritten figures on financial or verification forms; \
   (c) documents stamped "DUPLICATE" where the original was never independently confirmed; \
   (d) any other internal contradiction suggesting a document isn't genuine.

8. FINANCIAL_RECONCILIATION_MISMATCH — sum the total billed/paid amounts across ALL hospital bills \
   found in the facts (there may be multiple admissions or multiple hospitals) and compare against \
   the claimed amount stated in the insurer's referral/trigger email or claim form.

9. UNDISCLOSED_INSURANCE_OR_ANTI_SELECTION — a bank transaction referencing an insurance company, \
   broker, or aggregator that contradicts a declaration on a verification/proposal form stating no \
   other policy is held, ESPECIALLY if the transaction falls shortly before or after the first \
   hospital visit for this illness.

10. NARRATIVE_INCONSISTENCY — the SAME event described with materially different framing across \
    two documents in a way that changes its meaning — including across content categories (e.g. \
    Current Admission calling this an emergency visit while a PED/Prior-History interview frames \
    it as a routine follow-up for a known condition).

11. DOCUMENT_QUALITY_FLAG — a data-quality issue that reduces confidence in the investigation \
    itself. Always "warning" severity, never "critical."

12. OTHER_SUSPICIOUS — any other internally inconsistent or red-flag pattern across documents.

CLAIM CONTEXT (includes the original insurer trigger/instruction, if any):
{claim_context}

EXTRACTED FACTS (JSON, one entry per observation, each with file_name/page_number/quote/category/
content_category/content_category_title/inv_type/step_key):
{observations_json}

Return ONLY newline-delimited JSON (JSONL) — one complete finding object per
line, no wrapping array, no commas between lines, no prose, no markdown
fences. Each line:
{{
  "type": "PED_SUSPECTED" | "BILLING_MISMATCH" | "POLICY_COVERAGE_ISSUE" | "IDENTITY_MISMATCH" | "TIMELINE_INCONSISTENCY" | "DOCTOR_FACILITY_INCONSISTENCY" | "DOCUMENT_AUTHENTICITY_ISSUE" | "FINANCIAL_RECONCILIATION_MISMATCH" | "UNDISCLOSED_INSURANCE_OR_ANTI_SELECTION" | "NARRATIVE_INCONSISTENCY" | "DOCUMENT_QUALITY_FLAG" | "OTHER_SUSPICIOUS", "severity": "critical" | "warning","quotes": [{{"file_name": "<must exactly match a file_name from the facts above>", "page_number": <int matching that fact, or null>, "quote": "<must be copied EXACTLY, character-for-character, from the matching fact's quote above>"}}], "explanation": "<1-2 sentences, reviewer-facing, plain language, cite the specific contradiction, name which content categories it spans if more than one, and why it's material>"}}

Rules for "quotes":
- Include 1 quote for a single-source issue.
- Include 2 (occasionally more) quotes — from DIFFERENT file_name/page_number pairs — for any \
  comparison-based finding. Never fabricate a second quote just to satisfy this rule.

Only include a finding if you have genuine, specific evidence from the facts above. If nothing \
suspicious is found, return nothing.
"""


async def _reduce_observations_to_findings(claim_context: dict, observations: list) -> list:
    if not observations:
        return []

    claim_context_json = json.dumps(claim_context, default=str)
    observations_json = json.dumps(observations)
    prompt = _REDUCE_PROMPT.format(claim_context=claim_context_json, observations_json=observations_json)

    est_prompt_tokens = len(prompt) // 4
    available_for_completion = 131072 - est_prompt_tokens - 2000
    effective_max = min(FINDINGS_REDUCE_MAX_TOKENS, max(available_for_completion, 4000))

    completion = None
    for attempt_tokens in (effective_max, effective_max // 2, 8000):
        try:
            reserve_tokens(estimate_tokens(prompt, "", attempt_tokens))
            completion = await asyncio.to_thread(
                _groq_client.chat.completions.create,
                model=FINDINGS_MODEL, temperature=0, max_tokens=attempt_tokens,
                messages=[{"role": "user", "content": prompt}],
            )
            break
        except Exception as e:
            logger.warning("Field-officer findings: reduce pass failed at max_tokens=%d: %s", attempt_tokens, e)
            completion = None
    if completion is None:
        logger.error("Field-officer findings: reduce pass failed at every token size (non-rate-limit errors)")
        return []

    raw = completion.choices[0].message.content
    parsed = _parse_llm_jsonl(raw)

    valid_types = {
        "PED_SUSPECTED", "BILLING_MISMATCH", "POLICY_COVERAGE_ISSUE",
        "IDENTITY_MISMATCH", "TIMELINE_INCONSISTENCY", "DOCTOR_FACILITY_INCONSISTENCY",
        "DOCUMENT_AUTHENTICITY_ISSUE", "FINANCIAL_RECONCILIATION_MISMATCH",
        "UNDISCLOSED_INSURANCE_OR_ANTI_SELECTION", "NARRATIVE_INCONSISTENCY",
        "DOCUMENT_QUALITY_FLAG", "OTHER_SUSPICIOUS",
    }
    findings = []
    for item in parsed:
        if not isinstance(item, dict) or item.get("type") not in valid_types:
            continue
        raw_quotes = item.get("quotes")
        if not isinstance(raw_quotes, list) or not raw_quotes:
            continue
        clean_quotes = []
        for q in raw_quotes:
            if not isinstance(q, dict):
                continue
            quote_text = str(q.get("quote") or "").strip()
            file_name = q.get("file_name")
            if not quote_text or not file_name:
                continue
            clean_quotes.append({"file_name": file_name, "page_number": q.get("page_number"), "quote": quote_text})
        if not clean_quotes:
            continue
        findings.append({
            "id": f"finding_{uuid.uuid4().hex[:8]}",
            "type": item["type"],
            "severity": item.get("severity") if item.get("severity") in ("critical", "warning") else "warning",
            "quotes": clean_quotes,
            "explanation": item.get("explanation", ""),
        })
    return findings


# ═════════════════════════════════════════════════════════════════════════════
# Identity cross-check — same dedicated pass as case_documents.py, reused
# verbatim in approach (a single pass over every identity/date-type
# observation across the whole case, since only a whole-case view can catch
# a DOB conflicting with something 100 pages later).
# ═════════════════════════════════════════════════════════════════════════════
_IDENTITY_CROSSCHECK_PROMPT = """You are an insurance-fraud investigator. Below is every \
identity, demographic, date-of-birth/age, ID-number, MRD/registration-number, doctor-name, \
doctor-registration-number, and document-date observation extracted from ALL documents in one \
claim file, each tagged with which content category (Current Admission / PED-Prior-History / a \
verification type / Administrative) it came from. Your ONLY job is to find genuine, material \
conflicts within this list — do NOT judge anything else, and do NOT flag minor spelling/OCR \
variation of the same value.

Look for:
- Two or more different dates of birth, ages, or ID/Aadhaar numbers attributed to the same named \
  patient across different documents (especially across DIFFERENT content categories — an \
  Administrative ID document disagreeing with a Current Admission record is a strong signal).
- Two or more different MRD/registration numbers for what should be the same patient/admission.
- A document date (signing, discharge, form-filled date) that falls after a documented death date.
- A treating doctor's registration number that varies across documents for what should be the same \
  doctor (may be OCR noise — flag as worth confirming rather than certain).

OBSERVATIONS (JSON):
{observations_json}

Return ONLY newline-delimited JSON (JSONL), one finding per line, same schema as before:
{{"type": "IDENTITY_MISMATCH" | "TIMELINE_INCONSISTENCY" | "DOCTOR_FACILITY_INCONSISTENCY" | "DOCUMENT_AUTHENTICITY_ISSUE", "severity": "critical" | "warning", "quotes": [{{"file_name": "<exact match from an observation above>", "page_number": <int or null>, "quote": "<copied EXACTLY from that observation's quote>"}}], "explanation": "<1-2 sentences>"}}

Only include a finding backed by genuine evidence above. If nothing conflicts, return nothing.
"""


async def _cross_check_identity(observations: list) -> list:
    identity_categories = {
        "identity_detail", "doctor_facility_detail", "document_date",
        "admission_date", "discharge_date", "death_date", "authenticity_marker",
    }
    identity_obs = [o for o in observations if o.get("category") in identity_categories]
    if not identity_obs:
        return []

    prompt = _IDENTITY_CROSSCHECK_PROMPT.format(observations_json=json.dumps(identity_obs))
    try:
        reserve_tokens(estimate_tokens(prompt, "", 16000))
        completion = await asyncio.to_thread(
            _groq_client.chat.completions.create,
            model=FINDINGS_MODEL, temperature=0, max_tokens=16000,
            messages=[{"role": "user", "content": prompt}],
        )
    except Exception as e:
        logger.error("Field-officer findings: identity cross-check failed: %s", e)
        return []

    parsed = _parse_llm_jsonl(completion.choices[0].message.content)
    valid_types = {"IDENTITY_MISMATCH", "TIMELINE_INCONSISTENCY", "DOCTOR_FACILITY_INCONSISTENCY", "DOCUMENT_AUTHENTICITY_ISSUE"}
    findings = []
    for item in parsed:
        if not isinstance(item, dict) or item.get("type") not in valid_types:
            continue
        raw_quotes = item.get("quotes")
        if not isinstance(raw_quotes, list) or not raw_quotes:
            continue
        clean_quotes = [
            {"file_name": q.get("file_name"), "page_number": q.get("page_number"), "quote": str(q.get("quote") or "").strip()}
            for q in raw_quotes if isinstance(q, dict) and q.get("quote") and q.get("file_name")
        ]
        if not clean_quotes:
            continue
        findings.append({
            "id": f"finding_{uuid.uuid4().hex[:8]}",
            "type": item["type"],
            "severity": item.get("severity") if item.get("severity") in ("critical", "warning") else "warning",
            "quotes": clean_quotes,
            "explanation": item.get("explanation", ""),
        })
    return findings


# ═════════════════════════════════════════════════════════════════════════════
# VERIFY — reject any finding whose quote wasn't actually found verbatim (or
# verbatim after whitespace/quote-mark normalization) on the page it claims
# to come from. Same protection as case_documents.py's
# _verify_quote_on_page, reused verbatim since it's generic text matching,
# not findings-specific logic.
# ═════════════════════════════════════════════════════════════════════════════
def _normalize_for_match(s: str) -> str:
    s = s.replace("\u2018", "'").replace("\u2019", "'")
    s = s.replace("\u201c", '"').replace("\u201d", '"')
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def _verify_quote_on_page(blocks: List[dict], file_name, page_number, quote: str) -> bool:
    if not quote or not file_name:
        return False
    normalized_quote = _normalize_for_match(quote)
    for block in blocks:
        if block["file_name"] != file_name:
            continue
        for page in block["pages"]:
            if page_number is not None and page["page_number"] != page_number:
                continue
            if quote in page["text"]:
                return True
            if normalized_quote and normalized_quote in _normalize_for_match(page["text"]):
                return True
    return False


# ═════════════════════════════════════════════════════════════════════════════
# ORCHESTRATOR
# ═════════════════════════════════════════════════════════════════════════════
def _extract_claim_context(claim: Dict[str, Any]) -> Dict[str, Any]:
    """Same field set case_documents.py's _reduce_observations_to_findings
    queries via a separate Mongo read — pulled directly from the `claim`
    dict the caller already has, instead of this module doing its own DB
    read. Keeps this module a pure function of its inputs (design decision
    #9 — no new services), and mirrors field_officer_report_agent.py's own
    claim-dict-in, no-DB-access design."""
    def _get(path, default=None):
        cur = claim
        for part in path.split("."):
            if not isinstance(cur, dict) or part not in cur:
                return default
            cur = cur[part]
        return cur

    return {
        "claimedAmount":  claim.get("claimedAmount"),
        "sumInsured":     claim.get("sumInsured"),
        "policyDetails":  claim.get("policyDetails"),
        "hospitalDetails.admissionDate":  _get("hospitalDetails.admissionDate"),
        "hospitalDetails.dischargeDate":  _get("hospitalDetails.dischargeDate"),
        "claimantName":   claim.get("claimantName"),
        "claimantAge":    claim.get("claimantAge"),
        "insurer":        claim.get("insurer"),
        "riskDetails":    claim.get("riskDetails"),
        "claimTriggers":  claim.get("claimTriggers"),
        "description":    claim.get("description"),
        "deathDetails":   claim.get("deathDetails"),
        "billingDetails.finalBillAmount": _get("billingDetails.finalBillAmount"),
        "billingDetails.grossAmount":     _get("billingDetails.grossAmount"),
        "additionalMedicalDetails.chiefComplaints": _get("additionalMedicalDetails.chiefComplaints"),
    }


async def generate_field_officer_findings(
    case_id: str,
    claim: Dict[str, Any],
    raw_llama_markdown: str,
) -> Dict[str, Any]:
    """
    Returns {"findings": [...], "status": "ok" | "error", "error": str | None}
    — identical shape to case_documents.py's _generate_document_findings, so
    the caller's storage (documentFindings / documentFindingsStatus /
    documentFindingsError) needs no changes regardless of which pipeline ran.
    """
    if not raw_llama_markdown or not raw_llama_markdown.strip():
        return {"findings": [], "status": "ok", "error": None}

    try:
        blocks = extract_tagged_pdf_blocks(raw_llama_markdown)
        if not blocks:
            logger.warning("Field-officer findings: no tagged blocks parsed for case %s", case_id)
            return {"findings": [], "status": "ok", "error": None}
        logger.info(
            "Field-officer findings: parsed %d tagged block(s) for case %s across categories %s",
            len(blocks), case_id, sorted({b["content_category"] for b in blocks}),
        )

        chunk_tasks = []
        for block in blocks:
            for chunk in _chunk_pages(block["pages"], FINDINGS_MAP_CHUNK_CHARS):
                chunk_tasks.append(_extract_observations_for_chunk(block, chunk))

        semaphore = asyncio.Semaphore(FINDINGS_MAP_CONCURRENCY)

        async def _bounded(coro):
            async with semaphore:
                return await coro

        chunk_results = await asyncio.gather(*[_bounded(t) for t in chunk_tasks], return_exceptions=True)

        observations = []
        for result in chunk_results:
            if isinstance(result, Exception):
                logger.error("Field-officer findings: a map call raised for case %s: %s", case_id, result)
                continue
            observations.extend(result)

        logger.info("Field-officer findings: extracted %d observation(s) for case %s", len(observations), case_id)

        if not observations:
            return {"findings": [], "status": "ok", "error": None}

        claim_context = _extract_claim_context(claim)
        findings = await _reduce_observations_to_findings(claim_context, observations)
        identity_findings = await _cross_check_identity(observations)
        findings = findings + identity_findings
        logger.info(
            "Field-officer findings: reduce + identity cross-check returned %d raw finding(s) for case %s",
            len(findings), case_id,
        )

        verified = []
        dropped_quotes = 0
        unverified_findings = 0
        for f in findings:
            checked_quotes = []
            any_verified = False
            for q in f["quotes"]:
                ok = _verify_quote_on_page(blocks, q["file_name"], q["page_number"], q["quote"])
                q["verified"] = ok
                any_verified = any_verified or ok
                checked_quotes.append(q)
                if not ok:
                    dropped_quotes += 1
            f["quotes"] = checked_quotes
            if not any_verified:
                unverified_findings += 1
                f["quote_unverified"] = True
            verified.append(f)

        if dropped_quotes or unverified_findings:
            logger.warning(
                "Field-officer findings: %d quote(s) failed verbatim verification, %d finding(s) "
                "kept but flagged quote_unverified for case %s",
                dropped_quotes, unverified_findings, case_id,
            )

        return {"findings": verified, "status": "ok", "error": None}

    except Exception as e:
        logger.error("Field-officer findings: generation failed for case %s: %s", case_id, e)
        return {"findings": [], "status": "error", "error": str(e)}