"""
qc_review.py — QC Review backend router (v3)
"""

import os
import re
from datetime import datetime
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, HTTPException, Request
from pymongo import MongoClient
from pydantic import BaseModel

# ─── Init ──────────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/qc", tags=["QC Review"])

_client = MongoClient(os.getenv("MONGO_URI"))
_db = _client["doctorassistai"]

CLAIMS          = _db["insurance_claims_new"]
SUBMISSIONS     = _db["task_submissions"]
PROCESSED_DOCS  = _db["processed_documents"]
USER_AUTH       = _db["user_auth"]

STORAGE_BASE = "https://doctorassist.ai/uploads"

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
    "id_proof_of_patient":               "ID Proof – Patient",
    "policy_card___health_card":         "Policy / Health Card",
    "id_of_person_filling_mvf":          "ID – MVF Filler",
    "discharge_summary":                 "Discharge Summary",
    "doctor_statement":                  "Doctor Statement",
    "hospital_records":                  "Hospital Records",
    "op_card":                           "OP Card",
    "neighbour_statement":               "Neighbour Statement",
    "residence_proof":                   "Residence Proof",
    "call_recording":                    "Call Recording",
    "pharmacy_bill":                     "Pharmacy Bill",
    "discharge_bill":                    "Discharge Bill",
    "report_format":                     "Report Format",
    "check_for_cl___rsby_availability":  "CL / RSBY Check",
    "id_proof_patient":                  "ID Proof – Patient",
    "id_proof_mvf":                      "ID Proof – MVF",
    "policy_card":                       "Policy Card",
    "investigation_reports":             "Investigation Reports",
    "bill_copy":                         "Bill Copy",
    "driving_license":                   "Driving License",
    "scar_photo":                        "Scar Photo",
}


# ─── Helpers ───────────────────────────────────────────────────────────────────

def _get_path(value) -> Optional[str]:
    if not value:
        return None
    if isinstance(value, str):
        v = value.strip()
        # ✅ Accept voice-note sentinel in addition to paths/URLs
        return v if v and ("/" in v or v.startswith("http") or v == "voice-note") else None
    if isinstance(value, dict):
        path = value.get("path", "")
        if isinstance(path, str):
            p = path.strip()
            return p if p and ("/" in p or p.startswith("http") or p == "voice-note") else None
    return None


def _get_document_id(value) -> Optional[str]:
    if isinstance(value, dict):
        return value.get("document_id") or None
    return None


def _get_file_name(value) -> Optional[str]:
    if isinstance(value, dict):
        return value.get("file_name") or None
    return None


def _is_file(value) -> bool:
    return _get_path(value) is not None


def _full_url(path: str) -> Optional[str]:
    if not path or not isinstance(path, str):
        return None
    v = path.strip()
    if not v:
        return None
    # ✅ Voice notes have no real file URL — return None so the View button isn't shown
    if v == "voice-note":
        return None
    if v.startswith("http://") or v.startswith("https://"):
        return v
    if "/" not in v:
        return None
    return f"{STORAGE_BASE}/files/{v}"


def _fmt(dt) -> str:
    if not dt:
        return "—"
    try:
        if isinstance(dt, str):
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        return dt.strftime("%-d %b %Y, %H:%M")
    except Exception:
        return str(dt)


def _get_submission_for_entry(all_subs: dict, inv_type: str, user_id: str) -> dict:
    inv_subs = all_subs.get(inv_type, {})
    if not inv_subs:
        return {}
    if user_id and user_id in inv_subs:
        return inv_subs[user_id]
    return next(iter(inv_subs.values()), {})


def _load_submissions(case_id: str) -> dict:
    doc = SUBMISSIONS.find_one({"task_id": case_id}, {"_id": 0})
    if not doc:
        return {}
    return doc.get("submissions", {})


def _get_extracted_for_file(case_id: str, form_value) -> dict:
    """Returns entities, raw_markdown, and sections for a file."""
    if not form_value:
        return {"entities": [], "raw_markdown": None, "sections": None}

    doc = None

    # Strategy 1: match by document_id
    document_id = _get_document_id(form_value)
    if document_id:
        doc = PROCESSED_DOCS.find_one(
            {"document_id": document_id},
            {"entities": 1, "file_url": 1, "file_name": 1,
             "raw_markdown": 1, "sections": 1, "_id": 0}
        )

    # Strategy 2: match by filename + patient_id
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
                {"entities": 1, "file_url": 1, "file_name": 1,
                 "raw_markdown": 1, "sections": 1, "_id": 0}
            )

    if not doc:
        return {"entities": [], "raw_markdown": None, "sections": None}

    entities = doc.get("entities", [])
    filtered_entities = [
        {
            "entity_type":   e.get("entity_type", ""),
            "entity_name":   e.get("entity_name", ""),
            "entity_value":  e.get("entity_value"),
            "confidence":    round(float(e.get("confidence", 0.9)), 2),
            "evidence_text": e.get("evidence_text", ""),
        }
        for e in entities
        if e.get("entity_type") not in ("Document Date",) and e.get("entity_name")
    ][:30]

    return {
        "entities":     filtered_entities,
        "raw_markdown": doc.get("raw_markdown"),
        "sections":     doc.get("sections"),
    }


def _normalize_doc_key(label: str) -> str:
    key = label.lower()
    key = re.sub(r'[^a-z0-9]+', '_', key)
    key = key.strip('_')
    return key


def _find_form_val(form_data: dict, normalized_key: str):
    if normalized_key in form_data:
        return form_data[normalized_key]
    for k, v in form_data.items():
        if _normalize_doc_key(k) == normalized_key:
            return v
    return None


def _count_docs(claim: dict, all_subs: dict) -> dict:
    total = submitted = 0
    inv = claim.get("investigations", {})
    for inv_type in INV_TYPES:
        entries = inv.get(inv_type, [])
        for entry in entries:
            if not isinstance(entry, dict):
                continue

            assigned = entry.get("documents", [])
            assigned_keys = [_normalize_doc_key(d) for d in assigned]
            total += len(assigned_keys)

            user_id = entry.get("investigatorId", "")
            ts = _get_submission_for_entry(all_subs, inv_type, user_id)
            form_data = ts.get("form_data", {}) or entry.get("submission", {}).get("form_data", {}) or {}

            for dk in assigned_keys:
                if _is_file(_find_form_val(form_data, dk)):
                    submitted += 1

            for dk, fv in form_data.items():
                if dk not in assigned_keys and dk not in TEXT_KEYS and _is_file(fv):
                    total += 1
                    submitted += 1

    return {"total": total, "submitted": submitted}


def _build_investigations(case_id: str, claim: dict, all_subs: dict) -> dict:
    inv_raw = claim.get("investigations", {})
    result = {}

    for inv_type in INV_TYPES:
        entries = inv_raw.get(inv_type, [])
        if not entries:
            continue

        for entry in entries:
            if not isinstance(entry, dict):
                continue

            inv_name = entry.get("investigatorName") or entry.get("investigator") or "Unknown"
            user_id  = entry.get("investigatorId") or ""
            req_docs = entry.get("documents", [])
            if not isinstance(req_docs, list):
                req_docs = []
            req_docs = [_normalize_doc_key(d) for d in req_docs]

            ts       = _get_submission_for_entry(all_subs, inv_type, user_id)
            embedded = entry.get("submission") or {}

            if ts:
                form_data    = ts.get("form_data", {}) or {}
                submitted_at = ts.get("submitted_at")
                status       = ts.get("status", "PENDING")
            elif embedded:
                form_data    = embedded.get("form_data", {}) or {}
                submitted_at = embedded.get("submitted_at")
                status       = embedded.get("status", "PARTIAL")
            else:
                form_data    = {}
                submitted_at = None
                status       = "PENDING"

            docs_detail = []
            for dk in req_docs:
                form_val  = _find_form_val(form_data, dk)
                path      = _get_path(form_val)
                doc_id    = _get_document_id(form_val)
                orig_name = _get_file_name(form_val)
                file_url  = _full_url(path) if path else None
                extracted = _get_extracted_for_file(case_id, form_val) if path else {}

                docs_detail.append({
                    "key":          dk,
                    "label":        DOC_KEY_LABELS.get(dk, dk.replace("_", " ").title()),
                    "submitted":    bool(path),
                    "file_url":     file_url,
                    "file_name":    orig_name or (path.split("/")[-1] if path else None),
                    "document_id":  doc_id,
                    "entities":     extracted.get("entities", []),
                    "raw_markdown": extracted.get("raw_markdown"),
                    "sections":     extracted.get("sections"),
                })

            text_fields = {
                k: v for k, v in form_data.items()
                if k in TEXT_KEYS and v
            }

            submission_out = None
            if form_data or status != "PENDING":
                submission_out = {
                    "status":       status,
                    "submitted_at": _fmt(submitted_at) if submitted_at else None,
                    "text_fields":  text_fields,
                }

            result[inv_type] = {
                "label":            INV_LABELS.get(inv_type, inv_type),
                "investigatorName": inv_name,
                "investigatorId":   user_id,
                "docs":             docs_detail,
                "submission":       submission_out,
            }

    return result


# ─── Request Models ─────────────────────────────────────────────────────────────

class VerifyRequest(BaseModel):
    doctor_id:   str
    doctor_name: str
    remarks:     Optional[str] = ""


class FlaggedDoc(BaseModel):
    invType: str
    docKey:  str


class ReinvestigateRequest(BaseModel):
    flaggedDocs: List[FlaggedDoc]
    remarks:     Optional[str] = ""


class EntityItem(BaseModel):
    entity_type:   str
    entity_name:   str
    entity_value:  Optional[str]   = None
    confidence:    Optional[float] = 0.99
    evidence_text: Optional[str]   = ""


class UpdateEntitiesRequest(BaseModel):
    entities: List[EntityItem]


class UpdateDocumentContentRequest(BaseModel):
    raw_markdown: Optional[str]  = None
    sections:     Optional[dict] = None


# ─── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/claims")
def get_qc_claims(
    status: Optional[str] = None,
    search: Optional[str] = None,
    limit:  int = 50,
    skip:   int = 0,
):
    query: Dict[str, Any] = {}

    if status and status not in ("All", ""):
        query["status"] = status
    else:
        query["status"] = {"$in": ["ALLOCATED", "COMPLETED", "IN_PROGRESS"]}

    if search:
        query["$or"] = [
            {"caseId":       {"$regex": search, "$options": "i"}},
            {"claimantName": {"$regex": search, "$options": "i"}},
        ]

    raw_claims = list(
        CLAIMS.find(query, {"_id": 0})
              .sort("createdAt", -1)
              .skip(skip)
              .limit(limit)
    )

    claims_out = []
    for claim in raw_claims:
        case_id    = claim.get("caseId", "")
        all_subs   = _load_submissions(case_id)
        doc_counts = _count_docs(claim, all_subs)

        claim_mode = claim.get("claimMode", "") or ""
        claim_sub  = claim.get("claimSubtype", "") or claim.get("claimSubType", "") or ""
        type_label = f"{claim_mode.title()} — {claim_sub.title()}".strip(" —") or "Unknown"

        claims_out.append({
            "id":            case_id,
            "type":          type_label,
            "claimantName":  claim.get("claimantName", "Unknown"),
            "insurer":       claim.get("insurer", "—"),
            "priority":      claim.get("claimPriority", "Normal"),
            "status":        claim.get("status", "ALLOCATED"),
            "claimedAmount": claim.get("claimedAmount"),
            "targetDate":    str(claim.get("targetDate", "—")),
            "docsSubmitted": doc_counts["submitted"],
            "docsTotal":     doc_counts["total"],
        })

    doctors = list(USER_AUTH.find(
        {"role": "auditing-doctor-new", "status": "active"},
        {"_id": 0, "sys_user_id": 1, "full_name": 1}
    ))

    return {
        "claims":  claims_out,
        "total":   CLAIMS.count_documents(query),
        "doctors": doctors,
    }


@router.get("/claims/{case_id}")
def get_qc_claim_detail(case_id: str):
    claim = CLAIMS.find_one({"caseId": case_id}, {"_id": 0})
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")

    all_subs       = _load_submissions(case_id)
    doc_counts     = _count_docs(claim, all_subs)
    investigations = _build_investigations(case_id, claim, all_subs)

    claim_mode = claim.get("claimMode", "") or ""
    claim_sub  = claim.get("claimSubtype", "") or ""

    return {
        "id":             case_id,
        "type":           f"{claim_mode.title()} — {claim_sub.title()}".strip(" —"),
        "claimantName":   claim.get("claimantName", "Unknown"),
        "insurer":        claim.get("insurer", "—"),
        "priority":       claim.get("claimPriority", "Normal"),
        "status":         claim.get("status", "ALLOCATED"),
        "claimedAmount":  claim.get("claimedAmount"),
        "targetDate":     str(claim.get("targetDate", "—")),
        "docsSubmitted":  doc_counts["submitted"],
        "docsTotal":      doc_counts["total"],
        "investigations": investigations,
    }


@router.post("/claims/{case_id}/verify")
def verify_claim(case_id: str, body: VerifyRequest):
    claim = CLAIMS.find_one({"caseId": case_id}, {"_id": 0, "caseId": 1})
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")

    CLAIMS.update_one(
        {"caseId": case_id},
        {
            "$set": {
                "status": "VERIFIED",
                "qcDecision": {
                    "action":    "APPROVE",
                    "doctor_id": body.doctor_id,
                    "doctor":    body.doctor_name,
                    "remarks":   body.remarks or "",
                    "decidedAt": datetime.utcnow(),
                },
                "updatedAt": datetime.utcnow(),
            }
        },
    )

    return {
        "status":  "success",
        "message": f"Claim {case_id} verified and assigned to {body.doctor_name}",
        "caseId":  case_id,
    }


@router.post("/claims/{case_id}/reinvestigate")
def reinvestigate_claim(case_id: str, body: ReinvestigateRequest):
    claim = CLAIMS.find_one({"caseId": case_id}, {"_id": 0, "caseId": 1, "investigations": 1})
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")

    flagged = [{"invType": f.invType, "docKey": f.docKey} for f in body.flaggedDocs]

    for flag in body.flaggedDocs:
        inv_type = flag.invType
        doc_key  = flag.docKey

        CLAIMS.update_many(
            {
                "caseId": case_id,
                f"investigations.{inv_type}": {"$exists": True},
            },
            {
                "$set": {
                    f"investigations.{inv_type}.$[].submission.status":             "REINVESTIGATE",
                    f"investigations.{inv_type}.$[].submission.reinvestigate_docs": flagged,
                }
            },
        )

        SUBMISSIONS.update_one(
            {"task_id": case_id},
            {
                "$set": {
                    f"reinvestigation.{inv_type}.{doc_key}": {
                        "status":       "REQUIRED",
                        "requested_at": datetime.utcnow(),
                        "remarks":      body.remarks or "",
                    }
                }
            },
            upsert=True,
        )

    CLAIMS.update_one(
        {"caseId": case_id},
        {
            "$set": {
                "status": "ALLOCATED",
                "qcDecision": {
                    "action":      "REINVESTIGATE",
                    "flaggedDocs": flagged,
                    "remarks":     body.remarks or "",
                    "decidedAt":   datetime.utcnow(),
                },
                "updatedAt": datetime.utcnow(),
            }
        },
    )

    return {
        "status":      "success",
        "message":     f"Re-investigation requested for {len(flagged)} document(s) in claim {case_id}",
        "caseId":      case_id,
        "flaggedDocs": flagged,
    }


@router.get("/claims/{case_id}/extracted")
def get_extracted_for_claim(case_id: str):
    docs = list(PROCESSED_DOCS.find(
        {"patient_id": case_id},
        {"_id": 0, "document_id": 1, "file_name": 1, "file_url": 1, "metadata": 1, "entities": 1}
    ).sort("metadata.processing_date", -1).limit(50))

    return {
        "caseId": case_id,
        "documents": [
            {
                "document_id":     d.get("document_id"),
                "file_name":       d.get("file_name") or d.get("metadata", {}).get("file_name"),
                "file_url":        d.get("file_url"),
                "entity_count":    len(d.get("entities", [])),
                "entity_types":    list({e.get("entity_type") for e in d.get("entities", []) if e.get("entity_type")}),
                "processing_date": _fmt(d.get("metadata", {}).get("processing_date")),
            }
            for d in docs
        ],
    }


@router.patch("/documents/{document_id}/entities")
def update_document_entities(document_id: str, body: UpdateEntitiesRequest):
    """QC edits extracted entities for a specific processed document."""
    doc = PROCESSED_DOCS.find_one({"document_id": document_id}, {"_id": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    entities_to_save = [e.dict() for e in body.entities]

    PROCESSED_DOCS.update_one(
        {"document_id": document_id},
        {
            "$set": {
                "entities":       entities_to_save,
                "qc_reviewed":    True,
                "qc_reviewed_at": datetime.utcnow(),
            }
        }
    )

    return {
        "status":       "success",
        "message":      f"Entities updated for document {document_id}",
        "document_id":  document_id,
        "entity_count": len(entities_to_save),
    }


@router.patch("/documents/{document_id}/content")
def update_document_content(document_id: str, body: UpdateDocumentContentRequest):
    """QC edits raw_markdown and/or sections for a specific processed document."""
    doc = PROCESSED_DOCS.find_one({"document_id": document_id}, {"_id": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    update_fields: Dict[str, Any] = {
        "qc_reviewed":    True,
        "qc_reviewed_at": datetime.utcnow(),
    }
    if body.raw_markdown is not None:
        update_fields["raw_markdown"] = body.raw_markdown
    if body.sections is not None:
        update_fields["sections"] = body.sections

    PROCESSED_DOCS.update_one(
        {"document_id": document_id},
        {"$set": update_fields}
    )

    return {
        "status":      "success",
        "message":     f"Content updated for document {document_id}",
        "document_id": document_id,
    }