# first_line_plan.py
"""
First-Line Plan Backend — specialty-scoped, prior-decision aware, LLM-first.

Reads:
  • Patient graph (always).
  • Tumour board plan — fetched from the hospital integration endpoint
    hms/users/data/context/get-tumor-board-plan-by-doctor/{patient_id}/{doctor_id}.
  • Saved strategy (from `strategy_collection`) if the doctor has already
    chosen one.
  • Latest doctor decision (from `doctor_decisions_collection`) if one exists.
  • The CALLER'S SPECIALTY — passed in as input. Every strategy returned
    belongs to this specialty only.

Endpoint:
    GET /first-line-plan/{patient_id}?doctor_id=...&specialty=...
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from dotenv import load_dotenv
from loguru import logger
from fastapi import APIRouter, HTTPException, Query
from langchain_core.messages import HumanMessage, SystemMessage
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import MongoClient

from Agentic.clinical_agents import (
    PatientContextFetcher,
    _extract_patient_graph,
    reasoning_llm,
)


# ============================================================
# ENV + MONGO CLIENTS
# ============================================================

load_dotenv()

MONGO_URI    = os.getenv("MONGO_URI")
MONGO_DB     = "doctorassistai"
api_base_url = os.getenv("VITE_BACKEND_URL")

mongodb_client = AsyncIOMotorClient(MONGO_URI)
database       = mongodb_client[MONGO_DB]

client = MongoClient(MONGO_URI)
db     = client[MONGO_DB]


# ============================================================
# COLLECTIONS
# ============================================================

strategy_collection          = database["strategy"]
doctor_decisions_collection  = database["doctor_decisions"]


# ============================================================
# ROUTER
# ============================================================

router = APIRouter(prefix="/first-line-plan", tags=["first-line-plan"])


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

BASELINE_TILE_LABELS = [
    "BSA", "CrCl", "ECOG", "Marrow", "Cardiac", "Limiting factors",
]

DISEASE_DEFINITION_LABELS = [
    "Site and histology", "Stage", "Biology", "Resectability", "Burden and symptoms",
]

# Canonical specialty names
SPECIALTY_CANONICAL = {
    "medical oncology":   "Medical Oncology",
    "surgical oncology":  "Surgical Oncology",
    "radiation oncology": "Radiation Oncology",
    "radiology":          "Radiology",
    "pathology":          "Pathology",
    "oncology nurse":     "Oncology nurse",
}

# What "strategies" means for each specialty.
SPECIALTY_SCOPE = {
    "Medical Oncology": (
        "systemic therapy strategies — chemotherapy, targeted therapy, "
        "immunotherapy, endocrine therapy, and their sequencing with surgery "
        "and radiation. Do NOT present surgical technique or radiation planning "
        "as the primary strategy."
    ),
    "Surgical Oncology": (
        "surgical strategies — operability, upfront resection, neoadjuvant "
        "sequencing to enable surgery, breast-conservation feasibility, "
        "margin planning, axillary management. Do NOT present systemic regimen "
        "choice or radiation technique as the primary strategy."
    ),
    "Radiation Oncology": (
        "radiation strategies — neoadjuvant chemoradiation, definitive "
        "chemoradiation, adjuvant radiation timing, target volumes, and "
        "organ-at-risk sparing. Do NOT present surgical technique or systemic "
        "regimen choice as the primary strategy."
    ),
    "Radiology": (
        "imaging strategies — what further imaging is needed, how it changes "
        "staging, restaging timing, measurement accuracy. Do NOT present "
        "treatment strategies."
    ),
    "Pathology": (
        "pathology strategies — histology confirmation, biomarker completeness, "
        "specimen adequacy, additional testing. Do NOT present treatment "
        "strategies."
    ),
    "Oncology nurse": (
        "supportive-care strategies — patient education, venous access, "
        "transport, adherence, symptom management, and daily-life constraints. "
        "Do NOT present treatment strategies."
    ),
}


# ============================================================
# SYSTEM PROMPT — specialty-scoped + prior-decision aware
# ============================================================

FIRST_LINE_PLAN_SYSTEM_PROMPT = """
You are a clinical documentation assistant. You receive:

  1. A RAW PATIENT GRAPH — conditions, medications, procedures, summaries.

  2. ANY PRIOR DECISION RECORDS that exist for this patient — most
     importantly the TUMOUR BOARD PLAN if one exists. When a prior tumour
     board plan exists, the strategies you produce MUST be consistent with
     it. Do NOT contradict an explicit tumour board recommendation. If the
     board recommended a specific direction, honour it as the FIRST strategy
     and present alternatives only where the board's decision allows.

  3. THE CALLER'S SPECIALTY — this is the lens the doctor is using. It is
     the ONLY lens for which you may produce strategies. Every strategy you
     return must belong to this specialty. Do NOT produce strategies for
     other specialties. Do NOT produce a mixed list. Do NOT add a strategy
     that "also involves" another specialty — keep to the caller's lens.

Your ONLY job is to populate a fixed JSON container that answers ONE
question: "What are the candidate first-line strategies for THIS patient,
seen through the CALLER'S SPECIALTY, honouring any prior tumour board
recommendation?"

You must:
  • Ground every patient-specific fact in the graph or a prior decision.
  • Produce 2–4 candidate strategies — ALL relevant to the CALLER'S SPECIALTY.
  • Honour any prior tumour board recommendation as the FIRST strategy.
  • Name the missing decision-critical data and what each would change.
  • Note modality-preparation points relevant to the CALLER'S SPECIALTY.
  • Never invent a biomarker value, a stage, or a lab result.

If the graph does not contain something, output "Not documented".

You MUST return EXACTLY this JSON shape (all keys required, no extras):

{
  "hero": {
    "eyebrow":  "<patient name + ' / First-line plan', or 'First-line plan'>",
    "headline": "<one sentence summarising the choice through the CALLER'S SPECIALTY>",
    "subtitle": "<one sentence: built from the verified disease, prior decisions and tumour board>"
  },
  "baseline_tiles": [
    {"label": "BSA",              "value": "<value + unit, or Not documented>"},
    {"label": "CrCl",             "value": "<...>"},
    {"label": "ECOG",             "value": "<...>"},
    {"label": "Marrow",           "value": "<...>"},
    {"label": "Cardiac",          "value": "<...>"},
    {"label": "Limiting factors", "value": "<...>"}
  ],
  "disease_definition": [
    {"label": "Site and histology",  "value": "<...>", "source": "<source field>"},
    {"label": "Stage",               "value": "<...>", "source": "<source field>"},
    {"label": "Biology",             "value": "<...>", "source": "<source field>"},
    {"label": "Resectability",       "value": "<...>", "source": "<source field>"},
    {"label": "Burden and symptoms", "value": "<...>", "source": "<source field>"}
  ],
  "intents": [
    "<Curative>", "<Neoadjuvant>", "<Adjuvant>", "<Definitive>",
    "<Locoregional control>", "<Metastatic disease control>",
    "<Palliative / supportive>", "<Maintenance>"
  ],
  "default_intent": "<one of the intents above>",
  "strategies": [
    {
      "id":       "A",
      "name":     "<short strategy name — must belong to the CALLER'S SPECIALTY>",
      "role":     "<short role label>",
      "why":      "<one sentence: why this strategy is considered for THIS patient>",
      "pre":      "<comma-separated prerequisites>",
      "cons":     "<comma-separated constraints>",
      "regimen":  "<standard-of-care regimen options, keyed to biomarker status where relevant>",
      "evidence": "<guideline sources>"
    }
  ],
  "change_drivers": [
    {"title": "<short label>", "impact": "<one sentence>", "severity": "cr|rv|in", "source": "<source field>"}
  ],
  "modality_prep": [
    {"text": "<one preparation point relevant to the CALLER'S SPECIALTY>", "source": "<source field>"}
  ],
  "actions": [
    {"key": "<snake_case>", "label": "<human label>", "variant": "primary|secondary", "reason": "<one sentence>"}
  ],
  "confidence": "low | medium | high"
}

SEVERITY KEY:
  "cr" = critical.
  "rv" = review.
  "in" = informational.

RULES:
  1. Use ONLY the supplied graph and prior decisions. Never invent a value.
  2. If a field is absent, output "Not documented".
  3. Every entry in disease_definition, change_drivers, and modality_prep
     must cite a source from the allow-list.
  4. `intents` must always contain the eight options, in order.
  5. `default_intent` must be one of the eight.
  6. `strategies` MUST be relevant to the CALLER'S SPECIALTY ONLY.
     If Surgical Oncology → present surgical strategies first.
     If Radiation Oncology → present radiation strategies first.
     If Medical Oncology → present systemic-therapy strategies first.
     Never mix. Never show a strategy that belongs primarily to another
     specialty.
  7. If a tumour board plan exists, the FIRST strategy must be that plan's
     recommended strategy. Additional strategies must not contradict it.
  8. `change_drivers` should contain 3–6 entries.
  9. `modality_prep` should contain 3–5 entries relevant to the caller's
     specialty.
 10. `actions` should contain 2–3 entries.
 11. Output MUST be a single valid JSON object. No prose, no markdown, no
     code fences.
"""


# ============================================================
# HELPERS
# ============================================================

def _canonical_specialty(s: Optional[str]) -> str:
    if not s:
        return "Medical Oncology"
    key = s.strip().lower()
    return SPECIALTY_CANONICAL.get(key, "Medical Oncology")


def _format_graph_for_prompt(graph: Dict[str, Any]) -> str:
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


def _format_prior_decisions(priors: Dict[str, Any]) -> str:
    """
    Render all prior decision records into a single block. Tumour board
    is placed first because it is the strongest prior decision.
    """
    if not priors or not any(priors.values()):
        return (
            "=== PRIOR DECISIONS ===\n"
            "(No prior decision records found for this patient.)\n"
        )

    lines: List[str] = ["=== PRIOR DECISIONS (must be honoured) ==="]

    # Tumour board is the strongest
    tb = priors.get("tumour_board")
    if tb:
        lines.append("\n— TUMOUR BOARD PLAN (strongest prior decision) —")
        for k, v in tb.items():
            if v:
                lines.append(f"  {k}: {v}")

    saved = priors.get("saved_strategy")
    if saved:
        lines.append("\n— Previously saved first-line strategy —")
        for k, v in saved.items():
            if v:
                lines.append(f"  {k}: {v}")

    doctor = priors.get("doctor_decision")
    if doctor:
        lines.append("\n— Previous doctor decision —")
        for k, v in doctor.items():
            if v:
                lines.append(f"  {k}: {v}")

    return "\n".join(lines) + "\n"


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


# ============================================================
# PRIOR DECISION LOOKUP — TUMOUR BOARD VIA INTEGRATION
# ============================================================

async def _fetch_tumour_board(patient_id: str, doctor_id: str) -> Optional[Dict[str, Any]]:
    """
    Fetch the tumour board plan from the hospital integration endpoint:
        hms/users/data/context/get-tumor-board-plan-by-doctor/{patient_id}/{doctor_id}
    """
    url = (
        f"{api_base_url}hms/users/data/context/"
        f"get-tumor-board-plan-by-doctor/{patient_id}/{doctor_id}"
    )
    try:
        async with httpx.AsyncClient(timeout=15.0) as client_:
            resp = await client_.get(url)
        if resp.status_code != 200:
            logger.info(f"[first_line_plan] tumour board endpoint returned {resp.status_code}")
            return None

        payload = resp.json()
        if not payload:
            return None

        # The endpoint may return {status, data} or the plan directly.
        data = payload.get("data") if isinstance(payload, dict) else None
        plan = data if data else payload

        # The plan may be a list of records — take the most recent.
        if isinstance(plan, list):
            if not plan:
                return None
            plan = plan[-1]

        if not isinstance(plan, dict):
            return None

        def _clean(v):
            if isinstance(v, datetime):
                return v.isoformat()
            return v

        # Extract the fields the LLM needs. Names vary by integration; we
        # accept multiple common shapes.
        return {
            "decision":   _clean(
                plan.get("consensus_strategy")
                or plan.get("decision")
                or plan.get("recommendation")
                or plan.get("strategy")
            ),
            "sequence":   _clean(plan.get("sequence")),
            "intent":     _clean(plan.get("intent")),
            "reasoning":  _clean(plan.get("reasoning") or plan.get("rationale")),
            "specialty":  _clean(
                plan.get("specialty_recommendations")
                or plan.get("specialty")
            ),
            "unresolved": _clean(plan.get("unresolved")),
            "investigations": _clean(plan.get("investigations") or plan.get("additional_investigations")),
            "created_at": _clean(plan.get("created_at") or plan.get("updated_at")),
        }
    except Exception as e:
        logger.error(f"[first_line_plan] tumour board fetch failed: {e}")
        return None


async def _fetch_saved_strategy(patient_id: str, doctor_id: str) -> Optional[Dict[str, Any]]:
    try:
        doc = await strategy_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id, "active": True},
            sort=[("revision", -1)],
        )
        if not doc:
            return None

        def _clean(v):
            return v.isoformat() if isinstance(v, datetime) else v

        return {
            "strategy":      _clean(doc.get("strategy")),
            "strategy_id":   _clean(doc.get("strategy_id")),
            "strategy_name": _clean(doc.get("strategy_name")),
            "intent":        _clean(doc.get("intent")),
            "role":          _clean(doc.get("role")),
            "why":           _clean(doc.get("why")),
            "regimen":       _clean(doc.get("regimen")),
            "evidence":      _clean(doc.get("evidence")),
            "revision":      int(doc.get("revision", 1)),
        }
    except Exception as e:
        logger.error(f"[first_line_plan] saved strategy lookup failed: {e}")
        return None


async def _fetch_latest_doctor_decision(patient_id: str, doctor_id: str) -> Optional[Dict[str, Any]]:
    try:
        doc = await doctor_decisions_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id, "active": True},
            sort=[("revision", -1)],
        )
        if not doc:
            return None

        def _clean(v):
            return v.isoformat() if isinstance(v, datetime) else v

        return {
            "action":        _clean(doc.get("action")),
            "reason":        _clean(doc.get("reason")),
            "strategy_name": _clean(doc.get("strategy_name")),
            "intent":        _clean(doc.get("intent")),
            "decided_at":    _clean(doc.get("saved_at")),
        }
    except Exception as e:
        logger.error(f"[first_line_plan] doctor decision lookup failed: {e}")
        return None


async def _fetch_prior_decisions(patient_id: str, doctor_id: str) -> Dict[str, Any]:
    tb     = await _fetch_tumour_board(patient_id, doctor_id)
    saved  = await _fetch_saved_strategy(patient_id, doctor_id)
    doctor = await _fetch_latest_doctor_decision(patient_id, doctor_id)
    return {
        "tumour_board":    tb,
        "saved_strategy":  saved,
        "doctor_decision": doctor,
    }


# ============================================================
# POST-PROCESSING
# ============================================================

def _normalize_hero(hero: Any, doctor_name: str) -> Dict[str, str]:
    if not isinstance(hero, dict):
        hero = {}
    eyebrow = _safe_str(hero.get("eyebrow"), "")
    if not eyebrow:
        eyebrow = (
            f"{doctor_name} / First-line plan"
            if doctor_name else "First-line plan"
        )
    return {
        "eyebrow": eyebrow,
        "headline": _safe_str(
            hero.get("headline"),
            "First-line strategy options for clinician review.",
        ),
        "subtitle": _safe_str(
            hero.get("subtitle"),
            "Built from the verified disease, prior decisions and tumour board. You select, modify or reject.",
        ),
    }


def _normalize_tiles(items: Any, expected_labels: List[str]) -> List[Dict[str, str]]:
    by_label: Dict[str, str] = {}
    if isinstance(items, list):
        for it in items:
            if not isinstance(it, dict):
                continue
            label = _safe_str(it.get("label"), "")
            if label:
                by_label[label] = _safe_str(it.get("value"), NOT_DOCUMENTED)
    out = [
        {"label": lbl, "value": by_label.get(lbl, NOT_DOCUMENTED)}
        for lbl in expected_labels
    ]
    seen = set(expected_labels)
    if isinstance(items, list):
        for it in items:
            if not isinstance(it, dict):
                continue
            label = _safe_str(it.get("label"), "")
            if not label or label in seen:
                continue
            value = _safe_str(it.get("value"), NOT_DOCUMENTED)
            if value == NOT_DOCUMENTED:
                continue
            out.append({"label": label, "value": value})
            seen.add(label)
    return out


def _normalize_disease_definition(items: Any) -> List[Dict[str, str]]:
    by_label: Dict[str, Dict[str, str]] = {}
    if isinstance(items, list):
        for it in items:
            if not isinstance(it, dict):
                continue
            label = _safe_str(it.get("label"), "")
            if not label:
                continue
            src = (it.get("source") or "").strip().lower()
            if src not in ALLOWED_SOURCES:
                src = "conditions"
            by_label[label] = {
                "value": _safe_str(it.get("value"), NOT_DOCUMENTED),
                "source": src,
            }
    return [
        {
            "label": lbl,
            "value": by_label.get(lbl, {}).get("value", NOT_DOCUMENTED),
            "source": by_label.get(lbl, {}).get("source", "conditions"),
        }
        for lbl in DISEASE_DEFINITION_LABELS
    ]


def _normalize_intents(items: Any, default_intent: Any) -> Tuple[List[str], str]:
    required = [
        "Curative", "Neoadjuvant", "Adjuvant", "Definitive",
        "Locoregional control", "Metastatic disease control",
        "Palliative / supportive", "Maintenance",
    ]
    allowed = set(required)
    clean: List[str] = []
    if isinstance(items, list):
        for x in items:
            s = _safe_str(x, "")
            if s and s in allowed and s not in clean:
                clean.append(s)
    for x in required:
        if x not in clean:
            clean.append(x)
    di = _safe_str(default_intent, "")
    if di not in allowed:
        di = "Curative"
    return clean, di


def _normalize_strategies(items: Any) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    if not isinstance(items, list):
        return out
    for it in items:
        if not isinstance(it, dict):
            continue
        sid = _safe_str(it.get("id"), "").upper()
        name = _safe_str(it.get("name"), "")
        if not sid or not name:
            continue
        out.append({
            "id":       sid,
            "name":     name,
            "role":     _safe_str(it.get("role"), "—"),
            "why":      _safe_str(it.get("why"), "—"),
            "pre":      _safe_str(it.get("pre"), "—"),
            "cons":     _safe_str(it.get("cons"), "—"),
            "regimen":  _safe_str(it.get("regimen"), "—"),
            "evidence": _safe_str(it.get("evidence"), "—"),
        })
    return out[:6]


def _normalize_change_drivers(items: Any) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    if not isinstance(items, list):
        return out
    for it in items:
        if isinstance(it, str):
            title = _safe_str(it, "")
            if title:
                out.append({"title": title, "impact": "—", "severity": "rv", "source": ""})
            continue
        if not isinstance(it, dict):
            continue
        title = _safe_str(it.get("title"), "")
        if not title:
            continue
        src = (it.get("source") or "").strip().lower()
        if src not in ALLOWED_SOURCES:
            src = ""
        sev = (it.get("severity") or "rv").strip().lower()
        if sev not in ("cr", "rv", "in"):
            sev = "rv"
        out.append({
            "title":    title,
            "impact":   _safe_str(it.get("impact"), "—"),
            "severity": sev,
            "source":   src,
        })
    return out


def _normalize_modality_prep(items: Any) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    if not isinstance(items, list):
        return out
    for it in items:
        if isinstance(it, str):
            text = _safe_str(it, "")
            if text:
                out.append({"text": text, "source": ""})
            continue
        if not isinstance(it, dict):
            continue
        text = _safe_str(it.get("text"), "")
        if not text:
            continue
        src = (it.get("source") or "").strip().lower()
        if src not in ALLOWED_SOURCES:
            src = ""
        out.append({"text": text, "source": src})
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
                "key":     key,
                "label":   label,
                "variant": variant,
                "reason":  _safe_str(it.get("reason"), ""),
            })
    if not raw:
        return []
    raw = raw[:4]
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


def _normalize_story(raw: Dict[str, Any], graph: Dict[str, Any], specialty: str) -> Dict[str, Any]:
    doctor_name = _safe_str(graph.get("doctor_name"), "")

    hero               = _normalize_hero(raw.get("hero"), doctor_name)
    baseline_tiles     = _normalize_tiles(raw.get("baseline_tiles"), BASELINE_TILE_LABELS)
    disease_definition = _normalize_disease_definition(raw.get("disease_definition"))
    intents, default_intent = _normalize_intents(raw.get("intents"), raw.get("default_intent"))
    strategies         = _normalize_strategies(raw.get("strategies"))
    change_drivers     = _normalize_change_drivers(raw.get("change_drivers"))
    modality_prep      = _normalize_modality_prep(raw.get("modality_prep"))
    actions            = _normalize_actions(raw.get("actions"))

    confidence = (
        raw.get("confidence")
        if raw.get("confidence") in VALID_CONFIDENCE
        else "medium"
    )

    return {
        "hero":               hero,
        "baseline_tiles":     baseline_tiles,
        "disease_definition": disease_definition,
        "intents":            intents,
        "default_intent":     default_intent,
        "strategies":         strategies,
        "change_drivers":     change_drivers,
        "modality_prep":      modality_prep,
        "actions":            actions,
        "confidence":         confidence,
        "specialty":          specialty,
    }


def _empty_payload(graph: Dict[str, Any], specialty: str, reason: str) -> Dict[str, Any]:
    doctor_name = _safe_str(graph.get("doctor_name"), "")
    nd = NOT_DOCUMENTED
    required_intents = [
        "Curative", "Neoadjuvant", "Adjuvant", "Definitive",
        "Locoregional control", "Metastatic disease control",
        "Palliative / supportive", "Maintenance",
    ]
    return {
        "hero": {
            "eyebrow": (
                f"{doctor_name} / First-line plan"
                if doctor_name else "First-line plan"
            ),
            "headline": "First-line plan unavailable.",
            "subtitle": reason,
        },
        "baseline_tiles": [
            {"label": l, "value": nd} for l in BASELINE_TILE_LABELS
        ],
        "disease_definition": [
            {"label": l, "value": nd, "source": "conditions"}
            for l in DISEASE_DEFINITION_LABELS
        ],
        "intents":        required_intents,
        "default_intent": "Curative",
        "strategies":     [],
        "change_drivers": [],
        "modality_prep":  [],
        "actions":        [],
        "confidence":     "low",
        "specialty":      specialty,
    }


# ============================================================
# CORE
# ============================================================

async def build_first_line_plan_llm(
    graph: Dict[str, Any],
    specialty: str = "Medical Oncology",
    priors: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    scope = SPECIALTY_SCOPE.get(specialty, "oncology-relevant strategies")
    priors_block = _format_prior_decisions(priors or {})

    messages = [
        SystemMessage(content=FIRST_LINE_PLAN_SYSTEM_PROMPT),
        HumanMessage(content=(
            f"CALLER'S SPECIALTY: {specialty}\n"
            f"SCOPE OF STRATEGIES TO PRODUCE: {scope}\n\n"
            f"{priors_block}\n"
            f"{_format_graph_for_prompt(graph)}\n\n"
            "Produce the JSON object now.\n"
            f"  • Every strategy MUST belong to {specialty}.\n"
            "  • Honour any prior tumour board decision as the FIRST strategy.\n"
            "  • Output only valid JSON. No prose, no markdown, no code fences."
        )),
    ]

    try:
        resp = await reasoning_llm.ainvoke(messages)
        content = _strip_code_fences(resp.content)
        parsed = json.loads(content)
    except json.JSONDecodeError as e:
        logger.error(f"[first_line_plan] LLM returned non-JSON: {e}")
        return _empty_payload(graph, specialty, reason="LLM returned invalid JSON")
    except Exception as e:
        logger.error(f"[first_line_plan] LLM call failed: {e}")
        return _empty_payload(graph, specialty, reason=f"LLM call failed: {e}")

    return _normalize_story(parsed, graph, specialty)


# ============================================================
# ENDPOINTS
# ============================================================

@router.get("/{patient_id}")
async def get_first_line_plan(
    patient_id: str,
    doctor_id: str = Query(..., description="Doctor ID for context fetch"),
    specialty: Optional[str] = Query(None, description="Caller's specialty — strategies are scoped to this"),
) -> Dict[str, Any]:
    """
    Build the full First-Line Plan payload.

    The caller's specialty is honoured: every strategy returned belongs to
    that specialty only. Any prior tumour board plan is fetched and passed
    to the LLM as the strongest prior decision.
    """
    caller_specialty = _canonical_specialty(specialty)

    # 1) Patient graph
    fetcher = PatientContextFetcher()
    try:
        raw = await fetcher.fetch(patient_id, doctor_id)
    except Exception as e:
        logger.error(f"[first_line_plan] fetch failed: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to fetch patient context: {e}")
    if not raw:
        raise HTTPException(status_code=404, detail="Patient context not found.")

    graph = raw if "conditions" in raw else _extract_patient_graph(raw)

    # 2) Prior decisions (tumour board + saved strategy + doctor decision)
    priors = await _fetch_prior_decisions(patient_id, doctor_id)

    # 3) Build — scoped to the caller's specialty
    payload = await build_first_line_plan_llm(
        graph,
        specialty=caller_specialty,
        priors=priors,
    )

    return {
        "status":           "success",
        "generated_at":     datetime.now(timezone.utc).isoformat(),
        "patient_id":       patient_id,
        "doctor_id":        doctor_id,
        "doctor_specialty": caller_specialty,
        "priors_found": {
            "tumour_board":    bool(priors.get("tumour_board")),
            "saved_strategy":  bool(priors.get("saved_strategy")),
            "doctor_decision": bool(priors.get("doctor_decision")),
        },
        **payload,
    }


@router.get("/{patient_id}/raw")
async def get_first_line_plan_raw(
    patient_id: str,
    doctor_id: str = Query(...),
) -> Dict[str, Any]:
    """
    Debug endpoint — returns the raw graph and all prior decisions without
    calling the LLM.
    """
    fetcher = PatientContextFetcher()
    raw = await fetcher.fetch(patient_id, doctor_id)
    if not raw:
        raise HTTPException(status_code=404, detail="Patient context not found.")
    graph = raw if "conditions" in raw else _extract_patient_graph(raw)

    priors = await _fetch_prior_decisions(patient_id, doctor_id)

    return {
        "status":          "success",
        "patient_id":      patient_id,
        "doctor_id":       doctor_id,
        "prior_decisions": priors,
        "graph":           graph,
    }