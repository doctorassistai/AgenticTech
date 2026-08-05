from celery import Celery
import os

celery_app = Celery(
    "agentic_client",
    broker=os.getenv(
        "CELERY_BROKER_URL"
    )
)


def send_document_task(patient_id, doctor_id, file_url, file_name,appointment_id):

    celery_app.send_task(
        "legacy_lab_ai.process_document",
        kwargs={
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "file_url": file_url,
            "file_name": file_name ,
            "appointment_id":appointment_id# ✅ ADD THIS
        },
        queue="legacy_queue"
    )


def send_mongo_document_task(patient_id, doctor_id, document):

    celery_app.send_task(
        "legacy_lab_ai.process_mongo_document",
        kwargs={
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "document": document
        },
        queue="legacy_queue"
    )


# ✅ NEW FUNCTIO
def send_patient_summary_task(patient_id, doctor_id):

    celery_app.send_task(
        "legacy_lab_ai.generate_patient_summary",
        kwargs={
            "patient_id": patient_id,
            "doctor_id": doctor_id
        },
        queue="summary_queue"   # ✅ IMPORTANT
    )







# ============================================================
# AGENT PDF PIPELINE TASK
# ============================================================

def send_agent_pdf_task(
    doctor_id,
    file_url,
    filename,
    guideline_source="other",
    version="",
):

    return celery_app.send_task(

        "agentic.run_pipeline",

        kwargs={
            "doctor_id": doctor_id,
            "file_url": file_url,
            "filename": filename,
            "guideline_source": guideline_source,
            "version": version,
        },

        queue="agent_pdf_queue",

        exchange="agent_pdf",

        routing_key="agent_pdf",
    )

