# surgery.py
"""
Surgery Module Backend — LLM-first, schema-agnostic
----------------------------------------------------
One file, three endpoints, no Python-side field mapping.

The surgical booking payload varies by hospital, by procedure, by
cancer type, by phase. Field names differ. Nesting differs. Optional
fields appear in some payloads and not others.

Instead of guessing at field names in Python, every endpoint sends the
raw payload to the LLM and asks for the fixed frontend contract back.

Endpoints:
    GET /surgery-record/{patient_id}?doctor_id=...
    GET /surgery-presurgery-details/{patient_id}?doctor_id=...
    GET /surgery-readiness/{patient_id}?doctor_id=...
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx
from loguru import logger
from fastapi import APIRouter, HTTPException, Query
from langchain_core.messages import HumanMessage, SystemMessage

from Agentic.clinical_agents import (
    PatientContextFetcher,
    _extract_patient_graph,
    reasoning_llm,
)


router = APIRouter(prefix="/surgery", tags=["surgery"])

API_BASE_URL = os.getenv("VITE_BACKEND_URL", "https://doctorassist.ai/api/")

SURGICAL_BOOKING_ENDPOINT = os.getenv(
    "SURGICAL_BOOKING_ENDPOINT",
    "hms/users/data/surgical-oncology/patient/{patient_id}/latest-booking",
)

NOT_DOCUMENTED = "Not documented"


# ============================================================
# SHARED HELPERS — plumbing only, no field mapping
# ============================================================

def _strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = t.split("```", 2)[1]
        if t.startswith("json"):
            t = t[4:]
    return t.strip()


def _safe_get(obj: Any, path: str, default: Any = None) -> Any:
    """Read a dotted path from a dict without raising. Purely structural."""
    cur = obj
    for key in path.split("."):
        if not isinstance(cur, dict):
            return default
        cur = cur.get(key)
        if cur is None:
            return default
    return cur if cur is not None else default


def _pretty_dump(obj: Any) -> str:
    """Render any JSON-serializable object for the LLM prompt."""
    try:
        return json.dumps(obj, indent=2, default=str)
    except Exception:
        return str(obj)


async def _call_llm_json(system_prompt: str, human_content: str) -> Dict[str, Any]:
    """One LLM call. Returns parsed JSON or {} on failure. Never raises."""
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=human_content),
    ]
    try:
        resp = await reasoning_llm.ainvoke(messages)
        content = _strip_fences(resp.content)
        return json.loads(content)
    except json.JSONDecodeError as e:
        logger.error(f"[surgery] LLM returned non-JSON: {e}")
    except Exception as e:
        logger.error(f"[surgery] LLM call failed: {e}")
    return {}


class SurgicalBookingFetcher:
    """Fetch the surgical booking payload. Return {} if nothing found."""

    def __init__(self):
        self.client = httpx.AsyncClient(timeout=60.0)

    async def fetch(self, patient_id: str, doctor_id: str) -> Dict[str, Any]:
        url = (
            f"{API_BASE_URL}"
            f"{SURGICAL_BOOKING_ENDPOINT.format(patient_id=patient_id)}"
        )
        try:
            resp = await self.client.get(url, params={"doctor_id": doctor_id})
            if resp.status_code == 200:
                payload = resp.json()
                # The HIMS wraps in `data` sometimes and not others; hand
                # whichever shape arrives to the LLM unmodified.
                if isinstance(payload, dict) and "data" in payload:
                    return payload["data"]
                return payload if isinstance(payload, dict) else {}
            if resp.status_code == 404:
                return {}
            logger.error(
                f"[SurgicalBookingFetcher] {resp.status_code} {resp.text[:200]}"
            )
        except Exception as e:
            logger.error(f"[SurgicalBookingFetcher] fetch failed: {e}")
        return {}


async def _fetch_patient_graph(patient_id: str, doctor_id: str) -> Dict[str, Any]:
    """Fetch and normalize the patient graph. Returns {} on failure."""
    fetcher = PatientContextFetcher()
    try:
        raw = await fetcher.fetch(patient_id, doctor_id)
    except Exception as e:
        logger.error(f"[surgery] graph fetch failed: {e}")
        return {}
    if not raw:
        return {}
    return raw if "conditions" in raw else _extract_patient_graph(raw)


def _format_graph_for_prompt(graph: Dict[str, Any]) -> str:
    """Pass every summary field verbatim. No filtering, no renaming."""
    if not graph:
        return "(no patient graph available)"
    return (
        "=== CONDITIONS ===\n"
        f"{_pretty_dump(graph.get('conditions', []))}\n\n"
        "=== MEDICATIONS ===\n"
        f"{_pretty_dump(graph.get('medications', []))}\n\n"
        "=== PROCEDURES ===\n"
        f"{_pretty_dump(graph.get('procedures', []))}\n\n"
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
# PROMPT — SURGERY RECORD
# ============================================================

RECORD_PROMPT = """
You are a surgical documentation assistant. You receive TWO inputs:

  1. The RAW SURGICAL BOOKING PAYLOAD from a hospital system. Its schema
     varies — different hospitals use different field names, different
     nesting, and different subsets of fields.

  2. The RAW PATIENT GRAPH (conditions, medications, procedures, and
     free-text summaries).

Your job is to produce ONE JSON object with the exact shape below,
reading whatever fields exist in whatever names the payload uses.

You are a faithful extractor — never invent facts. If a fact is absent
from BOTH inputs, output exactly "Not documented".

Return EXACTLY this JSON:

{
  "phase": "before | during | after",

  "hero": {
    "patientLabel": "<Patient Name / Surgery, or 'Surgery'>",
    "headline": "<one sentence naming the planned or completed operation and its situation>",
    "sub": "<one sentence explaining what this panel separates>"
  },

  "operative_record": {
    "procedure":         "<full procedure name or 'Not documented'>",
    "approach":          "<Open/Laparoscopic/Robotic/Endoscopic/Combined or 'Not documented'>",
    "laterality":        "<Left/Right/Bilateral/Midline/Not applicable or 'Not documented'>",
    "surgeon":           "<lead surgeon or 'Not documented'>",
    "assistant":         "<assistant or 'Not documented'>",
    "date":              "<ISO date or 'Not documented'>",
    "startTime":         "<HH:MM or 'Not documented'>",
    "endTime":           "<HH:MM or 'Not documented'>",
    "duration":          "<e.g. '4 hours' or 'Not documented'>",
    "findings":          "<intra-operative findings paragraph or 'Not documented'>",
    "procedure_details": "<procedure narrative paragraph or 'Not documented'>",
    "blood_loss":        "<e.g. '150 mL' or 'Not documented'>",
    "transfusion":       "<e.g. 'None' or 'Not documented'>",
    "specimens":         "<what was sent to pathology or 'Not documented'>",
    "drains":            "<drain types and sites or 'Not documented'>",
    "intent":            "<Curative/Palliative/Diagnostic/Debulking or 'Not documented'>",
    "complications":     "<intra-operative complications or 'None'>"
  },

  "anaesthesia_record": {
    "mode":               "<GA/Spinal/Epidural/Regional/Sedation/Combined/Local or 'Not documented'>",
    "monitors":           ["<monitor 1>", "<monitor 2>"],
    "airway":             "<device + grade or 'Not documented'>",
    "induction":          "<drugs + doses or 'Not documented'>",
    "maintenance":        "<agents + doses or 'Not documented'>",
    "ventilation":        "<mode + settings or 'Not documented'>",
    "fluids":             "<crystalloids + colloids or 'Not documented'>",
    "blood_products":     "<products + units or 'None' or 'Not documented'>",
    "vasoactives":        "<agents used or available or 'None' or 'Not documented'>",
    "reversal":           "<agents + doses or 'Not documented'>",
    "extubation":         "<Uneventful/Delayed/Failed or 'Not documented'>",
    "post_op_condition":  "<one sentence or 'Not documented'>",
    "recovery_vitals": {
      "PR":   "<value or 'Not documented'>",
      "BP":   "<value or 'Not documented'>",
      "SpO2": "<value or 'Not documented'>",
      "RR":   "<value or 'Not documented'>",
      "Temp": "<value or 'Not documented'>"
    }
  },

  "pathology": {
    "available":         true | false,
    "specimen":          "<description or 'Not documented'>",
    "diagnosis":         "<full diagnosis or 'Not documented'>",
    "histology":         "<type + grade or 'Not documented'>",
    "staging": {
      "pT":    "<pT or 'Not documented'>",
      "pN":    "<pN or 'Not documented'>",
      "pM":    "<pM or 'Not documented'>",
      "group": "<stage group or 'Not documented'>"
    },
    "nodes_examined":    "<number or 'Not documented'>",
    "nodes_positive":    "<number or 'Not documented'>",
    "resection":         "<R0/R1/R2 or 'Not documented'>",
    "margins":           "<Clear/Close/Involved or 'Not documented'>",
    "margin_distance":   "<mm or 'Not documented'>",
    "lvi":               "<Present/Absent or 'Not documented'>",
    "pni":               "<Present/Absent or 'Not documented'>",
    "biomarkers":        "<ER/PR/HER2/KRAS/EGFR/HPV/etc or 'Not documented'>",
    "report_date":       "<ISO date or 'Not documented'>",
    "notes":             "<pathologist narrative or 'Not documented'>"
  },

  "recovery": {
    "has_complications":  true | false,
    "complications":      ["<complication 1>", "<complication 2>"],
    "clavien_dindo":      "<grade or 'Not documented'>",
    "readmit_30":         "<Yes/No or 'Not documented'>",
    "mortality_30":       "<Yes/No or 'Not documented'>",
    "readmit_90":         "<Yes/No or 'Not documented'>",
    "mortality_90":       "<Yes/No or 'Not documented'>",
    "post_op_plan":       "<monitoring plan or 'Not documented'>",
    "analgesia_plan":     "<analgesia plan or 'Not documented'>",
    "diet":               "<diet plan or 'Not documented'>",
    "vte_prophylaxis":    "<Yes/No or 'Not documented'>",
    "drain_care":         "<drain instructions or 'Not documented'>",
    "milestones":         [{"day": "<Day 0>", "event": "<one line>"}]
  },

  "adjuvant_decision": {
    "indicated":   true | false,
    "modality":    "<Chemotherapy/Radiation/Hormonal/Immunotherapy/Combination/Observation or 'Not documented'>",
    "basis":       "<one paragraph citing the pathology or 'Not documented'>",
    "next_module": "<Execution/Radiation/Surveillance/Not applicable>",
    "owner":       "<Medical Oncology/Radiation Oncology/Surgical Oncology/MDT>",
    "mdt_review":  "<Yes/No or 'Not documented'>"
  },

  "confidence": "low | medium | high"
}

=== PHASE DETECTION ===

Read the payload carefully and decide:

  • "before" — no operation has started. Look for booking status like
    "Pending"/"Confirmed"/"Scheduled", a future surgeryDate, or the
    ABSENCE of an operation start time / end time.

  • "during" — operation started, not finished. Look for an operation
    start time but no end time; or an in-progress status.

  • "after" — operation finished. Look for an operation end time, a
    pathology report date, or a status like "Completed".

Field names differ by hospital. The MEANING is what matters:
  start_time · operation_start · knife_time · surgery_start · ot_start
  end_time   · operation_end   · closure_time · surgery_end  · ot_end

=== READING THE PAYLOAD ===

The payload may arrive as a nested dict, a flat dict, or a list of
documents. Read whatever is there. Common aliases to look for — but
do NOT treat this list as exhaustive. Use your own reading of the
payload. If a value is present in some unexpected key, use it.

  Booking:      procedureName | procedure_name | surgery | operation
                laterality | side | affected_side
                approach | technique
                surgeon | surgeonName | primary_surgeon
                date | surgeryDate | operation_date | scheduled_date
                startTime | start_time | ot_start
                endTime   | end_time   | ot_end

  Operative:    findings | operative_findings | intraop_findings
                procedureDetails | procedure_details | operative_narrative
                bloodLoss | blood_loss | estimated_blood_loss
                specimens | specimens_sent | materialsForwarded
                drains | drain_details
                complications | intraop_complications
                intent | intentOfProcedure

  Anaesthesia:  modeAnaesthesia | mode | anaesthesia_type
                monitors | monitoring
                airway | airwayDevice
                induction | inductionAgents
                maintenance | maintInhalational
                fluids | ivFluids
                reversal | reversalDose
                extubation | extubation_status
                pr | bp | spo2 | rr | temperature

  Pathology:    pathStagingT | pT | pathological_T
                pathStagingN | pN | pathological_N
                pathStagingM | pM | pathological_M
                pathStageGroup | stage_group | final_stage
                pathNodesExamined | nodes_examined | total_nodes
                pathNodesPositive | nodes_positive | positive_nodes
                pathResection | resection | r_status
                pathMarginStatus | margins | margin_status
                pathLVI | lvi
                pathPNI | pni
                pathDiagnosis | diagnosis
                pathGrade | grade
                pathReportDate | report_date
                pathReportNotes | pathologist_notes

  Outcomes:     hasComplications | complications
                readmit30 | readmit90 | mortality30 | mortality90
                clavienDindo | clavien_dindo
                postOperativePlan | post_op_plan
                analgesiaPlan | analgesia_plan
                dietInstructions | diet
                dvtProphylaxis | vte_prophylaxis

If the payload uses totally different names, read the values by MEANING.

=== ABSOLUTE RULES ===

  1. Use ONLY the two inputs. Never use outside knowledge.
  2. Missing → "Not documented". Never blank. Never null.
  3. Never diagnose or recommend. Extract and state what is documented.
  4. Output MUST be ONE valid JSON object. No prose, no markdown.
  5. The keys and structure above are the frontend contract. Produce
     exactly those keys, in exactly that nesting.
"""


# ============================================================
# PROMPT — PRE-SURGERY DETAILS
# ============================================================

PRESURGERY_PROMPT = """
You are a surgical documentation assistant. You receive the RAW PATIENT
GRAPH (conditions, medications, procedures, and free-text summaries).

Your job is to produce a seven-row PRE-SURGERY DETAILS snapshot — the
background context a surgeon needs on the day of operation.

Read EVERY summary field carefully. Cross-check across summaries.

Return EXACTLY this JSON:

{
  "details": [
    {
      "item":    "<the exact label below>",
      "finding": "<what the graph says, or 'Not documented'>",
      "basis":   "Clinical | Documented | Imaging | Not documented"
    }
  ]
}

Produce EXACTLY these seven rows, in this order:

  1. "Prior cancer treatment"
       Prior systemic therapy, radiation, endocrine, immunotherapy.
       Include drugs, cycles, dates if documented.
       Example: "Neoadjuvant anthracycline-taxane, 4 cycles, completed
                2026-07-10"

  2. "Prior surgery"
       Prior operations including biopsies. Include name and date.

  3. "Comorbidities"
       Active non-cancer conditions. Include control status if known.

  4. "Current medications"
       Active medications with dose and frequency.

  5. "Allergies"
       Drug and food allergies with reaction.
       Example: "Sulfonamide (rash)" / "No known drug allergies"

  6. "Performance status"
       ECOG or equivalent.

  7. "Social and functional"
       Living situation, support, distance, tobacco/alcohol, functional
       issues.

ABSOLUTE RULES:
  • Use ONLY the supplied graph.
  • Missing → "Not documented". Never blank.
  • Never emit an `action` or `date` field at the row level.
  • Never invent a value.
  • Output MUST be ONE valid JSON object. No prose, no markdown.
"""


# ============================================================
# PROMPT — SURGICAL READINESS
# ============================================================

READINESS_PROMPT = """
You are a surgical documentation assistant. You receive the RAW PATIENT
GRAPH (conditions, medications, procedures, and free-text summaries).

Your job is to produce an eight-row SURGICAL READINESS snapshot from
that graph. This is a reading of the current clinical picture through a
surgical lens. It is NOT a task list. It has NO action buttons. It has
NO dates.

Read EVERY summary field. Cross-check across summaries.

Return EXACTLY this JSON:

{
  "readiness": [
    {
      "item":    "<the exact label below>",
      "finding": "<what the graph says, or 'Not documented'>",
      "basis":   "Imaging | Imaging + cytology | Clinical | Needs surgical assessment | Pathology | Not documented"
    }
  ]
}

Produce EXACTLY these eight rows, in this order:

  1. "Primary site" — where the tumour is.
       Source: imaging_summary, procedure_summary.
       Do NOT use a fixed list of sites.

  2. "Size / extent" — size, depth, T-stage if documented.
       If measured differently on different scans, show both.

  3. "Local invasion" — involvement of structures adjacent to the
       tumour. Use the specific structures the imaging report discusses.

  4. "Nodes" — regional nodal status.

  5. "Distant disease" — any metastasis. Indeterminate lesions listed
       as indeterminate.

  6. "Resectability" — whether the tumour appears surgically removable.
       Use "Needs surgical assessment" as basis when imaging is
       compatible but the surgical judgement is not documented.

  7. "Organ preservation" — the organ-preservation question specific to
       THIS cancer, derived from the primary site. Do NOT hardcode
       breast, larynx, rectum, etc. If preservation is not meaningful,
       output "Not applicable".

  8. "Fitness + workup gaps" — combine two things separated by " · ":
       (a) Patient fitness — ECOG, comorbidities, cardiac/pulmonary
           reserve.
       (b) Facts still absent from the graph that a surgeon would note
           — phrase as FACT ("LVEF not documented"), not as an action
           ("order LVEF").

ABSOLUTE RULES:
  • Use ONLY the supplied graph.
  • Missing → "Not documented". Never blank.
  • Never emit an `action` or `date` field.
  • Never say "order X" or "pending". Say "X not documented".
  • Output MUST be ONE valid JSON object. No prose, no markdown.
"""


# ============================================================
# ENDPOINT 1 — /surgery-record
# ============================================================

@router.get("/record/{patient_id}")
async def get_surgery_record(
    patient_id: str,
    doctor_id: str = Query(...),
    patient_name: Optional[str] = Query(None),
) -> Dict[str, Any]:
    # Fetch both inputs
    graph = await _fetch_patient_graph(patient_id, doctor_id)
    booking = await SurgicalBookingFetcher().fetch(patient_id, doctor_id)

    # If booking is empty AND graph is empty, return the empty contract
    if not booking and not graph:
        return {
            "status": "success",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "has_surgical_record": False,
            "phase": "before",
            "hero": {
                "patientLabel": f"{patient_name} / Surgery" if patient_name else "Surgery",
                "headline": "No surgical plan is active for this patient at this stage.",
                "sub": "The Surgery panel opens when a case is referred to surgical oncology.",
            },
            "operative_record": None,
            "anaesthesia_record": None,
            "pathology": None,
            "recovery": None,
            "adjuvant_decision": None,
            "confidence": "low",
        }

    human_content = (
        "=== RAW SURGICAL BOOKING PAYLOAD ===\n"
        f"{_pretty_dump(booking) if booking else '(empty — no booking record)'}\n\n"
        "=== RAW PATIENT GRAPH ===\n"
        f"{_format_graph_for_prompt(graph)}\n\n"
        "Produce the JSON object now. No prose, no markdown, no code fences."
    )

    parsed = await _call_llm_json(RECORD_PROMPT, human_content)

    # If the LLM failed entirely, return a minimal safe contract
    if not parsed:
        return {
            "status": "success",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "has_surgical_record": bool(booking),
            "phase": "before",
            "hero": {
                "patientLabel": f"{patient_name} / Surgery" if patient_name else "Surgery",
                "headline": "Surgical record could not be composed at this time.",
                "sub": "Please retry, or verify the surgical booking payload.",
            },
            "operative_record": None,
            "anaesthesia_record": None,
            "pathology": None,
            "recovery": None,
            "adjuvant_decision": None,
            "confidence": "low",
        }

    # Pass the LLM output straight through. Only fill in defaults for
    # top-level keys the LLM might have forgotten — never map inner fields.
    return {
        "status": "success",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "has_surgical_record": bool(booking),
        "phase": parsed.get("phase") or "before",
        "hero": parsed.get("hero") or {
            "patientLabel": f"{patient_name} / Surgery" if patient_name else "Surgery",
            "headline": "Surgical review.",
            "sub": "Imaging facts are separated from what needs surgical judgement.",
        },
        "operative_record": parsed.get("operative_record"),
        "anaesthesia_record": parsed.get("anaesthesia_record"),
        "pathology": parsed.get("pathology"),
        "recovery": parsed.get("recovery"),
        "adjuvant_decision": parsed.get("adjuvant_decision"),
        "confidence": parsed.get("confidence") or "medium",
    }


# ============================================================
# ENDPOINT 2 — /surgery-presurgery-details
# ============================================================

@router.get("/presurgery-details/{patient_id}")
async def get_presurgery_details(
    patient_id: str,
    doctor_id: str = Query(...),
) -> Dict[str, Any]:
    graph = await _fetch_patient_graph(patient_id, doctor_id)
    if not graph:
        raise HTTPException(404, "Patient context not found.")

    human_content = (
        f"{_format_graph_for_prompt(graph)}\n\n"
        "Produce the JSON object now. No prose, no markdown, no code fences."
    )
    parsed = await _call_llm_json(PRESURGERY_PROMPT, human_content)

    details = parsed.get("details") if isinstance(parsed, dict) else None
    if not isinstance(details, list):
        details = []

    return {
        "status": "success",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "patient_id": patient_id,
        "details": details,
    }


# ============================================================
# ENDPOINT 3 — /surgery-readiness
# ============================================================

@router.get("/readiness/{patient_id}")
async def get_surgery_readiness(
    patient_id: str,
    doctor_id: str = Query(...),
) -> Dict[str, Any]:
    graph = await _fetch_patient_graph(patient_id, doctor_id)
    if not graph:
        raise HTTPException(404, "Patient context not found.")

    human_content = (
        f"{_format_graph_for_prompt(graph)}\n\n"
        "Produce the JSON object now. No prose, no markdown, no code fences."
    )
    parsed = await _call_llm_json(READINESS_PROMPT, human_content)

    readiness = parsed.get("readiness") if isinstance(parsed, dict) else None
    if not isinstance(readiness, list):
        readiness = []

    return {
        "status": "success",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "patient_id": patient_id,
        "readiness": readiness,
    }