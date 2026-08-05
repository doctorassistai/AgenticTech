from datetime import datetime
from bson import ObjectId

from HMS.celery_app import celery_app
from HMS.db import document_collection, patient_context_collection
from HMS.services.text_extraction import extract_text_from_file
from HMS.services.lab_biomarker_llm_service import run_lab_biomarker_llm
from HMS.services.lab_context_save_sync import log_extracted_text_and_analysis_sync

import logging

logger = logging.getLogger(__name__)

@celery_app.task(
    name="legacy_lab_ai.lab_pipeline",
    autoretry_for=(Exception,),
    retry_kwargs={"max_retries": 3, "countdown": 30},
    retry_backoff=True,
    bind=True
)
def lab_pipeline_task(
    self,
    document_id: str,
    doc_type: str,
    file_path: str,
    patient_id: str,
    doctor_id: str,
): 
    """
    LAB / BIOMARKER   background pipeline
    """

    try:
        # -------------------------
        # 0️⃣ Mark as PROCESSING
        # -------------------------
        document_collection.update_one(
            {"_id": ObjectId(document_id)},
            {"$set": {
                "status": "PROCESSING",
                "ai_completed": False
            }}
        )

        # -------------------------
        # 1️⃣ Extract text
        # -------------------------
        text = extract_text_from_file(file_path, doc_type) or ""

        document_collection.update_one(
            {"_id": ObjectId(document_id)},
            {"$set": {
                "extracted_text": text,
                "ocr_completed": True
            }}
        )

        # -------------------------
        # 2️⃣ Run LLM
        # -------------------------
        doc_type = doc_type.lower()
        
        logger.info(f"Running LLM for lab document {document_id} of type {doc_type}")
        llm_result = run_lab_biomarker_llm(text, doc_type) or {}
        logger.info(f"LLM result for document {document_id}: {llm_result}")
        structured_data = llm_result.get("structured_data", [])
        logger.info(f"Structured data extracted: {structured_data}")
        medical_insights = llm_result.get("medical_insights", {})
        
        conditions = llm_result.get("conditions", [])

        # Normalize outputs (safety)
        if not isinstance(structured_data, list):
            structured_data = []
        if not isinstance(medical_insights, dict):
            medical_insights = {}
        if not isinstance(conditions, list):
            conditions = []

        # -------------------------
        # 3️⃣ Update patient_documents
        # -------------------------
        document_collection.update_one(
            {"_id": ObjectId(document_id)},
            {"$set": {
                "structured_data": structured_data,
                "medical_insights": medical_insights,
                "conditions": conditions,
                "has_conditions": len(conditions) > 0,
                "ai_completed": True,
                "last_ai_analysis": datetime.utcnow(),
                "completed_at": datetime.utcnow(),
                "status": "COMPLETED"
            }}
        )

        # -------------------------
        # 4️⃣ Save to patient_context (SYNC ONLY)
        # -------------------------
        # -------------------------
# 4️⃣ Save to patient_context (SYNC ONLY)
# -------------------------
        log_extracted_text_and_analysis_sync(
            document_id=document_id,
            doc_type=doc_type,  # ✅ pass doc_type
            document_collection=document_collection,
            patient_context_collection=patient_context_collection
        )



        # -------------------------
        # 5️⃣ Mark context saved
        # -------------------------
        document_collection.update_one(
            {"_id": ObjectId(document_id)},
            {"$set": {"patient_context_saved": True}}
        )

    except Exception as e:
        # -------------------------
        # ❌ Failure handling
        # -------------------------
        document_collection.update_one(
            {"_id": ObjectId(document_id)},
            {"$set": {
                "status": "FAILED",
                "ai_completed": False,
                "error_message": str(e),
                "failed_at": datetime.utcnow()
            }}
        )
        raise

    return {"status": "DONE", "document_id": document_id}
