"""
rheumatology_structured_note_api.py
─────────────────────────────────────────────────────────────────────────────
DoctorAssist.AI — Rheumatology AI Workflow, Module: AI-Generated Structured
Note (Requirement #2, Tier 1).

Assembles the standardized rheumatology note by reading every prior
module's saved output as context, asks the LLM to write the narrative
sections in plain language grounded strictly in that context, and lets
the doctor edit every section before saving. Mirrors the differential
diagnosis / imaging / manifestation files' route shape, response
envelope, and error-handling convention 1:1.

ROUTES IN THIS FILE
---------------------
  GET  /rheumatology-structured-note/context-preview/{patient_id}/{doctor_id}
  POST /rheumatology-structured-note/generate
  POST /rheumatology-structured-note/save
  GET  /rheumatology-structured-note/history/{patient_id}/{doctor_id}

⚠️ ASSUMPTIONS MADE WHILE ASSEMBLING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. ROUTER MOUNT: same convention as every other rheumatology file —
     `prefix="/context"`, mount with `app.include_router(...)` in main.py.

  2. COLLECTION NAME: "rheumatology_structured_notes" for saved notes.
     Change STRUCTURED_NOTE_COLLECTION_NAME below if you want a
     different name.

  3. CONFIRMED CONTEXT SOURCES (real shapes, verified against the actual
     files): rheumatology_intake, rheumatology_joint_map,
     rheumatology_differential_diagnosis, rheumatology_imaging_comparisons,
     rheumatology_manifestation_assessments, documentation-medication-analysis
     (current meds, same collection Module 11 already reads).

  4. UNCONFIRMED CONTEXT SOURCES — collection names GUESSED from your
     existing "rheumatology_<module>" naming convention, NOT yet
     verified against real backend files:
       - "rheumatology_investigation_planner"  → Laboratory Results (planned)
       - "rheumatology_lab_trends"              → Laboratory Results (values/trend)
       - "rheumatology_disease_activity"        → Disease Activity
       - "rheumatology_treatment_ledger"        → Medication History / Treatment Plan
       - "rheumatology_treat_to_target"         → Follow-up Plan
     Each read is wrapped in its own try/except and defaults to {} on
     failure (wrong collection name, wrong field name, or module not
     yet used for this patient) — a wrong guess degrades that one
     section to "Not documented" rather than breaking note generation.
     Paste the real files and I'll patch `_gather_note_context()`'s
     five TODO blocks with the real field names — everything else in
     this file is unaffected.

  5. FLAT 18-SECTION STRING SHAPE: the note is a flat dict of 18
     doctor-editable free-text sections (see NOTE_SECTION_KEYS) rather
     than nested structured objects — simplest shape that's uniformly
     editable in one textarea per section, matches how `diagnosisText`
     is already handled elsewhere in the app. If you want any section
     to instead be structured (e.g. joint-wise symptoms as a table
     keyed by joint), tell me and I'll change that section's shape.

  6. LLM WRITES NARRATIVE, NEVER FILLS FROM MEMORY: every section is
     written strictly from the JSON context assembled server-side. Where
     a source has no data for a section, the LLM must write "Not
     documented" for that section rather than infer or invent — same
     rule as every other rheumatology module's prompt.

  7. NO AUTOMATIC RE-GENERATION ON SAVE: identical to Module 3's
     differential-diagnosis save — the save payload is whatever the
     doctor's edited version is, not necessarily the raw /generate
     output.
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

STRUCTURED_NOTE_COLLECTION_NAME = "rheumatology_structured_notes"  # see ASSUMPTION #2

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    structured_note_collection = database[STRUCTURED_NOTE_COLLECTION_NAME]

    # Confirmed sources — see ASSUMPTION #3
    rheumatology_intake_collection = database["rheumatology_intake"]
    joint_map_collection = database["rheumatology_joint_map"]
    differential_collection = database["rheumatology_differential_diagnosis"]
    imaging_comparison_collection = database["rheumatology_imaging_comparisons"]
    manifestation_assessment_collection = database["rheumatology_manifestation_assessments"]
    documentation_medication_analysis_collection = database["documentation-medication-analysis"]

    # Corrected against the real backend files (Investigation Planner, Lab
    # Trends, Treat-to-Target) — was previously guessing wrong collection
    # names, which meant Laboratory Results and Follow-up Plan sections were
    # silently always empty.
    investigation_planner_collection = database["rheumatology_investigation_plan"]
    lab_trend_analysis_collection = database["rheumatology_lab_trend_analysis"]
    disease_activity_collection = database["rheumatology_disease_activity"]
    treatment_ledger_collection = database["rheumatology_treatment_ledger"]
    treat_to_target_collection = database["rheumatology_treat_to_target_snapshots"]
except Exception as e:
    logger.error(f"Error initializing MongoDB in rheumatology_structured_note_api: {e}")

# ─── Groq setup ─────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client: Optional[Groq] = None
try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        logger.warning("GROQ_API_KEY not set — structured note generation will fail at call time.")
except Exception as e:
    logger.error(f"Error initializing Groq client in rheumatology_structured_note_api: {e}")

router = APIRouter(prefix="/context", tags=["Rheumatology Structured Note"])

# ─── Section vocabulary — see ASSUMPTION #5 ──────────────────────────────────
NOTE_SECTION_KEYS = [
    "chief_complaint",
    "history_of_present_illness",
    "pain_characteristics",
    "joint_wise_symptoms",
    "morning_stiffness",
    "extra_articular_symptoms",
    "past_medical_history",
    "family_history",
    "medication_history",
    "previous_rheumatology_treatment",
    "examination_findings",
    "laboratory_results",
    "imaging_findings",
    "disease_activity",
    "assessment",
    "differential_diagnosis",
    "treatment_plan",
    "followup_plan",
]

NOTE_SECTION_LABELS = {
    "chief_complaint": "Chief Complaint",
    "history_of_present_illness": "History of Present Illness",
    "pain_characteristics": "Pain Characteristics",
    "joint_wise_symptoms": "Joint-wise Symptoms",
    "morning_stiffness": "Morning Stiffness",
    "extra_articular_symptoms": "Extra-articular Symptoms",
    "past_medical_history": "Past Medical History",
    "family_history": "Family History",
    "medication_history": "Medication History",
    "previous_rheumatology_treatment": "Previous Rheumatology Treatment",
    "examination_findings": "Examination Findings",
    "laboratory_results": "Laboratory Results",
    "imaging_findings": "Imaging Findings",
    "disease_activity": "Disease Activity",
    "assessment": "Assessment",
    "differential_diagnosis": "Differential Diagnosis",
    "treatment_plan": "Treatment Plan",
    "followup_plan": "Follow-up Plan",
}


# ═════════════════════════════════════════════════════════════════════════════
# CONTEXT GATHERING
# ═════════════════════════════════════════════════════════════════════════════
async def _safe_latest(collection, patient_id: str, doctor_id: str, label: str) -> dict:
    """Read latest doc for this patient/doctor from `collection`; never raises."""
    try:
        doc = await collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        if not doc:
            return {}
        doc.pop("_id", None)
        if isinstance(doc.get("created_at"), datetime):
            doc["created_at"] = doc["created_at"].isoformat()
        return doc
    except Exception as e:
        logger.warning(f"Structured note: {label} lookup failed for {patient_id}: {e}")
        return {}
        
async def _get_current_medications(patient_id: str, doctor_id: str) -> list:
    """
    Source-of-truth order (matches the fix applied to Modules 7 & 8):
    rheumatology_treatment_ledger active entries first, then
    documentation-medication-analysis as legacy fallback.
    """
    names = []
    seen = set()

    try:
        cursor = treatment_ledger_collection.find({
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "stop_date": None,
        })
        async for entry in cursor:
            name = entry.get("drug_name") or ""
            if name and name.lower() not in seen:
                names.append(name)
                seen.add(name.lower())
    except Exception as e:
        logger.warning(f"Structured note: treatment ledger lookup failed for {patient_id}: {e}")

    try:
        doc = await documentation_medication_analysis_collection.find_one(
            {"patient_id": patient_id}, sort=[("created_at", -1)]
        )
        if doc:
            prescriptions = (doc.get("finaloutput") or {}).get("prescriptions") or []
            for p in prescriptions:
                name = p.get("medication") or p.get("generic_name") or p.get("brand_name") or ""
                if name and name.lower() not in seen:
                    names.append(name)
                    seen.add(name.lower())
    except Exception as e:
        logger.warning(f"Structured note: medication lookup failed for {patient_id}: {e}")

    return names


async def _gather_note_context(patient_id: str, doctor_id: str) -> dict:
    """Pulls the latest saved output from every prior rheumatology module."""
    intake_doc = await _safe_latest(rheumatology_intake_collection, patient_id, doctor_id, "intake")
    joint_map_doc = await _safe_latest(joint_map_collection, patient_id, doctor_id, "joint map")
    differential_doc = await _safe_latest(differential_collection, patient_id, doctor_id, "differential")
    imaging_doc = await _safe_latest(imaging_comparison_collection, patient_id, doctor_id, "imaging comparison")
    manifestation_doc = await _safe_latest(manifestation_assessment_collection, patient_id, doctor_id, "manifestations")
    current_medications = await _get_current_medications(patient_id, doctor_id)

    # ── Unconfirmed sources — see ASSUMPTION #4. Each defaults to {} on any
    # failure (wrong collection/field name) so a bad guess never breaks the
    # rest of note generation. TODO: replace field access once real files
    # are pasted. ──────────────────────────────────────────────────────────
    investigation_doc = await _safe_latest(investigation_planner_collection, patient_id, doctor_id, "investigation planner")
    lab_trend_doc = await _safe_latest(lab_trend_analysis_collection, patient_id, doctor_id, "lab trend analysis")
    disease_activity_doc = await _safe_latest(disease_activity_collection, patient_id, doctor_id, "disease activity")
    treatment_ledger_doc = await _safe_latest(treatment_ledger_collection, patient_id, doctor_id, "treatment ledger")
    treat_to_target_doc = await _safe_latest(treat_to_target_collection, patient_id, doctor_id, "treat to target snapshot")

    context = {
        "intake": intake_doc.get("rheumatology_intake") or {},
        "joint_map": joint_map_doc.get("joint_map") or {},
        "differential": {
            "differential_diagnosis": differential_doc.get("differential_diagnosis") or {},
            "working_diagnosis": differential_doc.get("working_diagnosis") or "",
            "triage": differential_doc.get("triage") or None,
        } if differential_doc else {},
        "imaging": {
            "comparisons": imaging_doc.get("comparisons") or [],
            "narrative": imaging_doc.get("narrative") or "",
        } if imaging_doc else {},
        "manifestations": {
            "panel": manifestation_doc.get("panel") or [],
            "narrative": manifestation_doc.get("narrative") or "",
        } if manifestation_doc else {},
        "current_medications": current_medications,
        # Raw docs passed through as-is; LLM told to use only what's
        # actually present and write "Not documented" otherwise.
        "investigation_planner_raw": investigation_doc,
        "lab_trend_analysis_raw": lab_trend_doc,
        "disease_activity_raw": disease_activity_doc,
        "treatment_ledger_raw": treatment_ledger_doc,
        "treat_to_target_snapshot_raw": treat_to_target_doc,
    }
    return context


@router.get("/rheumatology-structured-note/context-preview/{patient_id}/{doctor_id}")
async def get_structured_note_context_preview(patient_id: str, doctor_id: str):
    """Read-only preview of every source that will feed note generation."""
    context = await _gather_note_context(patient_id, doctor_id)
    has_data = any([
        context["intake"], context["joint_map"], context["differential"],
        context["imaging"], context["manifestations"], context["current_medications"],
    ])
    return {"status": "success", "data": context, "has_data": has_data}


# ═════════════════════════════════════════════════════════════════════════════
# GENERATE
# ═════════════════════════════════════════════════════════════════════════════

STRUCTURED_NOTE_PROMPT = f"""
You are a clinical assistant supporting a rheumatologist. You will be
given structured data pulled from every prior module of a patient's
rheumatology workup (intake, joint exam, differential diagnosis,
imaging, extra-articular manifestations, current medications), plus
possibly some unconfirmed/raw sections and an optional free-text
"additional dictation" for anything not yet captured elsewhere.

Your task is to write a standardized rheumatology clinical note as a
JSON object with EXACTLY these {len(NOTE_SECTION_KEYS)} keys, each a
string value:
{json.dumps(NOTE_SECTION_KEYS)}

Rules:
- Use ONLY the information given. Never invent joints, symptoms, labs,
  imaging findings, or history not present in the input.
- If a section has no supporting data anywhere in the input, write
  exactly "Not documented" for that section — do not guess or pad it.
- Each section should be 1-4 sentences of plain clinical prose (except
  "joint_wise_symptoms", which may be a short structured list if the
  joint map data supports it).
- For "differential_diagnosis", summarize the likely/possible/must-not-
  miss tiers already provided — do not re-rank or invent new conditions.
- For "assessment", synthesize the working diagnosis and triage already
  provided — never invent a new diagnosis or contradict it.
- For "disease_activity", "laboratory_results", "treatment_plan", and
  "followup_plan" — some input for these may be raw/unconfirmed-shape
  data (`*_raw` keys). Use only fields you can clearly interpret from
  them; if the raw data is empty or not interpretable, write "Not
  documented".
- Never present this note as a final, confirmed clinical document — it
  is a draft for physician review and edit before it becomes part of
  the record.
- Return valid JSON only — no markdown, no commentary, no extra keys.
"""


@router.post("/rheumatology-structured-note/generate")
async def generate_structured_note(payload: dict):
    """
    Expected payload:
    { "doctor_id": "...", "patient_id": "...", "additional_dictation": "optional free text" }

    Returns:
    { "status": "success", "finaloutput": { <18 section keys>: str, ... }, "context_used": {...} }
    """
    if groq_client is None:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured on server")

    patient_id = payload.get("patient_id")
    doctor_id = payload.get("doctor_id")
    additional_dictation = (payload.get("additional_dictation") or "").strip()

    if not patient_id or not doctor_id:
        raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")

    context = await _gather_note_context(patient_id, doctor_id)
    context["additional_dictation"] = additional_dictation

    has_any_context = any([
        context["intake"], context["joint_map"], context["differential"],
        context["imaging"], context["manifestations"], additional_dictation,
    ])
    if not has_any_context:
        raise HTTPException(
            status_code=400,
            detail="No prior module data found for this patient, and no additional dictation was provided. "
                   "Complete at least Intake or Joint Mapping first, or add dictation text.",
        )

    try:
        completion = groq_client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[
                {"role": "system", "content": STRUCTURED_NOTE_PROMPT},
                {"role": "user", "content": json.dumps(context, indent=2, default=str)},
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )
        raw_content = completion.choices[0].message.content
        try:
            parsed = json.loads(raw_content)
        except (json.JSONDecodeError, TypeError):
            logger.error(f"Structured note generation returned non-JSON: {raw_content}")
            parsed = {}
        if not isinstance(parsed, dict):
            parsed = {}

        clean = {key: str(parsed.get(key, "") or "Not documented")[:2000] for key in NOTE_SECTION_KEYS}

        return {"status": "success", "finaloutput": clean, "context_used": context}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Structured note generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# SAVE
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-structured-note/save")
async def save_structured_note(payload: dict):
    """
    Expected payload (doctor-reviewed/edited version, NOT necessarily raw /generate output):
    {
        "patient_id": "...", "doctor_id": "...",
        "structuredNote": { <18 section keys>: str, ... },
        "additionalDictation": "optional — the dictation text used, for audit"
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        structured_note = payload.get("structuredNote") or {}
        additional_dictation = payload.get("additionalDictation") or ""

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if not structured_note or not any(str(structured_note.get(k, "")).strip() for k in NOTE_SECTION_KEYS):
            raise HTTPException(status_code=400, detail="structuredNote is required and cannot be entirely empty")

        clean_note = {key: str(structured_note.get(key, "") or "")[:2000] for key in NOTE_SECTION_KEYS}

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "structured_note": clean_note,
            "additional_dictation": str(additional_dictation)[:2000],
            "created_at": datetime.utcnow(),
            "type": "rheumatology_structured_note",
        }
        result = await structured_note_collection.insert_one(document)

        return {"status": "success", "message": "Structured note saved", "id": str(result.inserted_id)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# HISTORY
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-structured-note/history/{patient_id}/{doctor_id}")
async def get_structured_note_history(patient_id: str, doctor_id: str):
    try:
        cursor = structured_note_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("created_at", -1)

        records = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            if isinstance(doc.get("created_at"), datetime):
                doc["created_at"] = doc["created_at"].isoformat()
            records.append(doc)

        return {"status": "success", "count": len(records), "data": records}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))