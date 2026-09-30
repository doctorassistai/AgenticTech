"""
qc_review.py — QC Review backend router (v4)

Checklist-building logic (_normalize_doc_key, _find_form_val, _get_path,
_get_document_id, _get_file_name, _is_not_applicable, _get_skip_reason,
_is_accounted, DOC_KEY_LABELS, TEXT_KEYS, build_investigations) now lives in
routes/agents/investigation_checklist.py and is imported from there, so QC's
idea of "what's missing" and the new field-officer conclusion/findings
generators' idea of "what's missing" can never drift apart (design decision
#3 in the field-officer pipeline rewrite). No behavior change from v3 is
intended by this refactor — see the two spots marked NOTE below for the only
places call sites had to adjust to the shared module's shape.

INV_TYPES / INV_LABELS are GONE (design decision #1): the shared module's
count_docs()/build_investigations() discover whichever inv_type codes are
actually present on claim['investigations'] at runtime, and label_for_inv_type()
supplies a best-effort label (falling back to title-casing unknown codes)
instead of this file hardcoding the type set.
"""

import os
from datetime import datetime
from typing import List, Optional, Dict, Any

import uuid
from fastapi import APIRouter, HTTPException, Request
from pymongo import MongoClient
from pydantic import BaseModel
from celery_client import celery_client

from routes.agents.investigation_checklist import (
    count_docs,
    build_investigations,
)

# ─── Init ──────────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/qc", tags=["QC Review"])

_client = MongoClient(os.getenv("MONGO_URI"))
_db = _client["doctorassistai"]

CLAIMS          = _db["insurance_claims_new"]
SUBMISSIONS     = _db["task_submissions"]
USER_AUTH       = _db["user_auth"]
ADV_TASKS       = _db["advanced_upload_tasks"]

STORAGE_BASE = "https://doctorassist.ai/uploads"


# ─── Helpers (QC-local — not part of the shared checklist module) ────────────
# Everything below is either QC-display-only (formatting, URLs) or reads from
# collections (SUBMISSIONS/PROCESSED_DOCS) the shared checklist module has no
# business knowing about, so these stay here.

def _full_url(path: str) -> Optional[str]:
    if not path or not isinstance(path, str):
        return None
    v = path.strip()
    if not v:
        return None
    # Voice notes have no real file URL — return None so the View button isn't shown
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


def _load_submissions(case_id: str) -> dict:
    doc = SUBMISSIONS.find_one({"task_id": case_id}, {"_id": 0})
    if not doc:
        return {}
    return doc.get("submissions", {})


def _get_extracted_for_file(case_id: str, form_value) -> dict:
    """
    QC reviews the RAW PDF only — parsing (and therefore entities/raw
    markdown) doesn't happen until after QC verifies and assigns a
    doctor (see verify_claim below, which enqueues
    field_investigation_parse.run). So there's nothing to look up here
    at QC time; this always returns empty. Passed into
    build_investigations() as its injectable extractor (see that
    function's docstring) rather than being hardcoded into it, since a
    future caller with real extracted content needs a different one.
    """
    return {"entities": [], "raw_markdown": None, "sections": None}


def _attach_file_urls_and_format_dates(investigations: dict) -> dict:
    """
    Post-process the shared module's build_investigations() output for QC
    display purposes only:
      - resolve each doc's storage path into a full viewable URL (the
        shared module intentionally has no STORAGE_BASE / URL concept)
      - format submission.submitted_at as a display string via _fmt()
        (the shared module intentionally returns the raw value so a
        non-QC caller isn't forced into QC's date-format opinion)
    This is applied in place and the same dict is returned for convenience.
    """
    for inv in investigations.values():
        for doc in inv.get("docs", []):
            doc["file_url"] = _full_url(doc.pop("_path", None)) if "_path" in doc else doc.get("file_url")
        submission = inv.get("submission")
        if submission and submission.get("submitted_at"):
            submission["submitted_at"] = _fmt(submission["submitted_at"])
    return investigations


# ─── Request Models ─────────────────────────────────────────────────────────────

class VerifyRequest(BaseModel):
    doctor_id:   str
    doctor_name: str
    remarks:     Optional[str] = ""


class FlaggedDoc(BaseModel):
    invType:        str
    docKey:         str
    investigatorId: Optional[str] = ""


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
        query["status"] = {"$in": ["ALLOCATED", "COMPLETED", "IN_PROGRESS", "VERIFIED"]}

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
        doc_counts = count_docs(claim, all_subs)

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
    doc_counts     = count_docs(claim, all_subs)
    investigations = build_investigations(
        case_id, claim, all_subs, get_extracted_for_file=_get_extracted_for_file
    )

    # NOTE (call-site adjustment #1): build_investigations() returns each
    # doc's raw storage `path` rather than a resolved URL (the shared
    # module has no STORAGE_BASE concept — that's display-layer, QC-only),
    # and returns submission.submitted_at unformatted (the raw stored
    # value, so a non-QC caller isn't forced into QC's date-display
    # opinion). Resolve both here, same end result as v3's response shape.
    for inv in investigations.values():
        for doc in inv.get("docs", []):
            doc["file_url"] = _full_url(doc.pop("path", None))
        submission = inv.get("submission")
        if submission and submission.get("submitted_at"):
            submission["submitted_at"] = _fmt(submission["submitted_at"])

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
    # ── PARSING DISABLED ─────────────────────────────────────────────────
    # Field-officer investigation documents (MV/HV/HVI/etc.) are no longer
    # parsed on verify — they only need to be stored and shown to the
    # doctor as PDFs (see get_doctor_case_detail's investigationDocuments
    # handling in the doctor router, which is unaffected by this change).
    # The old flow enqueued a Celery task that parsed every
    # "queued_for_parse" entry and then kicked off findings regeneration.
    # Commented out rather than removed, so it can be restored later.
    #
    # task_id = f"fieldparse_{uuid.uuid4().hex}"
    # now = datetime.utcnow()
    # ADV_TASKS.insert_one({
    #     "task_id":       task_id,
    #     "case_id":       case_id,
    #     "doc_id":        None,
    #     "task_type":     "field_investigation_parse",
    #     "file_name":     "Field investigation documents",
    #     "display_label": "Field investigation documents",
    #     "supervisor_id": None,
    #     "status":        "queued",
    #     "result":        None,
    #     "error":         None,
    #     "total_pages":   None,
    #     "created_at":    now,
    #     "updated_at":    now,
    # })
    # celery_client.send_task(
    #     "field_investigation_parse.run",
    #     kwargs={"task_id": task_id, "case_id": case_id},
    #     task_id=task_id,
    #     queue="advanced_upload_queue",
    # )
    # ─────────────────────────────────────────────────────────────────────

    return {
        "status":  "success",
        "message": f"Claim {case_id} verified and assigned to {body.doctor_name}",
        "caseId":  case_id,
    }

@router.post("/claims/{case_id}/reinvestigate")
def reinvestigate_claim(case_id: str, body: ReinvestigateRequest):
    """
    Sends specific documents back for re-collection. This has to clear the
    stale file reference in every place it's stored, not just flip a status
    flag — otherwise the doc still "counts" as submitted for QC review,
    doctor findings, and the mobile app's own completion check.

    Layers touched per flagged doc:
      1. CLAIMS.investigations.{inv_type}.$.submission.form_data — the copy
         QC's own completion counting (count_docs / build_investigations)
         reads.
      2. SUBMISSIONS.submissions.{inv_type}.{investigatorId}.form_data — the
         copy GET /app/tasks/{user_id} reads to populate mySubmittedFormData,
         which is what the mobile app's TaskStepsScreen uses to decide
         whether a step is already filled.
      3. CLAIMS.investigationDocuments[] — the entry is neutralized (file
         reference nulled, status flipped) but NOT deleted. The mobile
         submit endpoint (/app/tasks/submit) finds this exact entry by
         (inv_type, step_key, investigator_id) and overwrites it in place
         on resubmit, reusing the same doc_id — so keeping the entry alive
         is what makes "find and replace on resubmit" work.
      4. SUBMISSIONS.reinvestigation.{inv_type}.{doc_key} — audit trail +
         remarks, shown back to the field officer. Cleared automatically
         by /app/tasks/submit once that exact field is resubmitted.
    """
    claim = CLAIMS.find_one({"caseId": case_id}, {"_id": 0, "caseId": 1, "investigations": 1})
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")

    flagged = [
        {"invType": f.invType, "docKey": f.docKey, "investigatorId": f.investigatorId or ""}
        for f in body.flaggedDocs
    ]

    for flag in body.flaggedDocs:
        inv_type = flag.invType
        doc_key  = flag.docKey
        user_id  = flag.investigatorId or ""

        # 1. Clear the field + flip status on the claim's investigation
        #    submission — targeted at the specific investigator's entry
        #    when we know who it is, otherwise falls back to every entry
        #    under that inv_type (old behaviour, kept for safety).
        unset_ops = {f"investigations.{inv_type}.$[elem].submission.form_data.{doc_key}": ""}
        set_ops   = {f"investigations.{inv_type}.$[elem].submission.status": "REINVESTIGATE"}

        if user_id:
            CLAIMS.update_one(
                {"caseId": case_id},
                {"$unset": unset_ops, "$set": set_ops},
                array_filters=[{"elem.investigatorId": user_id}],
            )
        else:
            CLAIMS.update_one(
                {"caseId": case_id, f"investigations.{inv_type}": {"$exists": True}},
                {"$unset": unset_ops, "$set": set_ops},
                array_filters=[{"elem.investigatorId": {"$exists": True}}],
            )

        # 2. Clear the same field in task_submissions — this is the copy
        #    GET /app/tasks/{user_id} actually serves to the mobile app.
        if user_id:
            SUBMISSIONS.update_one(
                {"task_id": case_id},
                {
                    "$unset": {
                        f"submissions.{inv_type}.{user_id}.form_data.{doc_key}":            "",
                        f"submissions.{inv_type}.{user_id}.parsed_document_ids.{doc_key}":  "",
                    },
                    "$set": {
                        f"submissions.{inv_type}.{user_id}.status": "REINVESTIGATE",
                    },
                },
            )

        # 3. Neutralize (don't delete) the matching investigationDocuments
        #    entry so it can't be viewed or parsed, while preserving doc_id
        #    continuity for the resubmit-in-place logic in /app/tasks/submit.
        doc_match: Dict[str, Any] = {"inv_type": inv_type, "step_key": doc_key}
        if user_id:
            doc_match["investigator_id"] = user_id

        CLAIMS.update_one(
            {"caseId": case_id, "investigationDocuments": {"$elemMatch": doc_match}},
            {
                "$set": {
                    "investigationDocuments.$.status":       "REINVESTIGATION_REQUESTED",
                    "investigationDocuments.$.pdf_url":      None,
                    "investigationDocuments.$.storage_path": None,
                    "investigationDocuments.$.raw_markdown": None,
                }
            },
        )

        # 4. Audit trail / remarks for this specific field.
        SUBMISSIONS.update_one(
            {"task_id": case_id},
            {
                "$set": {
                    f"reinvestigation.{inv_type}.{doc_key}": {
                        "status":         "REQUIRED",
                        "requested_at":   datetime.utcnow(),
                        "remarks":        body.remarks or "",
                        "investigatorId": user_id,
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