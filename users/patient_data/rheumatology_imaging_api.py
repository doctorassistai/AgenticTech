"""
rheumatology_imaging_api.py
─────────────────────────────────────────────────────────────────────────────
DoctorAssist.AI — Rheumatology AI Workflow, Module 11: Imaging
Intelligence (v1.0).

The roadmap describes this module as comparing current imaging to
previous imaging — e.g. turning "Previous: mild synovitis / Current:
increased synovitis + new erosive change" into a plain-language
correlation with disease activity and treatment history. That requires
actual structured, longitudinal imaging FINDINGS, which nothing upstream
captures (imaging studies elsewhere in the app are viewed as files via
DICOMViewer/uploads, not stored as structured per-region findings). So,
same shape as Module 5 (Lab Trend Intelligence): this module owns both a
manual structured study-entry step (the doctor's or radiologist's
structured read of a study) and the comparison-analysis engine on top of
it.

Mirrors rheumatology_lab_trends_api.py's route shape and
naming/response/error-handling convention 1:1 — replace "lab result"
with "imaging study" and "trend" with "comparison".

ROUTES IN THIS FILE
---------------------
  POST   /rheumatology-imaging/add-study
  DELETE /rheumatology-imaging/study/{study_id}
  GET    /rheumatology-imaging/studies/{patient_id}/{doctor_id}
  POST   /rheumatology-imaging/compare
  POST   /rheumatology-imaging/save-comparison
  GET    /rheumatology-imaging/history/{patient_id}/{doctor_id}

⚠️ ASSUMPTIONS MADE WHILE ASSEMBLING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. ROUTER MOUNT: same convention as the other ten rheumatology files —
     `prefix="/context"`, mount with `app.include_router(...)` in
     main.py.

  2. COLLECTION NAMES: "rheumatology_imaging_studies" for the structured
     study log (one document per study, same one-document-per-entry
     reasoning as Module 5's ASSUMPTION #2 — trivial single-entry
     delete, no shared-array write races), and
     "rheumatology_imaging_comparisons" for saved comparison analyses.
     Change STUDIES_COLLECTION_NAME / COMPARISON_COLLECTION_NAME below
     if you want different names.

  3. NO PACS/DICOM INTEGRATION: this module does NOT parse pixel data
     or read the DICOMViewer/uploads store automatically. A study entry
     is a doctor's (or radiologist's, transcribed by the doctor) manual
     STRUCTURED READ of a study that's already been viewed elsewhere in
     the app — same manual-entry philosophy as Module 5's lab results.
     An optional `linked_upload_path` free-text field lets the doctor
     reference an already-uploaded file (e.g. "/uploads/xray_2026-01.jpg")
     for their own cross-reference, but nothing here fetches or analyzes
     that file's contents.

  4. REGION VOCABULARY IS SEPARATE FROM MODULE 2's 28-JOINT SET:
     imaging is routinely ordered for regions Module 2's DAS28 exam
     mannequin doesn't cover (axial spine, sacroiliac joints, composite
     "both hands"/"both feet" views). REGION_ALLOWED below is its own
     closed list — where it overlaps peripheral joints it reuses Module
     2's naming pattern for consistency (e.g. "wrist_L"), but the two
     lists are NOT identical or interchangeable; don't assume a region
     string here will match a JOINT_IDS entry in rheumatology_joint_map_api.py.

  5. FOUR FIXED FINDING FIELDS, NOT MODALITY-AWARE: every study is
     scored on the same four closed-vocabulary fields — synovitis grade,
     erosion, joint space narrowing, bone marrow edema — chosen as the
     imaging findings most consistently relevant to inflammatory
     arthritis activity/damage tracking across X-ray/Ultrasound/MRI/CT.
     Not every field is meaningful for every modality (bone marrow
     edema is effectively MRI-only; erosion is best seen on X-ray, MRI,
     or high-resolution ultrasound). This file does NOT enforce
     modality-specific field masking — the frontend should visually
     de-emphasize non-applicable fields per modality, and the doctor is
     trusted to leave a non-applicable field at its default ("None" /
     "Absent") rather than guess at it.

  6. COMPARISON DIRECTION IS DETERMINISTIC, NOT LLM-DECIDED: computed
     from a fixed-weight composite severity score per study — synovitis
     0-3, erosion +2 if present, joint space narrowing +1 if present,
     bone marrow edema +2 if present (weighted higher because erosion
     and bone marrow edema represent structural/inflammatory findings
     of greater clinical weight than a synovitis grade alone) — see
     `_composite_severity()` / `_compare_region()`. Comparing the
     composite score across the two most relevant studies for a region
     yields "worsening" / "improving" / "stable". The LLM is never asked
     to decide the direction — only, optionally, to phrase a narrative
     describing a direction that's already been computed, the same way
     Module 5's lab-trend narrative works, correlated with current
     medications and working diagnosis for context.

  7. SAME-MODALITY PREFERENCE, CROSS-MODALITY FALLBACK: comparison
     prefers the two most recent studies of the SAME modality for a
     region (an ultrasound-to-ultrasound comparison is more meaningful
     than ultrasound-to-MRI). If fewer than 2 same-modality studies
     exist for that region, it falls back to the two most recent studies
     of ANY modality for that region and flags `"cross_modality": true`
     on that comparison entry so the doctor can weight it accordingly.

  8. REQUIRES ≥2 COMPARABLE STUDIES PER REGION: exactly like Module 5,
     a region with only one study on file has nothing to compare —
     /compare silently skips it and reports it in `skipped_regions`
     rather than erroring the whole request.

  9. TREATMENT CONTEXT FOR NARRATIVES: same as Module 5's ASSUMPTION #4
     — pulls the most recent documentation-medication-analysis
     prescriptions (deterministic string join, no extra LLM call) and
     Module 3's most recent working_diagnosis, both optional context.

 10. NO AUTOMATIC ALERTING: this module produces a narrative for doctor
     review only; it does not push notifications or badge the chart
     elsewhere automatically, same as Module 5's ASSUMPTION #6.
─────────────────────────────────────────────────────────────────────────
"""

import os
import json
import logging
from datetime import datetime
from typing import Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, HTTPException
from motor.motor_asyncio import AsyncIOMotorClient
from groq import Groq

logger = logging.getLogger(__name__)

# ─── Mongo setup ────────────────────────────────────────────────────────────
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

STUDIES_COLLECTION_NAME = "rheumatology_imaging_studies"          # see ASSUMPTION #2
COMPARISON_COLLECTION_NAME = "rheumatology_imaging_comparisons"

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    imaging_studies_collection = database[STUDIES_COLLECTION_NAME]
    imaging_comparison_collection = database[COMPARISON_COLLECTION_NAME]
    documentation_medication_analysis_collection = database["documentation-medication-analysis"]
    differential_collection = database["rheumatology_differential_diagnosis"]
except Exception as e:
    logger.error(f"Error initializing MongoDB in rheumatology_imaging_api: {e}")

# ─── Groq setup ─────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client: Optional[Groq] = None
try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        logger.warning("GROQ_API_KEY not set — imaging comparison LLM endpoints will fail at call time.")
except Exception as e:
    logger.error(f"Error initializing Groq client in rheumatology_imaging_api: {e}")

router = APIRouter(prefix="/context", tags=["Rheumatology Imaging Intelligence"])

# ─── Closed vocabularies — see ASSUMPTIONS #4, #5 ────────────────────────────
MODALITY_ALLOWED = {"X-ray", "Ultrasound", "MRI", "CT"}

_SIDES = ["L", "R"]
REGION_ALLOWED = (
    [f"shoulder_{s}" for s in _SIDES]
    + [f"elbow_{s}" for s in _SIDES]
    + [f"wrist_{s}" for s in _SIDES]
    + [f"hand_{s}" for s in _SIDES]
    + [f"knee_{s}" for s in _SIDES]
    + [f"ankle_{s}" for s in _SIDES]
    + [f"foot_{s}" for s in _SIDES]
    + [f"hip_{s}" for s in _SIDES]
    + ["Sacroiliac joints", "Cervical spine", "Thoracic spine", "Lumbar spine", "Both hands (composite)", "Both feet (composite)"]
)
REGION_ALLOWED_SET = set(REGION_ALLOWED)

GRADE_LEVELS = {"None": 0, "Mild": 1, "Moderate": 2, "Severe": 3}
PRESENT_ABSENT = {"Absent": 0, "Present": 1}

# ─── Modality-specific finding schemas — replaces the old one-size-fits-all
# 4-field form. Each modality only exposes the fields clinically relevant to
# it, matching the PDF's per-modality finding lists (X-ray / Ultrasound /
# MRI). "type": "grade" uses GRADE_LEVELS (None/Mild/Moderate/Severe),
# "type": "present_absent" uses PRESENT_ABSENT (Absent/Present). "weight" is
# the composite-severity multiplier — grade fields contribute 0-3*weight,
# present_absent fields contribute 0 or 1*weight. No data has been stored
# under the old schema yet, so this is a clean replacement, not a migration.
MODALITY_FIELD_SCHEMA = {
    "X-ray": {
        "joint_space_narrowing": {"type": "present_absent", "weight": 1},
        "erosion": {"type": "present_absent", "weight": 2},
        "osteophytes": {"type": "present_absent", "weight": 1},
        "deformity": {"type": "present_absent", "weight": 2},
        "ankylosis": {"type": "present_absent", "weight": 2},
        "sacroiliitis": {"type": "grade", "weight": 2},
        "periarticular_osteopenia": {"type": "present_absent", "weight": 1},
    },
    "Ultrasound": {
        "synovitis": {"type": "grade", "weight": 1},
        "effusion": {"type": "present_absent", "weight": 1},
        "tenosynovitis": {"type": "present_absent", "weight": 1},
        "enthesitis": {"type": "present_absent", "weight": 1},
        "power_doppler_activity": {"type": "grade", "weight": 2},
        "erosion": {"type": "present_absent", "weight": 2},
    },
    "MRI": {
        "bone_marrow_edema": {"type": "present_absent", "weight": 2},
        "synovitis": {"type": "grade", "weight": 1},
        "erosion": {"type": "present_absent", "weight": 2},
        "enthesitis": {"type": "present_absent", "weight": 1},
        "sacroiliitis": {"type": "grade", "weight": 2},
        "structural_lesion": {"type": "present_absent", "weight": 2},
    },
    "CT": {
        # CT shares X-ray's structural focus; no dedicated PDF list given,
        # so it reuses the structural-damage-relevant subset.
        "joint_space_narrowing": {"type": "present_absent", "weight": 1},
        "erosion": {"type": "present_absent", "weight": 2},
        "osteophytes": {"type": "present_absent", "weight": 1},
        "structural_lesion": {"type": "present_absent", "weight": 2},
    },
}


def _composite_severity(modality: str, finding: dict) -> int:
    schema = MODALITY_FIELD_SCHEMA.get(modality, {})
    score = 0
    for field, spec in schema.items():
        raw_val = finding.get(field)
        if spec["type"] == "grade":
            score += GRADE_LEVELS.get(raw_val, 0) * spec["weight"]
        else:
            score += PRESENT_ABSENT.get(raw_val, 0) * spec["weight"]
    return score


def _clean_finding(modality: str, raw: dict) -> dict:
    """Validates/defaults only the fields relevant to this modality — any
    field not in that modality's schema is dropped, so a study's `finding`
    dict never carries irrelevant keys."""
    raw = raw or {}
    schema = MODALITY_FIELD_SCHEMA.get(modality, {})
    cleaned = {}
    for field, spec in schema.items():
        allowed = GRADE_LEVELS if spec["type"] == "grade" else PRESENT_ABSENT
        default = "None" if spec["type"] == "grade" else "Absent"
        cleaned[field] = raw.get(field) if raw.get(field) in allowed else default
    return cleaned


# ═════════════════════════════════════════════════════════════════════════════
# 1. ADD / DELETE / FETCH STUDIES
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-imaging/add-study")
async def add_imaging_study(payload: dict):
    """
    Expected payload:
    {
        "patient_id": "...", "doctor_id": "...",
        "modality": "Ultrasound",          # must be in MODALITY_ALLOWED
        "region": "wrist_R",               # must be in REGION_ALLOWED
        "date": "2026-08-01",              # YYYY-MM-DD, defaults to today if omitted
        "finding": {
            # Field set depends on modality — see MODALITY_FIELD_SCHEMA.
            # Example for Ultrasound:
            "synovitis": "Moderate",              # None/Mild/Moderate/Severe
            "effusion": "Absent",                  # Absent/Present
            "tenosynovitis": "Absent",             # Absent/Present
            "enthesitis": "Absent",                # Absent/Present
            "power_doppler_activity": "None",      # None/Mild/Moderate/Severe
            "erosion": "Absent"                    # Absent/Present
        },
        "radiologist_impression": "optional free text, context only",
        "linked_upload_path": "optional, e.g. /uploads/xray_2026-01.jpg"
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        modality = str(payload.get("modality", ""))
        region = str(payload.get("region", ""))
        date_str = payload.get("date") or datetime.utcnow().strftime("%Y-%m-%d")
        radiologist_impression = payload.get("radiologist_impression") or ""
        linked_upload_path = payload.get("linked_upload_path") or ""

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if modality not in MODALITY_ALLOWED:
            raise HTTPException(status_code=400, detail=f"modality must be one of: {sorted(MODALITY_ALLOWED)}")
        if region not in REGION_ALLOWED_SET:
            raise HTTPException(status_code=400, detail=f"region must be one of: {REGION_ALLOWED}")
        try:
            datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="date must be in YYYY-MM-DD format")

        finding = _clean_finding(modality, payload.get("finding") or {})

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "modality": modality,
            "region": region,
            "date": date_str,
            "finding": finding,
            "finding_schema": {k: v["type"] for k, v in MODALITY_FIELD_SCHEMA.get(modality, {}).items()},
            "composite_severity": _composite_severity(modality, finding),
            "radiologist_impression": str(radiologist_impression)[:500],
            "linked_upload_path": str(linked_upload_path)[:300],
            "created_at": datetime.utcnow(),
        }
        result = await imaging_studies_collection.insert_one(document)
        document["_id"] = str(result.inserted_id)
        document["created_at"] = document["created_at"].isoformat()

        return {"status": "success", "message": "Imaging study logged", "data": document}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/rheumatology-imaging/study/{study_id}")
async def delete_imaging_study(study_id: str):
    try:
        try:
            oid = ObjectId(study_id)
        except InvalidId:
            raise HTTPException(status_code=400, detail="Invalid study_id")

        result = await imaging_studies_collection.delete_one({"_id": oid})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Study not found")

        return {"status": "success", "message": "Imaging study deleted"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/rheumatology-imaging/field-schema")
async def get_imaging_field_schema():
    """Returns the modality → field-list schema so the frontend renders the
    right inputs per modality without duplicating MODALITY_FIELD_SCHEMA."""
    return {"status": "success", "data": MODALITY_FIELD_SCHEMA}


@router.get("/rheumatology-imaging/studies/{patient_id}/{doctor_id}")
async def get_imaging_studies(patient_id: str, doctor_id: str):
    """All logged studies for a patient, most recent first — feeds the study log UI."""
    try:
        cursor = imaging_studies_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("date", -1)

        records = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            if isinstance(doc.get("created_at"), datetime):
                doc["created_at"] = doc["created_at"].isoformat()
            records.append(doc)

        return {"status": "success", "count": len(records), "data": records}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 2. COMPARE
# ═════════════════════════════════════════════════════════════════════════════

def _compare_region(region: str, studies: list) -> Optional[dict]:
    """
    studies: list of study docs for one region, sorted by date descending.
    Picks the two most relevant studies per ASSUMPTION #7 and returns a
    deterministic comparison dict, or None if fewer than 2 studies exist.
    """
    if len(studies) < 2:
        return None

    same_modality_pairs = {}
    for s in studies:
        same_modality_pairs.setdefault(s["modality"], []).append(s)

    chosen_pair = None
    cross_modality = False
    for modality, group in same_modality_pairs.items():
        if len(group) >= 2:
            chosen_pair = (group[0], group[1])  # already sorted descending by caller
            break

    if chosen_pair is None:
        chosen_pair = (studies[0], studies[1])
        cross_modality = True

    current, previous = chosen_pair
    # Composite severity is only directly comparable when both studies used
    # the same modality's field schema — for a cross-modality fallback pair,
    # each side's score is computed under its OWN modality's weights (so a
    # "3" from an X-ray schema and a "3" from an MRI schema aren't really
    # the same scale). This is still reported (with cross_modality: true
    # already flagging the caveat to the doctor), same trade-off documented
    # in ASSUMPTION #7 for the whole cross-modality fallback path.
    current_score = _composite_severity(current["modality"], current["finding"])
    previous_score = _composite_severity(previous["modality"], previous["finding"])

    if current_score > previous_score:
        direction = "worsening"
    elif current_score < previous_score:
        direction = "improving"
    else:
        direction = "stable"

    # Field deltas: only compare fields present in BOTH studies' finding
    # dicts (same-modality pairs share every field; cross-modality pairs
    # only share whatever overlaps between the two schemas, e.g. "erosion"
    # appears in X-ray, Ultrasound, and MRI).
    field_deltas = []
    shared_fields = set(previous["finding"].keys()) & set(current["finding"].keys())
    for field in sorted(shared_fields):
        prev_val = previous["finding"].get(field)
        curr_val = current["finding"].get(field)
        if prev_val != curr_val:
            field_deltas.append(f"{field.replace('_', ' ').title()}: {prev_val} → {curr_val}")

    return {
        "region": region,
        "direction": direction,
        "cross_modality": cross_modality,
        "current_study": {"modality": current["modality"], "date": current["date"], "finding": current["finding"], "composite_severity": current_score},
        "previous_study": {"modality": previous["modality"], "date": previous["date"], "finding": previous["finding"], "composite_severity": previous_score},
        "field_deltas": field_deltas,
    }


IMAGING_NARRATIVE_PROMPT = """
You are a clinical assistant. You will be given a list of imaging
comparison results for a rheumatology patient — for each anatomical
region, the direction (worsening/improving/stable), the specific
findings that changed, and current medications / working diagnosis for
context. Direction and findings have already been decided by rule-based
logic, not by you.

Return a JSON object with exactly one key, "narrative": ONE short
paragraph (2-4 sentences) summarizing the overall imaging picture across
all regions listed, in plain language a physician can scan quickly.
Reference the actual region names and findings given. Where relevant,
you may note that a finding trend appears to correlate (or not) with the
current medications/working diagnosis provided, but only as a
description of what's in the data, not a new judgment.

Rules:
- Do NOT change, soften, or second-guess the direction already assigned
  to any region — describe it, don't re-evaluate it.
- Do NOT recommend a treatment change or next imaging study — that
  decision belongs to the physician.
- Do NOT invent findings not present in the input.
- If a comparison is cross_modality: true, mention that the comparison
  spans different imaging modalities so it should be interpreted with
  that in mind.
- Return valid JSON only — no markdown, no commentary, no extra keys.
"""


async def _get_current_medications_brief(patient_id: str) -> list:
    try:
        doc = await documentation_medication_analysis_collection.find_one(
            {"patient_id": patient_id}, sort=[("created_at", -1)]
        )
        if not doc:
            return []
        prescriptions = (doc.get("finaloutput") or {}).get("prescriptions") or []
        return [p.get("medication") or p.get("generic_name") or p.get("brand_name") for p in prescriptions if p]
    except Exception as e:
        logger.warning(f"Imaging: medication lookup failed for {patient_id}: {e}")
        return []


async def _get_working_diagnosis(patient_id: str, doctor_id: str) -> Optional[str]:
    try:
        doc = await differential_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        if doc:
            return doc.get("working_diagnosis")
    except Exception as e:
        logger.warning(f"Imaging: working diagnosis lookup failed for {patient_id}: {e}")
    return None


@router.post("/rheumatology-imaging/compare")
async def compare_imaging_studies(payload: dict):
    """
    Expected payload:
    { "doctor_id": "...", "patient_id": "..." }

    Returns:
    {
        "status": "success",
        "finaloutput": { "comparisons": [...] },
        "skipped_regions": ["knee_L"],   # regions with <2 studies
        "context_used": { "medications": [...], "working_diagnosis": "..." }
    }
    """
    if groq_client is None:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured on server")

    patient_id = payload.get("patient_id")
    doctor_id = payload.get("doctor_id")
    if not patient_id or not doctor_id:
        raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")

    cursor = imaging_studies_collection.find(
        {"patient_id": patient_id, "doctor_id": doctor_id}
    ).sort("date", -1)

    by_region = {}
    async for doc in cursor:
        by_region.setdefault(doc["region"], []).append(doc)

    comparisons = []
    skipped_regions = []
    for region, studies in by_region.items():
        comparison = _compare_region(region, studies)
        if comparison is None:
            skipped_regions.append(region)
        else:
            comparisons.append(comparison)

    if not comparisons:
        raise HTTPException(
            status_code=400,
            detail="No region has 2 or more comparable studies yet — add at least two studies for the same region to compare.",
        )

    medications = await _get_current_medications_brief(patient_id)
    working_diagnosis = await _get_working_diagnosis(patient_id, doctor_id)

    llm_input = {
        "comparisons": comparisons,
        "current_medications": medications,
        "working_diagnosis": working_diagnosis,
    }

    try:
        completion = groq_client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[
                {"role": "system", "content": IMAGING_NARRATIVE_PROMPT},
                {"role": "user", "content": json.dumps(llm_input, indent=2, default=str)},
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )
        raw_content = completion.choices[0].message.content
        try:
            parsed = json.loads(raw_content)
        except (json.JSONDecodeError, TypeError):
            logger.error(f"Imaging comparison narrative returned non-JSON: {raw_content}")
            parsed = {}
        if not isinstance(parsed, dict):
            parsed = {}

        narrative = str(parsed.get("narrative", "")).strip()[:600] or None

        return {
            "status": "success",
            "finaloutput": {"comparisons": comparisons, "narrative": narrative},
            "skipped_regions": skipped_regions,
            "context_used": {"medications": medications, "working_diagnosis": working_diagnosis},
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Imaging comparison failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 3. SAVE COMPARISON
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-imaging/save-comparison")
async def save_imaging_comparison(payload: dict):
    """
    Expected payload (doctor-reviewed/edited version):
    {
        "patient_id": "...", "doctor_id": "...",
        "comparisons": [ {region, direction, cross_modality, current_study, previous_study, field_deltas}, ... ],
        "narrative": "optional"
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        comparisons = payload.get("comparisons") or []
        narrative = payload.get("narrative") or ""

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if not isinstance(comparisons, list) or not comparisons:
            raise HTTPException(status_code=400, detail="comparisons is required and cannot be empty")

        clean_comparisons = []
        for item in comparisons:
            if not isinstance(item, dict):
                continue
            region = str(item.get("region", ""))
            if region not in REGION_ALLOWED_SET:
                continue
            direction = str(item.get("direction", ""))
            if direction not in ("worsening", "improving", "stable"):
                continue
            clean_comparisons.append({
                "region": region,
                "direction": direction,
                "cross_modality": bool(item.get("cross_modality", False)),
                "current_study": item.get("current_study") or {},
                "previous_study": item.get("previous_study") or {},
                "field_deltas": [str(f)[:200] for f in (item.get("field_deltas") or [])][:10],
            })

        if not clean_comparisons:
            raise HTTPException(status_code=400, detail="No valid comparisons to save")

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "comparisons": clean_comparisons,
            "narrative": str(narrative)[:600],
            "created_at": datetime.utcnow(),
            "type": "rheumatology_imaging_comparison",
        }
        result = await imaging_comparison_collection.insert_one(document)

        return {"status": "success", "message": "Imaging comparison saved", "id": str(result.inserted_id)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 4. HISTORY
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-imaging/history/{patient_id}/{doctor_id}")
async def get_imaging_comparison_history(patient_id: str, doctor_id: str):
    """Fetch all saved imaging comparison analyses for a patient, most recent first."""
    try:
        cursor = imaging_comparison_collection.find(
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