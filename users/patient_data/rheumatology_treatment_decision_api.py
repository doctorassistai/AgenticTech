"""
rheumatology_treatment_decision_api.py
─────────────────────────────────────────────────────────────────────────────
DoctorAssist.AI — Rheumatology AI Workflow, Module 7: Treatment Decision
Engine (v2.0) — GENERALIZED ACROSS RA / PsA / Axial SpA (AS) / SLE / Gout.

v1 of this file supported RA only (see git history / ASSUMPTION #3 in the
old header). This version replaces the single RA gate with a
DISEASE_CONFIGS dict keyed by disease, each holding its own: condition
match strings, closed drug-option catalog, static guideline reference,
prognostic-field schema, and (where one exists) a deterministic
response-classification method.

Assembles: matched disease (from Module 3's saved differential) → current
therapy → disease activity → treatment response (where computable) →
disease-specific prognostic factors → safety/comorbidities → guideline
pathway → possible next options — and returns a doctor-facing decision
support panel, never a single prescriptive recommendation.

ROUTES IN THIS FILE
---------------------
  GET  /rheumatology-treatment/context-preview/{patient_id}/{doctor_id}
  POST /rheumatology-treatment/generate
  POST /rheumatology-treatment/save
  GET  /rheumatology-treatment/history/{patient_id}/{doctor_id}

⚠️ ASSUMPTIONS MADE WHILE GENERALIZING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. ROUTER MOUNT / COLLECTION NAME: unchanged from v1 — prefix="/context",
     collection "rheumatology_treatment_decision".

  2. ⚠️ CONDITION-MATCH STRINGS ARE UNCONFIRMED FOR 4 OF 5 DISEASES. RA's
     match string ("Rheumatoid arthritis") was confirmed against Module 3
     in v1. The PsA / AS / SLE / Gout entries in DISEASE_CONFIGS below are
     best-guess transcriptions of the PDF's prose list ("Ankylosing
     Spondylitis / Axial Spondyloarthritis", "Psoriatic Arthritis",
     "Systemic Lupus Erythematosus", "Gout"), NOT verified against Module
     3's actual closed differential-conditions vocabulary constant. If
     these strings don't exactly match what Module 3 actually saves in
     `working_diagnosis` / the `likely` tier's `condition` field, the
     match will silently fail for real patients with that condition and
     /generate will report "no supported diagnosis." Confirm/correct
     against rheumatology_differential_diagnosis_api.py before deploy.
     Each disease supports MULTIPLE acceptable strings (e.g. AS matches
     either "Ankylosing spondylitis" or "Axial spondyloarthritis") since
     it's unclear which exact label Module 3 uses.

  3. ⚠️ NON-RA DRUG CATALOGS AND GUIDELINE REFERENCES ARE FIRST-DRAFT
     CLINICAL CONTENT, NOT SOURCED FROM A REVIEWED REQUIREMENTS DOC. Only
     RA's catalog + "EULAR 2025 RA management recommendations (2026
     update)" carry over from the reviewed v1. The PsA / AS / SLE / Gout
     catalogs and their guideline-reference strings (e.g. "GRAPPA/EULAR
     PsA management recommendations (2026 update)") were drafted from
     general clinical knowledge of standard-of-care drug classes per
     disease. Treat these as a first pass requiring rheumatologist review
     — same caveat as v1 ASSUMPTION #4 for the original RA prognostic
     fields.

  4. ⚠️ NON-RA PROGNOSTIC FIELDS ARE FIRST-DRAFT, NOT A CONFIRMED SPEC.
     Same caveat as #3 — chosen from general clinical reasoning about what
     a rheumatologist would want to know for each disease, not from a
     reviewed requirements doc.

  5. RESPONSE CLASSIFICATION REMAINS RA-ONLY (carried over from v1
     ASSUMPTION #11, now formalized in code): only RA has a validated,
     implemented delta-threshold response classification (EULAR DAS28
     criteria), because Module 6 only exposes das28_crp/das28_esr in a
     confirmed shape. PsA and Gout have no composite disease-activity
     score wired into Module 6 at all — response is always "Not
     assessable — no composite disease-activity score available for this
     condition." AS and SLE DO have scores in Module 6 now (BASDAI/ASDAS,
     SLEDAI-2K per the Disease Activity module's recent extension), but
     no validated response-delta-threshold has been implemented here —
     ⚠️ the score field key names used below to read them back
     ("basdai", "asdas_crp", "asdas_esr", "sledai") are UNCONFIRMED
     guesses at Module 6's actual `scores` dict keys and must be checked
     against that file. Raw current/previous values are passed to the LLM
     as unlabeled context only, never as an asserted response category.

  6. GATE BEHAVIOR: /generate now raises 400 if NO supported disease
     (RA/PsA/AS/SLE/Gout) is matched in the most recent saved differential
     — same fail-closed behavior as v1, just widened to 5 conditions
     instead of 1. A differential with an unsupported condition (e.g.
     osteoarthritis, vasculitis) still correctly returns 400.

  7. DISEASE IS SERVER-DERIVED, NEVER CLIENT-SUPPLIED: the frontend does
     not send a disease selection — /generate and /context-preview both
     independently re-derive the matched disease from Module 3's saved
     differential, the same way v1 did for RA-only. This avoids a client
     being able to request a catalog/guideline mismatched to what's
     actually in the chart.

  8. PROGNOSTIC-FIELD SCHEMA IS SERVER-OWNED: context-preview now returns
     a `prognostic_field_schema` (list of {key, label, type, options}) for
     whichever disease matched, so the frontend can render the correct
     disease-specific inputs without hardcoding five field sets. /generate
     validates incoming `prognostic_factors` against that same schema
     server-side — never trusts frontend-only validation.

  9. UNCHANGED FROM v1: closed-vocabulary enforcement on options returned
     by the LLM, "never a single recommendation" (2-4 grounded options,
     `physician_decision_required: true` on every option),
     patient-specific vs. general-class risk labeling, static (not
     LLM-generated) guideline reference, save requiring explicit
     doctor-selected options (empty selection allowed = "reviewed, no
     change").
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

TREATMENT_COLLECTION_NAME = "rheumatology_treatment_decision"

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    treatment_collection = database[TREATMENT_COLLECTION_NAME]
    differential_collection = database["rheumatology_differential_diagnosis"]
    disease_activity_collection = database["rheumatology_disease_activity"]
    rheumatology_intake_collection = database["rheumatology_intake"]
    documentation_medication_analysis_collection = database["documentation-medication-analysis"]
    treatment_ledger_collection = database["rheumatology_treatment_ledger"]  # NEW — see fix note

except Exception as e:
    logger.error(f"Error initializing MongoDB in rheumatology_treatment_decision_api: {e}")

# ─── Groq setup ─────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client: Optional[Groq] = None
try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        logger.warning("GROQ_API_KEY not set — treatment decision LLM endpoints will fail at call time.")
except Exception as e:
    logger.error(f"Error initializing Groq client in rheumatology_treatment_decision_api: {e}")

router = APIRouter(prefix="/context", tags=["Rheumatology Treatment Decision Engine"])

YES_NO_UNKNOWN = {"Yes", "No", "Unknown"}


# ═════════════════════════════════════════════════════════════════════════════
# DISEASE_CONFIGS — see ASSUMPTIONS #2, #3, #4
# ═════════════════════════════════════════════════════════════════════════════
# Each entry:
#   label                 — display name
#   condition_strings      — [UNCONFIRMED except RA] strings matched against
#                             Module 3's working_diagnosis / likely tier
#   guideline_reference    — static string, appended programmatically, never
#                             LLM-generated
#   options_allowed         — closed drug-class catalog for this disease
#   prognostic_fields       — schema the frontend renders + backend validates
#                             each: {key, label, type: "select"|"number",
#                             options (for select), min (for number)}
#   response_method         — "das28_eular" | "not_assessable"

DISEASE_CONFIGS = {
    "RA": {
        "label": "Rheumatoid Arthritis",
        "condition_strings": ["Rheumatoid arthritis"],
        "guideline_reference": "EULAR 2025 RA management recommendations (2026 update)",
        "options_allowed": {
            "Methotrexate monotherapy (csDMARD)",
            "Hydroxychloroquine (csDMARD)",
            "Sulfasalazine (csDMARD)",
            "Leflunomide (csDMARD)",
            "csDMARD combination therapy (e.g. MTX + sulfasalazine + hydroxychloroquine)",
            "Short-term glucocorticoid bridge",
            "TNF inhibitor (bDMARD)",
            "IL-6 receptor inhibitor (bDMARD)",
            "Abatacept — T-cell costimulation blocker (bDMARD)",
            "Rituximab — B-cell depletion (bDMARD)",
            "JAK inhibitor (tsDMARD)",
            "Switch to alternate-class bDMARD/tsDMARD after inadequate response",
        },
        "prognostic_fields": [
            {"key": "seropositive", "label": "Seropositive (RF / Anti-CCP)", "type": "select", "options": ["Unknown", "Yes", "No"]},
            {"key": "erosive_disease", "label": "Erosive Disease on Imaging", "type": "select", "options": ["Unknown", "Yes", "No"]},
            {"key": "csdmards_failed_count", "label": "Prior csDMARDs Failed", "type": "number", "min": 0},
        ],
        "response_method": "das28_eular",
    },
    "PsA": {
        "label": "Psoriatic Arthritis",
        # [UNCONFIRMED] — verify exact string against Module 3
        "condition_strings": ["Psoriatic arthritis"],
        "guideline_reference": "GRAPPA/EULAR PsA management recommendations (2026 update) [UNCONFIRMED — verify citation before deploy]",
        "options_allowed": {
            "Methotrexate monotherapy (csDMARD)",
            "Sulfasalazine (csDMARD)",
            "Leflunomide (csDMARD)",
            "PDE4 inhibitor (apremilast)",
            "Short-term glucocorticoid bridge",
            "TNF inhibitor (bDMARD)",
            "IL-17 inhibitor (bDMARD)",
            "IL-23 inhibitor (bDMARD)",
            "JAK inhibitor (tsDMARD)",
            "Switch to alternate-class bDMARD/tsDMARD after inadequate response",
        },
        "prognostic_fields": [
            {"key": "dactylitis_present", "label": "Dactylitis Present", "type": "select", "options": ["Unknown", "Yes", "No"]},
            {"key": "enthesitis_present", "label": "Enthesitis Present", "type": "select", "options": ["Unknown", "Yes", "No"]},
            {"key": "nail_involvement", "label": "Nail Involvement", "type": "select", "options": ["Unknown", "Yes", "No"]},
            {"key": "csdmards_failed_count", "label": "Prior csDMARDs Failed", "type": "number", "min": 0},
        ],
        "response_method": "not_assessable",
    },
    "AS": {
        "label": "Axial Spondyloarthritis / Ankylosing Spondylitis",
        # CONFIRMED against rheumatology_differential_diagnosis_api.py's
        # DIFFERENTIAL_CONDITIONS_ALLOWED — Module 3 uses one combined
        # string, not two separate ones as previously guessed.
        "condition_strings": ["Ankylosing spondylitis / axial spondyloarthritis"],
        "guideline_reference": "ASAS-EULAR axial spondyloarthritis management recommendations (2026 update) [UNCONFIRMED — verify citation before deploy]",
        "options_allowed": {
            "Regular-dose NSAID trial",
            "Physical therapy / structured exercise program",
            "Short-term glucocorticoid bridge (local/regional only)",
            "TNF inhibitor (bDMARD)",
            "IL-17 inhibitor (bDMARD)",
            "JAK inhibitor (tsDMARD)",
            "Switch to alternate-class bDMARD/tsDMARD after inadequate response",
        },
        "prognostic_fields": [
            {"key": "hla_b27_positive", "label": "HLA-B27 Positive", "type": "select", "options": ["Unknown", "Yes", "No"]},
            {"key": "radiographic_sacroiliitis", "label": "Radiographic Sacroiliitis", "type": "select", "options": ["Unknown", "Yes", "No"]},
            {"key": "nsaids_failed_count", "label": "Prior NSAIDs Failed (adequate trial)", "type": "number", "min": 0},
        ],
        "response_method": "not_assessable",
    },
    "SLE": {
        "label": "Systemic Lupus Erythematosus",
        # CONFIRMED against rheumatology_differential_diagnosis_api.py's
        # DIFFERENTIAL_CONDITIONS_ALLOWED — Module 3's exact string includes
        # the "(SLE)" suffix, which was previously missing here.
        "condition_strings": ["Systemic lupus erythematosus (SLE)"],
        "guideline_reference": "EULAR SLE management recommendations (2026 update) [UNCONFIRMED — verify citation before deploy]",
        "options_allowed": {
            "Hydroxychloroquine (foundational therapy)",
            "Short-term glucocorticoid bridge",
            "Mycophenolate mofetil",
            "Azathioprine",
            "Belimumab (biologic)",
            "Anifrolumab (biologic)",
            "Rituximab — B-cell depletion (biologic)",
            "Cyclophosphamide (severe / organ-threatening disease)",
        },
        "prognostic_fields": [
            {"key": "major_organ_involvement", "label": "Major Organ Involvement (renal/CNS/etc.)", "type": "select", "options": ["Unknown", "Yes", "No"]},
            {"key": "complement_low", "label": "Low Complement (C3/C4)", "type": "select", "options": ["Unknown", "Yes", "No"]},
            {"key": "dsdna_positive", "label": "dsDNA Positive", "type": "select", "options": ["Unknown", "Yes", "No"]},
        ],
        "response_method": "not_assessable",
    },
    "Gout": {
        "label": "Gout",
        # [UNCONFIRMED] — verify exact string against Module 3
        "condition_strings": ["Gout"],
        "guideline_reference": "ACR/EULAR gout management recommendations (2026 update) [UNCONFIRMED — verify citation before deploy]",
        "options_allowed": {
            "Colchicine (acute flare)",
            "NSAID (acute flare)",
            "Short-term glucocorticoid bridge (acute flare)",
            "Allopurinol (urate-lowering therapy)",
            "Febuxostat (urate-lowering therapy)",
            "Probenecid (uricosuric agent)",
        },
        "prognostic_fields": [
            {"key": "tophi_present", "label": "Tophi Present", "type": "select", "options": ["Unknown", "Yes", "No"]},
            {"key": "serum_urate_at_goal", "label": "Serum Urate At Goal (<6 mg/dL)", "type": "select", "options": ["Unknown", "Yes", "No"]},
            {"key": "flares_per_year_count", "label": "Flares in Past Year", "type": "number", "min": 0},
        ],
        "response_method": "not_assessable",
    },
}


# ═════════════════════════════════════════════════════════════════════════════
# 1. DISEASE MATCHING (generalized from v1's RA-only check)
# ═════════════════════════════════════════════════════════════════════════════

async def _get_matched_disease_status(patient_id: str, doctor_id: str) -> dict:
    """
    Returns which (if any) of the 5 supported diseases is present in the
    most recent saved differential's working_diagnosis or 'likely' tier.
    See ASSUMPTION #2 for why the match strings themselves are unconfirmed.
    """
    doc = await differential_collection.find_one(
        {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
    )
    if not doc:
        return {"disease_key": None, "matched_condition": None, "differential_doc": None}

    working = doc.get("working_diagnosis", "")
    likely = [item.get("condition") for item in (doc.get("differential_diagnosis", {}).get("likely") or [])]

    for disease_key, config in DISEASE_CONFIGS.items():
        for condition_string in config["condition_strings"]:
            if working == condition_string or condition_string in likely:
                return {"disease_key": disease_key, "matched_condition": condition_string, "differential_doc": doc}

    return {"disease_key": None, "matched_condition": None, "differential_doc": doc}


async def _get_current_medications_brief(patient_id: str, doctor_id: str) -> list:
    """
    Source-of-truth order (matches the fix applied to Module 8's
    equivalent lookup): rheumatology_treatment_ledger active entries
    (stop_date is null) first — this is the doctor-confirmed medication
    record — then documentation-medication-analysis as a fallback for
    anything not yet ledgered. Merged, deduplicated by drug name.
    """
    briefs = []
    seen_names = set()

    # 1. Treatment Ledger — active entries only
    try:
        cursor = treatment_ledger_collection.find({
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "stop_date": None,
        })
        async for entry in cursor:
            name = entry.get("drug_name") or ""
            if not name or name.lower() in seen_names:
                continue
            parts = [name]
            if entry.get("dose"):
                parts.append(str(entry["dose"]))
            briefs.append(" ".join(parts))
            seen_names.add(name.lower())
    except Exception as e:
        logger.warning(f"Treatment decision: treatment ledger lookup failed for {patient_id}: {e}")

    # 2. Fallback — documentation-medication-analysis
    try:
        doc = await documentation_medication_analysis_collection.find_one(
            {"patient_id": patient_id}, sort=[("created_at", -1)]
        )
        if doc:
            prescriptions = (doc.get("finaloutput") or {}).get("prescriptions") or []
            for p in prescriptions:
                name = p.get("medication") or p.get("generic_name") or p.get("brand_name") or ""
                if not name or name.lower() in seen_names:
                    continue
                parts = [name]
                if p.get("dose"):
                    parts.append(str(p["dose"]))
                if p.get("frequency"):
                    parts.append(str(p["frequency"]))
                briefs.append(" ".join(parts))
                seen_names.add(name.lower())
    except Exception as e:
        logger.warning(f"Treatment decision: medication brief lookup failed for {patient_id}: {e}")

    return briefs[:15]

async def _get_last_two_disease_activity_records(patient_id: str, doctor_id: str) -> list:
    try:
        cursor = disease_activity_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("created_at", -1).limit(2)
        return [doc async for doc in cursor]
    except Exception as e:
        logger.warning(f"Treatment decision: disease activity lookup failed for {patient_id}: {e}")
        return []


def _compute_treatment_response(disease_key: str, records: list) -> dict:
    """
    Dispatches by disease's response_method — see ASSUMPTION #5.
    Only RA has an implemented validated delta-threshold today.
    """
    config = DISEASE_CONFIGS.get(disease_key, {})
    method = config.get("response_method", "not_assessable")

    if method == "das28_eular":
        if len(records) < 2:
            return {"response": "Not assessable — no baseline DAS28 for comparison", "delta": None, "score_type": None}

        current, previous = records[0], records[1]
        cur_scores = current.get("scores") or {}
        prev_scores = previous.get("scores") or {}

        for score_key in ["das28_crp", "das28_esr"]:
            cur = cur_scores.get(score_key)
            prev = prev_scores.get(score_key)
            if cur and prev and cur.get("value") is not None and prev.get("value") is not None:
                delta = round(prev["value"] - cur["value"], 2)  # positive delta = improvement
                if delta > 1.2 and cur["value"] <= 3.2:
                    response = "Good response"
                elif delta > 0.6:
                    response = "Moderate response"
                else:
                    response = "No response"
                return {"response": response, "delta": delta, "score_type": score_key.upper().replace("_", "-")}

        return {"response": "Not assessable — no comparable DAS28 score in both records", "delta": None, "score_type": None}

    # not_assessable path — still surface raw current score(s) as unlabeled
    # context if Module 6 has them, per ASSUMPTION #5. Key names below are
    # [UNCONFIRMED] guesses at Module 6's actual `scores` dict keys.
    raw_context = {}
    if records:
        cur_scores = records[0].get("scores") or {}
        # Confirmed against rheumatology_disease_activity_api.py: Module 6
        # stores a single "asdas" key (with an internal "variant": "CRP"/"ESR"
        # field), not separate "asdas_crp"/"asdas_esr" keys as originally
        # guessed here — corrected, so AS patients now actually get their
        # raw score surfaced as LLM context instead of silently getting none.
        for score_key in ["basdai", "asdas", "sledai"]:
            if score_key in cur_scores:
                raw_context[score_key] = cur_scores[score_key]

    if disease_key in ("PsA", "Gout"):
        msg = "Not assessable — no composite disease-activity score available for this condition"
    else:
        msg = "Not assessable — no validated delta-threshold implemented yet"

    return {"response": msg, "delta": None, "score_type": None, "raw_scores_context": raw_context}


async def _get_intake_safety_context(patient_id: str, doctor_id: str) -> dict:
    result = {"comorbidities": [], "previous_autoimmune_disease": "", "pregnancy_reproductive_considerations": "", "steroid_exposure": {}}
    try:
        doc = await rheumatology_intake_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        if doc:
            intake = doc.get("rheumatology_intake") or {}
            result["comorbidities"] = intake.get("comorbidities") or []
            result["previous_autoimmune_disease"] = intake.get("previous_autoimmune_disease") or ""
            result["pregnancy_reproductive_considerations"] = intake.get("pregnancy_reproductive_considerations") or ""
            result["steroid_exposure"] = intake.get("steroid_exposure") or {}
    except Exception as e:
        logger.warning(f"Treatment decision: intake safety context lookup failed for {patient_id}: {e}")
    return result


@router.get("/rheumatology-treatment/context-preview/{patient_id}/{doctor_id}")
async def get_treatment_context_preview(patient_id: str, doctor_id: str):
    """
    Read-only preview of everything /generate will use: matched disease
    (or none), the field schema the frontend should render for that
    disease, current therapy, latest disease activity + computed response
    (where computable), and safety context from intake.
    """
    match = await _get_matched_disease_status(patient_id, doctor_id)
    disease_key = match["disease_key"]
    medications = await _get_current_medications_brief(patient_id, doctor_id)
    activity_records = await _get_last_two_disease_activity_records(patient_id, doctor_id)
    response_info = _compute_treatment_response(disease_key, activity_records)
    safety = await _get_intake_safety_context(patient_id, doctor_id)

    current_activity = None
    if activity_records:
        rec = activity_records[0]
        created = rec.get("created_at")
        current_activity = {
            "date": created.isoformat() if isinstance(created, datetime) else created,
            "scores": rec.get("scores", {}),
        }

    config = DISEASE_CONFIGS.get(disease_key)

    return {
        "status": "success",
        "data": {
            "matched_disease_key": disease_key,
            "matched_disease_label": config["label"] if config else None,
            "matched_condition": match["matched_condition"],
            "prognostic_field_schema": config["prognostic_fields"] if config else [],
            "current_medications": medications,
            "current_disease_activity": current_activity,
            "treatment_response": response_info,
            "safety_context": safety,
        },
    }


# ═════════════════════════════════════════════════════════════════════════════
# 2. GENERATE TREATMENT OPTIONS
# ═════════════════════════════════════════════════════════════════════════════

def _build_treatment_options_prompt(disease_key: str) -> str:
    config = DISEASE_CONFIGS[disease_key]
    return f"""
You are a clinical decision-support assistant for a rheumatologist managing
a patient with confirmed/working {config['label']}. You will be given:
current medications, current disease activity data (where available),
computed treatment response where a validated method exists (otherwise
"Not assessable" — treat that as unknown, never as poor response),
disease-specific prognostic factors (doctor-entered), and safety context
(comorbidities, pregnancy/reproductive considerations, steroid exposure
history).

You must NEVER recommend a single "best" option. Your job is to lay out
2-4 reasonable next-step OPTIONS for physician review, each independently
justified. This mirrors how a rheumatologist would actually think through
next steps, not a single verdict.

Choose options ONLY from this exact closed list (use the exact string):
{json.dumps(sorted(config['options_allowed']))}

Return a JSON object with exactly one key, "options", a list of objects.
Each object must have exactly these keys:

  - "option": one of the exact strings from the list above.
  - "reason": one or two sentences explaining specifically why this option
    is reasonable GIVEN THIS PATIENT'S data (disease activity, response,
    prognostic factors) — not a generic textbook description.
  - "supporting_factors": a list of 1-4 short strings, each a specific
    fact drawn directly from the input.
  - "patient_specific_risks": a list of 0-3 short strings naming
    cautions grounded in THIS patient's actual comorbidities, pregnancy
    status, or steroid history from the input. Return an empty list if
    nothing in the input raises a patient-specific concern for this
    option — do not invent one.
  - "general_class_risk": ONE short string naming a well-known, general
    safety consideration for this drug class — this is general
    pharmacology knowledge, not a patient-specific finding. If genuinely
    no notable class-level caution applies, use an empty string.

Rules:
- Every option must have a "reason" and at least one "supporting_factor"
  grounded in the actual input — never propose an option with zero
  grounding.
- Do NOT rank the options or declare one as the recommended choice — list
  order does not imply preference.
- Do NOT invent comorbidities, medications, or lab values not present in
  the input.
- Do NOT state a specific dose or administration schedule — this module
  proposes therapy CLASSES for physician review, not a prescription.
- Return valid JSON only — no markdown formatting, no commentary, no
  extra top-level keys.
"""


def _validate_prognostic_factors(disease_key: str, raw_factors: dict) -> dict:
    """Validates incoming prognostic_factors against this disease's schema — see ASSUMPTION #8."""
    config = DISEASE_CONFIGS[disease_key]
    validated = {}
    for field in config["prognostic_fields"]:
        key = field["key"]
        value = raw_factors.get(key)
        if field["type"] == "select":
            value = str(value) if value is not None else "Unknown"
            if value not in field.get("options", YES_NO_UNKNOWN):
                raise HTTPException(status_code=400, detail=f"{key} must be one of {field.get('options')}")
            validated[key] = value
        elif field["type"] == "number":
            try:
                num = int(value) if value is not None else 0
                if num < field.get("min", 0):
                    raise ValueError
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"{key} must be a non-negative integer")
            validated[key] = num
    return validated


@router.post("/rheumatology-treatment/generate")
async def generate_treatment_options(payload: dict):
    """
    Expected payload:
    {
        "doctor_id": "...", "patient_id": "...",
        "prognostic_factors": { <disease-specific keys per schema> },
        "additional_context": "optional — patient preference, cost, prior intolerances"
    }

    Disease is NEVER read from the payload — always re-derived server-side
    from Module 3's saved differential (ASSUMPTION #7).

    Returns:
    {
        "status": "success",
        "finaloutput": {
            "matched_disease_key": "...", "matched_disease_label": "...",
            "options": [
                {"option","reason","supporting_factors","patient_specific_risks",
                 "general_class_risk","guideline_reference","physician_decision_required"}
            ]
        },
        "context_used": {...}
    }
    """
    if groq_client is None:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured on server")

    patient_id = payload.get("patient_id")
    doctor_id = payload.get("doctor_id")

    if not patient_id or not doctor_id:
        raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")

    additional_context = (payload.get("additional_context") or "").strip()
    raw_prognostic_factors = payload.get("prognostic_factors") or {}

    match = await _get_matched_disease_status(patient_id, doctor_id)
    disease_key = match["disease_key"]
    if disease_key is None:
        supported = ", ".join(c["label"] for c in DISEASE_CONFIGS.values())
        raise HTTPException(
            status_code=400,
            detail=(
                f"None of the currently supported conditions ({supported}) were found as the "
                "working diagnosis or in the 'likely' tier of the most recent saved differential "
                "(Module 3). This module supports treatment decision support only for these "
                "conditions — see file-level ASSUMPTION #6."
            ),
        )

    config = DISEASE_CONFIGS[disease_key]
    prognostic_factors = _validate_prognostic_factors(disease_key, raw_prognostic_factors)

    medications = await _get_current_medications_brief(patient_id, doctor_id)
    activity_records = await _get_last_two_disease_activity_records(patient_id, doctor_id)
    response_info = _compute_treatment_response(disease_key, activity_records)
    safety = await _get_intake_safety_context(patient_id, doctor_id)

    current_activity = activity_records[0].get("scores", {}) if activity_records else None

    llm_input = {
        "working_diagnosis": config["label"],
        "current_medications": medications,
        "current_disease_activity_scores": current_activity,
        "treatment_response": response_info["response"],
        "prognostic_factors": prognostic_factors,
        "safety_context": safety,
        "additional_context": additional_context,
    }

    try:
        completion = groq_client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[
                {"role": "system", "content": _build_treatment_options_prompt(disease_key)},
                {"role": "user", "content": json.dumps(llm_input, indent=2, default=str)},
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )
        raw_content = completion.choices[0].message.content
        try:
            parsed = json.loads(raw_content)
        except (json.JSONDecodeError, TypeError):
            logger.error(f"Treatment options generation returned non-JSON: {raw_content}")
            parsed = {}
        if not isinstance(parsed, dict):
            parsed = {}

        raw_options = parsed.get("options")
        clean_options = []
        seen = set()
        if isinstance(raw_options, list):
            for item in raw_options:
                if not isinstance(item, dict):
                    continue
                option = str(item.get("option", ""))
                if option not in config["options_allowed"] or option in seen:
                    continue
                reason = str(item.get("reason", "")).strip()
                supporting_raw = item.get("supporting_factors")
                supporting = [str(s)[:200] for s in supporting_raw if str(s).strip()][:4] if isinstance(supporting_raw, list) else []
                if not reason or not supporting:
                    continue  # never persist an ungrounded option
                risks_raw = item.get("patient_specific_risks")
                patient_risks = [str(r)[:200] for r in risks_raw if str(r).strip()][:3] if isinstance(risks_raw, list) else []
                general_risk = str(item.get("general_class_risk", ""))[:300]

                seen.add(option)
                clean_options.append({
                    "option": option,
                    "reason": reason[:500],
                    "supporting_factors": supporting,
                    "patient_specific_risks": patient_risks,
                    "general_class_risk": general_risk,
                    "guideline_reference": config["guideline_reference"],
                    "physician_decision_required": True,
                })

        return {
            "status": "success",
            "finaloutput": {
                "matched_disease_key": disease_key,
                "matched_disease_label": config["label"],
                "options": clean_options,
            },
            "context_used": llm_input,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Treatment options generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 3. SAVE
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-treatment/save")
async def save_treatment_decision(payload: dict):
    """
    Expected payload:
    {
        "patient_id": "...", "doctor_id": "...",
        "matched_disease_key": "RA" | "PsA" | "AS" | "SLE" | "Gout",
        "options_presented": [...],           # full list shown to the doctor
        "selected_options": ["option string", ...],  # may be empty — "reviewed, no change"
        "physician_notes": "optional free text — doctor's own reasoning",
        "prognostic_factors": { <disease-specific keys> }
    }

    matched_disease_key is required so the save endpoint knows which
    catalog to validate options_presented against — it is NOT trusted
    blindly for anything else (guideline_reference is always re-derived
    server-side from DISEASE_CONFIGS, never taken from the payload).
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        matched_disease_key = payload.get("matched_disease_key")
        options_presented = payload.get("options_presented") or []
        selected_options = payload.get("selected_options") or []
        physician_notes = payload.get("physician_notes") or ""
        prognostic_factors = payload.get("prognostic_factors") or {}

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if matched_disease_key not in DISEASE_CONFIGS:
            raise HTTPException(status_code=400, detail="matched_disease_key missing or not a supported condition")
        if not isinstance(options_presented, list) or not options_presented:
            raise HTTPException(status_code=400, detail="options_presented is required and cannot be empty")

        config = DISEASE_CONFIGS[matched_disease_key]

        clean_presented = []
        for item in options_presented:
            if not isinstance(item, dict):
                continue
            option = str(item.get("option", ""))
            if option not in config["options_allowed"]:
                continue
            clean_presented.append({
                "option": option,
                "reason": str(item.get("reason", ""))[:500],
                "supporting_factors": [str(s)[:200] for s in (item.get("supporting_factors") or [])][:4],
                "patient_specific_risks": [str(r)[:200] for r in (item.get("patient_specific_risks") or [])][:3],
                "general_class_risk": str(item.get("general_class_risk", ""))[:300],
                "guideline_reference": config["guideline_reference"],
                "physician_decision_required": True,
            })

        if not clean_presented:
            raise HTTPException(status_code=400, detail="No valid options to save")

        valid_option_strings = {o["option"] for o in clean_presented}
        clean_selected = [s for s in selected_options if isinstance(s, str) and s in valid_option_strings]

        clean_prognostic = {}
        for field in config["prognostic_fields"]:
            key = field["key"]
            raw_value = prognostic_factors.get(key)
            if field["type"] == "select":
                clean_prognostic[key] = str(raw_value)[:20] if raw_value is not None else "Unknown"
            else:
                try:
                    clean_prognostic[key] = int(raw_value or 0)
                except (TypeError, ValueError):
                    clean_prognostic[key] = 0

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "matched_disease_key": matched_disease_key,
            "matched_disease_label": config["label"],
            "options_presented": clean_presented,
            "selected_options": clean_selected,
            "physician_notes": str(physician_notes)[:2000],
            "prognostic_factors": clean_prognostic,
            "guideline_reference": config["guideline_reference"],
            "created_at": datetime.utcnow(),
            "type": "rheumatology_treatment_decision",
        }
        result = await treatment_collection.insert_one(document)

        return {"status": "success", "message": "Treatment decision review saved", "id": str(result.inserted_id)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 4. HISTORY
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-treatment/history/{patient_id}/{doctor_id}")
async def get_treatment_decision_history(patient_id: str, doctor_id: str):
    """Fetch all saved Treatment Decision reviews for a patient, most recent first."""
    try:
        cursor = treatment_collection.find(
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