"""
rheumatology_comorbidity_risk_api.py
─────────────────────────────────────────────────────────────────────────────
DoctorAssist.AI — Rheumatology AI Workflow, Module 13: Comorbidity & Risk
Intelligence Agent (v1.0).

Reads the free-text comorbidities list and steroid exposure captured at
intake (Module 1's rheumatology_intake collection), keyword-matches them
into closed risk-factor tags across three RA-relevant comorbidity
domains — Cardiovascular Risk, Osteoporosis/Fracture Risk, and General
Infection Risk — combines that with a doctor-completed manual checklist
for the items nothing upstream captures structurally (family history,
DEXA status, fall risk, smoking/vaccination confirmation), and computes
a Low / Moderate / High risk category PER DOMAIN.

Same "keyword-match auto-detection + manual checklist + deterministic
status, LLM narrative only" design as Module 8 (DMARD Safety), applied
one-flag-per-domain instead of one-flag-per-drug. Mirrors the
naming/response/error-handling convention of the twelve prior
rheumatology modules 1:1.

ROUTES IN THIS FILE
---------------------
  GET  /rheumatology-comorbidity-risk/context-preview/{patient_id}/{doctor_id}
  POST /rheumatology-comorbidity-risk/calculate
  POST /rheumatology-comorbidity-risk/save
  GET  /rheumatology-comorbidity-risk/history/{patient_id}/{doctor_id}

⚠️ ASSUMPTIONS MADE WHILE ASSEMBLING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. ROUTER MOUNT: same convention as the twelve prior rheumatology
     files — `prefix="/context"`, mount with
     `app.include_router(...)` in main.py.

  2. COLLECTION NAME: "rheumatology_comorbidity_risk". Change
     RISK_COLLECTION_NAME below if you want a different name.

  3. SOURCE OF COMORBIDITIES: reuses Module 1's rheumatology_intake
     collection — specifically `rheumatology_intake.comorbidities`
     (free-text list) and `rheumatology_intake.steroid_exposure`. This
     is NOT a new intake form. If intake hasn't been completed for a
     patient yet, this module still renders — auto-detected factors are
     simply empty and the doctor works from the manual checklist alone
     (has_intake_data flag tells the frontend which case it's in).

  4. KEYWORD MATCHING, NOT LLM CLASSIFICATION — same rationale as
     Module 8's ASSUMPTION #3: for a risk-screening module, a keyword
     match that either hits or misses is more predictable than an LLM
     guess. A free-text comorbidity that doesn't match any keyword in
     RISK_FACTOR_KEYWORD_MAP is silently excluded from the auto-detected
     tag list — but the raw intake comorbidities list is still returned
     in context-preview so the doctor can eyeball anything that fell
     through and account for it via the manual checklist / their own
     judgment.

  5. RISK CATEGORY (Low/Moderate/High) IS RULE-BASED, NOT LLM-DECIDED:
     see `_evaluate_domain_risk()`. Each domain accumulates one point
     per auto-detected risk factor present, one point per manual
     checklist item marked "Not Done", and one point per manual item
     left "Unknown" — an unassessed item is treated as a risk signal,
     not a neutral, the same way Module 8 escalates on "Unknown"
     checklist entries rather than ignoring them. 0 points = Low,
     1-2 = Moderate, 3+ = High, uniformly across all three domains. The
     LLM is never asked to produce or influence this category — only,
     optionally, to phrase a plain-English narrative describing
     categories that have already been decided.

  6. THREE FIXED DOMAINS: Cardiovascular Risk, Osteoporosis/Fracture
     Risk, and General Infection Risk — the comorbidity domains most
     consistently flagged for routine rheumatologist review in RA
     management. This module does NOT attempt malignancy risk
     stratification (an oncology-specific concern) or a formal
     fracture-risk score like FRAX (needs age/sex/BMI/DEXA T-score
     fields this workflow doesn't structurally capture) — flagging
     rather than approximating either.

  7. STEROID EXPOSURE CONTRIBUTES TO BOTH Cardiovascular and
     Osteoporosis domains: if `steroid_exposure.has_used == "Yes"` at
     intake, both domains get a flat +1 "Steroid exposure reported at
     intake" point, since cumulative glucocorticoid exposure is a
     shared driver for both. There's no cumulative-dose field to grade
     this by severity, so it's a flat flag rather than a graded one.

  8. POINT-IN-TIME SNAPSHOT, NOT LONGITUDINAL: each /calculate call is
     a fresh read of current intake + whatever manual checklist the
     doctor fills in that session. Trending comorbidity risk over time
     is not attempted here (that's a Module 15 dashboard-aggregation
     concern, not this module's).

  9. NO OVERLAP WITH MODULE 8: this module does not read current DMARD
     therapy or lab values — it's about the patient's baseline health
     profile, not drug-specific monitoring, so the two are kept
     intentionally separate rather than merged.
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

RISK_COLLECTION_NAME = "rheumatology_comorbidity_risk"  # see ASSUMPTION #2

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    risk_collection = database[RISK_COLLECTION_NAME]
    rheumatology_intake_collection = database["rheumatology_intake"]
except Exception as e:
    logger.error(f"Error initializing MongoDB in rheumatology_comorbidity_risk_api: {e}")

# ─── Groq setup ─────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client: Optional[Groq] = None
try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        logger.warning("GROQ_API_KEY not set — comorbidity risk narrative will be skipped (categories still compute).")
except Exception as e:
    logger.error(f"Error initializing Groq client in rheumatology_comorbidity_risk_api: {e}")

router = APIRouter(prefix="/context", tags=["Rheumatology Comorbidity & Risk Intelligence"])

# ─── Keyword -> risk-factor tag map, per domain — see ASSUMPTION #4 ──────────
RISK_FACTOR_KEYWORD_MAP = {
    "Cardiovascular Risk": {
        "Hypertension": ["hypertension", "high blood pressure"],
        "Diabetes mellitus": ["diabetes", "diabetic"],
        "Hyperlipidemia": ["hyperlipidemia", "high cholesterol", "dyslipidemia"],
        "Prior cardiovascular event": ["myocardial infarction", "heart attack", "coronary artery disease", "stroke", "angina"],
        "Obesity": ["obesity", "obese"],
        "Smoking history": ["smoking", "smoker", "tobacco"],
    },
    "Osteoporosis/Fracture Risk": {
        "Prior osteoporosis/osteopenia diagnosis": ["osteoporosis", "osteopenia"],
        "Prior fragility fracture": ["fracture"],
        "Postmenopausal": ["menopause", "postmenopausal"],
        "Low BMI / malnutrition": ["low bmi", "underweight", "malnutrition"],
    },
    "General Infection Risk": {
        "Chronic kidney disease": ["chronic kidney disease", "ckd", "renal failure"],
        "Chronic lung disease": ["copd", "chronic lung", "emphysema", "bronchiectasis", "interstitial lung disease"],
        "Recurrent infections": ["recurrent infection", "frequent infection"],
        "Immunosuppression (non-DMARD)": ["hiv", "immunosuppressed", "immunodeficiency"],
    },
}

DOMAINS = list(RISK_FACTOR_KEYWORD_MAP.keys())
STEROID_DOMAINS = ("Cardiovascular Risk", "Osteoporosis/Fracture Risk")  # see ASSUMPTION #7

# ─── Manual checklist items per domain — items nothing upstream captures ─────
MANUAL_CHECKLIST_ITEMS = {
    "Cardiovascular Risk": [
        "Family history of premature coronary disease",
        "Physical activity level assessed",
        "Blood pressure checked this visit",
    ],
    "Osteoporosis/Fracture Risk": [
        "DEXA scan performed/reviewed",
        "Calcium/Vitamin D supplementation status",
        "Fall risk assessed",
    ],
    "General Infection Risk": [
        "Smoking status confirmed this visit",
        "Vaccination status reviewed",
        "Recent unexplained weight loss / infection screen",
    ],
}

CHECKLIST_STATUS_ALLOWED = {"Done", "Not Done", "Unknown"}

RISK_CATEGORY_COLOR_HINT = {"Low": "green", "Moderate": "yellow", "High": "red"}  # for frontend, informational only


def _detect_risk_factors(comorbidities: list, domain: str) -> list:
    """Keyword-matches free-text comorbidities against one domain's map. Returns list of matched tag names."""
    keyword_map = RISK_FACTOR_KEYWORD_MAP[domain]
    text_blob = " | ".join(str(c).lower() for c in (comorbidities or []))
    matched = []
    for tag, keywords in keyword_map.items():
        if any(kw in text_blob for kw in keywords):
            matched.append(tag)
    return matched


async def _get_latest_intake(patient_id: str, doctor_id: str) -> Optional[dict]:
    try:
        doc = await rheumatology_intake_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        if doc:
            return doc.get("rheumatology_intake") or {}
    except Exception as e:
        logger.warning(f"Comorbidity risk: intake lookup failed for {patient_id}: {e}")
    return None


# ═════════════════════════════════════════════════════════════════════════════
# 1. CONTEXT PREVIEW
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-comorbidity-risk/context-preview/{patient_id}/{doctor_id}")
async def get_comorbidity_risk_context_preview(patient_id: str, doctor_id: str):
    """
    Pulls the latest intake's comorbidities + steroid exposure, keyword-
    matches auto-detected risk factors per domain, and returns the manual
    checklist items the frontend needs to render. No category is computed
    here — that only happens in /calculate, once the manual checklist is
    provided.
    """
    intake = await _get_latest_intake(patient_id, doctor_id)
    comorbidities = (intake or {}).get("comorbidities") or []
    steroid_exposure = (intake or {}).get("steroid_exposure") or {}
    steroid_used = str(steroid_exposure.get("has_used", "")) == "Yes"

    domains = []
    for domain in DOMAINS:
        auto_factors = _detect_risk_factors(comorbidities, domain)
        if steroid_used and domain in STEROID_DOMAINS:
            auto_factors = auto_factors + ["Steroid exposure reported at intake"]
        domains.append({
            "domain": domain,
            "auto_detected_factors": auto_factors,
            "manual_checklist_items": MANUAL_CHECKLIST_ITEMS[domain],
        })

    return {
        "status": "success",
        "data": {
            "domains": domains,
            "raw_comorbidities": comorbidities,
            "steroid_exposure_reported": steroid_used,
        },
        "has_intake_data": intake is not None,
    }


# ═════════════════════════════════════════════════════════════════════════════
# 2. CALCULATE
# ═════════════════════════════════════════════════════════════════════════════
def _evaluate_domain_risk(auto_factors: list, checklist: dict, domain: str) -> dict:
    """
    Deterministic rule engine. Real risk factors (auto-detected from
    intake, or a checklist item explicitly marked "Not Done") count as
    genuine evidence points. Items merely "Unknown" (not yet assessed)
    are tracked separately and can escalate a domain by at most ONE
    level on their own — mirroring Module 8's DMARD Safety pattern,
    where "not yet reviewed" caps at yellow, never red, unless a real
    finding is also present. This prevents an all-Unknown checklist on
    a patient with zero actual comorbidities from reading as High risk.
    """
    reasons = []
    evidence_points = 0
    unassessed_count = 0

    for factor in auto_factors:
        evidence_points += 1
        reasons.append(f"{factor} (from intake)")

    for item in MANUAL_CHECKLIST_ITEMS[domain]:
        item_status = (checklist or {}).get(item, "Unknown")
        if item_status == "Not Done":
            evidence_points += 1
            reasons.append(f"{item}: not done")
        elif item_status == "Unknown":
            unassessed_count += 1
            reasons.append(f"{item}: not yet assessed")

    if evidence_points == 0:
        category = "Low"
    elif evidence_points <= 2:
        category = "Moderate"
    else:
        category = "High"

    if unassessed_count > 0:
        escalation = {"Low": "Moderate", "Moderate": "High", "High": "High"}
        new_category = escalation[category]
        if new_category != category:
            reasons.append(f"{unassessed_count} item(s) not yet assessed — escalated one level pending review")
        category = new_category

    if not reasons:
        reasons.append("No risk factors detected from intake; checklist complete")

    return {"category": category, "evidence_points": evidence_points, "unassessed_count": unassessed_count, "reasons": reasons}


COMORBIDITY_NARRATIVE_PROMPT = """
You are a clinical assistant. You will be given a list of comorbidity risk
domain results for a rheumatology patient — for each domain, its risk
category (Low/Moderate/High) and the specific reasons behind it (already
decided by rule-based logic, not by you).

Return a JSON object with exactly one key, "narrative": ONE short
paragraph (2-4 sentences) summarizing the overall comorbidity risk
picture across all domains listed, in plain language a physician can
scan quickly. Reference the actual domain names and reasons given.

Rules:
- Do NOT change, soften, or second-guess the category already assigned
  to any domain — describe it, don't re-evaluate it.
- Do NOT recommend starting, stopping, or changing any treatment,
  medication, or screening test — that decision belongs to the
  physician.
- Do NOT invent findings not present in the input.
- Return valid JSON only — no markdown, no commentary, no extra keys.
"""


@router.post("/rheumatology-comorbidity-risk/calculate")
async def calculate_comorbidity_risk(payload: dict):
    """
    Expected payload:
    {
        "doctor_id": "...", "patient_id": "...",
        "checklist": {
            "Cardiovascular Risk": {"Blood pressure checked this visit": "Done"},
            "Osteoporosis/Fracture Risk": {},
            "General Infection Risk": {"Smoking status confirmed this visit": "Unknown"}
        }
    }
    (checklist keys are domain strings; values are objects mapping
    checklist item label -> "Done"/"Not Done"/"Unknown". Domains with
    nothing filled in can be omitted or given an empty object.)

    Returns:
    {
        "status": "success",
        "finaloutput": { "domains": [ {domain, category, reasons, auto_detected_factors, checklist}, ... ], "narrative": str | None }
    }
    """
    patient_id = payload.get("patient_id")
    doctor_id = payload.get("doctor_id")
    checklist_input = payload.get("checklist") or {}

    if not patient_id or not doctor_id:
        raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")

    intake = await _get_latest_intake(patient_id, doctor_id)
    comorbidities = (intake or {}).get("comorbidities") or []
    steroid_exposure = (intake or {}).get("steroid_exposure") or {}
    steroid_used = str(steroid_exposure.get("has_used", "")) == "Yes"

    domains_out = []
    for domain in DOMAINS:
        auto_factors = _detect_risk_factors(comorbidities, domain)
        if steroid_used and domain in STEROID_DOMAINS:
            auto_factors = auto_factors + ["Steroid exposure reported at intake"]

        domain_checklist_input = checklist_input.get(domain) or {}
        clean_checklist = {
            item: domain_checklist_input.get(item, "Unknown") if domain_checklist_input.get(item) in CHECKLIST_STATUS_ALLOWED else "Unknown"
            for item in MANUAL_CHECKLIST_ITEMS[domain]
        }

        evaluation = _evaluate_domain_risk(auto_factors, clean_checklist, domain)

        domains_out.append({
            "domain": domain,
            "category": evaluation["category"],
            "reasons": evaluation["reasons"],
            "auto_detected_factors": auto_factors,
            "checklist": clean_checklist,
        })

    narrative = None
    if groq_client is not None:
        try:
            llm_input = [{"domain": d["domain"], "category": d["category"], "reasons": d["reasons"]} for d in domains_out]
            completion = groq_client.chat.completions.create(
                model="openai/gpt-oss-120b",
                messages=[
                    {"role": "system", "content": COMORBIDITY_NARRATIVE_PROMPT},
                    {"role": "user", "content": json.dumps(llm_input, indent=2, default=str)},
                ],
                temperature=0,
                response_format={"type": "json_object"},
            )
            parsed = json.loads(completion.choices[0].message.content)
            if isinstance(parsed, dict) and parsed.get("narrative"):
                text = str(parsed["narrative"])
                if len(text) > 600:
                    truncated = text[:600]
                    last_period = truncated.rfind(". ")
                    text = truncated[:last_period + 1] if last_period > 0 else truncated + "..."
                narrative = text
        except Exception as e:
            logger.warning(f"Comorbidity risk: narrative generation failed for {patient_id}: {e}")

    return {"status": "success", "finaloutput": {"domains": domains_out, "narrative": narrative}}


# ═════════════════════════════════════════════════════════════════════════════
# 3. SAVE
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-comorbidity-risk/save")
async def save_comorbidity_risk(payload: dict):
    """
    Expected payload (doctor-reviewed version of /calculate's output):
    {
        "patient_id": "...", "doctor_id": "...",
        "domains": [ {domain, category, reasons, auto_detected_factors, checklist}, ... ],
        "narrative": "optional"
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        domains = payload.get("domains") or []
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
            if domain_name not in DOMAINS:
                continue
            category_val = str(item.get("category", ""))
            if category_val not in ("Low", "Moderate", "High"):
                continue
            clean_domains.append({
                "domain": domain_name,
                "category": category_val,
                "reasons": [str(r)[:300] for r in (item.get("reasons") or [])][:15],
                "auto_detected_factors": [str(f)[:150] for f in (item.get("auto_detected_factors") or [])][:15],
                "checklist": {
                    k: v for k, v in (item.get("checklist") or {}).items()
                    if v in CHECKLIST_STATUS_ALLOWED
                },
            })

        if not clean_domains:
            raise HTTPException(status_code=400, detail="No valid domain entries to save")

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "domains": clean_domains,
            "narrative": str(narrative)[:600],
            "created_at": datetime.utcnow(),
            "type": "rheumatology_comorbidity_risk",
        }
        result = await risk_collection.insert_one(document)

        return {"status": "success", "message": "Comorbidity risk review saved", "id": str(result.inserted_id)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 4. HISTORY
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-comorbidity-risk/history/{patient_id}/{doctor_id}")
async def get_comorbidity_risk_history(patient_id: str, doctor_id: str):
    """Fetch all saved Comorbidity & Risk Intelligence reviews for a patient, most recent first."""
    try:
        cursor = risk_collection.find(
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