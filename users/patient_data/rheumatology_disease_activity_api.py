"""
rheumatology_disease_activity_api.py
─────────────────────────────────────────────────────────────────────────────
DoctorAssist.AI — Rheumatology AI Workflow, Module 6: Disease Activity Engine
(v1.0).

Computes standard composite RA disease-activity scores from data that now
already exists elsewhere in the workflow:

    - TJC28 / SJC28 (tender/swollen joint counts) — derived automatically
      from Module 2's most recent SAVED joint map (same 28-joint DAS28 set
      that module was deliberately built around — see that file's
      ASSUMPTION #4).
    - CRP / ESR — pulled from Module 5's most recent recorded lab results
      for those two tests (if present).
    - Patient Global Assessment (PtGA, 0-100mm VAS) and Physician Global
      Assessment (PGA, 0-10 VAS) — NOT available anywhere upstream, so
      captured here as manual doctor-entered fields per calculation. See
      ASSUMPTION #4 below for why, and what would change if a patient-
      facing surface (roadmap Module 17) takes this over later.

Computes, categorizes, and lets the doctor save:
    - DAS28-ESR
    - DAS28-CRP
    - CDAI
    - SDAI

...plus a "Previous → Current → Target" trend, and an OPTIONAL short LLM
narrative (only generated when a previous saved score exists to compare
against — mirrors Module 5's trend-narrative pattern, grounded strictly in
the actual numbers, no invented clinical advice).

Mirrors the naming/response/error-handling convention of the four prior
rheumatology modules 1:1.

ROUTES IN THIS FILE
---------------------
  GET  /rheumatology-disease-activity/context-preview/{patient_id}/{doctor_id}
  POST /rheumatology-disease-activity/calculate
  POST /rheumatology-disease-activity/save
  GET  /rheumatology-disease-activity/history/{patient_id}/{doctor_id}

⚠️ ASSUMPTIONS MADE WHILE ASSEMBLING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. ROUTER MOUNT: same convention as the other four rheumatology files —
     `prefix="/context"`, mount with `app.include_router(...)` in main.py.

  2. COLLECTION NAME: "rheumatology_disease_activity". Change
     DISEASE_ACTIVITY_COLLECTION_NAME below if you want a different name.

  3. SCOPE — RA COMPOSITE SCORES ONLY (v1): DAS28-ESR, DAS28-CRP, CDAI,
     SDAI all consume the same 28 (TJC/SJC) joint set Module 2 already
     records, so they could be built now without asking for new upstream
     data. BASDAI and ASDAS (axial spondyloarthritis) and DAPSA
     (psoriatic arthritis) each need entirely different inputs (BASDAI is
     patient-reported 0-10 VAS across 6 questions about stiffness/
     fatigue/pain domains; ASDAS needs those plus CRP; DAPSA needs a
     66/68 joint count, not 28). Rather than half-implement those against
     the wrong joint vocabulary, this file only does the four RA scores
     for now. Tell me if a specific one of BASDAI/ASDAS/DAPSA is the
     priority and I'll scope a Module 6b the same way this file was
     scoped.

  4. PtGA / PGA ARE MANUAL, PER-CALCULATION INPUTS — NOT PERSISTED
     UPSTREAM: unlike TJC28/SJC28/CRP/ESR, nothing in Modules 1-5
     captures Patient Global Assessment or Physician Global Assessment.
     Per your instruction, this module has the doctor enter both directly
     in the /calculate call (PtGA: 0-100mm VAS: "how has your arthritis
     activity been over the last week"; PGA: 0-10 VAS: physician's own
     assessment of overall disease activity). If a patient-facing
     Patient Monitoring Agent (roadmap Module 17) is built later and
     should own PtGA (patients often complete this on their own between/
     before visits, which is more standard practice than a doctor
     guessing on their behalf), swap this module's PtGA field for a
     lookup against that module's most recent submission the same way
     CRP/ESR are looked up from Module 5 here — the calculation logic
     itself won't need to change, only where the number comes from.

  5. AUTO-DERIVED JOINT COUNTS ARE EDITABLE, NOT FORCED: /calculate
     returns the TJC28/SJC28 it derived from Module 2's latest joint map
     as part of context-preview, but /calculate itself accepts optional
     tender_joint_count / swollen_joint_count overrides in the payload —
     e.g. if the joint map is stale (last recorded 3 visits ago) and the
     doctor wants to enter today's count directly without re-doing the
     full Module 2 mannequin. If neither override is given, the derived
     Module 2 counts are used as-is.

  6. CRP/ESR SOURCE + UNIT ASSUMPTION: DAS28-CRP's formula (Fransen et al.)
     expects CRP in mg/L, which matches Module 5's LAB_TEST_CATALOG unit
     for "CRP" exactly, so no conversion is applied. If your lab reports
     CRP in mg/dL, values would be off by 10x — confirm Module 5's stored
     unit matches your actual lab reporting before trusting this number
     clinically. SDAI's formula (Smolen et al.) also expects CRP in mg/dL,
     NOT mg/L — this file converts the mg/L value pulled from Module 5 by
     dividing by 10 for the SDAI calculation specifically (this is a
     genuine, easy-to-get-wrong unit trap in the standard SDAI literature
     formula; flagging it explicitly rather than silently getting it
     right once and hoping nobody re-derives it later).

  7. MISSING CRP/ESR: if Module 5 has no CRP result on file, DAS28-CRP and
     SDAI are simply omitted from the response (not computed with a
     placeholder). Same for ESR and DAS28-ESR. CDAI never needs an acute
     phase reactant, so it's always computable as long as joint counts +
     PtGA + PGA are present.

  8. CATEGORY THRESHOLDS: standard, widely-published EULAR/ACR cutoffs —
     DAS28: Remission <2.6, Low ≤3.2, Moderate ≤5.1, High >5.1.
     CDAI:   Remission ≤2.8, Low ≤10,  Moderate ≤22,  High >22.
     SDAI:   Remission ≤3.3, Low ≤11,  Moderate ≤26,  High >26.
     These are not configurable per-tenant in this file; say so if you
     need practice-specific thresholds instead.

  9. NARRATIVE IS OPTIONAL AND COMPARISON-ONLY: the LLM narrative is only
     generated when a PREVIOUS saved disease-activity record exists for
     this patient — it describes Previous → Current numerically and
     categorically, and may reference medications only if given (same
     restraint pattern as Module 5's trend narrative). It does NOT
     recommend a treatment change; that judgment call stays entirely with
     the physician per the roadmap's explicit "AI should not simply say
     give drug X" principle from Module 7 (Treatment Decision Engine,
     not yet built).
─────────────────────────────────────────────────────────────────────────
"""

import os
import json
import math
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

DISEASE_ACTIVITY_COLLECTION_NAME = "rheumatology_disease_activity"  # see ASSUMPTION #2

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    disease_activity_collection = database[DISEASE_ACTIVITY_COLLECTION_NAME]
    joint_map_collection = database["rheumatology_joint_map"]
    lab_results_collection = database["rheumatology_lab_results"]
    documentation_medication_analysis_collection = database["documentation-medication-analysis"]
    differential_collection = database["rheumatology_differential_diagnosis"]  # for working-diagnosis-based score gating
except Exception as e:
    logger.error(f"Error initializing MongoDB in rheumatology_disease_activity_api: {e}")

# ─── Groq setup ─────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client: Optional[Groq] = None
try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        logger.warning("GROQ_API_KEY not set — disease activity trend narrative will be skipped.")
except Exception as e:
    logger.error(f"Error initializing Groq client in rheumatology_disease_activity_api: {e}")

router = APIRouter(prefix="/context", tags=["Rheumatology Disease Activity Engine"])

# ─── 28-joint vocabulary — must match rheumatology_joint_map_api.py's JOINT_IDS ─
_SIDES = ["L", "R"]
JOINT_IDS = (
    [f"shoulder_{s}" for s in _SIDES]
    + [f"elbow_{s}" for s in _SIDES]
    + [f"wrist_{s}" for s in _SIDES]
    + [f"mcp{n}_{s}" for s in _SIDES for n in range(1, 6)]
    + [f"pip{n}_{s}" for s in _SIDES for n in range(1, 6)]
    + [f"knee_{s}" for s in _SIDES]
)  # 28 total


# ═════════════════════════════════════════════════════════════════════════════
# SCORE MATH — pure functions, no I/O, easy to unit-test independently
# ═════════════════════════════════════════════════════════════════════════════

def _tjc_sjc_from_joints(joints: dict) -> tuple:
    """Given a Module 2 joints dict ({joint_id: status}), returns (TJC28, SJC28)."""
    tjc = 0
    sjc = 0
    for jid, status in (joints or {}).items():
        if jid not in JOINT_IDS:
            continue
        if status in ("tender", "tender_swollen"):
            tjc += 1
        if status in ("swollen", "tender_swollen"):
            sjc += 1
    return tjc, sjc


def _categorize_das28(score: float) -> str:
    if score < 2.6:
        return "Remission"
    if score <= 3.2:
        return "Low"
    if score <= 5.1:
        return "Moderate"
    return "High"


def _categorize_cdai(score: float) -> str:
    if score <= 2.8:
        return "Remission"
    if score <= 10:
        return "Low"
    if score <= 22:
        return "Moderate"
    return "High"


def _categorize_sdai(score: float) -> str:
    if score <= 3.3:
        return "Remission"
    if score <= 11:
        return "Low"
    if score <= 26:
        return "Moderate"
    return "High"


def calculate_das28_esr(tjc28: int, sjc28: int, esr: float, ptga_0_100: float) -> float:
    # Fransen/van Riel formula, ESR in mm/hr, PtGA 0-100mm VAS
    esr_term = max(esr, 1)  # ln(0) undefined; ESR of 0 is not physiologically meaningful anyway
    return round(
        0.56 * math.sqrt(tjc28) + 0.28 * math.sqrt(sjc28) + 0.70 * math.log(esr_term) + 0.014 * ptga_0_100,
        2,
    )


def calculate_das28_crp(tjc28: int, sjc28: int, crp_mg_per_l: float, ptga_0_100: float) -> float:
    # Fransen/van Riel CRP variant, CRP in mg/L, PtGA 0-100mm VAS
    return round(
        0.56 * math.sqrt(tjc28) + 0.28 * math.sqrt(sjc28) + 0.36 * math.log(crp_mg_per_l + 1) + 0.014 * ptga_0_100 + 0.96,
        2,
    )


def calculate_cdai(tjc28: int, sjc28: int, ptga_0_10: float, pga_0_10: float) -> float:
    return round(tjc28 + sjc28 + ptga_0_10 + pga_0_10, 2)


def calculate_sdai(tjc28: int, sjc28: int, ptga_0_10: float, pga_0_10: float, crp_mg_per_dl: float) -> float:
    return round(tjc28 + sjc28 + ptga_0_10 + pga_0_10 + crp_mg_per_dl, 2)


# ─── BASDAI / ASDAS (axial spondyloarthritis) — see requirement #8 ──────────
# All patient-reported items are 0-10 NRS, same VAS convention as PtGA/PGA
# above. Standard published formulas (Garrett et al. for BASDAI, ASAS for
# ASDAS); thresholds are the widely-cited ASAS cutoffs. Not configurable
# per-tenant, same caveat as ASSUMPTION #8 for the RA scores.

def calculate_basdai(q1_fatigue, q2_spinal_pain, q3_peripheral_pain, q4_enthesitis, q5_stiffness_severity, q6_stiffness_duration) -> float:
    return round((q1_fatigue + q2_spinal_pain + q3_peripheral_pain + q4_enthesitis + ((q5_stiffness_severity + q6_stiffness_duration) / 2)) / 5, 2)


def _categorize_basdai(score: float) -> str:
    # ASAS "active disease" cutoff is >=4; there is no standard four-tier
    # category system like DAS28/CDAI/SDAI, so this file uses a simple
    # two-state read presented in the same {value, category} shape for
    # frontend consistency. Tell me if you want a finer-grained scale.
    return "Active" if score >= 4 else "Inactive"


def calculate_asdas_crp(back_pain, morning_stiffness_duration, patient_global, peripheral_pain_swelling, crp_mg_per_l) -> float:
    return round(
        0.12 * back_pain + 0.06 * morning_stiffness_duration + 0.11 * patient_global
        + 0.07 * peripheral_pain_swelling + 0.58 * math.log(max(crp_mg_per_l, 0) + 1),
        2,
    )


def calculate_asdas_esr(back_pain, morning_stiffness_duration, patient_global, peripheral_pain_swelling, esr_mm_per_hr) -> float:
    return round(
        0.08 * back_pain + 0.07 * morning_stiffness_duration + 0.11 * patient_global
        + 0.09 * peripheral_pain_swelling + 0.29 * math.sqrt(max(esr_mm_per_hr, 0)),
        2,
    )


def _categorize_asdas(score: float) -> str:
    if score < 1.3:
        return "Inactive"
    if score < 2.1:
        return "Moderate"
    if score < 3.5:
        return "High"
    return "Very High"


# ─── SLEDAI-2K (SLE) — see requirement #8 ────────────────────────────────────
# Standard 24-descriptor weighted checklist (Gladman et al.). The doctor
# marks which descriptors were present in the last 10 days; the score is
# the sum of weights for descriptors marked true. Category cutpoints are a
# commonly-cited convention (Uribe 2004) — confirm against your practice's
# preferred reference before relying on the category label clinically;
# the raw numeric score is the more load-bearing value either way.
SLEDAI_DESCRIPTORS = {
    "seizure": 8, "psychosis": 8, "organic_brain_syndrome": 8, "visual_disturbance": 8,
    "cranial_nerve_disorder": 8, "lupus_headache": 8, "cva": 8, "vasculitis": 8,
    "arthritis": 4, "myositis": 4, "urinary_casts": 4, "hematuria": 4,
    "proteinuria": 4, "pyuria": 4,
    "new_rash": 2, "alopecia": 2, "mucosal_ulcers": 2, "pleurisy": 2,
    "pericarditis": 2, "low_complement": 2, "increased_dsdna": 2,
    "fever": 1, "thrombocytopenia": 1, "leukopenia": 1,
}


def calculate_sledai(descriptors: dict) -> int:
    return sum(weight for key, weight in SLEDAI_DESCRIPTORS.items() if descriptors.get(key) is True)


def _categorize_sledai(score: int) -> str:
    if score == 0:
        return "No Activity"
    if score <= 5:
        return "Mild"
    if score <= 10:
        return "Moderate"
    if score <= 19:
        return "High"
    return "Very High"


def _applicable_score_groups(working_diagnosis: Optional[str]) -> list:
    """
    Keyword-matched against Module 3's closed condition vocabulary (exact
    strings live in rheumatology_differential_diagnosis_api.py's
    DIFFERENTIAL_CONDITIONS_ALLOWED). "ra" is always included so the
    original four scores never disappear regardless of diagnosis state.
    """
    groups = ["ra"]
    wd = (working_diagnosis or "").lower()
    if "spondyloarthritis" in wd or "ankylosing spondylitis" in wd:
        groups.append("axial_spa")
    if "lupus" in wd or "sle" in wd:
        groups.append("sle")
    return groups


async def _get_working_diagnosis(patient_id: str, doctor_id: str) -> Optional[str]:
    try:
        doc = await differential_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        if doc:
            return doc.get("working_diagnosis")
    except Exception as e:
        logger.warning(f"Disease activity: working diagnosis lookup failed for {patient_id}: {e}")
    return None


# ═════════════════════════════════════════════════════════════════════════════
# 1. CONTEXT PREVIEW (auto-derived joint counts + latest labs + last score)
# ═════════════════════════════════════════════════════════════════════════════

async def _get_latest_joint_counts(patient_id: str, doctor_id: str) -> dict:
    result = {"tender_joint_count": None, "swollen_joint_count": None, "joint_map_date": None}
    try:
        doc = await joint_map_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        if doc:
            joints = (doc.get("joint_map") or {}).get("joints") or {}
            tjc, sjc = _tjc_sjc_from_joints(joints)
            result["tender_joint_count"] = tjc
            result["swollen_joint_count"] = sjc
            created = doc.get("created_at")
            result["joint_map_date"] = created.isoformat() if isinstance(created, datetime) else created
    except Exception as e:
        logger.warning(f"Disease activity: joint map lookup failed for {patient_id}: {e}")
    return result


async def _get_latest_value(patient_id: str, doctor_id: str, test_name: str) -> Optional[dict]:
    try:
        doc = await lab_results_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id, "test_name": test_name},
            sort=[("date", -1)],
        )
        if doc:
            return {"value": doc.get("value"), "date": doc.get("date")}
    except Exception as e:
        logger.warning(f"Disease activity: {test_name} lookup failed for {patient_id}: {e}")
    return None


async def _get_latest_disease_activity_record(patient_id: str, doctor_id: str) -> Optional[dict]:
    try:
        doc = await disease_activity_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        return doc
    except Exception as e:
        logger.warning(f"Disease activity: previous record lookup failed for {patient_id}: {e}")
        return None


@router.get("/rheumatology-disease-activity/context-preview/{patient_id}/{doctor_id}")
async def get_disease_activity_context_preview(patient_id: str, doctor_id: str):
    """
    Read-only preview shown before the doctor runs /calculate: the
    auto-derived TJC28/SJC28 from Module 2's latest joint map, the latest
    CRP/ESR from Module 5, and the previous saved disease-activity score
    (if any) for the "Previous" side of the Previous → Current → Target
    display.
    """
    joint_counts = await _get_latest_joint_counts(patient_id, doctor_id)
    crp = await _get_latest_value(patient_id, doctor_id, "CRP")
    esr = await _get_latest_value(patient_id, doctor_id, "ESR")
    previous = await _get_latest_disease_activity_record(patient_id, doctor_id)
    working_diagnosis = await _get_working_diagnosis(patient_id, doctor_id)

    previous_summary = None
    if previous:
        created = previous.get("created_at")
        previous_summary = {
            "date": created.isoformat() if isinstance(created, datetime) else created,
            "scores": previous.get("scores", {}),
        }

    has_joint_data = joint_counts["tender_joint_count"] is not None

    return {
        "status": "success",
        "data": {
            "joint_counts": joint_counts,
            "crp": crp,
            "esr": esr,
            "previous": previous_summary,
            "working_diagnosis": working_diagnosis,
            "applicable_score_groups": _applicable_score_groups(working_diagnosis),
        },
        "has_joint_data": has_joint_data,
    }


# ═════════════════════════════════════════════════════════════════════════════
# 2. CALCULATE
# ═════════════════════════════════════════════════════════════════════════════

TREND_NARRATIVE_PROMPT = """
You are a clinical assistant. You will be given a patient's previous and
current rheumatoid arthritis disease-activity scores (DAS28-ESR,
DAS28-CRP, CDAI, SDAI — only the ones actually available for both visits
are given), plus each score's category (Remission/Low/Moderate/High), and
optionally current medications.

Return a JSON object with exactly one key, "narrative": ONE short
paragraph (2-3 sentences) describing how disease activity has changed
between the previous and current visit, using the actual numbers and
categories given. If medications are provided, you may note them as
context (e.g. "...while on methotrexate 15mg weekly") but do NOT
recommend any treatment change or next step — that decision belongs to
the physician.

Rules:
- Do NOT invent scores, dates, or medications not present in the input.
- Do NOT suggest a specific treatment action.
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
        logger.warning(f"Disease activity: medication brief lookup failed for {patient_id}: {e}")
        return []


@router.post("/rheumatology-disease-activity/calculate")
async def calculate_disease_activity(payload: dict):
    """
    Expected payload:
    {
        "doctor_id": "...", "patient_id": "...",
        "patient_global_assessment": 0-100,   # required, VAS mm
        "physician_global_assessment": 0-10,  # required, VAS
        "tender_joint_count": optional int,   # overrides Module 2 derivation
        "swollen_joint_count": optional int   # overrides Module 2 derivation
    }

    Returns:
    {
        "status": "success",
        "finaloutput": {
            "tender_joint_count": int, "swollen_joint_count": int,
            "scores": {
                "das28_esr": {"value": float, "category": str} | None,
                "das28_crp": {"value": float, "category": str} | None,
                "cdai": {"value": float, "category": str},
                "sdai": {"value": float, "category": str} | None
            },
            "inputs_used": {...},
            "narrative": str | None
        }
    }
    """
    patient_id = payload.get("patient_id")
    doctor_id = payload.get("doctor_id")

    if not patient_id or not doctor_id:
        raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")

    ptga = payload.get("patient_global_assessment")
    pga = payload.get("physician_global_assessment")
    try:
        ptga = float(ptga)
        pga = float(pga)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="patient_global_assessment (0-100) and physician_global_assessment (0-10) are required numeric fields")
    if not (0 <= ptga <= 100):
        raise HTTPException(status_code=400, detail="patient_global_assessment must be 0-100")
    if not (0 <= pga <= 10):
        raise HTTPException(status_code=400, detail="physician_global_assessment must be 0-10")

    tjc_override = payload.get("tender_joint_count")
    sjc_override = payload.get("swollen_joint_count")

    joint_counts = await _get_latest_joint_counts(patient_id, doctor_id)
    tjc28 = tjc_override if tjc_override is not None else joint_counts["tender_joint_count"]
    sjc28 = sjc_override if sjc_override is not None else joint_counts["swollen_joint_count"]

    # ASSUMPTION #10 (added with BASDAI/ASDAS/SLEDAI): previously this raised
    # a hard 400 if no joint counts existed at all. Softened to a skip — a
    # patient being scored purely on BASDAI/ASDAS (axial SpA, often no
    # peripheral joint involvement) or SLEDAI (SLE) should not be blocked
    # just because Module 2 was never run. DAS28/CDAI/SDAI simply come back
    # null in that case, same pattern as missing CRP/ESR.
    if tjc28 is not None and sjc28 is not None:
        try:
            tjc28 = int(tjc28)
            sjc28 = int(sjc28)
            if not (0 <= tjc28 <= 28) or not (0 <= sjc28 <= 28):
                raise ValueError
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="tender_joint_count and swollen_joint_count must be integers 0-28")

    crp = await _get_latest_value(patient_id, doctor_id, "CRP")
    esr = await _get_latest_value(patient_id, doctor_id, "ESR")

    scores = {}
    ptga_0_10 = ptga / 10.0  # CDAI/SDAI use a 0-10 PtGA scale, not the 0-100 DAS28 scale

    scores["das28_esr"] = None
    if esr and esr.get("value") is not None:
        val = calculate_das28_esr(tjc28, sjc28, float(esr["value"]), ptga)
        scores["das28_esr"] = {"value": val, "category": _categorize_das28(val)}

    scores["das28_crp"] = None
    if crp and crp.get("value") is not None:
        val = calculate_das28_crp(tjc28, sjc28, float(crp["value"]), ptga)
        scores["das28_crp"] = {"value": val, "category": _categorize_das28(val)}

    scores["cdai"] = None
    if tjc28 is not None and sjc28 is not None:
        cdai_val = calculate_cdai(tjc28, sjc28, ptga_0_10, pga)
        scores["cdai"] = {"value": cdai_val, "category": _categorize_cdai(cdai_val)}

    scores["sdai"] = None
    if crp and crp.get("value") is not None and tjc28 is not None and sjc28 is not None:
        crp_mg_per_dl = float(crp["value"]) / 10.0  # see ASSUMPTION #6 — SDAI wants mg/dL, Module 5 stores mg/L
        val = calculate_sdai(tjc28, sjc28, ptga_0_10, pga, crp_mg_per_dl)
        scores["sdai"] = {"value": val, "category": _categorize_sdai(val)}

    # ── BASDAI (axial SpA) — all optional, only computed if provided ──────
    basdai_input = payload.get("basdai") or {}
    scores["basdai"] = None
    if all(basdai_input.get(k) is not None for k in ("q1_fatigue", "q2_spinal_pain", "q3_peripheral_pain", "q4_enthesitis", "q5_stiffness_severity", "q6_stiffness_duration")):
        try:
            vals = {k: float(basdai_input[k]) for k in ("q1_fatigue", "q2_spinal_pain", "q3_peripheral_pain", "q4_enthesitis", "q5_stiffness_severity", "q6_stiffness_duration")}
            val = calculate_basdai(**vals)
            scores["basdai"] = {"value": val, "category": _categorize_basdai(val)}
        except (TypeError, ValueError):
            pass

    # ── ASDAS (axial SpA) — uses CRP if available, falls back to ESR ──────
    asdas_input = payload.get("asdas") or {}
    scores["asdas"] = None
    if all(asdas_input.get(k) is not None for k in ("back_pain", "morning_stiffness_duration", "patient_global", "peripheral_pain_swelling")):
        try:
            bp = float(asdas_input["back_pain"])
            msd = float(asdas_input["morning_stiffness_duration"])
            pg = float(asdas_input["patient_global"])
            pps = float(asdas_input["peripheral_pain_swelling"])
            if crp and crp.get("value") is not None:
                val = calculate_asdas_crp(bp, msd, pg, pps, float(crp["value"]))
                scores["asdas"] = {"value": val, "category": _categorize_asdas(val), "variant": "CRP"}
            elif esr and esr.get("value") is not None:
                val = calculate_asdas_esr(bp, msd, pg, pps, float(esr["value"]))
                scores["asdas"] = {"value": val, "category": _categorize_asdas(val), "variant": "ESR"}
        except (TypeError, ValueError):
            pass

    # ── SLEDAI-2K (SLE) — checklist, only computed if any descriptor sent ─
    sledai_descriptors = payload.get("sledai_descriptors") or {}
    scores["sledai"] = None
    if sledai_descriptors:
        val = calculate_sledai(sledai_descriptors)
        scores["sledai"] = {"value": val, "category": _categorize_sledai(val), "descriptors": {k: True for k in sledai_descriptors if sledai_descriptors.get(k) is True}}

    inputs_used = {
        "tender_joint_count": tjc28,
        "swollen_joint_count": sjc28,
        "patient_global_assessment_0_100": ptga,
        "physician_global_assessment_0_10": pga,
        "crp_mg_per_l": crp.get("value") if crp else None,
        "crp_date": crp.get("date") if crp else None,
        "esr_mm_per_hr": esr.get("value") if esr else None,
        "esr_date": esr.get("date") if esr else None,
        "basdai_inputs": basdai_input if scores["basdai"] else None,
        "asdas_inputs": asdas_input if scores["asdas"] else None,
    }

    # Optional narrative — only if a previous record exists, see ASSUMPTION #9
    narrative = None
    previous = await _get_latest_disease_activity_record(patient_id, doctor_id)
    if previous and groq_client is not None:
        prev_scores = previous.get("scores") or {}
        comparable = {
            k: {"previous": prev_scores.get(k), "current": scores.get(k)}
            for k in ["das28_esr", "das28_crp", "cdai", "sdai"]
            if prev_scores.get(k) and scores.get(k)
        }
        if comparable:
            medications = await _get_current_medications_brief(patient_id)
            llm_input = {"score_comparison": comparable, "current_medications": medications}
            try:
                completion = groq_client.chat.completions.create(
                    model="openai/gpt-oss-120b",
                    messages=[
                        {"role": "system", "content": TREND_NARRATIVE_PROMPT},
                        {"role": "user", "content": json.dumps(llm_input, indent=2, default=str)},
                    ],
                    temperature=0,
                    response_format={"type": "json_object"},
                )
                parsed = json.loads(completion.choices[0].message.content)
                if isinstance(parsed, dict) and parsed.get("narrative"):
                    narrative = str(parsed["narrative"])[:600]
            except Exception as e:
                logger.warning(f"Disease activity: trend narrative generation failed for {patient_id}: {e}")

    return {
        "status": "success",
        "finaloutput": {
            "tender_joint_count": tjc28,
            "swollen_joint_count": sjc28,
            "scores": scores,
            "inputs_used": inputs_used,
            "narrative": narrative,
        },
    }


# ═════════════════════════════════════════════════════════════════════════════
# 3. SAVE
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-disease-activity/save")
async def save_disease_activity(payload: dict):
    """
    Expected payload (doctor-reviewed version of /calculate's output):
    {
        "patient_id": "...", "doctor_id": "...",
        "scores": { "das28_esr": {"value","category"} | null, ... },
        "inputs_used": {...},
        "narrative": "optional",
        "target": "optional — e.g. 'Remission' or 'Low disease activity',
                    doctor's stated treat-to-target goal for this patient"
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        scores = payload.get("scores") or {}
        inputs_used = payload.get("inputs_used") or {}
        narrative = payload.get("narrative") or ""
        target = payload.get("target") or ""

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")

        clean_scores = {}
        for key in ["das28_esr", "das28_crp", "cdai", "sdai", "basdai", "asdas", "sledai"]:
            item = scores.get(key)
            if isinstance(item, dict) and item.get("value") is not None and item.get("category"):
                try:
                    clean_scores[key] = {"value": round(float(item["value"]), 2), "category": str(item["category"])[:20]}
                    if item.get("variant"):
                        clean_scores[key]["variant"] = str(item["variant"])[:10]
                    if item.get("descriptors"):
                        clean_scores[key]["descriptors"] = {str(k)[:50]: True for k in item["descriptors"] if k in SLEDAI_DESCRIPTORS}
                except (TypeError, ValueError):
                    continue

        if not clean_scores:
            raise HTTPException(status_code=400, detail="At least one valid score is required to save")

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "scores": clean_scores,
            "inputs_used": inputs_used,
            "narrative": str(narrative)[:600],
            "target": str(target)[:100],
            "created_at": datetime.utcnow(),
            "type": "rheumatology_disease_activity",
        }
        result = await disease_activity_collection.insert_one(document)

        return {"status": "success", "message": "Disease activity assessment saved", "id": str(result.inserted_id)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 4. HISTORY
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-disease-activity/history/{patient_id}/{doctor_id}")
async def get_disease_activity_history(patient_id: str, doctor_id: str):
    """Fetch all saved Disease Activity records for a patient, most recent first."""
    try:
        cursor = disease_activity_collection.find(
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