"""
CCGI Discharge Report Generator — Dictation-First · HMS Standard Format
=========================================================================
v2.1.0

ARCHITECTURE:
  Input  : patient_id, doctor_id, dictation_text (optional)
  Source : discharge_summaries collection (day_wise_timeline only)
           patient_appointments collection (admission reason + date)
  Output : Structured HMS-standard discharge report (JSON + plain text)

PIPELINE:
  DR0 · DataFetcher        — loads day_wise_timeline from discharge_summaries DB
                             + fetches admission_reason & admission_date from
                               patient_appointments (IP visit matching doctor_id)
  DR1 · DictationParser    — LLM extracts structured fields from doctor's dictation
                             (skipped if no dictation provided)
  DR2 · TimelineExtractor  — pulls ALL clinical data from day_wise_timeline
                             (fills everything not captured by dictation)
  DR3 · ReportSynthesizer  — merges dictation (primary) + timeline (supplementary)
                             + admission context into full HMS discharge report (structured JSON)
  DR4 · ReportQuality      — audits completeness and clinical safety

PRIORITY RULE:
  1. Dictation text is PRIMARY source of truth (if provided).
  2. Timeline data is SECONDARY — fills gaps where dictation has null/missing.
  3. Appointment data supplies admission_reason + admission_date as fallback.
  4. If no source has a field → null (never invent or hallucinate).

HMS STANDARD SECTIONS:
  1.  Patient Demographics & Identifiers
  2.  Admission Details
  3.  Attending & Consulting Clinicians
  4.  Principal Diagnosis
  5.  Secondary Diagnoses & Comorbidities
  6.  Presenting Complaints & History
  7.  Physical Examination on Admission
  8.  Investigations & Results Summary
  9.  Procedures & Interventions
  10. Hospital Course (Clinical Narrative)
  11. Medications on Discharge
  12. Discharge Vitals
  13. Discharge Condition & Functional Status
  14. Discharge Instructions
  15. Follow-Up Plan
  16. Allergies & Adverse Reactions
  17. Treating Clinician Attestation
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, TypedDict

from fastapi import APIRouter, HTTPException
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END


# ═══════════════════════════════════════════════════════════════
# ENVIRONMENT
# ═══════════════════════════════════════════════════════════════

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
MONGO_URI    = os.getenv("MONGO_URI")
MONGO_DB     = os.getenv("MONGO_DB", "doctorassistai")

mongo_client = AsyncIOMotorClient(MONGO_URI)
mongo_db     = mongo_client[MONGO_DB]

llm_heavy = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0.0,
    max_tokens=8000,
    groq_api_key=GROQ_API_KEY,
)

llm_light = ChatGroq(
    model="llama-3.1-8b-instant",
    temperature=0.0,
    max_tokens=6500,
    groq_api_key=GROQ_API_KEY,
)

router = APIRouter(prefix="", tags=["Discharge Report"])


# ═══════════════════════════════════════════════════════════════
# REQUEST / RESPONSE MODELS
# ═══════════════════════════════════════════════════════════════

class DischargeReportRequest(BaseModel):
    patient_id:            str
    doctor_id:             str
    dictation_text:        Optional[str] = None   # Optional — pipeline handles absence
    specialty:             Optional[str] = None
    include_intermediates: bool = False


# ═══════════════════════════════════════════════════════════════
# PIPELINE STATE
# ═══════════════════════════════════════════════════════════════

class ReportState(TypedDict):
    patient_id:     str
    doctor_id:      str
    dictation_text: Optional[str]
    specialty:      Optional[str]

    # From DB
    day_wise_timeline:     List[Dict]
    patient_info:          Dict
    discharge_summary_raw: Optional[str]

    # ── NEW ── from patient_appointments (IP visit)
    admission_reason:      Optional[str]   # chief_complaint from latest IP appointment
    admission_date:        Optional[str]   # date from latest IP appointment

    # DR1 output — dictation structured fields (None if no dictation)
    dictation_fields: Optional[Dict]

    # DR2 output — timeline data (all clinical fields extracted)
    timeline_fields: Optional[Dict]

    # DR3 output — merged HMS report
    hms_report: Optional[Dict]

    # DR4 output — quality
    quality_report: Optional[Dict]

    errors:        List[str]
    agent_timings: Dict[str, float]


# ═══════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════

def parse_llm_json(text: str) -> Any:
    """Robustly parse LLM JSON output, stripping markdown fences."""
    if not text:
        return {}
    text = text.strip()
    text = re.sub(r"```json\s*", "", text)
    text = re.sub(r"```\s*", "", text)
    match = re.search(r"(\{.*\}|\[.*\])", text, re.DOTALL)
    if match:
        text = match.group(0)
    try:
        return json.loads(text)
    except Exception:
        return {"raw_output": text}


def _elapsed(start: float) -> float:
    return round((datetime.now().timestamp() - start) * 1000, 1)


class BaseAgent:
    def __init__(self, llm_instance):
        self.llm = llm_instance

    async def _invoke(self, system: str, user: str) -> Any:
        response = await self.llm.ainvoke([
            SystemMessage(content=system),
            HumanMessage(content=user),
        ])
        return parse_llm_json(response.content)

    async def _invoke_text(self, system: str, user: str) -> str:
        response = await self.llm.ainvoke([
            SystemMessage(content=system),
            HumanMessage(content=user),
        ])
        return response.content.strip()

    def _elapsed(self, start: float) -> float:
        return _elapsed(start)


# ═══════════════════════════════════════════════════════════════
# APPOINTMENT CONTEXT HELPER
# Fetches admission_reason (chief_complaint) and admission_date
# from the most recent IP appointment for this patient+doctor pair.
# Called inside DR0 so the values flow into ReportState.
# ═══════════════════════════════════════════════════════════════

async def fetch_admission_context(patient_id: str, doctor_id: str) -> Dict:
    """
    Returns:
        {
            "admission_reason": str | None,   # chief_complaint of latest IP appt
            "admission_date":   str | None,   # date of latest IP appt
        }

    Looks in patient_appointments collection for the most recent
    IP (in-patient) appointment belonging to the given doctor_id.
    Sorted by created_at descending (most recent first).
    """
    result: Dict = {
        "admission_reason": None,
        "admission_date":   None,
    }
    try:
        appt_doc = await mongo_db["patient_appointments"].find_one(
            {"sys_user_id": patient_id},
            {"appointments": 1},
        )
        if appt_doc:
            # Filter to IP appointments belonging to this doctor
            ip_appts = [
                a for a in appt_doc.get("appointments", [])
                if a.get("doctor_id") == doctor_id
                and a.get("visit_type", "").upper() == "IP"
            ]
            if ip_appts:
                # Sort by created_at descending — take most recent
                ip_appts.sort(
                    key=lambda x: x.get("created_at", ""),
                    reverse=True,
                )
                latest = ip_appts[0]
                result["admission_reason"] = latest.get("chief_complaint") or None
                result["admission_date"]   = latest.get("date") or None
                logger.info(
                    f"fetch_admission_context · patient={patient_id} doctor={doctor_id} "
                    f"→ reason='{result['admission_reason']}' date='{result['admission_date']}'"
                )
            else:
                logger.warning(
                    f"fetch_admission_context · No IP appointments found for "
                    f"patient={patient_id} doctor={doctor_id}"
                )
    except Exception as e:
        logger.warning(
            f"fetch_admission_context · Could not fetch IP appointment "
            f"for patient={patient_id}: {e}"
        )
    return result


# ═══════════════════════════════════════════════════════════════
# DR0 · DATA FETCHER
#
# Loads day_wise_timeline + patient info from discharge_summaries.
# ALSO fetches admission_reason + admission_date from
# patient_appointments via fetch_admission_context().
#
# Priority for admission_reason & admission_date:
#   1. discharge_summaries.admission_reason / .admission_date   (most specific)
#   2. patient_appointments chief_complaint / date              (fallback)
# ═══════════════════════════════════════════════════════════════

class DataFetcherAgent(BaseAgent):
    agent_id = "DR0"

    async def run(self, state: ReportState) -> ReportState:
        logger.info(f"{self.agent_id} · DataFetcher — START")
        t0 = datetime.now().timestamp()

        # ── 1. Fetch discharge_summaries record ──────────────
        try:
            record = await mongo_db["discharge_summaries"].find_one(
                {
                    "patient_id": state["patient_id"],
                    "doctor_id":  state["doctor_id"],
                },
                sort=[("generated_at", -1)],
                projection={
                    "day_wise_timeline":  1,
                    "discharge_summary":  1,
                    "patient":            1,
                    "admission_reason":   1,
                    "admission_date":     1,
                    "_id":                0,
                },
            )

            if not record:
                logger.warning(
                    f"{self.agent_id} · No discharge_summaries record found for "
                    f"patient={state['patient_id']} / doctor={state['doctor_id']} "
                    "— timeline will be empty"
                )
                state["day_wise_timeline"]     = []
                state["patient_info"]          = {}
                state["discharge_summary_raw"] = None
                ds_admission_reason            = None
                ds_admission_date              = None
            else:
                state["day_wise_timeline"] = record.get("day_wise_timeline", [])
                state["patient_info"] = {
                    **(record.get("patient") or {}),
                    "admission_reason": record.get("admission_reason"),
                    "admission_date":   record.get("admission_date"),
                }
                state["discharge_summary_raw"] = record.get("discharge_summary")
                ds_admission_reason = record.get("admission_reason")
                ds_admission_date   = record.get("admission_date")
                logger.info(
                    f"{self.agent_id} · Loaded {len(state['day_wise_timeline'])} "
                    "timeline blocks from discharge_summaries"
                )

        except Exception as e:
            logger.error(f"{self.agent_id} · discharge_summaries fetch failed: {e}")
            state["errors"].append(f"DR0-discharge_summaries: {str(e)}")
            state["day_wise_timeline"]     = []
            state["patient_info"]          = {}
            state["discharge_summary_raw"] = None
            ds_admission_reason            = None
            ds_admission_date              = None

        # ── 2. Fetch admission context from patient_appointments ──
        appt_ctx = await fetch_admission_context(
            state["patient_id"],
            state["doctor_id"],
        )

        # ── 3. Merge: discharge_summaries wins; appointments fill gaps ──
        #
        # admission_reason: prefer discharge_summaries.admission_reason,
        #                   fall back to patient_appointments.chief_complaint
        state["admission_reason"] = (
            ds_admission_reason
            or appt_ctx["admission_reason"]
            or None
        )

        # admission_date: prefer discharge_summaries.admission_date,
        #                 fall back to patient_appointments.date
        state["admission_date"] = (
            ds_admission_date
            or appt_ctx["admission_date"]
            or None
        )

        # Keep patient_info in sync so DR3 can read it too
        state["patient_info"].setdefault("admission_reason", state["admission_reason"])
        state["patient_info"].setdefault("admission_date",   state["admission_date"])

        logger.info(
            f"{self.agent_id} · Resolved "
            f"admission_reason='{state['admission_reason']}' | "
            f"admission_date='{state['admission_date']}'"
        )

        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        return state


# ═══════════════════════════════════════════════════════════════
# DR1 · DICTATION PARSER  (skipped if dictation_text is empty)
#
# PRIMARY source of truth.
# Extracts every HMS field the doctor explicitly stated.
# Sets missing fields to null — never invents data.
# ═══════════════════════════════════════════════════════════════

_DR1_SYSTEM = """\
You are a senior clinical documentation specialist in a hospital HMS.
Parse the doctor's dictation text and extract every clinical field that
was explicitly stated into structured JSON.

ABSOLUTE RULES:
1. Extract ONLY what the doctor explicitly stated.
2. If a field was NOT mentioned → set it to null. NEVER invent or infer.
3. Preserve the doctor's exact clinical language — do NOT rephrase.
4. Numbers, units, dates, drug names, doses — copy them exactly as spoken.
5. If the doctor lists multiple items (e.g., several medications), capture ALL of them.
6. Return ONLY valid JSON — no prose, no markdown, no explanation outside JSON.
"""

_DR1_PROMPT = """\
DOCTOR'S DICTATION TEXT:
═══════════════════════════════════════════════════════════════════════════
{dictation_text}
═══════════════════════════════════════════════════════════════════════════

Extract every field the doctor mentioned. Use null for anything not stated.
Capture ALL items in lists — do not truncate medications, diagnoses, or instructions.

Return EXACTLY this JSON structure (no extra keys, no missing keys):
{{
  "attending_doctor":              "full name and designation or null",
  "consulting_doctors":            ["name+specialty", "..."],
  "specialty":                     "clinical specialty or null",

  "admission_date":                "YYYY-MM-DD or free text date as spoken or null",
  "discharge_date":                "YYYY-MM-DD or free text date as spoken or null",
  "length_of_stay":                "X days or null",
  "ward":                          "ward/unit name or null",
  "admission_type":                "Elective | Emergency | Transfer | null",
  "mode_of_admission":             "OPD | ER | Referral | Transfer | null",

  "principal_diagnosis":           "exact text as stated or null",
  "secondary_diagnoses":           [
    {{"diagnosis": "...", "relationship": "Comorbidity | Complication | Incidental Finding"}}
  ],

  "chief_complaints":              ["...", "..."],
  "duration_of_complaints":        "text or null",
  "history_of_present_illness":    "full narrative exactly as dictated or null",
  "past_medical_history":          ["...", "..."],
  "past_surgical_history":         ["...", "..."],
  "family_history":                "text or null",
  "social_history":                "text or null",

  "allergies":                     [
    {{"allergen": "...", "reaction": "...", "severity": "Mild|Moderate|Severe|Life-threatening"}}
  ],
  "no_known_allergies":            true,

  "examination_general":           "text or null",
  "vitals_on_admission": {{
    "blood_pressure":    "value with units or null",
    "heart_rate":        "value with units or null",
    "respiratory_rate":  "value with units or null",
    "temperature":       "value with units or null",
    "spo2":              "value with units or null",
    "weight":            "value with units or null",
    "height":            "value with units or null",
    "bmi":               "value or null"
  }},
  "systemic_examination": {{
    "cardiovascular":    "text or null",
    "respiratory":       "text or null",
    "abdomen":           "text or null",
    "central_nervous_system": "text or null",
    "musculoskeletal":   "text or null",
    "other":             "text or null"
  }},

  "investigations": [
    {{
      "test":            "exact test name",
      "result":          "exact result as stated",
      "unit":            "unit or null",
      "date":            "date as mentioned or null",
      "significance":    "clinical interpretation as doctor stated or null"
    }}
  ],
  "imaging": [
    {{
      "modality":  "USG | CT | MRI | X-Ray | PET | etc.",
      "region":    "body region",
      "findings":  "exact findings as stated",
      "date":      "date or null"
    }}
  ],
  "ecg_echo": [
    {{
      "type":     "ECG | Echocardiogram | etc.",
      "findings": "exact findings as stated",
      "date":     "date or null"
    }}
  ],
  "histopathology_microbiology": [
    {{
      "test":     "biopsy | culture | cytology | etc.",
      "specimen": "specimen source",
      "findings": "exact findings as stated",
      "date":     "date or null"
    }}
  ],

  "procedures_performed": [
    {{
      "name":                    "exact procedure name",
      "date":                    "date as mentioned or null",
      "surgeon":                 "name or null",
      "anaesthesia":             "type or null",
      "intraoperative_findings": "text or null",
      "specimens_sent":          "text or null",
      "complications":           "text or None",
      "outcome":                 "text or null"
    }}
  ],

  "hospital_course_narrative":  "the full clinical story EXACTLY as the doctor dictated, verbatim or null",
  "significant_events":         ["...", "..."],
  "complications_during_admission": ["...", "..."],

  "condition_on_discharge":     "Stable | Improved | Guarded | Critical | exact text | null",
  "functional_status":          "Independent | Requires Assistance | Dependent | null",
  "mobility":                   "Ambulatory | Bedbound | With Support | null",
  "pain_level":                 "None | Mild | Moderate | Severe | null",
  "wound_status":               "text or null",

  "discharge_vitals": {{
    "blood_pressure":   "value or null",
    "heart_rate":       "value or null",
    "respiratory_rate": "value or null",
    "temperature":      "value or null",
    "spo2":             "value or null",
    "weight":           "value or null",
    "general_condition":"text or null"
  }},

  "medications_on_discharge": [
    {{
      "drug_name":            "exact drug name as stated",
      "brand_name":           "brand if mentioned or null",
      "dose":                 "exact dose as stated",
      "route":                "oral | IV | IM | SC | topical | etc.",
      "frequency":            "OD | BD | TDS | QID | SOS | exact text",
      "duration":             "X days | indefinite | exact text or null",
      "special_instructions": "exact instructions as stated or null",
      "indication":           "clinical reason if stated or null"
    }}
  ],

  "discharge_instructions": {{
    "activity":                    "exact text or null",
    "diet":                        "exact text or null",
    "wound_care":                  "exact text or null",
    "catheter_drain_care":         "exact text or null",
    "warning_signs_to_watch":      ["...", "..."],
    "when_to_seek_emergency_care": ["...", "..."],
    "restrictions":                ["...", "..."]
  }},

  "follow_up_plan": [
    {{
      "appointment_with":  "doctor name / department / specialty",
      "timeframe":         "exact timeframe as stated",
      "location":          "clinic / hospital / exact text or null",
      "purpose":           "reason for follow-up as stated",
      "tests_before_visit":["...", "..."]
    }}
  ],

  "special_notes": "any other clinical information the doctor mentioned that does not fit above categories or null"
}}
"""


class DictationParserAgent(BaseAgent):
    agent_id = "DR1"

    async def run(self, state: ReportState) -> ReportState:
        logger.info(f"{self.agent_id} · DictationParser — START")
        t0 = datetime.now().timestamp()

        dictation = (state.get("dictation_text") or "").strip()

        if not dictation:
            logger.info(f"{self.agent_id} · No dictation provided — skipping")
            state["dictation_fields"]             = {}
            state["agent_timings"][self.agent_id] = self._elapsed(t0)
            return state

        result = await self._invoke(
            _DR1_SYSTEM,
            _DR1_PROMPT.format(dictation_text=dictation),
        )

        # Auto-propagate specialty if not already set
        if not state.get("specialty") and result.get("specialty"):
            state["specialty"] = result["specialty"]

        # If dictation did not capture admission_date, seed it from appointment context
        if not result.get("admission_date") and state.get("admission_date"):
            result["admission_date"] = state["admission_date"]

        # If dictation did not mention chief complaints, seed from appointment reason
        if not result.get("chief_complaints") and state.get("admission_reason"):
            result["chief_complaints"] = [state["admission_reason"]]

        state["dictation_fields"]             = result
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(
            f"{self.agent_id} · DictationParser — DONE "
            f"({state['agent_timings'][self.agent_id]}ms) | "
            f"principal_dx={result.get('principal_diagnosis', 'null')}"
        )
        return state


# ═══════════════════════════════════════════════════════════════
# DR2 · TIMELINE EXTRACTOR
#
# SECONDARY source.
# Extracts ALL clinical fields from day_wise_timeline that were
# either absent in dictation or need richer detail from the timeline.
# Never overrides dictation values — only fills gaps.
# ═══════════════════════════════════════════════════════════════

_DR2_SYSTEM = """\
You are a clinical data extraction specialist processing a structured
day-wise clinical timeline from a hospital knowledge graph.

Your task: Extract a COMPLETE, COMPREHENSIVE clinical summary from the
timeline data. Aggregate data across ALL days. De-duplicate by name/test.

Include EVERY piece of clinical data present — investigations with values
and units, all medications administered, all vitals across days, all
procedures, all findings, all diagnoses, all recommendations.

Rules:
1. Extract EVERYTHING — do not omit any clinical detail.
2. Aggregate and de-duplicate across all days.
3. If a value appears on multiple days, capture it as a trend or keep most recent.
4. Return ONLY valid JSON — no prose outside JSON.
"""

_DR2_PROMPT = """\
FIELDS ALREADY CAPTURED FROM DICTATION (do NOT re-extract these, only SUPPLEMENT them):
{dictation_summary}

ADMISSION CONTEXT (from appointment records — use to fill any gaps):
Admission Reason : {admission_reason}
Admission Date   : {admission_date}

DAY-WISE CLINICAL TIMELINE (full structured data from knowledge graph):
{timeline_json}

Extract a comprehensive supplementary clinical summary from the timeline.
Cover ALL days. Aggregate everything. De-duplicate.
If chief_complaints or admission_date are absent from the timeline but
are provided in the ADMISSION CONTEXT above, include them in your output.

Return EXACTLY this JSON structure:
{{
  "attending_doctor":    "name from timeline or null",
  "consulting_doctors":  ["...", "..."],
  "specialty":           "specialty or null",

  "admission_date":      "date from timeline, or use ADMISSION CONTEXT date if not in timeline, or null",
  "discharge_date":      "date or null",
  "ward":                "ward/unit or null",

  "principal_diagnosis": "primary diagnosis from timeline or null",
  "all_diagnoses":       [
    {{"diagnosis": "...", "date": "...", "relationship": "Primary | Comorbidity | Complication | Incidental"}}
  ],

  "chief_complaints":    ["use ADMISSION CONTEXT admission_reason if not in timeline", "..."],
  "history_of_present_illness": "narrative from timeline or null",
  "past_medical_history":       ["...", "..."],
  "past_surgical_history":      ["...", "..."],
  "family_history":             "text or null",
  "social_history":             "text or null",

  "allergies":           [
    {{"allergen": "...", "reaction": "...", "severity": "..."}}
  ],
  "no_known_allergies":  true,

  "examination_general": "general appearance or null",
  "vitals_on_admission": {{
    "blood_pressure":   "first recorded value or null",
    "heart_rate":       "first recorded value or null",
    "respiratory_rate": "first recorded value or null",
    "temperature":      "first recorded value or null",
    "spo2":             "first recorded value or null",
    "weight":           "value or null",
    "height":           "value or null",
    "bmi":              "value or null"
  }},
  "systemic_examination": {{
    "cardiovascular":        "text or null",
    "respiratory":           "text or null",
    "abdomen":               "text or null",
    "central_nervous_system":"text or null",
    "musculoskeletal":       "text or null",
    "other":                 "text or null"
  }},

  "all_laboratory_investigations": [
    {{
      "test":            "exact test name",
      "result":          "value",
      "unit":            "unit or null",
      "reference_range": "range or null",
      "date":            "date or null",
      "status":          "Normal | Abnormal | Critical"
    }}
  ],
  "all_imaging": [
    {{
      "modality":    "USG | CT | MRI | X-Ray | PET | etc.",
      "region":      "body region",
      "findings":    "findings text",
      "date":        "date or null",
      "reported_by": "radiologist or null"
    }}
  ],
  "all_ecg_echo": [
    {{
      "type":     "ECG | Echocardiogram | etc.",
      "findings": "findings text",
      "date":     "date or null"
    }}
  ],
  "all_histopathology_microbiology": [
    {{
      "test":     "name",
      "specimen": "specimen source",
      "findings": "findings text",
      "date":     "date or null"
    }}
  ],
  "other_investigations": [
    {{
      "test":     "name",
      "findings": "text",
      "date":     "date or null"
    }}
  ],

  "all_medications_during_admission": [
    {{
      "drug":      "name",
      "dose":      "dose",
      "route":     "route",
      "frequency": "frequency",
      "dates":     "date range or specific dates",
      "indication":"reason or null"
    }}
  ],

  "all_procedures": [
    {{
      "name":                    "procedure name",
      "date":                    "date or null",
      "surgeon":                 "name or null",
      "anaesthesia":             "type or null",
      "intraoperative_findings": "text or null",
      "specimens_sent":          "text or null",
      "complications":           "text or None",
      "outcome":                 "text or null"
    }}
  ],

  "vitals_trend": [
    {{
      "date":           "YYYY-MM-DD",
      "day_label":      "Day 1 / POD1 / etc.",
      "blood_pressure": "value or null",
      "heart_rate":     "value or null",
      "respiratory_rate":"value or null",
      "temperature":    "value or null",
      "spo2":           "value or null",
      "urine_output":   "value or null",
      "other":          "any other vital or null"
    }}
  ],

  "hospital_course_narrative": "Reconstructed narrative from timeline data or null",
  "clinical_days_summary": [
    {{
      "date":       "YYYY-MM-DD",
      "day_label":  "Day 1 / POD1 / etc.",
      "key_events": "summary of that day's clinical events"
    }}
  ],
  "significant_events":              ["...", "..."],
  "complications_during_admission":  ["...", "..."],
  "abnormalities_flagged":           ["...", "..."],
  "all_recommendations":             ["...", "..."],

  "condition_on_discharge":   "text or null",
  "functional_status":        "text or null",
  "mobility":                 "text or null",
  "wound_status":             "text or null",

  "discharge_vitals": {{
    "blood_pressure":   "value or null",
    "heart_rate":       "value or null",
    "respiratory_rate": "value or null",
    "temperature":      "value or null",
    "spo2":             "value or null",
    "weight":           "value or null",
    "general_condition":"text or null"
  }},

  "medications_on_discharge": [
    {{
      "drug_name":            "name",
      "dose":                 "dose",
      "route":                "route",
      "frequency":            "frequency",
      "duration":             "duration or null",
      "special_instructions": "text or null",
      "indication":           "reason or null"
    }}
  ],

  "discharge_instructions": {{
    "activity":                    "text or null",
    "diet":                        "text or null",
    "wound_care":                  "text or null",
    "catheter_drain_care":         "text or null",
    "warning_signs_to_watch":      ["...", "..."],
    "when_to_seek_emergency_care": ["...", "..."],
    "restrictions":                ["...", "..."]
  }},

  "follow_up_plan": [
    {{
      "appointment_with":   "doctor / department",
      "timeframe":          "timeframe",
      "location":           "location or null",
      "purpose":            "reason",
      "tests_before_visit": ["...", "..."]
    }}
  ],

  "special_notes": "any additional clinical information from timeline not captured above or null"
}}
"""


class TimelineExtractorAgent(BaseAgent):
    agent_id = "DR2"

    async def run(self, state: ReportState) -> ReportState:
        logger.info(f"{self.agent_id} · TimelineExtractor — START")
        t0 = datetime.now().timestamp()

        timeline = state.get("day_wise_timeline") or []

        if not timeline:
            logger.info(f"{self.agent_id} · No timeline data — skipping")
            state["timeline_fields"]              = {}
            state["agent_timings"][self.agent_id] = self._elapsed(t0)
            return state

        dictation_fields = state.get("dictation_fields") or {}

        # Build a concise summary of what dictation already captured
        dictation_summary = {
            "has_dictation":              bool(state.get("dictation_text", "").strip()),
            "principal_diagnosis":        dictation_fields.get("principal_diagnosis"),
            "secondary_diagnoses":        [d.get("diagnosis") for d in (dictation_fields.get("secondary_diagnoses") or [])],
            "procedures_noted":           [p.get("name") for p in (dictation_fields.get("procedures_performed") or [])],
            "discharge_medications":      [m.get("drug_name") for m in (dictation_fields.get("medications_on_discharge") or [])],
            "investigations_noted":       [i.get("test") for i in (dictation_fields.get("investigations") or [])],
            "has_hospital_course":        bool(dictation_fields.get("hospital_course_narrative")),
            "has_follow_up":              bool(dictation_fields.get("follow_up_plan")),
            "has_discharge_instructions": bool(dictation_fields.get("discharge_instructions")),
        }

        # Compact timeline — keep all clinical fields
        compact_timeline = []
        for block in timeline:
            if block.get("type") == "admission":
                continue
            day_compact = {
                "date":      block.get("date"),
                "day_label": block.get("date_label"),
                "documents": [],
            }
            for doc in block.get("documents", []):
                day_compact["documents"].append({
                    "label":           doc.get("document_label"),
                    "vitals":          doc.get("vitals", []),
                    "medications":     doc.get("medications", []),
                    "investigations":  doc.get("investigations", []),
                    "procedures":      doc.get("procedures", []),
                    "findings":        doc.get("findings", []),
                    "diagnoses":       doc.get("diagnoses", []),
                    "treatments":      doc.get("treatments", []),
                    "abnormalities":   doc.get("abnormalities", []),
                    "recommendations": doc.get("recommendations", []),
                    "discharge_meds":  doc.get("discharge_meds", []),
                    "follow_up":       doc.get("follow_up", []),
                    "instructions":    doc.get("instructions", []),
                })
            compact_timeline.append(day_compact)

        result = await self._invoke(
            _DR2_SYSTEM,
            _DR2_PROMPT.format(
                dictation_summary = json.dumps(dictation_summary, indent=2),
                timeline_json     = json.dumps(compact_timeline, indent=2, default=str),
                # Pass appointment context so LLM can fill gaps
                admission_reason  = state.get("admission_reason") or "Not available",
                admission_date    = state.get("admission_date")   or "Not available",
            ),
        )

        state["timeline_fields"]              = result
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(
            f"{self.agent_id} · TimelineExtractor — DONE "
            f"({state['agent_timings'][self.agent_id]}ms)"
        )
        return state


# ═══════════════════════════════════════════════════════════════
# DR3 · REPORT SYNTHESIZER
#
# Merges dictation (primary) + timeline (secondary) + patient DB
# + appointment context into a complete 17-section HMS discharge report.
#
# MERGE RULES:
#   • If dictation has a value → use dictation value (always)
#   • If dictation is null/empty → use timeline value
#   • If both are null → use appointment context (admission_reason / admission_date)
#   • If everything null → null (never invent)
#   • For LISTS: UNION of both sources, de-duplicated by name
#   • Hospital course narrative → dictation verbatim if present,
#     else reconstruct from timeline day summaries
# ═══════════════════════════════════════════════════════════════

_DR3_SYSTEM = """\
You are a senior clinical documentation specialist generating a formal
HMS-standard discharge summary for a hospital.

You receive four sources:
  SOURCE A: Fields extracted from the doctor's DICTATION  ← PRIMARY
  SOURCE B: Fields extracted from the clinical TIMELINE   ← SECONDARY (fills gaps only)
  SOURCE C: Patient demographics from the hospital DB     ← REFERENCE
  SOURCE D: Admission context from appointment records    ← FALLBACK for admission reason & date

MERGE RULES (STRICT — NEVER VIOLATE):
  1. SOURCE A (dictation) ALWAYS takes priority for scalar fields.
     If A has a non-null value → use A. Never replace A with B or D.
  2. SOURCE B fills GAPS only — use B's value where A is null/empty/missing.
  3. SOURCE D is the FINAL FALLBACK for admission_reason and admission_date:
     Use D only if BOTH A and B are null for those fields.
  4. If A, B, and D are all null for a field → output null. Do NOT invent.
  5. For LIST fields (medications, investigations, procedures, diagnoses,
     instructions, follow-up, allergies):
       → UNION of A + B, de-duplicated by drug name / test name / procedure name.
       → Prefer A's version of any duplicate entry.
  6. hospital_course.narrative → use A verbatim if present.
       If A is null → reconstruct coherently from B's clinical_days_summary.
       Open the narrative with the admission reason from SOURCE D if not captured elsewhere.
  7. section_2_admission_details.admission_date → prefer A, then B, then D.
  8. section_6.chief_complaints → prefer A, then B; if still empty use SOURCE D admission_reason as a complaint.
  9. Include ALL 17 sections in output, even if value is null.
  10. For ICD-10 codes: provide the most accurate code you know for each diagnosis.
  11. Return ONLY valid JSON. No prose, no markdown, no text outside JSON.
"""

_DR3_PROMPT = """\
SOURCE A — DICTATION (PRIMARY):
{dictation_fields}

SOURCE B — TIMELINE (SECONDARY):
{timeline_fields}

SOURCE C — PATIENT INFO FROM DB:
{patient_info}

SOURCE D — ADMISSION CONTEXT FROM APPOINTMENT RECORDS (FALLBACK):
{{
  "admission_reason": "{admission_reason}",
  "admission_date":   "{admission_date}"
}}

SPECIALTY: {specialty}
PATIENT_ID: {patient_id}
GENERATED_AT: {generated_at}

Apply merge rules and produce the complete HMS discharge report.

Return EXACTLY this JSON (all keys required, null where no data):
{{
  "report_metadata": {{
    "report_type":   "Discharge Summary",
    "specialty":     "...",
    "generated_at":  "{generated_at}",
    "version":       "2.1"
  }},

  "section_1_patient_demographics": {{
    "patient_name":      "...",
    "date_of_birth":     "...",
    "age":               "...",
    "sex":               "...",
    "patient_id":        "{patient_id}",
    "blood_group":       "...",
    "contact_number":    "...",
    "address":           "...",
    "emergency_contact": "...",
    "insurance_details": "..."
  }},

  "section_2_admission_details": {{
    "admission_date":   "prefer dictation → timeline → appointment date",
    "discharge_date":   "...",
    "length_of_stay":   "... days",
    "ward":             "...",
    "bed_number":       "...",
    "admission_type":   "Elective | Emergency | Transfer | null",
    "mode_of_admission":"OPD | ER | Referral | Transfer | null",
    "referral_source":  "..."
  }},

  "section_3_clinicians": {{
    "attending_consultant":   "...",
    "resident_doctor":        "...",
    "consulting_specialists": ["...", "..."],
    "anaesthetist":           "...",
    "primary_nurse":          "..."
  }},

  "section_4_principal_diagnosis": {{
    "diagnosis":       "...",
    "icd_10_code":     "best matching ICD-10 code",
    "diagnosis_type":  "Confirmed | Provisional | null",
    "laterality":      "Left | Right | Bilateral | Not applicable | null"
  }},

  "section_5_secondary_diagnoses": [
    {{
      "diagnosis":     "...",
      "icd_10_code":   "...",
      "relationship":  "Comorbidity | Complication | Incidental Finding"
    }}
  ],

  "section_6_presenting_complaints_and_history": {{
    "chief_complaints":               ["prefer dictation; fallback to appointment admission_reason"],
    "duration_of_complaints":         "...",
    "history_of_present_illness":     "full narrative...",
    "past_medical_history":           ["...", "..."],
    "past_surgical_history":          ["...", "..."],
    "family_history":                 "...",
    "social_history":                 "...",
    "review_of_systems":              "..."
  }},

  "section_7_examination_on_admission": {{
    "general_appearance": "...",
    "vitals": {{
      "blood_pressure":   "...",
      "heart_rate":       "...",
      "respiratory_rate": "...",
      "temperature":      "...",
      "spo2":             "...",
      "weight":           "...",
      "height":           "...",
      "bmi":              "..."
    }},
    "systemic_examination": {{
      "cardiovascular":         "...",
      "respiratory":            "...",
      "abdomen":                "...",
      "central_nervous_system": "...",
      "musculoskeletal":        "...",
      "other":                  "..."
    }}
  }},

  "section_8_investigations": {{
    "laboratory": [
      {{
        "test":            "...",
        "result":          "...",
        "unit":            "...",
        "reference_range": "...",
        "date":            "...",
        "status":          "Normal | Abnormal | Critical"
      }}
    ],
    "imaging": [
      {{
        "modality":    "...",
        "region":      "...",
        "findings":    "...",
        "date":        "...",
        "reported_by": "..."
      }}
    ],
    "ecg_echo": [
      {{
        "type":     "...",
        "findings": "...",
        "date":     "..."
      }}
    ],
    "histopathology_microbiology": [
      {{
        "test":     "...",
        "specimen": "...",
        "findings": "...",
        "date":     "..."
      }}
    ],
    "other": [
      {{
        "test":     "...",
        "findings": "...",
        "date":     "..."
      }}
    ]
  }},

  "section_9_procedures_interventions": [
    {{
      "procedure_name":          "...",
      "date":                    "...",
      "indication":              "...",
      "surgeon_operator":        "...",
      "anaesthesia_type":        "...",
      "intraoperative_findings": "...",
      "specimens_sent":          "...",
      "complications":           "None | ...",
      "outcome":                 "..."
    }}
  ],

  "section_10_hospital_course": {{
    "narrative": "Full verbatim dictation narrative OR timeline-reconstructed narrative. If admission reason from SOURCE D is available and not already captured, open with it.",
    "clinical_days": [
      {{
        "date":       "YYYY-MM-DD",
        "day_label":  "Day 1 | POD1 | etc.",
        "key_events": "..."
      }}
    ],
    "vitals_trend": [
      {{
        "date":            "YYYY-MM-DD",
        "day_label":       "...",
        "blood_pressure":  "...",
        "heart_rate":      "...",
        "respiratory_rate":"...",
        "temperature":     "...",
        "spo2":            "...",
        "urine_output":    "..."
      }}
    ],
    "significant_events":             ["...", "..."],
    "complications_during_admission": ["None | ..."]
  }},

  "section_11_medications_on_discharge": [
    {{
      "drug_name":            "...",
      "brand_name":           "...",
      "dose":                 "...",
      "route":                "...",
      "frequency":            "...",
      "duration":             "...",
      "special_instructions": "...",
      "indication":           "..."
    }}
  ],

  "section_12_discharge_vitals": {{
    "blood_pressure":   "...",
    "heart_rate":       "...",
    "respiratory_rate": "...",
    "temperature":      "...",
    "spo2":             "...",
    "weight":           "...",
    "general_condition":"..."
  }},

  "section_13_discharge_condition": {{
    "overall_condition": "Stable | Improved | Guarded | Critical | null",
    "functional_status": "Independent | Requires Assistance | Dependent | null",
    "mobility":          "Ambulatory | Bedbound | With Support | null",
    "pain_level":        "None | Mild | Moderate | Severe | null",
    "wound_status":      "...",
    "drain_tube_status": "..."
  }},

  "section_14_discharge_instructions": {{
    "activity":                    "...",
    "diet":                        "...",
    "wound_care":                  "...",
    "catheter_drain_care":         "...",
    "warning_signs_to_watch":      ["...", "..."],
    "when_to_seek_emergency_care": ["...", "..."],
    "restrictions":                ["...", "..."]
  }},

  "section_15_follow_up_plan": [
    {{
      "appointment_with":   "...",
      "specialty":          "...",
      "timeframe":          "...",
      "location":           "...",
      "purpose":            "...",
      "tests_before_visit": ["...", "..."]
    }}
  ],

  "section_16_allergies": [
    {{
      "allergen":        "...",
      "reaction_type":   "...",
      "severity":        "Mild | Moderate | Severe | Life-threatening",
      "date_documented": "..."
    }}
  ],

  "section_17_attestation": {{
    "prepared_by":          "...",
    "designation":          "...",
    "date":                 "...",
    "reviewed_by":          "...",
    "reviewer_designation": "...",
    "digital_signature":    "Pending"
  }}
}}
"""


class ReportSynthesizerAgent(BaseAgent):
    agent_id = "DR3"

    async def run(self, state: ReportState) -> ReportState:
        logger.info(f"{self.agent_id} · ReportSynthesizer — START")
        t0 = datetime.now().timestamp()

        dictation_fields = state.get("dictation_fields") or {}
        timeline_fields  = state.get("timeline_fields")  or {}
        patient_info     = state.get("patient_info")     or {}
        specialty        = state.get("specialty")         or "General Medicine"

        full_patient_info = {
            **patient_info,
            "patient_id": state["patient_id"],
        }

        result = await self._invoke(
            _DR3_SYSTEM,
            _DR3_PROMPT.format(
                dictation_fields  = json.dumps(dictation_fields, indent=2, default=str),
                timeline_fields   = json.dumps(timeline_fields,  indent=2, default=str),
                patient_info      = json.dumps(full_patient_info, indent=2, default=str),
                specialty         = specialty,
                patient_id        = state["patient_id"],
                generated_at      = datetime.now().isoformat(),
                # Admission context — SOURCE D
                admission_reason  = state.get("admission_reason") or "Not documented",
                admission_date    = state.get("admission_date")   or "Not documented",
            ),
        )

        state["hms_report"]                   = result
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(
            f"{self.agent_id} · ReportSynthesizer — DONE "
            f"({state['agent_timings'][self.agent_id]}ms)"
        )
        return state


# ═══════════════════════════════════════════════════════════════
# DR4 · REPORT QUALITY GATE
# 12-point audit checklist + 6-dimension scoring
# ═══════════════════════════════════════════════════════════════

_DR4_SYSTEM = """\
You are a senior clinical quality auditor for a hospital HMS.
Audit the discharge summary for completeness, clinical safety, and HMS compliance.
Return ONLY valid JSON.
"""

_DR4_PROMPT = """\
SPECIALTY:             {specialty}
PRINCIPAL DIAGNOSIS:   {principal_diagnosis}
SECTIONS PRESENT:      {sections_present}
MEDICATIONS COUNT:     {med_count}
INVESTIGATIONS COUNT:  {inv_count}
PROCEDURES COUNT:      {proc_count}
FOLLOW-UP COUNT:       {followup_count}
HAS ALLERGIES:         {has_allergies}
HAS DISCHARGE VITALS:  {has_discharge_vitals}
HAS HOSPITAL COURSE:   {has_course}
HAS WARNING SIGNS:     {has_warnings}
HAS DICTATION SOURCE:  {has_dictation}
HAS ADMISSION REASON:  {has_admission_reason}
ADMISSION REASON:      {admission_reason}
ADMISSION DATE:        {admission_date}

HOSPITAL COURSE PREVIEW (first 2000 chars):
{course_preview}

Audit checklist — each item: "PASS" | "FAIL" | "PARTIAL" | "N/A":
  1.  principal_diagnosis_present_with_icd10
  2.  hospital_course_narrative_present
  3.  all_discharge_medications_documented_with_dose_frequency_duration
  4.  follow_up_plan_present_with_timeframe
  5.  warning_signs_documented
  6.  allergies_documented_or_nkda_stated
  7.  discharge_vitals_recorded
  8.  procedures_documented_if_applicable
  9.  secondary_diagnoses_documented
  10. discharge_instructions_complete_activity_diet_wound
  11. clinician_attestation_present
  12. all_17_hms_sections_populated

Score each dimension 0.0–1.0:
  completeness, clinical_safety, medication_safety,
  follow_up_adequacy, overall (mean of above)

Return:
{{
  "checklist": {{
    "principal_diagnosis_present_with_icd10":                       "PASS|FAIL|PARTIAL|N/A",
    "hospital_course_narrative_present":                            "PASS|FAIL|PARTIAL|N/A",
    "all_discharge_medications_documented_with_dose_frequency_duration": "PASS|FAIL|PARTIAL|N/A",
    "follow_up_plan_present_with_timeframe":                        "PASS|FAIL|PARTIAL|N/A",
    "warning_signs_documented":                                     "PASS|FAIL|PARTIAL|N/A",
    "allergies_documented_or_nkda_stated":                         "PASS|FAIL|PARTIAL|N/A",
    "discharge_vitals_recorded":                                    "PASS|FAIL|PARTIAL|N/A",
    "procedures_documented_if_applicable":                          "PASS|FAIL|PARTIAL|N/A",
    "secondary_diagnoses_documented":                               "PASS|FAIL|PARTIAL|N/A",
    "discharge_instructions_complete_activity_diet_wound":          "PASS|FAIL|PARTIAL|N/A",
    "clinician_attestation_present":                                "PASS|FAIL|PARTIAL|N/A",
    "all_17_hms_sections_populated":                                "PASS|FAIL|PARTIAL|N/A"
  }},
  "scores": {{
    "completeness":       0.0,
    "clinical_safety":    0.0,
    "medication_safety":  0.0,
    "follow_up_adequacy": 0.0,
    "overall":            0.0
  }},
  "gaps":                           ["list every missing or incomplete field"],
  "recommendations_for_clinician":  ["actionable recommendations"],
  "approved_for_clinical_use":      true,
  "review_notes":                   "One paragraph summary for the treating doctor"
}}
"""


class ReportQualityAgent(BaseAgent):
    agent_id = "DR4"

    async def run(self, state: ReportState) -> ReportState:
        logger.info(f"{self.agent_id} · ReportQuality — START")
        t0 = datetime.now().timestamp()

        hms       = state.get("hms_report") or {}
        specialty = state.get("specialty")  or "General Medicine"

        sec4  = hms.get("section_4_principal_diagnosis") or {}
        sec9  = hms.get("section_9_procedures_interventions") or []
        sec10 = hms.get("section_10_hospital_course") or {}
        sec11 = hms.get("section_11_medications_on_discharge") or []
        sec12 = hms.get("section_12_discharge_vitals") or {}
        sec14 = hms.get("section_14_discharge_instructions") or {}
        sec15 = hms.get("section_15_follow_up_plan") or []
        sec16 = hms.get("section_16_allergies") or []
        sec8  = hms.get("section_8_investigations") or {}

        all_inv = (
            len(sec8.get("laboratory", [])) +
            len(sec8.get("imaging", [])) +
            len(sec8.get("ecg_echo", [])) +
            len(sec8.get("histopathology_microbiology", [])) +
            len(sec8.get("other", []))
        )

        sections_present = [k for k, v in hms.items() if v not in (None, [], {}, "")]

        result = await self._invoke(
            _DR4_SYSTEM,
            _DR4_PROMPT.format(
                specialty            = specialty,
                principal_diagnosis  = sec4.get("diagnosis", "Not found"),
                sections_present     = json.dumps(sections_present),
                med_count            = len(sec11),
                inv_count            = all_inv,
                proc_count           = len(sec9),
                followup_count       = len(sec15),
                has_allergies        = len(sec16) > 0,
                has_discharge_vitals = any(v for v in sec12.values() if v and v not in ("null", "Not documented")),
                has_course           = bool(sec10.get("narrative")),
                has_warnings         = bool(sec14.get("warning_signs_to_watch")),
                has_dictation        = bool((state.get("dictation_text") or "").strip()),
                has_admission_reason = bool(state.get("admission_reason")),
                admission_reason     = state.get("admission_reason") or "Not documented",
                admission_date       = state.get("admission_date")   or "Not documented",
                course_preview       = str(sec10.get("narrative", ""))[:2000],
            ),
        )

        state["quality_report"]               = result
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(
            f"{self.agent_id} · ReportQuality — DONE "
            f"({state['agent_timings'][self.agent_id]}ms) | "
            f"Overall: {result.get('scores', {}).get('overall', 'N/A')}"
        )
        return state


# ═══════════════════════════════════════════════════════════════
# PLAIN TEXT FORMATTER
# Converts HMS JSON report → readable plain text
# ═══════════════════════════════════════════════════════════════

def _build_plain_text_report(hms: Dict, patient_id: str, doctor_id: str) -> str:
    SEP  = "═" * 80
    THIN = "─" * 80
    lines: List[str] = []

    def section_header(title: str):
        lines.extend(["", THIN, f"  {title}", THIN])

    def field(label: str, value: Any, indent: int = 4):
        if value and value not in ("Not documented", "null", "N/A", None, [], {}):
            prefix = " " * indent
            if isinstance(value, list):
                if value:
                    lines.append(f"{prefix}{label}:")
                    for item in value:
                        if isinstance(item, dict):
                            lines.append(f"{prefix}  • {json.dumps(item)}")
                        else:
                            lines.append(f"{prefix}  • {item}")
            else:
                lines.append(f"{prefix}{label}: {value}")

    meta  = hms.get("report_metadata", {})
    sec1  = hms.get("section_1_patient_demographics", {}) or {}
    sec2  = hms.get("section_2_admission_details", {}) or {}
    sec3  = hms.get("section_3_clinicians", {}) or {}
    sec4  = hms.get("section_4_principal_diagnosis", {}) or {}
    sec5  = hms.get("section_5_secondary_diagnoses", []) or []
    sec6  = hms.get("section_6_presenting_complaints_and_history", {}) or {}
    sec7  = hms.get("section_7_examination_on_admission", {}) or {}
    sec8  = hms.get("section_8_investigations", {}) or {}
    sec9  = hms.get("section_9_procedures_interventions", []) or []
    sec10 = hms.get("section_10_hospital_course", {}) or {}
    sec11 = hms.get("section_11_medications_on_discharge", []) or []
    sec12 = hms.get("section_12_discharge_vitals", {}) or {}
    sec13 = hms.get("section_13_discharge_condition", {}) or {}
    sec14 = hms.get("section_14_discharge_instructions", {}) or {}
    sec15 = hms.get("section_15_follow_up_plan", []) or []
    sec16 = hms.get("section_16_allergies", []) or []
    sec17 = hms.get("section_17_attestation", {}) or {}

    # ── Header ──────────────────────────────────────────────
    lines += [
        SEP,
        f"  DISCHARGE SUMMARY  —  {(meta.get('specialty') or '').upper()}",
        f"  Generated : {(meta.get('generated_at') or '')[:19]}",
        f"  Version   : {meta.get('version', '2.1')}",
        SEP,
    ]

    # ── 1. Demographics ─────────────────────────────────────
    section_header("1. PATIENT DEMOGRAPHICS")
    field("Patient Name",      sec1.get("patient_name"))
    field("Patient ID",        patient_id)
    field("Date of Birth",     sec1.get("date_of_birth"))
    field("Age",               sec1.get("age"))
    field("Sex",               sec1.get("sex"))
    field("Blood Group",       sec1.get("blood_group"))
    field("Contact",           sec1.get("contact_number"))
    field("Address",           sec1.get("address"))
    field("Emergency Contact", sec1.get("emergency_contact"))
    field("Insurance",         sec1.get("insurance_details"))

    # ── 2. Admission Details ─────────────────────────────────
    section_header("2. ADMISSION DETAILS")
    field("Date of Admission", sec2.get("admission_date"))
    field("Date of Discharge", sec2.get("discharge_date"))
    field("Length of Stay",    sec2.get("length_of_stay"))
    field("Ward / Unit",       sec2.get("ward"))
    field("Bed Number",        sec2.get("bed_number"))
    field("Admission Type",    sec2.get("admission_type"))
    field("Mode of Admission", sec2.get("mode_of_admission"))
    field("Referral Source",   sec2.get("referral_source"))

    # ── 3. Clinicians ────────────────────────────────────────
    section_header("3. TREATING TEAM")
    field("Attending Consultant",   sec3.get("attending_consultant"))
    field("Resident Doctor",        sec3.get("resident_doctor"))
    field("Consulting Specialists", sec3.get("consulting_specialists"))
    field("Anaesthetist",           sec3.get("anaesthetist"))
    field("Primary Nurse",          sec3.get("primary_nurse"))

    # ── 4. Principal Diagnosis ───────────────────────────────
    section_header("4. PRINCIPAL DIAGNOSIS")
    if sec4:
        lines.append(f"    {sec4.get('diagnosis', 'Not documented')}")
        if sec4.get("icd_10_code"):
            lines.append(f"    ICD-10 : {sec4['icd_10_code']}")
        if sec4.get("diagnosis_type"):
            lines.append(f"    Type   : {sec4['diagnosis_type']}")
        if sec4.get("laterality") and sec4["laterality"] not in ("Not applicable", None):
            lines.append(f"    Laterality: {sec4['laterality']}")

    # ── 5. Secondary Diagnoses ───────────────────────────────
    if sec5:
        section_header("5. SECONDARY DIAGNOSES / COMORBIDITIES")
        for d in sec5:
            line = f"    • {d.get('diagnosis', '')}"
            if d.get("icd_10_code"):  line += f"  [{d['icd_10_code']}]"
            if d.get("relationship"): line += f"  — {d['relationship']}"
            lines.append(line)

    # ── 6. History ───────────────────────────────────────────
    section_header("6. PRESENTING COMPLAINTS & HISTORY")
    if sec6.get("chief_complaints"):
        lines.append("    Chief Complaints:")
        for c in sec6["chief_complaints"]:
            lines.append(f"      • {c}")
    field("Duration", sec6.get("duration_of_complaints"))
    if sec6.get("history_of_present_illness"):
        lines.append("")
        lines.append("    History of Present Illness:")
        lines.append(f"    {sec6['history_of_present_illness']}")
    if sec6.get("past_medical_history"):
        lines.append("")
        lines.append("    Past Medical History:")
        for h in sec6["past_medical_history"]:
            lines.append(f"      • {h}")
    if sec6.get("past_surgical_history"):
        lines.append("    Past Surgical History:")
        for h in sec6["past_surgical_history"]:
            lines.append(f"      • {h}")
    field("Family History",    sec6.get("family_history"))
    field("Social History",    sec6.get("social_history"))
    field("Review of Systems", sec6.get("review_of_systems"))

    # ── 7. Examination ───────────────────────────────────────
    section_header("7. EXAMINATION ON ADMISSION")
    field("General Appearance", sec7.get("general_appearance"))
    vitals_adm = sec7.get("vitals") or {}
    if any(vitals_adm.values()):
        lines.append("    Vitals on Admission:")
        for k, v in vitals_adm.items():
            if v and v not in ("null", None):
                lines.append(f"      {k.replace('_', ' ').title()}: {v}")
    syst = sec7.get("systemic_examination") or {}
    if any(v for v in syst.values() if v and v != "null"):
        lines.append("    Systemic Examination:")
        for sys_name, finding in syst.items():
            if finding and finding not in ("null", None, "Not documented"):
                lines.append(f"      {sys_name.replace('_', ' ').title()}: {finding}")

    # ── 8. Investigations ────────────────────────────────────
    section_header("8. INVESTIGATIONS & RESULTS")

    lab = sec8.get("laboratory") or []
    if lab:
        lines.append("    Laboratory:")
        for inv in lab:
            line = f"      • {inv.get('test', '')}: {inv.get('result', '')} {inv.get('unit', '') or ''}"
            if inv.get("reference_range"):
                line += f"  [Ref: {inv['reference_range']}]"
            st = (inv.get("status") or "").lower()
            if st in ("abnormal", "critical"):
                line += f"  ⚠ {st.upper()}"
            if inv.get("date"):
                line += f"  ({inv['date']})"
            lines.append(line)

    imaging = sec8.get("imaging") or []
    if imaging:
        lines.append("    Imaging:")
        for img in imaging:
            lines.append(
                f"      • {img.get('modality', '')} {img.get('region', '')}: "
                f"{img.get('findings', '')}"
                + (f"  ({img['date']})" if img.get("date") else "")
                + (f"  — {img['reported_by']}" if img.get("reported_by") else "")
            )

    ecg_echo = sec8.get("ecg_echo") or []
    if ecg_echo:
        lines.append("    ECG / Echocardiogram:")
        for e in ecg_echo:
            lines.append(
                f"      • {e.get('type', '')}: {e.get('findings', '')}"
                + (f"  ({e['date']})" if e.get("date") else "")
            )

    histo = sec8.get("histopathology_microbiology") or []
    if histo:
        lines.append("    Histopathology / Microbiology:")
        for h in histo:
            lines.append(
                f"      • {h.get('test', '')} [{h.get('specimen', '')}]: "
                f"{h.get('findings', '')}"
                + (f"  ({h['date']})" if h.get("date") else "")
            )

    other_inv = sec8.get("other") or []
    if other_inv:
        lines.append("    Other Investigations:")
        for o in other_inv:
            lines.append(
                f"      • {o.get('test', '')}: {o.get('findings', '')}"
                + (f"  ({o['date']})" if o.get("date") else "")
            )

    # ── 9. Procedures ────────────────────────────────────────
    if sec9:
        section_header("9. PROCEDURES & INTERVENTIONS")
        for proc in sec9:
            lines.append(f"    ▸ {proc.get('procedure_name', '')}")
            if proc.get("date"):                    lines.append(f"      Date              : {proc['date']}")
            if proc.get("indication"):              lines.append(f"      Indication        : {proc['indication']}")
            if proc.get("surgeon_operator"):        lines.append(f"      Surgeon / Operator: {proc['surgeon_operator']}")
            if proc.get("anaesthesia_type"):        lines.append(f"      Anaesthesia       : {proc['anaesthesia_type']}")
            if proc.get("intraoperative_findings"): lines.append(f"      Findings          : {proc['intraoperative_findings']}")
            if proc.get("specimens_sent"):          lines.append(f"      Specimens Sent    : {proc['specimens_sent']}")
            if proc.get("complications"):           lines.append(f"      Complications     : {proc['complications']}")
            if proc.get("outcome"):                 lines.append(f"      Outcome           : {proc['outcome']}")
            lines.append("")

    # ── 10. Hospital Course ──────────────────────────────────
    section_header("10. HOSPITAL COURSE")
    if sec10.get("narrative"):
        lines.append(f"    {sec10['narrative']}")

    clinical_days = sec10.get("clinical_days") or []
    if clinical_days:
        lines.append("")
        lines.append("    Day-by-Day Summary:")
        for day in clinical_days:
            lines.append(
                f"      {day.get('date', '')}  [{day.get('day_label', '')}]  "
                f"— {day.get('key_events', '')}"
            )

    vitals_trend = sec10.get("vitals_trend") or []
    if vitals_trend:
        lines.append("")
        lines.append("    Vitals Trend:")
        header_parts = ["Date", "Label", "BP", "HR", "RR", "Temp", "SpO2", "UO"]
        lines.append("      " + "  |  ".join(f"{h:<10}" for h in header_parts))
        lines.append("      " + "-" * 70)
        for vt in vitals_trend:
            row = [
                str(vt.get("date", "") or "")[:10],
                str(vt.get("day_label", "") or "")[:10],
                str(vt.get("blood_pressure", "") or "")[:10],
                str(vt.get("heart_rate", "") or "")[:6],
                str(vt.get("respiratory_rate", "") or "")[:6],
                str(vt.get("temperature", "") or "")[:8],
                str(vt.get("spo2", "") or "")[:8],
                str(vt.get("urine_output", "") or "")[:8],
            ]
            lines.append("      " + "  |  ".join(f"{c:<10}" for c in row))

    if sec10.get("significant_events"):
        lines.append("")
        lines.append("    Significant Events:")
        for ev in sec10["significant_events"]:
            lines.append(f"      • {ev}")

    if sec10.get("complications_during_admission"):
        lines.append("    Complications During Admission:")
        for c in sec10["complications_during_admission"]:
            lines.append(f"      • {c}")

    # ── 11. Medications on Discharge ─────────────────────────
    if sec11:
        section_header("11. MEDICATIONS ON DISCHARGE")
        for i, med in enumerate(sec11, 1):
            parts = [f"{i}. {med.get('drug_name', '')}"]
            if med.get("brand_name") and med["brand_name"] not in ("null", None, "Not specified"):
                parts[0] += f" ({med['brand_name']})"
            if med.get("dose"):      parts.append(med["dose"])
            if med.get("route"):     parts.append(f"({med['route']})")
            if med.get("frequency"): parts.append(med["frequency"])
            if med.get("duration"):  parts.append(f"× {med['duration']}")
            lines.append(f"    {'  '.join(p for p in parts if p)}")
            if med.get("special_instructions") and med["special_instructions"] not in ("null", None):
                lines.append(f"        Note : {med['special_instructions']}")
            if med.get("indication") and med["indication"] not in ("null", None):
                lines.append(f"        For  : {med['indication']}")
    else:
        section_header("11. MEDICATIONS ON DISCHARGE")
        lines.append("    No discharge medications documented.")

    # ── 12. Discharge Vitals ─────────────────────────────────
    section_header("12. DISCHARGE VITALS")
    has_dv = False
    for k, v in (sec12 or {}).items():
        if v and v not in ("null", None, "Not documented"):
            lines.append(f"    {k.replace('_', ' ').title()}: {v}")
            has_dv = True
    if not has_dv:
        lines.append("    Not documented")

    # ── 13. Discharge Condition ──────────────────────────────
    section_header("13. CONDITION ON DISCHARGE")
    oc = sec13.get("overall_condition")
    if oc and oc not in ("null", None, "Not documented"):
        field("Overall Condition", oc)
    else:
        lines.append("    Not documented")
    field("Functional Status", sec13.get("functional_status"))
    field("Mobility",          sec13.get("mobility"))
    field("Pain Level",        sec13.get("pain_level"))
    field("Wound Status",      sec13.get("wound_status"))
    field("Drain / Tube",      sec13.get("drain_tube_status"))

    # ── 14. Discharge Instructions ───────────────────────────
    section_header("14. DISCHARGE INSTRUCTIONS")
    field("Activity",           sec14.get("activity"))
    field("Diet",               sec14.get("diet"))
    field("Wound Care",         sec14.get("wound_care"))
    field("Catheter/Drain Care",sec14.get("catheter_drain_care"))
    if sec14.get("restrictions"):
        lines.append("    Restrictions:")
        for r in sec14["restrictions"]:
            lines.append(f"      • {r}")
    if sec14.get("warning_signs_to_watch"):
        lines.append("    ⚠  Warning Signs — Call Doctor If:")
        for w in sec14["warning_signs_to_watch"]:
            lines.append(f"      • {w}")
    if sec14.get("when_to_seek_emergency_care"):
        lines.append("    🚨  Go to Emergency Immediately If:")
        for e in sec14["when_to_seek_emergency_care"]:
            lines.append(f"      • {e}")
    if not any([
        sec14.get("activity"), sec14.get("diet"), sec14.get("wound_care"),
        sec14.get("restrictions"), sec14.get("warning_signs_to_watch"),
        sec14.get("when_to_seek_emergency_care"),
    ]):
        lines.append("    Not documented")

    # ── 15. Follow-Up ────────────────────────────────────────
    if sec15:
        section_header("15. FOLLOW-UP PLAN")
        for fu in sec15:
            lines.append(f"    ▸ {fu.get('appointment_with', '')}  [{fu.get('specialty', '')}]")
            lines.append(f"      When   : {fu.get('timeframe', '')}")
            lines.append(f"      Where  : {fu.get('location', '')}")
            lines.append(f"      Purpose: {fu.get('purpose', '')}")
            if fu.get("tests_before_visit"):
                lines.append(f"      Tests before visit: {', '.join(fu['tests_before_visit'])}")
            lines.append("")
    else:
        section_header("15. FOLLOW-UP PLAN")
        lines.append("    No follow-up plan documented.")

    # ── 16. Allergies ────────────────────────────────────────
    section_header("16. ALLERGIES & ADVERSE REACTIONS")
    if sec16:
        for a in sec16:
            lines.append(
                f"    ⚠  {a.get('allergen', '')} — {a.get('reaction_type', '')} "
                f"[{a.get('severity', '')}]"
            )
    else:
        lines.append("    No known allergies documented.")

    # ── 17. Attestation ──────────────────────────────────────
    section_header("17. CLINICIAN ATTESTATION")
    field("Prepared By",       sec17.get("prepared_by"))
    field("Designation",       sec17.get("designation"))
    field("Date",              sec17.get("date"))
    field("Reviewed By",       sec17.get("reviewed_by"))
    field("Digital Signature", sec17.get("digital_signature"))

    lines += ["", SEP, "  END OF DISCHARGE REPORT", SEP]
    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════
# WORKFLOW GRAPH
# DR0 → DR1 → DR2 → DR3 → DR4 → END
# ═══════════════════════════════════════════════════════════════

def create_report_workflow():
    workflow = StateGraph(ReportState)

    workflow.add_node("DR0", DataFetcherAgent(llm_light).run)
    workflow.add_node("DR1", DictationParserAgent(llm_heavy).run)
    workflow.add_node("DR2", TimelineExtractorAgent(llm_heavy).run)
    workflow.add_node("DR3", ReportSynthesizerAgent(llm_heavy).run)
    workflow.add_node("DR4", ReportQualityAgent(llm_light).run)

    workflow.set_entry_point("DR0")
    workflow.add_edge("DR0", "DR1")
    workflow.add_edge("DR1", "DR2")
    workflow.add_edge("DR2", "DR3")
    workflow.add_edge("DR3", "DR4")
    workflow.add_edge("DR4", END)

    return workflow.compile()


report_workflow = create_report_workflow()


# ═══════════════════════════════════════════════════════════════
# STATE FACTORY
# ═══════════════════════════════════════════════════════════════

def build_report_state(request: DischargeReportRequest) -> ReportState:
    return ReportState(
        patient_id             = request.patient_id,
        doctor_id              = request.doctor_id,
        dictation_text         = request.dictation_text or "",
        specialty              = request.specialty,
        day_wise_timeline      = [],
        patient_info           = {},
        discharge_summary_raw  = None,
        # Appointment context — populated by DR0
        admission_reason       = None,
        admission_date         = None,
        dictation_fields       = None,
        timeline_fields        = None,
        hms_report             = None,
        quality_report         = None,
        errors                 = [],
        agent_timings          = {},
    )


# ═══════════════════════════════════════════════════════════════
# DEMO DICTATION
# ═══════════════════════════════════════════════════════════════

_DEMO_DICTATION = """\
Patient Mr. Rajesh Kumar, 58-year-old male, was admitted on 6th January 2026
under urology with presenting complaint of painless hematuria for 3 months.

He has a background of hypertension on amlodipine 5mg OD and type 2 diabetes
on metformin 500mg BD. No known drug allergies.

On admission, blood pressure was 130/80 mmHg, heart rate 88 per minute,
temperature 98.6°F, SpO2 98% on room air. Abdomen was soft and non-tender.

Investigations showed haemoglobin of 7.2 gm%, which is low, likely due to
chronic blood loss from the tumour. USG abdomen showed a 2.5 cm lesion in
the right lateral wall of the bladder. Cystoscopy confirmed a papillary
lesion and TURBT was performed on 6th January 2026.

Histopathology confirmed transitional cell carcinoma grade 3 with muscle
invasion, no lymphovascular invasion.

Post-operatively patient was haemodynamically stable with transient hypotension
managed with IV fluids. He received IV ceftriaxone and oral pantoprazole.
Catheter was removed on post-operative day 3 with clear urine.

Echocardiogram showed preserved LV function, EF 71%, mild LV diastolic
dysfunction grade 1 — clinically not significant.

Patient is being discharged in stable condition on:
1. Tab. Amlodipine 5mg OD
2. Tab. Metformin 500mg BD with meals
3. Tab. Pantoprazole 40mg OD before breakfast
4. Tab. Amoxicillin-Clavulanate 625mg BD for 5 days
5. Tab. Tramadol 50mg SOS for pain, not more than 3 times a day

Discharge instructions: Adequate oral fluids, avoid strenuous activity for
4 weeks, pelvic rest for 6 weeks. Report immediately if frank hematuria,
fever above 101°F, difficulty urinating, or abdominal pain.

Follow-up with urology in 2 weeks for wound review and to discuss oncology
referral. Intravesical BCG therapy to be planned post-recovery.
Repeat cystoscopy to be scheduled at 3 months.

Dr. Arun Menon, Consultant Urologist.
"""


# ═══════════════════════════════════════════════════════════════
# API ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@router.post("/discharge-report", response_model=None)
async def generate_discharge_report(request: DischargeReportRequest):
    """
    Discharge Report Generator v2.1.0

    Input  : patient_id, doctor_id, dictation_text (optional), specialty (optional)
    Sources:
      • discharge_summaries MongoDB → day_wise_timeline
      • patient_appointments MongoDB → latest IP appointment (admission_reason + date)
    Output : HMS-standard 17-section structured discharge report (JSON + plain text)

    Priority Rule:
      1. Dictation (PRIMARY)    — if provided, scalar fields always win
      2. Timeline (SECONDARY)   — fills gaps where dictation is null
      3. Appointment context    — final fallback for admission_reason & admission_date
      4. null                   — if no source has the data (never invented)
    """
    start_ms = datetime.now().timestamp() * 1000
    logger.info(
        f"Discharge Report v2.1 | patient={request.patient_id} | "
        f"doctor={request.doctor_id} | "
        f"has_dictation={bool(request.dictation_text and request.dictation_text.strip())} | "
        f"dictation_len={len(request.dictation_text or '')}"
    )

    try:
        initial_state = build_report_state(request)
        result        = await report_workflow.ainvoke(initial_state)

        hms_report = result.get("hms_report") or {}
        quality    = result.get("quality_report") or {}
        elapsed    = round(datetime.now().timestamp() * 1000 - start_ms)

        plain_text = _build_plain_text_report(
            hms_report,
            request.patient_id,
            request.doctor_id,
        )

        response = {
            "patient_id":                request.patient_id,
            "doctor_id":                 request.doctor_id,
            "generated_at":              datetime.now().isoformat(),
            "processing_time_ms":        elapsed,
            "version":                   "2.1.0",

            # Full structured HMS report (JSON — 17 sections)
            "hms_report":                hms_report,

            # Formatted plain text version
            "discharge_report_text":     plain_text,

            # Quality audit
            "quality_report":            quality,
            "score":                     quality.get("scores", {}),
            "gaps":                      quality.get("gaps", []),
            "approved_for_clinical_use": quality.get("approved_for_clinical_use", True),

            # Metadata
            "agent_timings":             result.get("agent_timings", {}),
            "errors":                    result.get("errors", []),
            "data_sources_used": {
                "dictation_provided":  bool((request.dictation_text or "").strip()),
                "timeline_blocks":     len(result.get("day_wise_timeline") or []),
                "admission_reason":    result.get("admission_reason"),
                "admission_date":      result.get("admission_date"),
            },
        }

        if request.include_intermediates:
            response["intermediate"] = {
                "dictation_fields":        result.get("dictation_fields"),
                "timeline_fields":         result.get("timeline_fields"),
                "day_wise_timeline_count": len(result.get("day_wise_timeline") or []),
                "admission_reason":        result.get("admission_reason"),
                "admission_date":          result.get("admission_date"),
            }

        # Persist to MongoDB
        try:
            await mongo_db["discharge_reports"].insert_one({
                **response,
                "dictation_text": request.dictation_text,
                "saved_at":       datetime.utcnow(),
            })
        except Exception as e:
            logger.error(f"MongoDB save failed: {e}")

        logger.info(
            f"Discharge Report complete | patient={request.patient_id} | "
            f"{elapsed}ms | quality_overall={quality.get('scores', {}).get('overall', 'N/A')}"
        )
        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            f"Discharge Report pipeline failed | patient={request.patient_id} | {e}"
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/discharge-report/demo")
async def run_discharge_report_demo():
    """Run pipeline with demo dictation — urology TURBT case."""
    demo_request = DischargeReportRequest(
        patient_id            = "PAT-demo-001",
        doctor_id             = "DOC-demo-001",
        dictation_text        = _DEMO_DICTATION,
        specialty             = "Urology",
        include_intermediates = True,
    )
    return await generate_discharge_report(demo_request)


@router.get("/discharge-report/demo-no-dictation")
async def run_discharge_report_demo_no_dictation():
    """Run pipeline WITHOUT dictation — relies on timeline + appointment data."""
    demo_request = DischargeReportRequest(
        patient_id            = "PAT-demo-001",
        doctor_id             = "DOC-demo-001",
        dictation_text        = None,
        specialty             = None,
        include_intermediates = True,
    )
    return await generate_discharge_report(demo_request)


@router.get("/discharge-report/health")
async def discharge_report_health():
    return {
        "status":  "ok",
        "version": "2.1.0",
        "agents":  5,

        "pipeline": [
            "DR0 · DataFetcher       — loads day_wise_timeline from discharge_summaries "
            "(patient_id + doctor_id) AND fetches admission_reason + admission_date "
            "from patient_appointments (latest IP visit matching doctor_id, sorted by created_at desc)",

            "DR1 · DictationParser   — PRIMARY: LLM extracts ALL HMS fields from dictation "
            "(skipped if no dictation); seeds admission_date + chief_complaints from "
            "appointment context if dictation omits them",

            "DR2 · TimelineExtractor — SECONDARY: extracts ALL clinical data from timeline; "
            "uses admission_reason + admission_date from appointment context as fallback "
            "if absent from timeline",

            "DR3 · ReportSynthesizer — MERGE: dictation wins scalars; UNION for lists; "
            "appointment context is SOURCE D final fallback for admission fields; "
            "null if no source has data → 17-section HMS report",

            "DR4 · ReportQuality     — 12-point checklist + 5-dimension scoring",
        ],

        "priority_rule": (
            "1. Dictation is PRIMARY — if the doctor said it, that is the value. "
            "2. Timeline FILLS GAPS — used where dictation is null. "
            "3. Appointment context is FINAL FALLBACK for admission_reason + admission_date. "
            "4. If no source has data → null. Never invent."
        ),

        "admission_context_source": (
            "patient_appointments collection → appointments[] filtered by "
            "doctor_id match AND visit_type == 'IP', sorted by created_at desc. "
            "Provides: admission_reason (chief_complaint) and admission_date (date)."
        ),

        "dictation_optional": (
            "dictation_text is optional. If not provided, DR1 is skipped "
            "and the full report is built from timeline + appointment data."
        ),

        "hms_sections": [
            "1.  Patient Demographics & Identifiers",
            "2.  Admission Details (dates from dictation → timeline → appointment)",
            "3.  Attending & Consulting Clinicians",
            "4.  Principal Diagnosis (with ICD-10)",
            "5.  Secondary Diagnoses & Comorbidities (with ICD-10)",
            "6.  Presenting Complaints (chief_complaint from appointment as fallback), HPI, PMH, PSH",
            "7.  Physical Examination on Admission (vitals + systemic)",
            "8.  Investigations (Lab / Imaging / Echo-ECG / Histo-Micro / Other)",
            "9.  Procedures & Interventions (surgeon, anaesthesia, findings, outcome)",
            "10. Hospital Course (narrative opened with admission reason if not otherwise captured)",
            "11. Medications on Discharge (drug + dose + route + freq + duration)",
            "12. Discharge Vitals",
            "13. Discharge Condition & Functional Status",
            "14. Discharge Instructions (activity, diet, wound, warnings, emergency signs)",
            "15. Follow-Up Plan (who, when, where, purpose, pre-visit tests)",
            "16. Allergies & Adverse Reactions",
            "17. Treating Clinician Attestation",
        ],

        "output_formats": [
            "hms_report (structured JSON — 17 sections)",
            "discharge_report_text (formatted plain text)",
        ],

        "data_sources": {
            "discharge_summaries": "day_wise_timeline, patient info (most recent record for patient+doctor)",
            "patient_appointments": "latest IP appointment for patient+doctor → admission_reason + admission_date",
        },
    }