# patient_story.py
"""
Patient Story Backend — LLM-first, universal cancer support
------------------------------------------------------------
Every clinical section of the Patient Story is populated by the LLM from
the raw patient graph. There is NO hardcoded keyword list, NO regex for
clinical concepts, NO cancer-specific assumption.

Python's only jobs:
  1. Fetch the patient graph (reuse PatientContextFetcher).
  2. Format the graph + the deterministic container schema into a prompt.
  3. Call the LLM once, get JSON back.
  4. Validate the JSON against the expected schema.
  5. Return it to the frontend.

Why LLM-first:
  * Any cancer type (breast, esophageal, lung, colorectal, sarcoma, ...).
  * Any patient data shape — different terminology, different structure.
  * New biomarkers, new drugs, new staging systems are handled by the
    model's world knowledge, not by us editing regex lists.

Safety:
  * The LLM is instructed to use ONLY the supplied graph. Anything not
    present must be returned as "Not documented".
  * Every claim must cite a source field; entries with unknown sources
    are dropped in post-processing.
  * Temperature 0.0 for reproducibility.
  * The frontend schema is fixed — only the *values* are LLM-generated.

Endpoint:
    GET /patient-story/{patient_id}?doctor_id=...
    GET /patient-story/{patient_id}?doctor_id=...&specialty=Cardiology
"""
from __future__ import annotations

import json
import re
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

router = APIRouter(prefix="/patient-story", tags=["patient-story"])


# ============================================================
# CONSTANTS
# ============================================================

NOT_DOCUMENTED = "Not documented"

ALLOWED_SOURCES = {
    "conditions", "medications", "procedures",
    "lab_summary", "procedure_summary", "medication_summary",
    "vital_summary", "symptom_summary", "imaging_summary",
}

VALID_SEVERITIES = {"cr", "rv", "ms", "in"}
VALID_CONFIDENCE = {"low", "medium", "high"}


# ============================================================
# SYSTEM PROMPT — the entire "logic" of the story
# ============================================================

PATIENT_STORY_SYSTEM_PROMPT = """
You are a clinical documentation assistant. You receive a RAW PATIENT GRAPH
extracted from a hospital record — conditions, medications, procedures, and
several free-text summaries (labs, procedures, medications, vitals, symptoms,
imaging). The graph may describe ANY cancer type (breast, esophageal, lung,
colorectal, sarcoma, lymphoma, ...) or ANY clinical situation.

Your ONLY job is to populate a fixed JSON container from that graph. You are
a faithful extractor and synthesiser — NOT a diagnostician, NOT a planner.
You must NEVER invent facts. If the graph does not contain something, you
must output "Not documented" for that field.

You must return EXACTLY this JSON shape (all keys required, no extras):

{
  "hero": {
    "eyebrow": "<doctor name + ' / Patient story', or 'Patient story'>",
    "headline": "<one clinically useful sentence naming the cancer and clinical situation>",
    "why_here": "<one sentence: why this patient is being reviewed, from the record>"
  },
  "identity": [
    {"key": "Case",       "value": "<e.g. New cancer | Follow-up | Post-op review>"},
    {"key": "Cancer",     "value": "<primary cancer name as documented, or Not documented>"},
    {"key": "Histology",  "value": "<histology + grade as documented, or Not documented>"},
    {"key": "Stage",      "value": "<stage as documented, or Not documented>"},
    {"key": "Diagnosed",  "value": "<earliest cancer diagnosis date, or Not documented>"},
    {"key": "Patient",    "value": "<age + sex if documented, or Not documented>"}
  ],
  "clinically_relevant": [
    {
      "severity": "cr | rv | ms | in",
      "text": "<one clinical fact, phrased exactly as a clinician would say it>",
      "source": "<one of: conditions|medications|procedures|lab_summary|procedure_summary|medication_summary|vital_summary|symptom_summary|imaging_summary>"
    }
  ],
  "lens": {
    "specialty": "<the specialty passed by the caller>",
    "intro": "Same patient story; emphasis changes with the specialty selected at the top.",
    "items": [
      {
        "text": "<one insight framed through this specialty's lens, grounded in the graph>",
        "source": "<source field>"
      }
    ]
  },
  "journey": [
    {
      "date": "<date as documented, or Not documented>",
      "stage": "<one short label: Symptom | Work-up | Diagnosis | Staging | Treatment | Follow-up | Procedure | Current status | Event>",
      "detail": "<one sentence describing what happened, grounded in the graph>",
      "now": true | false
    }
  ],
  "current_disease": [
    {"label": "Primary site",         "value": "<...>"},
    {"label": "Tumour size",          "value": "<...>"},
    {"label": "Nodes",                "value": "<...>"},
    {"label": "Metastasis",           "value": "<...>"},
    {"label": "Histology and grade",  "value": "<...>"},
    {"label": "Biomarkers",           "value": "<any biomarker mentioned, or Not documented>"},
    {"label": "Germline testing",     "value": "<...>"}
  ],
  "treatment_history": [
    {"label": "Systemic therapy", "value": "<...>"},
    {"label": "Surgery",          "value": "<...>"},
    {"label": "Radiation",        "value": "<...>"},
    {"label": "Prior cancer",     "value": "<...>"}
  ],
  "context": [
    {"label": "Performance status", "value": "<...>"},
    {"label": "Comorbidities",      "value": "<...>"},
    {"label": "Medications",        "value": "<...>"},
    {"label": "Supplements",        "value": "<...>"},
    {"label": "Allergies",          "value": "<...>"},
    {"label": "Family history",     "value": "<...>"},
    {"label": "Tobacco / alcohol",  "value": "<...>"},
    {"label": "Menopausal status",  "value": "<...>"}
  ],
  "confidence": "low | medium | high"
}

SEVERITY KEY (use the correct one — do not guess):
  "cr" = critical/high-acuity fact visible in the graph (e.g. metastatic
         disease, severe organ dysfunction, contraindication clearly stated).
  "rv" = needs review — equivocal, pending, indeterminate, awaiting a result,
         or a decision not yet made.
  "ms" = documented gap — the record explicitly says something is missing,
         not done, not reported, or unknown.
  "in" = neutral informational fact.

RULES — read carefully:
  1. Use ONLY the supplied graph. Never use outside knowledge about the
     patient. Never guess a value that is not present.
  2. If a field is genuinely absent from the graph, output the literal
     string "Not documented". Do not leave it empty, null, or blank.
  3. Every entry in clinically_relevant and lens.items MUST cite a `source`
     field from the allow-list. If you cannot cite a source, do not emit
     the entry.
  4. Do NOT diagnose, prognosticate, or recommend treatment. Describe what
     the record says.
  5. Do NOT invent dates. If a date is not in the record, use "Not documented"
     for that journey node's date (but you may still include the node if the
     event itself is documented).
  6. `now: true` on exactly the last journey node that represents the
     current encounter. All other nodes must be `now: false`.
  7. `identity` must always contain exactly the six keys listed, in order.
  8. `current_disease`, `treatment_history`, and `context` must always
     contain exactly the labels listed, in order.
  9. The `lens.specialty` value is the specialty passed by the caller —
     echo it back verbatim.
 10. Output MUST be a single valid JSON object. No prose, no markdown,
     no code fences.

Worked example of the required discipline (do not copy the content, copy
the *behaviour*): if the graph says "HER2 2+ equivocal, ISH pending" and
nothing else about HER2, then:
  • identity.Cancer        = the cancer name from conditions (or Not documented)
  • current_disease.Biomarkers = "HER2 2+ equivocal · ISH pending" (verbatim from graph)
  • a clinically_relevant entry with severity "rv" citing the source field
  • never invent "HER2-positive" or "HER2-negative"
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
    if isinstance(v, (list, tuple)):
        return ", ".join(_safe_str(x, "") for x in v if x) or fallback
    if isinstance(v, dict):
        return json.dumps(v, default=str)
    return str(v)


# ============================================================
# POST-PROCESSING — enforce schema, drop unsourced claims
# ============================================================

def _normalize_evidence_entry(entry: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Keep only entries whose `source` is in the allow-list."""
    if not isinstance(entry, dict):
        return None
    src = (entry.get("source") or "").strip().lower()
    if src not in ALLOWED_SOURCES:
        return None
    text = _safe_str(entry.get("text") or entry.get("value"), "")
    if not text:
        return None
    return {
        "severity": entry.get("severity") if entry.get("severity") in VALID_SEVERITIES else "in",
        "text": text,
        "source": src,
    }


def _normalize_lens_item(entry: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(entry, dict):
        return None
    src = (entry.get("source") or "").strip().lower()
    if src not in ALLOWED_SOURCES:
        return None
    text = _safe_str(entry.get("text"), "")
    if not text:
        return None
    return {"text": text, "source": src}


def _normalize_kv_list(items: Any, expected_labels: List[str]) -> List[Dict[str, str]]:
    """Guarantee the exact labels, in order, with a string value for each."""
    out: List[Dict[str, str]] = []
    if isinstance(items, list):
        by_label = {
            _safe_str(it.get("label"), ""): _safe_str(it.get("value"), NOT_DOCUMENTED)
            for it in items if isinstance(it, dict)
        }
    else:
        by_label = {}
    for label in expected_labels:
        out.append({"label": label, "value": by_label.get(label, NOT_DOCUMENTED)})
    return out


def _normalize_identity(items: Any) -> List[Dict[str, str]]:
    expected = ["Case", "Cancer", "Histology", "Stage", "Diagnosed", "Patient"]
    if not isinstance(items, list):
        return [{"key": k, "value": NOT_DOCUMENTED} for k in expected]
    by_key = {
        _safe_str(it.get("key"), ""): _safe_str(it.get("value"), NOT_DOCUMENTED)
        for it in items if isinstance(it, dict)
    }
    return [{"key": k, "value": by_key.get(k, NOT_DOCUMENTED)} for k in expected]


def _normalize_journey(items: Any) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    if not isinstance(items, list):
        return out
    for it in items:
        if not isinstance(it, dict):
            continue
        out.append({
            "date": _safe_str(it.get("date"), NOT_DOCUMENTED),
            "stage": _safe_str(it.get("stage"), "Event"),
            "detail": _safe_str(it.get("detail"), NOT_DOCUMENTED),
            "now": bool(it.get("now", False)),
        })
    # Enforce: at most one `now: true`, and it must be the last node.
    if out:
        for n in out[:-1]:
            n["now"] = False
        # If the LLM forgot to mark one, mark the last.
        if not any(n["now"] for n in out):
            out[-1]["now"] = True
    return out


def _normalize_hero(hero: Any, doctor_name: str) -> Dict[str, str]:
    if not isinstance(hero, dict):
        hero = {}
    eyebrow = _safe_str(hero.get("eyebrow"), "")
    if not eyebrow:
        eyebrow = f"{doctor_name} / Patient story" if doctor_name else "Patient story"
    return {
        "eyebrow": eyebrow,
        "headline": _safe_str(hero.get("headline"), "Clinical picture and treatment planning."),
        "why_here": _safe_str(hero.get("why_here"), "Referred for clinical review."),
    }


def _normalize_story(raw: Dict[str, Any], graph: Dict[str, Any], specialty: str) -> Dict[str, Any]:
    """Coerce the LLM's JSON into the exact frontend schema. Never raises."""
    doctor_name = _safe_str(graph.get("doctor_name"), "")

    hero = _normalize_hero(raw.get("hero"), doctor_name)
    identity = _normalize_identity(raw.get("identity"))

    clinically_relevant: List[Dict[str, Any]] = []
    for it in (raw.get("clinically_relevant") or []):
        norm = _normalize_evidence_entry(it)
        if norm:
            clinically_relevant.append(norm)

    lens_raw = raw.get("lens") if isinstance(raw.get("lens"), dict) else {}
    lens = {
        "specialty": _safe_str(lens_raw.get("specialty"), specialty),
        "intro": "Same patient story; emphasis changes with the specialty selected at the top.",
        "items": [
            norm for norm in (
                _normalize_lens_item(it) for it in (lens_raw.get("items") or [])
            ) if norm
        ],
    }

    journey = _normalize_journey(raw.get("journey"))

    current_disease = _normalize_kv_list(
        raw.get("current_disease"),
        ["Primary site", "Tumour size", "Nodes", "Metastasis",
         "Histology and grade", "Biomarkers", "Germline testing"],
    )
    treatment_history = _normalize_kv_list(
        raw.get("treatment_history"),
        ["Systemic therapy", "Surgery", "Radiation", "Prior cancer"],
    )
    context = _normalize_kv_list(
        raw.get("context"),
        ["Performance status", "Comorbidities", "Medications", "Supplements",
         "Allergies", "Family history", "Tobacco / alcohol", "Menopausal status"],
    )

    confidence = raw.get("confidence") if raw.get("confidence") in VALID_CONFIDENCE else "medium"

    return {
        "hero": hero,
        "identity": identity,
        "clinically_relevant": clinically_relevant,
        "lens": lens,
        "journey": journey,
        "current_disease": current_disease,
        "treatment_history": treatment_history,
        "context": context,
        "confidence": confidence,
    }


# ============================================================
# CORE — one LLM call builds the entire story
# ============================================================

async def build_patient_story_llm(
    graph: Dict[str, Any],
    specialty: str = "Medical Oncology",
) -> Dict[str, Any]:
    """Call the LLM once with the full graph; return the normalized story."""
    messages = [
        SystemMessage(content=PATIENT_STORY_SYSTEM_PROMPT),
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
        logger.error(f"[patient_story] LLM returned non-JSON: {e}")
        # Fallback: return an honest "not available" story rather than 500.
        return _empty_story(graph, specialty, reason="LLM returned invalid JSON")
    except Exception as e:
        logger.error(f"[patient_story] LLM call failed: {e}")
        return _empty_story(graph, specialty, reason=f"LLM call failed: {e}")

    return _normalize_story(parsed, graph, specialty)


def _empty_story(graph: Dict[str, Any], specialty: str, reason: str) -> Dict[str, Any]:
    """A valid, honest, empty story — used only if the LLM errors out."""
    doctor_name = _safe_str(graph.get("doctor_name"), "")
    nd = NOT_DOCUMENTED
    return {
        "hero": {
            "eyebrow": f"{doctor_name} / Patient story" if doctor_name else "Patient story",
            "headline": "Clinical picture unavailable.",
            "why_here": reason,
        },
        "identity": [{"key": k, "value": nd} for k in
                     ["Case", "Cancer", "Histology", "Stage", "Diagnosed", "Patient"]],
        "clinically_relevant": [],
        "lens": {"specialty": specialty,
                 "intro": "Same patient story; emphasis changes with the specialty selected at the top.",
                 "items": []},
        "journey": [],
        "current_disease": [{"label": k, "value": nd} for k in
                            ["Primary site", "Tumour size", "Nodes", "Metastasis",
                             "Histology and grade", "Biomarkers", "Germline testing"]],
        "treatment_history": [{"label": k, "value": nd} for k in
                              ["Systemic therapy", "Surgery", "Radiation", "Prior cancer"]],
        "context": [{"label": k, "value": nd} for k in
                    ["Performance status", "Comorbidities", "Medications", "Supplements",
                     "Allergies", "Family history", "Tobacco / alcohol", "Menopausal status"]],
        "confidence": "low",
    }


# ============================================================
# ENDPOINTS
# ============================================================

@router.get("/{patient_id}")
async def get_patient_story(
    patient_id: str,
    doctor_id: str = Query(..., description="Doctor ID for context fetch"),
    specialty: Optional[str] = Query(None, description="Specialty lens to apply"),
) -> Dict[str, Any]:
    """
    Build the full Patient Story for any patient / any cancer type.

    Entirely LLM-driven: Python fetches the graph, the LLM populates every
    section. Nothing is hardcoded per cancer type.
    """
    fetcher = PatientContextFetcher()
    try:
        raw = await fetcher.fetch(patient_id, doctor_id)
    except Exception as e:
        logger.error(f"[patient_story] fetch failed: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to fetch patient context: {e}")

    if not raw:
        raise HTTPException(status_code=404, detail="Patient context not found.")

    graph = raw if "conditions" in raw else _extract_patient_graph(raw)

    effective_specialty = (
        specialty
        or _safe_str(graph.get("doctor_specialty"), "")
        or "Medical Oncology"
    )

    story = await build_patient_story_llm(graph, specialty=effective_specialty)

    return {
        "status": "success",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "doctor_specialty": effective_specialty,
        **story,
    }


@router.get("/{patient_id}/raw")
async def get_patient_story_raw(
    patient_id: str,
    doctor_id: str = Query(...),
) -> Dict[str, Any]:
    """Debug endpoint — returns the raw extracted graph without LLM processing."""
    fetcher = PatientContextFetcher()
    raw = await fetcher.fetch(patient_id, doctor_id)
    if not raw:
        raise HTTPException(status_code=404, detail="Patient context not found.")
    return {"status": "success", "graph": raw}