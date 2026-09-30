"""
services/agentic_investigation.py

Page-level document classification + fourteen specialist investigation
agents (PED, Billing, Clinical Genuineness, Hospital Record Integrity,
Accident/RTA, Death, Medical Necessity, Hospital Verification,
High-Value Claim, Employee Verification, Bill Verification, Identity,
Policy/Coverage, Timeline) that run on top of a claim's accumulated
`raw_llama_markdown`.

STANDALONE MODULE — does not import from, and is not imported by,
routes/case_documents_router.py or celery_worker/advanced_upload_task.py.
Every helper it needs (PDF/page block parsing, JSON salvage parsing,
quote verification) is duplicated here in a minimal form rather than
imported, specifically so nothing in the existing findings pipeline has
to change, and this module has no coupling to their internals changing
later.

Persists its result to a single NEW field on the claim document:

insurance_claims_new.agenticInvestigation = {
  "status": "ok" | "error",
  "error": str | None,
  "updatedAt": datetime,
  "documentClassification": [
      {"file_name": ..., "page_number": ..., "doc_type": ..., "confidence": ...},
      ...
  ],
  "agents": {
    "ped": {"status": "ok" | "error", "result": {...} | None, "error": str | None},
    "billing": {"status": "ok" | "error", "result": {...} | None, "error": str | None},
    "clinical_genuineness": {"status": ..., "result": ..., "error": ...},
    "hospital_record_integrity": {"status": ..., "result": ..., "error": ...},
    "accident_rta": {"status": ..., "result": ..., "error": ...},
    "death": {"status": ..., "result": ..., "error": ...},
    "medical_necessity": {"status": ..., "result": ..., "error": ...},
    "hospital_verification": {"status": ..., "result": ..., "error": ...},
    "high_value_claim": {"status": ..., "result": ..., "error": ...},
    "employee_verification": {"status": ..., "result": ..., "error": ...},
    "bill_verification": {"status": ..., "result": ..., "error": ...},
  },
}

Entry point: `run_agentic_investigation(insurance_claims_col, case_id)`.
Callers (a Celery task, a script, a future endpoint) own the Motor
client/collection and just pass it in — this module never opens its own
DB connection, so it stays agnostic to sync-vs-async-loop lifetime
concerns (the caller's problem, same as the rest of this codebase).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from groq import Groq
from services.groq_rate_limiter import reserve_tokens, estimate_tokens

logger = logging.getLogger(__name__)

IST = timezone(timedelta(hours=5, minutes=30))

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
_groq_client = Groq(api_key=GROQ_API_KEY)

# Same model as the existing document-findings pipeline, for consistency.
AGENTIC_MODEL = os.getenv("FINDINGS_MODEL", "openai/gpt-oss-120b")

CLASSIFY_CHUNK_CHARS = int(os.getenv("AGENTIC_CLASSIFY_CHUNK_CHARS", "20000"))
AGENT_TEXT_BUDGET_CHARS = int(os.getenv("AGENTIC_AGENT_TEXT_BUDGET_CHARS", "60000"))


# ─────────────────────────────────────────────────────────────────────────
# Minimal PDF/page block parsing (duplicated, not imported — see module
# docstring). Mirrors the markers the rest of the pipeline already writes:
# <!-- PDF_START: name --> ... <!-- PAGE_START: n --> ... <!-- PAGE_END: n -->
# ... <!-- PDF_END: name -->
# ─────────────────────────────────────────────────────────────────────────

_PDF_BLOCK_RE = re.compile(
    r"<!--\s*PDF_START:\s*(.*?)\s*-->([\s\S]*?)<!--\s*PDF_END:\s*\1\s*-->"
)
_PAGE_BLOCK_RE = re.compile(
    r"<!--\s*PAGE_START:\s*(\d+)\s*-->([\s\S]*?)<!--\s*PAGE_END:\s*\1\s*-->"
)


def _extract_pdf_blocks(markdown: str) -> List[Dict[str, Any]]:
    blocks = []
    for m in _PDF_BLOCK_RE.finditer(markdown or ""):
        file_name = m.group(1).strip()
        raw = m.group(2)
        pages = [
            {"page_number": int(pm.group(1)), "text": pm.group(2).strip()}
            for pm in _PAGE_BLOCK_RE.finditer(raw)
        ]
        if not pages:
            pages = [{"page_number": None, "text": raw.strip()}]
        blocks.append({"file_name": file_name, "pages": pages})
    return blocks


def _chunk_pages(pages: List[Dict[str, Any]], max_chars: int) -> List[List[Dict[str, Any]]]:
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


def _normalize_for_match(s: str) -> str:
    s = s.replace("\u2018", "'").replace("\u2019", "'")
    s = s.replace("\u201c", '"').replace("\u201d", '"')
    # raw_llama_markdown embeds literal HTML (<table>/<td>/<b>/etc.) for
    # tabular content, and literal markdown emphasis (**bold**) elsewhere.
    # Agents naturally quote the rendered text, not the markup, so both
    # have to be stripped before comparison — otherwise a label and its
    # value sitting in adjacent table cells (e.g. "DOA</b></td><td>11-Mar-
    # 2026") never matches a quote like "DOA 11-Mar-2026", even though a
    # human reading the same table would see them as adjacent.
    s = re.sub(r"<[^>]+>", " ", s)
    s = s.replace("**", "").replace("__", "")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def _strip_markup_for_prompt(text: str) -> str:
    """Strip literal HTML (<table>/<td>/<b>/etc.) and markdown emphasis
    markup out of page text BEFORE it goes into an LLM prompt as SOURCE
    PAGES content. Without this, the model sees raw markup in its context
    and sometimes echoes it back verbatim into an explanation/quote field
    (e.g. reproducing <td>...</td> rows instead of prose). Table cell/row
    boundaries are converted to a readable separator rather than vanishing
    outright, so column values (e.g. an item name and its amount) don't
    get glued together with no space between them. Quotes generated from
    this cleaned text still verify correctly against the raw page text via
    _verify_quote_on_page's normalized-match fallback, which applies the
    same stripping to the original for comparison."""
    if not text:
        return text
    text = re.sub(r"</tr\s*>", "\n", text, flags=re.I)
    text = re.sub(r"</td\s*>\s*<td[^>]*>", " | ", text, flags=re.I)
    text = re.sub(r"</th\s*>\s*<th[^>]*>", " | ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("**", "").replace("__", "")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _verify_quote_on_page(pdf_blocks, file_name, page_number, quote: str) -> bool:
    """Reject any quote that wasn't actually found (verbatim, or verbatim
    after whitespace/quote-mark normalization) on the page it claims to
    come from. Same discipline as the existing findings pipeline — never
    let a fabricated quote reach persisted output unflagged."""
    if not quote or not file_name:
        return False
    normalized_quote = _normalize_for_match(quote)
    for block in pdf_blocks:
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


def _parse_llm_json(raw: str) -> Optional[dict]:
    """Strip ```json fences and parse. Returns None on failure (fail-soft —
    caller records that as an agent-level status='error', never a crash)."""
    if not raw:
        return None
    cleaned = raw.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except Exception as e:
        logger.warning("Agentic investigation: could not parse LLM JSON directly: %s", e)
    return None


def _parse_llm_jsonl(raw: str) -> List[dict]:
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

def _groq_call(system_prompt: str, user_prompt: str, max_tokens: int) -> Optional[str]:
    """Sync Groq call. Rate limits (429) are retried forever with backoff —
    never given up on. A response truncated mid-JSON (finish_reason ==
    "length") is retried with a LARGER token budget — shrinking the budget
    can only make truncation worse, never fix it. Only a genuine API error
    (not truncation) falls through to a smaller token size as a last resort."""
    last_tokens = max_tokens
    attempt_sizes = (max_tokens, min(max_tokens * 2, 32000), max(max_tokens // 2, 4000))
    for attempt_tokens in attempt_sizes:
        last_tokens = attempt_tokens
        wait_attempt = 0
        while True:
            reserve_tokens(estimate_tokens(system_prompt, user_prompt, attempt_tokens))
            try:
                completion = _groq_client.chat.completions.create(
                    model=AGENTIC_MODEL,
                    temperature=0,
                    max_tokens=attempt_tokens,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                )
                finish_reason = completion.choices[0].finish_reason
                content = completion.choices[0].message.content
                if finish_reason == "length":
                    logger.warning(
                        "Agentic investigation: response truncated at max_tokens=%d "
                        "(finish_reason=length) — retrying with a larger budget",
                        attempt_tokens,
                    )
                    break  # move to the next (larger) attempt size
                return content
            except Exception as e:
                err_str = str(e)
                if "429" in err_str or "rate_limit_exceeded" in err_str:
                    wait_attempt += 1
                    wait = min(5.0 * (2 ** min(wait_attempt, 5)), 60)
                    m = re.search(r'try again in ([\d.]+)s', err_str)
                    if m:
                        wait = float(m.group(1)) + 1.0
                    logger.warning(
                        "Agentic investigation: rate limited at max_tokens=%d, waiting %.1fs (attempt %d)...",
                        attempt_tokens, wait, wait_attempt,
                    )
                    time.sleep(wait)
                    continue
                logger.warning(
                    "Agentic investigation: Groq call failed at max_tokens=%d: %s",
                    attempt_tokens, e,
                )
                break
    logger.error(
        "Agentic investigation: Groq call failed at every token size (last attempt max_tokens=%d)",
        last_tokens,
    )
    return None


# ─────────────────────────────────────────────────────────────────────────
# Stage 1 — page-level document classification
# ─────────────────────────────────────────────────────────────────────────

DOC_TYPE_TAXONOMY = [
    "Discharge Summary",
    "Bill / Invoice",
    "Lab Report",
    "Radiology Report",
    "Cardiology Report",
    "Histopathology / Biopsy Report",
    "Prescription / Medication Record",
    "Policy / Proposal Form",
    "Claim Trigger Email / Claim Form",
    "Field Investigation Form (SDF)",
    "ID Proof",
    "Bank Statement",
    "Death Certificate / Death Summary",
    "FIR / MLC / Police Document",
    "Employment / HR Document",
    "Geo-Tagged Field Visit Photo",
    "Other",
]

_CLASSIFY_PROMPT = """You are classifying pages from an insurance claim's supporting \
documents into a fixed set of document types, so downstream specialist reviewers \
only see the pages relevant to them.

Return ONLY newline-delimited JSON (JSONL) — one object per page, no wrapping \
array, no prose, no markdown fences. Each line:
{{"page_number": <int or null>, "doc_type": "<one value from the list below, exactly>", "confidence": "high" | "medium" | "low"}}

Valid doc_type values (use EXACTLY one of these strings):
{taxonomy}

Classify every page in the content below, even if you are unsure — use the closest \
type and "low" confidence rather than omitting a page.

FILE: {file_name}
PAGE RANGE: {page_range}

CONTENT:
{content}
"""


def _classify_chunk(file_name: str, chunk_pages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    page_numbers = [p["page_number"] for p in chunk_pages if p["page_number"] is not None]
    page_range = f"{min(page_numbers)}-{max(page_numbers)}" if page_numbers else "n/a"
    content = "\n\n".join(f"[PAGE {p['page_number']}]\n{p['text']}" for p in chunk_pages)
    prompt = _CLASSIFY_PROMPT.format(
        taxonomy="\n".join(f"- {t}" for t in DOC_TYPE_TAXONOMY),
        file_name=file_name,
        page_range=page_range,
        content=content[:CLASSIFY_CHUNK_CHARS],
    )
    raw = _groq_call(
        "You are a precise document classifier. Output only JSONL, nothing else.",
        prompt,
        max_tokens=8000,
    )
    parsed = _parse_llm_jsonl(raw or "")
    out = []
    for item in parsed:
        doc_type = item.get("doc_type")
        if doc_type not in DOC_TYPE_TAXONOMY:
            doc_type = "Other"
        conf = item.get("confidence")
        out.append({
            "file_name": file_name,
            "page_number": item.get("page_number"),
            "doc_type": doc_type,
            "confidence": conf if conf in ("high", "medium", "low") else "low",
        })
    return out


def classify_documents(pdf_blocks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Synchronous — classify every page across every file. Intended to be
    called via loop.run_in_executor from the async orchestrator below,
    same pattern the rest of this codebase uses for blocking Groq/HTTP calls."""
    classification: List[Dict[str, Any]] = []
    for block in pdf_blocks:
        for chunk in _chunk_pages(block["pages"], CLASSIFY_CHUNK_CHARS):
            classification.extend(_classify_chunk(block["file_name"], chunk))
    logger.info("Agentic investigation: classified %d page(s)", len(classification))
    return classification


def _pages_for_doc_types(
    pdf_blocks: List[Dict[str, Any]],
    classification: List[Dict[str, Any]],
    wanted_types: set,
) -> str:
    """Build the concatenated source text for an agent: only pages whose
    classified doc_type is in wanted_types, bounded to AGENT_TEXT_BUDGET_CHARS."""
    wanted_keys = {
        (c["file_name"], c["page_number"])
        for c in classification
        if c["doc_type"] in wanted_types
    }
    parts = []
    total = 0
    for block in pdf_blocks:
        for page in block["pages"]:
            key = (block["file_name"], page["page_number"])
            if key not in wanted_keys:
                continue
            snippet = f"[FILE: {block['file_name']} | PAGE {page['page_number']}]\n{_strip_markup_for_prompt(page['text'])}\n"
            if total + len(snippet) > AGENT_TEXT_BUDGET_CHARS:
                continue
            parts.append(snippet)
            total += len(snippet)
    return "\n".join(parts)


def _filtered_pages_for_doc_types(pdf_blocks, classification, wanted_types) -> List[Dict[str, str]]:
    """Like _pages_for_doc_types, but returns the individual page snippets
    as a list instead of one joined, budget-truncated string — used by the
    chunked runner below so nothing gets silently dropped for agents whose
    wanted_types spans every classified doc type (the ones most likely to
    exceed AGENT_TEXT_BUDGET_CHARS on a large case)."""
    wanted_keys = {
        (c["file_name"], c["page_number"])
        for c in classification
        if c["doc_type"] in wanted_types
    }
    pages = []
    for block in pdf_blocks:
        for page in block["pages"]:
            key = (block["file_name"], page["page_number"])
            if key not in wanted_keys:
                continue
            pages.append({
                "text": f"[FILE: {block['file_name']} | PAGE {page['page_number']}]\n{_strip_markup_for_prompt(page['text'])}\n"
            })
    return pages


def _merge_agent_chunk_results(
    parsed_list: List[dict], status_priority: List[str], list_fields: List[str]
) -> dict:
    """Merges multiple per-chunk parsed LLM results into one: list_fields
    (e.g. "inconsistencies", "anomalies", "contradictions", "timeline")
    are concatenated across chunks; explanation strings are joined; the
    merged status is the most severe status present, per status_priority
    (most severe first)."""
    if not parsed_list:
        return {}
    merged = dict(parsed_list[0])
    for field in list_fields:
        merged[field] = [item for p in parsed_list for item in (p.get(field) or [])]
    explanations = [p.get("explanation") for p in parsed_list if p.get("explanation")]
    merged["explanation"] = " ".join(explanations)
    present = {p.get("status") for p in parsed_list}
    for status in status_priority:
        if status in present:
            merged["status"] = status
            break
    merged["findings"] = [item for p in parsed_list for item in (p.get("findings") or [])]
    return merged


def _run_agent_over_pages(
    pages: List[Dict[str, str]],
    max_chars: int,
    build_prompt_fn,
    system_prompt: str,
    max_tokens: int,
) -> List[dict]:
    """Chunks `pages` to max_chars using the existing _chunk_pages helper,
    runs one Groq call per chunk with build_prompt_fn(content), and
    returns the list of successfully-parsed per-chunk JSON results
    (unverified — caller still runs its own quote verification per
    chunk-result, same as the single-chunk path)."""
    chunk_page_lists = _chunk_pages(pages, max_chars)
    results = []
    for chunk_pages in chunk_page_lists:
        content = "\n".join(p["text"] for p in chunk_pages)
        raw = _groq_call(system_prompt, build_prompt_fn(content), max_tokens)
        parsed = _parse_llm_json(raw or "")
        if parsed:
            results.append(parsed)
    return results


# ─────────────────────────────────────────────────────────────────────────
# Stage 2a — PED (pre-existing disease) agent
# ─────────────────────────────────────────────────────────────────────────

PED_RELEVANT_TYPES = {
    "Discharge Summary",
    "Prescription / Medication Record",
    "Lab Report",
    "Field Investigation Form (SDF)",
    "Policy / Proposal Form",
    "Claim Trigger Email / Claim Form",
}

_PED_PROMPT = """You are an insurance investigator's PED (pre-existing disease) \
specialist. Using ONLY the source pages below, determine whether the claim \
involves a chronic condition, diagnosis, or long-term medication that predates \
the policy inception date or the stated onset of the current illness, and was \
not disclosed at proposal/claim stage.

CLAIM CONTEXT (policy dates, declared PED, current admission diagnosis, if known):
{claim_context}

Return ONLY a single JSON object, no prose, no markdown fences:
{{
  "status": "UNDISCLOSED_PED_SUSPECTED" | "DISCLOSED_CONSISTENT" | "NO_PED_EVIDENCE" | "UNCLEAR",
  "condition": "<name of condition, or null>",
  "first_documented_date": "<YYYY-MM-DD or null, earliest date the condition/medication appears in the source pages>",
  "policy_inception_date": "<YYYY-MM-DD or null, from claim context>",
  "explanation": "<2-4 sentences, reviewer-facing, plain language>",
  "quotes": [
    {{"file_name": "<exact file_name from a source page above>", "page_number": <int or null>, "quote": "<verbatim, under 20 words, copied exactly from that page>"}}
  ],
  "confidence": "high" | "medium" | "low"
}}

Rules:
- Only flag UNDISCLOSED_PED_SUSPECTED if you have genuine textual evidence of BOTH
  a chronic condition/medication AND that it predates policy inception or stated
  onset. Do not speculate.
- Never fabricate a quote — every quote must be copied exactly from the source
  pages below.
- Every quote must be a single contiguous run of characters exactly as they appear on the
  page — never elide, truncate, or skip words with "..." or similar; if you cannot quote a
  fully contiguous span, omit the quote rather than truncate it.
- If nothing relevant is found, use NO_PED_EVIDENCE and leave quotes empty.

SOURCE PAGES:
{content}
"""


def _run_ped_agent(pdf_blocks, classification, claim_context: dict) -> Dict[str, Any]:
    content = _pages_for_doc_types(pdf_blocks, classification, PED_RELEVANT_TYPES)
    if not content.strip():
        return {
            "status": "ok",
            "result": {
                "status": "NO_PED_EVIDENCE", "condition": None,
                "first_documented_date": None, "policy_inception_date": None,
                "explanation": "No PED-relevant documents were classified for this case.",
                "quotes": [], "confidence": "low",
            },
            "error": None,
        }

    prompt = _PED_PROMPT.format(
        claim_context=json.dumps(claim_context, default=str),
        content=content,
    )
    raw = _groq_call(
        "You are a careful, evidence-only insurance PED investigator. Output only JSON.",
        prompt,
        max_tokens=4000,
    )
    parsed = _parse_llm_json(raw or "")
    if not parsed:
        return {"status": "error", "result": None, "error": "PED agent: could not parse LLM output"}

    verified_quotes = []
    for q in (parsed.get("quotes") or []):
        if not isinstance(q, dict):
            continue
        ok = _verify_quote_on_page(
            pdf_blocks, q.get("file_name"), q.get("page_number"), str(q.get("quote") or "")
        )
        q["verified"] = ok
        verified_quotes.append(q)
    parsed["quotes"] = verified_quotes

    # Normalized cross-agent field — see claim_story agent, which walks
    # every agent's "findings" array the same way regardless of which
    # agent produced it. PED has no separate flags array of its own (its
    # verdict IS the finding), so wrap it into the same {type, explanation,
    # quotes} shape only when it's actually a concern-worthy verdict.
    parsed["findings"] = (
        [{
            "type": parsed.get("status"),
            "explanation": parsed.get("explanation"),
            "quotes": verified_quotes,
        }]
        if parsed.get("status") == "UNDISCLOSED_PED_SUSPECTED"
        else []
    )

    return {"status": "ok", "result": parsed, "error": None}


# ─────────────────────────────────────────────────────────────────────────
# Stage 2b — Billing / financial reconciliation agent
# ─────────────────────────────────────────────────────────────────────────

BILLING_RELEVANT_TYPES = {
    "Bill / Invoice",
    "Claim Trigger Email / Claim Form",
}

_BILLING_PROMPT = """You are an insurance investigator's billing/financial \
reconciliation specialist. Using ONLY the source pages below, reconcile the \
billed amounts against the claimed amount and check for internal billing \
inconsistencies.

CLAIM CONTEXT (claimed amount, and any known bill totals):
{claim_context}

Return ONLY a single JSON object, no prose, no markdown fences:
{{
  "status": "SUPPORTED" | "VARIANCE_FOUND" | "INSUFFICIENT_EVIDENCE",
  "claimed_amount": <number or null>,
  "total_billed_amount": <number or null, sum of the actual bill totals you can identify>,
  "variance": <number or null, total_billed_amount minus claimed_amount>,
  "explanation": "<2-4 sentences, reviewer-facing, plain language>",
  "itemized_flags": [
    {{
      "type": "DUPLICATE_CHARGE" | "DISCOUNT_DISCREPANCY" | "TOTAL_MISMATCH" | "ALTERED_FIGURE" | "OTHER",
      "explanation": "<1-2 sentences>",
      "quotes": [
        {{"file_name": "<exact file_name from a source page above>", "page_number": <int or null>, "quote": "<verbatim, under 20 words, copied exactly from that page>"}}
      ]
    }}
  ],
  "confidence": "high" | "medium" | "low"
}}

Rules:
- Only flag a variance or itemized issue with genuine textual evidence — never
  speculate, and never fabricate a quote.
- Every quote must be a single contiguous run of characters exactly as they appear on the
  page — never elide, truncate, or skip words with "..." or similar (e.g. never quote
  "Medicines ... 85568.78" when the item/count/amount sit in separate table columns — quote
  only one fully contiguous span, such as just "85568.78", instead).
- Minor rounding differences (a few rupees) are not a variance worth flagging.
- If nothing suspicious is found and figures reconcile, use SUPPORTED with an
  empty itemized_flags list.

SOURCE PAGES:
{content}
"""


def _run_billing_agent(pdf_blocks, classification, claim_context: dict) -> Dict[str, Any]:
    content = _pages_for_doc_types(pdf_blocks, classification, BILLING_RELEVANT_TYPES)
    if not content.strip():
        return {
            "status": "ok",
            "result": {
                "status": "INSUFFICIENT_EVIDENCE",
                "claimed_amount": claim_context.get("claimedAmount"),
                "total_billed_amount": None, "variance": None,
                "explanation": "No bill/invoice documents were classified for this case.",
                "itemized_flags": [], "confidence": "low",
            },
            "error": None,
        }

    prompt = _BILLING_PROMPT.format(
        claim_context=json.dumps(claim_context, default=str),
        content=content,
    )
    raw = _groq_call(
        "You are a careful, evidence-only insurance billing investigator. Output only JSON.",
        prompt,
        max_tokens=6000,
    )
    parsed = _parse_llm_json(raw or "")
    if not parsed:
        return {"status": "error", "result": None, "error": "Billing agent: could not parse LLM output"}

    for flag in (parsed.get("itemized_flags") or []):
        clean_quotes = []
        for q in (flag.get("quotes") or []):
            if not isinstance(q, dict):
                continue
            ok = _verify_quote_on_page(
                pdf_blocks, q.get("file_name"), q.get("page_number"), str(q.get("quote") or "")
            )
            q["verified"] = ok
            clean_quotes.append(q)
        flag["quotes"] = clean_quotes

    # Normalized cross-agent field — see claim_story agent.
    parsed["findings"] = parsed.get("itemized_flags") or []

    return {"status": "ok", "result": parsed, "error": None}


# ─────────────────────────────────────────────────────────────────────────
# Stage 2c — Clinical Genuineness agent
# ─────────────────────────────────────────────────────────────────────────

CLINICAL_GENUINENESS_RELEVANT_TYPES = {
    "Discharge Summary",
    "Lab Report",
    "Radiology Report",
    "Cardiology Report",
    "Histopathology / Biopsy Report",
    "Prescription / Medication Record",
}

_CLINICAL_GENUINENESS_PROMPT = """You are an insurance investigator's clinical genuineness \
specialist. Using ONLY the source pages below, assess whether the reported hospitalization \
and treatment are internally supported by the clinical evidence — i.e. whether the diagnosis, \
investigations, treatment, and discharge condition form a coherent, medically plausible picture \
of a real course of care, as opposed to a fabricated, templated, or internally contradictory one.

Specifically check:
- Is the diagnosis supported by investigation reports (lab / radiology / histopathology / \
  cardiology) and documented clinical findings, or is it asserted with no supporting evidence?
- Is the procedure/treatment consistent with the diagnosis (e.g. a surgical procedure matching \
  the stated condition, medications matching the stated diagnosis)?
- Do admission and discharge records agree with each other (dates, vitals, condition described) \
  rather than contradicting each other?
- Is there any sign of a templated or copy-pasted clinical picture (e.g. identical vitals/findings \
  appearing verbatim across what should be independent examinations, a diagnosis with zero \
  supporting investigation anywhere in the source pages)?

This is a GENUINENESS/COHERENCE check only — do NOT judge whether the length of stay, ICU use, \
or extent of treatment was medically necessary; that is a separate agent's job.

CLAIM CONTEXT (known diagnosis/procedure, if already extracted elsewhere):
{claim_context}

Return ONLY a single JSON object, no prose, no markdown fences:
{{
  "status": "GENUINE" | "INCONSISTENT_CLINICAL_PICTURE" | "INSUFFICIENT_EVIDENCE",
  "diagnosis": "<diagnosis being evaluated, or null>",
  "supporting_evidence_summary": "<1-3 sentences on what investigation/clinical evidence does or does not support the diagnosis and treatment>",
  "inconsistencies": [
    {{
      "type": "DIAGNOSIS_NOT_SUPPORTED" | "PROCEDURE_DIAGNOSIS_MISMATCH" | "ADMISSION_DISCHARGE_CONTRADICTION" | "TEMPLATED_OR_DUPLICATED_FINDINGS" | "OTHER",
      "explanation": "<1-2 sentences>",
      "quotes": [
        {{"file_name": "<exact file_name from a source page above>", "page_number": <int or null>, "quote": "<verbatim, under 20 words, copied exactly from that page>"}}
      ]
    }}
  ],
  "explanation": "<2-4 sentences, reviewer-facing, plain language, overall verdict rationale>",
  "confidence": "high" | "medium" | "low"
}}

Rules:
- Only flag INCONSISTENT_CLINICAL_PICTURE with genuine textual evidence of a specific \
  inconsistency above — never speculate, and never fabricate a quote.
- Every quote must be a single contiguous run of characters exactly as they appear on the \
  page — never elide, truncate, or skip words with "..." or similar.
- Use INSUFFICIENT_EVIDENCE if the source pages don't contain enough clinical detail to make a \
  genuineness assessment either way (e.g. only a one-line discharge summary with no investigations).
- Use GENUINE if the diagnosis, investigations, treatment and discharge condition cohere, even if \
  imperfectly documented.

SOURCE PAGES:
{content}
"""


def _run_clinical_genuineness_agent(pdf_blocks, classification, claim_context: dict) -> Dict[str, Any]:
    content = _pages_for_doc_types(pdf_blocks, classification, CLINICAL_GENUINENESS_RELEVANT_TYPES)
    if not content.strip():
        return {
            "status": "ok",
            "result": {
                "status": "INSUFFICIENT_EVIDENCE",
                "diagnosis": claim_context.get("diagnosis"),
                "supporting_evidence_summary": "No clinical-evidence documents were classified for this case.",
                "inconsistencies": [],
                "explanation": "No clinical-evidence documents were classified for this case.",
                "confidence": "low",
            },
            "error": None,
        }

    prompt = _CLINICAL_GENUINENESS_PROMPT.format(
        claim_context=json.dumps(claim_context, default=str),
        content=content,
    )
    raw = _groq_call(
        "You are a careful, evidence-only insurance clinical genuineness investigator. Output only JSON.",
        prompt,
        max_tokens=6000,
    )
    parsed = _parse_llm_json(raw or "")
    if not parsed:
        return {"status": "error", "result": None, "error": "Clinical genuineness agent: could not parse LLM output"}

    for inc in (parsed.get("inconsistencies") or []):
        clean_quotes = []
        for q in (inc.get("quotes") or []):
            if not isinstance(q, dict):
                continue
            ok = _verify_quote_on_page(
                pdf_blocks, q.get("file_name"), q.get("page_number"), str(q.get("quote") or "")
            )
            q["verified"] = ok
            clean_quotes.append(q)
        inc["quotes"] = clean_quotes

    # Normalized cross-agent field — see claim_story agent.
    parsed["findings"] = parsed.get("inconsistencies") or []

    return {"status": "ok", "result": parsed, "error": None}


# ─────────────────────────────────────────────────────────────────────────
# Stage 2d — Hospital Record Integrity agent
# ─────────────────────────────────────────────────────────────────────────

# All classified types EXCEPT "Other" — integrity anomalies (altered
# figures, duplicate stamps, inconsistent dates) can appear on any
# document type with dates, amounts, or signatures on it, not just a
# narrow subset.
HOSPITAL_RECORD_INTEGRITY_RELEVANT_TYPES = {
    t for t in DOC_TYPE_TAXONOMY if t != "Other"
}

_HOSPITAL_RECORD_INTEGRITY_PROMPT = """You are an insurance investigator's document-integrity \
specialist. Using ONLY the source pages below (OCR'd text — you have NO access to handwriting, \
ink color, physical signatures, or any other visual/image signal, so NEVER claim to have \
evaluated those), look for TEXT-DETECTABLE signs that a document may have been altered, \
duplicated, or is not what it claims to be.

Specifically check for:
- Figures that appear struck-through, corrected, or overwritten (OCR often preserves this as \
  ~~strikethrough~~, a crossed-out number, or two different values for what should be one figure).
- Any stamp, watermark, or label indicating a document is a "DUPLICATE" rather than an original.
- A document date (signing, discharge, form-filled date) that is chronologically impossible given \
  other dates in the source pages (e.g. a form "signed" by the patient dated AFTER a documented \
  death date, a discharge dated before admission).
- The same document/content appearing to be duplicated or closely templated across two supposedly \
  independent source pages (e.g. near-identical boilerplate text/values repeated verbatim where \
  they should differ).
- Missing-page indicators explicitly stated in the text itself (e.g. a page numbered "3 of 5" with \
  no other pages of that document present in the source pages — only flag this if the text itself \
  gives you a page-count clue, don't infer missing pages from silence).

Do NOT flag: minor OCR noise, spelling variants, or anything that would require seeing the actual \
physical document (handwriting style, ink, signature comparison) to judge.

CLAIM CONTEXT (known dates, if already extracted elsewhere):
{claim_context}

Return ONLY a single JSON object, no prose, no markdown fences:
{{
  "status": "NO_INTEGRITY_CONCERNS" | "INTEGRITY_ANOMALIES_FOUND" | "INSUFFICIENT_EVIDENCE",
  "anomalies": [
    {{
      "type": "ALTERED_OR_STRUCK_THROUGH_FIGURE" | "DUPLICATE_STAMP_OR_WATERMARK" | "CHRONOLOGICALLY_IMPOSSIBLE_DATE" | "DUPLICATED_OR_TEMPLATED_CONTENT" | "OTHER",
      "explanation": "<1-2 sentences>",
      "quotes": [
        {{"file_name": "<exact file_name from a source page above>", "page_number": <int or null>, "quote": "<verbatim, under 20 words, copied exactly from that page>"}}
      ]
    }}
  ],
  "explanation": "<2-4 sentences, reviewer-facing, plain language, overall verdict rationale>",
  "confidence": "high" | "medium" | "low"
}}

Rules:
- These are anomalies requiring investigation, NOT proof of fraud — phrase explanations neutrally.
- Only flag INTEGRITY_ANOMALIES_FOUND with genuine textual evidence of a specific anomaly above —
  never speculate, and never fabricate a quote.
- Every quote must be a single contiguous run of characters exactly as they appear on the page —
  never elide, truncate, or skip words with "..." or similar.
- Use INSUFFICIENT_EVIDENCE only if the source pages are too sparse to assess at all.

SOURCE PAGES:
{content}
"""
_HOSPITAL_RECORD_INTEGRITY_STATUS_PRIORITY = ["INTEGRITY_ANOMALIES_FOUND", "NO_INTEGRITY_CONCERNS", "INSUFFICIENT_EVIDENCE"]


def _run_hospital_record_integrity_agent(pdf_blocks, classification, claim_context: dict) -> Dict[str, Any]:
    pages = _filtered_pages_for_doc_types(pdf_blocks, classification, HOSPITAL_RECORD_INTEGRITY_RELEVANT_TYPES)
    if not pages:
        return {
            "status": "ok",
            "result": {
                "status": "INSUFFICIENT_EVIDENCE",
                "anomalies": [],
                "explanation": "No classified documents were available for this case.",
                "confidence": "low",
            },
            "error": None,
        }

    build_prompt = lambda content: _HOSPITAL_RECORD_INTEGRITY_PROMPT.format(
        claim_context=json.dumps(claim_context, default=str), content=content
    )
    chunk_results = _run_agent_over_pages(
        pages, AGENT_TEXT_BUDGET_CHARS, build_prompt,
        "You are a careful, evidence-only insurance document-integrity investigator. Output only JSON.",
        6000,
    )
    if not chunk_results:
        return {"status": "error", "result": None, "error": "Hospital record integrity agent: could not parse LLM output"}

    parsed = (
        chunk_results[0] if len(chunk_results) == 1
        else _merge_agent_chunk_results(chunk_results, _HOSPITAL_RECORD_INTEGRITY_STATUS_PRIORITY, ["anomalies"])
    )

    for anomaly in (parsed.get("anomalies") or []):
        clean_quotes = []
        for q in (anomaly.get("quotes") or []):
            if not isinstance(q, dict):
                continue
            ok = _verify_quote_on_page(
                pdf_blocks, q.get("file_name"), q.get("page_number"), str(q.get("quote") or "")
            )
            q["verified"] = ok
            clean_quotes.append(q)
        anomaly["quotes"] = clean_quotes

    # Normalized cross-agent field — see claim_story agent.
    parsed["findings"] = parsed.get("anomalies") or []

    return {"status": "ok", "result": parsed, "error": None}

# ─────────────────────────────────────────────────────────────────────────
# Stage 2e — Accident / RTA agent
# ─────────────────────────────────────────────────────────────────────────

ACCIDENT_RTA_RELEVANT_TYPES = {
    "FIR / MLC / Police Document",
    "Discharge Summary",
    "Field Investigation Form (SDF)",
    "Claim Trigger Email / Claim Form",
}

_ACCIDENT_RTA_PROMPT = """You are an insurance investigator's accident/RTA (road traffic accident) \
specialist. Using ONLY the source pages below (OCR'd text — you have NO access to photographs, \
so NEVER claim to have evaluated vehicle damage, spot photos, or helmet/seatbelt usage from an \
image), assess whether this claim involves an accident, and if so, whether the accident-related \
evidence is present and internally consistent.

First determine: does this claim involve an accident/RTA at all, based on the source pages? If \
there is no accident narration, MLC, FIR, or police document anywhere in the source pages, this is \
likely not an accident claim — say so plainly rather than forcing an accident assessment.

If it IS an accident claim, check:
- Is there a documented accident narration (date, time, location, how it occurred)?
- Is there MLC (Medico-Legal Case) documentation, and/or FIR/police intimation?
- Does the accident narration stay consistent across the documents it appears in (e.g. patient's \
  own account vs. hospital's recorded narration vs. field investigation form), or do they \
  materially conflict on what happened, when, or where?
- Is there a documented first-aid/first-hospital-arrival timeline that is chronologically \
  consistent with the stated accident time?
- Any explicit mention of alcohol/intoxication in relation to the accident, if present in the text.

CLAIM CONTEXT (known accident/incident date if already extracted elsewhere):
{claim_context}

Return ONLY a single JSON object, no prose, no markdown fences:
{{
  "status": "NOT_AN_ACCIDENT_CLAIM" | "ACCIDENT_EVIDENCE_CONSISTENT" | "ACCIDENT_EVIDENCE_INCONSISTENT" | "INSUFFICIENT_EVIDENCE",
  "accident_narration_summary": "<1-3 sentences summarizing the accident as documented, or null if not an accident claim>",
  "mlc_fir_present": true | false | null,
  "inconsistencies": [
    {{
      "type": "NARRATION_CONFLICT" | "MISSING_MLC_FIR" | "TIMELINE_INCONSISTENCY" | "OTHER",
      "explanation": "<1-2 sentences>",
      "quotes": [
        {{"file_name": "<exact file_name from a source page above>", "page_number": <int or null>, "quote": "<verbatim, under 20 words, copied exactly from that page>"}}
      ]
    }}
  ],
  "explanation": "<2-4 sentences, reviewer-facing, plain language, overall verdict rationale>",
  "confidence": "high" | "medium" | "low"
}}

Rules:
- Use NOT_AN_ACCIDENT_CLAIM if the source pages give no indication this is an accident/RTA claim —
  leave the other fields null/empty rather than forcing an assessment.
- Only flag ACCIDENT_EVIDENCE_INCONSISTENT with genuine textual evidence of a specific conflict
  above — never speculate, and never fabricate a quote.
- Every quote must be a single contiguous run of characters exactly as they appear on the page —
  never elide, truncate, or skip words with "..." or similar.
- Use INSUFFICIENT_EVIDENCE if it does appear to be an accident claim but the source pages don't
  contain enough detail (e.g. narration mentioned but no MLC/FIR pages present at all) to assess
  consistency either way.

SOURCE PAGES:
{content}
"""


def _run_accident_rta_agent(pdf_blocks, classification, claim_context: dict) -> Dict[str, Any]:
    content = _pages_for_doc_types(pdf_blocks, classification, ACCIDENT_RTA_RELEVANT_TYPES)
    if not content.strip():
        return {
            "status": "ok",
            "result": {
                "status": "NOT_AN_ACCIDENT_CLAIM",
                "accident_narration_summary": None,
                "mlc_fir_present": None,
                "inconsistencies": [],
                "explanation": "No accident/RTA-relevant documents were classified for this case.",
                "confidence": "low",
            },
            "error": None,
        }

    prompt = _ACCIDENT_RTA_PROMPT.format(
        claim_context=json.dumps(claim_context, default=str),
        content=content,
    )
    raw = _groq_call(
        "You are a careful, evidence-only insurance accident/RTA investigator. Output only JSON.",
        prompt,
        max_tokens=6000,
    )
    parsed = _parse_llm_json(raw or "")
    if not parsed:
        return {"status": "error", "result": None, "error": "Accident/RTA agent: could not parse LLM output"}

    for inc in (parsed.get("inconsistencies") or []):
        clean_quotes = []
        for q in (inc.get("quotes") or []):
            if not isinstance(q, dict):
                continue
            ok = _verify_quote_on_page(
                pdf_blocks, q.get("file_name"), q.get("page_number"), str(q.get("quote") or "")
            )
            q["verified"] = ok
            clean_quotes.append(q)
        inc["quotes"] = clean_quotes

    # Normalized cross-agent field — see claim_story agent.
    parsed["findings"] = parsed.get("inconsistencies") or []

    return {"status": "ok", "result": parsed, "error": None}


# ─────────────────────────────────────────────────────────────────────────
# Stage 2f — Death agent
# ─────────────────────────────────────────────────────────────────────────

DEATH_RELEVANT_TYPES = {
    "Death Certificate / Death Summary",
    "FIR / MLC / Police Document",
    "Discharge Summary",
    "Field Investigation Form (SDF)",
    "Claim Trigger Email / Claim Form",
}

_DEATH_PROMPT = """You are an insurance investigator's death-claim specialist. Using ONLY the \
source pages below (OCR'd text only), assess whether this is a death claim, and if so, whether \
the death-related documentation is present and internally consistent.

First determine: does this claim involve a death, based on the source pages? If there is no death \
certificate, death summary, or death-related narration anywhere in the source pages, this is not \
a death claim — say so plainly rather than forcing a death assessment.

If it IS a death claim, check:
- Is there a death certificate and/or death summary documenting cause, time, and place of death?
- Is the stated cause/circumstances of death consistent across the documents it appears in (e.g. \
  hospital discharge/death summary vs. death certificate vs. field investigation form), or do they \
  materially conflict?
- For deaths with potential legal/accident involvement: is there FIR, postmortem, or police \
  documentation, and is it consistent with the stated cause of death?
- Do any dates around the death (admission, treatment, death, and any document signed/dated \
  afterward) sequence chronologically, or is there a document purportedly signed/dated by the \
  patient AFTER the documented death date — this is a critical authenticity flag if present.
- Any explicit mention of suicide or alcohol-related circumstances in relation to the death, if \
  present in the text.

CLAIM CONTEXT (known death date if already extracted elsewhere):
{claim_context}

Return ONLY a single JSON object, no prose, no markdown fences:
{{
  "status": "NOT_A_DEATH_CLAIM" | "DEATH_EVIDENCE_CONSISTENT" | "DEATH_EVIDENCE_INCONSISTENT" | "INSUFFICIENT_EVIDENCE",
  "cause_of_death_summary": "<1-3 sentences summarizing the documented cause/circumstances of death, or null if not a death claim>",
  "death_certificate_present": true | false | null,
  "inconsistencies": [
    {{
      "type": "CAUSE_OF_DEATH_CONFLICT" | "MISSING_DEATH_CERTIFICATE" | "TIMELINE_INCONSISTENCY" | "POST_DEATH_DOCUMENT_SIGNED" | "OTHER",
      "explanation": "<1-2 sentences>",
      "quotes": [
        {{"file_name": "<exact file_name from a source page above>", "page_number": <int or null>, "quote": "<verbatim, under 20 words, copied exactly from that page>"}}
      ]
    }}
  ],
  "explanation": "<2-4 sentences, reviewer-facing, plain language, overall verdict rationale>",
  "confidence": "high" | "medium" | "low"
}}

Rules:
- Use NOT_A_DEATH_CLAIM if the source pages give no indication this is a death claim — leave the
  other fields null/empty rather than forcing an assessment.
- Only flag DEATH_EVIDENCE_INCONSISTENT with genuine textual evidence of a specific conflict above —
  never speculate, and never fabricate a quote. A document "signed" after the death date is always
  worth flagging if you have genuine textual evidence of it.
- Every quote must be a single contiguous run of characters exactly as they appear on the page —
  never elide, truncate, or skip words with "..." or similar.
- Use INSUFFICIENT_EVIDENCE if it does appear to be a death claim but the source pages don't
  contain enough detail to assess consistency either way.

SOURCE PAGES:
{content}
"""


def _run_death_agent(pdf_blocks, classification, claim_context: dict) -> Dict[str, Any]:
    content = _pages_for_doc_types(pdf_blocks, classification, DEATH_RELEVANT_TYPES)
    if not content.strip():
        return {
            "status": "ok",
            "result": {
                "status": "NOT_A_DEATH_CLAIM",
                "cause_of_death_summary": None,
                "death_certificate_present": None,
                "inconsistencies": [],
                "explanation": "No death-relevant documents were classified for this case.",
                "confidence": "low",
            },
            "error": None,
        }

    prompt = _DEATH_PROMPT.format(
        claim_context=json.dumps(claim_context, default=str),
        content=content,
    )
    raw = _groq_call(
        "You are a careful, evidence-only insurance death-claim investigator. Output only JSON.",
        prompt,
        max_tokens=6000,
    )
    parsed = _parse_llm_json(raw or "")
    if not parsed:
        return {"status": "error", "result": None, "error": "Death agent: could not parse LLM output"}

    for inc in (parsed.get("inconsistencies") or []):
        clean_quotes = []
        for q in (inc.get("quotes") or []):
            if not isinstance(q, dict):
                continue
            ok = _verify_quote_on_page(
                pdf_blocks, q.get("file_name"), q.get("page_number"), str(q.get("quote") or "")
            )
            q["verified"] = ok
            clean_quotes.append(q)
        inc["quotes"] = clean_quotes

    # Normalized cross-agent field — see claim_story agent.
    parsed["findings"] = parsed.get("inconsistencies") or []

    return {"status": "ok", "result": parsed, "error": None}


# ─────────────────────────────────────────────────────────────────────────
# Stage 2g — Medical Necessity agent
# ─────────────────────────────────────────────────────────────────────────

# Distinct from Clinical Genuineness: this agent assumes the hospitalization
# is genuine and asks a narrower question — was the LEVEL of care (admission,
# ICU, length of stay, specific procedures/investigations) actually warranted
# by the clinical picture, not just internally consistent with it.
MEDICAL_NECESSITY_RELEVANT_TYPES = {
    "Discharge Summary",
    "Lab Report",
    "Radiology Report",
    "Cardiology Report",
    "Histopathology / Biopsy Report",
    "Prescription / Medication Record",
    "Field Investigation Form (SDF)",
}

_MEDICAL_NECESSITY_PROMPT = """You are an insurance investigator's medical necessity specialist. \
Using ONLY the source pages below, assess whether the LEVEL of care documented — inpatient \
admission, ICU/critical care, length of stay, and any procedures/investigations performed — was \
clinically warranted by the diagnosis and clinical findings.

This is NOT a genuineness check — assume the hospitalization and diagnosis, as documented, are \
real. Your job is narrower: given that diagnosis and clinical picture, was this MUCH care \
actually needed, or does the record suggest the care given exceeded (or fell short of) what the \
condition required?

Specifically check:
- Was inpatient (as opposed to outpatient) admission clinically supported by the presenting \
  condition and findings?
- If ICU/critical care was used, do the vitals/clinical notes support that level of care, or does \
  the record show a stable patient who didn't clearly need it?
- Does the length of stay documented (admission to discharge date) match the clinical progress \
  described (e.g. a multi-day stay for a condition the record shows resolved on day one)?
- Were major investigations/procedures clinically indicated by the diagnosis, or do any appear \
  excessive/unrelated to the stated condition?

CLAIM CONTEXT (known diagnosis/admission-discharge dates, if already extracted elsewhere):
{claim_context}

Return ONLY a single JSON object, no prose, no markdown fences:
{{
  "status": "SUPPORTED" | "BORDERLINE" | "NOT_SUPPORTED" | "INSUFFICIENT_EVIDENCE",
  "admission_supported": true | false | null,
  "icu_supported": true | false | null,
  "length_of_stay_supported": true | false | null,
  "explanation": "<2-4 sentences, reviewer-facing, plain language, overall verdict rationale>",
  "concerns": [
    {{
      "type": "ADMISSION_NOT_SUPPORTED" | "ICU_NOT_SUPPORTED" | "LENGTH_OF_STAY_EXCESSIVE" | "PROCEDURE_NOT_INDICATED" | "OTHER",
      "explanation": "<1-2 sentences>",
      "quotes": [
        {{"file_name": "<exact file_name from a source page above>", "page_number": <int or null>, "quote": "<verbatim, under 20 words, copied exactly from that page>"}}
      ]
    }}
  ],
  "confidence": "high" | "medium" | "low"
}}

Rules:
- These are investigation findings, NOT automatic repudiation grounds — phrase explanations
  neutrally, as something for a reviewer to weigh, not a conclusion of wrongdoing.
- Use BORDERLINE when the evidence is mixed or a reasonable clinician could argue either way —
  don't force NOT_SUPPORTED just because something is debatable.
- Only flag a concern with genuine textual evidence above — never speculate, and never fabricate
  a quote.
- Every quote must be a single contiguous run of characters exactly as they appear on the page —
  never elide, truncate, or skip words with "..." or similar.
- Use INSUFFICIENT_EVIDENCE if the source pages don't contain enough clinical detail (vitals,
  progress notes, investigation results) to judge necessity either way.

SOURCE PAGES:
{content}
"""


def _run_medical_necessity_agent(pdf_blocks, classification, claim_context: dict) -> Dict[str, Any]:
    content = _pages_for_doc_types(pdf_blocks, classification, MEDICAL_NECESSITY_RELEVANT_TYPES)
    if not content.strip():
        return {
            "status": "ok",
            "result": {
                "status": "INSUFFICIENT_EVIDENCE",
                "admission_supported": None,
                "icu_supported": None,
                "length_of_stay_supported": None,
                "explanation": "No clinical-evidence documents were classified for this case.",
                "concerns": [],
                "confidence": "low",
            },
            "error": None,
        }

    prompt = _MEDICAL_NECESSITY_PROMPT.format(
        claim_context=json.dumps(claim_context, default=str),
        content=content,
    )
    raw = _groq_call(
        "You are a careful, evidence-only insurance medical necessity investigator. Output only JSON.",
        prompt,
        max_tokens=6000,
    )
    parsed = _parse_llm_json(raw or "")
    if not parsed:
        return {"status": "error", "result": None, "error": "Medical necessity agent: could not parse LLM output"}

    for concern in (parsed.get("concerns") or []):
        clean_quotes = []
        for q in (concern.get("quotes") or []):
            if not isinstance(q, dict):
                continue
            ok = _verify_quote_on_page(
                pdf_blocks, q.get("file_name"), q.get("page_number"), str(q.get("quote") or "")
            )
            q["verified"] = ok
            clean_quotes.append(q)
        concern["quotes"] = clean_quotes

    # Normalized cross-agent field — see claim_story agent.
    parsed["findings"] = parsed.get("concerns") or []

    return {"status": "ok", "result": parsed, "error": None}


# ─────────────────────────────────────────────────────────────────────────
# Stage 2h — Hospital Verification agent
# ─────────────────────────────────────────────────────────────────────────

# IMPORTANT SCOPE NOTE: this pipeline has no access to any external hospital
# registry/NABH database, so it cannot "verify" a hospital against ground
# truth the way the source architecture doc's version does. This agent is
# scoped to what's actually checkable from the claim's OWN documents: does
# the hospital's identity stay internally consistent across every page that
# mentions it, and what credential claims (registration no., NABH, bed
# count) does the text itself assert — never claiming external verification
# it has no evidence for.
HOSPITAL_VERIFICATION_RELEVANT_TYPES = {
    "Discharge Summary",
    "Bill / Invoice",
    "Lab Report",
    "Radiology Report",
    "Cardiology Report",
    "Histopathology / Biopsy Report",
    "Field Investigation Form (SDF)",
}

_HOSPITAL_VERIFICATION_PROMPT = """You are an insurance investigator's hospital-identity \
specialist. Using ONLY the source pages below (OCR'd text only — you have NO access to any \
external hospital registry, NABH database, or other ground-truth source, so NEVER claim a \
hospital credential is "verified"; you can only report what the documents themselves assert and \
whether those assertions are internally consistent), check the claimed hospital's identity and \
credential details.

Specifically check:
- Does the hospital name stay the same across every document that names it, or does it appear to \
  vary in a way suggesting a different facility (not just a spelling/OCR variant)?
- Does a hospital registration number appear anywhere in the text, and if it appears on multiple \
  documents, is it the same value each time?
- Is there any explicit claim of NABH accreditation, bed capacity, or specialist staff (pathologist, \
  radiologist) in the text, and if so, is it consistent across documents?
- Does the hospital address stay consistent across documents?

CLAIM CONTEXT (known hospital name, if already extracted elsewhere):
{claim_context}

Return ONLY a single JSON object, no prose, no markdown fences:
{{
  "status": "IDENTITY_CONSISTENT" | "IDENTITY_INCONSISTENCY_FOUND" | "INSUFFICIENT_EVIDENCE",
  "hospital_name": "<name as documented, or null>",
  "registration_number_asserted": "<value if found in text, or null>",
  "nabh_claimed": true | false | null,
  "inconsistencies": [
    {{
      "type": "HOSPITAL_NAME_VARIES" | "REGISTRATION_NUMBER_VARIES" | "ADDRESS_VARIES" | "OTHER",
      "explanation": "<1-2 sentences>",
      "quotes": [
        {{"file_name": "<exact file_name from a source page above>", "page_number": <int or null>, "quote": "<verbatim, under 20 words, copied exactly from that page>"}}
      ]
    }}
  ],
  "explanation": "<2-4 sentences, reviewer-facing, plain language — explicitly note this reflects internal document consistency only, not external registry verification>",
  "confidence": "high" | "medium" | "low"
}}

Rules:
- NEVER say a credential is "verified" — you have no external source to verify against. Only
  report what's asserted in the text and whether it's internally consistent.
- Only flag IDENTITY_INCONSISTENCY_FOUND with genuine textual evidence of a specific conflict —
  never speculate, and never fabricate a quote. Minor spelling/OCR variants of the same name are
  NOT a conflict.
- Every quote must be a single contiguous run of characters exactly as they appear on the page —
  never elide, truncate, or skip words with "..." or similar.
- Use INSUFFICIENT_EVIDENCE if the source pages don't name the hospital clearly enough to assess.

SOURCE PAGES:
{content}
"""


def _run_hospital_verification_agent(pdf_blocks, classification, claim_context: dict) -> Dict[str, Any]:
    content = _pages_for_doc_types(pdf_blocks, classification, HOSPITAL_VERIFICATION_RELEVANT_TYPES)
    if not content.strip():
        return {
            "status": "ok",
            "result": {
                "status": "INSUFFICIENT_EVIDENCE",
                "hospital_name": None,
                "registration_number_asserted": None,
                "nabh_claimed": None,
                "inconsistencies": [],
                "explanation": "No hospital-identifying documents were classified for this case.",
                "confidence": "low",
            },
            "error": None,
        }

    prompt = _HOSPITAL_VERIFICATION_PROMPT.format(
        claim_context=json.dumps(claim_context, default=str),
        content=content,
    )
    raw = _groq_call(
        "You are a careful, evidence-only insurance hospital-identity investigator. Output only JSON.",
        prompt,
        max_tokens=6000,
    )
    parsed = _parse_llm_json(raw or "")
    if not parsed:
        return {"status": "error", "result": None, "error": "Hospital verification agent: could not parse LLM output"}

    for inc in (parsed.get("inconsistencies") or []):
        clean_quotes = []
        for q in (inc.get("quotes") or []):
            if not isinstance(q, dict):
                continue
            ok = _verify_quote_on_page(
                pdf_blocks, q.get("file_name"), q.get("page_number"), str(q.get("quote") or "")
            )
            q["verified"] = ok
            clean_quotes.append(q)
        inc["quotes"] = clean_quotes

    # Normalized cross-agent field — see claim_story agent.
    parsed["findings"] = parsed.get("inconsistencies") or []

    return {"status": "ok", "result": parsed, "error": None}


# ─────────────────────────────────────────────────────────────────────────
# Stage 2i — High-Value Claim agent
# ─────────────────────────────────────────────────────────────────────────

# Distinct focus from the Billing agent: Billing reconciles claimed vs.
# billed totals and internal bill arithmetic. This agent looks at tariff
# variance, payment mode/evidence, and specifically non-payable items
# (diet, non-medical consumables) and high-cost implants/procedures — the
# checks the source doc calls out specifically for high-value claims. No
# claimed-amount threshold is applied here (that's a business/policy
# decision); this agent always runs and reports what it finds.
HIGH_VALUE_CLAIM_RELEVANT_TYPES = {
    "Bill / Invoice",
    "Claim Trigger Email / Claim Form",
    "Discharge Summary",
}

_HIGH_VALUE_CLAIM_PROMPT = """You are an insurance investigator's high-value-claim financial \
specialist. Using ONLY the source pages below, review the bill in detail for tariff variance, \
payment evidence, and non-payable or high-cost items that warrant scrutiny.

Specifically check:
- Do any billed line items appear to be non-medical or non-payable (e.g. diet charges, \
  attendant charges, administrative/registration fees, cosmetic items) that a reviewer would want \
  to exclude from reimbursement?
- Are there high-cost items — implants, prosthetics, expensive consumables, or high-cost \
  procedures — and if so, is their cost clearly itemized and consistent across the bill (not \
  vaguely bundled into a lump sum that's hard to verify)?
- Is there a discount applied, and does gross amount minus discount equal the net/claimed amount \
  (a mismatch here is a distinct concern from a simple reconciliation issue)?
- Is there explicit payment-mode or payment-evidence text (cash/online/cheque/NEFT, receipt \
  numbers) that would let a reviewer confirm the amount was actually paid, or is that entirely \
  absent for a bill this size?

CLAIM CONTEXT (known claimed amount / billing details, if already extracted elsewhere):
{claim_context}

Return ONLY a single JSON object, no prose, no markdown fences:
{{
  "status": "NO_CONCERNS" | "CONCERNS_FOUND" | "INSUFFICIENT_EVIDENCE",
  "non_payable_items": [
    {{"item": "<item description>", "amount": <number or null>, "file_name": "<exact file_name>", "page_number": <int or null>, "quote": "<verbatim, under 20 words>"}}
  ],
  "high_cost_items": [
    {{"item": "<item description>", "amount": <number or null>, "file_name": "<exact file_name>", "page_number": <int or null>, "quote": "<verbatim, under 20 words>"}}
  ],
  "payment_evidence_present": true | false | null,
  "explanation": "<2-4 sentences, reviewer-facing, plain language, overall verdict rationale>",
  "confidence": "high" | "medium" | "low"
}}

Rules:
- Only list a non_payable_item or high_cost_item with a genuine verbatim quote from the source
  pages above — never fabricate a quote, and never invent an amount not present in the text.
- Every quote must be a single contiguous run of characters exactly as they appear on the page —
  never elide, truncate, or skip words with "..." or similar. If an item's description and its
  amount sit in separate table columns, quote only ONE fully contiguous span (e.g. just the
  amount, "85568.78"), never a stitched-together span like "Medicines ... 85568.78".
- Use INSUFFICIENT_EVIDENCE if the source pages don't contain a detailed enough bill to assess
  this (e.g. only a summary total with no line items).
- Use NO_CONCERNS if the bill is itemized, reconciles, and shows no non-payable/unclear high-cost
  items.

SOURCE PAGES:
{content}
"""


def _run_high_value_claim_agent(pdf_blocks, classification, claim_context: dict) -> Dict[str, Any]:
    content = _pages_for_doc_types(pdf_blocks, classification, HIGH_VALUE_CLAIM_RELEVANT_TYPES)
    if not content.strip():
        return {
            "status": "ok",
            "result": {
                "status": "INSUFFICIENT_EVIDENCE",
                "non_payable_items": [],
                "high_cost_items": [],
                "payment_evidence_present": None,
                "explanation": "No bill/invoice documents were classified for this case.",
                "confidence": "low",
            },
            "error": None,
        }

    prompt = _HIGH_VALUE_CLAIM_PROMPT.format(
        claim_context=json.dumps(claim_context, default=str),
        content=content,
    )
    raw = _groq_call(
        "You are a careful, evidence-only insurance high-value-claim financial investigator. Output only JSON.",
        prompt,
        max_tokens=6000,
    )
    parsed = _parse_llm_json(raw or "")
    if not parsed:
        return {"status": "error", "result": None, "error": "High-value claim agent: could not parse LLM output"}

    for key in ("non_payable_items", "high_cost_items"):
        clean_items = []
        for item in (parsed.get(key) or []):
            if not isinstance(item, dict):
                continue
            ok = _verify_quote_on_page(
                pdf_blocks, item.get("file_name"), item.get("page_number"), str(item.get("quote") or "")
            )
            item["verified"] = ok
            clean_items.append(item)
        parsed[key] = clean_items

    # Normalized cross-agent field — see claim_story agent. This agent's
    # two item arrays don't share the {type, explanation, quotes} shape
    # every other agent uses, so each item is individually wrapped into
    # that shape here (original non_payable_items/high_cost_items arrays
    # are left untouched for backward compatibility).
    parsed["findings"] = [
        {
            "type": "NON_PAYABLE_ITEM",
            "explanation": item.get("item"),
            "quotes": [{
                "file_name": item.get("file_name"),
                "page_number": item.get("page_number"),
                "quote": item.get("quote"),
                "verified": item.get("verified"),
            }],
        }
        for item in (parsed.get("non_payable_items") or [])
    ] + [
        {
            "type": "HIGH_COST_ITEM",
            "explanation": item.get("item"),
            "quotes": [{
                "file_name": item.get("file_name"),
                "page_number": item.get("page_number"),
                "quote": item.get("quote"),
                "verified": item.get("verified"),
            }],
        }
        for item in (parsed.get("high_cost_items") or [])
    ]

    return {"status": "ok", "result": parsed, "error": None}


# ─────────────────────────────────────────────────────────────────────────
# Stage 2j — Employee Verification agent
# ─────────────────────────────────────────────────────────────────────────

# Only relevant for group/corporate policies — self-detects applicability
# same as Accident/RTA and Death agents. Uses the "Employment / HR
# Document" taxonomy value plus ID Proof and Policy/Proposal Form for
# cross-referencing employee identity.
EMPLOYEE_VERIFICATION_RELEVANT_TYPES = {
    "Employment / HR Document",
    "ID Proof",
    "Policy / Proposal Form",
    "Claim Trigger Email / Claim Form",
}

_EMPLOYEE_VERIFICATION_PROMPT = """You are an insurance investigator's employee-verification \
specialist, for group/corporate policy claims. Using ONLY the source pages below (OCR'd text \
only — you have NO access to any external HR/payroll system, so NEVER claim to have "verified" \
employment against a company's own records; you can only report what the documents themselves \
assert and whether those assertions are internally consistent), check whether this claim \
involves a group/corporate policy, and if so, whether the claimant's employment/relationship to \
the policyholder company is documented and internally consistent.

First determine: does this claim involve a group/corporate policy at all, based on the source \
pages (e.g. an employer name on the policy, an HR letter, a company ID)? If there is no such \
indication, this is likely an individual/retail policy — say so plainly rather than forcing an \
employment assessment.

If it IS a group/corporate policy claim, check:
- Is there a document (HR letter, employment certificate, company ID, appointment letter) \
  confirming the claimant's employment with the policyholder company?
- Does the claimant's name stay consistent between the employment document and the ID proof / \
  policy documents (not just a spelling/OCR variant)?
- Does the employee/policy relationship (self vs. dependent) match what's asserted across \
  documents — e.g. a claim for a "spouse" or "child" whose stated relationship to the named \
  employee is consistent across documents?
- Is the employee ID / designation, if stated, consistent everywhere it appears?

CLAIM CONTEXT (known policyholder/employer name, if already extracted elsewhere):
{claim_context}

Return ONLY a single JSON object, no prose, no markdown fences:
{{
  "status": "NOT_A_GROUP_POLICY_CLAIM" | "EMPLOYMENT_CONSISTENT" | "EMPLOYMENT_INCONSISTENCY_FOUND" | "INSUFFICIENT_EVIDENCE",
  "employer_name": "<name as documented, or null>",
  "claimant_relationship": "SELF" | "SPOUSE" | "CHILD" | "OTHER" | null,
  "inconsistencies": [
    {{
      "type": "NAME_MISMATCH" | "RELATIONSHIP_MISMATCH" | "EMPLOYMENT_NOT_DOCUMENTED" | "OTHER",
      "explanation": "<1-2 sentences>",
      "quotes": [
        {{"file_name": "<exact file_name from a source page above>", "page_number": <int or null>, "quote": "<verbatim, under 20 words, copied exactly from that page>"}}
      ]
    }}
  ],
  "explanation": "<2-4 sentences, reviewer-facing, plain language — explicitly note this reflects internal document consistency only, not external HR/payroll verification>",
  "confidence": "high" | "medium" | "low"
}}

Rules:
- Use NOT_A_GROUP_POLICY_CLAIM if the source pages give no indication this is a group/corporate
  policy claim — leave the other fields null/empty rather than forcing an assessment.
- NEVER say employment is "verified" — you have no external HR/payroll source to verify against.
  Only report what's asserted in the text and whether it's internally consistent.
- Only flag EMPLOYMENT_INCONSISTENCY_FOUND with genuine textual evidence — never speculate, and
  never fabricate a quote. Minor spelling/OCR variants of the same name are NOT a conflict.
- Every quote must be a single contiguous run of characters exactly as they appear on the page —
  never elide, truncate, or skip words with "..." or similar.
- Use INSUFFICIENT_EVIDENCE if it does appear to be a group policy claim but no employment
  document is present at all to assess.

SOURCE PAGES:
{content}
"""


def _run_employee_verification_agent(pdf_blocks, classification, claim_context: dict) -> Dict[str, Any]:
    content = _pages_for_doc_types(pdf_blocks, classification, EMPLOYEE_VERIFICATION_RELEVANT_TYPES)
    if not content.strip():
        return {
            "status": "ok",
            "result": {
                "status": "NOT_A_GROUP_POLICY_CLAIM",
                "employer_name": None,
                "claimant_relationship": None,
                "inconsistencies": [],
                "explanation": "No employment/HR-relevant documents were classified for this case.",
                "confidence": "low",
            },
            "error": None,
        }

    prompt = _EMPLOYEE_VERIFICATION_PROMPT.format(
        claim_context=json.dumps(claim_context, default=str),
        content=content,
    )
    raw = _groq_call(
        "You are a careful, evidence-only insurance employee-verification investigator. Output only JSON.",
        prompt,
        max_tokens=6000,
    )
    parsed = _parse_llm_json(raw or "")
    if not parsed:
        return {"status": "error", "result": None, "error": "Employee verification agent: could not parse LLM output"}

    for inc in (parsed.get("inconsistencies") or []):
        clean_quotes = []
        for q in (inc.get("quotes") or []):
            if not isinstance(q, dict):
                continue
            ok = _verify_quote_on_page(
                pdf_blocks, q.get("file_name"), q.get("page_number"), str(q.get("quote") or "")
            )
            q["verified"] = ok
            clean_quotes.append(q)
        inc["quotes"] = clean_quotes

    # Normalized cross-agent field — see claim_story agent.
    parsed["findings"] = parsed.get("inconsistencies") or []

    return {"status": "ok", "result": parsed, "error": None}


# ─────────────────────────────────────────────────────────────────────────
# Stage 2k — Bill Verification agent
# ─────────────────────────────────────────────────────────────────────────

# Distinct from both Billing (claimed-vs-billed total reconciliation) and
# High-Value Claim (non-payable items, high-cost implants, payment
# evidence): this agent looks WITHIN a single bill for duplicate line
# items, cross-references billed services against clinical report pages
# to catch a billed service with no corresponding report/order anywhere,
# and checks package/tariff-vs-itemized variance. Needs clinical report
# types in addition to Bill/Invoice for the cross-reference, unlike any
# other agent's relevant-types set.
BILL_VERIFICATION_RELEVANT_TYPES = {
    "Bill / Invoice",
    "Lab Report",
    "Radiology Report",
    "Cardiology Report",
    "Histopathology / Biopsy Report",
    "Prescription / Medication Record",
    "Discharge Summary",
}

_BILL_VERIFICATION_PROMPT = """You are an insurance investigator's bill-verification specialist. \
Using ONLY the source pages below, check the bill itself for internal irregularities distinct \
from a simple claimed-vs-billed total reconciliation.

Specifically check:
- DUPLICATE LINE ITEMS: does the same service/item appear billed more than once under different \
  line entries within the same bill (not the same item legitimately repeated on different days)?
- CLINICAL MISMATCH: is there a billed service (e.g. a specific lab test, radiology scan, \
  procedure) that has NO corresponding report, order, or clinical note anywhere in the source \
  pages — i.e. it was charged for but there's no evidence it was actually performed or ordered?
- PACKAGE / TARIFF VARIANCE: if a package/bundled procedure rate is billed AND its individual \
  components are also itemized somewhere, does the package rate reconcile with the sum of \
  itemized components, or is there an unexplained gap?

This is NOT a claimed-vs-total reconciliation check (a separate agent does that) and NOT a \
non-payable-items/payment-evidence check (a separate agent does that too) — stay narrowly focused \
on duplicate line items, clinical-mismatch, and package/tariff variance only.

CLAIM CONTEXT (known billing details, if already extracted elsewhere):
{claim_context}

Return ONLY a single JSON object, no prose, no markdown fences:
{{
  "status": "NO_CONCERNS" | "CONCERNS_FOUND" | "INSUFFICIENT_EVIDENCE",
  "flags": [
    {{
      "type": "DUPLICATE_LINE_ITEM" | "CLINICAL_MISMATCH" | "PACKAGE_TARIFF_VARIANCE" | "OTHER",
      "explanation": "<1-2 sentences>",
      "quotes": [
        {{"file_name": "<exact file_name from a source page above>", "page_number": <int or null>, "quote": "<verbatim, under 20 words, copied exactly from that page>"}}
      ]
    }}
  ],
  "explanation": "<2-4 sentences, reviewer-facing, plain language, overall verdict rationale>",
  "confidence": "high" | "medium" | "low"
}}

Rules:
- Only flag a concern with genuine textual evidence — never speculate, and never fabricate a
  quote. A clinical-mismatch flag requires positively confirming the service is billed AND that
  no corresponding report/order exists anywhere in the source pages provided to you — do not flag
  it just because you personally didn't notice the report; be conservative here.
- Every quote must be a single contiguous run of characters exactly as they appear on the page —
  never elide, truncate, or skip words with "..." or similar.
- Use INSUFFICIENT_EVIDENCE if the source pages don't contain a detailed enough itemized bill to
  assess this.
- Use NO_CONCERNS if the bill is itemized and shows no duplicate items, mismatches, or variance.

SOURCE PAGES:
{content}
"""


def _run_bill_verification_agent(pdf_blocks, classification, claim_context: dict) -> Dict[str, Any]:
    content = _pages_for_doc_types(pdf_blocks, classification, BILL_VERIFICATION_RELEVANT_TYPES)
    if not content.strip():
        return {
            "status": "ok",
            "result": {
                "status": "INSUFFICIENT_EVIDENCE",
                "flags": [],
                "explanation": "No bill or clinical documents were classified for this case.",
                "confidence": "low",
            },
            "error": None,
        }

    prompt = _BILL_VERIFICATION_PROMPT.format(
        claim_context=json.dumps(claim_context, default=str),
        content=content,
    )
    raw = _groq_call(
        "You are a careful, evidence-only insurance bill-verification investigator. Output only JSON.",
        prompt,
        max_tokens=6000,
    )
    parsed = _parse_llm_json(raw or "")
    if not parsed:
        return {"status": "error", "result": None, "error": "Bill verification agent: could not parse LLM output"}

    for flag in (parsed.get("flags") or []):
        clean_quotes = []
        for q in (flag.get("quotes") or []):
            if not isinstance(q, dict):
                continue
            ok = _verify_quote_on_page(
                pdf_blocks, q.get("file_name"), q.get("page_number"), str(q.get("quote") or "")
            )
            q["verified"] = ok
            clean_quotes.append(q)
        flag["quotes"] = clean_quotes

    # Normalized cross-agent field — see claim_story agent.
    parsed["findings"] = parsed.get("flags") or []

    return {"status": "ok", "result": parsed, "error": None}


# ─────────────────────────────────────────────────────────────────────────
# Stage 2l — Identity agent
# ─────────────────────────────────────────────────────────────────────────

# SCOPE NOTE: no access to any external ID/KYC registry (Aadhaar, PAN,
# voter ID databases), so this cannot "verify" identity against ground
# truth. Scoped to what's checkable from the claim's own documents: does
# the claimant's identity (name, DOB, ID number) stay consistent across
# every document that names them.
IDENTITY_RELEVANT_TYPES = {
    "ID Proof",
    "Policy / Proposal Form",
    "Claim Trigger Email / Claim Form",
    "Field Investigation Form (SDF)",
    "Discharge Summary",
}

_IDENTITY_PROMPT = """You are an insurance investigator's identity-verification specialist. \
Using ONLY the source pages below (OCR'd text only — you have NO access to any external \
ID/KYC registry such as Aadhaar or PAN databases, so NEVER claim an identity is "verified"; you \
can only report what the documents themselves assert and whether those assertions are internally \
consistent), check whether the claimant's identity stays consistent across the source pages.

Specifically check:
- Does the claimant's full name stay the same across every document that names them (not just a \
  spelling/OCR variant)?
- Does date of birth / age, if stated in more than one place, match across documents?
- Does an ID number (Aadhaar/PAN/voter ID/passport), if it appears on more than one document, \
  match each time it appears?
- Does the claimant named on the claim form/policy match the patient named on the hospital \
  records (accounting for legitimate dependent claims, which should not be flagged)?

CLAIM CONTEXT (known claimant/policyholder name, if already extracted elsewhere):
{claim_context}

Return ONLY a single JSON object, no prose, no markdown fences:
{{
  "status": "IDENTITY_CONSISTENT" | "IDENTITY_INCONSISTENCY_FOUND" | "INSUFFICIENT_EVIDENCE",
  "claimant_name": "<name as documented, or null>",
  "id_number_asserted": "<value if found in text, or null>",
  "inconsistencies": [
    {{
      "type": "NAME_VARIES" | "DOB_VARIES" | "ID_NUMBER_VARIES" | "PATIENT_CLAIMANT_MISMATCH" | "OTHER",
      "explanation": "<1-2 sentences>",
      "quotes": [
        {{"file_name": "<exact file_name from a source page above>", "page_number": <int or null>, "quote": "<verbatim, under 20 words, copied exactly from that page>"}}
      ]
    }}
  ],
  "explanation": "<2-4 sentences, reviewer-facing, plain language — explicitly note this reflects internal document consistency only, not external ID/KYC verification>",
  "confidence": "high" | "medium" | "low"
}}

Rules:
- NEVER say an identity is "verified" — you have no external source to verify against. Only
  report what's asserted in the text and whether it's internally consistent.
- Only flag IDENTITY_INCONSISTENCY_FOUND with genuine textual evidence of a specific conflict —
  never speculate, and never fabricate a quote. Minor spelling/OCR variants of the same name are
  NOT a conflict. A dependent claiming on a policyholder's policy is NOT a conflict by itself.
- Every quote must be a single contiguous run of characters exactly as they appear on the page —
  never elide, truncate, or skip words with "..." or similar.
- Use INSUFFICIENT_EVIDENCE if the source pages don't identify the claimant clearly enough to assess.

SOURCE PAGES:
{content}
"""


def _run_identity_agent(pdf_blocks, classification, claim_context: dict) -> Dict[str, Any]:
    content = _pages_for_doc_types(pdf_blocks, classification, IDENTITY_RELEVANT_TYPES)
    if not content.strip():
        return {
            "status": "ok",
            "result": {
                "status": "INSUFFICIENT_EVIDENCE",
                "claimant_name": None,
                "id_number_asserted": None,
                "inconsistencies": [],
                "explanation": "No identity-relevant documents were classified for this case.",
                "confidence": "low",
            },
            "error": None,
        }

    prompt = _IDENTITY_PROMPT.format(
        claim_context=json.dumps(claim_context, default=str),
        content=content,
    )
    raw = _groq_call(
        "You are a careful, evidence-only insurance identity investigator. Output only JSON.",
        prompt,
        max_tokens=6000,
    )
    parsed = _parse_llm_json(raw or "")
    if not parsed:
        return {"status": "error", "result": None, "error": "Identity agent: could not parse LLM output"}

    for inc in (parsed.get("inconsistencies") or []):
        clean_quotes = []
        for q in (inc.get("quotes") or []):
            if not isinstance(q, dict):
                continue
            ok = _verify_quote_on_page(
                pdf_blocks, q.get("file_name"), q.get("page_number"), str(q.get("quote") or "")
            )
            q["verified"] = ok
            clean_quotes.append(q)
        inc["quotes"] = clean_quotes

    # Normalized cross-agent field — see claim_story agent.
    parsed["findings"] = parsed.get("inconsistencies") or []

    return {"status": "ok", "result": parsed, "error": None}


# ─────────────────────────────────────────────────────────────────────────
# Stage 2m — Policy / Coverage agent
# ─────────────────────────────────────────────────────────────────────────

# SCOPE NOTE: no access to the full master policy wording/exclusion
# engine — only claim_context.policyDetails (whatever's already been
# extracted onto the claim) and whatever the claim's own Policy/Proposal
# Form pages state. This agent checks date-of-event-vs-policy-period
# consistency and any exclusion/condition text explicitly present in the
# claim's own documents; it does NOT adjudicate coverage against a full
# policy wordings database, and is instructed to say so plainly.
POLICY_COVERAGE_RELEVANT_TYPES = {
    "Policy / Proposal Form",
    "Claim Trigger Email / Claim Form",
    "Discharge Summary",
}

_POLICY_COVERAGE_PROMPT = """You are an insurance investigator's policy/coverage specialist. \
Using ONLY the source pages below plus the claim context (OCR'd text and structured claim data \
only — you have NO access to the full master policy wording or exclusion clause database, so \
NEVER claim coverage is definitively "approved" or "denied"; you can only report what the \
documents/claim data assert and flag anything that looks inconsistent with the policy period or \
any exclusion/condition text actually present in the source pages), check whether the reported \
event appears consistent with the policy.

Specifically check:
- Does the admission/event date (from the source pages or claim context) fall within the policy \
  period (inception to expiry), as stated in claim context or the source pages?
- Does any explicit exclusion, waiting-period, or condition clause appear in the source pages \
  (e.g. a stated waiting period for a specific treatment/condition), and if so, does the current \
  claim appear to conflict with it based on the dates/diagnosis available to you?
- Is the policy status (active/lapsed/expired), if stated anywhere in the source pages or claim \
  context, consistent with a valid claim being made?

CLAIM CONTEXT (policy dates, diagnosis, admission date, if already extracted elsewhere):
{claim_context}

Return ONLY a single JSON object, no prose, no markdown fences:
{{
  "status": "WITHIN_POLICY_PERIOD_NO_CONCERNS" | "COVERAGE_CONCERN_FOUND" | "INSUFFICIENT_EVIDENCE",
  "policy_inception_date": "<YYYY-MM-DD or null>",
  "policy_expiry_date": "<YYYY-MM-DD or null>",
  "event_date": "<YYYY-MM-DD or null, the admission/event date being checked>",
  "concerns": [
    {{
      "type": "EVENT_OUTSIDE_POLICY_PERIOD" | "WAITING_PERIOD_CONFLICT" | "EXCLUSION_CLAUSE_MATCH" | "POLICY_STATUS_CONCERN" | "OTHER",
      "explanation": "<1-2 sentences>",
      "quotes": [
        {{"file_name": "<exact file_name from a source page above>", "page_number": <int or null>, "quote": "<verbatim, under 20 words, copied exactly from that page>"}}
      ]
    }}
  ],
  "explanation": "<2-4 sentences, reviewer-facing, plain language — explicitly note this reflects only the policy dates/clauses available in this claim's own documents and data, not a full policy-wording adjudication>",
  "confidence": "high" | "medium" | "low"
}}

Rules:
- NEVER say coverage is "approved" or "denied" — you have no full policy wording engine to
  adjudicate against. Only flag concerns for a human reviewer to weigh.
- Only flag a concern with genuine evidence from claim context or a verbatim quote from the
  source pages above — never speculate, and never fabricate a quote.
- Every quote must be a single contiguous run of characters exactly as they appear on the page —
  never elide, truncate, or skip words with "..." or similar.
- Use INSUFFICIENT_EVIDENCE if policy dates and event date are not available in claim context or
  the source pages to make any assessment.

SOURCE PAGES:
{content}
"""


def _run_policy_coverage_agent(pdf_blocks, classification, claim_context: dict) -> Dict[str, Any]:
    content = _pages_for_doc_types(pdf_blocks, classification, POLICY_COVERAGE_RELEVANT_TYPES)
    policy_details = claim_context.get("policyDetails") or {}
    if not content.strip() and not policy_details:
        return {
            "status": "ok",
            "result": {
                "status": "INSUFFICIENT_EVIDENCE",
                "policy_inception_date": None,
                "policy_expiry_date": None,
                "event_date": None,
                "concerns": [],
                "explanation": "No policy-relevant documents or claim context were available for this case.",
                "confidence": "low",
            },
            "error": None,
        }

    prompt = _POLICY_COVERAGE_PROMPT.format(
        claim_context=json.dumps(claim_context, default=str),
        content=content,
    )
    raw = _groq_call(
        "You are a careful, evidence-only insurance policy/coverage investigator. Output only JSON.",
        prompt,
        max_tokens=6000,
    )
    parsed = _parse_llm_json(raw or "")
    if not parsed:
        return {"status": "error", "result": None, "error": "Policy/coverage agent: could not parse LLM output"}

    for concern in (parsed.get("concerns") or []):
        clean_quotes = []
        for q in (concern.get("quotes") or []):
            if not isinstance(q, dict):
                continue
            ok = _verify_quote_on_page(
                pdf_blocks, q.get("file_name"), q.get("page_number"), str(q.get("quote") or "")
            )
            q["verified"] = ok
            clean_quotes.append(q)
        concern["quotes"] = clean_quotes

    # Normalized cross-agent field — see claim_story agent.
    parsed["findings"] = parsed.get("concerns") or []

    return {"status": "ok", "result": parsed, "error": None}


# ─────────────────────────────────────────────────────────────────────────
# Stage 2n — Timeline agent
# ─────────────────────────────────────────────────────────────────────────

# SCOPE NOTE: source doc Section 7 ("Claim Story Reconstruction") and
# Section 9 ("Cross-Document Contradiction Engine") describe a full
# knowledge-graph-backed timeline with distinguished fact/statement/
# inference/contradiction event types. This agent is a scoped-down,
# single-pass version of that: it reads across ALL classified document
# types (dates relevant to the claim story can appear anywhere, same
# reasoning as Hospital Record Integrity) and reports date/event
# contradictions between independent sources, without building a
# persistent graph or a full event-by-event reconstruction.
TIMELINE_RELEVANT_TYPES = {t for t in DOC_TYPE_TAXONOMY if t != "Other"}

_TIMELINE_PROMPT = """You are an insurance investigator's timeline-consistency specialist. \
Using ONLY the source pages below, compare the dates and event sequence stated across \
INDEPENDENT sources — the patient's own statement/narration, the claim form, the field \
investigation form (SDF), and the hospital's own records (FCP, discharge summary, admission \
records) — and identify any material contradictions in what happened when.

Specifically check:
- Does the date symptoms/illness reportedly began stay consistent between the patient's own \
  statement (SDF/claim form) and what the hospital records document?
- Does the first-consultation date, if stated in more than one place, match?
- Does the admission date match across the discharge summary, claim form, and any other document \
  that states it?
- Does the discharge date match across the discharge summary, bill, and any other document that \
  states it?
- Is the overall sequence of events (symptom onset → first consultation → admission → treatment \
  → discharge → claim) chronologically possible, or does any document imply an impossible order \
  (e.g. a claim form event date after the discharge date it's meant to precede)?

This is a DATE/SEQUENCE consistency check only — do not assess clinical genuineness or medical \
necessity, those are separate agents' jobs.

CLAIM CONTEXT (any dates already extracted elsewhere, if known):
{claim_context}

Return ONLY a single JSON object, no prose, no markdown fences:
{{
  "status": "TIMELINE_CONSISTENT" | "TIMELINE_CONTRADICTION_FOUND" | "INSUFFICIENT_EVIDENCE",
  "reconstructed_sequence": "<1-3 sentences summarizing the claim story's event order as best determined from the source pages>",
  "contradictions": [
    {{
      "type": "SYMPTOM_ONSET_DATE_CONFLICT" | "FIRST_CONSULTATION_DATE_CONFLICT" | "ADMISSION_DATE_CONFLICT" | "DISCHARGE_DATE_CONFLICT" | "IMPOSSIBLE_SEQUENCE" | "OTHER",
      "explanation": "<1-2 sentences, naming the two conflicting sources and dates>",
      "quotes": [
        {{"file_name": "<exact file_name from a source page above>", "page_number": <int or null>, "quote": "<verbatim, under 20 words, copied exactly from that page>"}}
      ]
    }}
  ],
  "explanation": "<2-4 sentences, reviewer-facing, plain language, overall verdict rationale>",
  "confidence": "high" | "medium" | "low"
}}

Rules:
- Only flag a contradiction between dates/events stated in at least two genuinely INDEPENDENT
  sources — a single document restating its own date twice is not a contradiction.
- Only flag with genuine textual evidence — never speculate, and never fabricate a quote.
- Every quote must be a single contiguous run of characters exactly as they appear on the page —
  never elide, truncate, or skip words with "..." or similar.
- A gap in information (a date simply not mentioned anywhere) is NOT a contradiction — use
  INSUFFICIENT_EVIDENCE or note it in reconstructed_sequence instead of forcing a conflict.
- Use TIMELINE_CONSISTENT if the dates that ARE stated across sources agree, even if the record
  is incomplete overall.

SOURCE PAGES:
{content}
"""
_TIMELINE_STATUS_PRIORITY = ["TIMELINE_CONTRADICTION_FOUND", "TIMELINE_CONSISTENT", "INSUFFICIENT_EVIDENCE"]


def _run_timeline_agent(pdf_blocks, classification, claim_context: dict) -> Dict[str, Any]:
    pages = _filtered_pages_for_doc_types(pdf_blocks, classification, TIMELINE_RELEVANT_TYPES)
    if not pages:
        return {
            "status": "ok",
            "result": {
                "status": "INSUFFICIENT_EVIDENCE",
                "reconstructed_sequence": None,
                "contradictions": [],
                "explanation": "No classified documents were available for this case.",
                "confidence": "low",
            },
            "error": None,
        }

    build_prompt = lambda content: _TIMELINE_PROMPT.format(
        claim_context=json.dumps(claim_context, default=str), content=content
    )
    chunk_results = _run_agent_over_pages(
        pages, AGENT_TEXT_BUDGET_CHARS, build_prompt,
        "You are a careful, evidence-only insurance timeline-consistency investigator. Output only JSON.",
        6000,
    )
    if not chunk_results:
        return {"status": "error", "result": None, "error": "Timeline agent: could not parse LLM output"}

    parsed = (
        chunk_results[0] if len(chunk_results) == 1
        else _merge_agent_chunk_results(chunk_results, _TIMELINE_STATUS_PRIORITY, ["contradictions"])
    )

    for con in (parsed.get("contradictions") or []):
        clean_quotes = []
        for q in (con.get("quotes") or []):
            if not isinstance(q, dict):
                continue
            ok = _verify_quote_on_page(
                pdf_blocks, q.get("file_name"), q.get("page_number"), str(q.get("quote") or "")
            )
            q["verified"] = ok
            clean_quotes.append(q)
        con["quotes"] = clean_quotes

    # Normalized cross-agent field — see claim_story agent.
    parsed["findings"] = parsed.get("contradictions") or []

    return {"status": "ok", "result": parsed, "error": None}
# ─────────────────────────────────────────────────────────────────────────
# Stage 2n2 — Geo-Visit Verification agent (source doc Section 20)
# ─────────────────────────────────────────────────────────────────────────

# STATED ASSUMPTION: only a genuine location mismatch (GPS coordinates
# text pointing somewhere inconsistent with the claimed hospital's city/
# address) is treated as a flagged concern. The gap between the visit's
# GPS timestamp and the hospitalization dates is reported as INFORMATION
# ONLY (visitDateGapNote) and does NOT drive status/risk — there's no
# confirmed rule for what timing gap is normal for a field investigator's
# visit, so this agent does not judge that, only reports it for a human
# reviewer to weigh.
GEO_VISIT_RELEVANT_TYPES = {
    "Geo-Tagged Field Visit Photo",
    "Field Investigation Form (SDF)",
    "Discharge Summary",
}

_GEO_VISIT_PROMPT = """You are an insurance investigator's geo-visit verification specialist. \
Using ONLY the source pages below (OCR'd text only, including any GPS coordinates/location text \
and timestamps burned into geo-tagged photo captions), check whether field-visit location \
evidence is consistent with the claimed hospital's location, and report any dates found.

Specifically check:
- Does the location text (city/area name) on any geo-tagged photo page match the hospital's \
  claimed city/address (given in claim context or the hospital-identifying source pages)?
- What GPS timestamp(s) appear on the geo-tagged photo pages, and what hospitalization dates \
  (admission/discharge) are available in claim context — report both, do NOT judge whether the \
  gap between them is normal or suspicious, that is left to the human reviewer.

CLAIM CONTEXT (known hospital name/city/address, admission/discharge dates, if known):
{claim_context}

Return ONLY a single JSON object, no prose, no markdown fences:
{{
  "status": "LOCATION_CONSISTENT" | "LOCATION_MISMATCH" | "INSUFFICIENT_EVIDENCE",
  "geo_locations_found": [
    {{"file_name": "<exact file_name>", "page_number": <int or null>, "location_text": "<location text as it appears>", "timestamp": "<timestamp text as it appears, or null>"}}
  ],
  "visitDateGapNote": "<1-2 sentences plainly stating the GPS timestamp(s) found vs. the known admission/discharge dates, with NO judgement on whether the gap is normal or suspicious — purely descriptive, or null if no comparison is possible>",
  "inconsistencies": [
    {{
      "type": "LOCATION_MISMATCH",
      "explanation": "<1-2 sentences>",
      "quotes": [
        {{"file_name": "<exact file_name from a source page above>", "page_number": <int or null>, "quote": "<verbatim, under 20 words, copied exactly from that page>"}}
      ]
    }}
  ],
  "explanation": "<2-4 sentences, reviewer-facing, plain language, overall verdict rationale>",
  "confidence": "high" | "medium" | "low"
}}

Rules:
- Only flag LOCATION_MISMATCH with genuine textual evidence that the geo-tagged location text
  conflicts with the claimed hospital's city/address — never speculate, and never fabricate a quote.
- Never characterize a date gap as suspicious, unusual, or a concern — visitDateGapNote is
  descriptive only.
- Use INSUFFICIENT_EVIDENCE if no geo-tagged location text is present in the source pages.

SOURCE PAGES:
{content}
"""


def _run_geo_visit_agent(pdf_blocks, classification, claim_context: dict) -> Dict[str, Any]:
    content = _pages_for_doc_types(pdf_blocks, classification, GEO_VISIT_RELEVANT_TYPES)
    if not content.strip():
        return {
            "status": "ok",
            "result": {
                "status": "INSUFFICIENT_EVIDENCE",
                "geo_locations_found": [],
                "visitDateGapNote": None,
                "inconsistencies": [],
                "explanation": "No geo-tagged field-visit documents were classified for this case.",
                "confidence": "low",
                "findings": [],
            },
            "error": None,
        }

    prompt = _GEO_VISIT_PROMPT.format(
        claim_context=json.dumps(claim_context, default=str),
        content=content,
    )
    raw = _groq_call(
        "You are a careful, evidence-only insurance geo-visit investigator. Output only JSON.",
        prompt,
        max_tokens=4000,
    )
    parsed = _parse_llm_json(raw or "")
    if not parsed:
        return {"status": "error", "result": None, "error": "Geo-visit agent: could not parse LLM output"}

    for inc in (parsed.get("inconsistencies") or []):
        clean_quotes = []
        for q in (inc.get("quotes") or []):
            if not isinstance(q, dict):
                continue
            ok = _verify_quote_on_page(
                pdf_blocks, q.get("file_name"), q.get("page_number"), str(q.get("quote") or "")
            )
            q["verified"] = ok
            clean_quotes.append(q)
        inc["quotes"] = clean_quotes

    # Normalized cross-agent field — see claim_story agent.
    parsed["findings"] = parsed.get("inconsistencies") or []

    return {"status": "ok", "result": parsed, "error": None}


# ─────────────────────────────────────────────────────────────────────────
# Stage 2o — Claim Story agent (source doc Section 7)
# ─────────────────────────────────────────────────────────────────────────

# SCOPE NOTE: this is the scoped-down version of §7's full fact/statement/
# inferred/unresolved-contradiction tagging — see module usage: rather than
# have this agent independently re-derive contradictions (risking
# disagreement with the 14 specialist agents), it produces ONLY the
# chronological event narrative via LLM, and every flagged finding from the
# other agents is attached afterward, deterministically, by matching each
# event's cited (file_name, page_number) against every agent's own already-
# verified findings. This agent never re-judges what's a contradiction —
# it only tells the story and lets existing findings surface at the point
# in the story where they occurred.
CLAIM_STORY_RELEVANT_TYPES = TIMELINE_RELEVANT_TYPES

_CLAIM_STORY_PROMPT = """You are an insurance investigator's claim-story specialist. Using ONLY \
the source pages below, reconstruct the claim as a single chronological narrative — the sequence \
of events from first symptoms through to claim submission — so a reviewer can read the whole case \
top to bottom in one pass instead of piecing it together from separate documents.

Build an ORDERED list of events, each with a single best-supporting source citation. If the \
record genuinely contains two conflicting versions of the same kind of event (e.g. two different \
admission dates from two different documents), output them as TWO SEPARATE events in date order — \
do not silently merge or pick one as correct; a human reviewer resolves that, not you.

Event types to use (pick the closest one for each event; use "other_dated_event" for anything \
date-relevant that doesn't fit the others, e.g. a field-visit date, a signed-form date):
- symptom_onset
- first_consultation
- investigation
- diagnosis
- admission
- treatment_procedure
- discharge
- claim_submission
- other_dated_event

CLAIM CONTEXT (already-extracted claim data, if known):
{claim_context}

Return ONLY a single JSON object, no prose, no markdown fences:
{{
  "status": "ok" | "INSUFFICIENT_EVIDENCE",
  "timeline": [
    {{
      "event_type": "<one value from the list above>",
      "date": "<YYYY-MM-DD or null>",
      "description": "<1-2 sentences, plain language, reviewer-facing>",
      "source": {{"file_name": "<exact file_name from a source page above>", "page_number": <int or null>, "quote": "<verbatim, under 20 words, copied exactly from that page>"}}
    }}
  ],
  "narrative_summary": "<4-6 sentences, plain language, the whole claim story reviewer-facing>",
  "confidence": "high" | "medium" | "low"
}}

Rules:
- Do NOT include contradictions, flags, or "inconsistencies" fields — that is deliberately handled
  by a separate process. Just tell the story as the documents state it, including two entries
  where the record genuinely conflicts, as instructed above.
- Never fabricate a quote — every event's source quote must be copied exactly from the source
  pages below.
- Every quote must be a single contiguous run of characters exactly as they appear on the page —
  never elide, truncate, or skip words with "..." or similar.
- Order events by date where known; where a date is unknown, place the event in its logical
  narrative position.
- Use INSUFFICIENT_EVIDENCE only if the source pages contain no dateable clinical/claim events at
  all.

SOURCE PAGES:
{content}
"""

_CLAIM_STORY_STATUS_PRIORITY = ["ok", "INSUFFICIENT_EVIDENCE"]


def _run_claim_story_agent(pdf_blocks, classification, claim_context: dict) -> Dict[str, Any]:
    pages = _filtered_pages_for_doc_types(pdf_blocks, classification, CLAIM_STORY_RELEVANT_TYPES)
    if not pages:
        return {
            "status": "ok",
            "result": {
                "status": "INSUFFICIENT_EVIDENCE",
                "timeline": [],
                "narrative_summary": "No classified documents were available for this case.",
                "confidence": "low",
            },
            "error": None,
        }

    build_prompt = lambda content: _CLAIM_STORY_PROMPT.format(
        claim_context=json.dumps(claim_context, default=str), content=content
    )
    chunk_results = _run_agent_over_pages(
        pages, AGENT_TEXT_BUDGET_CHARS, build_prompt,
        "You are a careful, evidence-only insurance claim-story investigator. Output only JSON.",
        8000,
    )
    if not chunk_results:
        return {"status": "error", "result": None, "error": "Claim story agent: could not parse LLM output"}

    if len(chunk_results) == 1:
        parsed = chunk_results[0]
    else:
        parsed = _merge_agent_chunk_results(chunk_results, _CLAIM_STORY_STATUS_PRIORITY, ["timeline"])
        narratives = [p.get("narrative_summary") for p in chunk_results if p.get("narrative_summary")]
        parsed["narrative_summary"] = " ".join(narratives)
        # Re-sort merged timeline chronologically since chunk order was
        # page-count-based, not date-based, before chunks were combined.
        parsed["timeline"] = sorted(
            parsed.get("timeline") or [], key=lambda e: (e.get("date") or "9999-99-99")
        )

    for event in (parsed.get("timeline") or []):
        source = event.get("source")
        if not isinstance(source, dict):
            event["source"] = {"file_name": None, "page_number": None, "quote": None, "verified": False}
            continue
        ok = _verify_quote_on_page(
            pdf_blocks, source.get("file_name"), source.get("page_number"), str(source.get("quote") or "")
        )
        source["verified"] = ok

    return {"status": "ok", "result": parsed, "error": None}


def _attach_findings_to_timeline(timeline: List[Dict[str, Any]], agent_results: Dict[str, Dict[str, Any]]) -> None:
    """Deterministically attaches each agent's already-verified findings to
    any claim_story timeline event that cites the same (file_name,
    page_number) — a pointer to existing analysis, never a new finding.
    Mutates timeline in place. No LLM call, no re-judgement — this is what
    keeps the claim story from becoming a second, possibly disagreeing,
    source of truth alongside the 14 specialist agents."""
    for event in timeline:
        source = event.get("source") or {}
        event_key = (source.get("file_name"), source.get("page_number"))
        flags: List[Dict[str, Any]] = []
        if event_key[0] is not None:
            for agent_name, agent_result in agent_results.items():
                findings = (agent_result.get("result") or {}).get("findings") or []
                for finding in findings:
                    for q in (finding.get("quotes") or []):
                        if not isinstance(q, dict):
                            continue
                        if (q.get("file_name"), q.get("page_number")) == event_key:
                            flags.append({
                                "agent": agent_name,
                                "type": finding.get("type"),
                                "explanation": finding.get("explanation"),
                            })
                            break
        event["flags"] = flags


# ─────────────────────────────────────────────────────────────────────────
# Query Generation (source doc Section 28) — one small, isolated Groq call
# PER AGENT that has a flagged concern or reported INSUFFICIENT_EVIDENCE,
# run in parallel with each other. Each call is fed only that one agent's
# own already-computed result (small JSON, not raw page text), so this
# adds no context-window pressure. Deliberately NOT one big call across
# all agents — keeps each query grounded in a single agent's own evidence
# and avoids the reasoning load of juggling many agents' findings at once.
# No dedup pass across agents — see module usage notes if adding one later.
# ─────────────────────────────────────────────────────────────────────────

_QUERY_GENERATION_PROMPT = """You are an insurance TPA investigator drafting queries to send to \
the hospital/claimant/insurer, based on ONE specialist agent's verdict for this claim. Queries \
must be specific, evidence-based, and non-accusatory (per source doc Section 28) — they ask for \
clarification, confirmation, or missing documents. They must NEVER accuse anyone of fraud or \
wrongdoing.

AGENT: {agent_name}

Generate exactly ONE query for EACH item listed below, in the same order:
{items_description}

Return ONLY a single JSON object, no prose, no markdown fences:
{{
  "queries": [
    {{"relatedFindingType": "<the type/status value this query is about, copied from the item>", "query": "<one specific, evidence-based, non-accusatory query message>"}}
  ]
}}

Rules:
- Write exactly one query per item listed above, in the same order — do not merge items, do not
  skip any.
- Ground each query only in the fact(s)/quote(s) given in that item — never invent a fact not
  present in it.
- Style example: "The discharge summary notes X while the field investigation form states Y.
  Please confirm/clarify/provide ..." — always end with a specific, answerable ask.
- If the item is a missing-evidence gap (type INSUFFICIENT_EVIDENCE) rather than a flagged
  concern, phrase the query as a request to provide the missing document/detail, not a challenge.
"""


def _run_query_generation_for_agent(agent_name: str, agent_result: Dict[str, Any]) -> List[Dict[str, Any]]:
    if not agent_result or agent_result.get("status") != "ok":
        return []
    result = agent_result.get("result") or {}
    status = result.get("status")
    concern_statuses = _AGENT_CONCERN_STATUSES.get(agent_name, set())
    findings = result.get("findings") or []
    is_flagged = status in concern_statuses
    is_insufficient = status == "INSUFFICIENT_EVIDENCE"

    if findings:
        items_description = "\n".join(
            f"{i+1}. type={f.get('type')}: {f.get('explanation')} "
            f"(supporting quotes: {json.dumps(f.get('quotes') or [], default=str)})"
            for i, f in enumerate(findings)
        )
    elif is_insufficient:
        items_description = f"1. type=INSUFFICIENT_EVIDENCE: {result.get('explanation')}"
    elif is_flagged:
        # Flagged status but no findings array populated (shouldn't normally
        # happen given how each agent builds "findings", but fail-soft here
        # rather than silently producing zero queries for a real concern).
        items_description = f"1. type={status}: {result.get('explanation')}"
    else:
        return []

    prompt = _QUERY_GENERATION_PROMPT.format(agent_name=agent_name, items_description=items_description)
    raw = _groq_call(
        "You are a careful, evidence-only insurance investigator drafting queries. Output only JSON.",
        prompt,
        max_tokens=2000,
    )
    parsed = _parse_llm_json(raw or "")
    if not parsed:
        return []

    queries = []
    for q in (parsed.get("queries") or []):
        if not isinstance(q, dict):
            continue
        queries.append({
            "relatedAgent": agent_name,
            "relatedFindingType": q.get("relatedFindingType"),
            "query": q.get("query"),
        })
    return queries


# ─────────────────────────────────────────────────────────────────────────
# Risk & Exception summary (source doc Section 24) — deterministic
# aggregation over the 13 agents' own verdicts, NOT a separate LLM call.
# No opaque single fraud score: each agent's own status is surfaced as an
# independent flag, per the source doc's explicit instruction not to
# collapse findings into one score. This intentionally does NOT attempt
# the doc's named 9-dimension mapping (Identity Integrity, Clinical
# Genuineness, etc.) one-to-one — several agents here don't map cleanly
# onto a single named dimension (e.g. PED and Accident/RTA are their own
# findings, not sub-parts of one of the 9) — so this reports per-agent
# flags instead of forcing an imperfect dimension mapping. A true
# dimension-level rollup (and the source doc's TAT/regulatory dimensions,
# which this pipeline has no data for) is left for a future pass.
# ─────────────────────────────────────────────────────────────────────────

# Per-agent verdict values that represent something worth a reviewer's
# attention. Anything else (SUPPORTED, GENUINE, NO_CONCERNS, etc.) is
# treated as clean. "error" status is intentionally excluded here — a
# failed agent is a data-quality gap, not itself a risk finding, and is
# already surfaced separately via overall_status/overall_error above.
_AGENT_CONCERN_STATUSES = {
    "geo_visit": {"LOCATION_MISMATCH"},
    "ped": {"UNDISCLOSED_PED_SUSPECTED"},
    "billing": {"VARIANCE_FOUND"},
    "clinical_genuineness": {"INCONSISTENT_CLINICAL_PICTURE"},
    "hospital_record_integrity": {"INTEGRITY_ANOMALIES_FOUND"},
    "accident_rta": {"ACCIDENT_EVIDENCE_INCONSISTENT"},
    "death": {"DEATH_EVIDENCE_INCONSISTENT"},
    "medical_necessity": {"BORDERLINE", "NOT_SUPPORTED"},
    "hospital_verification": {"IDENTITY_INCONSISTENCY_FOUND"},
    "high_value_claim": {"CONCERNS_FOUND"},
    "employee_verification": {"EMPLOYMENT_INCONSISTENCY_FOUND"},
    "bill_verification": {"CONCERNS_FOUND"},
    "identity": {"IDENTITY_INCONSISTENCY_FOUND"},
    "policy_coverage": {"COVERAGE_CONCERN_FOUND"},
    "timeline": {"TIMELINE_CONTRADICTION_FOUND"},
}


def _compute_risk_summary(agent_results: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    flagged = []
    not_assessed = []

    for name, concern_statuses in _AGENT_CONCERN_STATUSES.items():
        agent = agent_results.get(name)
        if not agent:
            continue
        if agent["status"] == "error":
            not_assessed.append(name)
            continue
        result_status = (agent.get("result") or {}).get("status")
        if result_status in concern_statuses:
            flagged.append({
                "agent": name,
                "status": result_status,
                "confidence": (agent.get("result") or {}).get("confidence"),
            })

    concern_count = len(flagged)
    if concern_count == 0:
        overall_risk_level = "LOW"
    elif concern_count <= 2:
        overall_risk_level = "MEDIUM"
    else:
        overall_risk_level = "HIGH"

    return {
        "overallRiskLevel": overall_risk_level,
        "flaggedAgents": flagged,
        "agentsNotAssessed": not_assessed,
        "note": (
            "Deterministic rollup of each agent's own verdict — not an independent "
            "fraud score, and not a substitute for human investigator review, per "
            "source doc Section 25 (Human-in-the-Loop Decision Model)."
        ),
    }


# ─────────────────────────────────────────────────────────────────────────
# Recommended Action (source doc Section 25 — Human-in-the-Loop Decision
# Model). Deterministic, no LLM call. Maps the already-computed risk
# summary + which specific agents flagged onto ONE routing recommendation
# for a human reviewer — the AI recommends, it never silently decides.
#
# Priority order (highest first) when more than one condition applies to
# the same case — a document-integrity/authenticity signal is treated as
# its own investigation-worthy category distinct from general severity,
# per §25's explicit "potential fraud signal" bucket, and outranks a High
# overall risk level driven by other agents:
#   1. hospital_record_integrity flagged -> INVESTIGATION_WORKFLOW
#   2. clinical_genuineness or medical_necessity flagged -> MEDICAL_REVIEWER
#   3. policy_coverage flagged -> CLAIMS_LEGAL_COMPLIANCE_REVIEW
#   4. overallRiskLevel == HIGH -> SENIOR_INVESTIGATOR_REVIEW
#   5. overallRiskLevel == MEDIUM -> TPA_INVESTIGATOR_REVIEW
#   6. otherwise -> STRAIGHT_THROUGH
# ─────────────────────────────────────────────────────────────────────────

_RECOMMENDED_ACTION_LABELS = {
    "INVESTIGATION_WORKFLOW": "Investigation workflow (potential fraud/document-authenticity signal — do not label fraud solely from this AI output)",
    "MEDICAL_REVIEWER": "Medical reviewer (clinical ambiguity)",
    "CLAIMS_LEGAL_COMPLIANCE_REVIEW": "Claims/legal/compliance review (policy interpretation ambiguity)",
    "SENIOR_INVESTIGATOR_REVIEW": "Senior investigator/claims review (high-risk / material contradiction)",
    "TPA_INVESTIGATOR_REVIEW": "TPA investigator review (medium risk)",
    "STRAIGHT_THROUGH": "Investigator-ready / straight-through (low risk, fully supported)",
}


def _compute_recommended_action(risk_summary: Dict[str, Any], agent_results: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    flagged_names = {f["agent"] for f in (risk_summary.get("flaggedAgents") or [])}

    if "hospital_record_integrity" in flagged_names:
        action = "INVESTIGATION_WORKFLOW"
    elif "clinical_genuineness" in flagged_names or "medical_necessity" in flagged_names:
        action = "MEDICAL_REVIEWER"
    elif "policy_coverage" in flagged_names:
        action = "CLAIMS_LEGAL_COMPLIANCE_REVIEW"
    elif risk_summary.get("overallRiskLevel") == "HIGH":
        action = "SENIOR_INVESTIGATOR_REVIEW"
    elif risk_summary.get("overallRiskLevel") == "MEDIUM":
        action = "TPA_INVESTIGATOR_REVIEW"
    else:
        action = "STRAIGHT_THROUGH"

    return {
        "action": action,
        "label": _RECOMMENDED_ACTION_LABELS[action],
        "basedOn": sorted(flagged_names),
        "note": (
            "This is a routing recommendation for a human reviewer, not an automated "
            "adverse decision, per source doc Section 25 (Human-in-the-Loop Decision Model)."
        ),
    }


# ─────────────────────────────────────────────────────────────────────────
# Named Contradiction List (source doc Section 9). Deterministic, no LLM
# call — re-tags each agent's already-verified findings onto Section 9's
# five named categories. Category mapping below is a STATED ASSUMPTION,
# not confirmed against the source doc 1:1 (several agents don't map
# cleanly onto exactly one of the 5 named categories) — adjust the map if
# a different grouping is wanted.
# ─────────────────────────────────────────────────────────────────────────

_CONTRADICTION_CATEGORY_MAP = {
    "ped": "PED_CONTRADICTION",
    "timeline": "TIMELINE_DISCREPANCY",
    "billing": "SERVICE_DOCUMENT_MISMATCH",
    "bill_verification": "SERVICE_DOCUMENT_MISMATCH",
    "high_value_claim": "SERVICE_DOCUMENT_MISMATCH",
    "clinical_genuineness": "HISTORY_CONTRADICTION",
    "medical_necessity": "HISTORY_CONTRADICTION",
    "hospital_record_integrity": "HISTORY_CONTRADICTION",
    "hospital_verification": "HISTORY_CONTRADICTION",
    "accident_rta": "HISTORY_CONTRADICTION",
    "death": "HISTORY_CONTRADICTION",
    "identity": "HISTORY_CONTRADICTION",
    "policy_coverage": "HISTORY_CONTRADICTION",
    "employee_verification": "EMPLOYMENT_INCONSISTENCY",
}


def _compute_contradiction_list(agent_results: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    contradictions = []
    for agent_name, category in _CONTRADICTION_CATEGORY_MAP.items():
        agent_result = agent_results.get(agent_name)
        if not agent_result or agent_result.get("status") != "ok":
            continue
        findings = (agent_result.get("result") or {}).get("findings") or []
        for finding in findings:
            contradictions.append({
                "category": category,
                "sourceAgent": agent_name,
                "type": finding.get("type"),
                "explanation": finding.get("explanation"),
                "quotes": finding.get("quotes") or [],
            })
    return {
        "contradictions": contradictions,
        "note": (
            "Deterministic list built from each agent's own already-verified findings, "
            "re-tagged onto source doc Section 9's five contradiction categories — not a "
            "new analysis. Category mapping is a stated assumption."
        ),
    }


# ─────────────────────────────────────────────────────────────────────────
# Orchestrator
# ─────────────────────────────────────────────────────────────────────────

async def run_agentic_investigation(insurance_claims_col, case_id: str) -> Dict[str, Any]:
    """Runs classification + all 13 specialist agents for one case and
    persists the result onto insurance_claims_new.agenticInvestigation.
    Returns the persisted dict.

    `insurance_claims_col` must be an already-connected Motor collection
    (or the loop-safe proxy this codebase already uses elsewhere) — this
    function never opens its own DB connection, matching how every other
    piece of business logic in this codebase is structured."""
    claim = await insurance_claims_col.find_one(
        {"caseId": case_id},
        {
            "_id": 0, "raw_llama_markdown": 1, "claimedAmount": 1,
            "policyDetails": 1, "riskDetails": 1, "claimTriggers": 1,
            "billingDetails.finalBillAmount": 1, "billingDetails.grossAmount": 1,
            "criticalDetails.diagnosis": 1, "deathDetails": 1,
        },
    )
    now = datetime.now(IST)

    if not claim or not (claim.get("raw_llama_markdown") or "").strip():
        result = {
            "status": "ok", "error": None, "updatedAt": now,
            "documentClassification": [], "agents": {},
        }
        await insurance_claims_col.update_one(
            {"caseId": case_id}, {"$set": {"agenticInvestigation": result}}
        )
        logger.info("Agentic investigation: no parsed documents yet for case %s", case_id)
        return result

    try:
        pdf_blocks = _extract_pdf_blocks(claim["raw_llama_markdown"])
        loop = asyncio.get_event_loop()

        classification = await loop.run_in_executor(None, classify_documents, pdf_blocks)

        claim_context = {
            "claimedAmount": claim.get("claimedAmount"),
            "policyDetails": claim.get("policyDetails"),
            "riskDetails": claim.get("riskDetails"),
            "claimTriggers": claim.get("claimTriggers"),
            "billingDetails": claim.get("billingDetails"),
            "diagnosis": (claim.get("criticalDetails") or {}).get("diagnosis"),
            "deathDetails": claim.get("deathDetails"),
        }
        ped_result = await loop.run_in_executor(
            None, _run_ped_agent, pdf_blocks, classification, claim_context
        )
        billing_result = await loop.run_in_executor(
            None, _run_billing_agent, pdf_blocks, classification, claim_context
        )
        clinical_genuineness_result = await loop.run_in_executor(
            None, _run_clinical_genuineness_agent, pdf_blocks, classification, claim_context
        )
        hospital_record_integrity_result = await loop.run_in_executor(
            None, _run_hospital_record_integrity_agent, pdf_blocks, classification, claim_context
        )
        accident_rta_result = await loop.run_in_executor(
            None, _run_accident_rta_agent, pdf_blocks, classification, claim_context
        )
        death_result = await loop.run_in_executor(
            None, _run_death_agent, pdf_blocks, classification, claim_context
        )
        medical_necessity_result = await loop.run_in_executor(
            None, _run_medical_necessity_agent, pdf_blocks, classification, claim_context
        )
        hospital_verification_result = await loop.run_in_executor(
            None, _run_hospital_verification_agent, pdf_blocks, classification, claim_context
        )
        high_value_claim_result = await loop.run_in_executor(
            None, _run_high_value_claim_agent, pdf_blocks, classification, claim_context
        )
        employee_verification_result = await loop.run_in_executor(
            None, _run_employee_verification_agent, pdf_blocks, classification, claim_context
        )
        bill_verification_result = await loop.run_in_executor(
            None, _run_bill_verification_agent, pdf_blocks, classification, claim_context
        )
        identity_result = await loop.run_in_executor(
            None, _run_identity_agent, pdf_blocks, classification, claim_context
        )
        policy_coverage_result = await loop.run_in_executor(
            None, _run_policy_coverage_agent, pdf_blocks, classification, claim_context
        )
        timeline_result = await loop.run_in_executor(
            None, _run_timeline_agent, pdf_blocks, classification, claim_context
        )
        geo_visit_result = await loop.run_in_executor(
            None, _run_geo_visit_agent, pdf_blocks, classification, claim_context
        )

        agent_results = {
            "ped": ped_result,
            "billing": billing_result,
            "clinical_genuineness": clinical_genuineness_result,
            "hospital_record_integrity": hospital_record_integrity_result,
            "accident_rta": accident_rta_result,
            "death": death_result,
            "medical_necessity": medical_necessity_result,
            "hospital_verification": hospital_verification_result,
            "high_value_claim": high_value_claim_result,
            "employee_verification": employee_verification_result,
            "bill_verification": bill_verification_result,
            "identity": identity_result,
            "policy_coverage": policy_coverage_result,
            "timeline": timeline_result,
            "geo_visit": geo_visit_result,
        }

        # Claim Story agent runs last, separately from the other 14 — it
        # needs their already-verified findings to attach onto its
        # timeline (source doc Section 7), so it cannot run concurrently
        # with them the way they run with each other.
        claim_story_result = await loop.run_in_executor(
            None, _run_claim_story_agent, pdf_blocks, classification, claim_context
        )
        if claim_story_result["status"] == "ok":
            _attach_findings_to_timeline(
                claim_story_result["result"].get("timeline") or [], agent_results
            )
        agent_results["claim_story"] = claim_story_result

        # Query generation (source doc Section 28) — one small call PER
        # agent that has something to query about, run in parallel. Uses
        # the 14 specialist agents' already-computed results only
        # (claim_story is excluded — it has no findings/concern-status of
        # its own to generate queries from).
        query_gen_tasks = [
            loop.run_in_executor(None, _run_query_generation_for_agent, name, agent_results.get(name))
            for name in _AGENT_CONCERN_STATUSES.keys()
            if agent_results.get(name)
        ]
        query_gen_lists = await asyncio.gather(*query_gen_tasks) if query_gen_tasks else []
        all_queries = [q for sublist in query_gen_lists for q in sublist]
        generated_queries = {
            "status": "ok",
            "queries": all_queries,
            "note": (
                "Draft queries for investigator review before sending — evidence-based and "
                "non-accusatory per source doc Section 28, not a final communication."
            ),
        }

        overall_status = "ok"
        overall_error = None
        failed = {name: r for name, r in agent_results.items() if r["status"] == "error"}
        if failed and len(failed) == len(agent_results):
            # Every specialist agent genuinely failed to produce anything —
            # surface it distinctly from "ran cleanly, nothing to report",
            # same discipline as the existing findings pipeline's
            # documentFindingsStatus field. Written as a loop (not a fixed
            # N-way `and`) so adding future agents doesn't require touching
            # this check again.
            overall_status = "error"
            overall_error = " | ".join(f"{name}: {r['error']}" for name, r in failed.items())

        risk_summary = _compute_risk_summary(agent_results)
        recommended_action = _compute_recommended_action(risk_summary, agent_results)
        contradiction_list = _compute_contradiction_list(agent_results)

        result = {
            "status": overall_status,
            "error": overall_error,
            "updatedAt": now,
            "documentClassification": classification,
            "agents": agent_results,
            "riskSummary": risk_summary,
            "recommendedAction": recommended_action,
            "generatedQueries": generated_queries,
            "contradictionList": contradiction_list,
        }

    except Exception as e:
        logger.error("Agentic investigation failed for case %s: %s", case_id, e)
        result = {
            "status": "error", "error": str(e), "updatedAt": now,
            "documentClassification": [], "agents": {},
        }

    await insurance_claims_col.update_one(
        {"caseId": case_id}, {"$set": {"agenticInvestigation": result}}
    )
    logger.info(
        "Agentic investigation persisted for case %s | status=%s",
        case_id, result["status"],
    )
    return result