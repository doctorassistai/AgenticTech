"""
Insurance Claim Validation — Multi-Agent Pipeline (v2.5)
==========================================================

Updated output format to match the required JSON structure:
- patient_summary
- primary_diagnosis
- secondary_diagnoses
- investigations (with test_name, claim_remarks, system_remarks, status, reason_for_rejection)
- procedures (with procedure_name, claim_remarks, system_remarks, status, reason_for_rejection)
- return_notes_from_system

claim_remarks now only contain:
- "Billable Test under Insurance"
- "Non Billable Test Insurance"
"""

from __future__ import annotations

import asyncio
import calendar
import json
import os
import re
from datetime import datetime, date as date_cls
from typing import Any, Dict, List, Optional, Tuple, TypedDict

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorClient

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END

# ============================================================
# ENVIRONMENT / CLIENTS
# ============================================================

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

mongo_client = AsyncIOMotorClient(MONGO_URI)
mongo_db = mongo_client[MONGO_DB]

# Source of truth for visit history
patient_visit_history_collection = mongo_db["patientVisitHistory"]

# Source of truth for lab report history
LAB_REPORTS_COLLECTION_NAME = "integration_lab_reports"
integration_lab_reports_collection = mongo_db[LAB_REPORTS_COLLECTION_NAME]

# Where validated claims get persisted
insurance_claim_validation_collection = mongo_db["insurance_claim_validation"]

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

CLAIM_MAX_TOKENS = int(os.getenv("CLAIM_MAX_TOKENS", "3000"))
PREVIOUS_VISITS_CONTEXT_COUNT = int(os.getenv("PREVIOUS_VISITS_CONTEXT_COUNT", "3"))
LAB_HISTORY_WINDOW_MONTHS = int(os.getenv("LAB_HISTORY_WINDOW_MONTHS", "3"))

# Evidence Grounding Rules - medications are context only, never evidence
MEDICATION_EXCLUSION_RULE = (
    "EVIDENCE GROUNDING — MEDICATION EXCLUSION: every conclusion you "
    "produce must be directly traceable to documented clinical evidence "
    "from the latest visit — Primary Diagnosis, Presenting Complaint, "
    "Doctor Notes, Recent Abnormal Laboratory Values, Investigations, "
    "Procedures, or Visit Summary. Prescribed medications may inform "
    "clinical context but must NEVER be used to justify a diagnosis, an "
    "investigation, a procedure, or an insurance approval."
)

HISTORICAL_VISIT_RULE = (
    "HISTORICAL VISIT RULES: previous visits may only be used to "
    "understand chronic diseases, previous surgeries, previous "
    "procedures, long-term disease progression, previous abnormal "
    "laboratory trends, or recurring conditions. Previous visits must "
    "never become the primary evidence for the current diagnosis, "
    "current investigation, current procedure, or current medical "
    "necessity."
)

llm_claim_validation = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0.1,
    groq_api_key=GROQ_API_KEY,
    max_tokens=CLAIM_MAX_TOKENS,
)

router = APIRouter(prefix="", tags=["Insurance Claim Validation"])


# ============================================================
# HELPERS
# ============================================================

def parse_llm_json(text: str) -> Dict[str, Any]:
    if not text:
        return {}
    text = text.strip()
    text = re.sub(r"```json", "", text)
    text = re.sub(r"```", "", text)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        text = match.group(0)
    try:
        return json.loads(text)
    except Exception:
        return {"raw_output": text}


def _parse_visit_date(value: Any) -> Optional[date_cls]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date_cls):
        return value
    if isinstance(value, str):
        for fmt in (
            "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%d-%m-%Y", "%d/%m/%Y",
            "%m/%d/%Y", "%d-%b-%Y", "%d %b %Y", "%B %d, %Y",
        ):
            try:
                return datetime.strptime(value.strip(), fmt).date()
            except ValueError:
                continue
    return None


def _sort_key(visit: Dict[str, Any]):
    d = _parse_visit_date(visit.get("visit_date"))
    return (d is None, d or date_cls.min)


def _name_of(item: Any, key_dict: str, key_fallback: str = None) -> str:
    if isinstance(item, dict):
        return item.get(key_dict) or item.get(key_fallback or key_dict) or "Unknown"
    return str(item)


def _subtract_months(d: date_cls, months: int) -> date_cls:
    month = d.month - months
    year = d.year
    while month <= 0:
        month += 12
        year -= 1
    last_day = calendar.monthrange(year, month)[1]
    day = min(d.day, last_day)
    return date_cls(year, month, day)


def _normalize_report_name(name: Optional[str]) -> str:
    if not name:
        return ""
    name = name.lower()
    name = re.sub(r"[^a-z0-9 ]", " ", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name


def _extract_name_variants(raw_name: Optional[str]) -> List[str]:
    if not raw_name:
        return []
    variants = set()
    variants.add(_normalize_report_name(raw_name))
    paren_match = re.search(r"\(([^)]+)\)", raw_name)
    if paren_match:
        variants.add(_normalize_report_name(paren_match.group(1)))
    without_parens = re.sub(r"\([^)]*\)", "", raw_name)
    variants.add(_normalize_report_name(without_parens))
    return [v for v in variants if v]


def _names_match(investigation_name: str, report_name: str) -> bool:
    inv_variants = _extract_name_variants(investigation_name)
    rep_variants = _extract_name_variants(report_name)
    for inv_v in inv_variants:
        for rep_v in rep_variants:
            if not inv_v or not rep_v:
                continue
            if inv_v == rep_v or inv_v in rep_v or rep_v in inv_v:
                return True
    return False


def _parse_numeric(value: Any) -> Optional[float]:
    if value is None:
        return None
    match = re.search(r"-?\d+\.?\d*", str(value))
    return float(match.group()) if match else None


def _report_is_normal(report: Dict[str, Any]) -> Tuple[bool, List[str]]:
    abnormal: List[str] = []
    for param in report.get("parameters", []) or []:
        value = _parse_numeric(param.get("value"))
        low = _parse_numeric(param.get("low_range"))
        high = _parse_numeric(param.get("high_range"))
        if value is None:
            continue
        if low is not None and value < low:
            abnormal.append(f"{param.get('name')}={param.get('value')} (below {param.get('low_range')})")
        elif high is not None and value > high:
            abnormal.append(f"{param.get('name')}={param.get('value')} (above {param.get('high_range')})")
    return (len(abnormal) == 0, abnormal)


def build_lab_history_context(
    investigations: List[Any],
    lab_reports: List[Dict[str, Any]],
    latest_visit_date: Optional[date_cls],
) -> Dict[str, Dict[str, Any]]:
    """Build deterministic lab history context for each investigation."""
    context: Dict[str, Dict[str, Any]] = {}

    window_start = (
        _subtract_months(latest_visit_date, LAB_HISTORY_WINDOW_MONTHS)
        if latest_visit_date else None
    )

    for inv in investigations:
        inv_name = _name_of(inv, "investigation_name")

        best_report: Optional[Dict[str, Any]] = None
        best_date: Optional[date_cls] = None

        for report in lab_reports:
            if not _names_match(inv_name, report.get("report_name", "")):
                continue

            report_date = _parse_visit_date(report.get("report_date"))
            if report_date is None:
                continue

            if latest_visit_date and report_date > latest_visit_date:
                continue

            if best_date is None or report_date > best_date:
                best_date, best_report = report_date, report
            elif report_date == best_date and best_report is not None:
                prev_created = best_report.get("created_at")
                cur_created = report.get("created_at")
                try:
                    if cur_created and prev_created and cur_created > prev_created:
                        best_report = report
                except TypeError:
                    pass

        if best_report is None:
            context[inv_name] = {
                "previous_similar_investigation_found": False,
                "previous_investigation_date": "",
                "previous_report_within_last_3_months": False,
                "previous_report_normal": None,
                "abnormal_parameters": [],
            }
            continue

        within_window = bool(
            window_start is not None and best_date is not None and best_date >= window_start
        )
        is_normal, abnormal_params = _report_is_normal(best_report)

        context[inv_name] = {
            "previous_similar_investigation_found": True,
            "previous_investigation_date": str(best_date),
            "previous_report_within_last_3_months": within_window,
            "previous_report_normal": is_normal,
            "abnormal_parameters": abnormal_params,
        }

    return context


def _determine_insurance_rule_applied(ctx: Dict[str, Any], repeat_justified: bool) -> str:
    """Deterministically render the Case 1-4 wording from the spec."""
    found = ctx.get("previous_similar_investigation_found")
    within_window = ctx.get("previous_report_within_last_3_months")
    normal = ctx.get("previous_report_normal")

    if not found or not within_window:
        return (
            "No equivalent investigation was found within the previous "
            f"{LAB_HISTORY_WINDOW_MONTHS} months, so this investigation was "
            "evaluated using standard medical necessity criteria from the "
            "latest visit documentation alone."
        )

    if normal and not repeat_justified:
        return (
            "Repeat investigation not supported because an equivalent "
            f"investigation performed within the previous "
            f"{LAB_HISTORY_WINDOW_MONTHS} months demonstrated normal "
            "findings without any documented new clinical indication."
        )

    if normal and repeat_justified:
        return (
            "Repeat investigation supported because the latest visit "
            "documents a new clinical indication despite previous normal "
            "laboratory findings."
        )

    if normal is False and repeat_justified:
        return (
            "Repeat investigation supported for monitoring previously "
            "abnormal laboratory findings."
        )

    if normal is False and not repeat_justified:
        return (
            "A previous equivalent investigation was abnormal, but the "
            "latest visit does not document a clinical indication for "
            "repeat testing at this time."
        )

    return ""


def _determine_claim_remarks(status: str, billable_status: str) -> str:
    """
    Determine the claim_remarks value based on status and billable status.
    Only returns "Billable Test under Insurance" or "Non Billable Test Insurance".
    """
    if status == "Approved" and billable_status == "Billable":
        return "Billable Test under Insurance"
    elif status == "Approved" and billable_status == "Non-Billable":
        return "Non Billable Test Insurance"
    elif status == "Rejected":
        return "Non Billable Test Insurance"
    elif status == "Pending Documentation":
        return "Non Billable Test Insurance"
    else:
        return "Non Billable Test Insurance"


# ============================================================
# REQUEST MODEL
# ============================================================

class ClaimValidationRequest(BaseModel):
    patient_id: str
    doctor_id: str
    include_intermediates: bool = False


# ============================================================
# SHARED STATE
# ============================================================

class ClaimValidationState(TypedDict):
    patient_id: str
    doctor_id: str
    latest_visit: Dict[str, Any]
    previous_visits: List[Dict[str, Any]]
    lab_report_history: List[Dict[str, Any]]

    # A1 — Diagnosis
    diagnosis_result: Optional[Dict[str, Any]]

    # A2 — Investigations
    investigation_result: Optional[Dict[str, Any]]

    # A3 — Procedures
    procedure_result: Optional[Dict[str, Any]]

    # A4 — Insurance Decision
    decision_result: Optional[Dict[str, Any]]

    # Return Notes
    return_notes: Optional[List[Dict[str, Any]]]

    errors: List[str]
    agent_timings: Dict[str, float]


# ============================================================
# FETCH FUNCTIONS
# ============================================================

async def fetch_patient_visit_history(patient_id: str, doctor_id: str) -> List[Dict[str, Any]]:
    doc = await patient_visit_history_collection.find_one(
        {"patient_id": patient_id, "doctor_id": doctor_id},
        {"_id": 0, "visits": 1},
    )
    if not doc or not doc.get("visits"):
        return []
    visits = doc["visits"]
    visits_sorted = sorted(visits, key=_sort_key, reverse=True)
    return visits_sorted


def select_latest_and_context_visits(
    visits_sorted: List[Dict[str, Any]],
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    latest_visit = visits_sorted[0]
    context_visits = visits_sorted[1: 1 + PREVIOUS_VISITS_CONTEXT_COUNT]
    return latest_visit, context_visits


async def fetch_lab_report_history(patient_id: str, doctor_id: str) -> List[Dict[str, Any]]:
    doc = await integration_lab_reports_collection.find_one(
        {"patient_id": patient_id, "doctor_id": doctor_id},
        {"_id": 0, "reports": 1},
    )
    if not doc or not doc.get("reports"):
        return []
    return doc["reports"]


# ============================================================
# BASE AGENT
# ============================================================

class BaseAgent:
    def __init__(self, llm):
        self.llm = llm

    async def _invoke(self, system: str, user: str) -> Dict[str, Any]:
        response = await self.llm.ainvoke([
            SystemMessage(content=system),
            HumanMessage(content=user),
        ])
        return parse_llm_json(response.content)

    def _elapsed(self, start: float) -> float:
        return round((datetime.now().timestamp() - start) * 1000, 1)


# ============================================================
# A1 · DIAGNOSIS AGENT — Patient Complaint + Primary + Secondary Diagnoses
# ============================================================

class DiagnosisAgent(BaseAgent):
    agent_id = "A1_DIAGNOSIS"

    async def run(self, state: ClaimValidationState) -> ClaimValidationState:
        logger.info(f"{self.agent_id} · DiagnosisAgent — START")
        t0 = datetime.now().timestamp()

        latest_json = json.dumps(state["latest_visit"], indent=2, default=str)
        prior_json = (
            json.dumps(state["previous_visits"], indent=2, default=str)
            if state["previous_visits"] else "None available."
        )

        system = (
            "You are an expert Medical Insurance Claim Validation Assistant, "
            "specifically responsible for extracting the latest visit's own "
            "clinical fields and validating diagnoses. You use earlier visits "
            "STRICTLY as historical/clinical context — you never source the "
            "diagnosis, its support, or its ICD-10 code from anything other "
            "than the latest visit.\n\n"
            "Follow these steps:\n"
            "1. Extract the Patient Complaint / Presenting Complaint:\n"
            "   - Primary presenting complaint\n"
            "   - Secondary complaint(s), if documented\n"
            "   - Duration of symptoms\n"
            "   - Relevant past medical history related to the current encounter\n"
            "   - Current medication history (context only)\n"
            "   - Relevant abnormal clinical or laboratory findings\n"
            "   - Physician assessment\n"
            "   - Clinical justification for ordering investigations and procedures\n"
            "2. Extract the Primary Diagnosis with ICD-10-CM code\n"
            "3. Extract up to five Secondary Diagnoses that influence patient management\n\n"
            f"{MEDICATION_EXCLUSION_RULE}\n\n"
            f"{HISTORICAL_VISIT_RULE}\n\n"
            "Always respond with valid JSON only."
        )

        prompt = f"""
══════════════════════════════════════════════════════════
LATEST VISIT (the ONLY source for the diagnosis)
══════════════════════════════════════════════════════════
{latest_json}

══════════════════════════════════════════════════════════
PREVIOUS VISITS (HISTORICAL CONTEXT ONLY)
══════════════════════════════════════════════════════════
{prior_json}

══════════════════════════════════════════════════════════
TASK
══════════════════════════════════════════════════════════
STEP 2 — Patient Complaint / Presenting Complaint:
Extract a concise clinical summary from the latest medical visit only.

STEP 3 — Primary Diagnosis:
Populate the primary diagnosis documented during the latest visit with ICD-10-CM code.

STEP 4 — Secondary Diagnoses:
Populate up to five documented secondary diagnoses that influence patient management.
Each diagnosis should strengthen or reflect the clinical complexity of the primary diagnosis.

Return ONLY valid JSON:
{{
  "patient_summary": {{
    "primary_complaint": "",
    "secondary_complaints": [],
    "duration_of_symptoms": "",
    "relevant_past_medical_history": "",
    "current_medication_history": "",
    "relevant_abnormal_findings": [],
    "physician_assessment": "",
    "clinical_justification": ""
  }},
  "primary_diagnosis": {{
    "diagnosis": "",
    "icd10_code": "",
    "diagnosis_confidence": "High/Moderate/Low",
    "diagnosis_supported": true,
    "diagnosis_support": ""
  }},
  "secondary_diagnoses": [
    {{
      "diagnosis": "",
      "description": "",
      "icd10_code": ""
    }}
  ]
}}
"""
        try:
            result = await self._invoke(system, prompt)
            if not isinstance(result, dict):
                raise ValueError("unparseable diagnosis output")
            result.setdefault("patient_summary", {})
            result.setdefault("primary_diagnosis", {})
            result.setdefault("secondary_diagnoses", [])
        except Exception as e:
            logger.error(f"{self.agent_id} · failed: {e}")
            state["errors"].append(f"{self.agent_id}: {str(e)}")
            result = {
                "patient_summary": {
                    "primary_complaint": state["latest_visit"].get("presenting_complaint", ""),
                    "secondary_complaints": [],
                    "duration_of_symptoms": state["latest_visit"].get("duration_of_presenting_complaint", ""),
                    "relevant_past_medical_history": "",
                    "current_medication_history": "",
                    "relevant_abnormal_findings": [],
                    "physician_assessment": "",
                    "clinical_justification": ""
                },
                "primary_diagnosis": {
                    "diagnosis": state["latest_visit"].get("primary_diagnosis", ""),
                    "icd10_code": "",
                    "diagnosis_confidence": "Low",
                    "diagnosis_supported": False,
                    "diagnosis_support": "Automated diagnosis validation failed — manual review required."
                },
                "secondary_diagnoses": []
            }

        state["diagnosis_result"] = result
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A2 · INVESTIGATION AGENT — Investigation Validation with 3-Month Rule
# ============================================================

class InvestigationAgent(BaseAgent):
    agent_id = "A2_INVESTIGATIONS"

    async def run(self, state: ClaimValidationState) -> ClaimValidationState:
        logger.info(f"{self.agent_id} · InvestigationAgent — START")
        t0 = datetime.now().timestamp()

        investigations = state["latest_visit"].get("investigations", []) or []
        diagnosis = state["diagnosis_result"] or {}

        if not investigations:
            state["investigation_result"] = {"investigation_validation": []}
            state["agent_timings"][self.agent_id] = self._elapsed(t0)
            return state

        latest_visit_date = _parse_visit_date(state["latest_visit"].get("visit_date"))
        lab_history_context = build_lab_history_context(
            investigations, state.get("lab_report_history", []) or [], latest_visit_date
        )

        investigations_json = json.dumps(investigations, indent=2, default=str)
        diagnosis_json = json.dumps(diagnosis, indent=2, default=str)
        lab_history_json = json.dumps(lab_history_context, indent=2, default=str)

        system = (
            "You are an expert Medical Insurance Claim Validation Assistant, "
            "responsible for validating ordered investigations against the "
            "patient's presenting complaint and diagnosis.\n\n"
            "For each investigation, determine:\n"
            "1. Test Name (from the order)\n"
            "2. Claim Remarks - must be either 'Billable Test under Insurance' or 'Non Billable Test Insurance'\n"
            "3. System Remarks - explain medical necessity, physician documentation, diagnosis correlation, history\n"
            "4. Status - Approved / Rejected / Pending Documentation\n"
            "5. Reason for Rejection - populate only if rejected\n\n"
            "Apply the Three-Month Investigation Rule:\n"
            "1. Search equivalent historical laboratory reports\n"
            "2. Verify report date\n"
            "3. If performed within previous 90 days:\n"
            "   - Check whether all parameters were normal\n"
            "   - If normal and no new indication exists → Reject\n"
            "   - If abnormal or new indication exists → Approve\n\n"
            "IMPORTANT: Claim Remarks must ONLY be 'Billable Test under Insurance' or 'Non Billable Test Insurance'.\n"
            "Do not add any other text to claim_remarks.\n\n"
            f"{MEDICATION_EXCLUSION_RULE}\n\n"
            f"{HISTORICAL_VISIT_RULE}\n\n"
            "Always respond with valid JSON only."
        )

        prompt = f"""
══════════════════════════════════════════════════════════
VALIDATED DIAGNOSIS
══════════════════════════════════════════════════════════
{diagnosis_json}

══════════════════════════════════════════════════════════
INVESTIGATIONS ORDERED IN THE LATEST VISIT
══════════════════════════════════════════════════════════
{investigations_json}

══════════════════════════════════════════════════════════
LAB HISTORY CONTEXT (deterministically computed)
══════════════════════════════════════════════════════════
{lab_history_json}

══════════════════════════════════════════════════════════
TASK — INVESTIGATION VALIDATION
══════════════════════════════════════════════════════════
For EVERY investigation listed above, validate using the 3-month rule
and determine status.

IMPORTANT: claim_remarks must ONLY be either:
- "Billable Test under Insurance" (for Approved investigations)
- "Non Billable Test Insurance" (for Rejected or Pending Documentation)

Return ONLY valid JSON:
{{
  "investigation_validation": [
    {{
      "test_name": "",
      "claim_remarks": "Billable Test under Insurance / Non Billable Test Insurance",
      "system_remarks": "",
      "status": "Approved/Rejected/Pending Documentation",
      "reason_for_rejection": "",
      "billable_status": "Billable/Non-Billable/Requires Additional Documentation",
      "previous_similar_investigation_found": false,
      "previous_investigation_date": "",
      "previous_report_within_last_3_months": false,
      "previous_report_normal": null,
      "repeat_investigation_clinically_justified": true,
      "historical_lab_validation": {{
        "matching_report_found": false,
        "report_date": "",
        "within_last_3_months": false,
        "all_parameters_normal": null,
        "repeat_testing_required": true,
        "validation_summary": ""
      }},
      "insurance_rule_applied": ""
    }}
  ]
}}
"""
        try:
            result = await self._invoke(system, prompt)
            if not isinstance(result, dict) or "investigation_validation" not in result:
                raise ValueError("unparseable investigation output")
        except Exception as e:
            logger.error(f"{self.agent_id} · failed: {e}")
            state["errors"].append(f"{self.agent_id}: {str(e)}")
            result = {
                "investigation_validation": [
                    {
                        "test_name": _name_of(i, "investigation_name"),
                        "claim_remarks": "Non Billable Test Insurance",
                        "system_remarks": "Automated validation failed — manual review required.",
                        "status": "Pending Documentation",
                        "reason_for_rejection": "",
                        "billable_status": "Requires Additional Documentation",
                        "previous_similar_investigation_found": False,
                        "previous_investigation_date": "",
                        "previous_report_within_last_3_months": False,
                        "previous_report_normal": None,
                        "repeat_investigation_clinically_justified": False,
                        "historical_lab_validation": {
                            "matching_report_found": False,
                            "report_date": "",
                            "within_last_3_months": False,
                            "all_parameters_normal": None,
                            "repeat_testing_required": False,
                            "validation_summary": "Automated validation failed — manual review required."
                        },
                        "insurance_rule_applied": "Automated validation failed"
                    }
                    for i in investigations
                ]
            }

        # Force-merge deterministic lab history facts and fix claim_remarks
        empty_ctx = {
            "previous_similar_investigation_found": False,
            "previous_investigation_date": "",
            "previous_report_within_last_3_months": False,
            "previous_report_normal": None,
        }
        for entry in result.get("investigation_validation", []):
            if not isinstance(entry, dict):
                continue
            entry_name = entry.get("test_name", "")
            matched_ctx = None
            for inv_name, ctx in lab_history_context.items():
                if _names_match(entry_name, inv_name):
                    matched_ctx = ctx
                    break
            ctx = matched_ctx or empty_ctx

            entry["previous_similar_investigation_found"] = ctx["previous_similar_investigation_found"]
            entry["previous_investigation_date"] = ctx["previous_investigation_date"]
            entry["previous_report_within_last_3_months"] = ctx["previous_report_within_last_3_months"]
            entry["previous_report_normal"] = ctx["previous_report_normal"]
            entry.setdefault("repeat_investigation_clinically_justified", entry.get("status") == "Approved")

            repeat_justified = bool(entry.get("repeat_investigation_clinically_justified", False))
            rule_text = _determine_insurance_rule_applied(ctx, repeat_justified)
            entry["insurance_rule_applied"] = rule_text
            entry["historical_lab_validation"] = {
                "matching_report_found": ctx["previous_similar_investigation_found"],
                "report_date": ctx["previous_investigation_date"],
                "within_last_3_months": ctx["previous_report_within_last_3_months"],
                "all_parameters_normal": ctx["previous_report_normal"],
                "repeat_testing_required": repeat_justified,
                "validation_summary": rule_text,
            }

            # Fix claim_remarks to ONLY be "Billable Test under Insurance" or "Non Billable Test Insurance"
            status = entry.get("status", "Pending Documentation")
            billable_status = entry.get("billable_status", "Requires Additional Documentation")
            entry["claim_remarks"] = _determine_claim_remarks(status, billable_status)

        state["investigation_result"] = result
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        return state


# ============================================================
# A3 · PROCEDURE AGENT — Procedure Validation
# ============================================================

class ProcedureAgent(BaseAgent):
    agent_id = "A3_PROCEDURES"

    async def run(self, state: ClaimValidationState) -> ClaimValidationState:
        logger.info(f"{self.agent_id} · ProcedureAgent — START")
        t0 = datetime.now().timestamp()

        procedures = state["latest_visit"].get("procedures", []) or []
        diagnosis = state["diagnosis_result"] or {}

        if not procedures:
            state["procedure_result"] = {"procedure_validation": []}
            state["agent_timings"][self.agent_id] = self._elapsed(t0)
            return state

        procedures_json = json.dumps(procedures, indent=2, default=str)
        diagnosis_json = json.dumps(diagnosis, indent=2, default=str)

        system = (
            "You are an expert Medical Insurance Claim Validation Assistant, "
            "responsible for validating documented procedures.\n\n"
            "Validate every procedure using:\n"
            "1. Latest diagnosis\n"
            "2. Physician documentation\n"
            "3. Medical necessity\n"
            "4. Insurance reimbursement criteria\n\n"
            "For each procedure, provide:\n"
            "- Claim Remarks - must be either 'Billable Test under Insurance' or 'Non Billable Test Insurance'\n"
            "- System Remarks\n"
            "- Status (Approved/Rejected/Pending Documentation)\n"
            "- Reason for Rejection (if rejected)\n\n"
            "IMPORTANT: Claim Remarks must ONLY be 'Billable Test under Insurance' or 'Non Billable Test Insurance'.\n"
            "Do not add any other text to claim_remarks.\n\n"
            f"{MEDICATION_EXCLUSION_RULE}\n\n"
            f"{HISTORICAL_VISIT_RULE}\n\n"
            "Always respond with valid JSON only."
        )

        prompt = f"""
══════════════════════════════════════════════════════════
VALIDATED DIAGNOSIS
══════════════════════════════════════════════════════════
{diagnosis_json}

══════════════════════════════════════════════════════════
PROCEDURES DOCUMENTED IN THE LATEST VISIT
══════════════════════════════════════════════════════════
{procedures_json}

══════════════════════════════════════════════════════════
TASK — PROCEDURE VALIDATION
══════════════════════════════════════════════════════════
For EVERY procedure listed above, determine if it is clinically supported
and appropriate for insurance coverage.

IMPORTANT: claim_remarks must ONLY be either:
- "Billable Test under Insurance" (for Approved procedures)
- "Non Billable Test Insurance" (for Rejected or Pending Documentation)

Return ONLY valid JSON:
{{
  "procedure_validation": [
    {{
      "procedure_name": "",
      "claim_remarks": "Billable Test under Insurance / Non Billable Test Insurance",
      "system_remarks": "",
      "status": "Approved/Rejected/Pending Documentation",
      "reason_for_rejection": "",
      "supported": true,
      "correlated_with_diagnosis": true,
      "procedure_support": "",
      "missing_clinical_evidence": "",
      "insurance_recommendation": ""
    }}
  ]
}}
"""
        try:
            result = await self._invoke(system, prompt)
            if not isinstance(result, dict) or "procedure_validation" not in result:
                raise ValueError("unparseable procedure output")
        except Exception as e:
            logger.error(f"{self.agent_id} · failed: {e}")
            state["errors"].append(f"{self.agent_id}: {str(e)}")
            result = {
                "procedure_validation": [
                    {
                        "procedure_name": _name_of(p, "procedure_name"),
                        "claim_remarks": "Non Billable Test Insurance",
                        "system_remarks": "Automated validation failed — manual review required.",
                        "status": "Pending Documentation",
                        "reason_for_rejection": "",
                        "supported": False,
                        "correlated_with_diagnosis": False,
                        "procedure_support": "",
                        "missing_clinical_evidence": "Automated validation failed",
                        "insurance_recommendation": "Request Additional Documentation"
                    }
                    for p in procedures
                ]
            }

        # Fix claim_remarks for procedures
        for entry in result.get("procedure_validation", []):
            if not isinstance(entry, dict):
                continue
            status = entry.get("status", "Pending Documentation")
            # For procedures, if Approved, it's Billable, otherwise Non Billable
            if status == "Approved":
                entry["claim_remarks"] = "Billable Test under Insurance"
            else:
                entry["claim_remarks"] = "Non Billable Test Insurance"

        state["procedure_result"] = result
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        return state


# ============================================================
# A4 · INSURANCE DECISION AGENT — Decision + Return Notes
# ============================================================

class InsuranceDecisionAgent(BaseAgent):
    agent_id = "A4_DECISION"

    async def run(self, state: ClaimValidationState) -> ClaimValidationState:
        logger.info(f"{self.agent_id} · InsuranceDecisionAgent — START")
        t0 = datetime.now().timestamp()

        diagnosis = state["diagnosis_result"] or {}
        investigations = (state["investigation_result"] or {}).get("investigation_validation", [])
        procedures = (state["procedure_result"] or {}).get("procedure_validation", [])

        payload = {
            "diagnosis": diagnosis,
            "investigation_validation": investigations,
            "procedure_validation": procedures,
        }
        payload_json = json.dumps(payload, indent=2, default=str)

        system = (
            "You are an expert Medical Insurance Claim Validation Assistant, "
            "responsible for the final insurance decision and return notes.\n\n"
            "STEP 6 — Generate Insurance Decision based on:\n"
            "- Medical necessity summary\n"
            "- Claim status (Approved / Partially Approved / Requires Additional Information / Not Supported)\n"
            "- Approval percentage\n"
            "- Missing clinical documentation\n"
            "- Unsupported investigations\n"
            "- Unsupported procedures\n"
            "- Potential coding issues\n"
            "- Recommended corrections\n"
            "- Additional documents required\n\n"
            "STEP 7 — Return Notes From System:\n"
            "Generate this section only when investigations or procedures are "
            "rejected or require additional documentation.\n"
            "Purpose: Suggest improvements in physician documentation.\n"
            "Recommend additional clinical evidence that would support medical "
            "necessity if clinically appropriate.\n"
            "Never invent symptoms, diagnoses or findings.\n\n"
            f"{MEDICATION_EXCLUSION_RULE}\n\n"
            f"{HISTORICAL_VISIT_RULE}\n\n"
            "Always respond with valid JSON only."
        )

        prompt = f"""
══════════════════════════════════════════════════════════
ALREADY-VALIDATED DIAGNOSIS, INVESTIGATIONS, AND PROCEDURES
══════════════════════════════════════════════════════════
{payload_json}

══════════════════════════════════════════════════════════
TASK — FINAL INSURANCE DECISION + RETURN NOTES
══════════════════════════════════════════════════════════
Generate the final insurance decision and return notes.

Return ONLY valid JSON:
{{
  "medical_necessity_summary": "",
  "claim_status": "",
  "approval_percentage": "",
  "missing_clinical_documentation": [],
  "unsupported_investigations": [],
  "unsupported_procedures": [],
  "potential_coding_issues": [],
  "recommended_corrections": [],
  "additional_documents_required": [],
  "return_notes": [
    {{
      "issue": "",
      "suggestion": "",
      "recommended_evidence": ""
    }}
  ]
}}
"""
        try:
            result = await self._invoke(system, prompt)
            if not isinstance(result, dict) or "claim_status" not in result:
                raise ValueError("unparseable decision output")
        except Exception as e:
            logger.error(f"{self.agent_id} · failed: {e}")
            state["errors"].append(f"{self.agent_id}: {str(e)}")
            unsupported_inv = [
                i.get("test_name") for i in investigations
                if isinstance(i, dict) and i.get("status") in ["Rejected", "Pending Documentation"]
            ]
            unsupported_proc = [
                p.get("procedure_name") for p in procedures
                if isinstance(p, dict) and p.get("status") in ["Rejected", "Pending Documentation"]
            ]
            result = {
                "medical_necessity_summary": "Automated decision failed — manual review required.",
                "claim_status": "Requires Additional Information",
                "approval_percentage": "0%",
                "missing_clinical_documentation": ["Automated validation failed — see logs."],
                "unsupported_investigations": unsupported_inv,
                "unsupported_procedures": unsupported_proc,
                "potential_coding_issues": [
                    "Insufficient documentation for accurate ICD-10 assignment"
                ] if not diagnosis.get("primary_diagnosis", {}).get("diagnosis_supported") else [],
                "recommended_corrections": ["Retry automated validation or perform manual review."],
                "additional_documents_required": [],
                "return_notes": [
                    {
                        "issue": "Automated validation failed",
                        "suggestion": "Perform manual clinical review",
                        "recommended_evidence": "Review all clinical documentation"
                    }
                ]
            }

        state["decision_result"] = result
        state["return_notes"] = result.get("return_notes", [])
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        return state


# ============================================================
# WORKFLOW GRAPH
# ============================================================

async def _run_investigations_and_procedures(state: ClaimValidationState) -> ClaimValidationState:
    investigation_agent = InvestigationAgent(llm_claim_validation)
    procedure_agent = ProcedureAgent(llm_claim_validation)

    await asyncio.gather(
        investigation_agent.run(state),
        procedure_agent.run(state),
    )
    return state


def create_claim_validation_workflow() -> Any:
    workflow = StateGraph(ClaimValidationState)

    workflow.add_node("A1_DIAGNOSIS", DiagnosisAgent(llm_claim_validation).run)
    workflow.add_node("A2_A3_PARALLEL", _run_investigations_and_procedures)
    workflow.add_node("A4_DECISION", InsuranceDecisionAgent(llm_claim_validation).run)

    workflow.set_entry_point("A1_DIAGNOSIS")
    workflow.add_edge("A1_DIAGNOSIS", "A2_A3_PARALLEL")
    workflow.add_edge("A2_A3_PARALLEL", "A4_DECISION")
    workflow.add_edge("A4_DECISION", END)

    return workflow.compile()


claim_validation_workflow = create_claim_validation_workflow()


# ============================================================
# DETERMINISTIC FINAL ASSEMBLY — MATCHING REQUIRED FORMAT
# ============================================================

def _assemble_final_claim(state: ClaimValidationState) -> Dict[str, Any]:
    """
    Assemble the final claim in the exact required format:
    {
      "patient_summary": {},
      "primary_diagnosis": {},
      "secondary_diagnoses": [],
      "investigations": [...],
      "procedures": [...],
      "return_notes_from_system": [...]
    }
    """
    diagnosis = state.get("diagnosis_result") or {}
    investigations_raw = (state.get("investigation_result") or {}).get("investigation_validation", [])
    procedures_raw = (state.get("procedure_result") or {}).get("procedure_validation", [])
    decision = state.get("decision_result") or {}
    return_notes = state.get("return_notes", [])

    # Build investigations in the required format
    investigations = []
    for inv in investigations_raw:
        if not isinstance(inv, dict):
            continue
        investigations.append({
            "test_name": inv.get("test_name", ""),
            "claim_remarks": inv.get("claim_remarks", "Non Billable Test Insurance"),
            "system_remarks": inv.get("system_remarks", ""),
            "status": inv.get("status", "Pending Documentation"),
            "reason_for_rejection": inv.get("reason_for_rejection", "")
        })

    # Build procedures in the required format
    procedures = []
    for proc in procedures_raw:
        if not isinstance(proc, dict):
            continue
        procedures.append({
            "procedure_name": proc.get("procedure_name", ""),
            "claim_remarks": proc.get("claim_remarks", "Non Billable Test Insurance"),
            "system_remarks": proc.get("system_remarks", ""),
            "status": proc.get("status", "Pending Documentation"),
            "reason_for_rejection": proc.get("reason_for_rejection", "")
        })

    # Build return notes in the required format
    return_notes_formatted = []
    for note in return_notes:
        if isinstance(note, dict):
            # If it's already in the right format
            if "issue" in note and "suggestion" in note and "recommended_evidence" in note:
                return_notes_formatted.append({
                    "issue": note.get("issue", ""),
                    "suggestion": note.get("suggestion", ""),
                    "recommended_evidence": note.get("recommended_evidence", "")
                })
            else:
                # Try to extract from other formats
                return_notes_formatted.append({
                    "issue": note.get("issue", note.get("title", "Documentation issue identified")),
                    "suggestion": note.get("suggestion", note.get("description", "Review documentation")),
                    "recommended_evidence": note.get("recommended_evidence", note.get("evidence", "Additional clinical documentation required"))
                })
        elif isinstance(note, str):
            return_notes_formatted.append({
                "issue": "Documentation issue identified",
                "suggestion": note,
                "recommended_evidence": "Review clinical documentation"
            })

    # If no return notes but we have rejected items, generate default notes
    if not return_notes_formatted:
        rejected_investigations = [inv.get("test_name") for inv in investigations_raw 
                                   if isinstance(inv, dict) and inv.get("status") == "Rejected"]
        rejected_procedures = [proc.get("procedure_name") for proc in procedures_raw 
                               if isinstance(proc, dict) and proc.get("status") == "Rejected"]
        
        if rejected_investigations or rejected_procedures:
            return_notes_formatted.append({
                "issue": "Investigations and/or procedures require additional documentation",
                "suggestion": "Improve physician documentation to support medical necessity",
                "recommended_evidence": "Document new clinical findings, worsening symptoms, or treatment response"
            })

    return {
        "patient_summary": diagnosis.get("patient_summary", {}),
        "primary_diagnosis": diagnosis.get("primary_diagnosis", {}),
        "secondary_diagnoses": diagnosis.get("secondary_diagnoses", []),
        "investigations": investigations,
        "procedures": procedures,
        "return_notes_from_system": return_notes_formatted
    }


# ============================================================
# INITIAL STATE FACTORY
# ============================================================

def build_initial_state(
    patient_id: str,
    doctor_id: str,
    latest_visit: Dict[str, Any],
    previous_visits: List[Dict[str, Any]],
    lab_report_history: List[Dict[str, Any]],
) -> ClaimValidationState:
    return ClaimValidationState(
        patient_id=patient_id,
        doctor_id=doctor_id,
        latest_visit=latest_visit,
        previous_visits=previous_visits,
        lab_report_history=lab_report_history,
        diagnosis_result=None,
        investigation_result=None,
        procedure_result=None,
        decision_result=None,
        return_notes=[],
        errors=[],
        agent_timings={},
    )


# ============================================================
# API ENDPOINT
# ============================================================

@router.post("/internal/run-claim-validation")
async def run_claim_validation(request: ClaimValidationRequest):
    """
    Multi-agent insurance claim validation following the spec.
    Returns the claim in the required JSON format.
    """
    start_ms = datetime.now().timestamp() * 1000
    logger.info(f"Claim validation request | patient={request.patient_id} | doctor={request.doctor_id}")

    try:
        visits_sorted = await fetch_patient_visit_history(request.patient_id, request.doctor_id)

        if not visits_sorted:
            raise HTTPException(
                status_code=404,
                detail=f"No visit history found for patient {request.patient_id} under doctor {request.doctor_id}"
            )

        latest_visit, previous_visits = select_latest_and_context_visits(visits_sorted)
        lab_report_history = await fetch_lab_report_history(request.patient_id, request.doctor_id)

        initial_state = build_initial_state(
            request.patient_id,
            request.doctor_id,
            latest_visit,
            previous_visits,
            lab_report_history,
        )

        result_state = await claim_validation_workflow.ainvoke(initial_state)
        final_claim = _assemble_final_claim(result_state)

        elapsed = round(datetime.now().timestamp() * 1000 - start_ms)

        # Build the final response matching the required format
        response = {
            "patient_id": request.patient_id,
            "doctor_id": request.doctor_id,
            "generated_at": datetime.now().isoformat(),
            "processing_time_ms": elapsed,
            "visit_date_evaluated": latest_visit.get("visit_date"),
            "previous_visits_used": [v.get("visit_date") for v in previous_visits],
            "lab_reports_on_file": len(lab_report_history),
            "agent_timings": result_state.get("agent_timings", {}),
            "errors": result_state.get("errors", []),
            "claim": final_claim,
        }

        if request.include_intermediates:
            response["intermediate"] = {
                "latest_visit_raw": latest_visit,
                "previous_visits_raw": previous_visits,
                "lab_report_history_raw": lab_report_history,
                "diagnosis_result": result_state.get("diagnosis_result"),
                "investigation_result": result_state.get("investigation_result"),
                "procedure_result": result_state.get("procedure_result"),
                "decision_result": result_state.get("decision_result"),
                "return_notes": result_state.get("return_notes"),
            }

        try:
            await insurance_claim_validation_collection.insert_one(dict(response))
        except Exception as e:
            logger.error(f"MongoDB save failed: {e}")

        logger.info(f"Claim validation complete | {elapsed}ms | status={final_claim.get('claim_status', 'Unknown')}")
        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Claim validation pipeline failed | {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health/claim-validation")
async def claim_validation_health():
    return {
        "status": "ok",
        "version": "claim-validation-2.5.0",
        "agents": 4,
        "workflow_compiled": claim_validation_workflow is not None,
        "previous_visits_context_count": PREVIOUS_VISITS_CONTEXT_COUNT,
        "lab_history_window_months": LAB_HISTORY_WINDOW_MONTHS,
        "claim_max_tokens": CLAIM_MAX_TOKENS,
        "source_collections": {
            "visits": "patientVisitHistory",
            "lab_reports": LAB_REPORTS_COLLECTION_NAME,
        },
        "output_collection": "insurance_claim_validation",
        "evidence_grounding": "Medications are never used as evidence — context only",
        "claim_remarks_rule": "Only 'Billable Test under Insurance' or 'Non Billable Test Insurance'",
        "workflow": [
            "A1-Diagnosis: Patient Summary → Primary Diagnosis → Secondary Diagnoses (up to 5)",
            "A2-Investigations: Validation with 3-Month Historical Laboratory Rule",
            "A3-Procedures: Medical necessity validation",
            "A4-Decision: Insurance decision + Return Notes From System",
            "FinalAssembly: Required JSON format (deterministic Python)"
        ],
    }