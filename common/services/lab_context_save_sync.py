from datetime import datetime
from bson import ObjectId
import logging

logger = logging.getLogger(__name__)


def log_extracted_text_and_analysis_sync(
    document_id: str,
    doc_type: str,
    document_collection,
    patient_context_collection
):
    """
    SYNC function for Celery workers ONLY
    """

    document = document_collection.find_one(
        {"_id": ObjectId(document_id)}
    )

    if not document:
        logger.error(f"No document found: {document_id}")
        return

    patient_id = document.get("patient_id")
    doctor_id = document.get("doctor_id")

    doc_type = (doc_type or "").lower()

    # Decide target field
    if doc_type in ["biomarker", "bio_marker", "biomarkers"]:
        target_field = "biomarkers"
    else:
        target_field = "lab_reports"

    # ---- NORMALIZATION (CRITICAL) ----
    structured_data = document.get("structured_data")
    if not isinstance(structured_data, list):
        structured_data = []

    medical_insights = document.get("medical_insights")
    if not isinstance(medical_insights, dict):
        medical_insights = {}

    conditions = document.get("conditions")
    if not isinstance(conditions, list):
        conditions = []

    context_payload = {
        "document_id": document_id,
        "doctor_id": doctor_id,

        # STORE DATE AS STRING
        "date": datetime.utcnow().strftime("%Y-%m-%d"),

        "structured_data": structured_data,
        "medical_insights": medical_insights,
        "conditions": conditions,
    }

    patient_context_collection.update_one(
        {"patient_id": patient_id},
        {"$push": {target_field: context_payload}},
        upsert=True
    )

    logger.info(
        f"Saved document {document_id} to patient_context.{target_field}"
    )
