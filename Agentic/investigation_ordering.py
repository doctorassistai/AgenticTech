"""
Investigation Ordering Validator (DB-Driven)
============================================

Standalone module that classifies every ordered investigation as either:

  • ASSOCIATIVE  — first-line, basic, directly linked to the working
                   diagnosis (e.g. CBC for fever, ECG for chest pain).
  • ADVANCED     — second-line, specialized, only justified AFTER
                   associative workup is abnormal OR strongly
                   documented as clinically indicated.

Every investigation now returns:
  • test_type_reason    — why it was classified as associative/advanced
  • order_justification — why it was approved or flagged
  • clinical_rationale  — full clinical reasoning
  • flag_reason         — reason for the flag (if any)
  • suggested_action    — what the doctor should do

This module is COMPLETELY INDEPENDENT from insurance_claim_validation.py.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, date as date_cls
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorClient

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage

# ==========================================================
# ENVIRONMENT / CLIENTS
# ==========================================================

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

mongo_client = AsyncIOMotorClient(MONGO_URI)
mongo_db = mongo_client[MONGO_DB]

patient_visit_history_collection = mongo_db["patientVisitHistory"]
LAB_REPORTS_COLLECTION_NAME = "integration_lab_reports"
integration_lab_reports_collection = mongo_db[LAB_REPORTS_COLLECTION_NAME]

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
ORDERING_MAX_TOKENS = int(os.getenv("ORDERING_MAX_TOKENS", "4000"))

llm_ordering = ChatGroq(
    model="openai/gpt-oss-120b",
    temperature=0.1,
    groq_api_key=GROQ_API_KEY,
    max_tokens=ORDERING_MAX_TOKENS,
)

router = APIRouter(
    prefix="/internal/investigation-ordering",
    tags=["Investigation Ordering"],
)


# ==========================================================
# RULES
# ==========================================================

ORDERING_RULE = (
    "INVESTIGATION ORDERING RULE: Every ordered investigation must be "
    "classified as ASSOCIATIVE or ADVANCED.\n\n"

    "ASSOCIATIVE (first-line / basic / expected):\n"
    "  - Directly linked to the working diagnosis.\n"
    "  - Standard of care for the presenting complaint.\n"
    "  - Reasonable to order on first contact.\n"
    "  - Examples: CBC, Urinalysis, Dengue NS1, Malaria smear, "
    "ECG, Troponin, Chest X-ray, FBS, HbA1c, TSH, Lipid Profile.\n\n"

    "ADVANCED (second-line / specialized):\n"
    "  - Requires abnormal first-line results OR strong clinical "
    "justification.\n"
    "  - Examples: Bone Marrow Biopsy, MRI, CT Angiography, "
    "Coronary Angiography, PET Scan, Endoscopy, Colonoscopy, "
    "Genetic/Molecular panels, advanced autoimmune panels.\n\n"

    "VALIDATION LOGIC:\n"
    "  1. If investigation is ADVANCED:\n"
    "     a. Check if the corresponding ASSOCIATIVE workup is present "
    "in the same order set.\n"
    "     b. Check if the physician documented why associative workup "
    "is skipped.\n"
    "     c. If neither → status = 'Pending Documentation', "
    "reason_for_rejection = 'Advanced test ordered without "
    "associative workup', and add a return note.\n"
    "     d. If associative workup present OR justification present "
    "→ keep the original status.\n"
    "  2. If investigation is ASSOCIATIVE → keep the original status.\n"
)

JUSTIFICATION_RULE = (
    "JUSTIFICATION RULE: For EVERY investigation you must provide:\n"
    "  • test_type_reason    — 1 short sentence explaining WHY the test "
    "was classified as ASSOCIATIVE or ADVANCED for this specific "
    "clinical scenario (diagnosis + presenting complaint).\n"
    "  • order_justification — 1-2 sentences explaining WHY the test "
    "was Approved / Rejected / Pending Documentation.\n"
    "  • clinical_rationale  — the full clinical reasoning: how this "
    "test connects to the working diagnosis, what it rules in/out, "
    "and what clinical decision it supports.\n"
    "  • flag_reason         — ONLY populate if ordering_flag is true. "
    "Explain exactly what associative workup is missing and why the "
    "advanced test cannot stand alone.\n"
    "  • suggested_action    — concrete, actionable next step for the "
    "physician or insurance reviewer (e.g. 'Order CBC first', "
    "'Add clinical justification for MRI', 'No action needed').\n\n"
    "All justification fields must be grounded in the documented "
    "clinical content. Never invent symptoms, findings, or tests."
)

EVIDENCE_RULE = (
    "EVIDENCE RULE: base every classification strictly on the "
    "documented clinical content of the visit — Primary Diagnosis, "
    "Presenting Complaint, Doctor Notes, Investigations, Procedures. "
    "Never invent tests, symptoms, or findings."
)


# ==========================================================
# REQUEST MODEL
# ==========================================================

class OrderingRequest(BaseModel):
    patient_id: str
    doctor_id: str


# ==========================================================
# GENERIC HELPERS
# ==========================================================

def _parse_llm_json(text: str) -> Dict[str, Any]:
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


# ==========================================================
# FIELD NORMALIZERS
# ==========================================================

INVESTIGATION_NAME_KEYS = [
    "test_name",
    "investigation_name",
    "investigation",
    "name",
    "test",
    "service_name",
    "service_description",
    "investigation_description",
    "test_description",
    "service",
    "procedure_name",
]

PROCEDURE_NAME_KEYS = [
    "procedure_name",
    "procedure",
    "name",
    "test_name",
    "service_name",
    "service_description",
]

DIAGNOSIS_NAME_KEYS = [
    "diagnosis",
    "name",
    "diagnosis_name",
    "primary_diagnosis",
    "description",
]

COMPLAINT_KEYS = [
    "presenting_complaint",
    "presenting_complaints",
    "chief_complaint",
    "primary_complaint",
    "complaint",
    "symptoms",
]

DOCTOR_NOTES_KEYS = [
    "doctor_notes",
    "physician_assessment",
    "visit_summary",
    "notes",
    "clinical_notes",
    "assessment",
]


def _pick_first(d: Dict[str, Any], keys: List[str], default: Any = "") -> Any:
    if not isinstance(d, dict):
        return default
    for k in keys:
        v = d.get(k)
        if v is None:
            continue
        if isinstance(v, str) and not v.strip():
            continue
        if isinstance(v, (list, dict)) and len(v) == 0:
            continue
        return v
    return default


def _normalize_investigations(raw_list: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw_list, list):
        return []

    normalized: List[Dict[str, Any]] = []
    for inv in raw_list:
        if isinstance(inv, str):
            name = inv.strip()
            if name:
                normalized.append({
                    "test_name": name,
                    "status": "Approved",
                    "claim_remarks": "",
                    "system_remarks": "",
                    "reason_for_rejection": "",
                })
            continue

        if not isinstance(inv, dict):
            continue

        name = _pick_first(inv, INVESTIGATION_NAME_KEYS, "")
        if not name:
            logger.warning(
                f"Could not find name in investigation: keys={list(inv.keys())}"
            )
            continue

        normalized.append({
            "test_name": str(name).strip(),
            "status": inv.get("status") or inv.get("claim_status") or "Approved",
            "claim_remarks": inv.get("claim_remarks") or inv.get("remarks") or "",
            "system_remarks": inv.get("system_remarks") or "",
            "reason_for_rejection": (
                inv.get("reason_for_rejection")
                or inv.get("denial_reason")
                or ""
            ),
        })

    return normalized


def _normalize_primary_diagnosis(raw: Any) -> tuple[str, str]:
    if isinstance(raw, dict):
        name = _pick_first(raw, DIAGNOSIS_NAME_KEYS, "")
        icd = _pick_first(raw, ["icd10_code", "icd_code", "code"], "")
        return str(name or "").strip(), str(icd or "").strip()

    if isinstance(raw, str):
        return raw.strip(), ""

    return "", ""


# ==========================================================
# FETCH FUNCTIONS
# ==========================================================

async def fetch_patient_visit_history(
    patient_id: str, doctor_id: str
) -> List[Dict[str, Any]]:
    doc = await patient_visit_history_collection.find_one(
        {"patient_id": patient_id, "doctor_id": doctor_id},
        {"_id": 0, "visits": 1},
    )
    if not doc or not doc.get("visits"):
        return []
    visits = doc["visits"]
    return sorted(visits, key=_sort_key, reverse=True)


async def fetch_lab_report_history(
    patient_id: str, doctor_id: str
) -> List[Dict[str, Any]]:
    doc = await integration_lab_reports_collection.find_one(
        {"patient_id": patient_id, "doctor_id": doctor_id},
        {"_id": 0, "reports": 1},
    )
    if not doc or not doc.get("reports"):
        return []
    return doc["reports"]


# ==========================================================
# RETURN NOTES BUILDER
# ==========================================================

def _build_return_notes_from_results(
    validated: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    notes: List[Dict[str, Any]] = []

    for inv in validated:
        if not isinstance(inv, dict):
            continue

        if inv.get("status") == "Pending Documentation" and inv.get("ordering_flag"):
            test_name = inv.get("test_name", "investigation")
            missing = inv.get("associative_expected", [])
            missing_str = (
                ", ".join(missing) if missing else "the standard first-line workup"
            )

            notes.append({
                "issue": (
                    f"{test_name} is an ADVANCED investigation ordered "
                    f"without documented associative workup."
                ),
                "suggestion": (
                    inv.get("suggested_action")
                    or (
                        f"Order or document the associative workup "
                        f"({missing_str}) before or alongside {test_name}, "
                        f"or clearly justify why the associative workup "
                        f"is not required."
                    )
                ),
                "recommended_evidence": (
                    "Documentation of prior associative test results, "
                    "or a clear clinical rationale explaining why "
                    "associative testing is not indicated."
                ),
            })

    return notes


# ==========================================================
# CORE VALIDATION FUNCTION
# ==========================================================

async def validate_investigation_ordering(
    primary_diagnosis: str,
    icd10_code: str,
    presenting_complaint: str,
    investigations: List[Dict[str, Any]],
    doctor_notes: str = "",
) -> Dict[str, Any]:
    if not investigations:
        return {
            "validated_investigations": [],
            "return_notes": [],
            "summary": {
                "total": 0,
                "associative": 0,
                "advanced": 0,
                "flagged": 0,
            },
        }

    investigations_json = json.dumps(investigations, indent=2, default=str)

    system = (
        "You are an expert Medical Insurance Claim Review Assistant "
        "specializing in investigation ordering logic.\n\n"
        f"{ORDERING_RULE}\n\n"
        f"{JUSTIFICATION_RULE}\n\n"
        f"{EVIDENCE_RULE}\n\n"
        "Always respond with valid JSON only."
    )

    prompt = f"""
══════════════════════════════════════════════════════════
CLINICAL CONTEXT
══════════════════════════════════════════════════════════
Primary Diagnosis   : {primary_diagnosis or "Not documented"}
ICD-10 Code         : {icd10_code or "Not documented"}
Presenting Complaint: {presenting_complaint or "Not documented"}
Doctor Notes        : {doctor_notes or "Not documented"}

══════════════════════════════════════════════════════════
INVESTIGATIONS ORDERED IN THE LATEST VISIT
══════════════════════════════════════════════════════════
{investigations_json}

══════════════════════════════════════════════════════════
TASK
══════════════════════════════════════════════════════════
For EVERY investigation:

1. Classify as:
   - "ASSOCIATIVE"  → first-line / basic / expected for the working dx
   - "ADVANCED"     → second-line / specialized

2. If ADVANCED:
   - List the expected ASSOCIATIVE tests for this clinical scenario.
   - Check whether those associative tests are present in the SAME
     order set OR explicitly justified as not needed in the doctor notes.
   - If NOT present and NOT justified:
       * set ordering_flag = true
       * set status = "Pending Documentation"
       * set reason_for_rejection = "Advanced test ordered without associative workup"
   - Otherwise:
       * set ordering_flag = false
       * leave status unchanged

3. If ASSOCIATIVE:
   - set ordering_flag = false
   - leave status unchanged

4. JUSTIFICATION (MANDATORY for every test):
   - test_type_reason    : 1 short sentence — WHY this classification
   - order_justification : 1-2 sentences — WHY approved/flagged
   - clinical_rationale  : full clinical reasoning
   - flag_reason         : only if ordering_flag = true
   - suggested_action    : concrete next step

Return ONLY valid JSON:

{{
  "validated_investigations": [
    {{
      "test_name": "",
      "test_type": "ASSOCIATIVE|ADVANCED",
      "test_type_reason": "",
      "associative_expected": ["..."],
      "associative_present": ["..."],
      "associative_justified_skip": false,
      "ordering_flag": false,
      "order_sequence_valid": true,
      "status": "Approved|Rejected|Pending Documentation",
      "order_justification": "",
      "clinical_rationale": "",
      "flag_reason": "",
      "suggested_action": "",
      "claim_remarks": "",
      "system_remarks": "",
      "reason_for_rejection": ""
    }}
  ]
}}
"""

    try:
        response = await llm_ordering.ainvoke([
            SystemMessage(content=system),
            HumanMessage(content=prompt),
        ])
        result = _parse_llm_json(response.content)
    except Exception as e:
        logger.error(f"Investigation ordering validation failed: {e}")
        result = {
            "validated_investigations": [
                {
                    "test_name": inv.get("test_name", ""),
                    "test_type": "ASSOCIATIVE",
                    "test_type_reason": "Automated classification unavailable — defaulted to associative.",
                    "associative_expected": [],
                    "associative_present": [],
                    "associative_justified_skip": False,
                    "ordering_flag": False,
                    "order_sequence_valid": True,
                    "status": inv.get("status", "Approved"),
                    "order_justification": "Manual review required.",
                    "clinical_rationale": "Automated validation failed.",
                    "flag_reason": "",
                    "suggested_action": "Manual clinical review recommended.",
                    "claim_remarks": inv.get("claim_remarks", ""),
                    "system_remarks": inv.get("system_remarks", ""),
                    "reason_for_rejection": inv.get("reason_for_rejection", ""),
                }
                for inv in investigations
            ]
        }

    validated = result.get("validated_investigations", [])
    by_name = {
        str(v.get("test_name", "")).strip().lower(): v for v in validated
    }

    finalised: List[Dict[str, Any]] = []
    for inv in investigations:
        name = str(inv.get("test_name", "")).strip()
        v = by_name.get(name.lower())

        if v is None:
            v = {
                "test_name": name,
                "test_type": "ASSOCIATIVE",
                "test_type_reason": "Not returned by classifier — defaulted to associative.",
                "associative_expected": [],
                "associative_present": [],
                "associative_justified_skip": False,
                "ordering_flag": False,
                "order_sequence_valid": True,
                "status": inv.get("status", "Approved"),
                "order_justification": "No justification returned.",
                "clinical_rationale": "",
                "flag_reason": "",
                "suggested_action": "Review manually.",
                "system_remarks": inv.get("system_remarks", ""),
                "reason_for_rejection": inv.get("reason_for_rejection", ""),
            }

        # Ensure all justification fields exist
        v.setdefault(
            "test_type_reason",
            "Classified as associative (default).",
        )
        v.setdefault(
            "order_justification",
            "No specific justification provided.",
        )
        v.setdefault("clinical_rationale", "")
        v.setdefault("flag_reason", "")
        v.setdefault(
            "suggested_action",
            "No action required." if v.get("status") == "Approved"
            else "Review and provide documentation.",
        )

        status = v.get("status", "Approved")
        if status == "Approved":
            v["claim_remarks"] = "Billable Test under Insurance"
        else:
            v["claim_remarks"] = "Non Billable Test Insurance"

        finalised.append(v)

    return_notes = _build_return_notes_from_results(finalised)

    associative_count = sum(1 for v in finalised if v.get("test_type") == "ASSOCIATIVE")
    advanced_count = sum(1 for v in finalised if v.get("test_type") == "ADVANCED")
    flagged_count = sum(1 for v in finalised if v.get("ordering_flag"))

    return {
        "validated_investigations": finalised,
        "return_notes": return_notes,
        "summary": {
            "total": len(finalised),
            "associative": associative_count,
            "advanced": advanced_count,
            "flagged": flagged_count,
        },
    }


# ==========================================================
# API ENDPOINT
# ==========================================================

@router.post("/validate")
async def validate_ordering(request: OrderingRequest):
    """
    Fetch latest visit + lab history from MongoDB and validate the
    ordering (ASSOCIATIVE vs ADVANCED) of every investigation in the
    latest visit.

    Body:
      { "patient_id": "...", "doctor_id": "..." }
    """
    start_ms = datetime.now().timestamp() * 1000
    logger.info(
        f"Ordering validation | patient={request.patient_id} | "
        f"doctor={request.doctor_id}"
    )

    try:
        visits_sorted = await fetch_patient_visit_history(
            request.patient_id, request.doctor_id
        )

        if not visits_sorted:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"No visit history found for patient "
                    f"{request.patient_id} under doctor "
                    f"{request.doctor_id}"
                ),
            )

        latest_visit = visits_sorted[0]

        lab_reports = await fetch_lab_report_history(
            request.patient_id, request.doctor_id
        )

        raw_investigations = latest_visit.get("investigations", []) or []
        investigations = _normalize_investigations(raw_investigations)

        logger.info(
            f"Normalized {len(investigations)} investigation(s); "
            f"sample={investigations[0] if investigations else 'none'}"
        )

        primary_diagnosis, icd10_code = _normalize_primary_diagnosis(
            latest_visit.get("primary_diagnosis", "")
        )
        if not icd10_code:
            icd10_code = latest_visit.get("icd10_code", "") or ""

        presenting_complaint = str(
            _pick_first(latest_visit, COMPLAINT_KEYS, "")
        ).strip()

        doctor_notes = str(
            _pick_first(latest_visit, DOCTOR_NOTES_KEYS, "")
        ).strip()

        result = await validate_investigation_ordering(
            primary_diagnosis=primary_diagnosis,
            icd10_code=icd10_code,
            presenting_complaint=presenting_complaint,
            investigations=investigations,
            doctor_notes=doctor_notes,
        )

        elapsed = round(datetime.now().timestamp() * 1000 - start_ms)

        return {
            "status": "success",
            "patient_id": request.patient_id,
            "doctor_id": request.doctor_id,
            "generated_at": datetime.now().isoformat(),
            "processing_time_ms": elapsed,
            "visit_date_evaluated": latest_visit.get("visit_date"),
            "lab_reports_on_file": len(lab_reports),
            "primary_diagnosis": primary_diagnosis,
            "icd10_code": icd10_code,
            "validated_investigations": result["validated_investigations"],
            "return_notes": result["return_notes"],
            "summary": result["summary"],
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Ordering validation endpoint failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health")
async def ordering_health():
    return {
        "status": "ok",
        "module": "investigation_ordering",
        "version": "1.3.0",
        "input": "patient_id + doctor_id only",
        "source_collections": {
            "visits": "patientVisitHistory",
            "lab_reports": LAB_REPORTS_COLLECTION_NAME,
        },
        "classifications": ["ASSOCIATIVE", "ADVANCED"],
        "justification_fields": [
            "test_type_reason",
            "order_justification",
            "clinical_rationale",
            "flag_reason",
            "suggested_action",
        ],
        "rule": (
            "Advanced tests require associative workup or documented "
            "justification."
        ),
    }