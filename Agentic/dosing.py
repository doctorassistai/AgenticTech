# dosing.py
"""
Dosing Backend — MongoDB-scoped, LLM-first, universal cancer support
--------------------------------------------------------------------
Builds the structured "Dosing" payload consumed by Dosing.jsx.

This module declares its own MongoDB clients and collections (same pattern
as system.py) — it does NOT import from a shared database module.

Reads:
  • The patient graph via PatientContextFetcher.
  • The SAVED STRATEGY from `strategy_collection` — including the regimen,
    evidence, role, why, prerequisites and constraints the doctor saw at
    save time — so the Dosing screen is scoped to exactly that strategy.

Returns:
  • inputs          — the five anthropometric/renal inputs the frontend needs
  • warnings        — prerequisite / dose-cap / safety warnings
  • regimens        — guideline-standard drug definitions, scoped to the strategy
  • cumulative      — drugs with a lifetime cap
  • interactions    — drug–drug / drug–condition interactions relevant to the plan

Endpoints (no prefix):
    POST /generate_dosing
    GET  /get_dosing?patient_id=...&doctor_id=...
    GET  /get_dosing_raw?patient_id=...&doctor_id=...
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Query
from loguru import logger
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import MongoClient

# Reuse the shared LLM + fetcher + graph extractor from the clinical agents module
from Agentic.clinical_agents import (
    PatientContextFetcher,
    _extract_patient_graph,
    reasoning_llm,
)


# ============================================================
# ENV + MONGO CLIENTS (same pattern as system.py)
# ============================================================

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB  = "doctorassistai"

mongodb_client = AsyncIOMotorClient(MONGO_URI)   # async (Motor)
database       = mongodb_client[MONGO_DB]

client = MongoClient(MONGO_URI)                  # sync (PyMongo)
db     = client[MONGO_DB]


# ============================================================
# COLLECTIONS
# ============================================================

# Async (Motor) collections
patient_vitals_collection             = database["patient_vitals"]
integration_credentials_collection    = database["integration_credentials"]
integrator_save_api_collection        = database["integrator_save_api"]
integration_postman_data_collection   = database["integration_postman_data"]
OPD_Doctor_timings_collection         = database["OPD_Doctor_timings"]
transcription_formats_collection      = database["transcription_formats"]
dictation_collection                  = database["dictation"]
strategy_collection                   = database["strategy"]

# Sync (PyMongo) collections
user_auth_collection                  = db["user_auth"]
hospital_user_collection              = db["hospital_users"]
doctor_user_collection                = db["doctor_users"]
patient_user_collection               = db["patient_users"]
insurance_providers_collection        = db["insurance_providers"]
patient_appointments_collection       = db["patient_appointments"]


# ============================================================
# ROUTER — no prefix
# ============================================================

router = APIRouter(tags=["dosing"])


# ============================================================
# CONSTANTS
# ============================================================

NOT_DOCUMENTED = "Not documented"

ALLOWED_SOURCES = {
    "conditions", "medications", "procedures",
    "lab_summary", "procedure_summary", "medication_summary",
    "vital_summary", "symptom_summary", "imaging_summary",
}

VALID_MARKERS    = {"ok", "rv", "ms", "cr", "in"}
VALID_BASES      = {"bsa", "auc", "kg", "flat"}
VALID_CONFIDENCE = {"low", "medium", "high"}


# ============================================================
# SYSTEM PROMPT
# ============================================================

DOSING_SYSTEM_PROMPT = """
You are a clinical documentation assistant. You receive:
  1. A RAW PATIENT GRAPH extracted from a hospital record — conditions,
     medications, procedures, and several free-text summaries (labs,
     procedures, medications, vitals, symptoms, imaging).
  2. THE SAVED STRATEGY the doctor already selected on the First-Line Plan
     screen. This includes the strategy id and name, the intent, the
     regimen options text, the supporting evidence, the role, why it was
     considered, its prerequisites, and its constraints. Treat all of these
     as the DEFINITIVE scope — do not invent a different strategy.

Your ONLY job is to populate a fixed JSON container that provides the INPUTS
for a live dose calculator. You must NOT do the final arithmetic — the
frontend recalculates every dose from the doctor-editable inputs.

You must provide:
  • The anthropometric and renal inputs the frontend needs:
      height (cm), weight (kg), creatinine (mg/dL), age (years), sex (M/F).
    If any value is not present in the graph, output null for that value.
    NEVER invent a value.
  • The candidate regimen definitions for THE SAVED STRATEGY ONLY. Do not
    show regimens that belong to a different strategy. If the saved strategy
    already carries a regimen text (e.g. "Mastectomy or breast conservation
    with axillary surgery, then systemic therapy by final pathology"), use
    it as the anchor and expand it into structured drug definitions. Each
    drug must include:
        - name
        - standard dose (e.g. "60 mg/m²", "AUC 6", "8 mg/kg", "840 mg flat")
        - dose basis: "bsa" | "auc" | "kg" | "flat"
        - the numeric multiplier the frontend will use for the basis:
            * "bsa"  → mg per m²  (e.g. 60 for 60 mg/m²)
            * "auc"  → target AUC  (e.g. 6)
            * "kg"   → mg per kg   (e.g. 8)
            * "flat" → total mg    (e.g. 840)
  • The cumulative-exposure rows for drugs with a lifetime limit.
  • The interaction / polypharmacy warnings relevant to the strategy and
    the patient's current medication list.
  • The prerequisite warnings: missing baseline tests that must be
    obtained before a candidate drug can be given.

You must return EXACTLY this JSON shape (all keys required, no extras):

{
  "hero": {
    "eyebrow":   "<patient name + ' / Dosing', or 'Dosing'>",
    "headline":  "<one sentence summarising inputs available and what is missing>",
    "subtitle":  "<one sentence: engine calculates and explains; you and the pharmacist prescribe>"
  },
  "inputs": {
    "height_cm":          <number | null>,
    "weight_kg":          <number | null>,
    "creatinine_mg_dl":   <number | null>,
    "age":                <number | null>,
    "sex":                "M | F | null",
    "source":             "<source field for these inputs>"
  },
  "warnings": [
    {
      "status": "ok | rv | ms | cr | in",
      "title":  "<short warning>",
      "sub":    "<optional one-line explanation>",
      "source": "<source field>"
    }
  ],
  "regimens": [
    {
      "name":  "<full regimen name, keyed to the strategy>",
      "note":  "<optional one-line note>",
      "drugs": [
        {"name": "...", "standard": "...", "basis": "bsa|auc|kg|flat", "multiplier": <number>}
      ]
    }
  ],
  "cumulative": [
    {"drug": "...", "now": "...", "note": "...", "source": "..."}
  ],
  "interactions": [
    {"status": "ok|rv|ms|cr|in", "title": "...", "detail": "...", "source": "..."}
  ],
  "confidence": "low | medium | high"
}

MARKER KEY:
  "ok" = verified / no issue.
  "rv" = needs clinician review.
  "ms" = missing but important.
  "cr" = critical.
  "in" = informational.

RULES:
  1. Use ONLY the supplied graph for patient-specific inputs. NEVER invent
     a height, weight, creatinine, age, or sex. If absent, output null.
  2. Every entry in warnings, cumulative, interactions MUST cite a `source`.
  3. `regimens` are guideline-standard definitions, NOT patient-specific
     doses. You may name specific drugs and their standard mg/m², AUC, kg,
     or flat doses, because these are standard reference values.
  4. Provide 1–4 candidate regimens that match THE SAVED STRATEGY. If the
     saved strategy's regimen text is explicitly surgical (e.g. "Mastectomy
     or breast conservation with axillary surgery, then systemic therapy by
     final pathology") and the graph contains no post-surgical pathology,
     return an EMPTY regimens array and a warning that explains the regimen
     cannot be dosed until the pathology is available.
  5. `warnings` should contain 1–5 items: missing prerequisites, dose-cap
     caveats, baseline-test gaps.
  6. `cumulative` should contain one row per candidate drug with a lifetime
     limit.
  7. `interactions` should reflect the patient's CURRENT medication list.
  8. Output MUST be a single valid JSON object. No prose, no markdown, no
     code fences.
"""


# ============================================================
# REQUEST SCHEMA
# ============================================================

class GenerateDosingRequest(BaseModel):
    patient_id: str = Field(..., description="Patient ID")
    doctor_id:  str = Field(..., description="Doctor ID")
    specialty:  Optional[str] = Field(None, description="Specialty lens to apply")


# ============================================================
# HELPERS
# ============================================================

def _format_graph_for_prompt(graph: Dict[str, Any], saved: Optional[Dict[str, Any]]) -> str:
    """
    Format the graph + the full saved strategy record for the LLM prompt.
    When `saved` is present, include every field the doctor saw at save time
    so the LLM anchors its output to that exact strategy.
    """
    header = ""
    if saved:
        header = (
            "=== SAVED STRATEGY (scope everything to this) ===\n"
            f"strategy_id:    {saved.get('strategy_id') or '—'}\n"
            f"strategy_name:  {saved.get('strategy_name') or saved.get('strategy') or '—'}\n"
            f"intent:         {saved.get('intent') or '—'}\n"
            f"role:           {saved.get('role') or '—'}\n"
            f"why:            {saved.get('why') or '—'}\n"
            f"regimen:        {saved.get('regimen') or '—'}\n"
            f"evidence:       {saved.get('evidence') or '—'}\n"
            f"prerequisites:  {saved.get('prerequisites') or '—'}\n"
            f"constraints:    {saved.get('constraints') or '—'}\n"
            f"saved_at:       {saved.get('saved_at') or '—'}\n"
            f"revision:       {saved.get('revision') or 1}\n\n"
        )
    return (
        f"{header}"
        "=== CONDITIONS (structured) ===\n"
        f"{json.dumps(graph.get('conditions', []), indent=2, default=str)}\n\n"
        "=== MEDICATIONS (structured) ===\n"
        f"{json.dumps(graph.get('medications', []), indent=2, default=str)}\n\n"
        "=== PROCEDURES (structured) ===\n"
        f"{json.dumps(graph.get('procedures', []), indent=2, default=str)}\n\n"
        "=== LAB SUMMARY ===\n"
        f"{graph.get('lab_summary') or '(empty)'}\n\n"
        "=== PROCEDURE SUMMARY ===\n"
        f"{graph.get('procedure_summary') or '(empty)'}\n\n"
        "=== MEDICATION SUMMARY ===\n"
        f"{graph.get('medication_summary') or '(empty)'}\n\n"
        "=== VITALS SUMMARY ===\n"
        f"{graph.get('vital_summary') or '(empty)'}\n\n"
        "=== SYMPTOM SUMMARY ===\n"
        f"{graph.get('symptom_summary') or '(empty)'}\n\n"
        "=== IMAGING SUMMARY ===\n"
        f"{graph.get('imaging_summary') or '(empty)'}\n"
    )


def _strip_code_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = t.split("```", 2)[1]
        if t.startswith("json"):
            t = t[4:]
    return t.strip()


def _safe_str(v: Any, fallback: str = NOT_DOCUMENTED) -> str:
    if v is None:
        return fallback
    if isinstance(v, str):
        return v.strip() or fallback
    if isinstance(v, (int, float, bool)):
        return str(v)
    if isinstance(v, (list, tuple)):
        return ", ".join(_safe_str(x, "") for x in v if x) or fallback
    if isinstance(v, dict):
        return json.dumps(v, default=str)
    return str(v)


def _safe_number(v: Any) -> Optional[float]:
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        try:
            f = float(v)
            return None if f != f else f   # NaN guard
        except (TypeError, ValueError):
            return None
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        import re as _re
        m = _re.search(r"-?\d+(?:\.\d+)?", s)
        if not m:
            return None
        try:
            return float(m.group(0))
        except ValueError:
            return None
    return None


# ============================================================
# POST-PROCESSING
# ============================================================

def _normalize_hero(hero: Any, doctor_name: str) -> Dict[str, str]:
    if not isinstance(hero, dict):
        hero = {}
    eyebrow = _safe_str(hero.get("eyebrow"), "")
    if not eyebrow:
        eyebrow = f"{doctor_name} / Dosing" if doctor_name else "Dosing"
    return {
        "eyebrow": eyebrow,
        "headline": _safe_str(
            hero.get("headline"),
            "Dosing inputs and regimen definitions — live calculation on the frontend.",
        ),
        "subtitle": _safe_str(
            hero.get("subtitle"),
            "The engine calculates and explains. You and the pharmacist prescribe.",
        ),
    }


def _normalize_inputs(raw_inputs: Any) -> Dict[str, Any]:
    if not isinstance(raw_inputs, dict):
        raw_inputs = {}
    out = {
        "height_cm":        _safe_number(raw_inputs.get("height_cm")),
        "weight_kg":        _safe_number(raw_inputs.get("weight_kg")),
        "creatinine_mg_dl": _safe_number(raw_inputs.get("creatinine_mg_dl")),
        "age":              _safe_number(raw_inputs.get("age")),
        "sex":              None,
        "source":           _safe_str(raw_inputs.get("source"), "vital_summary"),
    }
    sex = _safe_str(raw_inputs.get("sex"), "").strip().upper()
    if sex in ("M", "F"):
        out["sex"] = sex
    if out["source"] not in ALLOWED_SOURCES:
        out["source"] = "vital_summary"
    if out["age"] is not None:
        try:
            out["age"] = int(out["age"])
        except (TypeError, ValueError):
            out["age"] = None
    return out


def _normalize_warnings(items: Any) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    if not isinstance(items, list):
        return out
    for it in items:
        if not isinstance(it, dict):
            continue
        src = (it.get("source") or "").strip().lower()
        if src not in ALLOWED_SOURCES:
            continue
        title = _safe_str(it.get("title"), "")
        if not title:
            continue
        status = (it.get("status") or "rv").strip().lower()
        if status not in VALID_MARKERS:
            status = "rv"
        out.append({
            "status": status,
            "title":  title,
            "sub":    _safe_str(it.get("sub"), ""),
            "source": src,
        })
    return out


def _normalize_regimens(items: Any) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    if not isinstance(items, list):
        return out
    for it in items:
        if not isinstance(it, dict):
            continue
        name = _safe_str(it.get("name"), "")
        if not name:
            continue
        raw_drugs = it.get("drugs") or []
        drugs: List[Dict[str, Any]] = []
        if isinstance(raw_drugs, list):
            for d in raw_drugs:
                if not isinstance(d, dict):
                    continue
                dname = _safe_str(d.get("name"), "")
                if not dname:
                    continue
                basis = (d.get("basis") or "").strip().lower()
                if basis not in VALID_BASES:
                    continue
                mult = _safe_number(d.get("multiplier"))
                if mult is None:
                    continue
                drugs.append({
                    "name":       dname,
                    "standard":   _safe_str(d.get("standard"), ""),
                    "basis":      basis,
                    "multiplier": mult,
                })
        if not drugs:
            continue
        out.append({
            "name":  name,
            "note":  _safe_str(it.get("note"), ""),
            "drugs": drugs,
        })
    return out[:6]


def _normalize_cumulative(items: Any) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    if not isinstance(items, list):
        return out
    for it in items:
        if not isinstance(it, dict):
            continue
        src = (it.get("source") or "").strip().lower()
        if src not in ALLOWED_SOURCES:
            continue
        drug = _safe_str(it.get("drug"), "")
        if not drug:
            continue
        out.append({
            "drug":   drug,
            "now":    _safe_str(it.get("now"), "0"),
            "note":   _safe_str(it.get("note"), ""),
            "source": src,
        })
    return out


def _normalize_interactions(items: Any) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    if not isinstance(items, list):
        return out
    for it in items:
        if not isinstance(it, dict):
            continue
        src = (it.get("source") or "").strip().lower()
        if src not in ALLOWED_SOURCES:
            continue
        title = _safe_str(it.get("title"), "")
        if not title:
            continue
        status = (it.get("status") or "rv").strip().lower()
        if status not in VALID_MARKERS:
            status = "rv"
        out.append({
            "status": status,
            "title":  title,
            "detail": _safe_str(it.get("detail"), ""),
            "source": src,
        })
    return out


def _normalize_story(raw: Dict[str, Any], graph: Dict[str, Any], specialty: str) -> Dict[str, Any]:
    doctor_name = _safe_str(graph.get("doctor_name"), "")
    return {
        "hero":         _normalize_hero(raw.get("hero"), doctor_name),
        "inputs":       _normalize_inputs(raw.get("inputs")),
        "warnings":     _normalize_warnings(raw.get("warnings")),
        "regimens":     _normalize_regimens(raw.get("regimens")),
        "cumulative":   _normalize_cumulative(raw.get("cumulative")),
        "interactions": _normalize_interactions(raw.get("interactions")),
        "confidence":   raw.get("confidence") if raw.get("confidence") in VALID_CONFIDENCE else "medium",
    }


def _empty_payload(graph: Dict[str, Any], reason: str, strategy: Optional[str]) -> Dict[str, Any]:
    doctor_name = _safe_str(graph.get("doctor_name"), "")
    return {
        "hero": {
            "eyebrow":  f"{doctor_name} / Dosing" if doctor_name else "Dosing",
            "headline": "Dosing inputs unavailable.",
            "subtitle": reason,
        },
        "inputs": {
            "height_cm":        None,
            "weight_kg":        None,
            "creatinine_mg_dl": None,
            "age":              None,
            "sex":              None,
            "source":           "vital_summary",
        },
        "warnings": [],
        "regimens": [],
        "cumulative": [],
        "interactions": [],
        "confidence": "low",
        "strategy": strategy,
    }


# ============================================================
# SAVED STRATEGY LOOKUP — now returns the FULL record
# ============================================================

async def _fetch_saved_strategy_record(
    patient_id: str,
    doctor_id: str,
) -> Optional[Dict[str, Any]]:
    """
    Return the full currently-active saved strategy record for this
    patient+doctor, or None if none was saved.

    The record includes regimen, evidence, role, why, prerequisites,
    constraints — everything the doctor saw at save time.
    """
    try:
        doc = await strategy_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id, "active": True},
            sort=[("revision", -1)],
        )
        if not doc:
            return None

        def _clean(v):
            if isinstance(v, datetime):
                return v.isoformat()
            return v

        return {
            "strategy":      _clean(doc.get("strategy")),
            "strategy_id":   _clean(doc.get("strategy_id")),
            "strategy_name": _clean(doc.get("strategy_name")),
            "intent":        _clean(doc.get("intent")),
            "role":          _clean(doc.get("role")),
            "why":           _clean(doc.get("why")),
            "regimen":       _clean(doc.get("regimen")),
            "evidence":      _clean(doc.get("evidence")),
            "prerequisites": _clean(doc.get("prerequisites")),
            "constraints":   _clean(doc.get("constraints")),
            "saved_at":      _clean(doc.get("saved_at")),
            "revision":      int(doc.get("revision", 1)),
        }
    except Exception as e:
        logger.error(f"[dosing] failed to read saved strategy: {e}")
        return None


def _saved_strategy_label(saved: Optional[Dict[str, Any]]) -> Optional[str]:
    """Human-readable label of the saved strategy for the response payload."""
    if not saved:
        return None
    label = saved.get("strategy") or ""
    if not label and saved.get("strategy_id") and saved.get("strategy_name"):
        label = f"{saved['strategy_id']} — {saved['strategy_name']}"
    return label or None


# ============================================================
# CORE
# ============================================================

async def build_dosing_llm(
    graph: Dict[str, Any],
    specialty: str = "Medical Oncology",
    saved: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    label = _saved_strategy_label(saved)
    messages = [
        SystemMessage(content=DOSING_SYSTEM_PROMPT),
        HumanMessage(content=(
            f"SPECIALTY REQUESTED BY CALLER: {specialty}\n"
            + (f"SAVED STRATEGY: {label}\n" if label else
               "SAVED STRATEGY: (none — show only what the graph supports)\n")
            + "\n"
            + _format_graph_for_prompt(graph, saved)
            + "\nProduce the JSON object now. No prose, no markdown, no code fences."
        )),
    ]

    try:
        resp = await reasoning_llm.ainvoke(messages)
        content = _strip_code_fences(resp.content)
        parsed = json.loads(content)
    except json.JSONDecodeError as e:
        logger.error(f"[dosing] LLM returned non-JSON: {e}")
        return _empty_payload(graph, "LLM returned invalid JSON.", label)
    except Exception as e:
        logger.error(f"[dosing] LLM call failed: {e}")
        return _empty_payload(graph, f"LLM call failed: {e}", label)

    normalized = _normalize_story(parsed, graph, specialty)
    normalized["strategy"] = label
    # Also surface the saved strategy details back to the frontend
    if saved:
        normalized["saved_strategy_detail"] = {
            "strategy_id":   saved.get("strategy_id"),
            "strategy_name": saved.get("strategy_name"),
            "intent":        saved.get("intent"),
            "role":          saved.get("role"),
            "why":           saved.get("why"),
            "regimen":       saved.get("regimen"),
            "evidence":      saved.get("evidence"),
            "prerequisites": saved.get("prerequisites"),
            "constraints":   saved.get("constraints"),
            "saved_at":      saved.get("saved_at"),
            "revision":      saved.get("revision"),
        }
    return normalized


# ============================================================
# SHARED FETCH + BUILD
# ============================================================

async def _load_and_build(
    patient_id: str,
    doctor_id: str,
    specialty: Optional[str],
) -> Dict[str, Any]:
    # 1) Saved strategy (full record)
    saved = await _fetch_saved_strategy_record(patient_id, doctor_id)
    saved_label = _saved_strategy_label(saved)

    # 2) Patient graph
    fetcher = PatientContextFetcher()
    try:
        raw = await fetcher.fetch(patient_id, doctor_id)
    except Exception as e:
        logger.error(f"[dosing] fetch failed: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to fetch patient context: {e}")
    if not raw:
        raise HTTPException(status_code=404, detail="Patient context not found.")

    graph = raw if "conditions" in raw else _extract_patient_graph(raw)

    effective_specialty = (
        specialty
        or _safe_str(graph.get("doctor_specialty"), "")
        or "Medical Oncology"
    )

    # 3) Build payload scoped to the saved strategy (full record passed in)
    payload = await build_dosing_llm(
        graph,
        specialty=effective_specialty,
        saved=saved,
    )

    return {
        "status":           "success",
        "generated_at":     datetime.now(timezone.utc).isoformat(),
        "patient_id":       patient_id,
        "doctor_id":        doctor_id,
        "doctor_specialty": effective_specialty,
        "saved_strategy":   saved_label,
        **payload,
    }


# ============================================================
# ENDPOINTS
# ============================================================

@router.post("/generate_dosing")
async def generate_dosing(payload: GenerateDosingRequest) -> Dict[str, Any]:
    """
    Build the Dosing payload scoped to the currently saved strategy.

    The strategy is read from the `strategy` collection — the doctor does
    not need to pass it in the request body.
    """
    return await _load_and_build(
        patient_id=payload.patient_id,
        doctor_id=payload.doctor_id,
        specialty=payload.specialty,
    )


@router.get("/get_dosing")
async def get_dosing(
    patient_id: str = Query(..., description="Patient ID"),
    doctor_id:  str = Query(..., description="Doctor ID"),
    specialty:  Optional[str] = Query(None, description="Optional specialty lens"),
) -> Dict[str, Any]:
    """
    Same as /generate_dosing, but callable via GET for debugging.
    """
    return await _load_and_build(
        patient_id=patient_id,
        doctor_id=doctor_id,
        specialty=specialty,
    )


@router.get("/get_dosing_raw")
async def get_dosing_raw(
    patient_id: str = Query(...),
    doctor_id:  str = Query(...),
) -> Dict[str, Any]:
    """
    Debug endpoint — returns the raw graph and the full saved strategy,
    without calling the LLM.
    """
    saved = await _fetch_saved_strategy_record(patient_id, doctor_id)
    fetcher = PatientContextFetcher()
    raw = await fetcher.fetch(patient_id, doctor_id)
    if not raw:
        raise HTTPException(status_code=404, detail="Patient context not found.")
    graph = raw if "conditions" in raw else _extract_patient_graph(raw)
    return {
        "status":         "success",
        "saved_strategy": saved,
        "graph":          graph,
    }