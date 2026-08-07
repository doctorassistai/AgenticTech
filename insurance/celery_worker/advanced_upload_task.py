"""
Celery task for the /web/advanced-upload pipeline.

Lives inside the INSURANCE image (insurance/celery_worker/advanced_upload_task.py),
NOT in common/celery_worker/ — because it needs direct access to
routes.case_documents_router and routes.multiagent_extraction, which only
exist in the insurance codebase. A dedicated `celery-advanced-upload`
worker container (built from insurance/Dockerfile, see docker-compose
changes) runs this.

The task function itself is sync (required by Celery), and drives an async
pipeline internally via asyncio.run() — same shape as
common/celery_worker/mobile_parse_task.py.

Storage upload (getting pdf_url) happens SYNCHRONOUSLY in the FastAPI route
before this task is enqueued — this task only does:
  1. dedup check (already-ingested file) + in-progress lock
  2. LlamaCloud agentic parse
  3. multi-agent LLM extraction
  4. Mongo writes (case_documents + insurance_claims_new)

IMPORTANT: a fresh AsyncIOMotorClient is created INSIDE the async function
and closed at the end. Do NOT reuse a Motor client across separate
asyncio.run() calls / task invocations — each call gets its own event loop,
and Motor clients bind to the loop they first operate on, so reusing one
across loops raises "attached to a different loop" errors eventually.
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

# Pure / non-DB helpers — safe to import directly, they don't hold any
# reference to the router's global Mongo collections.
from routes.case_documents_router import (
    _llamacloud_parse,
    _normalize_extracted_fields,
    _enrich_description,
    _unflatten,
    _extract_unused_fields,
    _deep_merge,
)
from routes.multiagent_extraction import run_multiagent_extraction

logger = logging.getLogger(__name__)
IST = timezone(timedelta(hours=5, minutes=30))
MONGO_URI = os.getenv("MONGO_URI")

DROPDOWN_ONLY = {"insurer", "claimMode", "claimSubtype", "tags", "claimTrigger"}
CREDITS_PER_PAGE = int(os.getenv("LLAMA_CREDITS_PER_PAGE", "1"))

# ─────────────────────────────────────────────────────────────────────────
# DB-coupled helpers — re-implemented here (not imported) so they use THIS
# task run's own Motor client/collections rather than the router's global
# ones from a different event loop.
# ─────────────────────────────────────────────────────────────────────────
async def _fix_null_parents(collection, case_id: str, flat_keys):
    """
    Dot-notation $set fails with error 28 if the parent field is currently
    stored as an explicit null (e.g. "criticalDetails": null). Promote any
    such parents to {} first so the dotted $set can proceed.
    """
    existing = await collection.find_one({"caseId": case_id}, {"_id": 0}) or {}
    parents_to_fix = set()
    for k in flat_keys:
        if "." in k:
            parent = k.split(".", 1)[0]
            if parent in existing and existing[parent] is None:
                parents_to_fix.add(parent)
    if parents_to_fix:
        await collection.update_one(
            {"caseId": case_id},
            {"$set": {p: {} for p in parents_to_fix}},
        )

async def _get_accumulated_markdown_local(insurance_claims_col, case_id: str, new_text: str) -> str:
    claim = await insurance_claims_col.find_one({"caseId": case_id}, {"raw_llama_markdown": 1})
    existing = (claim or {}).get("raw_llama_markdown", "") or ""

    if not new_text.strip():
        return existing
    if new_text.strip() in existing:
        return existing
    if existing.strip():
        return existing + "\n\n" + new_text
    return new_text


async def _build_claim_set_payload_local(
    insurance_claims_col,
    case_id: str,
    extracted_flat: Dict[str, Any],
    dropdown_only: set,
) -> Dict[str, Any]:
    existing = await insurance_claims_col.find_one({"caseId": case_id}, {"_id": 0}) or {}
    payload: Dict[str, Any] = {}

    for flat_key, value in extracted_flat.items():
        if value is None or flat_key in dropdown_only:
            continue

        if flat_key == "description":
            existing_desc = existing.get("description") or ""
            new_desc = value or ""
            payload["description"] = new_desc if len(new_desc) > len(existing_desc) else existing_desc
            continue

        if flat_key == "suggestedTriggers":
            existing_triggers = set(existing.get("suggestedTriggers") or [])
            new_triggers = set(value or [])
            payload["suggestedTriggers"] = list(existing_triggers | new_triggers)
            continue

        if flat_key == "emailInstructions":
            existing_ei = (existing.get("emailInstructions") or "").strip()
            new_ei = (value or "").strip()
            if existing_ei and new_ei and new_ei not in existing_ei:
                payload["emailInstructions"] = f"{existing_ei} | {new_ei}"
            else:
                payload["emailInstructions"] = new_ei or existing_ei
            continue

        if flat_key == "riskDetails.triggers":
            existing_risk = existing.get("riskDetails") or {}
            existing_trig = (existing_risk.get("triggers") or "").strip()
            new_trig = (value or "").strip()
            if existing_trig and new_trig and new_trig not in existing_trig:
                payload["riskDetails.triggers"] = f"{existing_trig}; {new_trig}"
            else:
                payload["riskDetails.triggers"] = new_trig or existing_trig
            continue

        parts = flat_key.split(".", 1)
        if len(parts) == 1:
            current_val = existing.get(parts[0])
        else:
            current_val = (existing.get(parts[0]) or {}).get(parts[1])

        if current_val in (None, "", [], {}):
            payload[flat_key] = value
        # else: keep existing value, skip overwrite

    return payload


# ─────────────────────────────────────────────────────────────────────────
# Main async pipeline
# ─────────────────────────────────────────────────────────────────────────

async def _process_advanced_upload(
    task_id: str,
    case_id: str,
    doc_id: str,
    doc_number: int,
    display_label: str,
    file_name: str,
    file_content_type: str,
    file_b64: str,
    email_text: Optional[str],
    stored_url: Optional[str],
    storage_path: Optional[str],
    supervisor_id: str,
) -> None:
    motor_client = AsyncIOMotorClient(MONGO_URI)
    db = motor_client["doctorassistai"]
    case_documents_col        = db["case_documents"]
    insurance_claims_col      = db["insurance_claims_new"]
    llama_stats_col           = db["llama_usage_stats"]
    advanced_upload_tasks_col = db["advanced_upload_tasks"]

    now = datetime.now(IST)

    try:
        # ── 1. Dedup check (moved here from the route) ───────────────────
        claim = await insurance_claims_col.find_one({"caseId": case_id}, {"ingested_files": 1})
        ingested = set((claim or {}).get("ingested_files") or [])

        if file_name in ingested:
            case_doc = await case_documents_col.find_one({"case_id": case_id}, {"documents": 1})
            cached_entry = None
            if case_doc:
                for d in case_doc.get("documents", []):
                    if d.get("file_name") == file_name and d.get("extracted_flat"):
                        cached_entry = d
                        break

            if cached_entry:
                # No re-parse — just re-apply the already-extracted data,
                # in case a prior save partially failed.
                flat_set_payload = await _build_claim_set_payload_local(
                    insurance_claims_col, case_id, cached_entry["extracted_flat"], DROPDOWN_ONLY
                )
                flat_set_payload["updatedAt"] = datetime.now(IST)

                await insurance_claims_col.update_one(
                    {"caseId": case_id},
                    {
                        "$set": flat_set_payload,
                        "$addToSet": {"ingested_files": file_name},
                        "$pull": {"processing_files": file_name},
                    },
                )

                await insurance_claims_col.update_one(
                    {"caseId": case_id, "supportingDocuments.doc_id": {"$ne": cached_entry["doc_id"]}},
                    {
                        "$push": {
                            "supportingDocuments": {
                                "doc_id":        cached_entry["doc_id"],
                                "file_name":     file_name,
                                "display_label": cached_entry.get("display_label", display_label),
                                "pdf_url":       cached_entry.get("pdf_url"),
                                "storage_path":  cached_entry.get("storage_path"),
                                "fields_found":  cached_entry.get("fields_found", 0),
                                "uploaded_at":   datetime.now(IST).isoformat(),
                            }
                        }
                    },
                )

                
                result = {
                    "success": True,
                    "already_processed": True,
                    "doc_id": cached_entry["doc_id"],
                    "display_label": cached_entry.get("display_label", display_label),
                    "pdf_url": cached_entry.get("pdf_url"),
                    "storage_path": cached_entry.get("storage_path"),
                    "extraction_mode": "advanced",
                    "extracted_fields": cached_entry.get("extracted_data", {}),
                    "fields_found": cached_entry.get("fields_found", 0),
                    "message": "File already processed. Re-synced saved data to the claim.",
                }
                await advanced_upload_tasks_col.update_one(
                    {"task_id": task_id},
                    {"$set": {
                        "status": "success", "result": result, "error": None,
                        "updated_at": datetime.now(IST),
                    }},
                )
                logger.info("advanced_upload.process_document: cached re-sync for %s / %s", case_id, file_name)
                return

            logger.warning(
                "Doc entry for '%s' has no extracted_flat (pre-fix upload). Re-processing.", file_name
            )

        # ── 2. Acquire in-progress lock ───────────────────────────────────
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
            logger.warning("advanced_upload.process_document: lock already held for %s / %s", case_id, file_name)
            return

        # ── 3. LlamaCloud agentic parse ────────────────────────────────────
        content = base64.b64decode(file_b64)
        raw_markdown, page_count = await _llamacloud_parse(content, file_name)

        await llama_stats_col.update_one(
            {"_id": "global_total"},
            {"$inc": {"total_pages_parsed": page_count, "credits_used": page_count * CREDITS_PER_PAGE}},
            upsert=True,
        )

        if not raw_markdown.strip():
            raise ValueError(f"LlamaCloud returned no text for '{file_name}'.")

        logger.info("LlamaCloud advanced parse: %d chars of markdown for %s", len(raw_markdown), display_label)

        # ── 4. LLM extraction ────────────────────────────────────────────────
        combined_text = f"""
        EMAIL CONTENT:
        {email_text or ""}

        DOCUMENT CONTENT:
        {raw_markdown}
        """

        # combined_text (not the case-history-aware full_context) is what
        # gets passed to extraction here, matching current behavior.
        extracted_flat: Dict[str, Any] = await run_multiagent_extraction(
            combined_text,
            display_label,
            email_text=email_text or "",
        )
        extracted_flat = _normalize_extracted_fields(extracted_flat)

        existing_claim_doc = await insurance_claims_col.find_one({"caseId": case_id}, {"description": 1})
        existing_description = (existing_claim_doc or {}).get("description") or ""
        extracted_flat["description"] = _enrich_description(combined_text, extracted_flat, existing_description)

        extracted_nested = _unflatten(extracted_flat)
        fields_found = len([v for v in extracted_flat.values() if v is not None])
        _extract_unused_fields(extracted_flat)  # parity with original call; not persisted separately

        # ── 5. Build document entry ───────────────────────────────────────
        new_doc_entry = {
            "doc_id": doc_id,
            "file_name": file_name,
            "file_type": file_content_type,
            "display_label": display_label,
            "pdf_url": stored_url,
            "storage_path": storage_path,
            "extraction_mode": "advanced",
            "extracted_data": extracted_nested,
            "extracted_flat": extracted_flat,
            "fields_found": fields_found,
            "voice_notes": [],
            "uploaded_at": now.isoformat(),
        }

        # ── 6. Merge into case record (advanced wins) ─────────────────────
        current = await case_documents_col.find_one({"case_id": case_id}, {"merged_extracted_data": 1})
        current_merged = (current or {}).get("merged_extracted_data", {})
        new_merged = _deep_merge(current_merged, extracted_nested)

        await case_documents_col.update_one(
            {"case_id": case_id},
            {
                "$push": {"documents": new_doc_entry},
                "$set": {"merged_extracted_data": new_merged, "updated_at": datetime.now(IST)},
                "$inc": {"total_fields_found": fields_found},
            },
        )

        flat_set_payload = await _build_claim_set_payload_local(
            insurance_claims_col, case_id, extracted_flat, DROPDOWN_ONLY
        )
        await _fix_null_parents(insurance_claims_col, case_id, extracted_flat.keys())
        flat_set_payload["raw_llama_markdown"] = await _get_accumulated_markdown_local(
            insurance_claims_col, case_id, combined_text
        )
        flat_set_payload["updatedAt"] = datetime.now(IST)

        await insurance_claims_col.update_one(
            {"caseId": case_id},
            {
                "$set": flat_set_payload,
                "$addToSet": {"ingested_files": file_name},
                "$pull": {"processing_files": file_name},  # release lock on success
            },
        )

        # Record this Supporting Document's pdf_url on the claim itself.
        upd = await insurance_claims_col.update_one(
            {"caseId": case_id, "supportingDocuments.doc_id": doc_id},
            {"$set": {
                "supportingDocuments.$.fields_found": fields_found,
                "supportingDocuments.$.status": "extracted",
                "supportingDocuments.$.pdf_url": stored_url,
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
                    "uploaded_at": now.isoformat(),
                }}},
            )

        result = {
            "success": True,
            "doc_id": doc_id,
            "case_id": case_id,
            "file_name": file_name,
            "display_label": display_label,
            "pdf_url": stored_url,
            "storage_path": storage_path,
            "extraction_mode": "advanced",
            "extracted_fields": extracted_nested,
            "fields_found": fields_found,
            "message": f"Advanced extraction: {fields_found} fields from {display_label} (LlamaCloud).",
        }

        await advanced_upload_tasks_col.update_one(
            {"task_id": task_id},
            {"$set": {"status": "success", "result": result, "error": None, "updated_at": datetime.now(IST)}},
        )
        logger.info("advanced_upload.process_document succeeded for task %s", task_id)

    except Exception as exc:
        logger.error("advanced_upload.process_document failed for task %s: %s", task_id, exc)
        # Release the lock on ANY failure so a genuine retry isn't blocked
        # forever by a stuck processing_files entry.
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
    name="advanced_upload.process_document",
    bind=True,
    max_retries=1,
    default_retry_delay=30,
)
def process_advanced_upload(
    self,
    task_id,
    case_id,
    doc_id,
    doc_number,
    display_label,
    file_name,
    file_content_type,
    file_b64,
    email_text,
    stored_url,
    storage_path,
    supervisor_id,
):
    asyncio.run(
        _process_advanced_upload(
            task_id=task_id,
            case_id=case_id,
            doc_id=doc_id,
            doc_number=doc_number,
            display_label=display_label,
            file_name=file_name,
            file_content_type=file_content_type,
            file_b64=file_b64,
            email_text=email_text,
            stored_url=stored_url,
            storage_path=storage_path,
            supervisor_id=supervisor_id,
        )
    )
    
@celery_app.task(name="llama_credits.reset")
def reset_llama_credits():
    async def _reset():
        client = AsyncIOMotorClient(MONGO_URI)
        try:
            db_ = client["doctorassistai"]
            await db_["llama_usage_stats"].update_one(
                {"_id": "global_total"},
                {"$set": {"credits_used": 0}},
                upsert=True,
            )
            logger.info("Monthly LlamaCloud credit counter reset to 0.")
        finally:
            client.close()
    asyncio.run(_reset())