from __future__ import annotations
import asyncio
import json
import logging
import os
import uuid
import io
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import httpx
import re
import time
from services.groq_rate_limiter import reserve_tokens, estimate_tokens
from dotenv import load_dotenv
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from groq import Groq
from motor.motor_asyncio import AsyncIOMotorClient
from jose import jwt
import requests
import base64
from celery_client import celery_client

# Page count is still needed (display-only "N pages" marker + credit
# estimate). Page-subset extraction is NOT used anywhere in this file —
# both upload endpoints always process the whole document.
try:
    from pypdf import PdfReader
except ImportError:  # pragma: no cover - fallback for older envs
    from PyPDF2 import PdfReader

load_dotenv()
logger = logging.getLogger(__name__)
from datetime import datetime, timezone, timedelta
IST = timezone(timedelta(hours=5, minutes=30))
# ── env ──────────────────────────────────────────────────────────────────────
MONGO_URI        = os.getenv("MONGO_URI")
GROQ_API_KEY     = os.getenv("GROQ_API_KEY")
SECRET_KEY       = os.getenv("SECRET_KEY")
ALGORITHM        = os.getenv("ALGORITHM", "HS256")
LLAMA_API_KEY = os.getenv("LLAMA_API_KEY")
LLAMA_CREDIT_BUDGET = int(os.getenv("LLAMA_CREDIT_BUDGET", "45000"))
CREDITS_PER_PAGE = int(os.getenv("LLAMA_CREDITS_PER_PAGE", "3"))  # 1 for cost_effective, 3 for cost_effective w/ tables, 10 for agentic
LLAMA_PARSE_TIER = os.getenv("LLAMA_PARSE_TIER", "cost_effective")  # "cost_effective" or "agentic"

PROXY_UPLOAD_URL = os.getenv(
    "PROXY_UPLOAD_URL",
    "http://common:8000/storage/proxy/upload",
)
STORAGE_BASE_URL = os.getenv("STORAGE_BASE_URL", "https://doctorassist.ai/uploads")
PROCESSING_LOCK_STALE_SECONDS = 300  # 5 min — lock older than this is treated as abandoned

# ── clients ──────────────────────────────────────────────────────────────────
# NOTE: case_documents_col and processed_documents were removed. Every write
# this router does now lands in insurance_claims_col (the single source of
# truth) or in the two job-tracking collections below.
# ── Motor client: loop-safe accessor ────────────────────────────────────────
# AsyncIOMotorClient binds its connection pool/background tasks to whatever
# asyncio event loop is running the first time it's used. That's fine in
# uvicorn (one persistent loop for the process lifetime), but Celery workers
# that run each task via asyncio.run(...) get a FRESH event loop per task —
# so a client created/first-used in task N's loop raises "Event loop is
# closed" the instant task N+1 (running in a new loop) touches it. This bit
# us in production: the map phase of _generate_document_findings ran fine
# (pure sync HTTP calls), but the very next line — a Mongo read in
# _reduce_observations_to_findings — died with exactly this error, which the
# outer try/except silently turned into "0 findings" indistinguishable from
# a genuinely clean case.
#
# Fix: recreate the client whenever the running loop differs from the one
# the client is currently bound to. Cheap to check, safe in both uvicorn
# (loop never changes, so this is a no-op after the first call) and Celery
# (loop changes every task, so we transparently get a fresh client).
_motor_client: AsyncIOMotorClient | None = None
_motor_client_loop: Any = None


def _get_motor_client() -> AsyncIOMotorClient:
    global _motor_client, _motor_client_loop
    loop = asyncio.get_event_loop()
    if _motor_client is None or _motor_client_loop is not loop:
        if _motor_client is not None:
            _motor_client.close()
        _motor_client = AsyncIOMotorClient(MONGO_URI)
        _motor_client_loop = loop
    return _motor_client


class _LoopSafeCollection:
    """Proxy that re-resolves the underlying Motor collection against the
    current event loop on every attribute access, so existing call sites
    (`insurance_claims_col.find_one(...)`, etc.) don't need to change."""
    def __init__(self, db_name: str, collection_name: str):
        self._db_name = db_name
        self._collection_name = collection_name

    def _resolve(self):
        return _get_motor_client()[self._db_name][self._collection_name]

    def __getattr__(self, item):
        return getattr(self._resolve(), item)


db_name = "doctorassistai"
advanced_upload_tasks_col = _LoopSafeCollection(db_name, "advanced_upload_tasks")
insurance_claims_col = _LoopSafeCollection(db_name, "insurance_claims_new")
llama_stats_col = _LoopSafeCollection(db_name, "llama_usage_stats")
raw_markdown_blocks_col = _LoopSafeCollection(db_name, "raw_markdown_blocks")  # NEW — see append_markdown_block_atomic

groq_client = Groq(api_key=GROQ_API_KEY)

router = APIRouter(tags=["CaseDocuments"])


# ── index setup ──────────────────────────────────────────────────────────────
async def ensure_case_doc_indexes():
    """
    Trimmed down after dropping case_documents. Only advanced_upload_tasks
    (sidebar/case-status polling) and a supervisor_id index on the claim
    collection (used by mobile's "my cases" list) are needed now.
    """
    await advanced_upload_tasks_col.create_index("status")
    await advanced_upload_tasks_col.create_index([("case_id", 1), ("status", 1)])
    await insurance_claims_col.create_index("supervisorId")
    await raw_markdown_blocks_col.create_index("caseId", unique=True)  # NEW


# ── auth helper ───────────────────────────────────────────────────────────────
def _get_user(request: Request) -> dict:
    uid  = request.headers.get("X-User-Id")
    role = request.headers.get("X-User-Role")
    if uid:
        return {"user_id": uid, "role": role}
    auth = request.headers.get("authorization", "")
    if not auth:
        raise HTTPException(status_code=401, detail="Missing auth")
    try:
        token   = auth.split(" ")[1]
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return {"user_id": payload.get("sub"), "role": payload.get("role")}
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

async def append_markdown_block_atomic(insurance_claims_col, case_id: str, doc_id: str, file_name: str, text: str) -> None:
    """
    Atomically append this file's parsed markdown into the case's markdown
    pool. Replaces the old read-then-compute-then-write pattern
    (_get_accumulated_markdown / its per-task local copies), which raced
    whenever two documents for the same case were processed concurrently:
    both tasks read the same stale raw_llama_markdown before either had
    written, both computed "existing + own text", and whichever task's
    $set landed last silently discarded the other task's text. This is
    exactly what caused a case's 4000818279A_ MV.pdf / HV.pdf text (and
    several near-simultaneous screenshot uploads) to vanish from
    raw_llama_markdown even though extraction succeeded for all of them.

    UPDATED: the per-file blocks array now lives in its own collection
    (raw_markdown_blocks) instead of on insurance_claims_new — nothing
    outside this function ever read raw_llama_markdown_blocks, so keeping
    it on the claim document was only bloating it for no benefit.

    Step 1 (atomic): merge this file's block into raw_markdown_blocks,
    deduped by doc_id (not file_name — a resubmitted document can arrive
    under a different original filename than the one it replaces, and a
    file_name-keyed dedupe would leave the old block as a stale duplicate
    instead of replacing it), AND compute the joined markdown string, both in
    ONE aggregation-pipeline update on ONE document in that collection —
    two concurrent calls for the same case still can't lose each other's
    text, same guarantee as before, just scoped to the new collection.
    Requires MongoDB 4.2+ (already required elsewhere in this codebase —
    see _atomic_set_with_null_parent_fix).

    Step 2 (NOT atomic with step 1): copy the freshly-computed joined
    string onto the claim doc's raw_llama_markdown field. MongoDB can't
    span two collections in one atomic operation, so this narrows (but
    does not fully close) the old race window. Acceptable for this
    write pattern — see PR discussion.
    """
    if not text or not text.strip():
        return
    text = text.strip()
    updated = await raw_markdown_blocks_col.find_one_and_update(
        {"caseId": case_id},
        [
            {
                "$set": {
                    "blocks": {
                        "$concatArrays": [
                            {
                                "$filter": {
                                    "input": {"$ifNull": ["$blocks", []]},
                                    "as": "b",
                                    "cond": {"$ne": ["$$b.doc_id", doc_id]},
                                }
                            },
                            [{"doc_id": doc_id, "file_name": file_name, "text": text}],
                        ]
                    }
                }
            },
            {
                "$set": {
                    "joined_markdown": {
                        "$reduce": {
                            "input": "$blocks",
                            "initialValue": "",
                            "in": {
                                "$cond": [
                                    {"$eq": ["$$value", ""]},
                                    "$$this.text",
                                    {"$concat": ["$$value", "\n\n", "$$this.text"]},
                                ]
                            },
                        }
                    }
                }
            },
        ],
        upsert=True,
        return_document=True,
    )

    joined_markdown = (updated or {}).get("joined_markdown", "")

    await insurance_claims_col.update_one(
        {"caseId": case_id},
        {"$set": {"raw_llama_markdown": joined_markdown}},
    )

async def _build_full_case_context(
    case_id: str,
    current_text: str
) -> str:
    """
    REWORKED: previously pulled prior documents' raw_markdown from
    case_documents.documents[]. That collection is gone, so this now uses
    the same accumulated markdown that already lives on the claim doc
    (raw_llama_markdown) as "everything seen so far", and just prepends it
    as prior context, excluding the current text itself.
    """
    claim = await insurance_claims_col.find_one(
        {"caseId": case_id},
        {"raw_llama_markdown": 1}
    )
    existing = ((claim or {}).get("raw_llama_markdown") or "").strip()
    current_clean = current_text.strip()

    if not existing or existing == current_clean or current_clean in existing:
        return current_text

    return (
        "PREVIOUS DOCUMENTS:\n\n"
        + existing
        + "\n\nCURRENT DOCUMENT:\n\n"
        + current_text
    )


def _normalize_extracted_fields(flat: Dict[str, Any]) -> Dict[str, Any]:
    """
    Post-process extracted fields to fix common OCR/LLM formatting issues.
    """
    import re

    # Normalize Aadhaar: strip spaces/dashes from 12-digit numbers
    id_num = flat.get("idProofNumber")
    if id_num:
        digits_only = re.sub(r"[\s\-]", "", str(id_num))
        if len(digits_only) == 12 and digits_only.isdigit():
            flat["idProofNumber"] = digits_only
            if not flat.get("idProofType"):
                flat["idProofType"] = "Aadhaar Card"

    # Normalize mobile: strip +91, spaces, dashes → 10 digits
    mobile = flat.get("claimantMobile")
    if mobile:
        digits = re.sub(r"[\s\-\+]", "", str(mobile))
        if digits.startswith("91") and len(digits) == 12:
            digits = digits[2:]
        if len(digits) == 10:
            flat["claimantMobile"] = digits

    # Normalize amounts: strip Rs, commas, currency symbols
    amount_fields = [
        "claimedAmount", "sumInsured", "cashlessDetails.estimatedCost",
        "billingDetails.finalBillAmount", "billingDetails.discountAmount"
    ]
    for field in amount_fields:
        val = flat.get(field)
        if val and isinstance(val, str):
            cleaned = re.sub(r"[^\d.]", "", val)
            try:
                flat[field] = float(cleaned)
            except ValueError:
                pass
    claimed = flat.get("claimedAmount")
    net_received = flat.get("billingDetails.finalBillAmount")

    if claimed is not None and net_received is not None:
        try:
            claimed_f = float(claimed)
            net_f = float(net_received)

            # likely partial slip / subtotal extracted as claimedAmount
            if claimed_f > 0 and net_f > claimed_f * 2:
                logger.warning(
                    "claimedAmount (%s) much lower than finalBillAmount (%s) — overriding claimedAmount",
                    claimed_f,
                    net_f,
                )
                flat["claimedAmount"] = net_f

        except (ValueError, TypeError):
            pass

    return flat


async def _enrich_description(text: str, extracted_flat: Dict[str, Any], existing_description: str = "") -> str:
    existing_desc = extracted_flat.get("description", "") or ""
    baseline = existing_description if len(existing_description) > len(existing_desc) else existing_desc

    if len(baseline) > 100:
        return baseline

    # Only enrich if description is too short (under 100 chars)
    if len(existing_desc) > 100:
        return existing_desc

    name    = extracted_flat.get("claimantName", "The patient")
    age     = extracted_flat.get("claimantAge", "")
    hosp    = (extracted_flat.get("hospitalDetails.name") or
               extracted_flat.get("hospitalDetails", {}).get("name", "the hospital"))
    admit   = extracted_flat.get("hospitalDetails.admissionDate", "")
    trigger = extracted_flat.get("riskDetails.triggers", "")

    prompt = f"""
You are an insurance investigation case summarizer.

Using ONLY the information present in the document text below, write a
4-6 sentence factual case description for an insurance investigator.

Include (if present in the document):
1. Patient name, age, gender
2. Nature of claim / how the incident/illness occurred
3. Incident date, time, and location
4. Hospital arrival date and time
5. Presenting condition and key vitals on admission
6. Key treatment given (surgery, ICU, ventilator, procedure, delivery)
7. Police/MLC/legal status (for accident cases)
8. Any fraud/suspicion flags from insurer email

Known facts already extracted:
- Name: {name}, Age: {age}
- Hospital: {hosp}, Admission: {admit}
- Insurer flags: {trigger or 'None'}

Write in third person, past tense. No bullet points.
Output ONLY the description paragraph, nothing else.

DOCUMENT TEXT:
{text[:6000]}
"""
    wait_attempt = 0
    while True:
        reserve_tokens(estimate_tokens(prompt, "", 400))
        try:
            completion = await asyncio.to_thread(
                groq_client.chat.completions.create,
                model="openai/gpt-oss-120b",
                temperature=0.1,
                max_tokens=400,
                messages=[{"role": "user", "content": prompt}],
            )
            return completion.choices[0].message.content.strip()
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "rate_limit_exceeded" in err_str:
                wait_attempt += 1
                wait = min(5.0 * (2 ** min(wait_attempt, 5)), 60)
                m = re.search(r'try again in ([\d.]+)s', err_str)
                if m:
                    wait = float(m.group(1)) + 1.0
                logger.warning("Description enrichment rate limited, waiting %.1fs (attempt %d)...", wait, wait_attempt)
                await asyncio.sleep(wait)
                continue
            logger.error("Description enrichment failed: %s", e)
            return existing_desc


# ── extraction helpers ────────────────────────────────────────────────────────
# SEMANTIC_RULES / FIELD_SCHEMA removed — confirmed dead. multiagent_extraction.py
# has its own inline per-agent schemas (_A1_SCHEMA..._A7_SCHEMA) and never
# imports these from this module.


def _get_pdf_page_count(content: bytes) -> int:
    """Best-effort page count for a PDF. Returns 1 on failure (e.g. images)."""
    try:
        reader = PdfReader(io.BytesIO(content))
        return max(len(reader.pages), 1)
    except Exception as e:
        logger.warning("Could not read PDF page count: %s", e)
        return 1

# ── Document findings (PED / billing / coverage suspicion) ──────────────────
# Map-reduce over the accumulated raw_llama_markdown for a case:
#   1) MAP  — per-PDF, per-page-chunk pass extracts short verbatim facts
#             (bounded chunk size so a single huge PDF never blows the
#             context window; this is the "batching" for the ~150k char
#             common case)
#   2) REDUCE — one pass reasons across ALL facts (small, structured JSON,
#             not raw text) for PED / billing / coverage red flags
#   3) VERIFY — every finding's quote is checked verbatim against the real
#             source page before being persisted, so the UI never bolds
#             something the LLM invented
FINDINGS_MODEL = os.getenv("FINDINGS_MODEL", "openai/gpt-oss-120b")
FINDINGS_MAP_CHUNK_CHARS = int(os.getenv("FINDINGS_MAP_CHUNK_CHARS", "20000"))

_PDF_BLOCK_RE = re.compile(
    r"<!--\s*PDF_START:\s*(.*?)\s*-->([\s\S]*?)<!--\s*PDF_END:\s*\1\s*-->"
)
_PAGE_BLOCK_RE = re.compile(
    r"<!--\s*PAGE_START:\s*(\d+)\s*-->([\s\S]*?)<!--\s*PAGE_END:\s*\1\s*-->"
)


def _extract_pdf_blocks(markdown: str) -> list:
    """Split accumulated markdown into per-file blocks, each holding its
    page-numbered sub-blocks. Mirrors the frontend's splitAndAnnotate so the
    page ranges line up exactly with what the reviewer sees."""
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


def _chunk_pages(pages: list, max_chars: int) -> list:
    """Group consecutive pages into batches under max_chars so each map call
    stays bounded regardless of how large a single source PDF is."""
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
    """Parse newline-delimited JSON objects. Each line is parsed independently,
    so if the model's output gets cut off mid-stream, every complete line
    before the cut survives — no brace-counting salvage needed. This is the
    standard robust pattern for LLM extraction output that may be truncated,
    and replaces the JSON-array approach which fails all-or-nothing."""
    if not raw:
        return []
    cleaned = raw.strip()
    cleaned = re.sub(r"^```(?:json|jsonl)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)

    results = []
    dropped = 0
    for line in cleaned.splitlines():
        line = line.strip().rstrip(",")
        if not line or line in ("[", "]", "{", "}"):
            continue
        try:
            obj = json.loads(line)
            if isinstance(obj, dict):
                results.append(obj)
        except Exception:
            dropped += 1
    if dropped:
        logger.info("Findings: JSONL parse skipped %d malformed/incomplete line(s)", dropped)
    return results


def _parse_llm_json(raw: str):
    """Strip ```json fences and parse. Returns None on failure (fail-soft —
    a bad LLM response just means fewer findings, never a crash).

    If the output looks like a truncated JSON array (common when the model
    hits max_tokens mid-object), salvage every complete top-level object
    that appears before the cut-off rather than discarding the whole
    response — a partial set of real findings beats none."""
    if not raw:
        return None
    cleaned = raw.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except Exception as e:
        logger.warning("Findings: could not parse LLM JSON output directly: %s", e)

    if cleaned.lstrip().startswith("["):
        salvaged = []
        depth = 0
        start = None
        in_string = False
        escape = False
        for i, ch in enumerate(cleaned):
            if in_string:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == '"':
                    in_string = False
                continue
            if ch == '"':
                in_string = True
                continue
            if ch == "{":
                if depth == 0:
                    start = i
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0 and start is not None:
                    candidate = cleaned[start:i + 1]
                    try:
                        salvaged.append(json.loads(candidate))
                    except Exception:
                        pass
                    start = None
        if salvaged:
            logger.warning(
                "Findings: salvaged %d complete object(s) from truncated/malformed JSON array",
                len(salvaged),
            )
            return salvaged

    return None

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
  the payee name, even on a page full of routine transactions (see itemization rule below)
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
reference ranges, routine day-to-day bank transactions like utility payments or small POS \
purchases, and line-by-line pharmacy charges may be capped at 1-2 representative observations per \
page. This cap NEVER applies to: insurer/broker-named bank transactions, struck-through/altered \
figures, form signing dates, discharge/admission/death dates, duration-of-symptom statements, \
administrative "not collected" gaps, OR any identity/demographic field (name, date of birth, age, \
ID number, MRD/registration number) or doctor/facility identifier (doctor name, registration \
number, hospital name) — extract EVERY occurrence of these on every page they appear, even if the \
field looks like routine header/letterhead text and even if an identical-looking value was already \
extracted from an earlier page. Two mentions of the same field with different values, even pages \
apart, is exactly the kind of thing this extraction exists to catch — never suppress a repeat \
value as "already seen."

If nothing relevant is on this page, output nothing.

FILE: {file_name}
PAGE RANGE: {page_range}

CONTENT:
{content}
"""

async def _extract_observations_for_chunk(file_name: str, chunk_pages: list) -> list:
    page_numbers = [p["page_number"] for p in chunk_pages if p["page_number"] is not None]
    page_range = f"{min(page_numbers)}-{max(page_numbers)}" if page_numbers else "n/a"
    content = "\n\n".join(f"[PAGE {p['page_number']}]\n{p['text']}" for p in chunk_pages)
    prompt = _OBSERVATION_PROMPT.format(
        file_name=file_name, page_range=page_range, content=content[:FINDINGS_MAP_CHUNK_CHARS]
    )
    OBSERVATION_MAX_TOKENS = int(os.getenv("FINDINGS_MAP_MAX_TOKENS", "32000"))
    completion = None
    for attempt_tokens in (OBSERVATION_MAX_TOKENS, 16000, 8000):
        wait_attempt = 0
        while True:
            reserve_tokens(estimate_tokens(prompt, "", attempt_tokens))
            try:
                completion = await asyncio.to_thread(
                    groq_client.chat.completions.create,
                    model=FINDINGS_MODEL,
                    temperature=0,
                    max_tokens=attempt_tokens,
                    messages=[{"role": "user", "content": prompt}],
                )
                break
            except Exception as e:
                err_str = str(e)
                if "429" in err_str or "rate_limit_exceeded" in err_str:
                    wait_attempt += 1
                    wait = min(5.0 * (2 ** min(wait_attempt, 5)), 60)
                    m = re.search(r'try again in ([\d.]+)s', err_str)
                    if m:
                        wait = float(m.group(1)) + 1.0
                    logger.warning(
                        "Findings: observation extraction for %s (%s) rate limited at max_tokens=%d, waiting %.1fs (attempt %d)...",
                        file_name, page_range, attempt_tokens, wait, wait_attempt,
                    )
                    await asyncio.sleep(wait)
                    continue
                logger.warning(
                    "Findings: observation extraction for %s (%s) failed at max_tokens=%d: %s",
                    file_name, page_range, attempt_tokens, e,
                )
                break
        if completion is not None:
            break
    if completion is None:
        logger.error("Findings: observation extraction failed for %s (%s) at every token size (non-rate-limit errors)", file_name, page_range)
        return []

    raw = completion.choices[0].message.content
    if completion.choices[0].finish_reason == "length":
        logger.warning(
            "Findings: observation extraction for %s (%s) still hit max_tokens=%d (output truncated, chunk=%d chars)",
            file_name, page_range, attempt_tokens, len(content),
        )

    parsed = _parse_llm_jsonl(raw)
    logger.info("Findings: %s (%s) yielded %d observation(s) from a %d-char chunk", file_name, page_range, len(parsed), len(content))

    observations = []
    for item in parsed:
        if not isinstance(item, dict) or not item.get("quote"):
            continue
        observations.append({
            "file_name": file_name,
            "page_number": item.get("page_number"),
            "quote": str(item["quote"]).strip(),
            "category": item.get("category", "other"),
            "detail": item.get("detail", ""),
        })
    return observations
_IDENTITY_CROSSCHECK_PROMPT = """You are an insurance-fraud investigator. Below is every \
identity, demographic, date-of-birth/age, ID-number, MRD/registration-number, doctor-name, \
doctor-registration-number, and document-date observation extracted from ALL documents in one \
claim file. Your ONLY job is to find genuine, material conflicts within this list — do NOT judge \
anything else, and do NOT flag minor spelling/OCR variation of the same value (e.g. "Shylaja" vs \
"Sylaja" is not a conflict; "08/02/1965" vs "30-Jul-1963" IS a conflict).

Look for:
- Two or more different dates of birth, ages, or ID/Aadhaar numbers attributed to the same named \
  patient across different documents
- Two or more different MRD/registration numbers for what should be the same patient/admission
- A document date (signing, discharge, form-filled date) that falls after a documented death date, \
  or otherwise makes no chronological sense given other dates in the list
- A treating doctor's registration number that varies across documents for what should be the same \
  doctor (note: this may be OCR noise — flag it as worth confirming rather than as certain fraud)

OBSERVATIONS (JSON):
{observations_json}

Return ONLY newline-delimited JSON (JSONL), one finding per line, same schema as before:
{{"type": "IDENTITY_MISMATCH" | "TIMELINE_INCONSISTENCY" | "DOCTOR_FACILITY_INCONSISTENCY" | "DOCUMENT_AUTHENTICITY_ISSUE", "severity": "critical" | "warning", "quotes": [{{"file_name": "<exact match from an observation above>", "page_number": <int or null>, "quote": "<copied EXACTLY from that observation's quote>"}}], "explanation": "<1-2 sentences>"}}

Only include a finding backed by genuine evidence above. If nothing conflicts, return nothing.
"""

async def _cross_check_identity(case_id: str, observations: list) -> list:
    """Dedicated pass over ONLY identity/date-type observations across the whole case.
    Runs after the map phase so it can see identity facts from every page at once —
    something the per-chunk map calls structurally cannot do, since each chunk is
    processed independently. This is what catches things like an Aadhaar DOB
    conflicting with a biopsy report DOB 100 pages later."""
    IDENTITY_CATEGORIES = {
        "identity_detail", "doctor_facility_detail", "document_date",
        "admission_date", "discharge_date", "death_date", "authenticity_marker",
    }
    identity_obs = [o for o in observations if o.get("category") in IDENTITY_CATEGORIES]
    if not identity_obs:
        return []

    prompt = _IDENTITY_CROSSCHECK_PROMPT.format(observations_json=json.dumps(identity_obs))
    completion = None
    wait_attempt = 0
    while True:
        reserve_tokens(estimate_tokens(prompt, "", 16000))
        try:
            completion = await asyncio.to_thread(
                groq_client.chat.completions.create,
                model=FINDINGS_MODEL,
                temperature=0,
                max_tokens=16000,
                messages=[{"role": "user", "content": prompt}],
            )
            break
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "rate_limit_exceeded" in err_str:
                wait_attempt += 1
                wait = min(5.0 * (2 ** min(wait_attempt, 5)), 60)
                m = re.search(r'try again in ([\d.]+)s', err_str)
                if m:
                    wait = float(m.group(1)) + 1.0
                logger.warning("Findings: identity cross-check rate limited for case %s, waiting %.1fs (attempt %d)...", case_id, wait, wait_attempt)
                await asyncio.sleep(wait)
                continue
            logger.error("Findings: identity cross-check failed for case %s: %s", case_id, e)
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
    logger.info("Findings: identity cross-check yielded %d finding(s) for case %s from %d identity observations", len(findings), case_id, len(identity_obs))
    return findings

_REDUCE_PROMPT = """You are an insurance-fraud investigator reviewing a set of extracted \
facts pulled from ALL documents uploaded for one claim (hospital records, insured/member \
visit forms, bills, identity documents). Your job is to spot suspicious patterns across \
these facts using your own judgment — NOT to restate them, and NOT to flag something just \
because two facts differ slightly. Minor OCR/spelling noise (e.g. "Shylaja" vs "Sylaja" vs \
"Shyalaja", a name spelled slightly differently by different hospital staff, a bill number \
typo) is NOT suspicious on its own and must not be flagged. Only flag a genuine, material \
discrepancy that a real investigator would care about.

Look specifically for these categories:

1. PED_SUSPECTED — a pre-existing disease/condition/medication that predates the policy \
   inception date or the stated onset of the current illness, and was not disclosed.

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
   the claimed amount stated in the insurer's referral/trigger email or claim form. A material \
   mismatch (claimed amount well below or well above the sum of actual bills) is a finding, since \
   it's unclear which bills the claim actually covers.

9. UNDISCLOSED_INSURANCE_OR_ANTI_SELECTION — a bank transaction referencing an insurance company, \
   broker, or aggregator (e.g. a UPI debit to "policybazaar" or a named insurer) that contradicts a \
   declaration on a verification/proposal form stating no other policy is held, ESPECIALLY if the \
   transaction falls shortly before or after the first hospital visit for this illness — this is a \
   classic anti-selection signal (shopping for coverage around the time of diagnosis).

10. NARRATIVE_INCONSISTENCY — the SAME event is described with materially different framing \
    across two documents in a way that changes its meaning (e.g. one document calls a hospital \
    visit an elective/preventive checkup while another calls it an emergency/casualty visit; a \
    self-declaration's timeline of events doesn't match the sequence documented in medical \
    records; a medication history stated on one form uses different drug names than what the \
    clinical record actually documents for the same time period). Only flag genuine narrative \
    conflicts, not paraphrasing of the same fact.

11. DOCUMENT_QUALITY_FLAG — a data-quality issue that reduces confidence in the investigation \
    itself: the same doctor's registration number appears in 3+ different variants across bills \
    (may be OCR noise, but worth flagging for confirmation against the official register), a \
    field-investigator's handwritten answer is illegible/garbled, or a form field is left blank \
    where it should be populated. Lower priority than the categories above — always mark these \
    "warning" severity, never "critical."

12. OTHER_SUSPICIOUS — any other internally inconsistent or red-flag pattern across documents \
    that doesn't fit the categories above.

CLAIM CONTEXT (includes the original insurer trigger/instruction, if any):
{claim_context}

EXTRACTED FACTS (JSON, one entry per observation, each with file_name/page_number/quote/category):
{observations_json}
Return ONLY newline-delimited JSON (JSONL) — one complete finding object per
line, no wrapping array, no commas between lines, no prose, no markdown
fences. Each line:
{{
  "type": "PED_SUSPECTED" | "BILLING_MISMATCH" | "POLICY_COVERAGE_ISSUE" | "IDENTITY_MISMATCH" | "TIMELINE_INCONSISTENCY" | "DOCTOR_FACILITY_INCONSISTENCY" | "DOCUMENT_AUTHENTICITY_ISSUE" | "FINANCIAL_RECONCILIATION_MISMATCH" | "UNDISCLOSED_INSURANCE_OR_ANTI_SELECTION" | "NARRATIVE_INCONSISTENCY" | "DOCUMENT_QUALITY_FLAG" | "OTHER_SUSPICIOUS", "severity": "critical" | "warning","quotes": [{{"file_name": "<must exactly match a file_name from the facts above>", "page_number": <int matching that fact, or null>, "quote": "<must be copied EXACTLY, character-for-character, from the matching fact's quote above>"}}], "explanation": "<1-2 sentences, reviewer-facing, plain language, cite the specific contradiction and why it's material>"}}

Rules for "quotes":
- Include 1 quote for a single-source issue (e.g. a billing figure that's internally impossible).
- Include 2 (occasionally more) quotes — from DIFFERENT file_name/page_number pairs — for any \
  comparison-based finding (IDENTITY_MISMATCH, TIMELINE_INCONSISTENCY, DOCTOR_FACILITY_INCONSISTENCY, \
  and any BILLING_MISMATCH/PED_SUSPECTED that rests on comparing two documents). Never fabricate a \
  second quote just to satisfy this rule — only include it if the fact list above actually contains it.

Only include a finding if you have genuine, specific evidence from the facts above — do not \
speculate, and do not flag minor spelling/formatting variation. If nothing suspicious is found, \
return [].
"""

async def _reduce_observations_to_findings(case_id: str, observations: list) -> list:
    if not observations:
        return []

    claim = await insurance_claims_col.find_one(
        {"caseId": case_id},
        {
            "_id": 0, "claimedAmount": 1, "sumInsured": 1, "policyDetails": 1,
            "hospitalDetails.admissionDate": 1, "hospitalDetails.dischargeDate": 1,
            "claimantName": 1, "claimantAge": 1, "insurer": 1,
            "riskDetails": 1, "claimTriggers": 1, "description": 1, "deathDetails": 1,
            "billingDetails.finalBillAmount": 1, "billingDetails.grossAmount": 1,
            "additionalMedicalDetails.chiefComplaints": 1,
        },
    ) or {}
    claim_context = json.dumps(claim, default=str)
    observations_json = json.dumps(observations)
    prompt = _REDUCE_PROMPT.format(claim_context=claim_context, observations_json=observations_json)

    # Rough token estimate (chars/4 is a conservative approximation for English text)
    # to stay under the 131,072 context window shared between prompt + completion.
    # If the observation set is too large to fit alongside a full 65,536-token
    # completion budget, cap the requested completion tokens to what's left.
    est_prompt_tokens = len(prompt) // 4
    available_for_completion = 131072 - est_prompt_tokens - 2000  # 2000 token safety margin
    if available_for_completion < 65536:
        logger.warning(
            "Findings: reduce pass for case %s has a large prompt (~%d est. tokens from %d observations); "
            "capping completion budget to %d tokens to stay within context window",
            case_id, est_prompt_tokens, len(observations), max(available_for_completion, 4000),
        )

    REDUCE_MAX_TOKENS = int(os.getenv("FINDINGS_REDUCE_MAX_TOKENS", "65536"))
    effective_max = min(REDUCE_MAX_TOKENS, max(available_for_completion, 4000))
    completion = None
    for attempt_tokens in (effective_max, effective_max // 2, 8000):
        wait_attempt = 0
        while True:
            reserve_tokens(estimate_tokens(prompt, "", attempt_tokens))
            try:
                completion = await asyncio.to_thread(
                    groq_client.chat.completions.create,
                    model=FINDINGS_MODEL,
                    temperature=0,
                    max_tokens=attempt_tokens,
                    messages=[{"role": "user", "content": prompt}],
                )
                break
            except Exception as e:
                err_str = str(e)
                if "429" in err_str or "rate_limit_exceeded" in err_str:
                    wait_attempt += 1
                    wait = min(5.0 * (2 ** min(wait_attempt, 5)), 60)
                    m = re.search(r'try again in ([\d.]+)s', err_str)
                    if m:
                        wait = float(m.group(1)) + 1.0
                    logger.warning(
                        "Findings: reduce pass for case %s rate limited at max_tokens=%d, waiting %.1fs (attempt %d)...",
                        case_id, attempt_tokens, wait, wait_attempt,
                    )
                    await asyncio.sleep(wait)
                    continue
                logger.warning(
                    "Findings: reduce pass for case %s failed at max_tokens=%d: %s",
                    case_id, attempt_tokens, e,
                )
                break
        if completion is not None:
            break
    if completion is None:
        logger.error("Findings: reduce pass failed for case %s at every token size (non-rate-limit errors)", case_id)
        return []

    raw = completion.choices[0].message.content
    if completion.choices[0].finish_reason == "length":
        logger.warning(
            "Findings: reduce pass for case %s still hit max_tokens=%d (output truncated, %d observations in)",
            case_id, attempt_tokens, len(observations),
        )

    parsed = _parse_llm_jsonl(raw)
    if not parsed:
        logger.info("Findings: reduce pass for case %s produced no findings (either nothing suspicious, or all lines failed to parse — check above for skip counts)", case_id)

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
            clean_quotes.append({
                "file_name": file_name,
                "page_number": q.get("page_number"),
                "quote": quote_text,
            })

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

def _normalize_for_match(s: str) -> str:
    """Collapse whitespace and strip common punctuation noise so OCR'd
    tables (stray newlines, doubled spaces, curly vs straight quotes)
    don't cause a real quote to fail verbatim matching."""
    s = s.replace("\u2018", "'").replace("\u2019", "'")
    s = s.replace("\u201c", '"').replace("\u201d", '"')
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def _verify_quote_on_page(pdf_blocks: list, file_name, page_number, quote: str) -> bool:
    """Reject any finding whose quote wasn't actually found (verbatim, or
    verbatim after whitespace/quote-mark normalization) on the page it
    claims to come from — protects against a fabricated quote ever
    reaching the UI and getting bolded as if it were real."""
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
async def _generate_document_findings(case_id: str, full_markdown: str) -> dict:
    """Returns {"findings": [...], "status": "ok" | "error", "error": str | None}.
    Callers that only persisted the findings list before should now persist
    the whole dict's fields — see documentFindingsStatus below — so an
    infra failure (dead event loop, Groq outage, etc.) is visibly different
    in the DB from "pipeline ran and genuinely found nothing.\""""
    if not full_markdown or not full_markdown.strip():
        return {"findings": [], "status": "ok", "error": None}
    try:
        pdf_blocks = _extract_pdf_blocks(full_markdown)
        if not pdf_blocks:
            logger.warning("Findings: no PDF blocks parsed from markdown for case %s (regex mismatch?)", case_id)
            return {"findings": [], "status": "ok", "error": None}
        logger.info("Findings: parsed %d PDF block(s) for case %s", len(pdf_blocks), case_id)
        chunk_tasks = []
        for block in pdf_blocks:
            for chunk in _chunk_pages(block["pages"], FINDINGS_MAP_CHUNK_CHARS):
                chunk_tasks.append(_extract_observations_for_chunk(block["file_name"], chunk))

        logger.info("Findings: running %d map call(s) concurrently for case %s", len(chunk_tasks), case_id)
        FINDINGS_MAP_CONCURRENCY = int(os.getenv("FINDINGS_MAP_CONCURRENCY", "6"))
        semaphore = asyncio.Semaphore(FINDINGS_MAP_CONCURRENCY)

        async def _bounded_chunk_call(coro):
            async with semaphore:
                return await coro

        chunk_results = await asyncio.gather(
            *[_bounded_chunk_call(t) for t in chunk_tasks],
            return_exceptions=True,
        )

        observations = []
        for result in chunk_results:
            if isinstance(result, Exception):
                logger.error("Findings: a map call raised during concurrent extraction for case %s: %s", case_id, result)
                continue
            observations.extend(result)

        logger.info("Findings: extracted %d observation(s) for case %s", len(observations), case_id)

        if not observations:
            return {"findings": [], "status": "ok", "error": None}

        findings = await _reduce_observations_to_findings(case_id, observations)
        identity_findings = await _cross_check_identity(case_id, observations)
        findings = findings + identity_findings
        logger.info("Findings: reduce pass + identity cross-check returned %d raw finding(s) for case %s (before quote verification)", len(findings), case_id)

        verified = []
        dropped_quotes = 0
        unverified_findings = 0
        for f in findings:
            checked_quotes = []
            any_verified = False
            for q in f["quotes"]:
                ok = _verify_quote_on_page(pdf_blocks, q["file_name"], q["page_number"], q["quote"])
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
                "Findings: %d quote(s) failed verbatim verification, %d finding(s) kept but flagged quote_unverified for case %s",
                dropped_quotes, unverified_findings, case_id,
            )

        return {"findings": verified, "status": "ok", "error": None}

    except Exception as e:
        # CRITICAL: this used to swallow infra failures (e.g. "Event loop is
        # closed" from a Celery-task-scoped Motor client) into an empty list
        # that was indistinguishable from a genuinely clean case. Surface it.
        logger.error("Findings: generation failed for case %s: %s", case_id, e)
        return {"findings": [], "status": "error", "error": str(e)}


def _unflatten(flat: Dict[str, Any]) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for key, value in flat.items():
        if value is None:
            continue
        parts = key.split(".", 1)
        if len(parts) == 1:
            result[key] = value
        else:
            parent, child = parts
            result.setdefault(parent, {})[child] = value
    return result


async def _build_claim_set_payload(
    case_id: str,
    extracted_flat: Dict[str, Any],
    dropdown_only: set,
) -> Dict[str, Any]:
    """
    Build the $set payload for insurance_claims_col WITHOUT blindly
    overwriting fields that already hold a better/non-empty value.
    Unchanged from before — this logic never touched case_documents.
    """
    existing = await insurance_claims_col.find_one(
        {"caseId": case_id},
        {"_id": 0},
    ) or {}

    payload: Dict[str, Any] = {}

    for flat_key, value in extracted_flat.items():
        if value is None or flat_key in dropdown_only:
            continue

        if flat_key == "description":
            existing_desc = existing.get("description") or ""
            new_desc = value or ""
            payload["description"] = new_desc if len(new_desc) > len(existing_desc) else existing_desc
            continue

        if flat_key == "suggestedTriggers":
            existing_triggers = set(existing.get("suggestedTriggers") or [])
            new_triggers = set(value or [])
            payload["suggestedTriggers"] = list(existing_triggers | new_triggers)
            continue

        if flat_key == "emailInstructions":
            existing_ei = (existing.get("emailInstructions") or "").strip()
            new_ei = (value or "").strip()
            if existing_ei and new_ei and new_ei not in existing_ei:
                payload["emailInstructions"] = f"{existing_ei} | {new_ei}"
            else:
                payload["emailInstructions"] = new_ei or existing_ei
            continue

        if flat_key == "riskDetails.triggers":
            existing_risk = existing.get("riskDetails") or {}
            existing_trig = (existing_risk.get("triggers") or "").strip()
            new_trig = (value or "").strip()
            if existing_trig and new_trig and new_trig not in existing_trig:
                payload["riskDetails.triggers"] = f"{existing_trig}; {new_trig}"
            else:
                payload["riskDetails.triggers"] = new_trig or existing_trig
            continue

        # default: only fill if not already present/non-empty
        parts = flat_key.split(".", 1)
        if len(parts) == 1:
            current_val = existing.get(parts[0])
        else:
            current_val = (existing.get(parts[0]) or {}).get(parts[1])

        if current_val in (None, "", [], {}):
            payload[flat_key] = value
        # else: keep existing value, skip overwrite

    return payload


async def _fix_null_parents(collection, case_id: str, flat_keys):
    """
    Dot-notation $set fails with error 28 if the parent field is currently
    stored as an explicit null (e.g. "criticalDetails": null). Promote any
    such parents to {} first so the dotted $set can proceed.
    """
    existing = await collection.find_one({"caseId": case_id}, {"_id": 0}) or {}
    parents_to_fix = set()
    for k in flat_keys:
        if "." in k:
            parent = k.split(".", 1)[0]
            if parent in existing and existing[parent] is None:
                parents_to_fix.add(parent)
    if parents_to_fix:
        await collection.update_one(
            {"caseId": case_id},
            {"$set": {p: {} for p in parents_to_fix}},
        )


async def _llamacloud_parse(
    content: bytes,
    filename: str
) -> tuple[str, int]:
    """Upload PDF bytes to LlamaCloud and return (full_markdown, page_count). Unchanged."""
    import tempfile
    import asyncio

    def _sync_parse():
        from llama_cloud import LlamaCloud

        if not LLAMA_API_KEY:
            raise ValueError("LLAMA_API_KEY is not configured")

        client = LlamaCloud(api_key=LLAMA_API_KEY)
        safe_filename = filename.replace(" ", "_")
        tmp_path = os.path.join(tempfile.gettempdir(), safe_filename)

        with open(tmp_path, "wb") as tmp:
            tmp.write(content)

        try:
            uploaded_file = client.files.create(file=tmp_path, purpose="parse")

            # Agentic tier removed — cost_effective is the only tier this
            # pipeline needs. Hardcoding it here (instead of reading
            # LLAMA_PARSE_TIER) means a stray LLAMA_PARSE_TIER=agentic in
            # some environment's config can never silently switch this
            # pipeline onto the slower, per-page-translation agentic parse.
            parse_kwargs = dict(
                file_id=uploaded_file.id,
                tier="cost_effective",
                version="latest",
                expand=["markdown"],
            )

            result = client.parsing.parse(**parse_kwargs)

            pages = result.markdown.pages
            page_count = len(pages)

            parts = [f"<!-- PDF_START: {filename} -->"]
            for idx, page in enumerate(pages):
                page_num = idx + 1
                parts.append(f"<!-- PAGE_START: {page_num} -->")
                parts.append(page.markdown)
                parts.append(f"<!-- PAGE_END: {page_num} -->")
            parts.append(f"<!-- PDF_END: {filename} -->")

            full_markdown = "\n\n".join(parts)
            return full_markdown, page_count

        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _sync_parse)


async def _reserve_doc_number(case_id: str, supervisor_id: str, supervisor_role: str) -> int:
    """
    REPLACES case_documents.doc_counter. Atomically reserves the next
    document number directly on the claim doc, and stamps supervisor_id on
    first use (needed by /api/app/my-cases now that case_documents is gone).
    """
    now = datetime.now(IST)
    updated = await insurance_claims_col.find_one_and_update(
        {"caseId": case_id},
        {
            "$setOnInsert": {
                "caseId": case_id,
                "supervisorId": supervisor_id,
                "supervisorRole": supervisor_role,
            },
            "$set": {"updatedAt": now},
            "$inc": {"docCounter": 1},
        },
        upsert=True,
        return_document=True,
    )
    return updated.get("docCounter", 1)


# ═══════════════════════════════════════════════════════════════════════════
# WEB ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/web/upload-document")
async def upload_document(
    request: Request,
    file: UploadFile = File(...),
    case_id: str = Form(...),
    email_text: str = Form(None)
):
    """Claim Detail Documents — full LlamaCloud parse + multi-agent extraction.
    All writes now go to insurance_claims_col only."""
    user            = _get_user(request)
    supervisor_id   = user["user_id"]
    supervisor_role = user.get("role", "")

    allowed_ext = (".pdf", ".jpg", ".jpeg", ".png", ".webp", ".txt")

    if not file.filename.lower().endswith(allowed_ext):
        raise HTTPException(
            status_code=400,
            detail="Only PDF and image files are accepted."
        )

    # ── Trigger-content-only path (pasted investigation instruction) ───────
    if file.filename.lower().endswith(".txt"):
        if not (email_text or "").strip():
            raise HTTPException(status_code=400, detail="Trigger text is empty.")

        trigger_text  = email_text.strip()
        doc_id        = f"CDOC-TRIGGER-{uuid.uuid4().hex[:8].upper()}"
        now           = datetime.now(IST)

        doc_number = await _reserve_doc_number(case_id, supervisor_id, supervisor_role)
        display_label = f"Trigger Content {doc_number}"

        extracted_flat = await agent_a7_email_instructions(trigger_text, {})
        extracted_flat = _normalize_extracted_fields(extracted_flat)
        extracted_nested = _unflatten(extracted_flat)
        fields_found = len([v for v in extracted_flat.values() if v is not None])

        DROPDOWN_ONLY = {'insurer', 'claimMode', 'claimSubtype', 'tags', 'claimTrigger'}
        flat_set_payload = await _build_claim_set_payload(case_id, extracted_flat, DROPDOWN_ONLY)
        flat_set_payload["updatedAt"] = now
        await _fix_null_parents(insurance_claims_col, case_id, extracted_flat.keys())

        await insurance_claims_col.update_one({"caseId": case_id}, {"$set": flat_set_payload})
        await insurance_claims_col.update_one(
            {"caseId": case_id, "supportingDocuments.doc_id": {"$ne": doc_id}},
            {"$push": {"supportingDocuments": {
                "doc_id": doc_id,
                "file_name": file.filename,
                "display_label": display_label,
                "pdf_url": None,
                "storage_path": None,
                "fields_found": fields_found,
                "status": "extracted",
                "doc_type": "claim_detail",
                "uploaded_at": now.isoformat(),
            }}},
        )

        return {
            "success": True, "doc_id": doc_id, "case_id": case_id,
            "file_name": file.filename, "display_label": display_label,
            "pdf_url": None, "extraction_mode": "trigger",
            "extracted_fields": extracted_nested, "fields_found": fields_found,
            "message": f"Trigger extraction: {fields_found} fields from {display_label}.",
        }

    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File exceeds 20 MB limit.")

    claim = await insurance_claims_col.find_one({"caseId": case_id}, {"_id": 0, "caseId": 1})
    if not claim:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found.")

    doc_id = f"CDOC-{uuid.uuid4().hex[:10].upper()}"
    now    = datetime.now(IST)

    doc_number    = await _reserve_doc_number(case_id, supervisor_id, supervisor_role)
    display_label = f"Document {doc_number}"

    is_pdf_claim_doc = file.filename.lower().endswith(".pdf")
    estimated_pages = _get_pdf_page_count(content) if is_pdf_claim_doc else 1
    estimated_credits = estimated_pages * CREDITS_PER_PAGE
    stats_doc = await llama_stats_col.find_one({"_id": "global_total"}) or {}
    credits_used_so_far = stats_doc.get("credits_used", 0)
    if credits_used_so_far + estimated_credits > LLAMA_CREDIT_BUDGET:
        raise HTTPException(
            status_code=402,
            detail=(
                f"LlamaCloud credit budget nearly exhausted "
                f"({credits_used_so_far}/{LLAMA_CREDIT_BUDGET} used). "
                f"This extraction needs ~{estimated_credits} credits. "
                f"Please top up credits or contact admin."
            ),
        )

    stored_url: Optional[str]      = None
    storage_path: Optional[str]    = None

    try:
        upload_url   = f"{STORAGE_BASE_URL}/upload"
        content_type = file.content_type or "application/octet-stream"
        files = {"file": (file.filename, content, content_type)}
        params = {
            "doctor_id":   supervisor_id,
            "patient_id":  case_id,
            "doc_type":    f"document_{doc_number}",
            "category":    None,
            "subcategory": None,
        }
        response = requests.post(upload_url, params=params, files=files, timeout=60)
        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail=response.text)

        upload_result = response.json()
        full_path = upload_result.get("filename", "")
        if not full_path:
            raise HTTPException(status_code=500, detail="No filename returned from storage service.")

        stored_filename = full_path.split("/")[-1]
        storage_path    = f"{case_id}/{stored_filename}"
        stored_url      = f"{STORAGE_BASE_URL}/files/{case_id}/{stored_filename}"
        logger.info("Direct storage upload success | stored_filename=%s", stored_filename)

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Direct storage upload failed")
        raise HTTPException(status_code=502, detail=f"Storage upload failed: {str(exc)}")

    # Push a "queued" supportingDocuments entry now, then hand parsing +
    # extraction + findings off to Celery — this endpoint used to do all
    # of that inline, which could exceed the browser/proxy timeout on
    # large documents even though the backend finished successfully a
    # moment later (frontend showed "Failed — retry" for an upload that
    # had already succeeded server-side). Mirrors /web/advanced-upload.
    await insurance_claims_col.update_one(
        {"caseId": case_id, "supportingDocuments.doc_id": {"$ne": doc_id}},
        {"$push": {"supportingDocuments": {
            "doc_id": doc_id,
            "file_name": file.filename,
            "display_label": display_label,
            "pdf_url": stored_url,
            "storage_path": storage_path,
            "fields_found": 0,
            "status": "queued",
            "doc_type": "claim_detail",
            "uploaded_at": now.isoformat(),
        }}},
    )

    task_id = f"claimdoc_{uuid.uuid4().hex}"
    await advanced_upload_tasks_col.insert_one({
        "task_id":        task_id,
        "case_id":        case_id,
        "doc_id":         doc_id,
        "task_type":      "claim_detail_extraction",
        "file_name":      file.filename,
        "display_label":  display_label,
        "supervisor_id":  supervisor_id,
        "status":         "queued",
        "result":         None,
        "error":          None,
        "total_pages":    None,
        "created_at":     now,
        "updated_at":     now,
    })

    celery_client.send_task(
        "claim_detail_upload.process_document",
        kwargs={
            "task_id":       task_id,
            "case_id":       case_id,
            "doc_id":        doc_id,
            "display_label": display_label,
            "file_name":     file.filename,
            "file_b64":      base64.b64encode(content).decode("utf-8"),
            "email_text":    email_text,
            "stored_url":    stored_url,
            "storage_path":  storage_path,
        },
        task_id=task_id,
        queue="advanced_upload_queue",
    )

    return {
        "success":         True,
        "status":          "queued",
        "task_id":         task_id,
        "doc_id":          doc_id,
        "case_id":         case_id,
        "file_name":       file.filename,
        "display_label":   display_label,
        "pdf_url":         stored_url,
        "storage_path":    storage_path,
        "extraction_mode": "claim_detail",
        "message":         f"'{file.filename}' stored — extraction in progress.",
    }


# ═══════════════════════════════════════════════════════════════════════════
# ADVANCED UPLOAD — store the file AND immediately queue LlamaCloud parse +
# LLM extraction on the FULL document. Job status lives in
# advanced_upload_tasks; the claim doc holds supportingDocuments[] (now the
# single source of doc metadata AND extracted data — see worker changes).
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/web/advanced-upload")
async def advanced_upload_document(
    request: Request,
    file: UploadFile = File(..., max_size=50_000_000),
    case_id: str = Form(...),
    email_text: str = Form(None)
):
    user            = _get_user(request)
    supervisor_id   = user["user_id"]
    supervisor_role = user.get("role", "")

    allowed_ext = (".pdf", ".jpg", ".jpeg", ".png", ".webp")
    if not file.filename.lower().endswith(allowed_ext):
        raise HTTPException(
            status_code=400,
            detail="Only PDF and image files are accepted."
        )

    content = await file.read()
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File exceeds 50 MB limit.")

    claim = await insurance_claims_col.find_one(
        {"caseId": case_id}, {"_id": 0, "caseId": 1, "ingested_files": 1}
    )
    if not claim:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found.")

    already_ingested = file.filename in set(claim.get("ingested_files") or [])

    doc_id = f"CDOC-ADV-{uuid.uuid4().hex[:8].upper()}"
    now    = datetime.now(IST)

    doc_number    = await _reserve_doc_number(case_id, supervisor_id, supervisor_role)
    display_label = f"Document {doc_number} (Advanced)"

    is_pdf = file.filename.lower().endswith(".pdf")
    page_count = _get_pdf_page_count(content) if is_pdf else 1

    # ── PARSING DISABLED ─────────────────────────────────────────────────
    # Credit estimation was only needed to gate the LlamaCloud extraction
    # call further down. Supporting docs are no longer extracted, so this
    # is dead weight now — kept commented for future re-enable.
    # estimated_credits = page_count * CREDITS_PER_PAGE
    # stats_doc = await llama_stats_col.find_one({"_id": "global_total"}) or {}
    # credits_used_so_far = stats_doc.get("credits_used", 0)
    # credits_insufficient = (credits_used_so_far + estimated_credits) > LLAMA_CREDIT_BUDGET
    # ─────────────────────────────────────────────────────────────────────

    stored_url, storage_path = None, None
    if not already_ingested:
        try:
            upload_url = f"{STORAGE_BASE_URL}/upload"
            content_type = file.content_type or "application/octet-stream"
            files = {"file": (file.filename, content, content_type)}
            params = {
                "doctor_id":   supervisor_id,
                "patient_id":  case_id,
                "doc_type":    f"document_{doc_number}_advanced",
                "category":    None,
                "subcategory": None
            }
            response = requests.post(upload_url, params=params, files=files, timeout=60)
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail=response.text)
            upload_result = response.json()
            full_path = upload_result.get("filename", "")
            if not full_path:
                raise HTTPException(status_code=500, detail="No filename returned from storage service.")
            stored_filename = full_path.split("/")[-1]
            storage_path = f"{case_id}/{stored_filename}"
            stored_url = f"{STORAGE_BASE_URL}/files/{case_id}/{stored_filename}"
            logger.info("Advanced upload success | stored_filename=%s", stored_filename)
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Direct storage upload failed")
            raise HTTPException(status_code=502, detail=f"Storage upload failed: {str(exc)}")
    else:
        logger.info("Skipping storage re-upload — '%s' already ingested for case %s", file.filename, case_id)

    await insurance_claims_col.update_one(
        {"caseId": case_id, "supportingDocuments.doc_id": {"$ne": doc_id}},
        {"$push": {"supportingDocuments": {
            "doc_id": doc_id,
            "file_name": file.filename,
            "display_label": display_label,
            "pdf_url": stored_url,
            "storage_path": storage_path,
            "fields_found": 0,
            "status": "stored",  # PARSING DISABLED — was "queued" / "extraction_pending_credits"
            "uploaded_at": now.isoformat(),
        }}},
    )
    # ── PARSING DISABLED ─────────────────────────────────────────────────
    # Supporting documents are stored only — never queued for LlamaCloud
    # parse + extraction. The task-tracking insert and Celery dispatch are
    # commented out rather than removed, so the extraction pipeline can be
    # restored later by uncommenting this block (and reverting the
    # supportingDocuments status above to "queued").
    #
    # task_id = f"advadv_{uuid.uuid4().hex}"
    #
    # task_doc = {
    #     "task_id":        task_id,
    #     "case_id":        case_id,
    #     "doc_id":         doc_id,
    #     "task_type":      "document_extraction",
    #     "file_name":      file.filename,
    #     "display_label":  display_label,
    #     "supervisor_id":  supervisor_id,
    #     "status":         "queued",
    #     "result":         None,
    #     "error":          None,
    #     "total_pages":    page_count,
    #     "created_at":     now,
    #     "updated_at":     now,
    # }
    #
    # if credits_insufficient:
    #     task_doc["status"] = "failed"
    #     task_doc["error"] = (
    #         f"LlamaCloud credit budget nearly exhausted "
    #         f"({credits_used_so_far}/{LLAMA_CREDIT_BUDGET} used, needs ~{estimated_credits}). "
    #         f"Document was stored — retry extraction once credits are available."
    #     )
    #     await advanced_upload_tasks_col.insert_one(task_doc)
    #     logger.warning(
    #         "Stored '%s' for case %s but skipped extraction — credit budget exhausted.",
    #         file.filename, case_id,
    #     )
    # else:
    #     await advanced_upload_tasks_col.insert_one(task_doc)
    #     celery_client.send_task(
    #         "advanced_upload.process_document",
    #         kwargs={
    #             "task_id":           task_id,
    #             "case_id":           case_id,
    #             "doc_id":            doc_id,
    #             "doc_number":        doc_number,
    #             "display_label":     display_label,
    #             "file_name":         file.filename,
    #             "file_content_type": file.content_type,
    #             "file_b64":          base64.b64encode(content).decode("utf-8"),
    #             "email_text":        email_text,
    #             "stored_url":        stored_url,
    #             "storage_path":      storage_path,
    #             "supervisor_id":     supervisor_id,
    #         },
    #         task_id=task_id,
    #         queue="advanced_upload_queue",
    #     )
    # ─────────────────────────────────────────────────────────────────────

    return {
        "success":         True,
        "status":          "stored",
        "task_id":         None,  # PARSING DISABLED — no extraction task is created
        "doc_id":          doc_id,
        "case_id":         case_id,
        "file_name":       file.filename,
        "display_label":   display_label,
        "pdf_url":         stored_url,
        "storage_path":    storage_path,
        "extraction_mode": "none",
        "page_count":      page_count,
        "message":         f"'{file.filename}' stored ({page_count} page(s)).",
    }


@router.get("/web/advanced-upload/status/{task_id}")
async def get_advanced_upload_status(task_id: str, request: Request):
    _get_user(request)

    doc = await advanced_upload_tasks_col.find_one({"task_id": task_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Advanced upload task not found.")

    if isinstance(doc.get("created_at"), datetime):
        doc["created_at"] = doc["created_at"].isoformat()
    if isinstance(doc.get("updated_at"), datetime):
        doc["updated_at"] = doc["updated_at"].isoformat()

    return doc


@router.get("/web/advanced-upload/case-status/{case_id}")
async def get_case_advanced_upload_status(case_id: str, request: Request):
    _get_user(request)

    # Only surface document_extraction rows here — a "findings" row (from
    # /web/regenerate-findings) stuck at queued/processing must never count
    # toward this case's outstanding-document total or block "Review the
    # case" in the frontend. Legacy rows with no task_type are treated as
    # document_extraction, same convention as /active-tasks.
    # Exclude findings-only rows. task_type alone isn't reliable here because
    # older regenerate_findings rows predate that field entirely (missing,
    # not even null) and would slip through a task_type filter. doc_id is
    # the reliable discriminator instead: every document_extraction task
    # (current or legacy) always has a real doc_id; every findings task,
    # old or new, always has doc_id: null.
    cursor = advanced_upload_tasks_col.find(
        {
            "case_id": case_id,
            "doc_id": {"$ne": None},
        },
        {"_id": 0},
    ).sort("created_at", -1)
    tasks = await cursor.to_list(length=500)

    # A retry inserts a brand-new task row for the same doc_id instead of
    # updating the old (failed) row in place. Collapse to one row per
    # doc_id here — keep only the most recent task per document — so a
    # retried document doesn't show up twice (old failed + new result).
    latest_by_doc: Dict[str, Dict[str, Any]] = {}
    for t in tasks:  # already sorted created_at desc, so first hit wins
        key = t.get("doc_id") or t.get("task_id")
        if key not in latest_by_doc:
            latest_by_doc[key] = t
    tasks = list(latest_by_doc.values())
    tasks.sort(key=lambda t: t.get("created_at") or datetime.min.replace(tzinfo=IST), reverse=True)

    for t in tasks:
        if isinstance(t.get("created_at"), datetime):
            t["created_at"] = t["created_at"].isoformat()
        if isinstance(t.get("updated_at"), datetime):
            t["updated_at"] = t["updated_at"].isoformat()

    return {"success": True, "case_id": case_id, "tasks": tasks, "count": len(tasks)}


@router.post("/web/advanced-upload/retry/{task_id}")
async def retry_advanced_upload(task_id: str, request: Request):
    _get_user(request)

    old_task = await advanced_upload_tasks_col.find_one({"task_id": task_id})
    if not old_task:
        raise HTTPException(status_code=404, detail="Task not found.")
    if old_task.get("status") != "failed":
        raise HTTPException(status_code=400, detail="Only failed tasks can be retried.")

    case_id   = old_task["case_id"]
    doc_id    = old_task["doc_id"]
    file_name = old_task["file_name"]

    claim = await insurance_claims_col.find_one(
        {"caseId": case_id, "supportingDocuments.doc_id": doc_id},
        {"supportingDocuments.$": 1},
    )
    support_doc = ((claim or {}).get("supportingDocuments") or [{}])[0]
    stored_url = support_doc.get("pdf_url")
    if not stored_url:
        raise HTTPException(status_code=422, detail="Original file is no longer available for retry.")

    try:
        async with httpx.AsyncClient(timeout=60) as http:
            resp = await http.get(stored_url)
            resp.raise_for_status()
            content = resp.content
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not retrieve stored file: {exc}")

    new_task_id = f"advadv_{uuid.uuid4().hex}"
    now = datetime.now(IST)
    await advanced_upload_tasks_col.insert_one({
        "task_id":        new_task_id,
        "case_id":        case_id,
        "doc_id":         doc_id,
        "task_type":      "document_extraction",
        "file_name":      file_name,
        "display_label":  old_task.get("display_label"),
        "supervisor_id":  old_task.get("supervisor_id"),
        "status":         "queued",
        "result":         None,
        "error":          None,
        "total_pages":    old_task.get("total_pages"),
        "created_at":     now,
        "updated_at":     now,
    })
    celery_client.send_task(
        "advanced_upload.process_document",
        kwargs={
            "task_id":           new_task_id,
            "case_id":           case_id,
            "doc_id":            doc_id,
            "doc_number":        None,
            "display_label":     old_task.get("display_label"),
            "file_name":         file_name,
            "file_content_type": "application/pdf",
            "file_b64":          base64.b64encode(content).decode("utf-8"),
            "email_text":        None,
            "stored_url":        stored_url,
            "storage_path":      support_doc.get("storage_path"),
            "supervisor_id":     old_task.get("supervisor_id"),
        },
        task_id=new_task_id,
        queue="advanced_upload_queue",
    )

    return {"success": True, "task_id": new_task_id, "doc_id": doc_id, "status": "queued"}


EXTRACTION_EVENT_WINDOW_MINUTES = 15


@router.get("/web/advanced-upload/active-tasks")
async def get_active_advanced_upload_tasks(request: Request):
    _get_user(request)

    TERMINAL_STATUSES = ["success", "failed", "rejected"]
    # Only count DOCUMENT_EXTRACTION tasks toward "active" — a findings-only
    # recheck must never make the dashboard show "Extracting" for a case
    # whose actual document parsing finished long ago. Legacy rows inserted
    # before task_type existed have no such field; treat those as
    # document_extraction (their prior behavior) rather than silently
    # dropping them from the active count.
    # doc_id, not task_type, is the reliable discriminator — legacy
    # regenerate_findings rows predate the task_type field entirely
    # (missing, not even null) and would slip past a task_type filter.
    # Every document_extraction task, current or legacy, always has a real
    # doc_id; every findings task, old or new, always has doc_id: null.
    active_cursor = advanced_upload_tasks_col.find(
        {
            "status": {"$nin": TERMINAL_STATUSES},
            "doc_id": {"$ne": None},
        },
        {"_id": 0, "case_id": 1, "task_id": 1},
    )
    active_docs = await active_cursor.to_list(length=2000)

    counts: Dict[str, int] = {}
    for d in active_docs:
        cid = d.get("case_id")
        if not cid:
            continue
        counts[cid] = counts.get(cid, 0) + 1

    event_cutoff = datetime.now(IST) - timedelta(minutes=EXTRACTION_EVENT_WINDOW_MINUTES)
    # Same reasoning as the active-tasks filter above: only surface
    # document-extraction completions as "extraction finished/failed"
    # events. A findings-recheck completing is not an extraction event and
    # must not pop an "Extraction finished" toast or flip a case's badge.
    events_cursor = advanced_upload_tasks_col.find(
        {
            "status": {"$in": ["success", "failed"]},
            "updated_at": {"$gte": event_cutoff},
            "doc_id": {"$ne": None},
        },
        {"_id": 0},
    ).sort("updated_at", -1).limit(100)
    event_docs = await events_cursor.to_list(length=100)

    # Same dedup as case-status: a retry leaves the old failed row and the
    # new row both inside the event window. Keep only the newest per doc_id.
    latest_events_by_doc: Dict[str, Dict[str, Any]] = {}
    for d in event_docs:  # sorted updated_at desc, so first hit wins
        key = d.get("doc_id") or d.get("task_id")
        if key not in latest_events_by_doc:
            latest_events_by_doc[key] = d
    event_docs = list(latest_events_by_doc.values())

    event_case_ids = list({d["case_id"] for d in event_docs if d.get("case_id")})
    claims_map: Dict[str, Dict[str, Any]] = {}
    if event_case_ids:
        claims_cursor = insurance_claims_col.find(
            {"caseId": {"$in": event_case_ids}},
            {"_id": 0, "caseId": 1, "insurer": 1, "insurerRef": 1, "claimantName": 1},
        )
        claims_map = {c["caseId"]: c async for c in claims_cursor}

    events: List[Dict[str, Any]] = []
    for d in event_docs:
        cid = d.get("case_id")
        claim = claims_map.get(cid, {})
        result = d.get("result") or {}
        updated_at = d.get("updated_at")
        events.append({
            "task_id":       d.get("task_id"),
            "case_id":       cid,
            "doc_id":        d.get("doc_id"),
            "status":        d.get("status"),
            "file_name":     d.get("file_name"),
            "display_label": d.get("display_label"),
            "insurer":       claim.get("insurer"),
            "insurer_ref":   claim.get("insurerRef"),
            "claimant_name": claim.get("claimantName"),
            "fields_found":  result.get("fields_found") if isinstance(result, dict) else None,
            "error":         d.get("error"),
            "completed_at":  updated_at.isoformat() if isinstance(updated_at, datetime) else updated_at,
        })

    return {
        "success":         True,
        "active_case_ids": list(counts.keys()),
        "counts":          counts,
        "events":          events,
    }


@router.get("/web/case-documents/{case_id}")
async def get_case_documents(case_id: str, request: Request):
    """
    REWORKED: previously read the case_documents record. Now returns the
    equivalent view built entirely from insurance_claims_new, so any
    frontend caller expecting {case_id, documents, total_fields_found}
    still gets a sensible (if simpler) shape. supportingDocuments doubles
    as "documents" here since that's the only doc-history array left.
    """
    _get_user(request)

    claim = await insurance_claims_col.find_one(
        {"caseId": case_id},
        {"_id": 0, "caseId": 1, "supportingDocuments": 1, "docCounter": 1, "updatedAt": 1},
    )
    if not claim:
        return {
            "case_id":            case_id,
            "documents":          [],
            "total_fields_found": 0,
        }

    updated_at = claim.get("updatedAt")
    return {
        "case_id":            case_id,
        "documents":          claim.get("supportingDocuments", []),
        "total_fields_found": sum(d.get("fields_found", 0) for d in claim.get("supportingDocuments", [])),
        "updated_at":         updated_at.isoformat() if isinstance(updated_at, datetime) else updated_at,
    }
# ─── Claim Q&A chat ──────────────────────────────────────────────────────
_CHAT_SYSTEM_PROMPT = """You are answering an insurance investigator's questions about ONE \
claim, using ONLY the structured claim data and the raw parsed source documents given below. \
You must never invent, guess, or infer facts that are not explicitly present in the material \
given to you.

Rules:
1. If the answer is clearly present, answer it directly and concisely, and say which \
   document/page it came from if that's identifiable (e.g. "Discharge Summary, p.3").
2. If the SAME fact appears with two or more DIFFERENT values across the documents or fields \
   (e.g. two different ages, two different admission dates), do NOT pick one silently — say \
   explicitly that multiple/conflicting values were found, list each value and where it came \
   from, and let the investigator decide.
3. If the information is simply not present anywhere in the material given, say plainly that \
   it could not be found in the claim documents. Do not speculate.
4. If you are only partially confident (e.g. the text is ambiguous, poorly OCR'd, or requires \
   interpretation), say so explicitly rather than presenting a guess as fact.
5. Keep answers focused and concise — a few sentences, not a report.
6. Never fabricate a page number, file name, or quote you don't actually see below.
7. Write in plain text only. Do NOT use markdown formatting of any kind — no **bold**, no \
   bullet characters like * or -, no headers, no numbered lists. If you need to list several \
   values, separate them with commas or write them as plain sentences instead.

STRUCTURED CLAIM FIELDS (JSON):
{claim_fields_json}

RAW SOURCE DOCUMENTS (page-marked; may be truncated if very long):
{raw_markdown}
"""

# Conservative — the real model context window is 131072 tokens shared
# between prompt + completion, but our char/token estimate (chars/4) can
# undershoot on dense JSON and non-English text, which is exactly what
# caused the 400 context_length_exceeded seen in production. Budget well
# under the nominal window and, if the model still rejects it, retry with
# a progressively smaller slice of raw_markdown rather than failing outright.
_CHAT_CONTEXT_WINDOW_TOKENS = int(os.getenv("CHAT_CONTEXT_WINDOW_TOKENS", "131072"))
_CHAT_COMPLETION_MAX_TOKENS = int(os.getenv("CHAT_COMPLETION_MAX_TOKENS", "1200"))
_CHAT_SAFETY_MARGIN_TOKENS = 4000
_CHAT_CHARS_PER_TOKEN_ESTIMATE = 3.2  # conservative vs the usual chars/4 rule of thumb


def _build_chat_messages(question, history, claim_fields_json, raw_markdown, markdown_char_budget):
    truncated = len(raw_markdown) > markdown_char_budget
    raw_markdown_for_prompt = raw_markdown[:markdown_char_budget]
    if truncated:
        raw_markdown_for_prompt += (
            "\n\n[NOTE: document text was too long to include in full — this is a partial "
            "view. If the answer isn't visible above, say it could not be confirmed from the "
            "portion of the documents available, rather than assuming it's absent.]"
        )
    system_prompt = _CHAT_SYSTEM_PROMPT.format(
        claim_fields_json=claim_fields_json,
        raw_markdown=raw_markdown_for_prompt or "(no parsed documents yet for this case)",
    )
    messages = [{"role": "system", "content": system_prompt}]
    for m in history[-12:]:
        role = m.get("role")
        content = str(m.get("content", "")).strip()
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content[:4000]})
    messages.append({"role": "user", "content": question})
    return messages, truncated


@router.post("/web/doctor/case/{case_id}/chat")
async def chat_about_claim(case_id: str, request: Request):
    user = _get_user(request)  # auth only — no role restriction beyond existing doctor routes

    body = await request.json()
    question = (body.get("question") or "").strip()
    history = body.get("history") or []  # [{role: "user"|"assistant", content: str}, ...]
    if not question:
        raise HTTPException(status_code=400, detail="question is required.")
    if len(question) > 2000:
        raise HTTPException(status_code=400, detail="question is too long.")

    claim = await insurance_claims_col.find_one({"caseId": case_id}, {"_id": 0})
    if not claim:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found.")

    raw_markdown = claim.get("raw_llama_markdown") or ""
    claim_fields = {
        k: v for k, v in claim.items()
        if k not in ("raw_llama_markdown", "documentFindings", "supportingDocuments")
    }
    claim_fields_json = json.dumps(claim_fields, default=str)

    base_chars = len(_CHAT_SYSTEM_PROMPT) + len(claim_fields_json) + len(question)
    for m in history[-12:]:
        base_chars += len(str(m.get("content", "")))
    base_tokens = int(base_chars / _CHAT_CHARS_PER_TOKEN_ESTIMATE)
    available_tokens = (
        _CHAT_CONTEXT_WINDOW_TOKENS
        - _CHAT_COMPLETION_MAX_TOKENS
        - _CHAT_SAFETY_MARGIN_TOKENS
        - base_tokens
    )
    initial_budget = max(int(available_tokens * _CHAT_CHARS_PER_TOKEN_ESTIMATE), 3000)

    answer = None
    truncated = False
    last_error = None

    # Shrink the markdown slice on each retry — covers both a case whose
    # documents are just very large, and the estimate itself being wrong
    # for this particular content mix.
    for attempt_budget in (initial_budget, initial_budget // 3, 8000, 2500):
        messages, truncated = _build_chat_messages(
            question, history, claim_fields_json, raw_markdown, attempt_budget
        )
        try:
            completion = groq_client.chat.completions.create(
                model=FINDINGS_MODEL,
                temperature=0,
                max_tokens=_CHAT_COMPLETION_MAX_TOKENS,
                messages=messages,
            )
            answer = (completion.choices[0].message.content or "").strip()
            last_error = None
            break
        except Exception as e:
            last_error = e
            msg = str(e).lower()
            if "context_length_exceeded" in msg or "reduce the length" in msg:
                logger.warning(
                    "Claim chat for case %s hit context limit at budget=%d chars, retrying smaller",
                    case_id, attempt_budget,
                )
                continue
            logger.error("Claim chat failed for case %s: %s", case_id, e)
            raise HTTPException(status_code=502, detail="Chat model request failed. Try again.")

    if answer is None:
        logger.error(
            "Claim chat gave up for case %s after shrinking context repeatedly: %s",
            case_id, last_error,
        )
        raise HTTPException(
            status_code=502,
            detail="This case's documents are too large to answer right now. Try a more specific question.",
        )

    if not answer:
        answer = "I couldn't generate an answer — please try rephrasing the question."

    return {"success": True, "case_id": case_id, "answer": answer, "truncated_context": truncated}

@router.post("/web/regenerate-findings/{case_id}")
async def regenerate_findings(case_id: str, request: Request):
    """
    ASYNC now: enqueues the map-reduce findings pass (PED / billing /
    coverage / identity / timeline / doctor-facility / other-suspicious)
    as a Celery task instead of running it inline. The previous synchronous
    version could exceed Cloudflare's 524 origin timeout on large cases —
    the pipeline would finish and persist findings server-side, but the
    client would never see a response. Frontend now polls
    /web/advanced-upload/status/{task_id} (reused as-is; it's generic over
    any advanced_upload_tasks_col row, not advanced-upload-specific)
    until status is "success" or "failed".
    """
    _get_user(request)

    claim = await insurance_claims_col.find_one(
        {"caseId": case_id}, {"_id": 0, "raw_llama_markdown": 1}
    )
    if not claim:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found.")

    raw_markdown = claim.get("raw_llama_markdown") or ""
    if not raw_markdown.strip():
        raise HTTPException(status_code=422, detail="No parsed document text available for this case yet.")

    task_id = f"findings_{uuid.uuid4().hex}"
    now = datetime.now(IST)
    await advanced_upload_tasks_col.insert_one({
        "task_id":        task_id,
        "case_id":        case_id,
        "doc_id":         None,
        "task_type":      "findings",  # NOT document_extraction — must not flip the
                                         # dashboard's "Extracting" badge for a case whose
                                         # documents already finished parsing long ago
        "file_name":      "Findings regeneration",
        "display_label":  "Findings regeneration",
        "supervisor_id":  None,
        "status":         "queued",
        "result":         None,
        "error":          None,
        "total_pages":    None,
        "created_at":     now,
        "updated_at":     now,
    })

    celery_client.send_task(
        "regenerate_findings.run",
        kwargs={"task_id": task_id, "case_id": case_id},
        task_id=task_id,
        queue="advanced_upload_queue",
    )

    return {
        "success": True,
        "status": "queued",
        "task_id": task_id,
        "case_id": case_id,
        "message": "Findings regeneration queued.",
    }


@router.patch("/web/case-documents/{case_id}/form-save")
async def save_form_to_draft(case_id: str, request: Request):
    """
    REWORKED: writes straight onto insurance_claims_new now — there's no
    separate staging collection anymore. Each top-level key in the posted
    payload is fully replaced (matches the previous "whole blob" semantics
    of case_documents.merged_extracted_data).
    """
    _get_user(request)

    body       = await request.json()
    new_merged = body.get("merged_extracted_data")

    if not isinstance(new_merged, dict):
        raise HTTPException(status_code=400, detail="merged_extracted_data must be a JSON object.")

    now = datetime.now(IST)
    payload = dict(new_merged)
    payload["updatedAt"] = now

    result = await insurance_claims_col.update_one(
        {"caseId": case_id},
        {"$set": payload},
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found.")

    return {
        "success":  True,
        "case_id":  case_id,
        "message":  "Draft form data saved.",
        "saved_at": now.isoformat(),
    }


@router.get("/web/llama-credit-status")
async def get_llama_credit_status():
    stats_doc = await llama_stats_col.find_one({"_id": "global_total"}) or {}
    used = stats_doc.get("credits_used", 0)
    percent = round((used / LLAMA_CREDIT_BUDGET) * 100, 1) if LLAMA_CREDIT_BUDGET else 0
    return {
        "credits_used": used,
        "credit_budget": LLAMA_CREDIT_BUDGET,
        "percent_used": percent,
        "warning": percent >= 90,
    }


@router.get("/web/check-file-ingested/{case_id}")
async def check_file_ingested(case_id: str, filename: str, request: Request):
    _get_user(request)
    claim = await insurance_claims_col.find_one(
        {"caseId": case_id}, {"ingested_files": 1}
    )
    ingested = set((claim or {}).get("ingested_files") or [])
    return {"already_uploaded": filename in ingested}


@router.get("/web/check-processing-status/{case_id}")
async def check_processing_status(case_id: str, filename: str, request: Request):
    """
    UNCHANGED logic, flagged not fixed: this reads "processing_locks", but
    the worker only ever writes "processing_files" (plain array, no
    started_at). These two fields have likely never matched — this endpoint
    has probably always reported "idle" even mid-processing. Confirm
    whether you want that fixed as a follow-up; left untouched here since
    it's unrelated to the case_documents removal.
    """
    _get_user(request)

    claim = await insurance_claims_col.find_one(
        {"caseId": case_id}, {"ingested_files": 1, "processing_locks": 1}
    )
    if not claim:
        return {"status": "idle"}

    if filename in set(claim.get("ingested_files") or []):
        return {"status": "done"}

    now = datetime.now(IST)
    stale_cutoff = now - timedelta(seconds=PROCESSING_LOCK_STALE_SECONDS)

    lock_entry = next(
        (l for l in (claim.get("processing_locks") or []) if l.get("filename") == filename),
        None,
    )

    if lock_entry:
        started_at = lock_entry.get("started_at")
        if isinstance(started_at, datetime) and started_at >= stale_cutoff:
            return {"status": "processing", "started_at": started_at.isoformat()}
        await insurance_claims_col.update_one(
            {"caseId": case_id},
            {"$pull": {"processing_locks": {"filename": filename}}},
        )

    return {"status": "idle"}


@router.post("/web/create-draft-case")
async def create_draft_case():
    """Create a DRAFT entry in insurance_claims_new. Unchanged."""
    case_id = f"CIMS-{uuid.uuid4().hex[:8].upper()}"
    result  = await insurance_claims_col.insert_one({
        "caseId":    case_id,
        "status":    "DRAFT",
        "createdAt": datetime.now(IST),
        "updatedAt": datetime.now(IST),
    })
    return {
        "success": True,
        "caseId":  case_id,
        "id":      str(result.inserted_id),
    }


# ═══════════════════════════════════════════════════════════════════════════
# MOBILE ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/api/app/my-cases")
async def get_my_cases(request: Request):
    """
    REWORKED: previously joined case_documents (supervisor_id, doc_count,
    display_labels, last_upload) with insurance_claims_new. Now everything
    comes from insurance_claims_new alone — supervisorId is stamped by
    _reserve_doc_number() on first upload, doc_count/display_labels are
    derived from supportingDocuments.
    """
    user          = _get_user(request)
    supervisor_id = user["user_id"]

    cursor = insurance_claims_col.find(
        {"supervisorId": supervisor_id},
        {
            "_id": 0, "caseId": 1, "claimantName": 1, "insurer": 1, "status": 1,
            "claimPriority": 1, "claimedAmount": 1, "tags": 1, "supportingDocuments": 1,
            "updatedAt": 1,
        },
    ).sort("updatedAt", -1).limit(200)
    records = await cursor.to_list(length=200)

    result = []
    for r in records:
        docs = r.get("supportingDocuments", [])
        updated_at = r.get("updatedAt")
        result.append({
            "case_id":        r["caseId"],
            "doc_count":      len(docs),
            "display_labels": [d.get("display_label") for d in docs],
            "last_upload":    updated_at.isoformat() if isinstance(updated_at, datetime) else updated_at,
            "claimantName":   r.get("claimantName", "—"),
            "insurer":        r.get("insurer", "—"),
            "status":         r.get("status", "—"),
            "claimPriority":  r.get("claimPriority", "Normal"),
            "claimedAmount":  r.get("claimedAmount"),
            "tags":           r.get("tags", []),
        })

    return {"status": "success", "cases": result, "count": len(result)}