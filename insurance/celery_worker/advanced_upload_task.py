"""
Celery task for the /web/advanced-upload pipeline.

Lives inside the INSURANCE image (insurance/celery_worker/advanced_upload_task.py),
NOT in common/celery_worker/ — because it needs direct access to
routes.case_documents_router and routes.multiagent_extraction, which only
exist in the insurance codebase.

CHANGED: case_documents is no longer written or read anywhere in this file.
insurance_claims_new is now the single source of truth: the "already
extracted, don't re-parse" cache that used to live in
case_documents.documents[].extracted_flat now lives directly on the
matching entry in insurance_claims_new.supportingDocuments[].

The task function itself is sync (required by Celery), and drives an async
pipeline internally via asyncio.run() — same shape as before.

IMPORTANT: a fresh AsyncIOMotorClient is created INSIDE the async function
and closed at the end. Do NOT reuse a Motor client across separate
asyncio.run() calls / task invocations.
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
    append_markdown_block_atomic,
)
from routes.multiagent_extraction import run_multiagent_extraction

logger = logging.getLogger(__name__)
IST = timezone(timedelta(hours=5, minutes=30))
MONGO_URI = os.getenv("MONGO_URI")

DROPDOWN_ONLY = {"insurer", "claimMode", "claimSubtype", "tags", "claimTrigger"}
CREDITS_PER_PAGE = int(os.getenv("LLAMA_CREDITS_PER_PAGE", "1"))


def _coerce_text(value) -> str:
    """
    emailInstructions / riskDetails.triggers are expected to be plain
    strings, but the extractor occasionally returns a list instead (e.g.
    several instruction lines). Normalize here so the .strip() calls below
    never raise "'list' object has no attribute 'strip'".
    """
    if isinstance(value, list):
        return " ".join(str(v).strip() for v in value if v)
    return value or ""

async def _fix_null_parents(collection, case_id: str, flat_keys):
    """
    Atomically promotes any null parent field (for dotted keys in
    flat_keys) to {} using a pipeline update ($ifNull) instead of a
    separate read-then-write.
    Requires MongoDB 4.2+ (pipeline-style updates).
    """
    parents = {k.split(".", 1)[0] for k in flat_keys if "." in k}
    if not parents:
        return
    await collection.update_one(
        {"caseId": case_id},
        [{"$set": {p: {"$ifNull": [f"${p}", {}]}} for p in parents}],
    )

async def _atomic_set_with_null_parent_fix(collection, case_id: str, set_payload: Dict[str, Any]):
    """
    Sets every key in set_payload via a SINGLE aggregation-pipeline update
    that ALSO promotes any null dotted-parent (e.g. criticalDetails: null,
    accidentDetails: null) to {} in the very same atomic operation.

    Doing the null-parent fix and the real field write as two separate
    update_one calls — even back-to-back with await — leaves a window
    where a concurrent worker processing a DIFFERENT document for the
    SAME case can land in between and re-null the parent before this
    worker's real $set runs.

    IMPORTANT: MongoDB's pipeline $set does not allow specifying both a
    path and one of its own sub-paths in the same stage — e.g. having both
    "policyDetails" and "policyDetails.preExistingDisease" as keys raises
    error 40176 ("conflicting paths"), even though they're semantically
    compatible. So for any parent that has dotted children in this
    payload, we do NOT emit a separate bare "parent: {$ifNull...}" key.
    Instead we group all of that parent's dotted children together and
    write the WHOLE parent as one $mergeObjects key: merge the (null-safe)
    existing parent object with an object built from just the children.
    This gives one key per parent, no path collisions, and still fixes a
    null parent in the same atomic write as the real update.
    Requires MongoDB 4.2+ (pipeline-style updates).
    """
    if not set_payload:
        return

    top_level: Dict[str, Any] = {}
    grouped_children: Dict[str, Dict[str, Any]] = {}

    for key, value in set_payload.items():
        if "." in key:
            parent, child = key.split(".", 1)
            grouped_children.setdefault(parent, {})[child] = value
        else:
            top_level[key] = value

    stage: Dict[str, Any] = dict(top_level)
    for parent, children in grouped_children.items():
        stage[parent] = {
            "$mergeObjects": [
                {"$ifNull": [f"${parent}", {}]},
                children,
            ]
        }

    await collection.update_one({"caseId": case_id}, [{"$set": stage}])




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
            existing_ei = _coerce_text(existing.get("emailInstructions")).strip()
            new_ei = _coerce_text(value).strip()
            if existing_ei and new_ei and new_ei not in existing_ei:
                payload["emailInstructions"] = f"{existing_ei} | {new_ei}"
            else:
                payload["emailInstructions"] = new_ei or existing_ei
            continue

        if flat_key == "riskDetails.triggers":
            existing_risk = existing.get("riskDetails") or {}
            existing_trig = _coerce_text(existing_risk.get("triggers")).strip()
            new_trig = _coerce_text(value).strip()
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

    return payload


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
    insurance_claims_col      = db["insurance_claims_new"]
    llama_stats_col           = db["llama_usage_stats"]
    advanced_upload_tasks_col = db["advanced_upload_tasks"]

    now = datetime.now(IST)

    try:
        # ── 1. Dedup check — cache now lives on supportingDocuments[] ────
        claim = await insurance_claims_col.find_one(
            {"caseId": case_id},
            {"ingested_files": 1, "supportingDocuments": 1},
        )
        ingested = set((claim or {}).get("ingested_files") or [])

        if file_name in ingested:
            cached_entry = next(
                (
                    d for d in (claim or {}).get("supportingDocuments", [])
                    if d.get("file_name") == file_name and d.get("extracted_flat")
                ),
                None,
            )

            if cached_entry:
                # No re-parse — just re-apply the already-extracted data,
                # in case a prior save partially failed.
                flat_set_payload = await _build_claim_set_payload_local(
                    insurance_claims_col, case_id, cached_entry["extracted_flat"], DROPDOWN_ONLY
                )
                flat_set_payload["updatedAt"] = datetime.now(IST)

                await _atomic_set_with_null_parent_fix(insurance_claims_col, case_id, flat_set_payload)

                # Re-append this file's markdown block in case an earlier
                # concurrent-write race (see append_markdown_block_atomic's
                # docstring) dropped it from raw_llama_markdown even though
                # extraction itself succeeded and was cached — this is what
                # lets a previously-broken case self-heal on next upload.
                if cached_entry.get("raw_markdown_block"):
                    await append_markdown_block_atomic(
                        insurance_claims_col, case_id, cached_entry["doc_id"], file_name, cached_entry["raw_markdown_block"]
                    )

                await insurance_claims_col.update_one(
                    {"caseId": case_id},
                    {
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
                                "extracted_flat": cached_entry.get("extracted_flat", {}),
                                "extracted_data": cached_entry.get("extracted_data", {}),
                                "raw_markdown_block": cached_entry.get("raw_markdown_block"),
                                "status":        "extracted",
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

        extracted_flat: Dict[str, Any] = await run_multiagent_extraction(
            combined_text,
            display_label,
            email_text=email_text or "",
        )
        # Same fix as the router's upload_document — strip the raw pass-1
        # dump before it gets persisted (and before it's cached onto
        # supportingDocuments.extracted_flat for dedup re-sync).
        extracted_flat = _normalize_extracted_fields(extracted_flat)

        existing_claim_doc = await insurance_claims_col.find_one({"caseId": case_id}, {"description": 1})
        existing_description = (existing_claim_doc or {}).get("description") or ""
        extracted_flat["description"] = await _enrich_description(combined_text, extracted_flat, existing_description)

        extracted_nested = _unflatten(extracted_flat)
        fields_found = len([v for v in extracted_flat.values() if v is not None])

        # ── 5. Persist claim fields + supportingDocuments entry ───────────
        flat_set_payload = await _build_claim_set_payload_local(
            insurance_claims_col, case_id, extracted_flat, DROPDOWN_ONLY
        )
        # NOTE: raw_llama_markdown is intentionally NOT set inside
        # flat_set_payload anymore. It is appended atomically via
        # append_markdown_block_atomic below, in its own dedicated Mongo
        # pipeline update — see that function's docstring for why bundling
        # it into this $set caused concurrent uploads for the same case to
        # silently drop each other's parsed text (the MV.pdf/HV.pdf loss bug).
        await append_markdown_block_atomic(insurance_claims_col, case_id, doc_id, file_name, combined_text)
        # Findings generation intentionally SKIPPED here — same reasoning as
        # claim_detail_upload_task.py. It used to run after every supporting
        # document, re-analyzing the entire case's accumulated markdown each
        # time. It now runs exactly once, when the case is submitted, via an
        # explicit call to /web/regenerate-findings from NewCase.jsx.
        flat_set_payload["documentFindingsStatus"] = "pending"
        flat_set_payload["updatedAt"] = datetime.now(IST)

        # Set every field AND promote any null dotted-parent in ONE atomic
        # pipeline update — see _atomic_set_with_null_parent_fix for why
        # this must be a single operation, not "fix, then set".
        await _atomic_set_with_null_parent_fix(insurance_claims_col, case_id, flat_set_payload)

        await insurance_claims_col.update_one(
            {"caseId": case_id},
            {
                "$addToSet": {"ingested_files": file_name},
                "$pull": {"processing_files": file_name},  # release lock on success
            },
        )
        # Agentic investigation is no longer auto-enqueued per supporting
        # document. It now runs exactly once, when the case is submitted,
        # via an explicit call to /web/run-agentic-investigation from
        # NewCase.jsx (mirrors the regenerate-findings-at-submit change).

        # extracted_flat/extracted_data now live directly on the
        # supportingDocuments entry — this is what future dedup checks
        # (step 1 above) read from, replacing the old case_documents cache.
        upd = await insurance_claims_col.update_one(
            {"caseId": case_id, "supportingDocuments.doc_id": doc_id},
            {"$set": {
                "supportingDocuments.$.fields_found":    fields_found,
                "supportingDocuments.$.status":          "extracted",
                "supportingDocuments.$.pdf_url":         stored_url,
                "supportingDocuments.$.storage_path":    storage_path,
                "supportingDocuments.$.extracted_flat":  extracted_flat,
                "supportingDocuments.$.extracted_data":  extracted_nested,
                "supportingDocuments.$.raw_markdown_block": combined_text,
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
                    "extracted_flat": extracted_flat,
                    "extracted_data": extracted_nested,
                    "raw_markdown_block": combined_text,
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