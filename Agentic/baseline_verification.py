# baseline_verification.py
"""
Baseline & Verification Backend — LLM-first, universal cancer support
----------------------------------------------------------------------
Builds the structured "Baseline & Verification" payload consumed by
BaselineVerification.jsx from the same patient graph that clinical_agents.py
already extracts.

Design goals:
  * Works for ANY cancer type (solid or haematological) and ANY patient data shape.
  * No hardcoded keyword lists, no regex for clinical concepts, no cancer-specific
    assumption — the LLM does all clinical reading.
  * Every entry that asserts a clinical fact must cite a `source` field; entries
    with unknown sources are dropped in post-processing.
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
    GET /baseline-verification/{patient_id}?doctor_id=...
    GET /baseline-verification/{patient_id}?doctor_id=...&specialty=Cardiology
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

router = APIRouter(prefix="/baseline-verification", tags=["baseline-verification"])


# ============================================================
# CONSTANTS
# ============================================================

NOT_DOCUMENTED = "Not documented"

ALLOWED_SOURCES = {
    "conditions", "medications", "procedures",
    "lab_summary", "procedure_summary", "medication_summary",
    "vital_summary", "symptom_summary", "imaging_summary",
}

VALID_MARKERS = {"ok", "rv", "cr", "ms", "in"}
VALID_CONFIDENCE = {"low", "medium", "high"}

# The 7 readiness checkpoints the frontend expects, in order.
READINESS_CHECKPOINTS = [
    "Cancer identity",
    "Stage and disease extent",
    "Pathology and biomarkers",
    "Performance status documented",
    "Organ function current",
    "Prior treatment exposure verified",
    "Toxicity baseline documented",
]

# The 12 baseline values the frontend expects, in order.
BASELINE_VALUE_LABELS = [
    "Haemoglobin",
    "ANC",
    "Platelets",
    "Creatinine",
    "CrCl (Cockcroft–Gault)",
    "Bilirubin",
    "ALT / AST",
    "Potassium",
    "HbA1c",
    "Height / weight",
    "BSA (Mosteller)",
    "LVEF",
]


# ============================================================
# SYSTEM PROMPT — the entire logic of Baseline & Verification
# ============================================================

BASELINE_SYSTEM_PROMPT = """
You are a clinical documentation assistant. You receive a RAW PATIENT GRAPH
extracted from a hospital record — conditions, medications, procedures, and
several free-text summaries (labs, procedures, medications, vitals, symptoms,
imaging). The graph may describe ANY cancer type (breast, esophageal, lung,
colorectal, sarcoma, lymphoma, leukaemia, myeloma, ...) or ANY clinical
situation.

Your ONLY job is to populate a fixed JSON container that answers ONE question:
"Is this patient characterised enough to make the next clinical decision, and
what still needs verification, is missing, or has changed?"

You are a faithful extractor and synthesiser — NOT a diagnostician, NOT a
planner. You must NEVER invent facts. If the graph does not contain something,
you must output "Not documented" for that field.

You must return EXACTLY this JSON shape (all keys required, no extras):

{
  "hero": {
    "eyebrow": "<patient name + ' / Baseline & verification', or 'Baseline & verification'>",
    "headline": "<one sentence summarising how many items are verified and how many could change the next decision>",
    "subtitle": "<one sentence: what is confirmed now, what is uncertain, and is the patient characterised enough to decide?>"
  },
  "counters": {
    "verified": <int>,
    "needs_verification": <int>,
    "missing_important": <int>,
    "clinically_relevant_change": <int>
  },
  "readiness": [
    {"checkpoint": "Cancer identity",                "status": "ok | rv | cr | ms | in"},
    {"checkpoint": "Stage and disease extent",       "status": "ok | rv | cr | ms | in"},
    {"checkpoint": "Pathology and biomarkers",       "status": "ok | rv | cr | ms | in"},
    {"checkpoint": "Performance status documented",  "status": "ok | rv | cr | ms | in"},
    {"checkpoint": "Organ function current",         "status": "ok | rv | cr | ms | in"},
    {"checkpoint": "Prior treatment exposure verified","status": "ok | rv | cr | ms | in"},
    {"checkpoint": "Toxicity baseline documented",   "status": "ok | rv | cr | ms | in"}
  ],
  "needs_verification": [
    {
      "title":  "<short clinical label, e.g. 'HER2 status'>",
      "why":    "<one sentence: why this matters for the next decision>",
      "action": "<concrete next step, e.g. 'Order dual-probe ISH'>",
      "source": "<one of: conditions|medications|procedures|lab_summary|procedure_summary|medication_summary|vital_summary|symptom_summary|imaging_summary>"
    }
  ],
  "missing_important": [
    {
      "title":  "<short label>",
      "why":    "<one sentence: why this matters>",
      "action": "<concrete next step>",
      "source": "<source field>"
    }
  ],
  "changes": [
    {
      "title":  "<short label, e.g. 'Weight 66 -> 64 kg in 6 weeks (-3%)'>",
      "why":    "<one sentence: clinical significance>",
      "source": "<source field>"
    }
  ],
  "verified": [
    {
      "text":   "<short confirmed fact, e.g. 'Histology: invasive ductal carcinoma, grade 3'>",
      "source": "<source field>"
    }
  ],
  "conflicts": [
    {
      "a":      "<older / less specific statement, verbatim>",
      "b":      "<newer / more specific statement, verbatim>",
      "source_a": "<source field>",
      "source_b": "<source field>"
    }
  ],
  "values": [
    {"label": "Haemoglobin",              "value": "<value + unit, or Not documented>"},
    {"label": "ANC",                      "value": "<...>"},
    {"label": "Platelets",                "value": "<...>"},
    {"label": "Creatinine",               "value": "<...>"},
    {"label": "CrCl (Cockcroft–Gault)",   "value": "<...>"},
    {"label": "Bilirubin",                "value": "<...>"},
    {"label": "ALT / AST",                "value": "<...>"},
    {"label": "Potassium",                "value": "<...>"},
    {"label": "HbA1c",                    "value": "<...>"},
    {"label": "Height / weight",          "value": "<...>"},
    {"label": "BSA (Mosteller)",          "value": "<...>"},
    {"label": "LVEF",                     "value": "<...>"}
  ],
  "geriatric": {
    "text": "<one sentence: whether geriatric / functional assessment is indicated for this patient's age, or Not documented>",
    "source": "<source field>"
  },
  "verification_sequence": "<the ordered verification sequence used, as a single string>",
  "confidence": "low | medium | high"
}

MARKER KEY (use the correct one for each readiness checkpoint):
  "ok" = verified / present / current.
  "rv" = needs review — equivocal, pending, indeterminate, awaiting a result,
         or a decision not yet made.
  "cr" = critical/high-acuity gap that could change the next decision.
  "ms" = missing — the record explicitly does not contain it.
  "in" = neutral informational state.

RULES — read carefully:
  1. Use ONLY the supplied graph. Never use outside knowledge about the
     patient. Never guess a value that is not present.
  2. If a field is genuinely absent, output the literal string "Not documented".
  3. Every entry in needs_verification, missing_important, changes, verified,
     and conflicts MUST cite a `source` (or `source_a`/`source_b`) from the
     allow-list. If you cannot cite a source, do not emit the entry.
  4. Do NOT diagnose, prognosticate, or recommend treatment. Describe what
     the record says.
  5. `verified` lists facts that ARE confirmed in the graph — histology,
     biomarkers, size, nodes, dates, etc. Keep each under 90 characters.
  6. `needs_verification` lists facts that are stated but equivocal / pending
     / contradicted — with the concrete test or step that would resolve them.
  7. `missing_important` lists facts that are absent AND clinically relevant
     to the next decision — with the concrete step that would obtain them.
  8. `changes` lists any documented trend (weight, labs, performance status,
     imaging change) with its clinical significance.
  9. `conflicts` lists ONLY genuine contradictions between two specific
     source statements (e.g. a referral says "HER2 positive" while pathology
     says "HER2 IHC 2+ equivocal"). Do NOT list normal documentation variance.
 10. `values` must always contain exactly the 12 labels listed, in order.
     Use "Not documented" for any that are absent. When a value is present
     but dated, include the date, e.g. "11.4 g/dL (23 Sep 2026)".
 11. `verification_sequence` must be the ordered pipeline string the frontend
     displays in the footer.
 12. Output MUST be a single valid JSON object. No prose, no markdown, no
     code fences.

Worked behaviour (do not copy content, copy the discipline): if the referral
says "HER2 positive" and pathology says "HER2 IHC 2+ equivocal", then:
  • a `needs_verification` entry titled "HER2 status" with the action
    "Order dual-probe ISH" — sourced to both the referral and pathology fields
  • a `conflicts` entry with `a` = the pathology statement, `b` = the referral
    statement, each citing its source
  • never resolve it yourself
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


def _safe_int(v: Any, fallback: int = 0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return fallback


# ============================================================
# POST-PROCESSING — enforce schema, drop unsourced claims
# ============================================================

def _normalize_sourced_entry(entry: Any, required_text_key: str = "text") -> Optional[Dict[str, Any]]:
    """Keep only entries whose `source` is in the allow-list."""
    if not isinstance(entry, dict):
        return None
    src = (entry.get("source") or "").strip().lower()
    if src not in ALLOWED_SOURCES:
        return None
    text = _safe_str(entry.get(required_text_key), "")
    if not text:
        return None
    out = {required_text_key: text, "source": src}
    # Preserve optional extra keys used by the frontend (title, why, action).
    for k in ("title", "why", "action"):
        if entry.get(k):
            out[k] = _safe_str(entry.get(k), "")
    return out


def _normalize_conflict(entry: Any) -> Optional[Dict[str, str]]:
    if not isinstance(entry, dict):
        return None
    a = _safe_str(entry.get("a"), "")
    b = _safe_str(entry.get("b"), "")
    if not a or not b:
        return None
    src_a = (entry.get("source_a") or "").strip().lower()
    src_b = (entry.get("source_b") or "").strip().lower()
    if src_a not in ALLOWED_SOURCES or src_b not in ALLOWED_SOURCES:
        return None
    return {"a": a, "b": b, "source_a": src_a, "source_b": src_b}


def _normalize_readiness(items: Any) -> List[Dict[str, str]]:
    """Guarantee the 7 checkpoints, in order, with a valid marker each."""
    by_name: Dict[str, str] = {}
    if isinstance(items, list):
        for it in items:
            if not isinstance(it, dict):
                continue
            name = _safe_str(it.get("checkpoint"), "")
            status = it.get("status")
            if name and status in VALID_MARKERS:
                by_name[name] = status
    return [
        {"checkpoint": name, "status": by_name.get(name, "in")}
        for name in READINESS_CHECKPOINTS
    ]


def _normalize_values(items: Any) -> List[Dict[str, str]]:
    """Guarantee the 12 baseline value labels, in order."""
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
        for lbl in BASELINE_VALUE_LABELS
    ]


def _normalize_hero(hero: Any, doctor_name: str) -> Dict[str, str]:
    if not isinstance(hero, dict):
        hero = {}
    eyebrow = _safe_str(hero.get("eyebrow"), "")
    if not eyebrow:
        eyebrow = f"{doctor_name} / Baseline & verification" if doctor_name else "Baseline & verification"
    return {
        "eyebrow": eyebrow,
        "headline": _safe_str(hero.get("headline"), "Baseline and verification status."),
        "subtitle": _safe_str(
            hero.get("subtitle"),
            "What is confirmed now, what is uncertain, and is the patient characterised enough to decide?",
        ),
    }


def _normalize_geriatric(g: Any) -> Dict[str, str]:
    if not isinstance(g, dict):
        return {"text": NOT_DOCUMENTED, "source": "conditions"}
    text = _safe_str(g.get("text"), NOT_DOCUMENTED)
    src = (g.get("source") or "").strip().lower()
    if src not in ALLOWED_SOURCES:
        src = "conditions"
    return {"text": text, "source": src}


def _normalize_story(raw: Dict[str, Any], graph: Dict[str, Any], specialty: str) -> Dict[str, Any]:
    """Coerce the LLM's JSON into the exact frontend schema. Never raises."""
    doctor_name = _safe_str(graph.get("doctor_name"), "")

    hero = _normalize_hero(raw.get("hero"), doctor_name)

    counters_raw = raw.get("counters") if isinstance(raw.get("counters"), dict) else {}
    counters = {
        "verified": _safe_int(counters_raw.get("verified"), 0),
        "needs_verification": _safe_int(counters_raw.get("needs_verification"), 0),
        "missing_important": _safe_int(counters_raw.get("missing_important"), 0),
        "clinically_relevant_change": _safe_int(counters_raw.get("clinically_relevant_change"), 0),
    }

    readiness = _normalize_readiness(raw.get("readiness"))

    needs_verification: List[Dict[str, Any]] = []
    for it in (raw.get("needs_verification") or []):
        norm = _normalize_sourced_entry(it, required_text_key="title")
        if norm and norm.get("why") and norm.get("action"):
            needs_verification.append(norm)

    missing_important: List[Dict[str, Any]] = []
    for it in (raw.get("missing_important") or []):
        norm = _normalize_sourced_entry(it, required_text_key="title")
        if norm and norm.get("why") and norm.get("action"):
            missing_important.append(norm)

    changes: List[Dict[str, Any]] = []
    for it in (raw.get("changes") or []):
        norm = _normalize_sourced_entry(it, required_text_key="title")
        if norm and norm.get("why"):
            changes.append(norm)

    verified: List[Dict[str, Any]] = []
    for it in (raw.get("verified") or []):
        norm = _normalize_sourced_entry(it, required_text_key="text")
        if norm:
            verified.append(norm)

    conflicts: List[Dict[str, str]] = []
    for it in (raw.get("conflicts") or []):
        norm = _normalize_conflict(it)
        if norm:
            conflicts.append(norm)

    values = _normalize_values(raw.get("values"))

    geriatric = _normalize_geriatric(raw.get("geriatric"))

    verification_sequence = _safe_str(
        raw.get("verification_sequence"),
        "History → Identity → Extent → Pathology & biomarkers → Clinical status → "
        "Function → Comorbidity & medicines → Labs & organ function → Prior exposure → "
        "Prerequisites → Contradictions → Missing data → Evidence → Readiness",
    )

    confidence = raw.get("confidence") if raw.get("confidence") in VALID_CONFIDENCE else "medium"

    # Recompute counters from normalized lists so they always match what the
    # frontend will actually render. Never trust the LLM's counts blindly.
    counters["verified"] = len(verified)
    counters["needs_verification"] = len(needs_verification)
    counters["missing_important"] = len(missing_important)
    counters["clinically_relevant_change"] = len(changes)

    return {
        "hero": hero,
        "counters": counters,
        "readiness": readiness,
        "needs_verification": needs_verification,
        "missing_important": missing_important,
        "changes": changes,
        "verified": verified,
        "conflicts": conflicts,
        "values": values,
        "geriatric": geriatric,
        "verification_sequence": verification_sequence,
        "confidence": confidence,
    }


# ============================================================
# CORE — one LLM call builds the entire baseline payload
# ============================================================

async def build_baseline_verification_llm(
    graph: Dict[str, Any],
    specialty: str = "Medical Oncology",
) -> Dict[str, Any]:
    """Call the LLM once with the full graph; return the normalized payload."""
    messages = [
        SystemMessage(content=BASELINE_SYSTEM_PROMPT),
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
        logger.error(f"[baseline_verification] LLM returned non-JSON: {e}")
        return _empty_baseline(graph, specialty, reason="LLM returned invalid JSON")
    except Exception as e:
        logger.error(f"[baseline_verification] LLM call failed: {e}")
        return _empty_baseline(graph, specialty, reason=f"LLM call failed: {e}")

    return _normalize_story(parsed, graph, specialty)


def _empty_baseline(graph: Dict[str, Any], specialty: str, reason: str) -> Dict[str, Any]:
    """A valid, honest, empty baseline — used only if the LLM errors out."""
    doctor_name = _safe_str(graph.get("doctor_name"), "")
    nd = NOT_DOCUMENTED
    return {
        "hero": {
            "eyebrow": f"{doctor_name} / Baseline & verification" if doctor_name else "Baseline & verification",
            "headline": "Baseline status unavailable.",
            "subtitle": reason,
        },
        "counters": {
            "verified": 0,
            "needs_verification": 0,
            "missing_important": 0,
            "clinically_relevant_change": 0,
        },
        "readiness": [{"checkpoint": c, "status": "in"} for c in READINESS_CHECKPOINTS],
        "needs_verification": [],
        "missing_important": [],
        "changes": [],
        "verified": [],
        "conflicts": [],
        "values": [{"label": l, "value": nd} for l in BASELINE_VALUE_LABELS],
        "geriatric": {"text": nd, "source": "conditions"},
        "verification_sequence": (
            "History → Identity → Extent → Pathology & biomarkers → Clinical status → "
            "Function → Comorbidity & medicines → Labs & organ function → Prior exposure → "
            "Prerequisites → Contradictions → Missing data → Evidence → Readiness"
        ),
        "confidence": "low",
    }


# ============================================================
# ENDPOINTS
# ============================================================

@router.get("/{patient_id}")
async def get_baseline_verification(
    patient_id: str,
    doctor_id: str = Query(..., description="Doctor ID for context fetch"),
    specialty: Optional[str] = Query(None, description="Specialty lens to apply"),
) -> Dict[str, Any]:
    """
    Build the full Baseline & Verification payload for any patient / any cancer type.

    Entirely LLM-driven: Python fetches the graph, the LLM populates every
    section. Nothing is hardcoded per cancer type.
    """
    fetcher = PatientContextFetcher()
    try:
        raw = await fetcher.fetch(patient_id, doctor_id)
    except Exception as e:
        logger.error(f"[baseline_verification] fetch failed: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to fetch patient context: {e}")

    if not raw:
        raise HTTPException(status_code=404, detail="Patient context not found.")

    graph = raw if "conditions" in raw else _extract_patient_graph(raw)

    effective_specialty = (
        specialty
        or _safe_str(graph.get("doctor_specialty"), "")
        or "Medical Oncology"
    )

    payload = await build_baseline_verification_llm(graph, specialty=effective_specialty)

    return {
        "status": "success",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "doctor_specialty": effective_specialty,
        **payload,
    }


@router.get("/{patient_id}/raw")
async def get_baseline_verification_raw(
    patient_id: str,
    doctor_id: str = Query(...),
) -> Dict[str, Any]:
    """Debug endpoint — returns the raw extracted graph without LLM processing."""
    fetcher = PatientContextFetcher()
    raw = await fetcher.fetch(patient_id, doctor_id)
    if not raw:
        raise HTTPException(status_code=404, detail="Patient context not found.")
    return {"status": "success", "graph": raw}