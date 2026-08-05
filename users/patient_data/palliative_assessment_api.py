"""
palliative_assessment_api.py
─────────────────────────────────────────────────────────────────────────────
NCG-KCDO Palliative Medicine Assessment Module (v2.0) — backend routes.

Powers PalliativeAssessmentForm.jsx (and the read-only
PalliativeAssessmentSummary.jsx). Mirrors the pain-management route naming
convention 1:1, with "pain-management" swapped for "palliative-assessment",
per the original component's docstring.

ROUTES IN THIS FILE
---------------------
  GET  /palliative-assessment/patient-context/{patient_id}/{doctor_id}
       (treatment_history falls back to an LLM synthesis over raw records
        when patient_summary has nothing structured — see ASSUMPTION #6)
  GET  /palliative-assessment/investigations-summary/{patient_id}/{doctor_id}
  GET  /palliative-assessment/latest-medications/{patient_id}/{doctor_id}
       (falls back to the same raw-record synthesis when
        documentation-medication-analysis has nothing usable — see
        ASSUMPTION #7)
  POST /palliative-assessment/extract-fields
  POST /palliative-assessment/upload-referral-letter
  POST /palliative-assessment/save
  GET  /palliative-assessment/history/{patient_id}/{doctor_id}

NOT included here (out of scope for this file):
  - /pain-management/*  — the sibling module this mirrors; left untouched.
  - Voice transcription (ElevenLabs) — that's a separate shared route the
    frontend already calls directly (TRANSCRIBE_URL), not palliative-specific.

⚠️ ASSUMPTIONS MADE WHILE ASSEMBLING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. ROUTER MOUNT: this router declares `prefix="/context"`, matching
     patientcontext.py's own convention exactly
     (`APIRouter(prefix="/context", tags=["doctor"], ...)`). The outer
     gateway/proxy in front of this FastAPI app already prepends
     "/api/hms/users/data" to every incoming request before it reaches
     FastAPI, so FastAPI itself only ever sees paths starting with
     "/context/...". Using the full "/hms/users/data/context" prefix here
     (an earlier version of this file did) causes every route to 404,
     since FastAPI never matches it against the real incoming path.
     Mount this the same way as patientcontext_router — just import and
     `app.include_router(palliative_router)` in main.py.

  2. COLLECTION NAMES — inferred from docstrings/field references in the
     code you shared, not confirmed against a live schema dump:
       - diagnosis_data_collection              -> "diagnosis_data"
       - tumor_board_collection                 -> "tumor_board_cases"
       - summary_collection                     -> "patient_summary"
       - documentation_investigation_notes_collection
                                                 -> "documentation-investigation-notes"
       - documentation_medication_analysis_collection
                                                 -> "documentation-medication-analysis"
       - palliative_assessment_collection        -> "palliative_assessment"
     If any of these differ from your actual Mongo collection names, this
     file will silently return empty fields (all lookups are wrapped in
     try/except and degrade to "" rather than raising) — worth verifying
     with a quick `db.<name>.findOne()` before relying on it in prod.

  3. REFERRAL LETTER `file_id`: the frontend's `uploadReferralLetter()`
     reads `json.file_id`, but the upload logic you shared only returns
     `file_url` / `storage_path` / `filename` (no `file_id`). I generated
     one with `uuid.uuid4()` and included it in the response so the
     frontend doesn't break. If your storage service actually returns an
     ID (e.g. inside `upload_result`), swap this generated one for that
     instead — a client-generated ID won't match anything on the storage
     side, so it's only useful for the frontend's own bookkeeping /
     "View uploaded file" link.

  4. LATEST MEDICATIONS ROUTE: earlier you showed a `/pain-management/
     latest-medications/{patient_id}/{doctor_id}` endpoint as reference
     context ("identical logic/prompt"). That one is NOT duplicated in
     this file — only the palliative-specific
     `/palliative-assessment/latest-medications/...` version is included,
     since that's the one PalliativeAssessmentForm.jsx's `LATEST_MEDS_URL`
     actually calls.

  5. SYNCHRONOUS `requests` IN AN ASYNC ROUTE (`upload_referral_letter`):
     kept as `requests.post(...)` (blocking) rather than converting to
     `httpx.AsyncClient`, since that's exactly how it was given to me and
     presumably matches an existing `case_documents.py` helper elsewhere
     in your codebase. This blocks the event loop for the duration of the
     upload. If `case_documents.py`'s `advanced_upload_document` actually
     uses `httpx` async under the hood, tell me and I'll convert this to
     match it exactly instead.

  6. TREATMENT HISTORY LLM FALLBACK: when `patient_summary.
     section_3_treatment_history` is empty (confirmed to be the case for
     at least one real patient), `get_palliative_patient_context` now
     falls back to gathering raw records from:
       - documentation-treatment-plan   (patient_id)
       - chemotherapy_records           (patientId — camelCase, per
                                          get_oncology_records in
                                          surgical_oncology_api.py)
       - radiotherapy_records           (patientId — same as above)
       - surgical_oncology              (patient_id, booking sub-doc)
       - tumor_board_cases.doctor_recommendation (reused, already fetched
                                          for last_mdt_notes)
     ...and asking the LLM to synthesize a `treatment_history` string from
     whatever's actually present. If NONE of these sources have data
     either, the field stays "" — no LLM call is made in that case (saves
     a wasted API call). Collection/field names here carry the same
     "not verified against a live schema" caveat as item #2 above —
     confirm `chemotherapy_records` / `radiotherapy_records` really do key
     on `patientId` (not `patient_id`) for your data before relying on
     this in prod.

  7. LATEST MEDICATIONS LLM FALLBACK: same root-cause pattern as #6 —
     when documentation-medication-analysis has no prescription record for
     this patient, `get_palliative_latest_medications` now calls
     `_llm_fallback_ongoing_medications`, which reuses the same raw-source
     gathering as the treatment_history fallback
     (`_gather_raw_treatment_sources`) and asks the LLM to pull any
     medication mentions out of those sources (chemo drug names/doses,
     medications named in a treatment plan or MDT note). If none of those
     sources mention a medication either, the field stays "" — same
     "don't invent" rule as everywhere else in this file. This fallback is
     wired into BOTH early-return points: no
     documentation-medication-analysis record at all, and a record that
     exists but has no real (non-empty) prescriptions.
─────────────────────────────────────────────────────────────────────────
"""

import os
import json
import uuid
import logging
from datetime import datetime
from typing import Optional

import requests
from fastapi import APIRouter, HTTPException, UploadFile, File as FastAPIFile, Form
from motor.motor_asyncio import AsyncIOMotorClient
from groq import Groq

logger = logging.getLogger(__name__)

# ─── Mongo setup ────────────────────────────────────────────────────────────
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    diagnosis_data_collection = database["diagnosis_data"]
    tumor_board_collection = database["tumor_board_cases"]
    summary_collection = database["patient_summary"]
    documentation_investigation_notes_collection = database["documentation-investigation-notes"]
    documentation_medication_analysis_collection = database["documentation-medication-analysis"]
    palliative_assessment_collection = database["palliative_assessment"]

    # Raw treatment-history fallback sources (used only when
    # patient_summary.section_3_treatment_history has nothing usable —
    # see _gather_raw_treatment_sources below). Names/field conventions
    # match what surgical_oncology_api.py already queries:
    #   - chemotherapy_records / radiotherapy_records key on "patientId"
    #     (camelCase), not "patient_id" — confirmed via get_oncology_records.
    #   - surgical_oncology keys on "patient_id" with booking data nested
    #     under doc["booking"].
    documentation_treatment_plan_collection = database["documentation-treatment-plan"]
    chemotherapy_records_collection = database["chemotherapy_records"]
    radiotherapy_records_collection = database["radiotherapy_records"]
    surgical_oncology_collection = database["surgical_oncology"]
except Exception as e:
    logger.error(f"Error initializing MongoDB in palliative_assessment_api: {e}")

# ─── Storage / Groq setup ───────────────────────────────────────────────────
STORAGE_BASE_URL = os.getenv("STORAGE_BASE_URL")

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client: Optional[Groq] = None
try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        logger.warning("GROQ_API_KEY not set — palliative LLM endpoints will fail at call time.")
except Exception as e:
    logger.error(f"Error initializing Groq client in palliative_assessment_api: {e}")

# Matches patientcontext.py's own router convention exactly:
# router = APIRouter(prefix="/context", tags=["doctor"], responses={...})
# The outer gateway/proxy already prepends "/api/hms/users/data" before the
# request reaches this FastAPI app, so internally we only need "/context" —
# NOT the full "/hms/users/data/context". That's what caused every palliative
# endpoint to 404: this router was registering paths FastAPI itself never
# matched against the real incoming request path.
router = APIRouter(prefix="/context", tags=["Palliative Assessment"])


# ═════════════════════════════════════════════════════════════════════════════
# 1. PATIENT CONTEXT (auto-fill for section 1: diagnosis, MDT notes, tx history)
# ═════════════════════════════════════════════════════════════════════════════

def _format_treatment_history(section_3: dict) -> str:
    """
    Collapse patient_summary.section_3_treatment_history into a short
    human-readable line(s) for the palliative assessment's free-text field.
    """
    if not section_3:
        return ""

    parts = []

    for t in section_3.get("current_active_treatments", []):
        line = f"{t.get('treatment', '')} (ongoing"
        if t.get("started"):
            line += f", started {t['started']}"
        line += ")"
        if t.get("for_condition"):
            line += f" for {t['for_condition']}"
        parts.append(line.strip())

    for t in section_3.get("completed_treatments_current_case", []):
        line = f"{t.get('treatment', '')} (completed"
        if t.get("period"):
            line += f", {t['period']}"
        line += f", outcome: {t.get('outcome', 'unknown')})"
        parts.append(line.strip())

    for t in section_3.get("historical_treatments_past_cases", []):
        line = f"{t.get('treatment', '')} — prior case ({t.get('period', '')})"
        if t.get("relevance_now"):
            line += f"; {t['relevance_now']}"
        parts.append(line.strip())

    return " | ".join(p for p in parts if p.strip())


def _serialize_doc(doc: dict) -> dict:
    """Strip _id / convert datetimes so a raw Mongo doc is JSON-safe for an LLM prompt."""
    if not doc:
        return doc
    out = dict(doc)
    out.pop("_id", None)
    for k, v in list(out.items()):
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
    return out


TREATMENT_HISTORY_SYNTHESIS_PROMPT = """
You are a clinical assistant. You will be given raw records from a cancer
patient's chart, pulled from several different clinical systems (surgical
bookings, chemotherapy records, radiotherapy records, a treatment-plan
documentation note, and/or a tumor board recommendation). Not all sources
will be present in every case — use whichever are given, and ignore any
that are null/empty.

Produce a JSON object with exactly one key:

- "treatment_history": a concise clinical summary (2-5 short lines,
  pipe-separated is fine) of the patient's cancer treatment history —
  surgeries performed (with dates if available), chemotherapy regimens and
  cycles, radiotherapy course and dose, and any documented treatment plan
  or MDT recommendation relevant to treatment. If none of the sources
  contain usable treatment information, return an empty string.

Rules:
- Do NOT invent treatments, dates, drug names, or outcomes not present in
  the input.
- Prefer specific dates, drug names, and procedure names over vague
  language (e.g. "FOLFOX x6 cycles, completed March 2025" rather than
  "received chemotherapy").
- Return valid JSON only — no markdown, no commentary.
"""


async def _gather_raw_treatment_sources(patient_id: str) -> dict:
    """
    Fallback data-gathering for treatment_history when
    patient_summary.section_3_treatment_history is empty/missing.
    Pulls whatever exists across documentation-treatment-plan,
    chemotherapy_records, radiotherapy_records, surgical_oncology bookings,
    and the tumor board recommendation (reusing the same latest-doc pattern
    as elsewhere in this file). Every lookup is independently wrapped —
    a failure on one source just omits it, never raises.

    Also reused by the latest-medications fallback (see #7 in the module
    docstring), since these same raw sources can legitimately mention
    medications even without a dedicated prescription record.
    """
    sources = {}

    try:
        doc = await documentation_treatment_plan_collection.find_one(
            {"patient_id": patient_id}, sort=[("updated_at", -1)]
        )
        if doc:
            sources["documentation_treatment_plan"] = _serialize_doc(doc)
    except Exception as e:
        logger.warning(f"Treatment history fallback: documentation-treatment-plan lookup failed for {patient_id}: {e}")

    try:
        doc = await chemotherapy_records_collection.find_one(
            {"patientId": patient_id}, sort=[("updatedAt", -1)]
        )
        if doc:
            sources["chemotherapy_records"] = _serialize_doc(doc)
    except Exception as e:
        logger.warning(f"Treatment history fallback: chemotherapy_records lookup failed for {patient_id}: {e}")

    try:
        doc = await radiotherapy_records_collection.find_one(
            {"patientId": patient_id}, sort=[("updatedAt", -1)]
        )
        if doc:
            sources["radiotherapy_records"] = _serialize_doc(doc)
    except Exception as e:
        logger.warning(f"Treatment history fallback: radiotherapy_records lookup failed for {patient_id}: {e}")

    try:
        cursor = surgical_oncology_collection.find({"patient_id": patient_id}).sort("created_at", -1).limit(5)
        bookings = []
        async for b in cursor:
            bk = b.get("booking", {}) or {}
            bookings.append({
                "procedure": bk.get("procedureName", ""),
                "date": bk.get("surgeryDate", ""),
                "surgeon": bk.get("treatingDoctor", ""),
                "status": b.get("status", ""),
            })
        if bookings:
            sources["surgical_oncology_bookings"] = bookings
    except Exception as e:
        logger.warning(f"Treatment history fallback: surgical_oncology lookup failed for {patient_id}: {e}")

    try:
        doc = await tumor_board_collection.find_one(
            {"patient_id": patient_id}, sort=[("created_at", -1)]
        )
        if doc and doc.get("doctor_recommendation"):
            sources["tumor_board_recommendation"] = doc.get("doctor_recommendation")
    except Exception as e:
        logger.warning(f"Treatment history fallback: tumor_board_cases lookup failed for {patient_id}: {e}")

    return sources


async def _llm_synthesize_treatment_history(sources: dict) -> str:
    """Ask the LLM to turn whatever raw sources exist into one treatment_history string."""
    if not sources:
        return ""
    if groq_client is None:
        logger.warning("Treatment history LLM synthesis skipped — GROQ_API_KEY not configured.")
        return ""
    try:
        completion = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": TREATMENT_HISTORY_SYNTHESIS_PROMPT},
                {"role": "user", "content": json.dumps(sources, indent=2, default=str)},
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )
        raw_content = completion.choices[0].message.content
        parsed = json.loads(raw_content)
        if isinstance(parsed, dict):
            return parsed.get("treatment_history") or ""
    except (json.JSONDecodeError, TypeError) as e:
        logger.error(f"Treatment history LLM synthesis returned non-JSON: {e}")
    except Exception as e:
        logger.warning(f"Treatment history LLM synthesis failed: {e}")
    return ""


@router.get("/palliative-assessment/patient-context/{patient_id}/{doctor_id}")
async def get_palliative_patient_context(patient_id: str, doctor_id: str):
    """
    Auto-fill for Palliative Assessment section 1.

    Sources (confirmed against real collections):
      - cancer_diagnosis   <- diagnosis_data (latest by created_at, this patient)
      - last_mdt_notes     <- tumor_board_cases.doctor_recommendation
                              (latest single specialist submission, per patient,
                              across all specialties — matches "1st latest doctor
                              submitted" as confirmed)
      - treatment_history  <- patient_summary.section_3_treatment_history
                              (structured, current — replaces the old broken
                              documentation-treatment-plan.procedure_steps lookup)

    Never raises — any individual lookup failure just leaves that field blank.
    """
    result = {"cancer_diagnosis": "", "last_mdt_notes": "", "treatment_history": ""}

    # ── Cancer diagnosis — latest diagnosis_data entry ─────────────────────
    try:
        diagnosis_doc = await diagnosis_data_collection.find_one(
            {"patient_id": patient_id},
            sort=[("created_at", -1)],
        )
        if diagnosis_doc:
            result["cancer_diagnosis"] = diagnosis_doc.get("diagnosis") or ""
    except Exception as e:
        logger.warning(f"Palliative context: diagnosis lookup failed for {patient_id}: {e}")

    # ── Last MDT notes — latest doctor's submitted tumor board opinion ─────
    try:
        mdt_doc = await tumor_board_collection.find_one(
            {"patient_id": patient_id},
            sort=[("created_at", -1)],
        )
        if mdt_doc:
            result["last_mdt_notes"] = mdt_doc.get("doctor_recommendation") or ""
    except Exception as e:
        logger.warning(f"Palliative context: MDT notes lookup failed for {patient_id}: {e}")

    # ── Treatment history — from patient_summary, not treatment-plan ───────
    try:
        summary_doc = await summary_collection.find_one(
            {"patient_id": patient_id},
            sort=[("updated_at", -1)],
        )
        if summary_doc:
            section_3 = (summary_doc.get("patient_summary") or {}).get(
                "section_3_treatment_history"
            ) or {}
            result["treatment_history"] = _format_treatment_history(section_3)
    except Exception as e:
        logger.warning(f"Palliative context: treatment history lookup failed for {patient_id}: {e}")

    # ── Fallback: patient_summary had nothing usable — synthesize from raw
    #    treatment records (documentation-treatment-plan, chemotherapy_records,
    #    radiotherapy_records, surgical_oncology bookings, tumor board
    #    recommendation) via LLM instead of leaving the field blank.
    if not result["treatment_history"]:
        try:
            raw_sources = await _gather_raw_treatment_sources(patient_id)
            if raw_sources:
                result["treatment_history"] = await _llm_synthesize_treatment_history(raw_sources)
        except Exception as e:
            logger.warning(f"Palliative context: treatment history LLM fallback failed for {patient_id}: {e}")

    return {"status": "success", "data": result}


# ═════════════════════════════════════════════════════════════════════════════
# 2. INVESTIGATIONS SUMMARY (reference text for section 1 + section 7)
# ═════════════════════════════════════════════════════════════════════════════

def _format_investigations_summary(section_2: dict) -> str:
    if not section_2:
        return ""
    parts = []

    pending = section_2.get("pending_investigations") or []
    if pending:
        parts.append(f"Pending: {', '.join(pending)}")

    for lab in (section_2.get("recent_labs") or [])[:3]:
        parts.append(f"{lab.get('test','')} ({lab.get('date','')}): {lab.get('result','')}")

    for img in (section_2.get("recent_imaging") or [])[:3]:
        parts.append(f"{img.get('modality','')} {img.get('site','')} ({img.get('date','')}): {img.get('key_finding','')}")

    for path in (section_2.get("recent_pathology") or [])[:3]:
        parts.append(f"{path.get('test','')} {path.get('site','')} ({path.get('date','')}): {path.get('result','')}")

    return " | ".join(p for p in parts if p.strip())


def _format_investigation_orders(orders: list) -> str:
    if not orders:
        return ""
    return " | ".join(
        f"{o.get('investigation_name','')} ({o.get('priority','Routine')}) — {o.get('standard_indications','')}"
        for o in orders[:8]
    )


@router.get("/palliative-assessment/investigations-summary/{patient_id}/{doctor_id}")
async def get_palliative_investigations_summary(patient_id: str, doctor_id: str):
    """
    Reference text for the Investigations field(s) in the Palliative
    Assessment form (section 1 and section 7). Primary source is the
    pre-digested patient_summary.section_2_investigations_summary; falls
    back to the raw documentation-investigation-notes order list if no
    summary exists yet.
    """
    text = ""
    try:
        summary_doc = await summary_collection.find_one(
            {"patient_id": patient_id},
            sort=[("updated_at", -1)],
        )
        section_2 = (summary_doc or {}).get("patient_summary", {}).get(
            "section_2_investigations_summary"
        )
        if section_2:
            text = _format_investigations_summary(section_2)
    except Exception as e:
        logger.warning(f"Investigations summary lookup failed for {patient_id}: {e}")

    if not text:
        try:
            inv_doc = await documentation_investigation_notes_collection.find_one(
                {"patient_id": patient_id},
                sort=[("created_at", -1)],
            )
            orders = (inv_doc or {}).get("finaloutput", {}).get("investigation_orders", [])
            text = _format_investigation_orders(orders)
        except Exception as e:
            logger.warning(f"Investigation orders fallback failed for {patient_id}: {e}")

    return {"status": "success", "finaloutput": {"investigations_text": text}}


# ═════════════════════════════════════════════════════════════════════════════
# 3. LATEST MEDICATIONS (auto-fill "Ongoing Medications" — section 7.E.i)
# ═════════════════════════════════════════════════════════════════════════════

ONGOING_MEDICATIONS_SUMMARY_PROMPT = """
You are a clinical assistant. You will be given a patient's most recent
prescriptions (from a Medication Analysis record) as JSON.

Produce a JSON object with exactly one key:

- "ongoing_medications": ONE-TO-TWO sentence free text summarizing the
  patient's current medications, including drug name(s), strength, and
  frequency where available. If the prescriptions list is empty or has
  no real data, return an empty string.

Rules:
- Do NOT invent medications not present in the input.
- Return valid JSON only — no markdown, no commentary.
"""

ONGOING_MEDICATIONS_FALLBACK_PROMPT = """
You are a clinical assistant. documentation-medication-analysis has NO
prescription record for this patient, so you're being given whatever raw
treatment records DO exist instead (surgical bookings, chemotherapy
records, radiotherapy records, a treatment-plan documentation note, and/or
a tumor board recommendation). Not all sources will be present — use
whichever are given, and ignore any that are null/empty.

Look through these for any mention of medications, drug regimens, or
prescribed treatment (e.g. chemotherapy drug names/doses, pain
medications mentioned in a treatment plan or MDT recommendation).

Produce a JSON object with exactly one key:

- "ongoing_medications": ONE-TO-TWO sentence free text summarizing any
  medications found in the sources above. If NONE of the sources mention
  any specific medication, return an empty string — do NOT guess or
  invent a plausible-sounding medication list.

Rules:
- Do NOT invent medications not explicitly present in the input.
- Chemotherapy drug regimens count as medications — include them if present.
- Return valid JSON only — no markdown, no commentary.
"""


async def _llm_fallback_ongoing_medications(patient_id: str) -> str:
    """
    Fallback for get_palliative_latest_medications when
    documentation-medication-analysis has nothing usable. Reuses the same
    raw-source gathering as the treatment_history fallback (see
    _gather_raw_treatment_sources above) since chemotherapy_records,
    documentation-treatment-plan, and the tumor board recommendation can
    all legitimately mention medications even without a dedicated
    prescription record.
    """
    try:
        raw_sources = await _gather_raw_treatment_sources(patient_id)
        if not raw_sources or groq_client is None:
            return ""
        completion = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": ONGOING_MEDICATIONS_FALLBACK_PROMPT},
                {"role": "user", "content": json.dumps(raw_sources, indent=2, default=str)},
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )
        raw_content = completion.choices[0].message.content
        parsed = json.loads(raw_content)
        if isinstance(parsed, dict):
            return parsed.get("ongoing_medications") or ""
    except (json.JSONDecodeError, TypeError) as e:
        logger.error(f"Ongoing medications fallback returned non-JSON: {e}")
    except Exception as e:
        logger.warning(f"Ongoing medications fallback failed for {patient_id}: {e}")
    return ""


@router.get("/palliative-assessment/latest-medications/{patient_id}/{doctor_id}")
async def get_palliative_latest_medications(patient_id: str, doctor_id: str):
    """
    Fetches the patient's most recent documentation-medication-analysis
    record and summarizes it into a short free-text line for the
    "Ongoing Medications" field (section 7.E.i).

    If documentation-medication-analysis has no record, or has no real
    prescriptions, falls back to _llm_fallback_ongoing_medications(), which
    scans the same raw treatment sources used by the treatment_history
    fallback (documentation-treatment-plan, chemotherapy_records,
    radiotherapy_records, surgical_oncology bookings, tumor board
    recommendation) for any mentioned medications before giving up and
    returning an empty string.

    Returns:
    {
        "status": "success",
        "finaloutput": { "currentMedicationsText": "..." }
    }

    NOTE: response key is "currentMedicationsText" (not "ongoing_medications")
    to match what PalliativeAssessmentForm.jsx reads — it looks for either
    finaloutput.currentMedicationsText or finaloutput.ongoing_medications,
    so this is compatible either way; kept consistent with the
    pain-management response shape for minimal frontend divergence.
    """
    if groq_client is None:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured on server")

    try:
        doc = await documentation_medication_analysis_collection.find_one(
            {"patient_id": patient_id},
            sort=[("created_at", -1)],
        )

        if not doc:
            fallback_text = await _llm_fallback_ongoing_medications(patient_id)
            return {"status": "success", "finaloutput": {"currentMedicationsText": fallback_text}}

        prescriptions = (doc.get("finaloutput") or {}).get("prescriptions") or []

        real_prescriptions = [
            p for p in prescriptions
            if any((p.get(k) or "").strip() for k in ["medication", "generic_name", "brand_name"])
        ]

        if not real_prescriptions:
            fallback_text = await _llm_fallback_ongoing_medications(patient_id)
            return {"status": "success", "finaloutput": {"currentMedicationsText": fallback_text}}

        prescriptions_text = json.dumps(real_prescriptions, indent=2, default=str)

        completion = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": ONGOING_MEDICATIONS_SUMMARY_PROMPT},
                {"role": "user", "content": prescriptions_text},
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )

        raw_content = completion.choices[0].message.content
        try:
            parsed = json.loads(raw_content)
        except (json.JSONDecodeError, TypeError):
            logger.error(f"Palliative ongoing medications summary returned non-JSON: {raw_content}")
            parsed = {}

        if not isinstance(parsed, dict):
            parsed = {}

        text = parsed.get("ongoing_medications") or ""

        return {
            "status": "success",
            "finaloutput": {"currentMedicationsText": text},
        }

    except Exception as e:
        logger.error(f"Palliative latest medications summary failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 4. EXTRACT FIELDS FROM DICTATION (Sections 2–7)
# ═════════════════════════════════════════════════════════════════════════════
ESAS_FIELD_KEYS = [
    "esas_pain", "esas_tiredness", "esas_drowsiness", "esas_nausea", "esas_appetite",
    "esas_breath", "esas_depression", "esas_anxiety", "esas_wellbeing",
    "esas_constipation", "esas_sleep", "esas_other",
]

ESAS_DETAILS_FIELD_KEYS = [f"{k}_details" for k in ESAS_FIELD_KEYS]

ECOG_ALLOWED = {"0", "1", "2", "3", "4"}
PPS_ALLOWED = {"100%", "90%", "80%", "70%", "60%", "50%", "40%", "30%", "20%", "10%", "0%"}
YES_NO_ALLOWED = {"Yes", "No"}
CONSCIOUSNESS_ALLOWED = {"Alert", "Vigilant", "Lethargic", "Stupor", "Coma"}

NUTRITION_ALLOWED = {"Orally", "Via NGT", "Via NJT", "Via PEG", "Via FJ", "TPN"}
ADL_ALLOWED = {"Dressing", "Ambulating", "Bathing", "Eating", "Transferring", "Toileting"}
PSYCHOSOCIAL_TOOLS_ALLOWED = {"NCCN-DT with problem checklist", "PHQ-9", "GAD 7"}
PROCEDURE_ALLOWED = {
    "Pleural Tapping", "Procedures for Pain relief", "Wound care", "Catheterisation",
    "IV Fluids", "NGT", "Paracentesis", "PM POCUS", "Others"
}
PM_POCUS_VIEWS_ALLOWED = {
    "Right lung base and right upper quadrant", "Right lower quadrant abdomen", "Subxiphoid cardiac view",
    "Left lung base and left upper abdomen", "Suprapubic Pelvic view",
    "Compression ultrasound of femoral vessels-Left", "Compression ultrasound of femoral vessels-Right"
}
GOALS_OF_CARE_KEYS = {
    "palliativeCareDisease", "palliativeCareOnly", "symptomManagement", "psychosocialCare",
    "respiteCare", "hospiceCare", "homeCare", "advancedCarePlanning", "eolc", "other"
}
PLACE_OF_CARE_KEYS = {"hospital", "hospice", "home"}
SOCIAL_SUPPORT_PLAN_KEYS = {"medicines", "travel", "equipment", "other"}

# Sanity ranges for dictated vitals
VITAL_RANGES = {
    "bp_systolic": (40, 260),
    "bp_diastolic": (20, 180),
    "pulse": (20, 250),
    "temperature": (85.0, 110.0),   # °F
    "respiratoryRate": (4, 60),
    "spo2": (30, 100),
}

PALLIATIVE_EXTRACT_FIELDS_PROMPT = f"""
You are a clinical assistant extracting structured Palliative Medicine Assessment data from a doctor's spoken/dictated clinical note for Sections 2 through 7 of the assessment form.

Return a JSON object with these optional keys — include a key ONLY if the dictation clearly states or implies a value for it. Never guess or invent a value that isn't stated.

SECTION 2 — PERFORMANCE SCALE:
  - "ecog": one of {sorted(ECOG_ALLOWED)}
  - "pps": one of {sorted(PPS_ALLOWED, key=lambda x: -int(x.rstrip('%')))}

SECTION 3 — ESAS-r NUMERIC SCORES (integer 0-10 each):
{json.dumps(ESAS_FIELD_KEYS)}
  - esas_pain: 0 = no pain, 10 = worst possible pain
  - esas_tiredness: 0 = no tiredness, 10 = worst possible tiredness
  - esas_drowsiness: 0 = no drowsiness, 10 = worst possible drowsiness
  - esas_nausea: 0 = no nausea, 10 = worst possible nausea
  - esas_appetite: 0 = no lack of appetite, 10 = worst possible lack of appetite
  - esas_breath: 0 = no shortness of breath, 10 = worst possible shortness of breath
  - esas_depression: 0 = no depression, 10 = worst possible depression
  - esas_anxiety: 0 = no anxiety, 10 = worst possible anxiety
  - esas_wellbeing: 0 = best wellbeing, 10 = worst possible wellbeing
  - esas_constipation: 0 = no constipation, 10 = worst possible constipation
  - esas_sleep: 0 = adequate sleep, 10 = worst possible loss of sleep
  - esas_other: 0 = no other problem, 10 = worst possible other problem

ESAS-r DETAIL NOTES (short free text, one per symptom above, suffix "_details"):
{json.dumps(ESAS_DETAILS_FIELD_KEYS)}

SECTION 4 — NURSING ASSESSMENT:
  - "bp_systolic": integer (mmHg)
  - "bp_diastolic": integer (mmHg)
  - "pulse": integer (beats/min)
  - "temperature": number (°F)
  - "respiratoryRate": integer (breaths/min)
  - "spo2": integer (%)
  - "tracheostomy": "Yes" or "No"
  - "stoma": short free text
  - "woundPressureInjury": short free text
  - "oralCavity": short free text
  - "oedema": short free text
  - "nutrition": list of matching strings from {sorted(NUTRITION_ALLOWED)}
  - "adl": list of matching strings from {sorted(ADL_ALLOWED)}
  - "primaryCaregiver": short free text (name, relation, contact)
  - "nursingOther": short free text

SECTION 5 — PSYCHOSOCIAL & SPIRITUAL ASSESSMENT:
  - "patientKnowsDiagnosis": "Yes" or "No"
  - "caregiverKnowsDiagnosis": "Yes" or "No"
  - "patientKnowsPrognosis": "Yes" or "No"
  - "caregiverKnowsPrognosis": "Yes" or "No"
  - "psychosocialTools": list of matching strings from {sorted(PSYCHOSOCIAL_TOOLS_ALLOWED)}
  - "psychosocialScores": object mapping tool name to {{"score": number, "notes": string}}
  - "socialSupport": "Yes" or "No"
  - "socialSupportDetails": short free text
  - "spiritualImportant": object {{"flag": "Yes"/"No"/"Uncertain"/"Others", "detail": string}}
  - "spiritualResourcesWorking": object {{"flag": "Yes"/"No"/"Uncertain"/"Others", "detail": string}}

SECTION 6 — CONFUSION ASSESSMENT METHOD (CAM):
  - "camAcuteOnset": "Yes" or "No"
  - "camInattention": "Yes" or "No"
  - "camDisorganized": "Yes" or "No"
  - "camConsciousness": one of {sorted(CONSCIOUSNESS_ALLOWED)}

SECTION 7 — COMPREHENSIVE CARE PLAN:
  - "palliativeDiagnosis": short free text
  - "goalsOfCare": object where key is one of {sorted(GOALS_OF_CARE_KEYS)} and value is {{"checked": true, "detail": string}}
  - "primaryDecisionMaker": short free text
  - "preferredPlaceOfCare": object where key is one of {sorted(PLACE_OF_CARE_KEYS)} and value is {{"checked": true, "detail": string}}
  - "procedures": list of matching strings from {sorted(PROCEDURE_ALLOWED)}
  - "pmPocusViews": list of matching strings from {sorted(PM_POCUS_VIEWS_ALLOWED)}
  - "medicationsPrescribed": short free text (drug, dose, route, frequency)
  - "reCounselling": object {{"flag": "Yes"/"No"/"Other", "detail": string}}
  - "psychSpiritualSupport": object {{"flag": "Yes"/"No"/"Others", "detail": string}}
  - "socialSupportPlan": object where key is one of {sorted(SOCIAL_SUPPORT_PLAN_KEYS)} and value is {{"checked": true, "detail": string}}
  - "followUpPlan": "Yes" or "No"
  - "followUpDate": string in YYYY-MM-DD format
  - "referralLetter": "Yes" or "No"

Rules:
- Strictly DO NOT include or extract data for Section 1 (Past Details, Referrals, Comorbidities, Exam findings), Section 8, or Section 9.
- Return valid JSON only — no markdown formatting, no commentary, no extra keys.
"""


@router.post("/palliative-assessment/extract-fields")
async def extract_palliative_assessment_fields(payload: dict):
    """
    Expected payload:
    {
        "doctor_id": "...",
        "patient_id": "...",
        "dictation": "free text transcript",
        "target_section": "esas_and_referral"
    }

    Returns:
    {
        "status": "success",
        "finaloutput": { "ecog": "4", "pps": "60%", "bp": "80", ... }
    }
    """
    if groq_client is None:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured on server")

    try:
        dictation = (payload.get("dictation") or "").strip()
        if not dictation:
            raise HTTPException(status_code=400, detail="dictation is required")

        completion = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": PALLIATIVE_EXTRACT_FIELDS_PROMPT},
                {"role": "user", "content": dictation},
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )

        raw_content = completion.choices[0].message.content
        try:
            parsed = json.loads(raw_content)
        except (json.JSONDecodeError, TypeError):
            logger.error(f"Palliative extract-fields returned non-JSON: {raw_content}")
            parsed = {}

        if not isinstance(parsed, dict):
            parsed = {}

        clean = {}

        # ── Section 2: Performance scale ───────────────────────────────────
        if str(parsed.get("ecog")) in ECOG_ALLOWED:
            clean["ecog"] = str(parsed["ecog"])
        if str(parsed.get("pps")) in PPS_ALLOWED:
            clean["pps"] = str(parsed["pps"])

        # ── Section 3: ESAS-r numeric scores & details ──────────────────────
        for key in ESAS_FIELD_KEYS:
            if key in parsed:
                try:
                    val = int(parsed[key])
                    if 0 <= val <= 10:
                        clean[key] = val
                except (TypeError, ValueError):
                    pass

        for key in ESAS_DETAILS_FIELD_KEYS:
            base_key = key[: -len("_details")]
            if parsed.get(key) and base_key in clean:
                clean[key] = str(parsed[key])[:500]

        # ── Section 4: Nursing vitals & clinical assessment ─────────────────
        def _clean_numeric_vital(src_key, range_key, cast=int):
            if src_key not in parsed:
                return None
            try:
                val = cast(parsed[src_key])
            except (TypeError, ValueError):
                return None
            lo, hi = VITAL_RANGES[range_key]
            return val if lo <= val <= hi else None

        systolic = _clean_numeric_vital("bp_systolic", "bp_systolic")
        diastolic = _clean_numeric_vital("bp_diastolic", "bp_diastolic")
        if systolic is not None:
            clean["bp"] = f"{systolic}/{diastolic}" if diastolic is not None else str(systolic)

        for vital in ["pulse", "temperature", "respiratoryRate", "spo2"]:
            val = _clean_numeric_vital(vital, vital, cast=float if vital == "temperature" else int)
            if val is not None:
                clean[vital] = val

        if str(parsed.get("tracheostomy")) in YES_NO_ALLOWED:
            clean["tracheostomy"] = str(parsed["tracheostomy"])

        for key in ["stoma", "woundPressureInjury", "oralCavity", "oedema", "primaryCaregiver", "nursingOther"]:
            if parsed.get(key):
                clean[key] = str(parsed[key])[:500]

        if isinstance(parsed.get("nutrition"), list):
            valid_nut = [item for item in parsed["nutrition"] if str(item) in NUTRITION_ALLOWED]
            if valid_nut:
                clean["nutrition"] = valid_nut

        if isinstance(parsed.get("adl"), list):
            valid_adl = [item for item in parsed["adl"] if str(item) in ADL_ALLOWED]
            if valid_adl:
                clean["adl"] = valid_adl

        # ── Section 5: Psychosocial & Spiritual Assessment ──────────────────
        for key in ["patientKnowsDiagnosis", "caregiverKnowsDiagnosis", "patientKnowsPrognosis", "caregiverKnowsPrognosis", "socialSupport"]:
            if str(parsed.get(key)) in YES_NO_ALLOWED:
                clean[key] = str(parsed[key])

        if parsed.get("socialSupportDetails"):
            clean["socialSupportDetails"] = str(parsed["socialSupportDetails"])[:1000]

        if isinstance(parsed.get("psychosocialTools"), list):
            valid_tools = [t for t in parsed["psychosocialTools"] if str(t) in PSYCHOSOCIAL_TOOLS_ALLOWED]
            if valid_tools:
                clean["psychosocialTools"] = valid_tools

        if isinstance(parsed.get("psychosocialScores"), dict):
            scores_obj = {}
            for t, val in parsed["psychosocialScores"].items():
                if t in PSYCHOSOCIAL_TOOLS_ALLOWED and isinstance(val, dict):
                    scores_obj[t] = {
                        "score": val.get("score", ""),
                        "notes": str(val.get("notes", ""))[:500]
                    }
            if scores_obj:
                clean["psychosocialScores"] = scores_obj

        def _clean_flag_detail(key):
            if isinstance(parsed.get(key), dict):
                obj = parsed[key]
                flag = str(obj.get("flag", "")).strip()
                detail = str(obj.get("detail", "")).strip()
                if flag or detail:
                    clean[key] = {"flag": flag, "detail": detail[:500]}

        for key in ["spiritualImportant", "spiritualResourcesWorking", "reCounselling", "psychSpiritualSupport"]:
            _clean_flag_detail(key)

        # ── Section 6: CAM Delirium ─────────────────────────────────────────
        for key in ["camAcuteOnset", "camInattention", "camDisorganized"]:
            if str(parsed.get(key)) in YES_NO_ALLOWED:
                clean[key] = str(parsed[key])

        if str(parsed.get("camConsciousness")) in CONSCIOUSNESS_ALLOWED:
            clean["camConsciousness"] = str(parsed["camConsciousness"])

        # ── Section 7: Comprehensive Care Plan ──────────────────────────────
        for key in ["palliativeDiagnosis", "primaryDecisionMaker", "medicationsPrescribed"]:
            if parsed.get(key):
                clean[key] = str(parsed[key])[:1000]

        def _clean_detail_choice_map(src_key, allowed_keys):
            if isinstance(parsed.get(src_key), dict):
                merged = {}
                for k, v in parsed[src_key].items():
                    if k in allowed_keys and isinstance(v, dict):
                        merged[k] = {
                            "checked": bool(v.get("checked", True)),
                            "detail": str(v.get("detail", ""))[:500]
                        }
                if merged:
                    clean[src_key] = merged

        _clean_detail_choice_map("goalsOfCare", GOALS_OF_CARE_KEYS)
        _clean_detail_choice_map("preferredPlaceOfCare", PLACE_OF_CARE_KEYS)
        _clean_detail_choice_map("socialSupportPlan", SOCIAL_SUPPORT_PLAN_KEYS)

        if isinstance(parsed.get("procedures"), list):
            valid_procs = [p for p in parsed["procedures"] if str(p) in PROCEDURE_ALLOWED]
            if valid_procs:
                clean["procedures"] = valid_procs

        if isinstance(parsed.get("pmPocusViews"), list):
            valid_views = [v for v in parsed["pmPocusViews"] if str(v) in PM_POCUS_VIEWS_ALLOWED]
            if valid_views:
                clean["pmPocusViews"] = valid_views

        for key in ["followUpPlan", "referralLetter"]:
            if str(parsed.get(key)) in YES_NO_ALLOWED:
                clean[key] = str(parsed[key])

        if parsed.get("followUpDate"):
            clean["followUpDate"] = str(parsed["followUpDate"])[:10]

        return {"status": "success", "finaloutput": clean}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Palliative extract-fields failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
# ═════════════════════════════════════════════════════════════════════════════
# 5. REFERRAL LETTER UPLOAD (section 7 — "Referral Letter")
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/palliative-assessment/upload-referral-letter")
async def upload_referral_letter(
    file: UploadFile = FastAPIFile(...),
    patient_id: str = Form(...),
    doctor_id: str = Form(...),
):
    """
    Uploads the referral letter via the same direct storage-service call
    used in case_documents.py's advanced_upload_document (STORAGE_BASE_URL/upload
    with `params=`, response parsed as upload_result["filename"]).

    ASSUMPTION — please confirm: doc_type is set to "referral_letter" and
    category/subcategory are left None, mirroring the advanced_upload_document
    params shape ({"doctor_id", "patient_id", "doc_type", "category", "subcategory"}).
    If referral letters need a distinct doc_type/category convention on the
    storage side, let me know and I'll adjust.

    ADDITIONAL ASSUMPTION (new in this file): the frontend expects a
    `file_id` in the response (`referralLetterFile.file_id`), which the
    storage call itself doesn't return. A UUID is generated here purely for
    frontend bookkeeping — it does NOT correspond to any ID on the storage
    service side. Swap this out if/when the storage service starts
    returning its own ID.
    """
    if not STORAGE_BASE_URL:
        raise HTTPException(status_code=500, detail="STORAGE_BASE_URL not configured on server")

    allowed_ext = (".pdf", ".jpg", ".jpeg", ".png")
    if not file.filename.lower().endswith(allowed_ext):
        raise HTTPException(status_code=400, detail="Only PDF and image files are accepted.")

    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File exceeds 20 MB limit.")

    try:
        upload_url = f"{STORAGE_BASE_URL}/upload"
        content_type = file.content_type or "application/octet-stream"
        files = {"file": (file.filename, content, content_type)}
        params = {
            "doctor_id": doctor_id,
            "patient_id": patient_id,
            "doc_type": "referral_letter",
            "category": None,
            "subcategory": None,
        }
        response = requests.post(upload_url, params=params, files=files, timeout=60)
        if response.status_code != 200:
            logger.error("Referral letter storage upload failed (%s): %s", response.status_code, response.text)
            raise HTTPException(status_code=response.status_code, detail=response.text)

        upload_result = response.json()
        full_path = upload_result.get("filename", "")
        if not full_path:
            raise HTTPException(status_code=500, detail="No filename returned from storage service.")

        stored_filename = full_path.split("/")[-1]
        storage_path = f"{patient_id}/{stored_filename}"
        stored_url = f"{STORAGE_BASE_URL}/files/{patient_id}/{stored_filename}"

    except HTTPException:
        raise
    except requests.RequestException as e:
        logger.error("Referral letter storage upload request failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Storage service unreachable: {e}")
    except Exception as e:
        logger.error("Referral letter upload failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "status": "success",
        "file_url": stored_url,
        "file_id": str(uuid.uuid4()),  # see ASSUMPTION #3 in module docstring
        "storage_path": storage_path,
        "filename": file.filename,
    }


# ═════════════════════════════════════════════════════════════════════════════
# 6. SAVE (writes the full assessment as a single unified document)
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/palliative-assessment/save")
async def save_palliative_assessment(payload: dict):
    """
    Save a Palliative Medicine Assessment (NCG-KCDO v2.0) — sections 1-7
    (Past Details, Performance Scale, ESAS-r, Nursing Assessment,
    Psychosocial & Spiritual Assessment, CAM, Comprehensive Care Plan).

    Unlike pain-management, this is a single unified form (the spec's
    "Patient is: New / Follow up" is just one field inside it, not two
    separate form shapes), so it saves as one document.

    Expected payload (from PalliativeAssessmentForm.jsx's onSave):
    {
        "patient_id": "...",
        "doctor_id": "...",
        "palliativeAssessment": {...all form fields, see frontend...},
        "saved_at": "ISO timestamp"   # optional, generated client-side
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        assessment = payload.get("palliativeAssessment") or {}

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if not assessment:
            raise HTTPException(status_code=400, detail="palliativeAssessment is required")

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "palliative_assessment": assessment,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
            "type": "palliative_assessment",
        }
        result = await palliative_assessment_collection.insert_one(document)

        return {
            "status": "success",
            "message": "Palliative medicine assessment saved",
            "id": str(result.inserted_id),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 7. HISTORY (used both by the form itself and the read-only summary view)
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/palliative-assessment/history/{patient_id}/{doctor_id}")
async def get_palliative_assessment_history(patient_id: str, doctor_id: str):
    """
    Fetch all Palliative Medicine Assessments for a patient, most recent
    first. Used by BOTH:
      - PalliativeAssessmentForm.jsx  (to decide whether prior records
        exist, so it can suggest "Follow up" as the default for
        section 1A — the doctor can still override it manually)
      - PalliativeAssessmentSummary.jsx (read-only view for every other
        doctor on the case)
    """
    try:
        cursor = palliative_assessment_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("created_at", -1)

        records = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            if isinstance(doc.get("created_at"), datetime):
                doc["created_at"] = doc["created_at"].isoformat()
            if isinstance(doc.get("updated_at"), datetime):
                doc["updated_at"] = doc["updated_at"].isoformat()
            records.append(doc)

        return {
            "status": "success",
            "count": len(records),
            "data": records,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))