"""
rheumatology_flare_prediction_api.py
─────────────────────────────────────────────────────────────────────────────
DoctorAssist.AI — Rheumatology AI Workflow, Module 10: Flare Prediction
Engine (v1.0).

Combines signals that already exist elsewhere in this workflow — disease
activity trend (Module 6), lab trend direction (Module 5), and recent
medication/steroid changes (Module 9's treatment ledger) — with one new
piece nothing upstream captures: a flare event log, so "previous flare
patterns" (the roadmap's own phrase) has somewhere to live.

Like Module 8, the risk level is computed by a deterministic point-based
rule engine in code, NOT the LLM — flare risk stratification is a
safety-adjacent clinical judgment and shouldn't be something an LLM could
silently drift on between calls. The LLM only writes an optional
plain-English narrative explaining a score that's already been decided;
it cannot change the score or the risk level.

Mirrors the naming/response/error-handling convention of the nine prior
rheumatology modules 1:1.

ROUTES IN THIS FILE
---------------------
  GET    /rheumatology-flare/context-preview/{patient_id}/{doctor_id}
  POST   /rheumatology-flare/add-flare-event
  GET    /rheumatology-flare/flare-events/{patient_id}/{doctor_id}
  DELETE /rheumatology-flare/flare-event/{event_id}
  POST   /rheumatology-flare/predict
  POST   /rheumatology-flare/save
  GET    /rheumatology-flare/history/{patient_id}/{doctor_id}

⚠️ ASSUMPTIONS MADE WHILE ASSEMBLING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. ROUTER MOUNT: same convention as the other nine rheumatology files —
     `prefix="/context"`, mount with `app.include_router(...)` in main.py.

  2. COLLECTION NAMES: "rheumatology_flare_predictions" for saved
     predictions, "rheumatology_flare_events" for the manual flare log.
     Change FLARE_PREDICTION_COLLECTION_NAME / FLARE_EVENT_COLLECTION_NAME
     below if you want different names.

  3. RISK SCORE IS RULE-BASED, NOT LLM-DECIDED — see
     `_compute_flare_risk()`. Each factor below contributes fixed points;
     the total maps to Low/Moderate/High. This is the single most
     important design decision in this file, same principle as Module
     8's ASSUMPTION #4 — do not let the narrative step become the source
     of truth for the risk level.

  4. RISK FACTORS AND THEIR WEIGHTS (deliberately simple, additive, and
     inspectable — not a trained model):
       - Disease activity trending up (DAS28/CDAI/SDAI delta between the
         two most recent saved Module 6 records, any one worsening
         counts): +2
       - Current disease activity category is Moderate or High
         (Module 6's latest saved record): +2
       - Inflammatory markers rising (Module 5's most recent SAVED trend
         analysis has an ESR or CRP entry with direction "rising"): +2
       - A DMARD/biologic was stopped in the last 90 days for
         "Inadequate response" or "Adverse effect / toxicity" (Module 9
         ledger): +2
       - A steroid-class entry (keyword-matched, see STEROID_KEYWORDS)
         in the ledger was stopped in the last 90 days: +1
       - 2+ flare events logged in the last 12 months: +2; exactly 1: +1
     Score 0-2 = Low, 3-5 = Moderate, 6+ = High. These weights are a
     reasonable starting heuristic, not a validated clinical prediction
     rule — tell me if you want them tuned or made configurable.

  5. "FLARE" IS DOCTOR-DEFINED, NOT AI-DETECTED: this module does not
     attempt to algorithmically decide whether a past visit "was a
     flare" from disease-activity numbers alone — that's a clinical
     judgment call with too many confounders (missed medication doses,
     concurrent infection, etc.) to infer safely. Instead, flare events
     are logged directly by the doctor via /add-flare-event (date +
     severity + optional notes), same manual-entry pattern as Module 6's
     PtGA/PGA and Module 7's prognostic factors.

  6. LAB TREND SOURCE: reads Module 5's most recent SAVED trend analysis
     (rheumatology_lab_trend_analysis), not a live recomputation — same
     "saved, not in-progress" pattern Module 4 uses for Module 3's
     differential. If the doctor hasn't run/saved a Module 5 trend
     analysis recently, this factor simply doesn't contribute (treated
     as unknown, not as "not rising").

  7. MEDICATION-CHANGE LOOKBACK IS FIXED AT 90 DAYS: matches Module 8's
     steady-state monitoring framing (see that file's ASSUMPTION #6) —
     a reasonable "recent change" window for flare risk, not tied to any
     specific drug's half-life or induction period. Not configurable
     per-patient in this file.

  8. STEROID KEYWORD LIST IS DELIBERATELY SMALL: only the systemic
     glucocorticoids relevant to a steroid-taper flare risk
     (prednisone/prednisolone/methylprednisolone/dexamethasone) — not a
     general corticosteroid list (e.g. deliberately excludes topical/
     inhaled steroids, which aren't a flare-taper signal here).

  9. NARRATIVE IS OPTIONAL AND NEVER RECOMMENDS AN ACTION: mirrors
     Module 5/6/8's narrative pattern exactly — describes the factors
     behind an already-decided risk level, never suggests a treatment
     change (that stays with Module 7 / the physician).
─────────────────────────────────────────────────────────────────────────
"""

import os
import json
import logging
from datetime import datetime, date
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

FLARE_PREDICTION_COLLECTION_NAME = "rheumatology_flare_predictions"  # see ASSUMPTION #2
FLARE_EVENT_COLLECTION_NAME = "rheumatology_flare_events"

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    flare_prediction_collection = database[FLARE_PREDICTION_COLLECTION_NAME]
    flare_event_collection = database[FLARE_EVENT_COLLECTION_NAME]
    disease_activity_collection = database["rheumatology_disease_activity"]
    lab_trend_analysis_collection = database["rheumatology_lab_trend_analysis"]
    treatment_ledger_collection = database["rheumatology_treatment_ledger"]
except Exception as e:
    logger.error(f"Error initializing MongoDB in rheumatology_flare_prediction_api: {e}")

# ─── Groq setup ─────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client: Optional[Groq] = None
try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        logger.warning("GROQ_API_KEY not set — flare prediction narrative will be skipped (score still computes).")
except Exception as e:
    logger.error(f"Error initializing Groq client in rheumatology_flare_prediction_api: {e}")

router = APIRouter(prefix="/context", tags=["Rheumatology Flare Prediction"])

SEVERITY_ALLOWED = {"Mild", "Moderate", "Severe"}
RISK_LEVEL_COLOR_HINT = {"Low": "green", "Moderate": "yellow", "High": "red"}  # for frontend convenience only

STEROID_KEYWORDS = ["prednisone", "prednisolone", "methylprednisolone", "dexamethasone"]  # see ASSUMPTION #8
STOP_REASON_TRIGGERS = {"Inadequate response", "Adverse effect / toxicity"}
MEDICATION_LOOKBACK_DAYS = 90  # see ASSUMPTION #7


def _days_since(date_str: Optional[str]) -> Optional[int]:
    if not date_str:
        return None
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d").date()
        return (date.today() - d).days
    except (TypeError, ValueError):
        return None


# ═════════════════════════════════════════════════════════════════════════════
# CONTEXT GATHERING (shared by context-preview and predict)
# ═════════════════════════════════════════════════════════════════════════════

async def _get_last_two_disease_activity(patient_id: str, doctor_id: str) -> list:
    try:
        cursor = disease_activity_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("created_at", -1).limit(2)
        return [doc async for doc in cursor]
    except Exception as e:
        logger.warning(f"Flare prediction: disease activity lookup failed for {patient_id}: {e}")
        return []


async def _get_latest_lab_trend(patient_id: str, doctor_id: str) -> Optional[dict]:
    try:
        return await lab_trend_analysis_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
    except Exception as e:
        logger.warning(f"Flare prediction: lab trend lookup failed for {patient_id}: {e}")
        return None


async def _get_recent_medication_changes(patient_id: str, doctor_id: str) -> dict:
    """Returns {'dmard_stopped': [...], 'steroid_stopped': [...]} within MEDICATION_LOOKBACK_DAYS."""
    result = {"dmard_stopped": [], "steroid_stopped": []}
    try:
        cursor = treatment_ledger_collection.find({"patient_id": patient_id, "doctor_id": doctor_id, "stop_date": {"$ne": None}})
        async for doc in cursor:
            days = _days_since(doc.get("stop_date"))
            if days is None or days > MEDICATION_LOOKBACK_DAYS:
                continue
            name_lower = (doc.get("drug_name") or "").lower()
            entry = {"drug_name": doc.get("drug_name"), "stop_date": doc.get("stop_date"), "reason_stopped": doc.get("reason_stopped")}
            if any(kw in name_lower for kw in STEROID_KEYWORDS):
                result["steroid_stopped"].append(entry)
            elif doc.get("reason_stopped") in STOP_REASON_TRIGGERS:
                result["dmard_stopped"].append(entry)
    except Exception as e:
        logger.warning(f"Flare prediction: medication change lookup failed for {patient_id}: {e}")
    return result


async def _get_flare_event_count_last_year(patient_id: str, doctor_id: str) -> int:
    try:
        cursor = flare_event_collection.find({"patient_id": patient_id, "doctor_id": doctor_id})
        count = 0
        async for doc in cursor:
            days = _days_since(doc.get("event_date"))
            if days is not None and days <= 365:
                count += 1
        return count
    except Exception as e:
        logger.warning(f"Flare prediction: flare event count failed for {patient_id}: {e}")
        return 0


async def _gather_flare_context(patient_id: str, doctor_id: str) -> dict:
    activity_records = await _get_last_two_disease_activity(patient_id, doctor_id)
    lab_trend_doc = await _get_latest_lab_trend(patient_id, doctor_id)
    med_changes = await _get_recent_medication_changes(patient_id, doctor_id)
    flare_count = await _get_flare_event_count_last_year(patient_id, doctor_id)

    current_activity = None
    activity_trend_worsening = False
    if activity_records:
        rec = activity_records[0]
        created = rec.get("created_at")
        current_activity = {
            "date": created.isoformat() if isinstance(created, datetime) else created,
            "scores": rec.get("scores", {}),
        }
        if len(activity_records) >= 2:
            cur_scores, prev_scores = activity_records[0].get("scores", {}), activity_records[1].get("scores", {})
            for key in ["das28_esr", "das28_crp", "cdai", "sdai"]:
                cur, prev = cur_scores.get(key), prev_scores.get(key)
                if cur and prev and cur.get("value") is not None and prev.get("value") is not None:
                    if cur["value"] > prev["value"]:
                        activity_trend_worsening = True

    rising_labs = []
    if lab_trend_doc:
        for t in (lab_trend_doc.get("trends") or []):
            if t.get("test_name") in ("ESR", "CRP") and t.get("direction") == "rising":
                rising_labs.append(t.get("test_name"))

    return {
        "current_disease_activity": current_activity,
        "activity_trend_worsening": activity_trend_worsening,
        "rising_inflammatory_markers": rising_labs,
        "recent_medication_changes": med_changes,
        "flare_events_last_12_months": flare_count,
    }


# ═════════════════════════════════════════════════════════════════════════════
# 1. CONTEXT PREVIEW
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-flare/context-preview/{patient_id}/{doctor_id}")
async def get_flare_context_preview(patient_id: str, doctor_id: str):
    """Read-only preview of every signal /predict will use — no score computed here."""
    context = await _gather_flare_context(patient_id, doctor_id)
    return {"status": "success", "data": context}


# ═════════════════════════════════════════════════════════════════════════════
# 2. FLARE EVENT LOG — see ASSUMPTION #5
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-flare/add-flare-event")
async def add_flare_event(payload: dict):
    """
    Expected payload:
    { "patient_id": "...", "doctor_id": "...",
      "event_date": "2026-05-12", "severity": "Moderate", "notes": "optional" }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        event_date = payload.get("event_date")
        severity = str(payload.get("severity", ""))
        notes = str(payload.get("notes", ""))

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if severity not in SEVERITY_ALLOWED:
            raise HTTPException(status_code=400, detail=f"severity must be one of: {sorted(SEVERITY_ALLOWED)}")
        try:
            datetime.strptime(event_date, "%Y-%m-%d")
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="event_date must be in YYYY-MM-DD format")

        document = {
            "patient_id": patient_id, "doctor_id": doctor_id,
            "event_date": event_date, "severity": severity, "notes": notes[:500],
            "created_at": datetime.utcnow(), "type": "rheumatology_flare_event",
        }
        result = await flare_event_collection.insert_one(document)
        return {"status": "success", "message": "Flare event logged", "id": str(result.inserted_id)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/rheumatology-flare/flare-events/{patient_id}/{doctor_id}")
async def get_flare_events(patient_id: str, doctor_id: str):
    try:
        cursor = flare_event_collection.find({"patient_id": patient_id, "doctor_id": doctor_id}).sort("event_date", -1)
        events = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            if isinstance(doc.get("created_at"), datetime):
                doc["created_at"] = doc["created_at"].isoformat()
            events.append(doc)
        return {"status": "success", "count": len(events), "data": events}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/rheumatology-flare/flare-event/{event_id}")
async def delete_flare_event(event_id: str):
    try:
        try:
            oid = ObjectId(event_id)
        except InvalidId:
            raise HTTPException(status_code=400, detail="Invalid event_id")
        result = await flare_event_collection.delete_one({"_id": oid})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Flare event not found")
        return {"status": "success", "message": "Flare event deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 3. PREDICT — deterministic scoring, see ASSUMPTION #3/#4
# ═════════════════════════════════════════════════════════════════════════════

def _compute_flare_risk(context: dict) -> dict:
    score = 0
    factors = []

    if context["activity_trend_worsening"]:
        score += 2
        factors.append("Disease activity score worsened compared to the previous assessment")

    current = context["current_disease_activity"]
    if current and current.get("scores"):
        categories = [v.get("category") for v in current["scores"].values() if v]
        if any(c in ("Moderate", "High") for c in categories):
            score += 2
            factors.append("Current disease activity is Moderate or High")

    if context["rising_inflammatory_markers"]:
        score += 2
        factors.append(f"Rising inflammatory marker(s): {', '.join(context['rising_inflammatory_markers'])}")

    dmard_stopped = context["recent_medication_changes"]["dmard_stopped"]
    if dmard_stopped:
        score += 2
        names = ", ".join(d["drug_name"] for d in dmard_stopped)
        factors.append(f"DMARD/biologic stopped in the last {MEDICATION_LOOKBACK_DAYS} days for inadequate response or toxicity: {names}")

    steroid_stopped = context["recent_medication_changes"]["steroid_stopped"]
    if steroid_stopped:
        score += 1
        names = ", ".join(d["drug_name"] for d in steroid_stopped)
        factors.append(f"Steroid stopped/tapered in the last {MEDICATION_LOOKBACK_DAYS} days: {names}")

    flare_count = context["flare_events_last_12_months"]
    if flare_count >= 2:
        score += 2
        factors.append(f"{flare_count} flare events logged in the last 12 months")
    elif flare_count == 1:
        score += 1
        factors.append("1 flare event logged in the last 12 months")

    if score >= 6:
        risk_level = "High"
    elif score >= 3:
        risk_level = "Moderate"
    else:
        risk_level = "Low"

    if not factors:
        factors.append("No elevated-risk factors identified from available data")

    return {"risk_level": risk_level, "score": score, "factors": factors}


FLARE_NARRATIVE_PROMPT = """
You are a clinical assistant. You will be given a patient's flare-risk
level (Low/Moderate/High), a numeric score, and the specific factors
behind that score (already decided by rule-based logic, not by you).

Return a JSON object with exactly one key, "narrative": ONE short
paragraph (2-3 sentences) summarizing the flare-risk picture in plain
language a physician can scan quickly, referencing the actual factors
given.

Rules:
- Do NOT change, soften, or second-guess the risk level already assigned
  — describe it, don't re-evaluate it.
- Do NOT recommend a specific treatment change, dose adjustment, or
  follow-up interval — that decision belongs to the physician.
- Do NOT invent factors not present in the input.
- Return valid JSON only — no markdown, no commentary, no extra keys.
"""


@router.post("/rheumatology-flare/predict")
async def predict_flare_risk(payload: dict):
    """
    Expected payload: { "doctor_id": "...", "patient_id": "..." }

    Returns:
    { "status": "success",
      "finaloutput": { "risk_level", "score", "factors": [...], "narrative": str|None },
      "context_used": {...} }
    """
    patient_id = payload.get("patient_id")
    doctor_id = payload.get("doctor_id")
    if not patient_id or not doctor_id:
        raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")

    context = await _gather_flare_context(patient_id, doctor_id)
    evaluation = _compute_flare_risk(context)

    narrative = None
    if groq_client is not None:
        try:
            completion = groq_client.chat.completions.create(
                model="openai/gpt-oss-120b",
                messages=[
                    {"role": "system", "content": FLARE_NARRATIVE_PROMPT},
                    {"role": "user", "content": json.dumps(evaluation, indent=2, default=str)},
                ],
                temperature=0,
                response_format={"type": "json_object"},
            )
            parsed = json.loads(completion.choices[0].message.content)
            if isinstance(parsed, dict) and parsed.get("narrative"):
                narrative = str(parsed["narrative"])[:600]
        except Exception as e:
            logger.warning(f"Flare prediction: narrative generation failed for {patient_id}: {e}")

    return {
        "status": "success",
        "finaloutput": {**evaluation, "narrative": narrative},
        "context_used": context,
    }


# ═════════════════════════════════════════════════════════════════════════════
# 4. SAVE
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-flare/save")
async def save_flare_prediction(payload: dict):
    """
    Expected payload (doctor-reviewed version of /predict's output):
    { "patient_id": "...", "doctor_id": "...",
      "risk_level": "Moderate", "score": 4, "factors": [...],
      "narrative": "optional", "context_used": {...} }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        risk_level = str(payload.get("risk_level", ""))
        score = payload.get("score")
        factors = payload.get("factors") or []

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if risk_level not in ("Low", "Moderate", "High"):
            raise HTTPException(status_code=400, detail="risk_level must be Low, Moderate, or High")
        try:
            score = int(score)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="score must be an integer")

        document = {
            "patient_id": patient_id, "doctor_id": doctor_id,
            "risk_level": risk_level, "score": score,
            "factors": [str(f)[:300] for f in factors][:15],
            "narrative": str(payload.get("narrative", ""))[:600],
            "context_used": payload.get("context_used") or {},
            "created_at": datetime.utcnow(), "type": "rheumatology_flare_prediction",
        }
        result = await flare_prediction_collection.insert_one(document)
        return {"status": "success", "message": "Flare prediction saved", "id": str(result.inserted_id)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 5. HISTORY
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-flare/history/{patient_id}/{doctor_id}")
async def get_flare_prediction_history(patient_id: str, doctor_id: str):
    try:
        cursor = flare_prediction_collection.find(
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