"""
Celery task for generating an investigation conclusion for a case.

This used to run synchronously inside /web/generate-conclusion/{case_id},
which could exceed Cloudflare's 524 origin timeout on large cases — the
Pass 1 Groq extraction plus the multi-trigger unified conclusion LLM
calls plus validation/repair easily run past a minute, and the backend
would keep working and persist the result while the client got a 524
with no way to see it. This task reuses the exact same
advanced_upload_tasks_col + task_id polling pattern as
regenerate_findings_task.py so the frontend can poll for completion
instead of blocking on one long request.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from motor.motor_asyncio import AsyncIOMotorClient

from .celery_app import celery_app
from routes.conclusion import _process_generate_conclusion

logger = logging.getLogger(__name__)
IST = timezone(timedelta(hours=5, minutes=30))
MONGO_URI = os.getenv("MONGO_URI")

async def _process(
    task_id: str,
    case_id: str,
    triggers: List[str],
    additional_context: str,
    selected_findings: Optional[List[Dict[str, Any]]],
) -> None:
    motor_client = AsyncIOMotorClient(MONGO_URI)
    db = motor_client["doctorassistai"]
    advanced_upload_tasks_col = db["advanced_upload_tasks"]
    # Loop-scoped collections, bound to THIS task's own asyncio.run() loop —
    # never the routes/conclusion.py module-level client, which is created
    # once at import time and gets bound to whichever loop first uses it,
    # then breaks every later task once that loop is closed. Both
    # collections _process_generate_conclusion writes to must be passed in
    # explicitly, or it silently falls back to the stale module-level
    # global for whichever one is omitted.
    insurance_claims_col = db["insurance_claims_new"]
    template_extractions_col = db["template_field_extractions"]

    try:
        result = await _process_generate_conclusion(
            case_id=case_id,
            triggers=triggers,
            additional_context=additional_context,
            selected_findings=selected_findings,
            insurance_claims_col=insurance_claims_col,
            template_extractions_col=template_extractions_col,
        )
        now = datetime.now(IST)
        await advanced_upload_tasks_col.update_one(
            {"task_id": task_id},
            {"$set": {"status": "success", "result": result, "error": None, "updated_at": now}},
        )
        logger.info(
            "generate_conclusion.run succeeded for task %s (case %s, %d chars)",
            task_id, case_id, result.get("chars", 0),
        )

    except Exception as exc:
        logger.error("generate_conclusion.run failed for task %s (case %s): %s", task_id, case_id, exc)
        await advanced_upload_tasks_col.update_one(
            {"task_id": task_id},
            {"$set": {"status": "failed", "error": str(exc), "updated_at": datetime.now(IST)}},
        )

    finally:
        motor_client.close()


@celery_app.task(
    name="generate_conclusion.run",
    bind=True,
    max_retries=1,
    default_retry_delay=30,
)
def generate_conclusion_task(self, task_id, case_id, triggers, additional_context="", selected_findings=None):
    asyncio.run(
        _process(
            task_id=task_id,
            case_id=case_id,
            triggers=triggers,
            additional_context=additional_context,
            selected_findings=selected_findings,
        )
    )