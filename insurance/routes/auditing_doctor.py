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
from services.template_field_manifests import get_manifest_for_template


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
case_documents_col = db["case_documents"]
user_auth_col      = db["user_auth"]


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
    uid  = request.headers.get("X-User-Id")
    role = request.headers.get("X-User-Role")
    if uid:
        return {"user_id": uid, "role": role}
    auth = request.headers.get("authorization", "")
    if not auth:
        raise HTTPException(status_code=401, detail="Missing auth")
    try:
        token   = auth.split(" ")[1]
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return {"user_id": payload.get("sub"), "role": payload.get("role")}
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


# ─────────────────────────────────────────────────────────────────────────────
# PDF GENERATION
# ─────────────────────────────────────────────────────────────────────────────

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

    doc_record = await case_documents_col.find_one(
        {"case_id": case_id},
        {"_id": 0, "documents": 1, "doctor_upload": 1},
    )
    case["case_documents"] = doc_record or {}

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
    5. Store the generated PDF's public URL in the DB.
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
            "in doctor stats even though the doctor is about to receive the file.",
            case_id,
        )

    # ── 3. Persist edited fields + PDF URL to insurance_claims_new ────────
    set_payload = _build_set_payload(edited_case)

    if pdf_url:
        set_payload["generated_pdf_url"] = pdf_url
        set_payload["generated_pdf_at"]  = datetime.utcnow()

    try:
        await claims_col.update_one(
            {"caseId": case_id},
            {"$set": set_payload},
        )
        logger.info(
            "Saved %d edited fields to DB for case %s (pdf_url=%s)",
            len(set_payload),
            case_id,
            pdf_url,
        )
    except Exception as exc:
        # Non-fatal — PDF is already generated; log and continue
        logger.error("DB update failed for case %s: %s", case_id, exc)

    # ── 4. Also record the PDF URL in case_documents for the viewer ───────
    if pdf_url:
        try:
            now = datetime.utcnow()
            await case_documents_col.update_one(
                {"case_id": case_id},
                {
                    "$set": {
                        "generated_report_url": pdf_url,
                        "generated_report_at":  now,
                        "updated_at":           now,
                    }
                },
                upsert=True,
            )
        except Exception as exc:
            logger.error(
                "case_documents update failed for case %s: %s", case_id, exc
            )

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
    _get_user(request)

    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="JSON object required.")

    existing = await claims_col.find_one({"caseId": case_id}, {"_id": 0, "caseId": 1})
    if not existing:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found.")

    body["caseId"] = case_id  # ensure immutable
    set_payload    = _build_set_payload(body)

    await claims_col.update_one({"caseId": case_id}, {"$set": set_payload})

    return {
        "success":      True,
        "caseId":       case_id,
        "fields_saved": len(set_payload),
        "message":      "Fields saved successfully.",
    }
@router.get("/case/{case_id}/resolved-fields")
async def get_resolved_fields(case_id: str, request: Request):
    """
    Returns which PDF template this case will render with, and — if we have
    one — the exact field manifest for that template, so the doctor can
    verify the right fields before generating.
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
    manifest = get_manifest_for_template(template_name)

    return {
        "success": True,
        "template": template_name,
        "sections": manifest,  # null if we haven't mapped this template yet
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
    #        generate-edited-pdf already own that) ─────────────────────────
    if docx_url:
        try:
            await claims_col.update_one(
                {"caseId": case_id},
                {"$set": {
                    "generated_docx_url": docx_url,
                    "generated_docx_at":  datetime.utcnow(),
                }},
            )
        except Exception as exc:
            logger.error("DB update (docx) failed for case %s: %s", case_id, exc)
 
        try:
            now = datetime.utcnow()
            await case_documents_col.update_one(
                {"case_id": case_id},
                {
                    "$set": {
                        "generated_report_docx_url": docx_url,
                        "generated_report_docx_at":  now,
                        "updated_at":                now,
                    }
                },
                upsert=True,
            )
        except Exception as exc:
            logger.error(
                "case_documents update (docx) failed for case %s: %s", case_id, exc
            )
 
    # ── 4. Stream DOCX back ─────────────────────────────────────────────────
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

    # ── 3. Persist the URL ──────────────────────────────────────────────────
    if docx_url:
        try:
            await claims_col.update_one(
                {"caseId": case_id},
                {"$set": {
                    "generated_formatted_docx_url": docx_url,
                    "generated_formatted_docx_at":  datetime.utcnow(),
                }},
            )
        except Exception as exc:
            logger.error("DB update (formatted docx) failed for case %s: %s", case_id, exc)

        try:
            now = datetime.utcnow()
            await case_documents_col.update_one(
                {"case_id": case_id},
                {
                    "$set": {
                        "generated_report_formatted_docx_url": docx_url,
                        "generated_report_formatted_docx_at":  now,
                        "updated_at":                          now,
                    }
                },
                upsert=True,
            )
        except Exception as exc:
            logger.error(
                "case_documents update (formatted docx) failed for case %s: %s", case_id, exc
            )

    # ── 4. Stream DOCX back ─────────────────────────────────────────────────
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