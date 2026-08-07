"""
timeline_builder.py
====================================================================
INCREMENTAL VISIT-TIMELINE UPDATER
====================================================================

This module is an INCREMENTAL updater. It is called exactly once per
newly extracted date-wise report.

It NEVER:

    - reads `processed_documents`
    - rebuilds a previous timeline
    - re-reads previous reports
    - regenerates summaries from historical documents

The `report_content` passed into `build_timeline_incremental()` is the
ONLY new clinical report considered on this call. Everything else
(visit summary continuity, timeline history) is carried forward from
whatever is already stored in Mongo, and updated incrementally.

====================================================================
INTEGRATION
====================================================================
The handwritten pipeline calls this after extracting a date-wise
report, without needing to know anything about visit/appointment
bucketing:

    from timeline_builder import build_timeline_incremental

    await build_timeline_incremental(
        patient_id=patient_id,
        doctor_id=doctor_id,
        appointment_id=appointment_id,
        document_id=document_id,
        report_date=entry_date,
        report_content=entry_content,
        file_name=filename,
    )

Nothing else in the handwritten pipeline needs to change.
"""

import asyncio
import hashlib
import os
import time
from datetime import datetime, date
from typing import Dict, List, Optional, Union

from groq import Groq
from loguru import logger
from pymongo import MongoClient

# =====================================================================
# MONGO INITIALIZATION
# =====================================================================
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB_NAME = os.getenv("MONGO_DB")

sync_client = MongoClient(MONGO_URI)
db = sync_client[MONGO_DB_NAME]

# Owned entirely by this module.
visit_timeline_collection = db.visit_timeline

# NOTE: this collection stores ONE DOCUMENT PER PATIENT, with an
# `appointments` array inside it -- NOT one document per appointment.
#
#   {
#       "patient_id": "...",
#       "appointments": [
#           {"appointment_id": "...", "date": "2025-01-10"},
#           {"appointment_id": "...", "date": "2025-02-15"},
#       ]
#   }
#
# Used ONLY to determine visit boundaries.
appointments_collection = db.patient_appointments


# =====================================================================
# GROQ INITIALIZATION
# =====================================================================
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = "llama-3.3-70b-versatile"

groq_client = Groq(api_key=GROQ_API_KEY)


# =====================================================================
# RETRY HELPER
# =====================================================================
def _with_retry(max_attempts: int = 3, base_delay: float = 2.0):
    """Simple exponential-ish backoff retry decorator for flaky network calls."""

    def decorator(fn):
        def wrapper(*args, **kwargs):
            last_exc = None
            for attempt in range(1, max_attempts + 1):
                try:
                    return fn(*args, **kwargs)
                except Exception as exc:  # noqa: BLE001
                    last_exc = exc
                    logger.warning(
                        f"{fn.__name__} attempt {attempt}/{max_attempts} failed: {exc}"
                    )
                    if attempt < max_attempts:
                        time.sleep(base_delay * attempt)
            logger.error(f"{fn.__name__} exhausted all {max_attempts} retries: {last_exc}")
            raise last_exc

        return wrapper

    return decorator


# =====================================================================
# LLM CALL (Groq only -- no OpenRouter, no GPT-4o)
# =====================================================================
@_with_retry(max_attempts=3, base_delay=2.0)
def _call_groq_text(prompt: str, temperature: float = 0.2, max_tokens: int = 600) -> str:
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not set")

    response = groq_client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=temperature,
        max_tokens=max_tokens,
    )

    try:
        text = response.choices[0].message.content
    except (AttributeError, IndexError) as e:
        raise RuntimeError(f"Unexpected Groq response shape: {response}") from e

    return (text or "").strip()


# =====================================================================
# PROMPTS
# =====================================================================
REPORT_SUMMARY_PROMPT = """You are a clinical documentation assistant.

Below is a single clinical report. Write ONE short clinical narrative
paragraph (2-4 sentences) summarizing it, using ONLY the information
explicitly present in the report content below.

=== REPORT DATE ===
{report_date}

=== REPORT CONTENT ===
{content}

STRICT GROUNDING RULES (follow all of these):
* Use ONLY facts, values, findings, diagnoses, medications, and procedures
  that are explicitly stated in the REPORT CONTENT above.
* Do NOT use any outside medical knowledge, clinical guidelines, typical
  disease patterns, or general reasoning to fill gaps, explain causes,
  predict outcomes, or add context not present in the text.
* Do NOT infer a diagnosis, severity, or interpretation that is not
  directly stated in the report, even if it seems clinically obvious.
* Do NOT invent, estimate, or normalize any values, dates, units, or
  ranges that are missing or unclear in the source text.
* Do NOT include information about any other report, visit, or prior
  history -- this summary reflects ONLY the single report provided above.

ADMINISTRATIVE / METADATA EXCLUSION RULES:
* Ignore all administrative or system metadata, including but not limited
  to: patient IDs, doctor/provider IDs, document IDs, UUIDs, database keys,
  record numbers, timestamps, file names, system-generated codes, or
  processing/ingestion metadata.
* Do NOT mention any identifiers (e.g., PAT-xxxx, DOC-xxxx), database keys,
  or system-generated values anywhere in the summary, even in passing.
* Focus exclusively on the CLINICAL content of the report -- findings,
  diagnoses, medications, procedures, symptoms, and clinical values.
* If the report contains ONLY administrative/system information and no
  actual clinical content, do not attempt to write a clinical paragraph.
  Instead, return exactly this sentence and nothing else:
  "No clinical information available in this report."

FORMATTING RULES:
* Do NOT return bullet points, headers, lists, or JSON -- prose only.
* Be concise and clinically precise (state findings, values, diagnoses,
  medications, and procedures exactly as described in the report,
  paraphrased only for readability, not reinterpreted).

Return only the paragraph, nothing else.
"""


# NOTE: the visit summary is updated from the RAW report content, not from
# the (separately generated) report_summary above.
VISIT_SUMMARY_UPDATE_PROMPT = """You are a clinical documentation assistant.

Previous Visit Summary
{previous_summary}

New Report Content
{report_content}

Update the visit summary by incorporating the new report into the existing
summary, using ONLY information present in the two sources above.

STRICT GROUNDING RULES (follow all of these):
* Use ONLY the "Previous Visit Summary" and "New Report Content" provided
  above as your source of truth. Do NOT use outside medical knowledge,
  general clinical assumptions, or information from any other source.
* Do NOT invent, infer, or assume any diagnosis, value, medication,
  finding, or clinical event that is not explicitly stated in either
  source.
* Do NOT reintroduce or add anything from general medical knowledge to
  "complete" or "explain" a finding -- if something is unclear or
  incomplete in the source text, leave it as stated rather than filling
  in the gap.

ADMINISTRATIVE / METADATA EXCLUSION RULES:
* Ignore all administrative or system metadata in the new report content,
  including but not limited to: patient IDs, doctor/provider IDs, document
  IDs, UUIDs, database keys, record numbers, timestamps, file names,
  system-generated codes, or processing/ingestion metadata.
* Do NOT mention any identifiers (e.g., PAT-xxxx, DOC-xxxx), database keys,
  or system-generated values anywhere in the updated summary.
* If the previous visit summary already contains such identifiers, remove
  them during this update rather than carrying them forward.
* Focus exclusively on the CLINICAL content -- findings, diagnoses,
  medications, procedures, symptoms, and clinical values.

MERGE / PRESERVATION RULES:
* Preserve ALL clinically significant information from the previous
  summary unless it is clearly and explicitly superseded or corrected by
  the new report content.
* Never remove or alter confirmed diagnoses, chronic conditions,
  allergies, surgeries, procedures, medications, abnormal findings,
  important laboratory or imaging results, or significant clinical
  events unless the new report explicitly contradicts or updates them.
* If the new report updates or corrects previous information, keep only
  the latest accurate information and drop the outdated version -- do
  not keep both if they conflict.
* Merge repeated or overlapping information instead of duplicating it.
* Compress only redundant narrative or repetitive wording; do NOT omit
  clinically relevant facts in the process of compressing.
* Prioritize active problems, current treatment, ongoing investigations,
  and the latest clinical status.

HANDLING NON-CLINICAL NEW REPORTS:
* If, after excluding administrative/system metadata, the New Report
  Content contains NO clinical information, do NOT alter the clinical
  substance of the Previous Visit Summary because of this report.
* In that case, return the Previous Visit Summary unchanged, except for
  removing any administrative/system identifiers if present (per the
  metadata exclusion rules above).
* Only return the sentence "No clinical information available in this
  report." if BOTH the Previous Visit Summary and the New Report Content
  contain no clinical information at all once metadata is excluded.

OUTPUT RULES:
* Keep the final summary concise (maximum 500 words or approximately
  3000 characters).
* Return ONLY one coherent clinical paragraph representing the complete
  updated visit summary -- no bullet points, headers, or JSON.

Return only the paragraph, nothing else.
"""


# =====================================================================
# REPORT SUMMARY (single report, no history) -- for timeline display only
# =====================================================================
def generate_report_summary(report_content: str, report_date: str) -> str:
    """One narrative paragraph summarizing ONLY the given report_content."""
    prompt = REPORT_SUMMARY_PROMPT.format(report_date=report_date, content=report_content)
    try:
        return _call_groq_text(prompt, temperature=0.2, max_tokens=350)
    except Exception as e:  # noqa: BLE001
        logger.error(f"Report summary generation failed for report_date={report_date}: {e}")
        return "Summary unavailable due to a processing error."


# =====================================================================
# INCREMENTAL VISIT SUMMARY (from raw report content, not report_summary)
# =====================================================================
def generate_updated_visit_summary(previous_visit_summary: str, report_content: str) -> str:
    """
    Folds the NEW REPORT's raw content into the existing visit summary.
    Returns the COMPLETE updated visit summary text.
    """
    prompt = VISIT_SUMMARY_UPDATE_PROMPT.format(
        previous_summary=previous_visit_summary, report_content=report_content
    )
    try:
        return _call_groq_text(prompt, temperature=0.2, max_tokens=600)
    except Exception as e:  # noqa: BLE001
        logger.error(f"Visit summary update failed: {e}")
        # Fail safe: keep the previous summary rather than losing it.
        return previous_visit_summary


# =====================================================================
# DATE PARSING
# =====================================================================
def _parse_date(value: Optional[Union[str, date, datetime]]) -> Optional[date]:
    """Best-effort parse of a date-ish value into a plain `date`."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value).date()
        except Exception:  # noqa: BLE001
            logger.warning(f"Could not parse date string: {value!r}")
            return None
    return None


# =====================================================================
# VISIT DETERMINATION
# =====================================================================
def _get_patient_appointments(patient_id: str) -> List[dict]:
    """
    Fetches the SINGLE patient document and flattens its `appointments`
    array, sorted ascending by date.

    Does NOT assume one Mongo document per appointment -- `patient_appointments`
    stores one document per PATIENT with an embedded `appointments` array.
    """
    patient_doc = appointments_collection.find_one({"sys_user_id": patient_id})
    if not patient_doc:
        return []

    raw_appointments = patient_doc.get("appointments") or []

    def sort_key(a: dict):
        d = _parse_date(a.get("date"))
        return d or date.min

    return sorted(raw_appointments, key=sort_key)


def _determine_visit(
    patient_id: str,
    fallback_appointment_id: str,
    report_date: Optional[str],
) -> Dict:
    """
    Works out which visit a report belongs to, using appointment date
    ranges. Works for unlimited appointments -- nothing hardcoded.

        Visit i:
            start = appointment_date[i]           (own appointment date)
            end   = appointment_date[i+1]          (next appointment, exclusive)
                     or +infinity if there is no next appointment

        Exception: Visit 1 additionally absorbs any report dated BEFORE
        appointment_date[0] (i.e. its effective start is -infinity).

        A report belongs to visit i when:
            report_date >= start   (except visit 1, which also takes
                                     anything before appointment_date[0])
            AND
            report_date < end

    Example (appointment1=2025-01-10, appointment2=2025-02-15):
        01-08, 01-09, 01-10, 01-11, 02-14  -> Visit 1  (all < 02-15)
        02-15, 02-16, 03-01                -> Visit 2  (own appt date
                                                          belongs to its
                                                          own visit)

    Returns a dict with: appointment_id, visit_number, appointment_date,
    visit_start_date, visit_end_date -- all as ISO strings or None.
    """
    appts = _get_patient_appointments(patient_id)
    report_dt = _parse_date(report_date)

    if not appts or report_dt is None:
        # Degrade gracefully: no appointment schedule to bucket against,
        # so trust whatever appointment context the caller passed in.
        logger.warning(
            f"No appointment schedule / report_date available for patient_id={patient_id}; "
            f"falling back to caller-provided appointment_id={fallback_appointment_id}"
        )
        return {
            "appointment_id": fallback_appointment_id,
            "visit_number": 1,
            "appointment_date": None,
            "visit_start_date": None,
            "visit_end_date": None,
        }

    parsed_dates = [_parse_date(a.get("date")) for a in appts]

    chosen_index = len(appts) - 1  # default: last visit, covers +infinity tail
    for i, appt_date in enumerate(parsed_dates):
        if appt_date is None:
            continue

        next_date = parsed_dates[i + 1] if i + 1 < len(parsed_dates) else None

        if i == 0 and report_dt < appt_date:
            # Anything before the very first appointment still belongs to visit 1.
            chosen_index = 0
            break

        if report_dt >= appt_date and (next_date is None or report_dt < next_date):
            chosen_index = i
            break

    chosen_appt = appts[chosen_index]
    visit_start = parsed_dates[chosen_index]
    visit_end = (
        parsed_dates[chosen_index + 1] if chosen_index + 1 < len(parsed_dates) else None
    )

    return {
        "appointment_id": chosen_appt.get("appointment_id", fallback_appointment_id),
        "visit_number": chosen_index + 1,
        "appointment_date": visit_start.isoformat() if visit_start else None,
        "visit_start_date": visit_start.isoformat() if visit_start else None,
        "visit_end_date": visit_end.isoformat() if visit_end else None,
    }


# =====================================================================
# DUPLICATE PREVENTION
# =====================================================================
def _compute_timeline_entry_id(document_id: str, report_date: str, report_content: str) -> str:
    """
    A report date alone is not unique -- one document can legitimately
    contain multiple entries for the same date. Fingerprint on content too,
    so the same (document, date) pair with different content is still
    accepted, while an exact re-processing of the same content is not.
    """
    content_hash = hashlib.sha256((report_content or "").encode("utf-8")).hexdigest()
    return f"{document_id}:{report_date}:{content_hash}"


def _is_duplicate_entry(existing_doc: Optional[dict], timeline_entry_id: str) -> bool:
    if not existing_doc:
        return False
    for entry in existing_doc.get("timeline", []):
        if entry.get("timeline_entry_id") == timeline_entry_id:
            return True
    return False


# =====================================================================
# SYNC CORE (wrapped by the async entry point via a thread)
# =====================================================================
def _build_timeline_incremental_sync(
    patient_id: str,
    doctor_id: str,
    appointment_id: str,
    document_id: str,
    report_date: str,
    report_content: str,
    file_name: str,
) -> Optional[dict]:
    if not report_content or not report_content.strip():
        logger.warning(
            f"Empty report_content for document_id={document_id}, report_date={report_date}; skipping."
        )
        return None

    visit_info = _determine_visit(patient_id, appointment_id, report_date)
    visit_appointment_id = visit_info["appointment_id"]

    existing_doc = visit_timeline_collection.find_one(
        {"patient_id": patient_id, "appointment_id": visit_appointment_id}
    )

    timeline_entry_id = _compute_timeline_entry_id(document_id, report_date, report_content)

    if _is_duplicate_entry(existing_doc, timeline_entry_id):
        logger.info(
            f"Duplicate timeline entry skipped: timeline_entry_id={timeline_entry_id}, "
            f"appointment_id={visit_appointment_id}"
        )
        return existing_doc

    # Report summary is generated for timeline display ONLY.
    report_summary = generate_report_summary(report_content, report_date)

    timeline_entry = {
        "timeline_entry_id": timeline_entry_id,
        "report_date": report_date,
        "document_id": document_id,
        "file_name": file_name,
        "report_content": report_content,
        "report_summary": report_summary,
    }

    now = datetime.utcnow()

    if existing_doc is None:
        # First report for this visit -- visit_summary starts as the report summary.
        new_doc = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "appointment_id": visit_appointment_id,
            "visit_number": visit_info["visit_number"],
            "appointment_date": visit_info["appointment_date"],
            "visit_start_date": visit_info["visit_start_date"],
            "visit_end_date": visit_info["visit_end_date"],
            "timeline": [timeline_entry],
            "visit_summary": report_summary,
            "latest_report_summary": report_summary,
            "created_at": now,
            "updated_at": now,
        }
        try:
            visit_timeline_collection.update_one(
                {"patient_id": patient_id, "appointment_id": visit_appointment_id},
                {"$setOnInsert": new_doc},
                upsert=True,
            )
            logger.info(
                f"visit_timeline created for appointment_id={visit_appointment_id} "
                f"(patient_id={patient_id}, visit_number={visit_info['visit_number']})"
            )
        except Exception as e:  # noqa: BLE001
            logger.error(f"Failed to create visit_timeline for appointment_id={visit_appointment_id}: {e}")
            raise
        return new_doc

    # Visit already exists -- fold the new REPORT CONTENT (not report_summary)
    # into the existing visit summary.
    previous_visit_summary = existing_doc.get("visit_summary") or report_summary
    updated_visit_summary = generate_updated_visit_summary(previous_visit_summary, report_content)

    try:
        visit_timeline_collection.update_one(
            {"patient_id": patient_id, "appointment_id": visit_appointment_id},
            {
                "$push": {"timeline": timeline_entry},
                "$set": {
                    "visit_summary": updated_visit_summary,
                    "latest_report_summary": report_summary,
                    "updated_at": now,
                    # Keep visit boundary metadata fresh in case the appointment
                    # schedule changed (e.g. a next appointment was booked since).
                    "appointment_date": visit_info["appointment_date"],
                    "visit_start_date": visit_info["visit_start_date"],
                    "visit_end_date": visit_info["visit_end_date"],
                },
            },
            upsert=True,
        )
        logger.info(
            f"visit_timeline updated for appointment_id={visit_appointment_id} "
            f"(patient_id={patient_id}, +1 timeline entry)"
        )
    except Exception as e:  # noqa: BLE001
        logger.error(f"Failed to update visit_timeline for appointment_id={visit_appointment_id}: {e}")
        raise

    return visit_timeline_collection.find_one(
        {"patient_id": patient_id, "appointment_id": visit_appointment_id}
    )


# =====================================================================
# ASYNC ENTRY POINT
# =====================================================================
async def build_timeline_incremental(
    patient_id: str,
    doctor_id: str,
    appointment_id: str,
    document_id: str,
    report_date: str,
    report_content: str,
    file_name: str,
) -> Optional[dict]:
    """
    Incrementally updates (or creates) the visit_timeline document that
    `report_content` belongs to.

    Called exactly once per newly extracted date-wise report. Reads NOTHING
    from `processed_documents` and never regenerates prior summaries -- it
    only summarizes `report_content` for display, and separately folds the
    RAW report_content into whatever visit_summary is already stored.
    """
    try:
        return await asyncio.to_thread(
            _build_timeline_incremental_sync,
            patient_id,
            doctor_id,
            appointment_id,
            document_id,
            report_date,
            report_content,
            file_name,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(
            f"build_timeline_incremental failed for document_id={document_id}, "
            f"appointment_id={appointment_id}, patient_id={patient_id}: {exc}"
        )
        raise