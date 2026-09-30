"""
Celery task: parses every field-investigation document for a case AFTER
QC verifies it (see qc_review.py::verify_claim). Reads/writes entirely
via insurance_claims_new.investigationDocuments[] — processed_documents
is no longer used anywhere in this pipeline.

Each PDF's markdown block is tagged with an [INV_TYPE/step_key] marker in
its filename so:
  - append_markdown_block_atomic stores it as a distinct block
  - RawDocument.jsx's splitAndAnnotate/inferDocType shows it under the
    right header in the PDF editor
  - the conclusion-generation LLM knows which investigation type/step
    each block came from

Once all documents are parsed, this enqueues regenerate_findings.run for
the case so QC/doctor immediately see fresh flags without a manual
"Re-check flags" click.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone, timedelta

import httpx
from motor.motor_asyncio import AsyncIOMotorClient

from .celery_app import celery_app
from routes.case_documents_router import _llamacloud_parse, append_markdown_block_atomic

logger = logging.getLogger(__name__)
IST = timezone(timedelta(hours=5, minutes=30))
MONGO_URI = os.getenv("MONGO_URI")
STORAGE_BASE_URL = os.getenv("STORAGE_BASE_URL", "https://doctorassist.ai/uploads")


def _full_url(path: str) -> str:
    if not path:
        return path
    if path.startswith("http://") or path.startswith("https://"):
        return path
    return f"{STORAGE_BASE_URL}/files/{path}"


async def _fetch_bytes(url: str) -> bytes:
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.content




async def _process_case_investigation_docs(task_id: str, case_id: str) -> None:
    motor_client = AsyncIOMotorClient(MONGO_URI)
    db = motor_client["doctorassistai"]
    insurance_claims_col      = db["insurance_claims_new"]
    advanced_upload_tasks_col = db["advanced_upload_tasks"]

    parsed_count = 0
    failed = []

    try:
        claim = await insurance_claims_col.find_one(
            {"caseId": case_id}, {"investigationDocuments": 1}
        )
        docs = [
            d for d in (claim or {}).get("investigationDocuments", [])
            if d.get("status") == "queued_for_parse"
        ]

        if not docs:
            await advanced_upload_tasks_col.update_one(
                {"task_id": task_id},
                {"$set": {
                    "status": "success",
                    "result": {"parsed_count": 0, "message": "No documents were queued for parsing."},
                    "updated_at": datetime.now(IST),
                }},
            )
            return

        for doc in docs:
            doc_id    = doc["doc_id"]
            inv_type  = doc.get("inv_type", "UNKNOWN")
            step_key  = doc.get("step_key", "unknown_step")
            file_name = doc.get("file_name") or f"{step_key}.pdf"
            kind      = doc.get("kind", "document")

            # Tag filename with the investigation marker so downstream
            # (RawDocument.jsx, findings, conclusion) can attribute the
            # block correctly. Format: "[MV/mv_visit_date] originalname.pdf"
            tagged_filename = f"[{inv_type}/{step_key}] {file_name}"

            try:
                if kind == "voice":
                    # Transcript is already text — no LlamaCloud call needed,
                    # just wrap it in the same PDF_START/PAGE_START marker
                    # shape so splitAndAnnotate treats it identically.
                    transcript = doc.get("raw_markdown") or ""
                    if not transcript.strip():
                        raise ValueError("Voice note has no transcript text.")
                    full_markdown = (
                        f"<!-- PDF_START: {tagged_filename} -->\n"
                        f"<!-- PAGE_START: 1 -->\n{transcript}\n<!-- PAGE_END: 1 -->\n"
                        f"<!-- PDF_END: {tagged_filename} -->"
                    )
                    page_count = 1
                else:
                    pdf_url = doc.get("pdf_url") or _full_url(doc.get("storage_path"))
                    if not pdf_url:
                        raise ValueError("No storage_path/pdf_url on document.")
                    content = await _fetch_bytes(pdf_url)
                    # _llamacloud_parse writes the incoming bytes to a temp
                    # file under /tmp using this filename directly, so the
                    # "/" inside our [INV_TYPE/step_key] tag gets read as a
                    # path separator (e.g. "/tmp/[MV" as a directory) and
                    # blows up with ENOENT. Give it a filesystem-safe name,
                    # then swap the real tagged name back into the returned
                    # markdown so RawDocument.jsx's splitAndAnnotate still
                    # sees the "/"-bearing marker it expects.
                    safe_filename = tagged_filename.replace("/", "-")
                    full_markdown, page_count = await _llamacloud_parse(content, safe_filename)
                    if not full_markdown.strip():
                        raise ValueError("LlamaCloud returned no text.")
                    full_markdown = full_markdown.replace(safe_filename, tagged_filename)

                # Case-level combined store: append_markdown_block_atomic
                # writes this block into the same raw_llama_markdown field
                # the case-document upload path uses, deduped by
                # tagged_filename so a retried doc never duplicates itself.
                await append_markdown_block_atomic(
                    insurance_claims_col, case_id, doc_id, tagged_filename, full_markdown
                )

                await insurance_claims_col.update_one(
                    {"caseId": case_id, "investigationDocuments.doc_id": doc_id},
                    {"$set": {
                        "investigationDocuments.$.status":             "processed",
                        "investigationDocuments.$.raw_markdown_block":  full_markdown,
                        "investigationDocuments.$.page_count":          page_count,
                        "investigationDocuments.$.tagged_file_name":    tagged_filename,
                        "investigationDocuments.$.parsed_at":           datetime.now(IST).isoformat(),
                    }},
                )
                parsed_count += 1

            except Exception as exc:
                logger.error(
                    "field_investigation_parse: failed on doc %s (%s/%s) for case %s: %s",
                    doc_id, inv_type, step_key, case_id, exc,
                )
                await insurance_claims_col.update_one(
                    {"caseId": case_id, "investigationDocuments.doc_id": doc_id},
                    {"$set": {
                        "investigationDocuments.$.status":      "parse_failed",
                        "investigationDocuments.$.parse_error": str(exc),
                    }},
                )
                failed.append({"doc_id": doc_id, "inv_type": inv_type, "step_key": step_key, "error": str(exc)})

        status = "success" if not failed or parsed_count > 0 else "failed"
        await advanced_upload_tasks_col.update_one(
            {"task_id": task_id},
            {"$set": {
                "status": status,
                "result": {
                    "parsed_count": parsed_count,
                    "failed_count": len(failed),
                    "failed": failed,
                },
                "error": None if status == "success" else "One or more documents failed to parse.",
                "updated_at": datetime.now(IST),
            }},
        )
        logger.info(
            "field_investigation_parse: case %s done — %d parsed, %d failed",
            case_id, parsed_count, len(failed),
        )

        # ── Kick off findings regeneration now that new markdown exists ───
        # (disabled via ENABLE_FINDINGS_REGEN, see top of task definition)
        if ENABLE_FINDINGS_REGEN and parsed_count > 0:
            import uuid
            from celery_client import celery_client
            findings_task_id = f"findings_{uuid.uuid4().hex}"
            now = datetime.now(IST)
            await advanced_upload_tasks_col.insert_one({
                "task_id":        findings_task_id,
                "case_id":        case_id,
                "doc_id":         None,
                "task_type":      "findings",
                "file_name":      "Findings regeneration",
                "display_label":  "Findings regeneration",
                "supervisor_id":  None,
                "status":         "queued",
                "result":         None,
                "error":          None,
                "total_pages":    None,
                "created_at":     now,
                "updated_at":     now,
            })
            celery_client.send_task(
                "regenerate_findings.run",
                kwargs={"task_id": findings_task_id, "case_id": case_id},
                task_id=findings_task_id,
                queue="advanced_upload_queue",
            )
            logger.info("field_investigation_parse: enqueued findings regen %s for case %s", findings_task_id, case_id)

    except Exception as exc:
        logger.error("field_investigation_parse: fatal error for case %s: %s", case_id, exc)
        await advanced_upload_tasks_col.update_one(
            {"task_id": task_id},
            {"$set": {"status": "failed", "error": str(exc), "updated_at": datetime.now(IST)}},
        )
    finally:
        motor_client.close()


# Findings regeneration after field-investigation parsing is disabled: doctors
# now read the PDFs directly and write the conclusion manually. Set to True
# to restore the old behaviour.
ENABLE_FINDINGS_REGEN = False


@celery_app.task(name="field_investigation_parse.run", bind=True, max_retries=1, default_retry_delay=30)
def run_field_investigation_parse(self, task_id, case_id):
    asyncio.run(_process_case_investigation_docs(task_id, case_id))