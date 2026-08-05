"""
doctor_review.py — Doctor Review backend router

Auth: uses existing cookie JWT (same SECRET_KEY, ALGORITHM as rest of app).
Only role == 'auditing-doctor' can access.
Doctor identified by sys_user_id from JWT, matched against qcDecision.doctor_id.

Key enhancement: each claim detail response now includes full claim data
(claimant info, policy, hospital, accident/death details etc.) alongside
investigator submissions, so the doctor can cross-verify everything.

Verification state (tick/cross per field/document) is persisted in the
doctorVerification sub-document on the claim.
"""

import os
import re
from datetime import datetime
from typing import List, Optional, Dict, Any

import httpx
from motor.motor_asyncio import AsyncIOMotorClient as _AsyncMotorClient
from fastapi import APIRouter, HTTPException, Request, Depends
from pymongo import MongoClient
from pydantic import BaseModel
from jose import jwt, JWTError

# ─── Init ──────────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/doctor", tags=["Doctor Review"])

_client = MongoClient(os.getenv("MONGO_URI"))
_db     = _client["doctorassistai"]

CLAIMS         = _db["insurance_claims_new"]
SUBMISSIONS    = _db["task_submissions"]
PROCESSED_DOCS = _db["processed_documents"]
USER_AUTH      = _db["user_auth"]

STORAGE_BASE = "https://doctorassist.ai//uploads"
SECRET_KEY   = os.getenv("SECRET_KEY")
ALGORITHM    = os.getenv("ALGORITHM")

# ─── Async Mongo client for agent result reads ─────────────────────────────────
_async_mongo       = _AsyncMotorClient(os.getenv("MONGO_URI", ""))
_async_db          = _async_mongo[os.getenv("MONGO_DB_NAME", "doctorassistai")]
_engine_results_col = _async_db["processed_engine_results"]

# ─── Agentic service base URL (internal docker network) ───────────────────────
AGENTIC_BASE = os.getenv("AGENTIC_BASE_URL", "http://agentic:8000")

INV_TYPES = ["MV", "HV", "HVI", "TELE", "BILL"]

INV_LABELS = {
    "MV":   "Medical Visit",
    "HV":   "Hospital Visit",
    "HVI":  "Home / Neighbour Visit",
    "TELE": "Telephone Verification",
    "BILL": "Bill Verification",
}

TEXT_KEYS = {
    "mv_visit_date", "mv_remarks",
    "hv_doctor_name", "hv_observations",
    "hvi_neighbour", "hvi_remarks",
    "tele_person", "tele_datetime", "tele_summary",
    "bill_amount", "bill_notes",
}

DOC_KEY_LABELS = {
    "id_proof_of_patient":              "ID Proof – Patient",
    "policy_card___health_card":        "Policy / Health Card",
    "id_of_person_filling_mvf":         "ID – MVF Filler",
    "discharge_summary":                "Discharge Summary",
    "doctor_statement":                 "Doctor Statement",
    "hospital_records":                 "Hospital Records",
    "op_card":                          "OP Card",
    "neighbour_statement":              "Neighbour Statement",
    "residence_proof":                  "Residence Proof",
    "call_recording":                   "Call Recording",
    "pharmacy_bill":                    "Pharmacy Bill",
    "discharge_bill":                   "Discharge Bill",
    "report_format":                    "Report Format",
    "check_for_cl___rsby_availability": "CL / RSBY Check",
    "id_proof_patient":                 "ID Proof – Patient",
    "id_proof_mvf":                     "ID Proof – MVF",
    "policy_card":                      "Policy Card",
    "investigation_reports":            "Investigation Reports",
    "bill_copy":                        "Bill Copy",
    "driving_license":                  "Driving License",
    "scar_photo":                       "Scar Photo",
    "lab_bill":                         "Lab Bill",
    "check_for_discounts":              "Discount Check",
}

# Fields from insurance_claims_new that doctors should verify
# Each entry: (field_path, label, category)
CLAIM_VERIFY_FIELDS = [
    # Claimant identity
    ("claimantName",    "Claimant Name",      "identity"),
    ("claimantMobile",  "Mobile Number",      "identity"),
    ("claimantEmail",   "Email",              "identity"),
    ("claimantAge",     "Age",                "identity"),
    ("relationship",    "Relationship",       "identity"),
    ("idProofType",     "ID Proof Type",      "identity"),
    ("idProofNumber",   "ID Proof Number",    "identity"),
    ("claimantAddress", "Address",            "identity"),
    ("city",            "City",               "identity"),
    ("district",        "District",           "identity"),
    ("pinCode",         "Pin Code",           "identity"),
    # Policy
    ("insurer",         "Insurer",            "policy"),
    ("policyNumber",    "Policy Number",      "policy"),
    ("policyType",      "Policy Type",        "policy"),
    ("sumInsured",      "Sum Insured",        "policy"),
    # Claim
    ("claimedAmount",   "Claimed Amount",     "claim"),
    ("dateOfIncident",  "Date of Incident",   "claim"),
    ("claimMode",       "Claim Mode",         "claim"),
    ("claimSubtype",    "Claim Subtype",       "claim"),
    ("description",     "Description",        "claim"),
]


# ─── Auth ───────────────────────────────────────────────────────────────────────

def get_auditing_doctor(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Token expired or invalid")
    if payload.get("role") != "auditing-doctor":
        raise HTTPException(status_code=403, detail="Access restricted to auditing doctors")
    user = USER_AUTH.find_one({"sys_user_id": payload.get("sub")}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# ─── Me endpoint ───────────────────────────────────────────────────────────────

@router.get("/me")
def get_me(user: dict = Depends(get_auditing_doctor)):
    return {
        "sys_user_id": user.get("sys_user_id"),
        "full_name":   user.get("full_name", ""),
        "username":    user.get("username", ""),
        "role":        user.get("role"),
    }


# ─── File / entity helpers ─────────────────────────────────────────────────────

def _normalize_doc_key(label: str) -> str:
    key = label.lower()
    key = re.sub(r'[^a-z0-9]+', '_', key)
    return key.strip('_')


def _get_path(value) -> Optional[str]:
    if not value:
        return None
    if isinstance(value, str):
        v = value.strip()
        # ✅ Accept voice-note sentinel
        return v if v and ("/" in v or v.startswith("http") or v == "voice-note") else None
    if isinstance(value, dict):
        p = value.get("path", "")
        if isinstance(p, str):
            p = p.strip()
            return p if p and ("/" in p or p.startswith("http") or p == "voice-note") else None
    return None


def _full_url(path: str) -> Optional[str]:
    if not path or not isinstance(path, str):
        return None
    v = path.strip()
    if not v:
        return None
    # ✅ Voice notes have no real file — no iframe/View button
    if v == "voice-note":
        return None
    if v.startswith("http://") or v.startswith("https://"):
        return v
    if "/" not in v:
        return None
    return f"{STORAGE_BASE}/files/{v}"


def _get_document_id(value) -> Optional[str]:
    return value.get("document_id") or None if isinstance(value, dict) else None


def _get_file_name(value) -> Optional[str]:
    return value.get("file_name") or None if isinstance(value, dict) else None


def _is_file(value) -> bool:
    return _get_path(value) is not None



def _fmt(dt) -> str:
    if not dt:
        return "—"
    try:
        if isinstance(dt, str):
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        return dt.strftime("%-d %b %Y, %H:%M")
    except Exception:
        return str(dt)


def _find_form_val(form_data: dict, normalized_key: str):
    if normalized_key in form_data:
        return form_data[normalized_key]
    for k, v in form_data.items():
        if _normalize_doc_key(k) == normalized_key:
            return v
    return None


def _get_submission_for_entry(all_subs: dict, inv_type: str, user_id: str) -> dict:
    inv_subs = all_subs.get(inv_type, {})
    if not inv_subs:
        return {}
    if user_id and user_id in inv_subs:
        return inv_subs[user_id]
    return next(iter(inv_subs.values()), {})


def _get_extracted_for_file(case_id: str, form_value) -> List[dict]:
    if not form_value:
        return []
    doc = None
    doc_id = _get_document_id(form_value)
    if doc_id:
        doc = PROCESSED_DOCS.find_one(
            {"document_id": doc_id},
            {"entities": 1, "_id": 0}
        )
    if not doc:
        path = _get_path(form_value)
        if path:
            filename = path.strip().split("/")[-1]
            doc = PROCESSED_DOCS.find_one(
                {
                    "patient_id": case_id,
                    "$or": [
                        {"file_name": filename},
                        {"metadata.file_name": filename},
                        {"file_url": {"$regex": filename, "$options": "i"}},
                    ]
                },
                {"entities": 1, "_id": 0}
            )
    if not doc:
        return []
    return [
        {
            "entity_type":   e.get("entity_type", ""),
            "entity_name":   e.get("entity_name", ""),
            "entity_value":  e.get("entity_value"),
            "confidence":    round(float(e.get("confidence", 0.9)), 2),
            "evidence_text": e.get("evidence_text", ""),
        }
        for e in doc.get("entities", [])
        if e.get("entity_type") not in ("Document Date",) and e.get("entity_name")
    ][:30]


def _load_submissions(case_id: str) -> dict:
    doc = SUBMISSIONS.find_one({"task_id": case_id}, {"_id": 0})
    return doc.get("submissions", {}) if doc else {}


def _count_docs(claim: dict, all_subs: dict) -> dict:
    total = submitted = 0
    for inv_type in INV_TYPES:
        for entry in claim.get("investigations", {}).get(inv_type, []):
            if not isinstance(entry, dict):
                continue
            assigned = [_normalize_doc_key(d) for d in entry.get("documents", [])]
            total += len(assigned)
            ts = _get_submission_for_entry(all_subs, inv_type, entry.get("investigatorId", ""))

            # Also check embedded submission on the entry
            embedded_sub = entry.get("submission") or {}
            form_data = (
                ts.get("form_data", {})
                or embedded_sub.get("form_data", {})
                or {}
            )
            for dk in assigned:
                if _is_file(_find_form_val(form_data, dk)):
                    submitted += 1
            for dk, fv in form_data.items():
                if _normalize_doc_key(dk) not in assigned and dk not in TEXT_KEYS and _is_file(fv):
                    total += 1
                    submitted += 1
    return {"total": total, "submitted": submitted}


def _build_investigations(case_id: str, claim: dict, all_subs: dict, verif: dict) -> dict:
    result = {}
    doc_verif = verif.get("documents", {})

    for inv_type in INV_TYPES:
        entries = claim.get("investigations", {}).get(inv_type, [])
        if not entries:
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            inv_name = entry.get("investigatorName") or entry.get("investigator") or "Unknown"
            user_id  = entry.get("investigatorId") or ""
            req_docs = [_normalize_doc_key(d) for d in (entry.get("documents", []) or [])]

            ts       = _get_submission_for_entry(all_subs, inv_type, user_id)
            embedded = entry.get("submission") or {}

            if ts:
                form_data    = ts.get("form_data", {}) or {}
                submitted_at = ts.get("submitted_at")
                status       = ts.get("status", "PENDING")
                submitted_by = ts.get("submitted_by", "")
            elif embedded:
                form_data    = embedded.get("form_data", {}) or {}
                submitted_at = embedded.get("submitted_at")
                status       = embedded.get("status", "PARTIAL")
                submitted_by = embedded.get("submitted_by", "")
            else:
                form_data, submitted_at, status, submitted_by = {}, None, "PENDING", ""

            docs_detail = []
            seen_keys   = set()

            for dk in req_docs:
                seen_keys.add(dk)
                fv        = _find_form_val(form_data, dk)
                path      = _get_path(fv)
                file_url  = _full_url(path) if path else None
                entities  = _get_extracted_for_file(case_id, fv) if path else []
                doc_key   = f"{inv_type}:{dk}"
                docs_detail.append({
                    "key":              dk,
                    "doc_key":          doc_key,
                    "label":            DOC_KEY_LABELS.get(dk, dk.replace("_", " ").title()),
                    "submitted":        bool(path),
                    "file_url":         file_url,
                    "file_name":        _get_file_name(fv) or (path.split("/")[-1] if path else None),
                    "document_id":      _get_document_id(fv),
                    "entities":         entities,
                    "verified":         doc_verif.get(doc_key),  # True | False | None
                    "verified_at":      verif.get("doc_verified_at", {}).get(doc_key),
                })

            for raw_dk, fv in form_data.items():
                ndk = _normalize_doc_key(raw_dk)        # normalize the form key too
                if ndk in seen_keys or raw_dk in seen_keys:   # check both
                    continue
                if raw_dk in TEXT_KEYS or ndk in TEXT_KEYS:
                    continue
                if not _is_file(fv):
                    continue
                seen_keys.add(ndk)                      # prevent future duplicates
                path     = _get_path(fv)
                file_url = _full_url(path) if path else None
                doc_key  = f"{inv_type}:{ndk}"
                docs_detail.append({
                    "key":         ndk,
                    "doc_key":     doc_key,
                    "label":       DOC_KEY_LABELS.get(ndk, ndk.replace("_", " ").title()),
                    "submitted":   True,
                    "file_url":    file_url,
                    "file_name":   _get_file_name(fv) or (path.split("/")[-1] if path else None),
                    "document_id": _get_document_id(fv),
                    "entities":    _get_extracted_for_file(case_id, fv),
                    "verified":    doc_verif.get(doc_key),
                    "verified_at": verif.get("doc_verified_at", {}).get(doc_key),
                })

            text_fields = {k: v for k, v in form_data.items() if k in TEXT_KEYS and v}

            result[inv_type] = {
                "label":            INV_LABELS.get(inv_type, inv_type),
                "investigatorName": inv_name,
                "investigatorId":   user_id,
                "submittedBy":      submitted_by,
                "docs":             docs_detail,
                "submission": {
                    "status":       status,
                    "submitted_at": _fmt(submitted_at) if submitted_at else None,
                    "text_fields":  text_fields,
                } if (form_data or status != "PENDING") else None,
            }
    return result


def _build_claim_fields(claim: dict, verif: dict) -> List[dict]:
    """
    Build a structured list of claim fields for doctor verification,
    pulling nested data from hospitalDetails, accidentDetails, etc.
    """
    field_verif    = verif.get("fields", {})
    field_verif_at = verif.get("field_verified_at", {})

    rows = []
    for field_path, label, category in CLAIM_VERIFY_FIELDS:
        value = claim.get(field_path)
        if value is None or value == "" or value == []:
            continue
        rows.append({
            "key":         field_path,
            "label":       label,
            "category":    category,
            "value":       str(value),
            "verified":    field_verif.get(field_path),
            "verified_at": field_verif_at.get(field_path),
        })

    # Pull hospital details if present
    hosp = claim.get("hospitalDetails") or {}
    for k, lbl in [
        ("hospitalName",   "Hospital Name"),
        ("hospitalAddress","Hospital Address"),
        ("admissionDate",  "Admission Date"),
        ("dischargeDate",  "Discharge Date"),
        ("ward",           "Ward"),
        ("treatingDoctor", "Treating Doctor"),
    ]:
        v = hosp.get(k)
        if v:
            key = f"hospitalDetails.{k}"
            rows.append({
                "key":         key,
                "label":       lbl,
                "category":    "hospital",
                "value":       str(v),
                "verified":    field_verif.get(key),
                "verified_at": field_verif_at.get(key),
            })

    # Accident details
    acc = claim.get("accidentDetails") or {}
    for k, lbl in [
        ("dateTime",          "Accident Date/Time"),
        ("place",             "Accident Place"),
        ("patientNarration",  "Patient Narration"),
        ("policeReportNumber","FIR / Police Report"),
    ]:
        v = acc.get(k)
        if v:
            key = f"accidentDetails.{k}"
            rows.append({
                "key":         key,
                "label":       lbl,
                "category":    "accident",
                "value":       str(v),
                "verified":    field_verif.get(key),
                "verified_at": field_verif_at.get(key),
            })

    # Death details
    death = claim.get("deathDetails") or {}
    for k, lbl in [
        ("date",               "Death Date"),
        ("time",               "Death Time"),
        ("reason",             "Cause of Death"),
        ("beneficiaryName",    "Beneficiary"),
        ("incidentNarration",  "Incident Narration"),
    ]:
        v = death.get(k)
        if v:
            key = f"deathDetails.{k}"
            rows.append({
                "key":         key,
                "label":       lbl,
                "category":    "death",
                "value":       str(v),
                "verified":    field_verif.get(key),
                "verified_at": field_verif_at.get(key),
            })

    # Cashless / reimbursement
    cash = claim.get("cashlessDetails") or {}
    for k, lbl in [
        ("admissionType", "Admission Type"),
        ("estimatedCost", "Estimated Cost"),
    ]:
        v = cash.get(k)
        if v:
            key = f"cashlessDetails.{k}"
            rows.append({
                "key":         key,
                "label":       lbl,
                "category":    "financial",
                "value":       str(v),
                "verified":    field_verif.get(key),
                "verified_at": field_verif_at.get(key),
            })

    reimb = claim.get("reimbursementDetails") or {}
    for k, lbl in [
        ("accountName", "Account Name"),
        ("ifsc",        "IFSC Code"),
        ("bankDetails", "Bank Details"),
    ]:
        v = reimb.get(k)
        if v:
            key = f"reimbursementDetails.{k}"
            rows.append({
                "key":         key,
                "label":       lbl,
                "category":    "financial",
                "value":       str(v),
                "verified":    field_verif.get(key),
                "verified_at": field_verif_at.get(key),
            })

    return rows


# ─── Agent datetime sanitiser ──────────────────────────────────────────────────

def _sanitize_dt(obj):
    """Recursively convert datetime objects to ISO strings."""
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _sanitize_dt(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_dt(v) for v in obj]
    return obj


# ─── Request models ─────────────────────────────────────────────────────────────

class ApproveRequest(BaseModel):
    diagnosis: Optional[str] = ""
    remarks:   Optional[str] = ""


class RejectRequest(BaseModel):
    reason:  str
    remarks: Optional[str] = ""


class RequestInfoRequest(BaseModel):
    message: str


class VerifyFieldRequest(BaseModel):
    """Doctor verifies (tick) or disputes (cross) a specific claim field."""
    key:      str             # field_path or doc_key
    kind:     str             # "field" | "document"
    verified: Optional[bool] = None   # True=tick, False=cross, None=clear


class BulkVerifyRequest(BaseModel):
    verifications: List[VerifyFieldRequest]


class AgentRunRequest(BaseModel):
    pass  # no body needed — case_id from path, doctor from auth


# ─── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/claims")
def get_doctor_claims(
    search: Optional[str] = None,
    status: Optional[str] = None,
    limit:  int = 50,
    skip:   int = 0,
    user:   dict = Depends(get_auditing_doctor),
):
    query: Dict[str, Any] = {
        "qcDecision.action":    "APPROVE",
        "qcDecision.doctor_id": user.get("sys_user_id"),
    }
    if status and status not in ("All", ""):
        query["status"] = status
    if search:
        query["$or"] = [
            {"caseId":       {"$regex": search, "$options": "i"}},
            {"claimantName": {"$regex": search, "$options": "i"}},
        ]

    raw = list(CLAIMS.find(query, {"_id": 0}).sort("updatedAt", -1).skip(skip).limit(limit))

    out = []
    for claim in raw:
        case_id  = claim.get("caseId", "")
        all_subs = _load_submissions(case_id)
        counts   = _count_docs(claim, all_subs)
        qc       = claim.get("qcDecision", {})
        verif    = claim.get("doctorVerification", {})
        mode     = claim.get("claimMode", "") or ""
        sub      = claim.get("claimSubtype", "") or claim.get("claimSubType", "") or ""

        # Compute verification progress
        total_fields = len(_build_claim_fields(claim, {}))
        verified_fields = len([
            k for k, v in verif.get("fields", {}).items() if v is True
        ])
        verified_docs = len([
            k for k, v in verif.get("documents", {}).items() if v is True
        ])
        disputed_count = len([
            k for k, v in {**verif.get("fields", {}), **verif.get("documents", {})}.items()
            if v is False
        ])

        out.append({
            "id":              case_id,
            "type":            f"{mode.title()} — {sub.title()}".strip(" —") or "Unknown",
            "claimantName":    claim.get("claimantName", "Unknown"),
            "insurer":         claim.get("insurer", "—"),
            "priority":        claim.get("claimPriority", "Normal"),
            "status":          claim.get("status", "VERIFIED"),
            "claimedAmount":   claim.get("claimedAmount"),
            "targetDate":      str(claim.get("targetDate", "—")),
            "docsSubmitted":   counts["submitted"],
            "docsTotal":       counts["total"],
            "qcRemarks":       qc.get("remarks", ""),
            "verifiedAt":      _fmt(qc.get("decidedAt")),
            "doctorDecision":  claim.get("doctorDecision"),
            "verifiedFields":  verified_fields,
            "totalFields":     total_fields,
            "verifiedDocs":    verified_docs,
            "totalDocs":       counts["total"],
            "disputedCount":   disputed_count,
        })

    return {
        "claims": out,
        "total":  CLAIMS.count_documents(query),
        "doctor": user.get("full_name", ""),
    }


@router.get("/claims/{case_id}")
def get_doctor_claim_detail(
    case_id: str,
    user:    dict = Depends(get_auditing_doctor),
):
    claim = CLAIMS.find_one({"caseId": case_id}, {"_id": 0})
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    qc = claim.get("qcDecision", {})
    if qc.get("action") != "APPROVE" or qc.get("doctor_id") != user.get("sys_user_id"):
        raise HTTPException(status_code=403, detail="Not assigned to you")

    all_subs  = _load_submissions(case_id)
    verif     = claim.get("doctorVerification", {})
    invs      = _build_investigations(case_id, claim, all_subs, verif)
    counts    = _count_docs(claim, all_subs)
    mode      = claim.get("claimMode", "") or ""
    sub_type  = claim.get("claimSubtype", "") or ""

    claim_fields = _build_claim_fields(claim, verif)

    # Verification summary
    all_verif       = {**verif.get("fields", {}), **verif.get("documents", {})}
    verified_count  = sum(1 for v in all_verif.values() if v is True)
    disputed_count  = sum(1 for v in all_verif.values() if v is False)
    total_checkable = len(claim_fields) + counts["total"]

    return {
        "id":            case_id,
        "type":          f"{mode.title()} — {sub_type.title()}".strip(" —"),
        "claimantName":  claim.get("claimantName", "Unknown"),
        "insurer":       claim.get("insurer", "—"),
        "priority":      claim.get("claimPriority", "Normal"),
        "status":        claim.get("status", "VERIFIED"),
        "claimedAmount": claim.get("claimedAmount"),
        "sumInsured":    claim.get("sumInsured"),
        "targetDate":    str(claim.get("targetDate", "—")),
        "docsSubmitted": counts["submitted"],
        "docsTotal":     counts["total"],
        "qcRemarks":     qc.get("remarks", ""),
        "verifiedAt":    _fmt(qc.get("decidedAt")),
        "doctorDecision":      claim.get("doctorDecision"),
        "claimFields":         claim_fields,
        "investigations":      invs,
        "verificationSummary": {
            "verified":    verified_count,
            "disputed":    disputed_count,
            "total":       total_checkable,
            "lastSavedAt": _fmt(verif.get("lastSavedAt")),
        },
        # Raw sub-objects doctors may want to see
        "hospitalDetails":      claim.get("hospitalDetails"),
        "accidentDetails":      claim.get("accidentDetails"),
        "deathDetails":         claim.get("deathDetails"),
        "cashlessDetails":      claim.get("cashlessDetails"),
        "reimbursementDetails": claim.get("reimbursementDetails"),
        "tags":                 claim.get("tags", []),
        "description":          claim.get("description", ""),
    }


@router.post("/claims/{case_id}/verify")
def doctor_verify_field(
    case_id: str,
    body:    VerifyFieldRequest,
    user:    dict = Depends(get_auditing_doctor),
):
    """
    Persist a single tick/cross/clear for a field or document.
    Idempotent — can be called on every toggle.
    """
    claim = CLAIMS.find_one({"caseId": case_id}, {"_id": 0, "qcDecision": 1})
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.get("qcDecision", {}).get("doctor_id") != user.get("sys_user_id"):
        raise HTTPException(status_code=403, detail="Not assigned to you")

    now = datetime.utcnow()
    if body.kind == "field":
        field_key = f"doctorVerification.fields.{body.key}"
        at_key    = f"doctorVerification.field_verified_at.{body.key}"
    else:
        field_key = f"doctorVerification.documents.{body.key}"
        at_key    = f"doctorVerification.doc_verified_at.{body.key}"

    if body.verified is None:
        CLAIMS.update_one({"caseId": case_id}, {
            "$unset": {field_key: "", at_key: ""},
            "$set":   {"doctorVerification.lastSavedAt": now, "updatedAt": now},
        })
    else:
        CLAIMS.update_one({"caseId": case_id}, {"$set": {
            field_key: body.verified,
            at_key:    now,
            "doctorVerification.lastSavedAt": now,
            "updatedAt": now,
        }})
    return {"status": "ok", "key": body.key, "verified": body.verified}


@router.post("/claims/{case_id}/verify/bulk")
def doctor_verify_bulk(
    case_id: str,
    body:    BulkVerifyRequest,
    user:    dict = Depends(get_auditing_doctor),
):
    """Batch-set multiple verifications in one round-trip."""
    claim = CLAIMS.find_one({"caseId": case_id}, {"_id": 0, "qcDecision": 1})
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.get("qcDecision", {}).get("doctor_id") != user.get("sys_user_id"):
        raise HTTPException(status_code=403, detail="Not assigned to you")

    now       = datetime.utcnow()
    set_doc   = {"doctorVerification.lastSavedAt": now, "updatedAt": now}
    unset_doc = {}

    for v in body.verifications:
        if v.kind == "field":
            fk = f"doctorVerification.fields.{v.key}"
            ak = f"doctorVerification.field_verified_at.{v.key}"
        else:
            fk = f"doctorVerification.documents.{v.key}"
            ak = f"doctorVerification.doc_verified_at.{v.key}"
        if v.verified is None:
            unset_doc[fk] = ""
            unset_doc[ak] = ""
        else:
            set_doc[fk] = v.verified
            set_doc[ak] = now

    update: Dict[str, Any] = {"$set": set_doc}
    if unset_doc:
        update["$unset"] = unset_doc
    CLAIMS.update_one({"caseId": case_id}, update)
    return {"status": "ok", "count": len(body.verifications)}


@router.post("/claims/{case_id}/approve")
def doctor_approve(
    case_id: str,
    body:    ApproveRequest,
    user:    dict = Depends(get_auditing_doctor),
):
    claim = CLAIMS.find_one({"caseId": case_id}, {"_id": 0, "qcDecision": 1})
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.get("qcDecision", {}).get("doctor_id") != user.get("sys_user_id"):
        raise HTTPException(status_code=403, detail="Not assigned to you")
    full_name = user.get("full_name", "")
    now = datetime.utcnow()
    CLAIMS.update_one({"caseId": case_id}, {"$set": {
        "status": "DOCTOR_VERIFIED",          # ← changed from DOCTOR_APPROVED
        "doctorDecision": {
            "action":    "APPROVE",
            "doctor":    full_name,
            "diagnosis": body.diagnosis or "",
            "remarks":   body.remarks or "",
            "decidedAt": now,
        },
        "doctorVerification.completedAt": now,
        "updatedAt": now,
    }})
    return {"status": "success", "message": f"Claim {case_id} approved and marked DOCTOR_VERIFIED"}
    
@router.post("/claims/{case_id}/reject")
def doctor_reject(
    case_id: str,
    body:    RejectRequest,
    user:    dict = Depends(get_auditing_doctor),
):
    claim = CLAIMS.find_one({"caseId": case_id}, {"_id": 0, "qcDecision": 1})
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.get("qcDecision", {}).get("doctor_id") != user.get("sys_user_id"):
        raise HTTPException(status_code=403, detail="Not assigned to you")
    full_name = user.get("full_name", "")
    CLAIMS.update_one({"caseId": case_id}, {"$set": {
        "status": "DOCTOR_REJECTED",
        "doctorDecision": {
            "action":  "REJECT",
            "doctor":  full_name,
            "reason":  body.reason,
            "remarks": body.remarks or "",
            "decidedAt": datetime.utcnow(),
        },
        "updatedAt": datetime.utcnow(),
    }})
    return {"status": "success", "message": f"Claim {case_id} rejected"}


@router.post("/claims/{case_id}/request-info")
def doctor_request_info(
    case_id: str,
    body:    RequestInfoRequest,
    user:    dict = Depends(get_auditing_doctor),
):
    claim = CLAIMS.find_one({"caseId": case_id}, {"_id": 0, "qcDecision": 1})
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.get("qcDecision", {}).get("doctor_id") != user.get("sys_user_id"):
        raise HTTPException(status_code=403, detail="Not assigned to you")
    full_name = user.get("full_name", "")
    CLAIMS.update_one({"caseId": case_id}, {"$set": {
        "status": "INFO_REQUESTED",
        "doctorDecision": {
            "action":      "REQUEST_INFO",
            "doctor":      full_name,
            "message":     body.message,
            "requestedAt": datetime.utcnow(),
        },
        "updatedAt": datetime.utcnow(),
    }})
    return {"status": "success", "message": f"Info requested for claim {case_id}"}


# ─── Agent analysis endpoints ──────────────────────────────────────────────────

@router.post("/claims/{case_id}/run-agent")
async def run_agent_analysis(
    case_id: str,
    user:    dict = Depends(get_auditing_doctor),
):
    """
    Trigger the clinical reasoning agentic pipeline for a claim.
    Calls the agentic docker service via HTTP (cross-container).
    case_id == patient_id in the agentic system.
    """
    claim = CLAIMS.find_one({"caseId": case_id}, {"_id": 0, "qcDecision": 1})
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.get("qcDecision", {}).get("doctor_id") != user.get("sys_user_id"):
        raise HTTPException(status_code=403, detail="Not assigned to you")

    doctor_id = user.get("sys_user_id", "")

    payload = {
        "patient_id":        case_id,
        "doctor_id":         doctor_id,
        "consultation_text": "",
    }

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(
    f"{AGENTIC_BASE}/helo/clinical-reasoning",
    json=payload,
)
            resp.raise_for_status()
            result = resp.json()
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail="Agent timed out — pipeline took longer than 5 minutes",
        )
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Agentic service error: {e.response.text[:300]}",
        )
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Agentic service unreachable: {str(e)}",
        )

    # Record that the agent was run on this claim
    CLAIMS.update_one(
        {"caseId": case_id},
        {"$set": {
            "agentAnalysis.lastRunAt": datetime.utcnow(),
            "agentAnalysis.runBy":     doctor_id,
            "agentAnalysis.status":    result.get("status", "error"),
            "updatedAt":               datetime.utcnow(),
        }}
    )

    return result


@router.get("/claims/{case_id}/agent-result")
async def get_agent_result(
    case_id: str,
    user:    dict = Depends(get_auditing_doctor),
):
    """
    Fetch the latest cached agent result from processed_engine_results.
    Written by the agentic pipeline after each run.
    """
    claim = CLAIMS.find_one(
        {"caseId": case_id},
        {"_id": 0, "qcDecision": 1, "agentAnalysis": 1},
    )
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.get("qcDecision", {}).get("doctor_id") != user.get("sys_user_id"):
        raise HTTPException(status_code=403, detail="Not assigned to you")

    result = await _engine_results_col.find_one(
        {"patient_id": case_id, "record_type": "composite"},
        {"_id": 0},
    )

    if not result:
        return {
            "status":         "not_found",
            "agent_run_info": _sanitize_dt(claim.get("agentAnalysis")),
        }

    return {
        "status":         "success",
        "data":           _sanitize_dt(result),
        "agent_run_info": _sanitize_dt(claim.get("agentAnalysis")),
    }
@router.post("/claims/{case_id}/complete-verification")
def complete_doctor_verification(
    case_id: str,
    user:    dict = Depends(get_auditing_doctor),
):
    """
    Called when doctor finishes reviewing all fields and documents.
    Checks that everything is verified (no pending, no disputed),
    then sets status to DOCTOR_VERIFIED.
    """
    claim = CLAIMS.find_one({"caseId": case_id}, {"_id": 0})
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.get("qcDecision", {}).get("doctor_id") != user.get("sys_user_id"):
        raise HTTPException(status_code=403, detail="Not assigned to you")

    verif     = claim.get("doctorVerification", {})
    all_subs  = _load_submissions(case_id)
    counts    = _count_docs(claim, all_subs)

    # Count expected verifiable items
    claim_fields   = _build_claim_fields(claim, verif)
    total_fields   = len(claim_fields)
    total_docs     = counts["total"]
    total_expected = total_fields + total_docs

    # Count what's actually verified
    field_verifs = verif.get("fields", {})
    doc_verifs   = verif.get("documents", {})

    # Flatten nested field verifs (e.g. hospitalDetails.admissionDate stored nested)
    def _flatten_verifs(d: dict, prefix: str = "") -> dict:
        flat = {}
        for k, v in d.items():
            full_key = f"{prefix}.{k}" if prefix else k
            if isinstance(v, dict):
                flat.update(_flatten_verifs(v, full_key))
            else:
                flat[full_key] = v
        return flat

    flat_field_verifs = _flatten_verifs(field_verifs)
    verified_count    = sum(1 for v in flat_field_verifs.values() if v is True)
    verified_count   += sum(1 for v in doc_verifs.values() if v is True)
    disputed_count    = sum(1 for v in flat_field_verifs.values() if v is False)
    disputed_count   += sum(1 for v in doc_verifs.values() if v is False)

    if disputed_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot complete: {disputed_count} item(s) are disputed. Resolve or remove disputes first.",
        )

    if verified_count < total_expected:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot complete: only {verified_count}/{total_expected} items verified. Verify all items first.",
        )

    now = datetime.utcnow()
    CLAIMS.update_one(
        {"caseId": case_id},
        {"$set": {
            "status":    "DOCTOR_VERIFIED",
            "doctorVerification.completedAt": now,
            "updatedAt": now,
        }}
    )

    return {
        "status":  "success",
        "message": f"Claim {case_id} marked as DOCTOR_VERIFIED",
        "verified_items": verified_count,
        "total_items":    total_expected,
    }