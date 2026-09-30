# toxicity.py
"""
Toxicity Backend — LLM-resolved cause + next action, unified across
chemo, radiation, and surgical records.

Reads:
  • Patient graph (conditions, medications, procedures, summaries).
  • Chemo record      → data.cycles[N].post_chemo.toxicities
  • Radiation record  → data.ebrt.adverseEvents
  • Surgical booking  → data.post_op.complications, anaesthesia blocks

For each toxicity event, the LLM resolves:
  • `drug`   — the likely cause, grounded in the cycle's regimen and
               the CTCAE event profile. Removes antiemetics, steroids,
               and other supportive-care drugs from the candidate list.
  • `action` — the next clinical step (continue, hold, reduce dose,
               add supportive care, order a test), grounded in the
               event, the grade, and the patient's record.

Endpoint (no prefix):
    POST /generate_toxicity
"""
from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException
from loguru import logger
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from Agentic.clinical_agents import (
    PatientContextFetcher,
    _extract_patient_graph,
    reasoning_llm,
)

load_dotenv()

API_BASE_URL = os.getenv("VITE_BACKEND_URL", "https://doctorassist.ai/api/")

router = APIRouter(tags=["toxicity"])

NOT_DOCUMENTED = "Not documented"
VALID_CONFIDENCE = {"low", "medium", "high"}


# ============================================================
# SCHEMAS
# ============================================================

class GenerateToxicityRequest(BaseModel):
    patient_id:  str            = Field(..., description="Patient ID")
    doctor_id:   str            = Field(..., description="Doctor ID")
    hospital_id: Optional[str]  = Field(None, description="Hospital ID (for RT record)")


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


def _normalize_grade(raw: Any) -> str:
    if raw is None:
        return "0"
    s = str(raw).strip().lower()
    import re as _re
    m = _re.search(r"\b([0-5])\b", s)
    if m:
        return m.group(1)
    return "0"


def _grade_trajectory(current_grade: str) -> List[int]:
    try:
        g = int(current_grade)
    except (TypeError, ValueError):
        g = 0
    if g <= 0:
        return [0, 0, 0, 0, 0]
    if g == 1:
        return [1, 1, 1, 1, 1]
    if g == 2:
        return [1, 1, 2, 2, 2]
    if g == 3:
        return [0, 1, 2, 3, 3]
    if g == 4:
        return [0, 1, 2, 4, 4]
    return [0, 0, 0, 0, 5]


# ============================================================
# SOURCE FETCHERS
# ============================================================

async def _fetch_chemo_record(patient_id: str) -> Dict[str, Any]:
    url = f"{API_BASE_URL}hms/users/data/context/get-chemotherapy-record?patientId={patient_id}"
    try:
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.get(url)
        if r.status_code != 200:
            logger.info(f"[toxicity] chemo record HTTP {r.status_code}")
            return {}
        return r.json().get("data", {}) or {}
    except Exception as e:
        logger.error(f"[toxicity] chemo fetch failed: {e}")
        return {}


async def _fetch_rt_record(patient_id: str, doctor_id: str, hospital_id: Optional[str]) -> Dict[str, Any]:
    if not hospital_id:
        return {}
    url = (
        f"{API_BASE_URL}hms/users/data/context/get-rt-record-details"
        f"?patientId={patient_id}&doctorId={doctor_id}&hospitalId={hospital_id}"
    )
    try:
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.get(url)
        if r.status_code != 200:
            logger.info(f"[toxicity] RT record HTTP {r.status_code}")
            return {}
        return r.json().get("data", {}) or {}
    except Exception as e:
        logger.error(f"[toxicity] RT fetch failed: {e}")
        return {}


async def _fetch_surgical_booking(patient_id: str) -> Dict[str, Any]:
    url = f"{API_BASE_URL}hms/users/data/surgical-oncology/patient/{patient_id}/latest-booking"
    try:
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.get(url)
        if r.status_code != 200:
            logger.info(f"[toxicity] surgical booking HTTP {r.status_code}")
            return {}
        return r.json().get("data", {}) or {}
    except Exception as e:
        logger.error(f"[toxicity] surgical fetch failed: {e}")
        return {}


# ============================================================
# EXTRACTORS (produce raw events; cause/action resolved by LLM later)
# ============================================================

def _extract_chemo_events(chemo: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    cycles = chemo.get("cycles", {}) or {}
    for cycle_num, cycle_data in cycles.items():
        post = cycle_data.get("post_chemo", {}) or {}
        regimen_drugs = [
            _safe_str(d.get("name"), "")
            for d in (cycle_data.get("regimen", {}) or {}).get("drugs", []) or []
            if isinstance(d, dict)
        ]
        for tox in post.get("toxicities", []) or []:
            if not isinstance(tox, dict):
                continue
            event = _safe_str(tox.get("event"), "")
            if not event:
                continue
            out.append({
                "event":        event,
                "modality":     "chemo",
                "system":       _safe_str(tox.get("system"), ""),
                "onset":        _safe_str(tox.get("onset"), "—"),
                "grade":        _normalize_grade(tox.get("grade")),
                "attribution":  _safe_str(tox.get("attribution"), ""),
                "management":   _safe_str(tox.get("managementPlace"), "—"),
                "resolution":   _safe_str(tox.get("resolutionDate"), ""),
                "explicit_drug": _safe_str(tox.get("drug"), ""),
                "source":       "chemo_record",
                "cycle":        cycle_num,
                "cycle_drugs":  regimen_drugs,
                "raw":          tox,
            })
    return out


def _extract_rt_events(rt: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    ebrt = rt.get("ebrt", {}) or {}
    for ev in ebrt.get("adverseEvents", []) or []:
        if not isinstance(ev, dict):
            continue
        event = _safe_str(ev.get("event"), "")
        if not event:
            continue
        out.append({
            "event":       event,
            "modality":    "radiation",
            "system":      "",
            "onset":       _safe_str(ev.get("date"), "—"),
            "grade":       _normalize_grade(ev.get("grade")),
            "attribution": "",
            "management":  _safe_str(ev.get("management"), "—"),
            "resolution":  "",
            "explicit_drug": "Radiation",
            "source":      "rt_record",
            "cycle":       None,
            "cycle_drugs": [],
            "raw":         ev,
        })
    return out


def _extract_surgical_events(booking: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []

    post = booking.get("post_op", {}) or {}
    for comp in (post.get("complications") or []):
        text = comp if isinstance(comp, str) else _safe_str(comp.get("event"), "")
        if not text:
            continue
        out.append({
            "event":        text,
            "modality":     "surgery",
            "system":       "",
            "onset":        _safe_str(post.get("pathReportDate"), "Post-operative"),
            "grade":        "0",
            "attribution":  "surgical",
            "management":   _safe_str(post.get("description"), "—"),
            "resolution":   "",
            "explicit_drug": "Surgery",
            "source":       "surgery_record",
            "cycle":        None,
            "cycle_drugs":  [],
            "raw":          comp,
        })

    # Anaesthetic complications
    io = (booking.get("anaesthesia", {}) or {}).get("io", {}) or {}
    for comp in (io.get("complications") or []):
        text = comp if isinstance(comp, str) else _safe_str(comp.get("event"), "")
        if not text:
            continue
        out.append({
            "event":        text,
            "modality":     "surgery",
            "system":       "",
            "onset":        "Intra-operative",
            "grade":        "0",
            "attribution":  "anaesthetic",
            "management":   _safe_str(io.get("complicationDetails"), "—"),
            "resolution":   "",
            "explicit_drug": "Anaesthesia",
            "source":       "surgery_record",
            "cycle":        None,
            "cycle_drugs":  [],
            "raw":          comp,
        })
    return out


# ============================================================
# MERGE (no cause/action resolution yet — LLM does that)
# ============================================================

def _merge_toxicity_events(
    chemo: List[Dict[str, Any]],
    rt: List[Dict[str, Any]],
    surgical: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    merged: List[Dict[str, Any]] = []
    seen = set()

    for ev in (chemo + rt + surgical):
        key = (ev["event"].lower().strip(), _safe_str(ev["onset"], "").lower())
        if key in seen:
            continue
        seen.add(key)

        grade_str = ev.get("grade", "0")
        try:
            grade_int = int(grade_str)
        except (TypeError, ValueError):
            grade_int = 0

        ev["g"]   = _grade_trajectory(str(grade_int))
        ev["now"] = grade_int

        if ev.get("resolution"):
            ev["st"] = "Resolved"
        elif grade_int == 0:
            ev["st"] = "Resolved"
        elif grade_int >= 3:
            ev["st"] = "Worsening"
        else:
            ev["st"] = "Ongoing"

        merged.append(ev)

    merged.sort(key=lambda x: (-x["now"], str(x.get("cycle") or "")))
    return merged


# ============================================================
# LLM CALL — cause + action + hero + grading assistant + similar patients
# ============================================================

TOXICITY_SYSTEM_PROMPT = """
You are a clinical documentation assistant supporting an oncologist.
You will receive:
  1. A UNIFIED TOXICITY EVENT LIST — every event recorded in the patient's
     chemo record, radiation record, and surgical record, already merged
     and tagged with its modality (`chemo` | `radiation` | `surgery`).
     Each event also carries the list of drugs given in that cycle
     (`cycle_drugs`) when the event is chemo-related.
  2. THE PATIENT GRAPH — conditions, medications, procedures, summaries.

Your job is to produce THREE things for each event, and one summary block:

  A. `drug`   — the LIKELY CAUSE of this event.
        • If the record already names a drug explicitly (`explicit_drug`),
          and it is not a generic word like "Chemotherapy" or
          "Not documented", use it.
        • Otherwise, choose from `cycle_drugs` the drug(s) that are
          plausibly known to cause this CTCAE event. Remove antiemetics,
          corticosteroids, analgesics, and other supportive-care drugs
          (ondansetron, dexamethasone, paracetamol, pantoprazole,
          metoclopramide, domperidone, etc.) — they are never the cause
          of the cytotoxic side effect they are given to prevent.
        • If `modality` is `radiation`, use "Radiation".
        • If `modality` is `surgery` and the event is anaesthetic
          (e.g. sore throat, aspiration, arrhythmia during anaesthesia),
          use "Anaesthesia"; otherwise use "Surgery".
        • If nothing plausibly matches, output "Not documented".

  B. `action` — the NEXT CLINICAL STEP for this event, one short sentence.
        Consider the grade:
          Grade 1 → "Continue; symptomatic support."
          Grade 2 → "Continue; add supportive care; monitor."
          Grade 3 → "Hold; consider dose reduction; consider growth factor."
          Grade 4 → "Hold; urgent management; consider stopping."
        Also consider the specific event:
          • Febrile neutropenia → "Hold; cultures; start antibiotics."
          • Nausea / vomiting → "Optimise antiemetics."
          • Mucositis → "Analgesia, soft diet, nutrition review."
          • Neuropathy grade 2 → "Consider dose reduction; monitor gait."
          • Cardiotoxicity → "Hold; cardiology review; repeat ECHO."
          • Proteinuria → "Check urine PCR; hold if confirmed."
          • Hypertension grade 2 → "Start/optimise antihypertensive."
        Keep it under 12 words. Do NOT write a paragraph.

  C. `cause_confidence` — one of `high` | `medium` | `low`.
        high   → the drug is named explicitly or is the only cytotoxic drug.
        medium → the drug is inferred from a small, unambiguous regimen.
        low    → the cause is not determinable from the record.

Then, in addition:

  D. `hero` — one sentence summarising the current toxicity state:
        "Worst current toxicity: <event>, grade <N>. <X> events ongoing or worsening."
     If no events: "No treatment-related toxicity recorded."

  E. `grading_assistant` — pull ANC, platelets, haemoglobin, creatinine
     from the graph's lab_summary or from the most recent cycle's
     pre_chemo.currentLabs. ALWAYS return the values in absolute
     cells/µL (multiply ×10³/µL values by 1000). Output null if absent.

  F. `similar_patients` — may be empty. Do NOT invent cohort numbers.

Return EXACTLY this JSON shape:

{
  "hero": {
    "eyebrow": "<patient name + ' / Toxicity', or 'Toxicity'>",
    "headline": "...",
    "subtitle": "Graded by CTCAE v5.0, tracked over time and cumulatively, and linked to the likely cause."
  },
  "grading_assistant": {
    "anc":  <number or null>,
    "plt":  <number or null>,
    "hb":   <number or null>,
    "cr":   <number or null>,
    "source": "<source field>"
  },
  "similar_patients": {
    "n": <int or 0>,
    "text": "...",
    "caution": "Registry association only, not a recommendation."
  },
  "events": [
    {
      "event":             "<exact same string as input>",
      "modality":          "chemo | radiation | surgery",
      "drug":              "<likely cause, resolved as above>",
      "action":            "<next clinical step, one short sentence>",
      "cause_confidence":  "high | medium | low"
    }
  ],
  "confidence": "low | medium | high"
}

RULES:
  • Do NOT change the `event`, `modality`, `onset`, `grade`, or `st` fields
    for any event. Return the same event strings exactly.
  • Do NOT invent events. Only return entries for the events provided.
  • The output MUST be a single valid JSON object. No prose, no markdown,
    no code fences.
"""


async def _build_llm_extras(
    graph: Dict[str, Any],
    unified_events: List[Dict[str, Any]],
) -> Dict[str, Any]:
    if not unified_events:
        return {
            "hero": {
                "eyebrow": "Toxicity",
                "headline": "No treatment-related toxicity recorded.",
                "subtitle": "Graded by CTCAE v5.0, tracked over time and cumulatively, and linked to the likely cause.",
            },
            "grading_assistant": {"anc": None, "plt": None, "hb": None, "cr": None, "source": "lab_summary"},
            "similar_patients": {"n": 0, "text": "", "caution": "Registry association only, not a recommendation."},
            "events": [],
            "confidence": "low",
        }

    # Send only the fields the LLM needs — no raw patient dicts
    simplified = []
    for ev in unified_events:
        simplified.append({
            "event":         ev["event"],
            "modality":      ev["modality"],
            "system":        ev.get("system", ""),
            "onset":         ev.get("onset", ""),
            "grade":         ev.get("grade", "0"),
            "attribution":   ev.get("attribution", ""),
            "explicit_drug": ev.get("explicit_drug", ""),
            "cycle_drugs":   ev.get("cycle_drugs", []),
            "cycle":         ev.get("cycle"),
        })

    events_json = json.dumps(simplified, indent=2, default=str)
    conditions_json = json.dumps(graph.get("conditions", []), default=str)
    medications_json = json.dumps(graph.get("medications", []), default=str)
    lab_summary = graph.get("lab_summary") or "(empty)"

    messages = [
        SystemMessage(content=TOXICITY_SYSTEM_PROMPT),
        HumanMessage(content=(
            f"=== UNIFIED TOXICITY EVENTS ===\n{events_json}\n\n"
            f"=== PATIENT CONDITIONS ===\n{conditions_json}\n\n"
            f"=== PATIENT MEDICATIONS ===\n{medications_json}\n\n"
            f"=== LAB SUMMARY ===\n{lab_summary}\n\n"
            "Produce the JSON object now. Keep the same event strings. "
            "Resolve `drug` and `action` for each event. Output only JSON."
        )),
    ]

    try:
        resp = await reasoning_llm.ainvoke(messages)
        content = _strip_code_fences(resp.content)
        parsed = json.loads(content)
    except Exception as e:
        logger.error(f"[toxicity] LLM extras failed: {e}")
        return {
            "hero": {
                "eyebrow": "Toxicity",
                "headline": f"{len(unified_events)} toxicity event(s) recorded.",
                "subtitle": "Graded by CTCAE v5.0, tracked over time and cumulatively.",
            },
            "grading_assistant": {"anc": None, "plt": None, "hb": None, "cr": None, "source": "lab_summary"},
            "similar_patients": {"n": 0, "text": "", "caution": "Registry association only, not a recommendation."},
            "events": [],
            "confidence": "medium",
        }

    return parsed


# ============================================================
# POST-PROCESSING — merge LLM cause/action back into the event list
# ============================================================

def _normalize_cell_count(v: Any) -> Optional[int]:
    """Expand ×10³/µL values to absolute cells/µL."""
    if v is None:
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if n < 100:
        n *= 1000
    return int(n)


def _merge_llm_into_events(
    unified_events: List[Dict[str, Any]],
    llm_events: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Attach LLM-resolved `drug`, `action`, `cause_confidence` to each event
    by matching on the event string + modality. If the LLM dropped an
    event, keep the original with a safe fallback.
    """
    by_key = {}
    for le in (llm_events or []):
        key = (
            _safe_str(le.get("event"), "").strip().lower(),
            _safe_str(le.get("modality"), "").strip().lower(),
        )
        by_key[key] = le

    out: List[Dict[str, Any]] = []
    for ev in unified_events:
        key = (ev["event"].strip().lower(), ev["modality"].strip().lower())
        llm = by_key.get(key, {})

        # If the LLM gave a drug/action, use it; otherwise fall back
        drug = _safe_str(llm.get("drug"), "") or ev.get("explicit_drug") or "Not documented"
        action = _safe_str(llm.get("action"), "") or ev.get("management") or "—"
        cause_conf = _safe_str(llm.get("cause_confidence"), "low")

        out.append({
            **ev,
            "drug":             drug,
            "action":           action,
            "cause_confidence": cause_conf,
        })
    return out


# ============================================================
# ENDPOINT
# ============================================================

@router.post("/generate_toxicity")
async def generate_toxicity(payload: GenerateToxicityRequest) -> Dict[str, Any]:
    # 1) Patient graph
    fetcher = PatientContextFetcher()
    try:
        raw = await fetcher.fetch(payload.patient_id, payload.doctor_id)
    except Exception as e:
        logger.error(f"[toxicity] graph fetch failed: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to fetch patient context: {e}")

    graph = raw if "conditions" in raw else _extract_patient_graph(raw)

    # 2) Source records in parallel
    chemo, rt, surgery = await asyncio.gather(
        _fetch_chemo_record(payload.patient_id),
        _fetch_rt_record(payload.patient_id, payload.doctor_id, payload.hospital_id),
        _fetch_surgical_booking(payload.patient_id),
    )

    # 3) Extract per source
    chemo_events = _extract_chemo_events(chemo)
    rt_events = _extract_rt_events(rt)
    surgical_events = _extract_surgical_events(surgery)

    # 4) Merge
    unified = _merge_toxicity_events(chemo_events, rt_events, surgical_events)

    # 5) LLM resolves drug + action + hero + grading assistant
    extras = await _build_llm_extras(graph, unified)

    # 6) Merge LLM-resolved drug/action back into the unified list
    events_with_cause = _merge_llm_into_events(
        unified,
        extras.get("events", []),
    )

    # 7) Normalize grading assistant values to absolute cells/µL
    ga_raw = extras.get("grading_assistant") or {}
    ga = {
        "anc":  _normalize_cell_count(ga_raw.get("anc")),
        "plt":  _normalize_cell_count(ga_raw.get("plt")),
        "hb":   ga_raw.get("hb"),
        "cr":   ga_raw.get("cr"),
        "source": ga_raw.get("source") or "lab_summary",
    }

    hero = extras.get("hero") or {
        "eyebrow": "Toxicity",
        "headline": f"{len(events_with_cause)} toxicity event(s) recorded.",
        "subtitle": "Graded by CTCAE v5.0, tracked over time and cumulatively.",
    }

    similar = extras.get("similar_patients") or {
        "n": 0, "text": "",
        "caution": "Registry association only, not a recommendation.",
    }

    return {
        "status":         "success",
        "generated_at":   datetime.now(timezone.utc).isoformat(),
        "patient_id":     payload.patient_id,
        "doctor_id":      payload.doctor_id,
        "source_counts": {
            "chemo":     len(chemo_events),
            "radiation": len(rt_events),
            "surgery":   len(surgical_events),
            "merged":    len(events_with_cause),
        },
        "hero":               hero,
        "grading_assistant":  ga,
        "similar_patients":   similar,
        "tox":                events_with_cause,
        "confidence":         extras.get("confidence")
                              if extras.get("confidence") in VALID_CONFIDENCE
                              else "medium",
    }