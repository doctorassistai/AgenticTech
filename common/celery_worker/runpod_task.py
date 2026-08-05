import asyncio
import logging
from typing import Dict, Any, Optional
from datetime import datetime

from .celery_app import celery_app
from common.llm.runpod_client import call_runpod_imaging_api
from common.HMS.db import (
    patient_documents_collection_sync,
    condition_collection_sync,
    image_reportnode_collection_sync,
)
# from .process_document import safe_parse_llm_json

logger = logging.getLogger(__name__)


# ============================================================
# Async helper
# ============================================================
def run_async(coro):
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        return asyncio.run(coro)
    return asyncio.run(coro)


# ============================================================
# CELERY TASK
# ============================================================
@celery_app.task(
    name="legacy_lab_ai.runpod_analysis",
    autoretry_for=(Exception,),
    retry_kwargs={"max_retries": 3, "countdown": 20},
    retry_backoff=True,
    bind=True,
)
def runpod_analysis_task(
    self,
    filename: str,
    doc_type: str,
    report_date: Optional[str],
    file_url: str,
    patient_id: str,
    appointment_id: Optional[str] = None,
    doctor_id: Optional[str] = None,
) -> Dict[str, Any]:

    logger.info(
        f"🧠 RUNPOD IMAGE TASK STARTED | patient={patient_id} | file={filename}"
    )

    try:
        # --------------------------------------------------
        # 1️⃣ Fetch IMAGE rules
        # --------------------------------------------------
        rules = get_image_report_node_rules(
            doctor_id=doctor_id,
            doc_type=doc_type,
        )

        # --------------------------------------------------
        # 2️⃣ Build prompt
        # --------------------------------------------------
        prompt = build_image_analysis_prompt(
            image_type=doc_type,
            analysis_rule_text=rules.get("analysis_rule_text"),
            condition_rule_text=rules.get("condition_rule_text"),
            output_keys=rules.get("output_keys", []),
            imaging_context=None,
        )

        logger.info("📨 RUNPOD PROMPT BUILT SUCCESSFULLY")

        # --------------------------------------------------
        # 3️⃣ Call RunPod
        # --------------------------------------------------
        raw_llm = run_async(
            call_runpod_imaging_api(
                image_url=file_url,
                prompt=prompt,
            )
        )

        logger.info(f"📦 RAW RUNPOD OUTPUT:\n{raw_llm}")

        # --------------------------------------------------
        # ✅ Extract actual LLM text safely
        # --------------------------------------------------
        if not isinstance(raw_llm, dict):
            raise ValueError("Invalid RunPod response format")

        analysis_text = raw_llm.get("analysis")

        if not analysis_text or not isinstance(analysis_text, str):
            raise ValueError("RunPod returned empty analysis text")

        # --------------------------------------------------
        # ✅ Parse JSON safely
        # --------------------------------------------------
        parsed_llm = safe_parse_llm_json(analysis_text)

        image_data = parsed_llm.get(doc_type)
        condition_data = parsed_llm.get("condition")

        if not isinstance(image_data, list):
            raise ValueError(f"{doc_type} must be an array of objects")

        # --------------------------------------------------
        # 5️⃣ Save IMAGE findings
        # --------------------------------------------------
        now = datetime.utcnow()

        patient_documents_collection_sync.update_one(
            {
                "patient_id": patient_id,
                "doc_type": doc_type,
            },
            {
                "$set": {
                    "doctor_id": doctor_id,
                    "updated_at": now,
                },
                "$push": {
                    "entries": {
                        "file_name": filename,
                        "appointment_id": appointment_id,
                        "report_date": report_date,
                        "data": image_data,
                        "created_at": now,
                    }
                },
                "$setOnInsert": {
                    "patient_id": patient_id,
                    "doc_type": doc_type,
                    "created_at": now,
                },
            },
            upsert=True,
        )

        logger.info(
            f"💾 IMAGE ENTRIES SAVED | patient={patient_id} | count={len(image_data)}"
        )

        # --------------------------------------------------
        # 6️⃣ Save CONDITION (optional)
        # --------------------------------------------------
        if isinstance(condition_data, dict):
            condition_text = condition_data.get("inference")

            if condition_text:
                condition_collection_sync.insert_one(
                    {
                        "patient_id": patient_id,
                        "doctor_id": doctor_id,
                        "doc_type": doc_type,
                        "report_date": report_date,
                        "condition": condition_text,
                        "created_at": now,
                    }
                )

                logger.info(
                    f"🧠 CONDITION SAVED | patient={patient_id} | {condition_text}"
                )

        # --------------------------------------------------
        # 7️⃣ Final response
        # --------------------------------------------------
        return {
            "status": "COMPLETED",
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "doc_type": doc_type,
            "filename": filename,
            "entries_saved": len(image_data),
            "completed_at": now.isoformat(),
        }

    except Exception as e:
        logger.error(
            f"❌ RUNPOD FAILED | patient={patient_id} | file={filename} | {str(e)}",
            exc_info=True,
        )
        raise





def get_image_report_node_rules(
    *,
    doctor_id: str,
    doc_type: str
) -> Dict[str, Any]:
    """
    Fetch doctor-specific IMAGE analysis rules, condition rules, and output keys
    """

    if not doctor_id:
        raise ValueError("doctor_id is required")

    if not doc_type:
        raise ValueError("doc_type is required")

    doc = image_reportnode_collection_sync.find_one(
        {
            "doctor_id": doctor_id,
            "doc_type": doc_type
        },
        {
            "_id": 0,
            "analysis_rule_text": 1,
            "condition_rule_text": 1,
            "output_keys": 1
        }
    )

    if not doc:
        raise ValueError(
            f"Image report node not found for doctor_id={doctor_id}, doc_type={doc_type}"
        )

    return doc





def build_image_analysis_prompt(
    *,
    image_type: str,
    analysis_rule_text: str,
    condition_rule_text: str,
    output_keys: list[str],
    imaging_context: str | None = None
) -> str:
    analysis_section = ""
    if analysis_rule_text:
        analysis_section = (
            "\nANALYSIS RULES (GUIDANCE ONLY):\n"
            "- Rules describe WHAT radiologic features to assess\n"
            "- Rules MUST NOT introduce findings not visible in the image\n"
            "- If a feature is not visible → return null\n"
            f"{analysis_rule_text}\n"
        )

    condition_section = ""
    if condition_rule_text:
        condition_section = (
            "\nCONDITION INFERENCE RULES:\n"
            "- Condition inference is OPTIONAL\n"
            "- Allowed ONLY if based on extracted (non-null) fields\n"
            "- MUST use cautious language\n"
            "- MUST be null if evidence is insufficient\n"
            f"{condition_rule_text}\n"
        )

    context_section = ""
    if imaging_context:
        context_section = f"\nCLINICAL CONTEXT:\n{imaging_context}\n"

    output_keys_instruction = build_image_output_keys_instruction(
        image_type=image_type,
        output_keys=output_keys
    )

    return f"""
You are a medical imaging analysis assistant.

PRIMARY TASK:
- STRICT structured data extraction from medical images

SECONDARY TASK:
- OPTIONAL condition inference (cautious, non-diagnostic)

IMAGE TYPE:
{image_type}
{context_section}

{analysis_section}
{condition_section}

OUTPUT REQUIREMENTS:
{output_keys_instruction}

CRITICAL STRUCTURE RULES:
- "{image_type}" MUST ALWAYS be an ARRAY
- NEVER repeat the same JSON key more than once
- Each finding MUST be its own object inside the array

CONDITION OUTPUT:
- Also return top-level key "condition"
- Inside it return ONLY: {{ "inference": <string or null> }}
- Use cautious language only:
  "may suggest", "can indicate", "is consistent with"
- NEVER diagnose
- NEVER state certainty

STRICT EXTRACTION RULES:
- IMAGE CONTENT is the ONLY source of truth
- NEVER hallucinate or infer beyond the image
- NEVER invent measurements or anatomy
- If not visible → return null
- Preserve wording EXACTLY


FINDING EXTRACTION RULES:
- Extract ALL distinct radiologic findings (normal AND abnormal)
- Each finding MUST be its own object
- Each object MUST fully populate output keys where applicable
- Do NOT repeat the same sentence across keys
- Each key should describe a DIFFERENT aspect of the finding





VALUE DETAIL REQUIREMENTS (VERY IMPORTANT):
- EACH output key value MUST be a detailed clinical description 
- ALL key values have detail content strictly from the image
- Values MUST be written as complete, professional radiology sentences
- Minimum length per value: 15–30 words (unless null)
- Describe:
  • appearance
  • extent
  • distribution
  • pattern (if visible)
- Do NOT use single words or short phrases
- If a value cannot be confidently described, return null






FINAL OUTPUT RULES:
- Return ONLY raw JSON
- Do NOT include markdown
- Do NOT include explanations
- Response MUST start with '{{' and end with '}}'
"""




def build_image_output_keys_instruction(
    *,
    image_type: str,
    output_keys: list[str]
) -> str:
    return (
        f'Return a JSON object with a top-level key "{image_type}".\n'
        f'"{image_type}" MUST be an ARRAY.\n'
        f'Each array item represents ONE radiologic finding or observation.\n'
        f'Each array item MUST contain ONLY these keys:\n'
        f'{", ".join(output_keys)}\n'
        f'Each value MUST come directly from the image content or be null.'
    )
