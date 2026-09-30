"""
rheumatology_correlation_api.py
─────────────────────────────────────────────────────────────────────────────
DoctorAssist.AI — Rheumatology AI Workflow, Biomarker + Imaging Correlation
Engine (requirement #7 in the senior review).

The roadmap frames this as synthesizing Symptoms ↔ Biomarkers ↔ Imaging ↔
Disease Activity ↔ Treatment Response into one correlation narrative,
explicitly cautioning that no single finding should be treated as
definitive by itself. This module owns NO new structured data — it is a
pure read-and-synthesize layer over three modules that already exist:

    - Biomarker Analysis (numeric flags, qualitative markers, combination
      flags) — read-only via its own collection.
    - Imaging Intelligence (per-region worsening/improving/stable
      comparisons) — read-only via its own collection.
    - Disease Activity Engine (DAS28/CDAI/SDAI/BASDAI/ASDAS/SLEDAI scores)
      — read-only via its own collection.

Unlike every prior module, there is no closed-vocabulary rule engine that
outputs a red/yellow/green flag here — the roadmap's own worked example
("Findings are collectively consistent with an inflammatory arthritis
pattern...") is explicitly a narrative synthesis task, not a
categorization task. So this module's ONLY output is the LLM narrative,
grounded strictly in already-decided data pulled from the three source
modules — the same "LLM narrates, never decides" boundary as every prior
module, just with nothing left for Python to decide except which pieces
of context to hand the LLM and whether there's enough data to run at all.

Mirrors the naming/response/error-handling convention of the prior
rheumatology modules, minus a per-item rule engine (there is no
`_evaluate_*` function in this file, by design).

ROUTES IN THIS FILE
---------------------
  GET  /rheumatology-correlation/context-preview/{patient_id}/{doctor_id}
  POST /rheumatology-correlation/generate
  POST /rheumatology-correlation/save
  GET  /rheumatology-correlation/history/{patient_id}/{doctor_id}

⚠️ ASSUMPTIONS MADE WHILE ASSEMBLING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. READS THREE OTHER MODULES' COLLECTIONS DIRECTLY, OWNS NONE OF THEM:
     "rheumatology_biomarker_analyses" (latest saved analysis — the
     doctor-reviewed version, not the raw /analyze output), 
     "rheumatology_imaging_comparisons" (latest saved comparison), and
     "rheumatology_disease_activity" (latest saved score record). All
     three shapes confirmed against their respective API files this
     session. If ANY of the three is missing for this patient, this
     module degrades to using whichever subset exists — see ASSUMPTION
     #2 — rather than failing outright, since the roadmap's own gating
     note (#7 in the plan doc) says this should be "gated on having at
     least one saved differential + one lab result + one imaging
     comparison," which this file relaxes slightly further: it runs on
     ANY two of the three sources being present, not strictly requiring
     imaging specifically, since a biomarker+disease-activity-only
     correlation is still a valid (if narrower) synthesis. Tell me if
     you want the stricter "must include imaging" gate instead.

  2. MINIMUM TWO SOURCES REQUIRED: /generate requires saved data from at
     least 2 of the 3 source modules to run — a "correlation" across a
     single source isn't a correlation, it's just that module's own
     output restated. Returns 400 with a clear message naming which
     source(s) are missing if fewer than 2 are present.

  3. ONLY THE MOST RECENT SAVED RECORD PER SOURCE IS USED: no historical
     trending across multiple biomarker/imaging/disease-activity saves —
     this is a point-in-time synthesis of "here's the most recent
     reviewed data from each module, how does it fit together." A
     longitudinal version of this (e.g. "has the correlation strengthened
     over 3 visits") would be a meaningfully different, heavier feature —
     flagging as a known scope boundary, not an oversight.

  4. NO NEW RULE ENGINE — PURE LLM SYNTHESIS OVER ALREADY-DECIDED DATA:
     every individual data point handed to the LLM (numeric flag,
     combination flag, imaging direction, disease-activity category) was
     already computed deterministically by its own source module. This
     file adds no new thresholds or flags of its own — the LLM's job is
     purely to describe how the ALREADY-DECIDED pieces relate to each
     other, and explicitly to avoid presenting any single one as
     definitive, per the roadmap's own caution. This is a narrower LLM
     role than "decide something new," but it's still the most
     interpretive task in this codebase so far — flagging that the
     output quality here depends more on prompt discipline than in any
     prior module, and should get real clinical review before trusting
     it in practice.

  5. COLLECTION NAME: "rheumatology_correlations" for saved correlation
     narratives. Change CORRELATION_COLLECTION_NAME below if you want a
     different name.

  6. SYMPTOMS ARE NOT DIRECTLY INCLUDED (YET): the roadmap's own
     Symptoms ↔ Biomarkers ↔ Imaging ↔ Disease Activity ↔ Treatment
     Response chain includes symptoms and treatment response, neither of
     which this file pulls in. Disease-activity scores implicitly carry
     some symptom signal (PtGA is patient-reported), but there's no
     direct read of Module 1's intake symptoms or Module 9's treatment
     ledger here. Once Treatment Response Evaluation (#13) is built, this
     module should likely be extended to include it as a fourth source —
     flagging that as the natural next iteration on this file rather
     than building it now against an unconfirmed shape.
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

CORRELATION_COLLECTION_NAME = "rheumatology_correlations"  # see ASSUMPTION #5

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    correlation_collection = database[CORRELATION_COLLECTION_NAME]

    # Read-only reaches into other modules' collections — see ASSUMPTION #1
    biomarker_analysis_collection = database["rheumatology_biomarker_analyses"]
    imaging_comparison_collection = database["rheumatology_imaging_comparisons"]
    disease_activity_collection = database["rheumatology_disease_activity"]
    # Added: Treatment Response (requirement #13), confirmed shape against
    # rheumatology_treatment_response_api.py — {classification, primary_signal,
    # biomarker_signal, imaging_signal, narrative}.
    treatment_response_collection = database["rheumatology_treatment_responses"]
except Exception as e:
    logger.error(f"Error initializing MongoDB in rheumatology_correlation_api: {e}")

# ─── Groq setup ─────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client: Optional[Groq] = None
try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        logger.warning("GROQ_API_KEY not set — correlation endpoints will fail at call time.")
except Exception as e:
    logger.error(f"Error initializing Groq client in rheumatology_correlation_api: {e}")

router = APIRouter(prefix="/context", tags=["Rheumatology Biomarker + Imaging Correlation"])


# ═════════════════════════════════════════════════════════════════════════════
# SOURCE FETCHERS — read-only, each degrades to None on failure
# ═════════════════════════════════════════════════════════════════════════════

async def _get_latest_biomarker_analysis(patient_id: str, doctor_id: str) -> Optional[dict]:
    try:
        doc = await biomarker_analysis_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        if not doc:
            return None
        return {
            "date": doc["created_at"].isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
            "numeric_flags": doc.get("numeric_flags", []),
            "qualitative_summary": doc.get("qualitative_summary", []),
            "combination_flags": doc.get("combination_flags", []),
        }
    except Exception as e:
        logger.warning(f"Correlation: biomarker analysis lookup failed for {patient_id}: {e}")
        return None


async def _get_latest_imaging_comparison(patient_id: str, doctor_id: str) -> Optional[dict]:
    try:
        doc = await imaging_comparison_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        if not doc:
            return None
        return {
            "date": doc["created_at"].isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
            "comparisons": doc.get("comparisons", []),
        }
    except Exception as e:
        logger.warning(f"Correlation: imaging comparison lookup failed for {patient_id}: {e}")
        return None


async def _get_latest_disease_activity(patient_id: str, doctor_id: str) -> Optional[dict]:
    try:
        doc = await disease_activity_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        if not doc:
            return None
        return {
            "date": doc["created_at"].isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
            "scores": doc.get("scores", {}),
            "target": doc.get("target", ""),
        }
    except Exception as e:
        logger.warning(f"Correlation: disease activity lookup failed for {patient_id}: {e}")
        return None


async def _get_latest_treatment_response(patient_id: str, doctor_id: str) -> Optional[dict]:
    try:
        doc = await treatment_response_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        if not doc:
            return None
        return {
            "date": doc["created_at"].isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
            "classification": doc.get("classification"),
            "primary_signal": doc.get("primary_signal", {}),
        }
    except Exception as e:
        logger.warning(f"Correlation: treatment response lookup failed for {patient_id}: {e}")
        return None


async def _gather_sources(patient_id: str, doctor_id: str) -> dict:
    biomarkers = await _get_latest_biomarker_analysis(patient_id, doctor_id)
    imaging = await _get_latest_imaging_comparison(patient_id, doctor_id)
    disease_activity = await _get_latest_disease_activity(patient_id, doctor_id)
    treatment_response = await _get_latest_treatment_response(patient_id, doctor_id)
    return {
        "biomarkers": biomarkers, "imaging": imaging,
        "disease_activity": disease_activity, "treatment_response": treatment_response,
    }


# ═════════════════════════════════════════════════════════════════════════════
# 1. CONTEXT PREVIEW
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-correlation/context-preview/{patient_id}/{doctor_id}")
async def get_correlation_context_preview(patient_id: str, doctor_id: str):
    """Shows which of the 3 sources are available before the doctor runs /generate — see ASSUMPTION #2."""
    sources = await _gather_sources(patient_id, doctor_id)
    available = [k for k, v in sources.items() if v is not None]

    return {
        "status": "success",
        "data": {
            "sources_available": available,
            "sources_missing": [k for k in ("biomarkers", "imaging", "disease_activity", "treatment_response") if k not in available],
            "biomarkers_date": sources["biomarkers"]["date"] if sources["biomarkers"] else None,
            "imaging_date": sources["imaging"]["date"] if sources["imaging"] else None,
            "disease_activity_date": sources["disease_activity"]["date"] if sources["disease_activity"] else None,
            "treatment_response_date": sources["treatment_response"]["date"] if sources["treatment_response"] else None,
        },
        "can_generate": len(available) >= 2,
    }


# ═════════════════════════════════════════════════════════════════════════════
# 2. GENERATE
# ═════════════════════════════════════════════════════════════════════════════

CORRELATION_PROMPT = """
You are a clinical assistant. You will be given the most recent saved
data from up to four rheumatology modules for one patient:

  - "biomarkers": numeric lab flags (high/low/normal against reference
    range), qualitative marker results (Positive/Negative/Equivocal),
    and any already-decided combination flags with reasoning.
  - "imaging": per-region comparisons (worsening/improving/stable) with
    the specific structured findings that changed between studies.
  - "disease_activity": composite disease-activity scores (e.g. DAS28,
    CDAI, SDAI, or BASDAI/ASDAS/SLEDAI where applicable) with their
    category (e.g. Remission/Low/Moderate/High).
  - "treatment_response": an already-decided overall response
    classification (Improving/Stable/Inadequate response/Worsening/
    Possible flare) with the primary disease-activity signal behind it.

Some sources may be missing — only synthesize across the sources that
are actually present; never assume or invent a missing source's data.

Return a JSON object with exactly one key, "narrative": a short synthesis
(3-5 sentences) describing how the available findings relate to each
other — e.g. whether biomarker activity, imaging findings, disease-
activity scores, and the treatment response classification point in a
consistent direction, or diverge. Follow the style of: "Findings are
collectively consistent with an inflammatory arthritis pattern with
objective evidence of active inflammation and structural involvement" —
i.e. describe a PATTERN across sources, not just restate each source
separately.

Rules:
- Do NOT treat any single biomarker or imaging finding as definitive by
  itself — always frame the synthesis as a pattern requiring clinical
  correlation, per standard practice.
- Do NOT state or imply a specific diagnosis — describe a pattern only.
- Do NOT recommend a treatment, test, or next step — that decision
  belongs to the physician.
- Do NOT invent findings, values, or scores not present in the input.
- If only 2 of the 3 sources are present, do not mention the missing
  source as if it were checked or normal — simply synthesize what is
  available.
- Return valid JSON only — no markdown, no commentary, no extra keys.
"""


@router.post("/rheumatology-correlation/generate")
async def generate_correlation(payload: dict):
    """
    Expected payload: { "doctor_id": "...", "patient_id": "..." }

    Returns:
    {
        "status": "success",
        "finaloutput": {
            "sources_used": ["biomarkers", "imaging", "disease_activity"],
            "source_data": {...},   # the actual data handed to the LLM, for doctor review
            "narrative": str
        }
    }
    """
    if groq_client is None:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured on server")

    patient_id = payload.get("patient_id")
    doctor_id = payload.get("doctor_id")
    if not patient_id or not doctor_id:
        raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")

    sources = await _gather_sources(patient_id, doctor_id)
    available = {k: v for k, v in sources.items() if v is not None}

    if len(available) < 2:
        missing = [k for k in ("biomarkers", "imaging", "disease_activity", "treatment_response") if k not in available]
        raise HTTPException(
            status_code=400,
            detail=(
                "Not enough saved data to correlate — need at least 2 of "
                "(biomarker analysis, imaging comparison, disease activity "
                "score, treatment response evaluation) saved for this patient. "
                f"Missing: {', '.join(missing)}."
            ),
        )

    llm_input = {k: v for k, v in available.items()}

    try:
        completion = groq_client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[
                {"role": "system", "content": CORRELATION_PROMPT},
                {"role": "user", "content": json.dumps(llm_input, indent=2, default=str)},
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )
        raw_content = completion.choices[0].message.content
        try:
            parsed = json.loads(raw_content)
        except (json.JSONDecodeError, TypeError):
            logger.error(f"Correlation narrative returned non-JSON: {raw_content}")
            parsed = {}
        if not isinstance(parsed, dict):
            parsed = {}

        narrative = str(parsed.get("narrative", "")).strip()[:800]
        if not narrative:
            raise HTTPException(status_code=502, detail="Correlation model returned no narrative — try again")

        return {
            "status": "success",
            "finaloutput": {
                "sources_used": sorted(available.keys()),
                "source_data": available,
                "narrative": narrative,
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Correlation generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 3. SAVE
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-correlation/save")
async def save_correlation(payload: dict):
    """
    Expected payload (doctor-reviewed/edited version of /generate's output):
    {
        "patient_id": "...", "doctor_id": "...",
        "sources_used": ["biomarkers", "imaging"],
        "source_data": {...},
        "narrative": "doctor-reviewed narrative text"
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        sources_used = payload.get("sources_used") or []
        source_data = payload.get("source_data") or {}
        narrative = payload.get("narrative") or ""

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        narrative = str(narrative).strip()
        if not narrative:
            raise HTTPException(status_code=400, detail="narrative is required and cannot be empty")

        clean_sources_used = [s for s in sources_used if s in ("biomarkers", "imaging", "disease_activity")]
        if not clean_sources_used:
            raise HTTPException(status_code=400, detail="sources_used must include at least one of biomarkers/imaging/disease_activity")

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "sources_used": clean_sources_used,
            "source_data": source_data,
            "narrative": narrative[:800],
            "created_at": datetime.utcnow(),
            "type": "rheumatology_correlation",
        }
        result = await correlation_collection.insert_one(document)

        return {"status": "success", "message": "Correlation analysis saved", "id": str(result.inserted_id)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 4. HISTORY
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-correlation/history/{patient_id}/{doctor_id}")
async def get_correlation_history(patient_id: str, doctor_id: str):
    """Fetch all saved correlation analyses for a patient, most recent first."""
    try:
        cursor = correlation_collection.find(
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