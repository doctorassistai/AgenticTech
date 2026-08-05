
from datetime import datetime
import os

import httpx

from pymongo import MongoClient

from common.celery_worker.celery_app import celery_app

# ============================================================
# CONFI
# =========================================================

MONGO_URI = os.getenv("MONGO_URI")

MONGO_DB = os.getenv(
    "MONGO_DB",
    "doctorassistai"
)

# =======================================================
# IMPORTANT
# Use Docker internal networking
# NOT public domain
# ============================================================

AGENTIC_URL = os.getenv(
    "AGENTIC_URL",
    "http://64.227.186.186:8041"
)

# ============================================================
# MONGO HELPER
# Avoid fork warning
# ============================================================

def get_pipeline_tracker():

    mongo_client = MongoClient(MONGO_URI)

    mongo_db = mongo_client[MONGO_DB]

    return mongo_db["agent_pdf_tracker"]

# ============================================================
# HTTP TIMEOUT
# ==========================================================

HTTP_TIMEOUT = httpx.Timeout(

    connect=30.0,

    read=3600.0,

    write=60.0,

    pool=60.0,
)

# ============================================================
# PDF FILE PIPELINE TASK
# ============================================================

@celery_app.task(

    name="agentic.run_pipeline",

    bind=True,

    autoretry_for=(Exception,),

    retry_backoff=5,

    retry_kwargs={"max_retries": 3},
)
def run_pipeline_task(

    self,

    doctor_id: str,

    file_url: str,

    filename: str,

    guideline_source: str = "other",

    version: str = "",
):

    pipeline_tracker = get_pipeline_tracker()

    try:

        # ====================================================
        # TRACK START
        # ====================================================

        pipeline_tracker.insert_one({

            "task_id": self.request.id,

            "doctor_id": doctor_id,

            "filename": filename,

            "file_url": file_url,

            "status": "processing",

            "started_at": datetime.utcnow(),
        })

        # ====================================================
        # CALL INTERNAL PIPELINE ENDPOINT
        # ====================================================

        response = httpx.post(

            f"{AGENTIC_URL}/pipeline/internal/pipeline/run",

            params={
                "doctor_id": doctor_id
            },

            json={

                "file_url": file_url,

                "filename": filename,

                "guideline_source":
                    guideline_source,

                "version": version,
            },

            timeout=HTTP_TIMEOUT,
        )

        response.raise_for_status()

        result = response.json()

        # ====================================================
        # MARK COMPLETED
        # ====================================================

        pipeline_tracker.update_one(

            {
                "task_id": self.request.id
            },

            {
                "$set": {

                    "status": "completed",

                    "completed_at":
                        datetime.utcnow(),

                    "result": result,
                }
            }
        )

        return {

            "status": "completed",

            "task_id": self.request.id,

            "result": result,
        }

    except Exception as e:

        # ====================================================
        # MARK FAILED
        # ====================================================

        pipeline_tracker.update_one(

            {
                "task_id": self.request.id
            },

            {
                "$set": {

                    "status": "failed",

                    "failed_at":
                        datetime.utcnow(),

                    "error": str(e),
                }
            }
        )

        raise e

# ============================================================
# URL PIPELINE TASK
# ============================================================

@celery_app.task(
    name="agentic.run_pipeline_urls",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=5,
    retry_kwargs={"max_retries": 3},
)
def run_pipeline_urls_task(
    self,
    doctor_id: str,
    urls: list,
    guideline_source: str = "other",
    version: str = "",
):

    pipeline_tracker = get_pipeline_tracker()

    try:

        # ====================================================
        # VALIDATION
        # ====================================================

        if not isinstance(urls, list):
            raise ValueError(
                f"urls must be a list, got {type(urls)}"
            )

        if not urls:
            raise ValueError(
                "urls list is empty"
            )

        # remove empty values
        urls = [
            str(u).strip()
            for u in urls
            if str(u).strip()
        ]

        if not urls:
            raise ValueError(
                "No valid URLs provided"
            )

        # ====================================================
        # DEBUG LOGGING
        # ====================================================

        print("========== URL PIPELINE ==========")
        print("doctor_id =", doctor_id)
        print("urls =", urls)
        print("guideline_source =", guideline_source)
        print("version =", version)
        print("==================================")

        # ====================================================
        # TRACK START
        # ====================================================

        pipeline_tracker.insert_one({
            "task_id": self.request.id,
            "doctor_id": doctor_id,
            "urls": urls,
            "status": "processing",
            "started_at": datetime.utcnow(),
        })

        # ====================================================
        # REQUEST PAYLOAD
        # ====================================================

        payload = {
            "urls": urls,
            "guideline_source": guideline_source,
            "version": version or None,
        }

        print("REQUEST PAYLOAD =", payload)

        # ====================================================
        # CALL INTERNAL URL PIPELINE
        # ====================================================

        response = httpx.post(
            f"{AGENTIC_URL}/pipeline/internal/run-urls",
            params={
                "doctor_id": doctor_id
            },
            json=payload,
            timeout=HTTP_TIMEOUT,
        )

        # ====================================================
        # DEBUG RESPONSE
        # ====================================================

        print("STATUS CODE =", response.status_code)
        print("RESPONSE TEXT =", response.text)

        response.raise_for_status()

        result = response.json()

        # ====================================================
        # MARK COMPLETED
        # ====================================================

        pipeline_tracker.update_one(
            {
                "task_id": self.request.id
            },
            {
                "$set": {
                    "status": "completed",
                    "completed_at": datetime.utcnow(),
                    "result": result,
                }
            }
        )

        return {
            "status": "completed",
            "task_id": self.request.id,
            "result": result,
        }

    except Exception as e:

        print("PIPELINE ERROR =", str(e))

        # ===============================================
        # MARK FAILED
        # =============================================

        pipeline_tracker.update_one(
            {
                "task_id": self.request.id
            },
            {
                "$set": {
                    "status": "failed",
                    "failed_at": datetime.utcnow(),
                    "error": str(e),
                }
            }
        )

        raise e