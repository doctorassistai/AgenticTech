"""
rheumatology_biomarker_analysis_api.py
─────────────────────────────────────────────────────────────────────────────
DoctorAssist.AI — Rheumatology AI Workflow, Biomarker Analysis Module
(requirement #4 in the senior review — distinct from Module 5's Lab Trend
Intelligence, which the gap analysis intentionally scoped to numeric,
trendable tests only — see Module 5's ASSUMPTION #3).

This module adds the piece Module 5 explicitly does not do:
  (a) reference-range abnormal-flagging as a first-class field (not just
      trend direction) for the numeric tests Module 5 already stores, and
  (b) a home for QUALITATIVE autoimmune markers (ANA, RF, Anti-CCP,
      HLA-B27, ANCA, ENA panel members) that Module 5's catalog
      deliberately excluded because they have no numeric trend.
  (c) a deterministic combination-flag rule engine (e.g. ANA+ / rising
      anti-dsDNA / low complement together) — same "rule-based flags,
      LLM only narrates" convention as every prior module.

It does NOT duplicate Module 5's numeric result storage — it reads
Module 5's own collection read-only for that half, and only owns storage
for the qualitative-marker half, which has nowhere else to live.

ROUTES IN THIS FILE
---------------------
  GET    /rheumatology-biomarkers/context-preview/{patient_id}/{doctor_id}
  POST   /rheumatology-biomarkers/add-qualitative
  GET    /rheumatology-biomarkers/qualitative/{patient_id}/{doctor_id}
  DELETE /rheumatology-biomarkers/qualitative/{marker_id}
  POST   /rheumatology-biomarkers/analyze
  POST   /rheumatology-biomarkers/save
  GET    /rheumatology-biomarkers/history/{patient_id}/{doctor_id}

⚠️ ASSUMPTIONS MADE WHILE ASSEMBLING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. READS MODULE 5's COLLECTION DIRECTLY: this file imports no code from
     rheumatology_lab_trends_api.py — it queries the same Mongo collection
     name ("rheumatology_lab_results") directly, matching Module 5's own
     ASSUMPTION #2 shape (test_name, value, unit, date). If Module 5's
     collection name or field shape ever changes, this file breaks
     silently (wrapped in try/except → degrades to "no numeric data"
     rather than crashing, per house convention, but the interpretation
     will be empty). Flagging this coupling explicitly since it's the one
     place this module reaches into another module's storage instead of
     owning its own.

  2. REFERENCE RANGES ARE GENERIC ADULT TEXTBOOK VALUES — NOT YOUR LAB'S
     ACTUAL RANGES: [UNCONFIRMED — clinical review required]. Every range
     in REFERENCE_RANGES below is a commonly-cited approximate normal
     range, not sourced from a specific lab's reporting standard (which
     vary by assay/instrument, and for some tests, by sex/age). Some
     tests intentionally use only a lower OR upper bound (e.g. eGFR,
     Anti-dsDNA titer, UPCR) since their clinical concern is one-sided.
     This needs sign-off before deploy or should be made lab-configurable.

  3. QUALITATIVE MARKER CATALOG: QUALITATIVE_MARKER_CATALOG below covers
     RF, Anti-CCP, ANA, HLA-B27, ANCA (p-ANCA/c-ANCA as two separate
     entries), and three ENA panel members (Ro/SSA, La/SSB, Sm, RNP) —
     the roadmap's named list minus Uric Acid/CBC/LFT/RFT/CK (already
     numeric in Module 5's catalog). Each entry is Positive/Negative/
     Equivocal plus an optional free-text titer string (titers aren't
     standardized enough across assays to make numeric/structured
     without knowing your lab's specific reporting convention — tell me
     if you want titer as a structured number with its own reference
     range per marker and I'll extend this).

  4. COMBINATION FLAGS ARE A STARTING SET, NOT EXHAUSTIVE: three rules
     implemented in `_evaluate_combination_flags()` — see that function's
     docstring for exactly which three and why. The roadmap's "flag
     clinically relevant combinations" is open-ended; these three were
     chosen because they're the most textbook-canonical and directly
     named in the roadmap's own worked example (ANA+/dsDNA+/low
     complement) or trivially derivable from data this module already
     has (RF+/Anti-CCP+ seropositivity, ESR/CRP concordance). Additional
     combination rules (e.g. ANCA+ with abnormal renal function →
     possible vasculitis) are straightforward additions to the same
     function once you confirm which combinations matter most
     clinically — flagged as a known gap, not silently omitted.

  5. COLLECTION NAME: "rheumatology_qualitative_biomarkers" for the new
     qualitative-marker log, "rheumatology_biomarker_analyses" for saved
     interpretations. Change QUALITATIVE_COLLECTION_NAME /
     ANALYSIS_COLLECTION_NAME below if you want different names.

 6. SYMPTOM/DISEASE-ACTIVITY CORRELATION NARRATIVE: the roadmap asks for
     "correlate biomarkers with symptoms" and "with disease activity."
     This module pulls the most recent saved scores (DAS28-ESR/CRP, CDAI,
     SDAI, and BASDAI/ASDAS/SLEDAI if present) from Module 6's collection
     read-only, same pattern as ASSUMPTION #1, purely as optional context
     handed to the narrative LLM call — it does not re-derive or validate
     those scores itself. Collection name and shape CONFIRMED against
     rheumatology_disease_activity_api.py — no longer unconfirmed.

  7. ALL FLAGS ARE RULE-BASED, NOT LLM-DECIDED — same convention as every
     prior module. The LLM only writes an optional narrative describing
     already-decided abnormal-flags and combination-flags; it never
     decides whether a value is abnormal or a combination is significant.
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

QUALITATIVE_COLLECTION_NAME = "rheumatology_qualitative_biomarkers"   # see ASSUMPTION #5
ANALYSIS_COLLECTION_NAME = "rheumatology_biomarker_analyses"

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    qualitative_collection = database[QUALITATIVE_COLLECTION_NAME]
    biomarker_analysis_collection = database[ANALYSIS_COLLECTION_NAME]

    # Read-only reach into Module 5's collection — see ASSUMPTION #1
    lab_results_collection = database["rheumatology_lab_results"]
    # Read-only reach into Module 6's collection — see ASSUMPTION #6
    # Confirmed against rheumatology_disease_activity_api.py: collection
    # name and {scores: {das28_esr: {value, category}, ...}} shape verified.
    disease_activity_collection = database["rheumatology_disease_activity"]
except Exception as e:
    logger.error(f"Error initializing MongoDB in rheumatology_biomarker_analysis_api: {e}")

# ─── Groq setup ─────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client: Optional[Groq] = None
try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        logger.warning("GROQ_API_KEY not set — biomarker narrative will be skipped (flags still compute).")
except Exception as e:
    logger.error(f"Error initializing Groq client in rheumatology_biomarker_analysis_api: {e}")

router = APIRouter(prefix="/context", tags=["Rheumatology Biomarker Analysis"])

# ─── Reference ranges for Module 5's numeric catalog — see ASSUMPTION #2 ─────
# [UNCONFIRMED — clinical review required] Generic adult reference ranges.
# {low, high}: None on either side = one-sided concern.
REFERENCE_RANGES = {
    "ESR": {"low": 0, "high": 20},
    "CRP": {"low": 0, "high": 10},
    "Hemoglobin": {"low": 12.0, "high": 16.0},
    "White Blood Cell Count (WBC)": {"low": 4.0, "high": 11.0},
    "Platelet Count": {"low": 150, "high": 400},
    "Creatinine": {"low": 0.6, "high": 1.3},
    "eGFR": {"low": 60, "high": None},
    "AST": {"low": 10, "high": 40},
    "ALT": {"low": 7, "high": 56},
    "Serum Uric Acid": {"low": 3.5, "high": 7.2},
    "Complement C3": {"low": 90, "high": 180},
    "Complement C4": {"low": 10, "high": 40},
    "Anti-dsDNA Titer": {"low": None, "high": 30},
    "Creatine Kinase (CK)": {"low": 30, "high": 200},
    "Urine Protein-to-Creatinine Ratio (UPCR)": {"low": None, "high": 150},
}

# ─── Qualitative marker catalog — see ASSUMPTION #3 ──────────────────────────
QUALITATIVE_MARKER_CATALOG = [
    "Rheumatoid Factor (RF)",
    "Anti-CCP",
    "ANA",
    "HLA-B27",
    "ANCA (p-ANCA)",
    "ANCA (c-ANCA)",
    "ENA — Anti-Ro/SSA",
    "ENA — Anti-La/SSB",
    "ENA — Anti-Sm",
    "ENA — Anti-RNP",
]
QUALITATIVE_RESULT_ALLOWED = {"Positive", "Negative", "Equivocal"}


def _flag_numeric(test_name: str, value: float) -> str:
    """Returns 'high' | 'low' | 'normal' | 'unranged' (no reference range on file)."""
    r = REFERENCE_RANGES.get(test_name)
    if not r:
        return "unranged"
    if r["high"] is not None and value > r["high"]:
        return "high"
    if r["low"] is not None and value < r["low"]:
        return "low"
    return "normal"


# ═════════════════════════════════════════════════════════════════════════════
# 1. CONTEXT PREVIEW
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-biomarkers/context-preview/{patient_id}/{doctor_id}")
async def get_biomarker_context_preview(patient_id: str, doctor_id: str):
    """Surfaces the closed vocab + whether numeric lab data already exists in Module 5."""
    numeric_test_count = 0
    try:
        numeric_test_count = await lab_results_collection.count_documents(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        )
    except Exception as e:
        logger.warning(f"Biomarker analysis: numeric count lookup failed for {patient_id}: {e}")

    return {
        "status": "success",
        "data": {
            "qualitative_markers": QUALITATIVE_MARKER_CATALOG,
            "numeric_tests_recorded_in_module5": numeric_test_count,
        },
    }


# ═════════════════════════════════════════════════════════════════════════════
# 2. QUALITATIVE MARKERS — ADD / DELETE / FETCH
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-biomarkers/add-qualitative")
async def add_qualitative_marker(payload: dict):
    """
    Expected payload:
    {
        "patient_id": "...", "doctor_id": "...",
        "marker_name": "ANA",              # must be in QUALITATIVE_MARKER_CATALOG
        "result": "Positive",              # Positive | Negative | Equivocal
        "titer": "1:320 speckled",         # optional free text — see ASSUMPTION #3
        "date": "2026-08-01",
        "notes": "optional free text"
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        marker_name = str(payload.get("marker_name", ""))
        result = str(payload.get("result", ""))
        titer = payload.get("titer") or ""
        date_str = payload.get("date") or datetime.utcnow().strftime("%Y-%m-%d")
        notes = payload.get("notes") or ""

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if marker_name not in QUALITATIVE_MARKER_CATALOG:
            raise HTTPException(status_code=400, detail=f"marker_name must be one of: {QUALITATIVE_MARKER_CATALOG}")
        if result not in QUALITATIVE_RESULT_ALLOWED:
            raise HTTPException(status_code=400, detail=f"result must be one of: {sorted(QUALITATIVE_RESULT_ALLOWED)}")
        try:
            datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="date must be in YYYY-MM-DD format")

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "marker_name": marker_name,
            "result": result,
            "titer": str(titer)[:100],
            "date": date_str,
            "notes": str(notes)[:500],
            "created_at": datetime.utcnow(),
        }
        res = await qualitative_collection.insert_one(document)

        return {"status": "success", "message": "Marker recorded", "id": str(res.inserted_id)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/rheumatology-biomarkers/qualitative/{patient_id}/{doctor_id}")
async def get_qualitative_markers(patient_id: str, doctor_id: str):
    try:
        cursor = qualitative_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("date", -1)

        records = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            if isinstance(doc.get("created_at"), datetime):
                doc["created_at"] = doc["created_at"].isoformat()
            records.append(doc)

        return {"status": "success", "count": len(records), "data": records}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/rheumatology-biomarkers/qualitative/{marker_id}")
async def delete_qualitative_marker(marker_id: str):
    try:
        try:
            oid = ObjectId(marker_id)
        except InvalidId:
            raise HTTPException(status_code=400, detail="Invalid marker_id")

        result = await qualitative_collection.delete_one({"_id": oid})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Marker not found")

        return {"status": "success", "message": "Marker deleted"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 3. ANALYZE
# ═════════════════════════════════════════════════════════════════════════════

async def _get_latest_numeric_per_test(patient_id: str, doctor_id: str) -> dict:
    """Latest value per numeric test from Module 5's collection — see ASSUMPTION #1."""
    latest = {}
    try:
        cursor = lab_results_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("date", 1)
        async for doc in cursor:
            latest[doc["test_name"]] = {"value": doc["value"], "date": doc["date"], "unit": doc.get("unit", "")}
    except Exception as e:
        logger.warning(f"Biomarker analysis: numeric lookup failed for {patient_id}: {e}")
    return latest


async def _get_latest_qualitative(patient_id: str, doctor_id: str) -> dict:
    latest = {}
    try:
        cursor = qualitative_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("date", 1)
        async for doc in cursor:
            latest[doc["marker_name"]] = {"result": doc["result"], "titer": doc.get("titer", ""), "date": doc["date"]}
    except Exception as e:
        logger.warning(f"Biomarker analysis: qualitative lookup failed for {patient_id}: {e}")
    return latest


async def _get_disease_activity_context(patient_id: str, doctor_id: str) -> dict:
    """
    Optional context for the narrative only — see ASSUMPTION #6.
    Returns the confirmed {scores: {das28_esr: {value, category}, ...},
    target} shape from Module 6, verified against
    rheumatology_disease_activity_api.py this session.
    """
    try:
        doc = await disease_activity_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        if not doc:
            return {}
        return {"scores": doc.get("scores", {}) or {}, "target": doc.get("target", "") or ""}
    except Exception as e:
        logger.warning(f"Biomarker analysis: disease activity lookup failed for {patient_id}: {e}")
        return {}


def _evaluate_combination_flags(numeric_latest: dict, qualitative_latest: dict) -> list:
    """
    Deterministic — see ASSUMPTION #4. Three starting rules:

    1. Lupus serology pattern: ANA Positive + Anti-dsDNA above reference
       + (C3 low OR C4 low) — the roadmap's own worked example.
    2. Seropositive RA pattern: RF Positive + Anti-CCP Positive together
       (higher specificity for RA than either alone — standard teaching).
    3. Concordant inflammatory markers: both ESR and CRP flagged 'high'
       at the same time.
    """
    flags = []

    ana = qualitative_latest.get("ANA", {}).get("result")
    dsdna = numeric_latest.get("Anti-dsDNA Titer")
    c3 = numeric_latest.get("Complement C3")
    c4 = numeric_latest.get("Complement C4")
    if ana == "Positive" and dsdna and _flag_numeric("Anti-dsDNA Titer", dsdna["value"]) == "high":
        c3_low = c3 and _flag_numeric("Complement C3", c3["value"]) == "low"
        c4_low = c4 and _flag_numeric("Complement C4", c4["value"]) == "low"
        if c3_low or c4_low:
            flags.append({
                "flag": "Lupus serology pattern",
                "reasoning": "ANA positive, elevated anti-dsDNA titer, and low complement (C3/C4) present together — pattern consistent with active lupus serologic activity. Correlate clinically; not a standalone diagnosis.",
            })

    rf = qualitative_latest.get("Rheumatoid Factor (RF)", {}).get("result")
    accp = qualitative_latest.get("Anti-CCP", {}).get("result")
    if rf == "Positive" and accp == "Positive":
        flags.append({
            "flag": "Seropositive RA pattern",
            "reasoning": "Both RF and Anti-CCP are positive — the combination carries higher specificity for rheumatoid arthritis than either marker alone.",
        })

    esr = numeric_latest.get("ESR")
    crp = numeric_latest.get("CRP")
    if esr and crp and _flag_numeric("ESR", esr["value"]) == "high" and _flag_numeric("CRP", crp["value"]) == "high":
        flags.append({
            "flag": "Concordant inflammatory markers",
            "reasoning": "ESR and CRP are both elevated concurrently, supporting active generalized inflammation rather than an isolated or discordant single-marker rise.",
        })

    return flags


BIOMARKER_NARRATIVE_PROMPT = """
You are a clinical assistant. You will be given: (1) latest numeric lab
values with their reference-range flag (high/low/normal/unranged), (2)
latest qualitative marker results, (3) any already-decided combination
flags with their reasoning, and optionally (4) the patient's most recent
disease-activity scores for correlation context.

Return a JSON object with exactly one key, "narrative": ONE short
paragraph (2-4 sentences) summarizing the overall biomarker picture in
plain language a physician can scan quickly, referencing actual test
names/values/flags given.

Rules:
- Do NOT change or re-evaluate any abnormal-flag or combination-flag
  already decided — describe them, don't second-guess them.
- Do NOT state a diagnosis — describe a pattern only, and note that
  clinical correlation is required.
- Do NOT invent values, markers, or flags not present in the input.
- Return valid JSON only — no markdown, no commentary, no extra keys.
"""


@router.post("/rheumatology-biomarkers/analyze")
async def analyze_biomarkers(payload: dict):
    """
    Expected payload: { "doctor_id": "...", "patient_id": "..." }

    Returns:
    {
        "status": "success",
        "finaloutput": {
            "numeric_flags": [{test_name, value, unit, date, flag}, ...],
            "qualitative_summary": [{marker_name, result, titer, date}, ...],
            "combination_flags": [{flag, reasoning}, ...],
            "narrative": str | None
        }
    }
    """
    patient_id = payload.get("patient_id")
    doctor_id = payload.get("doctor_id")
    if not patient_id or not doctor_id:
        raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")

    numeric_latest = await _get_latest_numeric_per_test(patient_id, doctor_id)
    qualitative_latest = await _get_latest_qualitative(patient_id, doctor_id)

    if not numeric_latest and not qualitative_latest:
        raise HTTPException(
            status_code=400,
            detail="No biomarker data yet — add numeric labs in Lab Trends and/or qualitative markers here first.",
        )

    numeric_flags = [
        {
            "test_name": name, "value": v["value"], "unit": v["unit"],
            "date": v["date"], "flag": _flag_numeric(name, v["value"]),
        }
        for name, v in numeric_latest.items()
    ]
    qualitative_summary = [
        {"marker_name": name, "result": v["result"], "titer": v["titer"], "date": v["date"]}
        for name, v in qualitative_latest.items()
    ]
    combination_flags = _evaluate_combination_flags(numeric_latest, qualitative_latest)
    disease_activity_context = await _get_disease_activity_context(patient_id, doctor_id)

    narrative = None
    if groq_client is not None:
        try:
            llm_input = {
                "numeric_flags": numeric_flags,
                "qualitative_summary": qualitative_summary,
                "combination_flags": combination_flags,
                "disease_activity_context": disease_activity_context,
            }
            completion = groq_client.chat.completions.create(
                model="openai/gpt-oss-120b",
                messages=[
                    {"role": "system", "content": BIOMARKER_NARRATIVE_PROMPT},
                    {"role": "user", "content": json.dumps(llm_input, indent=2, default=str)},
                ],
                temperature=0,
                response_format={"type": "json_object"},
            )
            parsed = json.loads(completion.choices[0].message.content)
            if isinstance(parsed, dict) and parsed.get("narrative"):
                narrative = str(parsed["narrative"])[:600]
        except Exception as e:
            logger.warning(f"Biomarker analysis: narrative generation failed for {patient_id}: {e}")

    return {
        "status": "success",
        "finaloutput": {
            "numeric_flags": numeric_flags,
            "qualitative_summary": qualitative_summary,
            "combination_flags": combination_flags,
            "narrative": narrative,
        },
    }


# ═════════════════════════════════════════════════════════════════════════════
# 4. SAVE
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-biomarkers/save")
async def save_biomarker_analysis(payload: dict):
    """
    Expected payload (doctor-reviewed version of /analyze's output):
    {
        "patient_id": "...", "doctor_id": "...",
        "numeric_flags": [...], "qualitative_summary": [...],
        "combination_flags": [...], "narrative": "optional"
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        numeric_flags = payload.get("numeric_flags") or []
        qualitative_summary = payload.get("qualitative_summary") or []
        combination_flags = payload.get("combination_flags") or []
        narrative = payload.get("narrative") or ""

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if not numeric_flags and not qualitative_summary:
            raise HTTPException(status_code=400, detail="No biomarker data to save")

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "numeric_flags": numeric_flags[:50],
            "qualitative_summary": qualitative_summary[:50],
            "combination_flags": combination_flags[:20],
            "narrative": str(narrative)[:600],
            "created_at": datetime.utcnow(),
            "type": "rheumatology_biomarker_analysis",
        }
        result = await biomarker_analysis_collection.insert_one(document)

        return {"status": "success", "message": "Biomarker analysis saved", "id": str(result.inserted_id)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 5. HISTORY
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-biomarkers/history/{patient_id}/{doctor_id}")
async def get_biomarker_analysis_history(patient_id: str, doctor_id: str):
    try:
        cursor = biomarker_analysis_collection.find(
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