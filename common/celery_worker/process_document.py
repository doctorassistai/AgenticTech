import httpx
from .celery_app import celery_app
from dotenv import load_dotenv
import os

load_dotenv()
AGENTIC_URL = os.getenv("VITE_BACKEND_URL")

@celery_app.task(name="legacy_lab_ai.process_document")
def process_document(patient_id, doctor_id, file_url, file_name,appointment_id):

    httpx.post(
        "http://143.198.100.153:8999/docling/process",
        json={
            "document_url": file_url,
            "callback_url": "http://64.227.186.186:8041/documents/internal/process-document",
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "file_name": file_name,
            "appointment_id":appointment_id
        },
        timeout=60
    )


@celery_app.task(name="legacy_lab_ai.process_mongo_document")
def process_mongo_document(patient_id, doctor_id, document):

    httpx.post(
        f"{AGENTIC_URL}hms/users/ai-legacy/documents/internal/process-mongo-document",
        json={
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "document": document
        },
        timeout=600
    )