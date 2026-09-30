# treatment_readiness.py
"""
Treatment Readiness Backend — LLM-first, universal cancer support
-----------------------------------------------------------------
Builds the structured "Treatment Readiness" payload consumed by
TreatmentReadiness.jsx from the same patient graph that clinical_agents.py
already extracts.

Design goals:
  * Works for ANY cancer type (solid or haematological) and ANY patient
    data shape.
  * No hardcoded keyword lists, no regex for clinical concepts, no
    cancer-specific assumption — the LLM does all clinical reading.
  * This module presents VERIFICATION FLAGS for the clinician, NOT an
    eligibility decision. It answers: "Before the selected strategy can
    start, what still needs to be verified, what is unresolved, and what
    is already confirmed?" — split across disease, patient, and treatment-
    specific readiness.
  * Every entry must cite a `source` field; entries with unknown sources
    are dropped in post-processing.
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
    GET /treatment-readiness/{patient_id}?doctor_id=...
    GET /treatment-readiness/{patient_id}?doctor_id=...&specialty=Medical Oncology&strategy=A
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from loguru import logger
from fastapi import APIRouter, HTTPException, Query
from langchain_core.messages import HumanMessage, SystemMessage

from Agentic.clinical_agents import (
    PatientContextFetcher,
    _extract_patient_graph,
    reasoning_llm,
)


# ============================================================
# ROUTER
# ============================================================

router = APIRouter(prefix="/treatment-readiness", tags=["treatment-readiness"])


# ============================================================
# CONSTANTS
# ============================================================

NOT_DOCUMENTED = "Not documented"

ALLOWED_SOURCES = {
    "conditions", "medications", "procedures",
    "lab_summary", "procedure_summary", "medication_summary",
    "vital_summary", "symptom_summary", "imaging_summary",
}

VALID_MARKERS = {"ok", "rv", "cr", "in"}
VALID_CONFIDENCE = {"low", "medium", "high"}


# ============================================================
# SYSTEM PROMPT — the entire logic of Treatment Readiness
# ============================================================

TREATMENT_READINESS_SYSTEM_PROMPT = """
You are a clinical documentation assistant. You receive a RAW PATIENT GRAPH
extracted from a hospital record — conditions, medications, procedures, and
several free-text summaries (labs, procedures, medications, vitals, symptoms,
imaging). The graph may describe ANY cancer type (breast, esophageal, lung,
colorectal, sarcoma, lymphoma, leukaemia, myeloma, ...) or ANY clinical
situation.

Your ONLY job is to populate a fixed JSON container that answers ONE question:
"Before the selected first-line strategy can start, what is verified, what
needs clinician review, and what is critically unresolved?"

You present VERIFICATION FLAGS for the clinician — NOT an eligibility
decision. You must:
  • Split findings into DISEASE readiness, PATIENT readiness, and TREATMENT-
    SPECIFIC readiness.
  • Use the marker key below to signal each item's state.
  • Ground every patient-specific fact in the graph.
  • Never invent a biomarker, a stage, a lab value, or a date.
  • If the graph does not contain something, output "Not documented" — but
    only for items that are genuinely relevant to the strategy being
    prepared. Do not invent checklist items that have no basis in the graph.

You must return EXACTLY this JSON shape (all keys required, no extras):

{
  "hero": {
    "eyebrow":   "<patient name + ' / Treatment readiness', or 'Treatment readiness'>",
    "headline":  "<one sentence summarising how many critical / review items remain before the strategy can start>",
    "subtitle":  "<one sentence: verification flags for the clinician, not an eligibility decision>"
  },
  "counters": {
    "verified":         <int>,
    "needs_review":     <int>,
    "critical_open":    <int>
  },
  "disease_readiness": [
    {
      "status": "ok | rv | cr | in",
      "text":   "<one short disease-specific readiness item>",
      "source": "<one of: conditions|medications|procedures|lab_summary|procedure_summary|medication_summary|vital_summary|symptom_summary|imaging_summary>"
    }
  ],
  "patient_readiness": [
    {
      "status": "ok | rv | cr | in",
      "text":   "<one short patient-specific readiness item>",
      "source": "<source field>"
    }
  ],
  "treatment_readiness": [
    {
      "status": "ok | rv | cr | in",
      "text":   "<one short treatment-specific readiness item>",
      "source": "<source field>"
    }
  ],
  "actions": [
    {
      "key":     "<snake_case identifier>",
      "label":   "<human label>",
      "variant": "primary | secondary",
      "reason":  "<one sentence: why this action is offered>"
    }
  ],
  "confidence": "low | medium | high"
}

MARKER KEY (use the correct one — do not guess):
  "ok" = verified / present / current / within range.
  "rv" = needs clinician review — equivocal, pending, indeterminate,
         awaiting a result, or a decision not yet made.
  "cr" = critical — the strategy cannot safely start without resolving this.
  "in" = neutral informational state.

RULES — read carefully:
  1. Use ONLY the supplied graph for patient-specific facts. Never invent a
     biomarker, a stage, a lab value, or a date.
  2. Every entry in disease_readiness, patient_readiness, and
     treatment_readiness MUST cite a `source` from the allow-list. If you
     cannot cite a source, do not emit the entry.
  3. `counters` must reflect the actual counts in the three lists:
        verified       = number of "ok" items across the three lists
        needs_review   = number of "rv" items across the three lists
        critical_open  = number of "cr" items across the three lists
  4. `disease_readiness` should cover the disease-specific prerequisites for
     starting the strategy: histopathology availability, staging completeness,
     biomarker status, resectability (if surgery is planned), imaging
     adequacy, etc.
  5. `patient_readiness` should cover the patient-specific prerequisites:
     performance status, haematology, renal, hepatic, electrolytes, cardiac
     baseline, serology, glycaemic control, weight trend, etc.
  6. `treatment_readiness` should cover the treatment-specific prerequisites
     for the strategy: prior exposure, drug interactions, allergies relevant
     to candidate regimens, venous access, schedule feasibility, growth-
     factor support, pharmacogenomics, etc.
  7. `actions` should contain 1–3 concrete actions. The primary action is
     typically "Go to decision" (proceed to the decision step), the
     secondary is "Request the missing items". Emit them in that order.
  8. Keep each `text` short (under 90 characters). One idea per item.
  9. Output MUST be a single valid JSON object. No prose, no markdown, no
     code fences.

Worked behaviour (do not copy content, copy the discipline): if the graph
shows a newly diagnosed solid tumour with an equivocal biomarker, an
indeterminate imaging lesion, no baseline LVEF, no hepatitis serology, an
HbA1c dated 36 days ago, and an unnamed supplement, then:
  • disease_readiness includes: histopathology available (ok), biomarker
    pending (cr), indeterminate liver lesion (rv)
  • patient_readiness includes: ECOG documented (ok), CBC within range (ok),
    renal function calculated (ok), hepatic function normal (ok),
    electrolytes normal (ok), LVEF not documented (cr), hepatitis B serology
    not documented (rv), HbA1c 36 days old and steroid premedication planned
    (rv), weight change −3% (ok)
  • treatment_readiness includes: no prior anthracycline or radiation (ok),
    unnamed supplement preventing interaction check (rv), sulfonamide
    allergy not relevant to candidate regimens (ok), venous access plan not
    documented (rv), dose-dense schedule requires growth-factor support (rv),
    pharmacogenomics not required (in)
  • counters reflect the actual counts
  • actions = ["Go to decision" (primary), "Request the missing items" (secondary)]
  • You never decide eligibility — you only flag for the clinician.
"""


# ============================================================
# HELPERS
# ============================================================

def _format_graph_for_prompt(graph: Dict[str, Any], strategy: Optional[str]) -> str:
    header = ""
    if strategy:
        header = f"TARGET FIRST-LINE STRATEGY: {strategy}\n\n"
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


def _safe_int(v: Any, fallback: int = 0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return fallback


# ============================================================
# POST-PROCESSING
# ============================================================

def _normalize_hero(hero: Any, doctor_name: str, counters: Dict[str, int]) -> Dict[str, str]:
    if not isinstance(hero, dict):
        hero = {}
    eyebrow = _safe_str(hero.get("eyebrow"), "")
    if not eyebrow:
        eyebrow = (
            f"{doctor_name} / Treatment readiness"
            if doctor_name else "Treatment readiness"
        )
    default_headline = (
        f"{counters['critical_open']} critical and "
        f"{counters['needs_review']} review items before the strategy can start."
    )
    return {
        "eyebrow": eyebrow,
        "headline": _safe_str(hero.get("headline"), default_headline),
        "subtitle": _safe_str(
            hero.get("subtitle"),
            "Verification flags for the clinician, not an eligibility decision.",
        ),
    }


def _normalize_readiness_list(items: Any) -> List[Dict[str, str]]:
    """Keep only entries whose `source` is valid and whose marker is valid."""
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
        status = (it.get("status") or "in").strip().lower()
        if status not in VALID_MARKERS:
            status = "in"
        out.append({"status": status, "text": text, "source": src})
    return out


def _normalize_actions(items: Any) -> List[Dict[str, str]]:
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
        # Fallback to the two default actions the frontend originally had.
        raw = [
            {
                "key": "go_to_decision",
                "label": "Go to decision",
                "variant": "primary",
                "reason": "Proceed to the decision step once verified.",
            },
            {
                "key": "request_missing_items",
                "label": "Request the missing items",
                "variant": "secondary",
                "reason": "Order or document the items flagged above.",
            },
        ]
    raw = raw[:3]
    if not any(a["variant"] == "primary" for a in raw):
        raw[0]["variant"] = "primary"
    seen_primary = False
    for a in raw:
        if a["variant"] == "primary":
            if seen_primary:
                a["variant"] = "secondary"
            else:
                seen_primary = True
    return raw


def _count_markers(*lists: List[Dict[str, str]]) -> Dict[str, int]:
    ok = rv = cr = 0
    for lst in lists:
        for it in lst:
            s = it.get("status")
            if s == "ok":
                ok += 1
            elif s == "rv":
                rv += 1
            elif s == "cr":
                cr += 1
    return {"verified": ok, "needs_review": rv, "critical_open": cr}


def _normalize_story(raw: Dict[str, Any], graph: Dict[str, Any], specialty: str) -> Dict[str, Any]:
    doctor_name = _safe_str(graph.get("doctor_name"), "")

    disease = _normalize_readiness_list(raw.get("disease_readiness"))
    patient = _normalize_readiness_list(raw.get("patient_readiness"))
    treatment = _normalize_readiness_list(raw.get("treatment_readiness"))

    # Recompute counters from the normalized lists — never trust the LLM's
    # counts blindly.
    counters = _count_markers(disease, patient, treatment)

    hero = _normalize_hero(raw.get("hero"), doctor_name, counters)
    actions = _normalize_actions(raw.get("actions"))

    confidence = (
        raw.get("confidence")
        if raw.get("confidence") in VALID_CONFIDENCE
        else "medium"
    )

    return {
        "hero": hero,
        "counters": counters,
        "disease_readiness": disease,
        "patient_readiness": patient,
        "treatment_readiness": treatment,
        "actions": actions,
        "confidence": confidence,
    }


# ============================================================
# CORE
# ============================================================

async def build_treatment_readiness_llm(
    graph: Dict[str, Any],
    specialty: str = "Medical Oncology",
    strategy: Optional[str] = None,
) -> Dict[str, Any]:
    messages = [
        SystemMessage(content=TREATMENT_READINESS_SYSTEM_PROMPT),
        HumanMessage(content=(
            f"SPECIALTY REQUESTED BY CALLER: {specialty}\n"
            + (f"STRATEGY CONTEXT: {strategy}\n" if strategy else "")
            + "\n"
            + _format_graph_for_prompt(graph, strategy)
            + "\n"
            "Produce the JSON object now. Remember: no prose, no markdown, "
            "no code fences, only the JSON object described in the schema."
        )),
    ]

    try:
        resp = await reasoning_llm.ainvoke(messages)
        content = _strip_code_fences(resp.content)
        parsed = json.loads(content)
    except json.JSONDecodeError as e:
        logger.error(f"[treatment_readiness] LLM returned non-JSON: {e}")
        return _empty_payload(graph, specialty, reason="LLM returned invalid JSON")
    except Exception as e:
        logger.error(f"[treatment_readiness] LLM call failed: {e}")
        return _empty_payload(graph, specialty, reason=f"LLM call failed: {e}")

    return _normalize_story(parsed, graph, specialty)


def _empty_payload(graph: Dict[str, Any], specialty: str, reason: str) -> Dict[str, Any]:
    doctor_name = _safe_str(graph.get("doctor_name"), "")
    return {
        "hero": {
            "eyebrow": (
                f"{doctor_name} / Treatment readiness"
                if doctor_name else "Treatment readiness"
            ),
            "headline": "Treatment readiness unavailable.",
            "subtitle": reason,
        },
        "counters": {"verified": 0, "needs_review": 0, "critical_open": 0},
        "disease_readiness": [],
        "patient_readiness": [],
        "treatment_readiness": [],
        "actions": [
            {
                "key": "go_to_decision",
                "label": "Go to decision",
                "variant": "primary",
                "reason": "Proceed to the decision step once verified.",
            },
            {
                "key": "request_missing_items",
                "label": "Request the missing items",
                "variant": "secondary",
                "reason": "Order or document the items flagged above.",
            },
        ],
        "confidence": "low",
    }


# ============================================================
# ENDPOINTS
# ============================================================

@router.get("/{patient_id}")
async def get_treatment_readiness(
    patient_id: str,
    doctor_id: str = Query(..., description="Doctor ID for context fetch"),
    specialty: Optional[str] = Query(None, description="Specialty lens to apply"),
    strategy: Optional[str] = Query(
        None,
        description="Optional strategy label (e.g. 'A' or 'A — Neoadjuvant ...') to scope readiness to.",
    ),
) -> Dict[str, Any]:
    """
    Build the full Treatment Readiness payload for any patient / any cancer
    type. Entirely LLM-driven.

    This endpoint presents verification FLAGS for the clinician — it does not
    make an eligibility decision.
    """
    fetcher = PatientContextFetcher()
    try:
        raw = await fetcher.fetch(patient_id, doctor_id)
    except Exception as e:
        logger.error(f"[treatment_readiness] fetch failed: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to fetch patient context: {e}")

    if not raw:
        raise HTTPException(status_code=404, detail="Patient context not found.")

    graph = raw if "conditions" in raw else _extract_patient_graph(raw)

    effective_specialty = (
        specialty
        or _safe_str(graph.get("doctor_specialty"), "")
        or "Medical Oncology"
    )

    payload = await build_treatment_readiness_llm(
        graph,
        specialty=effective_specialty,
        strategy=strategy,
    )

    return {
        "status": "success",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "doctor_specialty": effective_specialty,
        "strategy": strategy,
        **payload,
    }


@router.get("/{patient_id}/raw")
async def get_treatment_readiness_raw(
    patient_id: str,
    doctor_id: str = Query(...),
) -> Dict[str, Any]:
    """Debug endpoint — returns the raw extracted graph without LLM processing."""
    fetcher = PatientContextFetcher()
    raw = await fetcher.fetch(patient_id, doctor_id)
    if not raw:
        raise HTTPException(status_code=404, detail="Patient context not found.")
    return {"status": "success", "graph": raw}