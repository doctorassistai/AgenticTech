"""
rheumatology_treatment_response_api.py
─────────────────────────────────────────────────────────────────────────────
DoctorAssist.AI — Rheumatology AI Workflow, Treatment Response Evaluation
Module (requirement #13 in the senior review).

The roadmap asks for one engine that classifies OVERALL treatment response
by combining: disease-activity score delta, biomarker trend, imaging
comparison direction, and functional-status delta, into exactly one of:

    Improving | Stable | Inadequate response | Worsening | Possible flare

Unlike the Correlation Engine (#7, pure LLM synthesis, no rule engine by
design), this module DOES have a deterministic rule engine — the same
"Python decides, LLM only narrates" boundary as every module except
Correlation. See `_classify_response()` for the full rule set.

This module owns NO new structured data — like Correlation, it is a
read-and-synthesize layer, but with an added classification step. It reads:

    - Disease Activity (Module 6) — the TWO most recent saved records,
      to compute a category-tier delta. This is the REQUIRED input —
      without at least 2 saved Disease Activity records, no classification
      is possible, and /evaluate returns 400.
    - Biomarker Analysis (Module 4.5) — the TWO most recent saved records,
      to compute an abnormal-flag-count delta. OPTIONAL corroborating
      signal — degrades to "no biomarker signal" if fewer than 2 exist.
    - Imaging comparisons (Module 11) — the single most recent saved
      record, aggregating per-region worsening/improving/stable directions
      by majority. OPTIONAL corroborating signal — see ASSUMPTION #2,
      this is the one genuinely [UNCONFIRMED] piece in this file.

Functional status (the fourth input the roadmap names) is NOT included in
v1 — see ASSUMPTION #3. This is a known, explicitly flagged gap, not a
silent omission.

ROUTES IN THIS FILE
---------------------
  GET  /rheumatology-treatment-response/context-preview/{patient_id}/{doctor_id}
  POST /rheumatology-treatment-response/evaluate
  POST /rheumatology-treatment-response/save
  GET  /rheumatology-treatment-response/history/{patient_id}/{doctor_id}

⚠️ ASSUMPTIONS MADE WHILE ASSEMBLING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. DISEASE ACTIVITY DELTA IS THE REQUIRED PRIMARY SIGNAL: /evaluate
     requires at least 2 saved rheumatology_disease_activity records for
     this patient (so a Previous → Current tier comparison can be
     computed). If fewer than 2 exist, returns 400 with a clear message —
     there is no meaningful "response" classification with only one data
     point. Biomarker and imaging signals are optional modifiers on top of
     this required primary signal — see `_classify_response()`.

  2. IMAGING COMPARISON FIELD SHAPE — [UNCONFIRMED — clinical/dev review
     required]: this file reads database["rheumatology_imaging_comparisons"]
     (collection name confirmed via rheumatology_correlation_api.py, which
     already reads it read-only), and expects each saved record's
     "comparisons" list to contain per-region dicts with a "direction"
     field valued one of "worsening" / "improving" / "stable" (this is a
     GUESS at the field name, based on the gap-analysis doc's description
     of Module 11 producing a "longitudinal comparison narrative
     (worsening/improving/stable) across studies" — the actual Imaging
     API file was not available when this was written). This read is
     wrapped in try/except and degrades to "no imaging signal" if the
     field name doesn't match or is missing — it will NOT crash, but it
     will also silently contribute nothing until confirmed. Please supply
     rheumatology_imaging_api.py (or just the imaging_comparisons save
     shape) so this can be corrected — flagging explicitly rather than
     presenting this as settled.

  3. FUNCTIONAL STATUS IS NOT INCLUDED IN V1: the roadmap's requirement
     #13 names functional status as a fourth input alongside disease
     activity, biomarkers, and imaging. No module in this codebase
     currently captures a structured functional-status field (confirmed:
     not in the Treatment Ledger, Disease Activity, Biomarker Analysis,
     or Correlation files reviewed). Rather than invent a field shape
     that might not match wherever functional status eventually gets
     captured (Intake or Joint Map, per the roadmap's own suggestion),
     this is left out entirely for v1 and flagged as the natural next
     extension once that field exists — same treatment as Correlation's
     ASSUMPTION #6 for symptoms/treatment-response.

  4. COLLECTION NAME: "rheumatology_treatment_responses" for saved
     evaluations. Change RESPONSE_COLLECTION_NAME below if you want a
     different name.

  5. CLASSIFICATION RULES ARE A FIRST DRAFT — [UNCONFIRMED — clinical
     review required]: `_classify_response()` implements a reasonable,
     literature-consistent reading of the 5 categories (tier-delta based,
     corroborating signals only used to distinguish Worsening from
     Possible flare, and Stable from Inadequate response), but the exact
     thresholds/logic have not been reviewed by a rheumatologist. Flagging
     this the same way Steroid Tapering's TAPER_RULES were flagged last
     session — this is clinical decision support logic and needs sign-off
     before being trusted in practice.

  6. ROUTER MOUNT: same convention as every other rheumatology file —
     `prefix="/context"`, mount with `app.include_router(...)` in main.py.

  7. ALL FLAGS/CLASSIFICATION ARE RULE-BASED, NOT LLM-DECIDED: the LLM's
     only job is an optional plain-language narrative describing the
     already-decided classification and the signals behind it — it never
     re-decides the classification itself.
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

RESPONSE_COLLECTION_NAME = "rheumatology_treatment_responses"  # see ASSUMPTION #4

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    treatment_response_collection = database[RESPONSE_COLLECTION_NAME]

    # Read-only reaches into other modules' collections
    disease_activity_collection = database["rheumatology_disease_activity"]  # confirmed shape
    biomarker_analysis_collection = database["rheumatology_biomarker_analyses"]  # confirmed shape
    imaging_comparison_collection = database["rheumatology_imaging_comparisons"]  # see ASSUMPTION #2
except Exception as e:
    logger.error(f"Error initializing MongoDB in rheumatology_treatment_response_api: {e}")

# ─── Groq setup ─────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client: Optional[Groq] = None
try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        logger.warning("GROQ_API_KEY not set — response narrative will be skipped (classification still computes).")
except Exception as e:
    logger.error(f"Error initializing Groq client in rheumatology_treatment_response_api: {e}")

router = APIRouter(prefix="/context", tags=["Rheumatology Treatment Response Evaluation"])

# ─── Severity tier maps — 0 = best/least active, higher = worse ─────────────
# Mirrors the category strings rheumatology_disease_activity_api.py's
# _categorize_* functions actually produce.
SCORE_TIERS = {
    "das28_esr": {"Remission": 0, "Low": 1, "Moderate": 2, "High": 3},
    "das28_crp": {"Remission": 0, "Low": 1, "Moderate": 2, "High": 3},
    "cdai": {"Remission": 0, "Low": 1, "Moderate": 2, "High": 3},
    "sdai": {"Remission": 0, "Low": 1, "Moderate": 2, "High": 3},
    "asdas": {"Inactive": 0, "Moderate": 1, "High": 2, "Very High": 3},
    "basdai": {"Inactive": 0, "Active": 1},
    "sledai": {"No Activity": 0, "Mild": 1, "Moderate": 2, "High": 3, "Very High": 4},
}

# Preference order for picking which score to base the primary delta on,
# when a patient has multiple scores saved (e.g. RA scores always present
# per Module 6's ASSUMPTION #3, axial SpA / SLE scores only if applicable).
SCORE_PRIORITY = ["das28_crp", "das28_esr", "cdai", "sdai", "asdas", "basdai", "sledai"]


def _pick_primary_score(previous_scores: dict, current_scores: dict) -> Optional[dict]:
    """
    Finds the highest-priority score key present (with a valid category) in
    BOTH the previous and current saved Disease Activity records, and
    returns {key, previous_tier, current_tier, previous_category,
    current_category}. Returns None if no score key is present in both.
    """
    for key in SCORE_PRIORITY:
        prev_item = previous_scores.get(key)
        curr_item = current_scores.get(key)
        if not (isinstance(prev_item, dict) and isinstance(curr_item, dict)):
            continue
        prev_cat = prev_item.get("category")
        curr_cat = curr_item.get("category")
        tiers = SCORE_TIERS.get(key, {})
        if prev_cat in tiers and curr_cat in tiers:
            return {
                "score_key": key,
                "previous_category": prev_cat,
                "current_category": curr_cat,
                "previous_tier": tiers[prev_cat],
                "current_tier": tiers[curr_cat],
                "tier_delta": tiers[curr_cat] - tiers[prev_cat],
            }
    return None


# ═════════════════════════════════════════════════════════════════════════════
# SOURCE FETCHERS
# ═════════════════════════════════════════════════════════════════════════════

async def _get_last_two_disease_activity(patient_id: str, doctor_id: str) -> list:
    try:
        cursor = disease_activity_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("created_at", -1).limit(2)
        docs = [doc async for doc in cursor]
        return docs
    except Exception as e:
        logger.warning(f"Treatment response: disease activity lookup failed for {patient_id}: {e}")
        return []


async def _get_last_two_biomarker_analyses(patient_id: str, doctor_id: str) -> list:
    try:
        cursor = biomarker_analysis_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("created_at", -1).limit(2)
        docs = [doc async for doc in cursor]
        return docs
    except Exception as e:
        logger.warning(f"Treatment response: biomarker analysis lookup failed for {patient_id}: {e}")
        return []


async def _get_latest_imaging_comparison(patient_id: str, doctor_id: str) -> Optional[dict]:
    """See ASSUMPTION #2 — field shape is a best-effort guess, degrades gracefully."""
    try:
        doc = await imaging_comparison_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        return doc
    except Exception as e:
        logger.warning(f"Treatment response: imaging comparison lookup failed for {patient_id}: {e}")
        return None


def _biomarker_abnormal_count(doc: dict) -> int:
    numeric_flags = doc.get("numeric_flags") or []
    return sum(1 for f in numeric_flags if f.get("flag") in ("high", "low"))


def _biomarker_delta(records: list) -> Optional[dict]:
    """records = up to 2 docs, most recent first. Returns delta info or None."""
    if len(records) < 2:
        return None
    current, previous = records[0], records[1]
    curr_count = _biomarker_abnormal_count(current)
    prev_count = _biomarker_abnormal_count(previous)
    delta = curr_count - prev_count
    direction = "worsened" if delta > 0 else ("improved" if delta < 0 else "same")
    return {
        "previous_abnormal_count": prev_count,
        "current_abnormal_count": curr_count,
        "delta": delta,
        "direction": direction,
        "previous_date": previous.get("created_at").isoformat() if isinstance(previous.get("created_at"), datetime) else previous.get("created_at"),
        "current_date": current.get("created_at").isoformat() if isinstance(current.get("created_at"), datetime) else current.get("created_at"),
    }


def _imaging_direction(doc: Optional[dict]) -> Optional[dict]:
    """
    See ASSUMPTION #2. Expects doc["comparisons"] = [{..., "direction":
    "worsening"|"improving"|"stable", ...}, ...]. Returns None (no signal)
    if the doc is missing or the expected field isn't present anywhere in
    the comparisons list — never raises.
    """
    if not doc:
        return None
    comparisons = doc.get("comparisons") or []
    if not comparisons:
        return None

    worsening = sum(1 for c in comparisons if isinstance(c, dict) and c.get("direction") == "worsening")
    improving = sum(1 for c in comparisons if isinstance(c, dict) and c.get("direction") == "improving")
    stable = sum(1 for c in comparisons if isinstance(c, dict) and c.get("direction") == "stable")

    if worsening == 0 and improving == 0 and stable == 0:
        # Field name didn't match anything in the data — degrade to no signal
        # rather than guess further.
        return None

    if worsening > improving:
        direction = "worsened"
    elif improving > worsening:
        direction = "improved"
    else:
        direction = "same"

    return {
        "regions_worsening": worsening,
        "regions_improving": improving,
        "regions_stable": stable,
        "direction": direction,
        "date": doc.get("created_at").isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
    }


# ═════════════════════════════════════════════════════════════════════════════
# DETERMINISTIC CLASSIFICATION — see ASSUMPTION #5
# ═════════════════════════════════════════════════════════════════════════════

def _classify_response(primary: dict, biomarker: Optional[dict], imaging: Optional[dict]) -> str:
    """
    primary: output of _pick_primary_score() — REQUIRED, never None here
    (caller gates on this). biomarker/imaging: output of their respective
    delta functions, or None if unavailable.

    Returns one of: "Improving" | "Stable" | "Inadequate response" |
    "Worsening" | "Possible flare"
    """
    tier_delta = primary["tier_delta"]
    current_tier = primary["current_tier"]

    corroborating_worsening = (
        (biomarker and biomarker["direction"] == "worsened")
        or (imaging and imaging["direction"] == "worsened")
    )
    corroborating_improving = (
        (biomarker and biomarker["direction"] == "improved")
        or (imaging and imaging["direction"] == "improved")
    )

    if tier_delta > 0:
        # Disease activity got worse
        return "Possible flare" if corroborating_worsening else "Worsening"

    if tier_delta < 0:
        # Disease activity improved — even if one secondary signal lags,
        # the primary validated clinical score takes precedence per
        # ASSUMPTION #1's "required primary signal" design.
        return "Improving"

    # tier_delta == 0 — disease activity score unchanged
    if current_tier == 0:
        # Remission/inactive maintained — genuinely stable, not "inadequate"
        return "Stable"
    if corroborating_worsening:
        # Unchanged composite score but corroborating signals worsening —
        # treat cautiously as possible early flare rather than plain stable.
        return "Possible flare"
    if corroborating_improving:
        return "Stable"
    # Unchanged AND disease still active (tier > 0) AND no improving signal
    return "Inadequate response"


# ═════════════════════════════════════════════════════════════════════════════
# 1. CONTEXT PREVIEW
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-treatment-response/context-preview/{patient_id}/{doctor_id}")
async def get_treatment_response_context_preview(patient_id: str, doctor_id: str):
    """Shows whether enough data exists to run /evaluate — see ASSUMPTION #1."""
    da_records = await _get_last_two_disease_activity(patient_id, doctor_id)
    bm_records = await _get_last_two_biomarker_analyses(patient_id, doctor_id)
    imaging_doc = await _get_latest_imaging_comparison(patient_id, doctor_id)

    primary = None
    if len(da_records) >= 2:
        primary = _pick_primary_score(
            da_records[1].get("scores", {}) or {}, da_records[0].get("scores", {}) or {}
        )

    return {
        "status": "success",
        "data": {
            "disease_activity_records_available": len(da_records),
            "primary_score_key": primary["score_key"] if primary else None,
            "biomarker_records_available": len(bm_records),
            "imaging_available": imaging_doc is not None,
        },
        "can_evaluate": primary is not None,
    }


# ═════════════════════════════════════════════════════════════════════════════
# 2. EVALUATE
# ═════════════════════════════════════════════════════════════════════════════

RESPONSE_NARRATIVE_PROMPT = """
You are a clinical assistant. You will be given an ALREADY-DECIDED overall
treatment response classification (one of: Improving, Stable, Inadequate
response, Worsening, Possible flare) for a rheumatology patient, plus the
data behind that decision: the primary disease-activity score's previous
vs current category, and optionally a biomarker abnormal-value-count trend
and/or an imaging worsening/improving/stable summary.

Return a JSON object with exactly one key, "narrative": ONE short
paragraph (2-4 sentences) explaining, in plain language, why the response
was classified this way, referencing the actual categories/numbers given.

Rules:
- Do NOT change or second-guess the classification given — describe why
  it was reached, don't re-derive it.
- Do NOT recommend a specific treatment change — you may note that the
  clinician may wish to review the treatment plan, consistent with the
  classification, but the decision itself belongs to the physician.
- Do NOT invent scores, values, or sources not present in the input.
- Return valid JSON only — no markdown, no commentary, no extra keys.
"""


@router.post("/rheumatology-treatment-response/evaluate")
async def evaluate_treatment_response(payload: dict):
    """
    Expected payload: { "doctor_id": "...", "patient_id": "..." }

    Returns:
    {
        "status": "success",
        "finaloutput": {
            "classification": str,
            "primary_signal": {score_key, previous_category, current_category, tier_delta},
            "biomarker_signal": {...} | None,
            "imaging_signal": {...} | None,
            "narrative": str | None
        }
    }
    """
    patient_id = payload.get("patient_id")
    doctor_id = payload.get("doctor_id")
    if not patient_id or not doctor_id:
        raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")

    da_records = await _get_last_two_disease_activity(patient_id, doctor_id)
    if len(da_records) < 2:
        raise HTTPException(
            status_code=400,
            detail=(
                "Not enough Disease Activity data to evaluate response — need at "
                "least 2 saved Disease Activity assessments (Previous → Current) "
                f"for this patient. Currently have: {len(da_records)}."
            ),
        )

    primary = _pick_primary_score(
        da_records[1].get("scores", {}) or {}, da_records[0].get("scores", {}) or {}
    )
    if primary is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "The two most recent Disease Activity records don't share a "
                "common comparable score (e.g. DAS28 in one, SLEDAI-only in the "
                "other) — cannot compute a tier delta."
            ),
        )

    bm_records = await _get_last_two_biomarker_analyses(patient_id, doctor_id)
    biomarker = _biomarker_delta(bm_records)

    imaging_doc = await _get_latest_imaging_comparison(patient_id, doctor_id)
    imaging = _imaging_direction(imaging_doc)

    classification = _classify_response(primary, biomarker, imaging)

    narrative = None
    if groq_client is not None:
        try:
            llm_input = {
                "classification": classification,
                "primary_signal": primary,
                "biomarker_signal": biomarker,
                "imaging_signal": imaging,
            }
            completion = groq_client.chat.completions.create(
                model="openai/gpt-oss-120b",
                messages=[
                    {"role": "system", "content": RESPONSE_NARRATIVE_PROMPT},
                    {"role": "user", "content": json.dumps(llm_input, indent=2, default=str)},
                ],
                temperature=0,
                response_format={"type": "json_object"},
            )
            parsed = json.loads(completion.choices[0].message.content)
            if isinstance(parsed, dict) and parsed.get("narrative"):
                narrative = str(parsed["narrative"])[:600]
        except Exception as e:
            logger.warning(f"Treatment response: narrative generation failed for {patient_id}: {e}")

    return {
        "status": "success",
        "finaloutput": {
            "classification": classification,
            "primary_signal": primary,
            "biomarker_signal": biomarker,
            "imaging_signal": imaging,
            "narrative": narrative,
        },
    }


# ═════════════════════════════════════════════════════════════════════════════
# 3. SAVE
# ═════════════════════════════════════════════════════════════════════════════

CLASSIFICATION_ALLOWED = {"Improving", "Stable", "Inadequate response", "Worsening", "Possible flare"}


@router.post("/rheumatology-treatment-response/save")
async def save_treatment_response(payload: dict):
    """
    Expected payload (doctor-reviewed/edited version of /evaluate's output):
    {
        "patient_id": "...", "doctor_id": "...",
        "classification": "Improving",
        "primary_signal": {...}, "biomarker_signal": {...} | null,
        "imaging_signal": {...} | null, "narrative": "optional"
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        classification = str(payload.get("classification", ""))
        primary_signal = payload.get("primary_signal") or {}
        biomarker_signal = payload.get("biomarker_signal")
        imaging_signal = payload.get("imaging_signal")
        narrative = payload.get("narrative") or ""

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if classification not in CLASSIFICATION_ALLOWED:
            raise HTTPException(status_code=400, detail=f"classification must be one of: {sorted(CLASSIFICATION_ALLOWED)}")
        if not primary_signal:
            raise HTTPException(status_code=400, detail="primary_signal is required")

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "classification": classification,
            "primary_signal": primary_signal,
            "biomarker_signal": biomarker_signal,
            "imaging_signal": imaging_signal,
            "narrative": str(narrative)[:600],
            "created_at": datetime.utcnow(),
            "type": "rheumatology_treatment_response",
        }
        result = await treatment_response_collection.insert_one(document)

        return {"status": "success", "message": "Treatment response evaluation saved", "id": str(result.inserted_id)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 4. HISTORY
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-treatment-response/history/{patient_id}/{doctor_id}")
async def get_treatment_response_history(patient_id: str, doctor_id: str):
    """Fetch all saved Treatment Response evaluations for a patient, most recent first."""
    try:
        cursor = treatment_response_collection.find(
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