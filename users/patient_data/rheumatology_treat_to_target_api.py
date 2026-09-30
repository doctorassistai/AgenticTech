"""
rheumatology_treat_to_target_api.py
─────────────────────────────────────────────────────────────────────────────
DoctorAssist.AI — Rheumatology AI Workflow, Module 15: Treat-to-Target
Dashboard (v1.0).

The roadmap describes this as a single-screen rollup: Disease / Target /
Current / Trend / Current treatment / Response / Safety / Next review /
AI recommendation / Guideline evidence. Unlike Modules 1-14, this module
does NOT own a new manual entry log — it is a read-only AGGREGATOR that
pulls each field from the module that already owns it:

    Disease / working diagnosis  → Module 3  (rheumatology_differential_diagnosis)
    Current → disease activity   → Module 6  (rheumatology_disease_activity_assessments)
    Current treatment            → Module 7  (rheumatology_treatment_decisions)
                                    + documentation-medication-analysis (active Rx list)
    Safety                       → Module 8  (rheumatology_dmard_safety_assessments)
                                    + Module 14 (rheumatology_steroid_assessments), best-effort
    Flare risk (shown alongside Safety, not in the roadmap's field list,
    but directly relevant to "what needs attention now")
                                  → Module 10 (rheumatology_flare_predictions)
    Patient Summary (condition/duration/allergies/comorbidities)
                                  → Module 3 (working_diagnosis, already read),
                                    Module 1 (rheumatology_intake — comorbidities,
                                    onset), Module 13 (rheumatology_comorbidity_risk),
                                    added this session — see ASSUMPTIONS #12-14.
    Laboratory (latest biomarkers, abnormal values)
                                  → Module 4.5 (rheumatology_biomarker_analyses),
                                    added this session — see ASSUMPTION #15.
    Imaging (latest study, key findings)
                                  → Module 11 (rheumatology_imaging_comparisons,
                                    falls back to rheumatology_imaging_studies),
                                    added this session — see ASSUMPTION #16.

The only two things this module DOES own and persist are (a) the
doctor-chosen Target (Remission / Low disease activity) and Next Review
date — nothing upstream captures those — and (b) an optional saved
dashboard snapshot for trend-over-time / audit purposes.

Trend (↑ worsening / ↓ improving / → stable) and the short AI
Recommendation tag are computed by deterministic rules on top of the
aggregated data, NOT by the LLM — same "rule engine decides, LLM only
narrates" split as every prior rheumatology module. The LLM's narrative
is purely descriptive and never recommends a specific drug, dose, or
test — that decision belongs to the physician, per every prior module's
narrative-prompt convention.

ROUTES IN THIS FILE
---------------------
  GET  /rheumatology-treat-to-target/dashboard/{patient_id}/{doctor_id}
  GET  /rheumatology-treat-to-target/target/{patient_id}/{doctor_id}
  POST /rheumatology-treat-to-target/set-target
  POST /rheumatology-treat-to-target/save-snapshot
  GET  /rheumatology-treat-to-target/history/{patient_id}/{doctor_id}

⚠️ ASSUMPTIONS MADE WHILE ASSEMBLING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. ROUTER MOUNT: same convention as the fourteen prior rheumatology
     files — `prefix="/context"`, mount with `app.include_router(...)`
     in main.py.

  2. COLLECTION NAMES FOR UPSTREAM MODULES — UPDATED: Modules 7, 8, and 10's
     actual backend files have now been reviewed and all names/fields below
     are CONFIRMED, not guessed. Corrections made from the original
     low-confidence version are called out inline at each fix site:
       - rheumatology_disease_activity                (Module 6 — CONFIRMED.
         Was correct already: {scores, inputs_used, narrative, target}).
       - rheumatology_treatment_decision               (Module 7 — CONFIRMED,
         CORRECTED from the guessed plural "..._decisions". Also: this
         collection's saved documents do NOT have a "response" field —
         Module 7 computes response live but never persists it, so
         `response` will always read as None/"Not recorded" here, not just
         in the rare case ASSUMPTION #6 originally anticipated. And the
         guideline field is named "guideline_reference", not
         "guideline_pathway" — corrected).
       - rheumatology_dmard_safety                     (Module 8 — CONFIRMED,
         CORRECTED from the guessed "..._assessments". Also: the saved
         document's per-drug entries live under "panel" (not
         "drugs"/"domains"), with "status" (not "category") and "name"
         (not "drug"/"domain") — corrected in `_worst_safety_flag()`).
       - rheumatology_flare_predictions                (Module 10 —
         collection name was already correct. Field name was NOT: the
         saved document stores the risk category as "risk_level", not
         "probability_category"/"category" — corrected).
       - rheumatology_differential_diagnosis            (Module 3 — HIGH
         confidence: confirmed via Module 11's working_diagnosis lookup).
       - rheumatology_steroid_assessments                (Module 14 — HIGH
         confidence, this codebase).
       - documentation-medication-analysis               (active Rx list —
         HIGH confidence: confirmed via Module 11's medication lookup).
     All lookups remain defensive (every field access uses `.get()` with a
     fallback), so any future upstream schema change still degrades to
     "not available" instead of a 500 — but the dashboard is now accurate
     against Modules 7/8/10 as they actually exist today.

  3. "CURRENT" DISEASE ACTIVITY = MOST RECENT Module 6 SAVE; "PREVIOUS"
     = THE ONE BEFORE THAT. If Module 6 has fewer than two saves, trend
     is reported as `null` ("not enough history yet") rather than
     guessed.

  4. TREND METRIC PREFERENCE ORDER: DAS28-CRP → DAS28-ESR → CDAI → SDAI
     — whichever is present on BOTH the current and previous Module 6
     save. Mixing metrics between the two timepoints is avoided (e.g.
     comparing a save that only has CDAI against one that only has
     DAS28 would be misleading); if no single metric is present on
     both, trend is `null`.

  5. TREND DIRECTION IS RULE-BASED: current value > previous value by
     more than TREND_NOISE_THRESHOLD (0.1 absolute score points) →
     "worsening"; less than -TREND_NOISE_THRESHOLD → "improving";
     otherwise "stable". The small noise threshold avoids reporting a
     trend on trivial rounding differences — a heuristic, not a
     validated minimum-clinically-important-difference (MCID) figure;
     tell me if you want per-score MCID thresholds (they differ, e.g.
     DAS28 MCID ≈1.2) and I'll parameterize this.

  6. "RESPONSE" IS READ FROM Module 7's LATEST DECISION RECORD, field
     name guessed as `response` (e.g. "Good"/"Partial"/"Inadequate") —
     see ASSUMPTION #2. If absent, this module does NOT infer response
     from the disease-activity trend alone (response is a clinical
     judgment combining more context than a score delta) — it reports
     "Not recorded" instead of guessing.

  7. "SAFETY" ROLLS UP THE WORST (highest-severity) FLAG ACROSS
     Module 8's latest DMARD safety save AND Module 14's latest
     steroid stewardship save, if either exists — same "worst flag
     wins" logic as a simple aggregate, not a weighted score. Either
     source being absent doesn't block the dashboard; it's reported as
     "not assessed yet" for that source.

  8. FLARE RISK IS INFORMATIONAL, SHOWN ALONGSIDE SAFETY: pulled from
     Module 10's latest save if present, purely for the "what needs
     attention now" picture — not one of the roadmap's named dashboard
     fields, but directly relevant, so it's included as an extra
     `flare_risk` key rather than forced into an existing field.

  9. RECOMMENDATION TAG IS A SHORT, RULE-BASED LABEL, NOT FREE TEXT:
     `_derive_recommendation()` returns one of a small fixed set
     ("Continue current plan", "Reassess at next follow-up", "Review
     escalation options", "Safety review recommended") from trend +
     response + worst safety flag. This mirrors the roadmap's own
     example ("AI recommendation: Review escalation options") — it is
     a label pointing the physician's attention, not an instruction,
     and the physician always makes the actual decision.

 10. GUIDELINE EVIDENCE IS A STATIC STRING, NOT RAG-BACKED: this module
     does not do citation retrieval — it echoes whatever guideline_pathway
     string Module 7 already recorded (see ASSUMPTION #2), or "EULAR
     treat-to-target" as a generic fallback label if Module 7 has
     nothing recorded. A real guideline/RAG agent (mentioned in the
     roadmap's bigger-architecture section) is out of scope here.

 11. TARGET / NEXT REVIEW ARE UPSERTED PER (patient_id, doctor_id) —
     one active setting at a time, overwritten by each /set-target
     call, not versioned. Snapshot history (via /save-snapshot) is the
     mechanism for looking back at what the target/review date were on
     a past visit, same pattern as every prior module's save+history
     pair.

  12. PATIENT SUMMARY — CONDITION: reuses the working_diagnosis lookup
     this file already performs for the rollup header (Module 3) — no
     new source needed.

 13. PATIENT SUMMARY — DISEASE DURATION IS NOT A STRUCTURED FIELD
     ANYWHERE: Module 1 (rheumatology_intake) captures "onset" as
     free text (e.g. "gradual onset 3 months ago"), not a parsed
     duration. Rather than attempt to parse that into a number (which
     would silently misfire on ambiguous phrasing like "several years,
     worse recently"), this dashboard surfaces the raw onset string
     as-is, honestly labeled "as recorded at intake" on the frontend,
     not as a computed duration. If a real structured duration field is
     ever added to Intake, this should be repointed to it.

 14. PATIENT SUMMARY — ALLERGIES ARE NOT CAPTURED ANYWHERE IN THIS
     WORKFLOW: confirmed absent from Module 1 (Intake), and no other
     reviewed module captures them either. This dashboard reports
     `allergies: None` rather than guessing a source or inventing a
     field — same "known gap, explicitly reported rather than silently
     guessed" treatment as ASSUMPTION #6's `response` field. Flagging
     for a future Intake extension, not something this file should
     invent.

 15. PATIENT SUMMARY — COMORBIDITIES: primary source is Module 1's
     rheumatology_intake.comorbidities (raw free-text list, confirmed
     shape) — always available if intake was done, regardless of
     whether Comorbidity Risk (Module 13) has been run. If Module 13
     HAS a saved review, its `domains` list (confirmed shape:
     {domain, category, reasons, auto_detected_factors, checklist}) is
     also included as an optional enrichment (`comorbidity_risk_domains`)
     so the dashboard can show Low/Moderate/High per domain, not just
     the raw comorbidity strings. Module 13 absent doesn't block the
     panel — it just omits the risk-category enrichment.

 16. LABORATORY PANEL: sourced from Module 4.5's
     rheumatology_biomarker_analyses (confirmed shape: numeric_flags,
     qualitative_summary) — the latest saved analysis only, no trend
     field (Module 5/Lab Trends' own trend computation was not reviewed
     for this dashboard and is intentionally not depended on here, to
     avoid guessing a second collection's shape for one panel).

 17. IMAGING PANEL: prefers Module 11's latest saved
     rheumatology_imaging_comparisons record (confirmed shape:
     comparisons[].{region, direction, cross_modality, ...}) if one
     exists. If no comparison has been saved yet (e.g. only one study
     logged for any region so far — Module 11 requires 2+ to compare),
     falls back to the single most recent raw
     rheumatology_imaging_studies entry so the panel isn't empty before
     a comparison becomes possible. The frontend distinguishes the two
     cases via a `source` field ("comparison" vs "latest_study").
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

TARGET_COLLECTION_NAME = "rheumatology_treat_to_target_settings"
SNAPSHOT_COLLECTION_NAME = "rheumatology_treat_to_target_snapshots"

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    target_collection = database[TARGET_COLLECTION_NAME]
    snapshot_collection = database[SNAPSHOT_COLLECTION_NAME]

    # Upstream modules — collection names confirmed against Modules 7/8/10's
    # actual files (see ASSUMPTION #2, updated). Corrections applied:
    #   - disease_activity: was "..._assessments" (wrong) -> "rheumatology_disease_activity"
    #   - treatment_decision: was plural "..._decisions" (wrong) -> singular "rheumatology_treatment_decision"
    #   - dmard_safety: was "..._assessments" (wrong) -> "rheumatology_dmard_safety"
    #   - flare_prediction: "rheumatology_flare_predictions" was already correct
    disease_activity_collection = database["rheumatology_disease_activity"]
    treatment_decision_collection = database["rheumatology_treatment_decision"]
    dmard_safety_collection = database["rheumatology_dmard_safety"]
    flare_prediction_collection = database["rheumatology_flare_predictions"]
    differential_collection = database["rheumatology_differential_diagnosis"]
    steroid_assessment_collection = database["rheumatology_steroid_assessments"]
    documentation_medication_analysis_collection = database["documentation-medication-analysis"]
    treatment_ledger_collection = database["rheumatology_treatment_ledger"]

    # Added this session — see ASSUMPTIONS #12-17
    rheumatology_intake_collection = database["rheumatology_intake"]
    comorbidity_risk_collection = database["rheumatology_comorbidity_risk"]
    biomarker_analysis_collection = database["rheumatology_biomarker_analyses"]
    imaging_comparison_collection = database["rheumatology_imaging_comparisons"]
    imaging_studies_collection = database["rheumatology_imaging_studies"]
except Exception as e:
    logger.error(f"Error initializing MongoDB in rheumatology_treat_to_target_api: {e}")

# ─── Groq setup ─────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client: Optional[Groq] = None
try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        logger.warning("GROQ_API_KEY not set — treat-to-target narrative will be skipped (rollup still computes).")
except Exception as e:
    logger.error(f"Error initializing Groq client in rheumatology_treat_to_target_api: {e}")

router = APIRouter(prefix="/context", tags=["Rheumatology Treat-to-Target Dashboard"])

TARGET_ALLOWED = {"Remission", "Low disease activity"}
SCORE_PREFERENCE_ORDER = ["das28_crp", "das28_esr", "cdai", "sdai"]  # see ASSUMPTION #4
TREND_NOISE_THRESHOLD = 0.1  # see ASSUMPTION #5

SAFETY_SEVERITY_RANK = {"green": 0, "yellow": 1, "red": 2}


# ═════════════════════════════════════════════════════════════════════════════
# UPSTREAM LOOKUPS — every field access is defensive (.get with fallback);
# a missing/renamed upstream collection degrades to "not available" instead
# of a 500. See ASSUMPTION #2.
# ═════════════════════════════════════════════════════════════════════════════

async def _get_recent_disease_activity(patient_id: str, doctor_id: str, limit: int = 2) -> list:
    try:
        cursor = disease_activity_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("created_at", -1).limit(limit)
        return [doc async for doc in cursor]
    except Exception as e:
        logger.warning(f"Treat-to-target: disease activity lookup failed for {patient_id}: {e}")
        return []


async def _get_latest_treatment_decision(patient_id: str, doctor_id: str) -> Optional[dict]:
    try:
        return await treatment_decision_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
    except Exception as e:
        logger.warning(f"Treat-to-target: treatment decision lookup failed for {patient_id}: {e}")
        return None


async def _get_latest_dmard_safety(patient_id: str, doctor_id: str) -> Optional[dict]:
    try:
        return await dmard_safety_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
    except Exception as e:
        logger.warning(f"Treat-to-target: DMARD safety lookup failed for {patient_id}: {e}")
        return None


async def _get_latest_steroid_assessment(patient_id: str, doctor_id: str) -> Optional[dict]:
    try:
        return await steroid_assessment_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
    except Exception as e:
        logger.warning(f"Treat-to-target: steroid assessment lookup failed for {patient_id}: {e}")
        return None


async def _get_latest_flare_prediction(patient_id: str, doctor_id: str) -> Optional[dict]:
    try:
        return await flare_prediction_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
    except Exception as e:
        logger.warning(f"Treat-to-target: flare prediction lookup failed for {patient_id}: {e}")
        return None


async def _get_working_diagnosis(patient_id: str, doctor_id: str) -> Optional[str]:
    """
    Same fallback as Module 7's disease-matching lookup: prefer the
    explicit working_diagnosis field, but fall back to the differential's
    "likely" tier if that field was never separately confirmed/set.
    Without this fallback, a patient with a clear likely-tier diagnosis
    but no separately-saved working_diagnosis string reads as "Not yet
    established" even though Module 7 successfully resolves the same
    patient's disease via this same fallback path.
    """
    try:
        doc = await differential_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        if not doc:
            return None
        working = doc.get("working_diagnosis")
        if working:
            return working
        likely = (doc.get("differential_diagnosis") or {}).get("likely") or []
        if likely:
            top = likely[0].get("condition")
            if top:
                return top
    except Exception as e:
        logger.warning(f"Treat-to-target: working diagnosis lookup failed for {patient_id}: {e}")
    return None


async def _get_current_medications(patient_id: str, doctor_id: str) -> list:
    """
    Source-of-truth order matching Modules 7, 8, and Structured Note's
    ledger-first pattern: rheumatology_treatment_ledger active entries
    (stop_date is null) first, documentation-medication-analysis as
    legacy fallback.
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
        logger.warning(f"Treat-to-target: treatment ledger lookup failed for {patient_id}: {e}")

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
        logger.warning(f"Treat-to-target: medication lookup failed for {patient_id}: {e}")

    return names


async def _get_target_setting(patient_id: str, doctor_id: str) -> dict:
    try:
        doc = await target_collection.find_one({"patient_id": patient_id, "doctor_id": doctor_id})
        if doc:
            return {"target": doc.get("target", "Remission"), "next_review_date": doc.get("next_review_date")}
    except Exception as e:
        logger.warning(f"Treat-to-target: target setting lookup failed for {patient_id}: {e}")
    return {"target": "Remission", "next_review_date": None}


async def _get_latest_intake_summary(patient_id: str, doctor_id: str) -> dict:
    """See ASSUMPTIONS #13, #15. Returns {} if no intake exists yet."""
    try:
        doc = await rheumatology_intake_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        if not doc:
            return {}
        intake = doc.get("rheumatology_intake") or {}
        return {
            "onset": intake.get("onset"),
            "comorbidities": intake.get("comorbidities") or [],
        }
    except Exception as e:
        logger.warning(f"Treat-to-target: intake lookup failed for {patient_id}: {e}")
        return {}


async def _get_latest_comorbidity_risk(patient_id: str, doctor_id: str) -> Optional[dict]:
    """See ASSUMPTION #15. Optional enrichment — None if Module 13 hasn't been run."""
    try:
        doc = await comorbidity_risk_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        if not doc:
            return None
        return {"domains": doc.get("domains") or []}
    except Exception as e:
        logger.warning(f"Treat-to-target: comorbidity risk lookup failed for {patient_id}: {e}")
        return None


async def _get_latest_biomarker_summary(patient_id: str, doctor_id: str) -> Optional[dict]:
    """See ASSUMPTION #16."""
    try:
        doc = await biomarker_analysis_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        if not doc:
            return None
        return {
            "date": doc.get("created_at").isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
            "numeric_flags": doc.get("numeric_flags") or [],
            "qualitative_summary": doc.get("qualitative_summary") or [],
        }
    except Exception as e:
        logger.warning(f"Treat-to-target: biomarker analysis lookup failed for {patient_id}: {e}")
        return None


async def _get_latest_imaging_summary(patient_id: str, doctor_id: str) -> Optional[dict]:
    """See ASSUMPTION #17 — prefers a saved comparison, falls back to the
    latest raw study log entry if no comparison exists yet."""
    try:
        comparison_doc = await imaging_comparison_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        if comparison_doc:
            return {
                "source": "comparison",
                "date": comparison_doc.get("created_at").isoformat() if isinstance(comparison_doc.get("created_at"), datetime) else comparison_doc.get("created_at"),
                "comparisons": comparison_doc.get("comparisons") or [],
            }
    except Exception as e:
        logger.warning(f"Treat-to-target: imaging comparison lookup failed for {patient_id}: {e}")

    try:
        study_doc = await imaging_studies_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("date", -1)]
        )
        if study_doc:
            return {
                "source": "latest_study",
                "date": study_doc.get("date"),
                "modality": study_doc.get("modality"),
                "region": study_doc.get("region"),
                "finding": study_doc.get("finding"),
            }
    except Exception as e:
        logger.warning(f"Treat-to-target: imaging study lookup failed for {patient_id}: {e}")

    return None


# ═════════════════════════════════════════════════════════════════════════════
# DETERMINISTIC ROLLUP LOGIC — see ASSUMPTIONS #3-9
# ═════════════════════════════════════════════════════════════════════════════

def _compute_trend(recent_activity: list) -> dict:
    """Returns {previous, current, trend, metric_used} — see ASSUMPTIONS #3-5."""
    if len(recent_activity) < 1:
        return {"previous": None, "current": None, "trend": None, "metric_used": None}

    current_doc = recent_activity[0]
    current_scores = current_doc.get("scores") or {}
    current_summary = {
        "date": current_doc.get("created_at"),
        "scores": {k: v for k, v in current_scores.items() if v},
    }

    if len(recent_activity) < 2:
        return {"previous": None, "current": current_summary, "trend": None, "metric_used": None}

    previous_doc = recent_activity[1]
    previous_scores = previous_doc.get("scores") or {}
    previous_summary = {
        "date": previous_doc.get("created_at"),
        "scores": {k: v for k, v in previous_scores.items() if v},
    }

    metric_used = None
    for metric in SCORE_PREFERENCE_ORDER:
        if current_scores.get(metric) and previous_scores.get(metric):
            metric_used = metric
            break

    trend = None
    if metric_used:
        curr_val = current_scores[metric_used].get("value")
        prev_val = previous_scores[metric_used].get("value")
        if isinstance(curr_val, (int, float)) and isinstance(prev_val, (int, float)):
            delta = curr_val - prev_val
            if delta > TREND_NOISE_THRESHOLD:
                trend = "worsening"
            elif delta < -TREND_NOISE_THRESHOLD:
                trend = "improving"
            else:
                trend = "stable"

    return {"previous": previous_summary, "current": current_summary, "trend": trend, "metric_used": metric_used}


def _worst_safety_flag(dmard_doc: Optional[dict], steroid_doc: Optional[dict]) -> dict:
    """Rolls up the highest-severity flag across Modules 8 and 14 — see ASSUMPTION #7.

    Field names confirmed against Module 8's actual save schema: the saved
    document stores its per-drug entries under "panel" (not "drugs"/"domains"),
    each item's severity is "status" (not "category"), and each item's label
    is "name" (not "drug"/"domain"). Module 8's status values are the same
    green/yellow/red vocabulary this rollup already expects.
    """
    entries = []
    if dmard_doc:
        for item in (dmard_doc.get("panel") or []):
            cat = item.get("status")
            if cat in SAFETY_SEVERITY_RANK:
                entries.append({"source": "DMARD Safety", "label": item.get("name"), "category": cat})
    if steroid_doc:
        for item in (steroid_doc.get("domains") or []):
            cat = item.get("category")
            if cat in SAFETY_SEVERITY_RANK:
                entries.append({"source": "Steroid Stewardship", "label": item.get("domain"), "category": cat})

    if not entries:
        return {"worst_category": None, "flags": [], "assessed": {"dmard_safety": dmard_doc is not None, "steroid_stewardship": steroid_doc is not None}}

    worst = max(entries, key=lambda e: SAFETY_SEVERITY_RANK[e["category"]])
    flagged = [e for e in entries if SAFETY_SEVERITY_RANK[e["category"]] > 0]
    return {
        "worst_category": worst["category"],
        "flags": flagged,
        "assessed": {"dmard_safety": dmard_doc is not None, "steroid_stewardship": steroid_doc is not None},
    }


def _derive_recommendation(trend: Optional[str], response: Optional[str], worst_safety_category: Optional[str]) -> str:
    """Short rule-based label — see ASSUMPTION #9."""
    if worst_safety_category == "red":
        return "Safety review recommended"
    if trend == "worsening" or (response and response.lower() == "inadequate"):
        return "Review escalation options"
    if trend in ("improving", "stable") and response and response.lower() == "good":
        return "Continue current plan"
    return "Reassess at next follow-up"


TTT_NARRATIVE_PROMPT = """
You are a clinical assistant. You will be given a treat-to-target rollup
for a rheumatology patient — working diagnosis, disease-activity trend
(already computed), current treatment and response, safety flags
(already computed), flare risk, target, and a short recommendation label
(already decided by rule-based logic, not by you).

Return a JSON object with exactly one key, "narrative": ONE short
paragraph (2-4 sentences) summarizing the overall treat-to-target
picture in plain language a physician can scan in a few seconds.
Reference the actual values given.

Rules:
- Do NOT change, soften, or second-guess the trend, safety flags, or
  recommendation label already provided — describe them, don't
  re-evaluate them.
- Do NOT recommend a specific drug, dose, or test — that decision
  belongs to the physician.
- Do NOT invent findings not present in the input.
- Return valid JSON only — no markdown, no commentary, no extra keys.
"""


# ═════════════════════════════════════════════════════════════════════════════
# 1. DASHBOARD
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-treat-to-target/dashboard/{patient_id}/{doctor_id}")
async def get_treat_to_target_dashboard(patient_id: str, doctor_id: str):
    """
    One-screen rollup — see module docstring for the source of each field.
    Read-only: never writes anything (the target/review date is set
    separately via /set-target).
    """
    target_setting = await _get_target_setting(patient_id, doctor_id)
    working_diagnosis = await _get_working_diagnosis(patient_id, doctor_id)

    recent_activity = await _get_recent_disease_activity(patient_id, doctor_id, limit=2)
    activity_rollup = _compute_trend(recent_activity)

    treatment_doc = await _get_latest_treatment_decision(patient_id, doctor_id)
    current_medications = await _get_current_medications(patient_id, doctor_id)
    # CONFIRMED (was a guess): Module 7 never persists a "response" field at
    # all — its /generate endpoint computes EULAR response criteria live
    # (see its _compute_treatment_response()) but that value is NOT part of
    # the /save payload or the saved document. So `response` here will
    # always be None from the saved record, not just when "absent" — this
    # module's existing "Not recorded" fallback (ASSUMPTION #6) already
    # handles that correctly, it's just worth knowing this isn't a rare
    # case, it's the permanent case unless Module 7's save schema changes
    # to persist response, or this module is changed to compute response
    # itself from Module 6's records the same way Module 7 does.
    response = (treatment_doc or {}).get("response")  # see ASSUMPTION #6 — see note above
    # Field name confirmed against Module 7's actual save schema: the saved
    # document stores this as "guideline_reference" (a fixed string, always
    # "EULAR 2025 RA management recommendations (2026 update)"), not
    # "guideline_pathway".
    guideline_pathway = (treatment_doc or {}).get("guideline_reference") or "EULAR treat-to-target"  # see ASSUMPTION #10

    dmard_doc = await _get_latest_dmard_safety(patient_id, doctor_id)
    steroid_doc = await _get_latest_steroid_assessment(patient_id, doctor_id)
    safety_rollup = _worst_safety_flag(dmard_doc, steroid_doc)

    flare_doc = await _get_latest_flare_prediction(patient_id, doctor_id)
    flare_risk = None
    if flare_doc:
        # Field name confirmed against Module 10's actual save schema: the
        # saved document stores this as "risk_level" (was guessed as
        # "probability_category"/"category", neither of which exist).
        flare_risk = {
            "category": flare_doc.get("risk_level"),
            "factors": flare_doc.get("factors") or [],
        }

    # ─── Added this session: Patient Summary / Laboratory / Imaging panels
    # — see ASSUMPTIONS #12-17. Purely additive; nothing above this point
    # was changed. ──────────────────────────────────────────────────────
    intake_summary = await _get_latest_intake_summary(patient_id, doctor_id)
    comorbidity_risk = await _get_latest_comorbidity_risk(patient_id, doctor_id)
    patient_summary = {
        "condition": working_diagnosis,
        "disease_duration": intake_summary.get("onset"),  # see ASSUMPTION #13 — free text as recorded at intake, not a parsed duration
        "allergies": None,  # see ASSUMPTION #14 — not captured anywhere in this workflow yet
        "comorbidities": intake_summary.get("comorbidities") or [],
        "comorbidity_risk_domains": (comorbidity_risk or {}).get("domains") or [],
    }
    laboratory = await _get_latest_biomarker_summary(patient_id, doctor_id)
    imaging = await _get_latest_imaging_summary(patient_id, doctor_id)

    recommendation = _derive_recommendation(activity_rollup.get("trend"), response, safety_rollup.get("worst_category"))

    finaloutput = {
        "working_diagnosis": working_diagnosis,
        "target": target_setting.get("target"),
        "next_review_date": target_setting.get("next_review_date"),
        "disease_activity": activity_rollup,
        "current_treatment": {
            "medications": current_medications,
            "response": response,
            "guideline_pathway": guideline_pathway,
        },
        "safety": safety_rollup,
        "flare_risk": flare_risk,
        "patient_summary": patient_summary,
        "laboratory": laboratory,
        "imaging": imaging,
        "recommendation": recommendation,
        "narrative": None,
    }

    if groq_client is not None:
        try:
            completion = groq_client.chat.completions.create(
                model="openai/gpt-oss-120b",
                messages=[
                    {"role": "system", "content": TTT_NARRATIVE_PROMPT},
                    {"role": "user", "content": json.dumps({k: v for k, v in finaloutput.items() if k != "narrative"}, indent=2, default=str)},
                ],
                temperature=0,
                response_format={"type": "json_object"},
            )
            parsed = json.loads(completion.choices[0].message.content)
            if isinstance(parsed, dict) and parsed.get("narrative"):
                finaloutput["narrative"] = str(parsed["narrative"])[:600]
        except Exception as e:
            logger.warning(f"Treat-to-target: narrative generation failed for {patient_id}: {e}")

    return {"status": "success", "finaloutput": finaloutput}


# ═════════════════════════════════════════════════════════════════════════════
# 2. TARGET / NEXT REVIEW (the only fields this module owns)
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-treat-to-target/target/{patient_id}/{doctor_id}")
async def get_target_setting(patient_id: str, doctor_id: str):
    return {"status": "success", "data": await _get_target_setting(patient_id, doctor_id)}


@router.post("/rheumatology-treat-to-target/set-target")
async def set_target_setting(payload: dict):
    """
    Expected payload:
    {
        "patient_id": "...", "doctor_id": "...",
        "target": "Remission",              # must be in TARGET_ALLOWED
        "next_review_date": "2026-09-08"    # YYYY-MM-DD, optional
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        target = str(payload.get("target", ""))
        next_review_date = payload.get("next_review_date") or None

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if target not in TARGET_ALLOWED:
            raise HTTPException(status_code=400, detail=f"target must be one of: {sorted(TARGET_ALLOWED)}")
        if next_review_date:
            try:
                datetime.strptime(next_review_date, "%Y-%m-%d")
            except ValueError:
                raise HTTPException(status_code=400, detail="next_review_date must be in YYYY-MM-DD format")

        await target_collection.update_one(
            {"patient_id": patient_id, "doctor_id": doctor_id},
            {"$set": {
                "patient_id": patient_id, "doctor_id": doctor_id,
                "target": target, "next_review_date": next_review_date,
                "updated_at": datetime.utcnow(),
            }},
            upsert=True,
        )

        return {"status": "success", "message": "Target updated", "data": {"target": target, "next_review_date": next_review_date}}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 3. SAVE SNAPSHOT / HISTORY
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-treat-to-target/save-snapshot")
async def save_treat_to_target_snapshot(payload: dict):
    """
    Expected payload (doctor-reviewed version of /dashboard's finaloutput):
    {
        "patient_id": "...", "doctor_id": "...",
        "snapshot": { ...finaloutput as returned by /dashboard... }
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        snapshot = payload.get("snapshot")

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if not isinstance(snapshot, dict) or not snapshot:
            raise HTTPException(status_code=400, detail="snapshot is required and cannot be empty")

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "snapshot": snapshot,
            "created_at": datetime.utcnow(),
            "type": "rheumatology_treat_to_target_snapshot",
        }
        result = await snapshot_collection.insert_one(document)

        return {"status": "success", "message": "Treat-to-target snapshot saved", "id": str(result.inserted_id)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/rheumatology-treat-to-target/history/{patient_id}/{doctor_id}")
async def get_treat_to_target_history(patient_id: str, doctor_id: str):
    """Fetch all saved treat-to-target snapshots for a patient, most recent first."""
    try:
        cursor = snapshot_collection.find(
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