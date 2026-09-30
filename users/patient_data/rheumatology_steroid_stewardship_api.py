"""
rheumatology_steroid_stewardship_api.py
─────────────────────────────────────────────────────────────────────────────
DoctorAssist.AI — Rheumatology AI Workflow, Module 14: Steroid Stewardship
Agent (v1.0).

The roadmap frames this as tracking "every steroid exposure → dose →
duration → cumulative exposure" and flagging prolonged use, repeated
rescue courses, osteoporosis risk, infection risk, hyperglycemia risk,
and possible steroid-sparing opportunity. Nothing upstream captures
steroid courses as structured, dosed, dated data — Module 1 intake only
has a one-time `steroid_exposure.has_used` yes/no flag (see Module 13's
ASSUMPTION #3 for the same field). So, same shape as Modules 5/10/11/12:
this module owns a manual structured course-entry log (the doctor's own
record of a steroid course, not AI-detected) plus a deterministic
cumulative-exposure rule engine on top of it.

Like Modules 8/12/13, every flag category's status (🟢/🟡/🔴) is computed
by rule-based code, NOT the LLM. The LLM only writes an optional
plain-English narrative describing flags that are already decided.

Mirrors the naming/response/error-handling convention of the thirteen
prior rheumatology modules 1:1 — closest structurally to Module 12
(Extra-Articular Manifestations): context-preview → course log
(add/list/delete) → assess → save → history.

ROUTES IN THIS FILE
---------------------
  GET    /rheumatology-steroid-stewardship/context-preview/{patient_id}/{doctor_id}
  POST   /rheumatology-steroid-stewardship/add-course
  GET    /rheumatology-steroid-stewardship/courses/{patient_id}/{doctor_id}
  DELETE /rheumatology-steroid-stewardship/course/{course_id}
  POST   /rheumatology-steroid-stewardship/assess
  POST   /rheumatology-steroid-stewardship/save
  GET    /rheumatology-steroid-stewardship/history/{patient_id}/{doctor_id}

⚠️ ASSUMPTIONS MADE WHILE ASSEMBLING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. ROUTER MOUNT: same convention as the thirteen prior rheumatology
     files — `prefix="/context"`, mount with `app.include_router(...)`
     in main.py.

  2. COLLECTION NAMES: "rheumatology_steroid_courses" for the manual
     course log, "rheumatology_steroid_assessments" for saved
     stewardship reviews. Change STEROID_COURSE_COLLECTION_NAME /
     ASSESSMENT_COLLECTION_NAME below if you want different names.

  3. "COURSE" IS DOCTOR-LOGGED, NOT AI-DETECTED: same philosophy as
     Module 10's flare events / Module 12's manifestation events — a
     steroid course only enters the record via /add-course (drug,
     route, daily dose, start date, end date or "ongoing", indication).
     This module does not try to parse steroid mentions out of free-text
     notes or the medication ledger.

  4. INTAKE IS A HINT SOURCE ONLY: context-preview surfaces Module 1's
     `rheumatology_intake.steroid_exposure.has_used` flag and
     `comorbidities` list purely as read-only hints for the doctor
     (e.g. "steroid exposure reported at intake — log the course(s)
     below if not already captured"; diabetes-related comorbidity
     keywords are surfaced for context because they bear on the
     hyperglycemia flag, mirroring Module 13's keyword-hint pattern).
     Neither ever creates or edits a course automatically.

  5. PREDNISOLONE-EQUIVALENT CONVERSION IS A FIXED, STANDARD TABLE
     (see STEROID_DRUG_CONVERSION) — the commonly cited approximate
     equivalence ratios (e.g. 4mg methylprednisolone ≈ 5mg prednisolone,
     0.75mg dexamethasone ≈ 5mg prednisolone). This is a standard
     clinical approximation, not a personalized pharmacokinetic
     calculation — tell me if you want per-patient adjustment (e.g. for
     hepatic impairment) and I'll parameterize this.

  6. ALL SIX FLAGS ARE RULE-BASED, NOT LLM-DECIDED — see
     `_evaluate_steroid_stewardship()`. Every threshold below is a
     reasonable starting heuristic, not a validated clinical rule (same
     caveat as every prior module's chronicity/threshold assumptions):
       - Prolonged Use: total days on any steroid course within the
         trailing 365 days ≥ PROLONGED_USE_DAYS_THRESHOLD (90).
       - Repeated Rescue Courses: count of courses with
         indication="Rescue course" whose start_date falls in the
         trailing 365 days ≥ RESCUE_COURSE_COUNT_THRESHOLD (3).
       - Osteoporosis/Fracture Risk: trailing-365-day prednisolone-
         equivalent exposure — High if ≥90 days on steroid AND average
         daily dose during those days ≥5mg; Moderate if ≥30 days on
         steroid at any dose; else Low. Loosely mirrors the "≥2.5-7.5mg/
         day for ≥3 months warrants bone-health review" heuristic used
         in glucocorticoid-induced-osteoporosis guidance, deliberately
         simplified (no FRAX/DEXA integration — see Module 13's
         ASSUMPTION #6 for why this module doesn't attempt FRAX either).
       - Infection Risk: TODAY's active prednisolone-equivalent dose
         (summed across any concurrently active courses) — ≥10mg/day
         High, 5-9.9mg/day Moderate, <5mg/day or none Low.
       - Hyperglycemia Risk: same active-dose metric — ≥20mg/day High,
         7.5-19.9mg/day Moderate, <7.5mg/day Low; escalated one level
         if intake comorbidities keyword-match "diabetes"/"diabetic"
         (glucocorticoids compound existing glycemic risk).
       - Steroid-Sparing Opportunity: flagged (not a severity level,
         a yes/no signal) if Prolonged Use is triggered AND the patient
         still has an active course today (i.e. exposure is prolonged
         AND ongoing, not just historical) — surfaces the case for
         discussing a steroid-sparing agent; does not name one.
     The LLM never decides any of this — only, optionally, phrases a
     narrative describing flags that are already decided.

  7. CONCURRENT COURSES ARE SUMMED, NOT DEDUPLICATED: if two courses
     (e.g. a maintenance oral dose and an IM rescue depot) are both
     active on the same day, their prednisolone-equivalent daily doses
     are added together for "today's active dose" — reflects true
     cumulative exposure, at the cost of some imprecision for
     long-acting depot/IM doses that don't have a clean "daily dose"
     (the doctor is trusted to enter a clinically reasonable
     daily-equivalent for those; see ROUTE_ALLOWED).

  8. "ROLLING 365 DAYS" IS A FIXED WINDOW, NOT PATIENT-SPECIFIC: same
     "reasonable starting heuristic" caveat as Module 10/12's fixed
     review windows.

  9. NARRATIVE IS OPTIONAL AND NEVER RECOMMENDS A SPECIFIC ACTION: same
     pattern as every prior rheumatology module's narrative step —
     describes the already-decided flags, never suggests a specific
     taper schedule, steroid-sparing drug, or screening test (that
     stays with the physician).
10. TAPER PLAN IS A GENERIC, DOSE-BASED STEP-DOWN HEURISTIC — NOT
      PERSONALIZED, NOT VALIDATED: given today's active prednisolone-
      equivalent dose, `_generate_taper_plan()` proposes fixed
      decrement/interval steps (see TAPER_RULES) that get slower as
      dose falls, per the standard "smaller steps at lower doses"
      principle. It does NOT account for: the specific drug/route in
      use, indication, comorbidities, disease flare risk during taper,
      or adrenal-axis status. Below TAPER_LOW_DOSE_ADRENAL_CAUTION_MG
      each step is annotated with an adrenal-suppression caution note.
      This is scaffolding for the doctor to edit, not a prescription —
      every step's dose/date/duration is editable before save, and the
      plan carries an explicit disclaimer string end-to-end. Flagged
      [UNCONFIRMED — clinical review required] same as the Treatment
      Decision v2 drug catalogs.

  11. TAPER PLAN COLLECTION: new collection
      "rheumatology_steroid_taper_plans" (TAPER_PLAN_COLLECTION_NAME
      below), separate from the existing risk-assessment collection —
      keeps the two save flows (risk flags vs. taper schedule)
      independent since a doctor may want to save one without the
      other. No History component built this session (not requested) —
      the save/history routes exist but the paired
      `RheumatologySteroidStewardshipTaperHistory.jsx` still needs to
      be built if you want a dedicated history view; for now the latest
      plan is just re-fetchable via the history route below.
─────────────────────────────────────────────────────────────────────────
"""

import os
import json
import logging
from datetime import datetime, date, timedelta
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

STEROID_COURSE_COLLECTION_NAME = "rheumatology_steroid_courses"          # see ASSUMPTION #2
ASSESSMENT_COLLECTION_NAME = "rheumatology_steroid_assessments"

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    steroid_course_collection = database[STEROID_COURSE_COLLECTION_NAME]
    steroid_assessment_collection = database[ASSESSMENT_COLLECTION_NAME]
    rheumatology_intake_collection = database["rheumatology_intake"]
except Exception as e:
    logger.error(f"Error initializing MongoDB in rheumatology_steroid_stewardship_api: {e}")

# ─── Groq setup ─────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client: Optional[Groq] = None
try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        logger.warning("GROQ_API_KEY not set — steroid stewardship narrative will be skipped (flags still compute).")
except Exception as e:
    logger.error(f"Error initializing Groq client in rheumatology_steroid_stewardship_api: {e}")

router = APIRouter(prefix="/context", tags=["Rheumatology Steroid Stewardship"])

# ─── Closed vocabularies ──────────────────────────────────────────────────────
STEROID_DRUG_CONVERSION = {   # multiply dose_mg by this to get prednisolone-equivalent mg — see ASSUMPTION #5
    "Prednisolone": 1.0,
    "Prednisone": 1.0,
    "Methylprednisolone": 1.25,
    "Dexamethasone": 6.67,
    "Deflazacort": 0.83,
    "Hydrocortisone": 0.25,
    "Triamcinolone": 1.25,
}
STEROID_DRUGS = list(STEROID_DRUG_CONVERSION.keys())

ROUTE_ALLOWED = {"Oral", "IV", "IM", "Intra-articular"}
INDICATION_ALLOWED = {"Disease flare", "Rescue course", "Maintenance/bridging", "Post-procedure", "Other"}

# ─── Rule thresholds — see ASSUMPTION #6 ─────────────────────────────────────
ROLLING_WINDOW_DAYS = 365
PROLONGED_USE_DAYS_THRESHOLD = 90
RESCUE_COURSE_COUNT_THRESHOLD = 3
OSTEOPOROSIS_HIGH_DAYS = 90
OSTEOPOROSIS_HIGH_AVG_DOSE_MG = 5.0
OSTEOPOROSIS_MODERATE_DAYS = 30
INFECTION_HIGH_DOSE_MG = 10.0
INFECTION_MODERATE_DOSE_MG = 5.0
HYPERGLYCEMIA_HIGH_DOSE_MG = 20.0
HYPERGLYCEMIA_MODERATE_DOSE_MG = 7.5
# ─── Taper plan heuristic — see ASSUMPTION #10 ───────────────────────────────
# [UNCONFIRMED — clinical review required] Generic fixed-decrement heuristic.
# Rules checked top-to-bottom; first rule where current_dose > floor applies.
TAPER_RULES = [
    {"floor": 20.0, "decrement_mg": 5.0, "interval_days": 14},
    {"floor": 10.0, "decrement_mg": 2.5, "interval_days": 14},
    {"floor": 5.0,  "decrement_mg": 1.0, "interval_days": 28},
    {"floor": 0.0,  "decrement_mg": 1.0, "interval_days": 28},
]
TAPER_MAX_STEPS = 40  # safety cap against a runaway loop
TAPER_LOW_DOSE_ADRENAL_CAUTION_MG = 5.0

TAPER_PLAN_COLLECTION_NAME = "rheumatology_steroid_taper_plans"  # see ASSUMPTION #11

TAPER_DISCLAIMER = (
    "[UNCONFIRMED — clinical review required] Generic, non-personalized "
    "percentage/fixed-decrement step-down schedule based only on today's "
    "active prednisolone-equivalent dose. Does not account for the specific "
    "drug/route, indication, comorbidities, flare risk, or adrenal-axis "
    "status. Every step is editable — review and adjust before giving to "
    "the patient."
)

DIABETES_KEYWORDS = ["diabetes", "diabetic"]  # see ASSUMPTION #4/#6

FLAG_DOMAINS = [
    "Prolonged Use",
    "Repeated Rescue Courses",
    "Osteoporosis/Fracture Risk",
    "Infection Risk",
    "Hyperglycemia Risk",
    "Steroid-Sparing Opportunity",
]


def _parse_date(date_str: str) -> Optional[date]:
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _pred_equivalent_daily(drug: str, dose_mg: float) -> float:
    return round(dose_mg * STEROID_DRUG_CONVERSION.get(drug, 1.0), 3)


def _clean_course_for_calc(course: dict, today: date) -> dict:
    start = _parse_date(course["start_date"])
    end = _parse_date(course.get("end_date")) if course.get("end_date") else None
    effective_end = end if end else today
    return {
        **course,
        "_start": start,
        "_effective_end": effective_end,
        "_is_ongoing": end is None,
        "_daily_pred_equiv": _pred_equivalent_daily(course["drug"], course["dose_mg"]),
    }


def _overlap_days(start: date, effective_end: date, window_start: date, window_end: date) -> int:
    lo = max(start, window_start)
    hi = min(effective_end, window_end)
    if hi < lo:
        return 0
    return (hi - lo).days + 1


async def _get_latest_intake(patient_id: str, doctor_id: str) -> Optional[dict]:
    try:
        doc = await rheumatology_intake_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        if doc:
            return doc.get("rheumatology_intake") or {}
    except Exception as e:
        logger.warning(f"Steroid stewardship: intake lookup failed for {patient_id}: {e}")
    return None


# ═════════════════════════════════════════════════════════════════════════════
# 1. CONTEXT PREVIEW
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-steroid-stewardship/context-preview/{patient_id}/{doctor_id}")
async def get_steroid_stewardship_context_preview(patient_id: str, doctor_id: str):
    """
    Surfaces Module 1 intake's steroid_exposure.has_used flag and any
    diabetes-related comorbidity keywords, purely as hints for the
    doctor — see ASSUMPTION #4. Does not touch the course log.
    """
    intake = await _get_latest_intake(patient_id, doctor_id)
    steroid_exposure = (intake or {}).get("steroid_exposure") or {}
    steroid_reported_at_intake = str(steroid_exposure.get("has_used", "")) == "Yes"

    comorbidities = (intake or {}).get("comorbidities") or []
    text_blob = " | ".join(str(c).lower() for c in comorbidities)
    diabetes_flag = any(kw in text_blob for kw in DIABETES_KEYWORDS)

    return {
        "status": "success",
        "data": {
            "steroid_drugs": STEROID_DRUGS,
            "routes": sorted(ROUTE_ALLOWED),
            "indications": sorted(INDICATION_ALLOWED),
            "steroid_reported_at_intake": steroid_reported_at_intake,
            "diabetes_comorbidity_flagged": diabetes_flag,
        },
        "has_intake_data": intake is not None,
    }


# ═════════════════════════════════════════════════════════════════════════════
# 2. ADD / DELETE / FETCH COURSES
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-steroid-stewardship/add-course")
async def add_steroid_course(payload: dict):
    """
    Expected payload:
    {
        "patient_id": "...", "doctor_id": "...",
        "drug": "Prednisolone",                  # must be in STEROID_DRUGS
        "route": "Oral",                          # see ROUTE_ALLOWED
        "dose_mg": 10.0,                           # daily dose, drug's own units
        "start_date": "2026-05-01",                # YYYY-MM-DD
        "end_date": null,                          # YYYY-MM-DD or null = ongoing
        "indication": "Disease flare",             # see INDICATION_ALLOWED
        "notes": "optional free text"
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        drug = str(payload.get("drug", ""))
        route = str(payload.get("route", ""))
        dose_mg = payload.get("dose_mg")
        start_date = payload.get("start_date")
        end_date = payload.get("end_date") or None
        indication = str(payload.get("indication", ""))
        notes = payload.get("notes") or ""

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if drug not in STEROID_DRUG_CONVERSION:
            raise HTTPException(status_code=400, detail=f"drug must be one of: {STEROID_DRUGS}")
        if route not in ROUTE_ALLOWED:
            raise HTTPException(status_code=400, detail=f"route must be one of: {sorted(ROUTE_ALLOWED)}")
        if indication not in INDICATION_ALLOWED:
            raise HTTPException(status_code=400, detail=f"indication must be one of: {sorted(INDICATION_ALLOWED)}")
        try:
            dose_mg = float(dose_mg)
            if dose_mg <= 0:
                raise ValueError
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="dose_mg must be a positive number")

        start_parsed = _parse_date(start_date)
        if start_parsed is None:
            raise HTTPException(status_code=400, detail="start_date must be in YYYY-MM-DD format")
        if end_date:
            end_parsed = _parse_date(end_date)
            if end_parsed is None:
                raise HTTPException(status_code=400, detail="end_date must be in YYYY-MM-DD format")
            if end_parsed < start_parsed:
                raise HTTPException(status_code=400, detail="end_date cannot be before start_date")

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "drug": drug,
            "route": route,
            "dose_mg": dose_mg,
            "start_date": start_date,
            "end_date": end_date,
            "indication": indication,
            "prednisolone_equivalent_daily_mg": _pred_equivalent_daily(drug, dose_mg),
            "notes": str(notes)[:500],
            "created_at": datetime.utcnow(),
        }
        result = await steroid_course_collection.insert_one(document)
        document["_id"] = str(result.inserted_id)
        document["created_at"] = document["created_at"].isoformat()

        return {"status": "success", "message": "Steroid course logged", "data": document}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/rheumatology-steroid-stewardship/courses/{patient_id}/{doctor_id}")
async def get_steroid_courses(patient_id: str, doctor_id: str):
    """All logged steroid courses for a patient, most recent start date first."""
    try:
        cursor = steroid_course_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("start_date", -1)

        records = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            if isinstance(doc.get("created_at"), datetime):
                doc["created_at"] = doc["created_at"].isoformat()
            records.append(doc)

        return {"status": "success", "count": len(records), "data": records}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/rheumatology-steroid-stewardship/course/{course_id}")
async def delete_steroid_course(course_id: str):
    try:
        try:
            oid = ObjectId(course_id)
        except InvalidId:
            raise HTTPException(status_code=400, detail="Invalid course_id")

        result = await steroid_course_collection.delete_one({"_id": oid})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Course not found")

        return {"status": "success", "message": "Steroid course deleted"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 3. ASSESS
# ═════════════════════════════════════════════════════════════════════════════
def _active_dose_today(calc_courses: list, today: date) -> float:
    return round(sum(
        c["_daily_pred_equiv"] for c in calc_courses
        if c["_start"] <= today <= c["_effective_end"]
    ), 2)

def _evaluate_steroid_stewardship(courses: list, diabetes_flag: bool) -> dict:
    """
    Deterministic rule engine — see ASSUMPTION #6. Returns
    {"domains": [ {domain, category, reasons}, ... ], "metrics": {...}}.
    category is "green" | "yellow" | "red" for every domain except
    "Steroid-Sparing Opportunity", which uses "green" (no flag) or
    "yellow" (flagged) only — there's no "red" tier for that one.
    """
    today = date.today()
    window_start = today - timedelta(days=ROLLING_WINDOW_DAYS - 1)

    calc_courses = [_clean_course_for_calc(c, today) for c in courses]

    # Total distinct days-on-steroid in trailing window, plus weighted avg dose during those days.
    day_doses = {}  # date -> total prednisolone-equivalent mg that day (sums concurrent courses)
    for c in calc_courses:
        lo = max(c["_start"], window_start)
        hi = min(c["_effective_end"], today)
        d = lo
        while d <= hi:
            day_doses[d] = day_doses.get(d, 0.0) + c["_daily_pred_equiv"]
            d += timedelta(days=1)

    days_on_steroid_12mo = len(day_doses)
    cumulative_mg_12mo = round(sum(day_doses.values()), 1)
    avg_daily_dose_on_steroid_days = round(cumulative_mg_12mo / days_on_steroid_12mo, 2) if days_on_steroid_12mo else 0.0

    active_dose_today = _active_dose_today(calc_courses, today)

    rescue_count_12mo = sum(
        1 for c in calc_courses
        if c.get("indication") == "Rescue course" and c["_start"] >= window_start
    )

    domains = []

    # 1. Prolonged Use
    reasons = [f"{days_on_steroid_12mo} day(s) on steroid therapy in the past {ROLLING_WINDOW_DAYS} days"]
    if days_on_steroid_12mo >= PROLONGED_USE_DAYS_THRESHOLD:
        category = "red"
        reasons.append(f"Exceeds prolonged-use threshold ({PROLONGED_USE_DAYS_THRESHOLD} days)")
    elif days_on_steroid_12mo >= PROLONGED_USE_DAYS_THRESHOLD // 2:
        category = "yellow"
        reasons.append("Approaching prolonged-use threshold")
    else:
        category = "green"
    domains.append({"domain": "Prolonged Use", "category": category, "reasons": reasons})

    # 2. Repeated Rescue Courses
    reasons = [f"{rescue_count_12mo} rescue course(s) in the past {ROLLING_WINDOW_DAYS} days"]
    if rescue_count_12mo >= RESCUE_COURSE_COUNT_THRESHOLD:
        category = "red"
        reasons.append(f"Meets or exceeds threshold ({RESCUE_COURSE_COUNT_THRESHOLD} courses/year) — suggests inadequate baseline disease control")
    elif rescue_count_12mo >= 1:
        category = "yellow"
    else:
        category = "green"
    domains.append({"domain": "Repeated Rescue Courses", "category": category, "reasons": reasons})

    # 3. Osteoporosis/Fracture Risk
    reasons = [f"{days_on_steroid_12mo} day(s) on steroid in the past year, average {avg_daily_dose_on_steroid_days}mg/day prednisolone-equivalent on those days"]
    if days_on_steroid_12mo >= OSTEOPOROSIS_HIGH_DAYS and avg_daily_dose_on_steroid_days >= OSTEOPOROSIS_HIGH_AVG_DOSE_MG:
        category = "red"
        reasons.append(f"≥{OSTEOPOROSIS_HIGH_DAYS} days at ≥{OSTEOPOROSIS_HIGH_AVG_DOSE_MG}mg/day average — bone-health review indicated")
    elif days_on_steroid_12mo >= OSTEOPOROSIS_MODERATE_DAYS:
        category = "yellow"
    else:
        category = "green"
    domains.append({"domain": "Osteoporosis/Fracture Risk", "category": category, "reasons": reasons})

    # 4. Infection Risk
    reasons = [f"Current active dose: {active_dose_today}mg/day prednisolone-equivalent"]
    if active_dose_today >= INFECTION_HIGH_DOSE_MG:
        category = "red"
    elif active_dose_today >= INFECTION_MODERATE_DOSE_MG:
        category = "yellow"
    else:
        category = "green"
    domains.append({"domain": "Infection Risk", "category": category, "reasons": reasons})

    # 5. Hyperglycemia Risk
    reasons = [f"Current active dose: {active_dose_today}mg/day prednisolone-equivalent"]
    if active_dose_today >= HYPERGLYCEMIA_HIGH_DOSE_MG:
        category = "red"
    elif active_dose_today >= HYPERGLYCEMIA_MODERATE_DOSE_MG:
        category = "yellow"
    else:
        category = "green"
    if diabetes_flag:
        reasons.append("Diabetes-related comorbidity reported at intake — escalated")
        escalation = {"green": "yellow", "yellow": "red", "red": "red"}
        category = escalation[category]
    domains.append({"domain": "Hyperglycemia Risk", "category": category, "reasons": reasons})

    # 6. Steroid-Sparing Opportunity (flag-only, green/yellow)
    prolonged_flagged = days_on_steroid_12mo >= PROLONGED_USE_DAYS_THRESHOLD
    still_active = active_dose_today > 0
    if prolonged_flagged and still_active:
        category = "yellow"
        reasons = ["Prolonged exposure (≥90 days in the past year) and steroid still active today — may warrant discussing a steroid-sparing agent"]
    else:
        category = "green"
        reasons = ["No prolonged, still-active exposure pattern detected"]
    domains.append({"domain": "Steroid-Sparing Opportunity", "category": category, "reasons": reasons})

    return {
        "domains": domains,
        "metrics": {
            "days_on_steroid_12mo": days_on_steroid_12mo,
            "cumulative_prednisolone_equivalent_mg_12mo": cumulative_mg_12mo,
            "avg_daily_dose_on_steroid_days_mg": avg_daily_dose_on_steroid_days,
            "active_dose_today_mg": active_dose_today,
            "rescue_course_count_12mo": rescue_count_12mo,
        },
    }
def _generate_taper_plan(active_dose_mg: float, today: date) -> Optional[dict]:
    """
    Deterministic, LLM-free — see ASSUMPTION #10. Returns None if there's
    no active dose to taper from.
    """
    if active_dose_mg <= 0:
        return None

    steps = []
    current_dose = round(active_dose_mg, 2)
    current_date = today
    step_num = 1

    while current_dose > 0 and step_num <= TAPER_MAX_STEPS:
        rule = next(r for r in TAPER_RULES if current_dose > r["floor"])
        next_dose = max(round(current_dose - rule["decrement_mg"], 2), 0.0)

        note = None
        if current_dose <= TAPER_LOW_DOSE_ADRENAL_CAUTION_MG:
            note = (
                "Below ~5mg/day prednisolone-equivalent — consider "
                "adrenal-suppression risk before further reduction/"
                "discontinuation [UNCONFIRMED — clinical review required]"
            )

        steps.append({
            "step": step_num,
            "start_date": current_date.isoformat(),
            "duration_days": rule["interval_days"],
            "dose_mg": current_dose,
            "next_dose_mg": next_dose,
            "note": note,
        })

        current_date = current_date + timedelta(days=rule["interval_days"])
        current_dose = next_dose
        step_num += 1

    if steps:
        steps[-1]["note"] = (steps[-1]["note"] + " " if steps[-1]["note"] else "") + \
            "Final step reaches 0mg (discontinue) — confirm this is clinically appropriate."

    return {
        "steps": steps,
        "generated_from_active_dose_mg": active_dose_mg,
        "generated_date": today.isoformat(),
        "disclaimer": TAPER_DISCLAIMER,
    }

STEROID_NARRATIVE_PROMPT = """
You are a clinical assistant. You will be given a list of steroid
stewardship flag results for a rheumatology patient — for each flag
domain, its category (green/yellow/red) and the specific reasons behind
it, plus summary metrics (days on steroid in the past year, cumulative
prednisolone-equivalent exposure, current active dose, rescue course
count). All categories have already been decided by rule-based logic,
not by you.

Return a JSON object with exactly one key, "narrative": ONE short
paragraph (2-4 sentences) summarizing the overall steroid exposure
picture across all flags listed, in plain language a physician can scan
quickly. Reference the actual domain names, metrics, and reasons given.

Rules:
- Do NOT change, soften, or second-guess the category already assigned
  to any domain — describe it, don't re-evaluate it.
- Do NOT recommend a specific taper schedule, steroid-sparing drug, or
  screening test — that decision belongs to the physician.
- Do NOT invent findings not present in the input.
- Return valid JSON only — no markdown, no commentary, no extra keys.
"""


@router.post("/rheumatology-steroid-stewardship/assess")
async def assess_steroid_stewardship(payload: dict):
    """
    Expected payload:
    { "doctor_id": "...", "patient_id": "..." }

    Returns:
    {
        "status": "success",
        "finaloutput": { "domains": [...], "metrics": {...}, "narrative": str | None }
    }
    """
    patient_id = payload.get("patient_id")
    doctor_id = payload.get("doctor_id")
    if not patient_id or not doctor_id:
        raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")

    cursor = steroid_course_collection.find({"patient_id": patient_id, "doctor_id": doctor_id})
    courses = [doc async for doc in cursor]

    if not courses:
        raise HTTPException(
            status_code=400,
            detail="No steroid courses logged yet — log at least one course to assess.",
        )

    intake = await _get_latest_intake(patient_id, doctor_id)
    comorbidities = (intake or {}).get("comorbidities") or []
    text_blob = " | ".join(str(c).lower() for c in comorbidities)
    diabetes_flag = any(kw in text_blob for kw in DIABETES_KEYWORDS)

    evaluation = _evaluate_steroid_stewardship(courses, diabetes_flag)

    narrative = None
    if groq_client is not None:
        try:
            llm_input = {"domains": evaluation["domains"], "metrics": evaluation["metrics"]}
            completion = groq_client.chat.completions.create(
                model="openai/gpt-oss-120b",
                messages=[
                    {"role": "system", "content": STEROID_NARRATIVE_PROMPT},
                    {"role": "user", "content": json.dumps(llm_input, indent=2, default=str)},
                ],
                temperature=0,
                response_format={"type": "json_object"},
            )
            parsed = json.loads(completion.choices[0].message.content)
            if isinstance(parsed, dict) and parsed.get("narrative"):
                narrative = str(parsed["narrative"])[:600]
        except Exception as e:
            logger.warning(f"Steroid stewardship: narrative generation failed for {patient_id}: {e}")

    return {
        "status": "success",
        "finaloutput": {"domains": evaluation["domains"], "metrics": evaluation["metrics"], "narrative": narrative},
    }


# ═════════════════════════════════════════════════════════════════════════════
# 4. SAVE
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-steroid-stewardship/save")
async def save_steroid_stewardship_assessment(payload: dict):
    """
    Expected payload (doctor-reviewed version of /assess's output):
    {
        "patient_id": "...", "doctor_id": "...",
        "domains": [ {domain, category, reasons}, ... ],
        "metrics": {...},
        "narrative": "optional"
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        domains = payload.get("domains") or []
        metrics = payload.get("metrics") or {}
        narrative = payload.get("narrative") or ""

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if not isinstance(domains, list) or not domains:
            raise HTTPException(status_code=400, detail="domains is required and cannot be empty")

        clean_domains = []
        for item in domains:
            if not isinstance(item, dict):
                continue
            domain_name = str(item.get("domain", ""))
            if domain_name not in FLAG_DOMAINS:
                continue
            category = str(item.get("category", ""))
            if category not in ("green", "yellow", "red"):
                continue
            clean_domains.append({
                "domain": domain_name,
                "category": category,
                "reasons": [str(r)[:300] for r in (item.get("reasons") or [])][:15],
            })

        if not clean_domains:
            raise HTTPException(status_code=400, detail="No valid domain entries to save")

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "domains": clean_domains,
            "metrics": {k: metrics.get(k) for k in (
                "days_on_steroid_12mo", "cumulative_prednisolone_equivalent_mg_12mo",
                "avg_daily_dose_on_steroid_days_mg", "active_dose_today_mg", "rescue_course_count_12mo",
            ) if k in metrics},
            "narrative": str(narrative)[:600],
            "created_at": datetime.utcnow(),
            "type": "rheumatology_steroid_stewardship_assessment",
        }
        result = await steroid_assessment_collection.insert_one(document)

        return {"status": "success", "message": "Steroid stewardship assessment saved", "id": str(result.inserted_id)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 5. HISTORY
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-steroid-stewardship/history/{patient_id}/{doctor_id}")
async def get_steroid_stewardship_history(patient_id: str, doctor_id: str):
    """Fetch all saved steroid stewardship assessments for a patient, most recent first."""
    try:
        cursor = steroid_assessment_collection.find(
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

# ═════════════════════════════════════════════════════════════════════════════
# 3b. GENERATE / SAVE TAPER PLAN — see ASSUMPTION #10/#11
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-steroid-stewardship/generate-taper-plan")
async def generate_steroid_taper_plan(payload: dict):
    """
    Expected payload: { "patient_id": "...", "doctor_id": "..." }
    Returns a doctor-editable, non-personalized step-down schedule based on
    today's active prednisolone-equivalent dose. No LLM call — pure
    deterministic heuristic, see ASSUMPTION #10.
    """
    patient_id = payload.get("patient_id")
    doctor_id = payload.get("doctor_id")
    if not patient_id or not doctor_id:
        raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")

    cursor = steroid_course_collection.find({"patient_id": patient_id, "doctor_id": doctor_id})
    courses = [doc async for doc in cursor]
    if not courses:
        raise HTTPException(status_code=400, detail="No steroid courses logged yet.")

    today = date.today()
    calc_courses = [_clean_course_for_calc(c, today) for c in courses]
    active_dose_today = _active_dose_today(calc_courses, today)

    if active_dose_today <= 0:
        raise HTTPException(
            status_code=400,
            detail="No active steroid course today — nothing to taper. "
                   "A taper plan requires a currently active course.",
        )

    plan = _generate_taper_plan(active_dose_today, today)
    return {"status": "success", "finaloutput": plan}


@router.post("/rheumatology-steroid-stewardship/save-taper-plan")
async def save_steroid_taper_plan(payload: dict):
    """
    Expected payload (doctor-reviewed/edited version of generate's output):
    {
        "patient_id": "...", "doctor_id": "...",
        "steps": [ {step, start_date, duration_days, dose_mg, next_dose_mg, note}, ... ],
        "generated_from_active_dose_mg": 15.0,
        "disclaimer": "..."
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        steps = payload.get("steps") or []

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if not isinstance(steps, list) or not steps:
            raise HTTPException(status_code=400, detail="steps is required and cannot be empty")

        clean_steps = []
        for item in steps:
            if not isinstance(item, dict):
                continue
            try:
                clean_steps.append({
                    "step": int(item.get("step", 0)),
                    "start_date": str(item.get("start_date", "")),
                    "duration_days": int(item.get("duration_days", 0)),
                    "dose_mg": float(item.get("dose_mg", 0)),
                    "next_dose_mg": float(item.get("next_dose_mg", 0)),
                    "note": str(item.get("note") or "")[:300],
                })
            except (TypeError, ValueError):
                continue

        if not clean_steps:
            raise HTTPException(status_code=400, detail="No valid step entries to save")

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "steps": clean_steps,
            "generated_from_active_dose_mg": payload.get("generated_from_active_dose_mg"),
            "disclaimer": str(payload.get("disclaimer") or TAPER_DISCLAIMER)[:600],
            "created_at": datetime.utcnow(),
            "type": "rheumatology_steroid_taper_plan",
        }
        collection = database[TAPER_PLAN_COLLECTION_NAME]
        result = await collection.insert_one(document)

        return {"status": "success", "message": "Taper plan saved", "id": str(result.inserted_id)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/rheumatology-steroid-stewardship/taper-plan-history/{patient_id}/{doctor_id}")
async def get_steroid_taper_plan_history(patient_id: str, doctor_id: str):
    """Most recent saved taper plans first. No dedicated History component yet — see ASSUMPTION #11."""
    try:
        collection = database[TAPER_PLAN_COLLECTION_NAME]
        cursor = collection.find({"patient_id": patient_id, "doctor_id": doctor_id}).sort("created_at", -1)

        records = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            if isinstance(doc.get("created_at"), datetime):
                doc["created_at"] = doc["created_at"].isoformat()
            records.append(doc)

        return {"status": "success", "count": len(records), "data": records}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))