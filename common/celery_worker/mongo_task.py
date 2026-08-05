import httpx
import os
from dotenv import load_dotenv
from .celery_app import celery_app

load_dotenv()

AGENTIC_URL = os.getenv("VITE_BACKEND_URL")



@celery_app.task(name="legacy_lab_ai.process_mongo_batch")
def process_mongo_batch(temp_document_id):

    try:
        response = httpx.post(
            f"http://64.227.186.186:8041/documents/process-mongo",
            json={
                "temp_document_id": temp_document_id
            },
            timeout=180
        )

        response.raise_for_status()

    except Exception as e:
        raise Exception(f"Mongo batch trigger failed: {str(e)}")