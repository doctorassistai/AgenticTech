"""
phase1_task.py
==============
Celery task for Phase 1 Knowledge Creation Pipeline.

Follows the same pattern as agent_pdf_task.py:
  - Receives doc_id + doctor_id + file_url (NOT raw bytes through RabbitMQ)
  - Downloads the file from the URL inside the worker
  - Runs run_phase1_pipeline() asynchronously
  - Updates phase1_processing_jobs in MongoDB
"""

import asyncio
import base64
import os
from datetime import datetime

from bson import BSON

import httpx
from pymongo import MongoClient

from common.celery_worker.celery_app import celery_app

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB  = os.getenv("MONGO_DB", "doctorassistai")


def get_tracker():
    client = MongoClient(MONGO_URI)
    return client[MONGO_DB]["phase1_processing_jobs"]


# ── ADD THIS: Phase 3 workflow trigger ───────────────────────────────────

# async def _trigger_phase3_workflow(doctor_id: str, doc_id: str, pipeline_result: dict):
#     from Agentic.phase3_services import (
#         run_guideline_upload_workflow, get_client, get_db, ensure_indexes
#     )
#     from Agentic.phase3_models import GuidelineUploadWorkflowRequest

#     understanding     = pipeline_result.get("understanding", {})
#     preview           = pipeline_result.get("preview", {})
#     guideline_info    = preview.get("guideline", {})

#     guideline_name    = understanding.get("guideline_name") or guideline_info.get("name", "")
#     guideline_version = understanding.get("guideline_version") or guideline_info.get("version", "unknown")
#     disease_type      = understanding.get("disease_type", "")
#     specialty         = understanding.get("specialty", "")

#     # Auto-extract org from guideline name
#     organization = ""
#     for org in ["NCCN", "ACOG", "ASCO", "ESMO", "WHO", "AHA", "ACC", "NICE", "ESC"]:
#         if org.lower() in guideline_name.lower():
#             organization = org
#             break

#     request = GuidelineUploadWorkflowRequest(
#         doc_id            = doc_id,
#         version           = str(guideline_version),
#         title             = guideline_name or "Unknown Guideline",
#         organization      = organization,
#         disease_type      = disease_type,
#         specialty         = specialty,
#         llm_model         = "llama-3.3-70b-versatile",
#         prompt_version    = pipeline_result.get("pipeline_version", "v9fixes"),
#         embedding_model   = "pritamdeka/S-PubMedBert-MS-MARCO",
#         chunking_strategy = "heading_toc_fixed",
#         auto_compare      = True,
#         auto_impact       = True,
#         auto_recommend    = True,
#         auto_draft        = False,  # doctor reviews before drafts are created
#     )

#     client = get_client()
#     db     = get_db(client)
#     await ensure_indexes(db)

#     try:
#         workflow_result = await run_guideline_upload_workflow(db, doctor_id, request)
#         return workflow_result
#     finally:
#         client.close()


@celery_app.task(
    name="agentic.phase1_pipeline",
    bind=True,
    max_retries=0,
    soft_time_limit=7200,    # 2-hour soft limit — only for THIS task
    time_limit=7500,         # 2-hour hard kill — only for THIS taskkkkkkkkkk
)
def run_phase1_task(
    self,
    doctor_id: str,
    doc_id: str,
    filename: str,
    file_url: str,
):
    client = MongoClient(MONGO_URI)
    db = client[MONGO_DB]

    tracker = db["phase1_processing_jobs"]
    preview_skill_coll = db["phase1_preview_skills"]

    try:
        # ── Mark as processing ──
        tracker.update_one(
            {"doc_id": doc_id},
            {
                "$set": {
                    "status":     "processing",
                    "task_id":    self.request.id,
                    "started_at": datetime.utcnow(),
                }
            },
            upsert=True,
        )

        # ── Download file from URL 
        response = httpx.get(file_url, timeout=120.0)
        response.raise_for_status()
        file_bytes = response.content

        # ── Run pipeline (async inside sync Celery task) 
        from Agentic.phase1_knowledge_pipeline import run_phase1_pipeline

        result = asyncio.run(
            run_phase1_pipeline(
                file_bytes=file_bytes,
                filename=filename,
                doctor_id=doctor_id,
                doc_id=doc_id,
                save_to_db=False,   # keep False — approval flow unchanged
            )
        )

        result.pop("fact_store", None)   # <-- ADD THIS LINEeeeeeee

        # ── Move skills into their own collection (one doc per skill) ──
        skills = result.pop("skills", [])

        if skills:
            docs = [
                {
                    **skill,
                    "doc_id": doc_id,
                    "doctor_id": doctor_id
                }
                for skill in skills
            ]

            preview_skill_coll.delete_many(
                {"doc_id": doc_id, "doctor_id": doctor_id}
            )

            preview_skill_coll.insert_many(docs)

        result["skill_count"] = len(skills)

        

        # ── Log pipeline_result size before writing to MongoDB ──
        try:
            size_bytes = len(BSON.encode({"pipeline_result": result}))
            size_mb = size_bytes / (1024 * 1024)
            print(
                f"[Phase1] AFTER_SKILL_REMOVAL "
                f"doc_id={doc_id} size_mb={size_mb:.2f}"
            )
            if size_mb > 16:
                print(f"[Phase1] WARNING doc_id={doc_id} exceeds MongoDB 16MB doc limit ({size_mb:.2f} MB)")
        except Exception as size_err:
            print(f"[Phase1] SIZE_CHECK_ERROR doc_id={doc_id} error={size_err}")

        # ── Store full result, mark pending_review 
        tracker.update_one(
            {"doc_id": doc_id},
            {
                "$set": {
                    "status":          "pending_review",
                    "completed_at":    datetime.utcnow(),
                    "pipeline_result": result,
                    "filename":        filename,
                    "schema_version":  "v2",
                }
            },
        )

        # ── ADD THIS: Trigger Phase 3 governance workflow automatically ──---
        # try:
        #     workflow_result = asyncio.run(
        #         _trigger_phase3_workflow(doctor_id, doc_id, result)
        #     )
        #     tracker.update_one(
        #         {"doc_id": doc_id},
        #         {
        #             "$set": {
        #                 "phase3_workflow_id":   workflow_result.workflow_id,
        #                 "phase3_guideline_id":  workflow_result.guideline_id,
        #                 "phase3_comparison_id": workflow_result.comparison_id,
        #                 "phase3_status":        workflow_result.status.value,
        #                 "phase3_recommendations_generated": workflow_result.recommendations_generated,
        #             }
        #         },
        #     )
        # except Exception as phase3_err:
        #     # Phase 3 failure must NOT fail the Phase 1 job
        #     tracker.update_one(
        #         {"doc_id": doc_id},
        #         {"$set": {"phase3_error": str(phase3_err)}}
        #     )
        # ──────────────────────────────────────────────────

        return {"doc_id": doc_id, "status": "pending_review"}

    except Exception as e:
        tracker.update_one(
            {"doc_id": doc_id},
            {
                "$set": {
                    "status":    "failed",
                    "error":     str(e),
                    "failed_at": datetime.utcnow(),
                }
            },
        )
        raise