# doctor_decision.py
"""
Doctor Decision Backend — MongoDB-backed, LLM-assisted
------------------------------------------------------
Builds the "Doctor Decision" card for a patient and persists the doctor's
decision as a `documentation-treatment-plan` feature via the existing
/save_documentation_features_bulk endpoint.

Reads:
  • Saved strategy from `strategy_collection` — top 5 rows.
  • Patient graph via PatientContextFetcher — live considerations row.
  • Baseline Verification payload — outstanding concerns row.
  • Dosing payload — interactions for the considerations row.

Writes:
  • `documentation-treatment-plan` via the bulk documentation save endpoint.
  • Audit record in `doctor_decisions` collection.

Endpoints (no prefix):
    POST /generate_doctor_decision
    POST /record_doctor_decision
    GET  /get_doctor_decision_log
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Query
from loguru import logger
from langchain_core.messages import HumanMessage, SystemMessage
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from pymongo import MongoClient

# Reuse the shared LLM + fetcher + graph extractor
from Agentic.clinical_agents import (
    PatientContextFetcher,
    _extract_patient_graph,
    reasoning_llm,
)


# ============================================================
# ENV + MONGO CLIENTS (same pattern as system.py)
# ============================================================

load_dotenv()

MONGO_URI    = os.getenv("MONGO_URI")
MONGO_DB     = "doctorassistai"
api_base_url = os.getenv("VITE_BACKEND_URL")

mongodb_client = AsyncIOMotorClient(MONGO_URI)   # async
database       = mongodb_client[MONGO_DB]

client = MongoClient(MONGO_URI)                  # sync
db     = client[MONGO_DB]


# ============================================================
# COLLECTIONS
# ============================================================

strategy_collection                     = database["strategy"]
doctor_decisions_collection             = database["doctor_decisions"]
documentation_treatment_plan_collection = database["documentation-treatment-plan"]

# Sync (for the appointment lookup that the bulk-save endpoint mirrors)
patient_appointments_collection         = db["patient_appointments"]


# ============================================================
# ROUTER — no prefix
# ============================================================

router = APIRouter(tags=["doctor-decision"])


# ============================================================
# CONSTANTS
# ============================================================

NOT_DOCUMENTED = "Not documented"

ALLOWED_SOURCES = {
    "conditions", "medications", "procedures",
    "lab_summary", "procedure_summary", "medication_summary",
    "vital_summary", "symptom_summary", "imaging_summary",
}

VALID_ACTIONS    = {"accept", "modify", "reject", "refer", "request"}
VALID_CONFIDENCE = {"low", "medium", "high"}


# ============================================================
# SYSTEM PROMPT — for the two live rows
# ============================================================

DOCTOR_DECISION_SYSTEM_PROMPT = """
You are a clinical documentation assistant. You receive:
  1. A RAW PATIENT GRAPH — conditions, medications, procedures, summaries.
  2. THE SAVED STRATEGY the doctor chose on the First-Line Plan screen —
     intent, role, regimen, evidence, prerequisites, constraints.

Your ONLY job is to populate a fixed JSON container for the Doctor Decision
card's two LIVE rows, grounded in the current graph and the saved strategy:

  • "Patient-specific considerations" — the patient's comorbidities,
    medications, and drug interactions that matter for the saved regimen.
    Example: "Diabetes and steroids; supplement unknown".
  • "Outstanding concerns" — the tests, biomarkers, or decisions still open
    before the plan can be finalised. Example: "HER2 ISH, LVEF, liver MRI,
    HBV serology".

You MUST return EXACTLY this JSON shape (all keys required, no extras):

{
  "patient_specific_considerations": "<one short sentence>",
  "outstanding_concerns":            "<comma-separated list>",
  "confidence": "low | medium | high"
}

RULES:
  1. Use ONLY the supplied graph and saved strategy. Never invent a value.
  2. If nothing relevant is found, return "Not documented" for that field.
  3. Keep each field under 200 characters.
  4. Do NOT diagnose, prognosticate, or recommend treatment.
  5. Output MUST be a single valid JSON object. No prose, no markdown, no
     code fences.
"""


# ============================================================
# SCHEMAS
# ============================================================

class GenerateDoctorDecisionRequest(BaseModel):
    patient_id: str           = Field(..., description="Patient ID")
    doctor_id:  str           = Field(..., description="Doctor ID")
    specialty:  Optional[str] = Field(None, description="Specialty lens")


class RecordDoctorDecisionRequest(BaseModel):
    patient_id:       str
    doctor_id:        str
    action:           str = Field(..., description="accept | modify | reject | refer | request")
    reason:           Optional[str] = None

    card:             List[Dict[str, str]] = Field(default_factory=list)
    live_card:        List[Dict[str, str]] = Field(default_factory=list)

    replacement_plan: Optional[str] = None

    strategy_id:      Optional[str] = None
    strategy_name:    Optional[str] = None
    intent:           Optional[str] = None


# ============================================================
# HELPERS
# ============================================================

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


def _strip_code_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = t.split("```", 2)[1]
        if t.startswith("json"):
            t = t[4:]
    return t.strip()


def _format_graph_for_prompt(graph: Dict[str, Any]) -> str:
    return (
        "=== CONDITIONS ===\n"
        f"{json.dumps(graph.get('conditions', []), indent=2, default=str)}\n\n"
        "=== MEDICATIONS ===\n"
        f"{json.dumps(graph.get('medications', []), indent=2, default=str)}\n\n"
        "=== PROCEDURES ===\n"
        f"{json.dumps(graph.get('procedures', []), indent=2, default=str)}\n\n"
        "=== LAB SUMMARY ===\n"
        f"{graph.get('lab_summary') or '(empty)'}\n\n"
        "=== PROCEDURE SUMMARY ===\n"
        f"{graph.get('procedure_summary') or '(empty)'}\n\n"
        "=== MEDICATION SUMMARY ===\n"
        f"{graph.get('medication_summary') or '(empty)'}\n\n"
        "=== SYMPTOM SUMMARY ===\n"
        f"{graph.get('symptom_summary') or '(empty)'}\n\n"
        "=== IMAGING SUMMARY ===\n"
        f"{graph.get('imaging_summary') or '(empty)'}\n"
    )


# ============================================================
# SAVED STRATEGY LOOKUP
# ============================================================

async def _fetch_saved_strategy(patient_id: str, doctor_id: str) -> Optional[Dict[str, Any]]:
    """Return the full active saved strategy record, or None."""
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
        logger.error(f"[doctor_decision] failed to read saved strategy: {e}")
        return None


# ============================================================
# LLM CALL — populates the two live rows
# ============================================================

async def _build_live_rows(
    graph: Dict[str, Any],
    saved: Optional[Dict[str, Any]],
) -> Dict[str, str]:
    saved_txt = "—"
    if saved:
        saved_txt = (
            f"strategy:       {saved.get('strategy') or '—'}\n"
            f"intent:         {saved.get('intent') or '—'}\n"
            f"role:           {saved.get('role') or '—'}\n"
            f"regimen:        {saved.get('regimen') or '—'}\n"
            f"prerequisites:  {saved.get('prerequisites') or '—'}\n"
            f"constraints:    {saved.get('constraints') or '—'}\n"
        )

    messages = [
        SystemMessage(content=DOCTOR_DECISION_SYSTEM_PROMPT),
        HumanMessage(content=(
            f"=== SAVED STRATEGY ===\n{saved_txt}\n\n"
            f"{_format_graph_for_prompt(graph)}\n\n"
            "Produce the JSON object now. No prose, no markdown, no code fences."
        )),
    ]

    try:
        resp = await reasoning_llm.ainvoke(messages)
        content = _strip_code_fences(resp.content)
        parsed = json.loads(content)
    except Exception as e:
        logger.error(f"[doctor_decision] LLM failed: {e}")
        return {
            "patient_specific_considerations": NOT_DOCUMENTED,
            "outstanding_concerns":            NOT_DOCUMENTED,
            "confidence":                      "low",
        }

    return {
        "patient_specific_considerations": _safe_str(
            parsed.get("patient_specific_considerations"), NOT_DOCUMENTED
        ),
        "outstanding_concerns": _safe_str(
            parsed.get("outstanding_concerns"), NOT_DOCUMENTED
        ),
        "confidence": (
            parsed.get("confidence")
            if parsed.get("confidence") in VALID_CONFIDENCE
            else "medium"
        ),
    }


# ============================================================
# CORE — build the full decision card
# ============================================================

async def _build_decision_card(
    patient_id: str,
    doctor_id: str,
    specialty: Optional[str],
) -> Dict[str, Any]:
    # 1) Saved strategy
    saved = await _fetch_saved_strategy(patient_id, doctor_id)

    # 2) Patient graph
    fetcher = PatientContextFetcher()
    try:
        raw = await fetcher.fetch(patient_id, doctor_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch patient context: {e}")
    if not raw:
        raise HTTPException(status_code=404, detail="Patient context not found.")
    graph = raw if "conditions" in raw else _extract_patient_graph(raw)

    # 3) Two live rows via LLM
    live = await _build_live_rows(graph, saved)

    # 4) Top card from saved strategy
    if saved:
        top_card = [
            {"label": "Treatment intent",    "value": saved.get("intent")   or NOT_DOCUMENTED},
            {"label": "Modality",            "value": saved.get("role")     or NOT_DOCUMENTED},
            {"label": "Sequence",            "value": saved.get("why")      or NOT_DOCUMENTED},
            {"label": "Regimen options",     "value": saved.get("regimen")  or NOT_DOCUMENTED},
            {"label": "Supporting evidence", "value": saved.get("evidence") or NOT_DOCUMENTED},
        ]
    else:
        top_card = [
            {"label": "Treatment intent",    "value": NOT_DOCUMENTED},
            {"label": "Modality",            "value": NOT_DOCUMENTED},
            {"label": "Sequence",            "value": NOT_DOCUMENTED},
            {"label": "Regimen options",     "value": NOT_DOCUMENTED},
            {"label": "Supporting evidence", "value": NOT_DOCUMENTED},
        ]

    live_card = [
        {"label": "Patient-specific considerations", "value": live["patient_specific_considerations"]},
        {"label": "Outstanding concerns",            "value": live["outstanding_concerns"]},
    ]

    return {
        "saved_strategy": saved,
        "top_card":       top_card,
        "live_card":      live_card,
        "confidence":     live["confidence"],
    }


# ============================================================
# PERSIST THE DECISION
# ============================================================

async def _save_decision_to_feature_bulk(
    finaloutput: Dict[str, Any],
    patient_id: str,
    doctor_id: str,
) -> Dict[str, Any]:
    """
    Post the decision to the existing bulk documentation save endpoint.
    Uses the same document shape the Doctor Dashboard already uses.
    """
    documents = [{
        "status":         "success",
        "feature_id":     "documentation-treatment-plan",
        "feature_name":   "Treatment Plan",
        "display_method": "text",
        "finaloutput":    finaloutput,
        "metadata": {
            "doctor_id":  doctor_id,
            "patient_id": patient_id,
            "saved_from": "doctor-decision",
        },
    }]

    url = f"{api_base_url}hms/users/data/context/save_documentation_features_bulk"
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.post(url, json={"documents": documents})
        ok = resp.status_code == 200
        body = resp.json() if ok else {"detail": resp.text}
    except Exception as e:
        logger.error(f"[doctor_decision] bulk save failed: {e}")
        return {"ok": False, "detail": str(e)}

    return {"ok": ok, "response": body}


# ============================================================
# ENDPOINTS
# ============================================================

@router.post("/generate_doctor_decision")
async def generate_doctor_decision(payload: GenerateDoctorDecisionRequest) -> Dict[str, Any]:
    """
    Build the Doctor Decision card.
    Reads the saved strategy + the graph, then populates the two live rows
    via the LLM.
    """
    card = await _build_decision_card(
        patient_id=payload.patient_id,
        doctor_id=payload.doctor_id,
        specialty=payload.specialty,
    )
    return {
        "status":       "success",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "patient_id":   payload.patient_id,
        "doctor_id":    payload.doctor_id,
        **card,
    }


@router.post("/record_doctor_decision")
async def record_doctor_decision(payload: RecordDoctorDecisionRequest) -> Dict[str, Any]:
    """
    Persist the doctor's decision.

    Behaviour:
      • Builds the finaloutput card from the submitted top card + live card.
      • Saves it as a `documentation-treatment-plan` feature via the existing
        bulk-save endpoint (same shape as the Doctor Dashboard handleSave).
      • Writes an audit record to `doctor_decisions` with a revision pattern.
    """
    if payload.action not in VALID_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown action: {payload.action}")

    if payload.action == "reject" and not (payload.replacement_plan or "").strip():
        raise HTTPException(status_code=400, detail="Replacement plan required for reject.")

    now = datetime.now(timezone.utc)

    # Merge the two card halves
    merged = list(payload.card) + list(payload.live_card)

    sections = [
        {"label": r.get("label", ""), "value": r.get("value", "")}
        for r in merged if r.get("label")
    ]
    fields = {r["label"]: r.get("value", "") for r in merged if r.get("label")}

    # If rejected, prepend the replacement plan
    if payload.action == "reject":
        replacement = (payload.replacement_plan or "").strip()
        sections.insert(0, {"label": "Replacement plan (doctor)", "value": replacement})
        fields["Replacement plan (doctor)"] = replacement

    finaloutput = {
        "sections":         sections,
        "fields":           fields,
        "decision":         payload.action,
        "reason":           payload.reason or "",
        "replacement_plan": (payload.replacement_plan or "").strip() or None,
        "strategy_id":      payload.strategy_id,
        "strategy_name":    payload.strategy_name,
        "intent":           payload.intent,
        "decided_by":       payload.doctor_id,
        "decided_at":       now.isoformat(),
    }

    # 1) Save as documentation feature via the existing bulk endpoint
    save_result = await _save_decision_to_feature_bulk(
        finaloutput, payload.patient_id, payload.doctor_id
    )

    # 2) Write the audit record
    existing = await doctor_decisions_collection.find_one(
        {"patient_id": payload.patient_id, "doctor_id": payload.doctor_id, "active": True},
        sort=[("revision", -1)],
    )
    next_revision = (int(existing["revision"]) + 1) if existing else 1
    if existing:
        await doctor_decisions_collection.update_one(
            {"_id": existing["_id"]},
            {"$set": {"active": False, "superseded_at": now}},
        )

    audit_doc = {
        "patient_id":       payload.patient_id,
        "doctor_id":        payload.doctor_id,
        "action":           payload.action,
        "reason":           payload.reason or "",
        "strategy_id":      payload.strategy_id,
        "strategy_name":    payload.strategy_name,
        "intent":           payload.intent,
        "card":             payload.card,
        "live_card":        payload.live_card,
        "replacement_plan": (payload.replacement_plan or "").strip() or None,
        "finaloutput":      finaloutput,
        "saved_to_feature": save_result.get("ok", False),
        "saved_at":         now,
        "active":           True,
        "revision":         next_revision,
        "superseded_at":    None,
    }
    ins = await doctor_decisions_collection.insert_one(audit_doc)
    audit_doc["_id"] = ins.inserted_id

    logger.info(
        f"[doctor_decision] recorded decision patient={payload.patient_id} "
        f"doctor={payload.doctor_id} action={payload.action} revision={next_revision}"
    )

    return {
        "status":           "success",
        "action":           payload.action,
        "revision":         next_revision,
        "saved_to_feature": save_result.get("ok", False),
        "feature_detail":   save_result.get("response"),
        "finaloutput":      finaloutput,
        "audit_id":         str(audit_doc["_id"]),
        "decided_at":       now.isoformat(),
    }


@router.get("/get_doctor_decision_log")
async def get_doctor_decision_log(
    patient_id: str = Query(..., description="Patient ID"),
    doctor_id:  str = Query(..., description="Doctor ID"),
    limit:      int = Query(50, ge=1, le=500),
) -> Dict[str, Any]:
    """Return the audit log of decisions for this patient + doctor, newest first."""
    try:
        cursor = (
            doctor_decisions_collection
                .find({"patient_id": patient_id, "doctor_id": doctor_id})
                .sort("revision", -1)
                .limit(limit)
        )
        items: List[Dict[str, Any]] = []
        async for d in cursor:
            items.append({
                "revision":         int(d.get("revision", 1)),
                "action":           d.get("action"),
                "reason":           d.get("reason"),
                "strategy_id":      d.get("strategy_id"),
                "strategy_name":    d.get("strategy_name"),
                "intent":           d.get("intent"),
                "replacement_plan": d.get("replacement_plan"),
                "saved_to_feature": bool(d.get("saved_to_feature")),
                "decided_at": (
                    d["saved_at"].isoformat()
                    if isinstance(d.get("saved_at"), datetime)
                    else str(d.get("saved_at") or "")
                ),
                "active":           bool(d.get("active", True)),
            })
    except Exception as e:
        logger.error(f"[doctor_decision] log fetch failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "status":     "success",
        "patient_id": patient_id,
        "doctor_id":  doctor_id,
        "count":      len(items),
        "items":      items,
    }