"""
rheumatology_lab_trends_api.py
─────────────────────────────────────────────────────────────────────────────
DoctorAssist.AI — Rheumatology AI Workflow, Module 5: Lab Trend
Intelligence (v1.0).

The roadmap describes this module as NOT just displaying lab values, but
detecting trajectories and narrating them — e.g. turning "CRP 18 → 32 → 47"
into "Inflammatory markers are progressively increasing despite current
treatment." That requires actual longitudinal lab RESULTS, which nothing
upstream of this module captures as structured data (documentation-
investigation-notes stores ORDERS, not results — see ASSUMPTION #1 below).
So this module owns both: a simple manual result-entry step, and the
trend-analysis engine on top of it.

Mirrors the naming/response/error-handling convention of the three prior
rheumatology modules 1:1.

ROUTES IN THIS FILE
---------------------
  POST   /rheumatology-labs/add-result
  DELETE /rheumatology-labs/result/{result_id}
  GET    /rheumatology-labs/results/{patient_id}/{doctor_id}
  POST   /rheumatology-labs/analyze-trends
  POST   /rheumatology-labs/save-analysis
  GET    /rheumatology-labs/history/{patient_id}/{doctor_id}

⚠️ ASSUMPTIONS MADE WHILE ASSEMBLING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. NO EXISTING RESULTS STORE: I don't have visibility into a labs/
     results collection anywhere else in this codebase — only
     documentation-investigation-notes (orders/rationale, no numeric
     result value) and the generic Vitals panel (which is for vitals,
     not labs). If your lab/imaging system already has a results feed
     elsewhere (e.g. synced from a LIS), this module should read FROM
     that instead of doctors typing results in by hand — tell me the
     collection/field shape and I'll repoint /rheumatology-labs/results
     to read from there while keeping add-result as a manual-override
     fallback for anything not yet synced.

  2. ONE DOCUMENT PER RESULT: each add-result call inserts a single
     result document (test_name, value, unit, date, notes) rather than
     appending to a growing array on one patient-level doc. This keeps
     delete-a-single-bad-entry trivial and avoids concurrent-write races
     on a shared array. Collection: "rheumatology_lab_results".

  3. CLOSED, TREND-RELEVANT TEST CATALOG: LAB_TEST_CATALOG below is
     intentionally narrower than Module 4's investigation catalog — it's
     limited to tests that are genuinely meaningful to trend over time
     for a rheumatology patient (inflammatory markers, CBC components,
     renal/liver, uric acid, complement, anti-dsDNA titer, CK, urine
     protein), per the roadmap's explicit list. Qualitative/one-time
     tests from Module 4's catalog (e.g. ANA, RF, HLA-B27, imaging) are
     deliberately excluded — they don't have a meaningful numeric trend.
     Confirm the unit conventions per test match your lab's actual
     reporting units (e.g. some labs report creatinine in µmol/L, not
     mg/dL) before relying on the units shown here.

  4. TREATMENT CONTEXT FOR NARRATIVES: to produce a narrative like
     "...despite current treatment," this module pulls (a) the most
     recent documentation-medication-analysis prescriptions (drug name +
     dose/frequency, deterministic string join, NO extra LLM call for
     this part) and (b) the working_diagnosis field from Module 3's most
     recent saved differential (if any). Both are optional context — if
     neither exists, the trend narrative simply omits treatment
     correlation rather than guessing at what the patient is on.

  5. TREND ANALYSIS REQUIRES ≥2 DATA POINTS PER TEST: a single result
     has no trend to describe, so /analyze-trends silently skips any
     test with fewer than 2 recorded results rather than erroring — the
     response indicates which tests (if any) were skipped for this
     reason so the frontend can tell the doctor why.

  6. NO AUTOMATIC ALERTING: this module produces a narrative for doctor
     review only; it does not push notifications or flag the chart
     automatically elsewhere in the dashboard. If you want a rising-CRP
     narrative to also surface as an alert/badge somewhere else in the
     UI, tell me where and I'll wire an event dispatch the same way
     other modules use window.dispatchEvent for refresh signals.
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

RESULTS_COLLECTION_NAME = "rheumatology_lab_results"          # see ASSUMPTION #2
ANALYSIS_COLLECTION_NAME = "rheumatology_lab_trend_analysis"

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    lab_results_collection = database[RESULTS_COLLECTION_NAME]
    lab_trend_analysis_collection = database[ANALYSIS_COLLECTION_NAME]
    documentation_medication_analysis_collection = database["documentation-medication-analysis"]
    differential_collection = database["rheumatology_differential_diagnosis"]
except Exception as e:
    logger.error(f"Error initializing MongoDB in rheumatology_lab_trends_api: {e}")

# ─── Groq setup ─────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client: Optional[Groq] = None
try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        logger.warning("GROQ_API_KEY not set — lab trend LLM endpoints will fail at call time.")
except Exception as e:
    logger.error(f"Error initializing Groq client in rheumatology_lab_trends_api: {e}")

router = APIRouter(prefix="/context", tags=["Rheumatology Lab Trend Intelligence"])

# ─── Closed, trend-relevant lab catalog — see ASSUMPTION #3 ──────────────────
LAB_TEST_CATALOG = {
    "ESR": "mm/hr",
    "CRP": "mg/L",
    "Hemoglobin": "g/dL",
    "White Blood Cell Count (WBC)": "x10\u2079/L",
    "Platelet Count": "x10\u2079/L",
    "Creatinine": "mg/dL",
    "eGFR": "mL/min/1.73m\u00b2",
    "AST": "U/L",
    "ALT": "U/L",
    "Serum Uric Acid": "mg/dL",
    "Complement C3": "mg/dL",
    "Complement C4": "mg/dL",
    "Anti-dsDNA Titer": "IU/mL",
    "Creatine Kinase (CK)": "U/L",
    "Urine Protein-to-Creatinine Ratio (UPCR)": "mg/g",
}
LAB_TEST_NAMES_ALLOWED = set(LAB_TEST_CATALOG.keys())

DIRECTION_ALLOWED = {"rising", "falling", "stable", "fluctuating"}


# ═════════════════════════════════════════════════════════════════════════════
# 1. ADD / DELETE / FETCH RESULTS
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-labs/add-result")
async def add_lab_result(payload: dict):
    """
    Expected payload:
    {
        "patient_id": "...", "doctor_id": "...",
        "test_name": "CRP",           # must be in LAB_TEST_CATALOG
        "value": 32.4,
        "date": "2026-08-01",         # YYYY-MM-DD, defaults to today if omitted
        "notes": "optional free text"
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        test_name = str(payload.get("test_name", ""))
        value = payload.get("value")
        date_str = payload.get("date") or datetime.utcnow().strftime("%Y-%m-%d")
        notes = payload.get("notes") or ""

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if test_name not in LAB_TEST_NAMES_ALLOWED:
            raise HTTPException(status_code=400, detail=f"test_name must be one of: {sorted(LAB_TEST_NAMES_ALLOWED)}")
        try:
            value = float(value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="value must be numeric")
        try:
            datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="date must be in YYYY-MM-DD format")

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "test_name": test_name,
            "value": value,
            "unit": LAB_TEST_CATALOG[test_name],
            "date": date_str,
            "notes": str(notes)[:500],
            "created_at": datetime.utcnow(),
        }
        result = await lab_results_collection.insert_one(document)

        return {"status": "success", "message": "Lab result added", "id": str(result.inserted_id)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/rheumatology-labs/result/{result_id}")
async def delete_lab_result(result_id: str):
    """Removes a single mistaken/duplicate result entry."""
    try:
        try:
            oid = ObjectId(result_id)
        except InvalidId:
            raise HTTPException(status_code=400, detail="Invalid result_id")

        result = await lab_results_collection.delete_one({"_id": oid})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Result not found")

        return {"status": "success", "message": "Lab result deleted"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/rheumatology-labs/results/{patient_id}/{doctor_id}")
async def get_lab_results(patient_id: str, doctor_id: str):
    """
    Returns all recorded results for this patient, both as a flat list
    (for a table view with delete buttons) and grouped into per-test time
    series sorted oldest-to-newest (for charting).
    """
    try:
        cursor = lab_results_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("date", 1)

        flat = []
        series = {}
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            if isinstance(doc.get("created_at"), datetime):
                doc["created_at"] = doc["created_at"].isoformat()
            flat.append(doc)
            series.setdefault(doc["test_name"], []).append({
                "date": doc["date"], "value": doc["value"], "result_id": doc["_id"],
            })

        # flat list most-recent-first for a table view; series stays oldest-first for charts
        flat.sort(key=lambda d: d.get("date", ""), reverse=True)

        return {"status": "success", "results": flat, "series": series, "catalog": LAB_TEST_CATALOG}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 2. TREND ANALYSIS
# ═════════════════════════════════════════════════════════════════════════════

async def _get_current_medications_brief(patient_id: str) -> list:
    """Deterministic (no LLM) join of drug name + dose/frequency, for treatment-context narratives."""
    try:
        doc = await documentation_medication_analysis_collection.find_one(
            {"patient_id": patient_id}, sort=[("created_at", -1)]
        )
        if not doc:
            return []
        prescriptions = (doc.get("finaloutput") or {}).get("prescriptions") or []
        briefs = []
        for p in prescriptions:
            name = p.get("medication") or p.get("generic_name") or p.get("brand_name") or ""
            if not name:
                continue
            parts = [name]
            if p.get("dose"):
                parts.append(str(p["dose"]))
            if p.get("frequency"):
                parts.append(str(p["frequency"]))
            briefs.append(" ".join(parts))
        return briefs[:15]
    except Exception as e:
        logger.warning(f"Lab trends: medication brief lookup failed for {patient_id}: {e}")
        return []


async def _get_working_diagnosis(patient_id: str, doctor_id: str) -> str:
    try:
        doc = await differential_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        return (doc or {}).get("working_diagnosis", "") or ""
    except Exception as e:
        logger.warning(f"Lab trends: working diagnosis lookup failed for {patient_id}: {e}")
        return ""


TREND_ANALYSIS_PROMPT = """
You are a clinical assistant. You will be given, per lab test, a
chronological list of {date, value} results, plus optional current
medications and an optional working diagnosis for treatment-correlation
context.

For EACH test given, produce ONE trend insight. Return a JSON object with
exactly one key, "trends", a list of objects, each with exactly these keys:

  - "test_name": the exact test name as given in the input.
  - "direction": one of "rising", "falling", "stable", "fluctuating" —
    based strictly on the actual sequence of values given.
  - "narrative": ONE clear sentence describing the trajectory using the
    actual values and dates (e.g. "CRP rose from 18 to 32 to 47 mg/L
    between March and July 2026"). If medications and/or a working
    diagnosis were provided AND the direction is rising or fluctuating in
    a way that's clinically notable, you may add a short clause
    connecting it to treatment (e.g. "...despite ongoing methotrexate") —
    but ONLY state a medication name that was actually given in the
    input, never assume what the patient is on.

Rules:
- Do NOT invent values, dates, or medications not present in the input.
- Do NOT offer a clinical recommendation or next step — this module
  narrates the trend only; treatment decisions belong to a different
  module.
- Return valid JSON only — no markdown, no commentary, no extra keys.
"""


@router.post("/rheumatology-labs/analyze-trends")
async def analyze_lab_trends(payload: dict):
    """
    Expected payload:
    { "doctor_id": "...", "patient_id": "..." }

    Returns:
    {
        "status": "success",
        "finaloutput": { "trends": [...] },
        "skipped_tests": ["Anti-dsDNA Titer"],   # tests with <2 results
        "context_used": { "medications": [...], "working_diagnosis": "..." }
    }
    """
    if groq_client is None:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured on server")

    patient_id = payload.get("patient_id")
    doctor_id = payload.get("doctor_id")
    if not patient_id or not doctor_id:
        raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")

    cursor = lab_results_collection.find(
        {"patient_id": patient_id, "doctor_id": doctor_id}
    ).sort("date", 1)

    series = {}
    async for doc in cursor:
        series.setdefault(doc["test_name"], []).append({"date": doc["date"], "value": doc["value"]})

    trendable = {name: points for name, points in series.items() if len(points) >= 2}
    skipped = [name for name in series if name not in trendable]

    if not trendable:
        raise HTTPException(
            status_code=400,
            detail="No test has 2 or more recorded results yet — add at least two results for the same test to analyze a trend.",
        )

    medications = await _get_current_medications_brief(patient_id)
    working_diagnosis = await _get_working_diagnosis(patient_id, doctor_id)

    llm_input = {
        "lab_series": trendable,
        "current_medications": medications,
        "working_diagnosis": working_diagnosis,
    }

    try:
        completion = groq_client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[
                {"role": "system", "content": TREND_ANALYSIS_PROMPT},
                {"role": "user", "content": json.dumps(llm_input, indent=2, default=str)},
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )
        raw_content = completion.choices[0].message.content
        try:
            parsed = json.loads(raw_content)
        except (json.JSONDecodeError, TypeError):
            logger.error(f"Lab trend analysis returned non-JSON: {raw_content}")
            parsed = {}
        if not isinstance(parsed, dict):
            parsed = {}

        raw_trends = parsed.get("trends")
        clean_trends = []
        if isinstance(raw_trends, list):
            for item in raw_trends:
                if not isinstance(item, dict):
                    continue
                test_name = str(item.get("test_name", ""))
                if test_name not in trendable:
                    continue
                direction = str(item.get("direction", ""))
                if direction not in DIRECTION_ALLOWED:
                    continue
                narrative = str(item.get("narrative", "")).strip()
                if not narrative:
                    continue
                clean_trends.append({
                    "test_name": test_name,
                    "unit": LAB_TEST_CATALOG.get(test_name, ""),
                    "direction": direction,
                    "narrative": narrative[:400],
                    "values": trendable[test_name],
                })

        return {
            "status": "success",
            "finaloutput": {"trends": clean_trends},
            "skipped_tests": skipped,
            "context_used": {"medications": medications, "working_diagnosis": working_diagnosis},
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Lab trend analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 2b. SUGGEST ADDITIONAL TESTS
# ═════════════════════════════════════════════════════════════════════════════

SUGGEST_TESTS_PROMPT = f"""
You are a clinical assistant helping a rheumatologist decide whether any
additional lab tests are worth ordering for this patient right now.

You will be given, as JSON:
  - "catalog": the ONLY tests you are allowed to suggest (test_name -> unit)
  - "recorded_tests": for each test already recorded at least once, the
    most recent {{date, value}} and how many days ago that was
  - "never_recorded_tests": catalog test names with zero recorded results
  - "intake": structured rheumatology intake fields (may be partial/empty)
  - "joint_map": structured joint exam fields (may be partial/empty)
  - "working_diagnosis": free text, may be empty

Return a JSON object with exactly two keys:

  "suggested_tests": a list of objects, each:
    {{
      "test_name": "<exact name from catalog>",
      "reason": "ONE sentence explaining why, grounded in the specific
                 intake/joint_map/diagnosis facts given, or in how long
                 ago it was last checked. Never state a fact not present
                 in the input.",
      "urgency": one of "routine", "consider_soon"
    }}
    Only suggest tests from the given catalog. You may suggest a test
    that was never recorded, OR one that was recorded before but where
    the time elapsed plus the clinical context given makes a recheck
    reasonable to consider — use your own clinical judgment on staleness,
    there is no fixed interval provided to you on purpose. If nothing in
    the input supports suggesting a test, leave it out. Do not pad the
    list to reach any particular length — an empty list is a valid and
    expected answer when nothing stands out.

  "advisory_note": a SHORT (max 2 sentences) free-text note ONLY for
    something clinically relevant that falls OUTSIDE the given catalog
    (e.g. ANA, RF, HLA-B27, imaging) — grounded strictly in the input.
    Return an empty string if nothing applies. This is advisory only,
    never a suggested_tests entry, since those tests cannot be recorded
    in this module.

Rules:
- This is a suggestion for the doctor to review, NOT an order and NOT a
  diagnosis. Never phrase anything as a directive ("order X") — phrase
  as consideration ("may be worth checking given...").
- Do NOT invent findings, dates, or values not present in the input.
- Return valid JSON only — no markdown, no commentary, no extra keys.
"""


@router.post("/rheumatology-labs/suggest-tests")
async def suggest_additional_tests(payload: dict):
    """
    Expected payload:
    { "doctor_id": "...", "patient_id": "..." }

    Returns:
    {
        "status": "success",
        "finaloutput": {
            "suggested_tests": [{"test_name","reason","urgency"}, ...],
            "advisory_note": "..."
        },
        "context_used": {
            "recorded_tests": {...}, "never_recorded_tests": [...],
            "has_intake": bool, "has_joint_map": bool
        }
    }
    """
    if groq_client is None:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured on server")

    patient_id = payload.get("patient_id")
    doctor_id = payload.get("doctor_id")
    if not patient_id or not doctor_id:
        raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")

    try:
        rheumatology_intake_collection = database["rheumatology_intake"]
        joint_map_collection = database["rheumatology_joint_map"]
    except Exception as e:
        logger.error(f"Suggest-tests: collection access failed: {e}")
        raise HTTPException(status_code=500, detail="Internal collection error")

    # Most recent result per test
    cursor = lab_results_collection.find(
        {"patient_id": patient_id, "doctor_id": doctor_id}
    ).sort("date", -1)

    most_recent_by_test = {}
    async for doc in cursor:
        if doc["test_name"] not in most_recent_by_test:
            most_recent_by_test[doc["test_name"]] = doc

    today = datetime.utcnow().date()
    recorded_tests = {}
    for test_name, doc in most_recent_by_test.items():
        try:
            result_date = datetime.strptime(doc["date"], "%Y-%m-%d").date()
            days_ago = (today - result_date).days
        except Exception:
            days_ago = None
        recorded_tests[test_name] = {
            "date": doc["date"],
            "value": doc["value"],
            "days_ago": days_ago,
        }

    never_recorded_tests = [t for t in LAB_TEST_CATALOG if t not in recorded_tests]

    intake_doc = await rheumatology_intake_collection.find_one(
        {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
    )
    intake_fields = (intake_doc or {}).get("rheumatology_intake") or {}

    joint_map_doc = await joint_map_collection.find_one(
        {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
    )
    joint_map_fields = (joint_map_doc or {}).get("joint_map") or {}

    working_diagnosis = await _get_working_diagnosis(patient_id, doctor_id)

    llm_input = {
        "catalog": LAB_TEST_CATALOG,
        "recorded_tests": recorded_tests,
        "never_recorded_tests": never_recorded_tests,
        "intake": intake_fields,
        "joint_map": joint_map_fields,
        "working_diagnosis": working_diagnosis,
    }

    try:
        completion = groq_client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[
                {"role": "system", "content": SUGGEST_TESTS_PROMPT},
                {"role": "user", "content": json.dumps(llm_input, indent=2, default=str)},
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )
        raw_content = completion.choices[0].message.content
        try:
            parsed = json.loads(raw_content)
        except (json.JSONDecodeError, TypeError):
            logger.error(f"Suggest-tests returned non-JSON: {raw_content}")
            parsed = {}
        if not isinstance(parsed, dict):
            parsed = {}

        clean_suggestions = []
        raw_suggestions = parsed.get("suggested_tests")
        if isinstance(raw_suggestions, list):
            for item in raw_suggestions:
                if not isinstance(item, dict):
                    continue
                test_name = str(item.get("test_name", ""))
                if test_name not in LAB_TEST_CATALOG:
                    continue
                reason = str(item.get("reason", "")).strip()
                if not reason:
                    continue
                urgency = str(item.get("urgency", "routine"))
                if urgency not in {"routine", "consider_soon"}:
                    urgency = "routine"
                clean_suggestions.append({
                    "test_name": test_name,
                    "unit": LAB_TEST_CATALOG[test_name],
                    "reason": reason[:300],
                    "urgency": urgency,
                    "last_recorded": recorded_tests.get(test_name),
                })

        advisory_note = str(parsed.get("advisory_note", "") or "")[:400]

        return {
            "status": "success",
            "finaloutput": {
                "suggested_tests": clean_suggestions,
                "advisory_note": advisory_note,
            },
            "context_used": {
                "recorded_tests": recorded_tests,
                "never_recorded_tests": never_recorded_tests,
                "has_intake": bool(intake_doc),
                "has_joint_map": bool(joint_map_doc),
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Suggest-tests failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 3. SAVE ANALYSIS
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-labs/save-analysis")
async def save_lab_trend_analysis(payload: dict):
    """
    Expected payload (doctor-reviewed/edited version):
    {
        "patient_id": "...", "doctor_id": "...",
        "trends": [{"test_name","unit","direction","narrative","values"}, ...]
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        trends = payload.get("trends") or []

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if not isinstance(trends, list) or not trends:
            raise HTTPException(status_code=400, detail="trends is required and cannot be empty")

        clean_trends = []
        for item in trends:
            if not isinstance(item, dict):
                continue
            test_name = str(item.get("test_name", ""))
            if test_name not in LAB_TEST_NAMES_ALLOWED:
                continue
            direction = str(item.get("direction", ""))
            if direction not in DIRECTION_ALLOWED:
                continue
            clean_trends.append({
                "test_name": test_name,
                "unit": LAB_TEST_CATALOG.get(test_name, ""),
                "direction": direction,
                "narrative": str(item.get("narrative", ""))[:400],
                "values": item.get("values") or [],
            })

        if not clean_trends:
            raise HTTPException(status_code=400, detail="No valid trends to save")

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "trends": clean_trends,
            "created_at": datetime.utcnow(),
            "type": "rheumatology_lab_trend_analysis",
        }
        result = await lab_trend_analysis_collection.insert_one(document)

        return {"status": "success", "message": "Lab trend analysis saved", "id": str(result.inserted_id)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 4. HISTORY
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-labs/history/{patient_id}/{doctor_id}")
async def get_lab_trend_analysis_history(patient_id: str, doctor_id: str):
    """Fetch all saved trend analyses for a patient, most recent first."""
    try:
        cursor = lab_trend_analysis_collection.find(
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