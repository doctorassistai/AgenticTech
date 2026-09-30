"""
Insurance Claim Validation — Multi-Agent Pipeline (v4.0)
==========================================================

Output format:
- patient_summary
- primary_diagnosis
- secondary_diagnoses
- investigations (test_name, claim_remarks, system_remarks, status,
  reason_for_rejection, flags)
- procedures (procedure_name, claim_remarks, system_remarks, status,
  reason_for_rejection, flags)
- return_notes_from_system

claim_remarks only ever contain:
- "Billable Test under Insurance"
- "Non Billable Test Insurance"

v4.0 CHANGES
------------
Two new deterministic checks, both calling external DoctorAssist APIs:

1. BUNDLING CHECK — GET /check-bundle?investigation_name=...
   If the service comes back already bundled into another package
   (status != "bill payable" or count > 0), it's flagged
   "Payment Included in the Elements of Another Service (Bundling)".

2. TABLE OF BENEFITS (TOB) CHECK — GET /check-tob?policy_no=...&investigation_name=...
   The patient's policy number is resolved from `insurance_providers_collection`
   (the `primary_policy_number` field). If the service comes back excluded
   under that policy's TOB, it's flagged
   "Service Not Covered as per Table of Benefits (TOB)".

Both checks run for every investigation AND every procedure in the latest
visit. A new deterministic merge step ("A2_MERGE") now assembles a
canonical `flags` list per item, combining:
  - "CPT Activity Repeated Within Set Timeframe"          (periodicity)
  - "Test Not Related to Primary Diagnosis"                (no diagnosis link)
  - "Payment Included in the Elements of Another Service (Bundling)"
  - "Service Not Covered as per Table of Benefits (TOB)"

Four more canonical flags are defined (CANONICAL_FLAGS) for the headings
that don't yet have a wired data source in this codebase — they are NOT
set automatically anywhere, to avoid the LLM/pipeline fabricating a flag
with no grounding:
  - "Drug Not Medically Indicated as per Standard Practice"
  - "Prior Approval Required and Not Obtained"
  - "Diagnosis Not Covered as per Table of Benefits (TOB)"
  - "Medical Information Insufficient to Establish Medical Necessity"
Their insurer-facing explanation strings are already defined below
(REJECTION_EXPLANATION_DRUG_NOT_INDICATED, REJECTION_EXPLANATION_PRIOR_APPROVAL,
REJECTION_EXPLANATION_TOB_DIAGNOSIS, REJECTION_EXPLANATION_INSUFFICIENT_INFO)
and are already registered in the `_apply_flags_to_entry` explanations map,
so wiring one of these up later only requires: (1) a deterministic check
that produces a True/False signal, and (2) appending the matching
CANONICAL_FLAGS[...] heading to that item's flags list in A2_MERGE. No
further changes to system_remarks rendering are needed.

`flags` always contains ONLY the short headings, never the explanation
text. The explanation text still appears in `system_remarks` for context,
and `reason_for_rejection` mirrors the same headings joined together.

v4.1 CHANGES
------------
Wires in the patient's `/secondary-diagnosis-workflow` intake record
(stored in `wellkins_current_visit_data_collection`) as an additional,
explicitly-labeled source of context for the Diagnosis Agent's
secondary-diagnosis extraction. See `fetch_secondary_diagnosis_source`
and the "SECONDARY DIAGNOSIS SOURCE DATA" block in DiagnosisAgent.
"""

from __future__ import annotations

import asyncio
import calendar
import json
import os
import re
from datetime import datetime, date as date_cls
from typing import Any, Dict, List, Optional, Tuple, TypedDict

import httpx
from fastapi import APIRouter, HTTPException, Request
from loguru import logger
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorClient

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END

# ==========================================================
# ENVIRONMENT / CLIENTS
# ==========================================================

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

mongo_client = AsyncIOMotorClient(MONGO_URI)
mongo_db = mongo_client[MONGO_DB]

# Source of truth for visit history
patient_visit_history_collection = mongo_db["patientVisitHistory"]

# Source of truth for lab report history
LAB_REPORTS_COLLECTION_NAME = "integration_lab_reports"
integration_lab_reports_collection = mongo_db[LAB_REPORTS_COLLECTION_NAME]

# Source of truth for periodicity rules, e.g.:
# { "_id": "66fabc123456", "test_name": "CBC", "cpt_code": "85027", "interval": "1 Week" }
PERIODICITY_RULES_COLLECTION_NAME = "periodicity_rules"
periodicity_rules_collection = mongo_db[PERIODICITY_RULES_COLLECTION_NAME]

# This holds PatientInsurance documents — matches the model whose
# `primary_policy_number` field is used for the TOB check below.
INSURANCE_PROVIDERS_COLLECTION_NAME = "insurance_providers"
insurance_providers_collection = mongo_db[INSURANCE_PROVIDERS_COLLECTION_NAME]

# Hospital + patient master collections, used by the secondary-diagnosis
# intake workflow below.
HOSPITAL_USER_COLLECTION_NAME = "hospital_users"
hospital_user_collection = mongo_db[HOSPITAL_USER_COLLECTION_NAME]

DOCTOR_USER_COLLECTION_NAME = "doctor_users"
doctor_user_collection = mongo_db[DOCTOR_USER_COLLECTION_NAME]

PATIENT_USER_COLLECTION_NAME = "patient_users"
patient_user_collection = mongo_db[PATIENT_USER_COLLECTION_NAME]

# Latest secondary-diagnosis intake record per (patient_id, hospital_id),
# written by /secondary-diagnosis-workflow. Consumed as supplementary
# context by the Diagnosis Agent (A1) below.
WELLKINS_CURRENT_VISIT_DATA_COLLECTION_NAME = "wellkins_current_visit_data"
wellkins_current_visit_data_collection = mongo_db[WELLKINS_CURRENT_VISIT_DATA_COLLECTION_NAME]
# Where validated claims get persisted
insurance_claim_validation_collection = mongo_db["insurance_claim_validation"]

# Full, unfiltered historical claims data uploaded via /upload-bundle
# (every row of the "ProviderclaimDetailedReport" sheet, no filtering).
# Used below by find_historical_rejection() to look up whether a given
# investigation has a prior REJECTED claim on file for the same ICD code.
EXCEL_FULL_COLLECTION_NAME = "excel_full"
excel_full_collection = mongo_db[EXCEL_FULL_COLLECTION_NAME]

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

CLAIM_MAX_TOKENS = int(os.getenv("CLAIM_MAX_TOKENS", "3000"))
PREVIOUS_VISITS_CONTEXT_COUNT = int(os.getenv("PREVIOUS_VISITS_CONTEXT_COUNT", "3"))
LAB_HISTORY_WINDOW_MONTHS = int(os.getenv("LAB_HISTORY_WINDOW_MONTHS", "3"))

# Investigation validation is done ONE investigation per LLM call (see
# InvestigationAgent below) instead of one call for the whole visit.
# This is what prevents truncation/unparseable-JSON failures: a single
# investigation's response is small and never has to compete with 11
# others for the same token budget.
INVESTIGATION_MAX_RETRIES = int(os.getenv("INVESTIGATION_MAX_RETRIES", "4"))
INVESTIGATION_ITEM_MAX_TOKENS = int(os.getenv("INVESTIGATION_ITEM_MAX_TOKENS", "8000"))
INVESTIGATION_CONCURRENCY = int(os.getenv("INVESTIGATION_CONCURRENCY", "5"))
INVESTIGATION_RETRY_BACKOFF_SECONDS = float(os.getenv("INVESTIGATION_RETRY_BACKOFF_SECONDS", "0.6"))

# ----------------------------------------------------------
# EXTERNAL DOCTORASSIST APIs — BUNDLING + TABLE OF BENEFITS
# ----------------------------------------------------------
# check-bundle : https://doctorassist.ai/api/hms/users/data/system/check-bundle?investigation_name=
# check-tob    : https://doctorassist.ai/api/hms/users/data/system/check-tob?policy_no=...&investigation_name=...

DOCTORASSIST_API_BASE_URL = os.getenv(
    "DOCTORASSIST_API_BASE_URL",
    "https://doctorassist.ai/api/hms/users/data/system",
)
CHECK_BUNDLE_URL = f"{DOCTORASSIST_API_BASE_URL}/check-bundle"
CHECK_TOB_URL = f"{DOCTORASSIST_API_BASE_URL}/check-tob"
EXTERNAL_API_TIMEOUT_SECONDS = float(os.getenv("EXTERNAL_API_TIMEOUT_SECONDS", "10"))

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

SECONDARY_DIAGNOSIS_SOURCE_RULE = (
    "SECONDARY DIAGNOSIS SOURCE DATA RULES: a separate intake record may "
    "be supplied below, captured through the hospital's secondary-"
    "diagnosis workflow (fields such as conditions, symptoms, "
    "clinical_note, primary_diagnosis, icd_code, duration, "
    "investigations). Treat it as supplementary clinical evidence for "
    "the SAME patient and encounter — use its `conditions` list, "
    "alongside the latest visit itself, to help populate up to five "
    "secondary diagnoses. Never let it override or contradict the "
    "latest visit's own primary diagnosis, and never fabricate a "
    "secondary diagnosis that appears in neither source."
)

# ----------------------------------------------------------
# CANONICAL FLAGS — headings only, never explanations.
# These are the ONLY strings that may ever appear in an item's "flags" list.
# ----------------------------------------------------------

CANONICAL_FLAGS = {
    "periodicity": "CPT Activity Repeated Within Set Timeframe",
    "diagnosis_correlation": "Test Not Related to Primary Diagnosis",
    "bundling": "Payment Included in the Elements of Another Service (Bundling)",
    "drug_not_indicated": "Drug Not Medically Indicated as per Standard Practice",
    "tob_service": "Service Not Covered as per Table of Benefits (TOB)",
    "prior_approval": "Prior Approval Required and Not Obtained",
    "tob_diagnosis": "Diagnosis Not Covered as per Table of Benefits (TOB)",
    "insufficient_info": "Medical Information Insufficient to Establish Medical Necessity",
    "firstline": "Advanced Investigation Ordered Without Required First-Line Workup",
}

# The 7 canonical conditions that are evaluated for INVESTIGATIONS.
# "drug_not_indicated" is intentionally excluded — it's medication-only
# and investigations are never checked against it.
INVESTIGATION_FLAG_KEYS = [
    "periodicity",
    "diagnosis_correlation",
    "bundling",
    "tob_service",
    "prior_approval",
    "tob_diagnosis",
    "insufficient_info",
    "firstline",
]

# Kept as named aliases since earlier code / logs reference them directly.
REJECTION_REASON_PERIODICITY = CANONICAL_FLAGS["periodicity"]
REJECTION_REASON_NOT_RELATED_TO_DIAGNOSIS = CANONICAL_FLAGS["diagnosis_correlation"]
REJECTION_REASON_BUNDLING = CANONICAL_FLAGS["bundling"]
REJECTION_REASON_TOB_SERVICE = CANONICAL_FLAGS["tob_service"]

# Full insurer-facing explanations — used in system_remarks, NEVER in flags
# or reason_for_rejection (those stay as the bare heading only).

REJECTION_EXPLANATION_PERIODICITY = (
    "Your claim for this procedure has been declined because the same "
    "service was already processed and completed within the mandatory "
    "frequency window required by your policy. Insurance plans do not "
    "cover repetitive billing for this specific service within this set "
    "duration."
)

REJECTION_EXPLANATION_NOT_RELATED_TO_DIAGNOSIS = (
    "This diagnostic test has been declined because it does not have a "
    "verified clinical link to the primary diagnosis reported in your "
    "claim. Insurance coverage is restricted strictly to tests that "
    "directly correspond to the specific medical condition being "
    "evaluated or treated."
)

REJECTION_EXPLANATION_BUNDLING = (
    "This component of your claim has been declined because it is part "
    "of a fixed, comprehensive testing panel. When related diagnostic "
    "tests are performed together, they are consolidated under a "
    "single, main package payment, and the individual sub-tests cannot "
    "be processed or paid for separately."
)

REJECTION_EXPLANATION_TOB_SERVICE = (
    "This service has been declined because it is explicitly listed as "
    "a non-covered item under your current insurance plan's Table of "
    "Benefits. Every insurance tier has specific, set limits, and this "
    "particular procedure falls entirely outside your plan's scope of "
    "coverage."
)

REJECTION_EXPLANATION_FIRSTLINE = (
    "This advanced investigation has been declined because the standard "
    "first-line workup for your reported diagnosis is not documented as "
    "having been completed, either in this visit or in your recent visit "
    "history. Insurance coverage for advanced or specialist-level testing "
    "requires that the appropriate baseline investigation be performed "
    "first, unless it is already on file."
)

# The four flags below don't have a wired deterministic data source yet
# (see module docstring). Their explanation text is defined here so that
# wiring up a new check later is a two-line change (compute the boolean,
# append the CANONICAL_FLAGS[...] heading in A2_MERGE) rather than another
# trip through this file to add the copy.

REJECTION_EXPLANATION_DRUG_NOT_INDICATED = (
    "This medication has been declined because it falls outside the "
    "established clinical treatment guidelines for your reported "
    "diagnosis. Insurance coverage for prescriptions is restricted "
    "strictly to standard, globally accepted medical protocols matching "
    "the specific condition."
)

REJECTION_EXPLANATION_PRIOR_APPROVAL = (
    "This service has been declined because it required pre-authorization "
    "from the insurance provider before being performed, and no such "
    "approval was requested or secured. Your plan strictly mandates "
    "advance confirmation of medical necessity for this procedure to "
    "qualify for coverage."
)

REJECTION_EXPLANATION_TOB_DIAGNOSIS = (
    "This claim has been declined because the primary diagnosis "
    "submitted is listed as a permanent exclusion under your insurance "
    "policy. Your health plan is structured to cover specific medical "
    "conditions, and this particular diagnosis is not included in your "
    "benefit list."
)

REJECTION_EXPLANATION_INSUFFICIENT_INFO = (
    "This claim has been declined because the clinical data and medical "
    "history submitted do not meet the minimum requirements necessary to "
    "prove medical necessity under insurance guidelines. Without the "
    "definitive clinical benchmarks required by policy rules, coverage "
    "cannot be established."
)

llm_claim_validation = ChatGroq(
    model="openai/gpt-oss-120b",
    temperature=0.1,
    groq_api_key=GROQ_API_KEY,
    max_tokens=CLAIM_MAX_TOKENS,
)

# One investigation per call → small, predictable response size. This
# budget only ever has to hold ONE test's worth of remarks/reasoning.
llm_investigation_item = ChatGroq(
    model="openai/gpt-oss-120b",
    temperature=0.1,
    groq_api_key=GROQ_API_KEY,
    max_tokens=INVESTIGATION_ITEM_MAX_TOKENS,
)

# A2B Periodicity now does its own rule-matching, date comparison, and
# abnormality judgment inside the LLM call itself (no deterministic
# helper functions) — one investigation per call, same reasoning as
# above: small predictable responses, no truncation across N tests.
PERIODICITY_MAX_RETRIES = int(os.getenv("PERIODICITY_MAX_RETRIES", "4"))
PERIODICITY_ITEM_MAX_TOKENS = int(os.getenv("PERIODICITY_ITEM_MAX_TOKENS", "2000"))
PERIODICITY_CONCURRENCY = int(os.getenv("PERIODICITY_CONCURRENCY", "5"))
PERIODICITY_RETRY_BACKOFF_SECONDS = float(os.getenv("PERIODICITY_RETRY_BACKOFF_SECONDS", "0.6"))

llm_periodicity_item = ChatGroq(
    model="openai/gpt-oss-120b",
    temperature=0.1,
    groq_api_key=GROQ_API_KEY,
    max_tokens=PERIODICITY_ITEM_MAX_TOKENS,
)

# A2D Firstline Workup — same one-call-per-investigation shape as
# Periodicity above: the "is this firstline for the diagnosis?" lookup
# and the "was firstline already done in a recent prior visit?" lookup
# both happen inside a single LLM call.
FIRSTLINE_MAX_RETRIES = int(os.getenv("FIRSTLINE_MAX_RETRIES", "4"))
FIRSTLINE_ITEM_MAX_TOKENS = int(os.getenv("FIRSTLINE_ITEM_MAX_TOKENS", "2000"))
FIRSTLINE_CONCURRENCY = int(os.getenv("FIRSTLINE_CONCURRENCY", "5"))
FIRSTLINE_RETRY_BACKOFF_SECONDS = float(os.getenv("FIRSTLINE_RETRY_BACKOFF_SECONDS", "0.6"))

llm_firstline_item = ChatGroq(
    model="openai/gpt-oss-120b",
    temperature=0.1,
    groq_api_key=GROQ_API_KEY,
    max_tokens=FIRSTLINE_ITEM_MAX_TOKENS,
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


# Deterministic periodicity helpers (interval parsing, rule matching,
# last-ordered-date lookup, closest-report lookup) have been removed.
# PeriodicityAgent below now does that matching/date-comparison/
# abnormality-judgment reasoning itself, inside a single LLM call per
# investigation, using the raw periodicity rules list + visit history +
# lab report history as its evidence.


# ------------------------------------------------------------
# BUNDLING + TABLE OF BENEFITS HELPERS (new in v4.0)
# ------------------------------------------------------------

def _is_flagged(resp: Dict[str, Any], context_label: str = "") -> bool:
    """
    Both /check-bundle and /check-tob return e.g.:
      {"status": "bill payable", "count": 0, "text": "No rejected ... found for X."}
    "bill payable" + count 0 means clear. Anything else (a rejected
    bundle/TOB rule was actually found) means flagged.

    status == "unknown" means the external call FAILED (see check_bundle /
    check_tob except blocks) — a failed health check must never silently
    masquerade as a positive "this is bundled / excluded" finding, since
    that would reject a claim for a reason that was never evaluated.
    """
    raw_status = resp.get("status", "")
    status = str(raw_status).strip().lower()

    if status == "unknown":
        logger.error(
            f"_is_flagged [{context_label}] · external check FAILED "
            f"(status=unknown) — NOT flagging; item was never actually "
            f"validated against this rule. full_response={resp}"
        )
        return False

    raw_count = resp.get("count", 0) or 0
    try:
        count = int(raw_count)
    except (TypeError, ValueError):
        logger.warning(
            f"_is_flagged [{context_label}] · non-numeric count: {raw_count!r} — treating as 0"
        )
        count = 0

    flagged = status != "bill payable" or count > 0
    logger.info(
        f"_is_flagged [{context_label}] · status={raw_status!r} count={raw_count!r} · "
        f"FLAGGED={flagged} · full_response={resp}"
    )
    return flagged


async def check_bundle(item_name: str) -> Dict[str, Any]:
    params = {"investigation_name": item_name}
    logger.info(f"check_bundle · REQUEST GET {CHECK_BUNDLE_URL} params={params}")
    try:
        async with httpx.AsyncClient(timeout=EXTERNAL_API_TIMEOUT_SECONDS) as client:
            resp = await client.get(CHECK_BUNDLE_URL, params=params)
            logger.info(
                f"check_bundle · RESPONSE for '{item_name}' · "
                f"http_status={resp.status_code} · url={resp.url} · "
                f"raw_text={resp.text}"
            )
            resp.raise_for_status()
            parsed = resp.json()
            logger.info(f"check_bundle · PARSED JSON for '{item_name}': {parsed}")
            return parsed
    except Exception as e:
        logger.error(f"check_bundle · FAILED for '{item_name}': {e}")
        return {"status": "unknown", "count": 0, "text": f"Bundle check failed: {str(e)}"}


async def check_tob(item_name: str, policy_no: Optional[str]) -> Dict[str, Any]:
    if not policy_no:
        logger.warning(
            f"check_tob · SKIPPED for '{item_name}' — no policy_no on file "
            f"(fetch_patient_policy_number returned None/empty). TOB check "
            f"cannot run without a policy number."
        )
        return {
            "status": "unknown",
            "count": 0,
            "text": "No policy number on file for this patient — TOB check skipped.",
        }
    params = {"policy_no": policy_no, "investigation_name": item_name}
    logger.info(f"check_tob · REQUEST GET {CHECK_TOB_URL} params={params}")
    try:
        async with httpx.AsyncClient(timeout=EXTERNAL_API_TIMEOUT_SECONDS) as client:
            resp = await client.get(CHECK_TOB_URL, params=params)
            logger.info(
                f"check_tob · RESPONSE for '{item_name}' / policy '{policy_no}' · "
                f"http_status={resp.status_code} · url={resp.url} · "
                f"raw_text={resp.text}"
            )
            resp.raise_for_status()
            parsed = resp.json()
            logger.info(
                f"check_tob · PARSED JSON for '{item_name}' / policy "
                f"'{policy_no}': {parsed}"
            )
            return parsed
    except Exception as e:
        logger.error(f"check_tob · FAILED for '{item_name}' / policy '{policy_no}': {e}")
        return {"status": "unknown", "count": 0, "text": f"TOB check failed: {str(e)}"}


async def fetch_patient_policy_number(patient_id: str) -> Optional[str]:
    """
    Resolves the patient's primary insurance policy number from
    `insurance_providers_collection`, matching on either patient_id or
    sys_user_id, mirroring the lookup pattern used elsewhere in this app.
    """
    doc = await insurance_providers_collection.find_one(
        {"$or": [{"patient_id": patient_id}, {"sys_user_id": patient_id}]},
        {"_id": 0, "primary_policy_number": 1},
    )
    if not doc:
        return None
    return doc.get("primary_policy_number")


async def find_historical_investigation_match(
    icd_code: Optional[str], investigation_name: str
) -> Dict[str, Any]:
    """
    Deterministic, no-LLM lookup against `excel_full_collection` (the full,
    unfiltered historical claims data uploaded via /upload-bundle) for ANY
    historical claim matching both:
      1. the current visit's primary diagnosis ICD code
         (row's "PRINCIPAL ICD CODE"), and
      2. this investigation's name
         (row's "SERVICE DESCRIPTION", matched via _names_match).

    Unlike a rejection-only lookup, this returns every matching row
    regardless of STATUS, so the caller (DbHistoryAgent) can report both
    "matched, historically approved" and "matched, historically rejected"
    — not just rejections — which is what feeds the approved/rejected
    counts in the Insurance Database Search section.
    """
    empty_result = {
        "matched": False,
        "match_count": 0,
        "representative": None,
        "approved_count": 0,
        "rejected_count": 0,
    }

    if not icd_code or not investigation_name:
        return empty_result

    icd_code_clean = str(icd_code).strip()
    if not icd_code_clean:
        return empty_result

    try:
        cursor = excel_full_collection.find(
            {"PRINCIPAL ICD CODE": {"$regex": f"^{re.escape(icd_code_clean)}$", "$options": "i"}},
            {
                "_id": 0,
                "SERVICE DESCRIPTION": 1,
                "STATUS": 1,
                "DENIAL REASON": 1,
                "FINAL REMARKS": 1,
                "PRINCIPAL ICD CODE": 1,
                "CLAIM NUMBER": 1,
            },
        )
        candidates = await cursor.to_list(length=None)
    except Exception as e:
        logger.error(
            f"find_historical_investigation_match · excel_full_collection query "
            f"failed for icd_code='{icd_code_clean}': {e}"
        )
        return empty_result

    matches: List[Dict[str, Any]] = []
    for record in candidates:
        service_desc = record.get("SERVICE DESCRIPTION") or ""
        if _names_match(investigation_name, service_desc):
            matches.append(record)

    if not matches:
        logger.info(
            f"find_historical_investigation_match · no match for investigation "
            f"'{investigation_name}' / icd '{icd_code_clean}'"
        )
        return empty_result

    approved_count = 0
    rejected_count = 0
    representative: Optional[Dict[str, Any]] = None
    representative_is_rejected = False

    for record in matches:
        status = str(record.get("STATUS") or "").strip().lower()
        denial_reason = record.get("DENIAL REASON")
        has_denial_reason = bool(denial_reason and str(denial_reason).strip())
        is_rejected = status == "rejected" or has_denial_reason

        if is_rejected:
            rejected_count += 1
        elif status == "approved":
            approved_count += 1

        # Prefer a rejected row as the representative shown to the user
        # (more actionable) — otherwise keep the first match found.
        if representative is None or (is_rejected and not representative_is_rejected):
            reason_parts = []
            if has_denial_reason:
                reason_parts.append(str(denial_reason).strip())
            final_remarks = record.get("FINAL REMARKS")
            if final_remarks and str(final_remarks).strip():
                reason_parts.append(str(final_remarks).strip())

            representative = {
                "service_description": record.get("SERVICE DESCRIPTION"),
                "icd_code": record.get("PRINCIPAL ICD CODE"),
                "claim_number": record.get("CLAIM NUMBER"),
                "status": record.get("STATUS"),
                "reason_for_rejection": " | ".join(reason_parts) if reason_parts else "",
            }
            representative_is_rejected = is_rejected

    result = {
        "matched": True,
        "match_count": len(matches),
        "representative": representative,
        "approved_count": approved_count,
        "rejected_count": rejected_count,
    }
    logger.info(
        f"find_historical_investigation_match · MATCH for investigation "
        f"'{investigation_name}' / icd '{icd_code_clean}': {result}"
    )
    return result


async def fetch_secondary_diagnosis_source(
    patient_id: str, hospital_id: str
) -> Optional[Dict[str, Any]]:
    """
    Pulls the latest secondary-diagnosis intake record written by
    POST /secondary-diagnosis-workflow into
    `wellkins_current_visit_data_collection` for this
    (patient_id, hospital_id) pair.

    That endpoint upserts on {"patient_id": ..., "hospital_id": ...}, so
    there is at most one document per pair and this is a plain find_one —
    no sorting/latest-of-many logic needed.

    Returns None (not an exception) when nothing has been submitted yet,
    since this is supplementary context for the Diagnosis Agent, not a
    hard prerequisite for claim validation.
    """
    try:
        doc = await wellkins_current_visit_data_collection.find_one(
            {"patient_id": patient_id, "hospital_id": hospital_id},
            {"_id": 0},
        )
        if doc is None:
            logger.warning(
                f"fetch_secondary_diagnosis_source · NO DOCUMENT found in "
                f"wellkins_current_visit_data for patient_id='{patient_id}' "
                f"hospital_id='{hospital_id}' — check these are the resolved "
                f"sys_user_id / hospital_id, not the raw request IDs."
            )
        else:
            logger.info(
                f"fetch_secondary_diagnosis_source · FOUND doc for "
                f"patient_id='{patient_id}' hospital_id='{hospital_id}' · "
                f"primary_diagnosis={doc.get('primary_diagnosis')!r} · "
                f"conditions={doc.get('conditions')} · "
                f"investigations={doc.get('investigations')} · "
                f"updated_at={doc.get('updated_at')}"
            )
        return doc
    except Exception as e:
        logger.error(
            f"fetch_secondary_diagnosis_source failed for patient '{patient_id}' "
            f"/ hospital '{hospital_id}': {e}"
        )
        return None


async def run_bundle_and_tob_checks(
    item_names: List[str], policy_number: Optional[str]
) -> Dict[str, Dict[str, Any]]:
    """
    Runs /check-bundle and /check-tob concurrently for every item name
    (investigation or procedure), and returns a dict keyed by item name.
    """
    async def _check_one(name: str) -> Tuple[str, Dict[str, Any]]:
        bundle_resp, tob_resp = await asyncio.gather(
            check_bundle(name),
            check_tob(name, policy_number),
        )
        result = {
            "bundle_status": bundle_resp.get("status"),
            "bundle_count": bundle_resp.get("count"),
            "bundle_text": bundle_resp.get("text"),
            "bundle_flagged": _is_flagged(bundle_resp, context_label=f"bundle/{name}"),
            "tob_status": tob_resp.get("status"),
            "tob_count": tob_resp.get("count"),
            "tob_text": tob_resp.get("text"),
            "tob_flagged": _is_flagged(tob_resp, context_label=f"tob/{name}"),
        }
        logger.info(f"run_bundle_and_tob_checks · '{name}' · assembled result: {result}")
        return name, result

    if not item_names:
        return {}

    results = await asyncio.gather(*[_check_one(name) for name in item_names])
    return dict(results)


def _merge_secondary_investigations(
    latest_visit: Dict[str, Any],
    secondary_diagnosis_source: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Merges investigation names carried in the secondary-diagnosis intake
    record (wellkins_current_visit_data_collection, written by
    /secondary-diagnosis-workflow) into the latest visit's own
    `investigations` list, so they get validated by InvestigationAgent /
    PeriodicityAgent / BundleTobAgent exactly like visit-ordered
    investigations. Without this, anything submitted only through the
    secondary-diagnosis intake (e.g. "Ear Wash /Wax removal/Cleaning -
    one side") is captured in Mongo but never actually validated,
    flagged, or priced by the claim pipeline — it's shown to the
    Diagnosis Agent as inert context and then silently dropped.

    Returns a NEW latest_visit dict (does not mutate the input) with a
    de-duplicated `investigations` list — items already present in the
    visit (matched via _names_match) are not duplicated.
    """
    secondary_investigations = (secondary_diagnosis_source or {}).get("investigations") or []
    if not secondary_investigations:
        logger.info(
            "_merge_secondary_investigations · secondary_diagnosis_source has "
            "no investigations to merge (either no source doc, or its "
            "investigations list is empty) — latest_visit left unchanged."
        )
        return latest_visit

    existing_investigations = list(latest_visit.get("investigations", []) or [])
    existing_names = [_name_of(i, "investigation_name") for i in existing_investigations]

    merged = list(existing_investigations)
    added, skipped_dupes = [], []
    for raw_name in secondary_investigations:
        if not raw_name or not isinstance(raw_name, str):
            logger.warning(
                f"_merge_secondary_investigations · skipping non-string "
                f"investigation entry from secondary source: {raw_name!r}"
            )
            continue
        if any(_names_match(raw_name, existing_name) for existing_name in existing_names):
            skipped_dupes.append(raw_name)
            continue
        merged.append({
            "investigation_name": raw_name,
            "source": "secondary_diagnosis_intake",
        })
        existing_names.append(raw_name)
        added.append(raw_name)

    logger.info(
        f"_merge_secondary_investigations · visit had {len(existing_investigations)} "
        f"investigation(s) already · secondary source offered "
        f"{len(secondary_investigations)} · added {len(added)} new: {added} · "
        f"skipped {len(skipped_dupes)} as duplicates: {skipped_dupes} · "
        f"final count: {len(merged)}"
    )

    new_latest_visit = dict(latest_visit)
    new_latest_visit["investigations"] = merged
    return new_latest_visit


# ============================================================
# REQUEST MODEL
# ============================================================

class ClaimValidationRequest(BaseModel):
    patient_id: str
    doctor_id: str
    hospital_id: Optional[str] = None


# ============================================================
# SHARED STATE
# ============================================================

class ClaimValidationState(TypedDict):
    patient_id: str
    doctor_id: str
    latest_visit: Dict[str, Any]
    previous_visits: List[Dict[str, Any]]          # trimmed context for LLM prompts
    all_previous_visits: List[Dict[str, Any]]       # full history, used for periodicity search
    lab_report_history: List[Dict[str, Any]]
    periodicity_rules: List[Dict[str, Any]]
    policy_number: Optional[str]
    secondary_diagnosis_source: Optional[Dict[str, Any]]

    # A1 — Diagnosis
    diagnosis_result: Optional[Dict[str, Any]]

    # A2 — Investigations
    investigation_result: Optional[Dict[str, Any]]

    # A2B — Periodicity
    periodicity_result: Optional[Dict[str, Any]]

    # A2C — Bundling + Table of Benefits (new)
    bundle_tob_result: Optional[Dict[str, Any]]

    # A2D — Firstline Workup (new)
    firstline_result: Optional[Dict[str, Any]]

    # A2F — Historical Database Rejection Lookup (new)
    db_history_result: Optional[Dict[str, Any]]

    # A4 — Insurance Decision
    decision_result: Optional[Dict[str, Any]]

    # Return Notes
    return_notes: Optional[List[Dict[str, Any]]]

    errors: List[str]
    agent_timings: Dict[str, float]


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
# FETCH FUNCTIONS
# ============================================================





# NEW — insert before fetch_patient_visit_history
async def resolve_patient_sys_id(patient_id: str) -> str:
    """
    The claim-validation request carries the patient's hms_id (the
    human-facing patient_id). Everything downstream — patientVisitHistory,
    lab reports, insurance_providers, wellkins_current_visit_data — is
    keyed by sys_user_id instead, so this resolves hms_id -> sys_user_id
    via patient_users. Also accepts a sys_user_id directly, in case the
    caller already has it.
    """
    doc = await patient_user_collection.find_one(
        {"$or": [{"hms_id": patient_id}, {"sys_user_id": patient_id}]},
        {"_id": 0, "sys_user_id": 1},
    )
    if not doc or not doc.get("sys_user_id"):
        raise HTTPException(
            status_code=404,
            detail=f"Patient {patient_id} not found in patient_users",
        )
    return doc["sys_user_id"]


async def resolve_doctor_sys_id(doctor_id: str) -> str:
    """
    Resolves the caller-supplied doctor_id to the canonical sys_user_id
    via doctor_users. Also accepts a sys_user_id directly.
    """
    doc = await doctor_user_collection.find_one(
        {"$or": [{"doctor_id": doctor_id}, {"sys_user_id": doctor_id}]},
        {"_id": 0, "sys_user_id": 1},
    )
    if not doc or not doc.get("sys_user_id"):
        raise HTTPException(
            status_code=404,
            detail=f"Doctor {doctor_id} not found in doctor_users",
        )
    return doc["sys_user_id"]

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
) -> Tuple[Dict[str, Any], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Returns (latest_visit, context_visits, all_previous_visits).
    - context_visits: the latest 3 previous visits — used both inside LLM
      prompts and for the Periodicity Agent's deterministic checks.
      Validation only ever looks at the current visit plus these 3.
    - all_previous_visits: full remaining history, kept for reference but
      no longer used by any validation agent.
    """
    latest_visit = visits_sorted[0]
    all_previous_visits = visits_sorted[1:]
    context_visits = all_previous_visits[:PREVIOUS_VISITS_CONTEXT_COUNT]
    return latest_visit, context_visits, all_previous_visits


async def fetch_lab_report_history(patient_id: str, doctor_id: str) -> List[Dict[str, Any]]:
    doc = await integration_lab_reports_collection.find_one(
        {"patient_id": patient_id, "doctor_id": doctor_id},
        {"_id": 0, "reports": 1},
    )
    if not doc or not doc.get("reports"):
        return []
    return doc["reports"]


async def fetch_periodicity_rules() -> List[Dict[str, Any]]:
    """
    Periodicity rules are global (not patient-scoped), e.g.:
    { "test_name": "CBC", "cpt_code": "85027", "interval": "1 Week" }
    """
    cursor = periodicity_rules_collection.find({}, {"_id": 0})
    return await cursor.to_list(length=None)


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
        secondary_source = state.get("secondary_diagnosis_source")
        secondary_source_json = (
            json.dumps(secondary_source, indent=2, default=str)
            if secondary_source else "None available."
        )
        logger.info(
            f"{self.agent_id} · SECONDARY DIAGNOSIS SOURCE DATA block being "
            f"sent to the LLM:\n{secondary_source_json}"
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
            "3. Extract up to five Secondary Diagnoses that influence patient "
            "management, drawing on both the latest visit and, where "
            "present, the SECONDARY DIAGNOSIS SOURCE DATA supplied below\n\n"
            f"{MEDICATION_EXCLUSION_RULE}\n\n"
            f"{HISTORICAL_VISIT_RULE}\n\n"
            f"{SECONDARY_DIAGNOSIS_SOURCE_RULE}\n\n"
            "Always respond with valid JSON only."
        )

        prompt = f"""
══════════════════════════════════════════════════════════
LATEST VISIT (the ONLY source for the primary diagnosis)
══════════════════════════════════════════════════════════
{latest_json}

══════════════════════════════════════════════════════════
PREVIOUS VISITS (HISTORICAL CONTEXT ONLY)
══════════════════════════════════════════════════════════
{prior_json}

══════════════════════════════════════════════════════════
SECONDARY DIAGNOSIS SOURCE DATA (from the secondary-diagnosis intake
workflow — supplementary evidence for secondary_diagnoses only)
══════════════════════════════════════════════════════════
{secondary_source_json}

══════════════════════════════════════════════════════════
TASK
══════════════════════════════════════════════════════════
STEP 2 — Patient Complaint / Presenting Complaint:
Extract a concise clinical summary from the latest medical visit only.

STEP 3 — Primary Diagnosis:
Populate the primary diagnosis documented during the latest visit with ICD-10-CM code.

STEP 4 — Secondary Diagnoses:
Populate up to five documented secondary diagnoses that influence patient management.
Use the latest visit AND the SECONDARY DIAGNOSIS SOURCE DATA above (its
`conditions` field in particular) as grounding — do not invent a diagnosis
that appears in neither source. Each diagnosis should strengthen or
reflect the clinical complexity of the primary diagnosis.

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

_INVESTIGATION_ITEM_REQUIRED_KEYS = {
    "test_name", "claim_remarks", "system_remarks", "status",
    "reason_for_rejection", "billable_status",
    "correlates_with_primary_or_secondary_diagnosis", "correlation_reasoning",
    "repeat_investigation_clinically_justified",
}


def _validate_investigation_item(parsed: Any, expected_name: str) -> Optional[Dict[str, Any]]:
    """
    Accepts a parsed LLM response only if it is a complete, well-formed
    single-investigation result for the EXACT investigation that was
    asked about. Returns None on any problem (missing keys, wrong test,
    invalid enum value, empty remarks) so the caller retries instead of
    shipping a partial or mismatched record. Never raises.
    """
    if not isinstance(parsed, dict):
        return None
    if not _INVESTIGATION_ITEM_REQUIRED_KEYS.issubset(parsed.keys()):
        return None
    if not isinstance(parsed.get("test_name"), str) or not parsed["test_name"].strip():
        return None
    if not _names_match(parsed["test_name"], expected_name):
        return None
    if parsed.get("status") not in ("Approved", "Rejected", "Pending Documentation"):
        return None
    if parsed.get("claim_remarks") not in (
        "Billable Test under Insurance", "Non Billable Test Insurance"
    ):
        return None
    if not isinstance(parsed.get("system_remarks"), str) or not parsed["system_remarks"].strip():
        return None
    if not isinstance(parsed.get("correlates_with_primary_or_secondary_diagnosis"), bool):
        return None
    return parsed


class InvestigationAgent(BaseAgent):
    agent_id = "A2_INVESTIGATIONS"

    def __init__(self, llm):
        super().__init__(llm)

    async def _validate_one(
        self,
        inv: Any,
        diagnosis_json: str,
        lab_ctx_json: str,
        bundle_tob_ctx_json: str,
        semaphore: asyncio.Semaphore,
    ) -> Dict[str, Any]:
        inv_name = _name_of(inv, "investigation_name")
        inv_json = json.dumps(inv, indent=2, default=str)

        system = (
            "You are an expert Medical Insurance Claim Validation Assistant, "
            "validating ONE ordered investigation against the patient's "
            "diagnosis, lab history context, and a mandatory bundling / "
            "Table of Benefits check result.\n\n"
            "Determine:\n"
            "1. Claim Remarks - 'Billable Test under Insurance' or 'Non Billable Test Insurance', nothing else\n"
            "2. System Remarks - concise medical necessity reasoning (2-4 sentences)\n"
            "3. Status - Approved / Rejected / Pending Documentation\n"
            "4. Reason for Rejection - populate only if Rejected\n"
            "5. Whether this test correlates with the primary diagnosis OR any secondary diagnosis\n\n"
            "Apply the Three-Month Investigation Rule using the lab history context "
            "provided: if an equivalent report exists within the last 90 days and "
            "was normal with no new clinical indication documented, this repeat "
            "should be Rejected; if abnormal or a new indication exists, it can be "
            "Approved.\n\n"
            "MANDATORY BUNDLING / TABLE OF BENEFITS RULE — this overrides pure "
            "clinical judgment: the BUNDLING / TOB CHECK RESULT below comes from "
            "a deterministic external system, not a clinical opinion. If "
            "bundle_flagged is true, this test's payment is already included in "
            "another billed service and it CANNOT be separately approved — set "
            "status to 'Rejected' and billable_status to 'Non-Billable', and say "
            "why in system_remarks. If tob_flagged is true, this test is excluded "
            "under the patient's policy's Table of Benefits and CANNOT be "
            "approved regardless of clinical necessity — same requirement. If "
            "bundle_status or tob_status is 'unknown', the external check FAILED "
            "rather than returning a real result — do NOT treat that as a "
            "positive finding; evaluate this test on clinical grounds alone and "
            "note in system_remarks that the bundling/TOB check could not be "
            "completed.\n\n"
            "REASON_FOR_REJECTION FORMAT — this field is downstream-consumed "
            "and must stay predictable: if you reject a test purely because it "
            "does not correlate with the primary or any secondary diagnosis, "
            "set correlates_with_primary_or_secondary_diagnosis=false and leave "
            "reason_for_rejection EMPTY (a separate deterministic system adds "
            "the correct canonical rejection heading downstream from that "
            "boolean — do not write your own free-text diagnosis-relevance "
            "explanation into reason_for_rejection). Only populate "
            "reason_for_rejection with a short factual phrase when the "
            "rejection reason is something OTHER than diagnosis correlation, "
            "bundling, or TOB (all three of those are handled deterministically "
            "elsewhere and should never appear as free text here) — for "
            "example, a genuine missing-documentation issue specific to this "
            "test that isn't captured by any other check.\n\n"
            "Respond with a SINGLE flat JSON object for this one investigation only "
            "— no wrapping array, no other investigations, no markdown fences, no "
            "commentary before or after the JSON.\n\n"
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
INVESTIGATION TO VALIDATE
══════════════════════════════════════════════════════════
{inv_json}

══════════════════════════════════════════════════════════
LAB HISTORY CONTEXT FOR THIS INVESTIGATION (deterministically computed)
══════════════════════════════════════════════════════════
{lab_ctx_json}

══════════════════════════════════════════════════════════
BUNDLING / TABLE OF BENEFITS CHECK RESULT FOR THIS INVESTIGATION
(deterministic, authoritative — see MANDATORY rule above)
══════════════════════════════════════════════════════════
{bundle_tob_ctx_json}

Return ONLY this JSON object, fully filled in, for "{inv_name}":
{{
  "test_name": "{inv_name}",
  "claim_remarks": "Billable Test under Insurance / Non Billable Test Insurance",
  "system_remarks": "",
  "status": "Approved/Rejected/Pending Documentation",
  "reason_for_rejection": "",
  "billable_status": "Billable/Non-Billable/Requires Additional Documentation",
  "correlates_with_primary_or_secondary_diagnosis": true,
  "correlation_reasoning": "",
  "repeat_investigation_clinically_justified": true
}}
"""

        last_error = ""
        async with semaphore:
            for attempt in range(1, INVESTIGATION_MAX_RETRIES + 1):
                try:
                    response = await llm_investigation_item.ainvoke([
                        SystemMessage(content=system),
                        HumanMessage(content=prompt),
                    ])
                    parsed = parse_llm_json(response.content)
                    validated = _validate_investigation_item(parsed, inv_name)
                    if validated is not None:
                        if attempt > 1:
                            logger.info(f"{self.agent_id} · '{inv_name}' · validated on attempt {attempt}")
                        return validated
                    last_error = f"attempt {attempt}: malformed/incomplete/mismatched JSON: {parsed}"
                except Exception as e:
                    last_error = f"attempt {attempt}: exception: {e}"

                logger.warning(f"{self.agent_id} · '{inv_name}' · {last_error}")
                if attempt < INVESTIGATION_MAX_RETRIES:
                    await asyncio.sleep(INVESTIGATION_RETRY_BACKOFF_SECONDS * attempt)

        logger.error(
            f"{self.agent_id} · '{inv_name}' · exhausted {INVESTIGATION_MAX_RETRIES} "
            f"attempts — {last_error}"
        )
        return {
            "test_name": inv_name,
            "claim_remarks": "Non Billable Test Insurance",
            "system_remarks": (
                f"Automated validation could not be completed for this test after "
                f"{INVESTIGATION_MAX_RETRIES} attempts due to a system/LLM error. "
                "This is a system failure, not a clinical or coverage determination "
                "— manual review required."
            ),
            "status": "Pending Documentation",
            "reason_for_rejection": "",
            "billable_status": "Requires Additional Documentation",
            "correlates_with_primary_or_secondary_diagnosis": True,
            "correlation_reasoning": "",
            "repeat_investigation_clinically_justified": False,
            "_validation_error": last_error,
        }

    async def run(self, state: ClaimValidationState) -> ClaimValidationState:
        logger.info(f"{self.agent_id} · InvestigationAgent — START")
        t0 = datetime.now().timestamp()

        investigations = state["latest_visit"].get("investigations", []) or []
        diagnosis = state["diagnosis_result"] or {}

        logger.info(
            f"{self.agent_id} · about to validate {len(investigations)} "
            f"investigation(s): "
            f"{[_name_of(i, 'investigation_name') for i in investigations]}"
        )

        if not investigations:
            state["investigation_result"] = {"investigation_validation": []}
            state["agent_timings"][self.agent_id] = self._elapsed(t0)
            return state

        latest_visit_date = _parse_visit_date(state["latest_visit"].get("visit_date"))
        lab_history_context = build_lab_history_context(
            investigations, state.get("lab_report_history", []) or [], latest_visit_date
        )
        diagnosis_json = json.dumps(diagnosis, indent=2, default=str)

        # Populated by A2C_BUNDLE_TOB, which now runs BEFORE this node in
        # the graph (see create_claim_validation_workflow). If this is
        # empty here, check that agent's own logs.
        bundle_tob_items = (state.get("bundle_tob_result") or {}).get("items", {})
        logger.info(
            f"{self.agent_id} · bundle_tob_result available for "
            f"{len(bundle_tob_items)} item(s): {list(bundle_tob_items.keys())}"
        )

        empty_ctx = {
            "previous_similar_investigation_found": False,
            "previous_investigation_date": "",
            "previous_report_within_last_3_months": False,
            "previous_report_normal": None,
            "abnormal_parameters": [],
        }
        empty_bt_ctx = {
            "bundle_status": "unknown", "bundle_count": 0, "bundle_text": "Not checked.",
            "bundle_flagged": False,
            "tob_status": "unknown", "tob_count": 0, "tob_text": "Not checked.",
            "tob_flagged": False,
        }
        semaphore = asyncio.Semaphore(INVESTIGATION_CONCURRENCY)

        async def _validate_with_ctx(inv: Any) -> Dict[str, Any]:
            inv_name = _name_of(inv, "investigation_name")
            ctx = lab_history_context.get(inv_name, empty_ctx)
            ctx_json = json.dumps(ctx, indent=2, default=str)

            bt_ctx = empty_bt_ctx
            for name, bt in bundle_tob_items.items():
                if _names_match(inv_name, name):
                    bt_ctx = bt
                    break
            bt_ctx_json = json.dumps(bt_ctx, indent=2, default=str)

            return await self._validate_one(inv, diagnosis_json, ctx_json, bt_ctx_json, semaphore)

        entries = list(await asyncio.gather(*[_validate_with_ctx(inv) for inv in investigations]))

        failed = [e for e in entries if e.get("_validation_error")]
        if failed:
            failed_names = ", ".join(e.get("test_name", "?") for e in failed)
            state["errors"].append(
                f"{self.agent_id}: {len(failed)}/{len(entries)} investigation(s) "
                f"failed after {INVESTIGATION_MAX_RETRIES} retries: {failed_names}"
            )

        # Force-merge deterministic lab history facts (never trusted from
        # the LLM) and normalize claim_remarks. Same as before, just now
        # operating on independently-validated entries.
        for entry in entries:
            entry.pop("_validation_error", None)
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

            status = entry.get("status", "Pending Documentation")
            billable_status = entry.get("billable_status", "Requires Additional Documentation")
            entry["claim_remarks"] = _determine_claim_remarks(status, billable_status)

        state["investigation_result"] = {"investigation_validation": entries}
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(
            f"{self.agent_id} · DONE ({state['agent_timings'][self.agent_id]}ms) · "
            f"{len(entries) - len(failed)}/{len(entries)} validated cleanly, "
            f"{len(failed)} needed manual review"
        )
        return state


# ============================================================
# A2B · PERIODICITY AGENT
# Mostly deterministic — checks whether each investigation was repeated
# inside its required periodicity window, using periodicity_rules_collection
# (uploaded via /upload-periodicity-rules) + the latest 3 previous visits +
# lab report history. The ONLY judgment call routed to an LLM is the single
# genuinely ambiguous case: a repeat ordered within the interval whose prior
# result on file was abnormal — whether that abnormality is clinically
# significant enough, per the CURRENT visit's own documentation, to justify
# repeating now. If no periodicity rule exists at all for a test, that is
# reported explicitly (never silently treated as "no issue") and flagged as
# insufficient information rather than a periodicity violation.
# ============================================================

_PERIODICITY_ITEM_REQUIRED_KEYS = {
    "test_name", "periodicity_rule_found", "interval", "cpt_code",
    "last_ordered_date", "within_interval", "last_result_normal",
    "periodicity_status", "remarks",
}

_VALID_PERIODICITY_STATUSES = {
    "No Periodicity Data Available",
    "Valid",
    "Invalid - Repeated Within Timeframe",
    "Valid - Abnormal Previous Result Justifies Repeat",
}


def _validate_periodicity_item(parsed: Any, expected_name: str) -> Optional[Dict[str, Any]]:
    """
    Mirrors _validate_investigation_item's role for InvestigationAgent:
    accepts a parsed LLM response only if it's complete, well-formed, and
    for the exact test that was asked about. Returns None on any problem
    so the caller retries instead of shipping a partial/mismatched record.
    """
    if not isinstance(parsed, dict):
        return None
    if not _PERIODICITY_ITEM_REQUIRED_KEYS.issubset(parsed.keys()):
        return None
    if not isinstance(parsed.get("test_name"), str) or not parsed["test_name"].strip():
        return None
    if not _names_match(parsed["test_name"], expected_name):
        return None
    if parsed.get("periodicity_status") not in _VALID_PERIODICITY_STATUSES:
        return None
    if not isinstance(parsed.get("periodicity_rule_found"), bool):
        return None
    if not isinstance(parsed.get("within_interval"), bool):
        return None
    if not isinstance(parsed.get("remarks"), str) or not parsed["remarks"].strip():
        return None
    return parsed


class PeriodicityAgent(BaseAgent):
    """
    A2B · PERIODICITY AGENT — single LLM call per investigation, no
    deterministic date/interval/matching helpers. The model is handed the
    raw periodicity rules list, the latest 3 visits, and the lab report
    history, and does the rule-matching, interval-vs-elapsed-time
    comparison, abnormality lookup, AND the "was the abnormality clinically
    significant enough to justify an early repeat" judgment call — all in
    one place, with its own reasoning.
    """
    agent_id = "A2B_PERIODICITY"

    async def _validate_one(
        self,
        inv: Any,
        periodicity_rules_json: str,
        previous_visits_json: str,
        lab_report_history_json: str,
        latest_visit_json: str,
        diagnosis_json: str,
        semaphore: asyncio.Semaphore,
    ) -> Dict[str, Any]:
        inv_name = _name_of(inv, "investigation_name")

        system = (
            "You are an expert Medical Insurance Claim Validation Assistant "
            "responsible for the FULL periodicity check for ONE investigation "
            "— rule lookup, elapsed-time comparison, prior-result lookup, and "
            "clinical judgment. There is no separate deterministic system "
            "doing any of this for you; you must do all of it yourself, "
            "carefully, from the raw data provided.\n\n"
            "Do the following, in order:\n"
            "1. RULE LOOKUP: search the PERIODICITY RULES list for an entry "
            "whose test_name refers to the same test as the investigation "
            "under review (match sensibly — ignore case, punctuation, "
            "abbreviations in parentheses, minor wording differences — but "
            "do not match two clearly different tests). If no entry matches, "
            "periodicity_rule_found=false and periodicity_status must be "
            "'No Periodicity Data Available'; explain in remarks that no "
            "periodicity rule exists for this test in the database.\n"
            "2. ELAPSED TIME: if a rule was found, look through the PREVIOUS "
            "VISITS (already limited to the latest 3) for the most recent "
            "visit, strictly before the current visit's date, in which this "
            "same test was also ordered. That is the last_ordered_date. "
            "Compare the time elapsed between last_ordered_date and the "
            "current visit's date against the rule's interval (e.g. '1 "
            "Week', '3 Months', '1 Year'). Be precise about unit conversion "
            "— do not approximate weeks as months or vice versa.\n"
            "   - If no prior occurrence exists, or the elapsed time is >= "
            "the interval: within_interval=false, periodicity_status='Valid'.\n"
            "3. PRIOR RESULT: if within_interval is true, search the LAB "
            "REPORT HISTORY for the report matching this test closest to "
            "(on or before) last_ordered_date. Determine whether any of its "
            "parameters fell outside their stated low_range/high_range. If "
            "no matching report exists, last_result_normal=null. Otherwise "
            "true (all parameters in range) or false (at least one outside "
            "range) — list the abnormal ones in abnormal_parameters.\n"
            "4. DECISION when within_interval is true:\n"
            "   - last_result_normal is true or null (normal, or nothing on "
            "file): periodicity_status='Invalid - Repeated Within Timeframe' "
            "— a repeat this soon is not billable without a documented new "
            "indication, and none exists here by definition.\n"
            "   - last_result_normal is false (abnormal): this is a genuine "
            "judgment call, not automatic. Look at the CURRENT VISIT AND "
            "DIAGNOSIS documentation — presenting complaint, doctor notes, "
            "physician assessment. Only if the CURRENT visit documents an "
            "ongoing concern, worsening, or monitoring need tied to that "
            "abnormality should you set "
            "periodicity_status='Valid - Abnormal Previous Result Justifies "
            "Repeat'. If the current visit is silent on it, the prior "
            "abnormality alone is NOT sufficient — set "
            "periodicity_status='Invalid - Repeated Within Timeframe'.\n"
            "5. remarks: 1-3 sentences citing the concrete rule/interval/"
            "dates you used and why you reached this status — this is what "
            "a human reviewer or the insurer will read, so be specific and "
            "factual, never vague.\n\n"
            "Respond with a SINGLE flat JSON object for this one "
            "investigation only — no markdown fences, no commentary.\n\n"
            f"{MEDICATION_EXCLUSION_RULE}\n\n{HISTORICAL_VISIT_RULE}\n\n"
            "Always respond with valid JSON only."
        )

        prompt = f"""
══════════════════════════════════════════════════════════
INVESTIGATION UNDER REVIEW
══════════════════════════════════════════════════════════
{inv_name}

══════════════════════════════════════════════════════════
PERIODICITY RULES (raw list from periodicity_rules_collection)
══════════════════════════════════════════════════════════
{periodicity_rules_json}

══════════════════════════════════════════════════════════
PREVIOUS VISITS (latest 3, for finding the last time this test was ordered)
══════════════════════════════════════════════════════════
{previous_visits_json}

══════════════════════════════════════════════════════════
LAB REPORT HISTORY (for checking whether the prior result was abnormal)
══════════════════════════════════════════════════════════
{lab_report_history_json}

══════════════════════════════════════════════════════════
CURRENT VISIT (for the clinical-justification judgment call only)
══════════════════════════════════════════════════════════
{latest_visit_json}

══════════════════════════════════════════════════════════
VALIDATED DIAGNOSIS
══════════════════════════════════════════════════════════
{diagnosis_json}

Return ONLY this JSON object, fully filled in, for "{inv_name}":
{{
  "test_name": "{inv_name}",
  "periodicity_rule_found": true,
  "interval": "",
  "cpt_code": "",
  "last_ordered_date": "",
  "within_interval": true,
  "last_result_normal": true,
  "abnormal_parameters": [],
  "periodicity_status": "No Periodicity Data Available / Valid / Invalid - Repeated Within Timeframe / Valid - Abnormal Previous Result Justifies Repeat",
  "remarks": ""
}}
"""

        last_error = ""
        async with semaphore:
            for attempt in range(1, PERIODICITY_MAX_RETRIES + 1):
                try:
                    response = await llm_periodicity_item.ainvoke([
                        SystemMessage(content=system),
                        HumanMessage(content=prompt),
                    ])
                    parsed = parse_llm_json(response.content)
                    validated = _validate_periodicity_item(parsed, inv_name)
                    if validated is not None:
                        if attempt > 1:
                            logger.info(f"{self.agent_id} · '{inv_name}' · validated on attempt {attempt}")
                        return validated
                    last_error = f"attempt {attempt}: malformed/incomplete/mismatched JSON: {parsed}"
                except Exception as e:
                    last_error = f"attempt {attempt}: exception: {e}"

                logger.warning(f"{self.agent_id} · '{inv_name}' · {last_error}")
                if attempt < PERIODICITY_MAX_RETRIES:
                    await asyncio.sleep(PERIODICITY_RETRY_BACKOFF_SECONDS * attempt)

        logger.error(
            f"{self.agent_id} · '{inv_name}' · exhausted {PERIODICITY_MAX_RETRIES} "
            f"attempts — {last_error}"
        )
        return {
            "test_name": inv_name,
            "periodicity_rule_found": False,
            "interval": None,
            "cpt_code": None,
            "last_ordered_date": None,
            "within_interval": False,
            "last_result_normal": None,
            "abnormal_parameters": [],
            "periodicity_status": "No Periodicity Data Available",
            "remarks": (
                f"Automated periodicity validation could not be completed for "
                f"this test after {PERIODICITY_MAX_RETRIES} attempts due to a "
                "system/LLM error — treated as insufficient information; "
                "manual review required."
            ),
        }

    async def run(self, state: ClaimValidationState) -> ClaimValidationState:
        logger.info(f"{self.agent_id} · PeriodicityAgent — START")
        t0 = datetime.now().timestamp()

        investigations = state["latest_visit"].get("investigations", []) or []

        if not investigations:
            state["periodicity_result"] = {"periodicity_validation": []}
            state["agent_timings"][self.agent_id] = self._elapsed(t0)
            return state

        try:
            periodicity_rules_json = json.dumps(state.get("periodicity_rules", []) or [], indent=2, default=str)
            previous_visits_json = json.dumps(state.get("previous_visits", []) or [], indent=2, default=str)
            lab_report_history_json = json.dumps(state.get("lab_report_history", []) or [], indent=2, default=str)
            latest_visit_json = json.dumps(state["latest_visit"], indent=2, default=str)
            diagnosis_json = json.dumps(state.get("diagnosis_result") or {}, indent=2, default=str)

            semaphore = asyncio.Semaphore(PERIODICITY_CONCURRENCY)

            validation = list(await asyncio.gather(*[
                self._validate_one(
                    inv, periodicity_rules_json, previous_visits_json,
                    lab_report_history_json, latest_visit_json, diagnosis_json,
                    semaphore,
                )
                for inv in investigations
            ]))

            state["periodicity_result"] = {"periodicity_validation": validation}

        except Exception as e:
            logger.error(f"{self.agent_id} · failed: {e}")
            state["errors"].append(f"{self.agent_id}: {str(e)}")
            state["periodicity_result"] = {"periodicity_validation": []}

        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A2D · FIRSTLINE WORKUP AGENT
# Single LLM call per investigation. For the given primary diagnosis:
#   - If the investigation IS a standard firstline test → no problem,
#     billable, nothing further checked.
#   - If it is NOT firstline (an advanced/specialist/second-line test) →
#     search the previous 3-4 visits (already trimmed into
#     `previous_visits`) for evidence that the firstline workup for this
#     diagnosis was already completed. If found → billable (advanced test
#     is justified). If not found anywhere in that recent history → this
#     entry gets the "Advanced Investigation Ordered Without Required
#     First-Line Workup" flag in A2_MERGE, same as periodicity/bundling/
#     TOB do today.
# ============================================================

_FIRSTLINE_ITEM_REQUIRED_KEYS = {
    "test_name", "is_firstline_for_diagnosis", "firstline_equivalent_tests",
    "firstline_previously_completed", "firstline_completion_visit_date",
    "advanced_test_justified", "remarks",
}


def _validate_firstline_item(parsed: Any, expected_name: str) -> Optional[Dict[str, Any]]:
    """
    Mirrors _validate_periodicity_item's role: accepts a parsed LLM
    response only if it's complete, well-formed, and for the exact test
    that was asked about. Returns None on any problem so the caller
    retries instead of shipping a partial/mismatched record.
    """
    if not isinstance(parsed, dict):
        return None
    if not _FIRSTLINE_ITEM_REQUIRED_KEYS.issubset(parsed.keys()):
        return None
    if not isinstance(parsed.get("test_name"), str) or not parsed["test_name"].strip():
        return None
    if not _names_match(parsed["test_name"], expected_name):
        return None
    if not isinstance(parsed.get("is_firstline_for_diagnosis"), bool):
        return None
    if not isinstance(parsed.get("firstline_previously_completed"), bool):
        return None
    if not isinstance(parsed.get("advanced_test_justified"), bool):
        return None
    if not isinstance(parsed.get("remarks"), str) or not parsed["remarks"].strip():
        return None
    return parsed


class FirstlineAgent(BaseAgent):
    """
    A2D · FIRSTLINE WORKUP AGENT — one LLM call per investigation, no
    separate deterministic pre-processing and no hardcoded test allowlist.
    Every determination is made strictly against the specific primary
    diagnosis on THIS claim, via clinical-guideline reasoning — the same
    test can be firstline for one diagnosis and advanced for another, so
    a static list would be wrong by construction.
    """
    agent_id = "A2D_FIRSTLINE"

    async def _validate_one(
        self,
        inv: Any,
        diagnosis_json: str,
        latest_visit_json: str,
        secondary_source_json: str,
        previous_visits_json: str,
        semaphore: asyncio.Semaphore,
    ) -> Dict[str, Any]:
        inv_name = _name_of(inv, "investigation_name")

        system = (
            "You are an expert Medical Insurance Claim Validation Assistant "
            "responsible for the First-Line Workup check for ONE "
            "investigation. Your determination must be made STRICTLY "
            "relative to the SPECIFIC PRIMARY DIAGNOSIS supplied below — "
            "never in the abstract, and never from a generic memorized list "
            "of 'common' first-line tests. There is no predefined list of "
            "always-firstline or always-advanced tests: the exact same test "
            "can be first-line for one diagnosis and an advanced/unrelated "
            "test for a different diagnosis. Anchor every judgment to what "
            "standard clinical guidelines say is the appropriate INITIAL "
            "workup specifically for the primary diagnosis given on THIS "
            "claim.\n\n"
            "SCOPE — READ FIRST: this check exists ONLY to catch advanced, "
            "specialist-level, or invasive tests/procedures ordered before "
            "their standard baseline workup — FOR THIS DIAGNOSIS — was "
            "done. It is NOT a general relevance check, and it is NOT "
            "limited to physical/clinical exams — routine baseline LAB "
            "TESTS count as first-line just as much as a physical exam "
            "does, PROVIDED they are actually part of the standard initial "
            "workup for the specific primary diagnosis at hand.\n\n"
            "Do the following, in order:\n"
            "0. RELEVANCE GATE (do this first): decide whether the "
            "investigation under review has ANY plausible clinical role in "
            "the workup of the primary diagnosis given — even a minor, "
            "supportive, or comorbidity-monitoring role. If it has NO "
            "plausible connection at all to the primary diagnosis (e.g. a "
            "thyroid, renal, vitamin, or unrelated organ-system test "
            "ordered for a diagnosis with no clinical link to that organ "
            "system) — this is a relevance problem, not a first-line-"
            "sequencing problem, and it is handled by a separate diagnosis-"
            "correlation check elsewhere in the pipeline. In that case, "
            "SKIP first-line evaluation entirely: set "
            "is_firstline_for_diagnosis=true, firstline_equivalent_tests=[], "
            "firstline_previously_completed=false, "
            "firstline_completion_visit_date=\"\", "
            "advanced_test_justified=true, and explain in remarks that "
            "this test has no clinical link to the primary diagnosis so "
            "first-line sequencing does not apply — do not flag it here. "
            "Only continue to steps 1-4 below if the test IS plausibly "
            "connected to the primary diagnosis.\n"
            "1. NAME THE ACTUAL FIRST-LINE WORKUP FOR THIS DIAGNOSIS FIRST: "
            "before judging the test under review, first work out — from "
            "standard, widely-accepted clinical practice guidelines — what "
            "the real initial/baseline workup for THIS SPECIFIC primary "
            "diagnosis actually is (history and exam findings relevant to "
            "it, and any baseline labs/tests that are standard initial "
            "workup for it specifically). Record these in "
            "firstline_equivalent_tests. Do this step independently of "
            "which test you were asked to review — do not let the identity "
            "of the test under review bias what you name as first-line.\n"
            "1B. DOCUMENTED WORKUP PRECEDENT — THIS OVERRIDES GENERIC "
            "GUIDELINES WHEN THE TWO CONFLICT: your step 1 list is a "
            "starting point built from general guidelines, not the final "
            "word. Before moving to step 2, check the CURRENT VISIT'S own "
            "doctor notes / recent abnormal values, the SECONDARY "
            "DIAGNOSIS INTAKE NOTE below (a separately-submitted intake "
            "record that may state directly, in its own words, whether a "
            "prior baseline/first-line workup specific to a given test WAS "
            "or WAS NOT done before ordering it), AND the PREVIOUS VISITS "
            "below for direct documentary evidence of how THIS treating "
            "clinician actually sequenced the workup for THIS diagnosis — "
            "e.g. a note that a test was ordered 'as baseline workup', "
            "'first-line workup', 'before considering advanced testing', "
            "or a note in the current visit that explicitly says a more "
            "advanced test is being ordered BECAUSE an earlier test "
            "already confirmed something. If the test under review is the "
            "same test (or the same class of test) that the documentation "
            "itself identifies as the baseline/initial step preceding a "
            "more advanced test for this diagnosis, treat it as "
            "first-line for this diagnosis regardless of what a generic "
            "guideline list alone would suggest — the clinician's own "
            "documented workup sequence for this patient is stronger, "
            "more specific evidence than a general textbook assumption, "
            "and generic guideline reasoning must yield to it when the "
            "two disagree.\n"
            "1C. EXPLICIT DOCUMENTED ABSENCE OF WORKUP — ALSO "
            "AUTHORITATIVE: the same sources can just as easily state the "
            "opposite — that a test was ordered WITHOUT any prior "
            "baseline/first-line workup specific to it (e.g. the intake "
            "note or doctor notes say something was done 'directly', "
            "'without a prior exam', or otherwise flag the absence of a "
            "preceding baseline step for THIS specific test). If the "
            "investigation under review is that same test, this explicit "
            "statement of absence is just as authoritative as documented "
            "presence in step 1B: mark is_firstline_for_diagnosis=false, "
            "firstline_previously_completed=false, "
            "firstline_completion_visit_date=\"\", "
            "advanced_test_justified=false, and say in remarks that the "
            "documentation itself states no prior first-line workup was "
            "done for this test — do not let a generic previous-visit "
            "search override this explicit statement.\n"
            "2. FIRSTLINE DETERMINATION: now compare the investigation "
            "under review against the list you just built in step 1. Set "
            "is_firstline_for_diagnosis=true ONLY if the test under review "
            "genuinely belongs to that initial-workup list for THIS "
            "diagnosis — not because it is 'generally a routine test' in "
            "medicine broadly, but because it is specifically part of the "
            "standard first-line approach TO THIS DIAGNOSIS. Reserve "
            "is_firstline_for_diagnosis=false for anything that is instead "
            "an advanced, specialist, invasive, second-line, or confirmatory/"
            "definitive test for this diagnosis — ordered only after, or "
            "instead of, the initial workup.\n"
            "   CONSISTENCY RULE — SAME TIER, NOT DIFFERENT TIERS: an "
            "individual component of a test ordered on its own (e.g. "
            "'Sodium, Serum') is the SAME clinical tier as that same "
            "component ordered as part of a bundled panel (e.g. "
            "'Electrolyte Profile (Na, K, Bicarb, Cl)'). Being ordered "
            "individually rather than as a bundled panel never by itself "
            "changes whether a test counts as first-line for this "
            "diagnosis — judge the underlying test, not its packaging.\n"
            "3. IF NOT FIRSTLINE: is_firstline_for_diagnosis=false. Search "
            "BOTH the CURRENT VISIT'S own doctor notes/investigations AND "
            "the PREVIOUS VISITS provided below (already limited to the "
            "most recent 3-4 visits) for documentation that one of the "
            "firstline_equivalent_tests you named in step 1 (or a clear "
            "equivalent) was already ordered/completed, for this same "
            "diagnosis or its clinical precursor. Match test names "
            "loosely — ignore case and punctuation, and treat a general "
            "version of a test and a more detailed/specific version of "
            "that SAME underlying test (e.g. a panel and that same panel "
            "run with an added sub-breakdown) as the same test, not two "
            "different tests.\n"
            "   - If found: firstline_previously_completed=true, record "
            "which visit_date it was found in as "
            "firstline_completion_visit_date, and "
            "advanced_test_justified=true — the advanced test is billable "
            "because the standard workup was already done.\n"
            "   - If NOT found in any of those visits: "
            "firstline_previously_completed=false, "
            "firstline_completion_visit_date=\"\", and "
            "advanced_test_justified=false — this advanced test was "
            "ordered without the required firstline workup on file.\n"
            "4. IF FIRSTLINE (from step 2): "
            "firstline_previously_completed=false, "
            "firstline_completion_visit_date=\"\", and "
            "advanced_test_justified=true (a firstline test never needs "
            "separate justification).\n"
            "5. remarks: 1-3 concise, factual sentences stating which "
            "diagnosis-specific standard workup you weighed this test "
            "against, and why it landed where it did — this is what a "
            "human reviewer or the insurer will read, so ground it in the "
            "specific diagnosis, not generic test-category assumptions.\n\n"
            "Respond with a SINGLE flat JSON object for this one "
            "investigation only — no markdown fences, no commentary.\n\n"
            f"{MEDICATION_EXCLUSION_RULE}\n\n{HISTORICAL_VISIT_RULE}\n\n"
            "Always respond with valid JSON only."
        )

        prompt = f"""
══════════════════════════════════════════════════════════
VALIDATED DIAGNOSIS
══════════════════════════════════════════════════════════
{diagnosis_json}

══════════════════════════════════════════════════════════
CURRENT VISIT (raw — for documented workup precedent, e.g. doctor notes
explicitly stating a test was done as baseline/first-line before a more
advanced test)
══════════════════════════════════════════════════════════
{latest_visit_json}

══════════════════════════════════════════════════════════
SECONDARY DIAGNOSIS INTAKE NOTE (separately-submitted intake record —
may explicitly state, in its own clinical_note wording, whether a prior
baseline/first-line workup WAS or WAS NOT done before a given test)
══════════════════════════════════════════════════════════
{secondary_source_json}

══════════════════════════════════════════════════════════
INVESTIGATION UNDER REVIEW
══════════════════════════════════════════════════════════
{inv_name}

══════════════════════════════════════════════════════════
PREVIOUS VISITS (latest 3-4, for finding a prior firstline workup)
══════════════════════════════════════════════════════════
{previous_visits_json}

Return ONLY this JSON object, fully filled in, for "{inv_name}":
{{
  "test_name": "{inv_name}",
  "is_firstline_for_diagnosis": true,
  "firstline_equivalent_tests": [],
  "firstline_previously_completed": false,
  "firstline_completion_visit_date": "",
  "advanced_test_justified": true,
  "remarks": ""
}}
"""

        last_error = ""
        async with semaphore:
            for attempt in range(1, FIRSTLINE_MAX_RETRIES + 1):
                try:
                    response = await llm_firstline_item.ainvoke([
                        SystemMessage(content=system),
                        HumanMessage(content=prompt),
                    ])
                    parsed = parse_llm_json(response.content)
                    validated = _validate_firstline_item(parsed, inv_name)
                    if validated is not None:
                        if attempt > 1:
                            logger.info(f"{self.agent_id} · '{inv_name}' · validated on attempt {attempt}")
                        return validated
                    last_error = f"attempt {attempt}: malformed/incomplete/mismatched JSON: {parsed}"
                except Exception as e:
                    last_error = f"attempt {attempt}: exception: {e}"

                logger.warning(f"{self.agent_id} · '{inv_name}' · {last_error}")
                if attempt < FIRSTLINE_MAX_RETRIES:
                    await asyncio.sleep(FIRSTLINE_RETRY_BACKOFF_SECONDS * attempt)

        logger.error(
            f"{self.agent_id} · '{inv_name}' · exhausted {FIRSTLINE_MAX_RETRIES} "
            f"attempts — {last_error}"
        )
        return {
            "test_name": inv_name,
            "is_firstline_for_diagnosis": True,
            "firstline_equivalent_tests": [],
            "firstline_previously_completed": False,
            "firstline_completion_visit_date": "",
            "advanced_test_justified": True,
            "remarks": (
                f"Automated first-line workup validation could not be "
                f"completed for this test after {FIRSTLINE_MAX_RETRIES} "
                "attempts due to a system/LLM error — defaulting to "
                "'justified' so this failure never silently rejects a "
                "claim on its own; manual review required."
            ),
        }

    async def run(self, state: ClaimValidationState) -> ClaimValidationState:
        logger.info(f"{self.agent_id} · FirstlineAgent — START")
        t0 = datetime.now().timestamp()

        investigations = state["latest_visit"].get("investigations", []) or []

        if not investigations:
            state["firstline_result"] = {"firstline_validation": []}
            state["agent_timings"][self.agent_id] = self._elapsed(t0)
            return state

        try:
            diagnosis_json = json.dumps(state.get("diagnosis_result") or {}, indent=2, default=str)
            latest_visit_json = json.dumps(state.get("latest_visit") or {}, indent=2, default=str)
            secondary_source_json = json.dumps(
                state.get("secondary_diagnosis_source") or {}, indent=2, default=str
            )
            previous_visits_json = json.dumps(state.get("previous_visits", []) or [], indent=2, default=str)

            semaphore = asyncio.Semaphore(FIRSTLINE_CONCURRENCY)

            validation = list(await asyncio.gather(*[
                self._validate_one(
                    inv, diagnosis_json, latest_visit_json, secondary_source_json,
                    previous_visits_json, semaphore,
                )
                for inv in investigations
            ]))

            state["firstline_result"] = {"firstline_validation": validation}

        except Exception as e:
            logger.error(f"{self.agent_id} · failed: {e}")
            state["errors"].append(f"{self.agent_id}: {str(e)}")
            state["firstline_result"] = {"firstline_validation": []}

        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A2C · BUNDLING + TABLE OF BENEFITS AGENT (new in v4.0)
# Deterministic — no LLM call. Calls the two DoctorAssist APIs for every
# investigation AND every procedure in the latest visit.
# ============================================================

class BundleTobAgent(BaseAgent):
    agent_id = "A2C_BUNDLE_TOB"

    async def run(self, state: ClaimValidationState) -> ClaimValidationState:
        logger.info(f"{self.agent_id} · BundleTobAgent — START")
        t0 = datetime.now().timestamp()

        investigations = state["latest_visit"].get("investigations", []) or []

        inv_names = [_name_of(i, "investigation_name") for i in investigations]
        all_names = list(dict.fromkeys(inv_names))

        if not all_names:
            state["bundle_tob_result"] = {"items": {}}
            state["agent_timings"][self.agent_id] = self._elapsed(t0)
            return state

        try:
            logger.info(
                f"{self.agent_id} · running bundle+TOB checks for "
                f"{len(all_names)} item(s): {all_names} · "
                f"policy_number={state.get('policy_number')!r}"
            )
            results = await run_bundle_and_tob_checks(all_names, state.get("policy_number"))
            logger.info(f"{self.agent_id} · FINAL bundle_tob items: {results}")
            state["bundle_tob_result"] = {"items": results}
        except Exception as e:
            logger.error(f"{self.agent_id} · failed: {e}")
            state["errors"].append(f"{self.agent_id}: {str(e)}")
            state["bundle_tob_result"] = {"items": {}}

        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A2F · HISTORICAL DATABASE REJECTION LOOKUP (new)
# Deterministic — no LLM call. For the current visit's primary diagnosis
# ICD code, checks every investigation against excel_full_collection for
# a prior REJECTED claim on the same ICD code + same service. Purely
# informational — does not change status/claim_remarks/flags; surfaced
# separately in the final output as "database_search" per investigation.
# ============================================================

class DbHistoryAgent(BaseAgent):
    """
    A2F · Deterministic, no-LLM lookup against excel_full_collection.
    Builds ONE self-contained "Insurance Database Search" section — not a
    per-investigation field — matching the UI: which diagnosis+ICD was
    searched, how many investigation/diagnosis pairs were checked, how
    many had a historical match, an approved/rejected breakdown, and a
    per-investigation result row.
    """
    agent_id = "A2F_DB_HISTORY"

    async def run(self, state: ClaimValidationState) -> ClaimValidationState:
        logger.info(f"{self.agent_id} · DbHistoryAgent — START")
        t0 = datetime.now().timestamp()

        investigations = state["latest_visit"].get("investigations", []) or []
        inv_names = list(dict.fromkeys(_name_of(i, "investigation_name") for i in investigations))

        primary_diagnosis = (state.get("diagnosis_result") or {}).get("primary_diagnosis", {}) or {}
        diagnosis_name = primary_diagnosis.get("diagnosis", "")
        icd_code = primary_diagnosis.get("icd10_code")

        section: Dict[str, Any] = {
            "diagnosis": {
                "name": diagnosis_name,
                "icd10_code": icd_code,
            },
            "investigations_checked": len(inv_names),
            "summary": {
                "total_pairs": len(inv_names),
                "total_matches": 0,
                "approved_count": 0,
                "approved_percentage": "0%",
                "rejected_count": 0,
                "rejected_percentage": "0%",
            },
            "results": [],
        }

        if not inv_names or not icd_code:
            logger.info(
                f"{self.agent_id} · skipping — inv_names={inv_names} · "
                f"icd_code={icd_code!r}"
            )
            state["db_history_result"] = section
            state["agent_timings"][self.agent_id] = self._elapsed(t0)
            return state

        try:
            total_matches = 0
            approved_count = 0
            rejected_count = 0
            results: List[Dict[str, Any]] = []

            for name in inv_names:
                match = await find_historical_investigation_match(icd_code, name)

                if not match["matched"]:
                    results.append({
                        "test_name": name,
                        "matched": False,
                        "status": "No matching records found",
                    })
                    continue

                total_matches += 1
                rep = match["representative"] or {}
                rep_status = str(rep.get("status") or "").strip()
                is_rejected = bool(rep.get("reason_for_rejection")) or rep_status.lower() == "rejected"

                if is_rejected:
                    rejected_count += 1
                elif rep_status.lower() == "approved":
                    approved_count += 1

                results.append({
                    "test_name": name,
                    "matched": True,
                    "status": "Rejected" if is_rejected else (rep_status or "Matched"),
                    "match_count": match["match_count"],
                    "service_description": rep.get("service_description"),
                    "claim_number": rep.get("claim_number"),
                    "reason_for_rejection": rep.get("reason_for_rejection", ""),
                })

            total_pairs = len(inv_names)
            section["summary"] = {
                "total_pairs": total_pairs,
                "total_matches": total_matches,
                "approved_count": approved_count,
                "approved_percentage": f"{round((approved_count / total_pairs) * 100)}%" if total_pairs else "0%",
                "rejected_count": rejected_count,
                "rejected_percentage": f"{round((rejected_count / total_pairs) * 100)}%" if total_pairs else "0%",
            }
            section["results"] = results

            state["db_history_result"] = section
        except Exception as e:
            logger.error(f"{self.agent_id} · failed: {e}")
            state["errors"].append(f"{self.agent_id}: {str(e)}")
            state["db_history_result"] = section

        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · DONE ({state['agent_timings'][self.agent_id]}ms)")
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
            "- Reason for Rejection (if rejected)\n"
            "- Whether the procedure correlates with the primary or any secondary diagnosis\n\n"
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
and appropriate for insurance coverage, and whether it correlates with the
primary diagnosis or any secondary diagnosis.

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
                        "correlated_with_diagnosis": True,
                        "procedure_support": "",
                        "missing_clinical_evidence": "Automated validation failed",
                        "insurance_recommendation": "Request Additional Documentation"
                    }
                    for p in procedures
                ]
            }

        # Fix claim_remarks for procedures + defensive defaults
        for entry in result.get("procedure_validation", []):
            if not isinstance(entry, dict):
                continue
            entry.setdefault("correlated_with_diagnosis", True)
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
# A2_MERGE · DETERMINISTIC OVERRIDE
# Runs after Investigations / Procedures / Periodicity / Bundle+TOB all
# complete. Builds the canonical `flags` list for every item and applies
# the matching hard business-rule overrides on top of the LLM's own call.
# ============================================================

def _canonical_flags_for_investigation(
    entry: Dict[str, Any],
    periodicity_entries: List[Dict[str, Any]],
    bundle_tob_items: Dict[str, Dict[str, Any]],
    firstline_entries: List[Dict[str, Any]],
) -> Tuple[List[str], Dict[str, str]]:
    flags: List[str] = []
    extra_remarks: Dict[str, str] = {}
    entry_name = entry.get("test_name", "")

    if not entry.get("correlates_with_primary_or_secondary_diagnosis", True):
        flags.append(CANONICAL_FLAGS["diagnosis_correlation"])

    matched_periodicity = None
    for p_entry in periodicity_entries:
        if isinstance(p_entry, dict) and _names_match(entry_name, p_entry.get("test_name", "")):
            matched_periodicity = p_entry
            break

    if matched_periodicity:
        p_status = matched_periodicity.get("periodicity_status")
        if p_status == "Invalid - Repeated Within Timeframe":
            flags.append(CANONICAL_FLAGS["periodicity"])
            if matched_periodicity.get("remarks"):
                extra_remarks[CANONICAL_FLAGS["periodicity"]] = matched_periodicity["remarks"]
        elif p_status == "No Periodicity Data Available":
            # Missing reference data isn't a periodicity violation on its
            # own merits — no periodicity claim was ever actually evaluated
            # for this test — so it's surfaced as insufficient information
            # instead, with the specific "no rule found" wording preserved.
            flags.append(CANONICAL_FLAGS["insufficient_info"])
            if matched_periodicity.get("remarks"):
                extra_remarks[CANONICAL_FLAGS["insufficient_info"]] = matched_periodicity["remarks"]

    matched_bt = None
    for name, bt in bundle_tob_items.items():
        if _names_match(entry_name, name):
            matched_bt = bt
            break
    if matched_bt:
        if matched_bt.get("bundle_flagged"):
            flags.append(CANONICAL_FLAGS["bundling"])
        if matched_bt.get("tob_flagged"):
            flags.append(CANONICAL_FLAGS["tob_service"])

    matched_firstline = None
    for f_entry in firstline_entries:
        if isinstance(f_entry, dict) and _names_match(entry_name, f_entry.get("test_name", "")):
            matched_firstline = f_entry
            break

    if matched_firstline and not matched_firstline.get("is_firstline_for_diagnosis", True):
        # Not a firstline test — only flag it if the firstline workup was
        # NOT found in the previous 3-4 visits either. If it was found,
        # advanced_test_justified is already true and this stays clean.
        if not matched_firstline.get("advanced_test_justified", True):
            flags.append(CANONICAL_FLAGS["firstline"])
            if matched_firstline.get("remarks"):
                extra_remarks[CANONICAL_FLAGS["firstline"]] = matched_firstline["remarks"]

    return flags, extra_remarks





def _build_condition_checklist(triggered_flags: List[str]) -> List[Dict[str, str]]:
    """
    Returns all 8 investigation-applicable canonical conditions (every
    CANONICAL_FLAGS heading except the medication-only "Drug Not
    Medically Indicated as per Standard Practice"), each marked
    "Approved" or "Failed" depending on whether it's present in this
    item's triggered `flags`.

    NOTE: "prior_approval", "tob_diagnosis" and "insufficient_info" have
    no deterministic data source wired anywhere in this file yet, so they
    will always read "Approved" here — this list does not, by itself,
    mean those three were actually checked. "firstline" IS wired (via
    FirstlineAgent). Wire a real signal into
    _canonical_flags_for_investigation() for any of the remaining three
    before treating "Approved" as a real determination rather than "not
    evaluated".
    """
    return [
        {
            "condition": CANONICAL_FLAGS[key],
            "status": "Failed" if CANONICAL_FLAGS[key] in triggered_flags else "Approved",
        }
        for key in INVESTIGATION_FLAG_KEYS
    ]


def _apply_flags_to_entry(
    entry: Dict[str, Any],
    flags: List[str],
    extra_remarks: Optional[Dict[str, str]] = None,
) -> None:
    extra_remarks = extra_remarks or {}
    entry["flags"] = flags
    entry["conditions"] = _build_condition_checklist(flags)
    if flags:
        entry["status"] = "Rejected"
        entry["claim_remarks"] = "Non Billable Test Insurance"
        entry["reason_for_rejection"] = "; ".join(flags)
        # Keep system_remarks informative even if the LLM's own text is thin.
        # All 8 canonical flags are registered here — the 4 without a wired
        # data source yet simply never appear in `flags`, so this map is
        # future-proofed against wiring them up later without another edit.
        # `extra_remarks` lets a specific deterministic check (e.g. the
        # Periodicity Agent's "no rule found for X" message) supply its own
        # concrete wording for a flag, taking priority over the generic
        # boilerplate whenever it's present for that flag.
        explanations = {
            CANONICAL_FLAGS["periodicity"]: REJECTION_EXPLANATION_PERIODICITY,
            CANONICAL_FLAGS["diagnosis_correlation"]: REJECTION_EXPLANATION_NOT_RELATED_TO_DIAGNOSIS,
            CANONICAL_FLAGS["bundling"]: REJECTION_EXPLANATION_BUNDLING,
            CANONICAL_FLAGS["drug_not_indicated"]: REJECTION_EXPLANATION_DRUG_NOT_INDICATED,
            CANONICAL_FLAGS["tob_service"]: REJECTION_EXPLANATION_TOB_SERVICE,
            CANONICAL_FLAGS["prior_approval"]: REJECTION_EXPLANATION_PRIOR_APPROVAL,
            CANONICAL_FLAGS["tob_diagnosis"]: REJECTION_EXPLANATION_TOB_DIAGNOSIS,
            CANONICAL_FLAGS["insufficient_info"]: REJECTION_EXPLANATION_INSUFFICIENT_INFO,
            CANONICAL_FLAGS["firstline"]: REJECTION_EXPLANATION_FIRSTLINE,
        }
        entry["system_remarks"] = " ".join(
            extra_remarks.get(f) or explanations.get(f, "") for f in flags
        ).strip()
    # If no flags apply, leave status/claim_remarks/reason_for_rejection/
    # system_remarks exactly as the LLM/lab-history rule already set them.


async def merge_all_flags(state: ClaimValidationState) -> ClaimValidationState:
    investigation_entries = (state.get("investigation_result") or {}).get("investigation_validation", [])
    periodicity_entries = (state.get("periodicity_result") or {}).get("periodicity_validation", [])
    bundle_tob_items = (state.get("bundle_tob_result") or {}).get("items", {})
    firstline_entries = (state.get("firstline_result") or {}).get("firstline_validation", [])

    for entry in investigation_entries:
        if not isinstance(entry, dict):
            continue
        flags, extra_remarks = _canonical_flags_for_investigation(
            entry, periodicity_entries, bundle_tob_items, firstline_entries
        )
        _apply_flags_to_entry(entry, flags, extra_remarks)

    state["investigation_result"] = {"investigation_validation": investigation_entries}
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

        payload = {
            "diagnosis": diagnosis,
            "investigation_validation": investigations,
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
            "NOTE: some investigations/procedures may already carry one or "
            "more canonical `flags` (e.g. periodicity, bundling, TOB, "
            "diagnosis correlation) set by deterministic business rules — "
            "treat those as final and do not contradict them.\n\n"
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
            result = {
                "medical_necessity_summary": "Automated decision failed — manual review required.",
                "claim_status": "Requires Additional Information",
                "approval_percentage": "0%",
                "missing_clinical_documentation": ["Automated validation failed — see logs."],
                "unsupported_investigations": unsupported_inv,
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

async def _run_parallel_validations(state: ClaimValidationState) -> ClaimValidationState:
    """Investigations, Periodicity, and Firstline Workup run concurrently.
    Bundle+TOB now runs as its own mandatory graph node BEFORE this one
    (see create_claim_validation_workflow), so InvestigationAgent can read
    its results as a required input to its own LLM call. Firstline has no
    such dependency (it only needs the diagnosis from A1 and the previous
    visits, both already available by this point), so it runs alongside
    the other two."""
    investigation_agent = InvestigationAgent(llm_claim_validation)
    periodicity_agent = PeriodicityAgent(llm_claim_validation)
    firstline_agent = FirstlineAgent(llm_claim_validation)

    await asyncio.gather(
        investigation_agent.run(state),
        periodicity_agent.run(state),
        firstline_agent.run(state),
    )
    return state


def create_claim_validation_workflow() -> Any:
    workflow = StateGraph(ClaimValidationState)

    workflow.add_node("A1_DIAGNOSIS", DiagnosisAgent(llm_claim_validation).run)
    workflow.add_node("A2C_BUNDLE_TOB", BundleTobAgent(llm_claim_validation).run)
    workflow.add_node("A2F_DB_HISTORY", DbHistoryAgent(llm_claim_validation).run)
    workflow.add_node("A2_PARALLEL", _run_parallel_validations)
    workflow.add_node("A2_MERGE", merge_all_flags)
    workflow.add_node("A4_DECISION", InsuranceDecisionAgent(llm_claim_validation).run)

    workflow.set_entry_point("A1_DIAGNOSIS")
    workflow.add_edge("A1_DIAGNOSIS", "A2C_BUNDLE_TOB")
    workflow.add_edge("A2C_BUNDLE_TOB", "A2F_DB_HISTORY")
    workflow.add_edge("A2F_DB_HISTORY", "A2_PARALLEL")
    workflow.add_edge("A2_PARALLEL", "A2_MERGE")
    workflow.add_edge("A2_MERGE", "A4_DECISION")
    workflow.add_edge("A4_DECISION", END)

    return workflow.compile()


claim_validation_workflow = create_claim_validation_workflow()


# ============================================================
# DETERMINISTIC FINAL ASSEMBLY — MATCHING REQUIRED FORMAT
# ============================================================

def _assemble_final_claim(state: ClaimValidationState) -> Dict[str, Any]:
    """
    Assemble the final claim in the required format:
    {
      "patient_summary": {},
      "primary_diagnosis": {},
      "secondary_diagnoses": [],
      "investigations": [...],
      "return_notes_from_system": [...]
    }
    Each investigation now also carries a "flags" list — canonical
    headings only, may contain more than one.
    """
    diagnosis = state.get("diagnosis_result") or {}
    investigations_raw = (state.get("investigation_result") or {}).get("investigation_validation", [])
    return_notes = state.get("return_notes", [])

    investigations = []
    for inv in investigations_raw:
        if not isinstance(inv, dict):
            continue
        investigations.append({
            "test_name": inv.get("test_name", ""),
            "claim_remarks": inv.get("claim_remarks", "Non Billable Test Insurance"),
            "system_remarks": inv.get("system_remarks", ""),
            "status": inv.get("status", "Pending Documentation"),
            "reason_for_rejection": inv.get("reason_for_rejection", ""),
            "flags": inv.get("flags", []),
            "conditions": inv.get("conditions", []),
        })

    return_notes_formatted = []
    for note in return_notes:
        if isinstance(note, dict):
            if "issue" in note and "suggestion" in note and "recommended_evidence" in note:
                return_notes_formatted.append({
                    "issue": note.get("issue", ""),
                    "suggestion": note.get("suggestion", ""),
                    "recommended_evidence": note.get("recommended_evidence", "")
                })
            else:
                return_notes_formatted.append({
                    "issue": note.get("issue", note.get("title", "")),
                    "suggestion": note.get("suggestion", note.get("description", "")),
                    "recommended_evidence": note.get("recommended_evidence", note.get("evidence", ""))
                })
        elif isinstance(note, str):
            return_notes_formatted.append({
                "issue": "",
                "suggestion": note,
                "recommended_evidence": ""
            })

    default_db_history_section = {
        "diagnosis": {"name": "", "icd10_code": None},
        "investigations_checked": 0,
        "summary": {
            "total_pairs": 0,
            "total_matches": 0,
            "approved_count": 0,
            "approved_percentage": "0%",
            "rejected_count": 0,
            "rejected_percentage": "0%",
        },
        "results": [],
    }

    return {
        "patient_summary": diagnosis.get("patient_summary", {}),
        "primary_diagnosis": diagnosis.get("primary_diagnosis", {}),
        "secondary_diagnoses": diagnosis.get("secondary_diagnoses", []),
        "investigations": investigations,
        "insurance_database_search": state.get("db_history_result") or default_db_history_section,
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
    all_previous_visits: List[Dict[str, Any]],
    lab_report_history: List[Dict[str, Any]],
    periodicity_rules: List[Dict[str, Any]],
    policy_number: Optional[str],
    secondary_diagnosis_source: Optional[Dict[str, Any]] = None,
) -> ClaimValidationState:
    return ClaimValidationState(
        patient_id=patient_id,
        doctor_id=doctor_id,
        latest_visit=latest_visit,
        previous_visits=previous_visits,
        all_previous_visits=all_previous_visits,
        lab_report_history=lab_report_history,
        periodicity_rules=periodicity_rules,
        policy_number=policy_number,
        secondary_diagnosis_source=secondary_diagnosis_source,
        diagnosis_result=None,
        investigation_result=None,
        periodicity_result=None,
        bundle_tob_result=None,
        firstline_result=None,
        db_history_result=None,
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
    logger.critical(
        f"═══ CLAIM VALIDATION RUN START · v4.4-bundle-tob-mandatory · "
        f"patient={request.patient_id} · doctor={request.doctor_id} ═══"
    )
    logger.info(f"Claim validation request | patient={request.patient_id} | doctor={request.doctor_id}")

    try:
        resolved_patient_id = await resolve_patient_sys_id(request.patient_id)
        resolved_doctor_id = await resolve_doctor_sys_id(request.doctor_id)

        visits_sorted = await fetch_patient_visit_history(resolved_patient_id, resolved_doctor_id)

        if not visits_sorted:
            raise HTTPException(
                status_code=404,
                detail=f"No visit history found for patient {request.patient_id} under doctor {request.doctor_id}"
            )

        latest_visit, previous_visits, all_previous_visits = select_latest_and_context_visits(visits_sorted)
        lab_report_history = await fetch_lab_report_history(resolved_patient_id, resolved_doctor_id)
        periodicity_rules = await fetch_periodicity_rules()
        policy_number = await fetch_patient_policy_number(resolved_patient_id)

        # `hospital_id` isn't always sent explicitly — the secondary-diagnosis
        # intake workflow keys its records by hospital_id, and in this app
        # the resolved doctor sys_user_id doubles as that identifier when a
        # distinct hospital_id isn't provided. If your hospital_id differs,
        # pass it explicitly on the request.
        secondary_hospital_id = request.hospital_id or resolved_doctor_id
        secondary_diagnosis_source = await fetch_secondary_diagnosis_source(
            resolved_patient_id, secondary_hospital_id
        )
        latest_visit = _merge_secondary_investigations(latest_visit, secondary_diagnosis_source)
        logger.info(
            f"run_claim_validation · after merge, latest_visit investigations "
            f"going into the pipeline: "
            f"{[_name_of(i, 'investigation_name') for i in latest_visit.get('investigations', [])]}"
        )

        initial_state = build_initial_state(
            resolved_patient_id,
            resolved_doctor_id,
            latest_visit,
            previous_visits,
            all_previous_visits,
            lab_report_history,
            periodicity_rules,
            policy_number,
            secondary_diagnosis_source,
        )

        result_state = await claim_validation_workflow.ainvoke(initial_state)
        final_claim = _assemble_final_claim(result_state)

        elapsed = round(datetime.now().timestamp() * 1000 - start_ms)

        response = {
            "patient_id": request.patient_id,
            "doctor_id": request.doctor_id,
            "patient_sys_id": resolved_patient_id,
            "doctor_sys_id": resolved_doctor_id,
            "generated_at": datetime.now().isoformat(),
            "processing_time_ms": elapsed,
            "visit_date_evaluated": latest_visit.get("visit_date"),
            "previous_visits_used": [v.get("visit_date") for v in previous_visits],
            "lab_reports_on_file": len(lab_report_history),
            "periodicity_rules_loaded": len(periodicity_rules),
            "policy_number_used": policy_number,
            "secondary_diagnosis_source_found": secondary_diagnosis_source is not None,
            "agent_timings": result_state.get("agent_timings", {}),
            "errors": result_state.get("errors", []),
            "claim": final_claim,
        }

        try:
            await insurance_claim_validation_collection.insert_one(dict(response))
        except Exception as e:
            logger.error(f"MongoDB save failed: {e}")

        logger.info(f"Claim validation complete | {elapsed}ms")
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
        "version": "claim-validation-4.3.0",
        "agents": 7,
        "workflow_compiled": claim_validation_workflow is not None,
        "previous_visits_context_count": PREVIOUS_VISITS_CONTEXT_COUNT,
        "lab_history_window_months": LAB_HISTORY_WINDOW_MONTHS,
        "claim_max_tokens": CLAIM_MAX_TOKENS,
        "investigation_validation": {
            "mode": "one LLM call per investigation (concurrent, no batching)",
            "max_retries_per_investigation": INVESTIGATION_MAX_RETRIES,
            "max_tokens_per_call": INVESTIGATION_ITEM_MAX_TOKENS,
            "concurrency": INVESTIGATION_CONCURRENCY,
        },
        "source_collections": {
            "visits": "patientVisitHistory",
            "lab_reports": LAB_REPORTS_COLLECTION_NAME,
            "periodicity_rules": PERIODICITY_RULES_COLLECTION_NAME,
            "insurance_providers": INSURANCE_PROVIDERS_COLLECTION_NAME,
            "secondary_diagnosis_source": WELLKINS_CURRENT_VISIT_DATA_COLLECTION_NAME,
            "excel_full_history": EXCEL_FULL_COLLECTION_NAME,
        },
        "external_apis": {
            "check_bundle": CHECK_BUNDLE_URL,
            "check_tob": CHECK_TOB_URL,
        },
        "output_collection": "insurance_claim_validation",
        "evidence_grounding": "Medications are never used as evidence — context only",
        "claim_remarks_rule": "Only 'Billable Test under Insurance' or 'Non Billable Test Insurance'",
        "canonical_flags": CANONICAL_FLAGS,
        "flags_with_deterministic_source": [
            CANONICAL_FLAGS["periodicity"],
            CANONICAL_FLAGS["diagnosis_correlation"],
            CANONICAL_FLAGS["bundling"],
            CANONICAL_FLAGS["tob_service"],
            CANONICAL_FLAGS["firstline"],
        ],
        "flags_pending_data_source": [
            CANONICAL_FLAGS["drug_not_indicated"],
            CANONICAL_FLAGS["prior_approval"],
            CANONICAL_FLAGS["tob_diagnosis"],
            CANONICAL_FLAGS["insufficient_info"],
        ],
        "workflow": [
            "A1-Diagnosis: Patient Summary → Primary Diagnosis → Secondary Diagnoses (up to 5), "
            "now also grounded in the secondary-diagnosis intake record when one exists",
            "A2-Investigations: Validation with 3-Month Historical Laboratory Rule + diagnosis correlation flag, "
            "current visit investigations only",
            "A2B-Periodicity: Single LLM call per investigation (rule lookup, elapsed-time, abnormality judgment) using periodicity_rules_collection + latest 3 previous visits",
            "A2C-Bundle+TOB: Deterministic check against /check-bundle and /check-tob for every investigation",
            "A2D-Firstline: Single LLM call per investigation — is this test firstline for the diagnosis, and if not, was firstline already done in the previous 3-4 visits",
            "A2-Merge: Deterministic canonical `flags` assembly — always wins over the LLM's own call",
            "A4-Decision: Insurance decision + Return Notes From System",
            "FinalAssembly: Required JSON format (deterministic Python)"
        ],
    }


# ======================================================
# SECONDARY DIAGNOSIS INTAKE ENDPOINT
# Writes to `wellkins_current_visit_data_collection`, which
# fetch_secondary_diagnosis_source() reads back above.
# ============================================================

@router.post("/secondary-diagnosis-workflow")
async def secondary_diagnosis_workflow(request: Request):

    try:
        payload = await request.json()

        logger.info(f"Secondary diagnosis payload received: {payload}")

        hospital_id = payload.get("hospital_id")
        patient_id = payload.get("patient_id")

        if not hospital_id or not patient_id:
            raise HTTPException(
                status_code=400,
                detail="hospital_id and patient_id are required"
            )

        # -----------------------------
        # Validate hospital
        # -----------------------------

        hospital = await hospital_user_collection.find_one(
            {
                "$or": [
                    {"hospital_id": hospital_id},
                    {"sys_user_id": hospital_id}
                ]
            },
            {"_id": 0}
        )

        if not hospital:
            raise HTTPException(
                status_code=404,
                detail=f"Hospital {hospital_id} not found"
            )


        # -----------------------------
        # Validate patient
        # -----------------------------

        patient = await patient_user_collection.find_one(
            {
                "$or": [
                    {"hms_id": patient_id},
                    {"sys_user_id": patient_id}
                ]
            },
            {
                "_id": 0,
                "hms_id": 1,
                "sys_user_id": 1
            }
        )

        if not patient:
            raise HTTPException(
                status_code=404,
                detail=f"Patient {patient_id} not found"
            )


        patient_sys_id = patient.get("sys_user_id")


        # -----------------------------
        # Prepare latest patient record
        # -----------------------------

        current_time = datetime.utcnow()


        patient_record = {
            "patient_id": patient_sys_id,
            "hospital_id": hospital_id,

            # incoming data
            "conditions": payload.get("conditions"),
            "symptoms": payload.get("symptoms"),
            "clinical_note": payload.get("clinical_note"),
            "primary_diagnosis": payload.get("primary_diagnosis"),
            "icd_code": payload.get("icd_code"),
            "duration": payload.get("duration"),
            "investigations": payload.get("investigations"),

            "updated_at": current_time
        }


        # -----------------------------
        # Replace old record
        # -----------------------------

        existing = await wellkins_current_visit_data_collection.find_one(
            {
                "patient_id": patient_sys_id,
                "hospital_id": hospital_id
            }
        )


        if existing:
            await wellkins_current_visit_data_collection.update_one(
                {
                    "patient_id": patient_sys_id,
                    "hospital_id": hospital_id
                },
                {
                    "$set": patient_record
                }
            )

        else:
            patient_record["created_at"] = current_time

            await wellkins_current_visit_data_collection.insert_one(
                patient_record
            )


        logger.info(
            f"Latest secondary diagnosis data saved for patient {patient_sys_id}"
        )


        return {
            "status": "success",
            "message": "Patient secondary diagnosis data updated successfully",
            "patient_id": patient_sys_id,
            "hospital_id": hospital_id,
            "updated_at": current_time
        }


    except HTTPException:
        raise

    except Exception as e:
        logger.error(
            f"Secondary diagnosis workflow failed: {str(e)}"
        )

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )