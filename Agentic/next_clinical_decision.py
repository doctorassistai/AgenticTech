# next_clinical_decision.py
"""
Next Clinical Decision Backend — LLM-first, universal cancer support
--------------------------------------------------------------------
Builds the structured "Next Clinical Decision" payload consumed by
NextClinicalDecision.jsx from the same patient graph that clinical_agents.py
already extracts.

Design goals:
  * Works for ANY cancer type (solid or haematological) and ANY patient
    data shape.
  * No hardcoded keyword lists, no regex for clinical concepts, no
    cancer-specific assumption — the LLM does all clinical reading.
  * This module is a *decision-path router*, NOT a treatment recommender.
    Its job is to answer: "What is the next clinical decision, and where
    should it be made?" — e.g. tumour board, single-specialty clinic,
    MDT review, watchful waiting, etc.
  * Every entry that asserts a clinical fact must cite a `source` field;
    entries with unknown sources are dropped in post-processing.
  * The frontend schema is fixed; only the *values* are LLM-generated.
  * Temperature 0.0 (inherited from reasoning_llm) for reproducibility.

Python's only jobs:
  1. Fetch the patient graph (reuse PatientContextFetcher).
  2. Format the graph + the fixed container schema into a prompt.
  3. Call the LLM once, get JSON back.
  4. Validate the JSON against the expected schema (drop unsourced claims,
     normalise enums, guarantee required keys).
  5. Return it to the frontend.

Endpoint:
    GET /next-clinical-decision/{patient_id}?doctor_id=...
    GET /next-clinical-decision/{patient_id}?doctor_id=...&specialty=Surgical Oncology
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from loguru import logger
from fastapi import APIRouter, HTTPException, Query
from langchain_core.messages import HumanMessage, SystemMessage

# Reuse the same LLM + fetcher + graph extractor as clinical_agents.py
from Agentic.clinical_agents import (
    PatientContextFetcher,
    _extract_patient_graph,
    reasoning_llm,
)


# ============================================================
# ROUTER
# ============================================================

router = APIRouter(
    prefix="/next-clinical-decision",
    tags=["next-clinical-decision"],
)


# ============================================================
# CONSTANTS
# ============================================================

NOT_DOCUMENTED = "Not documented"

ALLOWED_SOURCES = {
    "conditions", "medications", "procedures",
    "lab_summary", "procedure_summary", "medication_summary",
    "vital_summary", "symptom_summary", "imaging_summary",
}

VALID_CONFIDENCE = {"low", "medium", "high"}

# The 6 field labels the frontend expects, in order.
DECISION_FIELD_LABELS = [
    "Case status",
    "Decision required",
    "Disciplines involved",
    "Complexity",
    "Missing information",
    "Suggested workflow",
]


# ============================================================
# SYSTEM PROMPT — the entire logic of Next Clinical Decision
# ============================================================

NEXT_DECISION_SYSTEM_PROMPT = """
You are a clinical documentation assistant. You receive a RAW PATIENT GRAPH
extracted from a hospital record — conditions, medications, procedures, and
several free-text summaries (labs, procedures, medications, vitals, symptoms,
imaging). The graph may describe ANY cancer type (breast, esophageal, lung,
colorectal, sarcoma, lymphoma, leukaemia, myeloma, ...) or ANY clinical
situation.

Your ONLY job is to populate a fixed JSON container that answers ONE question:
"What is the next clinical decision for this patient, and where should it be
made?"

You are a decision-path ROUTER, NOT a treatment recommender. You must NOT
recommend a specific drug, dose, or regimen. Instead you must:
  • Name the next decision that needs to be made.
  • List which specialties (if any) should be involved in making it.
  • Rate the complexity (single-specialty vs multidisciplinary vs tumour board).
  • List the key clinical questions that drive the decision.
  • Name the missing information that must be obtained first.
  • Suggest the workflow (e.g. tumour board, single-specialty clinic, watchful
    waiting, immediate action).

You are a faithful extractor and synthesiser. You must NEVER invent facts.
If the graph does not contain something, you must output "Not documented".

You must return EXACTLY this JSON shape (all keys required, no extras):

{
  "hero": {
    "eyebrow":   "<patient name + ' / Next clinical decision', or 'Next clinical decision'>",
    "headline":  "<one sentence naming the next decision and where it should be made>",
    "subtitle":  "<one sentence: decision-path routing, not a treatment recommendation>"
  },
  "fields": [
    {"label": "Case status",           "value": "<one short line, e.g. 'Baseline 3 of 9 items open'>"},
    {"label": "Decision required",     "value": "<one short line naming the decision>"},
    {"label": "Disciplines involved",  "value": "<comma-separated specialties, e.g. 'Medical, Surgical and Radiation Oncology, Radiology, Pathology'>"},
    {"label": "Complexity",            "value": "<one of: Single-specialty | Multidisciplinary | Tumour board | Emergent>"},
    {"label": "Missing information",   "value": "<comma-separated list of the specific items still needed>"},
    {"label": "Suggested workflow",    "value": "<one short line, e.g. 'Tumour board, Thursday 25 Sep 2026'>"}
  ],
  "points": [
    {
      "text":   "<one key decision point, phrased as a clinical question or issue>",
      "source": "<one of: conditions|medications|procedures|lab_summary|procedure_summary|medication_summary|vital_summary|symptom_summary|imaging_summary>"
    }
  ],
  "actions": [
    {
      "key":     "<snake_case identifier, e.g. 'prepare_for_tumour_board'>",
      "label":   "<human label, e.g. 'Prepare for tumour board'>",
      "variant": "primary | secondary",
      "reason":  "<one sentence: why this action is offered>"
    }
  ],
  "confidence": "low | medium | high"
}

RULES — read carefully:
  1. Use ONLY the supplied graph. Never use outside knowledge about the
     patient. Never guess a value that is not present.
  2. If a field is genuinely absent, output the literal string "Not documented".
  3. Every entry in `points` MUST cite a `source` from the allow-list.
  4. Do NOT recommend a specific treatment, drug, dose, or regimen. You are
     routing the decision, not making it.
  5. `fields` must always contain exactly the 6 labels listed, in order.
  6. `Complexity` must be one of: Single-specialty | Multidisciplinary |
     Tumour board | Emergent.
  7. `points` should contain 3–8 key decision points — the questions that
     the next decision actually turns on (e.g. biomarker status, staging,
     resectability, fertility, genetic counselling).
  8. `actions` should contain 1–3 concrete actions the doctor can take next,
     with exactly one `primary` variant (the recommended routing) and
     optionally one or two `secondary` variants. For a routine single-
     specialty decision, still emit at least one action.
  9. Output MUST be a single valid JSON object. No prose, no markdown, no
     code fences.

Worked behaviour (do not copy content, copy the discipline): if the graph
shows a newly diagnosed solid tumour with an equivocal biomarker, an
indeterminate imaging lesion, and no baseline cardiac assessment, and the
candidate regimens have different cardiotoxicities, then:
  • hero.headline names the next decision and the routing (e.g. "multidisciplinary
    decision — route to tumour board")
  • Complexity = "Tumour board"
  • Disciplines involved lists the relevant specialties
  • points lists the biomarker, staging, and baseline-assessment questions
  • Missing information lists the specific tests still needed
  • actions offers "Prepare for tumour board" as primary and "Plan directly
    instead" as secondary
  • Never recommend a specific drug or regimen.
"""


# ============================================================
# HELPERS — pure plumbing, no clinical logic
# ============================================================

def _format_graph_for_prompt(graph: Dict[str, Any]) -> str:
    """Serialize the raw graph into a stable, readable block for the LLM."""
    return (
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
    """LLMs sometimes wrap JSON in ```json ... ``` — strip it."""
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


# ============================================================
# POST-PROCESSING — enforce schema, drop unsourced claims
# ============================================================

def _normalize_hero(hero: Any, doctor_name: str) -> Dict[str, str]:
    if not isinstance(hero, dict):
        hero = {}
    eyebrow = _safe_str(hero.get("eyebrow"), "")
    if not eyebrow:
        eyebrow = (
            f"{doctor_name} / Next clinical decision"
            if doctor_name else "Next clinical decision"
        )
    return {
        "eyebrow": eyebrow,
        "headline": _safe_str(
            hero.get("headline"),
            "Next clinical decision to be confirmed.",
        ),
        "subtitle": _safe_str(
            hero.get("subtitle"),
            "Decision-path routing, not a treatment recommendation.",
        ),
    }


def _normalize_fields(items: Any) -> List[Dict[str, str]]:
    """Guarantee the 6 expected labels, in order."""
    by_label: Dict[str, str] = {}
    if isinstance(items, list):
        for it in items:
            if not isinstance(it, dict):
                continue
            label = _safe_str(it.get("label"), "")
            if label:
                by_label[label] = _safe_str(it.get("value"), NOT_DOCUMENTED)
    return [
        {"label": lbl, "value": by_label.get(lbl, NOT_DOCUMENTED)}
        for lbl in DECISION_FIELD_LABELS
    ]


def _normalize_points(items: Any) -> List[Dict[str, str]]:
    """Keep only points whose `source` is in the allow-list."""
    out: List[Dict[str, str]] = []
    if not isinstance(items, list):
        return out
    for it in items:
        if not isinstance(it, dict):
            continue
        src = (it.get("source") or "").strip().lower()
        if src not in ALLOWED_SOURCES:
            continue
        text = _safe_str(it.get("text"), "")
        if not text:
            continue
        out.append({"text": text, "source": src})
    return out


def _normalize_actions(items: Any) -> List[Dict[str, str]]:
    """
    Keep 1–3 actions with a valid variant. The first action whose variant is
    'primary' is kept as primary; all others are forced to 'secondary'. If
    no primary exists, the first action is promoted.
    """
    raw: List[Dict[str, str]] = []
    if isinstance(items, list):
        for it in items:
            if not isinstance(it, dict):
                continue
            label = _safe_str(it.get("label"), "")
            if not label:
                continue
            key = _safe_str(it.get("key"), "").lower().replace(" ", "_") or "action"
            variant = (it.get("variant") or "").strip().lower()
            if variant not in ("primary", "secondary"):
                variant = "secondary"
            raw.append({
                "key": key,
                "label": label,
                "variant": variant,
                "reason": _safe_str(it.get("reason"), ""),
            })
    if not raw:
        return []
    raw = raw[:3]  # at most 3 actions
    if not any(a["variant"] == "primary" for a in raw):
        raw[0]["variant"] = "primary"
    # Ensure only one primary
    seen_primary = False
    for a in raw:
        if a["variant"] == "primary":
            if seen_primary:
                a["variant"] = "secondary"
            else:
                seen_primary = True
    return raw


def _normalize_story(
    raw: Dict[str, Any],
    graph: Dict[str, Any],
    specialty: str,
) -> Dict[str, Any]:
    """Coerce the LLM's JSON into the exact frontend schema. Never raises."""
    doctor_name = _safe_str(graph.get("doctor_name"), "")

    hero = _normalize_hero(raw.get("hero"), doctor_name)
    fields = _normalize_fields(raw.get("fields"))
    points = _normalize_points(raw.get("points"))
    actions = _normalize_actions(raw.get("actions"))

    confidence = (
        raw.get("confidence")
        if raw.get("confidence") in VALID_CONFIDENCE
        else "medium"
    )

    return {
        "hero": hero,
        "fields": fields,
        "points": points,
        "actions": actions,
        "confidence": confidence,
    }


# ============================================================
# CORE — one LLM call builds the entire payload
# ============================================================

async def build_next_clinical_decision_llm(
    graph: Dict[str, Any],
    specialty: str = "Medical Oncology",
) -> Dict[str, Any]:
    """Call the LLM once with the full graph; return the normalized payload."""
    messages = [
        SystemMessage(content=NEXT_DECISION_SYSTEM_PROMPT),
        HumanMessage(content=(
            f"SPECIALTY REQUESTED BY CALLER: {specialty}\n\n"
            f"{_format_graph_for_prompt(graph)}\n\n"
            "Produce the JSON object now. Remember: no prose, no markdown, "
            "no code fences, only the JSON object described in the schema."
        )),
    ]

    try:
        resp = await reasoning_llm.ainvoke(messages)
        content = _strip_code_fences(resp.content)
        parsed = json.loads(content)
    except json.JSONDecodeError as e:
        logger.error(f"[next_clinical_decision] LLM returned non-JSON: {e}")
        return _empty_payload(graph, specialty, reason="LLM returned invalid JSON")
    except Exception as e:
        logger.error(f"[next_clinical_decision] LLM call failed: {e}")
        return _empty_payload(graph, specialty, reason=f"LLM call failed: {e}")

    return _normalize_story(parsed, graph, specialty)


def _empty_payload(
    graph: Dict[str, Any],
    specialty: str,
    reason: str,
) -> Dict[str, Any]:
    """A valid, honest, empty payload — used only if the LLM errors out."""
    doctor_name = _safe_str(graph.get("doctor_name"), "")
    nd = NOT_DOCUMENTED
    return {
        "hero": {
            "eyebrow": (
                f"{doctor_name} / Next clinical decision"
                if doctor_name else "Next clinical decision"
            ),
            "headline": "Next clinical decision unavailable.",
            "subtitle": reason,
        },
        "fields": [
            {"label": lbl, "value": nd} for lbl in DECISION_FIELD_LABELS
        ],
        "points": [],
        "actions": [],
        "confidence": "low",
    }


# ============================================================
# ENDPOINTS
# ============================================================

@router.get("/{patient_id}")
async def get_next_clinical_decision(
    patient_id: str,
    doctor_id: str = Query(..., description="Doctor ID for context fetch"),
    specialty: Optional[str] = Query(None, description="Specialty lens to apply"),
) -> Dict[str, Any]:
    """
    Build the full Next Clinical Decision payload for any patient / any
    cancer type.

    Entirely LLM-driven: Python fetches the graph, the LLM populates every
    section. Nothing is hardcoded per cancer type. This endpoint ROUTES the
    next decision — it does not recommend a specific treatment.
    """
    fetcher = PatientContextFetcher()
    try:
        raw = await fetcher.fetch(patient_id, doctor_id)
    except Exception as e:
        logger.error(f"[next_clinical_decision] fetch failed: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch patient context: {e}",
        )

    if not raw:
        raise HTTPException(status_code=404, detail="Patient context not found.")

    graph = raw if "conditions" in raw else _extract_patient_graph(raw)

    effective_specialty = (
        specialty
        or _safe_str(graph.get("doctor_specialty"), "")
        or "Medical Oncology"
    )

    payload = await build_next_clinical_decision_llm(
        graph, specialty=effective_specialty
    )

    return {
        "status": "success",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "doctor_specialty": effective_specialty,
        **payload,
    }


@router.get("/{patient_id}/raw")
async def get_next_clinical_decision_raw(
    patient_id: str,
    doctor_id: str = Query(...),
) -> Dict[str, Any]:
    """Debug endpoint — returns the raw extracted graph without LLM processing."""
    fetcher = PatientContextFetcher()
    raw = await fetcher.fetch(patient_id, doctor_id)
    if not raw:
        raise HTTPException(status_code=404, detail="Patient context not found.")
    return {"status": "success", "graph": raw}