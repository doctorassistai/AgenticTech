"""
rheumatology_dmard_safety_api.py
─────────────────────────────────────────────────────────────────────────────
DoctorAssist.AI — Rheumatology AI Workflow, Module 8: DMARD Safety
Monitoring Agent (v1.0).

Reads current therapy (from the generic documentation-medication-analysis
collection, same lookup pattern as Modules 6/7), classifies each drug into
a closed monitoring-relevant DMARD class, checks the required labs for
that class against Module 5's recorded results (value + recency), and
combines that with a doctor-completed manual checklist for the monitoring
items nothing upstream captures structurally (TB/hepatitis screening,
vaccination status, blood pressure, ophthalmology screening).

Produces a 🟢 Continue / 🟡 Monitoring required / 🔴 Review-hold-escalate
status PER DRUG. This status is computed by deterministic rules in code —
NOT by the LLM — see ASSUMPTION #4. An optional short LLM narrative may
accompany the result, purely descriptive, never itself deciding the
status or recommending a treatment action (that judgment stays with
Module 7 / the physician).

Mirrors the naming/response/error-handling convention of the six prior
rheumatology modules 1:1.

ROUTES IN THIS FILE
---------------------
  GET  /rheumatology-dmard-safety/context-preview/{patient_id}/{doctor_id}
  POST /rheumatology-dmard-safety/calculate
  POST /rheumatology-dmard-safety/save
  GET  /rheumatology-dmard-safety/history/{patient_id}/{doctor_id}

⚠️ ASSUMPTIONS MADE WHILE ASSEMBLING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. ROUTER MOUNT: same convention as the other six rheumatology files —
     `prefix="/context"`, mount with `app.include_router(...)` in main.py.

  2. COLLECTION NAME: "rheumatology_dmard_safety". Change
     SAFETY_COLLECTION_NAME below if you want a different name.

  3. DRUG CLASSIFICATION IS KEYWORD-MATCHED, NOT LLM: each prescription's
     free-text medication name is matched (case-insensitive substring)
     against DMARD_KEYWORD_MAP, a static generic+common-brand-name list
     per monitoring class. This is deliberately NOT an LLM classification
     step — for a safety-monitoring module, a keyword match that either
     hits or misses is more predictable than an LLM guess that could
     misclassify an unfamiliar brand name. The tradeoff: an unlisted
     brand name (e.g. a newer biosimilar not in the keyword list) will
     be silently skipped rather than flagged — DMARD_KEYWORD_MAP should
     be reviewed/extended periodically as new agents enter use. A drug
     that doesn't match any keyword is NOT reported as an error; it's
     simply excluded from the monitoring panel (e.g. NSAIDs, PPIs,
     unrelated medications are expected to fall through silently).

  4. STATUS (🟢/🟡/🔴) IS RULE-BASED, NOT LLM-DECIDED: see
     `_evaluate_drug_status()`. Red/yellow/green is computed from (a)
     whether required labs exist and are within the expected interval,
     (b) whether the most recent value for each required lab crosses a
     fixed toxicity threshold, and (c) whether manual checklist items
     flagged as safety-critical for that class are marked "Not Done" or
     "Unknown". The LLM is never asked to produce or influence this
     status — only, optionally, to phrase a plain-English one-line
     summary of a status that's already been decided. This is the
     single most important design decision in this file; do not let the
     narrative step become the source of truth for the flag color.

  5. LAB REQUIREMENTS USE MODULE 5's EXACT TEST NAMES: "Hemoglobin",
     "White Blood Cell Count (WBC)", "Platelet Count", "AST", "ALT",
     "Creatinine" — these must match rheumatology_lab_trends_api.py's
     LAB_TEST_CATALOG keys exactly or the lookup silently finds nothing.
     There is no aggregate "CBC" or "LFT" test in that catalog, so this
     file checks the individual component tests instead.

  6. MONITORING INTERVALS ARE MAINTENANCE-PHASE, NOT INDUCTION-PHASE:
     e.g. methotrexate is checked against a 90-day interval here, which
     reflects standard STEADY-STATE monitoring — the first 3-6 months on
     a new DMARD typically call for monthly labs, which this module does
     NOT distinguish. If a patient just started a drug, this module may
     under-flag how frequently they should actually be monitored. Adding
     an induction-phase interval would need a reliable "date therapy was
     started" field, which documentation-medication-analysis doesn't
     structurally guarantee — flagging rather than guessing.

  7. TOXICITY THRESHOLDS ARE GENERIC ADULT REFERENCE-RANGE CUTOFFS, NOT
     PATIENT-SPECIFIC OR LAB-SPECIFIC: AST/ALT >120 U/L (~3x a generic
     40 U/L ULN) = red, 40-120 = yellow; WBC <3.0 = red, 3.0-4.0 = yellow;
     Platelets <100 = red, 100-150 = yellow; Creatinine >2.0 mg/dL = red,
     1.5-2.0 = yellow; Hemoglobin <8 g/dL = red, 8-10 = yellow. These are
     NOT adjusted for the patient's own baseline, age, sex, or your lab's
     specific reference ranges — treat as a rough safety net, not a
     substitute for the physician's own review of the actual result.

  8. BIOLOGICS ARE SPLIT INTO "IL-6 receptor inhibitor" (which DOES get
     routine LFT/CBC monitoring, since tocilizumab/sarilumab specifically
     carry hepatotoxicity and cytopenia risk) vs. a generic "Biologic —
     other" bucket (TNF inhibitors, abatacept, rituximab) which gets the
     manual checklist only (TB/hepatitis screening, vaccination status,
     infection screening) and no enforced lab interval — agent-specific
     lab needs beyond that (e.g. rituximab's pre-infusion CBC) aren't
     modeled here. JAK inhibitors get CBC+LFT monitoring plus a manual
     cardiovascular/VTE/malignancy risk checklist per the FDA boxed
     warning, but NOT lipid panel monitoring — lipids aren't in Module
     5's LAB_TEST_CATALOG.

  9. MULTIPLE CONCURRENT DMARDS: a patient on e.g. methotrexate + a
     biologic gets one panel entry per classified drug, each evaluated
     independently — this module does not attempt to reason about
     combination-therapy-specific risk (e.g. combined hepatotoxicity of
     methotrexate + leflunomide together), only per-drug monitoring.

  10. eGFR TRACKING (NEW, Tier 4 #11): eGFR has been added as a required
      lab for Methotrexate only, alongside the existing Creatinine check
      — methotrexate is renally cleared and eGFR is the more clinically
      actionable renal marker. It was NOT added to Leflunomide,
      Sulfasalazine, JAK inhibitor, or IL-6 receptor inhibitor, which the
      PDF's Module 11 spec doesn't specifically call out for renal
      monitoring — [UNCONFIRMED] whether eGFR should be broader; flag for
      clinical review before extending. The exact string "eGFR" is
      assumed to match whatever test_name rheumatology_lab_trends_api.py
      uses for it (that file hasn't been reviewed) — this is a read-only
      lookup that degrades gracefully (no eGFR found = "not recorded",
      same as any other missing lab), not a hard dependency. Confirm
      against the real Lab Trends catalog if that file is ever reviewed.

  11. RATE-OF-CHANGE / DELTA-FROM-BASELINE ALERTS (NEW, Tier 4 #11):
      "baseline" is defined as the EARLIEST recorded value in
      rheumatology_lab_results for that patient/test — NOT the value at
      the current drug's specific start date, since no reliable "therapy
      start date" field exists anywhere upstream (see ASSUMPTION #6,
      still true). If a patient switched drugs mid-history, the
      "baseline" shown may predate the current drug entirely — a known
      limitation, not a silently-assumed correctness guarantee.
      RATE_OF_CHANGE_THRESHOLDS (percent change from baseline that
      triggers yellow/red) are first-draft, unvalidated clinical
      thresholds — [UNCONFIRMED — clinical review required], same status
      as the absolute thresholds in ASSUMPTION #7. Rate-of-change
      flagging is ADDITIVE to, not a replacement for, absolute-threshold
      flagging — a single value can trigger yellow/red via either
      mechanism independently, and both reasons display if both fire.
─────────────────────────────────────────────────────────────────────────
"""

import os
import json
import logging
from datetime import datetime, date
from typing import Optional

from fastapi import APIRouter, HTTPException
from motor.motor_asyncio import AsyncIOMotorClient
from groq import Groq

logger = logging.getLogger(__name__)

# ─── Mongo setup ────────────────────────────────────────────────────────────
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

SAFETY_COLLECTION_NAME = "rheumatology_dmard_safety"  # see ASSUMPTION #2

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    safety_collection = database[SAFETY_COLLECTION_NAME]
    lab_results_collection = database["rheumatology_lab_results"]
    documentation_medication_analysis_collection = database["documentation-medication-analysis"]
    treatment_ledger_collection = database["rheumatology_treatment_ledger"]  # NEW — see fix note below

except Exception as e:
    logger.error(f"Error initializing MongoDB in rheumatology_dmard_safety_api: {e}")

# ─── Groq setup ─────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client: Optional[Groq] = None
try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        logger.warning("GROQ_API_KEY not set — DMARD safety narrative will be skipped (status still computes).")
except Exception as e:
    logger.error(f"Error initializing Groq client in rheumatology_dmard_safety_api: {e}")

router = APIRouter(prefix="/context", tags=["Rheumatology DMARD Safety Monitoring"])

# ─── Keyword -> monitoring class map — see ASSUMPTION #3 ─────────────────────
DMARD_KEYWORD_MAP = {
    "Methotrexate": ["methotrexate", "trexall", "otrexup", "rasuvo"],
    "Leflunomide": ["leflunomide", "arava"],
    "Hydroxychloroquine": ["hydroxychloroquine", "plaquenil"],
    "Sulfasalazine": ["sulfasalazine", "azulfidine"],
    "TNF inhibitor (biologic)": [
        "adalimumab", "humira", "etanercept", "enbrel", "infliximab", "remicade",
        "golimumab", "simponi", "certolizumab", "cimzia",
    ],
    "IL-6 receptor inhibitor (biologic)": ["tocilizumab", "actemra", "sarilumab", "kevzara"],
    "Abatacept (biologic)": ["abatacept", "orencia"],
    "Rituximab (biologic)": ["rituximab", "rituxan", "truxima"],
    "JAK inhibitor": ["tofacitinib", "xeljanz", "baricitinib", "olumiant", "upadacitinib", "rinvoq"],
}
GENERIC_BIOLOGIC_CLASSES = {"TNF inhibitor (biologic)", "Abatacept (biologic)", "Rituximab (biologic)"}

# ─── Monitoring requirement definitions — see ASSUMPTIONS #5, #6, #8 ─────────
LAB_MONITORING_REQUIREMENTS = {
    "Methotrexate": {"labs": ["Hemoglobin", "White Blood Cell Count (WBC)", "Platelet Count", "AST", "ALT", "Creatinine", "eGFR"], "interval_days": 90},
    "Leflunomide": {"labs": ["White Blood Cell Count (WBC)", "AST", "ALT"], "interval_days": 60},
    "Sulfasalazine": {"labs": ["White Blood Cell Count (WBC)", "Platelet Count", "AST", "ALT"], "interval_days": 90},
    "Hydroxychloroquine": {"labs": [], "interval_days": None},
    "IL-6 receptor inhibitor (biologic)": {"labs": ["White Blood Cell Count (WBC)", "AST", "ALT"], "interval_days": 90},
    "JAK inhibitor": {"labs": ["White Blood Cell Count (WBC)", "Platelet Count", "AST", "ALT"], "interval_days": 90},
}
for _cls in GENERIC_BIOLOGIC_CLASSES:
    LAB_MONITORING_REQUIREMENTS[_cls] = {"labs": [], "interval_days": None}

MANUAL_CHECKLIST_ITEMS = {
    "Leflunomide": ["Blood pressure check"],
    "Hydroxychloroquine": ["Annual ophthalmology screening (OCT / visual field)"],
    "TNF inhibitor (biologic)": ["TB screening", "Hepatitis B/C screening", "Vaccination status reviewed", "Active infection screening"],
    "IL-6 receptor inhibitor (biologic)": ["TB screening", "Hepatitis B/C screening", "Vaccination status reviewed", "Active infection screening"],
    "Abatacept (biologic)": ["TB screening", "Hepatitis B/C screening", "Vaccination status reviewed", "Active infection screening"],
    "Rituximab (biologic)": ["TB screening", "Hepatitis B/C screening", "Vaccination status reviewed", "Active infection screening"],
    "JAK inhibitor": ["Cardiovascular risk assessment (FDA boxed warning)", "VTE risk assessment", "Malignancy screening up to date"],
}

CHECKLIST_STATUS_ALLOWED = {"Done", "Not Done", "Unknown"}
def _flag_lab_value(test_name: str, value: float) -> Optional[str]:
    """Returns 'red', 'yellow', or None."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if test_name in ("AST", "ALT"):
        if v > 120: return "red"
        if v > 40: return "yellow"
    elif test_name == "White Blood Cell Count (WBC)":
        if v < 3.0: return "red"
        if v < 4.0: return "yellow"
    elif test_name == "Platelet Count":
        if v < 100: return "red"
        if v < 150: return "yellow"
    elif test_name == "Creatinine":
        if v > 2.0: return "red"
        if v > 1.5: return "yellow"
    elif test_name == "Hemoglobin":
        if v < 8: return "red"
        if v < 10: return "yellow"
    elif test_name == "eGFR":
        # eGFR is inverse — LOW is bad. Thresholds mirror CKD staging
        # (G4 <30, G3 <60). [UNCONFIRMED — clinical review required].
        if v < 30: return "red"
        if v < 60: return "yellow"
    return None


# ─── Rate-of-change / delta-from-baseline — see ASSUMPTION #11 ──────────────
# (test_name -> (direction, yellow_pct_change, red_pct_change))
# direction "increase": a RISE from baseline is the concerning direction.
# direction "decrease": a FALL from baseline is the concerning direction.
# [UNCONFIRMED — clinical review required], first-draft thresholds.
RATE_OF_CHANGE_THRESHOLDS = {
    "AST": ("increase", 50, 100),
    "ALT": ("increase", 50, 100),
    "Creatinine": ("increase", 25, 50),
    "eGFR": ("decrease", 25, 50),
    "White Blood Cell Count (WBC)": ("decrease", 30, 50),
    "Platelet Count": ("decrease", 30, 50),
    "Hemoglobin": ("decrease", 20, 30),
}


def _flag_rate_of_change(test_name: str, baseline_value, current_value) -> Optional[dict]:
    """
    Returns {"level": "red"|"yellow", "pct_change": float} or None.
    Independent of, and additive to, _flag_lab_value's absolute check.
    """
    rule = RATE_OF_CHANGE_THRESHOLDS.get(test_name)
    if not rule:
        return None
    try:
        baseline = float(baseline_value)
        current = float(current_value)
    except (TypeError, ValueError):
        return None
    if baseline == 0:
        return None
    pct_change = ((current - baseline) / baseline) * 100
    direction, yellow_pct, red_pct = rule
    magnitude = pct_change if direction == "increase" else -pct_change
    if magnitude >= red_pct:
        return {"level": "red", "pct_change": round(pct_change, 1)}
    if magnitude >= yellow_pct:
        return {"level": "yellow", "pct_change": round(pct_change, 1)}
    return None


def _classify_medication(name: str) -> Optional[str]:
    name_lower = (name or "").lower()
    for drug_class, keywords in DMARD_KEYWORD_MAP.items():
        if any(kw in name_lower for kw in keywords):
            return drug_class
    return None

async def _get_classified_current_dmards(patient_id: str, doctor_id: str) -> list:
    """
    Returns list of {name, drug_class} for every current DMARD.

    Source-of-truth order:
      1. rheumatology_treatment_ledger — entries with no stop_date (i.e.
         "Active", per that module's own status-derivation rule) are the
         real current-medication record; a doctor explicitly entered
         start date + is actively managing these.
      2. documentation-medication-analysis — legacy/fallback source, kept
         so patients who only have dictation-derived medication data
         (no ledger entry yet) still get evaluated, same behavior as
         before this fix.
      Both sources are checked and merged (deduplicated by drug_class,
      ledger takes priority on conflict) rather than one replacing the
      other, since a patient may have some drugs ledgered and others not.
    """
    seen_classes = set()
    results = []

    # 1. Treatment Ledger — active entries only
    try:
        cursor = treatment_ledger_collection.find({
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "stop_date": None,
        })
        async for entry in cursor:
            name = entry.get("drug_name") or ""
            if not name:
                continue
            drug_class = _classify_medication(name)
            if drug_class and drug_class not in seen_classes:
                seen_classes.add(drug_class)
                results.append({"name": name, "drug_class": drug_class})
    except Exception as e:
        logger.warning(f"DMARD safety: treatment ledger lookup failed for {patient_id}: {e}")

    # 2. Fallback — documentation-medication-analysis, only for classes
    #    not already covered by the ledger
    try:
        doc = await documentation_medication_analysis_collection.find_one(
            {"patient_id": patient_id}, sort=[("created_at", -1)]
        )
        if doc:
            prescriptions = (doc.get("finaloutput") or {}).get("prescriptions") or []
            for p in prescriptions:
                name = p.get("medication") or p.get("generic_name") or p.get("brand_name") or ""
                if not name:
                    continue
                drug_class = _classify_medication(name)
                if drug_class and drug_class not in seen_classes:
                    seen_classes.add(drug_class)
                    results.append({"name": name, "drug_class": drug_class})
    except Exception as e:
        logger.warning(f"DMARD safety: medication lookup failed for {patient_id}: {e}")

    return results

async def _get_latest_lab_value(patient_id: str, doctor_id: str, test_name: str) -> Optional[dict]:
    try:
        doc = await lab_results_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id, "test_name": test_name},
            sort=[("date", -1)],
        )
        if doc:
            return {"value": doc.get("value"), "date": doc.get("date")}
    except Exception as e:
        logger.warning(f"DMARD safety: {test_name} lookup failed for {patient_id}: {e}")
    return None


async def _get_baseline_lab_value(patient_id: str, doctor_id: str, test_name: str) -> Optional[dict]:
    """
    "Baseline" = the EARLIEST recorded value for this test — see
    ASSUMPTION #11 for why this isn't tied to a specific drug-start date.
    """
    try:
        doc = await lab_results_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id, "test_name": test_name},
            sort=[("date", 1)],
        )
        if doc:
            return {"value": doc.get("value"), "date": doc.get("date")}
    except Exception as e:
        logger.warning(f"DMARD safety: baseline {test_name} lookup failed for {patient_id}: {e}")
    return None


def _days_since(date_str: str) -> Optional[int]:
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d").date()
        return (date.today() - d).days
    except (TypeError, ValueError):
        return None


# ═════════════════════════════════════════════════════════════════════════════
# 1. CONTEXT PREVIEW
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-dmard-safety/context-preview/{patient_id}/{doctor_id}")
async def get_dmard_safety_context_preview(patient_id: str, doctor_id: str):
    """
    Classifies current DMARDs, pulls the latest relevant lab value (+ date)
    for each, and returns the manual checklist items the frontend needs to
    render for the doctor to fill in. No status is computed here — that
    only happens in /calculate, once the manual checklist is provided.
    """
    dmards = await _get_classified_current_dmards(patient_id, doctor_id)
    panel = []
    for d in dmards:
        drug_class = d["drug_class"]
        lab_req = LAB_MONITORING_REQUIREMENTS.get(drug_class, {"labs": [], "interval_days": None})
        lab_status = {}
        baseline_status = {}
        for test_name in lab_req["labs"]:
            lab_status[test_name] = await _get_latest_lab_value(patient_id, doctor_id, test_name)
            baseline_status[test_name] = await _get_baseline_lab_value(patient_id, doctor_id, test_name)
        panel.append({
            "name": d["name"],
            "drug_class": drug_class,
            "required_labs": lab_req["labs"],
            "interval_days": lab_req["interval_days"],
            "latest_labs": lab_status,
            "baseline_labs": baseline_status,
            "manual_checklist_items": MANUAL_CHECKLIST_ITEMS.get(drug_class, []),
        })

    return {"status": "success", "data": {"panel": panel}, "has_dmards": len(panel) > 0}


# ═════════════════════════════════════════════════════════════════════════════
# 2. CALCULATE
# ═════════════════════════════════════════════════════════════════════════════
def _evaluate_drug_status(drug_class: str, latest_labs: dict, baseline_labs: dict, checklist: dict) -> dict:
    """
    Deterministic rule engine — see ASSUMPTION #4 (and #11 for the new
    rate-of-change piece). Returns
    {"status": "green"|"yellow"|"red", "reasons": [str, ...]}.
    """
    lab_req = LAB_MONITORING_REQUIREMENTS.get(drug_class, {"labs": [], "interval_days": None})
    interval = lab_req["interval_days"]
    reasons = []
    worst = "green"

    def escalate(level, reason):
        nonlocal worst
        reasons.append(reason)
        if level == "red":
            worst = "red"
        elif level == "yellow" and worst != "red":
            worst = "yellow"

    for test_name in lab_req["labs"]:
        entry = (latest_labs or {}).get(test_name)
        if not entry or entry.get("value") is None:
            escalate("red", f"{test_name} never recorded")
            continue

        value_flag = _flag_lab_value(test_name, entry["value"])
        if value_flag == "red":
            escalate("red", f"{test_name} value {entry['value']} outside safe range")
        elif value_flag == "yellow":
            escalate("yellow", f"{test_name} value {entry['value']} borderline")

        baseline_entry = (baseline_labs or {}).get(test_name)
        if baseline_entry and baseline_entry.get("value") is not None:
            roc = _flag_rate_of_change(test_name, baseline_entry["value"], entry["value"])
            if roc:
                direction_word = "increased" if roc["pct_change"] > 0 else "decreased"
                escalate(
                    roc["level"],
                    f"{test_name} {direction_word} {abs(roc['pct_change'])}% from baseline "
                    f"({baseline_entry['value']} on {baseline_entry.get('date', 'unknown date')} → {entry['value']})",
                )

        if interval is not None:
            days = _days_since(entry.get("date"))
            if days is not None:
                if days > interval * 2:
                    escalate("red", f"{test_name} overdue — last checked {days} days ago (interval: {interval} days)")
                elif days > interval:
                    escalate("yellow", f"{test_name} due for recheck — last checked {days} days ago (interval: {interval} days)")

    for item in MANUAL_CHECKLIST_ITEMS.get(drug_class, []):
        item_status = (checklist or {}).get(item, "Unknown")
        if item_status == "Not Done":
            escalate("red", f"{item}: not done")
        elif item_status == "Unknown":
            escalate("yellow", f"{item}: not yet reviewed")

    if not reasons:
        reasons.append("All required labs current and within safe range; checklist complete")

    return {"status": worst, "reasons": reasons}


DMARD_NARRATIVE_PROMPT = """
You are a clinical assistant. You will be given a list of DMARD safety
monitoring results — for each drug, its monitoring status
(green/yellow/red) and the specific reasons behind that status (already
decided by rule-based logic, not by you).

Return a JSON object with exactly one key, "narrative": ONE short
paragraph (2-4 sentences) summarizing the overall monitoring picture
across all drugs listed, in plain language a physician can scan quickly.
Reference the actual drug names and reasons given.

Rules:
- Do NOT change, soften, or second-guess the status already assigned to
  any drug — describe it, don't re-evaluate it.
- Do NOT recommend stopping, starting, or changing any medication — that
  decision belongs to the physician (see Module 7).
- Do NOT invent findings not present in the input.
- Return valid JSON only — no markdown, no commentary, no extra keys.
"""


@router.post("/rheumatology-dmard-safety/calculate")
async def calculate_dmard_safety(payload: dict):
    """
    Expected payload:
    {
        "doctor_id": "...", "patient_id": "...",
        "checklist": {
            "Methotrexate": {},
            "Leflunomide": {"Blood pressure check": "Done"},
            "TNF inhibitor (biologic)": {"TB screening": "Done", "Hepatitis B/C screening": "Unknown", ...}
        }
    }
    (checklist keys are drug_class strings; values are objects mapping
    checklist item label -> "Done"/"Not Done"/"Unknown". Drugs with no
    manual checklist items, or where the doctor hasn't filled anything in,
    can be omitted or given an empty object.)

    Returns:
    {
        "status": "success",
        "finaloutput": { "panel": [ {name, drug_class, status, reasons, latest_labs}, ... ], "narrative": str | None }
    }
    """
    patient_id = payload.get("patient_id")
    doctor_id = payload.get("doctor_id")
    checklist_input = payload.get("checklist") or {}

    if not patient_id or not doctor_id:
        raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")

    dmards = await _get_classified_current_dmards(patient_id, doctor_id)
    if not dmards:
        raise HTTPException(
            status_code=400,
            detail="No recognized DMARDs found in current medications. Nothing to monitor.",
        )

    panel = []
    for d in dmards:
        drug_class = d["drug_class"]
        lab_req = LAB_MONITORING_REQUIREMENTS.get(drug_class, {"labs": [], "interval_days": None})
        latest_labs = {}
        baseline_labs = {}
        for test_name in lab_req["labs"]:
            latest_labs[test_name] = await _get_latest_lab_value(patient_id, doctor_id, test_name)
            baseline_labs[test_name] = await _get_baseline_lab_value(patient_id, doctor_id, test_name)

        drug_checklist = checklist_input.get(drug_class) or {}
        clean_checklist = {
            item: drug_checklist.get(item, "Unknown") if drug_checklist.get(item) in CHECKLIST_STATUS_ALLOWED else "Unknown"
            for item in MANUAL_CHECKLIST_ITEMS.get(drug_class, [])
        }

        evaluation = _evaluate_drug_status(drug_class, latest_labs, baseline_labs, clean_checklist)

        panel.append({
            "name": d["name"],
            "drug_class": drug_class,
            "status": evaluation["status"],
            "reasons": evaluation["reasons"],
            "latest_labs": latest_labs,
            "baseline_labs": baseline_labs,
            "checklist": clean_checklist,
        })

    narrative = None
    if groq_client is not None:
        try:
            llm_input = [{"drug": p["name"], "drug_class": p["drug_class"], "status": p["status"], "reasons": p["reasons"]} for p in panel]
            completion = groq_client.chat.completions.create(
                model="openai/gpt-oss-120b",
                messages=[
                    {"role": "system", "content": DMARD_NARRATIVE_PROMPT},
                    {"role": "user", "content": json.dumps(llm_input, indent=2, default=str)},
                ],
                temperature=0,
                response_format={"type": "json_object"},
            )
            parsed = json.loads(completion.choices[0].message.content)
            if isinstance(parsed, dict) and parsed.get("narrative"):
                narrative = str(parsed["narrative"])[:600]
        except Exception as e:
            logger.warning(f"DMARD safety: narrative generation failed for {patient_id}: {e}")

    return {"status": "success", "finaloutput": {"panel": panel, "narrative": narrative}}


# ═════════════════════════════════════════════════════════════════════════════
# 3. SAVE
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-dmard-safety/save")
async def save_dmard_safety(payload: dict):
    """
    Expected payload (doctor-reviewed version of /calculate's output):
    {
        "patient_id": "...", "doctor_id": "...",
        "panel": [ {name, drug_class, status, reasons, latest_labs, checklist}, ... ],
        "narrative": "optional"
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        panel = payload.get("panel") or []
        narrative = payload.get("narrative") or ""

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if not isinstance(panel, list) or not panel:
            raise HTTPException(status_code=400, detail="panel is required and cannot be empty")

        clean_panel = []
        for item in panel:
            if not isinstance(item, dict):
                continue
            drug_class = str(item.get("drug_class", ""))
            if drug_class not in LAB_MONITORING_REQUIREMENTS:
                continue
            status_val = str(item.get("status", ""))
            if status_val not in ("green", "yellow", "red"):
                continue
            clean_panel.append({
                "name": str(item.get("name", ""))[:200],
                "drug_class": drug_class,
                "status": status_val,
                "reasons": [str(r)[:300] for r in (item.get("reasons") or [])][:15],
                "latest_labs": item.get("latest_labs") or {},
                "baseline_labs": item.get("baseline_labs") or {},
                "checklist": {
                    k: v for k, v in (item.get("checklist") or {}).items()
                    if v in CHECKLIST_STATUS_ALLOWED
                },
            })

        if not clean_panel:
            raise HTTPException(status_code=400, detail="No valid panel entries to save")

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "panel": clean_panel,
            "narrative": str(narrative)[:600],
            "created_at": datetime.utcnow(),
            "type": "rheumatology_dmard_safety",
        }
        result = await safety_collection.insert_one(document)

        return {"status": "success", "message": "DMARD safety review saved", "id": str(result.inserted_id)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 4. HISTORY
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-dmard-safety/history/{patient_id}/{doctor_id}")
async def get_dmard_safety_history(patient_id: str, doctor_id: str):
    """Fetch all saved DMARD Safety reviews for a patient, most recent first."""
    try:
        cursor = safety_collection.find(
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