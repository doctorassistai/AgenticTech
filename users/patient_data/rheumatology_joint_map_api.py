"""
rheumatology_joint_map_api.py
─────────────────────────────────────────────────────────────────────────────
DoctorAssist.AI — Rheumatology AI Workflow, Module 2: Joint & Symptom
Mapping Agent (v1.0).

Reads Module 1 (rheumatology_intake_api.py) output as prefill context
(affected_joints / joint_distribution), then lets the doctor build a
proper joint-level record: a 28-joint mannequin (tender/swollen per
joint — same joint set DAS28 uses, on purpose, so Module 6's Disease
Activity Engine can consume this record directly later), plus
enthesitis sites, dactylitis digits, axial involvement, ROM limitation,
pain severity, and functional impact.

Mirrors rheumatology_intake_api.py's / palliative_assessment_api.py's
route naming, response shapes, and error-handling convention 1:1.

ROUTES IN THIS FILE
---------------------
  GET  /rheumatology-joint-map/latest-intake/{patient_id}/{doctor_id}
  POST /rheumatology-joint-map/extract-fields
  POST /rheumatology-joint-map/save
  GET  /rheumatology-joint-map/history/{patient_id}/{doctor_id}

⚠️ ASSUMPTIONS MADE WHILE ASSEMBLING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. ROUTER MOUNT: same as the other two rheumatology/palliative files —
     `prefix="/context"`, mount with `app.include_router(...)` in main.py.

  2. COLLECTION NAME: "rheumatology_joint_map" (analogous to
     "rheumatology_intake"). Change JOINT_MAP_COLLECTION_NAME below if
     you want a different name.

  3. JOINT ID VOCABULARY: the 28 joint IDs below (JOINT_IDS) are the
     canonical vocabulary shared with the frontend mannequin
     (RheumatologyJointMap.jsx). If you rename/add joints on the
     frontend, mirror the exact same ID strings here — the extract-fields
     endpoint validates against this list and silently drops anything
     that doesn't match, so a mismatch means dictated joint findings
     quietly disappear rather than erroring. Worth a manual smoke test
     after any joint-list change on either side.

  4. NO computed DAS28/joint-count SCORE in this file. This module only
     records raw tender/swollen state per joint — the actual DAS28
     calculation (which needs ESR/CRP + patient global assessment too)
     belongs to Module 6 (Disease Activity Engine), not here. Storing
     the same 28-joint vocabulary now just means that module won't need
     to re-collect this data later.

  5. INTAKE PREFILL: pulls the most recent rheumatology_intake document
     for this patient/doctor pair and surfaces `affected_joints` /
     `joint_distribution` / `joint_symmetry` as read-only reference text
     at the top of the joint map form — it does NOT auto-populate the
     mannequin itself (a doctor should confirm on the mannequin, not
     have Module 1's free-text guess silently become Module 2's
     structured record). If you'd rather it auto-seed the mannequin,
     say so and I'll add a best-effort mapping.
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

JOINT_MAP_COLLECTION_NAME = "rheumatology_joint_map"  # see ASSUMPTION #2

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    joint_map_collection = database[JOINT_MAP_COLLECTION_NAME]
    rheumatology_intake_collection = database["rheumatology_intake"]
except Exception as e:
    logger.error(f"Error initializing MongoDB in rheumatology_joint_map_api: {e}")

# ─── Groq setup ─────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client: Optional[Groq] = None
try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        logger.warning("GROQ_API_KEY not set — joint-map LLM endpoints will fail at call time.")
except Exception as e:
    logger.error(f"Error initializing Groq client in rheumatology_joint_map_api: {e}")

router = APIRouter(prefix="/context", tags=["Rheumatology Joint Map"])

# ─── Canonical 28-joint vocabulary (DAS28 joint set) — see ASSUMPTION #3 ─────
_SIDES = ["L", "R"]
JOINT_IDS = (
    [f"shoulder_{s}" for s in _SIDES]
    + [f"elbow_{s}" for s in _SIDES]
    + [f"wrist_{s}" for s in _SIDES]
    + [f"mcp{n}_{s}" for s in _SIDES for n in range(1, 6)]
    + [f"pip{n}_{s}" for s in _SIDES for n in range(1, 6)]
    + [f"knee_{s}" for s in _SIDES]
)  # 28 total

JOINT_STATUS_ALLOWED = {"tender", "swollen", "tender_swollen", "none"}

ENTHESITIS_SITES_ALLOWED = {
    "Lateral epicondyle (L)", "Lateral epicondyle (R)",
    "Medial epicondyle (L)", "Medial epicondyle (R)",
    "Achilles insertion (L)", "Achilles insertion (R)",
    "Plantar fascia insertion (L)", "Plantar fascia insertion (R)",
    "Greater trochanter (L)", "Greater trochanter (R)",
    "Patellar tendon insertion (L)", "Patellar tendon insertion (R)",
}

AXIAL_ALLOWED = {"Yes", "No", "Uncertain"}


# ═════════════════════════════════════════════════════════════════════════════
# 1. LATEST INTAKE (reference-only prefill from Module 1)
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-joint-map/latest-intake/{patient_id}/{doctor_id}")
async def get_latest_intake_for_joint_map(patient_id: str, doctor_id: str):
    """
    Read-only reference pulled from the most recent Module 1 intake record,
    shown at the top of the joint map form so the doctor isn't re-reading
    free text while mapping joints. Does NOT pre-tick the mannequin —
    see ASSUMPTION #5.
    """
    result = {"affected_joints": [], "joint_distribution": "", "joint_symmetry": "", "axial_involvement": ""}
    try:
        doc = await rheumatology_intake_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        if doc:
            intake = doc.get("rheumatology_intake") or {}
            result["affected_joints"] = intake.get("affected_joints") or []
            result["joint_distribution"] = intake.get("joint_distribution") or ""
            result["joint_symmetry"] = intake.get("joint_symmetry") or ""
            result["axial_involvement"] = intake.get("axial_involvement") or ""
    except Exception as e:
        logger.warning(f"Joint map: intake lookup failed for {patient_id}: {e}")

    return {"status": "success", "data": result}


# ═════════════════════════════════════════════════════════════════════════════
# 2. EXTRACT FIELDS FROM DICTATION
# ═════════════════════════════════════════════════════════════════════════════

JOINT_MAP_EXTRACT_PROMPT = f"""
You are a clinical assistant extracting a structured rheumatology joint
examination from a doctor's spoken/dictated note. Only extract what is
clearly stated — never guess a joint's status if it isn't mentioned.

Return a JSON object with these optional keys:

  - "joints": an object mapping joint IDs to status. Valid joint IDs are
    exactly these (use "_L" for left, "_R" for right):
    {json.dumps(JOINT_IDS)}
    Valid status values: "tender", "swollen", "tender_swollen".
    Only include a joint ID if the dictation states it is tender and/or
    swollen. Do not include joints not mentioned. Map plain-language
    descriptions to IDs, e.g. "both wrists swollen" -> wrist_L and
    wrist_R both "swollen"; "left knee tender and swollen" -> knee_L:
    "tender_swollen"; "MCP joints of the right hand tender" -> mcp1_R
    through mcp5_R each "tender" if the dictation implies all of them,
    otherwise only the specific ones named.

  - "enthesitis_sites": list of matching strings from exactly:
    {sorted(ENTHESITIS_SITES_ALLOWED)}

  - "dactylitis_digits": list of short strings naming affected digits
    (e.g. ["right 3rd finger", "left 2nd toe"])

  - "axial_involvement": one of {sorted(AXIAL_ALLOWED)}

  - "rom_limitation": free text describing any range-of-motion limitation

  - "pain_severity": integer 0-10 (0 = no pain, 10 = worst possible pain)

  - "functional_impact": free text describing impact on daily activities

Rules:
- Do NOT invent joint findings, enthesitis sites, or digits not stated.
- Return valid JSON only — no markdown, no commentary, no extra keys.
"""


@router.post("/rheumatology-joint-map/extract-fields")
async def extract_joint_map_fields(payload: dict):
    """
    Expected payload:
    { "doctor_id": "...", "patient_id": "...", "dictation": "free text" }

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
                {"role": "system", "content": JOINT_MAP_EXTRACT_PROMPT},
                {"role": "user", "content": dictation},
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )
        raw_content = completion.choices[0].message.content
        try:
            parsed = json.loads(raw_content)
        except (json.JSONDecodeError, TypeError):
            logger.error(f"Joint map extract-fields returned non-JSON: {raw_content}")
            parsed = {}
        if not isinstance(parsed, dict):
            parsed = {}

        clean = {}

        if isinstance(parsed.get("joints"), dict):
            valid_joints = {
                jid: status for jid, status in parsed["joints"].items()
                if jid in JOINT_IDS and status in JOINT_STATUS_ALLOWED
            }
            if valid_joints:
                clean["joints"] = valid_joints

        if isinstance(parsed.get("enthesitis_sites"), list):
            sites = [s for s in parsed["enthesitis_sites"] if s in ENTHESITIS_SITES_ALLOWED]
            if sites:
                clean["enthesitis_sites"] = sites

        if isinstance(parsed.get("dactylitis_digits"), list):
            digits = [str(d)[:60] for d in parsed["dactylitis_digits"] if str(d).strip()]
            if digits:
                clean["dactylitis_digits"] = digits[:20]

        if str(parsed.get("axial_involvement")) in AXIAL_ALLOWED:
            clean["axial_involvement"] = str(parsed["axial_involvement"])

        if parsed.get("rom_limitation"):
            clean["rom_limitation"] = str(parsed["rom_limitation"])[:1000]

        if "pain_severity" in parsed:
            try:
                val = int(parsed["pain_severity"])
                if 0 <= val <= 10:
                    clean["pain_severity"] = val
            except (TypeError, ValueError):
                pass

        if parsed.get("functional_impact"):
            clean["functional_impact"] = str(parsed["functional_impact"])[:1000]

        return {"status": "success", "finaloutput": clean}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Joint map extract-fields failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 3. SAVE
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-joint-map/save")
async def save_joint_map(payload: dict):
    """
    Expected payload (from RheumatologyJointMap.jsx's onSave):
    {
        "patient_id": "...",
        "doctor_id": "...",
        "jointMap": {
            "joints": { "wrist_L": "swollen", ... },
            "enthesitis_sites": [...],
            "dactylitis_digits": [...],
            "axial_involvement": "...",
            "rom_limitation": "...",
            "pain_severity": 0-10,
            "functional_impact": "..."
        }
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        joint_map = payload.get("jointMap") or {}

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if not joint_map:
            raise HTTPException(status_code=400, detail="jointMap is required")

        # Defensive filter — never persist a joint ID/status outside the
        # canonical vocabulary, even if the frontend sent something stale.
        joints = joint_map.get("joints") or {}
        joint_map["joints"] = {
            jid: status for jid, status in joints.items()
            if jid in JOINT_IDS and status in JOINT_STATUS_ALLOWED
        }

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "joint_map": joint_map,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
            "type": "rheumatology_joint_map",
        }
        result = await joint_map_collection.insert_one(document)

        return {
            "status": "success",
            "message": "Joint map saved",
            "id": str(result.inserted_id),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 4. HISTORY
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-joint-map/history/{patient_id}/{doctor_id}")
async def get_joint_map_history(patient_id: str, doctor_id: str):
    """
    Fetch all Joint Map records for a patient, most recent first.
    Used by both the form (to preload the last mannequin state as a
    starting point for a follow-up visit) and a future read-only summary.
    """
    try:
        cursor = joint_map_collection.find(
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