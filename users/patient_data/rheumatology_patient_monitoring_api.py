"""
rheumatology_patient_monitoring_api.py
─────────────────────────────────────────────────────────────────────────────
DoctorAssist.AI — Rheumatology AI Workflow, Module 17: Patient Monitoring
Agent (v1.0).

The roadmap frames this as: between visits, the patient reports pain,
stiffness, swelling, fatigue, function, medication adherence, and adverse
effects — the AI detects deterioration and flags it for the clinical team.

DoctorAssist.AI does not currently have a patient-facing portal/app (there
is no such surface anywhere in this codebase — every other rheumatology
module is doctor-entered through the doctor dashboard). So this module
follows the SAME "manual, doctor/staff-logged entry" philosophy as every
prior module: a check-in is logged by clinic staff on the patient's behalf
(phone triage call, nurse check-in call, portal message relayed by staff,
etc.) via `reported_by`, not captured through a live patient app. If a
patient-facing surface is built later, it would POST to the same
`/add-checkin` endpoint — the schema doesn't assume who is typing.

Per explicit instruction, this module does NOT implement an alerting/
notification pipeline (no push/SMS/email, no integration with the
`Notification` component seen in DoctorDashboard.jsx) — deterioration is
surfaced as a computed 🟢/🟡/🔴 status per domain, the same visible-in-the-UI
pattern Module 8 (DMARD Safety) and Module 14 (Steroid Stewardship) already
use, not as a pushed alert.

Like every prior module, every flag's category is computed by rule-based
code, NOT the LLM. The LLM only writes an optional plain-English narrative
describing flags that are already decided.

ROUTES IN THIS FILE
---------------------
  GET    /rheumatology-patient-monitoring/context-preview/{patient_id}/{doctor_id}
  POST   /rheumatology-patient-monitoring/add-checkin
  GET    /rheumatology-patient-monitoring/checkins/{patient_id}/{doctor_id}
  DELETE /rheumatology-patient-monitoring/checkin/{checkin_id}
  POST   /rheumatology-patient-monitoring/assess
  POST   /rheumatology-patient-monitoring/save
  GET    /rheumatology-patient-monitoring/history/{patient_id}/{doctor_id}

⚠️ ASSUMPTIONS MADE WHILE ASSEMBLING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. ROUTER MOUNT: same convention as the sixteen prior rheumatology files
     — `prefix="/context"`, mount with `app.include_router(...)` in
     main.py.

  2. COLLECTION NAMES: "rheumatology_patient_checkins" for the raw manual
     check-in log, "rheumatology_patient_monitoring_assessments" for saved
     reviewed assessments. Change CHECKIN_COLLECTION_NAME /
     ASSESSMENT_COLLECTION_NAME below if you want different names.

  3. NO PATIENT-FACING SURFACE, NO ALERT PIPELINE — see module docstring.
     Every check-in has a `reported_by` field (closed vocabulary: "Patient
     — phone call", "Patient — in clinic", "Caregiver", "Clinic staff
     observation") so it's clear this was relayed by staff, not
     self-submitted through a live app. No SMS/email/push is sent by this
     file — the computed status is only ever surfaced back to the doctor's
     own UI, same as Module 8/14's colored panels.

  4. PRO COMPOSITE IS RAPID3-STYLE, NOT THE VALIDATED RAPID3: RAPID3
     (Routine Assessment of Patient Index Data 3) is a real, published,
     validated composite of three 0-10 patient-reported items (pain,
     patient global assessment, physical function) with standard severity
     bands. This module asks for pain (0-10) and patient global assessment
     (0-10) directly, matching RAPID3's first two components. Its third
     component is normally derived from the 10-item MDHAQ function
     questionnaire, which this codebase does not implement anywhere — so
     this module substitutes a single-item "function/difficulty with daily
     tasks" VAS (0-10) doctor/staff records instead. The result is
     reported as "RAPID3-style composite" with the real published banding
     applied to the same 0-30 sum-of-three scale (Near remission 0-3, Low
     3.1-6, Moderate 6.1-12, High 12.1-30) — but flagged clearly as an
     approximation, not the validated instrument, because of the
     function-item substitution. If a full MDHAQ is ever added, swap the
     function input the same way Module 6's ASSUMPTION #4 describes for
     PtGA.

  5. DOMAIN-LEVEL FLAGS ARE INDEPENDENT, RULE-BASED HEURISTICS, NOT
     VALIDATED CLINICAL RULES (same caveat as every prior module's
     threshold assumptions) — see `_evaluate_checkin()`:
       - Pain (0-10): escalation vs the previous check-in ≥3 points, OR an
         absolute value ≥7 regardless of trend → red; escalation of 1-2
         points → yellow; stable/improved and <7 → green.
       - Morning stiffness (minutes): ≥60 min → red (a widely used
         inflammatory-arthritis cutoff), 30-59 min → yellow, <30 min →
         green. This mirrors the same "≥30-60 min inflammatory stiffness"
         convention used informally across rheumatology guidance, not a
         DoctorAssist-specific number.
       - Swelling (new/increased swollen-joint count vs previous
         check-in): ≥3 newly/more-swollen joints → red, 1-2 → yellow, 0 →
         green. If there is no previous check-in, any reported swelling
         >0 is yellow (can't establish a trend yet).
       - Fatigue (0-10): same escalation logic as pain but with a lower
         bar since fatigue is noisier day-to-day — escalation ≥4 points OR
         absolute ≥8 → red; escalation 2-3 points → yellow; else green.
       - Function/difficulty (0-10): same escalation logic as fatigue.
       - Medication adherence (closed vocabulary): "Taking as prescribed"
         → green; "Missed some doses" → yellow; "Stopped taking" → red.
       - Adverse effects: none reported → green; reported, doctor marks
         "Mild/Moderate" → yellow; doctor marks "Severe" → red.
       - Hospitalization since last check-in: Yes → red (unconditionally
         — a hospitalization is always safety-critical regardless of
         reported reason). No → green.
       - Infection since last check-in: Yes → red (unconditionally, same
         reasoning as Module 8's infection-screening checklist items for
         immunosuppressed patients). No → green.
     OVERALL status = the single worst (highest-severity) domain flag —
     same "worst flag wins" rollup Module 15 uses for its safety rollup.
     The LLM never decides any of this — only, optionally, phrases a
     narrative describing flags that are already decided.

  6. TREND COMPARISONS USE THE IMMEDIATELY PREVIOUS CHECK-IN ONLY, not a
     longer rolling window — same "keep it simple, flag rather than
     guess" convention as every prior module's fixed-window caveats
     (e.g. Module 14's rolling-365-day window, Module 10's flare-window
     assumptions).

  7. THIS MODULE DOES NOT CROSS-REFERENCE MODULE 6's DISEASE ACTIVITY OR
     MODULE 10's FLARE PREDICTION — it is scoped to patient-reported data
     between visits, per the roadmap's own framing. A doctor wanting the
     clinician-measured picture already has Modules 6/10/15/16 for that;
     this module deliberately stays a separate, independent signal rather
     than blending self-report with clinician-measured scores into one
     number.

  8. NARRATIVE IS OPTIONAL AND NEVER RECOMMENDS A SPECIFIC ACTION: same
     pattern as every prior rheumatology module's narrative step —
     describes the already-decided flags, never suggests a specific
     medication change or intervention (that stays with the physician).

  9. ENTRY POINT: per instruction, this module is reached from a new
     Rheumatology-only option in ProcedureNotes.jsx's procedure dropdown
     ("Rheumatology Patient Monitoring"), not from the rheum-workflow tab
     alongside the other 16 modules — see the accompanying frontend
     changes. The API itself doesn't care which screen calls it.
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

CHECKIN_COLLECTION_NAME = "rheumatology_patient_checkins"                       # see ASSUMPTION #2
ASSESSMENT_COLLECTION_NAME = "rheumatology_patient_monitoring_assessments"

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    checkin_collection = database[CHECKIN_COLLECTION_NAME]
    monitoring_assessment_collection = database[ASSESSMENT_COLLECTION_NAME]
except Exception as e:
    logger.error(f"Error initializing MongoDB in rheumatology_patient_monitoring_api: {e}")

# ─── Groq setup ─────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client: Optional[Groq] = None
try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        logger.warning("GROQ_API_KEY not set — patient monitoring narrative will be skipped (flags still compute).")
except Exception as e:
    logger.error(f"Error initializing Groq client in rheumatology_patient_monitoring_api: {e}")

router = APIRouter(prefix="/context", tags=["Rheumatology Patient Monitoring"])

# ─── Closed vocabularies ──────────────────────────────────────────────────────
REPORTED_BY_ALLOWED = {"Patient — phone call", "Patient — in clinic", "Caregiver", "Clinic staff observation"}
ADHERENCE_ALLOWED = {"Taking as prescribed", "Missed some doses", "Stopped taking"}
ADVERSE_EFFECT_SEVERITY_ALLOWED = {"Mild", "Moderate", "Severe"}
YES_NO = {"Yes", "No"}

DOMAINS = [
    "pain", "morning_stiffness", "swelling", "fatigue", "function",
    "medication_adherence", "adverse_effects", "hospitalization", "infection",
]
SEVERITY_RANK = {"green": 0, "yellow": 1, "red": 2}


# ═════════════════════════════════════════════════════════════════════════════
# 1. CONTEXT PREVIEW
# ═════════════════════════════════════════════════════════════════════════════

async def _get_previous_checkin(patient_id: str, doctor_id: str) -> Optional[dict]:
    try:
        return await checkin_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
    except Exception as e:
        logger.warning(f"Patient monitoring: previous check-in lookup failed for {patient_id}: {e}")
        return None


@router.get("/rheumatology-patient-monitoring/context-preview/{patient_id}/{doctor_id}")
async def get_monitoring_context_preview(patient_id: str, doctor_id: str):
    """Read-only preview of the previous check-in, for reference while logging a new one."""
    previous = await _get_previous_checkin(patient_id, doctor_id)
    if previous:
        previous["_id"] = str(previous["_id"])
        if isinstance(previous.get("created_at"), datetime):
            previous["created_at"] = previous["created_at"].isoformat()
    return {"status": "success", "data": {"previous_checkin": previous}}


# ═════════════════════════════════════════════════════════════════════════════
# 2. CHECK-IN LOG (add / list / delete)
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-patient-monitoring/add-checkin")
async def add_patient_checkin(payload: dict):
    """
    Expected payload:
    {
        "patient_id": "...", "doctor_id": "...",
        "report_date": "2026-08-11",           # YYYY-MM-DD, defaults to today
        "reported_by": "Patient — phone call",  # see REPORTED_BY_ALLOWED
        "pain": 0-10,
        "patient_global_assessment": 0-10,      # see ASSUMPTION #4
        "morning_stiffness_minutes": int,
        "swollen_joint_count": int,             # patient-reported estimate
        "fatigue": 0-10,
        "function_difficulty": 0-10,
        "medication_adherence": "Taking as prescribed" | "Missed some doses" | "Stopped taking",
        "adverse_effects_reported": bool,
        "adverse_effects_description": "optional free text",
        "adverse_effects_severity": "Mild"|"Moderate"|"Severe" (required if adverse_effects_reported),
        "hospitalization_since_last_checkin": "Yes"|"No",
        "hospitalization_reason": "optional free text",
        "infection_since_last_checkin": "Yes"|"No",
        "notes": "optional free text"
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        report_date = payload.get("report_date") or datetime.utcnow().strftime("%Y-%m-%d")
        reported_by = str(payload.get("reported_by", ""))

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if reported_by not in REPORTED_BY_ALLOWED:
            raise HTTPException(status_code=400, detail=f"reported_by must be one of: {sorted(REPORTED_BY_ALLOWED)}")
        try:
            datetime.strptime(report_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="report_date must be in YYYY-MM-DD format")

        def _vas(field_name):
            val = payload.get(field_name)
            try:
                val = float(val)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"{field_name} must be numeric (0-10)")
            if not (0 <= val <= 10):
                raise HTTPException(status_code=400, detail=f"{field_name} must be between 0 and 10")
            return val

        pain = _vas("pain")
        patient_global_assessment = _vas("patient_global_assessment")
        fatigue = _vas("fatigue")
        function_difficulty = _vas("function_difficulty")

        try:
            morning_stiffness_minutes = int(payload.get("morning_stiffness_minutes", 0))
            if morning_stiffness_minutes < 0:
                raise ValueError
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="morning_stiffness_minutes must be a non-negative integer")

        try:
            swollen_joint_count = int(payload.get("swollen_joint_count", 0))
            if swollen_joint_count < 0:
                raise ValueError
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="swollen_joint_count must be a non-negative integer")

        medication_adherence = str(payload.get("medication_adherence", ""))
        if medication_adherence not in ADHERENCE_ALLOWED:
            raise HTTPException(status_code=400, detail=f"medication_adherence must be one of: {sorted(ADHERENCE_ALLOWED)}")

        adverse_effects_reported = bool(payload.get("adverse_effects_reported", False))
        adverse_effects_severity = str(payload.get("adverse_effects_severity", ""))
        if adverse_effects_reported and adverse_effects_severity not in ADVERSE_EFFECT_SEVERITY_ALLOWED:
            raise HTTPException(status_code=400, detail=f"adverse_effects_severity must be one of: {sorted(ADVERSE_EFFECT_SEVERITY_ALLOWED)} when adverse_effects_reported is true")

        hospitalization = str(payload.get("hospitalization_since_last_checkin", "No"))
        if hospitalization not in YES_NO:
            raise HTTPException(status_code=400, detail="hospitalization_since_last_checkin must be Yes/No")

        infection = str(payload.get("infection_since_last_checkin", "No"))
        if infection not in YES_NO:
            raise HTTPException(status_code=400, detail="infection_since_last_checkin must be Yes/No")

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "report_date": report_date,
            "reported_by": reported_by,
            "pain": pain,
            "patient_global_assessment": patient_global_assessment,
            "morning_stiffness_minutes": morning_stiffness_minutes,
            "swollen_joint_count": swollen_joint_count,
            "fatigue": fatigue,
            "function_difficulty": function_difficulty,
            "medication_adherence": medication_adherence,
            "adverse_effects_reported": adverse_effects_reported,
            "adverse_effects_description": str(payload.get("adverse_effects_description") or "")[:500],
            "adverse_effects_severity": adverse_effects_severity if adverse_effects_reported else "",
            "hospitalization_since_last_checkin": hospitalization,
            "hospitalization_reason": str(payload.get("hospitalization_reason") or "")[:500],
            "infection_since_last_checkin": infection,
            "notes": str(payload.get("notes") or "")[:1000],
            "created_at": datetime.utcnow(),
        }
        result = await checkin_collection.insert_one(document)

        return {"status": "success", "message": "Check-in logged", "id": str(result.inserted_id)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/rheumatology-patient-monitoring/checkins/{patient_id}/{doctor_id}")
async def list_patient_checkins(patient_id: str, doctor_id: str):
    """List all logged check-ins for a patient, most recent first."""
    try:
        cursor = checkin_collection.find(
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


@router.delete("/rheumatology-patient-monitoring/checkin/{checkin_id}")
async def delete_patient_checkin(checkin_id: str):
    """Removes a single mistaken/duplicate check-in entry."""
    try:
        try:
            oid = ObjectId(checkin_id)
        except InvalidId:
            raise HTTPException(status_code=400, detail="Invalid checkin_id")

        result = await checkin_collection.delete_one({"_id": oid})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Check-in not found")

        return {"status": "success", "message": "Check-in deleted"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 3. ASSESS — deterministic rule engine + optional narrative
# ═════════════════════════════════════════════════════════════════════════════

def _vas_trend_flag(current: float, previous: Optional[float], escalation_red: float, escalation_yellow: float, absolute_red: float) -> str:
    """Shared escalation logic for pain/fatigue/function — see ASSUMPTION #5."""
    if current >= absolute_red:
        return "red"
    if previous is None:
        return "green"
    delta = current - previous
    if delta >= escalation_red:
        return "red"
    if delta >= escalation_yellow:
        return "yellow"
    return "green"


def _evaluate_checkin(checkin: dict, previous: Optional[dict]) -> dict:
    """Returns {domains: [...], overall_status, rapid3_style: {...}} — see ASSUMPTIONS #4-5."""
    domains = []

    # Pain
    pain_status = _vas_trend_flag(checkin["pain"], previous.get("pain") if previous else None, escalation_red=3, escalation_yellow=1, absolute_red=7)
    pain_reasons = [f"Current pain {checkin['pain']}/10"]
    if previous:
        pain_reasons.append(f"Previous pain {previous.get('pain')}/10 ({checkin['report_date']} vs {previous.get('report_date')})")
    domains.append({"domain": "pain", "category": pain_status, "reasons": pain_reasons})

    # Morning stiffness
    stiffness_min = checkin["morning_stiffness_minutes"]
    if stiffness_min >= 60:
        stiffness_status = "red"
    elif stiffness_min >= 30:
        stiffness_status = "yellow"
    else:
        stiffness_status = "green"
    domains.append({"domain": "morning_stiffness", "category": stiffness_status, "reasons": [f"Morning stiffness {stiffness_min} minutes"]})

    # Swelling
    current_swollen = checkin["swollen_joint_count"]
    prev_swollen = previous.get("swollen_joint_count") if previous else None
    if prev_swollen is None:
        swelling_status = "yellow" if current_swollen > 0 else "green"
        swelling_reasons = [f"{current_swollen} swollen joint(s) reported — no previous check-in to compare"]
    else:
        delta_swollen = current_swollen - prev_swollen
        if delta_swollen >= 3:
            swelling_status = "red"
        elif delta_swollen >= 1:
            swelling_status = "yellow"
        else:
            swelling_status = "green"
        swelling_reasons = [f"{current_swollen} swollen joint(s) reported (previous: {prev_swollen})"]
    domains.append({"domain": "swelling", "category": swelling_status, "reasons": swelling_reasons})

    # Fatigue
    fatigue_status = _vas_trend_flag(checkin["fatigue"], previous.get("fatigue") if previous else None, escalation_red=4, escalation_yellow=2, absolute_red=8)
    domains.append({"domain": "fatigue", "category": fatigue_status, "reasons": [f"Current fatigue {checkin['fatigue']}/10"]})

    # Function
    function_status = _vas_trend_flag(checkin["function_difficulty"], previous.get("function_difficulty") if previous else None, escalation_red=4, escalation_yellow=2, absolute_red=8)
    domains.append({"domain": "function", "category": function_status, "reasons": [f"Current function difficulty {checkin['function_difficulty']}/10"]})

    # Medication adherence
    adherence_map = {"Taking as prescribed": "green", "Missed some doses": "yellow", "Stopped taking": "red"}
    domains.append({"domain": "medication_adherence", "category": adherence_map[checkin["medication_adherence"]], "reasons": [checkin["medication_adherence"]]})

    # Adverse effects
    if not checkin["adverse_effects_reported"]:
        ae_status = "green"
        ae_reasons = ["No adverse effects reported"]
    else:
        ae_severity_map = {"Mild": "yellow", "Moderate": "yellow", "Severe": "red"}
        ae_status = ae_severity_map.get(checkin["adverse_effects_severity"], "yellow")
        ae_reasons = [f"Adverse effect reported ({checkin['adverse_effects_severity']}): {checkin['adverse_effects_description'] or 'no description given'}"]
    domains.append({"domain": "adverse_effects", "category": ae_status, "reasons": ae_reasons})

    # Hospitalization
    hosp_status = "red" if checkin["hospitalization_since_last_checkin"] == "Yes" else "green"
    hosp_reasons = [checkin["hospitalization_reason"] or "Hospitalization reported"] if hosp_status == "red" else ["No hospitalization reported"]
    domains.append({"domain": "hospitalization", "category": hosp_status, "reasons": hosp_reasons})

    # Infection
    infection_status = "red" if checkin["infection_since_last_checkin"] == "Yes" else "green"
    domains.append({"domain": "infection", "category": infection_status, "reasons": ["Infection reported since last check-in" if infection_status == "red" else "No infection reported"]})

    overall_status = max((d["category"] for d in domains), key=lambda c: SEVERITY_RANK[c])

    # RAPID3-style composite — see ASSUMPTION #4
    rapid3_sum = round(checkin["pain"] + checkin["patient_global_assessment"] + checkin["function_difficulty"], 1)
    if rapid3_sum <= 3:
        rapid3_band = "Near remission"
    elif rapid3_sum <= 6:
        rapid3_band = "Low severity"
    elif rapid3_sum <= 12:
        rapid3_band = "Moderate severity"
    else:
        rapid3_band = "High severity"

    return {
        "domains": domains,
        "overall_status": overall_status,
        "rapid3_style": {"sum": rapid3_sum, "band": rapid3_band, "note": "Approximation — function item is a single-item substitute for MDHAQ, see ASSUMPTION #4"},
    }


MONITORING_NARRATIVE_PROMPT = """
You are a clinical assistant. You will be given a between-visit patient
check-in for a rheumatology patient — pain, morning stiffness, swelling,
fatigue, function, medication adherence, adverse effects, hospitalization,
and infection status — each already flagged green/yellow/red by rule-based
logic, not by you, plus an overall status and a RAPID3-style composite
score/band. You may also be given the previous check-in for comparison.

Return a JSON object with exactly one key, "narrative": ONE short
paragraph (2-4 sentences) summarizing the check-in for a physician to
scan quickly before deciding whether to bring the patient in early.
Reference the actual domain names, values, and reasons given.

Rules:
- Do NOT change, soften, or second-guess the category already assigned to
  any domain or the overall status — describe it, don't re-evaluate it.
- Do NOT recommend a specific medication change, appointment timing, or
  intervention — that decision belongs to the physician.
- Do NOT invent findings not present in the input.
- Return valid JSON only — no markdown, no commentary, no extra keys.
"""


@router.post("/rheumatology-patient-monitoring/assess")
async def assess_patient_checkin(payload: dict):
    """
    Expected payload:
    { "doctor_id": "...", "patient_id": "...", "checkin_id": "..." }

    Assesses a specific already-logged check-in (by id) against the one
    immediately before it. Returns:
    {
        "status": "success",
        "finaloutput": { "domains": [...], "overall_status", "rapid3_style", "narrative": str|None }
    }
    """
    patient_id = payload.get("patient_id")
    doctor_id = payload.get("doctor_id")
    checkin_id = payload.get("checkin_id")
    if not patient_id or not doctor_id or not checkin_id:
        raise HTTPException(status_code=400, detail="Missing patient_id, doctor_id, or checkin_id")

    try:
        oid = ObjectId(checkin_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="Invalid checkin_id")

    checkin = await checkin_collection.find_one({"_id": oid, "patient_id": patient_id, "doctor_id": doctor_id})
    if not checkin:
        raise HTTPException(status_code=404, detail="Check-in not found")

    previous = await checkin_collection.find_one(
        {"patient_id": patient_id, "doctor_id": doctor_id, "created_at": {"$lt": checkin["created_at"]}},
        sort=[("created_at", -1)],
    )

    evaluation = _evaluate_checkin(checkin, previous)

    narrative = None
    if groq_client is not None:
        try:
            llm_input = {
                "domains": evaluation["domains"],
                "overall_status": evaluation["overall_status"],
                "rapid3_style": evaluation["rapid3_style"],
                "previous_checkin_date": previous.get("report_date") if previous else None,
            }
            completion = groq_client.chat.completions.create(
                model="openai/gpt-oss-120b",
                messages=[
                    {"role": "system", "content": MONITORING_NARRATIVE_PROMPT},
                    {"role": "user", "content": json.dumps(llm_input, indent=2, default=str)},
                ],
                temperature=0,
                response_format={"type": "json_object"},
            )
            parsed = json.loads(completion.choices[0].message.content)
            if isinstance(parsed, dict) and parsed.get("narrative"):
                narrative = str(parsed["narrative"])[:600]
        except Exception as e:
            logger.warning(f"Patient monitoring: narrative generation failed for {patient_id}: {e}")

    return {
        "status": "success",
        "finaloutput": {
            "checkin_id": str(checkin["_id"]),
            "domains": evaluation["domains"],
            "overall_status": evaluation["overall_status"],
            "rapid3_style": evaluation["rapid3_style"],
            "narrative": narrative,
        },
    }


# ═════════════════════════════════════════════════════════════════════════════
# 4. SAVE
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-patient-monitoring/save")
async def save_monitoring_assessment(payload: dict):
    """
    Expected payload (doctor-reviewed version of /assess's output):
    {
        "patient_id": "...", "doctor_id": "...",
        "checkin_id": "...",
        "domains": [ {domain, category, reasons}, ... ],
        "overall_status": "green"|"yellow"|"red",
        "rapid3_style": {...},
        "narrative": "optional"
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        checkin_id = payload.get("checkin_id")
        domains = payload.get("domains") or []
        overall_status = str(payload.get("overall_status", ""))
        rapid3_style = payload.get("rapid3_style") or {}
        narrative = payload.get("narrative") or ""

        if not patient_id or not doctor_id or not checkin_id:
            raise HTTPException(status_code=400, detail="Missing patient_id, doctor_id, or checkin_id")
        if not isinstance(domains, list) or not domains:
            raise HTTPException(status_code=400, detail="domains is required and cannot be empty")
        if overall_status not in ("green", "yellow", "red"):
            raise HTTPException(status_code=400, detail="overall_status must be green/yellow/red")

        clean_domains = []
        for item in domains:
            if not isinstance(item, dict):
                continue
            domain_name = str(item.get("domain", ""))
            if domain_name not in DOMAINS:
                continue
            category = str(item.get("category", ""))
            if category not in ("green", "yellow", "red"):
                continue
            clean_domains.append({
                "domain": domain_name,
                "category": category,
                "reasons": [str(r)[:300] for r in (item.get("reasons") or [])][:10],
            })

        if not clean_domains:
            raise HTTPException(status_code=400, detail="No valid domain entries to save")

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "checkin_id": checkin_id,
            "domains": clean_domains,
            "overall_status": overall_status,
            "rapid3_style": {
                "sum": rapid3_style.get("sum"),
                "band": str(rapid3_style.get("band", ""))[:50],
            },
            "narrative": str(narrative)[:600],
            "created_at": datetime.utcnow(),
            "type": "rheumatology_patient_monitoring_assessment",
        }
        result = await monitoring_assessment_collection.insert_one(document)

        return {"status": "success", "message": "Patient monitoring assessment saved", "id": str(result.inserted_id)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 5. HISTORY
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-patient-monitoring/history/{patient_id}/{doctor_id}")
async def get_monitoring_history(patient_id: str, doctor_id: str):
    """Fetch all saved patient monitoring assessments for a patient, most recent first."""
    try:
        cursor = monitoring_assessment_collection.find(
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