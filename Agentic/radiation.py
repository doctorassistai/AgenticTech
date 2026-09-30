# radiation.py
"""
Radiation Module Backend — Hybrid
---------------------------------
• Two radiation endpoints  → direct mapping (no LLM)
• Patient graph            → LLM (one call, for the pre-radiotherapy context only)

Endpoints:
    GET /radiation/record/{patient_id}?doctor_id=...&hospital_id=...
    GET /radiation/context/{patient_id}?doctor_id=...&hospital_id=...
    GET /radiation/oars/{patient_id}?doctor_id=...&hospital_id=...
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from loguru import logger
from fastapi import APIRouter, HTTPException, Query
from langchain_core.messages import HumanMessage, SystemMessage

from Agentic.clinical_agents import (
    PatientContextFetcher,
    _extract_patient_graph,
    reasoning_llm,
)


router = APIRouter(prefix="/radiation", tags=["radiation"])

API_BASE_URL = os.getenv("VITE_BACKEND_URL", "https://doctorassist.ai/api/")

RADIOTHERAPY_RECORD_ENDPOINT = os.getenv(
    "RADIOTHERAPY_RECORD_ENDPOINT",
    "hms/users/data/context/get-radiotherapy-record",
)
RT_RECORD_DETAILS_ENDPOINT = os.getenv(
    "RT_RECORD_DETAILS_ENDPOINT",
    "hms/users/data/context/get-rt-record-details",
)

NOT_DOCUMENTED = "Not documented"


# ============================================================
# HELPERS
# ============================================================

def _s(v: Any, fallback: str = NOT_DOCUMENTED) -> str:
    if v is None:
        return fallback
    if isinstance(v, str):
        return v.strip() or fallback
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (list, tuple)):
        return ", ".join(_s(x, "") for x in v if x) or fallback
    if isinstance(v, dict):
        parts = [f"{k}: {_s(vv)}" for k, vv in v.items() if vv]
        return ", ".join(parts) or fallback
    return str(v)


def _normalize_dose_to_gy(value: Any) -> str:
    """Return a numeric string in Gy. Accepts '50', '5000 cGy', '2.0 Gy'."""
    if value is None:
        return ""
    s = str(value).strip().lower()
    if not s or s == "not documented":
        return ""
    m = re.match(r"^([\d.]+)\s*(c?gy)?\s*$", s)
    if not m:
        return ""
    try:
        num = float(m.group(1))
    except ValueError:
        return ""
    unit = (m.group(2) or "gy").strip()
    if unit == "cgy":
        num = num / 100.0
    return f"{num:.2f}".rstrip("0").rstrip(".") or "0"


def _pick_list(block: Any) -> Any:
    """
    Some payload blocks are lists like [{data: {...}}].
    Return the first entry's `.data` if so, else the block itself.
    """
    if isinstance(block, list):
        if not block:
            return {}
        first = block[0]
        if isinstance(first, dict):
            return first.get("data") or first
        return {}
    return block if isinstance(block, dict) else {}


class RadiationFetcher:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=60.0)

    async def _get(self, endpoint: str, params: Dict[str, str]) -> Dict[str, Any]:
        url = f"{API_BASE_URL}{endpoint}"
        try:
            resp = await self.client.get(url, params=params)
            if resp.status_code == 200:
                payload = resp.json()
                if isinstance(payload, dict) and "data" in payload:
                    return payload["data"]
                return payload if isinstance(payload, dict) else {}
            if resp.status_code == 404:
                return {}
            logger.error(
                f"[RadiationFetcher] {endpoint} → {resp.status_code} {resp.text[:200]}"
            )
        except Exception as e:
            logger.error(f"[RadiationFetcher] {endpoint} fetch failed: {e}")
        return {}

    async def fetch(
        self,
        patient_id: str,
        doctor_id: str,
        hospital_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        params = {"patientId": patient_id, "doctorId": doctor_id,"hospitalId": "",}
        if hospital_id:
            params["hospitalId"] = hospital_id
        record = await self._get(RADIOTHERAPY_RECORD_ENDPOINT, params)
        details = await self._get(RT_RECORD_DETAILS_ENDPOINT, params)
        return {"record": record, "details": details}


async def _fetch_patient_graph(patient_id: str, doctor_id: str) -> Dict[str, Any]:
    fetcher = PatientContextFetcher()
    try:
        raw = await fetcher.fetch(patient_id, doctor_id)
    except Exception as e:
        logger.error(f"[radiation] graph fetch failed: {e}")
        return {}
    if not raw:
        return {}
    return raw if "conditions" in raw else _extract_patient_graph(raw)


def _format_graph_for_prompt(graph: Dict[str, Any]) -> str:
    if not graph:
        return "(no patient graph available)"
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
        "=== VITALS SUMMARY ===\n"
        f"{graph.get('vital_summary') or '(empty)'}\n\n"
        "=== SYMPTOM SUMMARY ===\n"
        f"{graph.get('symptom_summary') or '(empty)'}\n\n"
        "=== IMAGING SUMMARY ===\n"
        f"{graph.get('imaging_summary') or '(empty)'}\n"
    )


# ============================================================
# BLOCK ACCESSORS — walk both top-level and history paths
# ============================================================

def _block(record: Dict[str, Any], name: str) -> Dict[str, Any]:
    """
    Return the {name} block from the payload. Handles both:
      - record[name]              → flat dict
      - record.history[name][0]   → [{data: {...}}]
    """
    if not isinstance(record, dict):
        return {}

    direct = record.get(name)
    if direct:
        picked = _pick_list(direct)
        if picked:
            return picked

    history = record.get("history") or {}
    if isinstance(history, dict):
        hist_block = history.get(name)
        if hist_block:
            return _pick_list(hist_block)

    return {}


def _block_list(record: Dict[str, Any], name: str) -> List[Dict[str, Any]]:
    """Return a list of raw entries (not unwrapped) for fields that are
    themselves arrays of objects like {data: {...}}."""
    if not isinstance(record, dict):
        return []
    direct = record.get(name)
    if isinstance(direct, list):
        return direct
    history = record.get("history") or {}
    if isinstance(history, dict):
        hist = history.get(name)
        if isinstance(hist, list):
            return hist
    return []


# ============================================================
# MAPPERS — direct from endpoints (no LLM)
# ============================================================

def _map_phase(record: Dict[str, Any], details: Dict[str, Any]) -> str:
    sessions = (record.get("sessions") or {}).get("treatmentSessions") or []
    delivered = len(sessions)

    ebrt = details.get("ebrt") or {}
    completion = ebrt.get("completion") or {}
    status = str(completion.get("rtCompletion") or "").strip().lower()

    treatment = _block(record, "treatment")
    try:
        total = int(str(treatment.get("numFractions") or "0"))
    except (TypeError, ValueError):
        total = 0

    if status in ("completed", "complete") or (total and delivered >= total):
        return "after"
    if delivered > 0:
        return "during"
    if status in ("in progress", "in_progress", "ongoing"):
        return "during"
    return "planning"


def _map_hero(
    record: Dict[str, Any],
    details: Dict[str, Any],
    phase: str,
    patient_name: Optional[str],
) -> Dict[str, str]:
    patient = record.get("patient") or {}
    if not isinstance(patient, dict):
        patient = {}
    resolved_name = (
        patient.get("patientName")
        or patient.get("firstName")
        or patient_name
        or ""
    )
    label = f"{resolved_name} / Radiation" if resolved_name else "Radiation"

    treatment = _block(record, "treatment")
    intent = _block(record, "intent")
    sessions = (record.get("sessions") or {}).get("treatmentSessions") or []
    delivered = len(sessions)

    try:
        total = int(str(treatment.get("numFractions") or "0"))
    except (TypeError, ValueError):
        total = 0

    intent_word = _s(intent.get("treatmentIntent"), "").capitalize()
    setting_word = _s(intent.get("treatmentSetting"), "").capitalize()
    site = _s(treatment.get("treatmentSite"), "")
    technique = _s(treatment.get("treatmentType"), "").upper()

    # Build headline from available parts
    if phase == "before":
        parts = []
        if intent_word:
            parts.append(intent_word)
        if technique:
            parts.append(technique)
        prefix = " ".join(parts) or "Radiation"
        site_phrase = f" for {site}" if site else ""
        frac_phrase = f" — {total} fractions prescribed" if total else ""
        headline = f"{prefix}{site_phrase} planned{frac_phrase}."
    elif phase == "during":
        prefix = " ".join(p for p in [intent_word, technique] if p) or "Radiation"
        site_phrase = f" for {site}" if site else ""
        frac_phrase = f" — {delivered} of {total} fractions delivered" if total else f" — {delivered} fractions delivered"
        headline = f"{prefix}{site_phrase}, in progress{frac_phrase}."
    elif phase == "after":
        prefix = " ".join(p for p in [intent_word, technique] if p) or "Radiation"
        site_phrase = f" for {site}" if site else ""
        frac_phrase = f" — {delivered} of {total} fractions delivered" if total else f" — {delivered} fractions delivered"
        headline = f"{prefix}{site_phrase}, completed{frac_phrase}."
    else:
        headline = "Radiation review."

    headline = re.sub(r"\s+", " ", headline).strip()

    sub_map = {
        "before": "Prescription, targets, setup, and pending delivery details.",
        "during": "Prescription, delivery log, and ongoing treatment status.",
        "after": "Completed prescription, delivery log, and follow-up.",
    }
    sub = sub_map.get(phase, "Prescription, delivery, and follow-up.")

    return {"patientLabel": label, "headline": headline, "sub": sub}


def _map_prescription(record: Dict[str, Any], details: Dict[str, Any]) -> Dict[str, Any]:
    treatment = _block(record, "treatment")
    intent = _block(record, "intent")
    sessions = record.get("sessions") or {}

    # Consent from details.common or details.history.common
    consent_taken = ""
    consent_date = ""
    common_entries = _block_list(details, "common") or _block_list(
        (details.get("history") or {}), "common"
    )
    for entry in common_entries:
        d = entry.get("data") or {}
        t = d.get("treatment") or {}
        if t.get("consentTaken"):
            consent_taken = t.get("consentTaken")
            consent_date = t.get("consentDate") or ""
            break

    return {
        "intent":          _s(intent.get("treatmentIntent"), "").capitalize() or NOT_DOCUMENTED,
        "setting":         _s(intent.get("treatmentSetting"), "").capitalize() or NOT_DOCUMENTED,
        "technique":       _s(treatment.get("treatmentType"), "").upper() or NOT_DOCUMENTED,
        "machine":         _s(treatment.get("treatmentMachine"), "") or NOT_DOCUMENTED,
        "totalDose":       _normalize_dose_to_gy(treatment.get("totalDose")) or NOT_DOCUMENTED,
        "totalFractions":  _s(treatment.get("numFractions"), "") or NOT_DOCUMENTED,
        "dosePerFraction": _normalize_dose_to_gy(treatment.get("dosePerFraction")) or NOT_DOCUMENTED,
        "schedule":        _s(treatment.get("treatmentDuration"), "") or NOT_DOCUMENTED,
        "boost":           NOT_DOCUMENTED,
        "startDate":       _s(sessions.get("startDate"), "") or NOT_DOCUMENTED,
        "endDate":         _s(sessions.get("endDate"), "") or NOT_DOCUMENTED,
        "planningSystem":  _s(treatment.get("planningSystem"), "") or NOT_DOCUMENTED,
        "doseAlgorithm":   _s(treatment.get("doseCalculationAlgorithm"), "") or NOT_DOCUMENTED,
        "doseGridMm":      _s(treatment.get("doseGridResolutionMm"), "") or NOT_DOCUMENTED,
        "consentTaken":    _s(consent_taken, "") or NOT_DOCUMENTED,
        "consentDate":     _s(consent_date, "") or NOT_DOCUMENTED,
    }


def _map_targets(record: Dict[str, Any]) -> List[Dict[str, str]]:
    intent = _block(record, "intent")
    raw_targets = intent.get("targetVolumes") or []
    out = []
    for t in raw_targets:
        if not isinstance(t, dict):
            continue
        name = t.get("volumeName") or t.get("name")
        if not name:
            continue
        out.append({
            "name":           name,
            "type":           (t.get("type") or "").upper() or NOT_DOCUMENTED,
            "volumeCc":       _s(t.get("volumeCc"), "") or NOT_DOCUMENTED,
            "prescribedDose": _s(t.get("prescribedDose"), "") or NOT_DOCUMENTED,
        })
    return out


def _map_organs_at_risk(record: Dict[str, Any], details: Dict[str, Any]) -> List[Dict[str, str]]:
    intent = _block(record, "intent")
    raw_oars = intent.get("organsAtRisk") or []

    ebrt = details.get("ebrt") or {}
    rt_tracking = ebrt.get("rtTracking") or {}
    organ_statuses = rt_tracking.get("organStatuses") or []
    status_by_organ: Dict[str, Dict[str, Any]] = {}
    for entry in organ_statuses:
        name = entry.get("organ")
        if name:
            status_by_organ[name.lower()] = entry

    out = []
    seen = set()
    for o in raw_oars:
        if not isinstance(o, dict):
            continue
        name = o.get("organName") or o.get("organ")
        if not name:
            continue
        seen.add(name.lower())
        status_entry = status_by_organ.get(name.lower(), {})
        out.append({
            "organ":     name,
            "meanLimit": _s(o.get("meanDoseGy"), "") or NOT_DOCUMENTED,
            "maxLimit":  _s(o.get("maxDoseGy"), "") or NOT_DOCUMENTED,
            "status":    _s(status_entry.get("status"), "") or NOT_DOCUMENTED,
            "details":   _s(status_entry.get("details"), "") or NOT_DOCUMENTED,
        })

    # Add organ statuses not present in the intent block
    for key, entry in status_by_organ.items():
        if key in seen:
            continue
        out.append({
            "organ":     _s(entry.get("organ"), "") or NOT_DOCUMENTED,
            "meanLimit": NOT_DOCUMENTED,
            "maxLimit":  NOT_DOCUMENTED,
            "status":    _s(entry.get("status"), "") or NOT_DOCUMENTED,
            "details":   _s(entry.get("details"), "") or NOT_DOCUMENTED,
        })
    return out


def _map_setup(record: Dict[str, Any]) -> Dict[str, Any]:
    setup = _block(record, "setup")
    devices = setup.get("immobilizationDevices") or []
    immobilisation = ""
    if devices and isinstance(devices, list):
        first = devices[0]
        if isinstance(first, dict):
            immobilisation = first.get("deviceType") or first.get("locationdescription") or ""

    return {
        "immobilisation": _s(immobilisation, "") or NOT_DOCUMENTED,
        "position":       _s(setup.get("positioning"), "").capitalize() or NOT_DOCUMENTED,
        "orientation":    _s(setup.get("orientation"), "").capitalize() or NOT_DOCUMENTED,
        "mouldRoomDate":  _s(setup.get("dateOfMouldRoomVisit"), "") or NOT_DOCUMENTED,
        "technician":     _s(setup.get("technician"), "") or NOT_DOCUMENTED,
        "tattoos":        _s(setup.get("tattooInformation"), "") or NOT_DOCUMENTED,
        "laserMarks":     _s(setup.get("laserAlignmentMarks"), "") or NOT_DOCUMENTED,
        "verification":   _s(setup.get("setupVerificationMethod"), "").upper() or NOT_DOCUMENTED,
        "notes":          _s(setup.get("setupNotes") or setup.get("mouldRoomNotes"), "") or NOT_DOCUMENTED,
    }


def _map_simulation(record: Dict[str, Any]) -> Dict[str, Any]:
    sim = _block(record, "simulation")
    return {
        "date":           _s(sim.get("simulationDate"), "") or NOT_DOCUMENTED,
        "type":           _s(sim.get("simulationType"), "").upper() or NOT_DOCUMENTED,
        "sliceThickness": _s(sim.get("sliceThicknessMm"), "") or NOT_DOCUMENTED,
        "contrast":       _s(sim.get("contrastUsed"), "").capitalize() or NOT_DOCUMENTED,
        "notes":          _s(sim.get("simulationNotes"), "") or NOT_DOCUMENTED,
    }


def _map_beams(record: Dict[str, Any]) -> List[Dict[str, str]]:
    treatment = _block(record, "treatment")
    beams = treatment.get("beamParameters") or []
    out = []
    for b in beams:
        if not isinstance(b, dict):
            continue
        out.append({
            "field":         _s(b.get("fieldName"), "") or NOT_DOCUMENTED,
            "energy":        _s(b.get("energyMv"), "").strip() or NOT_DOCUMENTED,
            "gantry":        _s(b.get("gantryAngle"), "") or NOT_DOCUMENTED,
            "collimator":    _s(b.get("collimatorAngle"), "") or NOT_DOCUMENTED,
            "fieldSize":     _s(b.get("fieldSizeCm"), "") or NOT_DOCUMENTED,
            "ssd":           _s(b.get("ssdCm"), "") or NOT_DOCUMENTED,
            "wedge":         _s(b.get("wedgeAngle"), "") or NOT_DOCUMENTED,
            "muPerFraction": _s(b.get("muPerFraction"), "") or NOT_DOCUMENTED,
        })
    return out


def _map_workflow(record: Dict[str, Any], details: Dict[str, Any]) -> List[Dict[str, str]]:
    setup = _block(record, "setup")
    sim = _block(record, "simulation")
    treatment = _block(record, "treatment")
    sessions = (record.get("sessions") or {}).get("treatmentSessions") or []

    ebrt = details.get("ebrt") or {}
    approvals = ebrt.get("approvals") or {}
    planning = ebrt.get("planning") or {}

    steps = []

    if sim.get("simulationDate"):
        steps.append({
            "step":   "Simulation",
            "status": "done",
            "detail": f"CT simulation on {sim.get('simulationDate')}",
        })

    if treatment.get("planningSystem"):
        algo = treatment.get("doseCalculationAlgorithm") or "algorithm not documented"
        steps.append({
            "step":   "Planning",
            "status": "done",
            "detail": f"Plan in {treatment.get('planningSystem')} ({algo})",
        })

    if approvals.get("mpSigned") or approvals.get("roSigned") or approvals.get("rttSigned"):
        steps.append({
            "step":   "QA and approvals",
            "status": "done",
            "detail": f"RO: {approvals.get('roName') or '—'}, "
                      f"MP: {approvals.get('mpName') or '—'}, "
                      f"RTT: {approvals.get('rttName') or '—'}",
        })

    try:
        total = int(str(treatment.get("numFractions") or "0"))
    except (TypeError, ValueError):
        total = 0

    if sessions:
        steps.append({
            "step":   "Delivery",
            "status": "in_progress" if (total and len(sessions) < total) else "done",
            "detail": f"{len(sessions)} of {total or '?'} fractions delivered",
        })
    else:
        steps.append({
            "step":   "Delivery",
            "status": "pending",
            "detail": "Not yet started",
        })

    if planning.get("verificationType"):
        freq = planning.get("verificationFrequency") or ""
        steps.append({
            "step":   "Image guidance",
            "status": "in_progress" if sessions else "pending",
            "detail": f"{planning.get('verificationType')} {freq}".strip(),
        })

    return steps


def _map_delivery(record: Dict[str, Any]) -> Dict[str, Any]:
    sessions_meta = record.get("sessions") or {}
    sessions = sessions_meta.get("treatmentSessions") or []
    imaging = record.get("imaging") or {}
    shifts = imaging.get("imagingShifts") or []
    treatment = _block(record, "treatment")

    try:
        planned_fractions = int(str(treatment.get("numFractions") or "0"))
    except (TypeError, ValueError):
        planned_fractions = 0

    planned_dose = _normalize_dose_to_gy(treatment.get("totalDose"))

    shift_by_session: Dict[str, Dict[str, Any]] = {}
    for sh in shifts:
        if not isinstance(sh, dict):
            continue
        sid = str(sh.get("session") or sh.get("session_number") or "").strip()
        if sid:
            shift_by_session[sid] = sh

    log_rows = []
    delivered_dose = 0.0
    for i, s in enumerate(sessions, 1):
        if not isinstance(s, dict):
            continue
        sid = str(s.get("session") or i).strip()
        sh = shift_by_session.get(sid, {})

        shift_parts = []
        for key, label in (("shiftXMm", "X"), ("shiftYMm", "Y"), ("shiftZMm", "Z")):
            v = sh.get(key) or s.get(key)
            if v is not None and str(v).strip() != "":
                shift_parts.append(f"{label} {v} mm")
        shift_str = ", ".join(shift_parts) if shift_parts else NOT_DOCUMENTED

        dose_raw = s.get("deliveredDoseGy")
        try:
            delivered_dose += float(dose_raw or 0)
        except (TypeError, ValueError):
            pass

        log_rows.append({
            "date":          _s(s.get("date"), "") or NOT_DOCUMENTED,
            "time":          _s(s.get("time"), "") or NOT_DOCUMENTED,
            "machine":       _s(s.get("machine"), "") or NOT_DOCUMENTED,
            "fraction":      sid or str(i),
            "dose":          f"{dose_raw} Gy" if dose_raw else NOT_DOCUMENTED,
            "durationMin":   _s(s.get("treatmentTimeMin"), "") or NOT_DOCUMENTED,
            "shift":         shift_str,
            "rotation":      _s(sh.get("rotation"), "") or NOT_DOCUMENTED,
            "residualError": _s(sh.get("residualErrorAfterShift"), "") or NOT_DOCUMENTED,
            "notes":         _s(s.get("notes"), ""),
        })

    return {
        "startDate":          _s(sessions_meta.get("startDate"), "") or NOT_DOCUMENTED,
        "endDate":            _s(sessions_meta.get("endDate"), "") or NOT_DOCUMENTED,
        "deliveredFractions": str(len(sessions)),
        "totalFractions":     str(planned_fractions) if planned_fractions else NOT_DOCUMENTED,
        "deliveredDoseGy":    f"{delivered_dose:.2f}".rstrip("0").rstrip(".") or "0",
        "totalDoseGy":        planned_dose or NOT_DOCUMENTED,
        "machine":            _s(treatment.get("treatmentMachine"), "") or NOT_DOCUMENTED,
        "sessions":           log_rows,
    }


def _map_approvals(record: Dict[str, Any], details: Dict[str, Any]) -> Dict[str, Any]:
    ebrt = details.get("ebrt") or {}
    approvals = ebrt.get("approvals") or {}
    planning = ebrt.get("planning") or {}

    consent_taken = ""
    consent_date = ""
    common_entries = _block_list(details, "common") or _block_list(
        (details.get("history") or {}), "common"
    )
    for entry in common_entries:
        d = entry.get("data") or {}
        t = d.get("treatment") or {}
        if t.get("consentTaken"):
            consent_taken = t.get("consentTaken")
            consent_date = t.get("consentDate") or ""
            break

    return {
        "consentTaken": _s(consent_taken, "") or NOT_DOCUMENTED,
        "consentDate":  _s(consent_date, "") or NOT_DOCUMENTED,
        "roName":       _s(approvals.get("roName"), "") or NOT_DOCUMENTED,
        "roSigned":     approvals.get("roSigned"),
        "mpName":       _s(approvals.get("mpName"), "") or NOT_DOCUMENTED,
        "mpSigned":     approvals.get("mpSigned"),
        "rttName":      _s(approvals.get("rttName"), "") or NOT_DOCUMENTED,
        "rttSigned":    approvals.get("rttSigned"),
        "peerReview":   _s(planning.get("verification"), "") or NOT_DOCUMENTED,
    }


def _map_adverse_events(details: Dict[str, Any]) -> List[Dict[str, Any]]:
    ebrt = details.get("ebrt") or {}
    events = ebrt.get("adverseEvents") or []
    out = []
    for e in events:
        if not isinstance(e, dict):
            continue
        out.append({
            "date":        _s(e.get("date"), "") or NOT_DOCUMENTED,
            "event":       _s(e.get("event"), "") or NOT_DOCUMENTED,
            "grade":       _s(e.get("grade"), "") or NOT_DOCUMENTED,
            "system":      _s(e.get("gradingSystem"), "") or NOT_DOCUMENTED,
            "management":  _s(e.get("management"), "") or NOT_DOCUMENTED,
            "anticipated": False,
        })
    return out


def _map_follow_up(details: Dict[str, Any]) -> Dict[str, Any]:
    ebrt = details.get("ebrt") or {}
    fu = ebrt.get("followUp") or {}
    return {
        "date":           _s(fu.get("date"), "") or NOT_DOCUMENTED,
        "time":           _s(fu.get("time"), "") or NOT_DOCUMENTED,
        "imagingAdvised": _s(fu.get("imagingAdvised"), "") or NOT_DOCUMENTED,
        "plan":           _s(fu.get("postCompletionPlan"), "") or NOT_DOCUMENTED,
        "advice":         _s(fu.get("adviceOnCompletion"), "") or NOT_DOCUMENTED,
    }


def _map_adaptive(details: Dict[str, Any]) -> Dict[str, Any]:
    ebrt = details.get("ebrt") or {}
    planning = ebrt.get("planning") or {}
    flag_raw = str(planning.get("adaptiveRadiation") or "").lower()
    if flag_raw in ("no", "false", ""):
        return {"flag": False, "reason": NOT_DOCUMENTED, "recommend": NOT_DOCUMENTED}
    return {
        "flag":      True,
        "reason":    _s(planning.get("adaptiveReason"), "") or NOT_DOCUMENTED,
        "recommend": NOT_DOCUMENTED,
    }


# ============================================================
# CONTEXT — LLM (graph only)
# ============================================================

CONTEXT_PROMPT = """
You are a radiation oncology documentation assistant. You receive a RAW
PATIENT GRAPH (conditions, medications, procedures, and free-text
summaries).

Produce a PRE-RADIOTHERAPY CONTEXT snapshot with these EXACTLY seven rows
in this order:

  1. "Primary diagnosis"
  2. "Prior treatment"
  3. "Prior radiation"
  4. "Radiation intent"
  5. "Comorbidities and fitness"
  6. "Medications and allergies"
  7. "Dental and skin"

Return EXACTLY this JSON:
{
  "context": [
    {
      "item":    "<the exact label above>",
      "finding": "<what the graph says, or 'Not documented'>",
      "basis":   "Documented | Clinical | Imaging | Prior treatment | Not documented"
    }
  ]
}

RULES:
  • Read every summary field. Cross-check.
  • Every date VERBATIM. Never compute.
  • Missing → "Not documented".
  • For medications: read the graph's `medications` and `medication_summary`.
  • For allergies: read the graph's conditions or medication_summary.
  • Do NOT include vital-sign dumps. Summarise.
  • Output MUST be ONE valid JSON object. No prose, no markdown.
"""


async def _build_context_llm(graph: Dict[str, Any]) -> List[Dict[str, str]]:
    if not graph:
        return [
            {"item": label, "finding": NOT_DOCUMENTED, "basis": "Not documented"}
            for label in [
                "Primary diagnosis",
                "Prior treatment",
                "Prior radiation",
                "Radiation intent",
                "Comorbidities and fitness",
                "Medications and allergies",
                "Dental and skin",
            ]
        ]

    messages = [
        SystemMessage(content=CONTEXT_PROMPT),
        HumanMessage(content=(
            f"{_format_graph_for_prompt(graph)}\n\n"
            "Produce the JSON object now. No prose, no markdown, no code fences."
        )),
    ]
    try:
        resp = await reasoning_llm.ainvoke(messages)
        content = resp.content.strip()
        if content.startswith("```"):
            content = content.split("```", 2)[1]
            if content.startswith("json"):
                content = content[4:]
        parsed = json.loads(content.strip())
        ctx = parsed.get("context")
        if isinstance(ctx, list) and ctx:
            return ctx
    except json.JSONDecodeError as e:
        logger.error(f"[radiation] context LLM non-JSON: {e}")
    except Exception as e:
        logger.error(f"[radiation] context LLM failed: {e}")

    return [
        {"item": label, "finding": NOT_DOCUMENTED, "basis": "Not documented"}
        for label in [
            "Primary diagnosis",
            "Prior treatment",
            "Prior radiation",
            "Radiation intent",
            "Comorbidities and fitness",
            "Medications and allergies",
            "Dental and skin",
        ]
    ]


# ============================================================
# ENDPOINTS
# ============================================================

@router.get("/record/{patient_id}")
async def get_radiation_record(
    patient_id: str,
    doctor_id: str = Query(...),
    hospital_id: Optional[str] = Query(None),
    patient_name: Optional[str] = Query(None),
) -> Dict[str, Any]:
    payloads = await RadiationFetcher().fetch(patient_id, doctor_id, hospital_id)

    record = payloads.get("record") or {}
    details = payloads.get("details") or {}

    logger.info(
        f"[radiation] record keys: "
        f"{list(record.keys()) if isinstance(record, dict) else 'not-dict'}"
    )
    logger.info(
        f"[radiation] treatment block keys: "
        f"{list(_block(record, 'treatment').keys())}"
    )
    logger.info(
        f"[radiation] intent block keys: "
        f"{list(_block(record, 'intent').keys())}"
    )

    if not record and not details:
        return {
            "status": "success",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "has_radiation_record": False,
            "phase": "planning",
            "hero": {
                "patientLabel": f"{patient_name} / Radiation"
                if patient_name
                else "Radiation",
                "headline": "No radiation plan is active for this patient at this stage.",
                "sub": "The Radiation panel opens when a case is referred to radiation oncology.",
            },
            "prescription": None,
            "targets": [],
            "organs_at_risk": [],
            "setup": None,
            "simulation": None,
            "beams": [],
            "workflow": [],
            "delivery": None,
            "approvals": None,
            "adverseEvents": [],
            "followUp": None,
            "adaptive": None,
            "confidence": "high",
        }

    phase = _map_phase(record, details)

    return {
        "status": "success",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "has_radiation_record": True,
        "phase": phase,
        "hero": _map_hero(record, details, phase, patient_name),
        "prescription": _map_prescription(record, details),
        "targets": _map_targets(record),
        "organs_at_risk": _map_organs_at_risk(record, details),
        "setup": _map_setup(record),
        "simulation": _map_simulation(record),
        "beams": _map_beams(record),
        "workflow": _map_workflow(record, details),
        "delivery": _map_delivery(record),
        "approvals": _map_approvals(record, details),
        "adverseEvents": _map_adverse_events(details),
        "followUp": _map_follow_up(details),
        "adaptive": _map_adaptive(details),
        "confidence": "high",
    }


@router.get("/context/{patient_id}")
async def get_radiation_context(
    patient_id: str,
    doctor_id: str = Query(...),
    hospital_id: Optional[str] = Query(None),
) -> Dict[str, Any]:
    graph = await _fetch_patient_graph(patient_id, doctor_id)
    context = await _build_context_llm(graph)

    return {
        "status": "success",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "patient_id": patient_id,
        "context": context,
    }


@router.get("/oars/{patient_id}")
async def get_radiation_oars(
    patient_id: str,
    doctor_id: str = Query(...),
    hospital_id: Optional[str] = Query(None),
) -> Dict[str, Any]:
    payloads = await RadiationFetcher().fetch(patient_id, doctor_id, hospital_id)

    record = payloads.get("record") or {}
    details = payloads.get("details") or {}

    if not record and not details:
        return {
            "status": "success",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "patient_id": patient_id,
            "available": False,
            "summary": None,
            "oars": [],
        }

    oars = _map_organs_at_risk(record, details)

    safe_count = sum(1 for o in oars if o.get("status") == "Safe")
    total = len(oars)
    summary = (
        f"{safe_count} of {total} organs at risk documented as Safe"
        if total
        else "No OAR data documented"
    )

    return {
        "status": "success",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "patient_id": patient_id,
        "available": bool(oars),
        "summary": summary,
        "oars": oars,
    }