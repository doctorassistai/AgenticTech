from fastapi import FastAPI, UploadFile, File, HTTPException, APIRouter, Form
from fastapi.responses import StreamingResponse
import requests
import os
import operator
import httpx
from typing import Dict, Any,Literal,TypedDict
from typing import TypedDict, Annotated, List, Dict, Any, Optional, Literal, Union
from datetime import datetime, date, timedelta
import re
from common.llm.onoclogy_pipeline import process_oncology_investigation
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, WebSocket, status, File, Form, UploadFile
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, WebSocket, status, File, Form, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse, FileResponse
# from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field, EmailStr, validator
from typing import Any, Dict, List, Optional, Union
from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, date, timedelta
from bson import ObjectId
from enum import Enum
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from groq import Groq
import json
import os
import logging
import logging
import random
import string
import sys
import pytz
import socket
import platform
import httpx
import asyncio
import json
import queue
import threading
from passlib.context import CryptContext
from functools import wraps, partial
import uuid
from pathlib import Path
import os
import aiofiles
import shutil
import re
import copy
import traceback
from PIL import Image
import fitz  # PyMuPDF
import pytesseract
import PyPDF2
import requests
from celery.result import AsyncResult
from common.celery_worker.celery_app import celery_app
from groq import Groq
from fastapi import Query
from typing import Optional
from fastapi import Response
from jose import jwt, JWTError
from datetime import datetime, timedelta
from fastapi.encoders import jsonable_encoder
# from common.celery_worker.process_documents import process_document_task
from common.celery_worker.runpod_task import runpod_analysis_task

from pydantic import BaseModel, Field, ValidationError, field_validator
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
from langchain_core.prompts import ChatPromptTemplate

from langchain_core.output_parsers import JsonOutputParser, PydanticOutputParser
import operator
from dotenv import load_dotenv
from common.celery_worker.handwritten_task import process_handwritten_document


router = APIRouter(
    prefix="/storage",
    tags=["common"],
    responses={404: {"description": "Not found"}},
)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
STORAGE_BASE_URL = "https://doctorassist.ai/uploads"   
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

mongodb_client = AsyncIOMotorClient(MONGO_URI)  # async (Motor)
database = mongodb_client[MONGO_DB]

client = MongoClient(MONGO_URI)  # sync (PyMongo)
db = client[MONGO_DB]

load_dotenv()
api_base_url = os.getenv("VITE_BACKEND_URL")



patient_user_collection = database["patient_users"]
oncology_investigations_collection = database["oncology_investigations"]
patient_appointments_collection = database["patient_appointments"]
doctor_user_collection = database["doctor_users"]
processing_tracker = database["processing_tracker"]
document_collection = database["patient_documents_collection"]
image_document_collection = database["patient_image_documents"]
condition_collection = database["conditions"]
reportnode_collection = database["report_nodes"]
image_reportnode_collection =database["image_report_nodes"]
report_list_collection = database["report_list"]
temp_documents_collection = database["temp_documents"]
preventive_images_collection = db["preventive_images"]
groq_client = Groq(
    api_key=os.getenv("GROQ_API_KEY")
)

# =====================================================
# UPLOAD → Proxy to main storage service
# =====================================================
@router.post("/proxy/upload")
async def proxy_upload(
    request: Request, 
    doctor_id: str = Form(...),
    patient_id: str = Form(...),
    appointment_id: Optional[str] = Form(None),
    doc_type: Optional[str] = Form(None), 
    category: Optional[str] = Form(None),          # ✅ ADD
    subcategory: Optional[str] = Form(None),       # ✅ ADD
    report_date: Optional[str] = Form(None),
    upload_mode: str = Form(...),
    hospital_id: Optional[str] = Form(None),
    file: UploadFile = File(...),
    
):
    try:
        # --------------------------------------------------
        # 1️⃣ Upload to storage service
        # --------------------------------------------------
        url = f"{STORAGE_BASE_URL}/upload"
        logger.info(f"Uploading file to {url}")
        logger.info(f"UPLOAD MODE {upload_mode}")

        files = {
            "file": (file.filename, await file.read(), file.content_type)
        }

        params = {
            "doctor_id": doctor_id,
            "patient_id": patient_id,
            "doc_type": doc_type,
            "category": category,
            "subcategory": subcategory
        }
        logger.info(f"Uploading file to {url} with params {params}")
        response = requests.post(url, params=params, files=files, timeout=60)
        logger.info(f"Upload response: {response.text}")
        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=response.text
            )

        upload_result = response.json()
                # ================= FIX: read category/subcategory from JSON if missing =================
        if category is None or subcategory is None:
            try:
                body = await request.json()
                category = category or body.get("category")
                subcategory = subcategory or body.get("subcategory")
            except Exception:
                pass

        logger.info(
            "UPLOAD FINAL | category=%s | subcategory=%s",
            category,
            subcategory
        )
        # ========================================================================================

        # ------------------------------------------
        # Appointment Resolution (CORRECT WAY)
        # ------------------------------------------
        logger.info(f"alwin_:{appointment_id}")
        INVALID_VALUES = {None, "", "null", "undefined", "fail"}

        # normalize input
        if isinstance(appointment_id, str):
            appointment_id = appointment_id.strip().lower()

        if appointment_id in INVALID_VALUES:
            appointment_id = None

        # final logic
        if appointment_id:
            latest_appointment_id = appointment_id
        else:
            latest_appointment_id = await get_latest_appointment_id(
                patient_id,
                doctor_id
            )

        # Optional logging
        if latest_appointment_id:
            logger.info(f"Using appointment_id={latest_appointment_id}")
        else:
            logger.warning(f"No appointment found for patient={patient_id}, doctor={doctor_id}")
        stored_filename = upload_result["filename"]
        task_id = None
        file_url = f"{STORAGE_BASE_URL}/files/{patient_id}/{stored_filename}"
        # --------------------------------------------------
        # 2️⃣ Conditional processing
        # --------------------------------------------------

        # ✅ CASE 1: runpod → just return success
        if upload_mode.lower() == "image":
            file_url = f"{STORAGE_BASE_URL}/files/{patient_id}/{stored_filename}"
            task = runpod_analysis_task.delay(
                filename=file.filename,
                doc_type=doc_type,
                report_date=report_date,
                file_url=file_url,
                patient_id=patient_id,
                appointment_id=latest_appointment_id,
                doctor_id=doctor_id
            )
            task_id = task.id        
        # ✅ CASE 2: lab_report → trigger OCR
        elif upload_mode.lower() == "handwritten":
            file_url = f"{STORAGE_BASE_URL}/files/{patient_id}/{stored_filename}"
            await processing_tracker.update_one(
        {
                    "patient_id": patient_id,
                    "doctor_id": doctor_id
                },
                {
                    "$inc": {
                        "total_documents": 1
                    },
                    "$set": {
                        "status": "processing"
                    },
                    "$setOnInsert": {
                        "processed_documents": 0,
                        "created_at": datetime.utcnow()
                    }
                },
                upsert=True
            )
            task = process_handwritten_document.apply_async(
                kwargs={
                    "filename": file.filename,
                    "doc_type": doc_type,
                    "category_key": category,
                    "subcategory_key": subcategory,
                    "report_date": report_date,
                    "file_url": file_url,
                    "patient_id": patient_id,
                    "appointment_id": latest_appointment_id,
                    "doctor_id": doctor_id,
                    "hospital_id": hospital_id,
                },
                queue="handwritten_queue"
            )
            task_id = task.id

            return {
                "message": "Handwritten file uploaded and queued for processing",
                "ocr_task_id": task_id,
                "category": category,
                "subcategory": subcategory,
                "file_url": file_url,
            }

            # from llama_cloud import LlamaCloud
            # import requests
            # import tempfile
            # import os

            # file_url = f"{STORAGE_BASE_URL}/files/{patient_id}/{stored_filename}"

            # logger.info(f"Starting handwritten parsing for: {file_url}")

            # try:
            #     # --------------------------------------------------
            #     # Initialize client
            #     # --------------------------------------------------
            #     client = LlamaCloud(
            #         api_key="llx-1HAGjDZaXymvAvRMg6ovKGELFwxwfpWFnpaa1vavO6kRt3K4"
            #     )

            #     # --------------------------------------------------
            #     # Download uploaded file
            #     # --------------------------------------------------
            #     response = requests.get(file_url, timeout=60)

            #     if response.status_code != 200:
            #         raise Exception("Failed to download uploaded file")

            #     # --------------------------------------------------
            #     # Save temp file
            #     # --------------------------------------------------
            #     with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            #         tmp.write(response.content)
            #         temp_pdf_path = tmp.name

            #     # --------------------------------------------------
            #     # Upload to LlamaCloud
            #     # --------------------------------------------------
            #     uploaded_file = client.files.create(
            #         file=temp_pdf_path,
            #         purpose="parse"
            #     )

            #     logger.info(f"Uploaded to LlamaCloud: {uploaded_file.id}")

            #     # --------------------------------------------------
            #     # Parse document
            #     # --------------------------------------------------
            #     result = client.parsing.parse(
            #         file_id=uploaded_file.id,
            #         tier="agentic",
            #         version="latest",
            #         expand=["markdown"],
            #     )

            #     # --------------------------------------------------
            #     # Extract markdown
            #     # --------------------------------------------------
            #     parsed_pages = []

            #     for i, page in enumerate(result.markdown.pages):
            #         parsed_pages.append({
            #             "page": i + 1,
            #             "markdown": page.markdown
            #         })

            #     full_markdown = "\n\n".join(
            #         [p["markdown"] for p in parsed_pages]
            #     )

            #     # --------------------------------------------------
            #     # Save DB
            #     # --------------------------------------------------
            #     await temp_documents_collection.insert_one({
            #         "patient_id": patient_id,
            #         "doctor_id": doctor_id,
            #         "appointment_id": latest_appointment_id,
            #         "file_name": file.filename,
            #         "file_url": file_url,
            #         "upload_mode": "handwritten",
            #         "parsed_text": full_markdown,
            #         "status": "parsed",
            #         "created_at": datetime.utcnow()
            #     })

            #     # cleanup
            #     os.remove(temp_pdf_path)

            #     # --------------------------------------------------
            #     # RETURN RESULT DIRECTLY
            #     # --------------------------------------------------
            #     return {
            #         "message": "Handwritten document parsed successfully",
            #         "doc_type": doc_type,
            #         "category": category,
            #         "subcategory": subcategory,
            #         "file_url": file_url,
            #         "parsed_result": {
            #             "pages": parsed_pages,
            #             "full_markdown": full_markdown
            #         }
            #     }

            # except Exception as e:
            #     logger.error(f"LlamaParse failed: {str(e)}")
            #     raise HTTPException(
            #         status_code=500,
            #         detail=f"Handwritten parsing failed: {str(e)}"
            #     )
        elif upload_mode.lower() == "document":

            file_url = f"{STORAGE_BASE_URL}/files/{patient_id}/{stored_filename}"
            await processing_tracker.update_one(
        {
                    "patient_id": patient_id,
                    "doctor_id": doctor_id
                },
                {
                    "$inc": {
                        "total_documents": 1
                    },
                    "$set": {
                        "status": "processing"
                    },
                    "$setOnInsert": {
                        "processed_documents": 0,
                        "created_at": datetime.utcnow()
                    }
                },
                upsert=True
            )
            task = process_handwritten_document.apply_async(
                kwargs={
                    "filename": file.filename,
                    "doc_type": doc_type,
                    "category_key": category,
                    "subcategory_key": subcategory,
                    "report_date": report_date,
                    "file_url": file_url,
                    "patient_id": patient_id,
                    "appointment_id": latest_appointment_id,
                    "doctor_id": doctor_id,
                    "hospital_id": hospital_id,
                },
                queue="handwritten_queue"
            )
            task_id = task.id

            return {
                "message": "Handwritten file uploaded and queued for processing",
                "ocr_task_id": task_id,
                "category": category,
                "subcategory": subcategory,
                "file_url": file_url,
            }
        else:
            file_url = f"{STORAGE_BASE_URL}/files/{patient_id}/{stored_filename}"
            
            task = process_document_task.apply_async(
                kwargs={
                    "filename": file.filename,
                    "doc_type": doc_type,
                    "category_key": category,
                    "subcategory_key": subcategory,
                    "report_date": report_date,
                    "file_url": file_url,
                    "patient_id": patient_id,
                    "appointment_id": latest_appointment_id,
                    "doctor_id": doctor_id,
                    "hospital_id": hospital_id,
                },
                queue="legacy_queue"   # 🔥 FORCE correct queue
            )
            task_id = task.id

        # --------------------------------------------------
        # 3️⃣ Default response
        # --------------------------------------------------
        return {
            "message": "File uploaded successfully",
            "doc_type": doc_type,
            "ocr_task_id": task_id,  
            "category": category,
            "subcategory": subcategory,
            "data": upload_result
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# =====================================================
# DOWNLOAD → Proxy from main storage service
# =====================================================
@router.get("/proxy/download")
def proxy_download(patient_id: str, filename: str):
    try:
        url = f"{STORAGE_BASE_URL}/download"
        params = {
            "patient_id": patient_id,
            "filename": filename
        }

        response = requests.get(url, params=params, stream=True, timeout=60)

        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail="File not found")

        return StreamingResponse(
            response.iter_content(chunk_size=8192),
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"'
            }
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))




def build_medical_prompt(
    document_type: str,
    extracted_text: str
) -> str:
    """
    Central prompt builder for medical documents.
    """

    document_type = document_type.lower()

    # ==================================================
    # LAB REPORT
    # ==================================================
    if document_type == "lab_report":
        return f"""
[INST] <<SYS>>
You are an expert medical AI assistant with deep knowledge of clinical medicine,
diagnostic criteria, and WHO/ICD standards.

DOCUMENT TYPE: {document_type}

Analyze the following medical document of type "{document_type}" and provide comprehensive structured output including:
1. Structured data extraction (individual lab tests)
2. Medical insights and clinical significance
3. Condition identification with WHO/ICD codes where applicable
4. Risk assessment and recommendations

========================
FLAG RULES (CRITICAL)
========================
- Always parse numeric values for test results and reference ranges.
- Compare the test value numerically to the reference range.
- Assign flags strictly as:
    "high" → if value > upper limit of reference range
    "low" → if value < lower limit of reference range
    "normal" → if value is within reference range
- Reference ranges may appear as:
    • min-max (e.g., 150-169)
    • ≤value (e.g., ≤7.0)
    • ≥value (e.g., ≥4.0)
- Handle all formats numerically.
- ONLY use: "high", "low", or "normal"
- Do NOT use any other flag terms.

Example:
{{"test_name": "Triglycerides", "value": "73", "unit": "mg/dL", "reference_range": "150-169", "flag": "low"}}

========================
OUTPUT FORMAT (STRICT)
========================
Return ONLY a valid JSON object with the following structure:

{{
  "structured_data": [
    {{
      "test_name": "test name",
      "value": "value",
      "unit": "unit",
      "reference_range": "reference range",
      "flag": "high|low|normal"
    }}
  ],
  "medical_insights": {{
    "summary": "comprehensive medical summary",
    "key_findings": ["finding1", "finding2"],
    "recommendations": ["recommendation1", "recommendation2"],
    "risk_factors": ["risk1", "risk2"],
    "follow_up_required": true,
    "urgency_level": "routine|urgent|critical"
  }},
  "conditions": [
    {{
      "condition_name": "Condition Name",
      "description": "Clinical description",
      "severity": "low|medium|high|critical",
      "confidence": 0,
      "who_code": "WHO_CODE if applicable",
      "icd_code": "ICD_CODE if applicable",
      "indicators": ["indicator1", "indicator2"],
      "values_supporting": ["value1", "value2"],
      "recommendation": "specific recommendation",
      "progression_notes": "notes about disease progression",
      "requires_immediate_attention": false
    }}
  ]
}}

========================
MEDICAL DOCUMENT (EXTRACTED TEXT)
========================
{extracted_text}

<</SYS>>
[/INST]
""".strip()

    # ==================================================
    # PRESCRIPTION
    # ==================================================
    elif document_type == "prescription":
        return f"""
[INST] <<SYS>>
You are an expert medical AI assistant with deep knowledge of pharmacology
and clinical medicine.

DOCUMENT TYPE: {document_type}

Extract medications, dosages, frequency, duration, and identify drug interactions.

Return ONLY valid JSON.

MEDICAL DOCUMENT:
{extracted_text}

<</SYS>>
[/INST]
""".strip()

    # ==================================================
    # DEFAULT / UNKNOWN
    # ==================================================
    else:
        return f"""
[INST] <<SYS>>
You are a medical AI assistant.

DOCUMENT TYPE: {document_type}

Analyze the following medical document and return structured insights.

MEDICAL DOCUMENT:
{extracted_text}

<</SYS>>
[/INST]
""".strip()



# =====================================================



SYSTEM_PROMPT = """
IMPORTANT:
- You MUST return ONLY raw JSON.
- Do NOT include any text before or after the JSON.
- Do NOT wrap the JSON in markdown.
- The response MUST start with '{' and end with '}'.

You are a medical AI assistant that helps doctors configure
DETAILED, REUSABLE REPORT PROCESSING RULES for automated clinical workflows.

You will receive:
- A medical document type (doctype)
- A doctor medical speciality

PRIMARY DESIGN PRINCIPLE:
- Rules MUST be driven FIRST by the document type, because document structure
  determines what information can be extracted.
- Medical speciality MUST refine clinical emphasis, prioritization,
  and condition relevance within that document type.

Your task:
- Generate STANDARD, TEMPLATE-LEVEL analysis and condition inference rules
  appropriate for the given document type and medical speciality.
- These rules are used to PROCESS, STRUCTURE, and PRIORITIZE future reports,
  not to interpret or diagnose a specific patient.
- Do NOT assume patient-specific values, results, timelines, diagnoses,
  or clinical outcomes.
- Generate EXACTLY 3 analysis rules.
- Generate EXACTLY 3 condition inference rules.
- Each rule MUST be clinically meaningful, detailed, explanatory,
  and sufficiently long to convey clear processing intent.
- Recommend output_keys ONLY if they are broadly applicable
  to reports of this document type.

Rules MUST be strongly speciality-aware.
For example:
- Cardiology → emphasize cardiac tests, biomarkers, functional indicators,
  ischemia-related findings, rhythm-related information, and risk stratification
- Endocrinology → emphasize hormone panels, metabolic markers, regulatory patterns
- Nephrology → emphasize renal function indicators, filtration markers, chronicity
- General medicine → emphasize screening tests, abnormal flags, and trends

All rules must follow internationally accepted medical guidelines
(WHO, CDC, NIH, AHA, ESC, KDIGO, ACR, RSNA, or equivalent).

====================================================
ANALYSIS RULES (DETAILED DOCUMENT PROCESSING LOGIC)
====================================================

Analysis rules define HOW reports of this document type
should be systematically processed and structured.

Each analysis rule MUST:
- Be written as a SINGLE, complete, multi-clause clinical sentence
- Be detailed and instructional rather than brief or generic
- Explicitly describe ALL of the following:
  1) WHAT categories of information should be extracted
     based on the document type
     (e.g., test names, result values, qualitative observations,
      impressions, recommendations, flags)
  2) HOW that information should be evaluated, normalized,
     or organized
     (e.g., comparison to reference ranges, identification of abnormal flags,
      normalization of terminology, grouping by clinical relevance,
      prioritization of speciality-critical findings)
  3) WHY this processing step is clinically important,
     with reasoning aligned to the given medical speciality
- Be reusable across all reports of this document type
- Read like a clear instruction for an automated processing pipeline

Avoid short, vague, or high-level statements.
Each analysis rule should provide enough detail
to guide real-world report parsing and prioritization.

====================================================
CONDITION INFERENCE RULES (DETAILED CLINICAL CONTEXT)
====================================================

Condition inference rules describe WHEN a POSSIBLE clinical condition
MAY be suggested based on TYPES or PATTERNS of findings
commonly identified in this document type.

Each condition rule MUST:
- Be written as a SINGLE, complete IF–THEN clinical sentence
- Be more descriptive than minimal phrasing
- Follow this structure exactly:
  "If <specific category or pattern of findings typically found in this document type>,
   then this may suggest <possible condition>"
- Use cautious, non-diagnostic language ONLY:
  "may suggest", "raises concern for", "can indicate", "is consistent with"
- Reference ONLY well-established, guideline-supported clinical conditions
- Be clearly appropriate for both the document type and the medical speciality
- Explain the clinical reasoning implicitly through wording,
  without numeric thresholds or patient-specific conclusions

Condition rules MUST NOT:
- Declare or confirm a diagnosis
- State certainty, urgency, or treatment decisions
- Refer to an individual patient
- Introduce rare, speculative, or loosely related conditions

====================================================
OUTPUT_KEYS RULES (DOCUMENT-BASED STRUCTURED DATA DESIGN)
====================================================

output_keys define WHAT structured data elements
can be extracted from reports of this document type.

General requirements:
- output_keys MUST be driven primarily by document structure
- output_keys MUST be generic, reusable, and broadly applicable
- output_keys MUST describe the TYPE of information, not anatomy or disease
- output_keys MUST be lowercase snake_case
- output_keys MUST NOT include literal values, units, or identifiers
- output_keys MUST NOT include patient, doctor, hospital, IDs, or dates

Allowed categories (include ONLY those appropriate to the document type):
- test_name
- result_value
- unit
- reference_range
- severity
- abnormality
- findings
- interpretation
- clinical_significance
- trend
- comparison
- recommendation
- follow_up
- specimen_type
- technique
- image_quality

Do NOT invent output_keys that would not commonly appear
across reports of this document type.

====================================================
OUTPUT FORMAT (STRICT)
====================================================

Return JSON EXACTLY in this structure:

{
  "doc_type": "<document_type>",
  "analysis_rules": {
    "1": { "rule_sentence": "" },
    "2": { "rule_sentence": "" },
    "3": { "rule_sentence": "" }
  },
  "condition_rules": {
    "1": { "rule_sentence": "" },
    "2": { "rule_sentence": "" },
    "3": { "rule_sentence": "" }
  },
  "output_keys": []
}

"""





# ===== REQUEST SCHEMA =====
class GenerateRulesRequest(BaseModel):
    doc_type: str
    doctor_id: str


async def get_doctor_speciality(doctor_id: str) -> str:
    doctor = await doctor_user_collection.find_one(
        {"sys_user_id": doctor_id},
        {"specialization": 1}
    )

    if not doctor or not doctor.get("specialization"):
        return "general_medicine"
    spec = doctor["specialization"].lower()
    logger.info(f"Doctor specialization for id={doctor_id} is {spec}")
    return doctor["specialization"].lower()

# ===== PERFECT JSON EXTRACTOR =====
def extract_json_strict(text: str) -> dict:
    """
    Extracts JSON by tracking opening/closing braces.
    This is safer than regex.
    """
    start = text.find("{")
    if start == -1:
        raise ValueError("No JSON start found")

    brace_count = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            brace_count += 1
        elif text[i] == "}":
            brace_count -= 1
            if brace_count == 0:
                json_str = text[start:i+1]
                return json.loads(json_str)

    raise ValueError("Incomplete JSON object")


# ===== LLM FUNCTION =====
def generate_rules_from_llm(doc_type: str, speciality: str) -> dict:
    user_prompt = f"""
Doctor medical speciality:
{speciality}

Medical document type:
{doc_type}

Generate standard, reusable medical analysis and condition inference rules
appropriate for this speciality and document type.
"""

    try:
        response = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
            max_tokens=3000,
        )

        raw = response.choices[0].message.content.strip()
        parsed = extract_json_strict(raw)

        # ---- VALIDATION ----
        if parsed.get("doc_type") != doc_type:
            raise ValueError("doc_type mismatch in LLM output")

        if len(parsed.get("analysis_rules", {})) != 3:
            raise ValueError("analysis_rules must contain exactly 3 rules")

        if len(parsed.get("condition_rules", {})) != 3:
            raise ValueError("condition_rules must contain exactly 3 rules")

        if not isinstance(parsed.get("output_keys"), list):
            raise ValueError("output_keys must be a list")

        parsed["output_keys"] = sorted(set(parsed["output_keys"]))

        return parsed

    except Exception as e:
        print("🔴 RAW LLM OUTPUT:")
        print(raw)
        raise HTTPException(
            status_code=500,
            detail=f"LLM JSON parsing failed: {str(e)}"
        )


# ===== API ENDPOINT =====
@router.post("/hms/report-node/generate-rules")
async def generate_report_rules(payload: GenerateRulesRequest):
    speciality = await get_doctor_speciality(payload.doctor_id)

    return {
        "status": "success",
        "data": generate_rules_from_llm(
            payload.doc_type,
            speciality
        )
    }



    
    
    
    
    
from pydantic import BaseModel, Field
from typing import Optional, List

class ReportNodeModel(BaseModel):
    doctor_id: str
    doc_type: str
    analysis_rule_text: str
    


@router.post("/hms/report-node/save")
async def save_report_node(payload: ReportNodeModel):
    """
    Save analysis + condition rules and output keys (Motor async-safe)
    """

    if not payload.doctor_id:
        raise HTTPException(status_code=400, detail="doctor_id is required")

    if not payload.analysis_rule_text.strip():
        raise HTTPException(status_code=400, detail="analysis_rule_text is required")


    

    # ❌ Forbidden keys filter
    

    

    document = {
        "doctor_id": payload.doctor_id,
        "doc_type": payload.doc_type,
        "analysis_rule_text": payload.analysis_rule_text,
        "updated_at": datetime.utcnow()
    }

    await reportnode_collection.update_one(
        {
            "doctor_id": payload.doctor_id,
            "doc_type": payload.doc_type,
        },
        {
            "$set": document,
            "$setOnInsert": {
                "created_at": datetime.utcnow()
            }
        },
        upsert=True
    )

    return {
        "status": "success",
        "message": "Report node saved successfully",
        "data": document
    }



@router.get("/hms/report-node/get")
async def get_report_node(doctor_id: str, doc_type: str):
    """
    Retrieve analysis + condition rules and output_keys
    """

    if not doctor_id:
        raise HTTPException(status_code=400, detail="doctor_id is required")

    if not doc_type:
        raise HTTPException(status_code=400, detail="doc_type is required")

    doc = await reportnode_collection.find_one(
        {
            "doctor_id": doctor_id,
            "doc_type": doc_type
        },
        {
            "_id": 0,
            "doctor_id": 1,
            "doc_type": 1,
            "analysis_rule_text": 1,
            
        }
    )

    if not doc:
        raise HTTPException(
            status_code=404,
            detail="Report node not found"
        )

    return {
        "status": "success",
        "data": doc
    }



@router.get("/hms/patient-document")
async def get_patient_document(
    patient_id: str = Query(..., description="Patient ID"),
    doc_type: str = Query(..., description="Document type (lab_report, ct_scan, etc.)"),
):
    """
    Retrieve full patient document by patient_id and doc_type
    Returns all entries
    """

    if not patient_id:
        raise HTTPException(status_code=400, detail="patient_id is required")

    if not doc_type:
        raise HTTPException(status_code=400, detail="doc_type is required")

    doc = await document_collection.find_one(
        {
            "patient_id": patient_id,
            "doc_type": doc_type
        },
        {
            "_id": 0
        }
    )

    if not doc:
        raise HTTPException(
            status_code=404,
            detail="Patient document not found"
        )

    return {
        "status": "success",
        "data": doc
    }



@router.get("/hms/patient-condition")
async def get_patient_conditions(
    patient_id: str = Query(..., description="Patient ID"),
    doctor_id: str = Query(..., description="Doctor ID"),
):
    """
    Retrieve all condition inferences for a patient by doctor
    Returns all condition entries
    """

    if not patient_id:
        raise HTTPException(status_code=400, detail="patient_id is required")

    if not doctor_id:
        raise HTTPException(status_code=400, detail="doctor_id is required")

    cursor = condition_collection.find(
        {
            "patient_id": patient_id,
            "doctor_id": doctor_id
        },
        {
            "_id": 0
        }
    ).sort("created_at", -1)

    conditions = await cursor.to_list(length=100)

    if not conditions:
        raise HTTPException(
            status_code=404,
            detail="No conditions found for this patient"
        )

    return {
        "status": "success",
        "data": conditions
    }



from fastapi import Query, HTTPException

@router.get("/hms/patient-docu")
async def get_patient_documents(
    patient_id: str = Query(..., description="Patient ID"),
    doctor_id: str = Query(..., description="Doctor ID"),
):
    """
    Retrieve all patient documents based on patient_id and doctor_id
    """

    documents_cursor = document_collection.find(
        {
            "patient_id": patient_id,
            "doctor_id": doctor_id
        },
        {
            "_id": 0
        }
    )

    documents = await documents_cursor.to_list(length=None)

    if not documents:
        raise HTTPException(
            status_code=404,
            detail="No documents found for this patient and doctor"
        )

    return {
        "status": "success",
        "count": len(documents),
        "data": documents
    }






# =====================================================

IMAGE_SYSTEM_PROMPT = """
IMPORTANT:
- You MUST return ONLY raw JSON.
- Do NOT include any text before or after the JSON.
- Do NOT wrap the JSON in markdown.
- The response MUST start with '{' and end with '}'.

You are a medical AI assistant that helps doctors configure
image-based radiology analysis rules.

You will receive:
- A radiology image type (e.g., x_ray, ct_scan, mri)
- A doctor medical speciality

Your task:
- Generate standard, reusable radiology analysis and condition inference rules
  appropriate for the given medical speciality and image type
  based on internationally accepted radiology guidelines.
- Do NOT assume patient-specific findings.
- Generate EXACTLY 3 analysis rules.
- Generate EXACTLY 3 condition inference rules.
- Recommend output_keys ONLY if they are generally applicable to this image type.

All rules must follow internationally accepted radiology guidelines
(ACR, RSNA, WHO, NIH, or equivalent).

========================
ANALYSIS RULES
========================
Each analysis rule MUST:
- Be a SINGLE complete clinical sentence
- Describe what radiologic feature to assess, how to assess it, and why
- Be applicable across similar radiology images

========================
CONDITION INFERENCE RULES
========================
Each condition rule MUST:
- Be written as ONE IF–THEN sentence
- Use cautious language only:
  "may suggest", "raises concern for", "is consistent with"
- Never declare a diagnosis

========================
OUTPUT FORMAT (STRICT)
========================
Return JSON EXACTLY in this structure:

{
  "doc_type": "<image_type>",
  "analysis_rules": {
    "1": { "rule_sentence": "" },
    "2": { "rule_sentence": "" },
    "3": { "rule_sentence": "" }
  },
  "condition_rules": {
    "1": { "rule_sentence": "" },
    "2": { "rule_sentence": "" },
    "3": { "rule_sentence": "" }
  },
  "output_keys": []
}
"""

def extract_json_strict(text: str) -> dict:
    start = text.find("{")
    if start == -1:
        raise ValueError("No JSON start found")

    brace_count = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            brace_count += 1
        elif text[i] == "}":
            brace_count -= 1
            if brace_count == 0:
                return json.loads(text[start:i+1])

    raise ValueError("Incomplete JSON object")


def generate_image_rules_from_llm(image_type: str, speciality: str) -> dict:
    user_prompt = f"""
Doctor medical speciality:
{speciality}

Radiology image type:
{image_type}

Generate standard, reusable radiology analysis and condition inference rules
appropriate for this medical speciality and image type.
"""

    try:
        response = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": IMAGE_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
            max_tokens=2000,
        )

        raw = response.choices[0].message.content.strip()
        parsed = extract_json_strict(raw)

        # ---- VALIDATION ----
        if parsed.get("doc_type") != image_type:
            raise ValueError("doc_type mismatch in image LLM output")

        if len(parsed.get("analysis_rules", {})) != 3:
            raise ValueError("analysis_rules must contain exactly 3 rules")

        if len(parsed.get("condition_rules", {})) != 3:
            raise ValueError("condition_rules must contain exactly 3 rules")

        if not isinstance(parsed.get("output_keys"), list):
            raise ValueError("output_keys must be a list")

        parsed["output_keys"] = sorted(set(parsed["output_keys"]))

        return parsed

    except Exception as e:
        print("🔴 RAW IMAGE LLM OUTPUT:")
        print(raw)
        raise HTTPException(
            status_code=500,
            detail=f"Image LLM JSON parsing failed: {str(e)}"
        )



@router.post("/hms/report-node/image/generate-rules")
async def generate_image_report_rules(payload: GenerateRulesRequest):
    speciality = await get_doctor_speciality(payload.doctor_id)

    return {
        "status": "success",
        "data": generate_image_rules_from_llm(
            payload.doc_type,
            speciality
        )
    }




class ImageReportNodeModel(BaseModel):
    doctor_id: str
    doc_type: str  # x_ray, ct_scan, mri, etc.
    analysis_rule_text: str
    condition_rule_text: str
    output_keys: List[str]


# ================= IMAGE SAVE ENDPOINT =================
@router.post("/hms/report-node/image/save")
async def save_image_report_node(payload: ImageReportNodeModel):
    """
    Save image-based analysis + condition rules and output keys
    (Same behavior as document save)
    """

    # ---------- BASIC VALIDATION ----------
    if not payload.doctor_id:
        raise HTTPException(status_code=400, detail="doctor_id is required")

    if not payload.doc_type:
        raise HTTPException(status_code=400, detail="doc_type is required")

    if not payload.analysis_rule_text.strip():
        raise HTTPException(
            status_code=400,
            detail="analysis_rule_text is required"
        )

    if not payload.condition_rule_text.strip():
        raise HTTPException(
            status_code=400,
            detail="condition_rule_text is required"
        )

    if not payload.output_keys or not isinstance(payload.output_keys, list):
        raise HTTPException(
            status_code=400,
            detail="At least one output_key is required"
        )

    # ---------- FORBIDDEN KEYS (SAME AS DOCUMENT) ----------
    FORBIDDEN_KEYS = {
        "date", "time", "timestamp",
        "patient_name", "patient_id",
        "doctor_name", "hospital_name"
    }

    clean_output_keys = [
        k for k in payload.output_keys
        if isinstance(k, str) and k not in FORBIDDEN_KEYS
    ]

    if not clean_output_keys:
        raise HTTPException(
            status_code=400,
            detail="Invalid output_keys"
        )

    # ---------- DOCUMENT ----------
    document = {
        "doctor_id": payload.doctor_id,
        "doc_type": payload.doc_type,
        "analysis_rule_text": payload.analysis_rule_text.strip(),
        "condition_rule_text": payload.condition_rule_text.strip(),
        "output_keys": clean_output_keys,  # ❗ PRESERVED
        "updated_at": datetime.utcnow()
    }

    # ---------- UPSERT ----------
    await image_reportnode_collection.update_one(
        {
            "doctor_id": payload.doctor_id,
            "doc_type": payload.doc_type,
        },
        {
            "$set": document,
            "$setOnInsert": {
                "created_at": datetime.utcnow()
            }
        },
        upsert=True
    )

    return {
        "status": "success",
        "message": "Image report node saved successfully",
        "data": document
    }

    
    
@router.get("/hms/report-node/image/get")
async def get_image_report_node(doctor_id: str, doc_type: str):
    """
    Retrieve image-based analysis + condition rules and output_keys
    (No hard validation on doc_type)
    """

    # ---------- BASIC VALIDATION ----------
    if not doctor_id:
        raise HTTPException(status_code=400, detail="doctor_id is required")

    if not doc_type:
        raise HTTPException(status_code=400, detail="doc_type is required")

    # ---------- FETCH DOCUMENT ----------
    doc = await image_reportnode_collection.find_one(
        {
            "doctor_id": doctor_id,
            "doc_type": doc_type,
        },
        {
            "_id": 0,
            "doctor_id": 1,
            "doc_type": 1,
            "analysis_rule_text": 1,
            "condition_rule_text": 1,
            "output_keys": 1,
        }
    )

    if not doc:
        raise HTTPException(
            status_code=404,
            detail="Image report node not found"
        )

    return {
        "status": "success",
        "data": doc
    }
    
    
    
@router.get("/task-status/{task_id}")
async def get_task_status(task_id: str):
    try:
        task_result = AsyncResult(task_id, app=celery_app)

        response = {
            "task_id": task_id,
            "completed": task_result.ready(),
            "status": task_result.status,
        }

        # ✅ ONLY AFTER SUCCESS
        if task_result.successful():
            result = task_result.result or {}

            response["result"] = result
            response["alerts"] = result.get("alerts", [])

        return response

    except Exception as e:
        return {
            "task_id": task_id,
            "completed": False,
            "status": "ERROR",
            "error": str(e)
        }




from datetime import datetime
from fastapi import Request

@router.post("/hms/report-node/report-types/add")
async def add_report_type_endpoint(request: Request):
    payload = await request.json()

    doctor_id = payload.get("doctor_id")
    report_type = payload.get("report_type")
    mode = payload.get("mode")  # document | image

    if not doctor_id or not report_type or not mode:
        return {
            "status": "error",
            "message": "doctor_id, report_type and mode are required"
        }

    report_type = report_type.strip().lower()

    # ✅ MUST await
    exists = await report_list_collection.find_one({
        "doctor_id": doctor_id,
        "report_type": report_type,
        "mode": mode
    })

    if exists is not None:
        return {
            "status": "error",
            "message": "Report type already exists"
        }

    # ✅ MUST await
    await report_list_collection.insert_one({
        "doctor_id": doctor_id,
        "report_type": report_type,
        "mode": mode,
        "created_at": datetime.utcnow()
    })

    return {
        "status": "success",
        "message": "Report type added successfully"
    }

    
    
@router.get("/hms/report-node/report-types")
async def get_report_types_endpoint(doctor_id: str):
    cursor = report_list_collection.find(
        {"doctor_id": doctor_id},
        {"_id": 0, "report_type": 1, "mode": 1}
    )

    document_types = []
    image_types = []

    async for row in cursor:
        if row["mode"] == "document":
            document_types.append(row["report_type"])
        elif row["mode"] == "image":
            image_types.append(row["report_type"])

    return {
        "status": "success",
        "data": {
            "document_types": document_types,
            "image_types": image_types
        }
    }






# #############################


# # ABi New modification 


# # ------------------------------------------------------------
# # These enums define how confident we are about extracted data
# # ------------------------------------------------------------

# class ConfidenceLevel(str, Enum):
#     CONFIRMED = "confirmed"      # Explicitly stated in transcript
#     INFERRED = "inferred"        # Reasonable inference but not explicit
#     DOUBTFUL = "doubtful"        # Mentioned as possibility/differential


# # ------------------------------------------------------------
# # This model stores where a piece of information came from
# # and how reliable it is
# # ------------------------------------------------------------

# class SourceAttribution(BaseModel):
#     text_snippet: str = Field(description="Exact text from transcript supporting this data")
#     confidence: ConfidenceLevel
#     requires_verification: bool = False

# # ------------------------------------------------------------
# # This model represents patient vital signs
# # Every field is optional because vitals may not be mentioned
# # ------------------------------------------------------------
# class VitalSigns(BaseModel):
#     temperature: Optional[str] = None
#     temperature_route: Optional[str] = None
#     pulse: Optional[str] = None
#     blood_pressure: Optional[str] = None
#     respiratory_rate: Optional[str] = None
#     spo2: Optional[str] = None
#     weight: Optional[str] = None
#     height: Optional[str] = None
#     bmi: Optional[str] = None
#     pain_score: Optional[str] = None
#     source: Optional[SourceAttribution] = None


# # ------------------------------------------------------------
# # Represents a single lab parameter (e.g., Hemoglobin)
# # ------------------------------------------------------------
# class LabParameter(BaseModel):
#     name: str
#     value: str
#     unit: Optional[str] = None
#     reference_range: Optional[str] = None
#     status: Optional[str] = None  # high/low/normal
#     source: SourceAttribution

# # ------------------------------------------------------------
# # Represents a complete lab report (e.g., CBC panel)
# # ------------------------------------------------------------
# class LabReport(BaseModel):
#     panel_name: str  # e.g., "Complete Blood Count (CBC)"
#     parameters: List[LabParameter] = []
#     report_date: Optional[str] = None
#     lab_name: Optional[str] = None
#     source: Optional[SourceAttribution] = None


# # ------------------------------------------------------------
# # Represents findings inside an imaging report
# # ------------------------------------------------------------
# class ImagingFinding(BaseModel):
#     finding: str
#     location: Optional[str] = None
#     severity: Optional[str] = None

# # ------------------------------------------------------------
# # Represents an imaging study like CT, MRI, X-ray
# # ------------------------------------------------------------
# class ImagingStudy(BaseModel):
#     modality: str  # From taxonomy
#     study_name: str  # From taxonomy
#     findings: Union[str, List[ImagingFinding], Dict] = []
#     impression: Optional[str] = None
#     comparison: Optional[str] = None
#     report_date: Optional[str] = None
#     source: SourceAttribution


# # ------------------------------------------------------------
# # Represents a medication mentioned in the transcript
# # ------------------------------------------------------------
# class Medication(BaseModel):
#     name: str
#     dose: Optional[str] = None
#     frequency: Optional[str] = None
#     route: Optional[str] = None
#     duration: Optional[str] = None
#     indication: Optional[str] = None
#     is_new: bool = False  # True if prescribed in this visit
#     is_discontinued: bool = False
#     source: SourceAttribution

# class DiagnosisItem(BaseModel):
#     diagnosis: str
#     icd_code: Optional[str] = None
#     type: Literal["confirmed", "differential", "rule_out", "history"] = "differential"
#     certainty: Optional[str] = None
#     source: SourceAttribution

# class TreatmentPlanItem(BaseModel):
#     category: Literal["pharmacological", "procedural", "lifestyle", "referral", "investigation"]
#     description: str
#     details: Optional[Dict[str, Any]] = None
#     urgency: Optional[str] = None
#     source: SourceAttribution

# class PatientDemographics(BaseModel):
#     age: Optional[str] = None
#     sex: Optional[str] = None
#     occupation: Optional[str] = None
#     source: Optional[SourceAttribution] = None

# class PresentingComplaint(BaseModel):
#     chief_complaint: Optional[str] = None
#     onset: Optional[str] = None
#     duration: Optional[str] = None
#     severity: Optional[str] = None
#     associated_symptoms: List[str] = []
#     source: Optional[SourceAttribution] = None



# # ------------------------------------------------------------
# # This is the main container holding all extracted clinical data
# # ------------------------------------------------------------
# class ClinicalExtract(BaseModel):
#     """Main structured extraction container with full provenance"""
#     demographics: Optional[PatientDemographics] = None
#     presenting_complaint: Optional[PresentingComplaint] = None
#     vital_signs: Optional[VitalSigns] = None
#     diagnoses: List[DiagnosisItem] = []
#     medications: List[Medication] = []
#     treatment_plan: List[TreatmentPlanItem] = []
#     investigation_orders: List[TreatmentPlanItem] = []
#     follow_up: Optional[Dict[str, Any]] = None
#     red_flags: List[str] = []
#     transcript_metadata: Dict[str, Any] = {}

# class DocumentTaxonomyItem(BaseModel):
#     category_key: str
#     category_name: str
#     subcategory_key: str
#     subcategory_name: str
#     test_name: str
#     report_content: Dict[str, Any]
#     report_date: Optional[str] = None
#     source_text: str  # Provenance

# class ExtractedDataContainer(BaseModel):
#     clinical_data: ClinicalExtract
#     documents: List[DocumentTaxonomyItem] = []  # Labs, Imaging, etc mapped to taxonomy
#     discarded_items: List[Dict[str, Any]] = []  # Items that failed validation

# # ==============================================================================
# # 2. LANGGRAPH STATE DEFINITION
# # ==============================================================================


# # ------------------------------------------------------------
# # GraphState tracks the workflow state across all nodes
# # ------------------------------------------------------------
# class GraphState(TypedDict):
#     # Input
#     transcript: str
#     specialty: Optional[str]
#     consultation_type: Optional[str]
#     patient_id: Optional[str]
#     doctor_id: Optional[str]
#     input_type: Optional[Literal["conversation", "dictation"]]
    
#     # Processing
#     extraction_attempts: Annotated[int, operator.add]
#     validated_extraction: Optional[ExtractedDataContainer]
#     error_logs: Annotated[List[str], operator.add]
    
#     # Output
#     api_payloads: Dict[str, Any]  # Prepared payloads for different endpoints
#     save_responses: List[Dict]
#     final_status: str

# # ==============================================================================
# # 3. COMPREHENSIVE DOCUMENT TAXONOMY (From Your Specification)
# # ==============================================================================

# # ------------------------------------------------------------
# # This dictionary defines ALL allowed lab, imaging, and test names
# # Used to standardize extracted documents
# # ------------------------------------------------------------
# DOCUMENT_CATEGORIES = {
#     "laboratory": {
#         "name": "Laboratory & Pathology Reports",
#         "panels": {
#             "routine_lab": ["Complete Blood Count (CBC)", "Liver Function Test (LFT) - Complete", 
#                           "Serum Electrolytes Panel (Na, K, Cl, HCO3)", "Lipid Profile - Complete"],
#             "renal": ["Blood Urea Nitrogen (BUN)", "Serum Creatinine", "Estimated Glomerular Filtration Rate (eGFR)"],
#             "cardiac": ["Troponin I", "Troponin T", "Creatine Kinase-MB (CK-MB)", "B-Type Natriuretic Peptide (BNP)"],
#             "diabetes": ["Hemoglobin A1c (HbA1c)", "Fasting Plasma Glucose", "C-Peptide"],
#             "thyroid": ["Thyroid Stimulating Hormone (TSH)", "Free T4", "Free T3"],
#             "hematology": ["Ferritin", "Serum Iron", "Prothrombin Time (PT)", "International Normalized Ratio (INR)"],
#             "infectious": ["COVID-19 RT-PCR", "HIV 1/2 Antibody", "Hepatitis B Surface Antigen (HBsAg)"]
#         }
#     },
#     "imaging": {
#         "name": "Imaging & Radiology Reports",
#         "modalities": {
#             "xray": ["Chest X-ray (PA View)", "Chest X-ray (Lateral View)", "X-ray KUB"],
#             "ct_scan": ["CT Brain (Plain)", "CT Brain (Contrast)", "CT Abdomen (Plain)", "CT Abdomen (Contrast)", 
#                        "CT Chest (Contrast)", "CT KUB (Non-Contrast)"],
#             "mri": ["MRI Brain (Plain)", "MRI Brain (Contrast)", "MRI Spine (Lumbar)", "MR Cholangiopancreatography (MRCP)"],
#             "ultrasound": ["Ultrasound Abdomen (Whole)", "Ultrasound Pelvis", "Ultrasound KUB"],
#             "doppler": ["Color Doppler Lower Limb Arteries", "Carotid Doppler"],
#             "cardiac_imaging": ["Echocardiography (2D Echo)", "Stress Echocardiography"]
#         }
#     },
#     "functional": {
#         "name": "Functional & Special Tests",
#         "tests": {
#             "pulmonary": ["Spirometry (Complete)", "Six Minute Walk Test (6MWT)"],
#             "cardiac": ["Electrocardiogram (ECG) - Resting", "Stress ECG (Treadmill Test - TMT)"],
#             "neurophysiology": ["Electroencephalogram (EEG)", "Nerve Conduction Study (NCS)"],
#             "endoscopy": ["Upper GI Endoscopy (EGD)", "Colonoscopy", "Bronchoscopy"]
#         }
#     },
#     "pathology": {
#         "name": "Histopathology & Cytology",
#         "tests": ["Histopathological Examination (HPE)", "Fine Needle Aspiration Cytology (FNAC)", 
#                  "Core Needle Biopsy", "Immunohistochemistry (IHC)"]
#     }
# }

# # Flattened lookup for validation

# # ------------------------------------------------------------
# # This creates a flattened set of all allowed test names
# # Used for validation and matching
# # ------------------------------------------------------------
# TAXONOMY_TEST_NAMES = set()

# for cat in DOCUMENT_CATEGORIES.values():

#     # panels → always dict[str, list]
#     panels = cat.get("panels", {})
#     if isinstance(panels, dict):
#         for subcat in panels.values():
#             if isinstance(subcat, list):
#                 TAXONOMY_TEST_NAMES.update(subcat)

#     # modalities → always dict[str, list]
#     modalities = cat.get("modalities", {})
#     if isinstance(modalities, dict):
#         for subcat in modalities.values():
#             if isinstance(subcat, list):
#                 TAXONOMY_TEST_NAMES.update(subcat)

#     # tests → dict OR list (mixed schema)
#     tests = cat.get("tests")

#     if isinstance(tests, dict):
#         for subcat in tests.values():
#             if isinstance(subcat, list):
#                 TAXONOMY_TEST_NAMES.update(subcat)

#     elif isinstance(tests, list):
#         TAXONOMY_TEST_NAMES.update(tests)


# # ==============================================================================
# # 4. LANGGRAPH NODE IMPLEMENTATIONS
# # ==============================================================================

# # ------------------------------------------------------------
# # This class contains all LangGraph nodes
# # Each method is one step in the workflow
# # ------------------------------------------------------------
# class ClinicalExtractionAgent:
#     def __init__(self, groq_api_key: str):
#         self.groq_client = Groq(api_key=groq_api_key)

#     def completion(self, prompt: str) -> str:
#         completion = self.groq_client.chat.completions.create(
#             model="llama-3.1-8b-instant",
#             messages=[{"role": "user", "content": prompt}],
#             temperature=0.1,
#             max_tokens=4000,
#         )
#         return completion.choices[0].message.content

#     # ------------------------------------------------------------
#     # Determines whether transcript is a conversation or dictation
#     # Uses heuristic + LLM
#     # ------------------------------------------------------------
#     def classify_input_type(self, state: GraphState) -> GraphState:
#         logger.info("Node: classify_input_type | Starting input classification")
#         """Determine if this is interactive conversation or dictation"""
#         transcript = state["transcript"]
#         logger.info(
#         "Transcript length=%d characters",
#         len(transcript)
#         )
        
#         # Simple heuristic + LLM confirmation
#         has_questions = any(phrase in transcript.lower() for phrase in 
#                           ["how are you", "do you have", "when did", "where is", "can you"])
#         logger.info("Heuristic question detection result: %s", has_questions)
        
#         prompt = f"""Analyze if this medical transcript is:
#         1. "conversation" - Interactive Q&A between doctor and patient with questions
#         2. "dictation" - Doctor monologue/dictation describing findings
        
#         Transcript excerpt: {transcript[:500]}...
        
#         Return ONLY: {{"type": "conversation" or "dictation", "reason": "brief explanation"}}"""
        
#         try:
#             llm_output = self.completion(prompt)
#             result = json.loads(llm_output)
#             input_type = result.get("type", "dictation")

#             logger.info(
#             "LLM classified input_type=%s | reason=%s",
#             input_type,
#             result.get("reason")
#             )
#         except:
#             input_type = "conversation" if has_questions else "dictation"
#             logger.info(
#             "Heuristic classified input_type=%s | reason=%s",
#             input_type,
#             "heuristic question detection" if has_questions else "no questions detected"
#         )
            
#         return {**state, "input_type": input_type}
    

#     # ------------------------------------------------------------
#     # Uses LLM + Pydantic to extract structured clinical data
#     # Fails safely if parsing errors occur
#     # ------------------------------------------------------------
#     def extract_structured_clinical(self, state: GraphState) -> GraphState:
#         if state.get("extraction_attempts", 0) >= 2:
#             logger.error("Extraction failed too many times, aborting workflow")
#             return {**state, "final_status": "failed"}

#         logger.info("Node: extract_structured_clinical | Starting extraction")
#         """Primary extraction node using Pydantic structured output"""
#         transcript = state["transcript"]
#         specialty = state.get("specialty", "general")
#         logger.info(
#         "Extraction context | specialty=%s | input_type=%s",
#         specialty,
#         state.get("input_type")
#     )

        
#         # Create parser for structured output
#         parser = PydanticOutputParser(pydantic_object=ClinicalExtract)
        
#         extraction_prompt = f"""You are a clinical data extraction AI. Extract ALL clinical information from this 
#         {state['input_type']} transcript. 
        
#         Rules:
#         1. EXTRACT ONLY what is explicitly stated in the transcript
#         2. For every piece of data, include the exact text snippet that supports it
#         3. Mark confidence as "confirmed" only if explicitly stated, "doubtful" if mentioned as possibility
#         4. For medications, extract exact doses, frequencies, routes if mentioned
#         5. For vitals, extract exact values with units
#         6. If information is not present, omit the field entirely (don't use null)
#         7. For labs/imaging mentioned, extract details but we'll process them separately
        
#         Format: {parser.get_format_instructions()}
        
#         Transcript:
#         {transcript}
#         """
        
#         try:
#             llm_output = self.completion(extraction_prompt)
#             parsed = parser.parse(llm_output)

#             logger.info(
#             "Parsed ClinicalExtract | diagnoses=%d | medications=%d | plans=%d",
#             len(parsed.diagnoses),
#             len(parsed.medications),
#             len(parsed.treatment_plan),
#             )
            
#             # Create container
#             container = ExtractedDataContainer(
#                 clinical_data=parsed,
#                 documents=[],
#                 discarded_items=[]
#             )
#             logger.info("Structured extraction validated and stored")
#             return {**state, "validated_extraction": container}
            
#         except Exception as e:
#             logger.error(
#                 "Clinical extraction failed | attempt=%s | error=%s",
#                 state.get("extraction_attempts", 0) + 1,
#                 str(e)
#             )
#             return {
#                 **state,
#                 "error_logs": state.get("error_logs", []) + [f"Extraction failed: {str(e)}"],
#                 "extraction_attempts": state.get("extraction_attempts", 0) + 1
#             }

#     # ------------------------------------------------------------
#     # Extracts lab/imaging documents from transcript
#     # Maps them to standardized taxonomy
#     # ------------------------------------------------------------
#     def identify_and_classify_documents(self, state: GraphState) -> GraphState:
#         logger.info("Node: identify_and_classify_documents | Starting")
#         if not state.get("validated_extraction"):
#             logger.info("No validated extraction found, skipping document classification")
#             return state

#         """Separate labs/imaging from clinical narrative and map to taxonomy"""
#         if not state.get("validated_extraction"):
#             logger.info("No validated extraction found, skipping document classification")
#             return state
            
#         transcript = state["transcript"]
#         container = state["validated_extraction"]
#         logger.info("Running document detection on transcript")
#         document_prompt = f"""Analyze this medical transcript and identify ALL discrete medical documents mentioned:
#         - Laboratory reports (CBC, LFT, RFT, Lipid profile, etc.)
#         - Imaging studies (X-ray, CT, MRI, Ultrasound)
#         - Pathology reports
#         - Functional tests (ECG, Spirometry, etc.)
        
#         For each document found:
#         1. Identify the EXACT test name from this allowed list: {list(TAXONOMY_TEST_NAMES)}
#         2. If exact match not found, use the closest standard medical term
#         3. Extract the specific values/findings
#         4. Note the report date if mentioned
#         5. Include the exact text describing the results
        
#         Return JSON list:
#         [
#           {{
#             "test_name": "exact name from taxonomy",
#             "category_key": "laboratory/imaging/functional/pathology",
#             "values": {{param: value}} or findings text,
#             "date": "YYYY-MM-DD or null",
#             "source_text": "exact quote from transcript"
#           }}
#         ]
        
#         Transcript: {transcript}
#         IMPORTANT:
#         - If NO documents are mentioned, return an EMPTY JSON ARRAY: []
#         - DO NOT explain anything
#         - DO NOT include markdown
#         - DO NOT include text outside JSON
#         - Output MUST be valid JSON only
#         """
        
#         try:
#             llm_output = self.completion(document_prompt).strip()

# # SAFE JSON PARSING
#             try:
#                 docs_data = json.loads(llm_output)
#             except json.JSONDecodeError:
#                 logger.info("No valid document JSON returned by LLM")
#                 docs_data = []

#             logger.info("Documents detected: %d", len(docs_data))
            
#             documents = []
#             for doc in docs_data:
#                 # Map to taxonomy structure
#                 taxonomy_item = self._map_to_taxonomy(doc)
#                 if taxonomy_item:
#                     documents.append(taxonomy_item)
            
#             # Update container
#             container.documents = documents
#             logger.info("Document classification completed successfully")
#             return {**state, "validated_extraction": container}
            
#         except Exception as e:
#             logger.error("Document classification failed | error=%s", str(e))
#             return {
#                 **state,
#                 "error_logs": state.get("error_logs", []) + [f"Document classification failed: {str(e)}"]
#             }
    
#     def _map_to_taxonomy(self, doc_data: Dict) -> Optional[DocumentTaxonomyItem]:
#         """Map extracted document to standardized taxonomy"""
#         test_name = doc_data.get("test_name", "")
        
#         # Find matching category/subcategory
#         category_key = doc_data.get("category_key", "laboratory")
        
#         # Determine specific category details
#         cat_info = DOCUMENT_CATEGORIES.get(category_key, {})
        
#         # Find subcategory
#         subcategory_key = "general"
#         subcategory_name = "General"
        
#         if category_key == "laboratory":
#             for subcat, tests in cat_info.get("panels", {}).items():
#                 if test_name in tests:
#                     subcategory_key = subcat
#                     subcategory_name = subcat.replace("_", " ").title()
#                     break
#         elif category_key == "imaging":
#             for mod, tests in cat_info.get("modalities", {}).items():
#                 if test_name in tests:
#                     subcategory_key = mod
#                     subcategory_name = mod.replace("_", " ").title()
#                     break
        
#         return DocumentTaxonomyItem(
#             category_key=category_key,
#             category_name=cat_info.get("name", category_key),
#             subcategory_key=subcategory_key,
#             subcategory_name=subcategory_name,
#             test_name=test_name,
#             report_content=doc_data.get("values", {}),
#             report_date=doc_data.get("date"),
#             source_text=doc_data.get("source_text", "")
#         )

#     # ------------------------------------------------------------
#     # Hallucination check:
#     # Verifies extracted data actually exists in transcript
#     # Discards anything suspicious
#     # ------------------------------------------------------------
    
#     def verify_against_source(self, state: GraphState) -> GraphState:
#         logger.info("Node: verify_against_source | Starting verification")

#         """Hallucination check: Verify extracted data against source transcript"""
#         if not state.get("validated_extraction"):
#             logger.info("No extraction present, skipping verification")
#             return state
            
#         container = state["validated_extraction"]
#         transcript = state["transcript"].lower()
        
#         verified_docs = []
#         discarded = []
        
#         for doc in container.documents:
#             # Check if source text actually exists in transcript
#             source_snippet = doc.source_text.lower()
#             if source_snippet in transcript or any(word in transcript for word in source_snippet.split()[:5]):
#                 verified_docs.append(doc)
#             else:
#                 discarded.append({
#                     "item": doc.dict(),
#                     "reason": "Source text not found in transcript - possible hallucination"
#                 })
#                 logger.info(
#                 "Discarded document due to missing source | test_name=%s",
#                 doc.test_name
#                 )
#         logger.info(
#         "Verification results | verified_docs=%d | discarded_docs=%d",
#         len(verified_docs),
#         len(discarded)
#         )
        
#         # Verify clinical data items similarly
#         clinical = container.clinical_data
        
#         # Check medications
#         verified_meds = []
#         for med in clinical.medications:
#             if med.name.lower() in transcript:
#                 verified_meds.append(med)
#             else:
#                 discarded.append({"medication": med.name, "reason": "Not found in source"})
        
#         clinical.medications = verified_meds
#         container.documents = verified_docs
#         container.discarded_items.extend(discarded)
        
#         return {**state, "validated_extraction": container}
    

#     # ------------------------------------------------------------
#     # Converts extracted data into payloads for:
#     # 1. Main storage API
#     # 2. Feature-level context API
#     # 3. Clinical summary API
#     # ------------------------------------------------------------
#     def prepare_api_payloads(self, state: GraphState) -> GraphState:
#         logger.info("Node: prepare_api_payloads | Preparing API payloads")
#         """Structure data for the three specific endpoints mentioned"""
#         if not state.get("validated_extraction"):
#             logger.info("No validated extraction, skipping payload preparation")
#             return state
            
#         container = state["validated_extraction"]
#         logger.info(
#         "Payload summary | documents=%d | medications=%d | diagnoses=%d",
#         len(container.documents),
#         len(container.clinical_data.medications),
#         len(container.clinical_data.diagnoses),
#         )

#         logger.info("API payloads constructed successfully")
#         patient_id = state.get("patient_id")
#         doctor_id = state.get("doctor_id")
#         input_type = state.get("input_type", "dictation")
        
#         # Payload 1: Main storage (save_conversation_user or save_dictation)
#         processed_data = [{
#             "source": "langgraph_extraction",
#             "content": container.clinical_data.dict(),
#             "documents": [doc.dict() for doc in container.documents],
#             "discarded": container.discarded_items,
#             "timestamp": datetime.now().isoformat()
#         }]
        
#         raw_data = [{
#             "source": "transcript",
#             "content": state["transcript"]
#         }]
        
#         main_payload = {
#             "patient_id": patient_id,
#             "doctor_id": doctor_id,
#             "processed_data": processed_data,
#             "raw_data": raw_data,
#         }
        
#         # Payload 2: Feature context LLM (individual test documents)
#         feature_payloads = []
#         for doc in container.documents:
#             feature_payload = {
#                 "patient_id": patient_id,
#                 "doctor_id": doctor_id,
#                 "feature_id": doc.test_name,
#                 "new_data": {
#                     "timestamp": doc.report_date or datetime.now().isoformat(),
#                     "data": doc.report_content,
#                     "category": doc.category_key,
#                     "source_text": doc.source_text,
#                     "confidence": "confirmed"
#                 }
#             }
#             feature_payloads.append(feature_payload)
        
#         # Payload 3: Clinical summary for context generation
#         clinical_context = {
#             "patient_id": patient_id,
#             "vitals": container.clinical_data.vital_signs.dict() if container.clinical_data.vital_signs else {},
#             "active_medications": [m.dict() for m in container.clinical_data.medications if not m.is_discontinued],
#             "diagnoses": [d.dict() for d in container.clinical_data.diagnoses],
#             "investigation_orders": [i.dict() for i in container.clinical_data.investigation_orders],
#             "timestamp": datetime.now().isoformat()
#         }
        
#         api_payloads = {
#             "main_storage": {
#                 "payload": main_payload,
#                 "endpoint": ("https://demo.doctorassist.ai/api/hms/users/data/context/save_conversation_user"
#                            if input_type == "conversation" 
#                            else "https://demo.doctorassist.ai/api/hms/users/data/context/save_dictation"),
#                 "type": input_type
#             },
#             "feature_context": {
#                 "payloads": feature_payloads,
#                 "endpoint": "https://demo.doctorassist.ai/api/hms/users/data/context/process_feature_context_llm"
#             },
#             "clinical_summary": clinical_context
#         }
        
#         return {**state, "api_payloads": api_payloads}
    
#     # ------------------------------------------------------------
#     # Sends prepared payloads to backend APIs
#     # Handles failures gracefully
#     # ------------------------------------------------------------
#     def save_to_endpoints(self, state: GraphState) -> GraphState:
#         logger.info("Node: save_to_endpoints | Saving data to APIs")
#         """Execute API calls to save data"""
#         payloads = state.get("api_payloads", {})
#         responses = []
#         logger.info("Saving main transcript data to HMS")

        
#         # Save main transcript data
#         main_config = payloads.get("main_storage", {})
#         if main_config:
#             try:
#                 resp = requests.post(
#                     main_config["endpoint"],
#                     json=main_config["payload"],
#                     timeout=30
#                 )
#                 resp.raise_for_status()
#                 responses.append({
#                     "endpoint": "main_storage",
#                     "status": "success",
#                     "id": resp.json().get("data", {}).get("id"),
#                     "type": main_config.get("type")
#                 })
#             except Exception as e:
#                 responses.append({
#                     "endpoint": "main_storage",
#                     "status": "failed",
#                     "error": str(e)
#                 })
        
#         # Save individual feature contexts (fire and forget with logging)
#         feature_config = payloads.get("feature_context", {})
#         for payload in feature_config.get("payloads", []):
#             try:
#                 resp = requests.post(
#                     feature_config["endpoint"],
#                     json=payload,
#                     timeout=10
#                 )
#                 responses.append({
#                     "endpoint": "feature_context",
#                     "feature_id": payload["feature_id"],
#                     "status": "success" if resp.status_code == 200 else "failed"
#                 })
#             except Exception as e:
#                 logger.error(f"Feature context save failed for {payload['feature_id']}: {e}")
#         logger.info(
#         "API save completed | total_calls=%d",
#         len(responses)
#         )
#         return {**state, "save_responses": responses, "final_status": "completed"}

# class ClinicalTranscriptRequest(BaseModel):
#     transcript: str = Field(..., min_length=1, description="Doctor-patient consultation transcript")
#     specialty: Optional[str] = Field(None, description="Medical specialty, e.g. cardiology")
#     consultation_type: Optional[str] = Field(None, description="initial, follow_up, urgent")
#     patient_id: Optional[str] = Field(None, description="Patient identifier")
#     doctor_id: Optional[str] = Field(None, description="Doctor identifier")
#     type_of_conversation: Optional[str] = Field(None, description="e.g. in-person, telemedicine")


# class ClinicalTranscriptResponse(BaseModel):
#     success: bool
#     data: Optional[Dict[str, Any]] = None
#     raw_llm_output: Optional[str] = None
#     error: Optional[str] = None
#     metadata: Optional[Dict[str, Any]] = None


# # ------------------------------------------------------------
# # API endpoint that receives transcript and runs the workflow
# # ------------------------------------------------------------
# @router.post(
#     "/analyze-transcript/",
#     response_model=ClinicalTranscriptResponse,
#     status_code=status.HTTP_200_OK,
# )
# def analyze_transcript_endpoint(
#     payload: ClinicalTranscriptRequest,
# ):
#     """
#     Analyze a clinical consultation transcript and extract comprehensive structured data.
#     """
#     try:
#         result = analyze_clinical_transcript(
#             transcript=payload.transcript,
#             specialty=payload.specialty,
#             consultation_type=payload.consultation_type,
#             patient_id=payload.patient_id,
#             doctor_id=payload.doctor_id,
#             type_of_conversation=payload.type_of_conversation,
#         )
#         logger.info("Clinical transcript analysis result: %s", result)
#         if not result.get("success"):
#             raise HTTPException(
#                 status_code=status.HTTP_400_BAD_REQUEST,
#                 detail=result.get("error", "Clinical analysis failed"),
#             )

#         return result

#     except HTTPException:
#         raise

#     except Exception as e:
#         raise HTTPException(
#             status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
#             detail=f"Unexpected server error: {str(e)}",
#         )






# # ==============================================================================
# # 5. GRAPH CONSTRUCTION AND WORKFLOW
# # ==============================================================================

# # ------------------------------------------------------------
# # Builds the LangGraph workflow:
# # classify → extract → classify docs → verify → prepare → save
# # ------------------------------------------------------------
# def create_clinical_workflow(groq_api_key: str):
#     """Build and compile the LangGraph workflow"""
    
#     agent = ClinicalExtractionAgent(groq_api_key)
    
#     # Define workflow graph
#     workflow = StateGraph(GraphState)
    
#     # Add nodes
#     workflow.add_node("classify_input", agent.classify_input_type)
#     workflow.add_node("extract_clinical", agent.extract_structured_clinical)
#     workflow.add_node("classify_documents", agent.identify_and_classify_documents)
#     workflow.add_node("verify_data", agent.verify_against_source)
#     workflow.add_node("prepare_payloads", agent.prepare_api_payloads)
#     workflow.add_node("save_data", agent.save_to_endpoints)
    
#     # Define edges
#     workflow.set_entry_point("classify_input")
#     workflow.add_edge("classify_input", "extract_clinical")

#     workflow.add_edge("classify_documents", "verify_data")
#     workflow.add_edge("verify_data", "prepare_payloads")
#     workflow.add_edge("prepare_payloads", "save_data")
#     workflow.add_edge("save_data", END)
#         # STOP workflow if extraction failed
#     def route_after_extraction(state: GraphState):
#         if state.get("validated_extraction") is None:
#             return END
#         return "classify_documents"

#     workflow.add_conditional_edges(
#         "extract_clinical",
#         route_after_extraction
#     )

#     # Add conditional error handling
#     def check_errors(state: GraphState):
#         if len(state.get("error_logs", [])) > 3:
#             return END
#         return "save_data"
    
#     return workflow.compile()

# # ==============================================================================
# # 6. MAIN INTERFACE FUNCTIONS (Drop-in replacements)
# # ==============================================================================
# class ClinicalTranscriptRequest(BaseModel):
#     transcript: str = Field(..., min_length=1)
#     specialty: Optional[str] = None
#     consultation_type: Optional[str] = None
#     patient_id: Optional[str] = None
#     doctor_id: Optional[str] = None
#     type_of_conversation: Optional[str] = None  # "conversation" or "dictation"

# class ClinicalTranscriptResponse(BaseModel):
#     success: bool
#     data: Optional[Dict[str, Any]] = None
#     raw_structured_data: Optional[Dict] = None
#     error: Optional[str] = None
#     metadata: Dict[str, Any] = {}
#     saved_endpoints: List[Dict] = []

# # Global workflow instance (initialize once)
# _clinical_workflow = None

# def get_workflow():
#     global _clinical_workflow
#     if _clinical_workflow is None:
#         import os
#         api_key = os.getenv("GROQ_API_KEY")
#         if not api_key:
#             raise ValueError("GROQ_API_KEY environment variable not set")
#         _clinical_workflow = create_clinical_workflow(api_key)
#     return _clinical_workflow


# # ------------------------------------------------------------
# # Entry point used by API
# # Initializes graph, executes workflow, formats response
# # ------------------------------------------------------------
# def analyze_clinical_transcript(
#     transcript: str,
#     specialty: Optional[str] = None,
#     consultation_type: Optional[str] = None,
#     patient_id: Optional[str] = None,
#     doctor_id: Optional[str] = None,
#     type_of_conversation: Optional[str] = None,
# ) -> Dict[str, Any]:
#     logger.info("Entered analyze_clinical_transcript function")
#     """
#     Agentic clinical transcript analysis using LangGraph.
#     Comprehensive extraction with hallucination resistance and taxonomy mapping.
#     """
    
#     if not transcript or not transcript.strip():
#         return {
#             "success": False,
#             "error": "Transcript is empty or invalid",
#             "data": None,
#             "metadata": None
#         }
    
#     try:
#         logger.info("About to get clinical workflow")
#         # Initialize workflow
#         workflow = get_workflow()
#          # 🔹 AFTER workflow creation
#         logger.info("Clinical workflow created successfully")

#         # 🔹 BEFORE graph execution
#         logger.info(
#             "Creating initial GraphState | patient_id=%s | doctor_id=%s",
#             patient_id,
#             doctor_id
#         )
#         # Initial state
#         initial_state = GraphState(
#             transcript=transcript,
#             specialty=specialty,
#             consultation_type=consultation_type,
#             patient_id=patient_id,
#             doctor_id=doctor_id,
#             input_type=type_of_conversation,  # Can be None, will be classified
#             extraction_attempts=0,
#             validated_extraction=None,
#             error_logs=[],
#             api_payloads={},
#             save_responses=[],
#             final_status="pending"
#         )
#          # 🔹 BEFORE workflow.invoke()
#         logger.info("Invoking workflow graph")
        
#         # Execute graph
#         final_state = workflow.invoke(initial_state)
#         # 🔹 AFTER workflow.invoke()
#         logger.info(
#             "Workflow finished | final_status=%s | attempts=%s | errors=%s",
#             final_state.get("final_status"),
#             final_state.get("extraction_attempts"),
#             final_state.get("error_logs")
#         )

#         # 🔹 CHECK extraction
#         logger.info(
#             "validated_extraction exists: %s",
#             bool(final_state.get("validated_extraction"))
#         )
#         # Prepare response
#         if final_state.get("validated_extraction"):
#             extraction = final_state["validated_extraction"]
#             response_data = {
#                 "clinical_summary": extraction.clinical_data.dict(),
#                 "classified_documents": [d.dict() for d in extraction.documents],
#                 "discarded_items": extraction.discarded_items,
#                 "input_type_detected": final_state.get("input_type")
#             }
#         else:
#             response_data = None
        
#         return {
#             "success": bool(final_state.get("validated_extraction")),
#             "data": response_data,
#             "raw_structured_data": final_state.get("validated_extraction", {}).dict() if final_state.get("validated_extraction") else None,
#             "error": final_state.get("error_logs", [])[-1] if final_state.get("error_logs") else None,
#             "metadata": {
#                 "extraction_attempts": final_state.get("extraction_attempts", 0),
#                 "conversation_type": final_state.get("input_type"),
#                 "patient_id": patient_id,
#                 "doctor_id": doctor_id
#             },
#             "saved_endpoints": final_state.get("save_responses", [])
#         }
        
#     except Exception as e:
#         logger.exception("Clinical analysis workflow failed")
#         return {
#             "success": False,
#             "error": str(e),
#             "data": None,
#             "metadata": {"timestamp": datetime.now().isoformat()}
#         }

#############################

# ABi New modification 

# ------------------------------------------------------------
# These enums define how confident we are about extracted data
# ------------------------------------------------------------

class ConfidenceLevel(str, Enum):
    CONFIRMED = "confirmed"      # Explicitly stated in transcript
    INFERRED = "inferred"        # Reasonable inference but not explicit
    DOUBTFUL = "doubtful"        # Mentioned as possibility/differential

# ------------------------------------------------------------
# This model stores where a piece of information came from
# and how reliable it is
# ------------------------------------------------------------

class SourceAttribution(BaseModel):
    text_snippet: Optional[str] = Field(
        default=None,
        description="Exact text from transcript supporting this data"
    )
    confidence: ConfidenceLevel
    requires_verification: bool = False


# ------------------------------------------------------------
# This model represents patient vital signs
# Every field is optional because vitals may not be mentioned
# ------------------------------------------------------------
class VitalSigns(BaseModel):
    temperature: Optional[str] = None
    temperature_route: Optional[str] = None
    pulse: Optional[str] = None
    blood_pressure: Optional[str] = None
    respiratory_rate: Optional[str] = None
    spo2: Optional[str] = None
    weight: Optional[str] = None
    height: Optional[str] = None
    bmi: Optional[str] = None
    pain_score: Optional[str] = None
    source: Optional[SourceAttribution] = None

# ------------------------------------------------------------
# Represents a single lab parameter (e.g., Hemoglobin)
# ------------------------------------------------------------
class LabParameter(BaseModel):
    name: str
    value: str
    unit: Optional[str] = None
    reference_range: Optional[str] = None
    status: Optional[str] = None  # high/low/normal
    source: SourceAttribution

# ------------------------------------------------------------
# Represents a complete lab report (e.g., CBC panel)
# ------------------------------------------------------------
class LabReport(BaseModel):
    panel_name: str  # e.g., "Complete Blood Count (CBC)"
    parameters: List[LabParameter] = []
    report_date: Optional[str] = None
    lab_name: Optional[str] = None
    source: Optional[SourceAttribution] = None

# ------------------------------------------------------------
# Represents findings inside an imaging report
# ------------------------------------------------------------
class ImagingFinding(BaseModel):
    finding: str
    location: Optional[str] = None
    severity: Optional[str] = None

# ------------------------------------------------------------
# Represents an imaging study like CT, MRI, X-ray
# ------------------------------------------------------------
class ImagingStudy(BaseModel):
    modality: str  # From taxonomy
    study_name: str  # From taxonomy
    findings: Union[str, List[ImagingFinding], Dict] = []
    impression: Optional[str] = None
    comparison: Optional[str] = None
    report_date: Optional[str] = None
    source: SourceAttribution

# ------------------------------------------------------------
# Represents a medication mentioned in the transcript
# ------------------------------------------------------------
class Medication(BaseModel):
    name: str
    dose: Optional[str] = None
    frequency: Optional[str] = None
    route: Optional[str] = None
    duration: Optional[str] = None
    indication: Optional[str] = None
    is_new: bool = False  # True if prescribed in this visit
    is_discontinued: bool = False
    source: SourceAttribution

class DiagnosisItem(BaseModel):
    diagnosis: Optional[str] = None
    icd_code: Optional[str] = None
    type: Literal["confirmed", "differential", "rule_out", "history"] = "differential"
    certainty: Optional[str] = None
    source: SourceAttribution


class TreatmentPlanItem(BaseModel):
    category: Literal["pharmacological", "procedural", "lifestyle", "referral", "investigation",   "follow_up"  ] # ✅ ADD THIS LINE]
    description: str
    details: Optional[Union[Dict[str, Any], str]] = None
    urgency: Optional[str] = None
    source: SourceAttribution

class PatientDemographics(BaseModel):
    age: Optional[str] = None
    sex: Optional[str] = None
    occupation: Optional[str] = None
    source: Optional[SourceAttribution] = None

class PresentingComplaint(BaseModel):
    chief_complaint: Optional[str] = None
    onset: Optional[str] = None
    duration: Optional[str] = None
    severity: Optional[str] = None
    associated_symptoms: List[str] = []
    source: Optional[SourceAttribution] = None


# ------------------------------------------------------------
# This is the main container holding all extracted clinical data
# ------------------------------------------------------------
class ClinicalExtract(BaseModel):
    """Main structured extraction container with full provenance"""
    demographics: Optional[PatientDemographics] = None
    presenting_complaint: Optional[PresentingComplaint] = None
    vital_signs: Optional[VitalSigns] = None
    diagnoses: List[DiagnosisItem] = []
    medications: List[Medication] = []
    treatment_plan: List[TreatmentPlanItem] = []
    investigation_orders: List[TreatmentPlanItem] = []
    follow_up: Optional[Dict[str, Any]] = None
    red_flags: List[str] = []
    transcript_metadata: Dict[str, Any] = {}

class DocumentTaxonomyItem(BaseModel):
    category_key: str
    category_name: str
    subcategory_key: str
    subcategory_name: str
    test_name: str
    report_content: Dict[str, Any]
    report_date: Optional[str] = None
    source_text: str  # Provenance

class ExtractedDataContainer(BaseModel):
    clinical_data: ClinicalExtract
    documents: List[DocumentTaxonomyItem] = []  # Labs, Imaging, etc mapped to taxonomy
    discarded_items: List[Dict[str, Any]] = []  # Items that failed validation

# ==============================================================================
# 2. LANGGRAPH STATE DEFINITION
# ==============================================================================

# ------------------------------------------------------------
# GraphState tracks the workflow state across all nodes
# ------------------------------------------------------------
class GraphState(TypedDict):
    # Input
    transcript: str
    specialty: Optional[str]
    consultation_type: Optional[str]
    patient_id: Optional[str]
    doctor_id: Optional[str]
    input_type: Optional[Literal["conversation", "dictation"]]
    
    # Processing
    extraction_attempts: Annotated[int, operator.add]
    validated_extraction: Optional[ExtractedDataContainer]
    error_logs: Annotated[List[str], operator.add]
    
    # Output
    api_payloads: Dict[str, Any]  # Prepared payloads for different endpoints
    save_responses: List[Dict]
    final_status: str

# ==============================================================================
# 3. COMPREHENSIVE DOCUMENT TAXONOMY (From Your Specification)
# ==============================================================================

# ------------------------------------------------------------
# This dictionary defines ALL allowed lab, imaging, and test names
# Used to standardize extracted documents
# ------------------------------------------------------------
DOCUMENT_CATEGORIES = {
    "laboratory": {
        "name": "Laboratory & Pathology Reports",
        "panels": {
            "routine_lab": ["Complete Blood Count (CBC)", "Liver Function Test (LFT) - Complete", 
                          "Serum Electrolytes Panel (Na, K, Cl, HCO3)", "Lipid Profile - Complete"],
            "renal": ["Blood Urea Nitrogen (BUN)", "Serum Creatinine", "Estimated Glomerular Filtration Rate (eGFR)"],
            "cardiac": ["Troponin I", "Troponin T", "Creatine Kinase-MB (CK-MB)", "B-Type Natriuretic Peptide (BNP)"],
            "diabetes": ["Hemoglobin A1c (HbA1c)", "Fasting Plasma Glucose", "C-Peptide"],
            "thyroid": ["Thyroid Stimulating Hormone (TSH)", "Free T4", "Free T3"],
            "hematology": ["Ferritin", "Serum Iron", "Prothrombin Time (PT)", "International Normalized Ratio (INR)"],
            "infectious": ["COVID-19 RT-PCR", "HIV 1/2 Antibody", "Hepatitis B Surface Antigen (HBsAg)"]
        }
    },
    "imaging": {
        "name": "Imaging & Radiology Reports",
        "modalities": {
            "xray": ["Chest X-ray (PA View)", "Chest X-ray (Lateral View)", "X-ray KUB"],
            "ct_scan": ["CT Brain (Plain)", "CT Brain (Contrast)", "CT Abdomen (Plain)", "CT Abdomen (Contrast)", 
                       "CT Chest (Contrast)", "CT KUB (Non-Contrast)"],
            "mri": ["MRI Brain (Plain)", "MRI Brain (Contrast)", "MRI Spine (Lumbar)", "MR Cholangiopancreatography (MRCP)"],
            "ultrasound": ["Ultrasound Abdomen (Whole)", "Ultrasound Pelvis", "Ultrasound KUB"],
            "doppler": ["Color Doppler Lower Limb Arteries", "Carotid Doppler"],
            "cardiac_imaging": ["Echocardiography (2D Echo)", "Stress Echocardiography"]
        }
    },
    "functional": {
        "name": "Functional & Special Tests",
        "tests": {
            "pulmonary": ["Spirometry (Complete)", "Six Minute Walk Test (6MWT)"],
            "cardiac": ["Electrocardiogram (ECG) - Resting", "Stress ECG (Treadmill Test - TMT)"],
            "neurophysiology": ["Electroencephalogram (EEG)", "Nerve Conduction Study (NCS)"],
            "endoscopy": ["Upper GI Endoscopy (EGD)", "Colonoscopy", "Bronchoscopy"]
        }
    },
    "pathology": {
        "name": "Histopathology & Cytology",
        "tests": ["Histopathological Examination (HPE)", "Fine Needle Aspiration Cytology (FNAC)", 
                 "Core Needle Biopsy", "Immunohistochemistry (IHC)"]
    }
}

# Flattened lookup for validation

# ------------------------------------------------------------
# This creates a flattened set of all allowed test names
# Used for validation and matching
# ------------------------------------------------------------
TAXONOMY_TEST_NAMES = set()

for cat in DOCUMENT_CATEGORIES.values():

    # panels → always dict[str, list]
    panels = cat.get("panels", {})
    if isinstance(panels, dict):
        for subcat in panels.values():
            if isinstance(subcat, list):
                TAXONOMY_TEST_NAMES.update(subcat)

    # modalities → always dict[str, list]
    modalities = cat.get("modalities", {})
    if isinstance(modalities, dict):
        for subcat in modalities.values():
            if isinstance(subcat, list):
                TAXONOMY_TEST_NAMES.update(subcat)

    # tests → dict OR list (mixed schema)
    tests = cat.get("tests")

    if isinstance(tests, dict):
        for subcat in tests.values():
            if isinstance(subcat, list):
                TAXONOMY_TEST_NAMES.update(subcat)

    elif isinstance(tests, list):
        TAXONOMY_TEST_NAMES.update(tests)

# ==============================================================================
# 4. LANGGRAPH NODE IMPLEMENTATIONS
# ==============================================================================

# ------------------------------------------------------------
# This class contains all LangGraph nodes
# Each method is one step in the workflow
# ------------------------------------------------------------
class ClinicalExtractionAgent:
    def __init__(self, groq_api_key: str):
        self.groq_client = Groq(api_key=groq_api_key)

        # ---------------------------------------------
    # Utility: flatten {value, source} → value
    # ---------------------------------------------
    # ---------------------------------------------
    # Utility: flatten {value, source} → value
    # ALSO converts string "null" → None
    # ---------------------------------------------
    def flatten_values(self, obj):
        if isinstance(obj, dict):
            # If dict contains "value", collapse it
            if "value" in obj and len(obj) <= 2:
                return self.flatten_values(obj["value"])
            return {k: self.flatten_values(v) for k, v in obj.items()}

        elif isinstance(obj, list):
            return [self.flatten_values(i) for i in obj]

        elif isinstance(obj, str):
            # 🔴 FIX: convert "null" (string) to None
            if obj.lower() == "null":
                return None
            return obj

        return obj
    # ------------------------------------------------------------
    # FIX: Convert ALL "null" strings to Python None (recursive)
    # ------------------------------------------------------------
    def normalize_nulls(self, obj):
        if isinstance(obj, dict):
            for key, value in obj.items():
                if isinstance(value, str) and value.lower() == "null":
                    obj[key] = None
                else:
                    self.normalize_nulls(value)

        elif isinstance(obj, list):
            for item in obj:
                self.normalize_nulls(item)

    # ------------------------------------------------------------
    # Utility: force-fix common LLM null mistakes
    # Converts "null" strings in Dict-typed fields to None
    # ------------------------------------------------------------
    def fix_null_dict_fields(self, obj):
        if isinstance(obj, dict):
            for key, value in list(obj.items()):
                # FIX: details must be dict or None, not "null"
                if key == "details" and isinstance(value, str) and value.lower() == "null":
                    obj[key] = None
                else:
                    self.fix_null_dict_fields(value)

        elif isinstance(obj, list):
            for item in obj:
                self.fix_null_dict_fields(item)

    
    def completion(self, prompt: str) -> str:
        completion = self.groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=4000,
        )
        return completion.choices[0].message.content

    # ------------------------------------------------------------
    # Determines whether transcript is a conversation or dictation
    # Uses heuristic + LLM
    # ------------------------------------------------------------
    def classify_input_type(self, state: GraphState) -> GraphState:
        logger.info("Node: classify_input_type | Starting input classification")
        """Determine if this is interactive conversation or dictation"""
        transcript = state["transcript"]
        logger.info(
        "Transcript length=%d characters",
        len(transcript)
        )
        
        # Simple heuristic + LLM confirmation
        has_questions = any(phrase in transcript.lower() for phrase in 
                          ["how are you", "do you have", "when did", "where is", "can you"])
        logger.info("Heuristic question detection result: %s", has_questions)
        
        prompt = f"""Analyze if this medical transcript is:
        1. "conversation" - Interactive Q&A between doctor and patient with questions
        2. "dictation" - Doctor monologue/dictation describing findings
        
        Transcript excerpt: {transcript[:500]}...
        
        Return ONLY: {{"type": "conversation" or "dictation", "reason": "brief explanation"}}"""
        
        try:
            llm_output = self.completion(prompt)
            result = json.loads(llm_output)
            input_type = result.get("type", "dictation")

            logger.info(
            "LLM classified input_type=%s | reason=%s",
            input_type,
            result.get("reason")
            )
        except:
            input_type = "conversation" if has_questions else "dictation"
            logger.info(
            "Heuristic classified input_type=%s | reason=%s",
            input_type,
            "heuristic question detection" if has_questions else "no questions detected"
        )
            
        return {**state, "input_type": input_type}
    

    # ------------------------------------------------------------
    # Uses LLM + Pydantic to extract structured clinical data
    # Fails safely if parsing errors occur
    # ------------------------------------------------------------
    def extract_structured_clinical(self, state: GraphState) -> GraphState:
        if state.get("extraction_attempts", 0) >= 2:
            logger.error("Extraction failed too many times, aborting workflow")
            return {**state, "final_status": "failed"}

        logger.info("Node: extract_structured_clinical | Starting extraction")
        """Primary extraction node using Pydantic structured output"""
        transcript = state["transcript"]
        specialty = state.get("specialty", "general")
        logger.info(
            "Extraction context | specialty=%s | input_type=%s",
            specialty,
            state.get("input_type")
        )

        
        # Create parser for structured output
        parser = PydanticOutputParser(pydantic_object=ClinicalExtract)
        
        extraction_prompt = f"""You are a clinical data extraction AI. Extract ALL clinical information from this 
        {state['input_type']} transcript. 
        
        Rules:
        1. EXTRACT ONLY what is explicitly stated in the transcript
        2. For every piece of data, include the exact text snippet that supports it
        3. Mark confidence as "confirmed" only if explicitly stated, "doubtful" if mentioned as possibility
        4. For medications, extract exact doses, frequencies, routes if mentioned
        5. For vitals, extract exact values with units
        6. If information is not present, omit the field entirely (don't use null)
        7. For labs/imaging mentioned, extract details but we'll process them separately
        
        Format: {parser.get_format_instructions()}
        
        Transcript:
        {transcript}
        """
        
        try:
            llm_output = self.completion(extraction_prompt)

            # Try strict JSON first
            try:
                raw_json = json.loads(llm_output)

            except json.JSONDecodeError:
                # Fallback: extract JSON manually (NO validation yet)
                json_start = llm_output.find("{")
                json_end = llm_output.rfind("}") + 1

                if json_start == -1 or json_end == -1:
                    raise ValueError("LLM output does not contain valid JSON")

                raw_json = json.loads(llm_output[json_start:json_end])


            # ✅ Sanitize "null" strings → None
            sanitized = self.flatten_values(raw_json)

            self.fix_null_dict_fields(sanitized)

            # ✅ REMOVE None VALUES FROM red_flags
            if "red_flags" in sanitized and isinstance(sanitized["red_flags"], list):
                sanitized["red_flags"] = [
                    rf for rf in sanitized["red_flags"] if isinstance(rf, str)
                ]

            # ✅ FIX: Remove "unknown" values from vital signs
            if "vital_signs" in sanitized and sanitized["vital_signs"] is not None:
                vital_signs = sanitized["vital_signs"]
                
                # Define placeholder values to remove
                placeholders = ["unknown", "null", "none", "not specified", "not available", ""]
                
                # Remove any fields with placeholder values
                cleaned_vitals = {}
                for key, value in vital_signs.items():
                    if key == "source":
                        # Keep source attribution
                        cleaned_vitals[key] = value
                    elif value is not None and isinstance(value, str) and value.lower() not in placeholders:
                        cleaned_vitals[key] = value
                    elif value is not None and not isinstance(value, str):
                        # Keep non-string values (like numbers, booleans)
                        cleaned_vitals[key] = value
                
                # If after cleaning, we have only "source" or nothing, set vital_signs to None
                if len(cleaned_vitals) <= 1 and "source" in cleaned_vitals:
                    # Check if the source text actually indicates vitals were mentioned
                    source_text = cleaned_vitals.get("source", {}).get("text_snippet", "").lower()
                    vital_keywords = ["temperature", "pulse", "bp", "blood pressure", "heart rate", 
                                    "respiratory rate", "spo2", "oxygen saturation", "weight", "height", "bmi"]
                    
                    # If source doesn't mention any actual vital signs, set to None
                    if not any(keyword in source_text for keyword in vital_keywords):
                        sanitized["vital_signs"] = None
                    else:
                        # Keep the source attribution if vitals were actually mentioned
                        sanitized["vital_signs"] = cleaned_vitals
                elif not cleaned_vitals:
                    sanitized["vital_signs"] = None

            parsed = ClinicalExtract.model_validate(sanitized)


            logger.info(
                "Parsed ClinicalExtract | diagnoses=%d | medications=%d | plans=%d",
                len(parsed.diagnoses),
                len(parsed.medications),
                len(parsed.treatment_plan),
            )
            
            # Create container
            container = ExtractedDataContainer(
                clinical_data=parsed,
                documents=[],
                discarded_items=[]
            )
            logger.info("Structured extraction validated and stored")
            return {**state, "validated_extraction": container}
            
        except Exception as e:
            logger.error(
                "Clinical extraction failed | attempt=%s | error=%s",
                state.get("extraction_attempts", 0) + 1,
                str(e)
            )
            return {
                **state,
                "error_logs": state.get("error_logs", []) + [f"Extraction failed: {str(e)}"],
                "extraction_attempts": state.get("extraction_attempts", 0) + 1
            }
    # def extract_structured_clinical(self, state: GraphState) -> GraphState:
    #     if state.get("extraction_attempts", 0) >= 2:
    #         logger.error("Extraction failed too many times, aborting workflow")
    #         return {**state, "final_status": "failed"}

    #     logger.info("Node: extract_structured_clinical | Starting extraction")
    #     """Primary extraction node using Pydantic structured output"""
    #     transcript = state["transcript"]
    #     specialty = state.get("specialty", "general")
    #     logger.info(
    #     "Extraction context | specialty=%s | input_type=%s",
    #     specialty,
    #     state.get("input_type")
    # )

        
    #     # Create parser for structured output
    #     parser = PydanticOutputParser(pydantic_object=ClinicalExtract)
        
    #     extraction_prompt = f"""You are a clinical data extraction AI. Extract ALL clinical information from this 
    #     {state['input_type']} transcript. 
        
    #     Rules:
    #     1. EXTRACT ONLY what is explicitly stated in the transcript
    #     2. For every piece of data, include the exact text snippet that supports it
    #     3. Mark confidence as "confirmed" only if explicitly stated, "doubtful" if mentioned as possibility
    #     4. For medications, extract exact doses, frequencies, routes if mentioned
    #     5. For vitals, extract exact values with units
    #     6. If information is not present, omit the field entirely (don't use null)
    #     7. For labs/imaging mentioned, extract details but we'll process them separately
        
    #     Format: {parser.get_format_instructions()}
        
    #     Transcript:
    #     {transcript}
    #     """
        
    #     try:
    #         llm_output = self.completion(extraction_prompt)

    #         # Try strict JSON first
    #         try:
    #             raw_json = json.loads(llm_output)

    #         except json.JSONDecodeError:
    #             # Fallback: extract JSON manually (NO validation yet)
    #             json_start = llm_output.find("{")
    #             json_end = llm_output.rfind("}") + 1

    #             if json_start == -1 or json_end == -1:
    #                 raise ValueError("LLM output does not contain valid JSON")

    #             raw_json = json.loads(llm_output[json_start:json_end])


    #         # ✅ Sanitize "null" strings → None
    #         sanitized = self.flatten_values(raw_json)

    #         self.fix_null_dict_fields(sanitized)

    #         # ✅ REMOVE None VALUES FROM red_flags
    #         if "red_flags" in sanitized and isinstance(sanitized["red_flags"], list):
    #             sanitized["red_flags"] = [
    #                 rf for rf in sanitized["red_flags"] if isinstance(rf, str)
    #             ]

    #         parsed = ClinicalExtract.model_validate(sanitized)


    #         logger.info(
    #         "Parsed ClinicalExtract | diagnoses=%d | medications=%d | plans=%d",
    #         len(parsed.diagnoses),
    #         len(parsed.medications),
    #         len(parsed.treatment_plan),
    #         )
            
    #         # Create container
    #         container = ExtractedDataContainer(
    #             clinical_data=parsed,
    #             documents=[],
    #             discarded_items=[]
    #         )
    #         logger.info("Structured extraction validated and stored")
    #         return {**state, "validated_extraction": container}
            
    #     except Exception as e:
    #         logger.error(
    #             "Clinical extraction failed | attempt=%s | error=%s",
    #             state.get("extraction_attempts", 0) + 1,
    #             str(e)
    #         )
    #         return {
    #             **state,
    #             "error_logs": state.get("error_logs", []) + [f"Extraction failed: {str(e)}"],
    #             "extraction_attempts": state.get("extraction_attempts", 0) + 1
    #         }

    # ------------------------------------------------------------
    # Extracts lab/imaging documents from transcript
    # Maps them to standardized taxonomy
    # ------------------------------------------------------------
    def identify_and_classify_documents(self, state: GraphState) -> GraphState:
        logger.info("Node: identify_and_classify_documents | Starting")
        if not state.get("validated_extraction"):
            logger.info("No validated extraction found, skipping document classification")
            return state

        """Separate labs/imaging from clinical narrative and map to taxonomy"""
        if not state.get("validated_extraction"):
            logger.info("No validated extraction found, skipping document classification")
            return state
            
        transcript = state["transcript"]
        container = state["validated_extraction"]
        logger.info("Running document detection on transcript")
        document_prompt = f"""Analyze this medical transcript and identify ALL discrete medical documents mentioned:
        - Laboratory reports (CBC, LFT, RFT, Lipid profile, etc.)
        - Imaging studies (X-ray, CT, MRI, Ultrasound)
        - Pathology reports
        - Functional tests (ECG, Spirometry, etc.)
        
        For each document found:
        1. Identify the EXACT test name from this allowed list: {list(TAXONOMY_TEST_NAMES)}
        2. If exact match not found, use the closest standard medical term
        3. Extract the specific values/findings
        4. Note the report date if mentioned
        5. Include the exact text describing the results
        
        Return JSON list:
        [
          {{
            "test_name": "exact name from taxonomy",
            "category_key": "laboratory/imaging/functional/pathology",
            "values": {{param: value}} or findings text,
            "date": "YYYY-MM-DD or null",
            "source_text": "exact quote from transcript"
          }}
        ]
        
        Transcript: {transcript}
        IMPORTANT:
        - If NO documents are mentioned, return an EMPTY JSON ARRAY: []
        - DO NOT explain anything
        - DO NOT include markdown
        - DO NOT include text outside JSON
        - Output MUST be valid JSON only
        """
        
        try:
            llm_output = self.completion(document_prompt).strip()

# SAFE JSON PARSING
            try:
                docs_data = json.loads(llm_output)
            except json.JSONDecodeError:
                logger.info("No valid document JSON returned by LLM")
                docs_data = []

            logger.info("Documents detected: %d", len(docs_data))
            
            documents = []
            for doc in docs_data:
                # Map to taxonomy structure
                taxonomy_item = self._map_to_taxonomy(doc)
                if taxonomy_item:
                    documents.append(taxonomy_item)
            
            # Update container
            container.documents = documents
            logger.info("Document classification completed successfully")
            return {**state, "validated_extraction": container}
            
        except Exception as e:
            logger.error("Document classification failed | error=%s", str(e))
            return {
                **state,
                "error_logs": state.get("error_logs", []) + [f"Document classification failed: {str(e)}"]
            }
    
    def _map_to_taxonomy(self, doc_data: Dict) -> Optional[DocumentTaxonomyItem]:
        """Map extracted document to standardized taxonomy"""
        test_name = doc_data.get("test_name", "")
        
        # Find matching category/subcategory
        category_key = doc_data.get("category_key", "laboratory")
        
        # Determine specific category details
        cat_info = DOCUMENT_CATEGORIES.get(category_key, {})
        
        # Find subcategory
        subcategory_key = "general"
        subcategory_name = "General"
        
        if category_key == "laboratory":
            for subcat, tests in cat_info.get("panels", {}).items():
                if test_name in tests:
                    subcategory_key = subcat
                    subcategory_name = subcat.replace("_", " ").title()
                    break
        elif category_key == "imaging":
            for mod, tests in cat_info.get("modalities", {}).items():
                if test_name in tests:
                    subcategory_key = mod
                    subcategory_name = mod.replace("_", " ").title()
                    break
        
        return DocumentTaxonomyItem(
            category_key=category_key,
            category_name=cat_info.get("name", category_key),
            subcategory_key=subcategory_key,
            subcategory_name=subcategory_name,
            test_name=test_name,
            report_content=doc_data.get("values", {}),
            report_date=doc_data.get("date"),
            source_text=doc_data.get("source_text", "")
        )

    # ------------------------------------------------------------
    # Hallucination check:
    # Verifies extracted data actually exists in transcript
    # Discards anything suspicious
    # ------------------------------------------------------------
    
    def verify_against_source(self, state: GraphState) -> GraphState:
        logger.info("Node: verify_against_source | Starting verification")

        """Hallucination check: Verify extracted data against source transcript"""
        if not state.get("validated_extraction"):
            logger.info("No extraction present, skipping verification")
            return state
            
        container = state["validated_extraction"]
        transcript = state["transcript"].lower()
        
        verified_docs = []
        discarded = []
        
        for doc in container.documents:
            # Check if source text actually exists in transcript
            source_snippet = doc.source_text.lower()
            if source_snippet in transcript or any(word in transcript for word in source_snippet.split()[:5]):
                verified_docs.append(doc)
            else:
                discarded.append({
                    "item": doc.dict(),
                    "reason": "Source text not found in transcript - possible hallucination"
                })
                logger.info(
                "Discarded document due to missing source | test_name=%s",
                doc.test_name
                )
        logger.info(
        "Verification results | verified_docs=%d | discarded_docs=%d",
        len(verified_docs),
        len(discarded)
        )
        
        # Verify clinical data items similarly
        clinical = container.clinical_data
        
        # Check medications
        verified_meds = []
        for med in clinical.medications:
            if med.name.lower() in transcript:
                verified_meds.append(med)
            else:
                discarded.append({"medication": med.name, "reason": "Not found in source"})
        
        clinical.medications = verified_meds
        container.documents = verified_docs
        container.discarded_items.extend(discarded)
        
        return {**state, "validated_extraction": container}
    

    # ------------------------------------------------------------
    # Converts extracted data into payloads for:
    # 1. Main storage API
    # 2. Feature-level context API
    # 3. Clinical summary API
    # ------------------------------------------------------------
    def prepare_api_payloads(self, state: GraphState) -> GraphState:
        logger.info("Node: prepare_api_payloads | Preparing API payloads")
        """Structure data for the three specific endpoints mentioned"""
        if not state.get("validated_extraction"):
            logger.warning("Fallback mode: saving raw transcript only")

            patient_id = state.get("patient_id")
            doctor_id = state.get("doctor_id")

            main_payload = {
                "patient_id": patient_id,
                "doctor_id": doctor_id,
                "processed_data": [{
                    "source": "fallback_no_extraction",
                    "content": {},
                    "documents": [],
                    "discarded": state.get("error_logs", []),
                    "timestamp": datetime.now().isoformat()
                }],
                "raw_data": [{
                    "source": "transcript",
                    "content": state["transcript"]
                }],
            }

            api_payloads = {
                "main_storage": {
                    "payload": main_payload,
                    "endpoint": f"{api_base_url}/hms/users/data/context/save_dictation",  # ✅ force dictation
                    "type": "dictation"
                },
                "clinical_summary": {}
            }

            return {**state, "api_payloads": api_payloads}
                    
        container = state["validated_extraction"]
        logger.info(
        "Payload summary | documents=%d | medications=%d | diagnoses=%d",
        len(container.documents),
        len(container.clinical_data.medications),
        len(container.clinical_data.diagnoses),
        )

        logger.info("API payloads constructed successfully")
        patient_id = state.get("patient_id")
        doctor_id = state.get("doctor_id")
        input_type = state.get("input_type", "dictation")
        
        # Payload 1: Main storage (save_conversation_user or save_dictation)
        processed_data = [{
            "source": "langgraph_extraction",
            "content": container.clinical_data.dict(),
            "documents": [doc.dict() for doc in container.documents],
            "discarded": container.discarded_items,
            "timestamp": datetime.now().isoformat()
        }]
        
        raw_data = [{
            "source": "transcript",
            "content": state["transcript"]
        }]
        
        main_payload = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "processed_data": processed_data,
            "raw_data": raw_data,
        }
        
        # Payload 2: Feature context LLM (individual test documents)
        # feature_payloads = []
        # for doc in container.documents:
        #     feature_payload = {
        #         "patient_id": patient_id,
        #         "doctor_id": doctor_id,
        #         "feature_id": doc.test_name,
        #         "new_data": {
        #             "timestamp": doc.report_date or datetime.now().isoformat(),
        #             "data": doc.report_content,
        #             "category": doc.category_key,
        #             "source_text": doc.source_text,
        #             "confidence": "confirmed"
        #         }
        #     }
        #     feature_payloads.append(feature_payload)
        
        # Payload 3: Clinical summary for context generation
        clinical_context = {
            "patient_id": patient_id,
            "vitals": container.clinical_data.vital_signs.dict() if container.clinical_data.vital_signs else {},
            "active_medications": [m.dict() for m in container.clinical_data.medications if not m.is_discontinued],
            "diagnoses": [d.dict() for d in container.clinical_data.diagnoses],
            "investigation_orders": [i.dict() for i in container.clinical_data.investigation_orders],
            "timestamp": datetime.now().isoformat()
        }
        
        api_payloads = {
            "main_storage": {
                "payload": main_payload,
                "endpoint": (
                    f"{api_base_url}/hms/users/data/context/save_conversation_user" 
                    if input_type == "conversation" 
                    else f"{api_base_url}/hms/users/data/context/save_dictation"
                ),
                "type": input_type
            },
            # "feature_context": {
            #     "payloads": feature_payloads,
            #     "endpoint": "https://demo.doctorassist.ai/api/hms/users/data/context/process_feature_context_llm"
            # },
            "clinical_summary": clinical_context
        }
        logger.info(
            "API payloads prepared | patient_id=%s | doctor_id=%s | "
            "input_type=%s | main_endpoint=%s",
            patient_id,
            doctor_id,
            input_type,
            api_payloads["main_storage"]["endpoint"]
        )

        
        return {**state, "api_payloads": api_payloads}
    
    # ------------------------------------------------------------
    # Sends prepared payloads to backend APIs
    # Handles failures gracefully
    # ------------------------------------------------------------
    def save_to_endpoints(self, state: GraphState) -> GraphState:
        logger.info("Node: save_to_endpoints | Saving data to APIs")
        """Execute API calls to save data"""
        payloads = state.get("api_payloads", {})
        responses = []
        logger.info("Saving main transcript data to HMS")

        
        # Save main transcript data
        main_config = payloads.get("main_storage", {})
        if main_config:
            try:
                resp = requests.post(
                    main_config["endpoint"],
                    json=main_config["payload"],
                    timeout=30
                )
                resp.raise_for_status()
                responses.append({
                    "endpoint": "main_storage",
                    "status": "success",
                    "id": resp.json().get("data", {}).get("id"),
                    "type": main_config.get("type")
                })
            except Exception as e:
                responses.append({
                    "endpoint": "main_storage",
                    "status": "failed",
                    "error": str(e)
                })
        
        # Save individual feature contexts (fire and forget with logging)
        feature_config = payloads.get("feature_context", {})
        for payload in feature_config.get("payloads", []):
            try:
                resp = requests.post(
                    feature_config["endpoint"],
                    json=payload,
                    timeout=10
                )

                if resp.status_code != 200:
                    logger.error(
                        f"Feature context failed | "
                        f"feature={payload['feature_id']} | "
                        f"status={resp.status_code} | "
                        f"body={resp.text}"
                    )

                responses.append({
                    "endpoint": "feature_context",
                    "feature_id": payload["feature_id"],
                    "status": "success" if resp.status_code == 200 else "failed"
                })

            except Exception as e:
                logger.exception(
                    f"Feature context exception | feature={payload['feature_id']}"
                )
        return {**state, "save_responses": responses, "final_status": "completed"}

class ClinicalTranscriptRequest(BaseModel):
    transcript: str = Field(..., min_length=1, description="Doctor-patient consultation transcript")
    specialty: Optional[str] = Field(None, description="Medical specialty, e.g. cardiology")
    consultation_type: Optional[str] = Field(None, description="initial, follow_up, urgent")
    patient_id: Optional[str] = Field(None, description="Patient identifier")
    doctor_id: Optional[str] = Field(None, description="Doctor identifier")
    type_of_conversation: Optional[str] = Field(None, description="e.g. in-person, telemedicine")

class ClinicalTranscriptResponse(BaseModel):
    success: bool
    data: Optional[Dict[str, Any]] = None
    raw_llm_output: Optional[str] = None
    error: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

# ------------------------------------------------------------
# API endpoint that receives transcript and runs the workflow
# ------------------------------------------------------------
@router.post(
    "/analyze-transcript/",
    response_model=ClinicalTranscriptResponse,
    status_code=status.HTTP_200_OK,
)
def analyze_transcript_endpoint(
    payload: ClinicalTranscriptRequest,
):
    logger.info("data received in analyze_transcript_endpoint: %s", payload)
    """
    Analyze a clinical consultation transcript and extract comprehensive structured data.
    """
    try:
        result = analyze_clinical_transcript(
            transcript=payload.transcript,
            specialty=payload.specialty,
            consultation_type=payload.consultation_type,
            patient_id=payload.patient_id,
            doctor_id=payload.doctor_id,
            type_of_conversation=payload.type_of_conversation,
        )
        logger.info("Clinical transcript analysis result: %s", result)
        if not result.get("success"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=result.get("error", "Clinical analysis failed"),
            )

        return result

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unexpected server error: {str(e)}",
        )





# ==============================================================================
# 5. GRAPH CONSTRUCTION AND WORKFLOW
# ==============================================================================

# ------------------------------------------------------------
# Builds the LangGraph workflow:
# classify → extract → classify docs → verify → prepare → save
# ------------------------------------------------------------
def create_clinical_workflow(groq_api_key: str):
    """Build and compile the LangGraph workflow"""
    
    agent = ClinicalExtractionAgent(groq_api_key)
    
    # Define workflow graph
    workflow = StateGraph(GraphState)
    
    # Add nodes
    workflow.add_node("classify_input", agent.classify_input_type)
    workflow.add_node("extract_clinical", agent.extract_structured_clinical)
    workflow.add_node("classify_documents", agent.identify_and_classify_documents)
    workflow.add_node("verify_data", agent.verify_against_source)
    workflow.add_node("prepare_payloads", agent.prepare_api_payloads)
    workflow.add_node("save_data", agent.save_to_endpoints)
    
    # Define edges
    workflow.set_entry_point("classify_input")
    workflow.add_edge("classify_input", "extract_clinical")

    workflow.add_edge("classify_documents", "verify_data")
    workflow.add_edge("verify_data", "prepare_payloads")
    workflow.add_edge("prepare_payloads", "save_data")
    workflow.add_edge("save_data", END)
        # STOP workflow if extraction failed
    def route_after_extraction(state: GraphState):
        if state.get("validated_extraction") is None:
            return "prepare_payloads"   # ✅ go to fallback instead of stopping
        return "classify_documents"

    workflow.add_conditional_edges(
        "extract_clinical",
        route_after_extraction
    )

    # Add conditional error handling
    def check_errors(state: GraphState):
        if len(state.get("error_logs", [])) > 3:
            return END
        return "save_data"
    
    return workflow.compile()

# ==============================================================================
# 6. MAIN INTERFACE FUNCTIONS (Drop-in replacements)
# ==============================================================================
class ClinicalTranscriptRequest(BaseModel):
    transcript: str = Field(..., min_length=1)
    specialty: Optional[str] = None
    consultation_type: Optional[str] = None
    patient_id: Optional[str] = None
    doctor_id: Optional[str] = None
    type_of_conversation: Optional[str] = None  # "conversation" or "dictation"

class ClinicalTranscriptResponse(BaseModel):
    success: bool
    data: Optional[Dict[str, Any]] = None
    raw_structured_data: Optional[Dict] = None
    error: Optional[str] = None
    metadata: Dict[str, Any] = {}
    saved_endpoints: List[Dict] = []

# Global workflow instance (initialize once)
_clinical_workflow = None

def get_workflow():
    global _clinical_workflow
    if _clinical_workflow is None:
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise ValueError("GROQ_API_KEY environment variable not set")
        _clinical_workflow = create_clinical_workflow(api_key)
    return _clinical_workflow

# ------------------------------------------------------------
# Entry point used by API
# Initializes graph, executes workflow, formats response
# ------------------------------------------------------------
def analyze_clinical_transcript(
    transcript: str,
    specialty: Optional[str] = None,
    consultation_type: Optional[str] = None,
    patient_id: Optional[str] = None,
    doctor_id: Optional[str] = None,
    type_of_conversation: Optional[str] = None,
) -> Dict[str, Any]:
    logger.info("Entered analyze_clinical_transcript function")
    """
    Agentic clinical transcript analysis using LangGraph.
    Comprehensive extraction with hallucination resistance and taxonomy mapping.
    """
    
    if not transcript or not transcript.strip():
        return {
            "success": False,
            "error": "Transcript is empty or invalid",
            "data": None,
            "metadata": None
        }
    
    try:
        logger.info("About to get clinical workflow")
        # Initialize workflow
        workflow = get_workflow()
         # 🔹 AFTER workflow creation
        logger.info("Clinical workflow created successfully")

        # 🔹 BEFORE graph execution
        logger.info(
            "Creating initial GraphState | patient_id=%s | doctor_id=%s",
            patient_id,
            doctor_id
        )
        # Initial state
        initial_state = GraphState(
            transcript=transcript,
            specialty=specialty,
            consultation_type=consultation_type,
            patient_id=patient_id,
            doctor_id=doctor_id,
            input_type=type_of_conversation,  # Can be None, will be classified
            extraction_attempts=0,
            validated_extraction=None,
            error_logs=[],
            api_payloads={},
            save_responses=[],
            final_status="pending"
        )
         # 🔹 BEFORE workflow.invoke()
        logger.info("Invoking workflow graph")
        
        # Execute graph
        final_state = workflow.invoke(initial_state)
        # 🔹 AFTER workflow.invoke()
        logger.info(
            "Workflow finished | final_status=%s | attempts=%s | errors=%s",
            final_state.get("final_status"),
            final_state.get("extraction_attempts"),
            final_state.get("error_logs")
        )

        # 🔹 CHECK extraction
        logger.info(
            "validated_extraction exists: %s",
            bool(final_state.get("validated_extraction"))
        )
        # Prepare response
        if final_state.get("validated_extraction"):
            extraction = final_state["validated_extraction"]
            response_data = {
                "clinical_summary": extraction.clinical_data.dict(),
                "classified_documents": [d.dict() for d in extraction.documents],
                "discarded_items": extraction.discarded_items,
                "input_type_detected": final_state.get("input_type")
            }
        else:
            response_data = None
        
        return {
            "success": bool(final_state.get("validated_extraction")),
            "data": response_data,
            "raw_structured_data": final_state.get("validated_extraction", {}).dict() if final_state.get("validated_extraction") else None,
            "error": final_state.get("error_logs", [])[-1] if final_state.get("error_logs") else None,
            "metadata": {
                "extraction_attempts": final_state.get("extraction_attempts", 0),
                "conversation_type": final_state.get("input_type"),
                "patient_id": patient_id,
                "doctor_id": doctor_id
            },
            "saved_endpoints": final_state.get("save_responses", [])
        }
        
    except Exception as e:
        logger.exception("Clinical analysis workflow failed")
        return {
            "success": False,
            "error": str(e),
            "data": None,
            "metadata": {"timestamp": datetime.now().isoformat()}
        }


async def get_latest_appointment_id(patient_id: str, doctor_id: str):

    pipeline = [
        {"$match": {"sys_user_id": patient_id}},   # ✅ IMPORTANT FIX
        {"$unwind": "$appointments"},
        {"$match": {"appointments.doctor_id": doctor_id}},  # ✅ FILTER doctor
        {"$sort": {"appointments.date": -1}},
        {"$limit": 1},
        {
            "$project": {
                "_id": 0,
                "appointment_id": {
                    "$ifNull": ["$appointments.appointment_id", "$appointments.id"]
                }
            }
        }
    ]

    cursor = patient_appointments_collection.aggregate(pipeline)
    result = await cursor.to_list(length=1)

    if not result:
        return None

    return result[0].get("appointment_id")




@router.post("/proxy/upload-file-url")
async def upload_file_url(
    doctor_id: str = Form(...),
    patient_id: str = Form(...),
    doc_type: str = Form(None),
    category: str = Form(None),
    subcategory: str = Form(None),
    file: UploadFile = File(...)
):
    try:
        url = f"{STORAGE_BASE_URL}/upload"

        files = {
            "file": (
                file.filename,
                await file.read(),
                file.content_type,
            )
        }

        params = {
            "doctor_id": doctor_id,
            "patient_id": patient_id,
            "doc_type": doc_type,
            "category": category,
            "subcategory": subcategory,
        }

        response = requests.post(
            url,
            params=params,
            files=files,
            timeout=60,
        )

        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=response.text,
            )

        upload_result = response.json()
        stored_filename = upload_result["filename"]

        file_url = f"{STORAGE_BASE_URL}/files/{patient_id}/{stored_filename}"

        return {
            "file_url": file_url
        }

    except Exception as e:
        logger.exception("File upload failed")
        raise HTTPException(status_code=500, detail=str(e))



@router.post("/oncology-investigations/upload-file-url")
async def upload_oncology_file(
    doctor_id: str = Form(...),
    patient_id: str = Form(...),
    investigation_id: int = Form(...),
    file: UploadFile = File(...),
):
    try:
        investigation = await oncology_investigations_collection.find_one({
            "doctor_id": doctor_id,
            "patient_id": patient_id,
            "id": investigation_id,
        })
        if not investigation:
            raise HTTPException(status_code=404, detail="Investigation not found")

        parameters = investigation.get("parameters")
        if not parameters:
            raise HTTPException(status_code=400, detail="Investigation has no parameters configured")

        url = f"{STORAGE_BASE_URL}/upload"
        files = {"file": (file.filename, await file.read(), file.content_type)}
        params = {
            "doctor_id": doctor_id,
            "patient_id": patient_id,
            "doc_type": investigation.get("investigation"),
        }
        response = requests.post(url, params=params, files=files, timeout=60)
        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail=response.text)

        stored_filename = response.json()["filename"]
        file_url = f"{STORAGE_BASE_URL}/files/{patient_id}/{stored_filename}"

        await oncology_investigations_collection.update_one(
            {"doctor_id": doctor_id, "patient_id": patient_id, "id": investigation_id},
            {"$set": {"status": "processing", "file_url": file_url, "file_name": file.filename}},
        )

        # Blocks until the full pipeline finishes
        result = await process_oncology_investigation(
            file_url=file_url,
            filename=file.filename,
            patient_id=patient_id,
            doctor_id=doctor_id,
            investigation_id=investigation_id,
            parameters=parameters,
        )

        if result["status"] != "success":
            raise HTTPException(status_code=500, detail=result.get("error", "Processing failed"))

        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Oncology file upload failed")
        raise HTTPException(status_code=500, detail=str(e))
    
    
    
    
@router.post("/proxy/upload-file-url/preventive")
async def upload_file_url(
    doctor_id: str = Form(...),
    patient_id: str = Form(...),
    doc_type: str = Form(None),
    category: str = Form(None),
    subcategory: str = Form(None),
    file: UploadFile = File(...)
):
    try:
        url = f"{STORAGE_BASE_URL}/upload"

        files = {
            "file": (
                file.filename,
                await file.read(),
                file.content_type,
            )
        }

        params = {
            "doctor_id": doctor_id,
            "patient_id": patient_id,
            "doc_type": doc_type,
            "category": category,
            "subcategory": subcategory,
        }

        response = requests.post(
            url,
            params=params,
            files=files,
            timeout=60,
        )

        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=response.text,
            )

        upload_result = response.json()
        stored_filename = upload_result["filename"]

        file_url = f"{STORAGE_BASE_URL}/files/{patient_id}/{stored_filename}"

        # Save in MongoDB
        preventive_images_collection.insert_one({
            "patient_id": patient_id,
            "file_url": file_url,
            "created_at": datetime.utcnow()
        })

        return {
            "file_url": file_url
        }

    except Exception as e:
        logger.exception("File upload failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/preventive-images/{patient_id}")
async def get_preventive_images(patient_id: str):
    try:
        images = list(
            preventive_images_collection.find(
                {"patient_id": patient_id},
                {"_id": 0}
            )
        )

        return {
            "patient_id": patient_id,
            "images": images
        }

    except Exception as e:
        logger.exception("Failed to fetch preventive images")
        raise HTTPException(status_code=500, detail=str(e))