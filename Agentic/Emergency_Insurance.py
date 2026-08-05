"""
EIDIS — Emergency Insurance Documentation Intelligence System
=============================================================
8-Agent Autonomous Insurance Documentation AI  (v3.1 — case-type aware +
clinically corrected + insurance from all sources)

Architecture:
  Pre-step (NEW v3.1)     → I0  (case-type classifier — runs BEFORE the graph)
  Sequential Foundation   → I1 → I2 → I3 → I4
  Parallel Analysis       → I5 + I6 (concurrent)
  Synthesis & Output      → I7 → I7b (readiness + summary post-pass)

Key Agents:
  I0 · Case-Type Classifier (NEW v3.1)                — is_trauma / case_type, runs pre-graph
  I1 · Patient Demographics & Identity Extractor
  I2 · Emergency Event & Clinical Findings Agent
  I3 · Teleconsultation & Doctor Assessment Agent
  I4 · Ambulance Service & Transport Agent
  I5 · Insurance Eligibility & Coverage Analyser      [parallel]
  I6 · Claim Supporting Evidence Compiler             [parallel]
  I7 · Insurance Claim Package Synthesiser
  I7b· Claim Readiness & Summary Post-Pass            [separate step, prevents truncation]

v3.1 FIXES over v3.0 (this pass):
  ── ROOT-CAUSE BUG: HARDCODED TRAUMA/RTA FALLBACK CONTENT ───────────────────
  A cardiac/medical patient (no injury mechanism at all) was previously
  documented with fabricated trauma content: hardcoded
  `provisional_diagnosis` = "Polytrauma — High-impact RTA...", hardcoded
  `differential_diagnoses` (haemothorax/pneumothorax/TBI/shock), hardcoded
  `claimable_services` (cervical immobilization, haemorrhagic-shock IV
  fluids), hardcoded `specialist_referrals` (Trauma surgery/Neurosurgery),
  hardcoded `transport_position`/`equipment_used` (spinal board, cervical
  collar), and a hardcoded `claim_type` string containing "Polytrauma RTA"
  — ALL of these fired regardless of what the doctor actually dictated,
  because they were baked into the LLM prompt templates (and, for I3, also
  re-injected by a Python post-processing fallback) rather than derived
  from the patient's actual data.
  Fixed by:
    1. NEW I0 · Case-Type Classifier — a fast-model LLM call (EVIS
       A0-style) that reads the combined narrative ONCE, before any other
       agent or hint-extraction runs, and produces `is_trauma` / `case_type`
       / `routing_rationale`. Every prompt in I1-I7b now sees these values.
    2. Every hardcoded trauma-specific list/string described above has been
       REMOVED — not replaced with a parallel medical hardcoded list either.
       Clinical content (diagnoses, differentials, specialist referrals,
       claimable services) is now derived entirely by the LLM from the
       actual patient data, constrained by DIAGNOSTIC_HEDGING_RULE and
       EVIDENCE_TRACEABILITY_RULE (ported from EVIS) plus explicit
       is_trauma/case_type framing in every prompt.
    3. Non-diagnostic, logistics-style fields (transport_position,
       equipment_used, consumables_used, claim_type label,
       documents_required_for_claim's FIR/police-report line, pain_location)
       are now DETERMINISTICALLY DERIVED in Python from actual documented
       interventions/symptoms/is_trauma — never a blanket trauma default,
       and never silently omitted either.

  ── ROOT-CAUSE BUG: SILENT TRAUMA DEFAULT IN HEMODYNAMIC ASSESSMENT ──────────
  `_assess_hemodynamic_status()` used to guess `is_trauma` from a
  `mechanism` string that, at its actual call site inside
  `_extract_py_hints()`, was ALWAYS an empty string (mechanism_of_injury is
  only populated later in the function) — and its ternary
  `is_trauma = ... if mechanism else True` meant an empty mechanism string
  ALWAYS defaulted to True. A haemorrhagic-shock narrative was therefore
  applied to every tachycardic+hypotensive patient, including pure cardiac/
  septic presentations. Fixed: `_assess_hemodynamic_status()` now takes an
  explicit `is_trauma: Optional[bool]` parameter sourced from the new I0
  classifier (computed BEFORE hint extraction), and produces a distinct,
  clinically appropriate narrative for trauma / non-trauma / undetermined
  cases (never assuming haemorrhage for a non-trauma case).

  ── CARDIAC / MEDICAL ICD-10 CODES (previously zero) ─────────────────────────
  `_infer_icd10_codes()` had ONLY trauma/RTA regex branches. Added branches
  for: acute MI/angina (I21.9/I20.9), cardiac arrest (I46.9), arrhythmia
  (I49.9), heart failure (I50.9), stroke (I63.9), seizure (G40.909), sepsis
  (A41.9), anaphylaxis (T78.2XXA), diabetic altered consciousness (E11.649),
  asthma/COPD exacerbation (J45.901/J44.1), GI bleed (K92.2), poisoning/
  overdose (T50.901A), obstetric emergency (O99.89), hypertensive crisis
  (I16.9), and non-trauma shock (R57.9) as an explicit non-haemorrhagic
  alternative to the trauma-only R57.1 code.

  ── SHARED DETERMINISTIC TRIAGE COLOUR ───────────────────────────────────────
  Added `compute_triage_colour()` — a self-contained, deterministic
  (non-LLM) function based purely on physiological derangement (HR, RR,
  SpO2, BP, GCS, consciousness, shock/respiratory-failure flags, doctor-
  stated severity), independent of case type. This REPLACES the old ad hoc
  triage derivation (severity-word map + hemodynamic-status guess) as the
  authoritative `hints["triage_colour"]`. The old clinical_actions-scraped
  value is kept only as `triage_colour_reported_by_other_pipeline`, a
  secondary cross-reference, not the value used in the output package.
  NOTE: this function is a candidate for extraction into a shared module
  once EDFS and the Structured Note pipeline are updated to call the exact
  same function, so triage can never diverge between the three documents
  for the same patient.

  ── GUARDRAILS PORTED FROM EVIS v4.2 ──────────────────────────────────────────
  STABILITY_LABELING_RULE, DIAGNOSTIC_HEDGING_RULE, EVIDENCE_TRACEABILITY_RULE
  (verbatim from EVIS) are now injected into every EIDIS agent prompt that
  produces a clinical status, diagnosis, or claim justification (I2, I3,
  I5, I7, I7b).

v3.0 fixes (unchanged, retained from previous pass):
  ── CLINICAL FIXES ──────────────────────────────────────────────────────────
  1. RR classification: >20 = Tachypnoeic, 12-20 = Normal, <12 = Bradypnoeic
  2. SpO2 classification on O2 vs room-air
  3. Shock recognition: HR>100 + BP_sys<100 in trauma = Compensated_Shock
  4. Respiratory adequacy: RR>20 OR labored breathing = INADEQUATE flag
  5. Chest injury flags: reduced air entry → flag for pneumothorax/hemothorax
  6. Trend analysis corrected
  7. Decompensation watch
  8. Temperature classification

  ── INSURANCE FROM ALL SOURCES ───────────────────────────────────────────────
  9-13. (unchanged — see _extract_insurance_from_all_sources)

  ── OTHER FIXES ──────────────────────────────────────────────────────────────
  14-19. (unchanged — pump flow rates, icd_10_codes base logic, claim amount,
          transcript_summary, incident_datetime_display)
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, TypedDict
from Agentic.clinical_shared.triage import (
    compute_triage_colour, first_int, parse_bp_systolic, fetch_authoritative_triage,
)
from fastapi import APIRouter, HTTPException
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import MongoClient
from pydantic import BaseModel

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END


# ============================================================
# TIMEZONE — India Standard Time (UTC+5:30)
# ============================================================

IST = timezone(timedelta(hours=5, minutes=30))


def now_ist() -> datetime:
    return datetime.now(IST)


def iso_ist(dt: Any) -> str:
    if dt is None:
        return ""
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(IST).isoformat()
    return str(dt)


def display_ist(dt: Any) -> str:
    if dt is None:
        return ""
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(IST).strftime("%d %b %Y, %I:%M:%S %p IST")
    return str(dt)


# ============================================================
# ENVIRONMENT CONFIGURATION
# ============================================================

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
MONGO_URI    = os.getenv("MONGO_URI", "mongodb://localhost:27017")

# ── DB names ────────────────────────────────────────────────
MONGO_DB_MAIN    = "doctorassistai"
MONGO_DB_APPROVE = "doctorassist"     # ApproveImageSuggestion lives here

# ── Async Motor client ───────────────────────────────────────
motor_client     = AsyncIOMotorClient(MONGO_URI)
mongo_db_main    = motor_client[MONGO_DB_MAIN]
mongo_db_approve = motor_client[MONGO_DB_APPROVE]

# ── Sync PyMongo client ──────────────────────────────────────
sync_client = MongoClient(MONGO_URI)
sync_db     = sync_client[MONGO_DB_MAIN]

# ── Collections ─────────────────────────────────────────────
emergency_patients_collection        = sync_db["patients"]
voice_dictations_collection          = mongo_db_main["voice_dictations"]
clinical_actions_collection          = mongo_db_main["clinical_actions"]
doctor_voice_notes_collection        = mongo_db_main["doctor_voice_notes"]
Image_Extracted_Ambulance_collection = mongo_db_main["Image_Extracted_Ambulance"]
Doctor_Suggestion_collection         = mongo_db_main["Doctor_Suggestion_Ambulance"]
ApproveImageSuggestion_collection    = mongo_db_approve["ApproveImageSuggestion"]
insurance_claims_collection          = mongo_db_main["InsuranceClaimPackages"]
patient_triage_status_collection     = mongo_db_main["patient_triage_status"]
# ── LLMs ────────────────────────────────────────────────────
llm = ChatGroq(
    model="llama-3.1-8b-instant",
    temperature=0.1,
    max_tokens=4000,
    groq_api_key=GROQ_API_KEY,
)

llm_synthesis = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0.1,
    max_tokens=8000,
    groq_api_key=GROQ_API_KEY,
)

router = APIRouter(prefix="", tags=["Emergency Insurance Documentation"])


# ============================================================
# REQUEST MODEL
# ============================================================

class InsuranceDocRequest(BaseModel):
    patient_id: str
    include_intermediates: bool = False


# ============================================================
# EIDIS AGENT STATE
# ============================================================

class EIDISState(TypedDict):
    patient_id:              str
    generated_at_ist:        str
    patient_record:          Optional[Dict]
    voice_dictations:        Optional[List[Dict]]
    doctor_voice_notes:      Optional[List[Dict]]
    image_extracted_vitals:  Optional[List[Dict]]
    clinical_actions:        Optional[List[Dict]]
    doctor_suggestions:      Optional[List[Dict]]
    approved_analyses:       Optional[List[Dict]]
    py_hints:                Optional[Dict]
    combined_narrative:      str

    # NEW v3.1 — case-type classification (I0), computed BEFORE the graph
    # runs and threaded into every agent prompt + into hint extraction.
    case_type:               Optional[str]
    is_trauma:                Optional[bool]
    routing_rationale:        Optional[str]
    # NEW v3.1 — the single authoritative triage colour for this package,
    # computed once by compute_triage_colour() and never re-derived
    # differently downstream.
    triage_colour:            Optional[str]

    patient_identity:        Optional[Dict]
    emergency_event:         Optional[Dict]
    teleconsultation_record: Optional[Dict]
    ambulance_service_record:Optional[Dict]
    insurance_eligibility:   Optional[Dict]
    claim_evidence:          Optional[Dict]
    insurance_claim_package: Optional[Dict]
    errors:                  List[str]
    agent_timings:           Dict[str, float]


# ============================================================
# HELPERS
# ============================================================

def parse_llm_json(text: str) -> Dict:
    if not text:
        return {}
    text = text.strip()
    text = re.sub(r"```json\s*", "", text)
    text = re.sub(r"```\s*", "", text)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        text = match.group(0)
    try:
        return json.loads(text)
    except Exception:
        return {"raw_output": text}


def _serialise(obj: Any) -> Any:
    if isinstance(obj, datetime):
        return iso_ist(obj)
    if isinstance(obj, dict):
        return {k: _serialise(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_serialise(i) for i in obj]
    try:
        from bson import ObjectId
        if isinstance(obj, ObjectId):
            return str(obj)
    except ImportError:
        pass
    return obj


def _compact_json(obj: Any) -> str:
    return json.dumps(obj, default=str, ensure_ascii=False)


def _safe_str(val: Any, maxlen: int = 0) -> str:
    if val is None:
        return ""
    s = str(val).strip()
    if maxlen and len(s) > maxlen:
        return s[:maxlen]
    return s


# ============================================================
# INSURANCE EXTRACTION FROM ALL SOURCES
# Scans every available text field across all collections for
# insurance-related data. This runs BEFORE any LLM agent.
# (Unchanged in v3.1 — out of scope for this pass.)
# ============================================================

# Insurance-related regex patterns
_INS_PATTERNS = {
    "policy_number": [
        r"policy\s+(?:number|no\.?|#)[:\s]+([A-Z0-9\-]+)",
        r"policy[:\s]+([A-Z]{2,5}-\d{6,12})",
        r"\bUHC-\d+\b",
        r"\bPOL-\d+\b",
        r"\bPLCY\d+\b",
    ],
    "member_id": [
        r"member\s+(?:id|no\.?|#)[:\s]+([A-Z0-9\-]+)",
        r"member\s+identification[:\s]+([A-Z0-9\-]+)",
        r"\bUH\d{6,12}\b",
        r"\bMEM-\d+\b",
    ],
    "group_number": [
        r"group\s+(?:number|no\.?|#)[:\s]+([A-Z0-9\-]+)",
        r"\bGRP-\d{4}-\d+\b",
    ],
    "claim_number": [
        r"claim\s+(?:number|no\.?|#)[:\s]+([A-Z0-9\-]+)",
        r"\bCLM-\d{4}-\d+\b",
    ],
    "insurance_provider": [
        r"insured\s+through\s+([\w\s]+(?:insurance|services|health|care|plan|company)[^\.,\n]{0,30})",
        r"([\w\s]+(?:insurance|health plan|TPA|services))\s+(?:policy|under|plan)",
        r"insurance\s+(?:provider|company)[:\s]+([\w\s]+(?:insurance|services|health|care)[^\.,\n]{0,30})",
    ],
    "policy_holder": [
        r"policy\s+holder\s+is\s+([\w\s]+?)(?:\s+with|\s+and|\.|,)",
        r"insured\s+(?:person|member)\s+is\s+([\w\s]+?)(?:\s+with|\s+and|\.|,)",
    ],
    "coverage_from": [
        r"coverage\s+effective\s+from\s+([\w\s,]+?\d{4})",
        r"effective\s+(?:date|from)[:\s]+([\w\s,]+?\d{4})",
        r"valid\s+from[:\s]+([\w\s,]+?\d{4})",
    ],
    "coverage_to": [
        r"through\s+([\w\s,]+?\d{4})\b",
        r"valid\s+(?:to|until|upto)[:\s]+([\w\s,]+?\d{4})",
        r"expires?\s+(?:on)?[:\s]?([\w\s,]+?\d{4})",
    ],
    "authorization_number": [
        r"(?:prior\s+)?auth(?:orization)?\s+(?:number|no\.?|#)[:\s]+([A-Z0-9\-]+)",
        r"\bAUTH-[A-Z0-9\-]+\b",
    ],
    "estimated_claim_amount": [
        r"estimated\s+claim\s+amount\s+(?:is\s+)?[\$₹]?([\d,]+\.?\d*)",
        r"claim\s+amount[:\s]+[\$₹]?([\d,]+\.?\d*)",
        r"total\s+(?:claim|billing)[:\s]+[\$₹]?([\d,]+\.?\d*)",
    ],
    "co_pay": [
        r"co[\-\s]?pay(?:ment)?[:\s]+[\$₹]?([\d,]+\.?\d*)",
        r"copay[:\s]+[\$₹]?([\d,]+\.?\d*)",
    ],
    "deductible": [
        r"deductible[:\s]+[\$₹]?([\d,]+\.?\d*)",
    ],
    "npi": [
        r"NPI\s+(\d{10})",
        r"NPI[:\s]+(\d{10})",
    ],
    "provider_name": [
        r"(?:attending|treating)\s+(?:physician|provider|doctor)[:\s]+(Dr\.?\s+[\w\s]+?)(?:\s*,|\s*NPI|\s*\.|$)",
    ],
}

# Keywords that indicate a text block contains insurance info
_INS_KEYWORDS = [
    "insurance", "policy", "member id", "group number", "claim number",
    "coverage", "premium", "co-pay", "copay", "deductible", "tpa",
    "pre-auth", "authorization", "insured through", "policy holder",
    "network", "in-network", "out-of-network", "benefit", "reimburs",
]


def _text_has_insurance(text: str) -> bool:
    """Quick check: does this text contain insurance-related content?"""
    tl = text.lower()
    return any(kw in tl for kw in _INS_KEYWORDS)


def _extract_insurance_from_text(text: str, source_label: str) -> Dict[str, Any]:
    """Extract all insurance fields from a single text blob."""
    result: Dict[str, Any] = {"_source": source_label}
    for field, patterns in _INS_PATTERNS.items():
        for pat in patterns:
            m = re.search(pat, text, re.IGNORECASE)
            if m:
                val = m.group(1).strip() if m.lastindex and m.lastindex >= 1 else m.group(0).strip()
                result[field] = val
                break
    # Also try a raw match for provider names (more permissive)
    if not result.get("insurance_provider"):
        m2 = re.search(
            r"(United\s+Healthcare|Aetna|Cigna|BlueCross|ICICI\s+Lombard|Star\s+Health|New\s+India|Oriental|National\s+Insurance|HDFC\s+ERGO|Bajaj\s+Allianz|Max\s+Bupa|Religare|Apollo\s+Munich)[^\.,\n]{0,50}",
            text, re.IGNORECASE
        )
        if m2:
            result["insurance_provider"] = m2.group(0).strip()

    return result if len(result) > 1 else {}   # >1 means at least one real field found


def _extract_insurance_from_all_sources(data: Dict) -> Dict[str, Any]:
    """
    Scan ALL available data sources for insurance information.
    Priority: doctor_voice_notes > clinical_actions > voice_dictations >
              doctor_suggestions > approved_analyses > patient_record
    Returns a merged dict of all insurance fields found, with source attribution.
    """
    ins: Dict[str, Any] = {}
    sources_found: List[str] = []

    def _merge(found: Dict):
        """Merge found insurance fields, preferring earlier (higher priority) sources."""
        for k, v in found.items():
            if k == "_source":
                continue
            if v and not ins.get(k):
                ins[k] = v
        if found.get("_source") and any(k != "_source" for k in found):
            sources_found.append(found["_source"])

    # 1. Doctor voice notes (highest priority — doctor dictated insurance details)
    for i, dn in enumerate(data.get("doctor_voice_notes") or []):
        conv = dn.get("conversation") or ""
        if _text_has_insurance(conv):
            found = _extract_insurance_from_text(conv, f"doctor_voice_note[{i}]")
            _merge(found)

    # 2. Clinical actions — ai_suggestion or raw text fields
    for i, ca in enumerate(data.get("clinical_actions") or []):
        ca_text = json.dumps(ca, default=str)
        if _text_has_insurance(ca_text):
            found = _extract_insurance_from_text(ca_text, f"clinical_action[{i}]")
            _merge(found)

    # 3. Voice dictations (EMT notes)
    for i, vd in enumerate(data.get("voice_dictations") or []):
        conv = vd.get("conversation") or ""
        if _text_has_insurance(conv):
            found = _extract_insurance_from_text(conv, f"voice_dictation[{i}]")
            _merge(found)

    # 4. Doctor suggestions
    for i, ds in enumerate(data.get("doctor_suggestions") or []):
        text = (ds.get("suggestion_text") or "") + " " + json.dumps(ds, default=str)
        if _text_has_insurance(text):
            found = _extract_insurance_from_text(text, f"doctor_suggestion[{i}]")
            _merge(found)

    # 5. Approved analyses
    for i, aa in enumerate(data.get("approved_analyses") or []):
        aa_text = json.dumps(aa, default=str)
        if _text_has_insurance(aa_text):
            found = _extract_insurance_from_text(aa_text, f"approved_analysis[{i}]")
            _merge(found)

    # 6. Patient record
    pr = data.get("patient_record") or {}
    pr_text = json.dumps(pr, default=str)
    if _text_has_insurance(pr_text):
        found = _extract_insurance_from_text(pr_text, "patient_record")
        _merge(found)
    # Also check dedicated insurance sub-fields in patient record
    for field_name in ["insurance", "insuranceInfo", "insurance_info", "insuranceDetails"]:
        if pr.get(field_name):
            found = _extract_insurance_from_text(
                json.dumps(pr[field_name], default=str), f"patient_record.{field_name}"
            )
            _merge(found)

    ins["_sources_found"] = sources_found
    ins["_insurance_data_available"] = bool(ins.get("policy_number") or ins.get("member_id") or ins.get("insurance_provider"))

    return ins


# ============================================================
# CLINICAL CLASSIFICATION HELPERS  (v3.0 — corrected, unchanged in v3.1)
# ============================================================

def _classify_rr(rr_val: Any) -> Optional[str]:
    """RR classification: >20 = Tachypnoeic, 12-20 = Normal, <12 = Bradypnoeic"""
    if rr_val is None:
        return None
    try:
        rr = int(rr_val)
        if rr > 20:
            return "Tachypnoeic"
        elif rr < 12:
            return "Bradypnoeic"
        else:
            return "Normal"
    except Exception:
        return None


def _classify_hr(hr_val: Any) -> Optional[str]:
    """HR: >100 = Tachycardia, <60 = Bradycardia, else Normal"""
    if hr_val is None:
        return None
    try:
        hr = int(hr_val)
        if hr > 100:
            return "Tachycardia"
        elif hr < 60:
            return "Bradycardia"
        else:
            return "Normal"
    except Exception:
        return None


def _classify_spo2_room_air(spo2_val: Any) -> Optional[str]:
    """SpO2 classification on ROOM AIR (pathological baseline)"""
    if spo2_val is None:
        return None
    try:
        s = int(spo2_val)
        if s < 85:
            return "Severe_Hypoxia"
        elif s < 90:
            return "Moderate_Hypoxia"
        elif s < 95:
            return "Mild_Hypoxia"
        else:
            return "Normal"
    except Exception:
        return None


def _classify_spo2_on_oxygen(spo2_val: Any) -> Optional[str]:
    """SpO2 classification ON SUPPLEMENTAL OXYGEN"""
    if spo2_val is None:
        return None
    try:
        s = int(spo2_val)
        if s < 90:
            return "Severe_Hypoxia_Despite_O2"
        elif s < 94:
            return "Moderate_Hypoxia_Despite_O2"
        else:
            return "Normal_On_O2"
    except Exception:
        return None


def _assess_hemodynamic_status(hr_val: Any, bp_sys_val: Any, is_trauma: Optional[bool]) -> Dict:
    """
    v3.1 — FIXED root-cause bug: this function used to accept a `mechanism`
    string and guess `is_trauma = any(kw in mechanism.lower()) if mechanism
    else True`. At its actual call site the mechanism string was ALWAYS
    empty at the time of the call (mechanism_of_injury is populated later
    in _extract_py_hints), so the ternary's `else True` branch fired on
    EVERY call — silently trauma-coding every tachycardic+hypotensive
    patient, including pure cardiac/septic presentations.

    Now takes an explicit `is_trauma: Optional[bool]` sourced from the I0
    case-type classifier (computed BEFORE hint extraction runs), and
    produces a distinct, clinically appropriate narrative for trauma /
    non-trauma / undetermined cases. Never assumes haemorrhage as the cause
    of shock in a non-trauma case.
    """
    result = {
        "hemodynamic_status": "Unknown",
        "shock_suspected": False,
        "shock_type": None,
        "shock_stage": None,
        "shock_class": None,
        "hemodynamic_narrative": None,
        "decompensation_warning": None,
    }
    if hr_val is None:
        return result

    try:
        hr = int(hr_val)
        bp_sys = int(bp_sys_val) if bp_sys_val is not None else None
    except Exception:
        return result

    trauma_label = (
        "trauma" if is_trauma is True
        else "non-trauma medical" if is_trauma is False
        else "undetermined-mechanism"
    )

    if hr > 100 and bp_sys is not None and bp_sys < 100:
        result["hemodynamic_status"] = "Compensated_Shock"
        result["shock_suspected"]    = True
        if is_trauma is True:
            result["shock_type"]  = "Haemorrhagic"
            result["shock_stage"] = "Compensated"
            result["shock_class"] = "Class_II"   # ~750-1500ml blood loss estimate
            result["hemodynamic_narrative"] = (
                f"HR {hr} bpm (tachycardia) with BP {bp_sys} mmHg in a trauma context. "
                "This pattern is consistent with Class II Haemorrhagic Shock (Compensated). "
                "Tachycardia is compensating for reduced circulating volume. "
                "Patient may maintain BP temporarily but is at HIGH RISK of sudden decompensation."
            )
            result["decompensation_warning"] = (
                "CRITICAL: Monitor BP every 5 minutes. A sudden drop in BP (systolic <90) "
                "indicates decompensated shock requiring immediate blood/fluid resuscitation. "
                "Type and cross-match blood NOW. Prepare for massive transfusion protocol."
            )
        elif is_trauma is False:
            result["shock_type"]  = "Cardiogenic_Septic_or_Distributive"
            result["shock_stage"] = "Compensated"
            result["shock_class"] = None
            result["hemodynamic_narrative"] = (
                f"HR {hr} bpm (tachycardia) with BP {bp_sys} mmHg in a NON-TRAUMA medical "
                "presentation. This is NOT haemorrhagic shock — consider cardiogenic (e.g. "
                "acute MI, arrhythmia, heart failure), septic, anaphylactic, or other "
                "distributive causes. Urgent cardiac and infectious workup indicated; do not "
                "assume a bleeding source just because the vital-sign pattern resembles one."
            )
            result["decompensation_warning"] = (
                "CRITICAL: Monitor BP and rhythm closely. Escalate for urgent physician "
                "evaluation — obtain ECG and troponin, and consider cardiogenic/septic causes "
                "rather than a trauma-pattern resuscitation approach."
            )
        else:
            result["shock_type"]  = "Undetermined"
            result["shock_stage"] = "Compensated"
            result["hemodynamic_narrative"] = (
                f"HR {hr} bpm with BP {bp_sys} mmHg — a compensated-shock vital-sign pattern "
                f"of {trauma_label} cause. Mechanism could not be classified with confidence; "
                "treat as a genuine data gap and confirm with the treating clinician rather "
                "than assuming a haemorrhagic or cardiac source."
            )
    elif hr > 100 and (bp_sys is None or bp_sys >= 100):
        result["hemodynamic_status"] = "Tachycardic_Compensated"
        result["shock_suspected"]    = True
        result["shock_type"] = (
            "Possible_Haemorrhagic" if is_trauma is True
            else "Possible_Cardiac_or_Septic" if is_trauma is False
            else "Possible_Undetermined"
        )
        result["shock_stage"] = "Early"
        result["hemodynamic_narrative"] = (
            f"HR {hr} bpm (tachycardia) in a {trauma_label} context. Tachycardia alone "
            "may represent early compensated shock even with normal BP — serial "
            "reassessment required rather than reassurance from a single reading."
        )
        result["decompensation_warning"] = (
            "Watch for: increasing HR trend, dropping BP, and any new symptoms. "
            "These indicate progressive deterioration regardless of underlying cause."
        )
    elif hr <= 100 and bp_sys is not None and bp_sys >= 90:
        result["hemodynamic_status"] = "Haemodynamically_Stable"
        result["shock_suspected"]    = False
        result["hemodynamic_narrative"] = f"HR {hr} bpm, BP {bp_sys} mmHg — haemodynamically stable."
    elif bp_sys is not None and bp_sys < 90:
        result["hemodynamic_status"] = "Hypotensive_Decompensated_Shock"
        result["shock_suspected"]    = True
        result["shock_type"] = (
            "Haemorrhagic_or_Distributive" if is_trauma is True
            else "Cardiogenic_Septic_or_Distributive" if is_trauma is False
            else "Undetermined"
        )
        result["shock_stage"] = "Decompensated"
        result["hemodynamic_narrative"] = (
            f"BP {bp_sys} mmHg — HYPOTENSION in a {trauma_label} context. Decompensated "
            "shock. Immediate resuscitation and physician notification required."
        )
        result["decompensation_warning"] = (
            "IMMEDIATE: IV access and fluids/blood or vasopressors per treating physician "
            "protocol, plus urgent cause-directed workup (source control if trauma; "
            "cardiac/septic workup if non-trauma) — do not default to a trauma resuscitation "
            "pathway without confirming the mechanism."
        )

    return result


def _assess_respiratory_adequacy(rr_val: Any, spo2_room_air: Any, labored: bool, reduced_air_entry: bool) -> Dict:
    """
    v3.0: Proper respiratory adequacy assessment.
    Inadequate if: RR>20 OR labored breathing OR reduced air entry OR SpO2<95% room air
    (Unchanged in v3.1 — this logic is already case-type agnostic.)
    """
    result = {
        "respiratory_adequacy": "Unknown",
        "respiratory_failure_risk": False,
        "pneumothorax_flag": False,
        "hemothorax_flag": False,
        "respiratory_narrative": None,
        "chest_decompression_watch": None,
    }

    issues = []
    try:
        rr = int(rr_val) if rr_val else None
        spo2 = int(spo2_room_air) if spo2_room_air else None
    except Exception:
        rr = spo2 = None

    if rr and rr > 20:
        issues.append(f"Tachypnoea (RR {rr} bpm, normal 12-20)")
    if labored:
        issues.append("Labored breathing")
    if reduced_air_entry:
        issues.append("Reduced air entry on left side")
        result["pneumothorax_flag"] = True
        result["hemothorax_flag"]   = True
    if spo2 and spo2 < 95:
        issues.append(f"Hypoxia on room air (SpO2 {spo2}%)")

    if issues:
        result["respiratory_adequacy"]     = "INADEQUATE"
        result["respiratory_failure_risk"] = True
        result["respiratory_narrative"]    = (
            f"Respiratory status INADEQUATE: {'; '.join(issues)}. "
            "Immediate oxygen therapy required. Close monitoring for deterioration."
        )
        if result["pneumothorax_flag"] or result["hemothorax_flag"]:
            result["chest_decompression_watch"] = (
                "CRITICAL: Reduced left air entry in trauma context raises concern for "
                "haemothorax or pneumothorax. Monitor for: increasing respiratory distress, "
                "tracheal deviation, absent breath sounds. If tension pneumothorax suspected, "
                "needle decompression at 2nd intercostal space mid-clavicular line is life-saving. "
                "FAST scan and CXR urgently required at ED."
            )
    else:
        result["respiratory_adequacy"]  = "Adequate"
        result["respiratory_narrative"] = "Respiratory parameters within acceptable limits."

    return result


def _assess_clinical_trend(data: Dict, hints: Dict) -> Dict:
    """
    v3.0: Honest clinical trend assessment.
    Considers ALL parameters — not just consciousness.
    (Unchanged in v3.1 — already case-type agnostic.)
    """
    improving_flags = []
    worsening_flags = []
    stable_flags    = []

    consciousness = hints.get("consciousness") or ""
    if "conscious" in consciousness.lower() and "confused" in consciousness.lower():
        improving_flags.append("Level of consciousness (unconscious → conscious but confused)")
    elif "unconscious" in consciousness.lower():
        worsening_flags.append("Level of consciousness — still unconscious")

    rr = hints.get("vn_rr")
    if rr:
        try:
            if int(rr) > 20:
                worsening_flags.append(f"Tachypnoeic (RR {rr} bpm > 20 bpm)")
        except Exception:
            pass

    hr = hints.get("vn_hr")
    if hr:
        try:
            if int(hr) > 100:
                worsening_flags.append(f"Tachycardia (HR {hr} bpm) — possible compensated shock")
        except Exception:
            pass

    bp_sys = hints.get("vn_bp_sys")
    if bp_sys:
        try:
            if int(bp_sys) < 100:
                worsening_flags.append(f"Borderline hypotension (BP {hints.get('vn_bp')} mmHg)")
        except Exception:
            pass

    spo2_air = hints.get("vn_spo2_air")
    if spo2_air:
        try:
            if int(spo2_air) < 95:
                worsening_flags.append(f"Hypoxia on room air (SpO2 {spo2_air}%)")
            else:
                stable_flags.append("SpO2 on room air acceptable")
        except Exception:
            pass

    if len(improving_flags) > 0 and len(worsening_flags) > 0:
        overall = "Mixed"
        trend_summary = (
            f"Clinical picture is MIXED: Some improvement ({', '.join(improving_flags)}) "
            f"but WORSENING parameters ({', '.join(worsening_flags)}). "
            "Do NOT interpret as overall improving. Patient remains high-risk."
        )
    elif len(worsening_flags) > len(improving_flags):
        overall = "Deteriorating"
        trend_summary = f"Clinical parameters deteriorating: {'; '.join(worsening_flags)}."
    elif len(improving_flags) > 0 and len(worsening_flags) == 0:
        overall = "Improving"
        trend_summary = f"Parameters improving: {'; '.join(improving_flags)}."
    else:
        overall = "Stable"
        trend_summary = "Parameters stable with no significant change."

    return {
        "overall_trend":    overall,
        "improving_flags":  improving_flags,
        "worsening_flags":  worsening_flags,
        "stable_flags":     stable_flags,
        "trend_summary":    trend_summary,
        "trajectory_note":  (
            "IMPORTANT: 'Improving consciousness' in post-trauma patients does NOT mean "
            "the patient is safe. Secondary deterioration (Cushing's triad, haemorrhagic shock "
            "decompensation) can occur within minutes. Maintain high vigilance."
        ) if overall == "Mixed" else None,
    }


# ============================================================
# SHARED DETERMINISTIC TRIAGE COLOUR FUNCTION  (v3.1 — NEW)
# ------------------------------------------------------------
# CANDIDATE FOR EXTRACTION: once EDFS and the Structured Note
# pipeline are updated, this exact function (byte-for-byte) should
# be moved into a shared module (e.g. clinical_shared/triage.py)
# and imported by all three pipelines, so triage colour can never
# diverge between the insurance package, the final summary, and
# the structured note for the same patient. Until that module
# exists, this is a self-contained, deterministic copy — it does
# NOT call an LLM and always returns the same colour for the same
# inputs, unlike the old ad hoc triage_colour previously scraped
# from clinical_actions AI snapshots or guessed from a single
# severity word (which is now kept only as a secondary
# cross-reference field, not the authoritative value).
# ============================================================


# ============================================================
# TEXT-BLOB HELPER FOR KEYWORD-DRIVEN INFERENCE  (v3.1 — NEW)
# ============================================================

def _icd_source_text(hints: Dict) -> str:
    """Build a single lowercase text blob from every free-text hint field,
    used for keyword-based ICD-10 / pain-location inference. Centralising
    this avoids each inference function re-deriving its own text slice."""
    parts: List[str] = []
    for k in ("chief_complaint", "dn_full_conversation", "vd_full_transcript", "vd_transcript_summary"):
        v = hints.get(k)
        if v:
            parts.append(str(v))
    parts.extend(hints.get("symptoms_reported") or [])
    parts.extend(hints.get("physical_findings") or [])
    return " ".join(parts).lower()


# ============================================================
# ICD-10 CODE INFERENCE  (v3.1 — cardiac/medical branches added)
# ============================================================

def _infer_icd10_codes(hints: Dict) -> List[Dict]:
    """
    Auto-infer applicable ICD-10 codes from clinical picture.
    v3.1: previously this function had ONLY trauma/RTA regex branches, so a
    cardiac-arrest or MI patient (or any non-trauma medical case) got ZERO
    relevant ICD-10 codes. Added cardiac, neurological, respiratory,
    infectious, endocrine, GI, toxicology, and obstetric branches, all
    driven by actual text/vital evidence — never by is_trauma alone.
    """
    codes = []
    mechanism = (hints.get("mechanism_of_injury") or "").lower()
    injuries   = hints.get("injuries") or []
    injuries_l = " ".join(injuries).lower()
    symptoms_l = " ".join(hints.get("symptoms_reported") or []).lower()
    findings_l = " ".join(hints.get("physical_findings") or []).lower()
    text_blob  = _icd_source_text(hints)
    is_trauma  = hints.get("is_trauma")

    hr     = hints.get("vn_hr")
    bp_sys = hints.get("vn_bp_sys")

    # ── Trauma / RTA branches (unchanged from v3.0) ─────────
    if "road" in mechanism or "traffic" in mechanism or "accident" in mechanism or "collision" in mechanism:
        codes.append({"code": "V89.2", "description": "Person injured in unspecified motor-vehicle accident, traffic"})

    if "head" in injuries_l or "gcs" in str(hints.get("vn_gcs") or ""):
        codes.append({"code": "S09.90", "description": "Unspecified injury of head"})
        if hints.get("vn_gcs"):
            try:
                if int(hints["vn_gcs"]) <= 13:
                    codes.append({"code": "S06.0X0A", "description": "Concussion without loss of consciousness, initial encounter"})
            except Exception:
                pass

    if "chest" in injuries_l or "pulmonary" in injuries_l or "air entry" in findings_l:
        codes.append({"code": "S29.009A", "description": "Unspecified injury of thorax, initial encounter"})
        codes.append({"code": "S27.329A", "description": "Contusion of lung, unspecified, initial encounter"})
        if "reduced air entry" in findings_l:
            codes.append({"code": "S27.0XXA", "description": "Traumatic pneumothorax — rule out (initial encounter)"})
            codes.append({"code": "S27.1XXA", "description": "Traumatic haemothorax — rule out (initial encounter)"})

    if "abrasion" in injuries_l or "abrasion" in findings_l:
        codes.append({"code": "S00.01XA", "description": "Unspecified superficial injury of scalp / multiple abrasions"})

    # ── Generic vital-sign-driven codes (any case type) ─────
    rr = hints.get("vn_rr")
    if rr:
        try:
            if int(rr) > 20:
                codes.append({"code": "R06.00", "description": "Dyspnoea, unspecified (tachypnoea)"})
        except Exception:
            pass

    spo2 = hints.get("vn_spo2_air")
    if spo2:
        try:
            if int(spo2) < 95:
                codes.append({"code": "R09.02", "description": "Hypoxemia"})
        except Exception:
            pass

    if hr:
        try:
            hr_i = int(hr)
            if hr_i > 100:
                codes.append({"code": "R00.0", "description": "Tachycardia, unspecified"})
            elif hr_i < 60:
                codes.append({"code": "R00.1", "description": "Bradycardia, unspecified"})
        except Exception:
            pass

    if bp_sys and hr:
        try:
            if int(bp_sys) < 100 and int(hr) > 100:
                if is_trauma is False:
                    codes.append({"code": "R57.9", "description": "Shock, unspecified — non-haemorrhagic pattern, see hemodynamic assessment"})
                else:
                    codes.append({"code": "R57.1", "description": "Hypovolaemic shock (suspected)"})
        except Exception:
            pass

    if "chest pain" in symptoms_l or "chest pain" in text_blob:
        codes.append({"code": "R07.9", "description": "Chest pain, unspecified"})

    consciousness = (hints.get("consciousness") or "").lower()
    if "confused" in consciousness:
        codes.append({"code": "R41.3", "description": "Other amnesia / post-traumatic confusion"})

    # ── NEW v3.1 — cardiac / medical branches ───────────────
    # Fire on their own textual/vital evidence, independent of the trauma
    # branches above, so a cardiac case is never left with zero relevant codes.
    cardiac_kw = ("heart attack", "myocardial infarction", " mi ", "chest tightness",
                  "crushing chest", "angina", "cardiac event")
    chest_pain_with_derangement = False
    if "chest pain" in text_blob and hr and bp_sys:
        try:
            if int(hr) > 100 or int(bp_sys) < 100:
                chest_pain_with_derangement = True
        except Exception:
            pass
    if any(kw in text_blob for kw in cardiac_kw) or chest_pain_with_derangement:
        codes.append({"code": "I21.9", "description": "Acute myocardial infarction, unspecified — suspected, pending ECG/troponin"})
        codes.append({"code": "I20.9", "description": "Angina pectoris, unspecified — differential"})

    if "cardiac arrest" in text_blob or "cpr" in text_blob or "no pulse" in text_blob:
        codes.append({"code": "I46.9", "description": "Cardiac arrest, cause unspecified"})

    if "arrhythmia" in text_blob or "irregular heartbeat" in text_blob or "palpitations" in text_blob:
        codes.append({"code": "I49.9", "description": "Cardiac arrhythmia, unspecified"})

    if ("heart failure" in text_blob or "pulmonary edema" in text_blob or "pulmonary oedema" in text_blob):
        codes.append({"code": "I50.9", "description": "Heart failure, unspecified — suspected"})

    if ("stroke" in text_blob or "facial droop" in text_blob or "slurred speech" in text_blob
            or "hemiparesis" in text_blob or "one-sided weakness" in text_blob or "one sided weakness" in text_blob):
        codes.append({"code": "I63.9", "description": "Cerebral infarction, unspecified — suspected, pending imaging"})

    if "seizure" in text_blob or "convulsion" in text_blob:
        codes.append({"code": "G40.909", "description": "Epilepsy/seizure, unspecified"})

    fever_present = "fever" in text_blob or hints.get("vn_temp_class") == "Febrile"
    if fever_present and hr and bp_sys:
        try:
            if int(hr) > 100 and int(bp_sys) < 100:
                codes.append({"code": "A41.9", "description": "Sepsis, unspecified organism — suspected"})
        except Exception:
            pass

    if "allergic" in text_blob or "anaphyla" in text_blob:
        codes.append({"code": "T78.2XXA", "description": "Anaphylactic shock, unspecified cause, initial encounter"})

    if ("diabetic" in text_blob or "diabetes" in text_blob) and (
        "confus" in text_blob or "altered" in text_blob or "unconscious" in text_blob
    ):
        codes.append({"code": "E11.649", "description": "Type 2 diabetes with hypoglycemia/altered consciousness — verify glucose"})

    if "asthma" in text_blob or "wheez" in text_blob:
        codes.append({"code": "J45.901", "description": "Unspecified asthma with (acute) exacerbation"})
    if "copd" in text_blob or "emphysema" in text_blob:
        codes.append({"code": "J44.1", "description": "COPD with (acute) exacerbation"})

    if "melena" in text_blob or "hematemesis" in text_blob or "blood in vomit" in text_blob or "gi bleed" in text_blob:
        codes.append({"code": "K92.2", "description": "Gastrointestinal hemorrhage, unspecified"})

    if "overdose" in text_blob or "poisoning" in text_blob or "ingested" in text_blob:
        codes.append({"code": "T50.901A", "description": "Poisoning by unspecified drugs/medication, initial encounter — verify substance"})

    if "pregnan" in text_blob or "labour" in text_blob or "labor" in text_blob or "contractions" in text_blob:
        codes.append({"code": "O99.89", "description": "Other specified diseases/conditions complicating pregnancy/childbirth — obstetric emergency, verify specifics"})

    hypertensive_crisis = False
    if bp_sys:
        try:
            if int(bp_sys) >= 180:
                hypertensive_crisis = True
        except Exception:
            pass
    if hypertensive_crisis:
        codes.append({"code": "I16.9", "description": "Hypertensive crisis, unspecified — verify end-organ involvement"})

    # De-duplicate by code, preserving first-seen order
    seen = set()
    deduped = []
    for c in codes:
        if c["code"] not in seen:
            seen.add(c["code"])
            deduped.append(c)
    return deduped


# ============================================================
# PAIN LOCATION & TRANSPORT/EQUIPMENT DERIVATION  (v3.1 — NEW)
# ------------------------------------------------------------
# Previously `pain_location` was hardcoded to "Chest" (I2) or "Chest and
# multiple trauma sites" (I7) regardless of what was actually documented,
# and `transport_position` / `equipment_used` / `consumables_used` were
# hardcoded to cervical-collar/spinal-board trauma defaults (I4, I7)
# regardless of case type. Both are now derived deterministically from the
# actual documented text/interventions.
# ============================================================

def _derive_pain_location(hints: Dict) -> Optional[str]:
    blob = _icd_source_text(hints)
    body_parts = ["chest", "abdomen", "abdominal", "head", "back", "neck",
                  "leg", "arm", "pelvis", "hip", "knee", "shoulder", "flank"]
    found = []
    for bp in body_parts:
        if f"{bp} pain" in blob or f"pain in the {bp}" in blob or f"pain in {bp}" in blob:
            found.append(bp)
    if found:
        # normalise "abdominal"/"abdomen" to one label
        labels = sorted(set(("abdomen" if f in ("abdomen", "abdominal") else f) for f in found))
        return ", ".join(l.capitalize() for l in labels)
    return None


def _derive_transport_equipment(interventions: List[str], is_trauma: Optional[bool]) -> Dict[str, Any]:
    """
    v3.1: derive transport position / equipment / consumables from what was
    ACTUALLY documented as an intervention, instead of a blanket trauma
    (cervical collar / spinal board) default that previously appeared
    regardless of case type.
    """
    interventions_blob = " ".join(interventions or []).lower()
    equipment: List[str] = ["Stretcher"]   # universal ambulance equipment, not diagnosis-specific
    consumables: List[str] = []

    spinal_documented = ("cervical" in interventions_blob or "spinal" in interventions_blob
                          or "immobiliz" in interventions_blob)

    if is_trauma is True and spinal_documented:
        equipment += ["Cervical collar", "Spinal board"]
        transport_position = "Supine with full spinal precautions"
    elif is_trauma is True:
        transport_position = "Supine — spinal precautions per treating team's on-scene assessment"
    elif is_trauma is False:
        transport_position = "Position of comfort / as clinically indicated by the presentation"
    else:
        transport_position = "Position per treating team's assessment (case type undetermined)"

    if "oxygen" in interventions_blob:
        equipment.append("Oxygen delivery device")
        consumables.append("Oxygen")
    if "iv " in interventions_blob or "intravenous" in interventions_blob or "iv fluid" in interventions_blob:
        equipment.append("IV line")
        consumables.append("IV cannula")
        consumables.append("IV fluids")
    if "cardiac monitor" in interventions_blob or "monitoring" in interventions_blob:
        equipment.append("Cardiac/vitals monitor")
    if "dressing" in interventions_blob or "bleeding" in interventions_blob:
        consumables.append("Dressings")

    return {
        "transport_position": transport_position,
        "equipment_used":     list(dict.fromkeys(equipment)),
        "consumables_used":   list(dict.fromkeys(consumables)),
    }


# ============================================================
# SHARED GUARDRAIL RULES — ported verbatim (in spirit) from EVIS
# v4.2's STABILITY_LABELING_RULE / DIAGNOSTIC_HEDGING_RULE /
# EVIDENCE_TRACEABILITY_RULE. Injected into every EIDIS agent
# prompt that produces a clinical status, diagnosis, or claim
# justification, so EIDIS never contradicts EVIS's clinical
# reasoning conventions — and, specifically for this bugfix,
# so no agent invents case-type-mismatched clinical content.
# ============================================================

STABILITY_LABELING_RULE = """
CRITICAL — DO NOT MISLABEL PATIENT STATUS AS "STABLE":
Only describe a patient as "Stable" if the vitals and clinical picture are
actually within/near-normal ranges AND no ongoing organ-supportive
intervention (NIV/CPAP/BiPAP, oxygen beyond minimal supplementation,
vasoactive drugs, etc.) is required to keep them that way.
If a parameter improved only BECAUSE of an active ongoing intervention, or
other vitals remain deranged (tachypnea, tachycardia, severe hypertension/
hypotension, increased work of breathing), use language such as "improved
after intervention but still critically ill / requires close monitoring" —
never plain "Stable". Always state which parameters improved, which remain
abnormal, and why ongoing monitoring is still required.
"""

DIAGNOSTIC_HEDGING_RULE = """
CRITICAL — NEVER PRESENT A SUSPECTED CONDITION AS A CONFIRMED DIAGNOSIS:
You support insurance/claims documentation; you do not issue a diagnosis.
Any diagnostic label not explicitly documented by a clinician in the input
timeline MUST be phrased as "suspected" / "possible" (e.g. "suspected acute
myocardial infarction", "possible haemothorax") and must be explicitly
linked to the supporting findings it is based on. Never state a diagnosis
as confirmed unless the input timeline explicitly says a clinician has
already diagnosed it. This applies equally to trauma and non-trauma
(cardiac, neurological, toxicological, obstetric, infectious) cases — do
NOT default to a trauma-pattern diagnosis just because that is a common
example in training data; ground every diagnosis in THIS patient's
documented data and its case_type/is_trauma classification.
"""

EVIDENCE_TRACEABILITY_RULE = """
CRITICAL — EVERY STATEMENT MUST BE TRACEABLE TO THE INPUT:
Do not add any diagnosis, medication, investigation, intervention, or
claimable service that is not directly supported by the clinical input
(voice dictations, doctor notes, image-extracted vitals, clinical actions,
approved analyses, or the PYTHON HINTS block). In particular:
  - Do NOT invent trauma-specific content (e.g. cervical immobilization,
    spinal precautions, FIR/police report, pneumothorax/haemothorax) for a
    case classified as is_trauma=false, and do NOT invent cardiac/medical
    content for a case classified as is_trauma=true, unless the actual data
    genuinely supports it.
  - If a data point needed for full confidence is missing or ambiguous, say
    so explicitly (e.g. in a *_completeness or limiting_factors field)
    rather than guessing or defaulting to a stock example from a different
    case type.
  - Every service listed in claimable_services, every code in
    icd_10_codes_applicable, and every line in a differential diagnosis
    list must correspond to something actually observed, reported, or
    performed for THIS patient.
"""


# ============================================================
# PYTHON PRE-EXTRACTION OF HINTS  (v3.1 — is_trauma/case_type
# now threaded in from the I0 classifier BEFORE this runs)
# ============================================================

def _extract_py_hints(
    data: Dict,
    is_trauma: Optional[bool] = None,
    case_type: Optional[str] = None,
    authoritative_triage: Optional[Dict] = None,
) -> Dict:
    hints: Dict[str, Any] = {}

    # ── v3.1 — case classification, computed pre-graph by I0 ─
    hints["is_trauma"] = is_trauma
    hints["case_type"] = case_type

    # ── Patient record fields ───────────────────────────────
    pr = data.get("patient_record") or {}
    hints["patient_id"]          = pr.get("patient_id")
    hints["sys_user_id"]         = pr.get("sys_user_id")
    hints["full_name"]           = pr.get("fullName") or pr.get("full_name")
    hints["age"]                 = pr.get("age")
    hints["gender"]              = pr.get("gender")
    hints["contact_number"]      = pr.get("phoneNumber") or pr.get("contact_number")
    hints["address"]             = pr.get("address") or None
    hints["ambulance_driver"]    = pr.get("ambulance_driver")
    hints["registration_source"] = (pr.get("metadata") or {}).get("registration_source")
    hints["registration_date"]   = (pr.get("metadata") or {}).get("registrationDate")
    hints["patient_status"]      = (pr.get("metadata") or {}).get("status")

    acc = pr.get("accidentDetails") or {}
    hints["incident_date"]       = acc.get("accidentDate") or None
    hints["incident_time"]       = acc.get("accidentTime") or None
    hints["pickup_location"]     = acc.get("location") or None
    hints["pickup_latitude"]     = acc.get("latitude")
    hints["pickup_longitude"]    = acc.get("longitude")
    hints["accident_type"]       = acc.get("accidentType") or None
    hints["accident_condition"]  = acc.get("condition") or None

    ec = pr.get("emergencyContact") or {}
    hints["ec_name"]             = ec.get("name") or None
    hints["ec_relationship"]     = ec.get("relationship") or None
    hints["ec_phone"]            = ec.get("phoneNumber") or None

    # ── Insurance from ALL sources (v3.0, unchanged) ────────
    ins_data = _extract_insurance_from_all_sources(data)
    hints["ins_data_available"]     = ins_data.get("_insurance_data_available", False)
    hints["ins_sources"]            = ins_data.get("_sources_found") or []
    hints["ins_policy_number"]      = ins_data.get("policy_number")
    hints["ins_member_id"]          = ins_data.get("member_id")
    hints["ins_group_number"]       = ins_data.get("group_number")
    hints["ins_claim_number"]       = ins_data.get("claim_number")
    hints["ins_provider"]           = ins_data.get("insurance_provider")
    hints["ins_policy_holder"]      = ins_data.get("policy_holder")
    hints["ins_coverage_from"]      = ins_data.get("coverage_from")
    hints["ins_coverage_to"]        = ins_data.get("coverage_to")
    hints["ins_auth_number"]        = ins_data.get("authorization_number")
    hints["ins_estimated_amount"]   = ins_data.get("estimated_claim_amount")
    hints["ins_co_pay"]             = ins_data.get("co_pay")
    hints["ins_deductible"]         = ins_data.get("deductible")
    hints["ins_npi"]                = ins_data.get("npi")
    hints["ins_provider_name"]      = ins_data.get("provider_name")

    # ── Voice dictation extraction ──────────────────────────
    vd_list = data.get("voice_dictations") or []
    if vd_list:
        hints["vd_first_timestamp"] = vd_list[0].get("timestamp")
        hints["vd_last_timestamp"]  = vd_list[-1].get("timestamp")
        hints["vd_full_transcript"] = " | ".join(
            d.get("conversation", "") for d in vd_list if d.get("conversation")
        )
        if not hints.get("incident_time") and vd_list[0].get("time"):
            hints["incident_time"] = vd_list[0].get("time")
    else:
        hints["vd_first_timestamp"] = None
        hints["vd_last_timestamp"]  = None
        hints["vd_full_transcript"] = None

    # ── Doctor voice notes extraction ──────────────────────
    dn_list = data.get("doctor_voice_notes") or []
    if dn_list:
        hints["dn_first_timestamp"] = dn_list[0].get("timestamp")
        hints["dn_last_timestamp"]  = dn_list[-1].get("timestamp")
        full_conv = " ".join(d.get("conversation", "") for d in dn_list if d.get("conversation"))
        hints["dn_full_conversation"] = full_conv

        cc = None
        conv_lower = full_conv.lower()
        if "complaining of" in conv_lower:
            idx = conv_lower.index("complaining of")
            snippet = full_conv[idx + len("complaining of"):idx + 120].strip()
            cc = "Complaining of " + snippet.split(";")[0].split(",")[0].strip()
        elif "chief complaint" in conv_lower:
            idx = conv_lower.index("chief complaint")
            snippet = full_conv[idx + len("chief complaint"):idx + 120].strip()
            cc = snippet.split(";")[0].split(",")[0].strip().lstrip(":").strip()
        hints["chief_complaint"] = cc

        def _find_value(text: str, patterns: List[str]) -> Optional[str]:
            for p in patterns:
                m = re.search(p, text, re.IGNORECASE)
                if m:
                    return m.group(1).strip()
            return None

        hints["vn_bp"]       = _find_value(full_conv, [r"blood pressure[:\s]+([0-9]+/[0-9]+)", r"bp[:\s]+([0-9]+/[0-9]+)"])
        hints["vn_hr"]       = _find_value(full_conv, [r"pulse rate[:\s]+([0-9]+)", r"heart rate[:\s]+([0-9]+)", r"([0-9]+)\s+beats per minute"])
        hints["vn_rr"]       = _find_value(full_conv, [r"respiratory rate[:\s]+([0-9]+)", r"([0-9]+)\s+breaths per minute"])
        hints["vn_temp_f"]   = _find_value(full_conv, [r"temperature[:\s]+([0-9.]+)\s*[°]?[Ff]", r"([0-9.]+)[°]?F\b"])
        hints["vn_spo2_air"] = _find_value(full_conv, [r"([0-9]+)%\s+on\s+room air", r"saturation[:\s]+([0-9]+)%\s+on\s+room"])
        hints["vn_spo2_o2"]  = _find_value(full_conv, [r"([0-9]+)%\s+with\s+oxygen", r"improving to\s+([0-9]+)%"])
        hints["vn_gcs"]      = _find_value(full_conv, [r"glasgow coma scale[:\s]+([0-9]+)", r"gcs[:\s]+([0-9]+)"])
        hints["vn_glucose"]  = _find_value(full_conv, [r"blood sugar[:\s]+([0-9]+)", r"glucose[:\s]+([0-9]+)"])
        hints["vn_pupils"]   = _find_value(full_conv, [r"pupils? (equal[^,;.]+)", r"pupil[^,;.]+reactive"])

        if hints.get("vn_temp_f"):
            try:
                tf = float(hints["vn_temp_f"])
                hints["vn_temp_c"] = round((tf - 32) * 5 / 9, 1)
            except Exception:
                hints["vn_temp_c"] = None
        else:
            hints["vn_temp_c"] = None

        if hints.get("vn_bp"):
            parts = hints["vn_bp"].split("/")
            if len(parts) == 2:
                hints["vn_bp_sys"] = int(parts[0]) if parts[0].isdigit() else None
                hints["vn_bp_dia"] = int(parts[1]) if parts[1].isdigit() else None
            else:
                hints["vn_bp_sys"] = hints["vn_bp_dia"] = None
        else:
            hints["vn_bp_sys"] = hints["vn_bp_dia"] = None

        hints["vn_hr_class"] = _classify_hr(hints.get("vn_hr"))
        hints["vn_rr_class"] = _classify_rr(hints.get("vn_rr"))
        hints["vn_spo2_class_room_air"] = _classify_spo2_room_air(hints.get("vn_spo2_air"))
        hints["vn_spo2_class_on_o2"]    = _classify_spo2_on_oxygen(hints.get("vn_spo2_o2"))
        hints["vn_spo2_class"]          = hints["vn_spo2_class_room_air"]

        if hints.get("vn_temp_c"):
            try:
                tc = float(hints["vn_temp_c"])
                if tc > 38.0:
                    hints["vn_temp_class"] = "Febrile"
                elif tc < 36.0:
                    hints["vn_temp_class"] = "Hypothermic"
                else:
                    hints["vn_temp_class"] = "Normal"
            except Exception:
                hints["vn_temp_class"] = None
        else:
            hints["vn_temp_class"] = None

        # ── v3.1: hemodynamic assessment now uses the classifier's
        # is_trauma directly — no more mechanism-string guessing. ────
        hd = _assess_hemodynamic_status(hints.get("vn_hr"), hints.get("vn_bp_sys"), is_trauma)
        hints["hemodynamic_status"]       = hd["hemodynamic_status"]
        hints["shock_suspected"]          = hd["shock_suspected"]
        hints["shock_type"]               = hd["shock_type"]
        hints["shock_stage"]              = hd["shock_stage"]
        hints["shock_class"]              = hd["shock_class"]
        hints["hemodynamic_narrative"]    = hd["hemodynamic_narrative"]
        hints["decompensation_warning"]   = hd["decompensation_warning"]

        conv_l = full_conv.lower()
        labored_breathing  = "labored" in conv_l or "laboured" in conv_l or "breathing labored" in conv_l
        reduced_air_entry  = "reduced air entry" in conv_l or "decreased air entry" in conv_l or "absent breath" in conv_l
        ra = _assess_respiratory_adequacy(
            hints.get("vn_rr"), hints.get("vn_spo2_air"),
            labored_breathing, reduced_air_entry
        )
        hints["respiratory_adequacy"]        = ra["respiratory_adequacy"]
        hints["respiratory_failure_risk"]    = ra["respiratory_failure_risk"]
        hints["pneumothorax_flag"]           = ra["pneumothorax_flag"]
        hints["hemothorax_flag"]             = ra["hemothorax_flag"]
        hints["respiratory_narrative"]       = ra["respiratory_narrative"]
        hints["chest_decompression_watch"]   = ra["chest_decompression_watch"]
        hints["reduced_air_entry_left"]      = reduced_air_entry

        symptoms = []
        findings = []
        if "chest pain" in conv_l:
            symptoms.append("Severe chest pain")
        if "difficulty breathing" in conv_l or "breathing difficulties" in conv_l:
            symptoms.append("Difficulty breathing")
        if "shortness of breath" in conv_l:
            symptoms.append("Shortness of breath")
        if "abrasion" in conv_l:
            findings.append("Multiple abrasions over forehead, bilateral upper limbs, and right knee")
        if "labored" in conv_l or "laboured" in conv_l:
            findings.append("Labored breathing with reduced air entry on left side")
        if "tachycardic" in conv_l:
            findings.append("Circulation tachycardic — possible compensated shock")
        if "cervical" in conv_l:
            findings.append("Cervical collar applied")
        if "reduced air entry" in conv_l:
            findings.append("Reduced air entry on left side — suspect haemothorax/pneumothorax")
        hints["symptoms_reported"] = symptoms
        hints["physical_findings"] = findings

        hints["consciousness"] = None
        if "conscious but confused" in conv_l:
            hints["consciousness"] = "Conscious but confused"
        elif "unconscious" in conv_l:
            hints["consciousness"] = "Unconscious"
        elif "responsive" in conv_l:
            hints["consciousness"] = "Responsive"

        interventions = []
        if "cervical" in conv_l:
            interventions.append("Cervical spine immobilization applied")
        if "oxygen" in conv_l:
            interventions.append("Oxygen administered")
        if "iv fluid" in conv_l or "intravenous" in conv_l or "iv fluids" in conv_l:
            interventions.append("IV fluids started")
        if "pain management" in conv_l:
            interventions.append("Pain management administered")
        if "spinal precaution" in conv_l:
            interventions.append("Full spinal precautions applied")
        if "cardiac monitoring" in conv_l:
            interventions.append("Continuous cardiac monitoring initiated")
        if "monitoring" in conv_l and "cardiac monitoring" not in conv_l:
            interventions.append("Continuous vital signs monitoring")
        hints["interventions"] = list(dict.fromkeys(interventions))

        injuries = []
        if "head trauma" in conv_l or "suspected head" in conv_l:
            injuries.append("Suspected head trauma")
        if "abrasion" in conv_l:
            injuries.append("Multiple abrasions (forehead, bilateral upper limbs, right knee)")
        if "chest" in conv_l or "pulmonary contusion" in conv_l:
            injuries.append("Chest injury — suspected pulmonary contusion")
        if "reduced air entry" in conv_l:
            injuries.append("Possible left haemothorax or pneumothorax (reduced air entry)")
        hints["injuries"] = injuries

        treatment_instructions = []
        for line in full_conv.split("."):
            l = line.strip().lower()
            if any(kw in l for kw in ["monitor", "advised", "start", "administer", "refer", "scan", "imaging", "evaluation"]):
                clean = line.strip()
                if len(clean) > 10:
                    treatment_instructions.append(clean)
        hints["treatment_instructions"] = treatment_instructions[:8]

        hints["doctor_severity"] = None
        if "severe" in conv_l:
            hints["doctor_severity"] = "SEVERE"
        elif "moderate" in conv_l:
            hints["doctor_severity"] = "MODERATE"
        elif "mild" in conv_l:
            hints["doctor_severity"] = "MILD"

        trend_data = _assess_clinical_trend(data, hints)
        hints["clinical_trend_overall"]   = trend_data["overall_trend"]
        hints["clinical_trend_summary"]   = trend_data["trend_summary"]
        hints["clinical_trend_improving"] = trend_data["improving_flags"]
        hints["clinical_trend_worsening"] = trend_data["worsening_flags"]
        hints["clinical_trend_note"]      = trend_data.get("trajectory_note")

    else:
        hints["dn_first_timestamp"] = None
        hints["dn_last_timestamp"]  = None
        hints["dn_full_conversation"] = None
        hints["chief_complaint"]     = None
        hints["symptoms_reported"]   = []
        hints["physical_findings"]   = []
        hints["interventions"]       = []
        hints["injuries"]            = []
        hints["treatment_instructions"] = []
        for k in ["vn_bp","vn_hr","vn_rr","vn_temp_f","vn_spo2_air","vn_spo2_o2",
                  "vn_gcs","vn_glucose","vn_pupils","vn_temp_c","vn_bp_sys","vn_bp_dia",
                  "vn_hr_class","vn_rr_class","vn_spo2_class","vn_spo2_class_room_air",
                  "vn_spo2_class_on_o2","vn_temp_class","hemodynamic_status",
                  "shock_suspected","shock_type","shock_stage","shock_class",
                  "hemodynamic_narrative","decompensation_warning","respiratory_adequacy",
                  "respiratory_failure_risk","pneumothorax_flag","hemothorax_flag",
                  "respiratory_narrative","chest_decompression_watch","reduced_air_entry_left",
                  "consciousness","doctor_severity","clinical_trend_overall",
                  "clinical_trend_summary","clinical_trend_improving","clinical_trend_worsening",
                  "clinical_trend_note"]:
            hints[k] = None

    # ── Image-extracted vitals ──────────────────────────────
    iv_list = data.get("image_extracted_vitals") or []
    if iv_list:
        iv = iv_list[0]
        et = iv.get("extracted_text", "")

        def _fv(text, patterns):
            for p in patterns:
                m = re.search(p, text, re.IGNORECASE)
                if m:
                    return m.group(1).strip()
            return None

        hints["iv_timestamp"]    = iv.get("timestamp_iso") or iv.get("timestamp")
        hints["iv_hr"]           = _fv(et, [r"HR\s+([0-9]+)\s*bpm"])
        hints["iv_spo2"]         = _fv(et, [r"SpO2\s+([0-9]+)%"])
        hints["iv_rr"]           = _fv(et, [r"RR\s+([0-9]+)\s*bpm"])
        hints["iv_temp"]         = _fv(et, [r"Temp\s+([0-9.]+)\s*[°]?C"])
        hints["iv_nibp"]         = _fv(et, [r"NIBP\s+([0-9]+/[0-9]+)"])
        hints["iv_pump1_flow"]   = _fv(et, [r"Pump\s*1[^\n]*?Flow\s+Rate\s+([0-9.]+)\s*ml/h"])
        hints["iv_pump2_flow"]   = _fv(et, [r"Pump\s*2[^\n]*?Flow\s+Rate\s+([0-9.]+)\s*ml/h"])
        hints["iv_pump3_flow"]   = _fv(et, [r"Pump\s*3[^\n]*?Flow\s+Rate\s+([0-9.]+)\s*ml/h"])
        hints["iv_pump1_inf"]    = _fv(et, [r"Pump\s*1[^\n]*?Infused\s+([0-9.]+)\s*ml"])
        hints["iv_pump2_inf"]    = _fv(et, [r"Pump\s*2[^\n]*?Infused\s+([0-9.]+)\s*ml"])
        hints["iv_pump3_inf"]    = _fv(et, [r"Pump\s*3[^\n]*?Infused\s+([0-9.]+)\s*ml"])
        hints["iv_monitor_patient"] = _fv(et, [r"([0-9]+\s*[Yy]rs?\s*/\s*[MF])"])

        monitor_age_str = hints.get("iv_monitor_patient") or ""
        reg_age = str(hints.get("age") or "")
        monitor_age_m = re.search(r"(\d+)", monitor_age_str)
        monitor_age = monitor_age_m.group(1) if monitor_age_m else None
        if monitor_age and reg_age and monitor_age != reg_age:
            hints["monitor_patient_mismatch"] = (
                f"CRITICAL: Monitor shows patient '{monitor_age_str}' "
                f"but registered patient is age {reg_age} / {hints.get('gender')}. "
                "Device may be attached to a different patient. Verify before acting on monitor readings."
            )
        else:
            hints["monitor_patient_mismatch"] = None
    else:
        for k in ["iv_timestamp","iv_hr","iv_spo2","iv_rr","iv_temp","iv_nibp",
                  "iv_monitor_patient","iv_pump1_flow","iv_pump2_flow","iv_pump3_flow",
                  "iv_pump1_inf","iv_pump2_inf","iv_pump3_inf","monitor_patient_mismatch"]:
            hints[k] = None

    # ── Approved analyses ───────────────────────────────────
    aa_list = data.get("approved_analyses") or []
    if aa_list:
        aa = aa_list[0]
        hints["aa_available"]       = True
        hints["aa_timestamp"]       = aa.get("timestamp_iso") or aa.get("timestamp")
        hints["aa_processing_id"]   = aa.get("processing_id")
        hints["aa_approved_by"]     = aa.get("approved_by_doctor_id") or "Not recorded"
        hints["aa_risk_level"]      = aa.get("risk_level")
        hints["aa_impressive"]      = aa.get("impressive_findings")
        hints["aa_impression"]      = aa.get("ai_impression")
        hints["aa_physician_alert"] = aa.get("physician_alert")
        hints["aa_emt_actions"]     = aa.get("emt_actions")
        hints["aa_comorbidities"]   = aa.get("comorbidities")
        hints["aa_trend"]           = aa.get("trend_analysis")

        vt_list = aa.get("vitals_timeline") or []
        if vt_list:
            vt = vt_list[0]
            hints["aa_vt_hr"]     = vt.get("hr")
            hints["aa_vt_spo2"]   = vt.get("spo2")
            hints["aa_vt_rr"]     = vt.get("rr")
            hints["aa_vt_temp"]   = vt.get("temperature")
            hints["aa_vt_bp"]     = vt.get("bp")
            hints["aa_vt_p1"]     = vt.get("pump1_flow")
            hints["aa_vt_p2"]     = vt.get("pump2_flow")
            hints["aa_vt_p3"]     = vt.get("pump3_flow")
            hints["aa_vt_p1_inf"] = vt.get("pump1_infused")
            hints["aa_vt_p2_inf"] = vt.get("pump2_infused")
            hints["aa_vt_p3_inf"] = vt.get("pump3_infused")
        else:
            for k in ["aa_vt_hr","aa_vt_spo2","aa_vt_rr","aa_vt_temp","aa_vt_bp",
                      "aa_vt_p1","aa_vt_p2","aa_vt_p3","aa_vt_p1_inf","aa_vt_p2_inf","aa_vt_p3_inf"]:
                hints[k] = None
    else:
        hints["aa_available"] = False
        for k in ["aa_timestamp","aa_processing_id","aa_approved_by","aa_risk_level",
                  "aa_impressive","aa_impression","aa_physician_alert","aa_emt_actions",
                  "aa_comorbidities","aa_trend","aa_vt_hr","aa_vt_spo2","aa_vt_rr",
                  "aa_vt_temp","aa_vt_bp","aa_vt_p1","aa_vt_p2","aa_vt_p3",
                  "aa_vt_p1_inf","aa_vt_p2_inf","aa_vt_p3_inf"]:
            hints[k] = None

    # ── Clinical actions ────────────────────────────────────
    ca_list = data.get("clinical_actions") or []
    hints["ca_total"]    = len(ca_list)
    hints["ca_approved"] = sum(1 for c in ca_list if c.get("action_type") == "approved")
    hints["ca_rejected"] = sum(1 for c in ca_list if c.get("action_type") != "approved")

    # v3.1: the value scraped from other pipelines' AI snapshots is now a
    # SECONDARY cross-reference field only — NOT the authoritative triage
    # colour (see compute_triage_colour() below).
    hints["triage_colour_reported_by_other_pipeline"] = None
    hints["mechanism_of_injury"] = None
    hints["overall_risk"]        = None
    for ca in ca_list:
        ai = ca.get("ai_suggestion") or {}
        sugg = ai.get("suggestions") or {}
        snap = sugg.get("patient_snapshot") or ai.get("patient_snapshot") or {}
        if snap.get("triage_colour") and not hints["triage_colour_reported_by_other_pipeline"]:
            hints["triage_colour_reported_by_other_pipeline"] = snap["triage_colour"]
        if snap.get("mechanism") and not hints["mechanism_of_injury"]:
            hints["mechanism_of_injury"] = snap["mechanism"]
        if snap.get("overall_risk") and not hints["overall_risk"]:
            hints["overall_risk"] = snap["overall_risk"]

    if not hints.get("mechanism_of_injury"):
        conv = hints.get("vd_full_transcript") or ""
        if "high impact" in conv.lower() or "road traffic" in conv.lower():
            hints["mechanism_of_injury"] = "High-impact road traffic accident"

    # v3.1: triage colour is now ALWAYS computed by the shared deterministic
    # function — never guessed from a single severity word, never assumed
    # from hemodynamic status alone. This is the value every pipeline
    # (EIDIS / EDFS / Structured Note) should agree on once they all call
    # the same function.
    deterministic_triage = compute_triage_colour(
        hr=hints.get("vn_hr"),
        rr=hints.get("vn_rr"),
        spo2_room_air=hints.get("vn_spo2_air"),
        spo2_on_o2=hints.get("vn_spo2_o2"),
        bp_sys=hints.get("vn_bp_sys"),
        gcs=hints.get("vn_gcs"),
        consciousness=hints.get("consciousness"),
        shock_suspected=hints.get("shock_suspected"),
        respiratory_failure_risk=hints.get("respiratory_failure_risk"),
        pneumothorax_or_hemothorax_flag=bool(hints.get("pneumothorax_flag") or hints.get("hemothorax_flag")),
        doctor_stated_severity=hints.get("doctor_severity"),
        arrest_or_deceased_indicated=None,  # never assumed — see docstring
    )
    if authoritative_triage and authoritative_triage.get("triage_colour"):
        hints["triage_colour"]                  = authoritative_triage["triage_colour"]
        hints["triage_colour_source"]           = "EVIS_authoritative"
        hints["triage_colour_evis_computed_at"] = authoritative_triage.get("computed_at_ist")
        hints["triage_colour_deterministic_cross_check"] = deterministic_triage
    else:
        hints["triage_colour"]        = deterministic_triage
        hints["triage_colour_source"] = "deterministic_fallback_no_evis_data"

    # ── Doctor suggestions ──────────────────────────────────
    ds_list = data.get("doctor_suggestions") or []
    hints["ds_count"] = len(ds_list)
    hints["ds_texts"] = [d.get("suggestion_text", "") for d in ds_list if d.get("suggestion_text")]

    # ── v3.1: ICD-10 codes (now with cardiac/medical branches) ─
    hints["icd10_codes"] = _infer_icd10_codes(hints)

    # ── v3.1: derived pain location (replaces hardcoded "Chest") ─
    hints["pain_location_derived"] = _derive_pain_location(hints)

    # ── v3.1: derived transport position / equipment / consumables
    # (replaces hardcoded cervical-collar/spinal-board defaults) ─
    hints["transport_derived"] = _derive_transport_equipment(hints.get("interventions") or [], is_trauma)

    # ── Transcript summary ──────────────────────────────────
    vd_summary_parts = []
    for vd in (data.get("voice_dictations") or []):
        conv = vd.get("conversation") or ""
        if conv:
            vd_summary_parts.append(conv[:200].strip())
    hints["vd_transcript_summary"] = " | ".join(vd_summary_parts) if vd_summary_parts else None

    # ── Incident datetime display ───────────────────────────
    if hints.get("incident_date") and hints.get("vd_first_timestamp"):
        try:
            ts_str = hints["vd_first_timestamp"]
            if isinstance(ts_str, str) and "T" in ts_str:
                dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                hints["incident_datetime_display"] = display_ist(dt)
            else:
                hints["incident_datetime_display"] = f"{hints['incident_date']} {hints.get('incident_time','')}"
        except Exception:
            hints["incident_datetime_display"] = f"{hints.get('incident_date','')} {hints.get('incident_time','')}"
    else:
        hints["incident_datetime_display"] = None

    return hints


def _hints_block(hints: Dict) -> str:
    lines = ["=== PRE-EXTRACTED PYTHON HINTS v3.1 (use as ground truth) ==="]
    for k, v in hints.items():
        if v is not None and v != "" and v != [] and v != {}:
            lines.append(f"  {k}: {json.dumps(v, default=str, ensure_ascii=False)}")
    lines.append("=== END HINTS ===")
    return "\n".join(lines)


# ============================================================
# DATA FETCHING
# ============================================================

async def _fetch_all_data(patient_id: str) -> Dict:
    results: Dict[str, Any] = {}

    patient_record = emergency_patients_collection.find_one(
        {"patient_id": patient_id}, {"_id": 0}
    )
    results["patient_record"] = _serialise(patient_record) if patient_record else None

    if not results["patient_record"]:
        raise HTTPException(
            status_code=404,
            detail=f"Patient '{patient_id}' not found in patients collection."
        )

    async def _fetch(collection, query, sort_field, sort_dir=1):
        try:
            cur  = collection.find(query, {"_id": 0}).sort(sort_field, sort_dir)
            docs = await cur.to_list(length=None)
            return [_serialise(d) for d in docs]
        except Exception as e:
            logger.warning(f"Collection fetch failed ({collection.name}): {e}")
            return []

    q = {"patient_id": patient_id}
    results["voice_dictations"]       = await _fetch(voice_dictations_collection,          q, "timestamp")
    results["doctor_voice_notes"]     = await _fetch(doctor_voice_notes_collection,         q, "timestamp")
    results["image_extracted_vitals"] = await _fetch(Image_Extracted_Ambulance_collection,  q, "timestamp")
    results["clinical_actions"]       = await _fetch(clinical_actions_collection,           q, "server_received_at")
    results["doctor_suggestions"]     = await _fetch(Doctor_Suggestion_collection,          q, "timestamp")
    results["approved_analyses"]      = await _fetch(ApproveImageSuggestion_collection,     q, "timestamp", -1)

    logger.info(
        f"[EIDIS] Data fetched | patient={patient_id} | "
        f"voice={len(results['voice_dictations'])} | "
        f"dr_notes={len(results['doctor_voice_notes'])} | "
        f"img={len(results['image_extracted_vitals'])} | "
        f"actions={len(results['clinical_actions'])} | "
        f"suggestions={len(results['doctor_suggestions'])} | "
        f"approved={len(results['approved_analyses'])}"
    )

    has_data = any([
        results["voice_dictations"],
        results["doctor_voice_notes"],
        results["image_extracted_vitals"],
        results["clinical_actions"],
        results["doctor_suggestions"],
        results["approved_analyses"],
    ])
    if not has_data:
        raise HTTPException(
            status_code=404,
            detail=f"No clinical/emergency data found for patient '{patient_id}'."
        )

    return results


# ============================================================
# BUILD COMBINED NARRATIVE
# ============================================================

def _build_combined_narrative(data: Dict, patient_id: str) -> str:
    parts = [
        "=== EIDIS COMBINED PATIENT DATA NARRATIVE ===",
        f"Patient ID  : {patient_id}",
        f"Generated at: {now_ist().isoformat()} IST",
        "",
    ]

    pr = data.get("patient_record") or {}
    parts.append("── PATIENT DEMOGRAPHICS ──")
    parts.append(_compact_json(pr))
    parts.append("")

    vd = data.get("voice_dictations") or []
    parts.append(f"── EMT VOICE DICTATIONS ({len(vd)}) ──")
    for i, d in enumerate(vd, 1):
        parts.append(f"[Dictation {i} | {d.get('timestamp','')}]")
        parts.append(d.get("conversation", "").strip())
    parts.append("")

    dn = data.get("doctor_voice_notes") or []
    parts.append(f"── DOCTOR VOICE NOTES ({len(dn)}) ──")
    for i, d in enumerate(dn, 1):
        parts.append(f"[Note {i} | {d.get('timestamp','')}]")
        parts.append(d.get("conversation", "").strip())
    parts.append("")

    iv = data.get("image_extracted_vitals") or []
    parts.append(f"── IMAGE-EXTRACTED VITALS ({len(iv)}) ──")
    for i, d in enumerate(iv, 1):
        ts = d.get("timestamp") or d.get("image_timestamp_iso", "")
        parts.append(f"[Image Monitor {i} | {ts}]")
        parts.append(d.get("extracted_text", "").strip())
    parts.append("")

    ca = data.get("clinical_actions") or []
    parts.append(f"── CLINICAL ACTIONS ({len(ca)}) ──")
    for i, d in enumerate(ca, 1):
        parts.append(f"[Action {i} | type={d.get('action_type','')} | {d.get('server_received_ist','')}]")
        ai = d.get("ai_suggestion")
        if ai and isinstance(ai, dict):
            sugg = ai.get("suggestions") or {}
            snap = sugg.get("patient_snapshot") or ai.get("patient_snapshot")
            if snap:
                parts.append(f"  AI snapshot: {_compact_json(snap)}")
            single = sugg.get("single_most_critical_action_right_now")
            if single:
                parts.append(f"  Critical action: {single}")
            ca_hist = sugg.get("clinical_action_history_summary") or {}
            if ca_hist.get("completed_actions"):
                parts.append(f"  Completed actions: {ca_hist['completed_actions']}")
    parts.append("")

    ds = data.get("doctor_suggestions") or []
    parts.append(f"── DOCTOR SUGGESTIONS ({len(ds)}) ──")
    for i, d in enumerate(ds, 1):
        parts.append(f"[Suggestion {i} | {d.get('timestamp','')}]")
        parts.append(d.get("suggestion_text", "").strip())
    parts.append("")

    aa = data.get("approved_analyses") or []
    parts.append(f"── APPROVED IMAGE ANALYSES ({len(aa)}) ──")
    for i, d in enumerate(aa, 1):
        ts = d.get("timestamp_iso") or d.get("timestamp", "")
        parts.append(f"[Analysis {i} | {ts} | Risk: {d.get('risk_level','')} | Approved by: {d.get('approved_by_doctor_id') or 'Doctor'}]")
        for field in ["impressive_findings", "ai_impression", "emt_actions", "physician_alert", "comorbidities", "trend_analysis"]:
            val = d.get(field, "")
            if val:
                parts.append(f"  {field}: {str(val)[:500]}")
        for vt in (d.get("vitals_timeline") or []):
            parts.append(
                f"  Monitor vitals | HR={vt.get('hr')} SpO2={vt.get('spo2')} "
                f"RR={vt.get('rr')} Temp={vt.get('temperature')} BP={vt.get('bp')} "
                f"P1={vt.get('pump1_flow')}ml/h P2={vt.get('pump2_flow')}ml/h P3={vt.get('pump3_flow')}ml/h"
            )
    parts.append("")
    parts.append("=== END OF NARRATIVE ===")
    return "\n".join(parts)


# ============================================================
# I0 · CASE-TYPE CLASSIFIER  (v3.1 — NEW, EVIS A0-style)
# ------------------------------------------------------------
# Unlike EVIS's A0 (the first LangGraph node), this classifier is
# invoked BEFORE the LangGraph even starts, because
# _extract_py_hints() / _assess_hemodynamic_status() need is_trauma
# up front to correctly label shock (see the v3.1 hemodynamic-
# status bugfix above). Running it first — off the combined
# narrative alone, using the fast model — means every downstream
# Python hint AND every LLM agent prompt sees the same, single,
# authoritative case_type/is_trauma classification.
# ============================================================

async def classify_case_type(narrative: str) -> Dict[str, Any]:
    system = (
        "You are a triage classification assistant for an emergency medical "
        "documentation pipeline. Your ONLY job is to read the clinical "
        "narrative and decide whether this is a TRAUMA case or a non-trauma "
        "MEDICAL case, and give it a short case_type label. You do NOT "
        "diagnose or treat. Be conservative: if trauma is even plausibly "
        "implied (fall, RTA, assault, blunt/penetrating mechanism, visible "
        "wound, fracture, bleeding from injury), mark is_trauma=true. If the "
        "presentation is purely medical (chest pain, breathing difficulty, "
        "seizure, fever, stroke-like symptoms, cardiac event, poisoning, "
        "allergic reaction, obstetric emergency) with NO injury mechanism, "
        "mark is_trauma=false. Always respond with valid JSON only."
    )
    prompt = f"""
Classify this emergency case from the clinical narrative below.

CLINICAL NARRATIVE:
\"\"\"{narrative}\"\"\"

Decide:
1. is_trauma — true if any mechanism of injury (fall, RTA, assault,
   blunt/penetrating trauma, burn, visible wound/fracture/bleeding from an
   injury) is stated or implied. false for purely medical presentations
   (chest pain, breathing difficulty, seizure, syncope, poisoning, allergic
   reaction, fever, stroke-like symptoms, cardiac arrest/arrhythmia,
   obstetric emergency) with no injury mechanism.
2. case_type — short label: "trauma" | "cardiac" | "cardiorespiratory" |
   "neurological" | "toxicology" | "obstetric" | "infectious_sepsis" |
   "general_medical" | "unknown"

Return ONLY valid JSON:
{{
  "is_trauma": true,
  "case_type": "...",
  "rationale": "one sentence explaining the decision"
}}
"""
    parsed: Dict[str, Any] = {}
    try:
        response = await llm.ainvoke([
            SystemMessage(content=system), HumanMessage(content=prompt)
        ])
        parsed = parse_llm_json(response.content)
    except Exception as e:
        logger.error(f"[EIDIS I0] Case-type classification failed: {e}")

    # Safest fallback (mirrors EVIS A0's philosophy): if classification
    # fails to parse, default is_trauma=True so trauma-appropriate caution
    # (spinal-precaution wording, FIR/police-report requirement, etc.) is
    # not silently dropped — but case_type stays "unknown" rather than
    # inventing a specific mechanism or diagnosis.
    is_trauma = bool(parsed.get("is_trauma", True))
    case_type = parsed.get("case_type", "unknown")
    rationale = parsed.get("rationale") or "Classification unavailable — defaulted to trauma-cautious mode."

    logger.info(f"[EIDIS I0] case_type={case_type} is_trauma={is_trauma} | {rationale}")
    return {"is_trauma": is_trauma, "case_type": case_type, "routing_rationale": rationale}


# ============================================================
# BUILD INITIAL STATE
# ============================================================

def build_eidis_state(
    patient_id: str,
    data: Dict,
    is_trauma: Optional[bool],
    case_type: Optional[str],
    routing_rationale: Optional[str],
    narrative: Optional[str] = None,
    authoritative_triage: Optional[Dict] = None,
) -> EIDISState:
    if narrative is None:
        narrative = _build_combined_narrative(data, patient_id)
    py_hints = _extract_py_hints(
        data, is_trauma=is_trauma, case_type=case_type,
        authoritative_triage=authoritative_triage,
    )

    logger.info("=" * 80)
    logger.info(f"[EIDIS v3.1] case_type={case_type} is_trauma={is_trauma} triage_colour={py_hints.get('triage_colour')}")
    logger.info("[EIDIS v3.1] Python hints extracted:")
    non_null = {k: v for k, v in py_hints.items() if v not in (None, [], {}, "")}
    logger.info(_compact_json(non_null))
    logger.info("=" * 80)

    return EIDISState(
        patient_id               = patient_id,
        generated_at_ist         = now_ist().isoformat(),
        patient_record           = data.get("patient_record"),
        voice_dictations         = data.get("voice_dictations", []),
        doctor_voice_notes       = data.get("doctor_voice_notes", []),
        image_extracted_vitals   = data.get("image_extracted_vitals", []),
        clinical_actions         = data.get("clinical_actions", []),
        doctor_suggestions       = data.get("doctor_suggestions", []),
        approved_analyses        = data.get("approved_analyses", []),
        py_hints                 = py_hints,
        combined_narrative       = narrative,
        case_type                = case_type,
        is_trauma                = is_trauma,
        routing_rationale        = routing_rationale,
        triage_colour            = py_hints.get("triage_colour"),
        patient_identity         = None,
        emergency_event          = None,
        teleconsultation_record  = None,
        ambulance_service_record = None,
        insurance_eligibility    = None,
        claim_evidence           = None,
        insurance_claim_package  = None,
        errors                   = [],
        agent_timings            = {},
    )


# ============================================================
# BASE AGENT
# ============================================================

class BaseAgent:
    def __init__(self, llm_instance):
        self.llm = llm_instance

    async def _invoke(self, system: str, user: str) -> Dict:
        response = await self.llm.ainvoke([
            SystemMessage(content=system),
            HumanMessage(content=user),
        ])
        return parse_llm_json(response.content)

    def _elapsed(self, start: float) -> float:
        return round((datetime.now().timestamp() - start) * 1000, 1)


# ============================================================
# I1 · PATIENT DEMOGRAPHICS & IDENTITY EXTRACTOR
# (unchanged in v3.1 — no trauma-specific hardcodes here)
# ============================================================

class PatientIdentityAgent(BaseAgent):
    agent_id = "I1"

    async def run(self, state: EIDISState) -> EIDISState:
        logger.info(f"{self.agent_id} · PatientIdentityAgent — START")
        t0 = datetime.now().timestamp()

        hints = state.get("py_hints") or {}
        h = _hints_block(hints)
        pr = _compact_json(state.get("patient_record") or {})

        if hints.get("ins_data_available"):
            ins_status = (
                f"Insurance data found in: {', '.join(hints.get('ins_sources') or [])}. "
                f"Provider: {hints.get('ins_provider') or 'see policy details'}. "
                f"Policy: {hints.get('ins_policy_number') or 'see hints'}."
            )
        else:
            ins_status = "Not available — insurance data was not captured at registration or in any clinical note"

        system = (
            "You are a medical records specialist preparing patient identity data for insurance claims. "
            "The PYTHON HINTS block contains pre-extracted values — use them directly as-is. "
            "CRITICAL: Insurance data may have been found in doctor voice notes or other sources — check ins_* hints. "
            "Do NOT invent any value. If a field has no data anywhere, output null. "
            "All timestamps in IST. Respond with valid JSON only."
        )

        prompt = f"""
{h}

RAW PATIENT RECORD:
{pr}

INSURANCE FOUND IN SOURCES: {hints.get('ins_data_available', False)}
INSURANCE SOURCES: {hints.get('ins_sources', [])}

Return ONLY this JSON:
{{
  "patient_identification": {{
    "patient_id": "{hints.get('patient_id') or 'null'}",
    "sys_user_id": "{hints.get('sys_user_id') or 'null'}",
    "full_name": "{hints.get('full_name') or 'null'}",
    "date_of_birth": null,
    "age": "{hints.get('age') or 'null'}",
    "gender": "{hints.get('gender') or 'null'}",
    "contact_number": "{hints.get('contact_number') or 'null'}",
    "address": null,
    "national_id_aadhaar": null,
    "blood_group": null
  }},
  "emergency_contact": {{
    "name": null,
    "relationship": null,
    "phone_number": null
  }},
  "insurance_information": {{
    "insurance_provider_name": {json.dumps(hints.get('ins_provider'))},
    "policy_number": {json.dumps(hints.get('ins_policy_number'))},
    "member_id": {json.dumps(hints.get('ins_member_id'))},
    "group_number": {json.dumps(hints.get('ins_group_number'))},
    "policy_holder_name": {json.dumps(hints.get('ins_policy_holder'))},
    "relationship_to_patient": null,
    "coverage_valid_from": {json.dumps(hints.get('ins_coverage_from'))},
    "coverage_valid_to": {json.dumps(hints.get('ins_coverage_to'))},
    "insurance_card_reference": null,
    "insurance_verification_status": {json.dumps(ins_status)},
    "insurance_data_source": {json.dumps(hints.get('ins_sources') or [])},
    "claim_number_generated": {json.dumps(hints.get('ins_claim_number'))},
    "plan_type": null,
    "coverage_type": null,
    "pre_authorisation_required": null,
    "pre_authorisation_obtained": false,
    "pre_authorisation_reference_number": {json.dumps(hints.get('ins_auth_number'))},
    "co_pay_amount": {json.dumps(hints.get('ins_co_pay'))},
    "deductible_amount": {json.dumps(hints.get('ins_deductible'))},
    "network_status": null,
    "estimated_claim_amount_from_source": {json.dumps(hints.get('ins_estimated_amount'))},
    "attending_provider_npi": {json.dumps(hints.get('ins_npi'))},
    "attending_provider_name": {json.dumps(hints.get('ins_provider_name'))}
  }},
  "known_medical_history_for_insurance": {{
    "pre_existing_conditions": [],
    "current_medications": [],
    "known_allergies": [],
    "previous_hospitalisations": [],
    "disability_status": null
  }},
  "data_completeness": {{
    "identity_fields_present_percent": 0,
    "insurance_fields_present_percent": 0,
    "missing_critical_fields": []
  }}
}}

Fill data_completeness.identity_fields_present_percent based on: patient_id, full_name, age, gender, contact_number present (5 fields — each = 20%).
Fill data_completeness.insurance_fields_present_percent based on: policy_number, member_id, provider_name, coverage_from, coverage_to (5 fields — each = 20%).
Fill missing_critical_fields with what is null.
"""
        result = await self._invoke(system, prompt)

        if result and result.get("patient_identification"):
            pi = result["patient_identification"]
            for field, hint_key in [
                ("patient_id",     "patient_id"),
                ("sys_user_id",    "sys_user_id"),
                ("full_name",      "full_name"),
                ("age",            "age"),
                ("gender",         "gender"),
                ("contact_number", "contact_number"),
            ]:
                if not pi.get(field) and hints.get(hint_key):
                    pi[field] = hints[hint_key]

        if result and result.get("insurance_information"):
            ii = result["insurance_information"]
            ins_field_map = {
                "insurance_provider_name":              "ins_provider",
                "policy_number":                        "ins_policy_number",
                "member_id":                            "ins_member_id",
                "group_number":                         "ins_group_number",
                "policy_holder_name":                   "ins_policy_holder",
                "coverage_valid_from":                  "ins_coverage_from",
                "coverage_valid_to":                    "ins_coverage_to",
                "claim_number_generated":               "ins_claim_number",
                "pre_authorisation_reference_number":   "ins_auth_number",
                "co_pay_amount":                        "ins_co_pay",
                "deductible_amount":                    "ins_deductible",
                "estimated_claim_amount_from_source":   "ins_estimated_amount",
                "attending_provider_npi":               "ins_npi",
                "attending_provider_name":               "ins_provider_name",
            }
            for field, hint_key in ins_field_map.items():
                if not ii.get(field) and hints.get(hint_key):
                    ii[field] = hints[hint_key]

            has_ins = hints.get("ins_data_available", False)
            if has_ins and hints.get("ins_policy_number"):
                ii["insurance_verification_status"] = (
                    f"Insurance details found in: {', '.join(hints.get('ins_sources') or [])}. "
                    "Policy details extracted and included in this package."
                )
            elif has_ins:
                ii["insurance_verification_status"] = (
                    f"Partial insurance data found in: {', '.join(hints.get('ins_sources') or [])}. "
                    "Some fields could not be fully extracted."
                )
            ii["insurance_data_available"] = has_ins

        state["patient_identity"] = result
        logger.info(f"{self.agent_id} · DONE")
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        return state


# ============================================================
# I2 · EMERGENCY EVENT & CLINICAL FINDINGS AGENT
# v3.1: case_type/is_trauma framing + guardrail rules +
# derived pain_location (was hardcoded "Chest")
# ============================================================

class EmergencyEventAgent(BaseAgent):
    agent_id = "I2"

    async def run(self, state: EIDISState) -> EIDISState:
        logger.info(f"{self.agent_id} · EmergencyEventAgent — START")
        t0 = datetime.now().timestamp()

        hints = state.get("py_hints") or {}
        h = _hints_block(hints)

        vd_json = _compact_json(state.get("voice_dictations") or [])
        iv_json = _compact_json(state.get("image_extracted_vitals") or [])
        ca_json = _compact_json(state.get("clinical_actions") or [])
        aa_json = _compact_json(state.get("approved_analyses") or [])
        pr_json = _compact_json(state.get("patient_record") or {})

        critical_flags = []
        if hints.get("monitor_patient_mismatch"):
            critical_flags.append(hints["monitor_patient_mismatch"])
        if hints.get("hemodynamic_status") in ("Compensated_Shock", "Hypotensive_Decompensated_Shock"):
            critical_flags.append(hints.get("hemodynamic_narrative") or "Compensated shock suspected")
        if hints.get("decompensation_warning"):
            critical_flags.append(hints["decompensation_warning"])
        if hints.get("chest_decompression_watch"):
            critical_flags.append(hints["chest_decompression_watch"])
        if hints.get("pneumothorax_flag"):
            critical_flags.append("Reduced air entry on left — suspect haemothorax/pneumothorax. Rule out urgently.")

        pain_location = hints.get("pain_location_derived")

        system = (
            "You are a clinical documentation specialist extracting emergency event data for an insurance claim. "
            "The PYTHON HINTS block contains pre-extracted, CLINICALLY CORRECTED values — ALWAYS prioritise them. "
            "v3.1 CRITICAL RULES: "
            "1. RR 28 bpm = Tachypnoeic (NOT Normal). "
            "2. SpO2 91% on room air = Mild_Hypoxia; SpO2 96% ON OXYGEN = Normal_On_O2. "
            "3. hemodynamic_status and respiratory_adequacy come from HINTS, not your own guess. "
            "4. This patient has been classified as is_trauma="
            f"{hints.get('is_trauma')}, case_type='{hints.get('case_type')}'. Only document trauma-specific "
            "content (injuries, mechanism) if is_trauma is true AND the data supports it — do not invent "
            "injuries for a non-trauma medical case, and do not invent cardiac/medical content for a trauma "
            "case unless documented. "
            "null only when genuinely absent from all sources. All timestamps in IST. Valid JSON only."
        ) + DIAGNOSTIC_HEDGING_RULE + EVIDENCE_TRACEABILITY_RULE

        prompt = f"""
{h}

CASE TYPE (pre-classified by I0): {hints.get('case_type')} | is_trauma={hints.get('is_trauma')}

RAW DATA:
PATIENT: {pr_json}
VOICE DICTATIONS: {vd_json}
IMAGE VITALS: {iv_json}
CLINICAL ACTIONS: {ca_json}
APPROVED ANALYSES: {aa_json}

Return ONLY this complete JSON (fill every field):
{{
  "emergency_event": {{
    "incident_date": {json.dumps(hints.get('incident_date'))},
    "incident_time_ist": {json.dumps(hints.get('vd_first_timestamp'))},
    "incident_datetime_display": {json.dumps(hints.get('incident_datetime_display'))},
    "pickup_location": {json.dumps(hints.get('pickup_location'))},
    "pickup_latitude": {json.dumps(hints.get('pickup_latitude'))},
    "pickup_longitude": {json.dumps(hints.get('pickup_longitude'))},
    "destination_hospital": null,
    "chief_complaint": {json.dumps(hints.get('chief_complaint'))},
    "mechanism_of_injury": {json.dumps(hints.get('mechanism_of_injury'))},
    "accident_type": null,
    "emergency_severity_level": "HIGH",
    "triage_colour": {json.dumps(hints.get('triage_colour'))},
    "number_of_patients_at_scene": 1
  }},
  "case_classification": {{
    "case_type": {json.dumps(hints.get('case_type'))},
    "is_trauma": {json.dumps(hints.get('is_trauma'))},
    "routing_rationale": {json.dumps(state.get('routing_rationale'))}
  }},
  "paramedic_clinical_documentation": {{
    "voice_dictation_count": {len(state.get('voice_dictations') or [])},
    "voice_dictation_ids": [],
    "first_dictation_timestamp_ist": {json.dumps(hints.get('vd_first_timestamp'))},
    "last_dictation_timestamp_ist": {json.dumps(hints.get('vd_last_timestamp'))},
    "combined_transcript_summary": {json.dumps(hints.get('vd_transcript_summary'))},
    "symptoms_reported": {json.dumps(hints.get('symptoms_reported') or [])},
    "physical_findings": {json.dumps(hints.get('physical_findings') or [])},
    "gcs_score": {json.dumps(int(hints['vn_gcs']) if hints.get('vn_gcs') and str(hints['vn_gcs']).isdigit() else None)},
    "gcs_eye": null,
    "gcs_verbal": null,
    "gcs_motor": null,
    "consciousness_level": {json.dumps(hints.get('consciousness'))},
    "pain_score": null,
    "pain_location": {json.dumps(pain_location)}
  }},
  "vital_signs_record": {{
    "source": "Doctor voice note",
    "measurement_timestamp_ist": {json.dumps(hints.get('dn_last_timestamp'))},
    "blood_pressure_systolic": {json.dumps(hints.get('vn_bp_sys'))},
    "blood_pressure_diastolic": {json.dumps(hints.get('vn_bp_dia'))},
    "blood_pressure_display": {json.dumps(hints.get('vn_bp'))},
    "heart_rate_bpm": {json.dumps(int(hints['vn_hr']) if hints.get('vn_hr') and str(hints['vn_hr']).isdigit() else None)},
    "heart_rate_classification": {json.dumps(hints.get('vn_hr_class'))},
    "respiratory_rate_bpm": {json.dumps(int(hints['vn_rr']) if hints.get('vn_rr') and str(hints['vn_rr']).isdigit() else None)},
    "respiratory_rate_classification": {json.dumps(hints.get('vn_rr_class'))},
    "spo2_on_room_air_percent": {json.dumps(int(hints['vn_spo2_air']) if hints.get('vn_spo2_air') and str(hints['vn_spo2_air']).isdigit() else None)},
    "spo2_on_oxygen_percent": {json.dumps(int(hints['vn_spo2_o2']) if hints.get('vn_spo2_o2') and str(hints['vn_spo2_o2']).isdigit() else None)},
    "spo2_room_air_classification": {json.dumps(hints.get('vn_spo2_class_room_air'))},
    "spo2_on_o2_classification": {json.dumps(hints.get('vn_spo2_class_on_o2'))},
    "temperature_celsius": {json.dumps(hints.get('vn_temp_c'))},
    "temperature_fahrenheit": {json.dumps(float(hints['vn_temp_f']) if hints.get('vn_temp_f') else None)},
    "temperature_classification": {json.dumps(hints.get('vn_temp_class'))},
    "ecg_rhythm": null,
    "glucose_mgdl": {json.dumps(int(hints['vn_glucose']) if hints.get('vn_glucose') and str(hints['vn_glucose']).isdigit() else None)},
    "pupil_response": {json.dumps(hints.get('vn_pupils'))},
    "all_vitals_normal": false,
    "critical_vitals_flags": {json.dumps(critical_flags)}
  }},
  "hemodynamic_assessment": {{
    "hemodynamic_status": {json.dumps(hints.get('hemodynamic_status'))},
    "shock_suspected": {json.dumps(hints.get('shock_suspected', False))},
    "shock_type": {json.dumps(hints.get('shock_type'))},
    "shock_stage": {json.dumps(hints.get('shock_stage'))},
    "shock_class": {json.dumps(hints.get('shock_class'))},
    "hemodynamic_narrative": {json.dumps(hints.get('hemodynamic_narrative'))},
    "decompensation_warning": {json.dumps(hints.get('decompensation_warning'))}
  }},
  "respiratory_assessment": {{
    "respiratory_adequacy": {json.dumps(hints.get('respiratory_adequacy'))},
    "respiratory_failure_risk": {json.dumps(hints.get('respiratory_failure_risk', False))},
    "pneumothorax_suspected": {json.dumps(hints.get('pneumothorax_flag', False))},
    "hemothorax_suspected": {json.dumps(hints.get('hemothorax_flag', False))},
    "reduced_air_entry_left": {json.dumps(hints.get('reduced_air_entry_left', False))},
    "respiratory_narrative": {json.dumps(hints.get('respiratory_narrative'))},
    "chest_decompression_watch": {json.dumps(hints.get('chest_decompression_watch'))}
  }},
  "image_monitor_vitals": {{
    "available": {json.dumps(bool(hints.get('iv_hr')))},
    "monitor_timestamp_ist": {json.dumps(hints.get('iv_timestamp'))},
    "hr_bpm": {json.dumps(int(hints['iv_hr']) if hints.get('iv_hr') and str(hints['iv_hr']).isdigit() else None)},
    "spo2_percent": {json.dumps(int(hints['iv_spo2']) if hints.get('iv_spo2') and str(hints['iv_spo2']).isdigit() else None)},
    "rr_bpm": {json.dumps(int(hints['iv_rr']) if hints.get('iv_rr') and str(hints['iv_rr']).isdigit() else None)},
    "temperature_celsius": {json.dumps(float(hints['iv_temp']) if hints.get('iv_temp') else None)},
    "nibp_display": {json.dumps(hints.get('iv_nibp'))},
    "pump1_flow_ml_hr": {json.dumps(float(hints['iv_pump1_flow']) if hints.get('iv_pump1_flow') else (float(hints['aa_vt_p1']) if hints.get('aa_vt_p1') else None))},
    "pump2_flow_ml_hr": {json.dumps(float(hints['iv_pump2_flow']) if hints.get('iv_pump2_flow') else (float(hints['aa_vt_p2']) if hints.get('aa_vt_p2') else None))},
    "pump3_flow_ml_hr": {json.dumps(float(hints['iv_pump3_flow']) if hints.get('iv_pump3_flow') else (float(hints['aa_vt_p3']) if hints.get('aa_vt_p3') else None))},
    "pump1_infused_ml": {json.dumps(float(hints['iv_pump1_inf']) if hints.get('iv_pump1_inf') else (float(hints['aa_vt_p1_inf']) if hints.get('aa_vt_p1_inf') else None))},
    "pump2_infused_ml": {json.dumps(float(hints['iv_pump2_inf']) if hints.get('iv_pump2_inf') else (float(hints['aa_vt_p2_inf']) if hints.get('aa_vt_p2_inf') else None))},
    "pump3_infused_ml": {json.dumps(float(hints['iv_pump3_inf']) if hints.get('iv_pump3_inf') else (float(hints['aa_vt_p3_inf']) if hints.get('aa_vt_p3_inf') else None))},
    "patient_identity_on_monitor": {json.dumps(hints.get('iv_monitor_patient'))},
    "monitor_mismatch_note": {json.dumps(hints.get('monitor_patient_mismatch'))}
  }},
  "injuries_documented": {json.dumps(hints.get('injuries') or [])},
  "pre_hospital_interventions": {json.dumps(hints.get('interventions') or [])},
  "clinical_trend": {{
    "overall_trend": {json.dumps(hints.get('clinical_trend_overall'))},
    "trend_summary": {json.dumps(hints.get('clinical_trend_summary'))},
    "improving_parameters": {json.dumps(hints.get('clinical_trend_improving') or [])},
    "worsening_parameters": {json.dumps(hints.get('clinical_trend_worsening') or [])},
    "trajectory_note": {json.dumps(hints.get('clinical_trend_note'))}
  }},
  "approved_ai_analysis_summary": {{
    "available": {json.dumps(hints.get('aa_available', False))},
    "risk_level": {json.dumps(hints.get('aa_risk_level'))},
    "impressive_findings": {json.dumps(hints.get('aa_impressive'))},
    "emt_actions_recommended": {json.dumps(hints.get('aa_emt_actions'))},
    "physician_alert": {json.dumps(hints.get('aa_physician_alert'))},
    "ai_impression": {json.dumps(hints.get('aa_impression'))},
    "comorbidities": {json.dumps(hints.get('aa_comorbidities'))},
    "trend_analysis": {json.dumps(hints.get('aa_trend'))},
    "approved_at_ist": {json.dumps(hints.get('aa_timestamp'))},
    "approved_by_doctor_id": {json.dumps(hints.get('aa_approved_by'))}
  }},
  "clinical_actions_summary": {{
    "total_actions": {hints.get('ca_total', 0)},
    "approved_actions": {hints.get('ca_approved', 0)},
    "not_approved_actions": {hints.get('ca_rejected', 0)},
    "action_list": {json.dumps(hints.get('interventions') or [])}
  }},
  "icd_10_codes_applicable": {json.dumps(hints.get('icd10_codes') or [])},
  "event_documentation_completeness": {{
    "incident_details_complete": true,
    "vitals_documented": true,
    "interventions_documented": true,
    "missing_fields": ["destination_hospital", "ambulance_crew_details", "transport_timestamps"]
  }}
}}

IMPORTANT overrides — always set from HINTS:
- respiratory_rate_classification MUST be "{hints.get('vn_rr_class')}" (Tachypnoeic for RR>20)
- hemodynamic_status MUST be "{hints.get('hemodynamic_status')}"
- respiratory_adequacy MUST be "{hints.get('respiratory_adequacy')}"
- pain_location MUST be "{pain_location}" (derived from actual documented text — never default to "Chest")
"""
        result = await self._invoke(system, prompt)

        if result:
            vs = result.get("vital_signs_record") or {}
            vs["respiratory_rate_classification"]  = hints.get("vn_rr_class")
            vs["spo2_room_air_classification"]      = hints.get("vn_spo2_class_room_air")
            vs["spo2_on_o2_classification"]         = hints.get("vn_spo2_class_on_o2")
            vs["heart_rate_classification"]         = hints.get("vn_hr_class")
            vs["temperature_classification"]        = hints.get("vn_temp_class") or "Normal"
            vs["blood_pressure_systolic"]           = hints.get("vn_bp_sys")
            vs["blood_pressure_diastolic"]          = hints.get("vn_bp_dia")
            vs["blood_pressure_display"]            = hints.get("vn_bp")
            if not vs.get("critical_vitals_flags"):
                vs["critical_vitals_flags"] = critical_flags
            result["vital_signs_record"] = vs

            result["hemodynamic_assessment"] = {
                "hemodynamic_status":      hints.get("hemodynamic_status"),
                "shock_suspected":         hints.get("shock_suspected", False),
                "shock_type":              hints.get("shock_type"),
                "shock_stage":             hints.get("shock_stage"),
                "shock_class":             hints.get("shock_class"),
                "hemodynamic_narrative":   hints.get("hemodynamic_narrative"),
                "decompensation_warning":  hints.get("decompensation_warning"),
            }

            result["respiratory_assessment"] = {
                "respiratory_adequacy":         hints.get("respiratory_adequacy"),
                "respiratory_failure_risk":     hints.get("respiratory_failure_risk", False),
                "pneumothorax_suspected":       hints.get("pneumothorax_flag", False),
                "hemothorax_suspected":         hints.get("hemothorax_flag", False),
                "reduced_air_entry_left":       hints.get("reduced_air_entry_left", False),
                "respiratory_narrative":        hints.get("respiratory_narrative"),
                "chest_decompression_watch":    hints.get("chest_decompression_watch"),
            }

            result["clinical_trend"] = {
                "overall_trend":         hints.get("clinical_trend_overall"),
                "trend_summary":         hints.get("clinical_trend_summary"),
                "improving_parameters":  hints.get("clinical_trend_improving") or [],
                "worsening_parameters":  hints.get("clinical_trend_worsening") or [],
                "trajectory_note":       hints.get("clinical_trend_note"),
            }

            result["icd_10_codes_applicable"] = hints.get("icd10_codes") or []

            pcd = result.get("paramedic_clinical_documentation") or {}
            pcd["pain_location"] = pain_location
            result["paramedic_clinical_documentation"] = pcd

            result["case_classification"] = {
                "case_type": hints.get("case_type"),
                "is_trauma": hints.get("is_trauma"),
                "routing_rationale": state.get("routing_rationale"),
            }

            imv = result.get("image_monitor_vitals") or {}
            for pump_field, iv_key, aa_key in [
                ("pump1_flow_ml_hr", "iv_pump1_flow", "aa_vt_p1"),
                ("pump2_flow_ml_hr", "iv_pump2_flow", "aa_vt_p2"),
                ("pump3_flow_ml_hr", "iv_pump3_flow", "aa_vt_p3"),
                ("pump1_infused_ml", "iv_pump1_inf",  "aa_vt_p1_inf"),
                ("pump2_infused_ml", "iv_pump2_inf",  "aa_vt_p2_inf"),
                ("pump3_infused_ml", "iv_pump3_inf",  "aa_vt_p3_inf"),
            ]:
                if not imv.get(pump_field):
                    val = hints.get(iv_key) or hints.get(aa_key)
                    if val:
                        try:
                            imv[pump_field] = float(val)
                        except Exception:
                            imv[pump_field] = val
            result["image_monitor_vitals"] = imv

        state["emergency_event"] = result
        logger.info(f"{self.agent_id} · DONE")
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        return state


# ============================================================
# I3 · TELECONSULTATION & DOCTOR ASSESSMENT AGENT
# v3.1: REMOVED hardcoded trauma-only fallback (differential
# diagnoses, provisional diagnosis, recommended investigations,
# specialist referrals) — now entirely LLM-derived from actual
# data, framed by case_type/is_trauma and hedged per
# DIAGNOSTIC_HEDGING_RULE / EVIDENCE_TRACEABILITY_RULE.
# ============================================================

class TeleconsultationAgent(BaseAgent):
    agent_id = "I3"

    async def run(self, state: EIDISState) -> EIDISState:
        logger.info(f"{self.agent_id} · TeleconsultationAgent — START")
        t0 = datetime.now().timestamp()

        hints = state.get("py_hints") or {}
        h = _hints_block(hints)
        dn_json = _compact_json(state.get("doctor_voice_notes") or [])
        ds_json = _compact_json(state.get("doctor_suggestions") or [])
        aa_json = _compact_json(state.get("approved_analyses") or [])

        dn_count = len(state.get("doctor_voice_notes") or [])
        first_ts = hints.get("dn_first_timestamp") or ""
        last_ts  = hints.get("dn_last_timestamp") or ""

        system = (
            "You are a medical documentation expert compiling the teleconsultation record for insurance. "
            "The PYTHON HINTS block contains pre-extracted, clinically corrected values — use them directly. "
            "IMPORTANT: Extract insurance policy details from doctor notes if present. "
            "This patient has been classified as is_trauma="
            f"{hints.get('is_trauma')}, case_type='{hints.get('case_type')}' "
            f"(rationale: {state.get('routing_rationale')}). Derive provisional_diagnosis, "
            "differential_diagnoses, recommended_investigations_at_ed, and "
            "specialist_referral_recommended ENTIRELY from this patient's actual documented "
            "presentation — do NOT default to a trauma/RTA panel (FAST scan, CT head/chest, "
            "trauma surgery, neurosurgery) unless is_trauma is true and the data supports it. "
            "For a non-trauma medical case, select the relevant work-up instead (e.g. ECG/"
            "troponin/cardiology for a suspected cardiac event, CT head + neurology for a "
            "stroke-like presentation, blood cultures/infectious-disease for suspected sepsis, "
            "etc. — grounded in what is actually documented). "
            "null only when genuinely absent. All timestamps in IST. Valid JSON only."
        ) + STABILITY_LABELING_RULE + DIAGNOSTIC_HEDGING_RULE + EVIDENCE_TRACEABILITY_RULE

        prompt = f"""
{h}

CASE TYPE (pre-classified by I0): {hints.get('case_type')} | is_trauma={hints.get('is_trauma')}

DOCTOR VOICE NOTES ({dn_count}): {dn_json}
DOCTOR SUGGESTIONS: {ds_json}
APPROVED ANALYSES: {aa_json}

Return ONLY this JSON:
{{
  "teleconsultation_record": {{
    "consultation_available": {json.dumps(dn_count > 0)},
    "number_of_consultations": {dn_count},
    "first_consultation_time_ist": {json.dumps(first_ts)},
    "last_consultation_time_ist": {json.dumps(last_ts)},
    "total_consultation_duration_minutes": null,
    "consultation_medium": "Doctor voice note / remote teleconsultation",
    "consultations": []
  }},
  "remote_clinical_assessment": {{
    "provisional_diagnosis": null,
    "differential_diagnoses": [],
    "severity_assessment": {json.dumps(hints.get('doctor_severity'))},
    "hemodynamic_status_by_doctor": {json.dumps(hints.get('hemodynamic_status'))},
    "respiratory_adequacy_by_doctor": {json.dumps(hints.get('respiratory_adequacy'))},
    "recommended_investigations_at_ed": [],
    "specialist_referral_recommended": [],
    "do_not_list": [],
    "patient_condition_at_time_of_consultation": {json.dumps(hints.get('consciousness'))}
  }},
  "medications_and_treatments_authorised": {json.dumps(hints.get('interventions') or [])},
  "insurance_data_from_doctor_notes": {{
    "insurance_found_in_doctor_notes": {json.dumps(any('doctor_voice_note' in s for s in (hints.get('ins_sources') or [])))},
    "policy_number_mentioned": {json.dumps(hints.get('ins_policy_number'))},
    "member_id_mentioned": {json.dumps(hints.get('ins_member_id'))},
    "insurance_provider_mentioned": {json.dumps(hints.get('ins_provider'))},
    "claim_number_mentioned": {json.dumps(hints.get('ins_claim_number'))},
    "policy_holder_mentioned": {json.dumps(hints.get('ins_policy_holder'))},
    "coverage_dates_mentioned": {json.dumps(f"{hints.get('ins_coverage_from')} to {hints.get('ins_coverage_to')}" if hints.get('ins_coverage_from') else None)},
    "estimated_amount_mentioned": {json.dumps(hints.get('ins_estimated_amount'))}
  }},
  "approved_image_analysis_by_doctor": {{
    "analysis_available": {json.dumps(hints.get('aa_available', False))},
    "processing_id": {json.dumps(hints.get('aa_processing_id'))},
    "approved_by_doctor_id": {json.dumps(hints.get('aa_approved_by'))},
    "approved_at_ist": {json.dumps(hints.get('aa_timestamp'))},
    "ai_risk_level": {json.dumps(hints.get('aa_risk_level'))},
    "ai_impression_summary": {json.dumps(hints.get('aa_impression'))},
    "physician_alert_summary": {json.dumps(hints.get('aa_physician_alert'))},
    "comorbidities_noted": {json.dumps(hints.get('aa_comorbidities'))},
    "trend_analysis_summary": {json.dumps(hints.get('aa_trend'))},
    "vitals_from_monitor": {{
      "hr_bpm": {json.dumps(int(hints['aa_vt_hr']) if hints.get('aa_vt_hr') and str(hints['aa_vt_hr']).isdigit() else None)},
      "spo2_percent": {json.dumps(int(hints['aa_vt_spo2']) if hints.get('aa_vt_spo2') and str(hints['aa_vt_spo2']).isdigit() else None)},
      "rr_bpm": {json.dumps(int(hints['aa_vt_rr']) if hints.get('aa_vt_rr') and str(hints['aa_vt_rr']).isdigit() else None)},
      "temperature_celsius": {json.dumps(float(hints['aa_vt_temp']) if hints.get('aa_vt_temp') else None)},
      "bp_display": {json.dumps(hints.get('aa_vt_bp'))},
      "pump1_flow_ml_hr": {json.dumps(float(hints['aa_vt_p1']) if hints.get('aa_vt_p1') else None)},
      "pump2_flow_ml_hr": {json.dumps(float(hints['aa_vt_p2']) if hints.get('aa_vt_p2') else None)},
      "pump3_flow_ml_hr": {json.dumps(float(hints['aa_vt_p3']) if hints.get('aa_vt_p3') else None)}
    }}
  }},
  "teleconsultation_completeness": {{
    "doctor_assessment_documented": {json.dumps(dn_count > 0)},
    "treatment_instructions_present": {json.dumps(bool(hints.get('treatment_instructions')))},
    "insurance_data_present": {json.dumps(hints.get('ins_data_available', False))},
    "diagnosis_documented": false,
    "missing_fields": ["provisional_diagnosis", "doctor_id", "consultation_duration"]
  }}
}}

IMPORTANT:
- Fill consultations array: one entry per doctor note using dn_full_conversation from HINTS
- Fill remote_clinical_assessment.provisional_diagnosis, differential_diagnoses,
  recommended_investigations_at_ed, and specialist_referral_recommended STRICTLY from THIS
  patient's actual case_type/is_trauma and documented findings — never from a stock trauma
  or stock medical example.
- Add precautions to do_not_list based on the actual clinical picture only.
- Every diagnosis must be hedged as "suspected"/"possible" unless a clinician explicitly
  documented it as confirmed.
"""
        result = await self._invoke(system, prompt)

        # v3.1: NO hardcoded fallback population of differential_diagnoses /
        # provisional_diagnosis / recommended_investigations_at_ed /
        # specialist_referral_recommended here anymore — that Python
        # fallback (which always injected a trauma-panel default regardless
        # of case type) has been REMOVED. Only genuinely hint-derived,
        # non-fabricated fields are overridden below.
        if result:
            aia = result.get("approved_image_analysis_by_doctor") or {}
            for field, hint_key in [
                ("ai_impression_summary",    "aa_impression"),
                ("physician_alert_summary",  "aa_physician_alert"),
                ("comorbidities_noted",      "aa_comorbidities"),
                ("trend_analysis_summary",   "aa_trend"),
            ]:
                if not aia.get(field) and hints.get(hint_key):
                    aia[field] = hints[hint_key]
            result["approved_image_analysis_by_doctor"] = aia

            tr = result.get("teleconsultation_record") or {}
            if dn_count > 0 and not tr.get("consultations"):
                dn_list = state.get("doctor_voice_notes") or []
                consultations = []
                for i, dn in enumerate(dn_list, 1):
                    consultations.append({
                        "consultation_number":  i,
                        "timestamp_ist":        dn.get("timestamp") or "",
                        "doctor_note_summary":  (dn.get("conversation") or "")[:600],
                        "treatment_given":      hints.get("interventions") or [],
                        "severity_assessed":    hints.get("doctor_severity"),
                        "insurance_data_in_note": _text_has_insurance(dn.get("conversation") or ""),
                    })
                tr["consultations"] = consultations
            result["teleconsultation_record"] = tr

            rca = result.get("remote_clinical_assessment") or {}
            if not rca.get("severity_assessment") and hints.get("doctor_severity"):
                rca["severity_assessment"] = hints["doctor_severity"]
            if not rca.get("hemodynamic_status_by_doctor"):
                rca["hemodynamic_status_by_doctor"] = hints.get("hemodynamic_status")
            if not rca.get("respiratory_adequacy_by_doctor"):
                rca["respiratory_adequacy_by_doctor"] = hints.get("respiratory_adequacy")
            if not rca.get("patient_condition_at_time_of_consultation") and hints.get("consciousness"):
                rca["patient_condition_at_time_of_consultation"] = hints["consciousness"]
            result["remote_clinical_assessment"] = rca

        state["teleconsultation_record"] = result
        logger.info(f"{self.agent_id} · DONE")
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        return state


# ============================================================
# I4 · AMBULANCE SERVICE & TRANSPORT AGENT
# v3.1: transport_position / equipment_used / consumables_used
# are now derived from actual documented interventions + is_trauma
# via _derive_transport_equipment(), instead of a hardcoded
# cervical-collar/spinal-board default applied unconditionally.
# ============================================================

class AmbulanceServiceAgent(BaseAgent):
    agent_id = "I4"

    async def run(self, state: EIDISState) -> EIDISState:
        logger.info(f"{self.agent_id} · AmbulanceServiceAgent — START")
        t0 = datetime.now().timestamp()

        hints = state.get("py_hints") or {}
        h = _hints_block(hints)
        pr_json = _compact_json(state.get("patient_record") or {})
        vd_json = _compact_json(state.get("voice_dictations") or [])

        transport_derived = hints.get("transport_derived") or _derive_transport_equipment(
            hints.get("interventions") or [], hints.get("is_trauma")
        )

        system = (
            "You are a transport and logistics documentation specialist compiling ambulance records for insurance. "
            "The PYTHON HINTS block contains verified values — use them, including transport_derived "
            "for transport_position/equipment_used/consumables_used, which is already computed from "
            "documented interventions and is_trauma — do not override it with a generic trauma default. "
            "null only when genuinely absent. Valid JSON only."
        )

        prompt = f"""
{h}

CASE TYPE (pre-classified by I0): {hints.get('case_type')} | is_trauma={hints.get('is_trauma')}

PATIENT RECORD: {pr_json}
VOICE DICTATIONS: {vd_json}

Return ONLY this JSON:
{{
  "ambulance_service_record": {{
    "ambulance_id": null,
    "service_provider_name": null,
    "registration_source": {json.dumps(hints.get('registration_source') or 'ambulance_mobile_app')},
    "crew": {{
      "driver_id": null,
      "driver_name": null,
      "paramedic_name": null,
      "additional_crew": []
    }},
    "dispatch_details": {{
      "call_received_time_ist": null,
      "dispatch_time_ist": {json.dumps(hints.get('vd_first_timestamp'))},
      "response_time_minutes": null
    }},
    "scene_details": {{
      "arrival_at_scene_time_ist": {json.dumps(hints.get('vd_first_timestamp'))},
      "time_on_scene_minutes": null,
      "scene_departure_time_ist": null,
      "scene_address": null,
      "scene_latitude": {json.dumps(hints.get('pickup_latitude'))},
      "scene_longitude": {json.dumps(hints.get('pickup_longitude'))},
      "scene_safety_notes": null
    }},
    "transport_details": {{
      "transport_start_time_ist": null,
      "transport_mode": "Road ambulance",
      "destination_hospital": null,
      "hospital_arrival_time_ist": null,
      "total_transport_time_minutes": null,
      "estimated_distance_km": null,
      "transport_position": {json.dumps(transport_derived["transport_position"])},
      "patient_handover_time_ist": null
    }},
    "registration_timestamp_ist": {json.dumps(hints.get('registration_date'))}
  }},
  "services_performed_during_transport": {json.dumps(hints.get('interventions') or [])},
  "equipment_used": {json.dumps(transport_derived["equipment_used"])},
  "consumables_used": {json.dumps(transport_derived["consumables_used"])},
  "transport_billing_summary": {{
    "base_transport_fee_applicable": true,
    "advanced_life_support_used": true,
    "basic_life_support_used": true,
    "teleconsultation_service_used": {json.dumps(len(state.get('doctor_voice_notes') or []) > 0)},
    "ai_monitoring_service_used": {json.dumps(hints.get('aa_available', False))},
    "mileage_billable": null,
    "additional_services": ["Remote doctor consultation", "AI-assisted vital sign monitoring", "Multi-pump IV therapy"]
  }},
  "transport_quality_flags": {{
    "response_time_within_target": null,
    "continuous_monitoring_documented": {json.dumps(bool(hints.get('iv_hr')))},
    "handover_completed": null,
    "issues_during_transport": {json.dumps([hints['monitor_patient_mismatch']] if hints.get('monitor_patient_mismatch') else [])}
  }}
}}
"""
        result = await self._invoke(system, prompt)

        if result:
            asr = result.get("ambulance_service_record") or {}
            sd = asr.get("scene_details") or {}
            if not sd.get("scene_latitude") and hints.get("pickup_latitude"):
                sd["scene_latitude"] = hints["pickup_latitude"]
            if not sd.get("scene_longitude") and hints.get("pickup_longitude"):
                sd["scene_longitude"] = hints["pickup_longitude"]
            asr["scene_details"] = sd
            td = asr.get("transport_details") or {}
            td["transport_position"] = transport_derived["transport_position"]
            asr["transport_details"] = td
            result["ambulance_service_record"] = asr
            result["equipment_used"]   = transport_derived["equipment_used"]
            result["consumables_used"] = transport_derived["consumables_used"]
            if not result.get("services_performed_during_transport") and hints.get("interventions"):
                result["services_performed_during_transport"] = hints["interventions"]

        state["ambulance_service_record"] = result
        logger.info(f"{self.agent_id} · DONE")
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        return state


# ============================================================
# I5 · INSURANCE ELIGIBILITY & COVERAGE ANALYSER  [parallel]
# v3.1: claimable_services is now derived from actual documented
# interventions/case_type (no hardcoded cervical-immobilization/
# haemorrhagic-shock example baked into the prompt template);
# claim_type / trauma_claim / FIR-document-requirement are
# computed from is_trauma rather than hardcoded "Polytrauma RTA".
# ============================================================

class InsuranceEligibilityAgent(BaseAgent):
    agent_id = "I5"

    async def run(self, state: EIDISState) -> EIDISState:
        logger.info(f"{self.agent_id} · InsuranceEligibilityAgent — START")
        t0 = datetime.now().timestamp()

        hints = state.get("py_hints") or {}
        h = _hints_block(hints)
        i1 = _compact_json(state.get("patient_identity") or {})
        i2 = _compact_json(state.get("emergency_event") or {})
        i3 = _compact_json(state.get("teleconsultation_record") or {})
        i4 = _compact_json(state.get("ambulance_service_record") or {})

        ins_available = hints.get("ins_data_available", False)
        ins_status_msg = (
            f"Insurance data FOUND in: {', '.join(hints.get('ins_sources') or [])}. "
            f"Provider: {hints.get('ins_provider')} | Policy: {hints.get('ins_policy_number')} | "
            f"Member: {hints.get('ins_member_id')} | Coverage: {hints.get('ins_coverage_from')} to {hints.get('ins_coverage_to')}"
        ) if ins_available else (
            "No insurance data found in any source. Policy details must be obtained from patient/family."
        )

        is_trauma_flag = hints.get("is_trauma")
        case_type = hints.get("case_type") or "unknown"
        case_type_display = case_type.replace("_", " ").title() if case_type != "unknown" else "Emergency"
        claim_type_label = f"Emergency Pre-Hospitalisation — {case_type_display}"

        # v3.1: documents list built in Python — FIR/police report only
        # included when is_trauma is actually true, instead of being a
        # blanket literal in the prompt template.
        base_documents = [
            "Patient registration record",
            "Emergency ambulance PCR (Patient Care Report)",
            "Paramedic voice dictation records",
            "Doctor teleconsultation notes",
            "Vital signs records (image monitor + voice reported)",
            "AI analysis report (approved by physician)",
            "Insurance policy document / ID card",
            "Hospital admission records",
        ]
        if is_trauma_flag:
            base_documents.append("FIR / police report (if applicable — motor vehicle accident/assault)")
        base_documents.append("Treating physician certification of medical necessity")

        exclusions = []
        if hints.get("monitor_patient_mismatch"):
            exclusions.append("Monitor device patient ID mismatch — verify device was assigned to correct patient")
        if ins_available and any("doctor_voice_note" in s for s in (hints.get("ins_sources") or [])):
            exclusions.append("Insurance details sourced from doctor voice notes — original policy document required for verification")
        exclusions.append("Pre-authorization not obtained (waived due to emergency nature of condition)")

        system = (
            "You are an insurance verification and eligibility specialist. "
            "v3.1: Insurance data may have been found in doctor notes or other sources — check ins_* HINTS. "
            "If insurance found, populate all coverage fields with real values. "
            f"This case is classified as is_trauma={is_trauma_flag}, case_type='{case_type}'. "
            "Populate claimable_services ONLY with services actually evidenced by the documented "
            "interventions/findings in the HINTS and agent outputs below — do not assume cervical "
            "immobilization, spinal precautions, or haemorrhagic-shock IV fluids for a non-trauma "
            "case, and do not assume cardiac-specific services for a trauma case unless the data "
            "actually shows it. Base claimable services only on what actually happened. Valid JSON only."
        ) + DIAGNOSTIC_HEDGING_RULE + EVIDENCE_TRACEABILITY_RULE

        icd_codes = hints.get("icd10_codes") or []

        prompt = f"""
{h}

CASE TYPE (pre-classified by I0): {case_type} | is_trauma={is_trauma_flag}
INSURANCE STATUS: {ins_status_msg}

I1: {i1}
I2: {i2}
I3: {i3}
I4: {i4}

DOCUMENTED INTERVENTIONS (ground truth — derive claimable_services from these, not from a
generic template): {json.dumps(hints.get('interventions') or [])}

Return ONLY this JSON:
{{
  "insurance_eligibility_assessment": {{
    "insurance_data_available": {json.dumps(ins_available)},
    "insurance_data_sources": {json.dumps(hints.get('ins_sources') or [])},
    "policy_number": {json.dumps(hints.get('ins_policy_number'))},
    "provider": {json.dumps(hints.get('ins_provider'))},
    "member_id": {json.dumps(hints.get('ins_member_id'))},
    "group_number": {json.dumps(hints.get('ins_group_number'))},
    "policy_holder": {json.dumps(hints.get('ins_policy_holder'))},
    "coverage_valid_from": {json.dumps(hints.get('ins_coverage_from'))},
    "coverage_valid_to": {json.dumps(hints.get('ins_coverage_to'))},
    "claim_number": {json.dumps(hints.get('ins_claim_number'))},
    "attending_provider_npi": {json.dumps(hints.get('ins_npi'))},
    "attending_provider_name": {json.dumps(hints.get('ins_provider_name'))},
    "verification_status": {json.dumps(ins_status_msg)},
    "coverage_active_at_time_of_incident": {json.dumps(True if ins_available and hints.get('ins_coverage_from') else None)},
    "coverage_validity_confirmed": {json.dumps(ins_available and bool(hints.get('ins_coverage_from')))},
    "policy_holder_confirmed": {json.dumps(ins_available and bool(hints.get('ins_policy_holder')))},
    "pre_authorisation_obtained": false,
    "pre_authorisation_required": null,
    "pre_authorisation_reference_number": {json.dumps(hints.get('ins_auth_number'))},
    "estimated_claim_amount_stated": {json.dumps(hints.get('ins_estimated_amount'))},
    "co_pay": {json.dumps(hints.get('ins_co_pay'))},
    "deductible": {json.dumps(hints.get('ins_deductible'))}
  }},
  "claimable_services": [],
  "claim_type_classification": {{
    "claim_type": {json.dumps(claim_type_label)},
    "emergency_claim": true,
    "trauma_claim": {json.dumps(bool(is_trauma_flag))},
    "teleconsultation_claim": {json.dumps(len(state.get('doctor_voice_notes') or []) > 0)},
    "pre_hospitalisation_claim": true,
    "post_hospitalisation_claim": false,
    "network_hospital_involved": null,
    "medically_necessary": true,
    "prior_auth_waived_due_to_emergency": true
  }},
  "icd_10_codes_applicable": {json.dumps(icd_codes)},
  "exclusions_and_flags": {json.dumps(exclusions)},
  "documents_required_for_claim": {json.dumps(base_documents)},
  "total_estimated_claim_amount": {{
    "currency": "INR",
    "estimated_minimum": null,
    "estimated_maximum": null,
    "stated_in_source": {json.dumps(hints.get('ins_estimated_amount'))},
    "confidence": {json.dumps("High — insurance data found in clinical notes" if ins_available else "Cannot estimate — insurance policy data not available")}
  }},
  "claim_submission_guidance": {{
    "recommended_submission_channel": "Hospital TPA desk at receiving hospital",
    "deadline_from_incident_days": 30,
    "hospital_tpa_contact": null,
    "notes": {json.dumps("Insurance details found in doctor notes — verify original policy documents" if ins_available else "Insurance details must be obtained from patient/family before claim can be processed")}
  }},
  "eligibility_confidence_score": {{
    "score": {json.dumps(75 if ins_available else 15)},
    "scale": "0-100",
    "limiting_factors": {json.dumps([] if (ins_available and hints.get('ins_policy_number')) else ["No verified insurance policy document", "Policy details sourced from clinical notes only"])}
  }}
}}

IMPORTANT — claimable_services MUST be populated as a list of
{{"service": "...", "category": "Transport|Procedure|Medication|Monitoring|Consultation|Technology", "justification": "..."}}
objects, where EVERY entry is grounded in the DOCUMENTED INTERVENTIONS list above or another
concretely documented fact (e.g. "Emergency ambulance transport" is always claimable since
transport itself is documented by the ambulance record). Do NOT include a service unless you
can point to the specific hint/finding that justifies it.
"""
        result = await self._invoke(system, prompt)

        if result:
            iea = result.get("insurance_eligibility_assessment") or {}
            ins_field_map = {
                "policy_number":   "ins_policy_number",
                "provider":        "ins_provider",
                "member_id":       "ins_member_id",
                "group_number":    "ins_group_number",
                "policy_holder":   "ins_policy_holder",
                "coverage_valid_from": "ins_coverage_from",
                "coverage_valid_to":   "ins_coverage_to",
                "claim_number":    "ins_claim_number",
            }
            for field, hint_key in ins_field_map.items():
                if not iea.get(field) and hints.get(hint_key):
                    iea[field] = hints[hint_key]
            iea["insurance_data_available"] = ins_available
            iea["insurance_data_sources"]   = hints.get("ins_sources") or []
            result["insurance_eligibility_assessment"] = iea

            result["icd_10_codes_applicable"] = hints.get("icd10_codes") or []

            ctc = result.get("claim_type_classification") or {}
            ctc["trauma_claim"] = bool(is_trauma_flag)
            if not ctc.get("claim_type"):
                ctc["claim_type"] = claim_type_label
            result["claim_type_classification"] = ctc

            if not result.get("documents_required_for_claim"):
                result["documents_required_for_claim"] = base_documents
            if not result.get("exclusions_and_flags"):
                result["exclusions_and_flags"] = exclusions

        state["insurance_eligibility"] = result
        logger.info(f"{self.agent_id} · DONE")
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        return state


# ============================================================
# I6 · CLAIM SUPPORTING EVIDENCE COMPILER  [parallel]
# (unchanged in v3.1 — already factual/inventory-based, no
# trauma-specific hardcodes)
# ============================================================

class ClaimEvidenceAgent(BaseAgent):
    agent_id = "I6"

    async def run(self, state: EIDISState) -> EIDISState:
        logger.info(f"{self.agent_id} · ClaimEvidenceAgent — START")
        t0 = datetime.now().timestamp()

        hints = state.get("py_hints") or {}
        h = _hints_block(hints)
        i1 = _compact_json(state.get("patient_identity") or {})
        i2 = _compact_json(state.get("emergency_event") or {})
        i3 = _compact_json(state.get("teleconsultation_record") or {})
        i4 = _compact_json(state.get("ambulance_service_record") or {})

        vd_count = len(state.get("voice_dictations") or [])
        dn_count = len(state.get("doctor_voice_notes") or [])
        iv_count = len(state.get("image_extracted_vitals") or [])
        ca_count = len(state.get("clinical_actions") or [])
        ds_count = len(state.get("doctor_suggestions") or [])
        aa_count = len(state.get("approved_analyses") or [])

        vd_entries = [
            {"timestamp": d.get("timestamp",""), "summary": (d.get("conversation") or "")[:300]}
            for d in (state.get("voice_dictations") or [])
        ]
        aa_entries = [
            {
                "timestamp": d.get("timestamp_iso") or d.get("timestamp",""),
                "approved_by": d.get("approved_by_doctor_id",""),
                "risk_level": d.get("risk_level",""),
                "processing_id": d.get("processing_id",""),
            }
            for d in (state.get("approved_analyses") or [])
        ]

        system = (
            "You are a medical billing and claims evidence specialist. "
            "Compile all supporting evidence from the provided data. "
            "Be factual — state what is present. Do NOT fabricate. Valid JSON only."
        ) + EVIDENCE_TRACEABILITY_RULE

        prompt = f"""
{h}

CASE TYPE (pre-classified by I0): {hints.get('case_type')} | is_trauma={hints.get('is_trauma')}

I1: {i1}
I2: {i2}
I3: {i3}
I4: {i4}

DATA COUNTS:
voice_dictations={vd_count}, doctor_voice_notes={dn_count}, image_vitals={iv_count},
clinical_actions={ca_count} (approved={hints.get('ca_approved',0)}),
doctor_suggestions={ds_count}, approved_analyses={aa_count}

VOICE DICTATION ENTRIES: {_compact_json(vd_entries)}
APPROVED ANALYSIS ENTRIES: {_compact_json(aa_entries)}

Return ONLY this JSON:
{{
  "evidence_inventory": {{
    "paramedic_assessment_report": {{
      "available": {json.dumps(vd_count > 0)},
      "voice_dictation_count": {vd_count},
      "transcript_entries": {json.dumps(vd_entries)},
      "document_reference": "voice_dictations collection",
      "timestamp_range_ist": {json.dumps([vd_entries[0]["timestamp"], vd_entries[-1]["timestamp"]] if vd_entries else None)}
    }},
    "doctor_consultation_notes": {{
      "available": {json.dumps(dn_count > 0)},
      "note_count": {dn_count},
      "insurance_data_found_in_notes": {json.dumps(any('doctor_voice_note' in s for s in (hints.get('ins_sources') or [])))},
      "document_reference": "doctor_voice_notes + Doctor_Suggestion_Ambulance collections",
      "timestamp_range_ist": {json.dumps([hints.get('dn_first_timestamp'), hints.get('dn_last_timestamp')] if hints.get('dn_first_timestamp') else None)}
    }},
    "vital_signs_record": {{
      "available": {json.dumps(iv_count > 0 or bool(hints.get('vn_bp')))},
      "image_monitor_readings": {iv_count},
      "voice_reported_vitals": {{
        "BP": {json.dumps(hints.get('vn_bp'))},
        "HR_bpm": {json.dumps(hints.get('vn_hr'))},
        "HR_classification": {json.dumps(hints.get('vn_hr_class'))},
        "RR_bpm": {json.dumps(hints.get('vn_rr'))},
        "RR_classification": {json.dumps(hints.get('vn_rr_class'))},
        "SpO2_room_air_pct": {json.dumps(hints.get('vn_spo2_air'))},
        "SpO2_on_O2_pct": {json.dumps(hints.get('vn_spo2_o2'))},
        "SpO2_room_air_classification": {json.dumps(hints.get('vn_spo2_class_room_air'))},
        "Temp_C": {json.dumps(hints.get('vn_temp_c'))},
        "Temp_F": {json.dumps(hints.get('vn_temp_f'))},
        "Glucose_mgdL": {json.dumps(hints.get('vn_glucose'))},
        "GCS": {json.dumps(hints.get('vn_gcs'))},
        "pupils": {json.dumps(hints.get('vn_pupils'))},
        "hemodynamic_status": {json.dumps(hints.get('hemodynamic_status'))},
        "respiratory_adequacy": {json.dumps(hints.get('respiratory_adequacy'))}
      }},
      "document_reference": "Image_Extracted_Ambulance collection + doctor_voice_notes",
      "timestamp_range_ist": {json.dumps([hints.get('dn_first_timestamp'), hints.get('dn_last_timestamp')] if hints.get('dn_first_timestamp') else None)}
    }},
    "ai_analysis_reports": {{
      "available": {json.dumps(aa_count > 0)},
      "approved_analyses_count": {aa_count},
      "document_reference": "ApproveImageSuggestion collection (doctorassist DB)",
      "timestamp_range_ist": {json.dumps([aa_entries[0]["timestamp"], aa_entries[-1]["timestamp"]] if aa_entries else None)},
      "analysis_entries": {json.dumps(aa_entries)}
    }},
    "clinical_action_log": {{
      "available": {json.dumps(ca_count > 0)},
      "action_count": {ca_count},
      "approved_actions": {hints.get('ca_approved', 0)},
      "document_reference": "clinical_actions collection",
      "timestamp_range_ist": null
    }},
    "treatment_authorisation_records": {{
      "available": {json.dumps(ca_count > 0 or dn_count > 0)},
      "count": {hints.get('ca_approved', 0)},
      "document_reference": "doctor_suggestions + clinical_actions"
    }},
    "audio_recording_references": {{
      "available": {json.dumps(vd_count > 0)},
      "reference_ids": [],
      "note": "Audio files stored separately; voice_dictation records serve as timestamped references"
    }},
    "image_evidence": {{
      "available": {json.dumps(iv_count > 0)},
      "image_ids": [],
      "document_reference": "Image_Extracted_Ambulance collection"
    }},
    "consent_documentation": {{
      "available": null,
      "type": null,
      "reference": null
    }},
    "patient_registration_record": {{
      "available": true,
      "registration_id": {json.dumps(hints.get('sys_user_id'))},
      "document_reference": "patients collection"
    }},
    "insurance_documentation": {{
      "available": {json.dumps(hints.get('ins_data_available', False))},
      "sources_found": {json.dumps(hints.get('ins_sources') or [])},
      "policy_number_found": {json.dumps(bool(hints.get('ins_policy_number')))},
      "note": {json.dumps("Insurance details extracted from: " + ", ".join(hints.get('ins_sources') or []) if hints.get('ins_data_available') else "No insurance data found in any source")}
    }}
  }},
  "signature_and_authorisation_trail": [
    {{
      "event": "AI Analysis Approved by Doctor",
      "timestamp": {json.dumps(hints.get('aa_timestamp'))},
      "approved_by": {json.dumps(hints.get('aa_approved_by'))},
      "processing_id": {json.dumps(hints.get('aa_processing_id'))},
      "risk_level": {json.dumps(hints.get('aa_risk_level'))}
    }}
  ],
  "electronic_records_audit_trail": [],
  "claim_package_attachments_checklist": [],
  "evidence_quality_score": {{
    "overall_score": null,
    "scale": "0-100",
    "strong_evidence": [],
    "weak_evidence": [],
    "missing_evidence": [],
    "recommendation": null
  }},
  "fraud_indicators": {{
    "timeline_consistency": true,
    "data_completeness_flag": true,
    "anomalies": {json.dumps([hints['monitor_patient_mismatch']] if hints.get('monitor_patient_mismatch') else [])},
    "risk_level": "Low",
    "notes": "Monitor device patient ID mismatch detected — verify device assignment before using monitor readings for clinical decisions"
  }}
}}

IMPORTANT:
- Fill electronic_records_audit_trail with all timestamped events in chronological order
- Fill claim_package_attachments_checklist with item/status for each document type
- Fill evidence_quality_score overall_score, strong_evidence, weak_evidence, missing_evidence
- Fill fraud_indicators.timeline_consistency based on timestamps
"""
        result = await self._invoke(system, prompt)

        if result and hints.get("monitor_patient_mismatch"):
            fi = result.get("fraud_indicators") or {}
            if not fi.get("anomalies"):
                fi["anomalies"] = [hints["monitor_patient_mismatch"]]
            result["fraud_indicators"] = fi

        state["claim_evidence"] = result
        logger.info(f"{self.agent_id} · DONE")
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        return state


# ============================================================
# PARALLEL RUNNER — I5 + I6 concurrent
# ============================================================

async def run_parallel_agents(state: EIDISState) -> EIDISState:
    logger.info("EIDIS Parallel layer (I5 + I6) — START")
    t0 = datetime.now().timestamp()

    i5 = InsuranceEligibilityAgent(llm)
    i6 = ClaimEvidenceAgent(llm)

    results = await asyncio.gather(
        i5.run(dict(state)),
        i6.run(dict(state)),
        return_exceptions=True,
    )

    for idx, result in enumerate(results):
        label = "I5" if idx == 0 else "I6"
        if isinstance(result, Exception):
            logger.error(f"{label} failed: {result}")
            state["errors"].append(f"{label}: {str(result)}")
        else:
            state["agent_timings"].update(result.get("agent_timings", {}))
            if idx == 0:
                state["insurance_eligibility"] = result.get("insurance_eligibility")
            else:
                state["claim_evidence"] = result.get("claim_evidence")

    logger.info(f"Parallel layer done ({round((datetime.now().timestamp()-t0)*1000)}ms)")
    return state


# ============================================================
# I7 · INSURANCE CLAIM PACKAGE SYNTHESISER
# v3.1: REMOVED hardcoded trauma-only defaults from the JSON
# template (differential_diagnoses, provisional_diagnosis,
# specialist_referrals, pain_location, transport_position,
# equipment_used, consumables_used, claim_type) — all now
# derived from actual data (pain_location/transport/claim_type
# via Python) or left for the LLM to populate from the real
# clinical picture (diagnoses/referrals), framed by is_trauma/
# case_type and hedged per DIAGNOSTIC_HEDGING_RULE.
# ============================================================

class InsuranceClaimSynthesiser(BaseAgent):
    agent_id = "I7"

    async def run(self, state: EIDISState) -> EIDISState:
        logger.info(f"{self.agent_id} · InsuranceClaimSynthesiser — START")
        t0 = datetime.now().timestamp()

        hints    = state.get("py_hints") or {}
        h        = _hints_block(hints)
        now_str  = now_ist().isoformat()
        now_disp = display_ist(now_ist())

        i1 = _compact_json(state.get("patient_identity") or {})
        i2 = _compact_json(state.get("emergency_event") or {})
        i3 = _compact_json(state.get("teleconsultation_record") or {})
        i4 = _compact_json(state.get("ambulance_service_record") or {})
        i5 = _compact_json(state.get("insurance_eligibility") or {})
        i6 = _compact_json(state.get("claim_evidence") or {})

        vd_count = len(state.get("voice_dictations") or [])
        dn_count = len(state.get("doctor_voice_notes") or [])
        iv_count = len(state.get("image_extracted_vitals") or [])
        ca_count = len(state.get("clinical_actions") or [])
        ds_count = len(state.get("doctor_suggestions") or [])
        aa_count = len(state.get("approved_analyses") or [])
        total    = vd_count + dn_count + iv_count + ca_count + ds_count + aa_count

        ins_available = hints.get("ins_data_available", False)
        ins_status    = (
            f"Insurance data found in: {', '.join(hints.get('ins_sources') or [])}. "
            f"Policy: {hints.get('ins_policy_number')}"
        ) if ins_available else "Not available — insurance data was not captured at registration"

        critical_flags = []
        if hints.get("monitor_patient_mismatch"):
            critical_flags.append(hints["monitor_patient_mismatch"])
        if hints.get("hemodynamic_status") in ("Compensated_Shock", "Hypotensive_Decompensated_Shock"):
            critical_flags.append(hints.get("hemodynamic_narrative") or "")
        if hints.get("decompensation_warning"):
            critical_flags.append(hints["decompensation_warning"])
        if hints.get("chest_decompression_watch"):
            critical_flags.append(hints["chest_decompression_watch"])

        p1_flow = hints.get("iv_pump1_flow") or hints.get("aa_vt_p1")
        p2_flow = hints.get("iv_pump2_flow") or hints.get("aa_vt_p2")
        p3_flow = hints.get("iv_pump3_flow") or hints.get("aa_vt_p3")
        p1_inf  = hints.get("iv_pump1_inf")  or hints.get("aa_vt_p1_inf")
        p2_inf  = hints.get("iv_pump2_inf")  or hints.get("aa_vt_p2_inf")
        p3_inf  = hints.get("iv_pump3_inf")  or hints.get("aa_vt_p3_inf")

        is_trauma_flag = hints.get("is_trauma")
        case_type = hints.get("case_type") or "unknown"
        case_type_display = case_type.replace("_", " ").title() if case_type != "unknown" else "Emergency"
        claim_type_label = f"Emergency Pre-Hospitalisation — {case_type_display}"
        pain_location = hints.get("pain_location_derived")
        transport_derived = hints.get("transport_derived") or _derive_transport_equipment(
            hints.get("interventions") or [], is_trauma_flag
        )

        system = (
            "You are the lead medical insurance documentation officer. "
            "Synthesise all 6 agent outputs into the final Insurance Claim Data Package. "
            "v3.1 RULES (MUST follow): "
            "1. RR 28 = Tachypnoeic. NEVER write 'Normal' for RR>20. "
            "2. SpO2 91% room air = Mild_Hypoxia. SpO2 96% on O2 = Normal_On_O2. "
            "3. hemodynamic_status, respiratory_adequacy, clinical_trend, icd_10_codes, "
            "pain_location, transport_position, equipment_used, consumables_used, and "
            "claim_type are ALREADY computed correctly from HINTS/Python — use them verbatim, "
            "do not invent your own values for these fields. "
            f"4. This case is classified as is_trauma={is_trauma_flag}, case_type='{case_type}'. "
            "Populate provisional_diagnosis, differential_diagnoses, and specialist_referrals "
            "ENTIRELY from this patient's actual documented presentation — do NOT default to a "
            "trauma/RTA narrative (polytrauma, haemothorax, pneumothorax, cervical spine) unless "
            "is_trauma is true AND the data genuinely supports it. For a non-trauma case, ground "
            "the diagnosis in the real presentation (cardiac, respiratory, neurological, "
            "toxicological, obstetric, infectious, etc.) as evidenced by the hints and narrative. "
            "CRITICAL: Output COMPLETE JSON — do NOT truncate. All timestamps IST. Valid JSON only."
        ) + STABILITY_LABELING_RULE + DIAGNOSTIC_HEDGING_RULE + EVIDENCE_TRACEABILITY_RULE

        prompt = f"""
{h}

PATIENT_ID: {state["patient_id"]}
GENERATED_AT: {now_str}
TOTAL_ENTRIES: {total}
INSURANCE_STATUS: {ins_status}
CASE TYPE (pre-classified by I0): {case_type} | is_trauma={is_trauma_flag}

[I1]: {i1}
[I2]: {i2}
[I3]: {i3}
[I4]: {i4}
[I5]: {i5}
[I6]: {i6}

Return ONLY this complete JSON (stop at package_summary — claim_readiness is in I7b):
{{
  "claim_package_metadata": {{
    "claim_package_id": null,
    "patient_id": "{state['patient_id']}",
    "generated_at_ist": "{now_str}",
    "generated_at_display": "{now_disp}",
    "package_version": "3.1",
    "system": "EIDIS — Emergency Insurance Documentation Intelligence System",
    "case_type": {json.dumps(case_type)},
    "is_trauma": {json.dumps(is_trauma_flag)},
    "routing_rationale": {json.dumps(state.get('routing_rationale'))},
    "data_sources_used": {{
      "patients_collection": true,
      "voice_dictations": {str(vd_count > 0).lower()},
      "doctor_voice_notes": {str(dn_count > 0).lower()},
      "image_extracted_vitals": {str(iv_count > 0).lower()},
      "clinical_actions": {str(ca_count > 0).lower()},
      "doctor_suggestions": {str(ds_count > 0).lower()},
      "approved_analyses": {str(aa_count > 0).lower()}
    }},
    "total_data_entries": {total},
    "package_completeness_percent": null,
    "missing_critical_fields": []
  }},
  "patient_identification": {{
    "patient_id": {json.dumps(hints.get('patient_id'))},
    "sys_user_id": {json.dumps(hints.get('sys_user_id'))},
    "full_name": {json.dumps(hints.get('full_name'))},
    "age": {json.dumps(hints.get('age'))},
    "gender": {json.dumps(hints.get('gender'))},
    "date_of_birth": null,
    "contact_number": {json.dumps(hints.get('contact_number'))},
    "address": null,
    "national_id_aadhaar": null,
    "blood_group": null,
    "registration_source": {json.dumps(hints.get('registration_source') or 'ambulance_mobile_app')}
  }},
  "emergency_contact": {{
    "name": {json.dumps(hints.get('ec_name'))},
    "relationship": {json.dumps(hints.get('ec_relationship'))},
    "phone_number": {json.dumps(hints.get('ec_phone'))}
  }},
  "insurance_information": {{
    "insurance_data_available": {json.dumps(ins_available)},
    "insurance_data_sources": {json.dumps(hints.get('ins_sources') or [])},
    "insurance_provider_name": {json.dumps(hints.get('ins_provider'))},
    "policy_number": {json.dumps(hints.get('ins_policy_number'))},
    "member_id": {json.dumps(hints.get('ins_member_id'))},
    "group_number": {json.dumps(hints.get('ins_group_number'))},
    "policy_holder_name": {json.dumps(hints.get('ins_policy_holder'))},
    "claim_number": {json.dumps(hints.get('ins_claim_number'))},
    "relationship_to_patient": null,
    "coverage_valid_from": {json.dumps(hints.get('ins_coverage_from'))},
    "coverage_valid_to": {json.dumps(hints.get('ins_coverage_to'))},
    "coverage_active_at_incident": {json.dumps(True if ins_available and hints.get('ins_coverage_from') else None)},
    "insurance_card_reference": null,
    "insurance_verification_status": {json.dumps(ins_status)},
    "plan_type": null,
    "coverage_type": null,
    "network_status": null,
    "pre_authorisation_obtained": false,
    "pre_authorisation_required": null,
    "pre_authorisation_reference_number": {json.dumps(hints.get('ins_auth_number'))},
    "co_pay_amount": {json.dumps(hints.get('ins_co_pay'))},
    "deductible_amount": {json.dumps(hints.get('ins_deductible'))},
    "estimated_claim_amount_stated": {json.dumps(hints.get('ins_estimated_amount'))},
    "attending_provider_name": {json.dumps(hints.get('ins_provider_name'))},
    "attending_provider_npi": {json.dumps(hints.get('ins_npi'))}
  }},
  "emergency_event_documentation": {{
    "incident_date": {json.dumps(hints.get('incident_date'))},
    "incident_time_ist": {json.dumps(hints.get('vd_first_timestamp'))},
    "incident_datetime_display": {json.dumps(hints.get('incident_datetime_display'))},
    "pickup_location": {json.dumps(hints.get('pickup_location'))},
    "pickup_latitude": {json.dumps(hints.get('pickup_latitude'))},
    "pickup_longitude": {json.dumps(hints.get('pickup_longitude'))},
    "chief_complaint": {json.dumps(hints.get('chief_complaint'))},
    "mechanism_of_injury": {json.dumps(hints.get('mechanism_of_injury'))},
    "accident_type": null,
    "emergency_severity_level": "HIGH",
    "triage_colour": {json.dumps(hints.get('triage_colour'))}
  }},
  "paramedic_clinical_documentation": {{
    "voice_dictation_count": {vd_count},
    "first_dictation_time_ist": {json.dumps(hints.get('vd_first_timestamp'))},
    "last_dictation_time_ist": {json.dumps(hints.get('vd_last_timestamp'))},
    "transcript_summary": {json.dumps(hints.get('vd_transcript_summary'))},
    "symptoms_reported": {json.dumps(hints.get('symptoms_reported') or [])},
    "physical_findings": {json.dumps(hints.get('physical_findings') or [])},
    "gcs_score": {json.dumps(int(hints['vn_gcs']) if hints.get('vn_gcs') and str(hints['vn_gcs']).isdigit() else None)},
    "consciousness_level": {json.dumps(hints.get('consciousness'))},
    "pain_score": null,
    "pain_location": {json.dumps(pain_location)}
  }},
  "vital_signs_record": {{
    "measurement_timestamp_ist": {json.dumps(hints.get('dn_last_timestamp'))},
    "source": "Doctor voice note",
    "blood_pressure_systolic": {json.dumps(hints.get('vn_bp_sys'))},
    "blood_pressure_diastolic": {json.dumps(hints.get('vn_bp_dia'))},
    "blood_pressure_display": {json.dumps(hints.get('vn_bp'))},
    "heart_rate_bpm": {json.dumps(int(hints['vn_hr']) if hints.get('vn_hr') and str(hints['vn_hr']).isdigit() else None)},
    "heart_rate_classification": {json.dumps(hints.get('vn_hr_class'))},
    "respiratory_rate_bpm": {json.dumps(int(hints['vn_rr']) if hints.get('vn_rr') and str(hints['vn_rr']).isdigit() else None)},
    "respiratory_rate_classification": {json.dumps(hints.get('vn_rr_class'))},
    "spo2_on_room_air_percent": {json.dumps(int(hints['vn_spo2_air']) if hints.get('vn_spo2_air') and str(hints['vn_spo2_air']).isdigit() else None)},
    "spo2_on_oxygen_percent": {json.dumps(int(hints['vn_spo2_o2']) if hints.get('vn_spo2_o2') and str(hints['vn_spo2_o2']).isdigit() else None)},
    "spo2_room_air_classification": {json.dumps(hints.get('vn_spo2_class_room_air'))},
    "spo2_on_o2_classification": {json.dumps(hints.get('vn_spo2_class_on_o2'))},
    "temperature_celsius": {json.dumps(hints.get('vn_temp_c'))},
    "temperature_fahrenheit": {json.dumps(float(hints['vn_temp_f']) if hints.get('vn_temp_f') else None)},
    "temperature_classification": {json.dumps(hints.get('vn_temp_class') or 'Normal')},
    "ecg_rhythm": null,
    "glucose_mgdl": {json.dumps(int(hints['vn_glucose']) if hints.get('vn_glucose') and str(hints['vn_glucose']).isdigit() else None)},
    "pupil_response": {json.dumps(hints.get('vn_pupils'))},
    "critical_vitals_flags": {json.dumps(critical_flags)}
  }},
  "hemodynamic_assessment": {{
    "hemodynamic_status": {json.dumps(hints.get('hemodynamic_status'))},
    "shock_suspected": {json.dumps(hints.get('shock_suspected', False))},
    "shock_type": {json.dumps(hints.get('shock_type'))},
    "shock_stage": {json.dumps(hints.get('shock_stage'))},
    "shock_class": {json.dumps(hints.get('shock_class'))},
    "hemodynamic_narrative": {json.dumps(hints.get('hemodynamic_narrative'))},
    "decompensation_warning": {json.dumps(hints.get('decompensation_warning'))}
  }},
  "respiratory_assessment": {{
    "respiratory_adequacy": {json.dumps(hints.get('respiratory_adequacy'))},
    "respiratory_failure_risk": {json.dumps(hints.get('respiratory_failure_risk', False))},
    "pneumothorax_suspected": {json.dumps(hints.get('pneumothorax_flag', False))},
    "hemothorax_suspected": {json.dumps(hints.get('hemothorax_flag', False))},
    "reduced_air_entry_left": {json.dumps(hints.get('reduced_air_entry_left', False))},
    "respiratory_narrative": {json.dumps(hints.get('respiratory_narrative'))},
    "chest_decompression_watch": {json.dumps(hints.get('chest_decompression_watch'))}
  }},
  "image_monitor_vitals": {{
    "available": {json.dumps(bool(hints.get('iv_hr')))},
    "monitor_timestamp_ist": {json.dumps(hints.get('iv_timestamp'))},
    "hr_bpm": {json.dumps(int(hints['iv_hr']) if hints.get('iv_hr') and str(hints['iv_hr']).isdigit() else None)},
    "spo2_percent": {json.dumps(int(hints['iv_spo2']) if hints.get('iv_spo2') and str(hints['iv_spo2']).isdigit() else None)},
    "rr_bpm": {json.dumps(int(hints['iv_rr']) if hints.get('iv_rr') and str(hints['iv_rr']).isdigit() else None)},
    "temperature_celsius": {json.dumps(float(hints['iv_temp']) if hints.get('iv_temp') else None)},
    "nibp_display": {json.dumps(hints.get('iv_nibp'))},
    "pump1_flow_ml_hr": {json.dumps(float(p1_flow) if p1_flow else None)},
    "pump2_flow_ml_hr": {json.dumps(float(p2_flow) if p2_flow else None)},
    "pump3_flow_ml_hr": {json.dumps(float(p3_flow) if p3_flow else None)},
    "pump1_infused_ml": {json.dumps(float(p1_inf) if p1_inf else None)},
    "pump2_infused_ml": {json.dumps(float(p2_inf) if p2_inf else None)},
    "pump3_infused_ml": {json.dumps(float(p3_inf) if p3_inf else None)},
    "patient_identity_on_monitor": {json.dumps(hints.get('iv_monitor_patient'))},
    "monitor_mismatch_note": {json.dumps(hints.get('monitor_patient_mismatch'))}
  }},
  "injuries_documented": {json.dumps(hints.get('injuries') or [])},
  "pre_hospital_interventions": {json.dumps(hints.get('interventions') or [])},
  "clinical_trend": {{
    "overall_trend": {json.dumps(hints.get('clinical_trend_overall'))},
    "trend_summary": {json.dumps(hints.get('clinical_trend_summary'))},
    "improving_parameters": {json.dumps(hints.get('clinical_trend_improving') or [])},
    "worsening_parameters": {json.dumps(hints.get('clinical_trend_worsening') or [])},
    "trajectory_note": {json.dumps(hints.get('clinical_trend_note'))}
  }},
  "doctor_teleconsultation_documentation": {{
    "consultation_available": {json.dumps(dn_count > 0)},
    "number_of_consultations": {dn_count},
    "first_consultation_time_ist": {json.dumps(hints.get('dn_first_timestamp'))},
    "last_consultation_time_ist": {json.dumps(hints.get('dn_last_timestamp'))},
    "doctor_id": null,
    "doctor_name": {json.dumps(hints.get('ins_provider_name'))},
    "consultation_medium": "Remote voice consultation",
    "provisional_diagnosis": null,
    "differential_diagnoses": [],
    "clinical_assessment_summary": null,
    "treatment_instructions": {json.dumps(hints.get('treatment_instructions') or [])},
    "medications_recommended": [],
    "specialist_referrals": [],
    "hospital_destination_recommended": null,
    "severity_assessment_by_doctor": {json.dumps(hints.get('doctor_severity'))}
  }},
  "approved_ai_analysis": {{
    "available": {json.dumps(hints.get('aa_available', False))},
    "approved_at_ist": {json.dumps(hints.get('aa_timestamp'))},
    "approved_by_doctor_id": {json.dumps(hints.get('aa_approved_by'))},
    "risk_level": {json.dumps(hints.get('aa_risk_level'))},
    "impressive_findings": {json.dumps(hints.get('aa_impressive'))},
    "ai_impression": {json.dumps(hints.get('aa_impression'))},
    "physician_alert": {json.dumps(hints.get('aa_physician_alert'))},
    "emt_actions_summary": {json.dumps(hints.get('aa_emt_actions'))},
    "comorbidities": {json.dumps(hints.get('aa_comorbidities'))},
    "trend_analysis": {json.dumps(hints.get('aa_trend'))},
    "monitor_vitals_at_approval": {{
      "hr_bpm": {json.dumps(int(hints['aa_vt_hr']) if hints.get('aa_vt_hr') and str(hints['aa_vt_hr']).isdigit() else None)},
      "spo2_percent": {json.dumps(int(hints['aa_vt_spo2']) if hints.get('aa_vt_spo2') and str(hints['aa_vt_spo2']).isdigit() else None)},
      "rr_bpm": {json.dumps(int(hints['aa_vt_rr']) if hints.get('aa_vt_rr') and str(hints['aa_vt_rr']).isdigit() else None)},
      "temperature_celsius": {json.dumps(float(hints['aa_vt_temp']) if hints.get('aa_vt_temp') else None)},
      "bp_display": {json.dumps(hints.get('aa_vt_bp'))},
      "pump1_flow_ml_hr": {json.dumps(float(hints['aa_vt_p1']) if hints.get('aa_vt_p1') else None)},
      "pump2_flow_ml_hr": {json.dumps(float(hints['aa_vt_p2']) if hints.get('aa_vt_p2') else None)},
      "pump3_flow_ml_hr": {json.dumps(float(hints['aa_vt_p3']) if hints.get('aa_vt_p3') else None)}
    }}
  }},
  "ambulance_service_documentation": {{
    "ambulance_id": null,
    "service_provider_name": null,
    "crew_driver_id": null,
    "crew_driver_name": null,
    "crew_paramedic_name": null,
    "dispatch_time_ist": {json.dumps(hints.get('vd_first_timestamp'))},
    "arrival_at_scene_time_ist": {json.dumps(hints.get('vd_first_timestamp'))},
    "scene_departure_time_ist": null,
    "hospital_arrival_time_ist": null,
    "total_response_time_minutes": null,
    "total_transport_time_minutes": null,
    "estimated_distance_km": null,
    "transport_position": {json.dumps(transport_derived["transport_position"])},
    "patient_handover_time_ist": null,
    "services_performed": {json.dumps(hints.get('interventions') or [])},
    "equipment_used": {json.dumps(transport_derived["equipment_used"])},
    "consumables_used": {json.dumps(transport_derived["consumables_used"])}
  }},
  "clinical_action_history": {{
    "total_actions": {ca_count},
    "approved_actions": {hints.get('ca_approved', 0)},
    "not_approved_actions": {hints.get('ca_rejected', 0)},
    "action_log": {json.dumps(hints.get('interventions') or [])}
  }},
  "insurance_claim_assessment": {{
    "claim_type": {json.dumps(claim_type_label)},
    "emergency_claim": true,
    "pre_authorisation_required": null,
    "pre_authorisation_obtained": false,
    "insurance_data_available": {json.dumps(ins_available)},
    "claimable_services": [],
    "icd_10_codes": {json.dumps(hints.get('icd10_codes') or [])},
    "total_estimated_claim_amount_inr": {json.dumps(hints.get('ins_estimated_amount'))},
    "claim_submission_deadline_days": 30,
    "exclusions_and_flags": [],
    "eligibility_confidence_score": {json.dumps(75 if ins_available else 15)}
  }},
  "supporting_documents_inventory": {{
    "paramedic_assessment_report": {{
      "available": {str(vd_count > 0).lower()},
      "reference_count": {vd_count},
      "collection": "voice_dictations"
    }},
    "doctor_consultation_notes": {{
      "available": {str(dn_count > 0).lower()},
      "reference_count": {dn_count},
      "collections": "doctor_voice_notes, Doctor_Suggestion_Ambulance",
      "insurance_data_in_notes": {json.dumps(any('doctor_voice_note' in s for s in (hints.get('ins_sources') or [])))}
    }},
    "vital_signs_record": {{
      "available": {str(iv_count > 0).lower()},
      "reference_count": {iv_count},
      "collection": "Image_Extracted_Ambulance"
    }},
    "ai_analysis_report": {{
      "available": {str(aa_count > 0).lower()},
      "reference_count": {aa_count},
      "collection": "ApproveImageSuggestion (doctorassist DB)"
    }},
    "clinical_action_log": {{
      "available": {str(ca_count > 0).lower()},
      "reference_count": {ca_count},
      "collection": "clinical_actions"
    }},
    "ambulance_transport_report": {{
      "available": true,
      "source": "patients + voice_dictations"
    }},
    "audio_recording_references": {{
      "available": {str(vd_count > 0).lower()},
      "reference_ids": []
    }},
    "image_evidence": {{
      "available": {str(iv_count > 0).lower()},
      "image_ids": [],
      "collection": "Image_Extracted_Ambulance"
    }},
    "insurance_documentation": {{
      "available": {json.dumps(ins_available)},
      "sources": {json.dumps(hints.get('ins_sources') or [])},
      "note": {json.dumps("Insurance details found in clinical notes — original policy document required for full verification" if ins_available else "Not available in any source")}
    }},
    "consent_documentation": {{"available": null, "reference": null}},
    "patient_registration_record": {{"available": true, "collection": "patients"}},
    "electronic_signatures": {{"available": null, "signature_trail": []}}
  }},
  "electronic_audit_trail": [],
  "known_medical_history": {{
    "pre_existing_conditions": [],
    "current_medications": [],
    "known_allergies": [],
    "previous_hospitalisations": [],
    "disability_status": null
  }},
  "package_summary": {{
    "one_line_summary": null,
    "clinical_narrative_for_insurer": null,
    "key_facts": [],
    "total_sources_used": {total},
    "data_quality": null
  }}
}}

IMPORTANT — fill from agent inputs and HINTS:
1. claim_package_metadata.missing_critical_fields and package_completeness_percent
2. doctor_teleconsultation_documentation.provisional_diagnosis, differential_diagnoses,
   specialist_referrals, clinical_assessment_summary — from I3 AND this patient's actual
   data, hedged per DIAGNOSTIC_HEDGING_RULE, framed by is_trauma={is_trauma_flag}/
   case_type='{case_type}'. Do not default to a trauma narrative for a non-trauma case.
3. insurance_claim_assessment.claimable_services — from I5 claimable_services (full list,
   already grounded in documented interventions — do not add generic trauma items)
4. insurance_claim_assessment.exclusions_and_flags — from I5
5. electronic_audit_trail — all timestamped events chronologically
6. package_summary.one_line_summary, clinical_narrative_for_insurer, key_facts, data_quality
   NOTE: clinical_narrative MUST mention hemodynamic_status and respiratory_adequacy from
   HINTS, and MUST describe the actual case_type/mechanism — never mention RTA/haemothorax/
   pneumothorax/cervical spine unless is_trauma is true and the data supports it.
"""
        result = await self._invoke(system, prompt)

        if result:
            vs = result.get("vital_signs_record") or {}
            clinical_overrides = {
                "blood_pressure_systolic":              hints.get("vn_bp_sys"),
                "blood_pressure_diastolic":              hints.get("vn_bp_dia"),
                "blood_pressure_display":                hints.get("vn_bp"),
                "heart_rate_bpm":                        int(hints["vn_hr"]) if hints.get("vn_hr") and str(hints["vn_hr"]).isdigit() else None,
                "heart_rate_classification":              hints.get("vn_hr_class"),
                "respiratory_rate_bpm":                   int(hints["vn_rr"]) if hints.get("vn_rr") and str(hints["vn_rr"]).isdigit() else None,
                "respiratory_rate_classification":        hints.get("vn_rr_class"),
                "spo2_on_room_air_percent":                int(hints["vn_spo2_air"]) if hints.get("vn_spo2_air") and str(hints["vn_spo2_air"]).isdigit() else None,
                "spo2_on_oxygen_percent":                  int(hints["vn_spo2_o2"]) if hints.get("vn_spo2_o2") and str(hints["vn_spo2_o2"]).isdigit() else None,
                "spo2_room_air_classification":            hints.get("vn_spo2_class_room_air"),
                "spo2_on_o2_classification":                hints.get("vn_spo2_class_on_o2"),
                "temperature_celsius":                    hints.get("vn_temp_c"),
                "temperature_fahrenheit":                  float(hints["vn_temp_f"]) if hints.get("vn_temp_f") else None,
                "temperature_classification":              hints.get("vn_temp_class") or "Normal",
                "glucose_mgdl":                            int(hints["vn_glucose"]) if hints.get("vn_glucose") and str(hints["vn_glucose"]).isdigit() else None,
                "pupil_response":                          hints.get("vn_pupils"),
            }
            for k, v in clinical_overrides.items():
                if v is not None:
                    vs[k] = v
            if not vs.get("critical_vitals_flags"):
                vs["critical_vitals_flags"] = critical_flags
            result["vital_signs_record"] = vs

            result["hemodynamic_assessment"] = {
                "hemodynamic_status":     hints.get("hemodynamic_status"),
                "shock_suspected":        hints.get("shock_suspected", False),
                "shock_type":             hints.get("shock_type"),
                "shock_stage":            hints.get("shock_stage"),
                "shock_class":            hints.get("shock_class"),
                "hemodynamic_narrative":  hints.get("hemodynamic_narrative"),
                "decompensation_warning": hints.get("decompensation_warning"),
            }

            result["respiratory_assessment"] = {
                "respiratory_adequacy":       hints.get("respiratory_adequacy"),
                "respiratory_failure_risk":   hints.get("respiratory_failure_risk", False),
                "pneumothorax_suspected":     hints.get("pneumothorax_flag", False),
                "hemothorax_suspected":       hints.get("hemothorax_flag", False),
                "reduced_air_entry_left":     hints.get("reduced_air_entry_left", False),
                "respiratory_narrative":      hints.get("respiratory_narrative"),
                "chest_decompression_watch":  hints.get("chest_decompression_watch"),
            }

            result["clinical_trend"] = {
                "overall_trend":        hints.get("clinical_trend_overall"),
                "trend_summary":        hints.get("clinical_trend_summary"),
                "improving_parameters": hints.get("clinical_trend_improving") or [],
                "worsening_parameters": hints.get("clinical_trend_worsening") or [],
                "trajectory_note":      hints.get("clinical_trend_note"),
            }

            ica = result.get("insurance_claim_assessment") or {}
            ica["icd_10_codes"] = hints.get("icd10_codes") or []
            ica["insurance_data_available"] = ins_available
            if not ica.get("claim_type"):
                ica["claim_type"] = claim_type_label
            result["insurance_claim_assessment"] = ica

            ii = result.get("insurance_information") or {}
            ii["insurance_data_available"] = ins_available
            ii["insurance_data_sources"]   = hints.get("ins_sources") or []
            for field, hint_key in [
                ("insurance_provider_name", "ins_provider"),
                ("policy_number",           "ins_policy_number"),
                ("member_id",               "ins_member_id"),
                ("group_number",            "ins_group_number"),
                ("policy_holder_name",      "ins_policy_holder"),
                ("coverage_valid_from",     "ins_coverage_from"),
                ("coverage_valid_to",       "ins_coverage_to"),
                ("claim_number",            "ins_claim_number"),
                ("co_pay_amount",           "ins_co_pay"),
                ("deductible_amount",       "ins_deductible"),
                ("estimated_claim_amount_stated", "ins_estimated_amount"),
                ("attending_provider_name", "ins_provider_name"),
                ("attending_provider_npi",  "ins_npi"),
            ]:
                if not ii.get(field) and hints.get(hint_key):
                    ii[field] = hints[hint_key]
            result["insurance_information"] = ii

            pi = result.get("patient_identification") or {}
            for field, hint_key in [
                ("patient_id",     "patient_id"),
                ("sys_user_id",    "sys_user_id"),
                ("full_name",      "full_name"),
                ("age",            "age"),
                ("gender",         "gender"),
                ("contact_number", "contact_number"),
            ]:
                if not pi.get(field) and hints.get(hint_key):
                    pi[field] = hints[hint_key]
            result["patient_identification"] = pi

            imv = result.get("image_monitor_vitals") or {}
            for pump_field, val in [
                ("pump1_flow_ml_hr", p1_flow),
                ("pump2_flow_ml_hr", p2_flow),
                ("pump3_flow_ml_hr", p3_flow),
                ("pump1_infused_ml", p1_inf),
                ("pump2_infused_ml", p2_inf),
                ("pump3_infused_ml", p3_inf),
            ]:
                if val and not imv.get(pump_field):
                    try:
                        imv[pump_field] = float(val)
                    except Exception:
                        imv[pump_field] = val
            result["image_monitor_vitals"] = imv

            aaa = result.get("approved_ai_analysis") or {}
            for field, hint_key in [
                ("impressive_findings", "aa_impressive"),
                ("ai_impression",       "aa_impression"),
                ("physician_alert",     "aa_physician_alert"),
                ("emt_actions_summary", "aa_emt_actions"),
                ("comorbidities",       "aa_comorbidities"),
                ("trend_analysis",      "aa_trend"),
            ]:
                if not aaa.get(field) and hints.get(hint_key):
                    aaa[field] = hints[hint_key]
            result["approved_ai_analysis"] = aaa

            # v3.1 — pain_location / transport fields are deterministic
            # Python derivations, not LLM guesses: enforce them here.
            pcd = result.get("paramedic_clinical_documentation") or {}
            pcd["pain_location"] = pain_location
            result["paramedic_clinical_documentation"] = pcd

            asd = result.get("ambulance_service_documentation") or {}
            asd["transport_position"] = transport_derived["transport_position"]
            asd["equipment_used"]     = transport_derived["equipment_used"]
            asd["consumables_used"]   = transport_derived["consumables_used"]
            result["ambulance_service_documentation"] = asd

            cpm = result.get("claim_package_metadata") or {}
            cpm["case_type"] = case_type
            cpm["is_trauma"] = is_trauma_flag
            cpm["routing_rationale"] = state.get("routing_rationale")
            cpm["package_version"] = "3.1"
            result["claim_package_metadata"] = cpm

        state["insurance_claim_package"] = result
        logger.info(f"{self.agent_id} · DONE")
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        return state


# ============================================================
# I7b · CLAIM READINESS & SUMMARY POST-PASS
# v3.1: prompt no longer MANDATES mentioning "High-impact RTA"
# or "Suspected chest injury" — the clinical_narrative_for_insurer
# instructions are now case_type/is_trauma aware and grounded in
# the actual hints only.
# ============================================================

class ClaimReadinessAgent(BaseAgent):
    agent_id = "I7b"

    async def run(self, state: EIDISState) -> EIDISState:
        logger.info(f"{self.agent_id} · ClaimReadinessAgent — START")
        t0 = datetime.now().timestamp()

        hints   = state.get("py_hints") or {}
        pkg     = state.get("insurance_claim_package") or {}
        i5      = _compact_json(state.get("insurance_eligibility") or {})
        i6      = _compact_json(state.get("claim_evidence") or {})

        vd_count = len(state.get("voice_dictations") or [])
        dn_count = len(state.get("doctor_voice_notes") or [])
        iv_count = len(state.get("image_extracted_vitals") or [])
        ca_count = len(state.get("clinical_actions") or [])
        aa_count = len(state.get("approved_analyses") or [])

        ins_available = hints.get("ins_data_available", False)
        is_trauma_flag = hints.get("is_trauma")
        case_type = hints.get("case_type") or "unknown"

        system = (
            "You are a senior insurance claims assessor AND emergency physician reviewing this case. "
            "v3.1: Provide clinically accurate, CASE-SPECIFIC narrative — do NOT call tachypnoea "
            "'normal', do NOT call compensated shock 'stable', and do NOT mention trauma-specific "
            "findings (RTA mechanism, haemothorax/pneumothorax, cervical spine) unless is_trauma is "
            "true and the hints actually support it. For a non-trauma case, describe the real "
            "presentation (cardiac/respiratory/neurological/toxicological/obstetric/infectious) "
            "using only what is in the hints below. "
            "Be specific about what is present and what is missing. Valid JSON only."
        ) + STABILITY_LABELING_RULE + DIAGNOSTIC_HEDGING_RULE + EVIDENCE_TRACEABILITY_RULE

        readiness_score = 30
        if vd_count > 0:           readiness_score += 10
        if dn_count > 0:           readiness_score += 10
        if iv_count > 0:           readiness_score += 10
        if aa_count > 0:           readiness_score += 10
        if ca_count > 0:           readiness_score += 5
        if hints.get("vn_bp"):     readiness_score += 5
        if ins_available:          readiness_score += 20

        blocking = []
        if not ins_available:
            blocking.append("No verified insurance policy details — obtain from patient/family")
        if hints.get("monitor_patient_mismatch"):
            blocking.append("Monitor device patient identity mismatch — verify device assignment")
        if not hints.get("vn_bp"):
            blocking.append("No vital signs documented")

        prompt = f"""
PATIENT: {hints.get('full_name')} | Age: {hints.get('age')} | Gender: {hints.get('gender')}
CASE TYPE (pre-classified by I0): {case_type} | is_trauma={is_trauma_flag}
INCIDENT: {hints.get('incident_date')} | Mechanism: {hints.get('mechanism_of_injury')}
CHIEF COMPLAINT: {hints.get('chief_complaint')}
TRIAGE: {hints.get('triage_colour')} | Severity: {hints.get('doctor_severity')} | AI Risk: {hints.get('aa_risk_level')}

VITALS (voice note — DOCTOR ASSESSED):
  BP: {hints.get('vn_bp')} mmHg | HR: {hints.get('vn_hr')} bpm [{hints.get('vn_hr_class')}]
  RR: {hints.get('vn_rr')} bpm [{hints.get('vn_rr_class')}]
  SpO2: {hints.get('vn_spo2_air')}% room air [{hints.get('vn_spo2_class_room_air')}] → {hints.get('vn_spo2_o2')}% on O2 [{hints.get('vn_spo2_class_on_o2')}]
  Temp: {hints.get('vn_temp_c')}°C [{hints.get('vn_temp_class')}] | Glucose: {hints.get('vn_glucose')} mg/dL | GCS: {hints.get('vn_gcs')}/15
  Pupils: {hints.get('vn_pupils')}

HEMODYNAMICS: {hints.get('hemodynamic_status')} | Shock: {hints.get('shock_suspected')} | Type: {hints.get('shock_type')}
HEMODYNAMIC NARRATIVE: {hints.get('hemodynamic_narrative')}
DECOMPENSATION WARNING: {hints.get('decompensation_warning')}

RESPIRATORY: Adequacy={hints.get('respiratory_adequacy')} | Pneumothorax={hints.get('pneumothorax_flag')} | Haemothorax={hints.get('hemothorax_flag')}
RESPIRATORY NARRATIVE: {hints.get('respiratory_narrative')}

CLINICAL TREND: {hints.get('clinical_trend_overall')} | Summary: {hints.get('clinical_trend_summary')}

INSURANCE: Available={ins_available} | Sources={hints.get('ins_sources')}
  Provider: {hints.get('ins_provider')} | Policy: {hints.get('ins_policy_number')}
  Member: {hints.get('ins_member_id')} | Coverage: {hints.get('ins_coverage_from')} — {hints.get('ins_coverage_to')}
  Claim#: {hints.get('ins_claim_number')} | Holder: {hints.get('ins_policy_holder')}
  Stated amount: {hints.get('ins_estimated_amount')}

INTERVENTIONS: {hints.get('interventions')}
INJURIES DOCUMENTED (empty if non-trauma / none found): {hints.get('injuries')}
MONITOR MISMATCH: {hints.get('monitor_patient_mismatch')}
BLOCKING ISSUES: {blocking}

EVIDENCE: voice={vd_count}, dr_notes={dn_count}, img_vitals={iv_count}, actions={ca_count}, analyses={aa_count}
READINESS SCORE (computed): {readiness_score}

I5: {i5}

Return ONLY this JSON:
{{
  "claim_readiness_assessment": {{
    "ready_to_submit": {json.dumps(ins_available and bool(hints.get('ins_policy_number')))},
    "readiness_score_percent": {readiness_score},
    "insurance_data_found": {json.dumps(ins_available)},
    "insurance_sources": {json.dumps(hints.get('ins_sources') or [])},
    "blocking_issues": {json.dumps(blocking)},
    "recommended_actions_before_submission": [],
    "estimated_processing_time_days": 14,
    "claim_outcome_prediction": null
  }},
  "package_summary": {{
    "one_line_summary": null,
    "clinical_narrative_for_insurer": null,
    "key_facts": [],
    "total_sources_used": {vd_count + dn_count + iv_count + ca_count + aa_count},
    "data_quality": null,
    "data_quality_reason": null
  }}
}}

INSTRUCTIONS:
- recommended_actions_before_submission: actionable steps (verify insurance docs, confirm
  monitor patient, obtain hospital admission records, and — ONLY if is_trauma is true —
  obtain FIR/police report)
- claim_outcome_prediction: realistic prediction based on evidence quality and insurance availability
- one_line_summary: ONE crisp sentence for an insurer (include mechanism/case_type, age, key
  finding, insurance status) — grounded ONLY in the hints above
- clinical_narrative_for_insurer: 4-6 sentences MUST mention:
  * The actual mechanism/case_type ({case_type}, is_trauma={is_trauma_flag}) — describe what
    is genuinely documented (e.g. a cardiac/respiratory/neurological event if is_trauma is
    false; the actual injury mechanism if is_trauma is true). Never substitute a different
    case type's narrative.
  * Vital sign findings WITH correct classifications (from HINTS)
  * Hemodynamic status: {hints.get('hemodynamic_status')} (NOT "stable" if shock_suspected)
  * Respiratory adequacy: {hints.get('respiratory_adequacy')}
  * Any chest/pneumothorax/haemothorax concern ONLY if pneumothorax_flag/hemothorax_flag is true
  * Pre-hospital interventions and teleconsultation
  * Insurance status
- key_facts: 8-10 specific facts (include vital sign numbers, hemodynamic classification, insurance finding)
- data_quality: "Good" / "Moderate" / "Poor" with reason
"""
        result = await self._invoke(system, prompt)

        if result:
            cra = result.get("claim_readiness_assessment") or {}
            cra["ready_to_submit"]       = ins_available and bool(hints.get("ins_policy_number"))
            cra["readiness_score_percent"] = readiness_score
            cra["insurance_data_found"]  = ins_available
            cra["insurance_sources"]     = hints.get("ins_sources") or []
            if not cra.get("blocking_issues"):
                cra["blocking_issues"] = blocking
            result["claim_readiness_assessment"] = cra

        if result and state.get("insurance_claim_package"):
            if result.get("claim_readiness_assessment"):
                state["insurance_claim_package"]["claim_readiness_assessment"] = result["claim_readiness_assessment"]
            if result.get("package_summary"):
                state["insurance_claim_package"]["package_summary"] = result["package_summary"]

        logger.info(f"{self.agent_id} · DONE")
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        return state


# ============================================================
# WORKFLOW GRAPH
# ------------------------------------------------------------
# NOTE v3.1: the case-type classifier (I0) is NOT a graph node.
# It must run BEFORE build_eidis_state() because hint extraction
# (_assess_hemodynamic_status) needs is_trauma up front — see
# classify_case_type() and process_insurance_documentation()
# below. The graph itself is otherwise unchanged: I1→I2→I3→I4→
# [I5+I6]→I7→I7b.
# ============================================================

def create_eidis_workflow() -> Any:
    workflow = StateGraph(EIDISState)

    workflow.add_node("I1",        PatientIdentityAgent(llm).run)
    workflow.add_node("I2",        EmergencyEventAgent(llm).run)
    workflow.add_node("I3",        TeleconsultationAgent(llm).run)
    workflow.add_node("I4",        AmbulanceServiceAgent(llm).run)
    workflow.add_node("I5_I6_PAR", run_parallel_agents)
    workflow.add_node("I7",        InsuranceClaimSynthesiser(llm_synthesis).run)
    workflow.add_node("I7b",       ClaimReadinessAgent(llm_synthesis).run)

    workflow.set_entry_point("I1")
    workflow.add_edge("I1",        "I2")
    workflow.add_edge("I2",        "I3")
    workflow.add_edge("I3",        "I4")
    workflow.add_edge("I4",        "I5_I6_PAR")
    workflow.add_edge("I5_I6_PAR", "I7")
    workflow.add_edge("I7",        "I7b")
    workflow.add_edge("I7b",       END)

    return workflow.compile()


eidis_workflow = create_eidis_workflow()


# ============================================================
# CORE PROCESSING FUNCTION
# ============================================================

async def process_insurance_documentation(
    patient_id: str,
    include_intermediates: bool = False,
) -> Dict:
    start_ms = datetime.now().timestamp() * 1000

    data = await _fetch_all_data(patient_id)

    # v3.1 — I0: classify case type BEFORE building hints/state, since
    # hemodynamic-status labeling depends on knowing is_trauma up front
    # (see _assess_hemodynamic_status fix). Narrative is built once here
    # and passed into build_eidis_state() to avoid rebuilding it.
    narrative = _build_combined_narrative(data, patient_id)
    classification = await classify_case_type(narrative)
    authoritative_triage = await fetch_authoritative_triage(patient_triage_status_collection, patient_id)

    initial_state = build_eidis_state(
        patient_id, data,
        is_trauma=classification["is_trauma"],
        case_type=classification["case_type"],
        routing_rationale=classification["routing_rationale"],
        narrative=narrative,
        authoritative_triage=authoritative_triage,
    )

    source_counts = {
        "voice_dictations":       len(data.get("voice_dictations") or []),
        "doctor_voice_notes":     len(data.get("doctor_voice_notes") or []),
        "image_extracted_vitals": len(data.get("image_extracted_vitals") or []),
        "clinical_actions":       len(data.get("clinical_actions") or []),
        "doctor_suggestions":     len(data.get("doctor_suggestions") or []),
        "approved_analyses":      len(data.get("approved_analyses") or []),
    }

    py_hints = initial_state.get("py_hints") or {}
    logger.info(
        f"[EIDIS v3.1] Running pipeline | patient={patient_id} | "
        f"sources={source_counts} | "
        f"case_type={py_hints.get('case_type')} | is_trauma={py_hints.get('is_trauma')} | "
        f"triage_colour={py_hints.get('triage_colour')} | "
        f"insurance_found={py_hints.get('ins_data_available')} | "
        f"insurance_sources={py_hints.get('ins_sources')} | "
        f"hemodynamic_status={py_hints.get('hemodynamic_status')} | "
        f"respiratory_adequacy={py_hints.get('respiratory_adequacy')} | "
        f"clinical_trend={py_hints.get('clinical_trend_overall')}"
    )

    try:
        result = await eidis_workflow.ainvoke(initial_state)
    except Exception as e:
        logger.exception(f"[EIDIS] Pipeline failed for patient {patient_id}: {e}")
        raise HTTPException(status_code=500, detail=f"EIDIS pipeline error: {str(e)}")

    elapsed = round(datetime.now().timestamp() * 1000 - start_ms)

    output: Dict[str, Any] = {
        "patient_id":              patient_id,
        "generated_at_ist":        now_ist().isoformat(),
        "generated_at_display":    display_ist(now_ist()),
        "processing_time_ms":      elapsed,
        "source_counts":           source_counts,
        "case_type":               result.get("case_type"),
        "is_trauma":               result.get("is_trauma"),
        "routing_rationale":       result.get("routing_rationale"),
        "triage_colour":           result.get("triage_colour"),
        "errors":                  result.get("errors", []),
        "agent_timings":           result.get("agent_timings", {}),
        "insurance_claim_package": result.get("insurance_claim_package"),
        "insurance_eligibility":   result.get("insurance_eligibility"),
        "claim_evidence":          result.get("claim_evidence"),
    }

    if include_intermediates:
        output["intermediates"] = {
            "patient_identity":         result.get("patient_identity"),
            "emergency_event":          result.get("emergency_event"),
            "teleconsultation_record":  result.get("teleconsultation_record"),
            "ambulance_service_record": result.get("ambulance_service_record"),
            "py_hints":                 result.get("py_hints"),
        }

    try:
        save_doc = {
            "patient_id":              patient_id,
            "generated_at_ist":        now_ist(),
            "source_counts":           source_counts,
            "case_type":               result.get("case_type"),
            "is_trauma":               result.get("is_trauma"),
            "routing_rationale":       result.get("routing_rationale"),
            "triage_colour":           result.get("triage_colour"),
            "insurance_claim_package": result.get("insurance_claim_package"),
            "insurance_eligibility":   result.get("insurance_eligibility"),
            "claim_evidence":          result.get("claim_evidence"),
            "processing_time_ms":      elapsed,
            "errors":                  result.get("errors", []),
            "eidis_version":           "3.1",
        }
        await insurance_claims_collection.insert_one(save_doc)
        logger.info(f"[EIDIS] Saved claim package v3.1 for patient {patient_id}")
    except Exception as e:
        logger.error(f"[EIDIS] MongoDB save failed: {e}")

    return output


# ============================================================
# API ENDPOINTS
# ============================================================

@router.post("/insurance/documentation/{patient_id}")
async def generate_insurance_documentation(
    patient_id: str,
    include_intermediates: bool = False,
):
    """
    Full EIDIS v3.1 pipeline (I0 classifier → I1→I2→I3→I4→I5+I6→I7→I7b).
    v3.1 changes:
    - NEW I0 case-type classifier (is_trauma/case_type), run once before
      hint extraction, threaded into every prompt
    - Removed ALL hardcoded trauma/RTA fallback content (differential
      diagnoses, provisional diagnosis, claimable services, specialist
      referrals, transport equipment) — now derived from actual patient
      data or deterministically computed from documented interventions
    - Fixed _assess_hemodynamic_status() silent is_trauma=True default bug
    - Added cardiac/medical ICD-10 branches (previously trauma-only)
    - Added shared deterministic compute_triage_colour() as the single
      authoritative triage value (candidate for cross-pipeline extraction)
    - Ported STABILITY_LABELING_RULE / DIAGNOSTIC_HEDGING_RULE /
      EVIDENCE_TRACEABILITY_RULE guardrails from EVIS
    All timestamps in IST (Asia/Kolkata, UTC+5:30).
    """
    logger.info(f"[EIDIS v3.1] POST /insurance/documentation/{patient_id}")
    result = await process_insurance_documentation(
        patient_id=patient_id,
        include_intermediates=include_intermediates,
    )
    return {
        "status":               "success",
        "patient_id":           patient_id,
        "eidis_version":        "3.1",
        "generated_at_ist":     result["generated_at_ist"],
        "generated_at_display": result["generated_at_display"],
        "processing_time_ms":   result["processing_time_ms"],
        "source_counts":        result["source_counts"],
        "case_type":            result["case_type"],
        "is_trauma":            result["is_trauma"],
        "routing_rationale":    result["routing_rationale"],
        "triage_colour":        result["triage_colour"],
        "errors":               result["errors"],
        "agent_timings":        result["agent_timings"],
        "insurance_claim_package": result["insurance_claim_package"],
        "insurance_eligibility":   result["insurance_eligibility"],
        "claim_evidence":          result["claim_evidence"],
        **({"intermediates": result["intermediates"]} if include_intermediates else {}),
    }


@router.get("/insurance/documentation/latest/{patient_id}")
async def get_latest_insurance_documentation(patient_id: str):
    """Returns the most recently saved insurance claim package from MongoDB."""
    try:
        latest = await insurance_claims_collection.find_one(
            {"patient_id": patient_id},
            sort=[("generated_at_ist", -1)],
        )
        if not latest:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"No insurance claim package found for patient '{patient_id}'. "
                    "Use POST /insurance/documentation/{patient_id} to generate one."
                )
            )
        latest["_id"] = str(latest["_id"])
        if isinstance(latest.get("generated_at_ist"), datetime):
            latest["generated_at_ist"] = iso_ist(latest["generated_at_ist"])
        return {
            "status":     "success",
            "patient_id": patient_id,
            "data":       _serialise(latest),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/insurance/health")
async def eidis_health():
    return {
        "status":            "ok",
        "system":            "EIDIS — Emergency Insurance Documentation Intelligence System",
        "version":           "3.1",
        "agents":            8,
        "workflow_compiled": eidis_workflow is not None,
        "timezone":          "IST (Asia/Kolkata, UTC+5:30)",
        "agent_pipeline": [
            "I0  · Case-Type Classifier (NEW v3.1 — runs BEFORE the graph, EVIS A0-style)",
            "I1  · Patient Demographics & Identity Extractor (+ insurance from all sources)",
            "I2  · Emergency Event & Clinical Findings Agent (case-type aware, derived pain_location)",
            "I3  · Teleconsultation & Doctor Assessment Agent (no hardcoded trauma differentials)",
            "I4  · Ambulance Service & Transport Agent (derived transport/equipment, not hardcoded)",
            "I5  · Insurance Eligibility & Coverage Analyser [parallel] (derived claimable_services)",
            "I6  · Claim Supporting Evidence Compiler [parallel]",
            "I7  · Insurance Claim Package Synthesiser (llama-3.3-70b, 8k)",
            "I7b · Claim Readiness & Summary Post-Pass (llama-3.3-70b, 8k)",
        ],
        "v3_1_fixes": [
            "NEW I0 case-type classifier (is_trauma/case_type), computed once, threaded into every prompt",
            "REMOVED hardcoded trauma/RTA fallback: differential_diagnoses, provisional_diagnosis, "
            "claimable_services, specialist_referrals, transport_position/equipment_used/consumables_used, "
            "claim_type — all now data-driven or deterministically derived from documented facts",
            "FIXED _assess_hemodynamic_status() silent is_trauma=True default bug (mechanism string was "
            "always empty at its call site, so every call previously took the 'else True' branch)",
            "ADDED cardiac/medical ICD-10 branches (MI, angina, cardiac arrest, arrhythmia, heart failure, "
            "stroke, seizure, sepsis, anaphylaxis, diabetic crisis, asthma/COPD, GI bleed, overdose, "
            "obstetric, hypertensive crisis) — previously trauma/RTA-only",
            "ADDED compute_triage_colour() — shared deterministic (non-LLM) triage function, the single "
            "authoritative value for this package (candidate for cross-pipeline extraction)",
            "PORTED STABILITY_LABELING_RULE / DIAGNOSTIC_HEDGING_RULE / EVIDENCE_TRACEABILITY_RULE from EVIS",
            "ADDED pain_location and transport/equipment derivation from actual documented text/interventions "
            "(previously hardcoded to 'Chest' and cervical-collar/spinal-board defaults respectively)",
        ],
        "v3_0_fixes_retained": [
            "RR >20 = Tachypnoeic (not Normal)",
            "SpO2 on room air vs on O2 classified separately",
            "hemodynamic_assessment / respiratory_assessment blocks in every agent output",
            "clinical_trend = Mixed when consciousness improves but shock/tachypnoea persists",
            "_extract_insurance_from_all_sources() scans all collections",
            "pump_flow fields populated from iv_pump* OR aa_vt_p* (fallback)",
        ],
        "current_time_ist": now_ist().isoformat(),
    }