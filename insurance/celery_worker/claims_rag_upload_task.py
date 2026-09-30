"""
Celery task for the /web/claims-rag/upload pipeline.

Runs the parse -> group -> embed -> Mongo upsert pipeline for one
uploaded Excel batch file OUTSIDE the request/response cycle, on the
same advanced_upload_queue used by advanced_upload_task.py (same
Celery app, same celery-advanced-upload worker container — no new
service needed).

Sync task (required by Celery), drives an async pipeline internally
via asyncio.run() — same shape as advanced_upload_task.py. A fresh
AsyncIOMotorClient is created INSIDE the async function and closed at
the end — do not reuse a Motor client across separate asyncio.run()
calls / task invocations.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import UpdateOne

from .celery_app import celery_app

from routes.insurance_claims_rag import (
    parse_excel_claims,
    group_claims,
    embed_texts,
    build_line_docs,
    store_line_docs,
)

logger = logging.getLogger(__name__)
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB", "doctorassistai")


async def _process_claims_rag_upload(
    task_id: str,
    hospital_id: str,
    file_name: str,
    file_b64: str,
) -> None:
    motor_client = AsyncIOMotorClient(MONGO_URI)
    db = motor_client[MONGO_DB]
    claims_collection = db["insurance_claim_embeddings"]
    claim_lines_collection = db["insurance_claim_lines"]
    tasks_collection = db["claims_rag_upload_tasks"]

    try:
        await tasks_collection.update_one(
            {"task_id": task_id},
            {"$set": {"status": "processing", "updated_at": datetime.now(timezone.utc)}},
        )

        file_bytes = base64.b64decode(file_b64)
        df = parse_excel_claims(file_bytes, file_name)
        groups = group_claims(df)

        if not groups:
            raise ValueError("No claim rows found in file")

        line_docs = build_line_docs(df, hospital_id, file_name)
        lines_written = await store_line_docs(line_docs, collection=claim_lines_collection)

        embeddings = await embed_texts([g["text"] for g in groups])

        now = datetime.now(timezone.utc)
        bulk_ops = [
            UpdateOne(
                {"hospital_id": hospital_id, "claim_number": g["claim_number"]},
                {"$set": {
                    **g,
                    "hospital_id": hospital_id,
                    "embedding": emb,
                    "source_file": file_name,
                    "uploaded_at": now,
                }},
                upsert=True,
            )
            for g, emb in zip(groups, embeddings)
        ]
        result = await claims_collection.bulk_write(bulk_ops)

        await tasks_collection.update_one(
            {"task_id": task_id},
            {"$set": {
                "status": "success",
                "result": {
                    "success": True,
                    "hospital_id": hospital_id,
                    "file": file_name,
                    "claims_ingested": len(groups),
                    "upserted": result.upserted_count,
                    "modified": result.modified_count,
                    "lines_ingested": lines_written,
                },
                "error": None,
                "updated_at": datetime.now(timezone.utc),
            }},
        )
        logger.info("claims_rag_upload.process_file succeeded for task %s (%s)", task_id, file_name)

    except Exception as exc:
        logger.error("claims_rag_upload.process_file failed for task %s (%s): %s", task_id, file_name, exc)
        await tasks_collection.update_one(
            {"task_id": task_id},
            {"$set": {
                "status": "failed",
                "error": str(exc),
                "updated_at": datetime.now(timezone.utc),
            }},
        )

    finally:
        motor_client.close()


@celery_app.task(
    name="claims_rag_upload.process_file",
    bind=True,
    max_retries=1,
    default_retry_delay=30,
)
def process_claims_rag_upload(self, task_id, hospital_id, file_name, file_b64):
    asyncio.run(
        _process_claims_rag_upload(
            task_id=task_id,
            hospital_id=hospital_id,
            file_name=file_name,
            file_b64=file_b64,
        )
    )