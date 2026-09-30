"""
Agentic Longitudinal Summary
============================

Standalone backend for the longitudinal patient journey.

Design:
- The RAW incoming event/document is the canonical source of truth.
- Every incoming event is persisted ATOMICALLY as its own document in a
  dedicated source-events collection, keyed by (patient_id, event_id).
  Two concurrent uploads can therefore never overwrite one another.
- The generated longitudinal output is a MATERIALIZED VIEW over canonical
  source events. The raw source history is always authoritative.
- Normal events update only the affected visit and dependent later cumulative
  snapshots; unchanged historical visits are retained.
- A full rebuild is available explicitly for deletion, migration, or recovery.
- No facts / measurements / entities / statements / observation layer.
  Each event keeps its complete raw text, and the section agents read it.
- One lightweight LLM classification agent adds document_type / title only.
- Appointment dates are used only for deterministic visit assignment.
- Multiple appointments on the same calendar date are one longitudinal visit.
- Six independent section agents run over the same raw journey.
- Numeric comparison stays deterministic: the Trends agent may surface series
  from the raw journey, and Python computes the deltas.
- Uses GROQ_API_KEY and GROQ_MODEL=openai/gpt-oss-120b.

Nothing in this file is disease, cancer-type, specialty, organ, modality or
keyword specific.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import os
import re
import unicodedata
from datetime import date, datetime
from typing import Any, Dict, List, Optional, TypedDict

from fastapi import APIRouter, HTTPException
from groq import Groq
from langgraph.graph import END, StateGraph
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field


# ============================================================================
# CONFIG
# ============================================================================

MONGO_URI = os.getenv("MONGO_URI", "")
MONGO_DB = os.getenv("MONGO_DB", "")

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")

# ============================================================================
# GROQ CONCURRENCY / RATE LIMIT CONTROL
# ============================================================================

MAX_CONCURRENT_GROQ_CALLS = int(
    os.getenv("MAX_CONCURRENT_GROQ_CALLS", "2")
)

GROQ_MIN_REQUEST_INTERVAL = float(
    os.getenv("GROQ_MIN_REQUEST_INTERVAL", "0.0")
)

_groq_semaphore = asyncio.Semaphore(MAX_CONCURRENT_GROQ_CALLS)

_groq_rate_lock = asyncio.Lock()

_groq_last_request_time = 0.0

LONGITUDINAL_COLLECTION = os.getenv(
    "LONGITUDINAL_SUMMARY_COLLECTION",
    "longitudinal_summary",
)

# NEW: canonical raw source-event history.
SOURCE_EVENTS_COLLECTION = os.getenv(
    "LONGITUDINAL_SOURCE_EVENTS_COLLECTION",
    "longitudinal_source_events",
)

APPOINTMENTS_COLLECTION = os.getenv(
    "PATIENT_APPOINTMENTS_COLLECTION",
    "patient_appointments",
)

# Generic text chunking, used ONLY by the classification agent so a long
# document is still fully examined. It never truncates and never discards
# text, and the raw text itself is always stored unmodified.
CLASSIFICATION_CHUNK_CHARS = int(
    os.getenv("LONGITUDINAL_CLASSIFICATION_CHUNK_CHARS", "24000")
)
CLASSIFICATION_CHUNK_OVERLAP = int(
    os.getenv("LONGITUDINAL_CLASSIFICATION_CHUNK_OVERLAP", "500")
)

# Safety limit for how much raw text is handed to each section agent per
# event. This is a model-context guard only, not a content rule.
AGENT_EVENT_TEXT_CHARS = int(
    os.getenv("LONGITUDINAL_AGENT_EVENT_TEXT_CHARS", "40000")
)

if not MONGO_URI:
    logger.warning("MONGO_URI is not configured")

if not MONGO_DB:
    logger.warning("MONGO_DB is not configured")

if not GROQ_API_KEY:
    logger.warning("GROQ_API_KEY is not configured")

mongo_client = AsyncIOMotorClient(MONGO_URI)
db = mongo_client[MONGO_DB]

longitudinal_collection = db[LONGITUDINAL_COLLECTION]
source_events_collection = db[SOURCE_EVENTS_COLLECTION]
patient_appointments_collection = db[APPOINTMENTS_COLLECTION]

router = APIRouter()


# ============================================================================
# MODELS
# ============================================================================

class LongitudinalEventRequest(BaseModel):
    patient_id: str
    doctor_id: Optional[str] = None
    event_id: str

    event_date: Optional[str] = None
    appointment_date: Optional[str] = None
    appointment_id: Optional[str] = None

    source: Optional[str] = None

    payload: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class LongitudinalState(TypedDict, total=False):
    input: Dict[str, Any]

    patient_id: Optional[str]
    doctor_id: Optional[str]

    incoming_event: Dict[str, Any]
    source_events: List[Dict[str, Any]]
    appointments: List[Dict[str, Any]]

    visits: List[Dict[str, Any]]
    deterministic_trends: Dict[str, Any]
    sections: Dict[str, Any]
    final_data: Dict[str, Any]

    existing_record: Optional[Dict[str, Any]]

    # Canonical source-history revision captured for this build.
    # Used to prevent an older in-flight build from overwriting a newer
    # materialized longitudinal view when concurrent events arrive.
    source_revision: Optional[str]
    stale_build: bool


# ============================================================================
# GENERIC UTILITIES
# ============================================================================

def deep_copy(value: Any) -> Any:
    return copy.deepcopy(value)


def json_signature(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            default=str,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def unique_append(target: List[Any], value: Any) -> None:
    signature = json_signature(value)

    for existing in target:
        if json_signature(existing) == signature:
            return

    target.append(deep_copy(value))




_PROVENANCE_KEYS = {
    "event_id",
    "event_ids",
    "source_event_id",
    "source_event_ids",
    "document_id",
    "source",
    "file_name",
    "evidence_id",
    "source_id",
    "evidence",
    "document_date",
    "created_at",
    "updated_at",
    "appointment_id",
    "appointment_ids",
}


def normalize_dedupe_text(value: Any) -> str:
    """
    Normalize a value ONLY for duplicate comparison (output is never changed).
    Character-level normalization only: unicode form, dash/quote variants,
    case, whitespace, trailing sentence punctuation.
    """
    if value is None:
        return ""

    text = unicodedata.normalize("NFKC", str(value))

    text = "".join(
        "-" if (unicodedata.category(ch) == "Pd" or ch == "\u2212") else ch
        for ch in text
    )

    for src, dst in (
        ("\u2018", "'"),
        ("\u2019", "'"),
        ("\u201c", '"'),
        ("\u201d", '"'),
    ):
        text = text.replace(src, dst)

    text = " ".join(text.casefold().split())

    return text.rstrip(" .;,:")


def _is_empty_value(value: Any) -> bool:
    return value is None or value == "" or value == [] or value == {}


def _signature_value(item: Any) -> Any:
    """
    Provenance keys and empty values are ignored, so the same fact cited by
    different events, or with/without an empty field, compares as equal.
    """
    if isinstance(item, dict):
        normalized: Dict[str, Any] = {}

        for key, value in item.items():
            if key in _PROVENANCE_KEYS:
                continue

            sig = _signature_value(value)

            if _is_empty_value(sig):
                continue

            normalized[str(key)] = sig

        return normalized

    if isinstance(item, list):
        parts = [_signature_value(v) for v in item]
        parts = [p for p in parts if not _is_empty_value(p)]

        return sorted(
            parts,
            key=lambda p: json.dumps(
                p, sort_keys=True, ensure_ascii=False
            ),
        )

    return normalize_dedupe_text(item)


def semantic_item_signature(item: Any) -> str:
    return json.dumps(
        _signature_value(item),
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )


def _leaf_values(item: Any, out: Optional[set] = None) -> set:
    """All normalized scalar values of an item, ignoring key names."""
    out = set() if out is None else out

    if isinstance(item, dict):
        for key, value in item.items():
            if key not in _PROVENANCE_KEYS:
                _leaf_values(value, out)

    elif isinstance(item, list):
        for value in item:
            _leaf_values(value, out)

    else:
        text = normalize_dedupe_text(item)
        if text:
            out.add(text)

    return out


def dedupe_list(items: Any) -> Any:
    """
    1) Remove exact semantic duplicates (keeps first occurrence).
    2) Remove an object whose values are all contained in another object
       (same fact with fewer fields, or the same values under different
       key names, e.g. `date` vs `administration_date`).

    Two items that differ in ANY value (date, visit, dose, site, status...)
    are never merged.
    """

    if not isinstance(items, list):
        return items

    unique: List[Any] = []
    seen = set()

    for item in items:
        sig_value = _signature_value(item)

        if _is_empty_value(sig_value):
            continue

        sig = json.dumps(
            sig_value,
            sort_keys=True,
            ensure_ascii=False,
            separators=(",", ":"),
        )

        if sig in seen:
            continue

        seen.add(sig)
        unique.append(item)

    leaves = {
        index: _leaf_values(item)
        for index, item in enumerate(unique)
        if isinstance(item, dict)
    }

    dropped = set()

    for i, li in leaves.items():
        if len(li) < 2:
            continue

        for j, lj in leaves.items():
            if i == j or j in dropped:
                continue

            if li < lj or (li == lj and j < i):
                dropped.add(i)
                break

    return [
        item
        for index, item in enumerate(unique)
        if index not in dropped
    ]


def dedupe_section_output(value: Any) -> Any:
    """
    Recursively remove duplicate items from every nested list
    inside an agent section.

    This is completely generic.
    """

    if isinstance(value, dict):

        return {
            key: dedupe_section_output(child)
            for key, child in value.items()
        }

    if isinstance(value, list):

        cleaned = [
            dedupe_section_output(item)
            for item in value
        ]

        return dedupe_list(cleaned)

    return value


def parse_date(value: Any) -> Optional[date]:
    if value is None:
        return None

    if isinstance(value, datetime):
        return value.date()

    if isinstance(value, date):
        return value

    if isinstance(value, str):
        value = value.strip()

        if not value:
            return None

        try:
            return datetime.fromisoformat(
                value.replace("Z", "+00:00")
            ).date()
        except Exception:
            pass

        for fmt in (
            "%Y-%m-%d",
            "%d-%m-%Y",
            "%d/%m/%Y",
            "%Y/%m/%d",
            "%d.%m.%Y",
        ):
            try:
                return datetime.strptime(value, fmt).date()
            except Exception:
                pass

    return None


def normalize_date(value: Any) -> Optional[str]:
    parsed = parse_date(value)
    return parsed.isoformat() if parsed else None


def make_visit_id(
    patient_id: str,
    visit_number: int,
    visit_date: str,
) -> str:
    raw = f"{patient_id}:{visit_number}:{visit_date}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:20]


def split_complete_text(
    text: str,
    chunk_chars: int = CLASSIFICATION_CHUNK_CHARS,
    overlap: int = CLASSIFICATION_CHUNK_OVERLAP,
) -> List[Dict[str, Any]]:
    """
    Split text only because an LLM request has a finite context.

    - The complete input is covered.
    - No prefix/suffix truncation is performed.
    - Chunking has no knowledge of any clinical concept.
    """

    if not text:
        return [
            {
                "chunk_index": 0,
                "start": 0,
                "end": 0,
                "text": "",
            }
        ]

    if chunk_chars <= 0:
        raise ValueError("chunk_chars must be positive")

    overlap = max(0, min(overlap, chunk_chars - 1))

    chunks: List[Dict[str, Any]] = []
    start = 0
    index = 0
    text_length = len(text)

    while start < text_length:
        end = min(start + chunk_chars, text_length)

        chunks.append(
            {
                "chunk_index": index,
                "start": start,
                "end": end,
                "text": text[start:end],
            }
        )

        if end >= text_length:
            break

        next_start = end - overlap

        if next_start <= start:
            next_start = end

        start = next_start
        index += 1

    return chunks


# ============================================================================
# GROQ
# ============================================================================

def _groq_client() -> Groq:
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not configured")

    return Groq(
        api_key=GROQ_API_KEY,
        max_retries=0,
    )


async def groq_json(
    system_prompt: str,
    user_payload: Any,
    max_tokens: int = 10000,
    retries: int = 2,
) -> Dict[str, Any]:

    async def call_once(use_json_mode: bool) -> Dict[str, Any]:

        def call() -> Dict[str, Any]:
            client = _groq_client()

            kwargs: Dict[str, Any] = {
                "model": GROQ_MODEL,
                "temperature": 0.0,
                "max_tokens": max_tokens,
                "messages": [
                    {
                        "role": "system",
                        "content": system_prompt,
                    },
                    {
                        "role": "user",
                        "content": json.dumps(
                            user_payload,
                            default=str,
                            ensure_ascii=False,
                        ),
                    },
                ],
            }

            if use_json_mode:
                kwargs["response_format"] = {
                    "type": "json_object"
                }

            response = client.chat.completions.create(
                **kwargs
            )

            content = response.choices[0].message.content

            if not content:
                raise ValueError(
                    "Groq returned empty content"
                )

            try:
                return json.loads(content)

            except json.JSONDecodeError:
                start = content.find("{")
                end = content.rfind("}")

                if start >= 0 and end > start:
                    return json.loads(
                        content[start:end + 1]
                    )

                raise

        return await asyncio.to_thread(call)

    last_error: Optional[Exception] = None

    for attempt in range(retries + 1):

        try:

            async with _groq_semaphore:

                global _groq_last_request_time

                async with _groq_rate_lock:

                    now = asyncio.get_running_loop().time()

                    elapsed = (
                        now - _groq_last_request_time
                    )

                    if (
                        elapsed
                        < GROQ_MIN_REQUEST_INTERVAL
                    ):
                        await asyncio.sleep(
                            GROQ_MIN_REQUEST_INTERVAL
                            - elapsed
                        )

                    _groq_last_request_time = (
                        asyncio.get_running_loop().time()
                    )

                return await call_once(
                    use_json_mode=True
                )

        except Exception as exc:

            last_error = exc

            error_text = str(exc)

            logger.error(
                "Groq JSON attempt %s/%s failed: %s",
                attempt + 1,
                retries + 1,
                error_text,
            )

            if "429" in error_text:

                retry_seconds = 15.0

                match = re.search(
                    r"try again in\s+([0-9.]+)s",
                    error_text,
                    flags=re.IGNORECASE,
                )

                if match:
                    try:
                        retry_seconds = (
                            float(match.group(1)) + 2.0
                        )
                    except Exception:
                        pass

                retry_seconds = max(
                    retry_seconds,
                    15.0 * (2 ** attempt),
                )

                retry_seconds = min(
                    retry_seconds,
                    120.0,
                )

                logger.warning(
                    "Groq rate limit reached. "
                    "Waiting %.1f seconds before retry.",
                    retry_seconds,
                )

                await asyncio.sleep(
                    retry_seconds
                )

                continue

            await asyncio.sleep(
                min(
                    2 ** attempt,
                    8,
                )
            )

    logger.error(
        "Groq JSON generation permanently failed: %s",
        last_error,
    )

    return {
        "_agent_status": "failed",
        "_error": str(last_error),
    }


# ============================================================================
# DOCUMENT CLASSIFICATION AGENT (the ONLY preprocessing agent)
# ============================================================================

DOCUMENT_CLASSIFICATION_PROMPT = """
You are a generic Document Classification Agent for a longitudinal clinical
information system.

Identify what kind of document/event the supplied source represents.

You must infer the document type from the supplied content itself.

Do NOT use keyword rules.
Do NOT use predefined mappings.
Do NOT assume a disease, cancer type, organ or specialty.
Do NOT assume a fixed list of clinical document types.
Do NOT extract clinical content. Classification only.

Return concise JSON with exactly these top-level fields:

{
  "document_family": "...",
  "document_type": "...",
  "document_type_name": "...",
  "title": "...",
  "date_candidates": [],
  "confidence": 0.0
}

document_type_name should be the human-readable name that can be displayed
beside the uploaded document.

Do not invent a document type that is unsupported by the source.

If the source does not contain enough evidence, use "Unknown" rather than
guessing.

Return JSON only.
"""

CLASSIFICATION_SYNTHESIS_PROMPT = """
You are the final Document Classification Agent.

Several classification agents examined different portions of ONE complete
source document.

Combine their observations into ONE classification.

Use only evidence contained in the supplied classification results.
Do not invent a type.
Do not apply hardcoded disease or specialty rules.

Return:

{
  "document_family": "...",
  "document_type": "...",
  "document_type_name": "...",
  "title": "...",
  "date_candidates": [],
  "confidence": 0.0
}

Return JSON only.
"""


def unknown_classification(status: str = "failed") -> Dict[str, Any]:
    return {
        "document_family": "Unknown",
        "document_type": "Unknown",
        "document_type_name": "Unknown",
        "title": None,
        "date_candidates": [],
        "confidence": 0.0,
        "agent_status": status,
    }


async def classify_document(document_text: str) -> Dict[str, Any]:
    """
    Lightweight, content-driven classification.

    Never raises. A failed classification must NOT stop the raw document from
    being stored, because the raw text is the source of truth.
    """

    if not (document_text or "").strip():
        return unknown_classification("empty_source")

    try:
        chunks = split_complete_text(document_text)

        chunk_results = await asyncio.gather(
            *[
                groq_json(
                    DOCUMENT_CLASSIFICATION_PROMPT,
                    {
                        "chunk_index": chunk["chunk_index"],
                        "source_text": chunk["text"],
                    },
                    max_tokens=3200,
                    retries=1,
                )
                for chunk in chunks
            ],
            return_exceptions=True,
        )

        usable: List[Dict[str, Any]] = []

        for index, result in enumerate(chunk_results):
            if isinstance(result, Exception):
                logger.error(
                    "Document classification chunk {} failed: {}",
                    index,
                    result,
                )
                continue

            if (
                isinstance(result, dict)
                and result.get("_agent_status") != "failed"
            ):
                usable.append(result)

        if not usable:
            return unknown_classification()

        if len(usable) == 1:
            return usable[0]

        return await groq_json(
            CLASSIFICATION_SYNTHESIS_PROMPT,
            {"chunk_classifications": usable},
            max_tokens=3500,
            retries=2,
        )

    except Exception as exc:
        logger.error("Document classification failed: {}", exc)
        return unknown_classification()


# ============================================================================
# CANONICAL SOURCE-HISTORY REVISION
# ============================================================================

def source_history_revision(
    source_events: List[Dict[str, Any]],
) -> str:
    """
    Stable content revision for the complete patient source history.

    Mongo bookkeeping timestamps are intentionally ignored. Retrying an
    unchanged event therefore does not manufacture a new revision.
    """

    canonical_events: List[Dict[str, Any]] = []

    for event in source_events or []:
        if not isinstance(event, dict):
            continue

        canonical_events.append(
            {
                "event_id": event.get("event_id"),
                "document_id": event.get("document_id"),
                "patient_id": event.get("patient_id"),
                "doctor_id": event.get("doctor_id"),
                "source": event.get("source"),
                "file_name": event.get("file_name"),
                "document_date": event.get("document_date"),
                "event_date": event.get("event_date"),
                "appointment_date": event.get("appointment_date"),
                "appointment_id": event.get("appointment_id"),
                "document_text": event.get("document_text") or "",
                "payload": event.get("payload") or {},
                "metadata": event.get("metadata") or {},
                "document_classification": (
                    event.get("document_classification") or {}
                ),
            }
        )

    canonical_events.sort(
        key=lambda item: (
            str(item.get("event_id") or ""),
            str(item.get("document_id") or ""),
        )
    )

    return json_signature(canonical_events)


# ============================================================================
# APPOINTMENTS
# ============================================================================

async def load_patient_appointments(
    patient_id: str,
) -> List[Dict[str, Any]]:

    record = await patient_appointments_collection.find_one(
        {"sys_user_id": patient_id},
        {"_id": 0},
    )

    if not record:
        return []

    raw = record.get("appointments") or []

    result = []

    for appointment in raw:
        if not isinstance(appointment, dict):
            continue

        dt = parse_date(appointment.get("date"))

        if dt is None:
            continue

        result.append({"appointment": appointment, "date": dt})

    result.sort(key=lambda x: x["date"])

    return [item["appointment"] for item in result]


def determine_visit(
    event_date: str,
    appointments: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Deterministic appointment-date visit assignment.

    VISIT IDENTITY:
    - patient + normalized calendar date
    - doctor_id NEVER creates a separate visit
    - appointment_id NEVER creates a separate visit
    - multiple appointments/events on one calendar date are one visit

    If an event date exactly matches an appointment date, that exact date is
    used. Otherwise the existing appointment-date behavior is retained:
    the event attaches to the first appointment date on/after its source date;
    events after the final appointment belong to the final visit.
    """

    event_dt = parse_date(event_date)

    if event_dt is None:
        raise ValueError(
            "The incoming longitudinal event does not contain a usable date."
        )

    appointment_rows = []

    for appointment in appointments:
        if not isinstance(appointment, dict):
            continue

        dt = parse_date(appointment.get("date"))

        if dt is not None:
            appointment_rows.append((dt, appointment))

    if not appointment_rows:
        return {
            "visit_number": None,
            "appointment_date": event_dt.isoformat(),
            "appointment_ids": [],
            "visit_start_date": event_dt.isoformat(),
            "visit_end_date": None,
        }

    grouped: Dict[str, Dict[str, Any]] = {}

    for dt, appointment in appointment_rows:
        key = dt.isoformat()

        group = grouped.setdefault(
            key,
            {
                "date": dt,
                "appointment_ids": [],
                "appointments": [],
            },
        )

        appointment_id = appointment.get("appointment_id")

        if (
            appointment_id is not None
            and appointment_id not in group["appointment_ids"]
        ):
            group["appointment_ids"].append(appointment_id)

        group["appointments"].append(appointment)

    unique_dates = sorted(
        grouped.values(),
        key=lambda x: x["date"],
    )

    # Exact calendar-date match: all doctors, appointments and events on this
    # date belong to the same longitudinal visit.
    exact_key = event_dt.isoformat()

    if exact_key in grouped:
        chosen = grouped[exact_key]

        next_group = next(
            (
                group
                for group in unique_dates
                if group["date"] > event_dt
            ),
            None,
        )

        return {
            "visit_number": None,
            "appointment_date": exact_key,
            "appointment_ids": chosen["appointment_ids"],
            "visit_start_date": exact_key,
            "visit_end_date": (
                next_group["date"].isoformat()
                if next_group
                else None
            ),
        }

    # Preserve the original appointment-date behavior for event dates that
    # do not exactly match an appointment.
    chosen_index = None

    for index, group in enumerate(unique_dates):
        if event_dt < group["date"]:
            chosen_index = index
            break

    if chosen_index is None:
        chosen_index = len(unique_dates) - 1

    chosen = unique_dates[chosen_index]

    next_group = (
        unique_dates[chosen_index + 1]
        if chosen_index + 1 < len(unique_dates)
        else None
    )

    return {
        "visit_number": None,
        "appointment_date": chosen["date"].isoformat(),
        "appointment_ids": chosen["appointment_ids"],
        "visit_start_date": chosen["date"].isoformat(),
        "visit_end_date": (
            next_group["date"].isoformat()
            if next_group
            else None
        ),
    }


# ============================================================================
# CANONICAL SOURCE-EVENT STORE  (concurrency-safe)
# ============================================================================

_source_index_ready = False


async def ensure_source_event_index() -> None:
    """
    (patient_id, event_id) must be unique so a retried or duplicated trigger
    updates the same row instead of creating a second copy.
    """

    global _source_index_ready

    if _source_index_ready:
        return

    try:
        await source_events_collection.create_index(
            [("patient_id", 1), ("event_id", 1)],
            unique=True,
            name="patient_event_unique",
        )
        await source_events_collection.create_index(
            [("patient_id", 1), ("document_date", 1)],
            name="patient_date",
        )
    except Exception as exc:
        logger.warning("Source event index creation skipped: {}", exc)

    _source_index_ready = True


async def save_source_event(event: Dict[str, Any]) -> None:
    """
    Atomically persist ONE raw event.

    Each event is its own Mongo document, so two concurrent uploads write to
    two different rows. There is no read-modify-write of a shared array and
    therefore no last-write-wins data loss.
    """

    await ensure_source_event_index()

    patient_id = event["patient_id"]
    event_id = event["event_id"]

    now = datetime.utcnow().isoformat()

    payload = deep_copy(event)
    payload["updated_at"] = now

    await source_events_collection.update_one(
        {
            "patient_id": patient_id,
            "event_id": event_id,
        },
        {
            "$set": payload,
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )

    logger.info(
        "LONGITUDINAL SOURCE EVENT SAVED | patient={} event_id={} "
        "file={} date={} chars={}",
        patient_id,
        event_id,
        event.get("file_name"),
        event.get("document_date"),
        len(event.get("document_text") or ""),
    )


async def load_source_events(
    patient_id: str,
    doctor_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Read the fresh canonical history.

    Longitudinal history is patient-wide. doctor_id is retained in the
    signature for backward compatibility but MUST NOT filter the history.
    """

    await ensure_source_event_index()

    query: Dict[str, Any] = {
        "patient_id": patient_id,
    }

    cursor = source_events_collection.find(
        query,
        {"_id": 0},
    )

    events = await cursor.to_list(length=None)

    def sort_key(item: Dict[str, Any]):
        return (
            normalize_date(item.get("document_date"))
            or normalize_date(item.get("event_date"))
            or normalize_date(item.get("appointment_date"))
            or "9999-12-31",
            str(item.get("created_at") or ""),
            str(item.get("event_id") or ""),
        )

    events.sort(key=sort_key)

    logger.info(
        "LONGITUDINAL SOURCE HISTORY LOADED | patient={} events={} ids={}",
        patient_id,
        len(events),
        [item.get("event_id") for item in events],
    )

    return events


# ============================================================================
# VISIT CONSTRUCTION  (always rebuilt from the complete source history)
# ============================================================================

def create_visit(
    patient_id: str,
    visit_number: int,
    visit_date: str,
    appointment_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:

    return {
        "patient_id": patient_id,
        "visit_id": make_visit_id(patient_id, visit_number, visit_date),
        "visit_number": visit_number,
        "visit_date": visit_date,
        "status": "Current",
        "appointment": {
            "appointment_date": visit_date,
            "appointment_ids": appointment_ids or [],
            "visit_start_date": visit_date,
            "visit_end_date": None,
        },
        "events": [],
        "event_count": 0,
    }


def build_visit_event(
    event: Dict[str, Any],
    visit_info: Dict[str, Any],
) -> Dict[str, Any]:
    """
    The event as it appears inside a visit.

    Exactly one entry per incoming appointment/document. The complete raw
    text is preserved. No facts / measurements / entities / statements.
    """

    appointment_ids = visit_info.get("appointment_ids") or []

    return {
        "event_id": event.get("event_id"),
        "patient_id": event.get("patient_id"),
        "doctor_id": event.get("doctor_id"),
        "document_id": event.get("document_id") or event.get("event_id"),
        "source": event.get("source"),
        "file_name": event.get("file_name"),
        "document_date": normalize_date(event.get("document_date")),
        "event_date": normalize_date(
            event.get("event_date") or event.get("document_date")
        ),
        "appointment_date": visit_info.get("appointment_date"),
        "appointment_id": appointment_ids[0] if appointment_ids else None,
        "appointment_ids": appointment_ids,
        "document_classification": event.get("document_classification")
        or unknown_classification("not_classified"),
        # RAW SOURCE — untouched.
        "document_text": event.get("document_text") or "",
        "payload": event.get("payload") or {},
        "metadata": event.get("metadata") or {},
        "visit_number": visit_info.get("visit_number"),
    }


def build_visits_from_source_events(
    patient_id: str,
    source_events: List[Dict[str, Any]],
    appointments: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Rebuild the complete visit structure from the complete raw history.

    One appointment + two documents on the same appointment date therefore
    always yields ONE visit containing exactly THREE events.
    """

    visits: List[Dict[str, Any]] = []
    seen_event_ids: set = set()

    for event in source_events:
        event_id = event.get("event_id") or event.get("document_id")

        if not event_id or event_id in seen_event_ids:
            continue

        source_date = (
            normalize_date(event.get("document_date"))
            or normalize_date(event.get("event_date"))
            or normalize_date(event.get("appointment_date"))
        )

        if not source_date:
            logger.warning(
                "Source event {} has no usable date and was skipped",
                event_id,
            )
            continue

        try:
            visit_info = determine_visit(source_date, appointments)
        except ValueError as exc:
            logger.warning("Visit resolution failed for {}: {}", event_id, exc)
            continue

        seen_event_ids.add(event_id)

        visit_date = visit_info["appointment_date"]

        target = None

        for visit in visits:
            if normalize_date(visit.get("visit_date")) == visit_date:
                target = visit
                break

        if target is None:
            target = create_visit(
                patient_id=patient_id,
                visit_number=visit_info["visit_number"],
                visit_date=visit_date,
                appointment_ids=visit_info.get("appointment_ids"),
            )
            visits.append(target)

        appointment = target.setdefault("appointment", {})
        appointment.setdefault("appointment_ids", [])

        for appointment_id in visit_info.get("appointment_ids") or []:
            if appointment_id not in appointment["appointment_ids"]:
                appointment["appointment_ids"].append(appointment_id)

        appointment["appointment_date"] = visit_date
        appointment["visit_start_date"] = visit_date

        if visit_info.get("visit_end_date"):
            appointment["visit_end_date"] = visit_info["visit_end_date"]

        target["events"].append(build_visit_event(event, visit_info))
        target["event_count"] = len(target["events"])

    return normalize_visits(patient_id, visits)


def normalize_visits(
    patient_id: str,
    visits: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:

    grouped: Dict[str, Dict[str, Any]] = {}

    for visit in visits:
        if not isinstance(visit, dict):
            continue

        visit_date = normalize_date(visit.get("visit_date"))

        if not visit_date:
            continue

        if visit_date not in grouped:
            destination = deep_copy(visit)
            destination.setdefault("events", [])
            destination.setdefault("appointment", {})
            destination["appointment"].setdefault("appointment_ids", [])
            grouped[visit_date] = destination
        else:
            destination = grouped[visit_date]

            for event in visit.get("events", []):
                unique_append(destination["events"], event)

            destination_appointments = destination["appointment"][
                "appointment_ids"
            ]

            for appointment_id in (
                visit.get("appointment", {}).get("appointment_ids", [])
            ):
                if appointment_id not in destination_appointments:
                    destination_appointments.append(appointment_id)

    ordered = sorted(
        grouped.values(),
        key=lambda x: normalize_date(x.get("visit_date")) or "9999-12-31",
    )

    for number, visit in enumerate(ordered, start=1):
        visit["patient_id"] = patient_id
        visit["visit_number"] = number
        visit["visit_id"] = make_visit_id(
            patient_id,
            number,
            visit["visit_date"],
        )

        events = visit.get("events", [])

        # Chronological inside the visit.
        events.sort(
            key=lambda item: (
                normalize_date(item.get("document_date")) or "9999-12-31",
                str(item.get("event_id") or ""),
            )
        )

        for event in events:
            if isinstance(event, dict):
                event["visit_number"] = number

        visit["event_count"] = len(events)

        visit["status"] = (
            "Current" if number == len(ordered) else "Historical"
        )

        appointment = visit.setdefault("appointment", {})
        appointment.setdefault("appointment_date", visit["visit_date"])
        appointment.setdefault("visit_start_date", visit["visit_date"])
        appointment.setdefault("appointment_ids", [])

        next_visit = ordered[number] if number < len(ordered) else None

        if next_visit:
            appointment["visit_end_date"] = next_visit["visit_date"]

    return ordered


def clean_visits(visits: List[Dict[str, Any]]) -> List[Dict[str, Any]]:

    result = []

    for visit in visits:
        item = deep_copy(visit)
        item.pop("patient_id", None)
        result.append(item)

    return result


def build_agent_journey(
    patient_id: str,
    visits: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Build the complete source-preserving journey.

    Important:
    - No clinical filtering.
    - No keyword filtering.
    - No disease-specific logic.
    - No semantic pre-classification.
    - Every source event receives a stable evidence identity.
    - The LLM decides relevance, but every generated statement must reference
      one or more supplied event_ids.
    """

    journey_visits = []

    for visit in clean_visits(visits):
        events = []

        for event in visit.get("events", []):
            if not isinstance(event, dict):
                continue

            text = event.get("document_text") or ""

            events.append(
                {
                    "event_id": event.get("event_id"),
                    "document_id": event.get("document_id"),
                    "file_name": event.get("file_name"),
                    "source": event.get("source"),
                    "document_date": event.get("document_date"),
                    "visit_number": visit.get("visit_number"),
                    "visit_date": visit.get("visit_date"),
                    "document_classification": event.get(
                        "document_classification"
                    ),
                    "document_text": text,
                    "payload": event.get("payload") or {},
                }
            )

        journey_visits.append(
            {
                "visit_id": visit.get("visit_id"),
                "visit_number": visit.get("visit_number"),
                "visit_date": visit.get("visit_date"),
                "status": visit.get("status"),
                "appointment": visit.get("appointment"),
                "event_count": len(events),
                "events": events,
            }
        )

    return {
        "patient_id": patient_id,
        "visits": journey_visits,
    }


# ============================================================================
# DETERMINISTIC NUMERIC COMPARISON
# ============================================================================

def numeric_value(value: Any) -> Optional[float]:

    if isinstance(value, bool):
        return None

    if isinstance(value, (int, float)):
        return float(value)

    if isinstance(value, str):
        try:
            return float(value.strip())
        except Exception:
            return None

    return None


def normalize_series(value: Any) -> Dict[str, List[Dict[str, Any]]]:
    """
    Accept whatever series shape the Trends agent produced from the raw
    journey and normalize it. No metric names are assumed.
    """

    series: Dict[str, List[Dict[str, Any]]] = {}

    if not isinstance(value, dict):
        return series

    for name, history in value.items():
        if not isinstance(name, str) or not name.strip():
            continue

        if not isinstance(history, list):
            continue

        points = []

        for item in history:
            if not isinstance(item, dict):
                continue

            points.append(
                {
                    "visit_number": item.get("visit_number"),
                    "visit_date": item.get("visit_date"),
                    "value": item.get("value"),
                    "unit": item.get("unit"),
                    "source_event_id": item.get("source_event_id"),
                    "context": item.get("context"),
                }
            )

        if points:
            collapsed = []
            seen_points = set()

            for point in points:
                key = (
                    str(point.get("visit_number")),
                    normalize_dedupe_text(point.get("visit_date")),
                    normalize_dedupe_text(point.get("value")),
                    normalize_dedupe_text(point.get("unit")),
                    normalize_dedupe_text(point.get("context")),
                )

                if key in seen_points:
                    continue

                seen_points.add(key)
                collapsed.append(point)

            points = collapsed

            points.sort(
                key=lambda p: (
                    p.get("visit_number") or 0,
                    str(p.get("visit_date") or ""),
                    str(p.get("source_event_id") or ""),
                )
            )
            series[name.strip()] = points

    return series


def calculate_series_trend(
    history: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Build a longitudinal comparison for one dynamically discovered series.

    Rules:
    - Never compare two observations from the same visit.
    - Preserve every source-supported observation.
    - The latest value comes from the latest visit that contains
      a usable observation.
    - Previous history contains ALL earlier visit observations.
    - The numerical delta compares the latest observation with the
      immediately preceding distinct visit observation.
    - No metric names or clinical concepts are hardcoded.
    """

    if not isinstance(history, list):
        history = []

    # ------------------------------------------------------------
    # Normalize and preserve all observations
    # ------------------------------------------------------------
    observations = []

    for item in history:
        if not isinstance(item, dict):
            continue

        visit_number = item.get("visit_number")

        if visit_number is None:
            continue

        observations.append(deep_copy(item))

    # Deterministic chronological ordering.
    observations.sort(
        key=lambda item: (
            item.get("visit_number") or 0,
            str(item.get("visit_date") or ""),
            str(item.get("source_event_id") or ""),
        )
    )

    # ------------------------------------------------------------
    # Group observations by visit
    # ------------------------------------------------------------
    visit_groups: Dict[Any, List[Dict[str, Any]]] = {}

    for item in observations:
        visit_number = item.get("visit_number")
        visit_groups.setdefault(visit_number, []).append(item)

    ordered_visit_numbers = sorted(
        visit_groups.keys(),
        key=lambda value: (
            value is None,
            value,
        ),
    )

    # ------------------------------------------------------------
    # Latest distinct visit
    # ------------------------------------------------------------
    latest_visit_number = (
        ordered_visit_numbers[-1]
        if ordered_visit_numbers
        else None
    )

    latest_visit_items = (
        visit_groups.get(latest_visit_number, [])
        if latest_visit_number is not None
        else []
    )

    numeric_latest_items = [
        item
        for item in latest_visit_items
        if numeric_value(item.get("value")) is not None
    ]

    # Preserve the latest source observation.
    #
    # If multiple observations exist in the latest visit,
    # do NOT silently choose one for numerical comparison.
    latest = None

    if len(numeric_latest_items) == 1:
        latest = numeric_latest_items[0]
    elif latest_visit_items:
        # Preserve latest information even if it is non-numeric.
        latest = latest_visit_items[-1]

    # ------------------------------------------------------------
    # ALL previous distinct visits
    # ------------------------------------------------------------
    previous_visit_numbers = [
        visit_number
        for visit_number in ordered_visit_numbers
        if visit_number != latest_visit_number
    ]

    previous_history = []

    for visit_number in previous_visit_numbers:
        for item in visit_groups.get(visit_number, []):
            previous_history.append(deep_copy(item))

    # ------------------------------------------------------------
    # Find the immediately preceding distinct visit
    # containing an unambiguous numeric observation.
    #
    # This is ONLY used for calculating delta.
    # It does not remove anything from previous_history.
    # ------------------------------------------------------------
    comparison_previous = None
    comparison_previous_number = None

    for visit_number in reversed(previous_visit_numbers):
        candidates = [
            item
            for item in visit_groups.get(visit_number, [])
            if numeric_value(item.get("value")) is not None
        ]

        # Do not silently choose among conflicting observations.
        if len(candidates) == 1:
            comparison_previous = candidates[0]
            comparison_previous_number = visit_number
            break

    # ------------------------------------------------------------
    # Calculate numerical comparison only when BOTH sides
    # are unambiguous and belong to different visits.
    # ------------------------------------------------------------
    comparison = None
    trend = None

    if latest is not None and comparison_previous is not None:

        current = numeric_value(latest.get("value"))
        previous = numeric_value(
            comparison_previous.get("value")
        )

        latest_visit = latest.get("visit_number")

        if (
            current is not None
            and previous is not None
            and latest_visit != comparison_previous_number
        ):
            change = current - previous

            percentage = None

            if previous != 0:
                percentage = round(
                    (change / previous) * 100,
                    2,
                )

            comparison = {
                "previous": previous,
                "current": current,
                "change": round(change, 6),
                "percentage_change": percentage,
                "previous_visit": comparison_previous_number,
                "current_visit": latest_visit,

                # NEW:
                # complete previous-visit representation.
                "previous_history": previous_history,

                # Explicit current source observation.
                "current_observation": deep_copy(latest),
            }

            if change > 0:
                trend = "Increasing"
            elif change < 0:
                trend = "Decreasing"
            else:
                trend = "Stable"

    # ------------------------------------------------------------
    # Final result
    # ------------------------------------------------------------
    return {
        "history": observations,

        # Latest visit observation.
        "latest": latest,

        # Keep backward compatibility:
        # immediately preceding distinct visit observation.
        "previous": comparison_previous,

        # ALL previous visit observations.
        "previous_history": previous_history,

        "comparison": comparison,

        "trend": trend,
    }


def build_visit_history(
    visits: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:

    return [
        {
            "visit_number": visit.get("visit_number"),
            "visit_date": visit.get("visit_date"),
            "event_count": visit.get(
                "event_count",
                len(visit.get("events", [])),
            ),
        }
        for visit in visits
    ]


def build_deterministic_trends(
    trends_result: Dict[str, Any],
    visits: List[Dict[str, Any]],
) -> Dict[str, Any]:

    empty = {
        "cumulative_dose_vs_limit": None,
        "toxicity_visit_over_visit": None,
        "tumor_burden": None,
        "key_labs": None,
        "biomarkers": None,
    }

    if not isinstance(trends_result, dict):
        return {
            "presentation_views": empty,
            "narrative": None,
        }

    raw_presentation = (
        trends_result.get("presentation_views")
    )

    if not isinstance(raw_presentation, dict):
        raw_presentation = {}

    valid_event_ids = {
        event.get("event_id")
        for visit in visits or []
        if isinstance(visit, dict)
        for event in (visit.get("events") or [])
        if isinstance(event, dict)
        and event.get("event_id")
    }

    resolved = build_presentation_views(
        raw_presentation=raw_presentation,
        visits=visits,
        valid_event_ids=valid_event_ids,
    )

    presentation = {
        "cumulative_dose_vs_limit": None,
        "toxicity_visit_over_visit": None,
        "tumor_burden": None,
        "key_labs": None,
        "biomarkers": None,
    }

    for view in resolved:

        if not isinstance(view, dict):
            continue

        slot = view.get("presentation_slot")

        if slot not in presentation:
            continue

        cleaned = deep_copy(view)

        cleaned.pop(
            "presentation_slot",
            None,
        )

        presentation[slot] = cleaned

    return {
        "presentation_views": presentation,
        "narrative": trends_result.get(
            "narrative"
        ),
    }

def _flow_value_is_present(value: Any) -> bool:
    if value is None:
        return False

    if isinstance(value, str):
        return bool(value.strip())

    if isinstance(value, list):
        return any(_flow_value_is_present(v) for v in value)

    if isinstance(value, dict):
        return any(
            _flow_value_is_present(v)
            for v in value.values()
        )

    return True


def _flow_observation_key(
    parameter: Any,
    unit: Any,
    category: Any,
    series_id: Any = None,
    longitudinal_identity: Any = None,
) -> tuple:
    """
    Structural identity for a flowsheet series.

    A reconciled `series_id` is the preferred longitudinal identity.
    It is assigned by the source-grounded flowsheet reconciliation agent.
    No clinical vocabulary, keyword mapping, regex, disease rule, or
    specialty-specific rule is used here.

    When no reconciled series_id exists, the legacy structural identity is
    retained for backward compatibility.
    """
    # The reconciliation agent may provide a semantic longitudinal identity
    # that is intentionally independent of presentation wording and treatment
    # phase.  It is preferred over series_id so phase-specific labels cannot
    # split one underlying entity into multiple rows.
    normalized_identity = normalize_dedupe_text(longitudinal_identity)

    if normalized_identity:
        return ("longitudinal_identity", normalized_identity)

    normalized_series_id = normalize_dedupe_text(series_id)

    if normalized_series_id:
        return ("series_id", normalized_series_id)

    return (
        "structural",
        normalize_dedupe_text(parameter),
        normalize_dedupe_text(unit),
        normalize_dedupe_text(category),
    )


def _coerce_flowsheet_series(
    entries: Any,
) -> List[Dict[str, Any]]:
    """
    Normalize both parameter-series and flat-observation representations
    without discarding source-supported observation fields.

    This function performs only structural normalization. It does not
    interpret clinical meaning and contains no clinical vocabulary rules.
    """

    if not isinstance(entries, list):
        return []

    series_by_key: Dict[tuple, Dict[str, Any]] = {}

    for entry in entries:
        if not isinstance(entry, dict):
            continue

        parameter = entry.get("parameter")

        if _is_empty_value(parameter):
            continue

        unit = entry.get("unit")
        category = entry.get("category")
        series_id = entry.get("series_id")
        longitudinal_identity = entry.get("longitudinal_identity")

        observations = entry.get("observations")

        key = _flow_observation_key(
            parameter,
            unit,
            category,
            series_id,
            longitudinal_identity,
        )

        trend = entry.get("trend")
        trend_rationale = entry.get("trend_rationale")

        target = series_by_key.setdefault(
            key,
            {
                "series_id": series_id,
                "longitudinal_identity": longitudinal_identity,
                "parameter": parameter,
                "unit": unit,
                "category": category,
                "trend": trend,
                "trend_rationale": trend_rationale,
                # Longitudinal LLM interpretation of the complete series.
                # This is intentionally separate from source observation status.
                "status": entry.get("status"),
                "status_rationale": entry.get("status_rationale"),
                "observations": [],
            },
        )

        # Preserve the first non-empty presentation metadata while allowing
        # observations to accumulate under the same reconciled series_id.
        if _is_empty_value(target.get("series_id")) and not _is_empty_value(series_id):
            target["series_id"] = series_id

        if _is_empty_value(target.get("longitudinal_identity")) and not _is_empty_value(longitudinal_identity):
            target["longitudinal_identity"] = longitudinal_identity

        if _is_empty_value(target.get("parameter")) and not _is_empty_value(parameter):
            target["parameter"] = parameter

        if _is_empty_value(target.get("unit")) and not _is_empty_value(unit):
            target["unit"] = unit

        if _is_empty_value(target.get("category")) and not _is_empty_value(category):
            target["category"] = category

        if _is_empty_value(target.get("trend")) and not _is_empty_value(trend):
            target["trend"] = trend

        if _is_empty_value(target.get("trend_rationale")) and not _is_empty_value(trend_rationale):
            target["trend_rationale"] = trend_rationale

        entry_status = entry.get("status")
        entry_status_rationale = entry.get("status_rationale")

        if _is_empty_value(target.get("status")) and not _is_empty_value(entry_status):
            target["status"] = entry_status

        if _is_empty_value(target.get("status_rationale")) and not _is_empty_value(entry_status_rationale):
            target["status_rationale"] = entry_status_rationale

        if isinstance(observations, list):
            for obs in observations:
                if not isinstance(obs, dict):
                    continue

                if obs.get("visit_number") is None:
                    continue

                # Preserve every observation field supplied by the agent.
                normalized_obs = deep_copy(obs)

                target["observations"].append(
                    normalized_obs
                )

            continue

        # Flat observation.
        if entry.get("visit_number") is None:
            continue

        # Preserve all flat-observation fields except the series-level fields.
        normalized_obs = {
            key_name: deep_copy(value)
            for key_name, value in entry.items()
            if key_name not in {
                "series_id",
                "longitudinal_identity",
                "parameter",
                "unit",
                "category",
                "trend",
                "trend_rationale",
                "status",
                "status_rationale",
                "observations",
            }
        }

        target["observations"].append(
            normalized_obs
        )

    # Clean + deduplicate observations while preserving distinct source data.
    result = []

    for series in series_by_key.values():
        observations = []
        seen = set()

        for obs in series["observations"]:
            if not isinstance(obs, dict):
                continue

            signature = semantic_item_signature(obs)

            if signature in seen:
                continue

            seen.add(signature)
            observations.append(obs)

        observations.sort(
            key=lambda x: (
                x.get("visit_number")
                if x.get("visit_number") is not None
                else 10**9,
                str(x.get("visit_date") or ""),
                str(x.get("document_date") or ""),
                str(x.get("event_id") or ""),
                str(x.get("source_event_id") or ""),
            )
        )

        if observations:
            series["observations"] = observations
            result.append(series)

    return result

def _cell_from_observations(
    observations: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Build one visit cell without discarding additional observation context.

    A scalar value is exposed when there is one value. Multiple observations
    remain available under `observations` and are represented by a value list.
    """

    valid_observations = [
        deep_copy(obs)
        for obs in observations
        if isinstance(obs, dict)
    ]

    if not valid_observations:
        return {
            "visit_number": None,
            "visit_date": None,
            "value": None,
            "status": None,
            "event_ids": [],
        }

    values = [
        obs.get("value")
        for obs in valid_observations
        if _flow_value_is_present(obs.get("value"))
    ]

    statuses = [
        obs.get("status")
        for obs in valid_observations
        if _flow_value_is_present(obs.get("status"))
    ]

    event_ids = []

    for obs in valid_observations:
        raw_ids = obs.get("event_ids")

        if raw_ids is None and obs.get("event_id") is not None:
            raw_ids = [obs.get("event_id")]

        for event_id in raw_ids or []:
            if event_id not in event_ids:
                event_ids.append(event_id)

    first = valid_observations[0]

    if len(values) == 1:
        value = values[0]
    elif len(values) > 1:
        value = values
    else:
        value = None

    if len(statuses) == 1:
        status = statuses[0]
    elif len(statuses) > 1:
        status = statuses
    else:
        status = None

    cell = {
        "visit_number": first.get("visit_number"),
        "visit_date": first.get("visit_date"),
        "value": value,
        "status": status,
        "event_ids": event_ids,
    }

    # Preserve every additional observation field without imposing a
    # clinical schema. Single-observation cells expose the fields directly;
    # multi-observation cells retain every observation under `observations`.
    if len(valid_observations) == 1:
        for key, value_item in valid_observations[0].items():
            if key not in {
                "visit_number",
                "visit_date",
                "value",
                "status",
                "event_ids",
            }:
                cell[key] = deep_copy(value_item)
    else:
        cell["observations"] = valid_observations

    return cell

def _numeric_scalar(value: Any) -> Optional[float]:
    """
    Numeric comparison is only performed when the value is genuinely
    scalar numeric data.

    No clinical interpretation is performed.
    """

    if isinstance(value, bool):
        return None

    if isinstance(value, (int, float)):
        return float(value)

    if isinstance(value, str):
        text = value.strip()

        if not text:
            return None

        try:
            return float(text)
        except Exception:
            return None

    return None


def _build_visit_comparisons(
    cells: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:

    comparisons = []

    populated = [
        cell
        for cell in cells
        if _flow_value_is_present(cell.get("value"))
    ]

    for previous, current in zip(
        populated,
        populated[1:],
    ):

        previous_numeric = _numeric_scalar(
            previous.get("value")
        )

        current_numeric = _numeric_scalar(
            current.get("value")
        )

        change = None
        percentage_change = None

        if (
            previous_numeric is not None
            and current_numeric is not None
        ):
            change = current_numeric - previous_numeric

            if previous_numeric != 0:
                percentage_change = (
                    (
                        current_numeric
                        - previous_numeric
                    )
                    / abs(previous_numeric)
                ) * 100

        comparisons.append(
            {
                "previous_visit": previous.get(
                    "visit_number"
                ),
                "previous_date": previous.get(
                    "visit_date"
                ),
                "previous_value": previous.get(
                    "value"
                ),
                "current_visit": current.get(
                    "visit_number"
                ),
                "current_date": current.get(
                    "visit_date"
                ),
                "current_value": current.get(
                    "value"
                ),
                "change": change,
                "percentage_change": percentage_change,
            }
        )

    return comparisons


def pivot_flowsheet_bucket(
    series_list: List[Dict[str, Any]],
    visits: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Convert source-grounded parameter series into a visit-wise
    longitudinal flowsheet.

    ONE reconciled series becomes ONE row. Each observation is placed into
    the cell belonging to its canonical visit. Pre/during/post timing is
    observation context and never creates a new row. Trend and longitudinal
    status remain row-level fields.

    No clinical vocabulary is assumed.
    No cycle count is assumed.
    Visit numbers and dates come only from the supplied journey.
    """

    normalized_series = _coerce_flowsheet_series(
        series_list
    )

    visit_axis = [
        {
            "visit_number": visit.get("visit_number"),
            "visit_date": visit.get("visit_date"),
        }
        for visit in visits
        if isinstance(visit, dict)
    ]

    rows = []

    for series in normalized_series:

        observations = series.get(
            "observations"
        ) or []

        by_visit: Dict[Any, List[Dict[str, Any]]] = {}

        for obs in observations:

            visit_number = obs.get(
                "visit_number"
            )

            if visit_number is None:
                continue

            by_visit.setdefault(
                visit_number,
                [],
            ).append(obs)

        cells = []

        for visit in visit_axis:

            visit_number = visit.get(
                "visit_number"
            )

            visit_observations = by_visit.get(
                visit_number,
                [],
            )

            if visit_observations:
                cell = _cell_from_observations(
                    visit_observations
                )
            else:
                cell = {
                    "visit_number": visit_number,
                    "visit_date": visit.get(
                        "visit_date"
                    ),
                    "value": None,
                    "status": None,
                    "event_ids": [],
                }

            cells.append(cell)

        # Prefer the source-grounded trend the reconciliation agent derived
        # by reading the actual (possibly composite) values. Only fall back
        # to a purely numeric Python comparison when the agent supplied
        # none — e.g. an older cached section, or a series it genuinely
        # could not compare.
        allowed_trends = {"up", "down", "flat", "mixed"}
        agent_trend = series.get("trend")
        trend = agent_trend if agent_trend in allowed_trends else None

        if trend is None:
            populated_numeric = [
                cell
                for cell in cells
                if (
                    _flow_value_is_present(
                        cell.get("value")
                    )
                    and _numeric_scalar(
                        cell.get("value")
                    )
                    is not None
                )
            ]

            if len(populated_numeric) >= 2:

                previous = _numeric_scalar(
                    populated_numeric[-2].get(
                        "value"
                    )
                )

                current = _numeric_scalar(
                    populated_numeric[-1].get(
                        "value"
                    )
                )

                if (
                    previous is not None
                    and current is not None
                ):
                    if current > previous:
                        trend = "up"
                    elif current < previous:
                        trend = "down"
                    else:
                        trend = "flat"

        rows.append(
            {
                "series_id": series.get("series_id"),
                "parameter": series.get(
                    "parameter"
                ),
                "unit": series.get("unit"),
                "category": series.get(
                    "category"
                ),
                "cells": cells,
                "comparisons": _build_visit_comparisons(
                    cells
                ),
                "trend": trend,
                "trend_rationale": series.get("trend_rationale")
                if agent_trend in allowed_trends
                else None,

                # ONE LLM-generated longitudinal status for the complete row.
                # This is deliberately separate from per-cell source status.
                "status": series.get("status"),
                "status_rationale": series.get(
                    "status_rationale"
                ),
            }
        )

    return {
        "visit_axis": visit_axis,
        "rows": rows,
    }

def _resolve_chart_view(
    view: Dict[str, Any],
    visits: List[Dict[str, Any]],
    valid_event_ids: set,
) -> Optional[Dict[str, Any]]:
    """
    Structurally normalize an LLM-generated chart.

    The LLM is responsible for discovering clinical meaning from the raw
    journey.

    This function ONLY:
      - validates the chart structure
      - resolves provenance
      - preserves visit identity
      - creates the visit axis

    No clinical vocabulary or keyword mapping is used.
    """

    if not isinstance(view, dict):
        return None

    series_specs = view.get("series")

    # Accept both the intended series representation and a possible
    # single-series object without performing clinical interpretation.
    if isinstance(series_specs, dict):
        series_specs = [series_specs]

    if not isinstance(series_specs, list):
        return None

    visit_axis = [
        {
            "visit_number": visit.get("visit_number"),
            "visit_date": visit.get("visit_date"),
        }
        for visit in visits
        if isinstance(visit, dict)
    ]

    resolved_series = []

    for spec in series_specs:

        if not isinstance(spec, dict):
            continue

        parameter = (
            spec.get("parameter")
            or spec.get("name")
            or spec.get("label")
        )

        if _is_empty_value(parameter):
            continue

        observations = spec.get("observations")

        if not isinstance(observations, list):
            observations = spec.get("points")

        if not isinstance(observations, list):
            continue

        normalized_observations = []

        for observation in observations:

            if not isinstance(observation, dict):
                continue

            visit_number = observation.get("visit_number")

            if visit_number is None:
                continue

            # ----------------------------------------------------------
            # Provenance normalization
            # ----------------------------------------------------------

            raw_event_ids = (
                observation.get("event_ids")
                or observation.get("source_event_ids")
                or observation.get("event_id")
                or observation.get("source_event_id")
                or observation.get("evidence_id")
            )

            if raw_event_ids is None:
                raw_event_ids = []

            if not isinstance(raw_event_ids, list):
                raw_event_ids = [raw_event_ids]

            event_ids = [
                event_id
                for event_id in raw_event_ids
                if event_id in valid_event_ids
            ]

            # ----------------------------------------------------------
            # If the LLM did not explicitly use event_ids but the
            # observation contains a document/source identifier that
            # matches the canonical event history, preserve it.
            # ----------------------------------------------------------

            if not event_ids:

                candidate_event_id = (
                    observation.get("document_id")
                    or observation.get("source_id")
                )

                if candidate_event_id in valid_event_ids:
                    event_ids = [candidate_event_id]

            # A clinical observation without provenance cannot be safely
            # materialized.
            if not event_ids:
                continue

            normalized_observations.append(
                {
                    "visit_number": visit_number,
                    "visit_date": (
                        observation.get("visit_date")
                        or next(
                            (
                                item["visit_date"]
                                for item in visit_axis
                                if item["visit_number"] == visit_number
                            ),
                            None,
                        )
                    ),
                    "value": observation.get("value"),
                    "unit": observation.get(
                        "unit",
                        spec.get("unit"),
                    ),
                    "status": observation.get("status"),
                    "event_ids": event_ids,
                }
            )

        if not normalized_observations:
            continue

        # Preserve the same entity as ONE longitudinal series.
        by_visit = {}

        for observation in normalized_observations:
            visit_number = observation["visit_number"]

            # If more than one source observation exists in a visit,
            # preserve the first structure while retaining all provenance.
            if visit_number not in by_visit:
                by_visit[visit_number] = observation
            else:
                existing = by_visit[visit_number]

                for event_id in observation.get("event_ids", []):
                    if event_id not in existing["event_ids"]:
                        existing["event_ids"].append(event_id)

        points = []

        for visit in visit_axis:

            visit_number = visit["visit_number"]

            observation = by_visit.get(visit_number)

            if observation:
                points.append(deep_copy(observation))
            else:
                points.append(
                    {
                        "visit_number": visit_number,
                        "visit_date": visit["visit_date"],
                        "value": None,
                        "unit": spec.get("unit"),
                        "status": None,
                        "event_ids": [],
                    }
                )

        resolved_series.append(
            {
                "series_id": spec.get("series_id"),
                "name": parameter,
                "parameter": parameter,
                "unit": spec.get("unit"),
                "points": points,
            }
        )

    if not resolved_series:
        return None

    reference_line = view.get("reference_line")

    if (
        not isinstance(reference_line, dict)
        or _is_empty_value(reference_line.get("value"))
    ):
        reference_line = None

    return {
        "id": view.get("view_id") or view.get("id"),
        "title": view.get("title"),
        "view_type": "chart",
        "reference_line": reference_line,
        "series": resolved_series,
    }


def _resolve_table_view(
    view: Dict[str, Any],
    visits: List[Dict[str, Any]],
    valid_event_ids: set,
) -> Optional[Dict[str, Any]]:

    if not isinstance(view, dict):
        return None

    rows = view.get("rows")

    # Be tolerant if the LLM uses series instead of rows.
    if not isinstance(rows, list):
        rows = view.get("series")

    if not isinstance(rows, list):
        return None

    cleaned_rows = []

    for row in rows:

        if not isinstance(row, dict):
            continue

        parameter = (
            row.get("parameter")
            or row.get("name")
            or row.get("label")
        )

        if _is_empty_value(parameter):
            continue

        observations = row.get("observations")

        if not isinstance(observations, list):
            observations = row.get("points")

        if not isinstance(observations, list):
            continue

        valid_observations = []

        for observation in observations:

            if not isinstance(observation, dict):
                continue

            visit_number = observation.get("visit_number")

            if visit_number is None:
                continue

            raw_event_ids = (
                observation.get("event_ids")
                or observation.get("source_event_ids")
                or observation.get("event_id")
                or observation.get("source_event_id")
                or observation.get("evidence_id")
            )

            if raw_event_ids is None:
                raw_event_ids = []

            if not isinstance(raw_event_ids, list):
                raw_event_ids = [raw_event_ids]

            event_ids = [
                event_id
                for event_id in raw_event_ids
                if event_id in valid_event_ids
            ]

            if not event_ids:
                candidate_event_id = (
                    observation.get("document_id")
                    or observation.get("source_id")
                )

                if candidate_event_id in valid_event_ids:
                    event_ids = [candidate_event_id]

            if not event_ids:
                continue

            visit_date = observation.get("visit_date")

            if not visit_date:
                visit_date = next(
                    (
                        visit["visit_date"]
                        for visit in visits
                        if visit.get("visit_number") == visit_number
                    ),
                    None,
                )

            valid_observations.append(
                {
                    "visit_number": visit_number,
                    "visit_date": visit_date,
                    "value": observation.get("value"),
                    "unit": observation.get(
                        "unit",
                        row.get("unit"),
                    ),
                    "status": observation.get("status"),
                    "event_ids": event_ids,
                }
            )

        if not valid_observations:
            continue

        cleaned_rows.append(
            {
                "series_id": row.get("series_id"),
                "parameter": parameter,
                "unit": row.get("unit"),
                "category": row.get("category"),
                "trend": row.get("trend"),
                "trend_rationale": row.get("trend_rationale"),
                "status": row.get("status"),
                "status_rationale": row.get(
                    "status_rationale"
                ),
                "observations": valid_observations,
            }
        )

    if not cleaned_rows:
        return None

    pivoted = pivot_flowsheet_bucket(
        cleaned_rows,
        visits,
    )

    if not pivoted.get("rows"):
        return None

    return {
        "id": view.get("view_id") or view.get("id"),
        "title": view.get("title"),
        "view_type": "table",
        "pivoted": pivoted,
    }


def build_trend_views(
    raw_views: Any,
    overall_trends: Dict[str, List[Dict[str, Any]]],
    visits: List[Dict[str, Any]],
    valid_event_ids: set,
) -> List[Dict[str, Any]]:
    """
    Resolve the LLM-curated view specs into ready-to-render chart/table
    payloads. A view that cannot be resolved (unmatched series, empty
    rows) is dropped rather than shown empty. Nothing here is disease,
    cancer-type, or metric specific.
    """

    if not isinstance(raw_views, list):
        return []

    resolved: List[Dict[str, Any]] = []

    for view in raw_views:
        if not isinstance(view, dict):
            continue

        view_type = normalize_dedupe_text(view.get("view_type"))

        item = None

        if view_type == "chart":
            item = _resolve_chart_view(view, overall_trends)
        elif view_type == "table":
            item = _resolve_table_view(view, visits, valid_event_ids)

        if item and not _is_empty_value(item.get("title")):
            resolved.append(item)

    return resolved


def build_presentation_views(
    raw_presentation: Any,
    visits: List[Dict[str, Any]],
    valid_event_ids: set,
) -> List[Dict[str, Any]]:
    """
    Validate and resolve the source-derived Trends & Statistics presentation.

    The LLM performs all clinical discovery directly from the raw journey.

    Python performs structural work only:
      - validates presentation containers
      - validates provenance
      - preserves visit identity
      - creates chart visit axes
      - creates table pivots

    No clinical vocabulary, disease rules, parameter mappings,
    keyword mappings, or predefined clinical extraction rules exist here.
    """

    if not isinstance(raw_presentation, dict):
        return []

    slot_order = (
        "cumulative_dose_vs_limit",
        "toxicity_visit_over_visit",
        "tumor_burden",
        "key_labs",
        "biomarkers",
    )

    resolved: List[Dict[str, Any]] = []

    for slot in slot_order:

        view = raw_presentation.get(slot)

        # Null means the LLM found no source-supported information
        # for this presentation purpose.
        if not isinstance(view, dict):
            continue

        normalized = deep_copy(view)

        # Backend owns the presentation identity.
        normalized["view_id"] = slot

        view_type = normalize_dedupe_text(
            normalized.get("view_type")
        )

        item = None

        if view_type == "chart":
            item = _resolve_chart_view(
                normalized,
                visits,
                valid_event_ids,
            )

        elif view_type == "table":
            item = _resolve_table_view(
                normalized,
                visits,
                valid_event_ids,
            )

        if not item:
            continue

        item["presentation_slot"] = slot

        resolved.append(item)

    return resolved


EVIDENCE_CONTRACT = """
EVIDENCE CONTRACT

The supplied journey is the only source of truth.

Every clinical statement you return MUST be supported by one or more
source events in the supplied journey.

Every item containing a clinical assertion MUST include:

{
    "event_ids": ["one or more supplied event_id values"],
    "statement": "source-grounded statement",
    "evidence": "short source-grounded explanation"
}

Rules:

1. Never create a clinical fact without an event_id.
2. Never create a measurement without an event_id.
3. Never create a diagnosis without an event_id.
4. Never create a treatment without an event_id.
5. Never create a response assessment without an event_id.
6. Never create a resistance assessment without an event_id.
7. Never create molecular/genomic information without an event_id.
8. Never create microbiome information without an event_id.
9. Never infer that something exists merely because the UI contains a
   corresponding section.
10. Absence of evidence is not evidence of absence.
11. Do not convert an unrelated finding into a section-specific finding.
12. Do not use medical knowledge to fill missing source information.
13. Do not predict future findings.
14. Do not manufacture a clinical interpretation.
15. Do not merge findings from different events unless the supplied evidence
    supports the relationship.
16. Preserve uncertainty exactly when the source is uncertain.
17. Preserve documented wording such as suspected, possible, probable,
    provisional, confirmed, negative, not identified, or pending.
18. Do not upgrade a provisional/suspected finding into a confirmed finding.
19. Do not downgrade a confirmed finding into a possibility.
20. Do not classify a source into a section merely because the source is
    clinically related to the patient's overall condition.

SOURCE RULE

An event_id is valid only if it exists in the supplied journey.

If there is no supporting event:

return [] or null for that field.

Never invent evidence.

OUTPUT RULE

Return JSON only.
"""

RESPONSE_SECTION_COMPLETENESS_RECONCILIATION_PROMPT = """
You are the final source-grounded completeness reconciliation agent for the
Response & Resistance section.

The supplied raw journey is the COMPLETE longitudinal source history and is
the authoritative source.

The evidence inventory is a source-discovery assistance layer. It may help
locate information, but the raw journey wins if they differ.

The generated section is a candidate representation and may be incomplete.
The existing section is also only a candidate representation.

Your job is to produce the most complete source-grounded representation of
the supplied Response & Resistance contract from the COMPLETE source
history.

============================================================
NO HARD-CODING
============================================================

Do not use:

- hardcoded diseases
- hardcoded cancer types
- hardcoded organs
- hardcoded biomarkers
- hardcoded imaging modalities
- hardcoded treatments
- keyword mappings
- regex
- string-pattern clinical rules
- predefined clinical examples
- predefined parameter lists
- disease-specific rules
- specialty-specific rules
- treatment-specific rules
- assumed response criteria
- assumed progression criteria
- assumed resistance criteria
- assumed toxicity criteria

All concepts, labels, parameters, sites, measurements, findings, and
relationships must be derived from the supplied source.

The only fixed names in this task are the application output fields in the
contract below.

============================================================
PRIMARY COMPLETENESS OBJECTIVE
============================================================

Inspect ALL supplied visits.

Inspect ALL source events.

Inspect the COMPLETE document_text of every event.

Inspect the evidence inventory.

Inspect the generated section.

Inspect the existing section when supplied.

For EACH contract field independently:

1. determine whether source-supported information exists;
2. preserve all source-supported information already represented;
3. add source-supported information missing from the generated section;
4. preserve longitudinally distinct observations;
5. remove only information that is unsupported by the complete source;
6. leave a field empty only when the complete source does not support
   information for that field.

An empty field in generated_section is NOT evidence that the source lacks
that information.

Do not stop at the latest visit.

Do not stop after the first matching source event.

============================================================
SOURCE GROUNDING
============================================================

Every clinical assertion MUST contain one or more valid event_ids.

Every event_id MUST exist in the supplied journey.

Never invent an event_id.

Never invent a value.

Never invent a measurement.

Never invent a date.

Never invent a diagnosis.

Never invent a treatment.

Never invent a response assessment.

Never invent resistance.

Never invent progression.

Never invent toxicity.

Never invent a comparison.

Never invent clinical significance.

When the source is uncertain, preserve the source uncertainty.

============================================================
LONGITUDINAL PRESERVATION
============================================================

Preserve all source-supported observations across all visits.

Do not replace an earlier observation because a later observation exists.

When observations differ by visit, date, value, measurement, site, specimen,
status, interpretation, or other source-supported context, preserve them as
distinct observations.

Repeated documentation of the same underlying fact may be deduplicated only
when the source evidence shows no meaningful difference.

Do not convert a longitudinal sequence into only a latest-state summary.

============================================================
RESPONSE / RESISTANCE / PROGRESSION
============================================================

These are conclusions only when source-supported.

Preserve an explicit source-documented conclusion.

Preserve an explicit source-documented comparison.

Do not infer response, resistance, progression, improvement, worsening, or
stability merely because a measurement changed.

Do not infer resistance from persistence, treatment change, interruption,
abnormality, or residual findings unless the source establishes that
relationship.

============================================================
TOXICITY / TOLERANCE
============================================================

Preserve source-supported adverse effects, toxicity assessments, symptoms,
grades, attribution, onset, duration, resolution, treatment relationship,
or other tolerance information.

Do not infer causality from an abnormal value or symptom unless the source
documents the relationship.

============================================================
PATHWAY / OUTCOME / NEW FINDINGS
============================================================

Preserve source-documented pathway changes, delays, holds, interruptions,
cancellations, modifications, prerequisites, or other documented changes.

Do not compare the patient against external guidelines.

Preserve outcome or benchmark information only when the source itself
documents the relevant comparison, benchmark, target, assessment, or
interpretation.

Preserve newly documented findings when supported by the source.

Do not convert a new finding into progression or resistance without source
support.

============================================================
FLOWSHEET
============================================================

The flowsheet is an exhaustive source-evidence representation for this
section. It is NOT dependent on whether a response or resistance conclusion
exists.

Rebuild or repair the flowsheet from the COMPLETE journey when the candidate
flowsheet is incomplete.

For every source-supported longitudinally trackable observation relevant to
this section, preserve:

- parameter or source-derived finding name
- exact source value
- source unit when present
- visit_number
- visit_date
- source status when present
- measurement when present
- site/context when present
- interpretation when present
- source event provenance

Do not replace detailed observations with category labels.

Do not retain only baseline.

Do not retain only the latest visit.

Do not discard diagnostic, pathological, imaging, observational,
measurement, laboratory, marker, organ/site, or other source-supported
evidence merely because another type of evidence is also present.

The parameter identity must be derived from the source evidence itself.

If the same underlying parameter is documented under different wording at
different visits, consolidate those observations only when the complete
source supports that they are the same underlying parameter.

Do not merge distinct sites, specimens, measurements, contexts, or findings.

Preserve the source-grounded wording as the canonical parameter label when
possible. Do not invent a new clinical concept.

The presentation buckets `organ`, `marker`, and `imaging` are the only
buckets you populate. Populate them from source-supported evidence. Do not
invent bucket membership. Do NOT return an `all` bucket — the backend
computes it deterministically as the union of `organ` + `marker` + `imaging`
immediately after this reconciliation runs, so any `all` array you return
is discarded.

Do not use a predefined list of parameters for any bucket.

Do not use a keyword mapping to assign a bucket.

Do not omit a source-supported series because its bucket is uncertain.

Each flowsheet series must use:

{
    "parameter": "<source-grounded label>",
    "unit": null,
    "category": null,
    "observations": [
        {
            "visit_number": null,
            "visit_date": null,
            "value": null,
            "status": null,
            "event_ids": []
        }
    ]
}

Additional source-supported observation fields may be included when present.

============================================================
OUTPUT CONTRACT
============================================================

Return JSON only.

Return exactly these Response & Resistance fields:

{
    "summary": [],
    "trajectory": [],
    "status_cards": [],
    "response_trajectory": [],
    "resistance_signal": [],
    "pathway_deviation": [],
    "pathway_deviation_log": [],
    "outcome_benchmark": [],
    "outcome_benchmark_note": null,
    "new_findings": [],
    "flowsheet": {
        "organ": [],
        "marker": [],
        "imaging": []
    },
    "intelligence": {
        "response": {},
        "toxicity": {},
        "progression": {}
    },
    "narrative": null
}

Do not return an `all` bucket inside `flowsheet`, and do not return
`flowsheet_pivoted`. Both are generated deterministically by the backend
after this reconciliation.

============================================================
FINAL AUDIT
============================================================

Before returning, perform a second completeness pass over the COMPLETE raw
journey.

Verify independently that:

1. no source-supported visit observation was lost;
2. no earlier observation was replaced by a later observation;
3. no detailed measurement was reduced to a label;
4. no distinct site/specimen/context was merged incorrectly;
5. every populated clinical item has valid event_ids;
6. every event_id exists in the supplied journey;
7. no unsupported clinical fact was introduced;
8. empty fields remain empty only when the complete source provides no
   source-supported information for them.

Return JSON only.
"""


RESPONSE_FLOWSHEET_RECONCILIATION_PROMPT = """
You are a source-grounded longitudinal flowsheet reconciliation agent.

The supplied raw journey is the COMPLETE source of truth.

Your task is ONLY to reconcile the Response & Resistance flowsheet so that
the same underlying longitudinally trackable entity is represented by ONE
parameter series across visits.

============================================================
STRICT NO-HARDCODING
============================================================

Do NOT use:
- disease-specific rules
- cancer-specific rules
- organ-specific rules
- biomarker-specific rules
- imaging-specific rules
- specialty-specific rules
- keyword mappings
- regex
- string-pattern clinical rules
- predefined clinical examples
- predefined parameter lists
- treatment-specific rules
- assumed response criteria

All entity identity decisions must come from the supplied source content.

The only fixed application concepts are:
- series_id
- parameter
- unit
- category
- observations
- visit_number
- visit_date
- value
- status
- event_ids
- longitudinal_identity (internal reconciliation key)

`longitudinal_identity` is an opaque semantic identity supplied by you for
reconciliation. It must represent WHAT the source says is being tracked, not
WHEN it was observed. The same underlying entity MUST receive the same
longitudinal_identity across different visits, documents, modalities of wording,
and temporal phases when the source supports that they are the same entity.
Do not encode treatment phase, visit, date, document type, or event_id in it.

============================================================
CORE LONGITUDINAL RULE
============================================================

The ROW identity is the underlying source-supported longitudinal entity.

The ROW identity is NOT:
- treatment phase
- pre-treatment
- during-treatment
- post-treatment
- baseline/post-treatment labels
- response status
- resistance status
- document type
- source file
- event_id
- appointment_id

Therefore, if source evidence describes the same underlying entity at
different visits or different treatment phases, those observations MUST be
placed in ONE parameter series.

For example, two source observations may use different wording because they
come from different documents. Do not create separate series merely because
the wording differs. Determine whether the source supports that they refer
to the same underlying entity.

At the same time, do NOT merge genuinely different entities merely because
their names are similar.

A merge is allowed only when the supplied source supports the same
underlying entity through its documented identity/context.

============================================================
TEMPORAL-PHASE LABELS NEVER CREATE A NEW SERIES
============================================================

This is the single most common reconciliation failure, so treat it as a
hard rule, not a suggestion.

A parameter label frequently carries a temporal or phase qualifier because
of which document it came from — words or phrases such as "baseline",
"pre-treatment", "pre", "initial", "screening", "post-treatment", "post",
"follow-up", "interim", "on-treatment", "cycle 1", "cycle 2", "day 1",
"week 4", or any other wording that marks WHEN the observation was made
rather than WHAT was measured.

Before deciding two source items are different entities, strip any such
temporal/phase qualifier from each parameter label and compare what
remains: the modality/method (e.g. the same imaging technique, the same
lab panel, the same assay) together with the same measured target
(the same anatomical site, specimen, or finding). If what remains is the
same underlying trackable thing, these are NOT two entities — they are two
visits of ONE longitudinal series, and MUST be merged under one
`series_id` regardless of how differently their source labels were worded.

When you merge such observations, the merged series' `parameter` label
must describe WHAT is tracked, with the temporal/phase qualifier removed
(e.g. if the source called one observation "Baseline PET-CT — right
breast lesion" and another "Post-treatment PET-CT — right breast lesion",
the merged parameter becomes "PET-CT — right breast lesion", and the
phase itself is preserved instead inside each observation's own `status`
or implicit visit_number/visit_date — never in the series-level name).

Concretely: if you are about to output two series whose only difference in
meaning is which phase of care they describe, STOP — merge them into one
series with multiple observations instead.

A merge is still never allowed when the modality, method, site, specimen,
or measured attribute genuinely differs between the two source items —
only phase-only differences must always be merged.

============================================================
SERIES IDENTITY
============================================================

Assign each distinct longitudinal entity a stable opaque `series_id`.

The series_id is an application identity only. It must not encode a disease,
organ, marker, modality, treatment, or clinical interpretation.

Use the SAME series_id for the SAME underlying entity across:
- visits
- documents
- treatment phases
- presentation buckets

Use DIFFERENT series_id values when the source supports genuinely different
entities.

Do not use visit number, date, phase, or event_id as the series identity.

============================================================
OBSERVATION PRESERVATION
============================================================

For every reconciled series:

{
    "series_id": "...",
    "longitudinal_identity": "...",
    "parameter": "...",
    "unit": "<series-level unit only when one unit applies consistently, otherwise null>",
    "category": "...",
    "trend": "<one of: up | down | flat | mixed | null — see TREND DETERMINATION>",
    "trend_rationale": "<one short source-grounded sentence citing the specific compared values, or null>",
    "observations": [
        {
            "visit_number": <actual supplied visit number>,
            "visit_date": "<actual supplied visit date>",
            "value": "<source-supported value>",
            "unit": "<source-supported unit or null>",
            "status": "<source-supported observation status or null>",
            "phase": "<source-supported temporal phase/timing such as pre, during, post, or null>",
            "event_ids": ["valid supplied event ids"]
        }
    ]
}

============================================================
OBSERVATION PHASE VS LONGITUDINAL STATUS
============================================================

`status` inside an observation is source-supported observation-level status
and must never be confused with the row-level longitudinal status generated
later by the backend.

If the source supports a temporal phase/timing for an observation, preserve
it in the observation as `phase`.

The phase is contextual and does NOT change the series identity.

All observations for the same underlying entity must remain under the same
series_id regardless of whether they are pre-treatment, during-treatment,
post-treatment, follow-up, interim, or another source-supported timing.

The backend will generate ONE separate series-level longitudinal `status`
after reconciliation. Do not create a separate series-level status here.

============================================================
TREND DETERMINATION
============================================================

After merging a series' observations (per the rule above), determine the
series-level `trend` by comparing its own observations across visits —
nothing else.

This comparison is a plain reading of the values you already preserved,
not a clinical judgment: you are only describing whether the tracked
value(s) went up, went down, stayed the same, or moved in inconsistent
directions — never whether that change is clinically good or bad.

Rules:
- Fewer than two observations exist for the series -> `trend` is null.
- The measured value is a single number/size and it increased across
  the compared visits -> "up". Decreased -> "down". Unchanged -> "flat".
- The measured value is composite (e.g. several dimensions, several
  named components measured together) and every component moved in the
  same direction -> use that direction ("up"/"down"). If components moved
  in different directions, or the value is not comparable in a single
  direction -> "mixed".
- Compare the two most recent visits that carry a usable value for this
  series, not necessarily the first and last, unless only two exist.
- `trend_rationale` must name the actual compared values (e.g. quoting
  the two observations being compared) so the trend is auditable against
  the source. Never invent a rationale; if you cannot point to the two
  specific compared observations, leave both `trend` and
  `trend_rationale` null.
- Never let `trend` or `trend_rationale` introduce a diagnosis, a
  response/resistance/progression conclusion, or any clinical
  interpretation. State only the direction of the tracked value.

Preserve every genuinely distinct source-supported observation.

A single underlying entity may have more than one source-supported
measurement or descriptor at the same visit (for example, different
measurement dimensions or different documented attributes). Keep those
observations under the SAME series_id when the source establishes that they
belong to the same underlying entity. Do not create separate longitudinal
rows merely because the measured attribute differs.

If the source documents units, preserve the unit with the observation. If
different observations of the same entity use different units, preserve
those observation-level units rather than converting, normalizing, or
discarding them. Never invent a conversion.

Do not keep only the latest visit.

Do not replace an earlier observation with a later observation.

Do not move an observation between visits.

Do not invent a value.

Do not invent a date.

Do not invent a status.

Do not invent an event_id.

Every observation MUST preserve the source event_ids supporting it.

If several source events document the same observation, combine their
event_ids into one observation rather than creating duplicate observations.

If different source events document different values, dates, sites,
specimens, measurements, statuses, or other clinically meaningful
contexts, preserve them as distinct observations when the source supports
that distinction.

============================================================
CATEGORY
============================================================

`category` is presentation metadata only.

It does NOT define longitudinal identity.

The same underlying entity may legitimately appear in more than one
presentation bucket when the source supports that classification.

The only Response & Resistance flowsheet presentation buckets are:

- organ
- marker
- imaging

These are presentation containers only and do not define longitudinal
clinical identity.

Preserve the source-supported category assignment supplied by the current
flowsheet.

If source-supported observations belong to one of these buckets, preserve
them.

If no source-supported observations belong to a bucket, return [].

Do not create an aggregate bucket.

Do not create an "all" bucket.

Do not manufacture a category.

============================================================
COMPLETE SOURCE AUDIT
============================================================

Inspect:
1. every visit;
2. every source event;
3. the complete document_text of every source event;
4. the existing flowsheet;
5. the generated flowsheet;
6. all supplied event_ids.

The generated flowsheet is NOT authoritative if it conflicts with the raw
journey.

Recover source-supported observations missing from the generated flowsheet.

The output must contain every source-supported relevant observation that
belongs to this flowsheet.

============================================================
OUTPUT
============================================================

Return JSON only:

{
    "organ": [...],
    "marker": [...],
    "imaging": [...]
}

Each array contains parameter-series objects.

The output MUST contain exactly these three flowsheet buckets:

- organ
- marker
- imaging

Do not return an "all" bucket.

Do not return any additional flowsheet bucket.

Each bucket must be independently populated from the COMPLETE supplied
source journey.

If source-supported evidence exists, preserve it.

If source-supported evidence does not exist, return [].

Do not use the absence of response, resistance, progression, toxicity, or
trajectory information as a reason to empty a bucket.

Do not discard source-supported observations merely because they are not
part of a response or resistance conclusion.
series, with the SAME underlying entity represented by ONE series even when
its observations originated from different presentation buckets.

The specialized buckets are retained for background processing only.

Do not create a separate row because an observation is pre-treatment,
during-treatment, or post-treatment.

Do not create a separate row because two documents use different wording
when the supplied source supports the same underlying entity.

Do not merge entities when the supplied source does not support their
identity relationship.

Return JSON only.
"""



RESPONSE_FLOWSHEET_STATUS_PROMPT = """
You are the longitudinal status agent for the Response & Resistance flowsheet.

The supplied flowsheet has already been semantically reconciled. Each
parameter series represents ONE underlying source-supported entity across
multiple visits.

Your task is to generate ONE longitudinal `status` for EACH series.

============================================================
CORE RULE
============================================================

Status belongs to the COMPLETE ROW/SERIES.

Do NOT generate a separate longitudinal status for:
- pre-treatment
- during-treatment
- post-treatment
- individual visits
- individual documents.

Read ALL observations belonging to the SAME series together.

The corresponding visit cells contain the observations for that series.
The phase/timing of an observation is contextual information only.

============================================================
SOURCE GROUNDING
============================================================

Use ONLY the supplied series observations and their source event evidence.

Do not invent:
- values
- measurements
- dates
- visits
- phases
- diagnoses
- response conclusions
- resistance conclusions
- progression
- improvement
- worsening
- stability
- clinical significance

If the source evidence is insufficient for a meaningful longitudinal status,
return null.

============================================================
NO HARD-CODING
============================================================

Do NOT use:
- disease-specific rules
- cancer-specific rules
- organ-specific rules
- marker-specific rules
- imaging-specific rules
- specialty-specific rules
- fixed thresholds
- keyword mappings
- regex
- predefined clinical examples
- predefined status mappings
- assumed response criteria
- assumed progression criteria
- assumed resistance criteria

Do not assume that increasing is good or bad.
Do not assume that decreasing is good or bad.

The status must be determined from the actual longitudinal evidence.

============================================================
TREND VS STATUS
============================================================

`trend` describes only the observed direction of the tracked value.

`status` is a separate longitudinal interpretation of the complete source
evidence for that series.

Do NOT simply copy the trend into status.

Do NOT mechanically transform:
- up -> worse
- down -> better
- flat -> stable

Those conclusions are not universally valid.

The status must be generated by reading the complete series and its
source-grounded context.

The supplied `trend` may be considered as one input, but it is not itself
the status.

============================================================
PRE / DURING / POST
============================================================

If an observation contains a source-supported phase/timing field, preserve
it in that observation.

A phase label NEVER creates a separate series.

If the same entity has observations across pre, during, and post treatment,
all of those observations must remain in the SAME series and the status must
consider them together.

============================================================
OUTPUT
============================================================

Return JSON only:

{
    "organ": [
        {
            "series_id": "...",
            "status": null,
            "status_rationale": null
        }
    ],
    "marker": [
        {
            "series_id": "...",
            "status": null,
            "status_rationale": null
        }
    ],
    "imaging": [
        {
            "series_id": "...",
            "status": null,
            "status_rationale": null
        }
    ]
}

Return exactly the three buckets.

Return one status object for every supplied series.

Do not create new series.

Do not remove series.

Do not return observations in this response.

Return JSON only.
"""


# ============================================================================
# OPTIMIZED RESPONSE FLOWSHEET PROMPT
# ============================================================================
# The old implementation used one LLM call to reconcile series and another
# LLM call to generate longitudinal status. This combined prompt performs both
# semantic operations in one call while keeping the exact public flowsheet
# contract: organ / marker / imaging, with series observations plus status.
# ============================================================================

RESPONSE_FLOWSHEET_RECONCILIATION_AND_STATUS_PROMPT = (
    RESPONSE_FLOWSHEET_RECONCILIATION_PROMPT
    + "\n\n"
    + RESPONSE_FLOWSHEET_STATUS_PROMPT
    + """

============================================================
FINAL COMBINED FLOWSHEET INSTRUCTION
============================================================

Perform BOTH operations in this SINGLE call:

STEP 1 — Semantic reconciliation
- Inspect the complete journey and the supplied existing flowsheet.
- Recover source-supported observations missing from the supplied flowsheet.
- Keep one longitudinal series for the same underlying source-supported entity.
- Preserve all distinct observations, visits, measurements, units, phases and
  source event_ids.
- Do not merge entities unless the source supports their identity.

STEP 2 — Longitudinal status
- After constructing the reconciled series, read every observation in each
  series together.
- Generate exactly one `status` and `status_rationale` for each series.
- Status must use only the supplied source-grounded series evidence and the
  source-grounded Response & Resistance fields already present in
  `current_section` (including status_cards, response_trajectory,
  resistance_signal, new_findings and intelligence when they explicitly support
  the same series).
- If the complete journey or current_section contains a source-supported
  longitudinal state for a series, `status` is REQUIRED and must not be null.
- Null is appropriate only when there is genuinely insufficient
  series-specific evidence for any meaningful status.
- Do not invent clinical conclusions or apply fixed thresholds/rules.

FINAL OUTPUT CONTRACT
Return JSON only with exactly these three top-level buckets:

{
  "organ": [...],
  "marker": [...],
  "imaging": [...]
}

Each series object must retain ALL fields required by the existing flowsheet
reconciliation contract and must additionally contain:

"longitudinal_identity": "...",
"status": null,
"status_rationale": null

Do not return an `all` bucket or any other top-level bucket. Do not return a
status-only representation that discards observations. The observations and
longitudinal status must be present together in the same series objects.

STATUS COMPLETENESS:
For every series with sufficient longitudinal evidence, make a source-grounded
status non-null. Do not leave status null merely because the raw source does
not contain a literal field named status. Read all observations together. Do
not simply copy trend into status. When an observation has an explicit source
status, preserve it as supporting evidence.

IMAGING COMPLETENESS:
Whenever the complete journey contains imaging/diagnostic measurements or
findings relevant to Response & Resistance, the imaging bucket MUST be
populated. Inspect the complete document_text of every source event, not only
the existing flowsheet. Preserve individual imaging measurements/findings,
site/context, exact values, units, dates, visits, interpretations and
event_ids. Keep distinct lesions, organs and measurements distinct unless
the source establishes they are the same entity. Do not reduce an imaging
report to a generic label. Do not discard baseline or later imaging.
Classify source-supported imaging evidence into the imaging bucket using the
actual evidence, without disease-specific keyword mappings.

Return JSON only.
"""
)


async def reconcile_response_flowsheet(
    patient_id: str,
    visits: List[Dict[str, Any]],
    journey: Dict[str, Any],
    flowsheet: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Single-call semantic reconciliation + longitudinal status generation.

    This replaces the previous two-call sequence:
      1. flowsheet reconciliation
      2. status generation

    The public output contract is unchanged. Python still performs deterministic
    provenance validation, structural normalization and deduplication.
    """

    empty_result = {
        "organ": [],
        "marker": [],
        "imaging": [],
    }

    if not isinstance(flowsheet, dict):
        return empty_result

    payload = {
        "patient_id": patient_id,
        "visit_history": build_visit_history(visits),
        "journey": journey,
        "existing_flowsheet": flowsheet,
    }

    result = await groq_json(
        RESPONSE_FLOWSHEET_RECONCILIATION_AND_STATUS_PROMPT,
        payload,
        max_tokens=16000,
        retries=2,
    )

    if (
        not isinstance(result, dict)
        or result.get("_agent_status") == "failed"
    ):
        logger.warning(
            "Response flowsheet reconciliation/status failed | patient={}",
            patient_id,
        )
        return flowsheet

    reconciled = result.get("flowsheet")
    if not isinstance(reconciled, dict):
        reconciled = result

    normalized = {}
    for bucket in ("organ", "marker", "imaging"):
        values = reconciled.get(bucket)
        normalized[bucket] = (
            values if isinstance(values, list) else []
        )

    valid_event_ids = {
        event.get("event_id")
        for visit in visits
        if isinstance(visit, dict)
        for event in (visit.get("events") or [])
        if isinstance(event, dict)
        and event.get("event_id")
    }

    normalized = validate_response_evidence_output(
        normalized,
        valid_event_ids,
    )

    normalized_series = {
        bucket: _coerce_flowsheet_series(
            normalized.get(bucket) or []
        )
        for bucket in ("organ", "marker", "imaging")
    }

    # The combined LLM call already generated status fields on the same
    # reconciled series. Preserve them while performing final structural
    # cleanup. No second LLM call is made here.
    for bucket in ("organ", "marker", "imaging"):
        for series in normalized_series[bucket]:
            if not isinstance(series, dict):
                continue
            series.setdefault("status", None)
            series.setdefault("status_rationale", None)

    return {
        bucket: dedupe_section_output(
            normalized_series.get(bucket) or []
        )
        for bucket in ("organ", "marker", "imaging")
    }


async def reconcile_response_section(
    patient_id: str,
    visits: List[Dict[str, Any]],
    journey: Dict[str, Any],
    evidence_inventory: List[Dict[str, Any]],
    generated_section: Dict[str, Any],
    existing_section: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Final source-grounded completeness pass over the entire Response &
    Resistance section.

    This pass is intentionally semantic and LLM-driven. Deterministic Python
    is used only after this pass for visit pivoting and numeric comparison.
    """

    payload = {
        "patient_id": patient_id,
        "visits": build_visit_history(visits),
        "journey": journey,
        "evidence_inventory": evidence_inventory or [],
        "existing_section": existing_section or {},
        "generated_section": generated_section or {},
    }

    result = await groq_json(
        RESPONSE_SECTION_COMPLETENESS_RECONCILIATION_PROMPT,
        payload,
        max_tokens=14000,
        retries=2,
    )

    if (
        not isinstance(result, dict)
        or result.get("_agent_status") == "failed"
    ):
        logger.warning(
            "Response section completeness reconciliation failed | patient={}",
            patient_id,
        )
        return generated_section or {}

    # The prompt returns the section fields directly. Accept a nested
    # `response_resistance` wrapper as a compatibility fallback.
    reconciled = result.get("response_resistance")

    if not isinstance(reconciled, dict):
        reconciled = result

    if not isinstance(reconciled, dict):
        return generated_section or {}

    return reconciled


# ============================================================================
# SECTION AGENT PROMPTS
# ============================================================================

# ============================================================================

RAW_JOURNEY_CONTRACT = """
You are a clinical longitudinal information organization agent.

You are given the patient's complete source-event journey.

The raw source events are authoritative.

Your job is NOT to invent a clinical interpretation.

Your job is to organize only information actually supported by the supplied
source material.

The patient may have any disease, any cancer type, any specialty, any age,
any treatment history, or no cancer at all.

Do not assume any diagnosis, organ, disease, treatment, modality, marker,
pathway, specialty, or clinical state.

Do not use:
- keyword mappings
- hardcoded disease rules
- specialty rules
- predefined clinical examples
- pattern matching
- assumptions based on common clinical practice

A UI section does not mean the patient has information for that section.

An empty section is a valid result.

============================================================
SOURCE GROUNDING
============================================================

Every clinical item MUST contain event_ids identifying the exact supplied
source event(s) supporting the statement.

Only event_ids present in the supplied journey are valid.

If evidence is not present, return an empty array or null.

Never manufacture evidence.

============================================================
TEMPORAL GROUNDING
============================================================

Use the source event's document_date and visit_number.

Do not move a finding to another visit.

Do not create chronology that is not supported by the source.

Do not assume that the most recent document represents the most recent
clinical state unless its date establishes that.

============================================================
UNCERTAINTY
============================================================

Preserve source certainty.

If the source says:
- suspected
- possible
- provisional
- probable
- pending
- recommended
- planned

do not convert it into a confirmed completed fact.

If the source documents a confirmed result, preserve that status.

============================================================
LONGITUDINAL RULE
============================================================

When multiple events describe the same clinical concept, preserve the
individual source evidence and chronology.

Do not collapse separate observations into one fact unless the source
supports that relationship.

============================================================
SECTION RELEVANCE
============================================================

Only place an item into the requested section when its actual source
content belongs to that section.

Clinical relevance to the patient is NOT sufficient.

For example, an imaging observation may be important to the patient while
still not being molecular/genomic evidence.

============================================================
OUTPUT
============================================================

Return valid JSON only.
"""

NO_DUPLICATION_RULES = """

============================================================
NO DUPLICATION (applies to EVERY list you return)
============================================================

- Each list must contain every underlying fact exactly once.
- If the same fact is documented in several source events (repeated saves
  of the same record, amended/final versions, or restated in another
  document), output ONE item and put ALL supporting event_ids in that
  item's event_ids array. Never create one item per source event.
- When several versions of the same record exist, represent the most
  recent/complete version. Keep an earlier version only when it documents
  a genuinely different value, status, date, site/side, specimen, cycle
  or visit.
- Two items are distinct ONLY if some documented attribute differs.
  Different wording of the same content is NOT a difference.
- Never restate one fact as several items with rephrased wording.
- Use one consistent wording and format for a concept everywhere: put the
  measured value in "value" and its unit in "unit"; do not mix
  representations of the same observation.
- Summary/narrative fields must synthesize: one entry per distinct point,
  not a copy of the detailed lists.
"""

RAW_JOURNEY_CONTRACT = RAW_JOURNEY_CONTRACT + NO_DUPLICATION_RULES

OVERVIEW_PROMPT = RAW_JOURNEY_CONTRACT + """

You are the Overview Agent.

Create the Overview section using ONLY information directly supported by
the supplied source events.

The supplied source events are the authoritative source of truth.

Do not use outside medical knowledge to fill missing information.

Do not infer information that is not explicitly supported by the source.

============================================================
CANCER CASE IDENTITY
====================

Cancer Case Identity represents the documented characteristics that
establish or describe the identity of the patient's disease or clinical
case.

The identity attributes MUST be discovered dynamically from the supplied
source events.

There is NO predefined Cancer Case Identity schema.

Do NOT assume that every patient has the same identity attributes.

Do NOT assume that every cancer type has the same identity attributes.

Do NOT hardcode clinical fields.

Do NOT use keyword-to-field mappings.

Do NOT use disease-specific mappings.

Do NOT use cancer-type-specific mappings.

Do NOT use specialty-specific mappings.

Do NOT use regex or pattern-based extraction.

Do NOT use predefined clinical examples.

Do NOT use a predefined list of possible attributes.

Do NOT force the source information into a fixed clinical structure.

Instead, inspect the supplied source events and determine which
documented characteristics are relevant to establishing the patient's
disease/case identity.

The available attributes must emerge from the source itself.

============================================================
DYNAMIC IDENTITY ATTRIBUTE DISCOVERY
====================================

Determine the identity-defining characteristics from the actual supplied
source information.

An identity characteristic may be represented when the source explicitly
documents it and when it materially contributes to describing the
patient's documented disease/case identity.

The number of identity attributes is completely dynamic.

There may be zero, one, several, or many identity attributes.

Do not create an attribute merely because it is commonly used in oncology.

Do not create an attribute merely because it exists for another patient.

Do not create an attribute merely because it is medically possible.

Do not create an attribute when the source does not support it.

Do not create empty attributes.

Do not create placeholder attributes.

Do not output:

* Unknown
* Not available
* Not documented
* N/A

unless that exact information is explicitly documented by the source.

============================================================
LABEL
=====

For every dynamically identified identity characteristic, create a concise
human-readable label describing what the corresponding value represents.

The label must be derived from the meaning of the source information.

The label must not be generated from a hardcoded clinical-field list.

The label should be suitable for display as the left-hand column of a
compact clinical information table.

The label and value must represent the same source-supported information.

Do not create a label without a corresponding source-supported value.

============================================================
VALUE
=====

For every dynamically identified identity characteristic, provide a concise
human-readable value extracted from the supplied source.

Preserve the source terminology and documented certainty.

Do not introduce medical interpretation that is not supported by the source.

Do not infer missing values.

Do not convert uncertain information into confirmed information.

Do not convert planned information into completed information.

Do not convert suspected information into confirmed information.

Do not combine unrelated source findings into one value.

When multiple source events describe the same identity characteristic,
consolidate them only when the source supports that they refer to the same
clinical characteristic.

When source events document distinct characteristics, represent them as
distinct label/value items.

============================================================
CLINICAL IDENTITY RELEVANCE
===========================

Use the clinical meaning of the supplied source information to determine
whether a documented characteristic belongs in Cancer Case Identity.

The agent must distinguish identity-defining information from:

* transient observations
* routine measurements
* isolated symptoms
* individual laboratory results
* individual imaging findings
* treatment administration details
* appointment metadata
* administrative information
* unrelated historical information

Do not place information into Cancer Case Identity merely because it is
clinically important.

The information must contribute to describing the documented disease or
case identity.

============================================================
LONGITUDINAL INFORMATION
========================

The source may contain identity information across multiple visits and
documents.

Use the longitudinal source information when determining Cancer Case
Identity.

If multiple source events confirm the same characteristic, represent the
characteristic once rather than duplicating it for every source event.

If different source events document genuinely different states of the same
characteristic, do not silently merge contradictory information.

Preserve the clinically meaningful distinction when it is supported by the
source.

Use the most appropriate documented state only when the longitudinal
evidence clearly establishes that it supersedes the earlier information.

Do not determine chronology from assumptions.

Use the actual dates and source-event information supplied in the journey.

============================================================
NO HALLUCINATION
================

Cancer Case Identity must contain ONLY information supported by the
supplied source events.

Do not infer any disease characteristic from general medical knowledge.

Do not infer an anatomical site.

Do not infer a cancer type.

Do not infer a histology.

Do not infer a subtype.

Do not infer laterality.

Do not infer grade.

Do not infer stage.

Do not infer biomarker status.

Do not infer molecular status.

Do not infer metastatic status.

Do not infer mutation status.

Do not infer prognosis.

Do not infer treatment response.

Do not infer disease progression.

Do not infer any other characteristic that is not supported by the source.

============================================================
OUTPUT REPRESENTATION
=====================

Cancer Case Identity must be represented as a list of generic label/value
objects.

The representation is intentionally generic so that it can accommodate any
patient and any cancer type without requiring a predefined clinical schema.

Use:

{
"cancer_case_identity": [
{
"label": "<dynamically derived label>",
"value": "<source-supported value>"
}
]
}

The array may contain any number of objects.

The number of objects MUST be determined dynamically from the supplied
source information.

Do not add fixed fields.

Do not add fields that are not supported by the source.

Do not create an object with a null or empty value.

Do not include clinical source identifiers in these objects.

============================================================
DISPLAY ORDER
=============

Order the identity attributes according to their relevance to the
documented case identity and the logical readability of the information.

Do NOT use a predefined field ordering.

Do NOT assume that one clinical attribute must always appear before another.

The ordering must be determined dynamically from the supplied information.

Place the most fundamental identity-defining information before less
central descriptive characteristics when the source supports such an
ordering.

============================================================
INTERNAL SOURCE GROUNDING
=========================

The source events may contain internal identifiers used by the system for
traceability and evidence verification.

These identifiers are internal metadata.

They are NOT part of the Cancer Case Identity user-facing representation.

Do not output:

* event_id
* event_ids
* source_event_id
* source_event_ids
* document_id
* appointment_id
* appointment_ids

Do not place these identifiers inside label or value strings.

Use source information for grounding, but return only the clinical
label/value representation in Cancer Case Identity.

============================================================
IDENTITY
========

The Identity section must also be generated dynamically from the supplied
source information.

Do not use a predefined identity schema.

Include only information directly supported by the source that describes
the patient or the clinical context relevant to the Overview.

Do not duplicate Cancer Case Identity unnecessarily.

============================================================
CURRENT STATE
=============

Current State must be based on the latest relevant documented evidence.

Determine the current state dynamically from the supplied source events.

Do not use predefined clinical states.

Do not infer a current state from general medical knowledge.

Do not treat an appointment date as proof of a clinical change.

Do not assume a treatment has started because it is planned.

Do not assume a procedure has occurred because it was scheduled.

Do not assume a diagnosis has been confirmed because it was suspected.

Only describe a current state when supported by the source.

============================================================
WHAT CHANGED
============

"What Changed" must represent an actual longitudinal difference supported
by at least two temporally distinct source observations OR an explicitly
documented change.

Determine the changed characteristics dynamically from the source.

Do not use predefined change categories.

Do not use keyword mappings.

Do not manufacture changes.

Do not describe a value as changed when only one observation exists.

Do not interpret the mere existence of a later document as a clinical
change.

For a single-visit patient, this may legitimately be [].

============================================================
KEY FINDINGS
============

Only include clinically important findings actually documented in the
source.

Determine the findings dynamically.

Do not use a predefined list of findings.

Do not use disease-specific keyword mappings.

Do not manufacture clinical significance that is not supported by the
source.

============================================================
CURRENT STATUS
==============

Current Status must contain only dynamically identified current clinical
information supported by the latest relevant source evidence.

Do not use a predefined status schema.

Do not infer status from treatment plans, appointments, or administrative
metadata.

============================================================
NARRATIVE
=========

The narrative must summarize the documented clinical picture using only
information supported by the supplied source events.

Do not introduce information that does not appear in the source.

Do not repeat information unnecessarily.

If there is insufficient source information to produce a meaningful
narrative, return null.

============================================================
OUTPUT
======

Return exactly this top-level structure:

{
"cancer_case_identity": [],
"identity": [],
"current_state": [],
"key_findings": [],
"what_changed": [],
"current_status": [],
"narrative": null
}

Cancer Case Identity must contain generic label/value objects:

{
"cancer_case_identity": [
{
"label": "...",
"value": "..."
}
]
}

All labels and values must be dynamically derived from the supplied source.

Do not hardcode clinical attributes.

Do not use keyword mapping.

Do not use predefined examples.

Do not use predefined patterns.

Do not use disease-specific logic.

Do not use cancer-type-specific logic.

Do not use specialty-specific logic.

Do not infer missing information.

Do not expose internal source identifiers.

Return valid JSON only.
"""


TREATMENT_PROMPT = RAW_JOURNEY_CONTRACT + """

You are the Regimen & Treatment Agent.

Organize only treatment and procedure information explicitly documented in
the source.

Every item must contain event_ids.

Preserve the distinction between:

- planned
- recommended
- proposed
- ordered
- scheduled
- started
- administered
- completed
- held
- stopped
- discontinued
- declined
- cancelled

Do not change one treatment state into another.

A planned treatment is NOT evidence that treatment occurred.

A recommended procedure is NOT evidence that the procedure was performed.

A treatment mentioned in a historical document is NOT automatically current.

============================================================
CURRENT
============================================================

Only identify a treatment as current when the source supports current status.

============================================================
HISTORY
============================================================

Preserve documented historical treatment events with their source dates.

============================================================
TIMELINE
============================================================

Do not create treatment dates that do not exist in the source.

CUMULATIVE EXPOSURE RECONSTRUCTION

Inspect the COMPLETE longitudinal journey.

When the source contains multiple treatment-related observations across visits,
preserve them longitudinally.

If the source explicitly provides cumulative exposure, preserve it.

If the source contains multiple source-supported administration or exposure
observations that together document a cumulative history, organize those
observations into the cumulative exposure representation without inventing
values or performing unsupported clinical calculations.

Do not discard earlier observations because a later observation exists.

Do not create a cumulative value when the source does not support one.

The purpose is complete source representation, not clinical estimation.

============================================================
OUTPUT
============================================================

{
    "regimen_history_cumulative_exposure": [],
    "current": [],
    "history": [],
    "timeline": [],
    "exposure": [],
    "plans": [],
    "changes": [],
    "procedures": [],
    "decisions": [],
    "narrative": null
}

Every clinical item must contain event_ids.

Return JSON only.
"""

TRENDS_PROMPT = RAW_JOURNEY_CONTRACT + """
You are the Trends & Statistics presentation agent.

Read the COMPLETE supplied longitudinal journey.

The journey is the only source of truth.

Your task is to organize source-supported longitudinal information into
exactly five application presentation fields.

Do not create a generic metric inventory.

Do not create a top-level `series` collection.

Do not return all measurable parameters.

Do not use keyword mappings.

Do not use regex.

Do not use predefined laboratory lists.

Do not use predefined biomarker lists.

Do not use disease-specific rules.

Do not use cancer-specific rules.

Do not use organ-specific rules.

Do not use specialty-specific rules.

Do not invent information.

The five presentation fields are application-level output slots only:

1. cumulative_dose_vs_limit
2. toxicity_visit_over_visit
3. tumor_burden
4. key_labs
5. biomarkers

For every populated observation, preserve:
- visit_number
- visit_date
- value
- unit
- status when source-supported
- event_ids

Every event_id must come from the supplied journey.

If a presentation field has source-supported information, populate it.

If a presentation field genuinely has no source-supported information,
return null.

Do not return null merely because the field contains a different
parameter/entity than an expected example.

============================================================
OUTPUT
============================================================

Return ONLY:

{
    "cumulative_dose_vs_limit": null,
    "toxicity_visit_over_visit": null,
    "tumor_burden": null,
    "key_labs": null,
    "biomarkers": null
}

============================================================
CUMULATIVE DOSE VS LIMIT
============================================================

Populate from source-supported longitudinal treatment exposure information.

Discover the treatment/exposure identity from the source.

Do not assume a particular drug, treatment, unit or limit.

If the source contains cumulative exposure observations and a documented
limit/ceiling/reference, preserve them.

If no source-supported limit exists, preserve the exposure information and
leave the unsupported limit as null rather than inventing it.

============================================================
TOXICITY VISIT OVER VISIT
============================================================

Populate from source-supported longitudinal toxicity/adverse-effect
observations.

Discover the toxicity entities from the source.

Do not use a predefined toxicity list.

Preserve source-supported grades, observations, visits and dates.

Do not invent a grade.

============================================================
TUMOR BURDEN
============================================================

Populate from source-supported longitudinal disease/lesion/tumor burden
measurements.

Discover the relevant entities from the source.

Do not assume a particular organ, lesion, modality or measurement method.

Preserve the actual source measurements and their longitudinal context.

Do not invent an aggregate measurement that the source does not support.

============================================================
KEY LABS
============================================================

Populate from source-supported longitudinal laboratory observations.

Discover the laboratory parameters from the complete journey.

Do not use a fixed laboratory list.

If several laboratory parameters have longitudinal observations, preserve
each as a separate row/series inside this presentation object.

Preserve exact source values and units.

============================================================
BIOMARKERS
============================================================

Populate from source-supported longitudinal biomarker observations.

Discover the marker identity from the complete journey.

Do not use a predefined marker list.

Preserve qualitative and quantitative source values exactly.

============================================================
PRESENTATION OBJECT FORMAT
============================================================

For chart-like information:

{
    "title": "...",
    "view_type": "chart",
    "series": [
        {
            "series_id": "...",
            "parameter": "...",
            "unit": "...",
            "observations": [
                {
                    "visit_number": 1,
                    "visit_date": "...",
                    "value": "...",
                    "unit": "...",
                    "status": "...",
                    "event_ids": ["..."]
                }
            ],
            "trend": "...",
            "trend_rationale": "..."
        }
    ]
}

For table-like information:

{
    "title": "...",
    "view_type": "table",
    "rows": [
        {
            "series_id": "...",
            "parameter": "...",
            "unit": "...",
            "observations": [
                {
                    "visit_number": 1,
                    "visit_date": "...",
                    "value": "...",
                    "unit": "...",
                    "status": "...",
                    "event_ids": ["..."]
                }
            ],
            "trend": "...",
            "trend_rationale": "..."
        }
    ]
}

The `series` or `rows` inside an individual presentation object are
rendering structures only.

They are NOT a generic Trends & Statistics inventory.

Return JSON only.
"""
# ============================================================================
# RESPONSE & RESISTANCE — EXHAUSTIVE EVIDENCE DISCOVERY
# ============================================================================

RESPONSE_EVIDENCE_DISCOVERY_PROMPT = RAW_JOURNEY_CONTRACT + """
You are the Evidence Discovery Agent for the Response & Resistance section.

Your task is ONLY to discover and preserve source evidence.

You are NOT responsible for deciding whether something represents:
- response
- resistance
- progression
- toxicity
- pathway deviation
- benchmark
- improvement
- worsening
- stability

Do not make those conclusions in this pass.

The complete longitudinal journey supplied to you is the only source of truth.

The patient may have any disease, cancer type, specialty, organ, treatment,
modality, laboratory system, pathology system, imaging system, biomarker,
procedure, or none of these.

Do not use:

- hardcoded diseases
- hardcoded cancer types
- hardcoded organs
- hardcoded biomarkers
- hardcoded imaging modalities
- hardcoded treatments
- keyword mappings
- regex
- string-pattern rules
- predefined clinical examples
- fixed clinical concept lists
- disease-specific rules
- specialty-specific rules
- treatment-specific rules

============================================================
PRIMARY OBJECTIVE
============================================================

Inspect EVERY visit.

Inspect EVERY source event.

Inspect the COMPLETE document_text of every event.

Do not stop after finding the first relevant observation.

Do not use only the latest visit.

Do not use only the latest event.

Discover all source-supported evidence that could be relevant to longitudinal
response, treatment effect, disease evolution, tolerance, toxicity,
outcome assessment, pathway changes, or newly documented findings.

The purpose of this pass is INFORMATION PRESERVATION.

It is better to preserve a source observation that later turns out to be
irrelevant than to lose a source-supported observation.

============================================================
SOURCE EVIDENCE RECORD
============================================================

Represent each discovered source-supported observation as:

{
    "event_ids": ["..."],
    "visit_number": 1,
    "visit_date": "...",
    "document_date": "...",
    "evidence_type": "<derive from source>",
    "parameter": "<source-derived name or description>",
    "value": "<exact source value when applicable>",
    "unit": "<source unit when present, otherwise null>",
    "status": "<source wording when present, otherwise null>",
    "site": "<source-supported site/context when present, otherwise null>",
    "measurement": "<source-supported measurement when present, otherwise null>",
    "interpretation": "<source interpretation when explicitly documented, otherwise null>",
    "statement": "<concise source-grounded description>"
}

IMPORTANT:

The field names above are an output representation only.

They do NOT define a fixed clinical vocabulary.

If the source contains richer information, preserve that information in
the statement, measurement, interpretation, value, site, or other fields.

Do not throw away information simply because it does not fit one field.

============================================================
LONGITUDINAL PRESERVATION
============================================================

If the same source-supported parameter or finding occurs on multiple visits,
preserve each distinct observation.

For example, if a source provides:

- different values
- different dates
- different measurements
- different sites
- different specimens
- different statuses
- different interpretations
- different treatment contexts

preserve those as separate observations.

Do not collapse them into the latest value.

If the same underlying fact is repeated without a meaningful difference,
it may be represented once with all supporting event_ids.

============================================================
MEASUREMENTS
============================================================

Preserve every source-supported measurement relevant to this section.

Do not calculate a measurement.

Do not convert a measurement.

Do not normalize a measurement.

Do not replace the source representation.

If the source contains multiple dimensions of one measurement, preserve the
complete source representation.

============================================================
IMAGING / OBSERVATIONAL EVIDENCE
============================================================

Inspect source documents for all source-supported observations that can
describe the patient's longitudinal state.

Do not assume what constitutes imaging.

Do not assume what constitutes a lesion.

Do not assume what constitutes a marker.

Do not assume what constitutes a response measurement.

Discover those dimensions from the actual source.

Preserve:

- measurements
- values
- classifications
- observations
- interpretations
- locations
- dates
- comparisons
- source wording

when present.

============================================================
PATHOLOGY / DIAGNOSTIC EVIDENCE
============================================================

Inspect all source events for diagnostic or pathological observations that
describe the patient's state before, during, or after treatment.

Preserve the actual source-supported findings.

Do not convert them into a response conclusion.

Do not infer resistance.

Do not infer progression.

Do not infer treatment failure.

Preserve the evidence so the later analysis pass can determine whether the
source itself supports a conclusion.

============================================================
TREATMENT-RELATED EVIDENCE
============================================================

Preserve source-supported treatment events that provide context for
longitudinal assessment.

Include actual source-supported:

- treatment administration
- treatment timing
- treatment state
- treatment exposure
- treatment-related assessment
- treatment-related finding
- documented treatment effect
- documented treatment change
- documented treatment hold
- documented treatment interruption
- documented treatment completion
- documented treatment response assessment

Do not transform a treatment event into a clinical conclusion.

============================================================
TOXICITY / TOLERANCE EVIDENCE
============================================================

Preserve source-supported adverse effects, toxicity assessments,
treatment-related symptoms, grades, attribution, onset, resolution,
duration, or other documented treatment-tolerance information.

Preserve the source wording.

Do not infer causality.

Do not infer toxicity from an abnormal laboratory value alone.

============================================================
COMPARATIVE EVIDENCE
============================================================

If the source explicitly compares:

- an earlier state with a later state
- pre-treatment with post-treatment
- one observation with another
- baseline with subsequent findings
- treatment with outcome

preserve the comparison exactly as supported.

Do not create a comparison that is not source-supported.

============================================================
NEW FINDINGS
============================================================

Preserve source-supported findings that are newly documented relative to
the supplied longitudinal history.

Do not decide whether the finding represents progression or resistance.

============================================================
EVENT IDS
============================================================

Every evidence record MUST contain one or more event_ids.

Every event_id MUST exist in the supplied journey.

Never invent an event_id.

============================================================
COMPLETENESS AUDIT
============================================================

Before returning the result:

1. Inspect every visit.
2. Inspect every source event.
3. Inspect every document_text.
4. Inspect all longitudinally distinct observations.
5. Inspect treatment-related evidence.
6. Inspect toxicity/tolerance evidence.
7. Inspect diagnostic/pathological evidence.
8. Inspect observational/measurement evidence.
9. Inspect explicitly documented comparisons.
10. Inspect newly documented findings.
11. Preserve event_ids for every item.
12. Do not return only the latest visit.
13. Do not return only one category of evidence.
14. Do not discard evidence because it does not fit a predefined concept.

The objective is exhaustive SOURCE EVIDENCE DISCOVERY.

Return JSON only:

{
    "evidence": []
}
"""

RESPONSE_ANALYSIS_PROMPT = """
You are the Response & Resistance Analysis Agent.

You are given:

1. the COMPLETE longitudinal source journey
2. an exhaustive source-evidence inventory produced from that journey

The source journey remains authoritative.

The evidence inventory is an assistance layer for completeness.
It is NOT authoritative if it conflicts with the raw journey.

Use the raw journey to verify every conclusion.

============================================================
NO HARD-CODING
============================================================

Do not use:

- hardcoded diseases
- hardcoded cancer types
- hardcoded organs
- hardcoded biomarkers
- hardcoded imaging modalities
- hardcoded treatments
- keyword mappings
- regex
- pattern-based clinical rules
- predefined clinical examples
- fixed disease rules
- specialty-specific rules
- treatment-specific rules

All concepts must emerge from the supplied source.

============================================================
COMPLETENESS
============================================================

The evidence inventory was intentionally created before this analysis.

Do not discard source evidence merely because it does not directly establish
response or resistance.

Evidence that does not establish a conclusion must still be represented
where the output contract provides an evidence/trajectory/flowsheet field.

============================================================
RESPONSE
============================================================

Return response information only when supported by the source.

An explicit source-supported response assessment may be represented.

An explicit source-supported comparison may be represented.

A documented post-treatment assessment may be represented when the source
supports the relationship.

Do not manufacture response.

============================================================
RESISTANCE
============================================================

Resistance is a clinical conclusion.

Only report it when the source itself explicitly documents it or provides
sufficient source-supported evidence establishing that conclusion.

Do not convert residual disease, persistent disease, treatment change,
treatment interruption, or a later abnormality into resistance unless the
source establishes that relationship.

============================================================
PROGRESSION
============================================================

Only report progression when source-supported.

Do not infer progression simply from disease persistence or a single
finding.

============================================================
TOXICITY
============================================================

Preserve documented toxicity/adverse-effect evidence.

If the source documents grade, attribution, onset, duration, resolution,
or treatment relationship, preserve those details.

Do not infer causality.

============================================================
PATHWAY
============================================================

Preserve explicit source-documented pathway changes, delays, holds,
interruptions, cancellations, modifications, prerequisites, or other
documented deviations.

Do not compare against external guidelines.

============================================================
TRAJECTORY
============================================================

Trajectory is longitudinal evidence, not merely a response verdict.

Preserve chronologically distinct source-supported observations relevant to
this section.

Do not leave trajectory empty merely because formal response is absent.

============================================================
FLOWSHEET
============================================================

The flowsheet is an evidence-preservation representation.

It must NOT depend on whether response or resistance is present.

For every source-supported trackable observation relevant to this section:

- preserve the parameter/finding
- preserve the exact value
- preserve unit
- preserve visit_number
- preserve visit_date
- preserve source status when documented
- preserve event_ids

Create parameter series dynamically from the source.

Do not use a predefined parameter list.

Do not use a predefined category list.

Do not throw away imaging/diagnostic/pathological measurements merely
because routine laboratory values were already discovered.

If an observation belongs to more than one presentation bucket, it may appear
in each applicable bucket.

============================================================
STATUS CARDS
============================================================

Status cards are summaries of already supported evidence.

They must never be the only location where evidence appears.

============================================================
FINAL FIELD AUDIT
============================================================

Before returning:

For EACH top-level field independently:

1. inspect the evidence inventory
2. inspect the raw journey
3. determine whether source-supported information exists
4. populate the field if supported
5. leave it empty only when unsupported

An empty field in a previous generated section is NOT evidence that the
source lacks the information.

Return JSON only.

Use this contract:

{
    "summary": [],
    "trajectory": [],
    "status_cards": [],
    "response_trajectory": [],
    "resistance_signal": [],
    "pathway_deviation": [],
    "pathway_deviation_log": [],
    "outcome_benchmark": [],
    "outcome_benchmark_note": null,
    "new_findings": [],
    "flowsheet": {
        "organ": [],
        "marker": [],
        "imaging": []
    },
    "intelligence": {
        "response": {},
        "toxicity": {},
        "progression": {}
    },
    "narrative": null
}

Every clinical assertion MUST contain event_ids.

Every event_id MUST exist in the supplied journey.

Return JSON only.
"""


# ============================================================================
# OPTIMIZED RESPONSE PROMPT
# ============================================================================
# The old implementation used two LLM calls for evidence discovery and
# response analysis. This prompt keeps both responsibilities in ONE call.
# The evidence inventory is returned under the internal `_evidence_inventory`
# field so the existing completeness-reconciliation call can still use it.
# `_evidence_inventory` is removed before persistence and is therefore NOT part
# of the public output contract.
# ============================================================================

RESPONSE_EVIDENCE_AND_ANALYSIS_PROMPT = (
    RESPONSE_EVIDENCE_DISCOVERY_PROMPT
    + "\n\n"
    + RESPONSE_ANALYSIS_PROMPT
    + """

============================================================
FINAL COMBINED-CALL INSTRUCTION
============================================================

This is a SINGLE combined pass. Do both jobs before returning the result:

1. Exhaustively inspect the COMPLETE journey and internally identify every
   source-supported observation relevant to Response & Resistance.
2. Analyze those observations and produce the COMPLETE Response & Resistance
   section using the exact contract required by the analysis prompt.
3. Perform the completeness checks from BOTH prompts before returning JSON.
4. Preserve every source-supported event, visit, measurement, value, unit,
   phase, status, rationale and event_id required by the existing contract.
5. Do not omit information merely because it is not part of a response or
   resistance conclusion.
6. Do not invent information.

The final response must contain the normal Response & Resistance section fields
from RESPONSE_ANALYSIS_PROMPT. In addition, include this INTERNAL field:

"_evidence_inventory": [
  {
    "event_id": "...",
    "visit_number": ...,
    "category": "...",
    "observation": "..."
  }
]

The internal evidence inventory is used only by the subsequent completeness
reconciliation pass. It must contain only source-supported evidence from the
complete journey. It will be removed before persistence.

IMPORTANT: `_evidence_inventory` must NOT replace, summarize, or omit any of
the normal Response & Resistance contract fields. The normal section output is
still mandatory.

Return JSON only.
"""
)

RESPONSE_PROMPT = RAW_JOURNEY_CONTRACT + """

You are the Response & Resistance section agent.

Your responsibility is to organize source-supported longitudinal evidence
related to response, resistance, progression, toxicity, treatment-pathway
changes, outcome assessment, and newly documented findings.

The source journey is authoritative.

The patient population is completely heterogeneous.

The patient may have:
- any cancer type
- any disease type
- any organ/site
- any specialty
- any treatment
- any biomarker
- any laboratory measurement
- any imaging modality
- any pathology finding
- any number of visits
- no treatment yet
- partial treatment history
- complete treatment history

Therefore the reasoning MUST be learned from the supplied source evidence.

Do NOT use:
- hardcoded cancer types
- hardcoded diseases
- hardcoded organs
- hardcoded biomarkers
- hardcoded imaging modalities
- hardcoded treatments
- keyword mappings
- regex
- string-pattern clinical rules
- predefined clinical examples
- predefined clinical measurements
- disease-specific rules
- specialty-specific rules
- treatment-specific rules
- assumed response criteria
- assumed progression criteria
- assumed resistance criteria
- assumed toxicity criteria

============================================================
SOURCE OF TRUTH
============================================================

Use ONLY information present in the supplied raw journey.

Every clinical assertion MUST contain event_ids.

Every event_id MUST exist in the supplied journey.

Never invent an event_id.

Never invent a measurement.

Never invent a value.

Never invent a date.

Never invent a diagnosis.

Never invent a treatment.

Never invent a response assessment.

Never invent resistance.

Never invent progression.

Never invent toxicity.

Never invent a comparison.

Never invent clinical significance.

============================================================
LONGITUDINAL EVIDENCE
============================================================

Use ALL relevant source events, not only the latest event.

Preserve the chronology represented by the source.

When multiple observations describe the same clinical concept at different
times, preserve the longitudinal sequence.

When multiple observations contain different values, dates, sites, specimens,
measurements, statuses, or clinically meaningful context, preserve them as
distinct observations.

When the same underlying fact is repeated without a meaningful difference,
do not duplicate it merely because it occurs in multiple source documents.

Source-document identity alone is NOT sufficient to create a separate
clinical event.

============================================================
BASELINE / REFERENCE EVIDENCE
============================================================

Baseline evidence and treatment response are different concepts.

A patient can have extensive baseline disease evidence without having any
documented treatment response.

If treatment-response evidence does not exist, DO NOT manufacture response.

However, do NOT discard source-supported baseline evidence.

Any documented clinical observation that establishes the patient's state
before or around treatment may be preserved as reference evidence when it is
relevant to this section.

The reference evidence must be derived from the supplied source.

Do not assume which dimensions constitute a baseline.

Discover the available dimensions from the actual source events.

Preserve source-supported:
- findings
- observations
- measurements
- values
- statuses
- interpretations
- dates
- context
- source event_ids

Do not convert baseline evidence into a response assessment.

============================================================
RESPONSE
============================================================

A response assessment requires source-supported longitudinal evidence.

A response may be represented when the source:

- explicitly documents a response assessment
- explicitly compares observations across time
- explicitly attributes a change to treatment
- documents a post-treatment assessment that establishes the response
- otherwise provides sufficient source-supported longitudinal evidence for
  the relationship

Do NOT infer response merely because:

- treatment exists
- treatment was started
- treatment was changed
- a later measurement exists
- a value increased
- a value decreased
- disease remains present
- disease is absent from one observation
- a laboratory value changed
- an imaging finding changed

Do not calculate a clinical response criterion unless that criterion is
explicitly supported by the source.

If response is not supported:

"response_trajectory": []

and:

"intelligence": {
    "response": {}
}

============================================================
TRAJECTORY
============================================================

Trajectory represents documented longitudinal evolution.

Trajectory is broader than treatment response.

If the source contains multiple observations over time, preserve their
chronological relationship.

If only a baseline observation exists, it may still be represented as
baseline/reference evidence.

Do not manufacture change where the source does not document change.

Do not manufacture improvement.

Do not manufacture worsening.

Do not manufacture stability.

============================================================
RESISTANCE
============================================================

Resistance is a clinical conclusion.

Return resistance only when the supplied source explicitly documents
resistance or provides source-supported clinical evidence that establishes
that conclusion.

Do NOT infer resistance from:

- treatment change
- treatment interruption
- treatment hold
- treatment discontinuation
- new disease finding
- persistent disease
- abnormal laboratory value
- biomarker change
- treatment planning
- treatment sequencing

If resistance is not supported:

"resistance_signal": []

============================================================
PROGRESSION
============================================================

Progression is a clinical conclusion.

Only report progression when supported by the source.

Do not infer progression from the existence of disease.

Do not infer progression from a single abnormal observation.

Do not infer progression from treatment initiation.

Do not infer progression from treatment interruption.

Do not infer progression from a treatment change.

Preserve the certainty expressed by the source.

If progression is not supported:

"intelligence": {
    "progression": {}
}

============================================================
TOXICITY
============================================================

Toxicity requires source-supported evidence.

Use documented adverse effects, documented toxicity assessments, documented
treatment-related findings, or other source-supported attribution.

Do not infer treatment-related toxicity merely from an abnormal laboratory
result.

Do not infer causality unless the source supports it.

If toxicity is not supported:

"intelligence": {
    "toxicity": {}
}

============================================================
PATHWAY DEVIATION
============================================================

Report pathway deviation only when the source documents an actual change,
delay, interruption, cancellation, hold, modification, or other departure
within the patient's documented pathway.

Do not compare the patient against an assumed standard pathway.

Do not introduce external guideline knowledge.

============================================================
OUTCOME BENCHMARK
============================================================

When the source contains documented observations that establish a reference
state for future longitudinal comparison, preserve those observations as
outcome benchmark evidence.

The benchmark MUST come from the source.

Do not invent benchmark values.

Do not assume which measurements should be benchmarks.

Discover available reference observations from the supplied evidence.

============================================================
NEW FINDINGS
============================================================

Include newly documented findings only when the source supports their
novelty within the supplied longitudinal history.

Do not call a finding "new" simply because it appears in the current input.

Do not invent novelty.

============================================================
STATUS CARDS  (generic — do not use a fixed list of card names)
============================================================

status_cards is a dynamically discovered set of short verdict cards.

A status card may be produced ONLY for a dimension where the supplied
source itself provides enough longitudinal or explicit evidence to state
a verdict in the source's own terms.

Do NOT force a fixed set of four cards. If the source supports a verdict
for a dimension, include it. If not, omit that card entirely — an
incomplete status_cards array is correct.

Do NOT invent a verdict label from a predefined vocabulary (e.g. do not
assume "IMPROVING"/"STABLE"/"WORSENING" is the only allowed set). Derive
the verdict label from how the source itself characterizes the finding
(e.g. "residual disease", "no evidence of recurrence", "on hold pending
cardiac clearance"). If the source uses no summarizing word at all, set
"status" to null and rely on "explanation" alone.

A status card must obey every rule already stated above for the dimension
it summarizes (RESPONSE, RESISTANCE, PROGRESSION, TOXICITY, PATHWAY
DEVIATION, OUTCOME BENCHMARK). A status card is a compact restatement of
evidence you have already validated elsewhere in this section — it never
introduces a conclusion that response_trajectory, resistance_signal,
intelligence, pathway_deviation, or outcome_benchmark does not itself
support.

Each status card:

{
    "id": "<short machine key derived from the dimension, e.g. response_trajectory>",
    "label": "<human-readable name for the dimension, source-derived>",
    "status": "<short verdict phrase taken from/derived from source wording, or null>",
    "explanation": "<one source-grounded sentence, e.g. what evidence and what visit>",
    "event_ids": ["..."]
}

============================================================
FLOWSHEET
============================================================

The flowsheet is an evidence-preservation layer.

It is NOT a clinical classification engine.

The existing containers:

- organ
- marker
- imaging

are presentation containers only. Do NOT produce an "all" bucket — the
backend builds it automatically as the union of organ + marker + imaging
immediately after this agent runs, so any "all" array you return is
discarded and never shown to the user.

They must NOT cause information loss.

Do NOT reduce a source-supported clinical observation to only its category
or label when additional evidence is available.

Each Response & Resistance flowsheet bucket:

- organ
- marker
- imaging
are dynamically relevant) is a list of PARAMETER SERIES, not a list of flat
findings. This lets a deterministic layer pivot the series by visit without
the model inventing which visit is "Cycle 1" vs "Cycle 2" — you only need
to anchor each observation to the actual visit_number/visit_date already
present in the supplied journey.

Each parameter series:

{
    "parameter": "<source-derived parameter name, e.g. 'ANC', 'Target lesion sum', 'LVEF'>",
    "unit": "<unit as documented, or null>",
    "category": "<the dynamically discovered grouping this belongs to, e.g. organ function / tumor marker / imaging response — derive from the source, do not force it into a fixed taxonomy if the source doesn't support one>",
    "observations": [
        {
            "visit_number": <int, from the supplied journey>,
            "visit_date": "<from the supplied journey>",
            "value": "<value exactly as documented>",
            "status": "<verbatim source characterization if present, e.g. 'within normal limits', 'suspicious', else null — never invent>",
            "event_ids": ["..."]
        }
    ]
}

Do not compute trend arrows or aggregate verdicts yourself — a
deterministic engine derives trend direction and pivots this by visit.
Your only job is exhaustive, source-grounded discovery of every
repeated/trackable parameter relevant to response and tolerance, exactly
like the Trends agent does for overall_trends, but scoped to
response/toxicity/tolerance-relevant parameters rather than all vitals.

Do not duplicate a parameter already fully captured in
trends_statistics.overall_trends unless this section's category framing
(organ function / tumor marker / imaging response) adds information the
Trends section's flat series does not carry (e.g. a source-stated
per-observation status).

FLOWSHEET COMPLETENESS

The flowsheet must be generated independently from whether a response,
resistance, progression, or toxicity conclusion exists.

First inspect the COMPLETE longitudinal journey for source-supported
observations relevant to this section.

Then preserve those observations as parameter series in the flowsheet.

The presence or absence of response_trajectory MUST NOT determine whether
flowsheet evidence is returned.

The presence or absence of resistance_signal MUST NOT determine whether
baseline or longitudinal observations are returned.

The presence or absence of progression intelligence MUST NOT determine
whether source observations are returned.

Populate ONLY these three Response & Resistance flowsheet presentation
containers:

- organ
- marker
- imaging

Do NOT create, return, infer, or populate an "all" flowsheet bucket.

These three buckets are the complete flowsheet output contract for this
section.

Each bucket must be populated independently from the COMPLETE raw
longitudinal journey.

If source-supported evidence exists for a bucket, preserve it in that
bucket.

If no source-supported evidence exists for a bucket, return [].

Do not make one bucket dependent on another bucket being populated.

Do not make flowsheet population dependent on response, resistance,
progression, toxicity, trajectory, status cards, or any other conclusion.

Do not reduce rich source evidence to a category label — put the full
per-visit observation (value, status when documented, event_ids) inside
the series' observations array.

Preserve distinct observations across visits rather than retaining only
the latest one.

Do not calculate a clinical response criterion unless explicitly supported
by the source.

FLOWSHEET BASELINE BEHAVIOR

If treatment-response evidence does not exist but relevant baseline
evidence exists:

- populate the flowsheet from that evidence as a one-observation series
  (the baseline visit)
- preserve measurements and findings
- preserve source context in "status" only when the source itself states
  a characterization
- preserve event_ids

At the same time:

- response_trajectory may remain []
- resistance_signal must remain []
  unless resistance is source-supported
- progression intelligence may remain {}
- toxicity intelligence may remain {}
- response intelligence may remain {}

An empty response field MUST NOT cause the evidence flowsheet to become
empty.

NO INFORMATION LOSS

Do not transform:

source observation
    ->
category name only

when the source contains richer information.

Instead preserve:

source observation
    ->
source-supported clinical information (value + status + event_ids)
    ->
longitudinal series, one entry per visit

The purpose is to preserve evidence, not to manufacture interpretation.

============================================================
PATHWAY DEVIATION LOG
============================================================

pathway_deviation_log is a list of explicit, source-documented deviations
from the patient's own planned pathway (delay, hold, dose change,
cancellation, modification). Do not compare against an external
guideline. Follow the same PATHWAY DEVIATION rules stated above. If no
deviation is documented, return [].

{
    "date": "...",
    "deviation": "...",
    "cause": "<source-stated cause, or null if not stated>",
    "event_ids": ["..."]
}

============================================================
OUTCOME BENCHMARK NOTE
========================================================

outcome_benchmark_note is a single source-grounded sentence ONLY when the
source itself makes a comparative/benchmark statement (e.g. references a
protocol-expected toxicity profile, a prior baseline, a documented
comparison). Follow the same OUTCOME BENCHMARK rules stated above. Never
invent a cohort, an "n=", or a statistical comparison that is not in the
source. If unsupported, return null.

============================================================
SUMMARY
============================================================

Generate summary only from evidence represented in this section.

Do not use unrelated information.

If no relevant evidence exists:

"summary": []

============================================================
FIELD-BY-FIELD COMPLETENESS AUDIT (perform before returning JSON)
============================================================

Every field below is independent. A field being represented elsewhere in
this same output is NEVER a reason to leave another field empty. Perform
this audit against the COMPLETE journey, one field at a time, before
returning JSON.

trajectory
    Inspect every visit for chronologically distinct observations relevant
    to this section (baseline evidence, treatment events, toxicity events,
    post-treatment findings). If two or more temporally distinct
    source-supported observations exist anywhere in the journey, represent
    them here as a chronological list, each with its own date/visit and
    event_ids. Do not leave this [] merely because response_trajectory or
    status_cards already exist — trajectory is the underlying chronological
    evidence; status_cards and response_trajectory are downstream
    summaries/verdicts derived from it, not substitutes for it.

status_cards
    Every card you produce must also be reflected in the corresponding
    dedicated field below (response_trajectory / resistance_signal /
    intelligence.toxicity / intelligence.progression /
    pathway_deviation_log / outcome_benchmark_note). A status card is a
    compact restatement — it never exists as the ONLY place a piece of
    evidence appears. If a status card cites toxicity, intelligence.toxicity
    must also be populated from that same evidence (and any other
    toxicity evidence in the journey). If a status card cites a new
    finding, new_findings must also contain it.

intelligence.response / intelligence.toxicity / intelligence.progression
    Audit each of these three independently against the complete journey.
    Do not leave intelligence.toxicity empty merely because a toxicity
    status_card exists — populate this object with the same
    source-supported toxicity evidence (events, grades, attribution,
    dates, event_ids) in structured form. The same applies to
    intelligence.response and intelligence.progression: if the journey
    supports either, populate the object; if not, leave it {} per the
    RESPONSE / PROGRESSION rules above.

flowsheet buckets: organ / marker / imaging

These are the ONLY flowsheet buckets allowed in the Response & Resistance
output.

Inspect the COMPLETE raw longitudinal journey independently for each bucket.

For each bucket:

1. Inspect every visit.
2. Inspect every source event belonging to every visit.
3. Inspect the complete document_text available for those events.
4. Identify source-supported observations that belong to that presentation
   bucket.
5. Preserve every supported observation as a parameter series.
6. Preserve the actual visit_number and visit_date supplied by the journey.
7. Preserve the source-supported value exactly as documented.
8. Preserve the source-supported unit when present.
9. Preserve the source-supported status when present.
10. Preserve all supporting event_ids.
11. Preserve distinct observations across visits.
12. Do not retain only the latest observation.

The three buckets are independent.

Evidence in one bucket MUST NOT cause another bucket to be omitted.

If the journey contains source-supported evidence for a bucket, populate it.

If the journey contains no source-supported evidence for a bucket, return [].

Do NOT create an "all" bucket.

Do NOT merge organ, marker, and imaging into another aggregate bucket.

Do NOT require a response or resistance conclusion before populating any
of these buckets.

Do NOT infer clinical meaning merely to populate a bucket.

The bucket assignment must be derived from the supplied source evidence by
the model itself. No keyword mapping, regex, predefined list, disease rule,
cancer-specific rule, organ-specific rule, marker-specific rule, imaging
modality rule, or specialty rule may be used.
    Inspect the complete journey specifically for imaging measurements
    (lesion sizes, uptake values, staging/category findings such as
    BIRADS) and for any biomarker/laboratory values distinct from routine
    organ-function panels. When such source-supported observations exist,
    represent them as parameter series in the relevant bucket(s) — do not
    leave "imaging" or "marker" empty merely because "organ" or "all" is
    already populated. A single observation belongs in every bucket that
    it dynamically fits, not only the first one you thought of.

pathway_deviation_log
    Inspect the complete journey — including care-plan, tumor-board, or
    planning documents — for any explicitly documented gap, missing
    prerequisite, safety flag, delay, hold, or other departure from the
    patient's own stated plan. A source-documented safety flag or planning
    caveat is a pathway deviation even if no treatment has yet occurred.
    Do not leave this [] merely because no dose change or cancellation is
    documented — an explicitly flagged prerequisite gap is enough.

outcome_benchmark_note
    Leave this null only when no source event makes any comparative or
    reference statement. This is independent of outcome_benchmark and of
    the other fields above.

new_findings
    Cross-check against status_cards and trajectory: any item you placed
    in either of those that also represents a source-established new
    finding within this longitudinal history must also appear here.

Do not consider the section complete merely because SOME fields are
populated. Every field listed above must be independently checked against
the complete journey before you decide it is empty.

============================================================
OUTPUT
============================================================

Return JSON only.

Use exactly this top-level contract:

{
    "summary": [],
    "trajectory": [],
    "status_cards": [],
    "response_trajectory": [],
    "resistance_signal": [],
    "pathway_deviation": [],
    "pathway_deviation_log": [],
    "outcome_benchmark": [],
    "outcome_benchmark_note": null,
    "new_findings": [],
    "flowsheet": {
        "organ": [],
        "marker": [],
        "imaging": []
    },
    "intelligence": {
        "response": {},
        "toxicity": {},
        "progression": {}
    },
    "narrative": null
}

The structure above is only the output contract.

It does NOT define what clinical concepts exist.

The actual clinical contents MUST emerge from the supplied source evidence.

Every clinical item MUST contain event_ids.

Return JSON only.
"""

MOLECULAR_PROMPT = RAW_JOURNEY_CONTRACT + """

You are the Molecular & Microbiome section agent.

Your responsibility is to organize source-supported evidence related to
molecular/genomic/genetic/assay information and microbiome information,
AND to produce a fully reconciled, longitudinal, visit-pivoted flowsheet
for both — in this single pass.

The UI section name must NOT influence whether evidence exists.

An empty result is correct when the supplied evidence does not support
information for this section.

============================================================
NO HARD-CODING
============================================================

Do NOT use:
- disease-specific rules
- cancer-specific rules
- organ-specific rules
- gene-specific rules
- assay-specific rules
- organism/taxon-specific rules
- keyword mappings
- regex
- string-pattern clinical rules
- predefined clinical examples
- predefined parameter lists
- specialty-specific rules
- assumed thresholds or criteria

All concepts, labels, parameters, and relationships must be derived from
the supplied source.

============================================================
MOLECULAR / GENOMIC (narrative)
============================================================

Include an item only when the source itself documents molecular/genomic/
genetic/assay/protein-level information.

Each item MUST have:

{
    "event_ids": [],
    "statement": "...",
    "evidence": "..."
}

Do not transform general imaging findings, anatomical findings, staging
findings, symptoms, medications, laboratory values, or treatment decisions
into molecular/genomic evidence.

============================================================
MICROBIOME (narrative)
============================================================

Include information only when the source explicitly provides microbiome-
related evidence.

Do not infer microbiome information from disease type, treatment,
antibiotics, laboratory abnormalities, gastrointestinal findings, or
general medical knowledge.

If no microbiome evidence exists: "microbiome": []

============================================================
SUMMARY
============================================================

The summary must be generated only from evidence returned in this section.

If no qualifying evidence exists: "summary": []

============================================================
FLOWSHEET — RECONCILED LONGITUDINAL PARAMETER SERIES
============================================================

The flowsheet is an exhaustive, longitudinal, source-evidence
representation. It is populated independently of whether the
molecular_genomic / microbiome narrative fields are populated.

There are exactly two flowsheet buckets:

- molecular   (molecular / genomic / genetic / assay / protein-level
               trackable observations)
- microbiome  (microbiome-related trackable observations)

Do NOT create, return, or infer an "all" bucket — the backend builds
that automatically.

Each bucket is a list of PARAMETER SERIES. Each series represents ONE
underlying longitudinally trackable entity (e.g. one gene/mutation, one
assay/marker, one microbial taxon or diversity index) and carries ALL of
its observations across every visit where it was measured — already
merged and already interpreted. Do this reconciliation yourself, in this
same pass; do not output one series per visit/phase/document for the same
underlying entity.

------------------------------------------------------------
STEP 1 — DISCOVER every observation
------------------------------------------------------------

Inspect EVERY visit and EVERY source event's complete document_text.
Do not stop after finding the first relevant observation. Do not use
only the latest visit.

------------------------------------------------------------
STEP 2 — GROUP into ONE series per underlying entity
------------------------------------------------------------

The ROW identity is the underlying source-supported longitudinal entity.
The ROW identity is NEVER: treatment phase, pre/during/post-treatment
labels, document type, source file, event_id, or appointment_id.

TEMPORAL-PHASE LABELS NEVER CREATE A NEW SERIES.

Before deciding two source items are different entities, strip any
temporal/phase qualifier ("baseline", "pre-treatment", "pre", "initial",
"screening", "post-treatment", "post", "follow-up", "interim",
"on-treatment", "cycle 1", "day 1", "week 4", etc.) from each parameter
label and compare what remains: the same assay/method/gene/specimen/
organism/taxon being measured. If what remains is the same underlying
trackable thing, merge into ONE series with multiple observations — the
phase goes into each observation's own `phase` field, never the series
name.

Do NOT merge genuinely different entities merely because their names look
similar (different gene, different assay, different specimen type,
different organism/taxon are never merged).

Assign each distinct entity a stable opaque `series_id` (any string
unique within this response). Use the SAME series_id for every
observation of that entity across all visits/phases/documents.

------------------------------------------------------------
STEP 3 — PRESERVE every observation inside its series
------------------------------------------------------------

For every reconciled series:

{
    "series_id": "...",
    "parameter": "<source-derived name, with any temporal/phase qualifier removed, e.g. 'PIK3CA mutation status', 'ctDNA VAF', 'Gut Shannon diversity index'>",
    "unit": "<series-level unit only when one unit applies consistently across all observations, otherwise null>",
    "category": "molecular" or "microbiome",
    "trend": null,
    "trend_rationale": null,
    "status": null,
    "status_rationale": null,
    "observations": [
        {
            "visit_number": <int, from the supplied journey>,
            "visit_date": "<from the supplied journey>",
            "value": "<value exactly as documented>",
            "unit": "<source-supported unit for this specific observation, or null>",
            "status": "<verbatim source characterization for this observation if present, e.g. 'positive', 'not detected', else null — never invent>",
            "phase": "<source-supported temporal phase/timing for this observation, e.g. pre/during/post/cycle label, or null>",
            "event_ids": ["..."]
        }
    ]
}

Preserve every genuinely distinct source-supported observation. Do not
keep only the latest visit. Do not replace an earlier observation with a
later one. Do not move an observation between visits. Do not invent a
value, date, status, unit, or event_id.

If several source events document the exact same observation (repeated
saves, amended/final versions), combine their event_ids into ONE
observation rather than duplicating it. If observations genuinely differ
(different value, date, phase, specimen, status), keep them separate.

------------------------------------------------------------
STEP 4 — DETERMINE trend (per series, reading ALL its observations)
------------------------------------------------------------

After assembling each series' observations, determine `trend` by
comparing its own observations across visits only. This is a plain
reading of the values, not a clinical judgment — only whether the
tracked value went up, down, stayed flat, or moved inconsistently; never
whether the change is clinically good or bad.

Rules:
- Fewer than two observations in the series -> trend is null.
- A single numeric value that increased across the two most recent
  visits carrying a usable value -> "up". Decreased -> "down".
  Unchanged -> "flat".
- A qualitative or composite value (e.g. mutation detected/not detected,
  several sub-components) where the change is consistent in one
  direction -> use that direction; inconsistent or not comparable in a
  single direction -> "mixed".
- Compare the two most recent visits with a usable value, not
  necessarily the very first and very last, unless only two exist.
- `trend_rationale` must name the actual two compared observations (e.g.
  quoting their values/visits) so it is auditable. Never invent a
  rationale — if you cannot point to two specific compared observations,
  leave both `trend` and `trend_rationale` null.
- Never let trend or trend_rationale introduce a diagnosis, a response/
  resistance/prognostic conclusion, or any clinical interpretation
  beyond the direction of the tracked value itself.

------------------------------------------------------------
STEP 5 — DETERMINE status (per series, reading ALL its observations TOGETHER)
------------------------------------------------------------

Status belongs to the COMPLETE series, never to one visit or one phase.
Read every observation of the series together — pre, during, post,
whatever phases are present — before writing a status for that series.

`status` is a separate longitudinal interpretation from `trend`. Do NOT
simply copy trend into status. Do NOT mechanically transform
up/down/flat into a verdict (e.g. do not assume "up" means worse or
"down" means better) — those conclusions are not universally valid for
molecular/microbiome data and depend entirely on what the source itself
supports.

Use ONLY the series' own observations and their source event evidence.
Do not invent a status. If the evidence is insufficient for a meaningful
longitudinal status, set "status" to null and "status_rationale" to null.

`status_rationale` must be one short source-grounded sentence citing what
in the series supports the stated status. Never invent it.

============================================================
FLOWSHEET COMPLETENESS AUDIT
============================================================

Do not let the molecular_genomic / microbiome narrative fields determine
whether the flowsheet buckets are populated — the flowsheet is
independent, exhaustive evidence preservation.

If a bucket has no source-supported evidence anywhere in the complete
journey, return [] for that bucket. Do not manufacture evidence to avoid
an empty result.

============================================================
OUTPUT
============================================================

Return exactly this contract:

{
    "summary": [],
    "molecular_genomic": [],
    "microbiome": [],
    "flowsheet": {
        "molecular": [],
        "microbiome": []
    },
    "narrative": null
}

Every narrative item and every observation must contain event_ids that
exist in the supplied journey. Never invent an event_id.

Return JSON only.
"""

NOTES_PROMPT = RAW_JOURNEY_CONTRACT + """
You are the Notes & Documents Agent.

EVERY source event in the journey must remain represented in documents,
including the appointment event. The number of entries in documents must
equal the number of events supplied.

For each document use its event_id, file_name, document_date and the
human-readable document_type_name from its classification.

Preserve:

notes
decisions
recommendations
pending
documents

Return concise JSON only.
"""



CUMULATIVE_SECTION_UPDATE_PROMPT = """
CUMULATIVE LONGITUDINAL MATERIALIZED-STATE UPDATE

You are updating ONE cumulative longitudinal section for the patient.

The `journey` supplied to you contains the COMPLETE source history currently
available for this patient, including ALL visits and ALL source events.

The complete journey is the authoritative source for completeness.

The previously persisted section is supplied only to preserve already-generated
source-supported information and presentation continuity.

IMPORTANT:

1. The complete journey is NOT limited to the newest event.

2. The incoming event identifies the event that triggered this regeneration.
   It does NOT limit the evidence that may be used.

3. Read ALL visits and ALL source events in `journey`.

4. Reconcile the existing section against the COMPLETE journey.

5. If the existing section is missing information that is supported by an
   earlier source event, add that information.

6. If the existing section contains information that is still supported by the
   source history, preserve it.

7. If a later source event contains a different observation, value, status,
   measurement, date, site, specimen, context, or other meaningful distinction,
   preserve the longitudinal distinction rather than replacing the earlier
   observation.

8. Do not delete earlier observations merely because a later observation exists.

9. Do not allow a missing value in the existing section to suppress source
   information found elsewhere in the complete journey.

10. Do not treat an empty field in the existing section as evidence that the
    source contains no information for that field.

11. The source journey has priority for completeness.

12. Existing generated state has priority for preserving previously represented
    source-supported information when the same information is still supported.

13. Never invent information.

14. Never infer information merely because a field exists in the application
    contract.

15. Never use outside medical knowledge to populate a field.

16. Never use keyword mappings.

17. Never use regex or pattern-based clinical rules.

18. Never use disease-specific rules.

19. Never use cancer-type-specific rules.

20. Never use specialty-specific rules.

21. Never use treatment-specific rules.

22. Never use predefined clinical examples.

23. Never use a fixed list of clinical concepts.

24. Every clinical assertion must be supported by one or more event_ids from
    the complete journey.

25. Preserve the actual source date and visit associated with every observation.

26. Preserve distinct observations across visits.

27. Do not collapse two observations merely because their labels are similar.

28. Deduplicate only when the source evidence supports that they are the same
    underlying fact.

29. The section must represent ALL source-supported information relevant to its
    contract, not merely the information introduced by the latest event.

30. Populate every contract field for which the complete journey provides
    relevant evidence.

31. Leave a field empty/null only when the complete journey does not support
    that field.

32. Do not create placeholder values such as "Unknown", "Not available", or
    "Not documented" unless those exact statements are present in the source.

33. Return the COMPLETE section contract.

COMPLETENESS REQUIREMENT

Before returning the result, internally verify every field in the requested
section against the complete journey.

For each field:

- inspect ALL visits
- inspect ALL source events
- identify source-supported information relevant to that field
- preserve longitudinal observations
- preserve dates and visit association
- preserve values and measurements
- preserve source-supported statuses
- preserve source-supported interpretations
- preserve source-supported relationships
- preserve event_ids

Do not stop after finding the first relevant observation.

If multiple source events contain relevant information, consider all of them.

The objective is not to make every field non-empty.

The objective is to ensure that NO source-supported relevant information is
lost merely because an earlier generation omitted it.

Return JSON only.
"""


CUMULATIVE_SECTION_UPDATE_PROMPT += """

REGENERATION AND DUPLICATION

- Regenerate the section from the complete journey.
- existing_section, when supplied, is only for continuity. If it contains a
  repeated fact, output that fact once.
- Never output a fact twice because it appears both in existing_section
  and in the journey.
"""

TREATMENT_COMPLETENESS_REQUIREMENT = """

============================================================
TREATMENT SECTION COMPLETENESS AUDIT
============================================================

Before returning the Regimen & Treatment section, inspect the COMPLETE
longitudinal journey again.

The purpose of this audit is to prevent loss of source-supported treatment
information.

For EACH output field:

- regimen_history_cumulative_exposure
- current
- history
- timeline
- exposure
- plans
- changes
- procedures
- decisions
- narrative

inspect ALL visits and ALL source events.

Do NOT stop after finding the first relevant treatment event.

Do NOT use only the incoming_event.

Do NOT use only the latest visit.

Do NOT use only the existing_section.

The COMPLETE journey is the completeness source.

============================================================
FIELD-BY-FIELD RECONCILIATION
============================================================

REGIMEN HISTORY / CUMULATIVE EXPOSURE

Include every source-supported treatment exposure that belongs here.

Preserve:
- treatment/regimen identity
- source-supported dose information
- source-supported administration information
- source-supported cycle information
- source-supported dates
- source-supported status
- source-supported cumulative information

Do not calculate cumulative exposure when the source does not explicitly
support the calculation.

Do not discard an earlier exposure because a later event exists.

------------------------------------------------------------

CURRENT

Determine the current treatment state from the complete longitudinal evidence.

A treatment can be current only when the source supports that state.

If different source events document different states, preserve the distinction
and the supporting event_ids rather than silently replacing one state with
another.

Do not convert:
planned -> administered
scheduled -> started
started -> completed
recommended -> performed

unless the source explicitly supports that transition.

------------------------------------------------------------

HISTORY

Inspect the complete journey for documented historical treatment.

Do not return [] merely because the latest document contains no historical
treatment.

Historical treatment must be distinguished from:
- historical diagnosis
- historical imaging
- historical pathology
- historical laboratory observations
- treatment that is only planned

Only treatment/procedure history belongs here.

------------------------------------------------------------

TIMELINE

Represent source-supported treatment events chronologically.

Each distinct treatment event must retain its actual source date and visit.

Do not invent dates.

Do not replace an earlier event with a later event.

Do not create a timeline entry merely because a treatment is mentioned.

------------------------------------------------------------

EXPOSURE

Inspect all source events for source-supported exposure information.

Preserve distinct exposure observations when they differ by:
- treatment
- dose
- date
- cycle
- status
- administration
- route
- other source-documented context

Do not collapse distinct exposures.

Do not duplicate the same underlying exposure merely because multiple
documents mention it.

------------------------------------------------------------

LEGACY PLANS / CHANGES DISABLED

Do NOT populate the legacy `plans` or `changes` arrays. They remain in the
schema only for frontend compatibility and must be returned as [].

Inspect all source events for planned/future treatment and treatment changes,
but place that information into the active fields where it belongs: `current`,
`history`, `timeline`, `exposure`, `procedures`, `decisions`, and/or
`narrative`. Preserve exact source-supported states such as planned,
scheduled, recommended, started, administered, completed, held, stopped,
cancelled, or modified. Do not convert planned treatment into performed
treatment. Do not lose documented changes merely because the legacy fields
are disabled.

------------------------------------------------------------

PROCEDURES

Inspect ALL source events for procedures related to treatment.

Preserve source-supported performed procedures separately from recommended,
planned, scheduled, or proposed procedures.

Do not convert a recommendation into a performed procedure.

------------------------------------------------------------

DECISIONS

Inspect the complete journey for documented treatment-related decisions.

Preserve decisions concerning:
- treatment selection
- treatment sequence
- continuation
- modification
- administration
- procedural planning
- treatment assessment
- other source-documented treatment decisions

Do not invent the decision rationale.

Do not infer a decision merely from an action.

------------------------------------------------------------

NARRATIVE

If the complete journey contains sufficient source-supported treatment
information to summarize the longitudinal treatment course, generate a
concise cumulative narrative.

The narrative must remain source-grounded.

It must not introduce medical interpretation that is not documented.

Return null only when the source does not contain enough treatment information
for a meaningful treatment narrative.

============================================================
FINAL COMPLETENESS CHECK
============================================================

Before returning JSON, verify:

1. Every non-empty item is supported by valid event_ids.
2. Every event_id exists in the supplied journey.
3. Every contract field was checked against ALL visits.
4. Earlier source-supported treatment information was not discarded.
5. Distinct treatment states were not silently merged.
6. Planned treatment was not converted into completed treatment.
7. Historical treatment was not confused with historical clinical findings.
8. Explicit treatment changes were not omitted.
9. Treatment decisions documented in the source were not omitted.
10. The narrative reflects the cumulative treatment journey when sufficient
    source evidence exists.

The goal is not to make every field non-empty.

The goal is to ensure that NO source-supported treatment information is lost.

Return JSON only.
"""

# ============================================================================
# SECTION AGENTS
# ============================================================================

async def overview_agent(
    patient_id,
    visits,
    update_context=None,
) -> Dict[str, Any]:

    prompt = OVERVIEW_PROMPT

    journey = build_agent_journey(
        patient_id=patient_id,
        visits=visits,
    )

    if update_context:
        prompt += CUMULATIVE_SECTION_UPDATE_PROMPT

        payload = {
            "journey": journey,
            "existing_section": update_context.get(
                "existing_section",
                {},
            ),
            "incoming_event": update_context.get(
                "incoming_event",
                {},
            ),
            "visit_history": build_visit_history(visits),
            "update_mode": "cumulative_longitudinal",
        }
    else:
        payload = {
            "journey": journey,
            "visit_history": build_visit_history(visits),
        }

    return await groq_json(
        prompt,
        payload,
        max_tokens=10000,
        retries=2,
    )


async def regimen_treatment_agent(
    patient_id,
    visits,
    update_context=None,
) -> Dict[str, Any]:

    prompt = TREATMENT_PROMPT + TREATMENT_COMPLETENESS_REQUIREMENT + """\n\nIMPORTANT: This is the final cumulative treatment pass. Inspect the complete journey, all visits, all source events, and complete source text before returning. Do not rely on a later reconciliation call; preserve every source-supported treatment observation, state, dose, cycle, procedure, decision, and narrative required by the existing contract.\n"""

    payload = build_agent_journey(
        patient_id=patient_id,
        visits=visits,
    )

    if update_context:
        prompt += CUMULATIVE_SECTION_UPDATE_PROMPT

        payload = {
            "journey": payload,
            **update_context,
        }

    result = await groq_json(
        prompt,
        payload,
        max_tokens=10000,
        retries=2,
    )
    if isinstance(result, dict) and result.get("_agent_status") != "failed":
        result["plans"] = []
        result["changes"] = []
    return result


async def reconcile_regimen_treatment_from_complete_journey(
    patient_id: str,
    visits: List[Dict[str, Any]],
    existing_section: Optional[Dict[str, Any]],
    generated_section: Dict[str, Any],
) -> Dict[str, Any]:

    journey = build_agent_journey(
        patient_id=patient_id,
        visits=visits,
    )

    reconciliation_prompt = TREATMENT_PROMPT + """

============================================================
FINAL CUMULATIVE TREATMENT RECONCILIATION
============================================================

You are performing the FINAL reconciliation of ONE cumulative
Regimen & Treatment section.

The supplied journey is the COMPLETE longitudinal source history.

The existing_section and generated_section are representations of
the source history. They may contain omissions.

They are NOT authoritative sources.

The COMPLETE journey is authoritative for completeness.

============================================================
PRIMARY OBJECTIVE
============================================================

Produce the most complete source-grounded Regimen & Treatment section
possible from the COMPLETE journey.

For every contract field:

- inspect ALL visits
- inspect ALL source events
- inspect the complete source text
- inspect the existing section
- inspect the generated section

Do not limit the reconciliation to the incoming event.

Do not limit the reconciliation to the latest visit.

Do not assume that information missing from generated_section is absent
from the source.

If information exists in the complete journey but is missing from
generated_section, add it.

If information exists in existing_section and remains supported by the
complete journey, preserve it.

If generated_section contains unsupported information, remove it.

============================================================
LONGITUDINAL PRESERVATION
============================================================

Preserve source-supported observations across all visits.

Do not replace an earlier treatment observation simply because a later
observation exists.

If two observations have different:

- dates
- visits
- treatments
- doses
- cycles
- statuses
- administration states
- procedures
- contexts

preserve them as distinct source-supported observations.

If multiple documents repeat the same underlying event without a
meaningful difference, represent the underlying event once.

============================================================
TREATMENT STATES
============================================================

Preserve the exact distinction documented by the source.

Do not convert:

planned -> started
planned -> administered
scheduled -> completed
recommended -> performed
started -> completed
held -> stopped
proposed -> ordered

unless the source explicitly documents that transition.

If different source events document different treatment states,
preserve those source-supported states with their event_ids.

Do not silently resolve conflicting source documentation.

============================================================
SOURCE STATE CONFLICT RECONCILIATION
============================================================

If different source events describe different states for the same
treatment, do NOT choose one state merely because it appears later,
earlier, more detailed, or more frequently.

Treat each source event as independent evidence.

If one event documents a treatment as planned, scheduled, or in progress
and another event documents the same treatment as administered or completed,
preserve the documented states with their respective event_ids and dates.

Do not erase the earlier state.

Do not rewrite the earlier state to match the later state.

Do not assume that two differently worded states are contradictory unless
the source actually makes them contradictory.

If the source explicitly establishes a transition between states, represent
that transition using the supporting source events.

If the source does not explicitly establish the transition, preserve the
individual documented states without inventing a transition.

The final output must reflect the source evidence, not a presumed clinical
workflow.

============================================================
REGIMEN_HISTORY_CUMULATIVE_EXPOSURE
============================================================

Inspect the COMPLETE journey.

Include every source-supported treatment exposure relevant to this
representation.

Preserve the source-supported:

- treatment/regimen
- date
- cycle
- dose
- administration state
- cumulative information
- other source-documented treatment context

Do not invent cumulative calculations.

Do not discard earlier exposures.

============================================================
CURRENT
============================================================

Determine current treatment information from the complete source history.

Only include a treatment as current when the source supports that state.

Use actual source dates and event_ids.

Do not infer current treatment merely from an appointment,
recommendation, schedule, or plan.

============================================================
HISTORY
============================================================

Inspect ALL visits for documented historical treatment.

Do not use historical diagnosis, imaging, pathology, laboratory,
symptoms, or other non-treatment information as treatment history.

If no historical treatment is supported, return [].

============================================================
TIMELINE
============================================================

Inspect every source event containing documented treatment or procedure
events.

Represent them chronologically.

Preserve their actual dates and visit numbers.

Do not invent dates.

Do not collapse different source-supported treatment events.

============================================================
EXPOSURE
============================================================

Inspect the complete source history for source-supported exposure
information.

Preserve distinct exposure observations when the source provides
meaningfully different treatment, date, cycle, dose, status,
administration, or context.

Deduplicate repeated documentation of the same underlying event.

============================================================
LEGACY PLANS / CHANGES DISABLED
============================================================

Return `plans: []` and `changes: []` for schema compatibility. Do not spend
generation space on these legacy fields.

Inspect the complete journey for planned/future and changed/modified
treatment information, then incorporate that information into `current`,
`history`, `timeline`, `exposure`, `procedures`, `decisions`, and/or
`narrative` as appropriate. Preserve source-supported treatment states and
chronology. Do not convert planned treatment into completed treatment. Do not
omit documented treatment changes just because the legacy field is disabled.

============================================================
============================================================
PROCEDURES
============================================================

Inspect ALL source events for procedures.

Preserve performed procedures separately from procedures that are only:

- recommended
- proposed
- planned
- scheduled
- ordered

Do not convert one state into another.

============================================================
DECISIONS
============================================================

Inspect the complete journey for treatment-related decisions.

Preserve source-supported decisions concerning treatment selection,
sequence, continuation, modification, administration, assessment,
procedural planning, or other documented treatment decisions.

Do not invent decision rationale.

============================================================
NARRATIVE
============================================================

If sufficient treatment information exists in the complete journey,
produce a concise cumulative treatment narrative.

The narrative must summarize only source-supported information.

It must not introduce outside medical knowledge.

It must not replace documented uncertainty with certainty.

Return null only when there is genuinely insufficient treatment
information for a meaningful source-grounded narrative.

============================================================
FINAL SOURCE AUDIT
============================================================

Before returning the result, verify every field against the COMPLETE
journey again.

Check that:

1. No source-supported treatment information was omitted.
2. No earlier treatment event was lost.
3. No distinct visit observation was replaced by a later observation.
4. No planned treatment was represented as completed.
5. No recommended procedure was represented as performed.
6. No unsupported treatment information was retained.
7. Every clinical item contains valid event_ids.
8. Every event_id exists in the supplied journey.
9. Explicit treatment changes were not omitted.
10. Treatment decisions documented in the source were not omitted.
11. The narrative, when present, is cumulative and source-grounded.

The objective is NOT to make every field populated.

The objective is to ensure that every populated field is supported
and every source-supported field is represented.

Return JSON only.
"""

    payload = {
        "journey": journey,
        "existing_section": existing_section or {},
        "generated_section": generated_section or {},
        "visit_history": build_visit_history(visits),
    }

    result = await groq_json(
        reconciliation_prompt,
        payload,
        max_tokens=14000,
        retries=2,
    )

    if (
        not isinstance(result, dict)
        or result.get("_agent_status") == "failed"
    ):
        raise RuntimeError(
            "Regimen & Treatment reconciliation failed: "
            f"{result.get('_error') if isinstance(result, dict) else result}"
        )

    result["plans"] = []
    result["changes"] = []
    return result


async def trends_statistics_agent(
    patient_id: str,
    visits: List[Dict[str, Any]],
    update_context=None,
) -> Dict[str, Any]:

    journey = build_agent_journey(
        patient_id=patient_id,
        visits=visits,
    )

    visit_history = build_visit_history(visits)

    payload = {
        "patient_id": patient_id,
        "journey": journey,
        "visit_history": visit_history,
    }

    result = await groq_json(
        TRENDS_PROMPT,
        payload,
        max_tokens=16000,
        retries=2,
    )

    logger.info(
        "TRENDS DIRECT LLM RESULT | patient={} result={}",
        patient_id,
        json.dumps(
            result,
            default=str,
            ensure_ascii=False,
        ),
    )

    if (
        not isinstance(result, dict)
        or result.get("_agent_status") == "failed"
    ):
        raise RuntimeError(
            "Trends agent failed: "
            f"{result.get('_error') if isinstance(result, dict) else result}"
        )

    result = dedupe_section_output(result)

    # ---------------------------------------------------------
    # NEW CONTRACT
    # ---------------------------------------------------------
    # The LLM directly returns the five presentation objects.
    # There is no generic top-level `series`.
    #
    # IMPORTANT: these fields must be returned FLAT (top-level), matching
    # the trends_statistics contract in empty_output_structure(). Do NOT
    # nest them under a "presentation_views" wrapper here — stable_section()
    # stabilizes this return value against that flat contract, and any key
    # that isn't found at the top level gets silently reset to null. That
    # mismatch was why every trends field was coming back null.
    # ---------------------------------------------------------

    return {
        "cumulative_dose_vs_limit": result.get(
            "cumulative_dose_vs_limit"
        ),
        "toxicity_visit_over_visit": result.get(
            "toxicity_visit_over_visit"
        ),
        "tumor_burden": result.get(
            "tumor_burden"
        ),
        "key_labs": result.get(
            "key_labs"
        ),
        "biomarkers": result.get(
            "biomarkers"
        ),
        "narrative": result.get("narrative"),
    }


def validate_response_evidence_output(
    result: Dict[str, Any],
    valid_event_ids: set,
) -> Dict[str, Any]:

    if not isinstance(result, dict):
        return {}

    def walk(value: Any) -> Any:

        if isinstance(value, list):
            return [
                walk(item)
                for item in value
            ]

        if not isinstance(value, dict):
            return value

        cleaned = {}

        for key, child in value.items():

            # Internal field; do not expose it as clinical output.
            if key == "_evidence_inventory":
                continue

            cleaned[key] = walk(child)

        # If event_ids exist, keep only valid source IDs...........
        if "event_ids" in cleaned:

            ids = cleaned.get("event_ids")

            if isinstance(ids, list):
                cleaned["event_ids"] = [
                    event_id
                    for event_id in ids
                    if event_id in valid_event_ids
                ]

        return cleaned

    return walk(result)



# ============================================================================
# RESPONSE & RESISTANCE — 9-CALL OPTIMIZATION OVERRIDES
# ============================================================================
# The Response & Resistance section keeps exactly THREE LLM calls:
#   1) exhaustive evidence discovery + complete section generation
#   2) complete field-by-field reconciliation
#   3) final flowsheet + ALL remaining field repair
#
# IMPORTANT:
# - `trajectory` is intentionally NOT generated by the LLM.
# - The legacy `trajectory` key remains in the persisted schema only for
#   frontend/backward compatibility and is forced to [] by Python.
# - The three calls above must spend their reasoning/output budget on every
#   other Response & Resistance field.
# - No additional LLM call is introduced.
# ============================================================================

RESPONSE_EVIDENCE_AND_ANALYSIS_PROMPT = RAW_JOURNEY_CONTRACT + r"""
You are the primary Response & Resistance evidence and section generation
agent.

The COMPLETE raw longitudinal journey is the only clinical source of truth.
Inspect EVERY visit, EVERY source event, and the COMPLETE document_text of
EVERY event.

Your job is exhaustive SOURCE PRESERVATION plus complete field generation.
Do not spend output/reasoning on a generic `trajectory` field. That field is
intentionally disabled for this optimized implementation. Use that capacity
to populate every OTHER Response & Resistance field whenever the raw source
supports it.

============================================================
STRICT SOURCE GROUNDING
============================================================

Every clinical assertion MUST contain valid event_ids from the supplied
journey.

Never invent:
- event_id
- measurement
- value
- date
- diagnosis
- treatment
- response
- resistance
- progression
- toxicity
- comparison
- benchmark
- clinical significance

Do not use:
- hardcoded diseases/cancer types
- hardcoded organs
- hardcoded biomarkers
- hardcoded imaging modalities
- hardcoded treatments
- keyword mappings
- regex
- string-pattern clinical rules
- predefined parameter lists
- disease-specific rules
- specialty-specific rules
- treatment-specific rules
- assumed response/progression/resistance/toxicity criteria

All concepts and labels must emerge from the supplied source.

============================================================
EXHAUSTIVE EVIDENCE
============================================================

Inspect the complete journey independently for:
- source-documented response assessments
- explicit comparisons
- resistance evidence
- progression evidence
- treatment effect evidence
- toxicity/tolerance evidence
- treatment/pathway changes
- delays, holds, interruptions, cancellations and prerequisites
- outcome/benchmark statements
- newly documented findings
- pathology/diagnostic findings
- imaging findings and measurements
- biomarkers
- laboratory values relevant to response/tolerance
- organ/site measurements
- qualitative and quantitative observations
- all repeated longitudinal measurements across visits

Never keep only the latest visit.
Never reduce a detailed measurement to a category label.
Never discard baseline/reference evidence merely because formal response is absent.

============================================================
FIELD-BY-FIELD REQUIREMENT
============================================================

Each field is independent. An empty generated field is NOT evidence that
the source lacks information.

For EACH field below, inspect the COMPLETE raw journey and populate it if
source-supported:

1. summary
   - concise source-grounded synthesis of the evidence represented in this
     section.

2. status_cards
   - dynamically discovered cards only where the source supports a status,
     comparison, or clinically meaningful documented state.
   - Every card must also be represented in its dedicated field.

3. response_trajectory
   - ONLY source-supported response assessments or explicit longitudinal
     treatment-response relationships.
   - Do not infer response from treatment existence or from a value changing.

4. resistance_signal
   - ONLY source-supported resistance.
   - Do not infer resistance from persistent disease, treatment change,
     interruption, abnormal labs, biomarkers, or residual findings alone.

5. pathway_deviation
   - source-documented pathway changes, delays, holds, interruptions,
     cancellations, modifications, prerequisites or other deviations.

6. pathway_deviation_log
   - preserve each explicit deviation with date, description, cause when
     stated, and event_ids.
   - Inspect care plans, tumor-board records and treatment-planning records.

7. outcome_benchmark
   - preserve source-documented benchmark/reference/target/comparison evidence.
   - Do not create external benchmarks or statistics.

8. outcome_benchmark_note
   - one source-grounded comparative/reference statement when supported,
     otherwise null.

9. new_findings
   - findings that are source-established as new within the supplied
     longitudinal history.
   - Do not call something new merely because it appears in the latest event.

10. intelligence.response
    - structured source-supported response evidence and its provenance.
    - Empty only when the complete source provides no support.

11. intelligence.toxicity
    - structured source-supported adverse effects/tolerance/toxicity evidence,
      including grade, attribution, onset, duration, resolution and treatment
      relationship when actually documented.
    - Do not infer causality.

12. intelligence.progression
    - structured source-supported progression evidence only.
    - Preserve source certainty.

13. flowsheet.organ
14. flowsheet.marker
15. flowsheet.imaging
    - independently inspect the COMPLETE journey for every relevant
      longitudinally trackable observation.
    - Preserve exact value, measurement, unit, date, visit_number, status,
      phase/context when present, and event_ids.
    - Never replace detailed measurements with labels.
    - Never keep only baseline or only latest values.
    - Dynamically derive parameter identity and bucket membership from source
      evidence. Do not use predefined lists or keyword rules.
    - Imaging measurements, pathology/diagnostic measurements, biomarkers and
      relevant laboratory measurements must not be dropped merely because
      another bucket already contains data.
    - If an observation belongs to more than one applicable presentation
      bucket, it may appear in each.

16. narrative
    - cumulative source-grounded narrative covering the strongest evidence
      actually present in this section.

============================================================
IMPORTANT DISTINCTION
============================================================

Baseline/reference evidence is valuable even when formal response is absent.
Preserve it in flowsheets, new findings, summary, status cards or other
appropriate evidence fields when supported.

Do NOT turn baseline evidence into a response conclusion.

Do NOT infer:
- response from treatment
- resistance from treatment change
- progression from persistence
- toxicity from an abnormal lab alone
- improvement/worsening/stability without source support

============================================================
FLOWSHEET SERIES CONTRACT
============================================================

Each series should use:

{
  "series_id": "...",
  "parameter": "<source-grounded parameter>",
  "unit": null,
  "category": null,
  "observations": [
    {
      "visit_number": null,
      "visit_date": null,
      "value": null,
      "unit": null,
      "status": null,
      "phase": null,
      "event_ids": []
    }
  ],
  "status": null,
  "status_rationale": null
}

Additional source-supported fields may be retained.

The objective is INFORMATION PRESERVATION, not forced interpretation.

============================================================
DISABLED FIELD
============================================================

Do NOT generate `trajectory`.
Do NOT spend output on a trajectory list.
The backend will force the legacy persisted `trajectory` field to [].

============================================================
FINAL COMPLETENESS AUDIT
============================================================

Before returning:
1. inspect every visit;
2. inspect every source event;
3. inspect complete document_text;
4. independently audit EVERY enabled field above;
5. recover information that appears in raw source but is missing from
   candidate output;
6. preserve all distinct measurements, sites, specimens, dates and statuses;
7. preserve event_ids;
8. never replace an earlier observation with a later one;
9. never reduce a rich observation to a label;
10. never introduce unsupported information.

Return JSON only.

Use this enabled-field contract:

{
  "summary": [],
  "status_cards": [],
  "response_trajectory": [],
  "resistance_signal": [],
  "pathway_deviation": [],
  "pathway_deviation_log": [],
  "outcome_benchmark": [],
  "outcome_benchmark_note": null,
  "new_findings": [],
  "flowsheet": {
    "organ": [],
    "marker": [],
    "imaging": []
  },
  "intelligence": {
    "response": {},
    "toxicity": {},
    "progression": {}
  },
  "narrative": null
}

Return JSON only.
"""

RESPONSE_SECTION_COMPLETENESS_RECONCILIATION_PROMPT = r"""
You are the FINAL source-grounded completeness reconciliation agent for the
Response & Resistance section.

The COMPLETE raw journey is authoritative. The evidence inventory, generated
section and existing section are only assistance/candidate representations.

There is NO LLM-generated `trajectory` field in this optimized implementation.
Do not generate it. Spend the entire call auditing and repairing every other
field.

============================================================
PRIMARY OBJECTIVE
============================================================

Inspect:
- ALL visits
- ALL source events
- COMPLETE document_text of ALL events
- evidence_inventory
- generated_section
- existing_section

For EACH enabled field independently:

1. find all source-supported information;
2. preserve everything already supported;
3. add anything missing;
4. preserve distinct observations across visits;
5. preserve exact values, measurements, units, dates, sites, specimens,
   statuses, interpretations and context;
6. preserve valid event_ids;
7. remove only unsupported information;
8. leave the field empty only when the COMPLETE source truly provides no
   support.

An empty candidate field is NOT evidence that the source lacks data.

============================================================
FIELDS TO REPAIR
============================================================

Repair ALL of these independently:

- summary
- status_cards
- response_trajectory
- resistance_signal
- pathway_deviation
- pathway_deviation_log
- outcome_benchmark
- outcome_benchmark_note
- new_findings
- flowsheet.organ
- flowsheet.marker
- flowsheet.imaging
- intelligence.response
- intelligence.toxicity
- intelligence.progression
- narrative

Do NOT generate `trajectory`.

============================================================
RESPONSE / RESISTANCE / PROGRESSION
============================================================

Only preserve conclusions explicitly supported by the source.

Do not infer response from:
- treatment existence
- treatment initiation/change
- later measurement alone
- laboratory change alone
- imaging change alone

Do not infer resistance from:
- persistent/residual disease
- treatment change/hold/interruption
- abnormal laboratory values
- biomarker changes
- treatment planning

Do not infer progression from disease presence or a single finding.

============================================================
TOXICITY
============================================================

Preserve source-documented adverse effects, toxicity assessments, grades,
attribution, onset, duration, resolution and treatment relationship whenever
present. Do not infer causality.

============================================================
PATHWAY / OUTCOME / NEW FINDINGS
============================================================

Inspect care plans, tumor-board documents, treatment plans and other planning
records for source-documented:
- delays
- holds
- interruptions
- cancellations
- modifications
- missing prerequisites
- safety flags
- pathway changes

Preserve source-documented outcome/benchmark/reference comparisons only.
Do not create external statistics or guideline comparisons.

Cross-check all candidate items for genuinely source-supported new findings.

============================================================
FLOWSHEET — EXHAUSTIVE
============================================================

The flowsheet is independent of response/resistance/progression/toxicity.

For EACH of organ, marker and imaging:
- inspect every visit and every source event;
- inspect complete document_text;
- recover every relevant longitudinally trackable observation;
- preserve exact value and measurement;
- preserve source unit;
- preserve visit_number and visit_date;
- preserve status/phase/context when documented;
- preserve all event_ids;
- preserve distinct observations across visits;
- do not retain only latest or baseline;
- do not reduce measurements to category labels;
- dynamically derive parameter identity and bucket membership from source;
- do not use keyword mappings, regex, predefined lists or disease rules.

If source-supported evidence exists in a bucket, populate it even when response
or resistance is empty.

============================================================
STATUS CARDS
============================================================

Status cards are summaries, never the sole evidence location.

Every card must correspond to source-supported evidence also represented in
the appropriate dedicated field.

============================================================
NO HARDCODING
============================================================

Do not use hardcoded diseases, cancers, organs, biomarkers, imaging modalities,
treatments, specialties, keyword mappings, regex, fixed thresholds, predefined
clinical examples, or assumed response/resistance/progression/toxicity criteria.

============================================================
FINAL AUDIT
============================================================

Before returning:
- inspect every enabled field independently;
- compare candidate output against raw journey;
- recover missing source-supported details;
- ensure every clinical assertion has valid event_ids;
- ensure no earlier observation is lost;
- ensure no detailed measurement becomes a label;
- ensure no unsupported conclusion is introduced.

Return JSON only with:

{
  "summary": [],
  "status_cards": [],
  "response_trajectory": [],
  "resistance_signal": [],
  "pathway_deviation": [],
  "pathway_deviation_log": [],
  "outcome_benchmark": [],
  "outcome_benchmark_note": null,
  "new_findings": [],
  "flowsheet": {
    "organ": [],
    "marker": [],
    "imaging": []
  },
  "intelligence": {
    "response": {},
    "toxicity": {},
    "progression": {}
  },
  "narrative": null
}
"""

RESPONSE_FLOWSHEET_RECONCILIATION_AND_STATUS_PROMPT = r"""
You are the FINAL Response & Resistance repair agent.

This is the THIRD and FINAL LLM call for this section. There must be NO
additional call.

The COMPLETE raw journey is authoritative.

The previous generated Response & Resistance section is a candidate and may
contain null/empty fields even when the raw journey contains supporting data.

Your job in this SAME call is to:
1. exhaustively repair the flowsheet;
2. generate longitudinal status/status_rationale for each flowsheet series;
3. audit and repair ALL OTHER Response & Resistance fields;
4. recover source-supported values that earlier passes missed.

Do NOT generate the legacy `trajectory` field. It is intentionally disabled.
Use the available output budget for every other field.

============================================================
SOURCE AUDIT
============================================================

Inspect:
- every visit
- every source event
- complete document_text of every event
- the current Response & Resistance section
- all source-supported evidence relevant to this section

Never invent event_ids, measurements, values, dates, diagnoses, treatments,
response, resistance, progression, toxicity, comparisons or significance.

No hardcoded disease/cancer/organ/marker/imaging/treatment rules.
No keyword mappings.
No regex.
No predefined parameter lists.
No assumed clinical criteria.

============================================================
FLOWSHEET REPAIR
============================================================

For organ, marker and imaging independently:

- recover EVERY source-supported trackable observation;
- preserve exact value and measurement;
- preserve unit;
- preserve visit_number and visit_date;
- preserve source status;
- preserve phase/context when present;
- preserve event_ids;
- preserve all distinct observations across all visits;
- do not keep only the latest visit;
- do not reduce detailed observations to category labels;
- do not omit imaging/diagnostic/pathology measurements;
- do not omit biomarkers or relevant laboratory values;
- dynamically determine series identity and bucket from the source;
- merge only when the source establishes the same underlying entity.

Each series:

{
  "series_id": "...",
  "parameter": "...",
  "unit": null,
  "category": null,
  "trend": null,
  "trend_rationale": null,
  "observations": [
    {
      "visit_number": null,
      "visit_date": null,
      "value": null,
      "unit": null,
      "status": null,
      "phase": null,
      "event_ids": []
    }
  ],
  "status": null,
  "status_rationale": null
}

Generate one source-grounded longitudinal status/status_rationale per series.
If insufficient evidence for a meaningful status, use null. Never invent a
clinical interpretation.

============================================================
REPAIR ALL OTHER RESPONSE & RESISTANCE FIELDS
============================================================

Independently audit and populate when source-supported:

- summary
- status_cards
- response_trajectory
- resistance_signal
- pathway_deviation
- pathway_deviation_log
- outcome_benchmark
- outcome_benchmark_note
- new_findings
- intelligence.response
- intelligence.toxicity
- intelligence.progression
- narrative

IMPORTANT:
A field being populated elsewhere is NOT a reason to leave another field
empty. The raw journey must be checked separately for each field.

Examples of required preservation:
- a detailed imaging measurement must remain detailed;
- a pathology finding must not become only "pathology";
- a biomarker value must retain its actual value/percent/score;
- an organ/lab value must retain the actual measurement and unit;
- a documented treatment-pathway hold or prerequisite gap must be represented
  in pathway fields;
- a documented toxicity must be represented in toxicity intelligence and any
  applicable status card;
- a source-supported response/resistance/progression conclusion must appear in
  its dedicated field and intelligence object.

Do not infer conclusions from raw measurements alone.

============================================================
FIELD CONSISTENCY
============================================================

If status_cards contains evidence for response, resistance, toxicity,
progression, pathway deviation or new finding, the corresponding dedicated
field must also contain the source-supported evidence.

If a source-supported finding appears in a flowsheet and is explicitly
described as new, preserve it in new_findings as well.

============================================================
OUTPUT
============================================================

Return JSON only.

Do NOT return `trajectory`.

Return:

{
  "summary": [],
  "status_cards": [],
  "response_trajectory": [],
  "resistance_signal": [],
  "pathway_deviation": [],
  "pathway_deviation_log": [],
  "outcome_benchmark": [],
  "outcome_benchmark_note": null,
  "new_findings": [],
  "flowsheet": {
    "organ": [],
    "marker": [],
    "imaging": []
  },
  "intelligence": {
    "response": {},
    "toxicity": {},
    "progression": {}
  },
  "narrative": null
}
"""

async def response_resistance_agent(
    patient_id,
    visits,
    update_context=None,
) -> Dict[str, Any]:
    """
    Generate Response & Resistance with EXACTLY THREE LLM calls.

    Call 1:
        Exhaustive evidence discovery + complete non-trajectory section.

    Call 2:
        Complete field-by-field source reconciliation.

    Call 3:
        Final flowsheet reconciliation/status PLUS repair of every other
        Response & Resistance field.

    The legacy `trajectory` field is intentionally not generated. Python
    restores it as [] only for backward-compatible schema stability.
    """

    journey = build_agent_journey(
        patient_id=patient_id,
        visits=visits,
    )
    journey["visit_history"] = build_visit_history(visits)

    existing_section = {}
    if isinstance(update_context, dict):
        existing_section = update_context.get("existing_section") or {}

    valid_event_ids = {
        event.get("event_id")
        for visit in visits
        if isinstance(visit, dict)
        for event in (visit.get("events") or [])
        if isinstance(event, dict) and event.get("event_id")
    }

    # ------------------------------------------------------------------
    # PASS 1 — exhaustive evidence + complete section generation
    # ------------------------------------------------------------------
    combined_prompt = RESPONSE_EVIDENCE_AND_ANALYSIS_PROMPT
    if update_context:
        combined_prompt += CUMULATIVE_SECTION_UPDATE_PROMPT

    combined_payload = {
        "journey": journey,
        "visit_history": build_visit_history(visits),
        "update_mode": "cumulative_longitudinal",
        "existing_section": existing_section,
    }

    if update_context:
        combined_payload["incoming_event"] = (
            update_context.get("incoming_event") or {}
        )

    result = await groq_json(
        combined_prompt,
        combined_payload,
        max_tokens=18000,
        retries=2,
    )

    if (
        not isinstance(result, dict)
        or result.get("_agent_status") == "failed"
    ):
        raise RuntimeError(
            "Combined Response & Resistance analysis failed: "
            f"{result.get('_error') if isinstance(result, dict) else result}"
        )

    evidence_inventory = result.get("_evidence_inventory")
    if not isinstance(evidence_inventory, list):
        evidence_inventory = []

    # Internal inventory is useful to pass 2 but never persisted.
    result.pop("_evidence_inventory", None)

    # Explicitly disable legacy trajectory generation.
    result.pop("trajectory", None)

    result = validate_response_evidence_output(
        result,
        valid_event_ids,
    )

    # ------------------------------------------------------------------
    # PASS 2 — complete field-by-field reconciliation
    # ------------------------------------------------------------------
    reconciled_section = await reconcile_response_section(
        patient_id=patient_id,
        visits=visits,
        journey=journey,
        evidence_inventory=evidence_inventory,
        generated_section=result,
        existing_section=existing_section,
    )

    if not isinstance(reconciled_section, dict):
        reconciled_section = result

    reconciled_section.pop("trajectory", None)

    reconciled_section = validate_response_evidence_output(
        reconciled_section,
        valid_event_ids,
    )

    # ------------------------------------------------------------------
    # PASS 3 — final complete repair:
    # flowsheet + longitudinal status + ALL OTHER fields
    # ------------------------------------------------------------------
    current_flowsheet = reconciled_section.get("flowsheet")
    if not isinstance(current_flowsheet, dict):
        current_flowsheet = {
            "organ": [],
            "marker": [],
            "imaging": [],
        }

    final_payload = {
        "patient_id": patient_id,
        "visit_history": build_visit_history(visits),
        "journey": journey,
        "current_section": reconciled_section,
        "existing_section": existing_section,
        "evidence_inventory": evidence_inventory,
        "flowsheet": current_flowsheet,
    }

    final_result = await groq_json(
        RESPONSE_FLOWSHEET_RECONCILIATION_AND_STATUS_PROMPT,
        final_payload,
        max_tokens=18000,
        retries=2,
    )

    if (
        isinstance(final_result, dict)
        and final_result.get("_agent_status") != "failed"
    ):
        final_result.pop("_evidence_inventory", None)
        final_result.pop("trajectory", None)

        # The third call is allowed to repair EVERY enabled field.
        # Never let an empty third-pass field erase a populated second-pass
        # field. Lists are merged; dictionaries are recursively reconciled;
        # non-empty scalars replace only when actually returned.
        def merge_nonempty(base: Any, incoming: Any) -> Any:
            if incoming is None:
                return deep_copy(base)

            if isinstance(incoming, list):
                if not incoming:
                    return deep_copy(base)
                if not isinstance(base, list):
                    return deep_copy(incoming)

                merged = deep_copy(base)
                for item in incoming:
                    unique_append(merged, item)
                return merged

            if isinstance(incoming, dict):
                if not isinstance(base, dict):
                    return deep_copy(incoming)

                merged = deep_copy(base)
                for key, value in incoming.items():
                    if key == "trajectory":
                        continue

                    if isinstance(value, dict):
                        merged[key] = merge_nonempty(
                            merged.get(key, {}),
                            value,
                        )
                    elif isinstance(value, list):
                        merged[key] = merge_nonempty(
                            merged.get(key, []),
                            value,
                        )
                    elif value is not None and value != "":
                        merged[key] = deep_copy(value)

                return merged

            if incoming == "":
                return deep_copy(base)

            return deep_copy(incoming)

        reconciled_section = merge_nonempty(
            reconciled_section,
            final_result,
        )

    else:
        logger.warning(
            "Final Response & Resistance repair failed | patient={}",
            patient_id,
        )

    # ------------------------------------------------------------------
    # Deterministic final cleanup — NO LLM call
    # ------------------------------------------------------------------
    reconciled_section = validate_response_evidence_output(
        reconciled_section,
        valid_event_ids,
    )

    # Force the legacy trajectory field to remain empty. This guarantees
    # trajectory never consumes LLM output while keeping old frontend/schema
    # consumers from crashing.
    reconciled_section["trajectory"] = []

    flowsheet = reconciled_section.get("flowsheet")
    if not isinstance(flowsheet, dict):
        flowsheet = {}

    normalized_flowsheet = {}
    for bucket in ("organ", "marker", "imaging"):
        normalized_flowsheet[bucket] = _coerce_flowsheet_series(
            flowsheet.get(bucket) or []
        )

    # No extra LLM call: if the LLM omitted a longitudinal status but the
    # source observations contain an explicit status, preserve the latest
    # source-documented status as a conservative UI fallback.
    for bucket_series in normalized_flowsheet.values():
        for series in bucket_series:
            if not isinstance(series, dict) or series.get("status") not in (None, "", [], {}):
                continue
            observations = series.get("observations") or []
            supported = [
                obs for obs in observations
                if isinstance(obs, dict) and obs.get("status") not in (None, "", [], {})
            ]
            if supported:
                latest = supported[-1]
                series["status"] = latest.get("status")
                series["status_rationale"] = (
                    "Latest source-documented observation status at visit "
                    f"{latest.get('visit_number')} ({latest.get('visit_date')}): "
                    f"{latest.get('status')}."
                )

    # `longitudinal_identity` is an internal reconciliation key.  The rows have
    # already been merged using it, so remove it from the public persisted
    # schema while retaining the stable series_id and observations.
    for bucket_series in normalized_flowsheet.values():
        for series in bucket_series:
            if isinstance(series, dict):
                series.pop("longitudinal_identity", None)

    reconciled_section["flowsheet"] = normalized_flowsheet

    # Keep internal evidence available only during this in-memory pipeline.
    # The persistence layer strips internal fields before storing output.
    reconciled_section["_evidence_inventory"] = evidence_inventory

    return dedupe_section_output(reconciled_section)


async def molecular_microbiome_agent(patient_id, visits, update_context=None) -> Dict[str, Any]:
    prompt = MOLECULAR_PROMPT
    payload = build_agent_journey(patient_id, visits)

    if update_context:
        prompt += CUMULATIVE_SECTION_UPDATE_PROMPT
        payload = {"journey": payload, **update_context}

    result = await groq_json(prompt, payload, max_tokens=12000, retries=2)

    if not isinstance(result, dict) or result.get("_agent_status") == "failed":
        return result

    # Validate event_ids and structurally normalize the flowsheet series.
    # This is deterministic Python only — no extra LLM call.
    valid_event_ids = {
        event.get("event_id")
        for visit in visits
        if isinstance(visit, dict)
        for event in (visit.get("events") or [])
        if isinstance(event, dict) and event.get("event_id")
    }

    result = validate_response_evidence_output(result, valid_event_ids)

    flowsheet = result.get("flowsheet")
    if isinstance(flowsheet, dict):
        result["flowsheet"] = {
            bucket: _coerce_flowsheet_series(flowsheet.get(bucket) or [])
            for bucket in ("molecular", "microbiome")
        }

    return dedupe_section_output(result)


async def notes_documents_agent(patient_id, visits, update_context=None) -> Dict[str, Any]:
    prompt = NOTES_PROMPT
    payload = build_agent_journey(patient_id, visits)
    if update_context:
        prompt += CUMULATIVE_SECTION_UPDATE_PROMPT
        payload = {"journey": payload, **update_context}
    return await groq_json(prompt, payload, max_tokens=10000, retries=2)


SECTION_AGENT_FUNCTIONS = {
    "overview": overview_agent,
    "regimen_treatment": regimen_treatment_agent,
    "trends_statistics": trends_statistics_agent,
    "response_resistance": response_resistance_agent,
    "molecular_microbiome": molecular_microbiome_agent,
    "notes_documents": notes_documents_agent,
}

SECTION_NAMES = tuple(SECTION_AGENT_FUNCTIONS.keys())


def stabilize_against_contract(generated: Any, contract: Any) -> Any:
    """
    Stabilize the application schema without constraining dynamic clinical
    content.

    - Dict contracts with keys define required structure.
    - Empty dict contracts are intentionally open dictionaries.
    - Empty list contracts are intentionally open lists.
    - Scalar contract types are preserved.
    """
    if isinstance(contract, dict):
        if not contract:
            return deep_copy(generated) if isinstance(generated, dict) else {}

        source = generated if isinstance(generated, dict) else {}
        return {
            key: stabilize_against_contract(source.get(key), default)
            for key, default in contract.items()
        }

    if isinstance(contract, list):
        return deep_copy(generated) if isinstance(generated, list) else []

    if contract is None:
        return deep_copy(generated) if generated is not None else None

    if isinstance(generated, type(contract)):
        return deep_copy(generated)

    return deep_copy(contract)


def section_contract(section_name: str) -> Dict[str, Any]:
    return empty_output_structure()[section_name]


def stable_section(section_name: str, generated: Any) -> Dict[str, Any]:
    default = section_contract(section_name)
    stabilized = stabilize_against_contract(generated, default)
    return dedupe_section_output(stabilized)


def reconcile_cumulative_value(
    existing: Any,
    generated: Any,
) -> Any:
    """
    Generic source-preserving reconciliation.

    No clinical field names are used.
    No clinical mappings are used.
    No disease logic is used.

    Existing materialized information is retained when the new generation
    omitted it, while newly generated information is added.

    Lists are merged using semantic duplicate signatures.
    Dictionaries are reconciled recursively.
    Scalars prefer newly generated source-supported values.
    """

    if existing is None:
        return deep_copy(generated)

    if generated is None:
        return deep_copy(existing)

    if isinstance(existing, list) and isinstance(generated, list):
        result = []

        for item in existing:
            if semantic_item_signature(item) not in {
                semantic_item_signature(x)
                for x in result
            }:
                result.append(deep_copy(item))

        for item in generated:
            signature = semantic_item_signature(item)

            if signature not in {
                semantic_item_signature(x)
                for x in result
            }:
                result.append(deep_copy(item))

        return result

    if isinstance(existing, dict) and isinstance(generated, dict):
        result = deep_copy(existing)

        for key, new_value in generated.items():
            if key not in result:
                result[key] = deep_copy(new_value)
            else:
                result[key] = reconcile_cumulative_value(
                    result[key],
                    new_value,
                )

        return result

    # Generated scalar wins because the complete journey has just been
    # reconsidered by the agent.
    return deep_copy(generated)


def reconcile_section(
    section_name: str,
    existing_section: Optional[Dict[str, Any]],
    generated_section: Dict[str, Any],
) -> Dict[str, Any]:

    if not existing_section:
        return stable_section(
            section_name,
            generated_section,
        )

    merged = reconcile_cumulative_value(
        existing_section,
        generated_section,
    )

    return stable_section(
        section_name,
        merged,
    )

def snapshot_section_hash(section: Any) -> str:
    return json_signature(section)


def build_cumulative_section_context(
    section_name: str,
    existing_section: Optional[Dict[str, Any]],
    visits: List[Dict[str, Any]],
    incoming_event: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Build the context for regeneration of ONE cumulative section.

    The complete visit history is the completeness source.
    Existing section state is only the continuity/stability source.
    """

    incoming = deep_copy(incoming_event)

    return {
        "update_mode": "cumulative_longitudinal",
        "section_name": section_name,

        # Previously persisted cumulative representation.
        "existing_section": deep_copy(existing_section or {}),

        # Complete source history represented deterministically.
        "journey": build_agent_journey(
            patient_id=incoming_event.get("patient_id"),
            visits=visits,
        ),

        # Triggering event is context only. It is NOT the evidence boundary.
        "incoming_event": incoming,

        # Deterministic visit history.
        "visit_history": build_visit_history(visits),
    }

# ============================================================================
# GRAPH NODES
# ============================================================================

# ============================================================================
# GRAPH NODES
# ============================================================================

async def ingest_event_node(
    state: LongitudinalState,
) -> LongitudinalState:
    """
    1. Build the raw canonical event.
    2. Classify it (lightweight).
    3. Save it ATOMICALLY.
    4. Re-read the COMPLETE fresh source history.
    """

    input_data = state.get("input") or {}

    patient_id = input_data.get("patient_id")
    doctor_id = input_data.get("doctor_id")

    document_text = input_data.get("document_text") or ""
    document_date = input_data.get("document_date")
    file_name = input_data.get("file_name")
    document_id = input_data.get("document_id")
    source = input_data.get("source")
    payload = input_data.get("payload") or {}
    metadata = input_data.get("metadata") or {}

    if not patient_id:
        raise ValueError("Longitudinal workflow received no patient_id")

    if not document_id:
        raise ValueError("Longitudinal workflow received no document_id")

    if not document_date:
        raise ValueError("Longitudinal workflow received no document_date")

    normalized_date = normalize_date(document_date)

    if not normalized_date:
        raise ValueError(
            f"Unparseable document_date for event {document_id}: "
            f"{document_date}"
        )

    logger.info(
        "LONGITUDINAL EVENT RECEIVED | patient={} document_id={} file={} "
        "date={} chars={}",
        patient_id,
        document_id,
        file_name,
        normalized_date,
        len(document_text),
    )

    classification = await classify_document(document_text)

    incoming_event = {
        "event_id": document_id,
        "document_id": document_id,
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "source": source,
        "file_name": file_name,
        "document_date": normalized_date,
        "event_date": normalized_date,
        "appointment_date": normalize_date(
            input_data.get("appointment_date")
        ),
        "appointment_id": input_data.get("appointment_id"),
        # RAW SOURCE — stored exactly as received.
        "document_text": document_text,
        "payload": payload,
        "metadata": metadata,
        "document_classification": classification,
    }

    # ATOMIC per-event write. No shared array, no read-modify-write......
    await save_source_event(incoming_event)

    # FRESH canonical history, including events written concurrently.
    source_events = await load_source_events(patient_id, doctor_id)

    appointments = await load_patient_appointments(patient_id)

    # Materialized longitudinal identity is PATIENT ONLY.
    # doctor_id is event provenance, not summary identity.
    query = {"patient_id": patient_id}

    # IMPORTANT: load the previously materialized output BEFORE generating
    # section updates. This is the stability mechanism.
    existing_record = await longitudinal_collection.find_one(
        query,
        {"_id": 0},
    )

    revision = source_history_revision(source_events)

    return {
        **state,
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "incoming_event": incoming_event,
        "source_events": source_events,
        "appointments": appointments,
        "existing_record": existing_record,
        "source_revision": revision,
        "stale_build": False,
        "visits": [],
        "deterministic_trends": {},
        "sections": {},
        "final_data": {},   
    }


def build_visits_node(state: LongitudinalState) -> LongitudinalState:

    visits = build_visits_from_source_events(
        patient_id=state["patient_id"],
        source_events=state.get("source_events") or [],
        appointments=state.get("appointments") or [],
    )

    logger.info(
        "LONGITUDINAL VISITS BUILT | patient={} visits={} events_per_visit={}",
        state["patient_id"],
        len(visits),
        [visit.get("event_count") for visit in visits],
    )

    return {
        **state,
        "visits": visits,
    }


async def section_agents_node(
    state: LongitudinalState,
) -> LongitudinalState:
    """
    Generate ONE cumulative representation from the COMPLETE journey.

    The complete journey is authoritative and is re-read on every build, so
    the regenerated section REPLACES the previous one. The previous section
    is used only as a fallback if an agent fails. It is never merged in and
    never fed back to the LLM, which is what accumulated paraphrased
    duplicates on every upload.
    """

    patient_id = state["patient_id"]
    visits = state.get("visits") or []

    if not visits:
        return {
            **state,
            "sections": {},
        }

    existing_record = state.get("existing_record") or {}
    existing_data = existing_record.get("data") or {}

    existing_sections = (
        existing_data.get("sections")
        if isinstance(existing_data.get("sections"), dict)
        else {}
    )

    incoming_event = state.get("incoming_event") or {}

    journey = build_agent_journey(
        patient_id=patient_id,
        visits=visits,
    )

    visit_history = build_visit_history(visits)

    async def run_section(section_name: str):
        agent = SECTION_AGENT_FUNCTIONS[section_name]

        fallback_section = (
            deep_copy(existing_sections.get(section_name))
            if isinstance(existing_sections, dict)
            else None
        )

        context = {
            "update_mode": "cumulative_longitudinal",
            "section_name": section_name,
            "journey": journey,
            "incoming_event": deep_copy(incoming_event),
            "visit_history": visit_history,
            "source_event_count": len(state.get("source_events") or []),
            "visit_count": len(visits),
        }

        try:
            result = await agent(
                patient_id,
                visits,
                update_context=context,
            )

            if (
                not isinstance(result, dict)
                or result.get("_agent_status") == "failed"
            ):
                raise RuntimeError(
                    f"{section_name} agent failed: "
                    f"{result.get('_error') if isinstance(result, dict) else result}"
                )

            if section_name == "regimen_treatment":
                # The treatment prompt already contains the full cumulative
                # completeness/source-audit requirements. The previous
                # unconditional reconciliation LLM call duplicated the same
                # complete-journey reasoning. Keep deterministic cleanup here
                # but avoid the second LLM request.
                result = dedupe_section_output(result)

            return section_name, result

        except Exception:
            logger.exception(
                "Cumulative section generation failed | section={}",
                section_name,
            )

            return section_name, stable_section(
                section_name,
                fallback_section or {},
            )

    results = await asyncio.gather(
        *(run_section(section_name) for section_name in SECTION_NAMES)
    )


    sections: Dict[str, Any] = {
        section_name: stable_section(section_name, generated)
        for section_name, generated in results
    }

    logger.info(
        "CUMULATIVE SECTIONS GENERATED | patient={} visits={} events={} sections={}",
        patient_id,
        len(visits),
        len(state.get("source_events") or []),
        list(sections.keys()),
    )

    return {
        **state,
        "sections": sections,
    }


def deterministic_trend_node(state):

    trends_section = (
        state.get("sections", {})
        .get("trends_statistics")
        or {}
    )

    logger.info(
        "TRENDS AGENT RAW OUTPUT | patient={} keys={} output={}",
        state.get("patient_id"),
        list(trends_section.keys()),
        json.dumps(
            trends_section,
            default=str,
            ensure_ascii=False,
        ),
    )

    # ---------------------------------------------------------
    # NEW CONTRACT
    # ---------------------------------------------------------
    # The section agent returns the five fields directly.
    # Convert them into the internal presentation_views
    # container used by the deterministic validation layer.
    # ---------------------------------------------------------

    raw_presentation = {
        "cumulative_dose_vs_limit": trends_section.get(
            "cumulative_dose_vs_limit"
        ),
        "toxicity_visit_over_visit": trends_section.get(
            "toxicity_visit_over_visit"
        ),
        "tumor_burden": trends_section.get(
            "tumor_burden"
        ),
        "key_labs": trends_section.get(
            "key_labs"
        ),
        "biomarkers": trends_section.get(
            "biomarkers"
        ),
    }

    trends = build_deterministic_trends(
        trends_result={
            "presentation_views": raw_presentation,
            "narrative": trends_section.get("narrative"),
        },
        visits=state.get("visits", []),
    )

    logger.info(
        "TRENDS RESOLVED OUTPUT | patient={} presentation_views={}",
        state.get("patient_id"),
        json.dumps(
            trends.get("presentation_views"),
            default=str,
            ensure_ascii=False,
        ),
    )

    return {
        **state,
        "deterministic_trends": trends,
    }


# ============================================================================
# OUTPUT CONTRACT
# ============================================================================

def empty_output_structure() -> Dict[str, Any]:

    return {
        "overview": {
            "label": "Overview",
            "cancer_case_identity": [],
            "identity": [],
            "current_state": [],
            "key_findings": [],
            "what_changed": [],
            "current_status": [],
            "narrative": None,
        },

        "regimen_treatment": {
            "label": "Regimen & Treatment",
            "regimen_history_cumulative_exposure": [],
            "current": [],
            "history": [],
            "timeline": [],
            "exposure": [],
            "plans": [],
            "changes": [],
            "procedures": [],
            "decisions": [],
            "narrative": None,
        },

        "trends_statistics": {
            "label": "Trends & Statistics",
"ai_summary": None,
            "overall_trends": {},
            "longitudinal_metric_trends": {},
            "comparison": {},
            "history": [],
            "visit_delta": {},
            "longitudinal_overview": {},
            "disease_trajectory": [],
            "disease_trajectory_periods": [],
            "symptom_trends": {},
            "medication_timeline": [],
            "treatment_history": [],
            "active_alerts": [],
            "pending_items": [],
            "clinical_decisions_log": [],
            "clinical_attributes_log": [],
            "clinical_recommendations_log": [],
            "dashboard": {},
            "additional_views": [],
            "graphs": [],
            "views": [],
            "presentation_views": {},
            "what_changed": [],
            
            "cumulative_dose_vs_limit": None,
            "toxicity_visit_over_visit": None,
            "tumor_burden": None,
            "key_labs": None,
            "biomarkers": None,

            "narrative": None,
        },

        "response_resistance": {
            "label": "Response & Resistance",
            "summary": [],
            "trajectory": [],
            "status_cards": [],
            "response_trajectory": [],
            "resistance_signal": [],
            "pathway_deviation": [],
            "pathway_deviation_log": [],
            "outcome_benchmark": [],
            "outcome_benchmark_note": None,
            "new_findings": [],
            "flowsheet": {
                "organ": [],
                "marker": [],
                "imaging": [],
            },
            "flowsheet_pivoted": {},
            "intelligence": {
                "response": {},
                "toxicity": {},
                "progression": {},
            },
            "narrative": None,
        },

        "molecular_microbiome": {
            "label": "Molecular & Microbiome",
            "summary": [],
            "molecular_genomic": [],
            "microbiome": [],
            "flowsheet": {
                "molecular": [],
                "microbiome": [],
            },
            "flowsheet_pivoted": {},
            "narrative": None,
        },

        "notes_documents": {
            "label": "Notes & Docs",
            "notes": [],
            "decisions": [],
            "recommendations": [],
            "pending": [],
            "documents": [],
            "narrative": None,
        },
    }


def merge_section_with_contract(
    generated: Any,
    default: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Recursively stabilize the fixed application contract without imposing a
    fixed schema on dynamic clinical contents.

    An empty dict/list in the contract is intentionally open.
    """
    return dedupe_section_output(
        stabilize_against_contract(generated, default)
    )


def build_document_index(
    visits: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Deterministic proof that every uploaded event survived. This never
    depends on an agent remembering to list a document.
    """

    documents = []

    for visit in visits:
        for event in visit.get("events", []):
            if not isinstance(event, dict):
                continue

            classification = event.get("document_classification") or {}

            documents.append(
                {
                    "event_id": event.get("event_id"),
                    "document_id": event.get("document_id"),
                    "visit_number": visit.get("visit_number"),
                    "visit_date": visit.get("visit_date"),
                    "file_name": event.get("file_name"),
                    "source": event.get("source"),
                    "document_date": event.get("document_date"),
                    "document_type": classification.get("document_type"),
                    "document_type_name": classification.get(
                        "document_type_name"
                    ),
                    "title": classification.get("title"),
                    "character_count": len(event.get("document_text") or ""),
                }
            )

    return documents


# ============================================================================
# FINAL ASSEMBLY
# ============================================================================


def remove_internal_ids(value: Any) -> Any:
    """
    Remove internal evidence/source identifiers from user-facing generated
    section output.

    IMPORTANT:
    This does NOT modify the canonical source events.
    It only sanitizes the generated `sections` output.

    Removed fields:
    - event_id
    - event_ids
    - source_event_id
    - source_event_ids

    All other generated content is preserved recursively.
    """

    INTERNAL_ID_FIELDS = {
        "event_id",
        "event_ids",
        "source_event_id",
        "source_event_ids",
        "_evidence_inventory",
    }

    if isinstance(value, dict):
        return {
            key: remove_internal_ids(item)
            for key, item in value.items()
            if key not in INTERNAL_ID_FIELDS
        }

    if isinstance(value, list):
        return [
            remove_internal_ids(item)
            for item in value
        ]

    return value

def _merge_flowsheet_series_collections(
    collections: List[Any],
) -> List[Dict[str, Any]]:
    """
    Merge flowsheet series using structural identity only.

    A series is merged only when its parameter/unit/category identity is the
    same. Category is a presentation attribute and remains part of structural
    identity. No clinical meaning is inferred here.
    """

    merged: Dict[tuple, Dict[str, Any]] = {}

    for collection in collections:
        for series in _coerce_flowsheet_series(collection):
            series_id = series.get("series_id")
            parameter = series.get("parameter")
            unit = series.get("unit")
            category = series.get("category")

            key = _flow_observation_key(
                parameter,
                unit,
                category,
                series_id,
            )

            trend = series.get("trend")
            trend_rationale = series.get("trend_rationale")

            target = merged.get(key)

            if target is None:
                target = {
                    "series_id": series_id,
                    "parameter": parameter,
                    "unit": unit,
                    "category": category,
                    "trend": trend,
                    "trend_rationale": trend_rationale,
                    "status": series.get("status"),
                    "status_rationale": series.get(
                        "status_rationale"
                    ),
                    "observations": [],
                }
                merged[key] = target
            else:
                # Keep the first non-empty presentation metadata, but never
                # discard a source-supported observation.
                if _is_empty_value(target.get("series_id")) and not _is_empty_value(series_id):
                    target["series_id"] = series_id
                if _is_empty_value(target.get("parameter")) and not _is_empty_value(parameter):
                    target["parameter"] = parameter
                if _is_empty_value(target.get("unit")) and not _is_empty_value(unit):
                    target["unit"] = unit
                if _is_empty_value(target.get("category")) and not _is_empty_value(category):
                    target["category"] = category
                if _is_empty_value(target.get("trend")) and not _is_empty_value(trend):
                    target["trend"] = trend
                if _is_empty_value(target.get("trend_rationale")) and not _is_empty_value(trend_rationale):
                    target["trend_rationale"] = trend_rationale

                if _is_empty_value(target.get("status")) and not _is_empty_value(series.get("status")):
                    target["status"] = series.get("status")

                if _is_empty_value(target.get("status_rationale")) and not _is_empty_value(series.get("status_rationale")):
                    target["status_rationale"] = series.get("status_rationale")

            target["observations"].extend(
                deep_copy(series.get("observations") or [])
            )

    result = []

    for series in merged.values():
        observations = _coerce_flowsheet_series(
            [series]
        )

        if observations:
            result.extend(observations)

    return result


# def build_response_flowsheet_all(
#     flowsheet: Dict[str, Any],
# ) -> List[Dict[str, Any]]:
#     """
#     Build the `all` presentation bucket from the supplied flowsheet
#     collections without applying clinical mappings.

#     The preferred source is the reconciled `all` bucket. Category buckets
#     are included so that source-supported organ/marker/imaging entries cannot
#     disappear from the aggregate representation.
#     """

#     if not isinstance(flowsheet, dict):
#         return []

#     collections: List[Any] = []

#     if isinstance(flowsheet.get("all"), list):
#         collections.append(flowsheet.get("all"))

#     for bucket_name in (
#         "organ",
#         "marker",
#         "imaging",
#     ):
#         values = flowsheet.get(bucket_name)

#         if isinstance(values, list):
#             collections.append(values)

#     return _merge_flowsheet_series_collections(
#         collections
#     )


def assemble_final_output_node(
    state: LongitudinalState,
) -> LongitudinalState:
    output = empty_output_structure()
    defaults = empty_output_structure()

    sections = state.get("sections", {}) or {}

    for section_name in output:
        generated = sections.get(section_name, {})
        output[section_name] = merge_section_with_contract(
            generated,
            defaults[section_name],
        )
        output[section_name] = dedupe_section_output(
            remove_internal_ids(output[section_name])
        )

    deterministic = state.get(
        "deterministic_trends",
        {},
    ) or {}

    trends = output["trends_statistics"]

    # Preserve the legacy generic views payload for existing consumers.
    # The new five presentation slots remain authoritative for the Trends UI.
    ordered_visits = state.get("visits", [])
    valid_event_ids = {
        event.get("event_id")
        for visit in ordered_visits
        if isinstance(visit, dict)
        for event in (visit.get("events") or [])
        if isinstance(event, dict) and event.get("event_id")
    }

    legacy_overall_trends = (
        trends.get("overall_trends")
        if isinstance(trends, dict)
        else {}
    ) or {}

    try:
        trends["views"] = build_trend_views(
            raw_views=trends.get("views"),
            overall_trends=legacy_overall_trends,
            visits=ordered_visits,
            valid_event_ids=valid_event_ids,
        )
    except Exception as exc:
        logger.warning("Legacy trend views could not be resolved: {}", exc)
        trends["views"] = trends.get("views") or []

    presentation = (
        deterministic.get("presentation_views")
        or {}
    )

    for slot in (
        "cumulative_dose_vs_limit",
        "toxicity_visit_over_visit",
        "tumor_burden",
        "key_labs",
        "biomarkers",
    ):
        trends[slot] = presentation.get(slot)

    latest_visit = ordered_visits[-1] if ordered_visits else None
    document_index = build_document_index(ordered_visits)

    # Legacy `views` remains available for backward compatibility, but it
    # is NOT the authoritative Trends & Statistics UI payload.
    

    


    resp_section = output["response_resistance"]

    flowsheet = resp_section.get("flowsheet") or {}

    # Response & Resistance exposes only the three supported presentation
    # buckets. No aggregate "all" bucket is created.
    resp_section["flowsheet"] = {
        "organ": flowsheet.get("organ") or [],
        "marker": flowsheet.get("marker") or [],
        "imaging": flowsheet.get("imaging") or [],
    }

    # Deterministic visit-wise representation. The visit axis comes only
    # from the canonical longitudinal visits. Each reconciled series remains
    # ONE row; its pre/during/post observations are placed in the matching
    # visit cells, while trend and LLM status remain row-level fields.
    resp_section["flowsheet_pivoted"] = {
        bucket: pivot_flowsheet_bucket(
            flowsheet.get(bucket, []),
            ordered_visits,
        )
        for bucket in (
            "organ",
            "marker",
            "imaging",
        )
    }

    # Documents are source-derived and therefore deterministic. Do not allowwww
    # an LLM response to silently remove them.
    output["notes_documents"]["documents"] = document_index

    mol_section = output["molecular_microbiome"]
    mol_flowsheet = mol_section.get("flowsheet") or {}

    # Molecular & Microbiome exposes only the two supported presentation
    # buckets. No aggregate "all" bucket is created.
    mol_section["flowsheet"] = {
        "molecular": mol_flowsheet.get("molecular") or [],
        "microbiome": mol_flowsheet.get("microbiome") or [],
    }

    # Deterministic visit-wise representation, same mechanism as
    # response_resistance. Each reconciled series remains ONE row; its
    # pre/during/post observations are placed in the matching visit cells,
    # while trend and LLM status remain row-level fields.
    mol_section["flowsheet_pivoted"] = {
        bucket: pivot_flowsheet_bucket(
            mol_flowsheet.get(bucket, []),
            ordered_visits,
        )
        for bucket in ("molecular", "microbiome")
    }

    # Documents are source-derived and therefore deterministic. Do not allow
    # an LLM response to silently remove them.
    output["notes_documents"]["documents"] = document_index

    final_data = {
        "patient_id": state["patient_id"],
        # Longitudinal output is patient-wide. Individual events retain
        # doctor_id as provenance.
        "doctor_id": None,

        "current_visit": (
            clean_visits([latest_visit])[0]
            if latest_visit
            else None
        ),

        # COMPLETE chronological history.
        "visits": clean_visits(ordered_visits),

        # ONE cumulative representation.
        "sections": output,

        "source_summary": {
            "source_event_count": len(
                state.get("source_events") or []
            ),
            "source_revision": state.get("source_revision"),
            "visit_count": len(ordered_visits),
            "event_count": sum(
                visit.get("event_count", 0)
                for visit in ordered_visits
            ),
            "documents": document_index,
        },
    }

    # Internal materialized state. It is deliberately separate from
    # data.visits so the frontend continues receiving the existing shape.
    snapshots = state.get("visit_section_snapshots") or {}
    final_data["visit_section_snapshots"] = deep_copy(snapshots)

    return {
        **state,
        "final_data": final_data,
    }


# ============================================================================
# PERSIST
# ============================================================================

async def persist_node(
    state: LongitudinalState,
) -> LongitudinalState:
    """
    Persist the patient-wide materialized longitudinal view.

    Before writing, verify that the canonical source history has not changed
    while the LLM agents were processing. A stale build is rejected instead of
    overwriting a newer result.
    """

    patient_id = state["patient_id"]
    build_revision = state.get("source_revision")

    current_events = await load_source_events(patient_id)
    current_revision = source_history_revision(current_events)

    if (
        build_revision
        and current_revision != build_revision
    ):
        logger.warning(
            "STALE LONGITUDINAL BUILD REJECTED | "
            "patient={} build_revision={} current_revision={} "
            "build_visits={} current_events={}",
            patient_id,
            build_revision,
            current_revision,
            len(state.get("visits") or []),
            len(current_events),
        )

        return {
            **state,
            "stale_build": True,
        }

    now = datetime.utcnow().isoformat()

    final_data = deep_copy(state["final_data"])
    final_data["generated_at"] = now

    final_data.setdefault("source_summary", {})
    final_data["source_summary"]["source_revision"] = current_revision

    await longitudinal_collection.update_one(
        {
            "patient_id": patient_id,
        },
        {
            "$set": {
                "patient_id": patient_id,

                # Deliberately not part of materialized-view identity.
                "doctor_id": None,

                "generated_at": now,
                "source_revision": current_revision,
                "data": final_data,
            }
        },
        upsert=True,
    )

    # A source event can arrive in the tiny interval between the pre-write
    # revision check and the Mongo update. Verify once more after writing.
    # If the source changed, mark this build stale so the caller retries.
    post_write_events = await load_source_events(patient_id)
    post_write_revision = source_history_revision(post_write_events)

    if post_write_revision != current_revision:
        logger.warning(
            "LONGITUDINAL BUILD BECAME STALE DURING PERSIST | "
            "patient={} persisted_revision={} latest_revision={}",
            patient_id,
            current_revision,
            post_write_revision,
        )

        return {
            **state,
            "stale_build": True,
        }

    logger.info(
        "Longitudinal materialized view persisted | "
        "patient={} visits={} events={} target_visit={} affected_visits={} "
        "source_revision={}",
        patient_id,
        len(state.get("visits", [])),
        final_data.get("source_summary", {}).get("event_count"),
        state.get("target_visit_number"),
        state.get("affected_visit_numbers"),
        current_revision,
    )

    return {
        **state,
        "stale_build": False,
        "source_revision": current_revision,
        "final_data": final_data,
    }


# ============================================================================
# LANGGRAPH
# ============================================================================

def build_longitudinal_graph():

    graph = StateGraph(LongitudinalState)

    graph.add_node("ingest_event", ingest_event_node)
    graph.add_node("build_visits", build_visits_node)
    graph.add_node("section_agents", section_agents_node)
    graph.add_node("calculate_trends", deterministic_trend_node)
    graph.add_node("assemble", assemble_final_output_node)
    graph.add_node("persist", persist_node)

    graph.set_entry_point("ingest_event")

    graph.add_edge("ingest_event", "build_visits")
    graph.add_edge("build_visits", "section_agents")
    graph.add_edge("section_agents", "calculate_trends")
    graph.add_edge("calculate_trends", "assemble")
    graph.add_edge("assemble", "persist")
    graph.add_edge("persist", END)

    return graph.compile()


_longitudinal_graph = build_longitudinal_graph()


# ============================================================================
# PUBLIC TRIGGER
# ============================================================================

async def generate_longitudinal_summary(
    patient_id: str,
    document_text: str,
    document_date: Optional[str],
    file_name: Optional[str],
    document_id: str,
    doctor_id: Optional[str] = None,
    source: Optional[str] = None,
    payload: Optional[Dict[str, Any]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    appointment_date: Optional[str] = None,
    appointment_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Main function used by handwritten_task.py and process_mongo_document().

    Signature remains backward compatible.

    If another event arrives while the LLM agents are processing, persist_node
    rejects the stale build and this function retries from the fresh canonical
    source history.
    """

    if not patient_id:
        raise ValueError("patient_id is required")

    if not document_id:
        raise ValueError("document_id is required")

    if not document_date:
        raise ValueError("document_date is required")

    initial_state: LongitudinalState = {
        "input": {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "document_text": document_text or "",
            "document_date": document_date,
            "file_name": file_name,
            "document_id": document_id,
            "source": source,
            "payload": payload or {},
            "metadata": metadata or {},
            "appointment_date": appointment_date,
            "appointment_id": appointment_id,
        }
    }

    max_attempts = 3

    for attempt in range(1, max_attempts + 1):

        final_state = await _longitudinal_graph.ainvoke(
            initial_state
        )

        if not final_state.get("stale_build"):
            return final_state.get("final_data") or {}

        logger.warning(
            "Retrying stale longitudinal build | patient={} "
            "attempt={}/{}",
            patient_id,
            attempt,
            max_attempts,
        )

    # If the source keeps changing, return the newest safely materialized
    # record rather than returning an obsolete in-memory build.
    latest_record = await longitudinal_collection.find_one(
        {"patient_id": patient_id},
        {"_id": 0},
    )

    if latest_record:
        return latest_record.get("data") or {}

    raise RuntimeError(
        "Longitudinal source history changed during processing and "
        "the materialized view could not be safely updated."
    )


# ============================================================================
# EVENT ADAPTERS
# ============================================================================

async def trigger_from_document(
    patient_id: str,
    doctor_id: Optional[str],
    document_id: str,
    document_text: str,
    document_date: Optional[str],
    file_name: Optional[str] = None,
) -> Dict[str, Any]:

    # The document text stays the document text. Nothing is wrapped.
    return await generate_longitudinal_summary(
        patient_id=patient_id,
        doctor_id=doctor_id,
        document_text=document_text,
        document_date=document_date,
        file_name=file_name,
        document_id=document_id,
        source="document",
    )


def payload_as_text(payload: Any) -> str:
    """
    A workflow payload is structured data, not a document. It is kept intact
    in `payload`; this readable rendering exists only so the agents can read
    it as text.
    """

    if isinstance(payload, str):
        return payload

    return json.dumps(
        payload,
        default=str,
        ensure_ascii=False,
        indent=2,
    )


async def trigger_from_workflow(
    patient_id: str,
    doctor_id: Optional[str],
    event_id: str,
    event_date: Optional[str],
    appointment_date: Optional[str],
    payload: Dict[str, Any],
    source: Optional[str] = None,
    appointment_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:

    metadata = metadata or {}

    source_date = (
        appointment_date
        or event_date
        or metadata.get("document_date")
        or metadata.get("visit_date")
        or metadata.get("date")
    )

    if not source_date:
        raise ValueError(
            "A workflow event requires a usable event/appointment date."
        )

    return await generate_longitudinal_summary(
        patient_id=patient_id,
        doctor_id=doctor_id,
        document_text=payload_as_text(payload),
        document_date=source_date,
        file_name=source,
        document_id=event_id,
        source=source,
        payload=payload,
        metadata=metadata,
        appointment_date=appointment_date,
        appointment_id=appointment_id,
    )


# ============================================================================
# REBUILD (no new event required)
# ============================================================================

async def rebuild_longitudinal_summary(
    patient_id: str,
    doctor_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Regenerate the complete output from stored raw source history.

    The old materialized view is intentionally NOT deleted before processing.
    A stale build is discarded if source history changes during LLM work.
    """

    max_attempts = 3

    for attempt in range(1, max_attempts + 1):

        source_events = await load_source_events(patient_id)

        if not source_events:
            raise ValueError(
                "No stored source events for this patient."
            )

        appointments = await load_patient_appointments(patient_id)

        revision = source_history_revision(source_events)

        state: LongitudinalState = {
            "patient_id": patient_id,
            "doctor_id": None,
            "source_events": source_events,
            "appointments": appointments,
            "existing_record": await longitudinal_collection.find_one(
                {"patient_id": patient_id},
                {"_id": 0},
            ),
            "source_revision": revision,
            "stale_build": False,
        }

        state = build_visits_node(state)
        state = await section_agents_node(state)
        state = deterministic_trend_node(state)
        state = assemble_final_output_node(state)
        state = await persist_node(state)

        if not state.get("stale_build"):
            return state.get("final_data") or {}

        logger.warning(
            "Retrying stale longitudinal rebuild | patient={} "
            "attempt={}/{}",
            patient_id,
            attempt,
            max_attempts,
        )

    latest_record = await longitudinal_collection.find_one(
        {"patient_id": patient_id},
        {"_id": 0},
    )

    if latest_record:
        return latest_record.get("data") or {}

    raise RuntimeError(
        "Longitudinal source history changed during rebuild and "
        "the materialized view could not be safely updated."
    )


# ============================================================================
# GET
# ============================================================================

@router.get("/api/patients/{patient_id}/longitudinal-summary")
async def get_longitudinal_summary(
    patient_id: str,
    doctor_id: Optional[str] = None,
):
    """
    Return the patient-wide longitudinal materialized view.

    doctor_id remains accepted for backward compatibility but does not filter
    the longitudinal journey.
    """

    record = await longitudinal_collection.find_one(
        {
            "patient_id": patient_id,
        },
        {
            "_id": 0,
        },
    )

    if not record:
        raise HTTPException(
            status_code=404,
            detail="Longitudinal summary has not been generated yet.",
        )

    return record


# ============================================================================
# RAW SOURCE EVENTS (diagnostics)
# ============================================================================

@router.get("/api/patients/{patient_id}/longitudinal-source-events")
async def get_longitudinal_source_events(
    patient_id: str,
    doctor_id: Optional[str] = None,
    include_text: bool = False,
):
    """
    Answers "did both uploads actually arrive?" directly from the canonical
    history instead of from the generated output.
    """

    events = await load_source_events(patient_id, doctor_id)

    result = []

    for event in events:
        item = deep_copy(event)

        if not include_text:
            text = item.pop("document_text", "") or ""
            item["document_text_length"] = len(text)

        result.append(item)

    return {
        "patient_id": patient_id,
        "count": len(result),
        "events": result,
    }


# =========================================================================
# REBUILD ENDPOINT
# ============================================================================

@router.post("/api/longitudinal-summary/{patient_id}/rebuild")
async def rebuild_longitudinal_summary_endpoint(
    patient_id: str,
    doctor_id: Optional[str] = None,
):

    try:
        data = await rebuild_longitudinal_summary(
            patient_id=patient_id,
            doctor_id=None,
        )

        return {"success": True, "data": data}

    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    except Exception as exc:
        logger.exception("Longitudinal rebuild failed")
        raise HTTPException(status_code=500, detail=str(exc))


# ============================================================================
# DELETE PARTICULAR VISIT
# ========================================================================

@router.delete("/api/longitudinal-summary/{patient_id}/visit/{visit_number}")
async def delete_longitudinal_visit(
    patient_id: str,
    visit_number: int,
    doctor_id: Optional[str] = None,
):
    """
    Deleting a visit now deletes the RAW SOURCE EVENTS behind it and then
    regenerates. Otherwise the next upload would resurrect the visit from
    the source history.
    """

    if visit_number < 1:
        raise HTTPException(
            status_code=400,
            detail="visit_number must be >= 1",
        )

    source_events = await load_source_events(patient_id, doctor_id)

    if not source_events:
        raise HTTPException(
            status_code=404,
            detail="No longitudinal source events for this patient.",
        )

    appointments = await load_patient_appointments(patient_id)

    visits = build_visits_from_source_events(
        patient_id,
        source_events,
        appointments,
    )

    target = None

    for visit in visits:
        if visit.get("visit_number") == visit_number:
            target = visit
            break

    if target is None:
        raise HTTPException(
            status_code=404,
            detail=f"Visit {visit_number} not found.",
        )

    event_ids = [
        event.get("event_id")
        for event in target.get("events", [])
        if isinstance(event, dict) and event.get("event_id")
    ]

    if event_ids:
        await source_events_collection.delete_many(
            {
                "patient_id": patient_id,
                "event_id": {"$in": event_ids},
            }
        )

    logger.info(
        "Deleted longitudinal visit patient={} visit={} events={}",
        patient_id,
        visit_number,
        len(event_ids),
    )

    remaining = await load_source_events(patient_id, doctor_id)

    if not remaining:
        await longitudinal_collection.delete_one(
            {"patient_id": patient_id}
        )

        return {
            "success": True,
            "deleted_visit": visit_number,
            "deleted_events": len(event_ids),
            "remaining_visits": 0,
            "message": "Visit deleted. No source events remain.",
        }

    data = await rebuild_longitudinal_summary(patient_id, doctor_id)

    return {
        "success": True,
        "deleted_visit": visit_number,
        "deleted_events": len(event_ids),
        "remaining_visits": len(data.get("visits") or []),
        "message": "Visit deleted and the journey was regenerated.",
    }


# =================================================================
# INTERNAL EVENT ENDPOINT
# =================================================================

@router.post("/internal/longitudinal-summary/event")
async def longitudinal_event_endpoint(
    request: LongitudinalEventRequest,
):

    try:
        source_date = (
            request.appointment_date
            or request.event_date
            or request.metadata.get("document_date")
            or request.metadata.get("visit_date")
            or request.metadata.get("date")
        )

        if not source_date:
            raise ValueError(
                "The event does not contain a usable "
                "event/appointment/document date."
            )

        result = await generate_longitudinal_summary(
            patient_id=request.patient_id,
            doctor_id=request.doctor_id,
            document_text=payload_as_text(request.payload),
            document_date=source_date,
            file_name=request.source,
            document_id=request.event_id,
            source=request.source,
            payload=request.payload,
            metadata=request.metadata,
            appointment_date=request.appointment_date,
            appointment_id=request.appointment_id,
        )

        return {"success": True, "data": result}

    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    except Exception as exc:
        logger.exception("Longitudinal event processing failed")
        raise HTTPException(status_code=500, detail=str(exc))