"""
celery_worker/agentic_investigation_task.py
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient

from .agentic_celery_app import agentic_celery_app
from services.agentic_investigation import run_agentic_investigation

logger = logging.getLogger(__name__)
MONGO_URI = os.getenv("MONGO_URI")


async def _run(case_id: str, task_id: str) -> None:
    motor_client = AsyncIOMotorClient(MONGO_URI)
    try:
        db = motor_client["doctorassistai"]
        insurance_claims_col = db["insurance_claims_new"]
        tasks_col = db["advanced_upload_tasks"]

        result = await run_agentic_investigation(insurance_claims_col, case_id)

        await tasks_col.update_one(
            {"task_id": task_id},
            {"$set": {
                "status": "success",
                "result": result,
                "error": None,
                "updated_at": datetime.now(timezone.utc),
            }},
        )
    except Exception as e:
        logger.error("Agentic investigation task failed for case %s: %s", case_id, e)
        try:
            db = motor_client["doctorassistai"]
            await db["advanced_upload_tasks"].update_one(
                {"task_id": task_id},
                {"$set": {
                    "status": "failed",
                    "error": str(e),
                    "updated_at": datetime.now(timezone.utc),
                }},
            )
        except Exception:
            pass
        raise
    finally:
        motor_client.close()


@agentic_celery_app.task(
    name="agentic_investigation.run",
    bind=True,
    max_retries=1,
    default_retry_delay=30,
)
def run_agentic_investigation_task(self, case_id: str, task_id: str):
    asyncio.run(_run(case_id, task_id))