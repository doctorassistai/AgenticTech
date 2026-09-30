from fastapi import APIRouter, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime
from typing import Optional
import os
import re
import httpx
import logging
from dotenv import load_dotenv
from jose import jwt
from fastapi.responses import FileResponse
from services.pdf_generator import resolve_template, get_pdf_filename_base
from services.template_field_manifests import get_manifest_or_default
from celery_client import celery_client

load_dotenv()
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/web/doctor", tags=["AuditingDoctor"])

MONGO_URI        = os.getenv("MONGO_URI")
MONGO_DB         = os.getenv("MONGO_DB", "doctorassistai")
SECRET_KEY       = os.getenv("SECRET_KEY")
ALGORITHM        = os.getenv("ALGORITHM", "HS256")
PROXY_UPLOAD_URL = os.getenv("PROXY_UPLOAD_URL", "http://common:8000/storage/proxy/upload")
STORAGE_BASE_URL = os.getenv("STORAGE_BASE_URL", "https://doctorassist.ai/uploads")

motor_client       = AsyncIOMotorClient(MONGO_URI)
db                 = motor_client[MONGO_DB]
claims_col         = db["insurance_claims_new"]
user_auth_col      = db["user_auth"]
template_extractions_col = db["template_field_extractions"]


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _wrap_conclusion_images_for_weasyprint(html: str) -> str:
    """
    WeasyPrint handles data: URIs natively.
    Enforce max-width so images never overflow the PDF column.
    """
    def _add_style(match):
        tag = match.group(0)
        if "max-width" not in tag:
            tag = tag.replace(
                "<img ",
                '<img style="max-width:160mm;height:auto;display:block;margin:4px 0;" ',
                1,
            )
        return tag

    return re.sub(r"<img[^>]+>", _add_style, html, flags=re.IGNORECASE)


def _conclusion_to_safe_html(conclusion_raw: str) -> str:
    """
    Accept either:
      • Raw HTML from the rich editor  → wrap images, pass through as-is
      • Plain text                     → convert newlines to <p> tags

    The conclusion_html_formatter module is intentionally NOT used here.
    """
    if not conclusion_raw:
        return '<p class="no-conclusion">No conclusion provided.</p>'

    is_html = bool(re.search(r"<[a-zA-Z][^>]*>", conclusion_raw))

    if is_html:
        return _wrap_conclusion_images_for_weasyprint(conclusion_raw)

    # Plain text → wrap each non-empty line in a <p>
    paragraphs = [
        f"<p>{line.strip()}</p>"
        for line in conclusion_raw.splitlines()
        if line.strip()
    ]
    return "\n".join(paragraphs) if paragraphs else '<p class="no-conclusion">No conclusion provided.</p>'

def _get_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload  = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id  = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        return {"user_id": user_id, "role": payload.get("role")}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Token expired or invalid")
# ─────────────────────────────────────────────────────────────────────────────
# PDF GENERATION
# ─────────────────────────────────────────────────────────────────────────────

def _enqueue_pattern_analysis(case_id: str, user_id: str, trigger: str, conclusion: str):
    """Fire-and-forget. Must never break save/generate if the broker is down."""
    try:
        if not (conclusion or "").strip():
            logger.warning("pattern analysis skipped for %s: empty conclusion (trigger=%s)", case_id, trigger)
            return
        logger.info("pattern analysis enqueued for %s (trigger=%s, %d chars)", case_id, trigger, len(conclusion))
        celery_client.send_task(
            "doctor_pattern.analyze",
            kwargs={
                "case_id": case_id,
                "doctor_id": user_id,
                "trigger": trigger,
                "conclusion": conclusion,
            },
            queue="advanced_upload_queue",
        )
    except Exception as exc:
        logger.error("pattern analysis enqueue failed for %s: %s", case_id, exc)


def _generate_pdf_from_edited_case(case_data: dict) -> str:
    from services.pdf_generator import generate_investigation_pdf_edited
    return generate_investigation_pdf_edited(case_data)

async def _upload_pdf_to_storage(
    pdf_path: str,
    case_id: str,
    user_id: str,
) -> Optional[str]:
    """
    Push the generated PDF directly to the storage service (same pattern as
    document uploads in case_documents_router.py), bypassing the common:8000
    proxy which has been unreliable.
    """
    try:
        filename = os.path.basename(pdf_path)
        with open(pdf_path, "rb") as fh:
            pdf_bytes = fh.read()

        upload_url = f"{STORAGE_BASE_URL}/upload"
        params = {
            "doctor_id":   user_id,
            "patient_id":  case_id,
            "doc_type":    "generated_report",
            "category":    None,
            "subcategory": None,
        }
        files = {"file": (filename, pdf_bytes, "application/pdf")}

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(upload_url, params=params, files=files)

        if resp.status_code == 200:
            upload_result = resp.json()
            full_path = upload_result.get("filename", "")
            if full_path:
                stored_filename = full_path.split("/")[-1]
                url = f"{STORAGE_BASE_URL}/files/{case_id}/{stored_filename}"
                logger.info("Generated PDF stored at %s", url)
                return url
            logger.error("Storage upload for case %s returned no filename: %s", case_id, upload_result)
        else:
            logger.error(
                "PDF direct storage upload failed (%s) for case %s: %s",
                resp.status_code, case_id, resp.text,
            )
    except Exception as exc:
        logger.error("PDF direct storage upload exception for case %s: %s", case_id, exc)

    return None


async def _upload_docx_to_storage(
    docx_path: str,
    case_id: str,
    user_id: str,
    doc_type: str = "generated_report_docx",
) -> Optional[str]:
    """Push the generated DOCX directly to the storage service."""
    try:
        filename = os.path.basename(docx_path)
        with open(docx_path, "rb") as fh:
            docx_bytes = fh.read()

        upload_url = f"{STORAGE_BASE_URL}/upload"
        params = {
            "doctor_id":   user_id,
            "patient_id":  case_id,
            "doc_type":    doc_type,
            "category":    None,
            "subcategory": None,
        }
        files = {
            "file": (
                filename,
                docx_bytes,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        }

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(upload_url, params=params, files=files)

        if resp.status_code == 200:
            upload_result = resp.json()
            full_path = upload_result.get("filename", "")
            if full_path:
                stored_filename = full_path.split("/")[-1]
                url = f"{STORAGE_BASE_URL}/files/{case_id}/{stored_filename}"
                logger.info("Generated DOCX stored at %s", url)
                return url
            logger.error("Storage upload (docx) for case %s returned no filename: %s", case_id, upload_result)
        else:
            logger.error(
                "DOCX direct storage upload failed (%s) for case %s: %s",
                resp.status_code, case_id, resp.text,
            )
    except Exception as exc:
        logger.error("DOCX direct storage upload exception for case %s: %s", case_id, exc)

    return None


# ─────────────────────────────────────────────────────────────────────────────
# FIELD MERGING HELPER
# ─────────────────────────────────────────────────────────────────────────────

_NESTED_KEYS = {
    "hospitalDetails", "criticalDetails", "additionalMedicalDetails",
    "billingDetails", "investigationDetails", "medicalStaff",
    "accidentDetails", "policyDetails", "cashlessDetails",
    "reimbursementDetails", "deathDetails", "obstetricDetails",
    "riskDetails", "checklist", "briefVerification", "briefComments",
    "briefInsured", "briefInvestigation", "interviewDetails",
}

# Fields that must NOT be overwritten by the edited payload
_IMMUTABLE_FIELDS = {"caseId", "createdAt", "status", "_id"}


def _build_set_payload(edited: dict) -> dict:
    """
    Convert the doctor's edited case dict into a MongoDB $set payload.

    • Top-level scalar fields  → set directly
    • Nested dict fields       → set as whole sub-document (doctor edited them)
    • Immutable fields         → skipped

    NOTE: "status" is deliberately in _IMMUTABLE_FIELDS so an edited-fields
    payload can never accidentally overwrite it — the report-generation
    routes below set status:"COMPLETED" explicitly and separately, after
    calling this helper.
    """
    payload = {}
    for key, value in edited.items():
        if key in _IMMUTABLE_FIELDS:
            continue
        if value is None:
            continue
        payload[key] = value

    payload["updatedAt"] = datetime.utcnow()
    return payload


# ─────────────────────────────────────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/my-cases")
async def get_doctor_cases(request: Request):
    """
    Return all cases assigned to this auditing doctor.
    Matches on:
      1. doctor_assigned == doctor_sys_id, OR
      2. doctor_assigned is null/missing AND qcDecision.doctor_id == doctor_sys_id
    """
    user          = _get_user(request)
    doctor_sys_id = user["user_id"]
    logger.info("Resolved doctor_sys_id = %r", doctor_sys_id)

    query = {
        "$or": [
            {"doctor_assigned": doctor_sys_id},
            {
                "doctor_assigned": {"$in": [None, ""]},
                "qcDecision.doctor_id": doctor_sys_id,
            },
            {
                "doctor_assigned": {"$exists": False},
                "qcDecision.doctor_id": doctor_sys_id,
            },
        ]
    }

    cursor = claims_col.find(
        query,
        {
            "_id": 0,
            "caseId": 1,
            "status": 1,
            "insurerRef": 1,
            "claimantName": 1,
            "insurer": 1,
            "claimMode": 1,
            "claimSubtype": 1,
            "claimedAmount": 1,
            "claimPriority": 1,
            "tags": 1,
            "targetDate": 1,
            "createdAt": 1,
            "updatedAt": 1,
            "hospitalDetails": 1,
            "doctor_assigned": 1,
            "raw_llama_markdown": 1,
        },
    ).sort("updatedAt", -1)

    cases = await cursor.to_list(length=500)

    for c in cases:
        if isinstance(c.get("createdAt"), datetime):
            c["createdAt"] = c["createdAt"].isoformat()
        if isinstance(c.get("updatedAt"), datetime):
            c["updatedAt"] = c["updatedAt"].isoformat()
        c["has_markdown"] = bool(c.get("raw_llama_markdown"))

    return {"success": True, "cases": cases, "count": len(cases)}

@router.get("/case/{case_id}")
async def get_doctor_case_detail(case_id: str, request: Request):
    """
    Full case details for a specific case, including raw_llama_markdown.
    Accessible if:
      1. doctor_assigned == doctor_sys_id, OR
      2. doctor_assigned is null/missing AND qcDecision.doctor_id == doctor_sys_id
    """
    user          = _get_user(request)
    doctor_sys_id = user["user_id"]

    case = await claims_col.find_one(
        {
            "caseId": case_id,
            "$or": [
                {"doctor_assigned": doctor_sys_id},
                {
                    "doctor_assigned": {"$in": [None, ""]},
                    "qcDecision.doctor_id": doctor_sys_id,
                },
                {
                    "doctor_assigned": {"$exists": False},
                    "qcDecision.doctor_id": doctor_sys_id,
                },
            ],
        },
        {"_id": 0},
    )

    if not case:
        raise HTTPException(
            status_code=404,
            detail="Case not found or not assigned to you.",
        )

    if isinstance(case.get("createdAt"), datetime):
        case["createdAt"] = case["createdAt"].isoformat()
    if isinstance(case.get("updatedAt"), datetime):
        case["updatedAt"] = case["updatedAt"].isoformat()

    # case_documents_col is no longer written to (see case_documents_router.py —
    # uploads now push into insurance_claims_new.supportingDocuments[] directly).
    # Rebuild the shape the frontend expects ({documents: [...]}) from that
    # array instead of a collection that's permanently empty now.
    supporting_docs = case.get("supportingDocuments", []) or []
    documents = [
        {
            "doc_id": d.get("doc_id"),
            "file_name": d.get("file_name"),
            "display_label": d.get("display_label"),
            "pdf_url": d.get("pdf_url"),
            "storage_path": d.get("storage_path"),
            "fields_found": d.get("fields_found"),
            "status": d.get("status"),
            "uploaded_at": d.get("uploaded_at"),
        }
        for d in supporting_docs
    ]

    # Field-investigation documents (MV/HV/HVI/etc., uploaded via the
    # mobile field officer app and parsed by field_investigation_parse.py)
    # are the source files behind the [INV_TYPE/step_key] blocks already
    # showing in the Raw Document tab's raw_llama_markdown — they need to
    # appear in this same sidebar list so the doctor can open/preview them
    # from Documents too. Skip entries with no pdf_url (NOT_APPLICABLE /
    # voice-note placeholders with nothing to preview as a PDF).
    # Dedupe by storage_path — the mobile field officer app can append a
    # fresh investigationDocuments entry (new doc_id) on every submission/
    # resubmission for the same step instead of updating one in place, so
    # the same physical file can appear 2-3+ times in this array. Keep only
    # the most recently added entry per storage_path so the sidebar shows
    # each real file once.
    investigation_docs = case.get("investigationDocuments", []) or []
    latest_by_path = {}
    for d in investigation_docs:
        path = d.get("storage_path")
        if not path or not d.get("pdf_url"):
            continue
        existing = latest_by_path.get(path)
        if not existing or (d.get("added_at") or "") > (existing.get("added_at") or ""):
            latest_by_path[path] = d

    documents += [
        {
            "doc_id": d.get("doc_id"),
            "file_name": d.get("file_name"),
            "display_label": d.get("display_label"),
            "pdf_url": d.get("pdf_url"),
            "storage_path": d.get("storage_path"),
            "fields_found": None,
            "status": d.get("status"),
            "uploaded_at": d.get("added_at"),
        }
        for d in latest_by_path.values()
    ]

    case["case_documents"] = {"documents": documents}

    return {"success": True, "case": case}


@router.get("/case/{case_id}/download-pdf")
async def download_pdf(case_id: str):
    """Generate (or regenerate) the standard PDF for a case and stream it."""
    from services.pdf_generator import generate_investigation_pdf

    case = await claims_col.find_one({"caseId": case_id}, {"_id": 0})
    if not case:
        raise HTTPException(404, "Case not found")

    pdf_path = generate_investigation_pdf(case)
    fname = f"{get_pdf_filename_base(case)}.pdf"

    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=fname,
    )


@router.post("/case/{case_id}/generate-edited-pdf")
async def generate_edited_pdf(case_id: str, request: Request):
    """
    1. Accept the doctor's fully-edited case dict (conclusion may be rich HTML
       with embedded base64 images).
    2. Generate PDF via WeasyPrint.
    3. Upload the PDF to the storage proxy under the case_id.
    4. Persist the edited fields into insurance_claims_new (DB sync).
    5. Store the generated PDF's public URL in the DB, and mark the case
       COMPLETED — generating a report is the doctor's terminal action.
    6. Stream the PDF back as a download.

    Request body:
        { "case_data": { ...all edited fields, conclusion: "<html>..." } }
    """
    user = _get_user(request)

    body        = await request.json()
    edited_case = body.get("case_data")

    if not edited_case or not isinstance(edited_case, dict):
        raise HTTPException(status_code=400, detail="case_data is required.")

    # Confirm the case exists
    existing = await claims_col.find_one(
        {"caseId": case_id}, {"_id": 0, "caseId": 1}
    )
    if not existing:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found.")

    # Lock caseId from URL — never trust the body
    edited_case["caseId"] = case_id

    # ── 1. Generate PDF ───────────────────────────────────────────────────
    try:
        pdf_path = _generate_pdf_from_edited_case(edited_case)
    except Exception as exc:
        logger.exception("PDF generation failed for case %s", case_id)
        raise HTTPException(
            status_code=500, detail=f"PDF generation failed: {exc}"
        )

    # ── 2. Upload PDF to storage proxy ────────────────────────────────────
    pdf_url = await _upload_pdf_to_storage(
        pdf_path=pdf_path,
        case_id=case_id,
        user_id=user["user_id"],
    )
    if not pdf_url:
        logger.error(
            "PDF generated for case %s but storage upload failed — "
            "generated_pdf_at will NOT be recorded, so this will be invisible "
            "in doctor stats even though the doctor is about to receive the file. "
            "Status will NOT be moved to COMPLETED either, for the same reason.",
            case_id,
        )

    # ── 3. Persist edited fields + PDF URL to insurance_claims_new ────────
    set_payload = _build_set_payload(edited_case)

    if pdf_url:
        set_payload["generated_pdf_url"] = pdf_url
        set_payload["generated_pdf_at"]  = datetime.utcnow()
        # Report successfully generated & stored → case is done.
        set_payload["status"] = "COMPLETED"

    try:
        await claims_col.update_one(
            {"caseId": case_id},
            {"$set": set_payload},
        )
        logger.info(
            "Saved %d edited fields to DB for case %s (pdf_url=%s, status=%s)",
            len(set_payload),
            case_id,
            pdf_url,
            set_payload.get("status", "<unchanged>"),
        )
    except Exception as exc:
        # Non-fatal — PDF is already generated; log and continue
        logger.error("DB update failed for case %s: %s", case_id, exc)
    # generated_pdf_url / generated_pdf_at are already persisted onto the
    # claim doc in step 3's set_payload above (which is what the frontend
    # and get_doctor_case_detail actually read) — the old case_documents_col
    # write here was a second, unread copy of the same data. Removed.

    _enqueue_pattern_analysis(case_id, user["user_id"], "pdf", edited_case.get("conclusion", ""))

    # ── 5. Stream PDF back ────────────────────────────────────────────────
    fname = f"{get_pdf_filename_base(edited_case)}_edited.pdf"

    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=fname,
        headers={
            "Content-Disposition": f'attachment; filename="{fname}"',
            # Expose the stored URL to the frontend in a response header
            "X-Generated-PDF-URL": pdf_url or "",
        },
    )


@router.patch("/case/{case_id}/save-fields")
async def save_edited_fields(case_id: str, request: Request):
    """
    Lightweight endpoint to persist ONLY the form fields the doctor edited,
    without regenerating the PDF.  Useful for auto-save / manual save.

    Request body: the partial or full case dict with changed fields.
    """
    user = _get_user(request)

    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="JSON object required.")

    existing = await claims_col.find_one({"caseId": case_id}, {"_id": 0, "caseId": 1})
    if not existing:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found.")

    body["caseId"] = case_id  # ensure immutable
    set_payload    = _build_set_payload(body)

    await claims_col.update_one({"caseId": case_id}, {"$set": set_payload})

    _enqueue_pattern_analysis(case_id, user["user_id"], "save", body.get("conclusion", ""))

    return {
        "success":      True,
        "caseId":       case_id,
        "fields_saved": len(set_payload),
        "message":      "Fields saved successfully.",
    }
@router.patch("/case/{case_id}/agentic-investigation-review")
async def save_agentic_investigation_review(case_id: str, request: Request):
    """
    Batched save of which agentic-investigation findings the doctor has
    checked — called once from the "Continue to Conclusion" button, not
    per-checkbox, so reviewing many findings doesn't fire a request per click.

    Request body: { "checked": { "<agent>:<findingIndex>": true, ... } }
    """
    _get_user(request)

    body = await request.json()
    checked = body.get("checked")
    if not isinstance(checked, dict):
        raise HTTPException(status_code=400, detail="checked must be a JSON object.")

    existing = await claims_col.find_one({"caseId": case_id}, {"_id": 0, "caseId": 1})
    if not existing:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found.")

    await claims_col.update_one(
        {"caseId": case_id},
        {"$set": {
            "agenticInvestigationReview": checked,
            "updatedAt": datetime.utcnow(),
        }},
    )

    return {
        "success": True,
        "caseId": case_id,
        "checked_count": len(checked),
        "message": "Investigation review saved.",
    }
@router.get("/case/{case_id}/resolved-fields")
async def get_resolved_fields(case_id: str, request: Request):
    """
    Returns which PDF template this case will render with, and the field
    manifest for that template (falls back to a generic manifest if this
    template isn't individually mapped yet — see get_manifest_or_default) —
    merged in per field with every candidate value the last "Generate
    Conclusion" run's extraction pass found (services/template_field_extractor.py),
    persisted in the template_field_extractions collection so a page refresh
    never loses them.

    A field with 0 or 1 candidate is left for the doctor to fill/edit
    normally. A field with 2+ candidates is returned with "candidates":
    [...] so the frontend can render it as a pick-one-or-override chip row.
    """
    user = _get_user(request)

    case = await claims_col.find_one(
        {"caseId": case_id, "doctor_assigned": user["user_id"]},
        {"_id": 0, "insurer": 1, "tpaName": 1, "claimMode": 1, "claimedAmount": 1},
    )
    if not case:
        raise HTTPException(status_code=404, detail="Case not found or not assigned to you.")

    config = resolve_template(
        insurer=case.get("insurer", ""),
        tpa=case.get("tpaName", ""),
        claim_mode=case.get("claimMode", ""),
        case_data=case,
    )
    template_name = config.get("template")
    manifest = get_manifest_or_default(template_name)

    extraction_doc = await template_extractions_col.find_one({"caseId": case_id}, {"_id": 0, "fields": 1})
    field_candidates = (extraction_doc or {}).get("fields") or {}

    annotated_manifest = []
    for section in manifest:
        new_fields = []
        for f in section.get("fields", []):
            candidates = field_candidates.get(f["key"])
            new_f = dict(f)
            if candidates:
                new_f["candidates"] = candidates
            new_fields.append(new_f)
        annotated_manifest.append({**section, "fields": new_fields})

    return {
        "success": True,
        "template": template_name,
        "sections": annotated_manifest,
    }

def _generate_docx_from_edited_case(case_data: dict) -> str:
    from services.docx_generator import build_case_docx
    return build_case_docx(case_data)


def _generate_formatted_docx_from_edited_case(case_data: dict) -> str:
    from services.docx_generator import build_formatted_docx
    return build_formatted_docx(case_data)


 
# Reuses the exact same request body shape ({"case_data": {...}}) so the
# frontend can call it with the same payload it already builds for the PDF.
 
@router.post("/case/{case_id}/generate-edited-docx")
async def generate_edited_docx(case_id: str, request: Request):
    """
    Same flow as generate-edited-pdf, but produces a generic, non-templated
    .docx containing every case field + the parsed conclusion, so the doctor
    can copy-paste into whatever format they ultimately need.

    Also marks the case COMPLETED on a successful upload — generating any
    one of the three report formats (PDF / DOCX / formatted DOCX) is treated
    as the doctor's terminal action for the case.
    """
    user = _get_user(request)
 
    body        = await request.json()
    edited_case = body.get("case_data")
 
    if not edited_case or not isinstance(edited_case, dict):
        raise HTTPException(status_code=400, detail="case_data is required.")
 
    existing = await claims_col.find_one(
        {"caseId": case_id}, {"_id": 0, "caseId": 1}
    )
    if not existing:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found.")
 
    edited_case["caseId"] = case_id  # never trust the body
 
    # ── 1. Generate DOCX ───────────────────────────────────────────────────
    try:
        docx_path = _generate_docx_from_edited_case(edited_case)
    except Exception as exc:
        logger.exception("DOCX generation failed for case %s", case_id)
        raise HTTPException(
            status_code=500, detail=f"DOCX generation failed: {exc}"
        )
 
    # ── 2. Upload to storage proxy ─────────────────────────────────────────
    docx_url = await _upload_docx_to_storage(
        docx_path=docx_path,
        case_id=case_id,
        user_id=user["user_id"],
    )
 
    # ── 3. Persist the URL (does NOT touch the edited fields — save-fields /
    #        generate-edited-pdf already own that) and mark COMPLETED ──────
    if docx_url:
        try:
            await claims_col.update_one(
                {"caseId": case_id},
                {"$set": {
                    "generated_docx_url": docx_url,
                    "generated_docx_at":  datetime.utcnow(),
                    "status":             "COMPLETED",
                }},
            )
        except Exception as exc:
            logger.error("DB update (docx) failed for case %s: %s", case_id, exc)
         # generated_docx_url is already persisted onto the claim doc a few
        # lines above — that's what the frontend/get_doctor_case_detail
        # actually read, so the old case_documents_col write here was dead.

    # ── 4. Stream DOCX back ─────────────────────────────────────────────────
    _enqueue_pattern_analysis(case_id, user["user_id"], "docx", edited_case.get("conclusion", ""))

    fname = f"{get_pdf_filename_base(edited_case)}_edited.docx"

    return FileResponse(
        docx_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=fname,
        headers={
            "Content-Disposition": f'attachment; filename="{fname}"',
            "X-Generated-DOCX-URL": docx_url or "",
        },
    )


@router.post("/case/{case_id}/generate-formatted-docx")
async def generate_formatted_docx(case_id: str, request: Request):
    """
    Same as generate-edited-docx, but produces a Word document that mirrors
    the actual insurer/TPA PDF template layout (same headings, tables and
    images as the PDF) instead of a generic field dump — so the doctor gets
    an editable copy that already looks like the final report.

    Also marks the case COMPLETED on a successful upload (see note in
    generate_edited_docx above).

    Request body:
        { "case_data": { ...all edited fields, conclusion: "<html>..." } }
    """
    user = _get_user(request)

    body        = await request.json()
    edited_case = body.get("case_data")

    if not edited_case or not isinstance(edited_case, dict):
        raise HTTPException(status_code=400, detail="case_data is required.")

    existing = await claims_col.find_one(
        {"caseId": case_id}, {"_id": 0, "caseId": 1}
    )
    if not existing:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found.")

    edited_case["caseId"] = case_id  # never trust the body

    # ── 1. Generate formatted DOCX (same template render as the PDF) ──────
    try:
        docx_path = _generate_formatted_docx_from_edited_case(edited_case)
    except Exception as exc:
        logger.exception("Formatted DOCX generation failed for case %s", case_id)
        raise HTTPException(
            status_code=500, detail=f"Formatted DOCX generation failed: {exc}"
        )

    # ── 2. Upload to storage proxy ─────────────────────────────────────────
    docx_url = await _upload_docx_to_storage(
        docx_path=docx_path,
        case_id=case_id,
        user_id=user["user_id"],
        doc_type="generated_report_formatted_docx",
    )

    # ── 3. Persist the URL and mark COMPLETED ──────────────────────────────
    if docx_url:
        try:
            await claims_col.update_one(
                {"caseId": case_id},
                {"$set": {
                    "generated_formatted_docx_url": docx_url,
                    "generated_formatted_docx_at":  datetime.utcnow(),
                    "status":                        "COMPLETED",
                }},
            )
        except Exception as exc:
            logger.error("DB update (formatted docx) failed for case %s: %s", case_id, exc)


    # ── 4. Stream DOCX back ─────────────────────────────────────────────────
    _enqueue_pattern_analysis(case_id, user["user_id"], "formatted_docx", edited_case.get("conclusion", ""))

    fname = f"{get_pdf_filename_base(edited_case)}_formatted.docx"

    return FileResponse(
        docx_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=fname,
        headers={
            "Content-Disposition": f'attachment; filename="{fname}"',
            "X-Generated-FORMATTED-DOCX-URL": docx_url or "",
        },
    )