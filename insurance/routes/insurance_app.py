"""
App router — field officer task submission.

processed_documents is retired. All investigation documents (uploaded
files AND voice-note transcripts) now live directly on the claim doc at
insurance_claims_new.investigationDocuments[]. No parsing happens here —
files are registered as "queued_for_parse"; actual LlamaCloud parsing is
triggered by /qc/claims/{id}/verify (see qc_review.py + field_investigation_
parse_task.py), which tags each markdown block with an [INV_TYPE/step_key]
marker for RawDocument.jsx / findings / conclusion generation.

/app/parse-document (client-side preview parse) is removed — there is no
pre-submit parsing step anymore.
"""

from fastapi import APIRouter, HTTPException, Request, File, UploadFile, Form
from pymongo import MongoClient
from jose import jwt
import os
import uuid
import logging
from typing import Optional, List
import img2pdf
from pypdf import PdfWriter, PdfReader
import io
from datetime import datetime, timezone, timedelta

IST = timezone(timedelta(hours=5, minutes=30))

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/app", tags=["doctor"])

client = MongoClient(os.getenv("MONGO_URI"))
db = client["doctorassistai"]
insurance_collection   = db["insurance_claims_new"]
submissions_collection = db["task_submissions"]
user_auth_collection   = db["user_auth"]

SECRET_KEY       = os.getenv("SECRET_KEY")
ALGORITHM        = os.getenv("ALGORITHM")
STORAGE_BASE_URL = os.getenv("STORAGE_BASE_URL", "https://doctorassist.ai/uploads")
API_BASE_URL     = os.getenv("API_BASE_URL")


INV_TYPES = ["MV", "HV", "HVI", "TELE", "BILL", "TRIGGER"]

INV_LABELS = {
    "MV":      "Medical Visit",
    "HV":      "Hospital Visit",
    "HVI":     "Home Visit / Neighbour Verification",
    "TELE":    "Telephone Verification",
    "BILL":    "Bill Verification",
    "TRIGGER": "Trigger Investigation",
}

TEXT_KEYS = {
    "mv_visit_date", "mv_remarks",
    "hv_doctor_name", "hv_observations",
    "hvi_neighbour", "hvi_remarks",
    "tele_person", "tele_datetime", "tele_summary",
    "bill_amount", "bill_notes",
    "trigger_date", "trigger_reason", "trigger_observations",
}


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _upload_bytes_to_storage(file_bytes: bytes, filename: str, case_id: str, doctor_id: str = "") -> str:
    import httpx

    files = {"file": (filename, file_bytes, "application/pdf")}

    res = httpx.post(
        f"{STORAGE_BASE_URL}/upload",
        params={
            "doctor_id":   doctor_id,
            "patient_id":  case_id,
            "doc_type":    "document",
            "upload_mode": "document",
        },
        files=files,
        timeout=60,
    )
    res.raise_for_status()
    body = res.json()

    stored_filename = body.get("filename")
    if not stored_filename:
        raise ValueError(f"No filename in storage upload response: {body}")

    return f"{case_id}/{stored_filename}"


def _normalize_url(value: str, case_id: str) -> str:
    if value.startswith("http://") or value.startswith("https://"):
        return value
    return f"{STORAGE_BASE_URL}/files/{value}"


def _full_url(path: str) -> Optional[str]:
    if not path or path == "voice-note":
        return None
    if path.startswith("http://") or path.startswith("https://"):
        return path
    return f"{STORAGE_BASE_URL}/files/{path}"


def _is_file_value(value) -> bool:
    if not value:
        return False
    if isinstance(value, str):
        v = value.strip()
        return "/" in v or v.startswith("http") or v == "voice-note"
    if isinstance(value, dict):
        path = value.get("path")
        if isinstance(path, str):
            return "/" in path or path.startswith("http") or path == "voice-note"
    return False


def _authenticate(request: Request) -> tuple[str, Optional[str]]:
    user_id_from_header   = request.headers.get("X-User-Id")
    user_role_from_header = request.headers.get("X-User-Role")
    if user_id_from_header:
        return user_id_from_header, user_role_from_header
    auth = request.headers.get("authorization")
    if not auth:
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        token = auth.split(" ")[1]
        user  = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return user.get("sub"), user.get("role")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


# ─────────────────────────────────────────────────────────────────────────────
# POST /app/tasks/submit
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/tasks/submit")
async def submit_task(request: Request):
    authenticated_user_id, user_role = _authenticate(request)

    body     = await request.json()
    not_applicable_keys: list = body.get("not_applicable_keys", [])
    task_id  = body.get("task_id")
    user_id  = body.get("user_id")
    vis_type = body.get("type")
    form     = body.get("data", {})

    if authenticated_user_id != user_id:
        raise HTTPException(status_code=403, detail=f"Unauthorized: {authenticated_user_id} != {user_id}")

    if not task_id or not vis_type:
        raise HTTPException(status_code=400, detail="task_id and type are required")
    if vis_type not in INV_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid type. Must be one of {INV_TYPES}")

    # ── Normalize file paths ──────────────────────────────────────────────
    normalized_form = {}
    for k, v in form.items():
        if k in not_applicable_keys or (isinstance(v, dict) and v.get("not_applicable")):
            normalized_form[k] = {
                "path":          None,
                "document_id":   None,
                "file_name":     None,
                "status":        "NOT_APPLICABLE",
                "not_applicable": True,
            }
            continue
        if k in TEXT_KEYS:
            normalized_form[k] = v
        elif isinstance(v, dict) and v.get("path"):
            path = v.get("path")
            if path.startswith("http://") or path.startswith("https://"):
                path = path.split("/files/")[-1]
            normalized_form[k] = {
                "path":        path,
                "document_id": v.get("document_id"),
                "file_name":   v.get("file_name"),
                "status":      "UPLOADED",
            }
        elif _is_file_value(v):
            if isinstance(v, str) and (v.startswith("http://") or v.startswith("https://")):
                normalized_form[k] = v.split("/files/")[-1]
            else:
                normalized_form[k] = v
        else:
            normalized_form[k] = v

    # ── Register every submitted file as a "queued for parse" document ────
    # Stored directly on the claim doc's investigationDocuments[] array.
    # No LlamaCloud call happens here. QC reviews the raw PDFs via pdf_url;
    # parsing is triggered from /qc/claims/{id}/verify instead.
    stored_parsed_doc_ids = {}
    for step_key, value in normalized_form.items():
        if step_key in TEXT_KEYS:
            continue
        path = value.get("path") if isinstance(value, dict) else value
        is_not_applicable = isinstance(value, dict) and value.get("not_applicable")

        if is_not_applicable:
            # Explicitly registered "skipped" entry so QC can distinguish
            # "investigator marked this not applicable" from "nobody has
            # touched this step yet". Same replace-in-place dedup key as a
            # normal document, so toggling a step between file <-> skip
            # <-> file across resubmits always leaves exactly one entry.
            existing_claim = insurance_collection.find_one(
                {
                    "caseId": task_id,
                    "investigationDocuments": {
                        "$elemMatch": {
                            "inv_type":        vis_type,
                            "step_key":        step_key,
                            "investigator_id": user_id,
                        }
                    },
                },
                {"investigationDocuments.$": 1},
            )
            existing_entries = (existing_claim or {}).get("investigationDocuments") or []
            existing_entry = existing_entries[0] if existing_entries else None
            skip_doc_id = existing_entry["doc_id"] if existing_entry else f"invdoc_{uuid.uuid4().hex[:10]}"

            skip_entry = {
                "doc_id":           skip_doc_id,
                "document_id":      skip_doc_id,
                "file_name":        None,
                "storage_path":     None,
                "pdf_url":          None,
                "display_label":    f"[{vis_type}] {step_key.replace('_', ' ').title()}",
                "inv_type":         vis_type,
                "step_key":         step_key,
                "investigator_id":  user_id,
                "status":           "NOT_APPLICABLE",
                "kind":             "not_applicable",
                "raw_markdown":     None,
                "added_at":         datetime.now(IST).isoformat(),
                "source":           "MOBILE_FIELD_OFFICER",
                "skip_reason":      value.get("skip_reason") if isinstance(value, dict) else None,
            }

            if existing_entry:
                insurance_collection.update_one(
                    {"caseId": task_id, "investigationDocuments.doc_id": skip_doc_id},
                    {"$set": {"investigationDocuments.$": skip_entry}},
                )
            else:
                insurance_collection.update_one(
                    {"caseId": task_id, "investigationDocuments.doc_id": {"$ne": skip_doc_id}},
                    {"$push": {"investigationDocuments": skip_entry}},
                )
            stored_parsed_doc_ids[step_key] = skip_doc_id
            continue

        if not path or path in ("N/A",):
            continue
        if path == "voice-note":
            # Voice-note transcripts are registered separately via
            # /app/voice/process, which already wrote its own
            # investigationDocuments entry with a real doc_id. If that
            # entry's id was echoed back into the form as document_id, keep
            # it; otherwise there's nothing further to register here.
            existing_doc_id = value.get("document_id") if isinstance(value, dict) else None
            if existing_doc_id:
                stored_parsed_doc_ids[step_key] = existing_doc_id
            continue

        now = datetime.now(IST)
        file_name = (value.get("file_name") if isinstance(value, dict) else None) or path.split("/")[-1]
        full_url = _full_url(path)

        # A resubmit/edit for this exact (inv_type, step_key, investigator)
        # should REPLACE the existing investigationDocuments entry, not
        # append a duplicate. Reuse the prior doc_id if one already exists
        # on the claim so any earlier reference to it stays valid.
        existing_claim = insurance_collection.find_one(
            {
                "caseId": task_id,
                "investigationDocuments": {
                    "$elemMatch": {
                        "inv_type":        vis_type,
                        "step_key":        step_key,
                        "investigator_id": user_id,
                    }
                },
            },
            {"investigationDocuments.$": 1},
        )
        existing_entries = (existing_claim or {}).get("investigationDocuments") or []
        existing_entry = existing_entries[0] if existing_entries else None
        doc_id = existing_entry["doc_id"] if existing_entry else f"invdoc_{uuid.uuid4().hex[:10]}"

        entry = {
            "doc_id":           doc_id,
            "document_id":      doc_id,
            "file_name":        file_name,
            "storage_path":     path,
            "pdf_url":          full_url,
            "display_label":    f"[{vis_type}] {step_key.replace('_', ' ').title()}",
            "inv_type":         vis_type,
            "step_key":         step_key,
            "investigator_id":  user_id,
            "status":           "queued_for_parse",
            "kind":             "document",
            "raw_markdown":     None,
            "added_at":         now.isoformat(),
            "source":           "MOBILE_FIELD_OFFICER",
        }

        if existing_entry:
            insurance_collection.update_one(
                {"caseId": task_id, "investigationDocuments.doc_id": doc_id},
                {"$set": {"investigationDocuments.$": entry}},
            )
        else:
            insurance_collection.update_one(
                {"caseId": task_id, "investigationDocuments.doc_id": {"$ne": doc_id}},
                {"$push": {"investigationDocuments": entry}},
            )
        stored_parsed_doc_ids[step_key] = doc_id

        if isinstance(normalized_form.get(step_key), dict):
            normalized_form[step_key]["parsed_document_id"] = doc_id
            normalized_form[step_key]["document_id"] = doc_id
        else:
            normalized_form[step_key] = {
                "path": path, "parsed_document_id": doc_id, "document_id": doc_id,
                "file_name": file_name, "status": "UPLOADED",
            }

    # ── Clear any pending re-investigation flags for steps just resubmitted
    # ─────────────────────────────────────────────────────────────────────
    # If QC previously flagged one of these step_keys via /qc/claims/{id}/
    # reinvestigate, that unset the field from both CLAIMS and SUBMISSIONS
    # form_data. The loop above already re-registered the fresh file (or
    # skip) under the SAME doc_id in investigationDocuments[] and rewrote
    # form_data for it here — so the field itself is already "replaced".
    # This just clears the stale reinvestigation.{vis_type}.{step_key}
    # audit entry so downstream consumers (QC UI, findings generation)
    # stop treating it as outstanding.
    resolved_reinv_unset = {}
    for step_key, value in normalized_form.items():
        if step_key in TEXT_KEYS:
            continue
        path  = value.get("path") if isinstance(value, dict) else value
        is_na = isinstance(value, dict) and value.get("not_applicable")
        if path or is_na:
            resolved_reinv_unset[f"reinvestigation.{vis_type}.{step_key}"] = ""

    if resolved_reinv_unset:
        submissions_collection.update_one(
            {"task_id": task_id},
            {"$unset": resolved_reinv_unset},
        )

    # ── Determine PARTIAL / COMPLETED for this inv type ───────────────────
    claim = insurance_collection.find_one({"caseId": task_id})
    inv_submission_status = "PARTIAL"

    if claim:
        inv_entry = next(
            (e for e in claim.get("investigations", {}).get(vis_type, [])
             if isinstance(e, dict) and e.get("investigatorId") == user_id),
            {}
        )
        required_docs      = inv_entry.get("documents", [])
        na_keys_in_submission = {
            k for k, v in normalized_form.items()
            if isinstance(v, dict) and v.get("status") == "NOT_APPLICABLE"
        }

        submitted_doc_keys = {
            k for k in form
            if k not in TEXT_KEYS and (
                _is_file_value(form.get(k))
                or (isinstance(form.get(k), dict) and form.get(k, {}).get("path") == "voice-note")
                or k in na_keys_in_submission
            )
        }

        if len(required_docs) == 0:
            inv_submission_status = (
                "COMPLETED"
                if any(normalized_form.get(k) for k in TEXT_KEYS)
                else "PARTIAL"
            )
        elif len(submitted_doc_keys) >= len(required_docs):
            inv_submission_status = "COMPLETED"
        else:
            inv_submission_status = "PARTIAL"

    # ── 1. Upsert task_submissions ────────────────────────────────────────
    submissions_collection.update_one(
        {"task_id": task_id},
        {
            "$set": {
                "task_id": task_id,
                f"submissions.{vis_type}.{user_id}": {
                    "submitted_at":        datetime.now(IST),
                    "status":              inv_submission_status,
                    "form_data":           normalized_form,
                    "parsed_document_ids": stored_parsed_doc_ids,
                }
            }
        },
        upsert=True,
    )

    # ── 2. Write submission onto the claim ────────────────────────────────
    insurance_collection.update_one(
        {"caseId": task_id},
        {
            "$set": {
                f"investigations.{vis_type}.$[elem].submission": {
                    "submitted_by":        user_id,
                    "submitted_at":        datetime.now(IST),
                    "status":              inv_submission_status,
                    "form_data":           normalized_form,
                    "parsed_document_ids": stored_parsed_doc_ids,
                }
            }
        },
        array_filters=[{"elem.investigatorId": user_id}],
    )

    # ── 3. Check overall claim completion ─────────────────────────────────
    total     = 0
    completed = 0
    just_completed = False

    claim = insurance_collection.find_one({"caseId": task_id})
    if claim:
        inv = claim.get("investigations", {})
        for t in INV_TYPES:
            for entry in inv.get(t, []):
                if not isinstance(entry, dict):
                    continue
                total += 1
                if entry.get("submission", {}).get("status") == "COMPLETED":
                    completed += 1

        if total > 0 and completed == total:
            insurance_collection.update_one(
                {"caseId": task_id},
                {"$set": {"status": "COMPLETED", "updatedAt": datetime.now(IST)}}
            )
            just_completed = True
        else:
            any_submission = any(
                entry.get("submission")
                for t in INV_TYPES
                for entry in inv.get(t, [])
                if isinstance(entry, dict)
            )
            insurance_collection.update_one(
                {"caseId": task_id},
                {"$set": {
                    "status":    "IN_PROGRESS" if any_submission else "ALLOCATED",
                    "updatedAt": datetime.now(IST),
                }}
            )

    # NOTE: no markdown append here. All investigation docs sit as
    # "queued_for_parse" until QC verifies the case — parsing + markdown
    # append + findings regen all happen in the Celery task fired from
    # /qc/claims/{id}/verify (see qc_review.py, field_investigation_parse_task.py).

    return {
        "status":             "success",
        "message":            "Task submitted successfully",
        "task_id":            task_id,
        "type":               vis_type,
        "submitted_by":       user_id,
        "submission_status":  inv_submission_status,
        "parsed_docs_stored": list(stored_parsed_doc_ids.keys()),
        "progress":           f"{completed}/{total} investigator tasks COMPLETED",
        "claim_completed":    just_completed,
    }


# ─────────────────────────────────────────────────────────────────────────────
# GET /app/tasks/{user_id}
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/tasks/{user_id}")
async def get_tasks(user_id: str, request: Request):
    authenticated_user_id, user_role = _authenticate(request)

    if authenticated_user_id != user_id:
        raise HTTPException(status_code=403, detail=f"Unauthorized: {authenticated_user_id} != {user_id}")

    tasks = list(insurance_collection.find(
        {"$or": [{f"investigations.{t}.investigatorId": user_id} for t in INV_TYPES]},
        {"_id": 0}
    ))

    for task in tasks:
        case_id = task.get("caseId")
        inv     = task.get("investigations", {})

        task["myInvestigationTypes"] = [
            t for t in INV_TYPES
            if any(
                isinstance(e, dict) and e.get("investigatorId") == user_id
                for e in inv.get(t, [])
            )
        ]

        sub_doc  = submissions_collection.find_one({"task_id": case_id}, {"_id": 0})
        all_subs = sub_doc.get("submissions", {}) if sub_doc else {}
        all_reinv = sub_doc.get("reinvestigation", {}) if sub_doc else {}

        task["mySubmissionStatus"]   = {}
        task["mySubmittedFormData"]  = {}
        # Only surface re-investigation notes for inv types this user owns —
        # e.g. {"MV": {"discharge_summary": {"remarks": "...", "status": "REQUIRED", ...}}}
        task["reinvestigationNotes"] = {
            t: all_reinv[t] for t in task["myInvestigationTypes"] if all_reinv.get(t)
        }

        for t in task["myInvestigationTypes"]:
            user_sub = all_subs.get(t, {}).get(user_id)

            if not user_sub:
                task["mySubmissionStatus"][t]  = "PENDING"
                task["mySubmittedFormData"][t] = {}
                continue

            form = user_sub.get("form_data", {})
            inv_entry = next(
                (e for e in inv.get(t, [])
                 if isinstance(e, dict) and e.get("investigatorId") == user_id),
                {}
            )
            required_docs = inv_entry.get("documents", [])
            submitted_doc_keys = {
                k for k in form
                if k not in TEXT_KEYS and (
                    _is_file_value(form.get(k))
                    or (isinstance(form.get(k), dict) and form.get(k, {}).get("path") == "voice-note")
                )
            }

            if len(required_docs) > 0 and len(submitted_doc_keys) >= len(required_docs):
                status = "COMPLETED"
            elif len(submitted_doc_keys) > 0 or any(k in form for k in TEXT_KEYS):
                status = "PARTIAL"
            else:
                status = "PENDING"

            task["mySubmissionStatus"][t]  = status
            task["mySubmittedFormData"][t] = form

    return {"status": "success", "data": tasks}


# ─────────────────────────────────────────────────────────────────────────────
# POST /app/voice/process
# Voice-note transcripts need no LlamaCloud parse — the transcript IS the
# text. Written straight into investigationDocuments[] as "processed";
# the parse task (field_investigation_parse_task.py) still needs to append
# its markdown block, so it treats kind="voice" entries specially (no
# LlamaCloud call, just wraps the transcript and appends it).
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/voice/process")
async def process_voice_note(request: Request):
    body = await request.json()

    patient_id = body.get("patient_id")
    doctor_id  = body.get("doctor_id")
    transcript = body.get("transcript")
    visit_type = body.get("visit_type")
    step_key   = body.get("step_key")

    if not patient_id or not transcript:
        raise HTTPException(status_code=400, detail="Missing fields")

    doc_id = f"voicedoc_{uuid.uuid4().hex[:10]}"
    now    = datetime.now(IST)
    file_name = f"{step_key}_voice_note.txt"

    entry = {
        "doc_id":          doc_id,
        "document_id":     doc_id,
        "file_name":       file_name,
        "storage_path":    None,
        "pdf_url":         None,
        "display_label":   f"[{visit_type}] {step_key.replace('_', ' ').title()} (Voice Note)",
        "inv_type":        visit_type,
        "step_key":        step_key,
        "investigator_id": doctor_id,
        "status":          "queued_for_parse",  # still needs its block appended by the parse task
        "kind":            "voice",
        "raw_markdown":    transcript,
        "added_at":        now.isoformat(),
        "source":          "VOICE_NOTE",
    }

    insurance_collection.update_one(
        {"caseId": patient_id, "investigationDocuments.doc_id": {"$ne": doc_id}},
        {"$push": {"investigationDocuments": entry}},
    )

    return {"status": "success", "document_id": doc_id}


# ─────────────────────────────────────────────────────────────────────────────
# POST /app/combine-images-pdf
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/combine-images-pdf")
async def combine_images_to_pdf(
    request:  Request,
    files:    List[UploadFile] = File(...),
    case_id:  str              = Form(...),
    step_key: str              = Form(...),
):
    authenticated_user_id, _ = _authenticate(request)

    if not files:
        raise HTTPException(status_code=400, detail="No images provided")
    if len(files) > 20:
        raise HTTPException(status_code=400, detail="Maximum 20 pages allowed")

    image_bytes_list = []
    for f in files:
        if not f.filename.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
            raise HTTPException(status_code=400, detail=f"Images only. Got: {f.filename}")
        content = await f.read()
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail=f"{f.filename} exceeds 10MB")
        image_bytes_list.append(content)

    try:
        pdf_bytes = img2pdf.convert(image_bytes_list, rotation=img2pdf.Rotation.ifvalid)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF creation failed: {str(e)}")

    pdf_filename = f"{step_key}_{uuid.uuid4().hex[:8]}.pdf"

    try:
        storage_path = _upload_bytes_to_storage(
            pdf_bytes, pdf_filename, case_id, doctor_id=authenticated_user_id,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Storage upload failed: {str(e)}")

    return {
        "success":      True,
        "storage_path": storage_path,
        "file_name":    pdf_filename,
        "page_count":   len(image_bytes_list),
        "file_url":     f"{STORAGE_BASE_URL}/files/{storage_path}",
    }


@router.post("/combine-files-pdf")
async def combine_files_to_pdf(
    request:  Request,
    files:    List[UploadFile] = File(...),
    case_id:  str              = Form(...),
    step_key: str              = Form(...),
):
    authenticated_user_id, _ = _authenticate(request)

    if not files:
        raise HTTPException(status_code=400, detail="No files provided")
    if len(files) > 30:
        raise HTTPException(status_code=400, detail="Maximum 30 files allowed")

    ALLOWED_IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp")
    ALLOWED_EXTS       = ALLOWED_IMAGE_EXTS + (".pdf",)

    writer     = PdfWriter()
    page_count = 0

    for f in files:
        fname_lower = (f.filename or "").lower()
        if not any(fname_lower.endswith(ext) for ext in ALLOWED_EXTS):
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type: {f.filename}. Only images and PDFs are accepted."
            )

        content = await f.read()
        if len(content) > 15 * 1024 * 1024:
            raise HTTPException(status_code=400, detail=f"{f.filename} exceeds 15 MB")
        if not content:
            raise HTTPException(status_code=400, detail=f"{f.filename} is empty")

        if any(fname_lower.endswith(ext) for ext in ALLOWED_IMAGE_EXTS):
            try:
                pdf_bytes = img2pdf.convert(content, rotation=img2pdf.Rotation.ifvalid)
            except Exception as e:
                raise HTTPException(
                    status_code=500,
                    detail=f"Could not convert image '{f.filename}' to PDF: {str(e)}"
                )
            reader = PdfReader(io.BytesIO(pdf_bytes))
        else:
            try:
                reader = PdfReader(io.BytesIO(content))
            except Exception as e:
                raise HTTPException(
                    status_code=500,
                    detail=f"Could not read PDF '{f.filename}': {str(e)}"
                )

        for page in reader.pages:
            writer.add_page(page)
            page_count += 1

    if page_count == 0:
        raise HTTPException(status_code=422, detail="No pages could be extracted from the provided files.")

    output_buffer = io.BytesIO()
    writer.write(output_buffer)
    merged_pdf_bytes = output_buffer.getvalue()

    pdf_filename = f"{step_key}_{uuid.uuid4().hex[:8]}.pdf"
    try:
        storage_path = _upload_bytes_to_storage(
            merged_pdf_bytes, pdf_filename, case_id, doctor_id=authenticated_user_id,
        )
    except Exception as e:
        logger.error("Storage upload failed for combine-files-pdf: %s", e)
        raise HTTPException(status_code=500, detail=f"Storage upload failed: {str(e)}")

    return {
        "success":      True,
        "storage_path": storage_path,
        "file_name":    pdf_filename,
        "page_count":   page_count,
        "file_url":     f"{STORAGE_BASE_URL}/files/{storage_path}",
        "file_count":   len(files),
    }


@router.post("/tasks/{task_id}/respond")
async def respond_to_assignment(task_id: str, request: Request):
    body    = await request.json()
    user_id = request.headers.get("X-User-Id")
    action  = body.get("action")
    reason  = body.get("reason", "")

    if action not in ("accepted", "declined"):
        raise HTTPException(status_code=400, detail="action must be accepted or declined")

    inv_types = []
    claim = insurance_collection.find_one({"caseId": task_id})
    if not claim:
        raise HTTPException(status_code=404, detail="Case not found")

    for inv_type in INV_TYPES:
        for entry in claim.get("investigations", {}).get(inv_type, []):
            if isinstance(entry, dict) and entry.get("investigatorId") == user_id:
                inv_types.append(inv_type)

    for inv_type in inv_types:
        insurance_collection.update_one(
            {"caseId": task_id},
            {"$set": {
                f"investigations.{inv_type}.$[elem].assignmentResponse": action,
                f"investigations.{inv_type}.$[elem].assignmentResponseAt": datetime.now(IST),
                f"investigations.{inv_type}.$[elem].declineReason": reason if action == "declined" else "",
            }},
            array_filters=[{"elem.investigatorId": user_id}],
        )

    return {"success": True, "task_id": task_id, "action": action}