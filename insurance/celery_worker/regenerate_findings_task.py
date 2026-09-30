"""
Celery task for re-running the document-findings map-reduce pass
(PED / billing / coverage / identity / timeline / etc.) over a case's
existing raw_llama_markdown, WITHOUT re-uploading or re-parsing anything.

This used to run synchronously inside
/web/regenerate-findings/{case_id}, which could exceed Cloudflare's
524 origin timeout on large cases — the backend would keep running and
persist the result, but the client would never see the response. This
task reuses the exact same advanced_upload_tasks_col + task_id polling
pattern as advanced_upload_task.py so the frontend can poll for
completion instead of blocking on one long request.

FIELD-OFFICER BRANCH POINT (added): if the case's raw_llama_markdown
carries field-officer [INV_TYPE/step_key] tags, this now calls the new
tag-aware findings generator
(routes.agents.field_officer_findings_agent.generate_field_officer_findings)
instead of the existing untagged one
(routes.case_documents_router._generate_document_findings). Both return
the identical {findings, status, error} shape, so everything below the
call — storage into documentFindings/documentFindingsStatus/
documentFindingsError, task-row bookkeeping, error handling — is
UNCHANGED and shared by both branches. case_documents.py's own
_generate_document_findings, and every claim that doesn't carry
field-officer tags, are completely untouched by this change.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone, timedelta

from motor.motor_asyncio import AsyncIOMotorClient

from .celery_app import celery_app
from routes.case_documents_router import _generate_document_findings
from routes.agents.investigation_checklist import has_field_officer_tags
from routes.agents.field_officer_findings_agent import generate_field_officer_findings

logger = logging.getLogger(__name__)
IST = timezone(timedelta(hours=5, minutes=30))
MONGO_URI = os.getenv("MONGO_URI")

# Everything generate_field_officer_findings' _extract_claim_context() reads
# off the claim dict, on top of raw_llama_markdown itself — same field set
# case_documents.py's own _reduce_observations_to_findings queries
# separately today; fetched once here instead so both branches share one
# claim read.
_CLAIM_PROJECTION = {
    "_id": 0,
    "raw_llama_markdown": 1,
    "claimedAmount": 1,
    "sumInsured": 1,
    "policyDetails": 1,
    "hospitalDetails.admissionDate": 1,
    "hospitalDetails.dischargeDate": 1,
    "claimantName": 1,
    "claimantAge": 1,
    "insurer": 1,
    "riskDetails": 1,
    "claimTriggers": 1,
    "description": 1,
    "deathDetails": 1,
    "billingDetails.finalBillAmount": 1,
    "billingDetails.grossAmount": 1,
    "additionalMedicalDetails.chiefComplaints": 1,
}


async def _process_regenerate_findings(task_id: str, case_id: str) -> None:
    motor_client = AsyncIOMotorClient(MONGO_URI)
    db = motor_client["doctorassistai"]
    insurance_claims_col      = db["insurance_claims_new"]
    advanced_upload_tasks_col = db["advanced_upload_tasks"]

    try:
        claim = await insurance_claims_col.find_one(
            {"caseId": case_id}, _CLAIM_PROJECTION
        )
        if not claim:
            raise ValueError(f"Case {case_id} not found.")

        raw_markdown = claim.get("raw_llama_markdown") or ""
        if not raw_markdown.strip():
            raise ValueError("No parsed document text available for this case yet.")

        # ── Branch point (field-officer-aware pipeline) ──────────────────
        if has_field_officer_tags(raw_markdown):
            _findings_result = await generate_field_officer_findings(case_id, claim, raw_markdown)
        else:
            _findings_result = await _generate_document_findings(case_id, raw_markdown)

        now = datetime.now(IST)

        if _findings_result["status"] == "error":
            # Unlike the advanced-upload task, this task's ENTIRE job is
            # findings generation — there's no other successful work to
            # protect by swallowing the error. Raise so the outer except
            # marks the Celery task "failed"; the frontend's existing
            # poll loop (handleRegenerateFindings in PDFEditorPage.jsx)
            # already surfaces a failed task status as "retry failed"
            # (see RawDocument.jsx's regenError state) — so this requires
            # no frontend changes to stop silently reporting "0 findings"
            # as if the case had genuinely been checked and found clean.
            raise RuntimeError(
                f"Findings generation failed: {_findings_result['error']}"
            )

        findings = _findings_result["findings"]

        await insurance_claims_col.update_one(
            {"caseId": case_id},
            {"$set": {
                "documentFindings": findings,
                "documentFindingsStatus": "ok",
                "documentFindingsError": None,
                "findingsUpdatedAt": now,
                "updatedAt": now,
            }},
        )

        result = {
            "success": True,
            "case_id": case_id,
            "findings": findings,
            "count": len(findings),
            "generated_at": now.isoformat(),
        }
        await advanced_upload_tasks_col.update_one(
            {"task_id": task_id},
            {"$set": {"status": "success", "result": result, "error": None, "updated_at": now}},
        )
        logger.info("regenerate_findings.run succeeded for task %s (case %s, %d findings)", task_id, case_id, len(findings))

    except Exception as exc:
        logger.error("regenerate_findings.run failed for task %s (case %s): %s", task_id, case_id, exc)
        await advanced_upload_tasks_col.update_one(
            {"task_id": task_id},
            {"$set": {"status": "failed", "error": str(exc), "updated_at": datetime.now(IST)}},
        )

    finally:
        motor_client.close()


@celery_app.task(
    name="regenerate_findings.run",
    bind=True,
    max_retries=1,
    default_retry_delay=30,
)
def regenerate_findings_task(self, task_id, case_id):
    asyncio.run(_process_regenerate_findings(task_id=task_id, case_id=case_id))