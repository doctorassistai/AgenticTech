"""
rheumatology_intake_api.py
─────────────────────────────────────────────────────────────────────────────
DoctorAssist.AI — Rheumatology AI Workflow, Module 1: Intake Agent (v1.0).

This is the FIRST module of the 17-module Rheumatology Workflow described in
the senior's note. Everything else in that roadmap (Disease Activity Engine,
Differential Diagnosis, DMARD Safety, Flare Prediction, Treat-to-Target
Dashboard, etc.) reads structured data that starts here, so this module is
built first and built to be extended, not to be a one-off form.

Mirrors palliative_assessment_api.py's route naming, response shapes, and
error-handling convention 1:1, with "palliative-assessment" swapped for
"rheumatology-intake". Where this file diverges from that pattern, it's
called out explicitly below.

ROUTES IN THIS FILE
---------------------
  GET  /rheumatology-intake/patient-context/{patient_id}/{doctor_id}
  POST /rheumatology-intake/extract-fields
  POST /rheumatology-intake/save
  GET  /rheumatology-intake/history/{patient_id}/{doctor_id}

NOT included here (future modules, out of scope for this file):
  - Joint & Symptom Mapping Agent (Module 2)
  - Differential Diagnosis Engine (Module 3)
  - Disease Activity Engine / DAS28 etc. (Module 6)
  - DMARD Safety Monitoring (Module 8)
  - Everything else in the 17-module roadmap.
  These will each get their own router file later, the same way
  palliative-assessment and pain-management are separate files today.

⚠️ ASSUMPTIONS MADE WHILE ASSEMBLING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. ROUTER MOUNT: same convention as patientcontext.py and
     palliative_assessment_api.py — `prefix="/context"`. The outer
     gateway already prepends "/api/hms/users/data" before the request
     reaches FastAPI, so this file only ever sees "/context/...". Mount
     with `app.include_router(rheumatology_router)` in main.py, same as
     the other two.

  2. COLLECTION NAME: I don't have a live schema for this, so I picked
     "rheumatology_intake" as the Mongo collection name (analogous to
     "palliative_assessment"). Change RHEUM_COLLECTION_NAME below if you
     want a different name — it's the only place it's referenced.

  3. DIAGNOSIS PREFILL: DoctorDashboard.jsx already has a *generic*
     diagnosis save/history flow (`/context/diagnosis/save`,
     `/context/diagnosis/history/{patient_id}/{doctor_id}`) that's not
     oncology-specific — that's what saveDiagnosis()/diagnosisText use.
     I reused THAT collection for patient-context prefill here (assumed
     name: "diagnosis_data", same as palliative_assessment_api.py's
     diagnosis_data_collection, since that's the only diagnosis
     collection confirmed to exist). If rheumatology doctors save
     diagnosis somewhere else, tell me and I'll repoint this.

  4. MEDICATION PREFILL: reused documentation-medication-analysis the
     same way palliative_assessment_api.py does — same collection name,
     same "most recent prescriptions, LLM-summarized to one line" logic.
     No LLM fallback to raw treatment records here (unlike palliative's
     chemo/radiotherapy fallback) since none of those sources are
     relevant to a rheumatology patient. If the medication doc is empty,
     the field just stays "".

  5. NO REFERRAL LETTER UPLOAD / NO STORAGE_BASE_URL CALL: the Module 1
     field list (presenting complaint, joint distribution, morning
     stiffness, onset, extra-articular symptoms, previous autoimmune
     disease, family history, meds, steroid exposure, functional
     limitation, comorbidities, pregnancy/reproductive considerations)
     doesn't include a document upload. Left out entirely rather than
     adding an unused endpoint.

  6. "SUSPECTED DISEASE PATTERNS": the note says intake output should be
     "structured rheumatology history + suspected disease patterns". I
     added a lightweight `suspected_patterns` list (short strings, e.g.
     "Pattern consistent with seropositive RA") to the extract-fields
     LLM output — NOT a real differential engine (that's Module 3,
     future work). This is explicitly a rough first-pass hint the doctor
     can ignore; the prompt instructs the LLM to leave it empty rather
     than force a guess when the dictation doesn't support one.
─────────────────────────────────────────────────────────────────────────
"""

import os
import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from motor.motor_asyncio import AsyncIOMotorClient
from groq import Groq

logger = logging.getLogger(__name__)

# ─── Mongo setup ────────────────────────────────────────────────────────────
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

RHEUM_COLLECTION_NAME = "rheumatology_intake"  # see ASSUMPTION #2

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    rheumatology_intake_collection = database[RHEUM_COLLECTION_NAME]
    diagnosis_data_collection = database["diagnosis_data"]  # see ASSUMPTION #3
    documentation_medication_analysis_collection = database["documentation-medication-analysis"]
except Exception as e:
    logger.error(f"Error initializing MongoDB in rheumatology_intake_api: {e}")

# ─── Groq setup ─────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client: Optional[Groq] = None
try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        logger.warning("GROQ_API_KEY not set — rheumatology LLM endpoints will fail at call time.")
except Exception as e:
    logger.error(f"Error initializing Groq client in rheumatology_intake_api: {e}")

router = APIRouter(prefix="/context", tags=["Rheumatology Intake"])


# ═════════════════════════════════════════════════════════════════════════════
# 1. PATIENT CONTEXT (auto-fill: known diagnosis + current medications)
# ═════════════════════════════════════════════════════════════════════════════

MEDICATION_SUMMARY_PROMPT = """
You are a clinical assistant. You will be given a patient's most recent
prescriptions (from a Medication Analysis record) as JSON.

Produce a JSON object with exactly one key:

- "current_medications": ONE-TO-TWO sentence free text summarizing the
  patient's current medications, including drug name(s), strength, and
  frequency where available. If the prescriptions list is empty or has
  no real data, return an empty string.

Rules:
- Do NOT invent medications not present in the input.
- Return valid JSON only — no markdown, no commentary.
"""


async def _get_current_medications_text(patient_id: str) -> str:
    if groq_client is None:
        return ""
    try:
        doc = await documentation_medication_analysis_collection.find_one(
            {"patient_id": patient_id}, sort=[("created_at", -1)]
        )
        if not doc:
            return ""
        prescriptions = (doc.get("finaloutput") or {}).get("prescriptions") or []
        real_prescriptions = [
            p for p in prescriptions
            if any((p.get(k) or "").strip() for k in ["medication", "generic_name", "brand_name"])
        ]
        if not real_prescriptions:
            return ""

        completion = groq_client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[
                {"role": "system", "content": MEDICATION_SUMMARY_PROMPT},
                {"role": "user", "content": json.dumps(real_prescriptions, indent=2, default=str)},
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )
        parsed = json.loads(completion.choices[0].message.content)
        return parsed.get("current_medications", "") if isinstance(parsed, dict) else ""
    except Exception as e:
        logger.warning(f"Rheumatology context: medication summary failed for {patient_id}: {e}")
        return ""


@router.get("/rheumatology-intake/patient-context/{patient_id}/{doctor_id}")
async def get_rheumatology_patient_context(patient_id: str, doctor_id: str):
    """
    Auto-fill for the top of the Rheumatology Intake form: known diagnosis
    (if this patient already has one on record) and current medications.
    Never raises — any individual lookup failure just leaves that field blank.
    """
    result = {"known_diagnosis": "", "current_medications": ""}

    try:
        diagnosis_doc = await diagnosis_data_collection.find_one(
            {"patient_id": patient_id}, sort=[("created_at", -1)]
        )
        if diagnosis_doc:
            result["known_diagnosis"] = diagnosis_doc.get("diagnosis") or ""
    except Exception as e:
        logger.warning(f"Rheumatology context: diagnosis lookup failed for {patient_id}: {e}")

    result["current_medications"] = await _get_current_medications_text(patient_id)

    return {"status": "success", "data": result}


# ═════════════════════════════════════════════════════════════════════════════
# 2. EXTRACT FIELDS FROM DICTATION
# ═════════════════════════════════════════════════════════════════════════════

YES_NO_ALLOWED = {"Yes", "No"}
JOINT_DISTRIBUTION_ALLOWED = {"Monoarticular", "Oligoarticular", "Polyarticular"}
JOINT_SIZE_ALLOWED = {"Small joints", "Large joints", "Both"}
SYMMETRY_ALLOWED = {"Symmetrical", "Asymmetrical"}
AXIAL_ALLOWED = {"Yes", "No", "Uncertain"}
PROGRESSION_ALLOWED = {"Improving", "Stable", "Worsening", "Fluctuating"}

RHEUM_EXTRACT_FIELDS_PROMPT = f"""
You are a clinical assistant extracting a structured Rheumatology Intake
record from a doctor's spoken/dictated clinical note. This is the FIRST
visit intake — extract only what the dictation actually states or clearly
implies. Never guess or invent a value that isn't supported by the text.

Return a JSON object with these optional keys — include a key ONLY if the
dictation supports it:

- "chief_complaint": short free text
  - "current_symptoms": free text, 1-3 sentences describing symptoms the
    patient reports having RIGHT NOW at this visit (distinct from
    history_of_present_illness, which is the fuller narrative) — omit if
    the dictation doesn't distinguish current symptoms from history
  - "history_of_present_illness": free text, 1-4 sentences
  - "onset": free text (e.g. "gradual onset 3 months ago", "acute, 2 weeks ago")
  - "progression": one of {sorted(PROGRESSION_ALLOWED)}
  - "joint_distribution": one of {sorted(JOINT_DISTRIBUTION_ALLOWED)}
  - "joint_size": one of {sorted(JOINT_SIZE_ALLOWED)}
  - "joint_symmetry": one of {sorted(SYMMETRY_ALLOWED)}
  - "axial_involvement": one of {sorted(AXIAL_ALLOWED)}
  - "morning_stiffness_minutes": integer, duration of morning stiffness in minutes
  - "affected_joints": list of short strings naming specific joints mentioned
    (e.g. ["bilateral MCP", "left knee", "lumbar spine"])
  - "extra_articular_symptoms": list of short strings (e.g. "dry eyes",
    "skin rash", "Raynaud phenomenon", "oral ulcers")
  - "previous_autoimmune_disease": free text, or "None" if explicitly denied
  - "family_history": free text, or "None" if explicitly denied
  - "previous_medications": free text (drug names/classes tried before, if any)
  - "steroid_exposure": object {{"has_used": "Yes"/"No", "detail": string}}
    (detail = dose/duration/route if stated)
  - "functional_limitations": free text (impact on daily activities/work)
  - "comorbidities": list of short strings
  - "pregnancy_reproductive_considerations": free text, only if explicitly
    discussed (pregnancy status, planning, contraception relevant to
    teratogenic DMARDs) — omit entirely if not mentioned, do not assume
  - "suspected_patterns": list of at most 3 SHORT strings, each a
    tentative pattern-level observation directly supported by the
    dictation (e.g. "Symmetrical small-joint polyarthritis pattern
    consistent with possible RA"). This is NOT a diagnosis and NOT a
    differential — it is a rough first-pass note for the doctor to
    weigh. If the dictation doesn't clearly support any pattern, return
    an empty list. Never state a named diagnosis as fact here.

Rules:
- Do NOT diagnose. "suspected_patterns" must stay descriptive/tentative,
  never a definitive named condition presented as confirmed.
- Do NOT invent joints, symptoms, or history not stated in the dictation.
- Return valid JSON only — no markdown formatting, no commentary, no extra keys.
"""


@router.post("/rheumatology-intake/extract-fields")
async def extract_rheumatology_intake_fields(payload: dict):
    """
    Expected payload:
    {
        "doctor_id": "...",
        "patient_id": "...",
        "dictation": "free text transcript"
    }

    Returns:
    { "status": "success", "finaloutput": { ...cleaned fields... } }
    """
    if groq_client is None:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured on server")

    dictation = (payload.get("dictation") or "").strip()
    if not dictation:
        raise HTTPException(status_code=400, detail="dictation is required")

    try:
        completion = groq_client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[
                {"role": "system", "content": RHEUM_EXTRACT_FIELDS_PROMPT},
                {"role": "user", "content": dictation},
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )
        raw_content = completion.choices[0].message.content
        try:
            parsed = json.loads(raw_content)
        except (json.JSONDecodeError, TypeError):
            logger.error(f"Rheumatology extract-fields returned non-JSON: {raw_content}")
            parsed = {}
        if not isinstance(parsed, dict):
            parsed = {}

        clean = {}

        for key in ["chief_complaint", "current_symptoms", "history_of_present_illness", "onset",
                    "previous_autoimmune_disease", "family_history",
                    "previous_medications", "functional_limitations",
                    "pregnancy_reproductive_considerations"]:
            if parsed.get(key):
                clean[key] = str(parsed[key])[:1000]

        if str(parsed.get("progression")) in PROGRESSION_ALLOWED:
            clean["progression"] = str(parsed["progression"])
        if str(parsed.get("joint_distribution")) in JOINT_DISTRIBUTION_ALLOWED:
            clean["joint_distribution"] = str(parsed["joint_distribution"])
        if str(parsed.get("joint_size")) in JOINT_SIZE_ALLOWED:
            clean["joint_size"] = str(parsed["joint_size"])
        if str(parsed.get("joint_symmetry")) in SYMMETRY_ALLOWED:
            clean["joint_symmetry"] = str(parsed["joint_symmetry"])
        if str(parsed.get("axial_involvement")) in AXIAL_ALLOWED:
            clean["axial_involvement"] = str(parsed["axial_involvement"])

        if "morning_stiffness_minutes" in parsed:
            try:
                val = int(parsed["morning_stiffness_minutes"])
                if 0 <= val <= 1440:
                    clean["morning_stiffness_minutes"] = val
            except (TypeError, ValueError):
                pass

        for list_key in ["affected_joints", "extra_articular_symptoms", "comorbidities"]:
            if isinstance(parsed.get(list_key), list):
                items = [str(i)[:100] for i in parsed[list_key] if str(i).strip()]
                if items:
                    clean[list_key] = items[:20]

        if isinstance(parsed.get("steroid_exposure"), dict):
            obj = parsed["steroid_exposure"]
            has_used = str(obj.get("has_used", ""))
            if has_used in YES_NO_ALLOWED:
                clean["steroid_exposure"] = {
                    "has_used": has_used,
                    "detail": str(obj.get("detail", ""))[:500],
                }

        if isinstance(parsed.get("suspected_patterns"), list):
            patterns = [str(p)[:200] for p in parsed["suspected_patterns"] if str(p).strip()]
            if patterns:
                clean["suspected_patterns"] = patterns[:3]

        return {"status": "success", "finaloutput": clean}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Rheumatology extract-fields failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 3. SAVE
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-intake/save")
async def save_rheumatology_intake(payload: dict):
    """
    Expected payload (from RheumatologyIntakeForm.jsx's onSave):
    {
        "patient_id": "...",
        "doctor_id": "...",
        "rheumatologyIntake": {...all form fields, see frontend...}
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        intake = payload.get("rheumatologyIntake") or {}

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if not intake:
            raise HTTPException(status_code=400, detail="rheumatologyIntake is required")

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "rheumatology_intake": intake,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
            "type": "rheumatology_intake",
        }
        result = await rheumatology_intake_collection.insert_one(document)

        return {
            "status": "success",
            "message": "Rheumatology intake saved",
            "id": str(result.inserted_id),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 4. HISTORY
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-intake/history/{patient_id}/{doctor_id}")
async def get_rheumatology_intake_history(patient_id: str, doctor_id: str):
    """
    Fetch all Rheumatology Intake records for a patient, most recent first.
    Used by both RheumatologyIntakeForm.jsx (to check whether a prior
    intake already exists) and RheumatologyIntakeSummary.jsx (read-only
    view for other doctors on the case).
    """
    try:
        cursor = rheumatology_intake_collection.find(
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

        return {"status": "success", "count": len(records), "data": records}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))