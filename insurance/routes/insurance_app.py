"""
App router — field officer task submission + on-device PDF parsing.

CHANGES vs previous version:
  - After every submit, if the claim just became COMPLETED (all inv types done),
    fetch ALL processed_documents for that caseId, combine them into one labelled
    markdown string, and APPEND it to raw_llama_markdown in insurance_claims_new.
  - No other behaviour is changed.
"""

from fastapi import APIRouter, HTTPException, Request, File, UploadFile, Form
from pymongo import MongoClient
from jose import jwt
import os
import uuid
import asyncio
import logging
from datetime import datetime
from typing import Optional
# Add after existing imports
import img2pdf
import tempfile
from typing import List
from pypdf import PdfWriter, PdfReader
import io                                  # ← ADD
from datetime import datetime, timezone, timedelta
import base64
from celery_client import celery_client
IST = timezone(timedelta(hours=5, minutes=30))

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/app", tags=["doctor"])

client = MongoClient(os.getenv("MONGO_URI"))
db = client["doctorassistai"]
insurance_collection           = db["insurance_claims_new"]
submissions_collection         = db["task_submissions"]
user_auth_collection           = db["user_auth"]
processed_documents_collection = db["processed_documents"]
parse_tasks_collection = db["parse_tasks"]

SECRET_KEY       = os.getenv("SECRET_KEY")
ALGORITHM        = os.getenv("ALGORITHM")
LLAMA_API_KEY    = os.getenv("LLAMA_API_KEY")
# Two separate constants — don't mix them up
STORAGE_BASE_URL = os.getenv("STORAGE_BASE_URL", "https://doctorassist.ai/uploads")  # where files live
API_BASE_URL     = os.getenv("API_BASE_URL")     # where API lives


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

    # Match the path shape your app already builds for single uploads:
    # f"{task.caseId}/{storedFilename}"
    return f"{case_id}/{stored_filename}"


def _normalize_url(value: str, case_id: str) -> str:
    if value.startswith("http://") or value.startswith("https://"):
        return value
    return f"{STORAGE_BASE_URL}/files/{value}"

def _is_file_value(value) -> bool:
    if not value:
        return False
    if isinstance(value, str):
        v = value.strip()
        return "/" in v or v.startswith("http") or v == "voice-note"  # ← add this
    if isinstance(value, dict):
        path = value.get("path")
        if isinstance(path, str):
            return "/" in path or path.startswith("http") or path == "voice-note"  # ← and this
    return False


# ─────────────────────────────────────────────────────────────────────────────
# LlamaCloud parse helper
# ─────────────────────────────────────────────────────────────────────────────

async def _llamacloud_parse_bytes(content: bytes, filename: str) -> tuple[str, int]:
    import tempfile

    def _sync():
        from llama_cloud import LlamaCloud

        if not LLAMA_API_KEY:
            raise ValueError("LLAMA_API_KEY not configured")

        lc_client = LlamaCloud(api_key=LLAMA_API_KEY)
        safe_name = filename.replace(" ", "_")
        tmp_path  = os.path.join(tempfile.gettempdir(), safe_name)

        with open(tmp_path, "wb") as f:
            f.write(content)

        try:
            uploaded = lc_client.files.create(file=tmp_path, purpose="parse")
            result   = lc_client.parsing.parse(
                file_id=uploaded.id,
                tier="agentic",
                version="latest",
                expand=["markdown"],
            )
            pages    = result.markdown.pages
            markdown = "\n\n".join(p.markdown for p in pages)
            return markdown, len(pages)
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _sync)


def _split_markdown_into_sections(markdown: str) -> list[dict]:
    sections  = []
    current_h = "Document Content"
    current_c = []

    for line in markdown.splitlines():
        stripped = line.strip()
        if stripped.startswith("### ") or stripped.startswith("## ") or stripped.startswith("# "):
            if current_c:
                sections.append({"heading": current_h, "content": "\n".join(current_c).strip()})
            current_h = stripped.lstrip("# ").strip()
            current_c = []
        else:
            current_c.append(line)

    if current_c:
        sections.append({"heading": current_h, "content": "\n".join(current_c).strip()})

    sections = [s for s in sections if s["content"].strip()]
    if not sections:
        sections = [{"heading": "Document Content", "content": markdown.strip()}]

    return sections


# ─────────────────────────────────────────────────────────────────────────────
# NEW — combine all processed_documents for a case and append to
#       raw_llama_markdown in insurance_claims_new
# ─────────────────────────────────────────────────────────────────────────────

def _build_combined_markdown(case_id: str) -> str:
    """
    Fetch every processed_document entry for this case_id.
    Build a single labelled markdown string: one block per document/voice entry.

    Block format
    ────────────
    ---
    ## [{INV_TYPE}] {INV_TYPE_LABEL} — {step_key} [{VOICE NOTE} if applicable]
    - **Investigator:** {doctor_id}
    - **File:** {file_name}   |   **Pages:** {page_count}   |   **Source:** {source}
    - **Parsed at:** {created_at}
    ---

    {raw_markdown content}


    Sorted by: inv_type → step_key → created_at so the output is deterministic.
    """
    docs = list(
        processed_documents_collection.find(
            {"patient_id": case_id},
            {"_id": 0}  # exclude ObjectId — not serialisable
        ).sort([("inv_type", 1), ("step_key", 1), ("created_at", 1)])
    )

    if not docs:
        return ""

    blocks = []

    for doc in docs:
        inv_type   = doc.get("inv_type", "UNKNOWN")
        inv_label  = INV_LABELS.get(inv_type, inv_type)
        step_key   = doc.get("step_key", "unknown_step")
        source     = doc.get("source", "")
        file_name  = doc.get("file_name", "—")
        doctor_id  = doc.get("doctor_id", "—")
        raw_md     = (doc.get("raw_markdown") or "").strip()
        created_at = doc.get("created_at")
        page_count = (doc.get("metadata") or {}).get("page_count", "—")

        is_voice   = source == "VOICE_NOTE"

        # ── heading line ──────────────────────────────────────────────────
        voice_tag  = " [VOICE NOTE]" if is_voice else ""
        heading    = f"## [{inv_type}] {inv_label} — {step_key}{voice_tag}"

        # ── meta line ─────────────────────────────────────────────────────
        created_str = created_at.strftime("%Y-%m-%d %H:%M UTC") if isinstance(created_at, datetime) else str(created_at or "—")
        if is_voice:
            meta = (
                f"- **Investigator:** {doctor_id}\n"
                f"- **Source:** Voice transcription\n"
                f"- **Captured at:** {created_str}"
            )
        else:
            meta = (
                f"- **Investigator:** {doctor_id}\n"
                f"- **File:** {file_name}   |   **Pages:** {page_count}   |   **Source:** {source}\n"
                f"- **Parsed at:** {created_str}"
            )

        # ── assemble block ────────────────────────────────────────────────
        block = (
            f"---\n"
            f"{heading}\n"
            f"{meta}\n"
            f"---\n\n"
            f"{raw_md if raw_md else '_No content extracted._'}"
        )
        blocks.append(block)

    separator = "\n\n\n"  # 3 blank lines between docs for clear visual separation
    return separator.join(blocks)


def _append_investigation_markdown_to_claim(case_id: str) -> None:
    """
    Called once when a claim transitions to COMPLETED.
    Builds the combined markdown from processed_documents and appends it
    to the existing raw_llama_markdown field (preserving allocation-time content).
    """
    combined = _build_combined_markdown(case_id)
    if not combined:
        logger.info("No processed_documents found for %s — skipping markdown append", case_id)
        return

    claim = insurance_collection.find_one({"caseId": case_id}, {"raw_llama_markdown": 1})
    if not claim:
        logger.warning("Claim %s not found when trying to append markdown", case_id)
        return

    existing_md = (claim.get("raw_llama_markdown") or "").strip()

    # Separator block so allocation docs and investigation docs are clearly divided
    divider = (
        "\n\n\n"
        "═══════════════════════════════════════════════════════════\n"
        "## FIELD INVESTIGATION DOCUMENTS\n"
        f"Combined at: {datetime.now(IST).strftime('%Y-%m-%d %H:%M UTC')}  |  Case: {case_id}\n"
        "═══════════════════════════════════════════════════════════\n\n"
    )

    if existing_md:
        final_md = existing_md + divider + combined
    else:
        # No allocation-time markdown — just store investigation docs
        final_md = combined

    insurance_collection.update_one(
        {"caseId": case_id},
        {
            "$set": {
                "raw_llama_markdown":         final_md,
                "investigation_docs_appended": True,
                "investigation_docs_appended_at": datetime.now(IST),
            }
        }
    )
    logger.info(
        "Appended %d chars of investigation markdown to claim %s",
        len(combined), case_id
    )
# ─────────────────────────────────────────────────────────────────────────────
# Helper — push uploaded doc into case_documents for PDF editor
# ─────────────────────────────────────────────────────────────────────────────

def _upsert_case_document(case_id: str, doc_id: str, file_url: str, file_name: str, inv_type: str, step_key: str) -> None:
    if not file_url or file_url == "voice-note":
        return

    full_url = file_url if file_url.startswith("http") else f"{STORAGE_BASE_URL}/files/{file_url}"

    doc_entry = {
        "doc_id":        doc_id,
        "document_id":   doc_id,
        "file_name":     file_name,
        "pdf_url":       full_url,
        "display_label": f"[{inv_type}] {step_key.replace('_', ' ').title()}",
        "inv_type":      inv_type,
        "step_key":      step_key,
        "added_at":      datetime.now(IST),
        "source":        "MOBILE_FIELD_OFFICER",
    }

    claim = insurance_collection.find_one({"caseId": case_id}, {"case_documents": 1})
    if not claim:
        return

    existing_ids = {d.get("doc_id") for d in (claim.get("case_documents") or {}).get("documents", [])}
    if doc_id in existing_ids:
        return

    insurance_collection.update_one(
        {"caseId": case_id},
        {
            "$push": {"case_documents.documents": doc_entry},
            "$set":  {"case_documents.updated_at": datetime.now(IST)},
        }
    )
    logger.info("Added doc %s to case_documents for claim %s", doc_id, case_id)

# ─────────────────────────────────────────────────────────────────────────────
# POST /app/parse-document  — unchanged
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/parse-document")
async def parse_document_for_preview(
    request:  Request,
    file:     UploadFile = File(...),
    step_key: str        = Form(...),
    case_id:  str         = Form(...),
):
    # ── Auth (unchanged) ──────────────────────────────────────────────────
    user_id_from_header = request.headers.get("X-User-Id")
    if user_id_from_header:
        authenticated_user_id = user_id_from_header
    else:
        auth = request.headers.get("authorization")
        if not auth:
            raise HTTPException(status_code=401, detail="Missing token")
        try:
            token = auth.split(" ")[1]
            user  = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            authenticated_user_id = user.get("sub")
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid token")

    allowed_ext = (".pdf", ".jpg", ".jpeg", ".png", ".webp")
    if not file.filename.lower().endswith(allowed_ext):
        raise HTTPException(status_code=400, detail="Only PDF and image files are accepted.")

    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File exceeds 20 MB limit.")
    if not content:
        raise HTTPException(status_code=400, detail="Empty file.")

    # ── Enqueue to Celery instead of parsing inline ────────────────────────
    task_id = f"parse_{uuid.uuid4().hex}"
    now     = datetime.now(IST)

    parse_tasks_collection.insert_one({
        "task_id":    task_id,
        "status":     "pending",
        "step_key":   step_key,
        "case_id":    case_id,
        "doctor_id":  authenticated_user_id,
        "file_name":  file.filename,
        "result":     None,
        "error":      None,
        "created_at": now,
        "updated_at": now,
    })

    celery_client.send_task(
        "mobile_parse.parse_document",
        kwargs={
            "task_id":   task_id,
            "file_b64":  base64.b64encode(content).decode("utf-8"),
            "file_name": file.filename,
            "step_key":  step_key,
            "case_id":   case_id,
        },
        task_id=task_id,
        queue="mobile_parse_queue",
    )

    return {"status": "queued", "task_id": task_id}


@router.get("/parse-document/status/{task_id}")
async def get_parse_document_status(task_id: str, request: Request):
    user_id_from_header = request.headers.get("X-User-Id")
    if not user_id_from_header:
        auth = request.headers.get("authorization")
        if not auth:
            raise HTTPException(status_code=401, detail="Missing token")
        try:
            token = auth.split(" ")[1]
            jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid token")

    doc = parse_tasks_collection.find_one({"task_id": task_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Parse task not found")
    return doc


# ─────────────────────────────────────────────────────────────────────────────
# POST /app/tasks/submit  — same as before + triggers combine on completion
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/tasks/submit")
async def submit_task(request: Request):
    # ── Auth ──────────────────────────────────────────────────────────────
    user_id_from_header   = request.headers.get("X-User-Id")
    user_role_from_header = request.headers.get("X-User-Role")

    if user_id_from_header:
        authenticated_user_id = user_id_from_header
        user_role             = user_role_from_header
    else:
        auth = request.headers.get("authorization")
        if not auth:
            raise HTTPException(status_code=401, detail="Missing token")
        try:
            token = auth.split(" ")[1]
            user  = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            authenticated_user_id = user.get("sub")
            user_role             = user.get("role")
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid token")

    body     = await request.json()
    not_applicable_keys: list = body.get("not_applicable_keys", [])
    task_id  = body.get("task_id")
    user_id  = body.get("user_id")
    vis_type = body.get("type")
    form     = body.get("data", {})
    parsed_documents: dict = body.get("parsed_documents", {})

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

    # ── Persist parsed documents into processed_documents ─────────────────
    stored_parsed_doc_ids = {}
    if parsed_documents:
        for step_key, parse_result in parsed_documents.items():
            if not parse_result.get("raw_markdown"):
                continue

            doc_id   = f"mobile_parse_{uuid.uuid4().hex[:10]}"
            now      = datetime.now(IST)
            raw_md   = parse_result.get("raw_markdown", "")
            sections = parse_result.get("sections", [])
            f_name   = parse_result.get("file_name", f"{step_key}.pdf")

            processed_doc = {
                "document_id": doc_id,
                "patient_id":  task_id,
                "doctor_id":   user_id,
                "file_url":    (
                    normalized_form.get(step_key, {}).get("path")
                    if isinstance(normalized_form.get(step_key), dict)
                    else normalized_form.get(step_key)
                ),
                "file_name":   f_name,
                "step_key":    step_key,
                "inv_type":    vis_type,
                "metadata": {
                    "document_id":     doc_id,
                    "patient_id":      task_id,
                    "doctor_id":       user_id,
                    "file_name":       f_name,
                    "processing_date": now,
                    "page_count":      parse_result.get("page_count", 0),
                    "char_count":      parse_result.get("char_count", len(raw_md)),
                },
                "raw_markdown": raw_md,
                "sections": {
                    "tables":   [],
                    "sections": sections,
                },
                "source":     "MOBILE_FIELD_OFFICER",
                "status":     "processed",
                "created_at": now,
            }

            processed_documents_collection.insert_one(processed_doc)
            stored_parsed_doc_ids[step_key] = doc_id

            # ── Push to case_documents so PDF editor can see it ───────────
            file_url_for_case = (
                normalized_form.get(step_key, {}).get("path")
                if isinstance(normalized_form.get(step_key), dict)
                else normalized_form.get(step_key)
            ) or ""
            _upsert_case_document(
                case_id=task_id,
                doc_id=doc_id,
                file_url=file_url_for_case,
                file_name=f_name,
                inv_type=vis_type,
                step_key=step_key,
            )

            if isinstance(normalized_form.get(step_key), dict):
                normalized_form[step_key]["parsed_document_id"] = doc_id
            else:
                normalized_form[step_key] = {
                    "path":               normalized_form.get(step_key) or "",
                    "parsed_document_id": doc_id,
                    "file_name":          f_name,
                    "status":             "UPLOADED",
                }

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
                or k in na_keys_in_submission   # ← N/A counts as submitted
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
    just_completed = False  # flag: did THIS submit flip the claim to COMPLETED?

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
            # ── All investigator tasks done → mark claim COMPLETED ────────
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

    # ── 4. If claim just completed → combine & append all parsed docs ─────
    if just_completed:
        try:
            _append_investigation_markdown_to_claim(task_id)
        except Exception as exc:
            # Never block the submit response for this — log and continue
            logger.error(
                "Failed to append investigation markdown for %s: %s",
                task_id, exc
            )

    return {
        "status":             "success",
        "message":            "Task submitted successfully",
        "task_id":            task_id,
        "type":               vis_type,
        "submitted_by":       user_id,
        "submission_status":  inv_submission_status,
        "parsed_docs_stored": list(stored_parsed_doc_ids.keys()),
        "progress":           f"{completed}/{total} investigator tasks COMPLETED",
        "claim_completed":    just_completed,  # ← tells mobile claim is fully done
    }


# ─────────────────────────────────────────────────────────────────────────────
# GET /app/tasks/{user_id}  — unchanged
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/tasks/{user_id}")
async def get_tasks(user_id: str, request: Request):
    user_id_from_header   = request.headers.get("X-User-Id")
    user_role_from_header = request.headers.get("X-User-Role")

    if user_id_from_header:
        authenticated_user_id = user_id_from_header
        user_role             = user_role_from_header
    else:
        auth = request.headers.get("authorization")
        if not auth:
            raise HTTPException(status_code=401, detail="Missing token")
        try:
            token = auth.split(" ")[1]
            user  = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            authenticated_user_id = user.get("sub")
            user_role             = user.get("role")
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid token")

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

        task["mySubmissionStatus"]  = {}
        task["mySubmittedFormData"] = {}

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
# POST /app/voice/process  — unchanged, voice notes still go to processed_documents
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

    document_id = f"voice_{uuid.uuid4().hex[:10]}"
    now         = datetime.now(IST)

    doc = {
        "document_id": document_id,
        "patient_id":  patient_id,
        "doctor_id":   doctor_id,
        "file_url":    None,
        "file_name":   f"{step_key}_voice_note.txt",
        "step_key":    step_key,       # ← ensure step_key is stored for combine
        "inv_type":    visit_type,     # ← ensure inv_type is stored for combine
        "metadata": {
            "document_id":     document_id,
            "patient_id":      patient_id,
            "doctor_id":       doctor_id,
            "file_name":       f"{step_key}_voice_note.txt",
            "file_hash":       None,
            "processing_date": now,
            "document_date":   now.date().isoformat(),
            "page_count":      1,
        },
        "raw_markdown": transcript,
        "sections": {
            "tables":   [],
            "sections": [{"heading": "Voice Notes", "content": transcript}],
        },
        "entities":   [],
        "source":     "VOICE_NOTE",
        "visit_type": visit_type,
        "status":     "processed",
        "created_at": now,
    }

    processed_documents_collection.insert_one(doc)

    return {"status": "success", "document_id": document_id}

# ─────────────────────────────────────────────────────────────────────────────
# POST /app/combine-images-pdf
# Accept multiple images, combine into one PDF, upload to storage, return path.
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/combine-images-pdf")
async def combine_images_to_pdf(
    request:  Request,
    files:    List[UploadFile] = File(...),
    case_id:  str              = Form(...),
    step_key: str              = Form(...),
):
    # ── Auth ──────────────────────────────────────────────────────────────
    user_id_from_header = request.headers.get("X-User-Id")
    if user_id_from_header:
        authenticated_user_id = user_id_from_header
    else:
        auth = request.headers.get("authorization")
        if not auth:
            raise HTTPException(status_code=401, detail="Missing token")
        try:
            token = auth.split(" ")[1]
            user  = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            authenticated_user_id = user.get("sub")
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid token")

    if not files:
        raise HTTPException(status_code=400, detail="No images provided")
    if len(files) > 20:
        raise HTTPException(status_code=400, detail="Maximum 20 pages allowed")

    # ── Read all image bytes ───────────────────────────────────────────────
    image_bytes_list = []
    for f in files:
        if not f.filename.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
            raise HTTPException(status_code=400, detail=f"Images only. Got: {f.filename}")
        content = await f.read()
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail=f"{f.filename} exceeds 10MB")
        image_bytes_list.append(content)

    # ── Combine into one PDF (no intermediate storage) ────────────────────
    try:
        pdf_bytes = img2pdf.convert(image_bytes_list, rotation=img2pdf.Rotation.ifvalid)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF creation failed: {str(e)}")

    pdf_filename = f"{step_key}_{uuid.uuid4().hex[:8]}.pdf"

    # ── Store ONLY the PDF via proxy/upload ───────────────────────────────
    # ── Store ONLY the PDF via proxy/upload ───────────────────────────────
    try:
        storage_path = _upload_bytes_to_storage(
            pdf_bytes,
            pdf_filename,
            case_id,
            doctor_id=authenticated_user_id,   # ← add this
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
    """
    Accept N files (images and/or PDFs), merge them into one PDF in order,
    upload to storage, and return the storage_path + metadata.
    """
 
    # ── Auth ──────────────────────────────────────────────────────────────
    user_id_from_header = request.headers.get("X-User-Id")
    if user_id_from_header:
        authenticated_user_id = user_id_from_header
    else:
        from jose import jwt
        import os
        SECRET_KEY = os.getenv("SECRET_KEY")
        ALGORITHM  = os.getenv("ALGORITHM")
        auth = request.headers.get("authorization")
        if not auth:
            raise HTTPException(status_code=401, detail="Missing token")
        try:
            token = auth.split(" ")[1]
            user  = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            authenticated_user_id = user.get("sub")
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid token")
 
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
 
        # ── Image → convert to single-page PDF bytes, then merge ──────────
        if any(fname_lower.endswith(ext) for ext in ALLOWED_IMAGE_EXTS):
            try:
                pdf_bytes = img2pdf.convert(content, rotation=img2pdf.Rotation.ifvalid)
            except Exception as e:
                raise HTTPException(
                    status_code=500,
                    detail=f"Could not convert image '{f.filename}' to PDF: {str(e)}"
                )
            reader = PdfReader(io.BytesIO(pdf_bytes))
 
        # ── PDF → read directly ────────────────────────────────────────────
        else:
            try:
                reader = PdfReader(io.BytesIO(content))
            except Exception as e:
                raise HTTPException(
                    status_code=500,
                    detail=f"Could not read PDF '{f.filename}': {str(e)}"
                )
 
        # Append all pages from this file
        for page in reader.pages:
            writer.add_page(page)
            page_count += 1
 
    if page_count == 0:
        raise HTTPException(status_code=422, detail="No pages could be extracted from the provided files.")
 
    # ── Write merged PDF to bytes ──────────────────────────────────────────
    output_buffer = io.BytesIO()
    writer.write(output_buffer)
    merged_pdf_bytes = output_buffer.getvalue()
 
    # ── Upload to storage ──────────────────────────────────────────────────
    pdf_filename = f"{step_key}_{uuid.uuid4().hex[:8]}.pdf"
    try:
        storage_path = _upload_bytes_to_storage(
            merged_pdf_bytes,
            pdf_filename,
            case_id,
            doctor_id=authenticated_user_id,
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
    action  = body.get("action")  # "accepted" or "declined"
    reason  = body.get("reason", "")

    if action not in ("accepted", "declined"):
        raise HTTPException(status_code=400, detail="action must be accepted or declined")

    # Mark this officer's response on every inv type they're assigned to
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