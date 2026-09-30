"""
Celery task for the /web/upload-document (Claim Detail Documents) pipeline.

Mirrors advanced_upload_task.py's shape exactly. Previously this pipeline
(LlamaCloud parse -> multi-agent extraction -> map-reduce findings) ran
synchronously inside the FastAPI request handler, which could exceed the
browser/proxy timeout on large documents -> the frontend would mark the
row "Failed", even though the backend finished and persisted successfully
moments later. This task makes it async + pollable, same as advanced-upload.

Lives inside the INSURANCE image (insurance/celery_worker/claim_detail_upload_task.py).
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

from motor.motor_asyncio import AsyncIOMotorClient

from .celery_app import celery_app

from routes.case_documents_router import (
    _llamacloud_parse,
    _normalize_extracted_fields,
    _enrich_description,
    _unflatten,
    _build_claim_set_payload,
    append_markdown_block_atomic,
)
from routes.multiagent_extraction import run_multiagent_extraction

logger = logging.getLogger(__name__)
IST = timezone(timedelta(hours=5, minutes=30))
MONGO_URI = os.getenv("MONGO_URI")

DROPDOWN_ONLY = {"insurer", "claimMode", "claimSubtype", "tags", "claimTrigger"}
CREDITS_PER_PAGE = int(os.getenv("LLAMA_CREDITS_PER_PAGE", "3"))


async def _fix_null_parents_local(collection, case_id: str, flat_keys):
    parents = {k.split(".", 1)[0] for k in flat_keys if "." in k}
    if not parents:
        return
    existing = await collection.find_one({"caseId": case_id}, {"_id": 0}) or {}
    parents_to_fix = {p for p in parents if p in existing and existing[p] is None}
    if parents_to_fix:
        await collection.update_one(
            {"caseId": case_id},
            {"$set": {p: {} for p in parents_to_fix}},
        )




async def _process_claim_detail_upload(
    task_id: str,
    case_id: str,
    doc_id: str,
    display_label: str,
    file_name: str,
    file_b64: str,
    email_text: Optional[str],
    stored_url: Optional[str],
    storage_path: Optional[str],
) -> None:
    motor_client = AsyncIOMotorClient(MONGO_URI)
    db = motor_client["doctorassistai"]
    insurance_claims_col      = db["insurance_claims_new"]
    llama_stats_col           = db["llama_usage_stats"]
    advanced_upload_tasks_col = db["advanced_upload_tasks"]

    now = datetime.now(IST)

    try:
        # ── Acquire in-progress lock (same convention as advanced-upload) ──
        lock_result = await insurance_claims_col.update_one(
            {"caseId": case_id, "processing_files": {"$ne": file_name}},
            {"$addToSet": {"processing_files": file_name}},
        )
        if lock_result.modified_count == 0:
            await advanced_upload_tasks_col.update_one(
                {"task_id": task_id},
                {"$set": {
                    "status": "rejected",
                    "error": f"'{file_name}' is already being processed for this case.",
                    "updated_at": datetime.now(IST),
                }},
            )
            logger.warning("claim_detail_upload.process_document: lock already held for %s / %s", case_id, file_name)
            return

        # ── Parse ────────────────────────────────────────────────────────
        content = base64.b64decode(file_b64)
        document_text, page_count = await _llamacloud_parse(content, file_name)

        await llama_stats_col.update_one(
            {"_id": "global_total"},
            {"$inc": {"total_pages_parsed": page_count, "credits_used": page_count * CREDITS_PER_PAGE}},
            upsert=True,
        )

        document_text = (document_text or "").strip()
        if not document_text:
            raise ValueError(f"Parsing returned no text for '{file_name}'.")

        combined_text = f"""
EMAIL CONTENT:
{email_text or ""}

DOCUMENT CONTENT:
{document_text}
"""

        # ── Extraction ───────────────────────────────────────────────────
        # Previous-documents context intentionally dropped: prepending every
        # prior document's full markdown here meant the fixed _TEXT_LIMIT
        # (85k chars) budget per agent call got eaten by old documents as a
        # case grew, silently truncating — or fully cutting off — the
        # CURRENT document's own text, which is the one actually being
        # extracted. It also re-sent old document text through all 6 agent
        # calls on every new upload (O(n^2) tokens/latency across a case).
        # Per-document extraction only needs the current document; full
        # case history is already handled correctly (per-file/per-page) by
        # the findings map-reduce pass at submit time.
        extracted_flat: Dict[str, Any] = await run_multiagent_extraction(
            combined_text,
            display_label,
            email_text=email_text or "",
        )
        extracted_flat = _normalize_extracted_fields(extracted_flat)

        existing_claim_doc = await insurance_claims_col.find_one({"caseId": case_id}, {"description": 1})
        existing_description = (existing_claim_doc or {}).get("description") or ""
        extracted_flat["description"] = await _enrich_description(
            combined_text, extracted_flat, existing_description
        )

        extracted_nested = _unflatten(extracted_flat)
        fields_found = len([v for v in extracted_flat.values() if v is not None])

        flat_set_payload = await _build_claim_set_payload(case_id, extracted_flat, DROPDOWN_ONLY)
        # NOTE: raw_llama_markdown is intentionally NOT set inside
        # flat_set_payload anymore — see append_markdown_block_atomic's
        # docstring for why the old read-then-concat-then-write pattern
        # silently dropped concurrent uploads' text for the same case.
        await append_markdown_block_atomic(insurance_claims_col, case_id, doc_id, file_name, combined_text)
        # Findings generation is intentionally SKIPPED here. It used to run
        # after every single document, re-analyzing the ENTIRE case's
        # accumulated markdown each time — O(n^2) reprocessing across an
        # "Extract All" batch, and the actual cause of the 16s-480s per-doc
        # variance (not the individual document's page count). Findings now
        # run exactly once, after all Claim Detail Documents finish, via a
        # single explicit call to /web/regenerate-findings triggered by the
        # frontend — see CaseDocumentUpload.jsx.
        flat_set_payload["documentFindingsStatus"] = "pending"
        flat_set_payload["updatedAt"] = datetime.now(IST)

        await _fix_null_parents_local(insurance_claims_col, case_id, extracted_flat.keys())
        await insurance_claims_col.update_one(
            {"caseId": case_id},
            {
                "$set": flat_set_payload,
                "$addToSet": {"ingested_files": file_name},
                "$pull": {"processing_files": file_name},  # release lock on success
            },
        )

        upd = await insurance_claims_col.update_one(
            {"caseId": case_id, "supportingDocuments.doc_id": doc_id},
            {"$set": {
                "supportingDocuments.$.fields_found": fields_found,
                "supportingDocuments.$.status":       "extracted",
                "supportingDocuments.$.pdf_url":      stored_url,
                "supportingDocuments.$.storage_path": storage_path,
            }},
        )
        if upd.matched_count == 0:
            await insurance_claims_col.update_one(
                {"caseId": case_id},
                {"$push": {"supportingDocuments": {
                    "doc_id": doc_id,
                    "file_name": file_name,
                    "display_label": display_label,
                    "pdf_url": stored_url,
                    "storage_path": storage_path,
                    "fields_found": fields_found,
                    "status": "extracted",
                    "doc_type": "claim_detail",
                    "uploaded_at": now.isoformat(),
                }}},
            )

        result = {
            "success":          True,
            "doc_id":           doc_id,
            "case_id":          case_id,
            "file_name":        file_name,
            "display_label":    display_label,
            "pdf_url":          stored_url,
            "storage_path":     storage_path,
            "extraction_mode":  "claim_detail",
            "extracted_fields": extracted_nested,
            "fields_found":     fields_found,
            "message":          f"Extracted {fields_found} fields from {display_label}.",
        }

        await advanced_upload_tasks_col.update_one(
            {"task_id": task_id},
            {"$set": {"status": "success", "result": result, "error": None, "updated_at": datetime.now(IST)}},
        )
        logger.info("claim_detail_upload.process_document succeeded for task %s", task_id)

    except Exception as exc:
        logger.error("claim_detail_upload.process_document failed for task %s: %s", task_id, exc)
        await insurance_claims_col.update_one(
            {"caseId": case_id},
            {"$pull": {"processing_files": file_name}},
        )
        await advanced_upload_tasks_col.update_one(
            {"task_id": task_id},
            {"$set": {"status": "failed", "error": str(exc), "updated_at": datetime.now(IST)}},
        )

    finally:
        motor_client.close()


@celery_app.task(
    name="claim_detail_upload.process_document",
    bind=True,
    max_retries=1,
    default_retry_delay=30,
)
def process_claim_detail_upload(
    self,
    task_id,
    case_id,
    doc_id,
    display_label,
    file_name,
    file_b64,
    email_text,
    stored_url,
    storage_path,
):
    asyncio.run(
        _process_claim_detail_upload(
            task_id=task_id,
            case_id=case_id,
            doc_id=doc_id,
            display_label=display_label,
            file_name=file_name,
            file_b64=file_b64,
            email_text=email_text,
            stored_url=stored_url,
            storage_path=storage_path,
        )
    )