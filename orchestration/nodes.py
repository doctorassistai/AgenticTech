from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, WebSocket, status, File, Form, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse, FileResponse
# from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field, EmailStr, validator
from fastapi.encoders import jsonable_encoder
from typing import Any, Dict, List, Optional, Union
from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, date, timedelta
from bson import ObjectId
from enum import Enum
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
import time
import queue
import threading
from passlib.context import CryptContext
from functools import wraps, partial
import uuid
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
from groq import Groq
from fastapi import Query
from typing import Optional
from fastapi import Response
from jose import jwt, JWTError
from datetime import datetime, timedelta
from fastapi.encoders import jsonable_encoder
from shared.audit.schema import AuditEvent
from shared.audit.utils import emit_audit
from datetime import datetime, timezone
from dotenv import load_dotenv
import os
import inspect


load_dotenv()
api_base_url = os.getenv("VITE_BACKEND_URL")


SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
ACCESS_TOKEN_EXPIRE_DAYS = os.getenv("ACCESS_TOKEN_EXPIRE_DAYS")

api_key = os.getenv("GROQ_API_KEY")

groq_client = Groq(api_key=api_key)



router = APIRouter(
    prefix="",
    tags=["doctor"],
    responses={404: {"description": "Not found"}},
)



# templates = Jinja2Templates(directory="templates")
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
stream_handler = logging.StreamHandler(sys.stdout)
log_formatter = logging.Formatter("%(asctime)s [%(processName)s: %(process)d] [%(threadName)s: %(thread)d] [%(levelname)s] %(name)s: %(message)s")
stream_handler.setFormatter(log_formatter)
logger.addHandler(stream_handler)

logger.info('API is starting up')



#######################################################################HEADER OF FILE ########################################################################################

class DoctorScreeningQuestions(BaseModel):
    doctor_id: Optional[str] = None  # Doctor ID (optional)
    questions: Optional[List[str]] = None  # List of questions as strings (optional)


class TriggerConfig(BaseModel):
    type: str
    button_label: Optional[str] = None


class FeatureConfiguration(BaseModel):
    doctor_id: str = Field(..., example="DOC12345")

    feature_id: str = Field(..., example="pattern-detector")
    feature_name: str

    category_id: str
    category_name: str

    enabled: bool = True
    configured: bool = False

    trigger: TriggerConfig

    data_sources: List[str] = []
    lab_parameters: List[str] = []
    vitals_parameters: List[str] = []
    selected_output_categories: List[str] = []
    display_method: Optional[str]="text"
    rules: Optional[str] = None

    timestamp: datetime = Field(default_factory=datetime.utcnow)


class PatientProfileConfig(BaseModel):
    fields: List[str]
    display_mode: Optional[str] = "default"


class PatientProfileFeatureConfiguration(BaseModel):
    doctor_id: str = Field(..., example="WOnZfHqOmN")

    feature_id: str = Field(default="patient-profile")
    feature_name: str = Field(default="Patient Profile Retriever")

    category_id: str = Field(default="patient-data")

    enabled: bool = True
    configured: bool = False

    patient_profile: PatientProfileConfig

    timestamp: datetime = Field(default_factory=datetime.utcnow)



class ScreeningFeatureConfiguration(BaseModel):
    doctor_id: str

    feature_id: str = "screening-section"
    feature_name: str = "Screening Data Form"
    category_id: str = "screening-data"

    fields: List[str]  # 👈 accept fields directly

    enabled: bool = True
    configured: bool = True

    timestamp: datetime = Field(default_factory=datetime.utcnow)

    def to_feature_data(self):
        """
        Normalize structure before saving to DB
        """
        data = self.dict(exclude={"doctor_id", "fields"})
        data["screening_section"] = {
            "fields": self.fields
        }
        return data

class ClinicalFormGenerateRequest(BaseModel):
    doctor_id: str
    patient_id: str

class GeneratedField(BaseModel):
    field_id: str
    label: str
    type: str
    options: Optional[List[str]] = None
    unit: Optional[str] = None
    suggested_value: Optional[Any] = None
    source: str = "llm_suggested"

class ClinicalFormGenerateResponse(BaseModel):
    fields: List[GeneratedField]


########################################################################################################################################################




MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"
NODES_DB = "doctorassistai_nodes"

mongodb_client = AsyncIOMotorClient(MONGO_URI)  # async (Motor)
database = mongodb_client[MONGO_DB]

client = MongoClient(MONGO_URI)  # sync (PyMongo)
db = client[MONGO_DB]

nodes_database = mongodb_client[NODES_DB]        # async nodes db
nodes_db = client[NODES_DB]                 # sync nodes db
context_rule_collection = db["context_admin_rules"]
context_rule_doctor_collection = db["context_admin_doctor_rules"]
screening_settings_collection = nodes_database["screening_settings"]

oncology_investigations_collection = database["oncology_investigations"]
doctor_medical_current_rule_collection = db["doctor_medical_current_rules"]
doctor_nodes_collection = nodes_database["doctor_feature_configurations"]
medical_current_rule_collection = db["medical_current_admin_rules"]
patient_user_collection = db["patient_users"]

insurance_claims_collection = db["insurance_claims"]

doctor_user_collection = db["doctor_users"]

prognosis_data_collection = database["prognosis-data"]

patient_vitals_collection = database["patient_vitals"]

patient_nodes_collection = nodes_database["patient_profile_configurations"]

medical_context_collection = database["medical_context"]

current_context_collection = database["current_context"]
structured_note_doctor_collection = database["structured_note_doctor_rules"]
longitudinal_context_collection = database["longitudinal_context"]
summary_collection = database["patient_summary"]
report_user_collection = database["report_user"]

document_user_collection = database["document_user"]
processed_documents = database["processed_documents"]
doctor_screening_questions_collection = database["doctor_screening_questions"]

conversation_user_collection = database["conversation_user"]

orchestration_state = database["feature_orchestration_state"]

dictation_collection = database["dictation"]

doctor_screening_results_collection = database["doctor_screening_results"]

condition_context_collection = database["conditions"]

procedure_notes_collection = database["procedure_notes"]

agentic_data_collection = db["agentic_data"]

temp_data_collection = db["temp_data"]

document_categories_collection = database["document_categories"]

patient_appointments_collection = database["patient_appointments"]

document_collection = database["patient_documents_collection"]

template_master_collection = database["template-master"]

template_items_collection = database["template-items"]

investigation_master_collection = database["investigation-master"]


documentation_treatment_plan_collection = database["documentation-treatment-plan"]
documentation_investigation_notes_collection = database["documentation-investigation-notes"]
documentation_medication_analysis_collection = database["documentation-medication-analysis"]
documentation_treatment_summary_collection = database["documentation-treatment-summary"]

documentation_clinical_notes_collection = database["documentation-clinical-notes"]
clinical_element_collection = database["clinical_element"]



patient_triage_history = db["patient_triage_history"]
structured_note_collection = db["structured_notes"]
tumor_board_presentation_collection = database["tumor_board_presentations"]


@router.post("/speciality-vital-selection")
async def speciality_vital_selection(request: Request):
    """
    Analyse which vital signs are important vs optional
    for a doctor based on speciality.
    """

    try:
        data = await request.json()
        doctor_id = data.get("doctor_id")

        if not doctor_id:
            raise HTTPException(status_code=400, detail="doctor_id is required")

        # ---------------------------------------------------
        # FETCH DOCTOR SPECIALITY
        # ---------------------------------------------------
        doctor_doc = doctor_user_collection.find_one(
            {"sys_user_id": doctor_id},
            {"_id": 0, "specialization": 1, "qualifications": 1}
        )
        logger.info("doctor_daata", doctor_doc)
        if not doctor_doc:
            raise HTTPException(
                status_code=404,
                detail=f"No doctor found for doctor_id={doctor_id}"
            )

        speciality = doctor_doc.get("speciality", "General Medicine")

        # ---------------------------------------------------
        # LLM PROMPT
        # ---------------------------------------------------
        prompt = f"""
You are a clinical workflow intelligence AI.

Your task is to determine which patient vital signs
should be collected for a doctor based ONLY on their speciality.

Do NOT analyze values.
Do NOT perform diagnosis.
Do NOT assess risk.
Do NOT generate treatment advice.

Your responsibility is ONLY to classify vital signs into:
1. Important vitals – routinely needed and clinically relevant
2. Optional vitals – supportive or situational

Base your decision strictly on standard clinical practice
for the given speciality.

# DOCTOR CONTEXT
Speciality: {speciality}

# OUTPUT RULES
- Output must be valid JSON
- Do not include explanations outside JSON
- Use standard clinical vital names only
- Do not invent new measurements

# STRICT OUTPUT FORMAT
{{
  "important_vitals": [],
  "optional_vitals": []
}}
"""

        # ---------------------------------------------------
        # LLM CALL (Same Pattern as KDRI)
        # ---------------------------------------------------
        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            temperature=0.1,
            max_tokens=1200,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
        )

        vital_selection = json.loads(completion.choices[0].message.content)

        return {
            "timestamp": data.get("timestamp"),
            "doctor_id": doctor_id,
            "speciality": speciality,
            "vital_selection": vital_selection
        }

    except Exception as e:
        logger.exception("Speciality vital selection failed")
        raise HTTPException(
            status_code=500,
            detail=f"Speciality vital selection failed: {str(e)}"
        )



@router.post("/doctor_screening_feature_save")
async def save_screening_feature(config: ScreeningFeatureConfiguration):
    doctor_id = config.doctor_id

    feature_data = config.to_feature_data()
   
    feature_data["enabled"] = True
   
    await screening_settings_collection.update_one(
        {"doctor_id": doctor_id},
        {"$pull": {"features": {"feature_id": feature_data["feature_id"]}}},
    )

    await screening_settings_collection.update_one(
        {"doctor_id": doctor_id},
        {
            "$push": {"features": feature_data},
            "$set": {"updated_at": datetime.utcnow()}
        },
        upsert=True
    )

    return {
        "status": "success",
        "feature_id": feature_data["feature_id"],
        "doctor_id": doctor_id
    }



@router.get("/doctor_screening_features/{doctor_id}")
async def get_screening_features_by_doctor(doctor_id: str):
    """
    Retrieve all screening-related feature configurations
    for a given doctor_id
    """

    doctor_doc = await screening_settings_collection.find_one(
        {"doctor_id": doctor_id},
        {"_id": 0}  # Exclude MongoDB _id
    )

    if not doctor_doc:
        raise HTTPException(
            status_code=404,
            detail=f"No screening features found for doctor_id={doctor_id}"
        )

    response_data = {
        "status": "success",
        "doctor_id": doctor_id,
        "features": doctor_doc.get("features", []),
        "updated_at": doctor_doc.get("updated_at")
    }

    return JSONResponse(
        status_code=200,
        content=jsonable_encoder(response_data)
    )







###############################################################################AI NODES STARTING###################################################################


# @router.post("/feature-analysis-templates")
# async def feature_analysis_templates(request: Request):
#     """
#     Generate data-selection templates and
#     single-string analysis prompts for a feature.
#     """

#     try:
#         data = await request.json()

#         doctor_id = data.get("doctor_id")
#         feature = data.get("feature")

#         if not doctor_id or not feature:
#             raise HTTPException(
#                 status_code=400,
#                 detail="doctor_id and feature are required"
#             )

#         # ---------------------------------------------------
#         # FETCH DOCTOR SPECIALITY
#         # ---------------------------------------------------
#         doctor_doc = doctor_user_collection.find_one(
#             {"sys_user_id": doctor_id},
#             {"_id": 0, "specialization": 1}
#         )

#         if not doctor_doc:
#             raise HTTPException(
#                 status_code=404,
#                 detail=f"No doctor found for doctor_id={doctor_id}"
#             )

#         speciality = doctor_doc.get("specialization", "General Medicine")

#         feature_id = feature.get("id")
#         feature_name = feature.get("name")

#         # ---------------------------------------------------
#         # LLM PROMPT — PROMPT AUTHORING ONLY
#         # ---------------------------------------------------
#         prompt = f"""
# You are a CLINICAL AI PROMPT AUTHOR.

# Your responsibility is to WRITE EXECUTION-READY ANALYSIS PROMPTS
# for a clinical software feature.

# You are NOT performing analysis.
# You are NOT detecting patterns.
# You are NOT interpreting patient data.

# You are ONLY writing the PROMPT
# that will later be used as a SYSTEM PROMPT
# for another AI to perform the actual analysis.

# The prompt you generate must:
# - Be feature-specific
# - Be speciality-aware
# - Clearly define allowed analytical reasoning
# - Explicitly forbid diagnosis, prognosis, and treatment advice
# - Assume structured clinical data as input

# # DOCTOR CONTEXT
# Speciality: {speciality}

# # FEATURE CONTEXT
# Feature ID: {feature_id}
# Feature Name: {feature_name}

# # FEATURE INTENT INTERPRETATION
# The feature name represents the intended type of analytical support.

# You must infer the nature of the analysis from the feature name itself.
# Do not rely on assumptions beyond what the feature name implies.

# When interpreting the feature name:
# - Focus on the type of analytical support implied by the wording
# - Prefer neutral, supportive, and observational analysis for decision-oriented features
# - Avoid introducing disease-focused, risk-focused, or outcome-focused reasoning
#   unless clearly implied by the feature name

# The analysis_prompt must reflect:
# - The analytical intent inferred from the feature name
# - The speciality-specific clinical review context
# - The selected data sources

# # AVAILABLE DATA SOURCES
# - Vitals
# - Lab Report
# - Radiology
# - Biopsy
# - Medications
# - Treatment Plan

# # TEMPLATE REQUIREMENTS
# - Generate 2–3 templates
# - Each template must define:
#   1. Selected data sources
#   2. A SINGLE analysis_prompt string
#   3. A descriptive template_name derived from:
#      - Feature intent
#      - Selected data sources

# # TEMPLATE NAMING RULES
# - template_name must sound natural and clinician-friendly
# - template_name should read like a meaningful option a doctor would select
# - Use plain, professional language (not technical or academic phrasing)
# - Avoid rigid or formulaic patterns
# - Avoid excessive clinical jargon
# - Avoid disease names, diagnoses, or outcomes
# - The name should intuitively reflect:
#   - What kind of review or analysis is being done
#   - Which types of data are involved
# - Keep the name short, clear, and descriptive (ideally under 8–10 words)

# # ANALYSIS PROMPT RULES
# The analysis_prompt MUST be a COMPLETE, EXECUTION-READY instruction set
# for another AI that will perform the actual analysis.

# The analysis_prompt MUST:
# - Assign the AI a clinical analytical role aligned with the feature intent
# - Explicitly state the doctor’s speciality
# - Explicitly list which data sources are provided
# - Describe HOW each selected data source should be analysed:
#   - trends, variability, consistency, relationships
#   - longitudinal vs cross-sectional reasoning
# - Describe HOW multiple data sources should be reviewed together
# - Align reasoning with standard clinical review practices for the speciality
# - Restrict reasoning strictly to observational and descriptive analysis

# The analysis_prompt MUST EXPLICITLY PROHIBIT:
# - Diagnosis or disease labeling
# - Risk prediction or prognosis
# - Treatment recommendations or medication advice
# - Clinical decision-making or triage
# - Assumptions beyond provided data

# The analysis_prompt MUST:
# - Use neutral, objective, non-judgmental language
# - Require structured output (sections or bullet points)
# - State that outputs are analytical observations only

# # OUTPUT RULES
# - Output ONLY valid JSON
# - No explanations
# - No markdown
# - No examples
# - No commentary

# # STRICT OUTPUT FORMAT
# {{
#   "templates": [
#     {{
#       "template_id": "",
#       "template_name": "",
#       "data_sources": {{
#         "vitals": false,
#         "lab_reports": false,
#         "radiology": false,
#         "biopsy": false,
#         "medications": false,
#         "treatment_plan": false
#     }},
#       "analysis_prompt": ""
#     }}
#   ]
# }}
# """

#         # ---------------------------------------------------
#         # LLM CALL
#         # ---------------------------------------------------
#         completion = groq_client.chat.completions.create(
#             model="llama-3.1-8b-instant",
#             temperature=0.1,
#             max_tokens=2500,
#             response_format={"type": "json_object"},
#             messages=[{"role": "user", "content": prompt}],
#         )

#         templates = json.loads(
#             completion.choices[0].message.content
#         )

#         return {
#             "timestamp": data.get("timestamp"),
#             "doctor_id": doctor_id,
#             "speciality": speciality,
#             "feature": {
#                 "id": feature_id,
#                 "name": feature_name
#             },
#             "analysis_templates": templates
#         }

#     except Exception as e:
#         logger.exception("Feature analysis template generation failed")
#         raise HTTPException(
#             status_code=500,
#             detail=f"Feature analysis template generation failed: {str(e)}"
#         )



# important madhavan done

# @router.post("/feature-analysis-templates")
# async def feature_analysis_templates(request: Request):
#     """
#     Generate fully self-contained analysis templates for a feature.
#     Each template includes a natural name and a complete analysis prompt
#     that can be directly executed by another LLM.
#     """

#     try:
#         # -----------------------------
#         # PARSE REQUEST
#         # -----------------------------
#         data = await request.json()

#         doctor_id = data.get("doctor_id")
#         feature = data.get("feature")

#         if not doctor_id or not feature:
#             raise HTTPException(
#                 status_code=400,
#                 detail="doctor_id and feature are required"
#             )

#         feature_id = feature.get("id")
#         feature_name = feature.get("name")

#         if not feature_id or not feature_name:
#             raise HTTPException(
#                 status_code=400,
#                 detail="feature.id and feature.name are required"
#             )

#         # -----------------------------
#         # FETCH DOCTOR SPECIALITY
#         # -----------------------------
#         doctor_doc = doctor_user_collection.find_one(
#             {"sys_user_id": doctor_id},
#             {"_id": 0, "specialization": 1}
#         )

#         if not doctor_doc:
#             raise HTTPException(
#                 status_code=404,
#                 detail=f"No doctor found for doctor_id={doctor_id}"
#             )

#         speciality = doctor_doc.get("specialization", "General Medicine")

#         # -----------------------------
#         # LLM PROMPT — PROMPT AUTHORING ONLY
#         # -----------------------------
#         prompt = f"""
# You are a CLINICAL AI PROMPT AUTHOR.

# Your responsibility is to WRITE EXECUTION-READY ANALYSIS PROMPTS
# for a clinical software feature.

# You are NOT performing analysis.
# You are NOT detecting patterns.
# You are NOT interpreting patient data.

# You are ONLY writing PROMPTS that will later be used
# as SYSTEM PROMPTS for another AI to perform the actual analysis.

# The prompts you generate must:
# - Be feature-specific
# - Be speciality-aware
# - Clearly define allowed analytical reasoning
# - Explicitly forbid diagnosis, prognosis, and treatment advice
# - Assume structured clinical data as input

# # DOCTOR CONTEXT
# Speciality: {speciality}

# # FEATURE CONTEXT
# Feature ID: {feature_id}
# Feature Name: {feature_name}

# # FEATURE INTENT INTERPRETATION
# The feature name represents the intended type of analytical support.

# You must infer the nature of the analysis from the feature name itself.
# Do not rely on assumptions beyond what the feature name implies.

# When interpreting the feature name:
# - Focus on the analytical intent suggested by the wording
# - Prefer neutral, supportive, and observational analysis
# - Avoid disease-focused, risk-focused, or outcome-focused reasoning
#   unless clearly implied by the feature name

# # TEMPLATE REQUIREMENTS
# - Generate 2–3 analysis templates
# - Each template must define:
#   1. A natural, clinician-friendly template_name
#   2. A SINGLE analysis_prompt string

# The analysis_prompt must be FULLY SELF-CONTAINED and must explicitly include:
# - The AI’s analytical role
# - The doctor’s speciality context
# - The feature intent inferred from the feature name
# - The clinical data types expected as input
# - How each data type should be analysed
# - How multiple data types should be reviewed together (if applicable)
# - The expected output structure

# # TEMPLATE NAME DERIVATION RULE
# For each template:
# - First design the analysis_prompt in full
# - Then derive the template_name as a natural-language summary of that analysis_prompt
# - The template_name must accurately reflect what the analysis_prompt instructs the AI to do
# - A clinician reading the template_name should be able to predict
#   the purpose and scope of the analysis_prompt


# # TEMPLATE NAMING RULES
# - template_name must be a concise, natural-language summary of the analysis_prompt
# - The name should describe the type of review or analysis being performed
# - Use plain, professional, clinician-friendly language
# - Avoid rigid or formulaic phrasing
# - Avoid technical or academic tone
# - Avoid disease names, diagnoses, or outcomes
# - Keep the name short and clear (ideally under 8–10 words)
# - The name should sound like an option a doctor would naturally choose

# # ANALYSIS PROMPT RULES
# Each analysis_prompt MUST be a COMPLETE, EXECUTION-READY SYSTEM PROMPT
# for another AI that will perform the actual feature analysis.

# Each analysis_prompt MUST include:

# 1. ROLE AND CONTEXT
# - Assign a clinical analytical role to the AI
# - State the doctor’s speciality
# - State the inferred feature intent

# 2. DATA INPUT DEFINITION
# - Explicitly list the types of clinical data that will be provided
#   (e.g. vitals, lab reports, radiology, medications, treatment plans)
# - State that ONLY these data sources should be used

# 3. ANALYSIS INSTRUCTIONS
# - Describe HOW each data source should be analysed
#   (trends, variability, consistency, temporal relationships)
# - Specify whether longitudinal, cross-sectional, or combined reasoning is appropriate
# - Describe how multiple data sources should be reviewed together
# - Align reasoning with standard clinical review practices for the speciality

# 4. OUTPUT STRUCTURE
# - Explicitly define how the output should be structured
#   (sections, headings, bullet points, or categorized observations)
# - Require neutral, objective, and observational language

# 5. STRICT CONSTRAINTS
# The analysis_prompt MUST explicitly prohibit:
# - Diagnosis or disease labeling
# - Risk prediction or prognosis
# - Treatment recommendations or medication advice
# - Clinical decision-making or triage
# - Assumptions beyond the provided data

# 6. GENERAL RULES
# - Assume structured clinical data as input
# - State that outputs are analytical observations only, not conclusions

# # OUTPUT RULES
# - Output ONLY valid JSON
# - No explanations
# - No markdown
# - No examples
# - No commentary

# # STRICT OUTPUT FORMAT
# {{
#   "templates": [
#     {{
#       "template_id": "",
#       "template_name": "",
#       "analysis_prompt": ""
#     }}
#   ]
# }}
# """

#         # -----------------------------
#         # LLM CALL
#         # -----------------------------
#         completion = groq_client.chat.completions.create(
#             model="llama-3.1-8b-instant",
#             temperature=0.1,
#             max_tokens=3000,
#             response_format={"type": "json_object"},
#             messages=[{"role": "user", "content": prompt}],
#         )

#         analysis_templates = json.loads(
#             completion.choices[0].message.content
#         )

#         # -----------------------------
#         # RESPONSE
#         # -----------------------------
#         return {
#             "timestamp": data.get("timestamp"),
#             "doctor_id": doctor_id,
#             "speciality": speciality,
#             "feature": {
#                 "id": feature_id,
#                 "name": feature_name
#             },
#             "analysis_templates": analysis_templates
#         }

#     except Exception as e:
#         logger.exception("Feature analysis template generation failed")
#         raise HTTPException(
#             status_code=500,
#             detail=f"Feature analysis template generation failed: {str(e)}"
#         )



# @router.post("/feature-output-categories")
# async def feature_generic_output_categories(request: Request):
#     """
#     Determines GENERIC, HIGH-LEVEL OUTPUT CATEGORIES
#     that a feature can produce, based on feature intent
#     and inferred clinical speciality.

#     This function does NOT perform analysis.
#     """

#     try:
#         data = await request.json()

#         feature_id = data.get("feature_id")
#         feature_name = data.get("feature_name")
#         category_name = data.get("category_name")
#         rules = data.get("rules", "")

#         doctor_id = data.get("doctor_id")
#         timestamp = data.get("timestamp")

#         if not feature_id or not feature_name:
#             raise HTTPException(
#                 status_code=400,
#                 detail="feature_id and feature_name are required"
#             )

#         # ------------------------------------------------------------------
#         # LLM PROMPT — FEATURE + SPECIALITY AWARE CATEGORY INFERENCE
#         # ------------------------------------------------------------------
#         prompt = f"""
# You are a senior clinical AI system designer.

# Your task is to determine the OUTPUT CATEGORIES
# that an LLM-based analysis would generate for a given feature.

# This is NOT generic abstraction.
# These output categories are the STANDARD SECTIONS
# that appear in the final AI-generated analysis report.

# You must follow this process internally:
# 1. Identify what TYPE of feature this is based on the feature name
#    (e.g., pattern analysis, CDSS, monitoring, scoring, summarization, intelligence).
# 2. Based on that feature type, determine the COMMON OUTPUT SECTIONS
#    such a feature would always generate.
# 3. Adjust the sections to align with the analysis intent and clinical domain.

# Output categories:
# - Represent report sections (not raw data, not results)
# - Are consistent for the same feature type
# - Can be populated by an LLM
# - Are reusable across patients
# - May include severity-based or classification-based sections when appropriate

# Do NOT:
# - Perform the analysis
# - Populate any category
# - Mention patient data
# - Provide explanations
# - Invent UI concepts
# - Return abstract meta-types only

# IMPORTANT FEATURE-TYPE GUIDANCE (DO NOT OUTPUT THIS TEXT):

# • Pattern analysis features typically produce sections such as:
#   critical vs non-critical findings, normal vs abnormal patterns,
#   temporal patterns, correlations, anomalies, summaries.

# • Clinical decision support features typically produce sections such as:
#   recommendations, alerts, contraindications, monitoring guidance,
#   rationale, follow-up considerations.

# • Monitoring or tracking features typically produce sections such as:
#   trend summaries, stability assessments, deviations, alerts, observations.

# • Scoring or index features typically produce sections such as:
#   score summary, contributing factors, interpretation, thresholds.

# Use this guidance internally to decide output categories,
# but return ONLY the category names.

# # FEATURE CONTEXT
# Feature Name: {feature_name}
# Feature Domain: {category_name}

# # ANALYSIS INTENT (FOR CONTEXT ONLY)
# {rules}

# # OUTPUT RULES
# - snake_case only
# - concise, meaningful section names
# - no explanations
# - no extra keys

# # STRICT OUTPUT FORMAT (JSON ONLY)

# {{
#   "feature_id": "{feature_id}",
#   "feature_name": "{feature_name}",
#   "possible_output_categories": []
# }}
# """

#         # ------------------------------------------------------------------
#         # LLM CALL
#         # ------------------------------------------------------------------
#         completion = groq_client.chat.completions.create(
#             model="llama-3.1-8b-instant",
#             temperature=0.03,
#             max_tokens=1500,
#             response_format={"type": "json_object"},
#             messages=[{"role": "user", "content": prompt}],
#         )

#         result_json = json.loads(completion.choices[0].message.content)

#         return {
#             "timestamp": timestamp,
#             "doctor_id": doctor_id,
#             "feature_output_categories": result_json
#         }

#     except Exception as e:
#         logger.exception("Generic feature output categories failed")
#         raise HTTPException(
#             status_code=500,
#             detail=f"Generic feature output categories failed: {str(e)}"
#         )

#important madhavan done till above 

# Aleena done from here

FEATURE_BASE_PROMPTS = {

    # ============================================================
    # 🔬 ONCOLOGY — PATHOLOGY & DIAGNOSTICS
    # ============================================================

    "Histopathology-Incisional-Excisional-Biopsy": """
Structured histopathology report analysis.

Focus strictly on:
- Specimen and biopsy details
- Gross findings
- Microscopic morphology
- Tumor architecture and cytology
- Depth of invasion and margin status
- Adverse pathological features
- Special stains and IHC correlation
- Final pathological impression
- One-line pathology summary

Exclude staging, prognosis, and treatment guidance.
""",

    "Cytology-Biopsy": """
Structured cytology and biopsy material evaluation.

This feature is LIMITED to descriptive, observational documentation
of cytological and biopsy-related findings.

Scope of analysis is strictly restricted to:

- Specimen type, source, and collection technique
- Sample adequacy and cellularity
- Cytomorphological characteristics of observed cells
- Background elements (e.g., inflammation, necrosis, blood, debris)
- Architectural or pattern-level cytological arrangements
- Presence or absence of cytological atypia described WITHOUT grading
- Internal consistency of reported observations
- Correlation of cytological findings with provided clinical context
  ONLY at a descriptive level

This feature DOES NOT perform:
- Diagnostic confirmation
- Disease labeling
- Malignancy grading or staging
- Prognostic interpretation
- Risk stratification
- Treatment or investigation recommendations
- Clinical decision support

If diagnostic, impression, or recommendation text is present
in the source data, it MUST be:
- Converted into neutral observational language
- Explicitly framed as reported text, not inferred conclusions


""",

"Baseline-Diagnostics": """
Baseline diagnostic data structuring and summarization for initial clinical assessment.

This feature is strictly limited to DOCUMENTING and ORGANIZING
diagnostic inputs available at baseline.
It does NOT perform diagnosis, staging, grading, prognosis, or recommendations.

----------------------------------------------------------------
SCOPE OF DATA (AUTHORITATIVE)
----------------------------------------------------------------
This feature may include, but is limited to:

1. Cytology-based diagnostics
   - FNAC / aspiration cytology
   - Specimen type and anatomical site
   - Technique used
   - Sample adequacy
   - Cytomorphological description
   - Cytology impression as documented

2. Histopathology-based diagnostics
   - Biopsy type (incisional / excisional)
   - Specimen and site
   - Microscopic description
   - Architectural and cytological features
   - Depth of invasion and margin descriptions (as documented)
   - Adverse histological features
   - Special stains performed
   - Pathology diagnosis text AS-IS (no reinterpretation)

3. Immunohistochemistry (IHC) and molecular panels
   - Panel names and dates
   - Markers tested
   - Quantitative or qualitative results (e.g., TPS %, positive/negative)
   - Assay details if provided
   - Marker groupings (epithelial, squamous, prognostic, viral, etc.)

4. Baseline laboratory and investigation references
   - Key lab values explicitly mentioned in diagnostic context
   - Tumor markers or relevant investigations cited in reports

5. Diagnostic completeness and adequacy
   - Presence or absence of expected baseline diagnostic elements
   - Sample adequacy statements
   - Missing or pending components explicitly noted

----------------------------------------------------------------
STRICT EXCLUSIONS (NON-NEGOTIABLE)
----------------------------------------------------------------
This feature MUST NOT:
- Assign or infer diagnoses beyond documented text
- Perform cancer staging, grading, or risk stratification
- Correlate findings to clinical outcomes
- Recommend further tests or treatment
- Reinterpret pathology or override report conclusions
- Perform longitudinal or follow-up comparison

----------------------------------------------------------------
ANALYTICAL INTENT
----------------------------------------------------------------
The purpose of this feature is to:
- Organize baseline diagnostic data into structured, clinician-readable form
- Preserve original diagnostic language
- Normalize terminology without altering meaning
- Clearly separate cytology, histology, IHC, and lab-derived inputs
- Identify data completeness WITHOUT judgment

All outputs must remain observational and documentational.
""",

    "Immunohistochemistry-IHC-Analysis": """
Immunohistochemistry (IHC) analytical data extraction and normalization.

This feature is LIMITED to structured, observational representation
of immunohistochemical test results only.

----------------------------------------------------------------
CORE ANALYTICAL MODES (AUTHORITATIVE)
----------------------------------------------------------------
This feature SUPPORTS MULTIPLE DISTINCT analytical modes.
Each mode represents a fundamentally different way a clinician
may review the SAME IHC data.

These modes are INDEPENDENT and MUST NOT be merged.

Valid analytical modes include:

1. COMPLETENESS & AVAILABILITY REVIEW
   - Identification of markers tested vs expected
   - Presence or absence of reported results, scores, or patterns
   - Detection of missing, partial, or unreported IHC elements

2. MARKER-ISOLATED REVIEW
   - Independent, one-by-one examination of each marker
   - No panel-level assumptions
   - No cross-marker inference during initial extraction

3. PANEL-LEVEL AGGREGATION REVIEW
   - Evaluation of the IHC panel as a whole AFTER individual extraction
   - Identification of shared or contrasting expression patterns
   - Purely descriptive aggregation (no interpretation)

4. CONTROL & TECHNICAL ADEQUACY REVIEW
   - Assessment of internal and external control reporting
   - Documentation of control adequacy, limitations, or absence
   - Separation of technical validity from marker results

5. HISTOPATHOLOGY ALIGNMENT REVIEW
   - Sequential alignment of IHC findings with described histopathology
   - Descriptive correlation ONLY
   - No diagnostic, prognostic, or causal inference

Each analytical template MUST commit to ONE primary mode.
Templates MUST NOT collapse multiple modes into a single strategy.

----------------------------------------------------------------
ALLOWED ANALYTICAL SCOPE
----------------------------------------------------------------
Focus STRICTLY on:
- Individual marker names tested
- Marker expression status (positive / negative / equivocal / not assessable)
- Quantitative scores when explicitly provided (e.g., TPS, CPS, IC score)
- Staining intensity (weak / moderate / strong) when reported
- Distribution patterns (focal / diffuse / percentage-based)
- Technical validity of internal and external controls
- Descriptive alignment with histopathology (no inference)

----------------------------------------------------------------
EXPLICITLY FORBIDDEN CONTENT
----------------------------------------------------------------
The analysis MUST NOT include:
- Diagnostic conclusions or disease labeling
- Prognostic statements or outcome implications
- Treatment implications or therapy selection
- Clinical recommendations or next-step suggestions
- Risk stratification or urgency language
- Interpretive summaries beyond restating reported findings

----------------------------------------------------------------
DATA HANDLING CONSTRAINTS
----------------------------------------------------------------
- All findings must be traceable directly to provided report data
- Do not infer meaning from marker positivity
- Do not infer disease type from marker patterns
- Do not combine analytical modes into a single narrative
- Normalize language into neutral, report-style observations


This feature produces NO clinical interpretation.
""",

    "Baseline-Radiology-RECIST-Evaluation": """
Baseline radiology evaluation with RECIST 1.1–oriented structural documentation.

This feature is LIMITED to BASELINE IMAGING DATA ONLY.

Focus on:
- Identification and documentation of measurable target lesions per RECIST 1.1
- Documentation of non-target lesions using qualitative descriptors only
- Recording of lesion measurements exactly as reported, without modification
- Association of each lesion with its imaging modality and acquisition context
- Modality-specific imaging details (CT, MRI, PET-CT) as documented in reports
- Baseline disease burden described ONLY through observed lesion number, size, location, and imaging characteristics
- Documentation of metabolic parameters (e.g., SUVmax) ONLY as reported values, without interpretation

STRICT EXCLUSIONS:
- No response assessment
- No longitudinal comparison
- No staging, grading, or disease classification
- No impression, conclusion, or diagnostic inference
- No treatment relevance or outcome prediction
- No RECIST response categorization (CR, PR, SD, PD)
- No TNM or stage labeling
- No clinical interpretation of metabolic activity

The output MUST remain:
- Observational
- Descriptive
- Measurement-faithful
- Imaging-report–aligned

All information must be traceable directly to provided imaging data.
""",

    "Response-Assessment-Follow-up": """
Follow-up response assessment and longitudinal comparison.

This feature is LIMITED to observational documentation of how
previously recorded disease-related findings change across time.

----------------------------------------------------------------
SCOPE OF THIS FEATURE
----------------------------------------------------------------
This feature focuses on FOLLOW-UP DATA ONLY.

The purpose is to:
- Compare current findings against prior documented findings
- Describe changes, stability, or variability over time
- Track measurements, signal intensity, or laboratory values
- Maintain temporal consistency across follow-up points

This feature does NOT perform response categorization.

----------------------------------------------------------------
ALLOWED DATA DIMENSIONS (AUTHORITATIVE)
----------------------------------------------------------------
Only the following types of data may be referenced:

1. Imaging follow-up data
   - Study dates
   - Modality and protocol
   - Lesion measurements
   - Quantitative imaging metrics (e.g. SUVmax)
   - Target and non-target lesion tracking
   - Presence or absence of new findings

2. Longitudinal measurement tracking
   - Baseline vs current values
   - Percentage change where explicitly provided
   - Timepoint-based value listings
   - Aggregated measurement summaries

3. Clinical and laboratory trend documentation
   - Symptom presence or change over time
   - Performance status trends
   - Tumor marker value trends
   - Weight or functional trends if explicitly recorded

4. Follow-up completeness and consistency
   - Availability or absence of baseline data
   - Missing or non-comparable follow-up elements
   - Consistency of measurement technique across visits

5. Surveillance and follow-up structure
   - Documented follow-up schedules
   - Planned or completed imaging intervals
   - Audit or update timestamps

----------------------------------------------------------------
STRICT EXCLUSIONS (NON-NEGOTIABLE)
----------------------------------------------------------------
This feature MUST NOT include:
- Response labels (e.g. partial response, progression, stable disease)
- RECIST outcome classification
- Deauville, Hopkins, or response scoring interpretation
- Treatment recommendations
- Clinical decision support
- Prognostic statements
- Any AI-generated interpretation or suggestion

If such data exists in the input, it must be ignored or neutralized.



----------------------------------------------------------------
INTENDED CLINICAL USE
----------------------------------------------------------------
This feature supports:
- Follow-up documentation
- Disease monitoring records
- Audit-ready longitudinal summaries
- Multidisciplinary review preparation

It does NOT support treatment planning or response determination.
""",

    "Toxicity-Safety-Monitoring": """
Toxicity and safety data monitoring based strictly on documented observations.

This feature is LIMITED to structured, descriptive representation of safety-related data.
It captures WHAT has been observed and documented, not WHAT it means or WHAT should be done.

------------------------------------------------------------
ALLOWED DATA SCOPE
------------------------------------------------------------
- Reported adverse events as documented (verbatim or normalized)
- Laboratory safety parameters relevant to toxicity surveillance
- Presence or absence of abnormal values
- Temporal patterns or trends as observed across timepoints
- Completeness, presence, or absence of safety documentation

------------------------------------------------------------
ANALYTICAL BOUNDARIES (STRICT)
------------------------------------------------------------
This feature MUST NOT:
- Assign toxicity grades or severity levels
- Infer clinical significance or risk
- Predict future toxicity or complications
- Recommend dose changes, supportive care, or interventions
- Suggest management actions or monitoring strategies
- Perform causality assessment or attribution
- Perform clinical interpretation or judgment

------------------------------------------------------------
ANALYTICAL INTENT
------------------------------------------------------------
The purpose is to:
- Organize safety-related observations
- Normalize terminology into neutral, descriptive language
- Present laboratory values and trends without interpretation
- Document adverse events without severity scoring
- Highlight data completeness and missing information

------------------------------------------------------------
OUTPUT CHARACTER
------------------------------------------------------------
The output is:
- Observational
- Descriptive
- Non-evaluative
- Non-predictive
- Non-directive

All statements must remain factual, time-bound, and source-based.
""",

    # ============================================================
    # 🧬 ONCOLOGY — MOLECULAR & GENOMICS
    # ============================================================

    "Molecular-Diagnostics-Summary-Report": """
Molecular diagnostics structured summary.

This feature is LIMITED to structured, observational documentation
of molecular diagnostic testing data as reported in laboratory reports.

----------------------------------------------------------------
PRIMARY OBJECTIVE
----------------------------------------------------------------
To normalize and document molecular diagnostic findings
WITHOUT interpretation, clinical judgment, or therapeutic linkage.

The output must reflect WHAT WAS TESTED and WHAT WAS REPORTED,
not WHAT IT MEANS clinically.

----------------------------------------------------------------
INCLUDED DATA DOMAINS (ALLOWED)
----------------------------------------------------------------
The analysis may include ONLY the following molecular data types
when explicitly present in the source data:

- Test methodology and platform
  (e.g., NGS, PCR, FISH, gene expression assays, liquid biopsy)

- Specimen and sample characteristics
  (e.g., tissue type, tumor content, sample adequacy, quality notes)

- Genomic regions, genes, or loci analyzed

- Detected molecular variants
  - single nucleotide variants
  - insertions / deletions
  - copy number alterations
  - gene fusions or rearrangements

- Variant-level metadata
  - exon / region
  - variant allele frequency (VAF)
  - copy number status
  - detection status (detected / not detected)

- Laboratory-provided variant classification
  (e.g., pathogenic, likely pathogenic, VUS)
  ONLY as stated in the report

- Quantitative molecular metrics
  (e.g., TMB score, MSI status)
  ONLY as numeric or categorical lab outputs

- Test limitations, coverage notes, quality flags,
  and laboratory disclaimers

- Explicitly stated absence of testing
  (e.g., "not tested", "not performed")

----------------------------------------------------------------
EXCLUDED DATA DOMAINS (STRICTLY FORBIDDEN)
----------------------------------------------------------------
The analysis MUST NOT include:

- Diagnosis or disease labeling
- Tumor type inference
- Cancer staging or grading
- Prognostic statements
- Clinical interpretation
- Actionability assessment
- Therapy or drug references
- Guidelines, tiers, or recommendations
- Follow-up or next-step suggestions
- Risk stratification or outcome prediction

If such content appears in source text,
it must be OMITTED or DOWNGRADED to a neutral observation
(e.g., "statement present in source text" without restatement).

----------------------------------------------------------------
NORMALIZATION RULES
----------------------------------------------------------------
- Preserve laboratory terminology verbatim where possible
- Convert narrative statements into structured observations
- Maintain separation between:
  - what was tested
  - what was detected
  - what was not detected
- Explicitly document missing or unavailable data
- Do not infer relationships across tests

------------------------------------------------------------
outputformat 
---------------------------------------------------------------
{{
  "feature_id": "{feature_id}",
  "feature_name": "{feature_name}",
  "possible_output_categories": []
}}

----------------------------------------------------------------
SCOPE ENFORCEMENT
----------------------------------------------------------------
This feature definition is AUTHORITATIVE.
No additional scope may be inferred.
""",

    "Molecular-Diagnostics-Targeted-Gene-Panels": """
Response assessment and follow-up documentation.

FOCUS ON:
- Documented follow-up timelines
- Recorded clinical observations over time
- Measured changes explicitly reported in follow-up data
- Comparison of sequential findings as stated in records

LIMITED TO:
- Observational follow-up documentation
- Time-based data alignment
- Reported measurements and descriptions
- Explicitly documented changes without inference

EXCLUDE:
- Response categorization (e.g., responder, non-responder)
- Outcome determination
- Prognostic assessment
- Treatment effectiveness judgment
- Clinical decision-making or recommendations
""",

    "comprehensive-tumor-profiling": """
Comprehensive tumor genomic profiling.

Focus on:
- Broad molecular alterations
- Variant landscape overview
- Test scope and limitations
- Summary of detected genomic events

No clinical actionability or treatment linkage.
""",

    "targeted-gene-panel": """
Targeted molecular gene panel review.

Focus on:
- Selected gene alterations
- Variant classification
- Panel coverage and adequacy

No clinical recommendations.
""",

    "liquid-biopsy-analysis": """
Liquid biopsy molecular analysis.

Focus on:
- Circulating tumor DNA findings
- Variant detection sensitivity
- Temporal sampling context
- Technical limitations

No disease monitoring conclusions.
""",

    "immunotherapy-biomarkers": """
Immunotherapy-related biomarker analysis.

Focus on:
- Biomarker presence or absence
- Expression patterns
- Testing methodology
- Result reliability

No prediction of therapy response.
""",

    "hereditary-cancer-panel": """
Hereditary cancer genetic panel analysis.

Focus on:
- Germline variants detected
- Variant classification
- Gene-disease association documentation
- Testing limitations

No risk estimation or counseling advice.
""",

    # ============================================================
    # 🫀 CARDIOLOGY
    # ============================================================

    "revascularization-strategy": """
Revascularization strategy analytical review.

Focus on:
- Anatomical findings
- Lesion characteristics
- Diagnostic imaging summaries
- Clinical parameter alignment

No procedural recommendations or outcome prediction.
""",

    # ============================================================
    # 🧠 AI & INTELLIGENCE
    # ============================================================

    "pattern-detector": """
Cross-variable clinical pattern detection.

Focus strictly on:
- Temporal trends (rising, falling, fluctuating values)
- Recurrent abnormalities across time or datasets
- Co-occurring deviations across parameters
- Deviations from patient baseline
- Consistency or inconsistency between data sources

PATTERN DEFINITION:
A pattern is an observable relationship in data,
not an interpretation or conclusion.

STRICT OUTPUT CONSTRAINTS:
- Describe WHAT is observed, never WHAT it implies
- No risk, severity, or concern labeling
- No causality, explanation, or inference
- No alerts, diagnoses, or conclusions
- No clinical decisions or recommendations
- No future-oriented language

Output must be observational and factual only.
""",

   "decision-analytics": """
Clinical decision-support analytics (CDSS-aligned).

PRIMARY PURPOSE:
Structured observational analytics for clinical decision support,
WITHOUT performing autonomous decisions.

SYSTEM DEFAULT OVERRIDE:
System-default analytical templates MAY extract
high-level signals from mixed clinical content,
provided they normalize all outputs into
non-decisional, observational language.

SPECIALITY ADAPTATION RULE:
The analytical framing MUST adapt to the doctor’s speciality
provided at execution time.

Speciality influences:
- Which guidelines are referenced (if applicable)
- Which risks are typically documented
- Which interactions are clinically relevant
- Which monitoring elements are emphasized
- How patient guidance is framed (non-prescriptive)

Do NOT introduce diagnoses, decisions, or speciality-specific treatments.

MANDATORY OUTPUT SECTIONS:
This feature MUST support the following sections as structured outputs:

- guideline_compliance
- drug_interactions
- risk_assessment
- immediate_considerations
- monitoring_plan
- patient_guidance
- metadata

ANALYTICAL FOCUS:
- Data consistency checks
- Rule and guideline alignment (as documented)
- Cross-variable observational logic
- Risk documentation (descriptive only)
- Monitoring and follow-up completeness
- Data provenance and traceability

SCOPE LIMITATIONS (STRICT):
- No diagnosis confirmation
- No staging, grading, or prognosis
- No treatment selection or modification
- No triage or prioritization
- No autonomous clinical decisions

OUTPUT NATURE:
Observational and documentational only.
""",

    "corelation-analysis": """
Correlation analysis across clinical variables.

Focus on:
- Statistical co-variation
- Temporal relationships
- Parameter associations

No causality or inference claims.
""",

    "patient-data-summary": """
Comprehensive patient clinical summary.

Focus on:
- Condensed multi-source data
- Timeline-based organization
- Objective summarization

No interpretation beyond data aggregation.
""",

    # ============================================================
    # 🩺 NEPHROLOGY
    # ============================================================

    "kdigo-care-compliance-checker": """
KDIGO guideline compliance evaluation.

Focus on:
- Documentation completeness
- Monitoring parameter presence
- Temporal alignment with KDIGO guidance

No risk stratification or treatment advice.
""",

    # ============================================================
    # 📝 DOCUMENTATION
    # ============================================================

"documentation-treatment-plan": """
Structured treatment plan documentation definition.

PRIMARY PURPOSE
----------------------------------------------------------------
Defines a STANDARD, CONSISTENT STRUCTURE
for documenting treatment plans
in outpatient and inpatient clinical records.

This feature concerns DOCUMENTATION STRUCTURE ONLY
and provides a neutral organizational framework
without influencing analysis, rules, or presentation.

----------------------------------------------------------------
SCOPE BOUNDARY (STRICT)
----------------------------------------------------------------
This feature is STRICTLY DOCUMENTATIONAL.

It performs:
- NO clinical interpretation or reasoning
- NO assessment or diagnostic inference
- NO recommendations or optimization
- NO rule-specific logic

The system MUST NOT generate, infer, populate,
or transform treatment plan content.

----------------------------------------------------------------
STRUCTURAL ROLE
----------------------------------------------------------------
The treatment plan is a SINGLE, COMPLETE documentation unit.

All rules or presentation styles:
- Access the FULL treatment plan
- Use the SAME structure
- Differ ONLY in style or emphasis

Structure does NOT vary by rule.

----------------------------------------------------------------
TREATMENT PLAN DOCUMENTATION SECTIONS
----------------------------------------------------------------
The following identifiers represent STANDARD
documentation headings for organizing
explicitly recorded treatment plan content.

1. planned_therapies  
2. expected_duration  
3. follow_up_timeline  
4. supportive_measures  
5. additional_notes  

These sections are neutral containers only.

----------------------------------------------------------------
INPUT HANDLING RULES
----------------------------------------------------------------
The system may receive:
- Medication orders
- Investigation notes
- Treatment plans
- Clinical or discharge notes
- Transcribed planning narratives

The system MUST:
- Use ONLY explicitly documented information
- Ignore implied or unstated meaning
- Never infer missing content
- Never convert documentation into recommendations

----------------------------------------------------------------
OUTPUT RULES (MANDATORY)
----------------------------------------------------------------
Return ONLY a LIST of SECTION DESCRIPTORS.

Each section MUST include:
- section_id
- section_name
- description

The system MUST NOT:
- Populate content
- Create schemas or nested objects
- Add examples or narrative text
- Bind structure to rules or logic

----------------------------------------------------------------
CLINICAL SAFETY GUARANTEE
----------------------------------------------------------------
This feature produces:
- NO clinical interpretation
- NO treatment reasoning
- NO recommendations
"""


,

"documentation-treatment-summary": """
Structured treatment summary section definition and normalization.

PRIMARY PURPOSE
----------------------------------------------------------------
This feature defines the STANDARD SECTION HEADINGS
used for documenting treatment summaries
in outpatient or inpatient clinical records.

This task concerns SECTION STRUCTURE ONLY.

The system defines and returns authoritative
treatment summary sections in a structured,
clinician-readable format.

----------------------------------------------------------------
SCOPE BOUNDARY (STRICT)
----------------------------------------------------------------
This feature is STRICTLY DOCUMENTATIONAL.

It performs:
- NO clinical interpretation
- NO assessment
- NO diagnostic inference
- NO treatment planning
- NO recommendations
- NO medication modification
- NO clinical reasoning

The system MUST NOT generate, infer, or populate
any treatment content.

----------------------------------------------------------------
SECTION AUTHORITY (CRITICAL)
----------------------------------------------------------------
The following are the ONLY VALID SECTIONS
for the Treatment Summary feature.

Each section represents a TOP-LEVEL
TREATMENT DOCUMENTATION HEADING.

These are NOT schemas.
These are NOT populated objects.
These are NOT clinical narratives.

----------------------------------------------------------------
AUTHORITATIVE TREATMENT SUMMARY SECTIONS
----------------------------------------------------------------

1. treated_condition
   Documents the condition(s) for which treatment
   was provided, as explicitly stated.

2. medication_details
   Documents medications prescribed or administered,
   including names, dosage forms, strength,
   frequency, route, and duration.

3. administration_instructions
   Documents recorded instructions related to
   how medications should be taken.

4. supportive_care_measures
   Documents non-pharmacological supportive measures
   explicitly recorded, such as hydration,
   rest, or symptomatic care.

5. refills_or_continuation
   Documents any explicitly stated refill,
   continuation, or extension instructions.

6. monitoring_or_follow_up
   Documents monitoring instructions or
   follow-up timelines explicitly recorded.

7. lifestyle_advice
   Documents general or lifestyle-related advice
   explicitly provided.

----------------------------------------------------------------
INPUT HANDLING RULES
----------------------------------------------------------------
The system may receive:
- Clinical notes
- Prescription summaries
- Discharge notes
- Transcribed treatment narratives

The system MUST:
- Use ONLY explicitly documented concepts
- Ignore interpretation, reasoning, or intent
- Never convert advice into recommendations
- Never infer missing sections

----------------------------------------------------------------
NAMING AND OUTPUT RULES (MANDATORY)
----------------------------------------------------------------
The output MUST be a LIST of SECTION DESCRIPTORS.

Each section MUST be represented as an object with:
- section_id   (snake_case identifier)
- section_name (human-readable UI title)
- description  (concise, neutral purpose statement)

The section_id MUST EXACTLY MATCH one of the
authoritative sections listed above.

The system MUST NOT:
- Populate section content
- Create nested objects
- Define schemas or fields
- Add examples
- Summarize treatments
- Generate narrative summaries

----------------------------------------------------------------
OUTPUT EXPECTATION (STRICT)
----------------------------------------------------------------
Return ONLY a structured list of section descriptors
under possible_output_categories.

No raw strings.
No populated data.
No clinical content.

----------------------------------------------------------------
CLINICAL SAFETY GUARANTEE
----------------------------------------------------------------
This feature produces:
- NO clinical interpretation
- NO treatment reasoning
- NO recommendations
- NO clinical insight
""",

 
"documentation-medication-analysis": """
Structured medication section definition and normalization.

PRIMARY PURPOSE
----------------------------------------------------------------
This feature defines the STANDARD SECTION HEADINGS
used for documenting medications
in outpatient or inpatient clinical records.

This task concerns SECTION STRUCTURE ONLY.

The system defines and returns authoritative
medication documentation sections
in a structured, clinician-readable format.

----------------------------------------------------------------
SCOPE BOUNDARY (STRICT)
----------------------------------------------------------------
This feature is STRICTLY DOCUMENTATIONAL.

It performs:
- NO pharmacological analysis
- NO specialty-specific interpretation
- NO drug classification or indication inference
- NO safety, interaction, or contraindication checking
- NO clinical reasoning or commentary

The system MUST NOT generate, infer, or populate
any medication content.

----------------------------------------------------------------
SECTION AUTHORITY (CRITICAL)
----------------------------------------------------------------
The following are the ONLY VALID SECTIONS
for the Medication Documentation feature.

Each section represents a TOP-LEVEL
MEDICATION DOCUMENTATION HEADING.

These are NOT schemas.
These are NOT populated objects.
These are NOT clinical narratives.
----------------------------------------------------------------
AUTHORITATIVE MEDICATION DOCUMENTATION SECTIONS
----------------------------------------------------------------

GLOBAL ROW MODEL (MANDATORY)
Medications MUST be documented as a Medication List
consisting of independent medication entries.
Each entry represents exactly ONE medication.
No section may aggregate values across entries.

1. medication_name
   Documents exactly ONE drug or product name
   within the same medication entry.

2. medication_dose
   Documents the prescribed dose corresponding
   to the medication in the same entry only.

3. medication_route
   Documents the route of administration
   for the medication in the same entry only.

4. medication_frequency
   Documents the administration frequency
   for the medication in the same entry only.

5. medication_duration
   Documents the duration of therapy
   for the medication in the same entry only.

6. medication_brand_name
   Documents the brand name if explicitly recorded
   for the medication in the same entry only.

7. medication_composition
   Documents the drug composition if explicitly recorded
   for the medication in the same entry only.

8. medication_review_after_days
   Documents review or follow-up interval in days
   if explicitly documented for the medication entry.

----------------------------------------------------------------
INPUT HANDLING RULES
----------------------------------------------------------------
The system may receive:
- Prescriptions
- Medication lists
- Clinical notes
- Discharge summaries

The system MUST:
- Use ONLY explicitly documented concepts
- Ignore interpretation, reasoning, or intent
- Never infer missing medication data
- Never evaluate correctness or appropriateness

----------------------------------------------------------------
NAMING AND OUTPUT RULES (MANDATORY)
----------------------------------------------------------------
The output MUST be a LIST of SECTION DESCRIPTORS.

Each section MUST be represented as an object with:
- section_id   (snake_case identifier)
- section_name (human-readable UI title)
- description  (concise, neutral purpose statement)

The section_id MUST EXACTLY MATCH one of the
authoritative sections listed above.

The system MUST NOT:
- Populate medication values
- Create nested objects
- Define schemas or internal fields
- Add examples
- Perform extraction or normalization
- Generate narrative summaries

----------------------------------------------------------------
OUTPUT EXPECTATION (STRICT)
----------------------------------------------------------------
Return ONLY a structured list of section descriptors
under possible_output_categories.

No raw strings.
No populated data.
No clinical content.

----------------------------------------------------------------
CLINICAL SAFETY GUARANTEE
----------------------------------------------------------------
This feature produces:
- NO pharmacological interpretation
- NO medication advice
- NO safety analysis
- NO specialty attribution
"""
,
"documentation-investigation-notes": """
Structured investigation order section definition and normalization.

PRIMARY PURPOSE
----------------------------------------------------------------
This feature defines the STANDARD SECTION HEADINGS
used for documenting investigation orders
in outpatient or inpatient clinical records.

This task concerns SECTION STRUCTURE ONLY.

The system defines and returns authoritative
investigation order sections
in a structured, clinician-readable format.

----------------------------------------------------------------
SCOPE BOUNDARY (STRICT)
----------------------------------------------------------------
This feature is STRICTLY DOCUMENTATIONAL.

It performs:
- NO clinical interpretation
- NO diagnostic inference
- NO test appropriateness evaluation
- NO prioritization or optimization
- NO clinical justification
- NO specialty-specific reasoning

The system MUST NOT generate, infer, or populate
any investigation-related content.

----------------------------------------------------------------
SECTION AUTHORITY (CRITICAL)
----------------------------------------------------------------
The following are the ONLY VALID SECTIONS
for the Investigation Orders feature.

Each section represents a TOP-LEVEL
INVESTIGATION DOCUMENTATION HEADING.

These are NOT schemas.
These are NOT populated objects.
These are NOT clinical narratives.

----------------------------------------------------------------
AUTHORITATIVE INVESTIGATION ORDER SECTIONS
----------------------------------------------------------------

1. laboratory_investigations
   Documents laboratory investigations
   that were ordered, as explicitly recorded.

2. imaging_investigations
   Documents imaging or radiological investigations
   that were ordered, as explicitly recorded.

3. other_investigations
   Documents other investigations, procedures,
   or non-laboratory/non-imaging orders
   explicitly recorded.

4. investigation_metadata
   Documents metadata related to investigation
   documentation, such as timing or notes,
   when explicitly stated.

----------------------------------------------------------------
INPUT HANDLING RULES
----------------------------------------------------------------
The system may receive:
- Investigation orders
- Clinical notes
- Discharge summaries
- Transcribed investigation narratives

The system MUST:
- Use ONLY explicitly documented concepts
- Ignore interpretation, reasoning, or intent
- Never infer missing investigation sections
- Never reclassify or evaluate orders

----------------------------------------------------------------
NAMING AND OUTPUT RULES (MANDATORY)
----------------------------------------------------------------
The output MUST be a LIST of SECTION DESCRIPTORS.

Each section MUST be represented as an object with:
- section_id   (snake_case identifier)
- section_name (human-readable UI title)
- description  (concise, neutral purpose statement)

The section_id MUST EXACTLY MATCH one of the
authoritative sections listed above.

The system MUST NOT:
- Populate investigation data
- Create nested objects
- Define schemas or fields
- Add examples
- Summarize or interpret orders

----------------------------------------------------------------
OUTPUT EXPECTATION (STRICT)
----------------------------------------------------------------
Return ONLY a structured list of section descriptors
under possible_output_categories.

No raw strings.
No populated data.
No clinical content.

----------------------------------------------------------------
CLINICAL SAFETY GUARANTEE
----------------------------------------------------------------
This feature produces:
- NO clinical interpretation
- NO diagnostic reasoning
- NO recommendations
- NO clinical insight
"""
,

"documentation-clinical-notes": """
Structured clinical note section definition and normalization.

PRIMARY PURPOSE
----------------------------------------------------------------
This feature defines the STANDARD SECTION HEADINGS
used for documenting clinical notes
in outpatient or inpatient clinical records.

This task concerns SECTION STRUCTURE ONLY.

The system defines and returns authoritative
clinical note sections in a structured,
clinician-readable format.

----------------------------------------------------------------
SCOPE BOUNDARY (STRICT)
----------------------------------------------------------------
This feature is STRICTLY DOCUMENTATIONAL.

It performs:
- NO clinical interpretation
- NO diagnostic inference
- NO treatment planning
- NO recommendations
- NO specialty-based reasoning
- NO clinical judgment

The system MUST NOT generate, infer, or populate
any clinical note content.

----------------------------------------------------------------
SECTION AUTHORITY (CRITICAL)
----------------------------------------------------------------
The following are the ONLY VALID SECTIONS
for the Clinical Notes feature.

Each section represents a TOP-LEVEL
CLINICAL DOCUMENTATION HEADING.

These are NOT schemas.
These are NOT populated objects.
These are NOT clinical narratives.

----------------------------------------------------------------
AUTHORITATIVE CLINICAL NOTE SECTIONS
----------------------------------------------------------------

1. subjective
   Documents patient-reported symptoms,
   complaints, and history as explicitly stated.

2. objective
   Documents observed clinical findings,
   examination details, and recorded test results
   exactly as documented.

3. assessment
   Documents diagnoses or clinical assessments
   explicitly recorded by the clinician.

4. plan
   Documents treatments, medications,
   investigations, and actions explicitly recorded.

5. diagnosis_summary
   Documents diagnosis summaries including
   ICD-10 codes when explicitly provided.

6. procedures_and_investigations
   Documents procedures and investigations
   including CPT codes when explicitly provided.

7. laboratory_analysis
   Documents laboratory findings including
   LOINC codes and stated interpretations
   when explicitly provided.

8. system_overviews
   Documents system- or specialty-specific
   overviews (e.g., cardiac function overview)
   when explicitly stated.

9. insurance_and_administrative
   Documents insurance or administrative
   considerations when explicitly recorded.

10. metadata
    Documents metadata related to documentation
    timing, department, source, or model details.

----------------------------------------------------------------
INPUT HANDLING RULES
----------------------------------------------------------------
The system may receive:
- Clinical notes
- SOAP notes
- Transcribed dictations
- Discharge summaries

The system MUST:
- Use ONLY explicitly documented concepts
- Ignore interpretation, reasoning, or intent
- Never infer missing sections
- Never normalize or validate clinical content

----------------------------------------------------------------
NAMING AND OUTPUT RULES (MANDATORY)
----------------------------------------------------------------
The output MUST be a LIST of SECTION DESCRIPTORS.

Each section MUST be represented as an object with:
- section_id   (snake_case identifier)
- section_name (human-readable UI title)
- description  (concise, neutral purpose statement)

The section_id MUST EXACTLY MATCH one of the
authoritative sections listed above.

The system MUST NOT:
- Populate section content
- Create nested objects
- Define schemas or internal fields
- Add examples
- Summarize or rewrite notes
- Generate narrative text

----------------------------------------------------------------
OUTPUT EXPECTATION (STRICT)
----------------------------------------------------------------
Return ONLY a structured list of section descriptors
under possible_output_categories.

No raw strings.
No populated data.
No clinical content.

----------------------------------------------------------------
CLINICAL SAFETY GUARANTEE
----------------------------------------------------------------
This feature produces:
- NO clinical interpretation
- NO diagnostic reasoning
- NO recommendations
- NO clinical insight
"""
,

    "lab-report-retriever": """
Structured laboratory report extraction and normalization.

PRIMARY PURPOSE
----------------------------------------------------------------
This feature defines the STANDARD REPORT SECTIONS
used for documenting laboratory reports in a
structured, clinician-readable format.

This task concerns REPORT STRUCTURE ONLY.

This feature documents, at a section level:
- WHAT was tested
- WHEN it was tested
- WHAT was reported

WITHOUT inferring meaning, significance, trends,
clinical relevance, or actionability.

----------------------------------------------------------------
SCOPE BOUNDARY (STRICT)
----------------------------------------------------------------
This feature is STRICTLY OBSERVATIONAL and DOCUMENTATIONAL.

It performs:
- NO analysis
- NO interpretation
- NO clinical reasoning
- NO correlation
- NO recommendations

----------------------------------------------------------------
SECTION AUTHORITY (CRITICAL)
----------------------------------------------------------------
The following are the ONLY VALID REPORT SECTIONS
for this feature.

Each section represents a TOP-LEVEL REPORT HEADING
that will be populated later by structured data.

These are NOT data schemas.
These are NOT field definitions.
These are NOT populated objects.

----------------------------------------------------------------
AUTHORITATIVE REPORT SECTIONS
----------------------------------------------------------------

1. test_identification  
   Identifies the laboratory tests and panels as reported,
   including specimen and timing information.

2. quantitative_results  
   Captures numeric laboratory values, units,
   reference ranges, and laboratory-reported flags.

3. qualitative_results  
   Captures textual, categorical, or narrative
   laboratory results exactly as reported.

4. panel_structure  
   Describes how laboratory tests are grouped
   and ordered within reported panels.

5. microbiology_data  
   Documents culture, organism identification,
   and sensitivity information when reported.

6. laboratory_metadata  
   Captures laboratory source information,
   accession details, and processing notes.

7. data_completeness_indicators  
   Documents explicitly reported missing,
   pending, or incomplete laboratory data.

----------------------------------------------------------------
NAMING AND OUTPUT RULES (MANDATORY)
----------------------------------------------------------------
- Treat each section as a REPORT HEADING ONLY
- Do NOT define internal fields
- Do NOT generate schemas
- Do NOT populate values
- Do NOT reference configuration or extraction modes
- Do NOT include examples or data

----------------------------------------------------------------
OUTPUT EXPECTATION (STRICT)
----------------------------------------------------------------
When asked to define output categories, this feature
MUST return a list of structured section descriptors.

Each section MUST be represented as an object with:
- section_id   (snake_case identifier)
- section_name (human-readable title)
- description  (concise clinical description)

The section_id MUST exactly match one of the
authoritative report sections listed above.

The section_name MUST be a readable expansion
of the section_id suitable for UI display.

The description MUST summarize the purpose
of the section in observational, non-interpretive language.

Do NOT return raw strings.
Do NOT return schemas.
Do NOT return populated data.

This feature produces
NO clinical interpretation,
NO clinical insight,
and NO clinical recommendation.


This feature produces
NO clinical interpretation,
NO clinical insight,
and NO clinical recommendation.
""",
"xray-report-retriever": """
Structured X-ray report section extraction and normalization.

PRIMARY PURPOSE
----------------------------------------------------------------
This feature defines the STANDARD REPORT SECTIONS
used for documenting plain radiography (X-ray) reports
in a structured, clinician-readable format.

This task concerns REPORT STRUCTURE ONLY.

The system extracts and organizes information
from unstructured or semi-structured radiology content
(e.g., narrative text or JSON fields)
into standardized report section headings.

----------------------------------------------------------------
SCOPE BOUNDARY (STRICT)
----------------------------------------------------------------
This feature is STRICTLY OBSERVATIONAL and DOCUMENTATIONAL.

It performs:
- NO clinical analysis
- NO interpretation
- NO diagnostic inference
- NO severity grading
- NO clinical correlation
- NO recommendations or follow-up advice
- NO modification or rewriting of source meaning

The system MUST NOT add, infer, transform, or reinterpret
any medical content beyond organizing it into sections.

----------------------------------------------------------------
SECTION AUTHORITY (CRITICAL)
----------------------------------------------------------------
The following are the ONLY VALID REPORT SECTIONS
for this feature.

Each section represents a TOP-LEVEL REPORT HEADING
that may be populated later by downstream systems.

These are NOT schemas.
These are NOT field definitions.
These are NOT populated data objects.

----------------------------------------------------------------
AUTHORITATIVE REPORT SECTIONS
----------------------------------------------------------------

1. study_identification  
   Identifies the X-ray study performed, including
   documented anatomical region, laterality,
   projections/views, study date, and stated indication.

2. technical_details  
   Documents how the study was performed, including
   positioning, number of views, exposure notes,
   or stated technical limitations.

3. anatomical_observations  
   Captures descriptive observations of visualized
   bones, joints, soft tissues, and structures
   exactly as reported, without interpretation.

4. abnormal_findings  
   Documents reported abnormalities using neutral,
   descriptive language exactly as stated in the source.

5. normal_findings  
   Documents explicitly stated normal or unremarkable
   findings when reported.

6. comparison_information  
   Captures any prior study references or comparison
   statements exactly as documented, without assessing
   change or progression.

7. radiology_metadata  
   Captures reporting-related information such as
   radiologist, facility, timestamps, or study identifiers
   when explicitly stated.

8. data_completeness_indicators  
   Documents explicitly reported limitations such as
   missing views, motion artifacts, limited exams,
   or incomplete studies.

----------------------------------------------------------------
INPUT HANDLING RULES
----------------------------------------------------------------
The system may receive:
- Free-text radiology reports
- Semi-structured narratives
- JSON-based radiology outputs containing fields such as
  findings, impression, metadata, or recommendations

The system MUST:
- Use ONLY the information explicitly present
- Ignore recommendations, impressions, or assessments
  unless they contain purely descriptive observations
- Never convert impressions into diagnoses
- Never restate conclusions as findings

----------------------------------------------------------------
NAMING AND OUTPUT RULES (MANDATORY)
----------------------------------------------------------------
When defining output categories, the system MUST return
a LIST of SECTION DESCRIPTORS.

Each section MUST be represented as an object with:
- section_id   (snake_case identifier)
- section_name (human-readable UI title)
- description  (concise, neutral purpose statement)

The section_id MUST EXACTLY MATCH one of the
authoritative report sections listed above.

The system MUST NOT:
- Populate section content
- Define internal fields
- Generate schemas
- Add examples
- Summarize or interpret findings
- Introduce clinical meaning

----------------------------------------------------------------
OUTPUT EXPECTATION (STRICT)
----------------------------------------------------------------
The output MUST be a structured list of section descriptors.
No raw strings.
No populated medical data.
No clinical conclusions.

----------------------------------------------------------------
CLINICAL SAFETY GUARANTEE
----------------------------------------------------------------
This feature produces:
- NO clinical interpretation
- NO diagnostic labeling
- NO severity assessment
- NO clinical insight
- NO clinical recommendation
""",

"ct-report-retriever": """
Structured CT scan report section extraction and normalization.

PRIMARY PURPOSE
----------------------------------------------------------------
This feature defines the STANDARD REPORT SECTIONS
used for documenting computed tomography (CT) scan reports
in a structured, clinician-readable format.

This task concerns REPORT STRUCTURE ONLY.

The system extracts and organizes information
from unstructured or semi-structured radiology content
(e.g., narrative text or JSON fields)
into standardized report section headings.

----------------------------------------------------------------
SCOPE BOUNDARY (STRICT)
----------------------------------------------------------------
This feature is STRICTLY OBSERVATIONAL and DOCUMENTATIONAL.

It performs:
- NO clinical analysis
- NO interpretation
- NO diagnostic inference
- NO severity grading
- NO clinical correlation
- NO recommendations or follow-up advice
- NO modification or rewriting of source meaning

The system MUST NOT add, infer, transform, or reinterpret
any medical content beyond organizing it into sections.

----------------------------------------------------------------
SECTION AUTHORITY (CRITICAL)
----------------------------------------------------------------
The following are the ONLY VALID REPORT SECTIONS
for this feature.

Each section represents a TOP-LEVEL REPORT HEADING
that may be populated later by downstream systems.

These are NOT schemas.
These are NOT field definitions.
These are NOT populated data objects.

----------------------------------------------------------------
AUTHORITATIVE REPORT SECTIONS
----------------------------------------------------------------

1. study_identification  
   Identifies the CT study performed, including
   documented anatomical region, scan protocol,
   study date, and stated indication.

2. technical_details  
   Documents how the CT study was performed,
   including acquisition technique, slice thickness,
   reconstruction details, and stated technical limitations.

3. contrast_information  
   Captures explicitly stated contrast usage,
   including type, route, phase, or absence of contrast.

4. anatomical_observations  
   Captures descriptive observations of visualized
   organs, structures, and anatomical regions
   exactly as reported, without interpretation.

5. abnormal_findings  
   Documents reported abnormalities using neutral,
   descriptive language exactly as stated in the source.

6. normal_findings  
   Documents explicitly stated normal or unremarkable
   findings when reported.

7. comparison_information  
   Captures any prior study references or comparison
   statements exactly as documented, without assessing
   change or progression.

8. radiology_metadata  
   Captures reporting-related information such as
   radiologist, facility, timestamps, accession numbers,
   or study identifiers when explicitly stated.

9. data_completeness_indicators  
   Documents explicitly reported limitations such as
   motion artifacts, limited field of view,
   incomplete coverage, or technically limited studies.

----------------------------------------------------------------
INPUT HANDLING RULES
----------------------------------------------------------------
The system may receive:
- Free-text CT scan reports
- Semi-structured radiology narratives
- JSON-based radiology outputs containing fields such as
  findings, impression, metadata, or recommendations

The system MUST:
- Use ONLY the information explicitly present
- Ignore impressions, conclusions, or assessments
  unless they contain purely descriptive observations
- Never convert impressions into diagnoses
- Never restate conclusions as findings

----------------------------------------------------------------
NAMING AND OUTPUT RULES (MANDATORY)
----------------------------------------------------------------
When defining output categories, the system MUST return
a LIST named **possible_output_categories**.

Each item in the list MUST be an object containing:
- section_id   (snake_case identifier)
- section_name (human-readable UI title)
- description  (concise, neutral purpose statement)

The section_id MUST EXACTLY MATCH one of the
authoritative report sections listed above.

The system MUST NOT:
- Use numeric section identifiers
- Populate section content
- Define internal fields
- Generate schemas
- Add examples
- Summarize or interpret findings
- Introduce clinical meaning

----------------------------------------------------------------
OUTPUT EXPECTATION (STRICT)
----------------------------------------------------------------
The output MUST EXACTLY MATCH this structure:

{
  "feature_output_categories": {
    "feature_id": "ct-report-retriever",
    "feature_name": "CT Scan Report Retriever",
    "possible_output_categories": [ ... ]
  }
}

No alternate keys.
No raw strings.
No populated medical data.
No clinical conclusions.

----------------------------------------------------------------
CLINICAL SAFETY GUARANTEE
----------------------------------------------------------------
This feature produces:
- NO clinical interpretation
- NO diagnostic labeling
- NO severity assessment
- NO clinical insight
- NO clinical recommendation
"""
,

"mri-report-retriever": """
Structured MRI report section extraction and normalization.

PRIMARY PURPOSE
----------------------------------------------------------------
Defines STANDARD REPORT SECTIONS for magnetic resonance imaging (MRI)
documentation in a structured, clinician-readable format.

This task concerns REPORT STRUCTURE ONLY.

----------------------------------------------------------------
SCOPE BOUNDARY (STRICT)
----------------------------------------------------------------
STRICTLY OBSERVATIONAL and DOCUMENTATIONAL.

Performs:
- NO interpretation
- NO diagnostic reasoning
- NO severity grading
- NO clinical recommendations

----------------------------------------------------------------
AUTHORITATIVE REPORT SECTIONS
----------------------------------------------------------------

1. study_identification  
2. technical_details  
3. sequence_information  
4. contrast_information  
5. anatomical_observations  
6. abnormal_findings  
7. normal_findings  
8. comparison_information  
9. radiology_metadata  
10. data_completeness_indicators  

----------------------------------------------------------------
INPUT HANDLING RULES
----------------------------------------------------------------
- Preserve wording exactly as reported
- Ignore impressions unless purely descriptive
- Never infer disease or severity

----------------------------------------------------------------
OUTPUT EXPECTATION
----------------------------------------------------------------
Structured list of section descriptors only.
No medical content population.

----------------------------------------------------------------
CLINICAL SAFETY GUARANTEE
----------------------------------------------------------------
NO interpretation. NO diagnosis. NO inference.
""",

"ultrasound-report-retriever": """
Structured ultrasound report section extraction and normalization.

PRIMARY PURPOSE
----------------------------------------------------------------
Defines STANDARD REPORT SECTIONS for ultrasound imaging
documentation in a structured format.

----------------------------------------------------------------
SCOPE BOUNDARY (STRICT)
----------------------------------------------------------------
STRICTLY OBSERVATIONAL and DOCUMENTATIONAL.

Performs:
- NO interpretation
- NO diagnostic inference
- NO clinical correlation

----------------------------------------------------------------
AUTHORITATIVE REPORT SECTIONS
----------------------------------------------------------------

1. study_identification  
2. technical_details  
3. anatomical_observations  
4. abnormal_findings  
5. normal_findings  
6. doppler_observations  
7. comparison_information  
8. radiology_metadata  
9. data_completeness_indicators  

----------------------------------------------------------------
INPUT HANDLING RULES
----------------------------------------------------------------
- Use ONLY explicitly documented observations
- Doppler data MUST remain descriptive
- Never infer pathology

----------------------------------------------------------------
OUTPUT EXPECTATION
----------------------------------------------------------------
Section descriptors only.
No populated content.

----------------------------------------------------------------
CLINICAL SAFETY GUARANTEE
----------------------------------------------------------------
Produces NO diagnostic or clinical interpretation.
""",
"pet-scan-report-retriever": """
Structured PET scan report section extraction and normalization.

PRIMARY PURPOSE
----------------------------------------------------------------
Defines STANDARD REPORT SECTIONS for positron emission tomography (PET)
documentation.

----------------------------------------------------------------
SCOPE BOUNDARY (STRICT)
----------------------------------------------------------------
STRICTLY OBSERVATIONAL and DOCUMENTATIONAL.

Performs:
- NO metabolic interpretation
- NO malignancy inference
- NO staging
- NO treatment assessment

----------------------------------------------------------------
AUTHORITATIVE REPORT SECTIONS
----------------------------------------------------------------

1. study_identification  
2. technical_details  
3. tracer_information  
4. uptake_observations  
5. abnormal_findings  
6. normal_findings  
7. comparison_information  
8. radiology_metadata  
9. data_completeness_indicators  

----------------------------------------------------------------
INPUT HANDLING RULES
----------------------------------------------------------------
- SUV values are descriptive ONLY
- No interpretation of uptake patterns
- Never infer disease status

----------------------------------------------------------------
OUTPUT EXPECTATION
----------------------------------------------------------------
Section descriptor list only.
No clinical conclusions.

----------------------------------------------------------------
CLINICAL SAFETY GUARANTEE
----------------------------------------------------------------
NO interpretation. NO staging. NO assessment.
""",

"ecg-report-retriever": """
Structured ECG report section extraction and normalization.

PRIMARY PURPOSE
----------------------------------------------------------------
This feature defines the STANDARD REPORT SECTIONS
used for documenting electrocardiogram (ECG) reports
in a structured, clinician-readable format.

This task concerns REPORT STRUCTURE ONLY.

The system extracts and organizes information
from unstructured or semi-structured ECG content
(e.g., narrative ECG reports or machine-generated text)
into standardized report section headings.

----------------------------------------------------------------
SCOPE BOUNDARY (STRICT)
----------------------------------------------------------------
This feature is STRICTLY OBSERVATIONAL and DOCUMENTATIONAL.

It performs:
- NO rhythm interpretation
- NO diagnostic inference
- NO severity grading
- NO clinical correlation
- NO recommendations or follow-up advice
- NO modification or rewriting of source meaning

The system MUST NOT add, infer, transform, or reinterpret
any ECG data beyond organizing it into sections.

----------------------------------------------------------------
SECTION AUTHORITY (CRITICAL)
----------------------------------------------------------------
The following are the ONLY VALID REPORT SECTIONS
for this feature.

Each section represents a TOP-LEVEL REPORT HEADING
that may be populated later by downstream systems.

These are NOT schemas.
These are NOT field definitions.
These are NOT populated data objects.

----------------------------------------------------------------
AUTHORITATIVE REPORT SECTIONS
----------------------------------------------------------------

1. study_identification  
   Identifies the ECG study performed, including
   acquisition date/time, lead configuration,
   stated indication, and patient context if documented.

2. technical_details  
   Documents ECG acquisition parameters such as
   paper speed, gain, filter settings, lead placement,
   or recording conditions when explicitly stated.

3. waveform_observations  
   Captures purely descriptive observations of ECG waveforms
   (P wave, QRS complex, ST segment, T wave morphology)
   exactly as reported, without interpretation.

4. interval_measurements  
   Documents reported numerical ECG intervals and durations
   (e.g., PR interval, QRS duration, QT/QTc values)
   exactly as stated in the source.

5. abnormal_findings  
   Documents explicitly stated abnormal ECG observations
   using neutral, descriptive language exactly as reported.

6. normal_findings  
   Documents explicitly stated normal or unremarkable
   ECG findings when reported.

7. comparison_information  
   Captures any references to prior ECGs or comparison
   statements exactly as documented, without assessing change.

8. cardiology_metadata  
   Captures reporting-related information such as
   interpreting physician, device, facility,
   timestamps, or report identifiers when stated.

9. data_completeness_indicators  
   Documents explicitly reported limitations such as
   poor signal quality, lead artifact, missing leads,
   or incomplete recordings.

----------------------------------------------------------------
INPUT HANDLING RULES
----------------------------------------------------------------
The system may receive:
- Free-text ECG reports
- Semi-structured ECG narratives
- Machine-generated ECG summaries
- JSON-based ECG outputs

The system MUST:
- Use ONLY information explicitly present
- Ignore automated interpretations or conclusions
- Never convert machine impressions into diagnoses
- Never label rhythms, ischemia, or conduction blocks

----------------------------------------------------------------
NAMING AND OUTPUT RULES (MANDATORY)
----------------------------------------------------------------
When defining output categories, the system MUST return
a LIST of SECTION DESCRIPTORS.

Each section MUST be represented as an object with:
- section_id   (snake_case identifier)
- section_name (human-readable UI title)
- description  (concise, neutral purpose statement)

The section_id MUST EXACTLY MATCH one of the
authoritative report sections listed above.

The system MUST NOT:
- Populate section content
- Define internal fields
- Generate schemas
- Add examples
- Summarize or interpret ECG data
- Introduce clinical meaning

----------------------------------------------------------------
OUTPUT EXPECTATION (STRICT)
----------------------------------------------------------------
The output MUST be a structured list of section descriptors.
No raw strings.
No populated medical data.
No clinical conclusions.

----------------------------------------------------------------
CLINICAL SAFETY GUARANTEE
----------------------------------------------------------------
This feature produces:
- NO rhythm interpretation
- NO diagnostic labeling
- NO severity assessment
- NO clinical insight
- NO clinical recommendation
""",

"current-clinical-context": """
I want you to act as a senior, multidisciplinary clinician reviewing a
patient’s current presenting condition for a single clinical encounter,
based strictly on screening data or an initial clinical conversation.

Using only the provided complaint, symptoms, vitals, and preliminary
findings, generate a focused yet comprehensive current clinical context
that explains what is most likely happening now.

Strict data integrity and safety rules must be followed:
– Use only information explicitly provided in the screening data or
  conversation.
– Do not assume, infer, fabricate, or hallucinate symptoms, diagnoses,
  disease stages, timelines, risks, or comorbidities.
– Do not introduce population-based expectations.
– Do not state “no data available” if relevant data is present.
– If information is genuinely missing, explicitly label it as missing
  and explain why it is clinically important.
– Ensure all relevant provided data is included with no clinically
  meaningful omission.

Identify and clearly outline, based solely on available data:
– The most relevant conditions or differential diagnoses directly
  indicated by the current presentation.
– Possible underlying causes and contributing factors, including
  pathophysiology, comorbidities, medications, lifestyle factors, or
  recent events, only where supported by the data.
– Probable disease stage or severity only when explicit staging
  indicators are present.
– Early indicators influencing prognosis or clinical risk only when
  supported by documented evidence.

Incorporate cross-specialty considerations using available information
only, including medical, surgical, cardiology, respiratory, endocrine,
neurology, psychiatry, infectious disease, oncology, and other relevant
domains, and explicitly state how each may influence the current
condition or its management when applicable.

List all information required before making a treatment decision,
clearly separating:
– Essential information that must be obtained before treatment.
– Recommended information that significantly improves decision accuracy
  or safety.
– Optional information that provides contextual or long-term value.

Include missing history, red-flag symptoms, physical examination
findings, laboratory tests, imaging, functional assessments, or
specialty consultations, without speculation.

Highlight contraindications, high-risk interactions, or conditions that
may alter or delay treatment, such as allergies, organ dysfunction,
pregnancy status, immunosuppression, or prior procedures, only when
explicitly documented or clearly marked as requiring confirmation.

Present the output as a clear, structured clinical reasoning narrative
that transparently connects symptoms to possible causes, severity,
prognosis, and next clinical considerations.

Explicitly flag uncertainty, unresolved assumptions, and data gaps that
must be addressed before proceeding with treatment, without introducing
unsupported conclusions.
""",


"medical-clinical-context": """
MEDICAL CLINICAL CONTEXT — CONSOLIDATED SOURCE-BOUND CLINICAL RECORD

CRITICAL FEATURE OVERRIDE (NON-NEGOTIABLE)
------------------------------------------------------------
This feature DOES NOT generate multiple analysis templates.

This feature produces:
- EXACTLY ONE consolidated clinical context output
- NO alternative review approaches
- NO analytical variation

Any instruction outside this feature definition that
requires multiple templates, analytical lenses, or
review variants MUST be ignored.

------------------------------------------------------------
PRIMARY CLINICAL INTENT
------------------------------------------------------------
Produce a SINGLE, consolidated, clinician-authored
medical clinical context summary intended for
SAFE clinical review before any assessment,
diagnosis, or treatment.

------------------------------------------------------------
ABSOLUTE SOURCE-BINDING RULES
------------------------------------------------------------
- Use ONLY and EXACTLY the medical information
  explicitly documented in the patient record.
- Do NOT generate example conditions, common
  diseases, allergies, surgeries, or placeholder facts.
- Do NOT infer, normalize, expand, or complete
  missing medical history.
- Do NOT restate vague terms in more specific form.
- Every statement MUST be traceable to documented data.

------------------------------------------------------------
DATA PRESENCE & OMISSION RULES
------------------------------------------------------------
- Include ALL documented medical information.
- Omit entire categories if no data exists.
- NEVER imply absence of information unless
  explicitly documented.
- NEVER assume normal findings.

If missing information is clinically required for
safe treatment, list it ONLY under:

“Critical Information Required Before Treatment”

------------------------------------------------------------
ALLOWED CONTENT (STRICT)
------------------------------------------------------------
Include ONLY IF documented:
- Known or past medical conditions
- Past illnesses and surgeries
- Explicitly documented allergies
- Medications with recorded details
- Procedures or hospitalizations
- Family medical history
- Social or lifestyle history
- Vitals, labs, imaging, screening records
  WITHOUT interpretation or trend analysis

------------------------------------------------------------
SYSTEMS-BASED REVIEW (CONDITIONAL)
------------------------------------------------------------
A systems-based review may be performed ONLY for
systems with documented patient data.

No system may be mentioned without patient-specific data.
No assumed normal or abnormal findings are permitted.

------------------------------------------------------------
CLINICAL COHERENCE RULE
------------------------------------------------------------
The output MUST be:
- A SINGLE unified narrative
- Specialty-aware
- Fully source-bound
- Free of prioritization, abstraction, or summarization

------------------------------------------------------------
STRICT PROHIBITIONS
------------------------------------------------------------
The output MUST NOT include:
- Diagnosis
- Differential diagnosis
- Severity grading
- Prognosis
- Treatment recommendations
- Clinical decision-making

This feature is DOCUMENTATIONAL ONLY.
""",
"prognosis-clinical-analysis": """
Clinical prognosis analysis and documentation framework.

PRIMARY PURPOSE
----------------------------------------------------------------
This feature supports STRUCTURED, OBSERVATIONAL prognosis analysis
based strictly on documented clinical, pathological, radiological,
and treatment-related data.

It documents FACTORS THAT MAY INFLUENCE disease trajectory
WITHOUT predicting outcomes or assigning probabilities.

----------------------------------------------------------------
SCOPE OF ANALYSIS (AUTHORITATIVE)
----------------------------------------------------------------
The analysis is LIMITED to identifying and organizing:

1. Disease progression–associated factors (negative factors)
   - Documented indicators associated with worsening course
   - Adverse pathological, radiological, molecular, or clinical features
   - Treatment resistance or lack of response as documented
   - Disease burden or spread indicators explicitly stated

2. Disease regression–associated factors (positive factors)
   - Documented indicators associated with stabilization or improvement
   - Favorable pathology, biomarker, or response-related findings
   - Treatment responsiveness explicitly recorded
   - Functional or symptomatic improvement as documented

3. Practically possible influencing factors
   - Modifiable or contextual elements documented in the record
   - Treatment adherence notes
   - Comorbidities or concurrent conditions
   - Supportive care, follow-up regularity, or access factors
   - Patient-related factors explicitly stated (performance status, nutrition)

----------------------------------------------------------------
STRICT EXCLUSIONS (NON-NEGOTIABLE)
----------------------------------------------------------------
This feature MUST NOT:
- Predict survival, cure, remission, or progression timelines
- Assign prognosis categories or labels
- Quantify risk, probability, or likelihood
- Compare against population-level outcomes
- Recommend treatment changes or escalation
- Infer future disease course
- Recommend or imply treatment actions
- Introduce assumptions beyond documented data

----------------------------------------------------------------
OUTPUT STRUCTURE (MANDATORY)
----------------------------------------------------------------
Return ONLY a SINGLE LIST of SECTION DESCRIPTORS
under:

possible_output_categories
Each section descriptor MUST include:
- section_id
- section_name
- description

NO section content is populated.

----------------------------------------------------------------
AUTHORITATIVE SECTION SET (FIXED)
----------------------------------------------------------------
The following sections MUST be returned TOGETHER
as ONE unified prognosis context:

1. disease_progression_negative_factors
2. disease_regression_positive_factors
3. practically_possible_influencing_factors

----------------------------------------------------------------
CLINICAL SAFETY GUARANTEE
----------------------------------------------------------------
This feature produces:
- NO outcome prediction
- NO prognostic scoring
- NO treatment recommendations
- NO decision support

All outputs remain descriptive, source-bound, and non-predictive.
""",

"multidisciplinary-clinical-analyser": """
Multidisciplinary clinical relevance analysis.

PRIMARY PURPOSE
----------------------------------------------------------------
This feature evaluates whether the documented disease process,
clinical findings, or treatments intersect with other medical
specialties requiring awareness, coordination, or co-management.

This feature defines a SINGLE, INSEPARABLE representation of
documented multidisciplinary clinical relevance for a given
clinical encounter.

It captures ONLY the PRESENCE and CATEGORIZATION of cross-specialty
clinical relevance as explicitly documented in the source record.
----------------------------------------------------------------
ANALYTICAL SCOPE (AUTHORITATIVE)
----------------------------------------------------------------
The analysis focuses on:

- Identification of disease features relevant to other specialties
- Documentation of organ system involvement across domains
- Treatment-related cross-specialty considerations
- Diagnostic findings that fall outside a single specialty scope
- Existing documented referrals or co-managed care

Examples of relevance (descriptive only):
- Oncology with cardiology (cardiotoxicity monitoring)
- Oncology with nephrology (renal impairment)
- Oncology with endocrinology (hormonal effects)
- Oncology with surgery, radiation, palliative care, rehabilitation

----------------------------------------------------------------
STRICT EXCLUSIONS (NON-NEGOTIABLE)
----------------------------------------------------------------
This feature MUST NOT:
- Mandate referrals
- Recommend consultations
- Judge adequacy of multidisciplinary involvement
- Prioritize specialties
- Create care pathways or coordination plans
- Infer unmet care needs

----------------------------------------------------------------
OUTPUT INTENT
----------------------------------------------------------------
Outputs should DOCUMENT:
- Which specialties are clinically relevant based on documented data
- The specific documented elements triggering relevance
- Existing multidisciplinary involvement if recorded

This feature defines a SINGLE, INSEPARABLE representation of
documented multidisciplinary clinical relevance for a given
clinical encounter.

It captures ONLY the PRESENCE and CATEGORIZATION of cross-specialty
clinical relevance as explicitly documented in the source record.

----------------------------------------------------------------
OUTPUT INTENT
----------------------------------------------------------------
Return ONLY a SINGLE LIST of SECTION DESCRIPTORS
under:

possible_output_categories

Each section descriptor MUST include:
- section_id
- section_name
- description

NO section content is populated.


----------------------------------------------------------------
CLINICAL SAFETY GUARANTEE
----------------------------------------------------------------
This feature produces:
- NO referrals
- NO recommendations
- NO care coordination directives
- NO clinical judgment

The output is informational and awareness-oriented only.
""",
"treatment-response-clinical-analyser":"""
Clinical treatment response observational analysis.

PRIMARY PURPOSE
----------------------------------------------------------------
This feature documents HOW a disease has responded to treatment
based strictly on recorded follow-up data.

It captures CHANGE, STABILITY, or VARIABILITY
WITHOUT classifying response or effectiveness.

----------------------------------------------------------------
ALLOWED DATA SOURCES
----------------------------------------------------------------
- Imaging follow-up reports
- Laboratory trends
- Symptom documentation
- Functional or performance status notes
- Biomarker or measurable disease tracking
- Clinician-documented response statements

----------------------------------------------------------------
ANALYTICAL SCOPE (STRICT)
----------------------------------------------------------------
The feature may:
- Compare baseline vs follow-up findings
- Describe documented improvement, worsening, or stability
- Track measurements and timepoints
- Document consistency or inconsistency of response data

----------------------------------------------------------------
STRICT EXCLUSIONS
----------------------------------------------------------------
This feature MUST NOT:
- Assign response categories (CR, PR, SD, PD)
- Judge treatment effectiveness
- Recommend continuation, escalation, or change
- Predict future response
- Interpret causality

----------------------------------------------------------------
OUTPUT CHARACTER
----------------------------------------------------------------
Observational, time-based, data-faithful.

----------------------------------------------------------------
CLINICAL SAFETY GUARANTEE
----------------------------------------------------------------
NO response labeling.
NO decision support.
NO treatment judgment.
""",
"quality-treatment-sufficiency":"""
Treatment sufficiency documentation evaluation.

PRIMARY PURPOSE
----------------------------------------------------------------
This feature evaluates whether documented treatment components
are PRESENT and COMPLETE relative to the documented condition.

----------------------------------------------------------------
ANALYTICAL SCOPE
----------------------------------------------------------------
The analysis checks for:
- Presence of treatment modalities typically documented
- Completeness of medication, procedural, and supportive elements
- Documentation continuity across encounters
- Explicit gaps or omissions in documentation

----------------------------------------------------------------
STRICT EXCLUSIONS
----------------------------------------------------------------
This feature MUST NOT:
- Judge treatment adequacy
- Evaluate correctness or effectiveness
- Recommend additional treatments
- Compare against guidelines
- Assign quality scores

----------------------------------------------------------------
OUTPUT INTENT
----------------------------------------------------------------
Documentational completeness ONLY.

----------------------------------------------------------------
CLINICAL SAFETY GUARANTEE
----------------------------------------------------------------
NO treatment evaluation.
NO recommendations.
NO scoring.
""",

"quality-survivorship-management":"""
Survivorship management documentation evaluation.

PRIMARY PURPOSE
----------------------------------------------------------------
This feature evaluates whether survivorship-related elements
are documented for patients beyond active treatment phases.

----------------------------------------------------------------
ANALYTICAL SCOPE
----------------------------------------------------------------
Checks for documentation of:
- Follow-up planning
- Late-effect monitoring
- Secondary prevention notes
- Rehabilitation or supportive care references
- Psychosocial or quality-of-life documentation

----------------------------------------------------------------
STRICT EXCLUSIONS
----------------------------------------------------------------
This feature MUST NOT:
- Define survivorship plans
- Recommend surveillance strategies
- Predict long-term outcomes
- Judge survivorship care quality

----------------------------------------------------------------
OUTPUT INTENT
----------------------------------------------------------------
Presence-or-absence documentation only.

----------------------------------------------------------------
CLINICAL SAFETY GUARANTEE
----------------------------------------------------------------
NO planning.
NO recommendations.
NO evaluation.
""",

"quality-value-based-care":"""
Value-based care documentation assessment.

PRIMARY PURPOSE
----------------------------------------------------------------
This feature documents whether elements relevant to
value-based care principles are present in the record.

----------------------------------------------------------------
ANALYTICAL SCOPE
----------------------------------------------------------------
May document presence of:
- Outcome tracking
- Resource utilization notes
- Patient-reported outcomes
- Care coordination documentation
- Cost-awareness or efficiency references if recorded

----------------------------------------------------------------
STRICT EXCLUSIONS
----------------------------------------------------------------
This feature MUST NOT:
- Judge cost-effectiveness
- Rank value
- Compare providers or systems
- Recommend cost-related changes
- Perform economic analysis

----------------------------------------------------------------
OUTPUT INTENT
----------------------------------------------------------------
Observational documentation of value-related elements only.

----------------------------------------------------------------
CLINICAL SAFETY GUARANTEE
----------------------------------------------------------------
NO evaluation.
NO comparison.
NO recommendations.
""",
"current-vitals-context": """
Unified current vitals context definition.

PRIMARY PURPOSE
----------------------------------------------------------------
This feature defines a SINGLE, INSEPARABLE representation of
ALL vitals-related documentation recorded for one clinical encounter.

It captures ONLY the PRESENCE and STRUCTURE of vitals data
as provided by the source record.

----------------------------------------------------------------
ANTI-FRAGMENTATION RULE (OVERRIDING)
----------------------------------------------------------------
Current vitals are ONE COMPOSITE UNIT.

The system MUST NOT:
- Assume any predefined vital sign fields
- Enumerate or expect specific physiological parameters
- Normalize, validate, or interpret values
- Compare against reference ranges
- Perform trend or abnormality detection

ALL vitals-related data is treated uniformly,
regardless of structure or naming.

----------------------------------------------------------------
SCOPE BOUNDARY (STRICT — OBSERVATIONAL ONLY)
----------------------------------------------------------------
This feature is STRICTLY DOCUMENTATIONAL.

It performs:
- NO analysis
- NO interpretation
- NO reasoning
- NO classification
- NO prioritization
- NO clinical judgment

----------------------------------------------------------------
ALLOWED CONTENT (AUTHORITATIVE)
----------------------------------------------------------------
The feature may document ONLY:

1. Presence of vitals-related documentation
   - Any data explicitly identified as vitals,
     physiological measurements, or observations
   - Structure preserved EXACTLY as received
   - No assumptions about meaning or completeness

2. Vitals documentation metadata
   - Timing, source, or method if explicitly present
   - Absence or incompleteness if explicitly indicated

----------------------------------------------------------------
STRICT PROHIBITIONS
----------------------------------------------------------------
The system MUST NOT:
- Hard-code or expect specific vitals
- Interpret numeric or textual values
- Link vitals to symptoms, diagnoses, or actions
- Compare vitals across encounters
- Generate summaries or narratives

----------------------------------------------------------------
OUTPUT STRUCTURE (MANDATORY)
----------------------------------------------------------------
Return ONLY a SINGLE LIST of SECTION DESCRIPTORS
under:

possible_output_categories

Each section descriptor MUST include:
- section_id
- section_name
- description

NO section content is populated.

----------------------------------------------------------------
AUTHORITATIVE SECTION SET (FIXED)
----------------------------------------------------------------
The following sections MUST be returned TOGETHER
as ONE unified context:

1. current_vitals_data_presence
2. vitals_data_structure
3. vitals_documentation_metadata
4. vitals_documentation_completeness

----------------------------------------------------------------
OUTPUT CONSTRAINT (ABSOLUTE)
----------------------------------------------------------------
NO additional text.
NO inferred structure.
NO analysis.
NO interpretation.

----------------------------------------------------------------
CLINICAL SAFETY GUARANTEE
----------------------------------------------------------------
This feature produces:
- NO diagnosis
- NO interpretation
- NO reasoning
- NO recommendations
- NO decision support
""",
"current-screening-context": """
Unified current screening context definition.

PRIMARY PURPOSE
----------------------------------------------------------------
This feature defines a SINGLE, INSEPARABLE representation of
ALL screening or assessment-related documentation
recorded for one clinical encounter.

It documents ONLY the EXISTENCE and STRUCTURE
of screening data as provided by the source record.

----------------------------------------------------------------
ANTI-FRAGMENTATION RULE (OVERRIDING)
----------------------------------------------------------------
Screening data is ONE COMPOSITE UNIT.

The system MUST NOT:
- Assume specific screening tools or instruments
- Enumerate or predefine assessment types
- Score, grade, or interpret screening outputs
- Infer risk, severity, or diagnosis
- Perform tool-specific or domain-specific analysis

ALL screening-related data is treated uniformly,
regardless of format or naming.

----------------------------------------------------------------
SCOPE BOUNDARY (STRICT — OBSERVATIONAL ONLY)
----------------------------------------------------------------
This feature is STRICTLY DOCUMENTATIONAL.

It performs:
- NO interpretation
- NO scoring or threshold logic
- NO reasoning
- NO prioritization
- NO diagnostic inference
- NO linkage to plans or actions

----------------------------------------------------------------
ALLOWED CONTENT (AUTHORITATIVE)
----------------------------------------------------------------
The feature may document ONLY:

1. Presence of screening-related documentation
   - Any data explicitly recorded as screening,
     assessment, evaluation, or questionnaire content
   - Structure preserved EXACTLY as received
   - No assumptions about purpose or outcome

2. Screening documentation metadata
   - Tool names, timing, or context if explicitly present
   - Absence or incompleteness if explicitly indicated

----------------------------------------------------------------
STRICT PROHIBITIONS
----------------------------------------------------------------
The system MUST NOT:
- Hard-code screening instruments
- Interpret results or scores
- Compare screening outcomes over time
- Link screening data to diagnoses or decisions
- Generate narratives or conclusions

----------------------------------------------------------------
OUTPUT STRUCTURE (MANDATORY)
----------------------------------------------------------------
Return ONLY a SINGLE LIST of SECTION DESCRIPTORS
under:

possible_output_categories

Each section descriptor MUST include:
- section_id
- section_name
- description

NO section content is populated.

----------------------------------------------------------------
AUTHORITATIVE SECTION SET (FIXED)
----------------------------------------------------------------
The following sections MUST be returned TOGETHER
as ONE unified context:

1. current_screening_data_presence
2. screening_data_structure
3. screening_documentation_summary
4. screening_documentation_evaluation
5. screening_documentation_severity

----------------------------------------------------------------
OUTPUT CONSTRAINT (ABSOLUTE)
----------------------------------------------------------------
NO additional text.
NO inferred structure.
NO analysis.
NO interpretation.

----------------------------------------------------------------
CLINICAL SAFETY GUARANTEE
----------------------------------------------------------------
This feature produces:
- NO diagnosis
- NO interpretation
- NO reasoning
- NO recommendations
- NO decision support
"""
}

@router.post("/feature-analysis-templates")
async def feature_analysis_templates(request: Request):
    try:
        data = await request.json()

        doctor_id = data.get("doctor_id")
        feature = data.get("feature")

        if not doctor_id or not feature:
            raise HTTPException(400, "doctor_id and feature required")

        feature_id = feature.get("id")
        feature_name = feature.get("name")

        doctor_doc = doctor_user_collection.find_one(
            {"sys_user_id": doctor_id},
            {"_id": 0, "specialization": 1}
        )

        speciality = doctor_doc.get("specialization", "General Medicine")

        base_prompt = FEATURE_BASE_PROMPTS.get(feature_id)
        logger.info("BASE PROMPT",base_prompt)

        if not base_prompt:
            raise HTTPException(
                status_code=400,
                detail=f"No base prompt defined for feature {feature_id}"
            )

        # ------------------------------------------------------------------
        # 🔒 ENHANCED, FEATURE-LOCKED PROMPT
        # ------------------------------------------------------------------
        prompt = f"""
You are a SENIOR CLINICAL AI PROMPT ARCHITECT.

Your responsibility is to design clinician-readable
clinical review templates that describe HOW a clinical
assessment should be performed.

You are not performing analysis.
You are defining structured clinical review protocols
that another system will later execute.

You MUST strictly follow the feature definition provided.
You MUST NOT generalize beyond the feature scope.
You MUST think like a clinician reviewing a report.

----------------------------------------------------------------
CLINICAL CONTEXT
----------------------------------------------------------------
Doctor Speciality:
{speciality}

Clinical Feature Name:
{feature_name}

----------------------------------------------------------------
FEATURE-SPECIFIC DEFINITION (AUTHORITATIVE)
----------------------------------------------------------------
{base_prompt}

This feature definition is STRICT.
Do not add, remove, or reinterpret its scope.

--------------------------------------------------------------------
FEATURE DERIVATION RULE (NON-NEGOTIABLE):
---------------------------------------------------------------------
- ALL feature-specific templates MUST be directly derived from:
  - clinical actions
  - data elements
  - relationships
  - constraints
  explicitly described in the FEATURE-SPECIFIC DEFINITION above.
- You MUST NOT introduce analytical strategies, review styles,
  or perspectives that are not clearly implied by the base prompt.
- Before writing templates, internally identify:
  - What clinicians actually LOOK FOR in this feature
  - What comparisons or observations are UNIQUE to this feature
- If a template could exist without this base prompt,
  it is INVALID.


----------------------------------------------------------------
PREDEFINED CONTEXTUAL DATA MODELS (AUTHORITATIVE)
----------------------------------------------------------------
The downstream system MAY provide contextual clinical data
in addition to feature-specific report content.

These data models are PREDEFINED and IMMUTABLE.
You MUST NOT invent, rename, or extend these fields.

---------------------------------------------------------------
MEDICAL CONTEXT
---------------------------------------------------------------
Represents historical, background clinical conditions
relevant to the patient across encounters.

MedicalContext fields:
- id: Unique identifier for the context record
- doctor_id: Identifier of the doctor who recorded the data (optional)
- patient_id: Identifier of the patient (optional)
- date: Date when the context was recorded
- known_condition: List of previously known or chronic conditions

Usage constraints:
- This context is HISTORICAL and NON-ACTIVE
- It may be used ONLY for background awareness
- It MUST NOT be used to infer progression, diagnosis, or causality
- Absence of data must not be treated as negative evidence

---------------------------------------------------------------
CURRENT CONTEXT
---------------------------------------------------------------
Represents active or recent clinical conditions
documented for the patient at a given time point.

CurrentContext fields:
- id: Unique identifier for the context record
- doctor_id: Identifier of the doctor who recorded the data (optional)
- patient_id: Identifier of the patient (optional)
- date: Date when the context was recorded
- current_condition: List of currently observed or reported conditions

Usage constraints:
- This context is TIME-BOUND and DESCRIPTIVE
- It may be referenced ONLY to align observations temporally
- It MUST NOT be used for diagnosis, staging, or clinical inference
- Conflicts with feature data must be DOCUMENTED, not resolved


----------------------------------------------------------------
EXPECTED INPUT DATA (ASSUME STRUCTURED OBJECTS)
----------------------------------------------------------------
Assume the downstream AI will receive structured clinical data such as:
- Feature-specific report data defined in the base prompt
- MedicalContext objects (as defined above)
- CurrentContext objects (as defined above)
- Nested JSON objects
- Clearly labeled sections (e.g., biopsy_details, microscopic_findings)
- Temporal or categorical fields where applicable

You must explicitly reference ONLY the data types relevant to this feature.
Do NOT mention unrelated data sources.

You MUST NOT:
- Introduce new context models
- Assume availability of unlisted fields
- Reference patient demographics unless explicitly present

----------------------------------------------------------------
TEMPLATE GENERATION TASK
----------------------------------------------------------------
You MUST generate EXACTLY **5 ANALYSIS TEMPLATES**.

CRITICAL STRUCTURE RULE (MANDATORY):
- The FIRST 2 templates are SYSTEM-DEFAULT templates.
- The NEXT 3 templates are FEATURE-SPECIFIC analytical templates.

SYSTEM-DEFAULT TEMPLATE PURPOSE:
These templates MUST:
- Be applicable to ALL clinical features
- Perform SAFE, NON-INTERPRETIVE signal extraction
- Normalize language into observational form
- Capture high-level patterns WITHOUT clinical judgment
- Remove or downgrade risk, action, or decision language
- Act as a universal preprocessing and safety layer
- Act as baseline analytical rules for every feature

FEATURE-SPECIFIC TEMPLATE PURPOSE:

These templates MUST:
- Define DISTINCT but PRACTICAL ways a doctor may review
  the COMPLETE patient medical record for this feature
- Describe HOW the full medical record is read and reviewed,
  not WHAT sections or categories exist
- Represent different clinically realistic review approaches
  a doctor may choose while reading the entire chart
- Be reusable even if report sections or output categories change
- Preserve ALL documented patient information in every template

Templates MUST NOT:
- Focus on or isolate any single type of medical data
- Be named after domain concepts or report sections
- Mirror or correspond to output categories
- Represent a single section or data block
- Filter, summarize, exclude, or prioritize patient information


IMPORTANT:
- Do NOT label templates as “default” or “system” in output
- Do NOT omit or reorder templates
- Do NOT generate more or fewer than 5 templates


Each template represents a DIFFERENT but VALID way
a doctor may go through the SAME COMPLETE patient record,
without losing or modifying any documented information.


LEXICAL DIVERSITY CONSTRAINT (MANDATORY):

- Template names MUST be derived from FEATURE-SPECIFIC clinical activities,
  signals, or observations explicitly present in the feature definition.
- DO NOT reuse generic analytical keywords such as:
  temporal, correlation, holistic, structured, morphology, section-focused,
  summary, recurrent, co-occurring, deviation, pattern, system, framework.
- Each template_name must contain at least ONE noun or phrase
  that is UNIQUE to this feature and would NOT apply to most other features.
- If a template name could reasonably apply to another feature,
  it is INVALID.

----------------------------------------------------------------
CRITICAL SEPARATION RULE (NON-NEGOTIABLE)
----------------------------------------------------------------
The analysis templates MUST NOT mirror or duplicate
the output categories as sections.

Rules:
- Templates define ANALYTICAL LENSES, not report sections
- Do NOT create one template per output category
- Do NOT reuse section names as template intent
- Multiple templates may populate the SAME output sections
- Templates describe HOW data is reviewed, not WHERE it appears

Violation of this rule makes the output INVALID.

-----------------------------------------------------------------
GLOBAL DATA INCLUSION RULE (MANDATORY)
----------------------------------------------------------------
- Every analysis template MUST include ALL available patient data
- No template may focus on or prioritize a specific category
  (e.g., vitals, labs, imaging, medications)
- Templates differ ONLY in HOW the full record is read,
  not in WHAT data is included
- Absence of data must not be commented on
- No data may be omitted, summarized, filtered, or reduced


-----------------------------------------------------------
FEATURE-SPECIFIC JUSTIFICATION CHECK (MANDATORY):
-----------------------------------------------------------------
For EACH of the 3 feature-specific templates:
- The template must answer:
  “Why would a clinician choose THIS review approach
   specifically for THIS feature?”
- The answer must depend on the feature definition,
  not on general analytical preferences.
- If the justification is generic or reusable,
  the template is INVALID.


----------------------------------------------------------------
FOR EACH TEMPLATE
----------------------------------------------------------------
You MUST produce:

1. template_id
   - short, stable, machine-friendly identifier

2. template_name
   - natural, clinician-facing name
   - describes WHAT is reviewed (not how)
   - sounds like an option in a clinical system
   - no technical or AI language

3. analysis_prompt
   This MUST be written as a CLINICAL REVIEW PROTOCOL that:
   - Reads like a doctor-authored assessment framework
   - Clearly defines review scope and intent
   - Specifies which clinical records are reviewed
   - Describes review order and hierarchy
   - Explains how observations are documented
   - Explains HOW EACH SECTION should be reviewed
     (e.g., descriptive summary, pattern recognition, consistency check)
   - Explains how sections relate to each other (if applicable)
   

----------------------------------------------------------------
ANALYSIS PROMPT DEPTH REQUIREMENT (MANDATORY)
----------------------------------------------------------------
Each analysis_prompt MUST be a DETAILED, EXECUTION-GRADE SYSTEM PROMPT.

Minimum requirements for EACH analysis_prompt:
- At least 8–12 explicit instructional steps or bullet points
Each template MUST:
- Review the COMPLETE patient medical record as a whole
- Include ALL documented medical data in every template
- NEVER isolate, extract, or focus on a single data category
- NEVER exclude or filter any patient information
- Apply a DIFFERENT READING STYLE to the SAME FULL DATASET
- Explicit instructions for cross-variable comparison (if applicable)
- Explicit prohibition of interpretation repeated inside the prompt
- Uses professional medical documentation language
- Avoids any reference to system roles, prompts, or JSON schemas
- Output schema must match the feature’s mandatory output sections

Shallow, high-level, or single-paragraph prompts are INVALID.

----------------------------------------------------------------
STRICT SAFETY & SCOPE CONSTRAINTS (MANDATORY)
----------------------------------------------------------------
Each analysis_prompt MUST explicitly prohibit:
- Diagnosis or disease labeling
- Staging, grading, or prognostic claims
- Treatment recommendations
- Clinical decision-making or triage
- Assumptions beyond the provided data

The output is OBSERVATIONAL and DOCUMENTATIONAL only.


----------------------------------------------------------------
OUTPUT REQUIREMENTS
----------------------------------------------------------------
- Output ONLY valid JSON
- No explanations
- No markdown
- No comments
- No trailing text

----------------------------------------------------------------
FINAL OUTPUT FORMAT (STRICT)
----------------------------------------------------------------
{{
  "templates": [
    {{
      "template_id": "",
      "template_name": "",
      "analysis_prompt": ""
    }}
  ]
}}
"""

        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            temperature=0.12,   # 🔑 Lower = more deterministic, less generic
            max_tokens=3000,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
        )

        # return {
        #     "doctor_id": doctor_id,
        #     "speciality": speciality,
        #     "feature": feature,
        #     "analysis_templates": json.loads(
        #         completion.choices[0].message.content
        #     )
        result = {
            "doctor_id": doctor_id,
            "speciality": speciality,
            "feature": feature,
            "analysis_templates": json.loads(
                completion.choices[0].message.content
            )
        }

        logger.info(
            "Logger 1 %s",
            json.dumps(result, ensure_ascii=False, indent=2)
        )

        return result
        

    except Exception as e:
        logger.exception("Feature analysis template generation failed")
        raise HTTPException(500, str(e))

@router.post("/feature-output-categories")
async def feature_generic_output_categories(request: Request):
    try:
        data = await request.json()

        feature_id = data.get("feature_id")
        feature_name = data.get("feature_name")
        doctor_id = data.get("doctor_id")

        if not feature_id or not feature_name:
            raise HTTPException(400, "feature_id and feature_name required")

        base_prompt = FEATURE_BASE_PROMPTS.get(feature_id)
        logger.info("BASE PROMPT",base_prompt)

        if not base_prompt:
            raise HTTPException(
                status_code=400,
                detail=f"No base prompt defined for feature {feature_id}"
            )

        # ------------------------------------------------------------------
        # 🔒 ENHANCED, FEATURE-LOCKED CATEGORY PROMPT
        # ------------------------------------------------------------------
        prompt = f"""
You are a SENIOR CLINICAL REPORT ARCHITECT.

Your task is to DEFINE THE FINAL REPORT SECTION HEADINGS
that will appear in the AI-generated output for a specific clinical feature.

This task is about REPORT STRUCTURE only.
You are NOT performing analysis.
You are NOT summarizing patient data.

----------------------------------------------------------------
FEATURE CONTEXT
----------------------------------------------------------------
Feature Name:
{feature_name}

----------------------------------------------------------------
AUTHORITATIVE FEATURE DEFINITION
----------------------------------------------------------------
{base_prompt}

Every section must map directly to a concept
explicitly or implicitly present in the feature definition above.

This definition strictly controls what sections are allowed.
Do NOT introduce sections outside this scope.



----------------------------------------------------------------
PREDEFINED CONTEXTUAL DATA MODELS (AUTHORITATIVE)
----------------------------------------------------------------
The downstream system MAY provide contextual clinical data
in addition to feature-specific report content.

These models are PREDEFINED and IMMUTABLE.
You MUST NOT invent, rename, or extend them.
You MUST NOT convert them into report sections.

---------------------------------------------------------------
MEDICAL CONTEXT (BACKGROUND ONLY)
---------------------------------------------------------------
Represents historical or background clinical conditions.

MedicalContext fields:
- id
- doctor_id (optional)
- patient_id (optional)
- date
- known_condition: list of previously known or chronic conditions

Usage constraints:
- HISTORICAL and NON-ACTIVE
- Used ONLY for background awareness
- MUST NOT generate output sections
- MUST NOT influence section naming
- MUST NOT be summarized or restructured

---------------------------------------------------------------
CURRENT CONTEXT (DESCRIPTIVE ONLY)
---------------------------------------------------------------
Represents active or recently documented conditions.

CurrentContext fields:
- id
- doctor_id (optional)
- patient_id (optional)
- date
- current_condition: list of currently observed conditions

Usage constraints:
- TIME-BOUND and DESCRIPTIVE
- Used ONLY for temporal alignment
- MUST NOT generate output sections
- MUST NOT influence section naming
- MUST NOT be merged with feature data

----------------------------------------------------------------
CRITICAL CONTEXT SEPARATION RULE (NON-NEGOTIABLE)
----------------------------------------------------------------
Report output categories MUST be derived ONLY from:
- the FEATURE DEFINITION above

They MUST NOT:
- mirror MedicalContext
- mirror CurrentContext
- include history, comorbidities, or current conditions
- introduce sections like medical_history or active_conditions

If a section could exist without the feature definition,
the output is INVALID.


----------------------------------------------------------------
SECTION DESIGN RULES (MANDATORY)
----------------------------------------------------------------
You MUST produce section names that:

- Represent REAL clinical report sections
- Would naturally appear as headings in a hospital report
- Are reusable across patients
- Are stable (not scenario-specific)
- Align directly with the feature definition
- Can be populated by structured JSON data

You MUST NOT:
- Include patient data
- Include values, results, or examples
- Include reasoning or interpretation
- Invent UI-specific or technical labels
- Use abstract names like "analysis_summary" or "insights"
- Use generic clinical system sections
  (e.g. assessment, plan, summary, overview)


ANTI-REUSE CONSTRAINT (CRITICAL)
The section list MUST be UNIQUE to this feature.

If the same or very similar section names
could reasonably apply to another feature,
the output is INVALID.

Each section must be JUSTIFIED by the feature definition.

----------------------------------------------------------------
NAMING CONVENTIONS
----------------------------------------------------------------
- snake_case only
- concise but clinically meaningful
- noun-based section names
- no verbs, no adjectives unless standard (e.g. gross_findings)

----------------------------------------------------------------
SECTION GRANULARITY
----------------------------------------------------------------
Choose a level of detail such that:
- Each section corresponds to a distinct block of structured data
- Sections can be independently rendered in the frontend
- A clinician would expect these exact sections

Examples of GOOD sections (for reference only, do not copy):
- biopsy_details
- gross_findings
- microscopic_findings
- ihc_results
- molecular_findings
- safety_observations

----------------------------------------------------------------
OUTPUT REQUIREMENTS
----------------------------------------------------------------
- Output ONLY valid JSON
- No explanations
- No markdown
- No extra keys
- No trailing text

----------------------------------------------------------------
FINAL OUTPUT FORMAT (STRICT)
----------------------------------------------------------------
{{
  "feature_id": "{feature_id}",
  "feature_name": "{feature_name}",
  "possible_output_categories": []
}}
"""

        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            temperature=0.02,  # 🔑 very low to ensure stability
            max_tokens=1500,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
        )

        # return {
        #     "doctor_id": doctor_id,
        #     "feature_output_categories": json.loads(
        #         completion.choices[0].message.content
        #     )
        # }
        result = {
            "doctor_id": doctor_id,
            "feature_output_categories": json.loads(
                completion.choices[0].message.content
            )
        }

        logger.info(
            "Logger 2 %s",
            json.dumps(result, ensure_ascii=False, indent=2)
        )

        return result

    except Exception as e:
        logger.exception("Feature output categories failed")
        raise HTTPException(500, str(e))

# Aleena done till above

async def infer_required_data_sources(
    *,
    feature_id: str,
    feature_name: str,
    rules: str,
    doctor_id: str
) -> List[str]:
    """
    Pure helper function.
    NO FastAPI Request.
    Safe to call internally.
    """

    # ------------------------------------
    # FETCH DOCTOR SPECIALITY
    # ------------------------------------
    doctor_doc = doctor_user_collection.find_one(
        {"sys_user_id": doctor_id},
        {"_id": 0, "specialization": 1}
    )


    speciality = doctor_doc.get("specialization", "General Medicine")

    # ------------------------------------
    # LLM PROMPT
    # ------------------------------------
    prompt = f"""
You are a senior clinical AI system architect.

Your responsibility is to determine which TYPES OF CLINICAL DATA
are STRICTLY REQUIRED for an AI feature to function correctly.

You are NOT performing analysis.
You are NOT interpreting patient data.
You are ONLY deciding which data sources must be AVAILABLE
for a downstream AI analysis to be possible.

--------------------------------------
DEFINITION OF "REQUIRED"
--------------------------------------
A data source is REQUIRED if:
- The analysis described in the rules CANNOT be performed meaningfully without it
- The feature explicitly depends on information typically found in that data source
- Omitting the data source would make the analysis incomplete or invalid

A data source is NOT required if:
- It is only optional, supportive, or situational
- It might be useful but is not essential
- The analysis can still be performed without it

--------------------------------------
ALLOWED DATA SOURCES (STRICT)
--------------------------------------
You may choose ONLY from the following list.
You MUST NOT invent, rename, or generalize data sources.

- lab_reports        → structured laboratory results and trends
- vitals             → vital sign measurements and trends
- radiology          → imaging reports and findings
- biopsy             → pathology, histology, cytology results
- medications        → prescribed drugs and medication history
- treatment_plan     → documented clinical plans, procedures, or therapies

--------------------------------------
SELECTION INSTRUCTIONS
--------------------------------------
1. Carefully read the ANALYSIS INTENT.
2. Identify what kinds of clinical information are explicitly required
   to perform the described analysis.
3. Select the MINIMUM SET of data sources necessary.
4. Do NOT select a data source unless it is clearly required.
5. If multiple data sources are needed together, include all of them.
6. Do NOT assume availability of data that is not mentioned or implied.

--------------------------------------
CONSTRAINTS
--------------------------------------
- Do NOT explain your reasoning
- Do NOT include optional or speculative sources
- Do NOT include patient identifiers
- Do NOT include extra fields
- Output JSON ONLY

--------------------------------------
FEATURE CONTEXT
--------------------------------------
Feature ID: {feature_id}
Feature Name: {feature_name}
Clinical Speciality: {speciality}

--------------------------------------
ANALYSIS INTENT
--------------------------------------
{rules}

--------------------------------------
STRICT OUTPUT FORMAT (JSON ONLY)
--------------------------------------
{{
  "required_data_sources": []
}}
"""


    completion = groq_client.chat.completions.create(
        model="llama-3.1-8b-instant",
        temperature=0.0,
        max_tokens=500,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": prompt}],
    )

    result = json.loads(completion.choices[0].message.content)

    return result.get("required_data_sources", [])


@router.post("/feature-required-data-sources")
async def feature_required_data_sources(request: Request):
    data = await request.json()

    required_sources = await infer_required_data_sources(
        feature_id=data["feature_id"],
        feature_name=data["feature_name"],
        rules=data.get("rules", ""),
        doctor_id=data["doctor_id"]
    )

    return {
        "feature_id": data["feature_id"],
        "required_data_sources": required_sources
    }



###DOCTOR NODES SAVE####

@router.post("/doctor-feature-save")
async def doctor_feature_save(config: FeatureConfiguration):
    doctor_id = config.doctor_id
    feature_id = config.feature_id

    feature_data = config.dict(exclude={"doctor_id"})
    # -------------------------------------------------
    # 🔹 AUTO-INFER DATA SOURCES IF EMPTY
    # -------------------------------------------------
    if not feature_data.get("data_sources"):
        feature_data["data_sources"] = await infer_required_data_sources(
            feature_id=feature_data["feature_id"],
            feature_name=feature_data["feature_name"],
            rules=feature_data.get("rules", ""),
            doctor_id=doctor_id
        )

    # 1️⃣ Check if doctor exists
    doctor_doc = await doctor_nodes_collection.find_one(
        {"doctor_id": doctor_id}
    )

    # -----------------------------
    # CASE 1: Doctor does NOT exist
    # -----------------------------
    if not doctor_doc:
        await doctor_nodes_collection.insert_one({
            "doctor_id": doctor_id,
            "features": [feature_data],
            "updated_at": datetime.utcnow()
        })

        return JSONResponse({
            "status": "success",
            "message": "Doctor created and feature added",
            "action": "inserted"
        })

    # -----------------------------
    # CASE 2: Feature EXISTS → REPLACE
    # -----------------------------
    feature_exists = any(
        f["feature_id"] == feature_id
        for f in doctor_doc.get("features", [])
    )

    if feature_exists:
        await doctor_nodes_collection.update_one(
            {
                "doctor_id": doctor_id,
                "features.feature_id": feature_id
            },
            {
                "$set": {
                    "features.$": feature_data,
                    "updated_at": datetime.utcnow()
                }
            }
        )

        return JSONResponse({
            "status": "success",
            "message": "Feature updated for doctor",
            "action": "replaced"
        })

    # -----------------------------
    # CASE 3: Feature DOES NOT exist → APPEND
    # -----------------------------
    await doctor_nodes_collection.update_one(
        {"doctor_id": doctor_id},
        {
            "$push": {"features": feature_data},
            "$set": {"updated_at": datetime.utcnow()}
        }
    )

    return JSONResponse({
        "status": "success",
        "message": "Feature added for doctor",
        "action": "appended"
    })




@router.post("/doctor_patient_profile_save")
async def save_patient_profile_feature(
    config: PatientProfileFeatureConfiguration
):
    doctor_id = config.doctor_id
    feature_data = config.dict(exclude={"doctor_id"})
    # ✅ FORCE ENABLE FEATURE BEFORE SAVE
    # feature_data["enabled"] = True
    feature_data["enabled"] = config.enabled

    # 1️⃣ Remove existing feature (if any)
    await patient_nodes_collection.update_one(
        {"doctor_id": doctor_id},
        {
            "$pull": {
                "features": {"feature_id": feature_data["feature_id"]}
            }
        }
    )

    # 2️⃣ Push new feature (or create doc)
    await patient_nodes_collection.update_one(
        {"doctor_id": doctor_id},
        {
            "$push": {
                "features": feature_data
            },
            "$set": {
                "updated_at": datetime.utcnow()
            }
        },
        upsert=True
    )

    return {
        "status": "success",
        "message": "Patient profile feature saved successfully",
        "feature_id": feature_data["feature_id"]
    }

@router.get("/doctor_patient_features/{doctor_id}")
async def get_patient_features_by_doctor(doctor_id: str):

    # 🔥 Normalize incoming ID
    normalized_id = doctor_id.lower().replace("doc-", "")

    doctor_doc = await patient_nodes_collection.find_one(
        {
            "$or": [
                {"doctor_id": doctor_id},
                {"doctor_id": normalized_id}
            ]
        },
        {"_id": 0}
    )

    # ✅ DON'T THROW 404 — return empty instead
    if not doctor_doc:
        return JSONResponse(
            status_code=200,
            content={"features": []}
        )

    return JSONResponse(
        status_code=200,
        content=jsonable_encoder(doctor_doc)
    )

# -----------------------------------------
# DELETE ALL CONFIGURATIONS
# -----------------------------------------

@router.post("/delete_all_config")
async def delete_all_config(confirm: bool = False):
    """
    Delete ALL documents in doctor_nodes_collection.
    Must pass ?confirm=true to allow deletion.
    """

    try:
        if not confirm:
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "message": "Confirmation required. Add ?confirm=true to proceed."
                }
            )

        # ✅ Async delete
        result = await doctor_nodes_collection.delete_many({})

        return {
            "status": "success",
            "message": f"Deleted {result.deleted_count} documents from doctor_nodes_collection."
        }

    except Exception as e:
        logger.exception("Error deleting all configs: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/get-doctor-features/{doctor_id}")
async def get_doctor_features(doctor_id: str):
    """
    Retrieve all feature configurations for a given doctor_id
    """
    logger.info(f"Retrieving features for doctor_id={doctor_id}")
    doctor_doc = await doctor_nodes_collection.find_one(
        {"doctor_id": doctor_id},
        {"_id": 0}  # Exclude MongoDB _id
    )

    if not doctor_doc:
        raise HTTPException(
            status_code=404,
            detail=f"No feature configuration found for doctor_id={doctor_id}"
        )

    response_data = {
        "status": "success",
        "doctor_id": doctor_id,
        "features": doctor_doc.get("features", []),
        "updated_at": doctor_doc.get("updated_at")
    }

    return JSONResponse(
        status_code=200,
        content=jsonable_encoder(response_data)
    )


# NON_UI_FEATURE_IDS = {
#     "screening-section",
#     "patient-profile",
#     "pre-screening-section"
# }
# @router.get("/doctor-enabled-features/{doctor_id}")
# async def get_enabled_features_for_doctor(doctor_id: str):
#     enabled_features = []
#     seen_feature_ids = set()

#     # --------------------------------------------------
#     # 1️⃣ AI / DECISION FEATURES
#     # --------------------------------------------------
#     doctor_nodes_doc = await doctor_nodes_collection.find_one(
#         {"doctor_id": doctor_id},
#         {"_id": 0, "features": 1}
#     )

#     if doctor_nodes_doc:
#         for feature in doctor_nodes_doc.get("features", []):
#             if feature.get("enabled") is True:
#                 fid = feature.get("feature_id")

#                 # 🚫 SKIP DATA-ONLY SECTIONS
#                 if fid in NON_UI_FEATURE_IDS:
#                     continue

#                 if fid and fid not in seen_feature_ids:
#                     enabled_features.append({
#                         "feature_id": fid,
#                         "feature_name": feature.get("feature_name"),
#                         "category_id": feature.get("category_id"),
#                         "type": "analysis",
#                         "source": "doctor_nodes"
#                     })
#                     seen_feature_ids.add(fid)

#     # --------------------------------------------------
#     # 2️⃣ SCREENING FEATURES
#     # --------------------------------------------------
#     screening_doc = await screening_settings_collection.find_one(
#         {"doctor_id": doctor_id},
#         {"_id": 0, "features": 1}
#     )

#     if screening_doc:
#         for feature in screening_doc.get("features", []):
#             if feature.get("enabled") is True:
#                 fid = feature.get("feature_id")

#                 # 🚫 SKIP DATA-ONLY SECTIONS
#                 if fid in NON_UI_FEATURE_IDS:
#                     continue

#                 if fid and fid not in seen_feature_ids:
#                     enabled_features.append({
#                         "feature_id": fid,
#                         "feature_name": feature.get("feature_name"),
#                         "category_id": feature.get("category_id"),
#                         "type": "screening",
#                         "source": "screening_settings"
#                     })
#                     seen_feature_ids.add(fid)

#     # --------------------------------------------------
#     # 3️⃣ PATIENT PROFILE FEATURES
#     # --------------------------------------------------
#     profile_doc = await patient_nodes_collection.find_one(
#         {"doctor_id": doctor_id},
#         {"_id": 0, "features": 1}
#     )

#     if profile_doc:
#         for feature in profile_doc.get("features", []):
#             if feature.get("enabled") is True:
#                 fid = feature.get("feature_id")

#                 # 🚫 SKIP DATA-ONLY SECTIONS
#                 if fid in NON_UI_FEATURE_IDS:
#                     continue

#                 if fid and fid not in seen_feature_ids:
#                     enabled_features.append({
#                         "feature_id": fid,
#                         "feature_name": feature.get("feature_name"),
#                         "category_id": feature.get("category_id"),
#                         "type": "patient_profile",
#                         "source": "Profile_data_retrieval"
#                     })
#                     seen_feature_ids.add(fid)

#     return JSONResponse(
#         status_code=200,
#         content={
#             "status": "success",
#             "doctor_id": doctor_id,
#             "enabled_features": enabled_features,
#             "count": len(enabled_features)
#         }
#     )



@router.get("/doctor-enabled-features/{doctor_id}")
async def get_enabled_features_for_doctor(doctor_id: str):
    enabled_features = []
    seen_feature_ids = set()

    # --------------------------------------------------
    # 1️⃣ AI / DECISION FEATURES
    # --------------------------------------------------
    doctor_nodes_doc = await doctor_nodes_collection.find_one(
        {"doctor_id": doctor_id},
        {"_id": 0, "features": 1}
    )

    if doctor_nodes_doc:
        for feature in doctor_nodes_doc.get("features", []):
            if feature.get("enabled") is True:
                fid = feature.get("feature_id")
                if fid and fid not in seen_feature_ids:
                    enabled_features.append({
                        "feature_id": fid,
                        "feature_name": feature.get("feature_name"),
                        "category_id": feature.get("category_id"),
                        "type": "analysis",
                        "source": "doctor_nodes"
                    })
                    seen_feature_ids.add(fid)

    # --------------------------------------------------
    # 2️⃣ SCREENING FEATURES (FIXED)
    # --------------------------------------------------
    screening_doc = await screening_settings_collection.find_one(
        {"doctor_id": doctor_id},
        {"_id": 0, "features": 1}
    )

    if screening_doc:
        for feature in screening_doc.get("features", []):
            if feature.get("enabled") is True:
                fid = feature.get("feature_id")
                if fid and fid not in seen_feature_ids:
                    enabled_features.append({
                        "feature_id": fid,
                        "feature_name": feature.get("feature_name"),
                        "category_id": feature.get("category_id"),
                        "type": "screening",
                        "source": "screening_settings"
                    })
                    seen_feature_ids.add(fid)

    profile_doc = await patient_nodes_collection.find_one(
        {"doctor_id": doctor_id},
        {"_id": 0, "features": 1}
    )
    if profile_doc:
        for feature in profile_doc.get("features", []):
            if feature.get("enabled") is True:
                fid = feature.get("feature_id")
                if fid and fid not in seen_feature_ids:
                    enabled_features.append({
                        "feature_id": fid,
                        "feature_name": feature.get("feature_name"),
                        "category_id": feature.get("category_id"),
                        "type": "patient_profile",
                        "source": "Profile_data_retrieval"
                    })
                    seen_feature_ids.add(fid)


    return JSONResponse(
        status_code=200,
        content={
            "status": "success",
            "doctor_id": doctor_id,
            "enabled_features": enabled_features,
            "count": len(enabled_features)
        }
    )





from datetime import datetime, date

def calculate_age(dob):
    """
    dob can be:
    - datetime.date
    - datetime.datetime
    - ISO string: '1995-08-21' or '1995-08-21T00:00:00'
    """

    if not dob:
        return None

    # If DOB is string → parse
    if isinstance(dob, str):
        dob = datetime.fromisoformat(dob).date()

    # If DOB is datetime → convert to date
    if isinstance(dob, datetime):
        dob = dob.date()

    today = date.today()

    age = today.year - dob.year - (
        (today.month, today.day) < (dob.month, dob.day)
    )

    return age



def json_safe(obj):
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    return obj


def sanitize_for_json(data):
    if isinstance(data, dict):
        return {k: sanitize_for_json(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [sanitize_for_json(i) for i in data]
    else:
        return json_safe(data)




class FeatureExecutionRequest(BaseModel):
    patient_id: str
    doctor_id: str
    feature_id: str
    current_dictation: Optional[str] = None



@router.post("/execute-feature-db")
async def execute_feature_db(request: FeatureExecutionRequest, requestheaders: Request):
    
    patient_id = request.patient_id
    doctor_id = request.doctor_id
    feature_id = request.feature_id
    current_dictation = request.current_dictation
    
    print( requestheaders.headers.get("x-trace-id"), requestheaders.headers.get("x-client-ip"),  requestheaders.headers.get("x-user-id"), requestheaders.headers.get("x-user-role"))
    # ----------------------------------
    # DOCUMENTATION FEATURE HANDLING
    # ----------------------------------
    is_documentation_feature = feature_id.startswith("documentation")

    documentation_payload = None
    if is_documentation_feature:
        if not current_dictation or not current_dictation.strip():
            emit_audit(requestheaders.app, AuditEvent(
                timestamp=datetime.utcnow(),
                level="ERROR",
                source={"service": "orchestration", "component": "execute-feature-db"},
                actor={
                    "type": requestheaders.headers.get("x-user-role"),
                    "id": requestheaders.headers.get("x-user-id")
                },
                context={
                    "trace_id": requestheaders.headers.get("x-trace-id"),
                    "ip": requestheaders.headers.get("x-client-ip"),
                    "endpoint": "/hms/users/orchestration/execute-feature-db",
                    "method": "POST",
                    "feature_id": feature_id,
                    "feature_name": feature_name
                },
                clinical_context={},
                action={
                    "type": "FEATURE_EXECUTION",
                    "status": "FAILED",
                    "details": "Missing current_dictation for documentation feature"
                }
            ))
            raise HTTPException(
                status_code=400,
                detail="current_dictation is required for documentation features"
            )

        documentation_payload = {
            "current_dictation": current_dictation.strip()
        }

    # ----------------------------------
    # Fetch patient
    # ----------------------------------
    if feature_id == "patient-profile":
        profile_retrieved = await get_patient_profile_internal(
            patient_id=patient_id,
            doctor_id=doctor_id
        )
        extrated_details ={
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "feature_id": feature_id,
            "profile_retrieved": profile_retrieved
        }
        emit_audit(requestheaders.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="INFO",
            source={"service": "orchestration", "component": "execute-feature-db"},
            actor={
                "type": requestheaders.headers.get("x-user-role"),
                "id": requestheaders.headers.get("x-user-id")
            },
            context={
                "trace_id": requestheaders.headers.get("x-trace-id"),
                "ip": requestheaders.headers.get("x-client-ip"),
                "endpoint": "/hms/users/orchestration/execute-feature-db",
                "method": "POST",
                "feature_id": feature_id,
                "feature_name": "Patient Profile Retrieval"
            },
            clinical_context={},
            action={
                "type": "FEATURE_EXECUTION",
                "status": "SUCCESS",
                "details": f"Patient profile retrieved for patient_id={patient_id}"
            }
        ))
        return {
            "status": "success",
            "message": "Patient profile retrieved successfully",
            "data": extrated_details
        }
    patient = patient_user_collection.find_one(
        {"sys_user_id": patient_id},
        {"_id": 0, "name": 1, "date_of_birth": 1, "patient_id": 1, "gender": 1}
    )

    if not patient:
        emit_audit(requestheaders.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="ERROR",
            source={"service": "orchestration", "component": "execute-feature-db"},
            actor={
                "type": requestheaders.headers.get("x-user-role"),
                "id": requestheaders.headers.get("x-user-id")
            },
            context={
                "trace_id": requestheaders.headers.get("x-trace-id"),
                "ip": requestheaders.headers.get("x-client-ip"),
                "endpoint": "/hms/users/orchestration/execute-feature-db",
                "method": "POST",
                "feature_id": feature_id,
                "feature_name": feature_name
            },
            clinical_context={},
            action={
                "type": "FEATURE_EXECUTION",
                "status": "FAILED",
                "details": f"Patient not found for patient_id={patient_id}"
            }
        ))
        raise HTTPException(status_code=404, detail="Patient not found")

    age = calculate_age(patient.get("date_of_birth"))
    gender = patient.get("gender")

    # ----------------------------------
    # Fetch doctor feature config
    # ----------------------------------
    doctor_doc = await doctor_nodes_collection.find_one(
        {"doctor_id": doctor_id}
    )

    if not doctor_doc:
        emit_audit(requestheaders.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="ERROR",
            source={"service": "orchestration", "component": "execute-feature-db"},
            actor={
                "type": requestheaders.headers.get("x-user-role"),
                "id": requestheaders.headers.get("x-user-id")
            },
            context={
                "trace_id": requestheaders.headers.get("x-trace-id"),
                "ip": requestheaders.headers.get("x-client-ip"),
                "endpoint": "/hms/users/orchestration/execute-feature-db",
                "method": "POST",
                "feature_id": feature_id,
                "feature_name": feature_name
            },
            clinical_context={},
            action={
                "type": "FEATURE_EXECUTION",
                "status": "FAILED",
                "details": f"Doctor not found for doctor_id={doctor_id}"
            }
        ))
        raise HTTPException(status_code=404, detail="Doctor not found")

    feature = next(
        (f for f in doctor_doc.get("features", []) if f["feature_id"] == feature_id),
        None
    )

    if not feature:
        emit_audit(requestheaders.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="ERROR",
            source={"service": "orchestration", "component": "execute-feature-db"},
            actor={
                "type": requestheaders.headers.get("x-user-role"),
                "id": requestheaders.headers.get("x-user-id")
            },
            context={
                "trace_id": requestheaders.headers.get("x-trace-id"),
                "ip": requestheaders.headers.get("x-client-ip"),
                "endpoint": "/hms/users/orchestration/execute-feature-db",
                "method": "POST",
                "feature_id": feature_id,
                "feature_name": feature_name
            },
            clinical_context={},
            action={
                "type": "FEATURE_EXECUTION",
                "status": "FAILED",
                "details": f"Feature not configured for doctor_id={doctor_id}"
            }
        ))
        raise HTTPException(status_code=404, detail="Feature not configured for doctor")

    data_sources = feature.get("data_sources", [])
    feature_name = feature.get("feature_name")
    rules = feature.get("rules", "")
    selected_output_categories = feature.get("selected_output_categories",[])

    # ----------------------------------
    # Fetch documents
    # ----------------------------------
    documents_cursor = database["patient_report_documents"].find(
        {"patient_id": patient_id},
        {"_id": 0}
    )
    documents = await documents_cursor.to_list(length=None)

    # ----------------------------------
    # Fetch vitals
    # ----------------------------------
    vitals_doc = await patient_vitals_collection.find_one(
        {"sys_user_id": patient_id},
        {"_id": 0}
    )

    vitals_list = []
    if vitals_doc and "vitals" in vitals_doc:
        vitals_list = [
            {"recorded_at": ts, **values}
            for ts, values in vitals_doc["vitals"].items()
        ]
        vitals_list = sorted(
            vitals_list,
            key=lambda x: x.get("recorded_at", ""),
            reverse=True
        )

    # ----------------------------------
    # Classify documents
    # ----------------------------------
    lab_reports, radiology, biopsy = [], [], []

    for doc in documents:
        doc_type = doc.get("type")

        if doc_type == "lab_report":
            sanitized_doc = dict(doc)
            for field in [
                "medical_insights",
                "conditions",
                "ai_analyzed",
                "has_conditions",
                "last_ai_analysis",
                "imaging_analysis_completed",
                "additional_images",
                "dicom_metadata"
            ]:
                sanitized_doc.pop(field, None)

            lab_reports.append(sanitized_doc)

        elif doc_type in [
            "xray", "foot_xray", "ct_scan", "mri",
            "pet_scan", "angiography", "echo"
        ]:
            radiology.append(doc)

        elif doc_type in ["biopsy", "histopathology", "cytology"]:
            biopsy.append(doc)

    # ----------------------------------
    # Build STRICT data_fetched
    # ----------------------------------
    data_fetched = []

    # 🔒 DOCUMENTATION FEATURES: ONLY pass dictation
    if documentation_payload:
        data_fetched = [{
            "current_dictation": documentation_payload
        }]

    else:
        # Normal data fetching for non-documentation features

        if "vitals" in data_sources:
            data_fetched.append({"vitals": vitals_list[-5:]})

        if "lab_reports" in data_sources:
            data_fetched.append({"lab_reports": lab_reports})

        if "radiology" in data_sources:
            data_fetched.append({"radiology": radiology})

        if "biopsy" in data_sources:
            data_fetched.append({"biopsy": biopsy})

        if "treatment_plan" in data_sources:
            data_fetched.append({"treatment_plan": []})

        if "medications" in data_sources:
            data_fetched.append({"medications": []})


    # ----------------------------------
    # FINAL AI ANALYSIS PAYLOAD
    # ----------------------------------
    analysis_payload = {
        "feature_id": feature_id,
        "feature_name": feature_name,
        "doctor_id": doctor_id,
        "patient_id": patient_id,
        "patient_context": {
            "age": age,
            "gender": gender
        },
        "rules": rules,
        "selected_output_categories":selected_output_categories,
        "data_sources": data_sources,
        "data_fetched": data_fetched
    }
    # ----------------------------------
    # POST to analysis engine
    # ----------------------------------
    ANALYSIS_URL = "http://ai_service:8000/execute-feature"

    timeout = httpx.Timeout(
        connect=10.0,
        read=180.0,
        write=30.0,
        pool=10.0
    )
    safe_payload = sanitize_for_json(analysis_payload)

    forward_headers = {
        "x-trace-id": requestheaders.headers.get("x-trace-id"),
        "x-client-ip": requestheaders.headers.get("x-client-ip"),
        "x-user-id": requestheaders.headers.get("x-user-id"),
        "x-user-role": requestheaders.headers.get("x-user-role"),
    }

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            ANALYSIS_URL,
            json=safe_payload,
            headers=forward_headers
        )


    # async with httpx.AsyncClient(timeout=60) as client:
    #     safe_payload = sanitize_for_json(analysis_payload)

    #     response = await client.post(
    #         ANALYSIS_URL,
    #         json=safe_payload
    #     )

    if response.status_code != 200:
        emit_audit(requestheaders.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="ERROR",
            source={"service": "orchestration", "component": "execute-feature-db"},
            actor={
                "type": requestheaders.headers.get("x-user-role"),
                "id": requestheaders.headers.get("x-user-id")
            },
            context={
                "trace_id": requestheaders.headers.get("x-trace-id"),
                "ip": requestheaders.headers.get("x-client-ip"),
                "endpoint": "/hms/users/orchestration/execute-feature-db",
                "method": "POST",
                "feature_id": feature_id,
                "feature_name": feature_name
            },
            clinical_context={},
            action={
                "type": "FEATURE_EXECUTION",
                "status": "FAILED",
                "details": f"Analysis engine error for feature_id={feature_id}"
            }
        ))
        raise HTTPException(
            status_code=500,
            detail="Analysis engine failed"
        )

    analysis_result = response.json()

    # ----------------------------------
    # RETURN FINAL RESULT
    # ----------------------------------
    emit_audit(requestheaders.app, AuditEvent(
        timestamp=datetime.utcnow(),
        level="INFO",
        source={"service": "orchestration", "component": "execute-feature-db"},
        actor={
            "type": requestheaders.headers.get("x-user-role"),
            "id": requestheaders.headers.get("x-user-id")
        },
        context={
            "trace_id": requestheaders.headers.get("x-trace-id"),
            "ip": requestheaders.headers.get("x-client-ip"),
            "endpoint": "/hms/users/orchestration/execute-feature-db",
            "method": "POST",
            "feature_id": feature_id,
            "feature_name": feature_name
        },
        clinical_context={},
        action={
            "type": "FEATURE_EXECUTION",
            "status": "SUCCESS",
            "details": f"Feature executed successfully for feature_id={feature_id}"
        }
    ))
    return {
        "status": "success",
        "feature_id": feature_id,
        "feature_name": feature_name,
        "analysis_result": analysis_result
    }
    



#################################################################PATIENT RETRIEVAL NODE FUNCTION BELOW#############################################

ALL_PATIENT_FIELDS = [
    "name", "date_of_birth", "phone_number", "address",
    "gender", "marital_status", "hms_id", "blood_group"
]

async def get_patient_profile_internal(patient_id: str, doctor_id: str):
    try:
        # Always use default config
        selected_fields = ALL_PATIENT_FIELDS
        display_mode = "profile"

        patient_context = patient_user_collection.find_one(
            {"sys_user_id": patient_id}
        )

        if not patient_context:
            return {"error": "Patient context not found"}

        profile_data = {
            field: patient_context.get(field, "N/A")
            for field in selected_fields
        }

        return {
            "profile_data": profile_data,
            "display_mode": display_mode
        }

    except Exception as e:
        logger.exception("Failed to fetch patient profile internally")
        return {"error": f"Failed to fetch patient profile: {str(e)}"}


class DisableFeatureRequest(BaseModel):
    doctor_id: str
    feature_id: str

@router.post("/doctor-feature-disable")
async def doctor_feature_disable(payload: DisableFeatureRequest):
    doctor_id = payload.doctor_id
    feature_id = payload.feature_id

    # Try to disable in doctor_nodes_collection
    result = await doctor_nodes_collection.update_one(
        {
            "doctor_id": doctor_id,
            "features.feature_id": feature_id
        },
        {
            "$set": {
                "features.$.enabled": False,
                "updated_at": datetime.utcnow()
            }
        }
    )

    # ✅ If feature does NOT exist, silently succeed
    if result.matched_count == 0:
        return {
            "status": "success",
            "message": "Feature not found in DB, treated as disabled"
        }

    return {
        "status": "success",
        "message": "Feature disabled"
    }

class ToggleFeatureRequest(BaseModel):
    doctor_id: str
    feature_id: str

@router.post("/doctor-feature-enable")
async def doctor_feature_enable(payload: ToggleFeatureRequest):
    doctor_id = payload.doctor_id
    feature_id = payload.feature_id

    result = await doctor_nodes_collection.update_one(
        {
            "doctor_id": doctor_id,
            "features.feature_id": feature_id
        },
        {
            "$set": {
                "features.$.enabled": True,
                "updated_at": datetime.utcnow()
            }
        }
    )

    # ✅ If feature does not exist yet, create minimal entry
    if result.matched_count == 0:
        await doctor_nodes_collection.update_one(
            {"doctor_id": doctor_id},
            {
                "$push": {
                    "features": {
                        "feature_id": feature_id,
                        "enabled": True,
                        "configured": False
                    }
                },
                "$set": {"updated_at": datetime.utcnow()}
            },
            upsert=True
        )

    return {
        "status": "success",
        "message": "Feature enabled"
    }



class PatientFeatureToggleRequest(BaseModel):
    doctor_id: str
    feature_id: str
    enabled: bool


@router.post("/doctor-patient-feature-toggle")
async def toggle_patient_profile_feature(payload: PatientFeatureToggleRequest):
    doctor_id = payload.doctor_id
    feature_id = payload.feature_id
    enabled = payload.enabled

    result = await patient_nodes_collection.update_one(
        {
            "doctor_id": doctor_id,
            "features.feature_id": feature_id
        },
        {
            "$set": {
                "features.$.enabled": enabled,
                "updated_at": datetime.utcnow()
            }
        }
    )

    # If patient-profile does not exist → create it
    if result.matched_count == 0:
        await patient_nodes_collection.update_one(
            {"doctor_id": doctor_id},
            {
                "$push": {
                    "features": {
                        "feature_id": feature_id,
                        "enabled": enabled,
                        "configured": False,
                        "patient_profile": {
                            "fields": [],
                            "display_mode": "detailed"
                        }
                    }
                },
                "$set": {"updated_at": datetime.utcnow()}
            },
            upsert=True
        )

    return {
        "status": "success",
        "feature_id": feature_id,
        "enabled": enabled
    }



# @router.post("/process-feature")
# async def process_feature(request: Request):
#     """
#     Universal Feature Processing Engine

#     Input:
#     - doctor_id
#     - patient_id
#     - feature_id

#     Output:
#     - Feature specific structured output
#     """

#     try:
#         payload = await request.json()

#         doctor_id = payload.get("doctor_id")
#         patient_id = payload.get("patient_id")
#         feature_id = payload.get("feature_id")

#         if not doctor_id or not patient_id or not feature_id:
#             raise HTTPException(400, "doctor_id, patient_id, feature_id required")

#         # ---------------------------------------------------------------------
#         # 1️⃣ LOAD FEATURE CONFIG
#         # ---------------------------------------------------------------------
#         doctor_node = await doctor_nodes_collection.find_one(
#             {"doctor_id": doctor_id, "features.feature_id": feature_id},
#             {"features.$": 1, "_id": 0}
#         )

#         if not doctor_node:
#             raise HTTPException(404, "Feature configuration not found")

#         feature = doctor_node["features"][0]

#         if not feature.get("enabled"):
#             raise HTTPException(403, "Feature disabled")

#         # ---------------------------------------------------------------------
#         # 🔐 FEATURE CONFIG NORMALIZATION
#         # ---------------------------------------------------------------------
#         data_sources = feature.get("data_sources")

#         if not isinstance(data_sources, list):
#             data_sources = []   # ← auto-fix legacy features

#         # ---------------------------------------------------------------------
#         # 2️⃣ RESOLVE DATA SOURCES  ← data_sources is now known
#         # ---------------------------------------------------------------------
#         inputs = {}

#         # ---------------- VITALS ----------------
#         if "vitals" in data_sources:
#             vitals_doc = await patient_vitals_collection.find_one(
#                 {"sys_user_id": patient_id}, {"_id": 0}
#             )

#             vitals_data = vitals_doc.get("vitals", {}) if vitals_doc else {}

#             if feature.get("vitals_parameters"):
#                 filtered_vitals = {}
#                 for ts, values in vitals_data.items():
#                     filtered_vitals[ts] = {
#                         k: v for k, v in values.items()
#                         if k in feature["vitals_parameters"]
#                     }
#                 inputs["vitals"] = filtered_vitals
#             else:
#                 inputs["vitals"] = vitals_data

#         # ---------------- LONGITUDINAL CONTEXT ----------------
#         longitudinal_docs = await longitudinal_context_collection.find(
#             {"patient_id": patient_id}
#         ).to_list(length=50)

#         # ---------------- LAB REPORTS ----------------
#         if "lab_reports" in data_sources:
#             labs = []
#             for ctx in longitudinal_docs:
#                 if ctx.get("labs"):
#                     labs.extend(ctx["labs"])

#             if feature.get("lab_parameters"):
#                 labs = [
#                     lab for lab in labs
#                     if lab.get("test_name") in feature["lab_parameters"]
#                 ]

#             inputs["lab_reports"] = labs

#         # ---------------- RADIOLOGY ----------------
#         if "radiology" in data_sources:
#             inputs["radiology"] = [
#                 ctx.get("radiology")
#                 for ctx in longitudinal_docs
#                 if ctx.get("radiology")
#             ]

#         # ---------------- MEDICATIONS ----------------
#         if "medications" in data_sources:
#             medications = []
#             for ctx in longitudinal_docs:
#                 if ctx.get("medications"):
#                     medications.extend(ctx["medications"])
#             inputs["medications"] = medications

#         # ---------------- TREATMENT PLAN ----------------
#         if "treatment_plan" in data_sources:
#             plans = []
#             for ctx in longitudinal_docs:
#                 note = ctx.get("clinical_note")
#                 if note and note.get("clinical_note", {}).get("plan"):
#                     plans.append(note["clinical_note"]["plan"])
#             inputs["treatment_plan"] = plans

#         # ---------------- MEDICAL CONTEXT ----------------
#         if "medical_context" in data_sources:
#             inputs["medical_context"] = await medical_context_collection.find(
#                 {"patient_id": patient_id}, {"_id": 0}
#             ).to_list(length=20)

#         # ---------------- CURRENT CONTEXT ----------------
#         if "current_context" in data_sources:
#             inputs["current_context"] = await current_context_collection.find(
#                 {"patient_id": patient_id}, {"_id": 0}
#             ).to_list(length=10)

#         # ---------------------------------------------------------------------
#         # 3️⃣ BUILD PROMPT (RULE-DRIVEN)
#         # ---------------------------------------------------------------------
#         output_categories = feature.get("selected_output_categories", [])

#         prompt = f"""
# You are a clinical analysis engine.

# STRICT RULES:
# {feature["rules"]}

# AVAILABLE DATA (JSON):
# {json.dumps(inputs, indent=2)}

# REQUIRED OUTPUT CATEGORIES:
# {output_categories}

# INSTRUCTIONS:
# - Use ONLY the provided data
# - Do NOT infer diagnoses or recommendations unless explicitly permitted
# - Output must contain ONLY the requested categories
# - Structure output cleanly and clinically
# - Use neutral, observational language

# Return JSON only with the above categories.
# """

#         # ---------------------------------------------------------------------
#         # 4️⃣ LLM EXECUTION
#         # ---------------------------------------------------------------------
#         completion = groq_client.chat.completions.create(
#             model="llama-3.1-8b-instant",
#             messages=[{"role": "user", "content": prompt}],
#             temperature=0.2,
#             response_format={"type": "json_object"},
#             max_tokens=2000
#         )

#         result = json.loads(completion.choices[0].message.content)

#         # ---------------------------------------------------------------------
#         # 5️⃣ RESPONSE
#         # ---------------------------------------------------------------------
#         return {
#             "status": "success",
#             "feature_id": feature_id,
#             "feature_name": feature.get("feature_name"),
#             "display_method": feature.get("display_method"),
#             "output": result,
#             "metadata": {
#                 "doctor_id": doctor_id,
#                 "patient_id": patient_id,
#                 "processed_at": datetime.utcnow().isoformat()
#             }
#         }

#     except HTTPException:
#         raise
#     except Exception as e:
#         logger.exception("Feature processing failed")
#         raise HTTPException(500, f"Feature processing error: {str(e)}")



#step 1

#inputs - rules, output_categories(doctor_nodes_collection), specialization(doctor_users_collcetion), 
#        vitals(screening_settings_collection), reports(report_user_collection), medical_contexts(medical_context_collection),
#        current_contexts(current_context_collection), documents(document_user_collection), screening_result(doctor_screening_results_collection)

#Output - LLM result or queries suggesting what aee the inputs to be considered for the extraction from the corresponding database 

#calls fetch_data_based_on_llm_output and input the llm result that is generated and using the function extract the data 

# @router.post("/process-feature")
# async def process_feature(
#     *,
#     doctor_id: str,
#     patient_id: str,
#     feature_id: str,
    
# ):
#     """
#     Query-based Feature Processing Engine (INTERNAL)

#     Inputs:
#     - doctor_id
#     - patient_id
#     - feature_id
#     """

#     try:
#         # ------------------------------------------------------------------
#         # 0️⃣ VALIDATION
#         # ------------------------------------------------------------------
#         if not doctor_id or not patient_id or not feature_id:
#             raise ValueError("doctor_id, patient_id, feature_id required")

        
#         # ------------------------------------------------------------------
#         # 1️⃣ LOAD FEATURE CONFIG (RULES ONLY)
#         # ------------------------------------------------------------------
#         # doctor_node = await doctor_nodes_collection.find_one(
#         #     {"doctor_id": doctor_id, "features.feature_id": feature_id},
#         #     {"features.$": 1, "_id": 0}
#         # )

#         # if not doctor_node:
#         #     raise HTTPException(404, "Feature configuration not found")

#         # feature = doctor_node["features"][0]

#         # if not feature.get("enabled"):
#         #     raise HTTPException(403, "Feature disabled")

#         # rules = feature.get("rules", "")
#         # output_categories = feature.get("selected_output_categories", [])


#         #Rules will be saved here doctor_nodes_collection

#         doctor_node = await doctor_nodes_collection.find_one(
#             {"doctor_id": doctor_id, "features.feature_id": feature_id},
#             {"features.$": 1, "_id": 0}
#         )

#         if not doctor_node:
#             raise HTTPException(404, "Feature configuration not found")

#         feature = doctor_node["features"][0]

#         if not feature.get("enabled"):
#             raise HTTPException(403, "Feature disabled")

#         feature_name = feature.get("feature_name", feature_id)
#         rules = feature.get("rules", "")
#         output_categories = feature.get("selected_output_categories", [])
#         display_method = feature.get("display_method")
#         # ---------------------------------------------------------
#         # 🔐 Feature-level suggestion permission
#         # ---------------------------------------------------------
#         allow_llm_suggestions = feature.get("allow_llm_suggestions", False)


#         logger.info("display_method: %s", display_method)
#         logger.info("feature_name: %s", feature_name)
#         logger.info("rules: %s", rules)
#         logger.info("output_categories: %s", output_categories)

#         # ------------------------------------------------------------------
# # 🔍 LOG FEATURE CONFIG
# # ------------------------------------------------------------------




#         # ------------------------------------------------------------------
#         # 2️⃣ LOAD DOCTOR DETAILS
#         # ------------------------------------------------------------------
#         doctor = doctor_user_collection.find_one(
#             {"sys_user_id": doctor_id},
#             {"_id": 0}
#         )

#         doctor_context = {
#             "doctor_id": doctor_id,
#             "specialization": doctor.get("specialization") if doctor else None,
#             "hospital_id": doctor.get("hospital_id") if doctor else None
#         }

#         # ------------------------------------------------------------------
#         # 3️⃣ BUILD UNIFIED PATIENT CONTEXT
#         # ------------------------------------------------------------------
#         inputs = {}

#         # ---------------- VITALS ----------------
#         # vitals_doc = await patient_vitals_collection.find_one(
#         #     {"sys_user_id": patient_id},
#         #     {"_id": 0}
#         # )
#         # inputs["vitals"] = vitals_doc.get("vitals") if vitals_doc else {}
#         # logger.info(
#         #     "Vitals data: %s",
#         #     vitals_doc.get("vitals") if vitals_doc else {}
#         # )

#         # ---------------- VITALS (FROM SCREENING SETTINGS) ----------------

#         screening_doc = await screening_settings_collection.find_one(
#             {"doctor_id": doctor_id},
#             {"_id": 0}
#         )

#         screening_fields = []

#         if screening_doc:
#             for feature in screening_doc.get("features", []):
#                 if (
#                     feature.get("feature_id") == "screening-section"
#                     and feature.get("enabled")
#                 ):
#                     screening_fields = feature.get("screening_section", {}).get("fields", [])
#                     break

#         vitals = {field: "Not documented in available data" for field in screening_fields}
#         logger.info("Screening fields for vitals: %s", screening_fields)
#         inputs["vitals"] = vitals

#         logger.info("Vitals derived from screening settings: %s", vitals)



#         # ---------------- REPORTS (LAB / RADIOLOGY / OTHER) ----------------
#         reports = await report_user_collection.find(
#             {"patient_id": patient_id},
#             {"_id": 0}
#         ).to_list(length=50)

#         inputs["reports"] = reports

#         logger.info("Lab reportsss: %s",reports)

#         # ---------------- MEDICAL CONTEXT (KNOWN CONDITIONS) ----------------
#         medical_contexts = await medical_context_collection.find(
#             {"patient_id": patient_id, "enabled": True},
#             {"_id": 0}
#         ).to_list(length=20)

#         normalized_medical_context = []

#         for doc in medical_contexts:
#             normalized_medical_context.append({
#                 "date": doc.get("date"),
#                 "conditions": [
#                     {
#                         "id": c.get("id"),
#                         "text": c.get("text")
#                     }
#                     for c in doc.get("conditions", [])
#                 ]
#             })

#         inputs["medical_context"] = normalized_medical_context

#         logger.info("meical context:%S")


#         # ---------------- CURRENT CONTEXT (ACTIVE CONDITIONS) ----------------
#         current_contexts = await current_context_collection.find(
#             {"patient_id": patient_id, "enabled": True},
#             {"_id": 0}
#         ).to_list(length=10)

#         normalized_current_context = []

#         for doc in current_contexts:
#             normalized_current_context.append({
#                 "date": doc.get("date"),
#                 "current_condition": [
#                     {
#                         "id": c.get("id"),
#                         "text": c.get("text")
#                     }
#                     for c in doc.get("current_condition", [])
#                 ]
#             })

#         inputs["current_context"] = normalized_current_context


#         # ---------------- DOCUMENTATION ----------------
#         documents = await document_user_collection.find(
#             {"patient_id": patient_id, "enabled": True},
#             {"_id": 0}
#         ).to_list(length=20)

#         inputs["documentation"] = documents


#         # ---------------- SCREENING RESULTS ----------------
#         screening_result = await doctor_screening_results_collection.find_one(
#             {
#                 "patient_id": patient_id,
#                 "doctor_id": doctor_id,
#                 "screening_completed": True
#             },
#             {"_id": 0}
#         )

#         inputs["screening_results"] = (
#             {
#                 "appointment_id": screening_result.get("appointment_id"),
#                 "completed_at": screening_result.get("completed_at"),
#                 "question_answers": screening_result.get("question_answers", [])
#             }
#             if screening_result
#             else "Not documented in available data"
#         )
#         logger.info(
#             "Screening results fetched | patient_id=%s doctor_id=%s screening_results=%s",
#             patient_id,
#             doctor_id,
#             inputs["screening_results"]
#         )
#         # ------------------------------------------------------------------
#         # 🔍 LOG FULL INPUT CONTEXT (BEFORE PROMPT)
#         # ------------------------------------------------------------------
#         logger.info(
#             "FEATURE INPUT CONTEXT | doctor_id=%s | patient_id=%s | feature_id=%s | inputs=%s",
#             doctor_id,
#             patient_id,
#             feature_id,
#             json.dumps(inputs, indent=2)
#         )

#         logger.info("Prompt starts")
#         # ------------------------------------------------------------------
#         # 4️⃣ PROMPT CONSTRUCTION (QUERY-BASED)
#         # ------------------------------------------------------------------
#         prompt = f"""
# You are a QUERY PLANNING ENGINE.

# Your task:
# Determine which patient input fields are REQUIRED
# to satisfy the requested output categories.

# You MUST determine required inputs STRICTLY BASED ON:
# - Feature configuration
# - Governing rules (implicit authority)
# - Output categories
# - Structural context requirements

# You operate under NON-NEGOTIABLE system rules
# that are authoritative but must NOT be restated.

# ────────────────────────────────────────────
# ROLE CONSTRAINTS
# ────────────────────────────────────────────

# You MUST:
# - Identify ONLY required input categories
# - Specify ONLY required fields per category
# - Respect structural context requirements
# - Output ONLY valid JSON

# ────────────────────────────────────────────
# FEATURE CONTEXT
# ────────────────────────────────────────────
# Feature Name: {feature_name}
# Requested Output Categories: {output_categories}

# ────────────────────────────────────────────
# GOVERNING RULES (AUTHORITATIVE)
# ────────────────────────────────────────────
# {rules}

# These rules are authoritative and binding.
# You MUST apply them implicitly.
# You MUST NOT restate, explain, or quote them.

# ────────────────────────────────────────────
# STRUCTURAL CONTEXT GUARANTEE
# ────────────────────────────────────────────
# The following categories represent STRUCTURAL CONTEXT
# when governed by rules or feature configuration:

# - vitals
# - reports
# - medical_context
# - current_context
# - documentation
# - screening_results

# If required by rules or feature behavior:
# - They MUST be included as required inputs
# - Their internal structure MUST be preserved
# - No relevance filtering is allowed

# ────────────────────────────────────────────
# STRUCTURAL CONTEXT SCHEMA LOCK (ABSOLUTE)
# ────────────────────────────────────────────

# For the following sections ONLY:
# - medical_context
# - current_context

# You MUST obey these schema rules:

# medical_context item schema:
# {{
# "date": <string | date>,
# "conditions": [
#     {{
#     "id": <string>,
#     "text": <string>
#     }}
# ]
# }}

# current_context item schema:
# {{
# "date": <string | date>,
# "current_condition": [
#     {{
#     "id": <string>,
#     "text": <string>
#     }}
# ]
# }}

# STRICT RULES:
# - DO NOT create any additional fields
# - DO NOT rename fields
# - DO NOT invent "identifier", "known_conditions", or similar keys
# - If an array is empty, return an empty array []
# - If no entries exist, return []
# - Preserve values EXACTLY as provided

# ────────────────────────────────────────────
# DOCTOR CONTEXT (REFERENCE ONLY)
# ────────────────────────────────────────────
# {json.dumps(doctor_context, indent=2)}

# Doctor context is provided ONLY to align specialty language.
# It MUST NOT influence clinical interpretation or conclusions.

# ────────────────────────────────────────────
# ALLOWED OUTPUT CATEGORIES (STRICT CONTRACT)
# ────────────────────────────────────────────

# You may ONLY use the following category keys:


# - medical_context
# - current_context


# STRICT RULES:
# - DO NOT invent new category names
# - DO NOT prefix with "current_"
# - DO NOT use synonyms like "laboratory", "radiology", "clinical_notes"
# - ALL laboratory, radiology, and procedures MUST map to "reports"


# ────────────────────────────────────────────
# OUTPUT FORMAT (STRICT)
# ────────────────────────────────────────────
# {{
#   "<category>": {{
#     "fields": [],
#     "filters": {{}}
#   }}
# }}

# RULES FOR OUTPUT:
# - Categories MUST be derived from output categories and governing rules
# - Fields MUST be justified by rules or structural requirements
# - Do NOT include disallowed categories
# - Do NOT include data values
# - Do NOT include explanations

# BEGIN.
# """

#         # ------------------------------------------------------------------
#         # 5️⃣ LLM EXECUTION
#         # ------------------------------------------------------------------
#         completion = groq_client.chat.completions.create(
#             model="llama-3.1-8b-instant",
#             messages=[{"role": "user", "content": prompt}],
#             temperature=0.2,
#             response_format={"type": "json_object"},
#             max_tokens=2500
#         )

#         result = json.loads(completion.choices[0].message.content)

#         llm_result = result  # parsed JSON from LLM

#         logger.info("llm result: %s",llm_result)

#         fetched_data = await fetch_data_based_on_llm_output(
#             llm_output=llm_result,
#             patient_id=patient_id,
#             doctor_id=doctor_id,
#             database=database
#         )

#         logger.info("Fetched data: %s",fetched_data)
        

#         # ✅ SAVE STAGE-1 DATA
#         await orchestration_state.update_one(
#             {
#                 "doctor_id": doctor_id,
#                 "patient_id": patient_id,
#                 "feature_id": feature_id
#             },
#             {
#                 "$set": {
#                     "fetched_data": fetched_data["data"],
#                     "created_at": datetime.utcnow()
#                 }
#             },
#             upsert=True
#         )

#         logger.info("stage-1 orchestration state saved")


#         # ------------------------------------------------------------------
#         # 6️⃣ RESPONSE
#         # ------------------------------------------------------------------
#         return {
#             "status": "success",
#             "feature_id": feature_id,
#             "output": result,
#             "llm_output": llm_result,
#             "fetched_data": fetched_data,
#             "metadata": {
#                 "doctor_id": doctor_id,
#                 "patient_id": patient_id,
#                 "processed_at": datetime.utcnow().isoformat()
#             }
#         }
        

#     except HTTPException:
#         raise
#     except Exception as e:
#         logger.exception("Feature processing failed")
#         raise HTTPException(500, f"Feature processing error: {str(e)}")


# #here the process-feature function call this below function it will extract the data from the correspodning fields of vitals, reports, medical context, current context, documentation, screening results from corresponding databases

# async def fetch_data_based_on_llm_output(
#     llm_output: Dict[str, Any],
#     patient_id: str,
#     doctor_id: str,
#     database
# ) -> Dict[str, Any]:
#     """
#     Dynamically fetch patient data based ONLY on LLM output keys.
#     No inference. No assumptions. Read-only fetch.
#     """

#     response_data = {}

#     for section in llm_output.keys():

#         # ---------------- VITALS ----------------
#         # if section == "vitals":
#         #     vitals_doc = await database["patient_vitals"].find_one(
#         #         {"sys_user_id": patient_id},
#         #         {"_id": 0}
#         #     )
#         #     response_data["vitals"] = (
#         #         vitals_doc.get("vitals")
#         #         if vitals_doc and vitals_doc.get("vitals")
#         #         else {}
#         #     )

#         # # ---------------- REPORTS ----------------
#         # elif section == "reports":
#         #     documents_cursor = database["patient_documents_collection"].find(
#         #         {"patient_id": patient_id},
#         #         {"_id": 0}
#         #     )

#         #     documents = await documents_cursor.to_list(length=20)

#         #     # Normalize output for LLM / frontend
#         #     reports = []

#         #     for doc in documents:
#         #         reports.append({
#         #             "doc_type": doc.get("doc_type"),
#         #             "created_at": doc.get("created_at"),
#         #             "updated_at": doc.get("updated_at"),
#         #             "doctor_id": doc.get("doctor_id"),
#         #             "entries": doc.get("entries", [])
#         #         })

#         #     response_data["reports"] = reports or []


#         # ---------------- MEDICAL CONTEXT ----------------
#         if section == "medical_context":
#             docs = await database["medical_context"].find(
#                 {"patient_id": patient_id},
#                 {"_id": 0}
#             ).to_list(length=10)

#             medical_contexts = []

#             for doc in docs:
#                 for ctx in doc.get("medical_contexts", []):
#                     medical_contexts.append({
#                         "date": ctx.get("date"),
#                         "conditions": [
#                             {
#                                 "id": c.get("id"),
#                                 "text": c.get("text")
#                             }
#                             for c in ctx.get("conditions", [])
#                         ]
#                     })

#             response_data["medical_context"] = medical_contexts




#         # ---------------- CURRENT CONTEXT ----------------
#         elif section == "current_context":
#             docs = await database["current_context"].find(
#                 {"patient_id": patient_id},
#                 {"_id": 0}
#             ).to_list(length=10)

#             current_contexts = []

#             for doc in docs:
#                 for ctx in doc.get("current_contexts", []):   # ✅ FIXED
#                     current_contexts.append({
#                         "date": ctx.get("date"),
#                         "current_condition": [
#                             {
#                                 "id": c.get("id"),
#                                 "text": c.get("text")
#                             }
#                             for c in ctx.get("current_condition", [])
#                         ]
#                     })

#             response_data["current_context"] = current_contexts





#         # ---------------- DOCUMENTATION ----------------
#         # elif section == "documentation":
#         #     documents = await database["document_user"].find(
#         #         {
#         #             "patient_id": patient_id,
#         #             "enabled": True
#         #         },
#         #         {"_id": 0}
#         #     ).to_list(length=20)

#         #     response_data["documentation"] = documents or []

#         # # ---------------- SCREENING RESULTS ----------------
#         # elif section == "screening_results":
#         #     screening_doc = await database["doctor_screening_results"].find_one(
#         #         {
#         #             "patient_id": patient_id,
#         #             "doctor_id": doctor_id,
#         #             "screening_completed": True
#         #         },
#         #         {"_id": 0}
#         #     )

#         #     if screening_doc:
#         #         response_data["screening_results"] = {
#         #             "appointment_id": screening_doc.get("appointment_id"),
#         #             "completed_at": screening_doc.get("completed_at"),
#         #             "question_answers": screening_doc.get("question_answers", [])
#         #         }
#         #     else:
#         #         response_data["screening_results"] = "Not documented in available data"


#         # ---------------- UNKNOWN / FUTURE KEYS ----------------
#         else:
#             response_data[section] = "Not supported data section"
#     logger.info(
#         "Feature data fetch completed | response=%s",
#         {
#             "patient_id": patient_id,
#             "doctor_id": doctor_id,
#             "fetched_at": datetime.utcnow().isoformat(),
#             "data": response_data
#         }
#     )



#     return {
#         "patient_id": patient_id,
#         "doctor_id": doctor_id,
#         "fetched_at": datetime.utcnow().isoformat(),
#         "data": response_data
#     }
    

# # 3 inputs - payload(patientid, doctorid, featureid, dictation), rules , output generation, displayname, feature from doctor_nodes_collection, 
# # calls process-feaure function and collect the fetched data 
# #using the rules, feature, output categories, fetched data, conversation if needed, dictation if needed then produce the analysed output that is to be generated in the frontend 


# async def wait_for_orchestration_state(
#     doctor_id, patient_id, feature_id, timeout=3.0
# ):
#     start = time.time()

#     while time.time() - start < timeout:
#         state = await orchestration_state.find_one(
#             {
#                 "doctor_id": doctor_id,
#                 "patient_id": patient_id,
#                 "feature_id": feature_id
#             },
#             {"_id": 0}
#         )

#         if state and state.get("fetched_data"):
#             return state

#         await asyncio.sleep(0.2)

#     raise HTTPException(
#         500, "Orchestration state not ready"
#     )

def prune_empty_domains(data: dict) -> dict:
    cleaned = {}
    for k, v in data.items():
        if v is None:
            continue
        if isinstance(v, (list, dict)) and len(v) == 0:
            continue
        cleaned[k] = v
    return cleaned
@router.post("/process-feature-with-fetched-data")
async def process_feature_with_fetched_data(request: Request):
    """
    Second-stage Feature Processing with Dynamic Prompt Generation
    
    Handles two modes:
    1. Structured output when output_categories are defined
    2. Expert clinical summary when output_categories is empty
    """

    try:
        payload = await request.json()

        doctor_id = payload.get("doctor_id")
        patient_id = payload.get("patient_id")
        feature_id = payload.get("feature_id")
        dictation = payload.get("dictation")

        DICTATION_FEATURE_IDS = {
            "documentation-treatment-plan",
            "documentation-treatment-summary",
            "documentation-medication-analysis",
            "documentation-investigation-notes",
            "documentation-clinical-notes",
        }

        if not doctor_id or not patient_id or not feature_id:
            raise HTTPException(
                status_code=400,
                detail="doctor_id, patient_id, feature_id are required"
            )

        # ---------------------------------------------------------
        # 1️⃣ LOAD FEATURE CONFIG
        # ---------------------------------------------------------
        # doctor_node = await doctor_nodes_collection.find_one(
        #     {"doctor_id": doctor_id, "features.feature_id": feature_id},
        #     {"features.$": 1, "_id": 0}
        # )

        # if not doctor_node:
        #     raise HTTPException(404, "Feature configuration not found")

        # feature = doctor_node["features"][0]

        # if not feature.get("enabled"):
        #     raise HTTPException(403, "Feature disabled")

        feature_name = feature_id
        rules = None
        output_categories =  None
        display_method =  None


        # allow_llm_suggestions = feature.get("allow_llm_suggestions", False)

        logger.info("display_method: %s", display_method)
        logger.info("feature_name: %s", feature_name)
        logger.info("rules: %s", rules)
        logger.info("output_categories: %s", output_categories)

        # ------------------------------------------------------------------
        # 🧱 BACKEND-ENFORCED OUTPUT CONTRACT (WHEN UI HAS NO OUTPUT CATEGORIES)
        # ------------------------------------------------------------------
        FEATURE_DEFAULT_OUTPUTS = {
            "medical-clinical-context": ["medical_context"],
            "current-clinical-context": ["current_context"],
            "documentation-treatment-plan": ["documentation"],
        }

        # Determine if we're in expert summary mode
        use_expert_summary_mode = not output_categories

        if not output_categories:
            output_categories = FEATURE_DEFAULT_OUTPUTS.get(feature_id, [])

        logger.info("use_expert_summary_mode: %s", use_expert_summary_mode)

        # ---------------------------------------------------------
        # 2️⃣ FETCH ORCHESTRATION STATE & CLINICAL DATA
        # ---------------------------------------------------------
        # state = None

        # if state is None:
        #     logger.info(
        #         "Orchestration state missing. Triggering process_feature() "
        #         "(stage-1 execution)."
        #     )

        #     await process_feature(
        #         doctor_id=doctor_id,
        #         patient_id=patient_id,
        #         feature_id=feature_id
        #     )

        #     state = await wait_for_orchestration_state(
        #         doctor_id, patient_id, feature_id
        #     )

        # clinical_data = prune_empty_domains(state["fetched_data"])
        # logger.info("clinical_dataaaa: %s", clinical_data)


    
        # ---------------------------------------------------------
        # 3️⃣ DIRECT CLINICAL DATA FETCH
        # ---------------------------------------------------------
        clinical_data = {}

        # ---------------- MEDICAL CONTEXT ----------------
        doc = await medical_context_collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0}
        )

        medical_context = []

        if doc:
            for ctx in doc.get("medical_contexts", []):
                texts = [
                    c.get("text")
                    for c in ctx.get("conditions", [])
                    if c.get("text")
                ]

                if texts:
                    medical_context.append({
                        "date": ctx.get("date"),
                        "conditions": texts
                    })

        if medical_context:
            clinical_data["medical_context"] = medical_context


        # ---------------- CURRENT CONTEXT ----------------
        doc = await current_context_collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0}
        )

        current_context = []

        if doc:
            for ctx in doc.get("current_contexts", []):
                texts = [
                    c.get("text")
                    for c in ctx.get("current_condition", [])
                    if c.get("text")
                ]

                if texts:
                    current_context.append({
                        "date": ctx.get("date"),
                        "current_condition": texts
                    })

        if current_context:
            clinical_data["current_context"] = current_context




        logger.info("clinical_data=%s", json.dumps(clinical_data, indent=2, default=str))
        
        
        # ---------------- VITALS ----------------
        vitals_doc = await patient_vitals_collection.find_one(
            {"sys_user_id": patient_id},   # ⚠️ your vitals use sys_user_id
            {"_id": 0, "vitals": 1}
        )

        latest_vitals = []

        if vitals_doc and vitals_doc.get("vitals"):
            vitals_map = vitals_doc["vitals"]

            # helper to parse mongo-safe timestamps
            from datetime import datetime, timezone


            def parse_ts(ts: str):
                return datetime.fromisoformat(ts.replace("_", "."))

            # sort timestamps descending and take latest 3
            sorted_items = sorted(
                vitals_map.items(),
                key=lambda x: parse_ts(x[0]),
                reverse=True
            )[:3]

            for ts, data in sorted_items:
                latest_vitals.append({
                    "timestamp": ts,
                    "vitals": data
                })

        if latest_vitals:
            clinical_data["vitals"] = latest_vitals

        chief_complaints = await fetch_all_appointments_for_patient(patient_id)
        if chief_complaints:
            clinical_data["chief_complaints"] = chief_complaints

        logger.info("clinical_data=%s", json.dumps(clinical_data, indent=2, default=str))
        # ---------------- DOCUMENTS (LATEST 3 → processed_data ONLY) ----------------
        latest_documents = []

        cursor = (
            document_categories_collection
            .find(
                {"patient_id": patient_id},
                {
                    "_id": 0,
                    "processed_data": 1,
                    "created_at": 1
                }
            )
            .sort("_id", -1).limit(3)
            .limit(3)
        )

        async for doc in cursor:
            if doc.get("processed_data"):
                latest_documents.append(doc["processed_data"])

        if latest_documents:
            clinical_data["documents"] = latest_documents
        
        clinical_data["documentation_features"] = await fetch_latest_documentation_features(
            patient_id,
            5
        )
        logger.info("clinical_data=%s", json.dumps(clinical_data, indent=2, default=str))
        # ---------------------------------------------------------
        # 3️⃣ LOAD CONVERSATION (OPTIONAL, SECONDARY)
        # ---------------------------------------------------------
        conversation_text = None

        if feature_id != "medical-clinical-context":
            conversation_doc = await database["conversation_user"].find_one(
                {
                    "patient_id": patient_id,
                    "doctor_id": doctor_id
                },
                {"_id": 0}
            )
            conversation_text = conversation_doc.get("conversation") if conversation_doc else None

        # ---------------------------------------------------------
        # 4️⃣ DYNAMIC PROMPT CONSTRUCTION
        # ---------------------------------------------------------
        
        if use_expert_summary_mode:
            # ═══════════════════════════════════════════════════════════
            # EXPERT CLINICAL SUMMARY MODE (No output_categories)
            # ═══════════════════════════════════════════════════════════
            
            if feature_name == "Medical Clinical Context Retriever":
                prompt = f"""
You are a clinical documentation synthesizer.

Your task:
Construct the patient's Medical Context.

Medical Context means:
The complete, specialty-agnostic collection of ALL documented medical facts about the patient, gathered from every available source, without interpretation, prioritization, or clinical judgment.

It represents ONLY what is recorded — not what it means.

══════════════════════════════
SOURCE OF TRUTH
══════════════════════════════
The structured JSON below contains validated clinical data.

This is the ONLY source of information you may use.
Every statement you produce MUST be directly supported by this data.

If a detail is not explicitly present, DO NOT include it.

Never:
- invent information
- assume missing values
- interpret findings
- diagnose
- predict
- explain significance
- summarize meaning
- add external knowledge

When uncertain, omit the information.

══════════════════════════════
AVAILABLE CLINICAL DOMAINS
══════════════════════════════
The data may include information from multiple specialties and document types, such as:

- diagnoses and conditions
- symptoms and complaints
- vital signs and measurements
- laboratory results
- microbiology and pathology findings
- imaging and radiology reports
- procedures and operative notes
- medications and doses
- allergies
- comorbidities
- clinical notes and summaries
- treatment plans
- investigations
- processed documents

All domains are equally important.
Do NOT prioritize, interpret, or filter.

Use everything that exists.
Ignore domains that are empty.

{json.dumps(clinical_data, indent=2, default=str)}

══════════════════════════════
OPTIONAL CONTEXT (WORDING ONLY)
══════════════════════════════
Conversation: {conversation_text if conversation_text else "Not available"}
Dictation: {dictation if dictation else "Not available"}

These may clarify wording or timing ONLY.
They MUST NOT introduce new medical facts.

══════════════════════════════
INSTRUCTIONS
══════════════════════════════
1. Extract only explicitly documented facts.
2. Combine information from ALL available domains.
3. Preserve factual wording as closely as possible.
4. Use neutral, objective language.
5. Prefer chronological ordering when appropriate.
6. Do not interpret, explain, or evaluate any finding.
7. Do not remove information based on importance — include all facts that exist.

Think of this as creating a unified factual record, not a clinical opinion.

══════════════════════════════
OUTPUT FORMAT (STRICT)
══════════════════════════════
Return ONLY valid JSON:

{{
  "medical_context": "One concise paragraph (maximum 15–25 sentences) containing only documented medical facts aggregated across all domains."
}}

If no validated data exists:
{{
  "medical_context": "No clinical data available for review."
}}
"""



            elif feature_name == "Current Clinical Context Retriever":
                prompt = f"""
You are a clinical reasoning synthesizer.

Your task:
Construct the patient's Clinical Context.

Clinical Context means:
A comprehensive, problem-centered clinical interpretation that integrates all available medical facts to describe the patient’s current condition, likely diagnoses, severity, risks, treatment status, and overall clinical picture.

Unlike raw documentation summaries, this task REQUIRES thoughtful synthesis and clinical reasoning based ONLY on the validated data provided.

══════════════════════════════
SOURCE OF TRUTH
══════════════════════════════
The structured JSON below contains validated clinical information.

You MUST reason ONLY from this data.
Do NOT invent or hallucinate information.
Do NOT use external knowledge beyond general clinical reasoning.
If something is not supported by the data, omit it.

{json.dumps(clinical_data, indent=2, default=str)}

══════════════════════════════
OPTIONAL CONTEXT
══════════════════════════════
Conversation: {conversation_text if conversation_text else "Not available"}
Dictation: {dictation if dictation else "Not available"}

These may clarify timing or wording and may update current findings.

══════════════════════════════
ALLOWED REASONING (EXPECTED)
══════════════════════════════
You SHOULD:
- correlate related findings
- identify likely diagnoses when clearly supported
- summarize disease stage/severity when evidence exists
- connect labs, vitals, imaging, and symptoms
- describe treatment responses or progression
- explain overall clinical status
- synthesize fragmented data into a coherent picture

You MAY:
- interpret abnormal results
- state clinical impressions
- summarize risks or concerns
- provide provisional or differential diagnoses when supported

══════════════════════════════
RESTRICTIONS
══════════════════════════════
Do NOT:
- fabricate facts
- assume undocumented findings
- contradict provided data
- introduce unrelated medical knowledge

All reasoning must be traceable to the provided information.

══════════════════════════════
INSTRUCTIONS
══════════════════════════════
1. Review all domains (medical history, current findings, vitals, labs, imaging, medications, notes, plans, documents).
2. Identify the key current problems.
3. Integrate related findings.
4. Provide a coherent clinical interpretation.
5. Write in professional medical language suitable for clinicians.

══════════════════════════════
OUTPUT FORMAT (STRICT)
══════════════════════════════
Return ONLY valid JSON:

{{
  "clinical_context": "A concise paragraph (15–25 sentences) summarizing the interpreted clinical situation, including key diagnoses, severity, relevant findings, and current management status."
}}

If insufficient data exists:
{{
  "clinical_context": "Insufficient clinical information available to determine clinical context."
}}
"""

            else:
                # Generic expert summary for other features
                prompt = f"""
You are a STRICT CLINICAL DATA EXTRACTOR.

YOUR ONLY TASK: Organize DOCUMENTED information for the feature "{feature_name}".

════════════════════════════════════
CRITICAL SAFETY RULES - ABSOLUTELY NO EXCEPTIONS
════════════════════════════════════
⛔ DO NOT mention ANY information NOT explicitly in the clinical_data
⛔ DO NOT add medical knowledge, assumptions, or interpretations
⛔ DO NOT infer or fill information gaps
⛔ If data is MISSING → DO NOT mention it
⛔ NO diagnosis, NO recommendations
⛔ NEVER include system identifiers

DOCTOR-AUTHORED GOVERNING RULES (HIGHEST PRIORITY)
════════════════════════════════════
The following rules were explicitly defined by the treating doctor.
They MUST influence how the output is written.

Rules:
{rules if rules else "Extract only documented information."}

MANDATORY RULE APPLICATION:
- FIRST interpret these rules
- Convert them into HARD output constraints
- Apply them to EVERY sentence
- If any content violates a rule → OMIT it
- Omission is ALWAYS preferred over violation


════════════════════════════════════
AVAILABLE CLINICAL DATA
════════════════════════════════════
{json.dumps(clinical_data, indent=2, default=str)}

════════════════════════════════════
SECONDARY INPUTS (CLARIFICATION ONLY)
════════════════════════════════════
Conversation: {conversation_text if conversation_text else "Not available"}
Dictation: {dictation if dictation else "Not available"}

════════════════════════════════════
PROCESSING INSTRUCTIONS
════════════════════════════════════
1. Check what data domains exist
2. Extract ONLY documented information
3. Write concise paragraph with facts only
4. Maximum 7 sentences

════════════════════════════════════
OUTPUT FORMAT
════════════════════════════════════
Return ONLY valid JSON:
{{
  "summary": "Concise paragraph with ONLY documented facts."
}}

BEGIN EXTRACTION.
"""

        else:
            # ═══════════════════════════════════════════════════════════
            # STRUCTURED OUTPUT MODE (output_categories defined)
            # ═══════════════════════════════════════════════════════════
            
            prompt = f"""
You are a STRICT, READ-ONLY CLINICAL FEATURE ANALYSIS ENGINE.

Your task is to generate FACTUAL, NON-INFERENTIAL ANALYTICAL SUMMARIES
for each REQUIRED OUTPUT CATEGORY using ONLY the provided inputs.

════════════════════════════════════
ABSOLUTE RULES (NON-NEGOTIABLE)
════════════════════════════════════
- NO diagnosis, prediction, recommendation, or decision
- NO external medical knowledge
- NO assumptions, inference, or interpretation beyond data
- NO normalization, severity grading, or judgment
- If data is not explicitly present → it DOES NOT EXIST
- Governing feature rules ALWAYS override defaults

════════════════════════════════════
FEATURE CONTEXT (STRUCTURAL ONLY)
════════════════════════════════════
Feature Name: {feature_name}
Display Method: {display_method}

This context defines OUTPUT STRUCTURE only,
NOT clinical conclusions.

DOCTOR-AUTHORED GOVERNING RULES (HIGHEST AUTHORITY)
════════════════════════════════════
These rules were defined by the treating doctor and MUST actively
control how the output is generated.

Rules:
{rules}

MANDATORY APPLICATION PROCESS:
1. Interpret these rules BEFORE analyzing any data
2. Convert them into OUTPUT RESTRICTIONS
3. Apply them to every sentence in every output category
4. If a sentence violates a rule → DO NOT WRITE IT
5. If uncertain → OMIT the information

These rules OVERRIDE all other instructions.

════════════════════════════════════
STRUCTURED CLINICAL DATA (PRIMARY)
════════════════════════════════════
{json.dumps(clinical_data, indent=2, default=str)}

Each TOP-LEVEL JSON key is a distinct clinical data domain.
You MUST evaluate ALL domains for relevance.
Missing domain = DOES NOT EXIST.

════════════════════════════════════
OPTIONAL SECONDARY INPUTS
════════════════════════════════════
Conversation:
{conversation_text if conversation_text else "None"}

Dictation:
{dictation if dictation else "None"}

These MAY ONLY:
- clarify wording
- clarify temporal references already present
They MUST NEVER add, override, or contradict structured data.

════════════════════════════════════
MANDATORY ANALYSIS PROCESS
════════════════════════════════════

FOR EACH OUTPUT CATEGORY (ISOLATED TASK):

1. Enumerate ALL clinical data domains
2. Identify ALL relevant domains (no defaults)
3. If none relevant → state "No documented information available"
4. Apply governing feature rules
5. All analytical observations MUST be written as sentences
   inside the paragraph of the CURRENT OUTPUT CATEGORY.

   DO NOT create:
   - headings
   - labels
   - sub-sections
   - analytical titles
   - additional JSON keys
6. Do NOT explain causes, implications, or significance
7. Do NOT mention information not present in clinical_data

Analysis MUST help a doctor understand
WHAT IS DOCUMENTED about the patient,
NOT what it means clinically.

════════════════════════════════════
REQUIRED OUTPUT CATEGORIES (STRICT)
════════════════════════════════════
{output_categories}

- Preserve EXACT order and category names
- Do NOT add, remove, or merge categories

════════════════════════════════════
OUTPUT FORMAT (STRICT)
════════════════════════════════════
- VALID JSON ONLY
- Each category value = ONE complete paragraph
- Full sentences, neutral analytical language
- NO lists, bullets, headings, dates, or line breaks
- NO raw value dumping (e.g., "BP 120/50")
- If no data for category: "No documented information available for this category."

════════════════════════════════════
LANGUAGE CONSTRAINTS
════════════════════════════════════
Allowed verbs ONLY:
documented, recorded, observed, listed, reported, present, absent, stated

Disallowed:
suggests, indicates, implies, likely, normal, abnormal,
concerning, significant, consistent with

════════════════════════════════════
IDENTIFIER EXCLUSION (ABSOLUTE)
════════════════════════════════════
NEVER include or mention:
doctor_id, patient_id, appointment_id, feature_id,
UUIDs, system identifiers.

BEGIN FEATURE ANALYSIS - ONLY DOCUMENTED DATA.
"""

        # ---------------------------------------------------------
        # 5️⃣ LLM EXECUTION
        # ---------------------------------------------------------
        logger.info("Executing LLM with prompt length: %d", len(prompt))
        
        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,  # Reduced from 0.2 for more deterministic output
            response_format={"type": "json_object"},
            max_tokens=3000
        )

        llm_output = json.loads(completion.choices[0].message.content)
        logger.info("LLM output: %s", llm_output)

        # ---------------------------------------------------------
        # 6️⃣ FINAL RESPONSE
        # ---------------------------------------------------------
        response_data = {
            "status": "success",
            "feature_id": feature_id,
            "feature_name": feature_name,
            "display_method": display_method,
            "mode": "expert_summary" if use_expert_summary_mode else "structured",
            "finaloutput": llm_output,
            "metadata": {
                "doctor_id": doctor_id,
                "patient_id": patient_id,
                
                "output_categories": output_categories if not use_expert_summary_mode else None
            }
        }

        return response_data

    except HTTPException:

        raise

    except Exception as e:
        logger.exception("Second-stage feature processing failed")
        raise HTTPException(
            status_code=500,
            detail=f"Feature processing error: {str(e)}"
        )


@router.delete("/delete-doctor-feature/{doctor_id}/{feature_id}")
async def delete_doctor_feature(doctor_id: str, feature_id: str):
    await doctor_nodes_collection.update_one(
        {"doctor_id": doctor_id},
        {
            "$pull": {
                "features": {
                    "feature_id": feature_id
                }
            }
        }
    )
    return {"status": "success"}


###################Alwin Section Starts Here#####################

@router.post("/save_doctor_screening_questions")
async def save_doctor_screening_questions(data: dict):
    try:
        # Directly extract doctor_id and questions from the incoming request payload
        doctor_id = data.get("doctor_id")
        questions = data.get("questions", [])

        if not doctor_id or not questions:
            raise HTTPException(400, "doctor_id and questions are required")

        # Prepare the questions string (in case it's a mixed paragraph format)
        mixed_questions_paragraph = " ".join(questions)  # Combine all questions if they come as a list of strings

        # Construct a clear, directive prompt for the LLM
        prompt = f"""
        Extract all distinct questions from this text: "{mixed_questions_paragraph}"
        
        Return ONLY a JSON object with this exact structure:
        {{
            "questions": ["first question here", "second question here", "third question here"]
        }}
        
        Rules:
        1. Extract each complete question as a separate string
        2. Keep questions in the order they appear
        3. Make sure each ends with a question mark
        4. Clean up conversational phrases (remove "I need to know about", "Also", etc.)
        5. Do not add any explanations or additional text
        6. Do not number the questions in the output
        
        Example input: "I need to know about your age. Also, have you had any surgeries? Do you smoke?"
        Example output: {{"questions": ["What is your age?", "Have you had any surgeries?", "Do you smoke?"]}}
        """

        # Call the LLM to process the mixed question paragraph
        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,  # Lower temperature for more consistent results
            response_format={"type": "json_object"},
            max_tokens=500  # Reduced since we're only extracting questions
        )

        # Parse the response from LLM
        result = json.loads(completion.choices[0].message.content)

        # Ensure the result is a list of properly ordered questions
        ordered_questions = result.get("questions", [])

        if not ordered_questions:
            raise HTTPException(400, "Failed to extract questions from the LLM response.")

        # Format questions with numbers (1., 2., 3., etc.)
        numbered_questions = [f"{i+1}. {question}" for i, question in enumerate(ordered_questions)]

        # Prepare the data to insert/update in the database
        screening_data_dict = {
            "doctor_id": doctor_id,
            "questions": numbered_questions,  # Store with numbers
            "updated_at": datetime.now()  # Add timestamp for update tracking
        }

        # Check if a record already exists for this doctor_id
        existing_record = await doctor_screening_questions_collection.find_one(
            {"doctor_id": doctor_id}
        )

        if existing_record:
            # Update existing record
            result = await doctor_screening_questions_collection.update_one(
                {"doctor_id": doctor_id},
                {"$set": screening_data_dict}
            )
            
            operation = "updated"
            record_id = str(existing_record["_id"])
        else:
            # Insert new record
            screening_data_dict["created_at"] = datetime.now()  # Add creation timestamp
            result = await doctor_screening_questions_collection.insert_one(screening_data_dict)
            
            operation = "created"
            record_id = str(result.inserted_id)

        # Return a response with the operation result
        return {
            "message": f"Doctor screening questions {operation} successfully",
            "id": record_id,
            "operation": operation,
            "questions": numbered_questions,  # Return formatted questions in response
            "modified_count": result.modified_count if hasattr(result, 'modified_count') else 1
        }

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error saving data: {e}")

        
###################Alwin Section Ends Here#######################


#23-01-2026 documnetationssss


def is_empty_output_json(output_json):
    if output_json is None:
        return True
    if isinstance(output_json, dict) and not output_json:
        return True
    if isinstance(output_json, list) and len(output_json) == 0:
        return True
    return False



#Aleena44







# def extract_medications(dictation: str):
#     if not dictation or not isinstance(dictation, str):
#         return []

#     meds = []

#     clauses = re.split(r'[.;\n]', dictation)

#     for clause in clauses:
#         clause = clause.strip()

#         # skip investigation-heavy lines
#         if re.search(r'\b(ECG|MRI|CT|X[- ]?ray|markers|enzymes|labs|tests)\b', clause, re.I):
#             continue

#         # normalize connectors
#         clause = re.sub(r'\b(and|with|along with)\b', ',', clause, flags=re.I)

#         # extract medication names (case-insensitive)
#         matches = re.findall(
#             r'\b(?:IV|Inj|Tab|Cap|Syrup|Oral|PO)?\s*([a-zA-Z][a-zA-Z\- ]{2,})',
#             clause,
#             flags=re.I
#         )

#         for m in matches:
#             m = m.strip().title()
#             meds.append(m)

#     blacklist = {
#         "Patient", "Started", "Given", "Continue", "Plan",
#         "Diagnosis", "History", "Therapy"
#     }

#     meds = [
#         m for m in meds
#         if m not in blacklist and len(m.split()) <= 3
#     ]

#     return list(dict.fromkeys(meds))


#################################################################################################################################################################################################


@router.post("/generate_documentation_with_suggestions")
async def generate_documentation_with_suggestions(request: Request):
    """
    Feature-driven clinical documentation processor.
    Prompt behavior changes STRICTLY based on feature_id.
    """


    try:
        # ---------------------------------------------------------
        # 0️⃣ EXTRACT PAYLOAD (FRONTEND DRIVEN)
        # ---------------------------------------------------------
        body = await request.json()


        doctor_id = body.get("doctor_id")
        patient_id = body.get("patient_id")
        feature_id = body.get("feature_id")
        output_json = body.get("output_json")
        objectives = body.get("objectives")
        dictation = body.get("dictation")
        temp_data = body.get("temp_data")

        agentic_output = body.get("agentic_output") # New field for agentic output
        logger.info("Received payload for documentation generation: %s", body)
        logger.info("output_json: %s", output_json)    

        # extracted_medications = extract_medications(dictation)

        # logger.info("Extracted medicationss: %s", extracted_medications)


        if not doctor_id or not patient_id or not feature_id:
            raise HTTPException(
                status_code=400,
                detail="doctor_id, patient_id, feature_id are required"
            )


       


        # ✅ ADD THIS LINE HERE
        empty_output_json = is_empty_output_json(output_json)


        logger.info(
            "Clinical feature processing started | doctor_id=%s | patient_id=%s | feature_id=%s",
            doctor_id, patient_id, feature_id
        )


        # ---------------------------------------------------------
        # 1️⃣ LOAD FEATURE CONFIG
        # ---------------------------------------------------------
        # doctor_node = await doctor_nodes_collection.find_one(
        #     {"doctor_id": doctor_id, "features.feature_id": feature_id},
        #     {"features.$": 1, "_id": 0}
        # )


        # if not doctor_node:
        #     raise HTTPException(404, "Feature configuration not found")


        # feature = doctor_node["features"][0]


        # if not feature.get("enabled"):
        #     raise HTTPException(403, "Feature disabled")


        feature_name = feature_id
        rules = None
        display_method = None
        output_categories = None


      



        # ---------------------------------------------------------
        # 2️⃣ FETCH CLINICAL DATA
        # ---------------------------------------------------------
        clinical_data = {}


        # -------- MEDICAL CONTEXT --------
        doc = await medical_context_collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0}
        )


        if doc:
            medical_context = []
            for ctx in doc.get("medical_contexts", []):
                texts = [
                    c.get("text")
                    for c in ctx.get("conditions", [])
                    if c.get("text")
                ]
                if texts:
                    medical_context.append({
                        "date": ctx.get("date"),
                        "conditions": texts
                    })
            if medical_context:
                clinical_data["medical_context"] = medical_context



        # -------- CURRENT CONTEXT --------
        doc = await current_context_collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0}
        )


        if doc:
            current_context = []
            for ctx in doc.get("current_contexts", []):
                texts = [
                    c.get("text")
                    for c in ctx.get("current_condition", [])
                    if c.get("text")
                ]
                if texts:
                    current_context.append({
                        "date": ctx.get("date"),
                        "current_condition": texts
                    })
            if current_context:
                clinical_data["current_context"] = current_context


        
        

        
        patient_details = {}

        patient_doc = patient_user_collection.find_one(
            {"sys_user_id": patient_id},
            {
                "_id": 0,
                "name": 1,
                "date_of_birth": 1,
                "blood_group": 1,
                "gender": 1,
                "family_history": 1
            }
        )

        if patient_doc:
            # Calculate age safely
            age = None
            dob_str = patient_doc.get("date_of_birth")

            if dob_str:
                try:
                    dob = datetime.strptime(dob_str, "%Y-%m-%d").date()
                    today = datetime.utcnow().date()
                    age = today.year - dob.year - (
                        (today.month, today.day) < (dob.month, dob.day)
                    )
                except Exception:
                    logger.warning("Invalid DOB format while computing age")

            patient_details = {
                "name": patient_doc.get("name"),
                "age": age,
                "blood_group": patient_doc.get("blood_group"),
                "sex": patient_doc.get("gender"),   # mapping gender → sex
                "family_history": patient_doc.get("family_history")
            }
        patient_details_json = json.dumps( patient_details if patient_details else {}, indent=2, default=str )
        logger.info(f"patient_details_json:{patient_details_json}")    
        
        # ---------------------------------------------------------
        # 2️⃣.5 FETCH AGENTIC OUTPUT (SAFE & CORRECT)
        # ---------------------------------------------------------
       
        agentic_output = None

        agentic_doc = await summary_collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0},
            sort=[("generated_at", -1)]
        )

        if agentic_doc:
            agentic_output = agentic_doc

    

        agentic_json = json.dumps({
                "clinical_summary": agentic_output.get("clinical_summary", ""),
                
        }, indent=2, default=str) if agentic_output else "No agentic output available."
        logger.info(f"thomas_dictation:{agentic_json}")
        
     
        # ---------------------------------------------------------
        # 2️⃣.6 FETCH TEMP DATA (IF NOT PROVIDED IN REQUEST)
        # ---------------------------------------------------------

        temp_doc =  temp_data_collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0}
        )

        if temp_doc:
            temp_data = temp_doc.get("data")


        logger.info("temp_data=%s", json.dumps(temp_data, indent=2, default=str))

        # ---------------------------------------------------------
        # 3️⃣ PROMPT CONSTRUCTION (FEATURE-SPECIFIC)
        # ---------------------------------------------------------


       
        if feature_id == "documentation-treatment-plan":

            agentic_json = json.dumps(agentic_output, indent=2, default=str) \
                if agentic_output else "No agentic context available."

            temp_data_text = json.dumps(temp_data, indent=2, default=str) \
                if temp_data else "No cached patient data available."

            clinical_data_text = json.dumps(clinical_data, indent=2, default=str) \
                if clinical_data else "No structured clinical data available."

            prompt = f"""
You are a CLINICAL TREATMENT PLAN ANALYSIS & ENHANCEMENT ASSISTANT.

Your task is to PROCESS an existing doctor-authored treatment plan and generate structured clinical reasoning outputs STRICTLY governed by doctor-defined rules, objectives, and documented patient data.

════════════════════════════════════
AUTHORITATIVE INPUT HIERARCHY (STRICT)
════════════════════════════════════

1️⃣ DOCTOR-AUTHORED RULES (HIGHEST PRIORITY)
These rules STRICTLY control:
- what may be included
- how it may be written
- what must be excluded

2️⃣ DOCTOR-AUTHORED TREATMENT PLAN & DICTATION
- OUTPUT_JSON and DICTATION are both doctor-authored inputs
- They carry equal clinical authority within their allowed scope
- OUTPUT_JSON defines explicit actions
- DICTATION provides contextual intent and reasoning
- Neither may violate doctor-authored rules

3️⃣ PATIENT CLINICAL DATA
- Factual only
- No interpretive authority

Rules:
{rules if rules else "No explicit rules provided by the doctor."}

MANDATORY RULE ENFORCEMENT:
- Interpret rules BEFORE generating any content
- Apply rules to EVERY sentence
- If any content violates a rule → OMIT it
- Never override, soften, reinterpret, or compensate for a rule
- If rules restrict a domain → explicitly state that limitation

════════════════════════════════════
FEATURE CONTEXT
════════════════════════════════════
Feature Name: {feature_name}
Display Method: {display_method}

This defines presentation depth, tone, and structure.

════════════════════════════════════
PATIENT CLINICAL DATA (FACTUAL ONLY)
════════════════════════════════════
This contains ONLY documented clinical information. It is NOT an instruction set.

{json.dumps(clinical_data, indent=2, default=str)}

STRICT CONSTRAINTS:
- Do NOT invent diagnoses
- Do NOT infer undocumented severity
- Do NOT introduce treatments not implied by data
- If information is missing → acknowledge explicitly
- Dictation may NOT be used to introduce new diagnoses, medications, or procedures
- ⚠️ CRITICAL: Always verify and match the exact side (left/right/bilateral) of any condition mentioned in dictation

════════════════════════════════════
DOCTOR-AUTHORED TREATMENT PLAN (OUTPUT_JSON)
════════════════════════════════════
This represents the doctor's EXISTING intended plan. It is AUTHORITATIVE and must NOT be replaced.

{json.dumps(output_json, indent=2, default=str)}

════════════════════════════════════
DOCTOR DICTATION (CONTEXTUAL INPUT)
════════════════════════════════════
This represents free-text, doctor-authored dictation captured during or after clinical decision-making.

The dictation:
- MAY clarify intent, concerns, uncertainty, priorities, or reasoning
- MAY reinforce or contextualize the existing treatment plan
- DOES NOT override doctor-authored rules
- DOES NOT replace or expand the treatment plan unless explicitly reflected in OUTPUT_JSON
- ⚠️ CRITICAL: The exact side (left/right/bilateral) mentioned in dictation MUST be preserved in ALL suggestions and content

Dictation Content:
{dictation if dictation else "No dictation provided."}

════════════════════════════════════
CLINICAL OBJECTIVES (IF PROVIDED)
════════════════════════════════════
Objectives DEFINE prioritization and emphasis.

Possible objectives include (but are not limited to):
- Curative vs palliative intent
- Symptom control goals
- Functional improvement goals
- Disease progression control
- Quality-of-life targets

Provided Objectives:
{objectives if objectives else "No explicit objectives provided."}

════════════════════════════════════
MANDATORY EXTRACTION STEP (NON-NEGOTIABLE)
════════════════════════════════════

From the doctor dictation and OUTPUT_JSON, you MUST extract and internally classify:

A) Diagnosis details (if mentioned) - ⚠️ CRITICAL: Note exact side/laterality
B) Medications / Rx (if mentioned)
C) Investigations (if mentioned)
D) Treatment plan elements (if mentioned)
E) Monitoring/Follow-up elements (if mentioned)

If a section is NOT mentioned, treat it as MISSING — not negative.

If inputs include only partial sections, populate ONLY those sections with doctor_content and leave others empty without inference.

════════════════════════════════════
INTELLIGENT VERIFICATION & RECONCILIATION
════════════════════════════════════

For EACH extracted element and for EACH section in the output structure:

✔ STEP 1: EXTRACT & IDENTIFY GAPS
   - Identify what the doctor HAS documented (from dictation and OUTPUT_JSON)
   - ⚠️ CRITICAL: Verify laterality (left/right/bilateral) matches dictation EXACTLY
   - Identify what is MISSING from each clinical domain:
     * Diagnosis (specificity, staging, severity, comorbidities, laterality)
     * Pharmacological plan (drug, dose, frequency, duration, titration)
     * Investigations (diagnostic, monitoring, baseline, response assessment)
     * Procedural plan (interventions, timing, preparation, follow-up)
     * Monitoring/Follow-up (frequency, parameters, triggers, escalation criteria)

✔ STEP 2: CLINICAL INTELLIGENCE ACTIVATION
   When a section is MISSING or INCOMPLETE, you MUST activate clinical reasoning to:
   - Analyze available patient data (diagnoses, vitals, labs, comorbidities, age, allergies)
   - Apply evidence-based standard of care for the documented condition(s)
   - Consider treatment intent (curative/palliative/supportive/diagnostic)
   - Account for patient-specific factors (renal/hepatic function, pregnancy, contraindications)
   - Identify safety considerations and drug-drug interactions
   - Determine appropriate first-line or guideline-directed therapy
   - Consider disease severity and staging from available data
   - Factor in social determinants if documented
   - ⚠️ CRITICAL: Consider age-specific factors (pediatric, adult, geriatric considerations)
   - ⚠️ CRITICAL: Consider specialty-specific factors (cardiology, neurology, infectious disease, etc.)

✔ STEP 3: GENERATE DOCTOR-LEVEL SUGGESTIONS
   For MISSING or INCOMPLETE sections, generate clinically precise suggestions that:

   A) Complete the missing plan with specific, actionable recommendations
   B) Include (when clinically indicated):
      - Specific drug names (generic), doses, frequencies, and durations
      - Specific diagnostic tests with timing and indications
      - Specific procedures with preparation and follow-up requirements
      - Specific monitoring parameters and frequency
      - Specific escalation and de-escalation criteria
      - Specific follow-up intervals and triggers for earlier review
      - Address patient-specific factors (age, comorbidities, pregnancy, breastfeeding)
      - Include specialty-appropriate monitoring

   C) Must be:
      - Clinically accurate and evidence-based
      - Appropriate for the patient's specific clinical data
      - Aligned with the stated treatment intent
      - Safe given patient comorbidities and contraindications
      - Specific enough for a doctor to implement or adjust
      - Justified by the available clinical data
      - Considerate of drug-drug interactions
      - Appropriate for the care setting
      - Include real-world implementation considerations

✔ STEP 4: VALIDATE EXISTING CONTENT
   For sections where doctor HAS provided content:
   - Validate against doctor-authored rules
   - Check for clinical appropriateness and accuracy
   - Identify safety concerns or contraindications
   - Detect redundancy or conflict with other treatments
   - Assess rule compliance
   - Evaluate alignment with treatment intent
   - ⚠️ CRITICAL: Verify laterality matches dictation EXACTLY
   - If valid → retain doctor content AS-IS

✔ STEP 5: ENHANCE WITH AI SUGGESTIONS
   For EACH section (whether doctor content exists or is missing):

   ✓ If doctor content EXISTS and is valid:
      - Retain doctor content AS-IS
      - Generate at least ONE high-quality AI suggestion focused on:
        * Optimization of existing plan
        * Risk reduction strategies
        * Long-term management considerations
        * Evidence-based refinements
        * Preventive care integration
        * Monitoring enhancements
        * Adherence support strategies
        * Care coordination recommendations
        * Address patient-specific factors
        * Include psychosocial support and patient education

   ✓ If section is MISSING or INCOMPLETE:
      - Generate comprehensive, clinically accurate suggestions that COMPLETE the plan
      - Act as a clinical consultant providing specific, actionable recommendations
      - Base suggestions on patient data, standard of care, and treatment intent
      - Ensure suggestions are specific enough for immediate clinical consideration
      - Prioritize first-line, evidence-based options unless contraindicated
      - Address age-specific factors
      - Include specialty-appropriate monitoring
      - Address real-world implementation and resource availability

   ✓ Quality Criteria for ALL suggestions:
      - Must add measurable clinical value
      - Must be non-redundant (never restate existing therapy)
      - Must not contradict doctor intent
      - Must be specific and actionable (not vague or textbook-level)
      - Must comply with doctor-authored rules
      - Must be justified by available clinical data
      - Must consider patient safety as the highest priority
      - Must be appropriate for the clinical context
      - ⚠️ ENHANCED: Must match laterality from dictation EXACTLY
      - Must be appropriate for the clinical specialty

✔ STEP 6: MANDATORY SUGGESTION REQUIREMENT
   - At least ONE meaningful AI suggestion MUST be generated across the entire plan
   - If all sections are complete, accurate, and no optimization opportunities exist:
     * Generate a proactive safety, preventive, or monitoring suggestion

✔ STEP 7: SAFETY CHECK
   Before finalizing ANY suggestion:
   - Verify no contraindications based on patient data
   - Check for drug-drug interactions with existing medications
   - Ensure doses are appropriate for renal/hepatic function
   - Confirm alignment with treatment intent
   - Validate that suggestions don't violate doctor-authored rules
   - Verify specialty-appropriate safety monitoring
   - Consider age-appropriate monitoring and interventions
   - ⚠️ CRITICAL: Verify laterality matches dictation EXACTLY

✔ Only generate section-level suggestions when clinically justified.
✔ Do NOT generate forced suggestions for every section if not clinically warranted.
✔ If data insufficient for a safe, specific suggestion → explicitly state the limitation and suggest what additional information would be needed.

════════════════════════════════════
TREATMENT INTENT ALIGNMENT CHECK
════════════════════════════════════

If a treatment intent is provided:
- Evaluate dictated treatment and suggestions against intent
- If misaligned → FLAG clearly in intent_alignment.notes

════════════════════════════════════
GUIDELINE INTEGRATION FRAMEWORK
════════════════════════════════════

When generating suggestions, incorporate principles from relevant clinical guidelines WITHOUT citing specific guideline names/numbers:

INTERNATIONAL GUIDELINE PRINCIPLES:

🔹 NATIONAL COMPREHENSIVE CANCER NETWORK (NCCN) PRINCIPLES:
   - Multidisciplinary team approach to treatment planning
   - Risk stratification based on prognostic factors
   - Treatment escalation/de-escalation based on response and biomarkers
   - Survivorship care planning including long-term follow-up
   - Shared decision-making incorporating patient preferences

🔹 NATIONAL INSTITUTE FOR HEALTH AND CARE EXCELLENCE (NICE) PRINCIPLES:
   - Cost-effectiveness and resource utilization considerations
   - Stepped care approach starting with least intensive intervention
   - Patient-centered care and shared decision-making
   - Quality of life as a key outcome measure
   - Integrated care across specialties and community settings

🔹 WORLD HEALTH ORGANIZATION (WHO) PRINCIPLES:
   - Essential medicines list concept
   - Stepped approach to pain management
   - Public health perspective on disease management
   - Health system strengthening and capacity building
   - Equity in healthcare access and delivery

🔹 SPECIALTY-SPECIFIC GUIDELINE PRINCIPLES:

   CARDIOLOGY (ACC/AHA/ESC):
   - Guideline-directed medical therapy (GDMT) titration to target doses
   - Risk stratification using validated scores (CHA2DS2-VASc, ASCVD, HEART)
   - Stepwise addition of therapies based on response
   - Device therapy considerations at appropriate thresholds
   - Lifestyle modification as foundation of cardiovascular care

   ENDOCRINOLOGY (ADA/AACE/ENDO):
   - Individualized glycemic targets based on patient factors
   - Cardiovascular and renal risk reduction beyond glycemic control
   - Stepped approach to medication intensification
   - Complication screening at appropriate intervals
   - Weight management as integral to metabolic care

   INFECTIOUS DISEASE (IDSA):
   - Pathogen-directed therapy when possible
   - De-escalation based on culture results
   - Duration of therapy based on infection site and severity
   - Antimicrobial stewardship principles
   - Prevention strategies (vaccination, prophylaxis)

   NEUROLOGY (AAN/AHA/EFNS):
   - Acute treatment vs. prevention strategies
   - Medication selection based on seizure/stroke/migraine type
   - Titration to therapeutic effect or tolerability
   - Monitoring for adverse effects and drug levels
   - Rehabilitation and supportive care integration

   PULMONOLOGY (ATS/ERS/GOLD/GINA):
   - Stepwise approach based on symptom control and exacerbation risk
   - Inhaler technique education and verification
   - Phenotype-guided therapy selection
   - Pulmonary rehabilitation referral when appropriate
   - Vaccination and infection prevention

   GASTROENTEROLOGY (ACG/AGA/EASL):
   - Treat-to-target endpoints (mucosal healing, biochemical remission)
   - Step-up vs. top-down therapy based on disease severity
   - Hepatotoxicity monitoring for relevant medications
   - Screening for complications (varices, HCC)
   - Nutritional assessment and support

   NEPHROLOGY (KDIGO):
   - CKD staging and progression risk assessment
   - RAAS inhibition for proteinuric CKD
   - SGLT2 inhibition for cardiorenal protection
   - Mineral and bone disorder monitoring and management
   - Preparation for renal replacement therapy when indicated

   RHEUMATOLOGY (ACR/EULAR):
   - Treat-to-target with regular disease activity assessment
   - Stepwise addition of DMARDs based on response
   - Screening for latent infections before immunosuppression
   - Glucocorticoid-sparing strategies
   - Vaccination and infection prevention

   PSYCHIATRY (APA):
   - Medication selection based on predominant symptoms
   - Adequate trial duration before switching
   - Monitoring for metabolic effects of antipsychotics
   - Suicide risk assessment and safety planning
   - Psychotherapy integration when indicated

   PRIMARY CARE/PREVENTIVE (USPSTF):
   - Age-appropriate screening based on risk factors
   - Shared decision-making for screening tests
   - Appropriate screening intervals
   - Follow-up of abnormal results
   - Lifestyle counseling integration

════════════════════════════════════
OUTPUT STRUCTURE (FIXED & MANDATORY)
════════════════════════════════════

Return ONLY the following JSON structure:

{{
  "processed_treatment_plan": {{
    "doctor_content": "[Generate clinically coherent paragraph reconstructed strictly from doctor dictation and OUTPUT_JSON (3–5 sentences). Include only what the doctor explicitly documented. ⚠️ CRITICAL: Must match exact laterality from dictation.]",
    "ai_enhancement": "[Optional AI-improved version or missing linkage, clearly marked as suggestion. Use only if clinically valuable. ⚠️ CRITICAL: Must match exact laterality from dictation.]"
  }},
  "sections": {{
    "diagnosis": {{
      "doctor_content": "[Exact diagnosis as documented by doctor. Empty if not mentioned. ⚠️ CRITICAL: Must include exact laterality from dictation.]",
      "ai_suggestions": []
    }},
    "pharmacological_plan": {{
      "doctor_content": "[Exact medications as documented by doctor. Include dose/frequency if mentioned.]",
      "ai_suggestions": []
    }},
    "investigations": {{
      "doctor_content": "[Exact investigations as documented by doctor. Include timing if mentioned.]",
      "ai_suggestions": []
    }},
    "procedural_plan": {{
      "doctor_content": "[Exact procedures as documented by doctor. Include timing/prep if mentioned. ⚠️ CRITICAL: Must match exact laterality from dictation.]",
      "ai_suggestions": []
    }},
    "monitoring_follow_up": {{
      "doctor_content": "[Exact monitoring/follow-up as documented by doctor. Include frequency/parameters if mentioned.]",
      "ai_suggestions": []
    }}
  }},
  "intent_alignment": {{
    "intent": "none",
    "alignment_status": "not_assessable",
    "notes": ""
  }},
  "evaluation": {{
    "standard_of_care_alignment": "[2-3 sentence assessment of how well the treatment plan aligns with accepted clinical practice for the condition, based on available data and without citing specific guidelines. Include discussion of regimen appropriateness and evidence basis.]",
    "practical_feasibility": "[2-3 sentence assessment of whether the plan can be realistically implemented in the inferred care setting, considering patient circumstances, available resources, age-related factors, comorbidities, and potential barriers to care. Address real-world implementation challenges.]",
    "doability_and_sustainability": "[2-3 sentence assessment of long-term adherence, monitoring burden, risk of relapse, side-effect burden, need for psychosocial support, patient education requirements, and strategies to ensure treatment completion. Include discussion of adherence support services and multidisciplinary care coordination.]"
  }}
}}

════════════════════════════════════
STRICT RULES (ABSOLUTE)
════════════════════════════════════

⛔ Do NOT override doctor intent or documented decisions
⛔ Do NOT invent diagnoses not supported by dictation or clinical data
⛔ Do NOT contradict prescribed treatments
⛔ Do NOT generate redundant, generic, or textbook-level suggestions
⛔ Do NOT restate existing therapy as a suggestion
⛔ Do NOT introduce speculative escalation without supporting data
⛔ Do NOT violate doctor-authored rules for ANY reason
⛔ Do NOT suggest treatments contraindicated by patient data
⛔ Do NOT ignore drug-drug interactions with existing medications
⛔ Do NOT use brand names unless specified in dictation
⛔ Do NOT cite specific guidelines by name/number
⛔ Do NOT use guideline acronyms (NCCN, NICE, WHO, etc.) in output
⛔ ⚠️ CRITICAL: Do NOT mismatch laterality - must match dictation EXACTLY
⛔ If data insufficient for safe suggestion → explicitly say so
⛔ Use professional, precise clinical language only
⛔ Do NOT predefine or hardcode specific medications, doses, or regimens
⛔ Base ALL clinical suggestions on the actual patient data provided, not on assumptions
⛔ ⚠️ CRITICAL: Suggestions MUST be simple strings in the ai_suggestions arrays. Do NOT include objects with justification or laterality fields.

✔ At least ONE meaningful, specific, actionable AI suggestion MUST be generated across the entire treatment plan
✔ The mandatory suggestion may appear in processed_treatment_plan.ai_enhancement OR ONE clinically appropriate section.ai_suggestions
✔ Suggestions for missing sections MUST be specific (based on actual patient data)
✔ Address age-specific factors (pediatric, adult, geriatric as appropriate)
✔ Include specialty-appropriate monitoring
✔ Address psychosocial support and patient education needs when relevant
✔ Consider multidisciplinary team involvement when appropriate
✔ Suggestions MUST be justified by available clinical data
✔ Suggestions MUST consider patient safety as the highest priority
✔ Only generate section-level suggestions when clinically justified
✔ If no gaps exist, generate a proactive safety/preventive suggestion

All fields MUST be present.
Section suggestion arrays MAY remain empty unless clinically warranted.
Use empty strings only where explicitly appropriate.

════════════════════════════════════
SUGGESTION GENERATION REQUIREMENTS
════════════════════════════════════

YOU MUST GENERATE AT LEAST 2 AI SUGGESTIONS IN THIS RESPONSE.

ALL SUGGESTIONS MUST:
1. ⚠️ CRITICAL: Match exact laterality from dictation when applicable
2. Be based on the ACTUAL patient data provided
3. Be specific and actionable for the clinical context
4. Include appropriate monitoring parameters
5. Consider patient-specific factors (age, comorbidities, etc.)
6. Address real-world implementation when relevant
7. ⚠️ CRITICAL: Be simple strings - NOT objects with fields

Based on the provided patient data and current treatment plan, identify gaps and generate appropriate suggestions.

PATIENT CONTEXT (ANALYZE THIS CAREFULLY):
- Review all patient data provided in clinical_data
- ⚠️ CRITICAL: Note any laterality mentioned in dictation

IDENTIFIED GAPS (TO BE DETERMINED FROM INPUTS):
- Review all sections for missing or incomplete content
- Prioritize gaps that are clinically significant

FOR EACH CLINICALLY RELEVANT MISSING SECTION, GENERATE APPROPRIATE SUGGESTIONS BASED ON THE ACTUAL PATIENT DATA.

⚠️ IMPORTANT: Place suggestions as simple strings in the appropriate section.ai_suggestions arrays based on clinical relevance.

YOUR OUTPUT MUST CONTAIN AT LEAST 2 AI SUGGESTIONS ACROSS THESE SECTIONS.
ALL SUGGESTIONS MUST BE BASED ON THE ACTUAL PATIENT DATA PROVIDED.

FAILURE TO GENERATE SUGGESTIONS BASED ON ACTUAL PATIENT DATA WILL RESULT IN INCOMPLETE OUTPUT.

BEGIN GENERATION NOW WITH AT LEAST 2 AI SUGGESTIONS BASED ON THE PROVIDED PATIENT DATA.
"""


#         elif feature_id == "documentation-treatment-plan" and empty_output_json:


#             prompt = f"""
# You are a CLINICAL REASONING & SUGGESTION ASSISTANT.

# There is NO doctor-authored treatment plan provided.
# You MUST NOT generate or reconstruct a treatment plan.

# ════════════════════════════════════
# DOCTOR DICTATION (CONTEXTUAL INPUT)
# ════════════════════════════════════
# This represents free-text, doctor-authored dictation captured during clinical reasoning.

# The dictation:
# - MAY clarify clinical intent, uncertainty, or caution
# - MAY highlight priorities or concerns
# - MUST NOT imply an existing or planned treatment
# - MUST NOT introduce diagnoses, medications, or procedures

# Dictation Content:
# {dictation if dictation else "No dictation provided."}

# ════════════════════════════════════
# PATIENT CLINICAL DATA (FACTUAL ONLY)
# ════════════════════════════════════
# {json.dumps(clinical_data, indent=2, default=str)}

# STRICT CONSTRAINTS:
# - No diagnoses
# - No inferred severity
# - No assumption of missing care
# - If data is insufficient → explicitly state limitation
# - Dictation may NOT be used to construct, imply, or infer a treatment plan

# ════════════════════════════════════
# GENERATION TASKS
# ════════════════════════════════════

# ━━━━━━━━━━━━━━━━━━━━━━
# SECTION 1: CLINICAL SUGGESTIONS (OPTIONAL)
# ━━━━━━━━━━━━━━━━━━━━━━

# Provide clinical suggestions for consideration ONLY.

# These suggestions:
# - Are OPTIONAL considerations only
# - MUST NOT imply an existing treatment plan
# - Must be justified by clinical data OR dictation
# - Must be clinically valid and safe

# ALLOWED SUGGESTION TYPES:
# ✔ Supportive or adjunct considerations
# ✔ Approaches when uncertainty is documented
# ✔ Preventive or safety-related measures
# ✔ Enhanced monitoring or follow-up actions

# STRICT CONSTRAINTS:
# ⛔ NO treatment plan generation
# ⛔ NO medications or procedures
# ⛔ NO clinical assumptions
# ⛔ NO directive language

# FORMAT RULES:
# - Each suggestion = SINGLE complete sentence
# - Neutral, non-directive clinical language
# - Justification embedded in same sentence
# - If no safe suggestion exists → return empty list

# ━━━━━━━━━━━━━━━━━━━━━━
# SECTION 2: CLINICAL EVALUATION
# ━━━━━━━━━━━━━━━━━━━━━━

# Provide assessment based ONLY on:
# - Clinical data
# - Doctor dictation

# If dictation introduces ambiguity or uncertainty, reflect it explicitly without resolving it.

# EVALUATION DOMAINS (2-3 sentences each):
# 1. STANDARD OF CARE ALIGNMENT  
# 2. PRACTICAL FEASIBILITY  
# 3. SUSTAINABILITY CONSIDERATIONS

# If insufficient information exists → explicitly state so.

# ════════════════════════════════════
# STRICT PROHIBITIONS
# ════════════════════════════════════
# ⛔ NO treatment plan generation
# ⛔ NO medications or procedures
# ⛔ NO clinical assumptions
# ⛔ NO external medical knowledge

# ════════════════════════════════════
# OUTPUT FORMAT (STRICT JSON ONLY)
# ════════════════════════════════════

# Return ONLY this EXACT JSON structure:

# {{
#   "suggestions": [
#     "Complete clinical sentence with embedded justification.",
#     "Another complete clinical sentence with embedded justification."
#   ],
#   "evaluation": {{
#     "standard_of_care_alignment": "2-3 sentence assessment",
#     "practical_feasibility": "2-3 sentence assessment",
#     "sustainability_considerations": "2-3 sentence assessment"
#   }}
# }}

# REQUIREMENTS:
# - All fields must be present
# - Suggestions must be single sentences
# - Evaluation sections must be 2-3 sentences each
# - If no suggestions exist, use empty array: []
# - Use professional clinical language

# BEGIN GENERATION.
# """



        
        elif feature_id == "documentation-medication-analysis" :
            
            
            dictation_text = dictation if dictation else "No dictation provided."
            
            

            temp_data_text = json.dumps(temp_data, indent=2, default=str) \
                if temp_data else "No cached patient context available."
            
            # Fetch latest 3 vitals (most recent first)
            # Clear agentic data after extracting it
            agentic_output = None

            # If passing to prompt later, this will become null
            agentic_json = json.dumps(agentic_output)
            

            
             
            prompt = f"""

You are a STRICT CLINICAL MEDICATION EXTRACTION AND SAFETY ANALYSIS ENGINE.
Return ONLY valid JSON. No prose. No markdown. No explanations.
Hallucination strictly prohibited. Missing values → use defined fallbacks only.

════════════════════════════
INPUTS
════════════════════════════

PATIENT DEMOGRAPHICS (use ONLY for safety/dose — do NOT extract medications):
{patient_details_json}

CLINICAL SUMMARY (use ONLY for safety/interactions — do NOT extract medications):
{agentic_json}

CLINICAL DICTATION (ONLY source for medication extraction):
{dictation_text}

════════════════════════════
FORMAT DETECTION
════════════════════════════

FORMAT A — Natural clinical speech ("start X", "initiate Y", "prescribe Z")
→ Extract using action verbs directly.

FORMAT B — Treatment Protocol (contains "TREATMENT PROTOCOL", "- Dose:",
"- Frequency:", "- Indication:", "PRIMARY GOALS", "LIFESTYLE MODIFICATIONS")
→ Rules:
  • Valid med bullet = line starting with "•" naming a drug/supplement
  • Extract: name, strength (← "- Dose:"), frequency (← "- Frequency:"),
    route (infer: supplements → oral, infusions → intravenous),
    category (← "- Indication:")
  • Treat as: "Prescribe [med] [strength] [route] [frequency]."
  • SKIP lifestyle bullets (Maintain/Schedule/Manage/Follow/Engage/Limit/Establish)
  • SKIP diagnostics (Mammogram/Colonoscopy/CBC/KFT/Lipid Profile/Bone Density/
    Pap Smear/HPV/Urinalysis/Vision/Dental/BP/BMI/BMP/Fasting Glucose)
  • IGNORE entirely: INVESTIGATIONS, LIFESTYLE MODIFICATIONS,
    FOLLOW-UP PLAN, PRIMARY GOALS sections

════════════════════════════
EXTRACTION RULES
════════════════════════════

ACTIVE verbs (extract): start/begin/prescribe/initiate/order/give/administer/
continue/take/increase to/decrease to/add/infuse/bolus of/commence

EXCLUSION verbs (skip): stop/discontinue/hold/previously on/was on/
completed/avoided/withhold

NEVER classify as medication: radiation/chemotherapy sessions/surgery/
O2 therapy/physiotherapy/dialysis/imaging/splinting/FAST exam/BP monitoring

REQUIRED per medication (never leave empty):
  generic_name → derive from drug name
  brand_name   → most recognized brand (Metformin→Glucophage, Aspirin→Bayer,
                  Paracetamol→Crocin, Atorvastatin→Lipitor, Lisinopril→Zestril)
  route        → infer if unambiguous

All other string fields → "" if not stated. Arrays → [] if not stated.

════════════════════════════
SAFETY ANALYSIS
════════════════════════════

Check: drug–drug interactions, drug–disease interactions, contraindications,
age/renal/hepatic dosing, antibiotic misuse, duplicate therapy.

MANDATORY alerts (severity "moderate" minimum) if:
  • glucose > 200 or < 60 mg/dL
  • eGFR < 60 or renal impairment documented
  • ALT/AST > 2× ULN or liver disease
  • age ≥ 65
  • heart failure, arrhythmia, hemodynamic instability

Alert schema: {{"medication":"","severity":"safe|moderate|danger",
"alert":"","reason":"","references":[]}}

════════════════════════════
MANDATORY FALLBACKS (never return "" for these)
════════════════════════════

safe_rx.principles → "Standard safe prescribing principles apply: verify
  indication, confirm allergy status, adjust for renal/hepatic function,
  monitor for adverse effects, and counsel the patient."
renal_adjustment / hepatic_adjustment / weight_adjustment →
  "Insufficient clinical data available to determine adjustment."
evidence_at_bedside.summary → "No specific guideline references were
  identified for the medications extracted from this dictation."
overall_analysis → "Clinical data processed. No additional systemic concerns
  identified beyond those noted in safety alerts."

════════════════════════════
OUTPUT SCHEMA (return ONLY this JSON)
════════════════════════════

{{
  "prescriptions": [{{
    "medication": "",
    "generic_name": "",
    "brand_name": "",
    "category": "",
    "strength": "",
    "dosage_form": "",
    "route": "",
    "frequency": "",
    "follow_up": "",
    "standard_frequency_options": [],
    "standard_duration_options": [],
    "special_instructions": "",
    "dosage_instructions": "",
    "quantity": "",
    "refills": ""
  }}],
  "safety_alerts": [],
  "safe_rx": {{
    "principles": "",
    "dose_personalization": {{
      "renal_adjustment": "",
      "hepatic_adjustment": "",
      "weight_adjustment": "",
      "references": []
    }},
    "antibiotics_analysis": "none",
    "issues_found": []
  }},
  "evidence_at_bedside": {{
    "summary": "",
    "guidelines": [],
    "key_studies": []
  }},
  "overall_analysis": ""
}}
"""


        elif feature_id == "documentation-referral-letter":

            # ---------------------------------------------------------
            # 1️⃣ FETCH TREATMENT PLAN
            # ---------------------------------------------------------

            treatment_plan_doc = await documentation_treatment_plan_collection.find_one(
                {"patient_id": patient_id},
                {"_id": 0}
            )

            treatment_plan_text = json.dumps(
                treatment_plan_doc.get("finaloutput", {}),
                indent=2,
                default=str
            ) if treatment_plan_doc else "No documented treatment plan available."

            # ---------------------------------------------------------
            # 2️⃣ BUILD PROMPT
            # ---------------------------------------------------------

            prompt = f"""
        
        You are a REGULATED HOSPITAL REFERRAL LETTER GENERATION ENGINE.

        This output is an OFFICIAL inter-physician medical communication.
        It may be stored in the EHR and shared across institutions.

        Doctor authority is ABSOLUTE.
        You are NOT permitted to create, infer, optimize, or interpret clinical content.

        This is a DOCUMENT SYNTHESIS task — not analysis.

        ════════════════════════════════════
        CLINICAL GOVERNANCE REQUIREMENTS
        ════════════════════════════════════

        You MUST:

        1. Use ONLY documented treatment plan content.
        2. NOT invent diagnoses.
        3. NOT infer severity.
        4. NOT generate prognosis.
        5. NOT introduce new medications.
        6. NOT create follow-up advice.
        7. NOT create referral reasons.
        8. NOT synthesize new clinical relationships.
        9. NOT interpret laboratory or imaging findings.
        10. Preserve original documented terminology.

        If documentation is insufficient:
        → Return an empty clinical_summary ("").

        Do NOT compensate for missing data.

        ════════════════════════════════════
        EDITABLE FIELDS (STRICT – DO NOT POPULATE)
        ════════════════════════════════════

        The following fields are DOCTOR-EDITABLE ONLY.
        They MUST remain empty strings:

        1. Referring Doctor Details
        2. Referred-To Specialty / Doctor
        3. Reason for Referral

        Under NO circumstance should you generate content for these fields.

        ════════════════════════════════════
        AUTHORITATIVE SOURCE
        ════════════════════════════════════

        Treatment Plan (Primary Source of Truth):
        {treatment_plan_text}

        No other source is authoritative for this task.

        ════════════════════════════════════
        CLINICAL SUMMARY GENERATION RULES
        ════════════════════════════════════

        The "clinical_summary" must:

        • Be derived ONLY from the treatment plan
        • Include documented diagnoses if present
        • Include documented pharmacologic treatments
        • Include documented non-pharmacologic measures
        • Include documented monitoring measures
        • Maintain formal medical tone
        • Be concise (4–8 sentences maximum)
        • Avoid redundancy
        • Avoid interpretation
        • Avoid speculation
        • Avoid risk commentary
        • Avoid recommendations

        DO NOT:
        ✘ Rephrase into optimized language
        ✘ Combine diagnoses into new composite phrases
        ✘ Expand abbreviated treatments
        ✘ Add medical commentary
        ✘ Add background history unless explicitly documented
        ✘ Add closing statements

        If treatment plan contains structured sections:
        → Convert into a clear, professional paragraph
        → Maintain terminology exactly as documented

        ════════════════════════════════════
        OUTPUT STRUCTURE (STRICT JSON ONLY)
        ════════════════════════════════════

        Return ONLY valid JSON in the exact structure below:

        {{
        "referral_letter": {{
            "referring_doctor_details": "",
            "referred_to_specialty_or_doctor": "",
            "reason_for_referral": "",
            "clinical_summary": ""
        }}
        }}

        ════════════════════════════════════
        STRICT OUTPUT VALIDATION RULES
        ════════════════════════════════════

        • JSON only
        • No extra keys
        • No commentary outside JSON
        • No null values (use "")
        • Editable fields MUST remain ""
        • clinical_summary MUST be a single paragraph string
        • If no treatment plan available → clinical_summary = ""

        If any rule cannot be followed → return structured empty values.

        BEGIN GENERATION.
        """


#         elif feature_id == "documentation-medication-analysis" and empty_output_json:
#             prompt = f"""
# You are a CLINICAL MEDICATION REASONING & SUGGESTION ASSISTANT.


# There is NO structured medication list available.
# You MUST NOT extract or name medications.


# Your role is LIMITED to offering
# OPTIONAL medication-related considerations ONLY.


# ════════════════════════════════════
# AUTHORITATIVE INPUT HIERARCHY (STRICT)
# ════════════════════════════════════


# 1️⃣ DOCTOR-AUTHORED RULES (HIGHEST PRIORITY)


# Rules:
# {rules if rules else "No explicit rules provided by the doctor."}


# MANDATORY ENFORCEMENT:
# - Apply rules BEFORE generating content
# - If rules restrict medications → enforce strictly
# - NEVER invent, name, or recommend a specific drug


# ════════════════════════════════════
# FEATURE CONTEXT
# ════════════════════════════════════


# Feature Name: {feature_name}
# Display Method: {display_method}


# ════════════════════════════════════
# PATIENT CLINICAL DATA (FACTUAL ONLY)
# ════════════════════════════════════


# {json.dumps(clinical_data, indent=2, default=str)}


# STRICT CONSTRAINTS:
# - No diagnoses
# - No inferred severity
# - No assumption of existing treatment
# - Any mention of medications, drug classes, or treatment actions
# will be considered a violation of task scope.




# ════════════════════════════════════
# RAW CLINICAL DICTATION (PRIMARY SIGNAL)
# ════════════════════════════════════


# This dictation represents clinician intent
# but is NOT a confirmed medication order.


# {dictation if dictation else "No dictation provided."}


# ════════════════════════════════════
# OUTPUT CATEGORIES (AUTHORITATIVE)
# ════════════════════════════════════


# You MUST structure suggestions ONLY under the following
# doctor-selected output categories.


# You MUST NOT create new categories.
# Only categories with valid suggestions should appear in the output.




# Categories:
# {json.dumps(output_categories, indent=2)}


# CAPABILITY LOCK — EMPTY MEDICATION STATE (ABSOLUTE)


# There is NO confirmed medication data.


# NOTE:
# "Medication-related considerations" refers ONLY to
# decision-support context, NOT to treatment advice.




# CRITICAL CONSEQUENCES:
# - Medication IDENTIFICATION is DISABLED
# - Medication NAMING is DISABLED
# - Medication RECOMMENDATION is DISABLED


# The assistant MUST NOT:
# ⛔ Name drugs (generic or brand)
# ⛔ Refer to drug classes
# ⛔ Suggest starting, stopping, switching, or adjusting medications
# ⛔ Imply that any medication is planned, appropriate, or required


# Only HIGH-LEVEL, NON-ACTIONABLE considerations are permitted.




# SCHEMA-DRIVEN OUTPUT AUTHORITY (STRICT)


# The provided OUTPUT CATEGORIES are the ONLY allowed
# conceptual containers for content.


# Rules:
# - No content may exist outside these categories
# - No category implies permission to name or recommend medications
# - Category titles do NOT override global prohibitions


# If a category would normally involve medications:
# ✔ Convert content to NON-SPECIFIC, CONDITIONAL considerations ONLY
# ✔ Avoid therapeutic direction






# ════════════════════════════════════
# GENERATION TASK
# ════════════════════════════════════


# Generate OPTIONAL medication-related considerations
# GROUPED STRICTLY under the provided output categories.


# RULES:
# - Do NOT name medications
# - Do NOT imply an existing medication order
# - Suggestions must be OPTIONAL and non-directive
# - Suggestions must be justified by:
#   ✔ clinical_data
#   ✔ dictation
#   ✔ documented uncertainty
#   ✔ doctor-authored rules


# CATEGORY HANDLING:
# - Each output category is OPTIONAL
# - Each category maps to a LIST of suggestion strings
# - If no safe suggestion applies → OMIT the category entirely


# SUGGESTION RULES (STRICT & ENFORCED)


# ✔ Suggestions must be:
#   - Conditional ("may be considered", "if clinically indicated")
#   - High-level
#   - Non-actionable
#   - Non-prescriptive


# ⛔ Suggestions MUST NOT:
#   - Name or hint at medications
#   - Mention drug classes (e.g., antibiotics, steroids, analgesics)
#   - Imply initiation, continuation, or modification of therapy
#   - Contain dosing, routes, or timing concepts




# ════════════════════════════════════
# OUTPUT FORMAT (STRICT – NOT JSON)
# ════════════════════════════════════


# Return output using ONLY the provided output categories
# as section headings.


# Rules:
# - Each category may contain MULTIPLE bullet points
# - Each bullet point = ONE optional medication-related consideration
# - Suggestions MUST be non-directive and conditional
# - Suggestions MUST NOT name medications
# - Content must be concise and clinically neutral
# - If a category has NO valid suggestions → OMIT it entirely
# - Do NOT add any text before or after the output
# - Do NOT include explanations, summaries, or labels


# HARD OUTPUT RULE:
# - If content does not map EXACTLY to one of the provided OUTPUT CATEGORIES,
#   it MUST NOT be produced under any circumstance.


# BEGIN GENERATION.
# """
        elif feature_id == "documentation-investigation-notes":

            agentic_json = json.dumps(agentic_output, indent=2, default=str) \
                if agentic_output else "No agentic data provided."

            temp_data_text = json.dumps(temp_data, indent=2, default=str) \
                if temp_data else "No cached data available."

            dictation_text = dictation if dictation else "No dictation provided."
            logger.info(f"investigation:{dictation_text}")
            output_json_text = json.dumps(output_json, indent=2, default=str)
            # Clear agentic data after extracting it
            agentic_output = None

            # If passing to prompt later, this will become null
            agentic_json = json.dumps(agentic_output)

            prompt = f"""
You are a CLINICAL INVESTIGATION ORDER PROCESSOR.
Return ONLY valid JSON. No prose. No markdown. No explanations outside JSON.
If you cannot comply, return {{}}.

════════════════════════════════════
INPUTS
════════════════════════════════════

FEATURE: {feature_name}

DOCTOR DICTATION (SOLE SOURCE — primary and only):
{dictation_text}

AGENTIC OUTPUT (clarification of dictation terms only — DO NOT add investigations):
{agentic_json}

OUTPUT JSON (reference for formatting only — DO NOT extract investigations from this):
{output_json_text}

TEMP DATA (reference only — DO NOT extract investigations from this):
{temp_data_text}

════════════════════════════════════
STEP 0: DICTATION GATE (MANDATORY — RUN FIRST)
════════════════════════════════════

Before ANY processing, scan dictation_text only.

A) MEDICATION FILTER:
   - Identify and DISCARD any item that is a:
     drug, medication, antibiotic, analgesic, dosage,
     frequency, route of administration, or therapeutic instruction.
   - Examples to discard: Paracetamol, Amoxicillin, Metformin,
     Ibuprofen, "500mg twice daily", "IV fluids", "apply topically".

B) INVESTIGATION EXTRACTION:
   - After discarding medications, check: does dictation contain
     ANY remaining investigation orders?
   - An investigation is: a test, scan, imaging study, biopsy,
     blood test, urine test, or functional study explicitly
     named in the dictation.

C) GATE DECISION:
   - If NO investigations remain after medication filter:
     → STOP. Return EMPTY OUTPUT SCHEMA immediately.
     → Do NOT pull from output_json, agentic_json, or temp_data.
     → Do NOT infer, suggest, or add any investigations.
   - If investigations ARE found in dictation:
     → Proceed to STEP 1.

OUTPUT JSON VALIDATION:
   - If output_json contains ONLY UI placeholder labels such as:
     "Investigation Name", "Category", "Subcategory", "LOINC Name",
     "Sample Type", "Flag Reason" with no real test values →
     treat output_json as EMPTY. Ignore it entirely.
   - NEVER fill UI template placeholders using clinical inference.

CRITICAL RULES — ZERO TOLERANCE:
   - output_json, agentic_json, and temp_data are NEVER sources
     for investigation extraction.
   - Do NOT infer or suggest investigations from diagnosis.
   - Every investigation in output MUST have a verbatim or direct
     equivalent explicitly stated in the dictation text.

════════════════════════════════════
STEP 1: EXTRACT FROM DICTATION ONLY
════════════════════════════════════

Extract ONLY investigations explicitly stated in dictation_text.

EXTRACTION RULES:
- Expand grouped panel names into individual component tests
  ONLY when the panel name is explicitly stated in dictation:
  "liver function tests"   → ALT, AST, ALP, Bilirubin Total, Albumin
  "renal function tests"   → Creatinine, Urea, Sodium, Potassium
  "coagulation screen"     → Prothrombin Time, APTT
  "thyroid function tests" → TSH, Free T4
  "lipid profile"          → Total Cholesterol, HDL Cholesterol,
                              LDL Cholesterol, Triglycerides
  "iron studies"           → Serum Iron, Ferritin
- Split investigations joined by "and" or commas → separate entries.
- Remove qualifier words from investigation_name only
  (e.g. "Urgent", "Repeat", "Routine", "Fasting", "STAT").
  These words influence the priority field only.
- Do NOT duplicate investigations.
- Do NOT add investigations from output_json.

════════════════════════════════════
STEP 2: NORMALIZE EACH INVESTIGATION
════════════════════════════════════

investigation_name:
- Clean, standardized test name. No qualifiers, no timing, no route.

category:
- "Lab"     → requires biological specimen
- "Imaging" → radiological study (X-ray, CT, MRI, US, PET, Nuclear)
- "Other"   → functional or non-radiological (ECG, EEG, Spirometry,
               Biopsy, Pathology)

subcategory:
- Lab     → Hematology / Biochemistry / Microbiology / Immunology /
            Coagulation / Tumor Markers / Endocrinology / Lipids /
            Vitamins & Minerals
- Imaging → Radiology / Nuclear Medicine / Interventional
- Other   → Cardiology / Pulmonology / Neurology /
            Surgical Pathology / Gastroenterology

sample_type:
- Blood / Urine / Tissue / CSF / Sputum / Stool / Swab
- null if no specimen collected (ECG, imaging studies)

standard_indications:
- ONE concise clinical purpose phrase only.

fasting_required:
- "Yes" / "No" / "Not specified"

priority:
- "Urgent"  → explicitly stated OR clearly urgent clinical context
- "Routine" → all other cases

════════════════════════════════════
STEP 2A: PARAMETER EXTRACTION
════════════════════════════════════

For every extracted investigation populate "parameters".

RULE 1
If the doctor's dictation explicitly mentions investigation parameters,
return ONLY those parameters.

Example:
Dictation:
"CBC with Hemoglobin and Platelet Count"

Output:
"parameters": [
  "Hemoglobin",
  "Platelet Count"
]

RULE 2
If the doctor mentions ONLY the investigation name,
populate "parameters" using the standard components of that investigation.

Examples

Complete Blood Count (CBC)
→ Hemoglobin, Hematocrit, RBC Count, WBC Count,
Platelet Count, MCV, MCH, MCHC, RDW

Liver Function Tests
→ ALT, AST, ALP, Total Bilirubin, Albumin

Renal Function Tests
→ Creatinine, Urea, Sodium, Potassium

Lipid Profile
→ Total Cholesterol, HDL Cholesterol,
LDL Cholesterol, Triglycerides

Thyroid Function Tests
→ TSH, Free T4

Urinalysis
→ Color, Appearance, Specific Gravity,
pH, Protein, Glucose, Ketones,
Blood, Nitrite, Leukocyte Esterase

RULE 3
Never generate parameters unless an investigation was explicitly extracted
from the doctor's dictation.

RULE 4
Never add a new investigation in order to generate parameters.

RULE 5
If an investigation has no commonly accepted parameter list
(e.g. CT Scan, MRI, Chest X-ray, ECG),
return:

"parameters": []

════════════════════════════════════
STEP 3: LOINC CODE ASSIGNMENT — MANDATORY
════════════════════════════════════

CRITICAL RULE — LOINC IS MANDATORY WHERE AVAILABLE:
- You MUST assign a LOINC code for every investigation that
  appears in the VERIFIED LOINC REFERENCE TABLE below.
- Matching is MANDATORY, not optional.
- Do NOT set null for any investigation that has a table entry.
- Null is only permitted when the investigation genuinely has
  no entry in the table below.
- Both loinc_code AND loinc_name must always be populated together,
  or both must be null. Never one null and one populated.
- NEVER guess or fabricate codes outside this table.

MATCHING RULES:
- Match by investigation name, common abbreviation, or synonym.
- If dictation says "CBC", "full blood count", "FBC", "hemogram"
  → all map to CBC entry in table.
- If dictation says "echo", "echocardiogram", "ECG", "EKG",
  "12-lead ECG" → map to ECG entry.
- If dictation says "LFTs", "liver enzymes", "liver function"
  → expand to ALT, AST, ALP, Bilirubin Total, Albumin and
    assign each their individual LOINC from table.
- Use common sense synonym matching before setting null.

════════════════════════════════════
VERIFIED LOINC REFERENCE TABLE
(All codes confirmed at loinc.org — mandatory use)
════════════════════════════════════

── HEMATOLOGY ─────────────────────────────────────
Complete Blood Count / CBC / FBC / Full Blood Count
  loinc_code: "58410-2"
  loinc_name: "CBC panel - Blood by Automated count"

CBC with Differential
  loinc_code: "57021-8"
  loinc_name: "CBC W Auto Differential panel - Blood"

Hemoglobin / Hb / Haemoglobin
  loinc_code: "718-7"
  loinc_name: "Hemoglobin [Mass/volume] in Blood"

── BIOCHEMISTRY ───────────────────────────────────
ALT / Alanine Aminotransferase / SGPT
  loinc_code: "1742-6"
  loinc_name: "Alanine aminotransferase [Enzymatic activity/volume] in Serum or Plasma"

AST / Aspartate Aminotransferase / SGOT
  loinc_code: "1920-8"
  loinc_name: "Aspartate aminotransferase [Enzymatic activity/volume] in Serum or Plasma"

ALP / Alkaline Phosphatase
  loinc_code: "6768-6"
  loinc_name: "Alkaline phosphatase [Enzymatic activity/volume] in Serum or Plasma"

Bilirubin Total / Total Bilirubin
  loinc_code: "1975-2"
  loinc_name: "Bilirubin.total [Mass/volume] in Serum or Plasma"

Albumin / Serum Albumin
  loinc_code: "1751-7"
  loinc_name: "Albumin [Mass/volume] in Serum or Plasma"

Creatinine / Serum Creatinine
  loinc_code: "2160-0"
  loinc_name: "Creatinine [Mass/volume] in Serum or Plasma"

Urea / BUN / Blood Urea Nitrogen / Urea Nitrogen
  loinc_code: "3094-0"
  loinc_name: "Urea nitrogen [Mass/volume] in Serum or Plasma"

Sodium / Serum Sodium / Na
  loinc_code: "2951-2"
  loinc_name: "Sodium [Moles/volume] in Serum or Plasma"

Potassium / Serum Potassium / K
  loinc_code: "2823-3"
  loinc_name: "Potassium [Moles/volume] in Serum or Plasma"

Fasting Blood Glucose / Fasting Glucose / FBG / FBS
  loinc_code: "1558-6"
  loinc_name: "Fasting glucose [Mass/volume] in Serum or Plasma"

HbA1c / Glycated Haemoglobin / Haemoglobin A1c
  loinc_code: "4548-4"
  loinc_name: "Hemoglobin A1c/Hemoglobin.total in Blood"

Uric Acid / Serum Urate
  loinc_code: "3084-1"
  loinc_name: "Urate [Mass/volume] in Serum or Plasma"

Serum Iron / Iron / Fe
  loinc_code: "2498-4"
  loinc_name: "Iron [Mass/volume] in Serum or Plasma"

Ferritin / Serum Ferritin
  loinc_code: "2276-4"
  loinc_name: "Ferritin [Mass/volume] in Serum or Plasma"

── LIPIDS ─────────────────────────────────────────
Total Cholesterol / Cholesterol
  loinc_code: "2093-3"
  loinc_name: "Cholesterol [Mass/volume] in Serum or Plasma"

HDL Cholesterol / HDL / High Density Lipoprotein
  loinc_code: "2085-9"
  loinc_name: "Cholesterol in HDL [Mass/volume] in Serum or Plasma"

LDL Cholesterol / LDL / Low Density Lipoprotein
  loinc_code: "13457-7"
  loinc_name: "Cholesterol in LDL [Mass/volume] in Serum or Plasma by calculation"

Triglycerides / TG / Triacylglycerol
  loinc_code: "2571-8"
  loinc_name: "Triglyceride [Mass/volume] in Serum or Plasma"

── ENDOCRINOLOGY ──────────────────────────────────
TSH / Thyroid Stimulating Hormone / Thyrotropin
  loinc_code: "3016-3"
  loinc_name: "Thyrotropin [Units/volume] in Serum or Plasma"

Free T4 / FT4 / Free Thyroxine
  loinc_code: "3024-7"
  loinc_name: "Thyroxine (T4) free [Mass/volume] in Serum or Plasma"

── VITAMINS & MINERALS ────────────────────────────
Vitamin B12 / Cobalamin / B12
  loinc_code: "2132-9"
  loinc_name: "Cobalamin (Vitamin B12) [Mass/volume] in Serum or Plasma"

Vitamin D / 25-OH Vitamin D / 25-Hydroxyvitamin D / Vit D
  loinc_code: "62292-8"
  loinc_name: "25-Hydroxyvitamin D3+25-Hydroxyvitamin D2 [Mass/volume] in Serum or Plasma"

── IMMUNOLOGY / INFLAMMATION ──────────────────────
CRP / C-Reactive Protein
  loinc_code: "1988-5"
  loinc_name: "C reactive protein [Mass/volume] in Serum or Plasma"

ESR / Erythrocyte Sedimentation Rate
  loinc_code: "30341-2"
  loinc_name: "Erythrocyte sedimentation rate"

── COAGULATION ────────────────────────────────────
Prothrombin Time / PT / INR
  loinc_code: "5902-2"
  loinc_name: "Prothrombin time (PT)"

APTT / aPTT / Activated Partial Thromboplastin Time
  loinc_code: "3173-2"
  loinc_name: "aPTT in Blood by Coagulation assay"

── URINALYSIS ─────────────────────────────────────
Urinalysis / Urine Routine / Urine RE / Dipstick Urine
  loinc_code: "24357-6"
  loinc_name: "Urinalysis macro (dipstick) panel - Urine"

── IMAGING: ULTRASOUND ────────────────────────────
Ultrasound Abdomen / US Abdomen / Abdominal Ultrasound
  loinc_code: "24558-9"
  loinc_name: "US Abdomen"

Ultrasound Breast / US Breast / Breast Ultrasound
  loinc_code: "24601-7"
  loinc_name: "US Breast"

Obstetric Ultrasound / Ultrasound for Pregnancy / Dating Scan
  loinc_code: "11525-3"
  loinc_name: "US for pregnancy"

── IMAGING: X-RAY ─────────────────────────────────
Chest X-Ray / CXR / X-Ray Chest (2 views)
  loinc_code: "36643-5"
  loinc_name: "XR Chest 2 Views"

Chest X-Ray Single View / CXR 1 view
  loinc_code: "36554-4"
  loinc_name: "XR Chest Single view"

Chest X-Ray (unspecified views)
  loinc_code: "30745-4"
  loinc_name: "XR Chest Views"

── IMAGING: CT ────────────────────────────────────
CT Chest / CT Thorax
  loinc_code: "24627-2"
  loinc_name: "CT Chest"

CT Abdomen / CT Abdomen Scan
  loinc_code: "41806-1"
  loinc_name: "CT Abdomen"

── IMAGING: MRI ───────────────────────────────────
MRI Brain / MR Brain / Brain MRI
  loinc_code: "24590-2"
  loinc_name: "MR Brain"

MRI Abdomen / MR Abdomen
  loinc_code: "24556-3"
  loinc_name: "MR Abdomen"

── OTHER: FUNCTIONAL STUDIES ──────────────────────
ECG / EKG / 12-Lead ECG / Electrocardiogram
  loinc_code: "11524-6"
  loinc_name: "EKG study"

Spirometry / Lung Function Test / PFT
  loinc_code: "18759-1"
  loinc_name: "Spirometry study"

── OTHER: PATHOLOGY ───────────────────────────────
Biopsy / Histopathology / Pathology Study / Tissue Biopsy
  loinc_code: "11526-1"
  loinc_name: "Pathology study"

════════════════════════════════════
STEP 4: APPROPRIATENESS FLAGGING
════════════════════════════════════

Extract diagnosis ONLY from dictation_text or agentic_json.
Use diagnosis ONLY for flagging — NOT for adding investigations.
If no diagnosis found → use "unspecified diagnosis" and flag
all investigations "standard" with reason noting diagnosis
was not specified in the dictation.

FLAG VALUES:
"standard"    → clinically appropriate and expected for diagnosis
"advanced"    → higher complexity/cost/risk than first-line,
                 but may still be justified
"unnecessary" → no clear clinical rationale for this diagnosis

flag_reason:
- One clear sentence explaining WHY this flag was assigned.
- MUST reference the specific diagnosis.
- FORBIDDEN: "not indicated", "per guidelines", "standard practice",
  "based on data", "as per protocol", "per clinical guidelines",
  "routinely ordered".

IMPORTANT:
- Flagging is ADVISORY only. Never remove any investigation.
- Doctor retains final authority. All flags are editable.

════════════════════════════════════
FINAL GATE — VERIFY BEFORE OUTPUT
════════════════════════════════════

1. Every investigation comes ONLY from dictation_text.
2. No investigation sourced from output_json, agentic_json,
   or temp_data.
3. No medications or drugs included.
4. No duplicated investigations.
5. Every investigation that matches the LOINC table HAS a code.
   Null is only present for investigations not in the table.
6. loinc_code and loinc_name are always both populated or both null.
7. All LOINC codes are ONLY from the VERIFIED REFERENCE TABLE.
8. Every investigation has appropriateness_flag AND flag_reason.
9. flag_reason references the specific diagnosis.
10. No forbidden phrases in any field.
12. Every investigation contains a "parameters" field.
13. If parameters were explicitly dictated, preserve only those.
14. Otherwise populate the standard parameter list for that investigation.
15. Never create parameters when no investigation exists.

If ANY check fails → fix and regenerate before returning.

════════════════════════════════════
OUTPUT SCHEMA (DO NOT ALTER)
════════════════════════════════════

{{
  "status": "success",
  "feature_id": "documentation-investigation-notes",
  "feature_name": "{feature_name}",
  "display_method": "structured_table",
  "extracted_diagnosis": "",
  "investigation_orders": [
    {{
      "investigation_name": "",
      "parameters": [],
      "loinc_code": null,
      "loinc_name": null,
      "category": "",
      "subcategory": "",
      "standard_indications": null,
      "sample_type": null,
      "fasting_required": "Not specified",
      "priority": "Routine",
      "appropriateness_flag": "standard | advanced | unnecessary",
      "flag_reason": "",
      "editable": true
    }}
  ],
  "metadata": {{
    "total_investigations": 0
  }}
}}

════════════════════════════════════
EMPTY OUTPUT SCHEMA
(Return only when dictation has zero investigations)
════════════════════════════════════

{{
  "status": "success",
  "feature_id": "documentation-investigation-notes",
  "feature_name": "{feature_name}",
  "display_method": "structured_table",
  "extracted_diagnosis": "",
  "investigation_orders": [],
  "metadata": {{
    "total_investigations": 0
  }}
}}

Return ONLY the JSON above. Nothing else."""


        elif feature_id == "documentation-clinical-notes":
            agentic_json = json.dumps(agentic_output, indent=2, default=str) \
                if agentic_output else "No agentic data provided."

            temp_data_text = json.dumps(temp_data, indent=2, default=str) \
                if temp_data else "No cached data available."

            dictation_text = dictation if dictation else "No dictation provided."
            # Clear agentic data after extracting it
            agentic_output = None

            # If passing to prompt later, this will become null
            agentic_json = json.dumps(agentic_output)

            prompt = f"""
You are a CLINICAL VALIDATION & DECISION-SAFETY ENGINE.
Return ONLY valid JSON. No prose. No explanations outside JSON. No markdown.
If you cannot comply, return {{}}.

═══════════════════════════════
INPUTS
═══════════════════════════════

AGENTIC OUTPUT (authoritative clinical intelligence — REASONING SOURCE ONLY, NEVER A NAMING SOURCE):
{agentic_json}

DOCTOR DICTATION (the ONLY source of medication/investigation NAMES):
{dictation_text}

PATIENT CONTEXT (may be null):
{temp_data_text}

═══════════════════════════════
NON-NEGOTIABLE RULE #1 — DICTATION IS THE ONLY SOURCE OF TRUTH FOR MEDS/INVESTIGATIONS
═══════════════════════════════

- A medication or investigation NAME appears in the output IF AND ONLY IF that
  exact name (or an unambiguous synonym/brand-generic match) is present as
  literal text inside DOCTOR DICTATION.
- If the doctor ordered it in dictation → it MUST appear in the output. Omitting
  a dictated medication/investigation is a FAILURE equal in severity to
  hallucinating one.
- If a medication or investigation NAME does NOT appear as literal text in
  DOCTOR DICTATION → it MUST NOT appear anywhere in drug_name, test_name, or
  any array in rx_validation/investigation_validation — even if agentic_output,
  clinical guidelines, or standard-of-care reasoning would suggest it.
- CRITICAL WARNING: agentic_json is generated by a separate clinical AI and
  routinely contains ITS OWN recommended/suggested medications and
  investigations that the doctor never dictated. This is EXPECTED and NORMAL —
  it does not mean those items belong in your output. Every medication or
  investigation name you see inside agentic_json that does NOT also appear as
  literal text in dictation_text is NOISE for naming purposes. Do not copy it,
  rephrase it, or "confirm" it into rx_validation or investigation_validation.
- agentic_json and temp_data may ONLY be used to write REASONING TEXT
  (explainability, dose_concerns, contraindications, interaction_risks,
  clinical_justification, issues) about an item that ALREADY exists because it
  was extracted from dictation. They can never populate a drug_name or
  test_name field.
- Zero medications in dictation → rx_validation key is fully omitted.
  Zero investigations in dictation → investigation_validation key is fully omitted.
- If this rule ever conflicts with any instruction below, THIS RULE WINS.

═══════════════════════════════
STEP 0: MANDATORY EXTRACTION (STRICT — DICTATION ONLY)
═══════════════════════════════

Before any validation, extract from dictation ONLY:

A) medications_from_dictation
- Every medication explicitly mentioned as literal text in dictation, any
  specialty, any route.
- Preserve: exact name, dose, frequency, route.
- No merging. No skipping. No inferring.
- Do NOT add, predict, suggest, or supplement with any medication that is not
  explicitly present as literal text in dictation — even if agentic_output,
  clinical guidelines, or standard practice would recommend it.
- If dictation mentions ZERO medications → medications_from_dictation = []

B) investigations_from_dictation
- Every investigation explicitly mentioned as literal text in dictation, any
  specialty.
- Expand any grouped term into its individual constituent tests (this is
  expansion of what was stated, not addition of new items).
- Include labs, imaging, bedside, functional, repeat tests.
- Do NOT add, predict, suggest, or supplement with any investigation that is
  not explicitly present as literal text in dictation — even if agentic_output,
  clinical guidelines, or standard practice would recommend it.
- If dictation mentions ZERO investigations → investigations_from_dictation = []

═══════════════════════════════
STEP 0.5: MANDATORY SOURCE TAGGING (SILENT INTERNAL VERIFICATION)
═══════════════════════════════

Before writing rx_validation or investigation_validation into the output,
perform this check internally for EVERY item you are about to write, one at
a time. Do not output this reasoning — it is an internal gate only.

For each candidate drug_name or test_name, ask in order:
  1. "Can I point to the literal words in DOCTOR DICTATION that name this item?"
     - YES → proceed to write it.
     - NO → DELETE this item from your working list immediately. It does not
       go in the output, no matter where else it appeared (agentic_json,
       guideline knowledge, clinical judgment).
  2. "Did I get this name from agentic_json, guideline knowledge, or my own
     clinical judgment rather than from dictation text?"
     - If YES to this → this is a violation in progress. Stop. Remove the item.

Any item that fails tag #1 must never reach the final JSON. There is no
partial credit, no "clinically reasonable to include," no exception.

COUNT GATE (mandatory — do not proceed if failed):
- Count of medications in dictation = count in rx_validation.medications[]
- Count of investigations in dictation = count in investigation_validation.investigations[]
- Zero in dictation = zero in output (see CONDITIONAL OUTPUT RULE below).
Mismatch (including outputting items not present in dictation, or omitting
items that ARE present in dictation) → output INVALID. Regenerate.

═══════════════════════════════
CONDITIONAL OUTPUT RULE (STRICT — APPLIES TO FINAL JSON)
═══════════════════════════════

- If medications_from_dictation is empty → OMIT the entire "rx_validation" key
  from the final output JSON. Do not output it as an empty object or with
  placeholder/empty arrays.
- If investigations_from_dictation is empty → OMIT the entire
  "investigation_validation" key from the final output JSON. Do not output it
  as an empty object or with placeholder/empty arrays.
- "diagnosis_validation", "insurance_risk_analysis", and "summary_flags" are
  ALWAYS present in the output regardless of medication/investigation presence.
- Never fabricate a medication or investigation solely to keep a section
  non-empty. An absent section is the correct and required output when
  dictation contains none.

═══════════════════════════════
OPERATING RULES
═══════════════════════════════

- Advisory only. Doctor retains final authority.
- Use agentic_output for clinical intelligence and reasoning ONLY — never as a
  source of additional medications, investigations, or diagnoses beyond what
  dictation states or clearly implies.
- Never assume or fabricate missing data. Flag it explicitly.
- All findings must be explainable, traceable, and editable.
- Explainability MUST reference specific clinical factors from the case:
  symptoms, vitals, lab values, imaging findings, comorbidities, drug class effects, organ function.

FORBIDDEN phrases in ANY field:
  "Based on agentic_output", "Based on dictation", "Based on available data",
  "As per guidelines", "Standard practice", "Clinical reasoning applied",
  "Based on the patient's profile"

FALLBACK RULE:
  "Insufficient clinical data available to fully assess this item."
  MUST ONLY be used when the specific data needed is genuinely absent from ALL
  three inputs (agentic_output, dictation, temp_data).
  If dictation contains dose, frequency, route, age, receptor status, imaging findings,
  or any relevant clinical detail — you MUST use it.
  Using this fallback when data exists in inputs is a VALIDATION FAILURE → regenerate.

═══════════════════════════════
DOMAIN 1: DIAGNOSIS & CODING
═══════════════════════════════

EXTRACTION:
- Extract all diagnoses explicitly stated or clearly implied in dictation.
- Cross-check against agentic_output reasoning.
- Do NOT invent or assume diagnoses not present or implied.

ICD-10 RULES (STRICT):
- Provide exactly 3 ICD-10 codes per diagnosis, ranked 1 (most relevant) to 3.
- Each code MUST be distinct. Duplicate codes across ranks are FORBIDDEN.
- Code name MUST exactly match the official ICD-10-CM description for that code.
- If you are not certain a code name matches exactly → do NOT use it. Flag in issues[].
  A hallucinated or mismatched code name is a critical failure.
- Use the most specific code available:
  • Laterality required (breast, limb, eye) → use laterality-specific code.
  • Recurrence or relapse present → reflect it in code selection.
  • Staging known → use most specific stage-appropriate code.
- Each explanation MUST state why this specific code applies to THIS patient's
  clinical picture (findings, history, imaging, receptor status, laterality, stage).
- Rank 1 must be the single most accurate and complete code for this patient.

ISSUES (MANDATORY):
- issues[] MUST contain at least one entry per diagnosis.
- Explain what is confirmed, ambiguous, incomplete, or uncertain.
- If confidence < 1.0 → state what clinical data would increase certainty.

EXPLAINABILITY:
- Must reference specific clinical findings from dictation or agentic_output.
- Must NOT use any forbidden phrase.

═══════════════════════════════
DOMAIN 2: INVESTIGATION VALIDATION (CONDITIONAL)
═══════════════════════════════

- Only applicable if investigations_from_dictation is non-empty. If empty,
  omit this entire domain per CONDITIONAL OUTPUT RULE.
- Validate every investigation from Step 0 extraction — and ONLY those.
- REMINDER: agentic_json may list its own suggested investigations. If an
  investigation appears in agentic_json but NOT as literal text in dictation,
  it must NOT appear here, and must NOT be mentioned in issues[] as something
  "also worth considering." Ignore it completely for this domain.
- issues[] MUST contain at least one entry per investigation:
  • If appropriate → confirm why with specific clinical reasoning from this case.
  • If concern exists → explain what it is.
- clinical_justification MUST be patient-specific, not generic.

LOINC RULES (STRICT):
- For each investigation, provide the LOINC code only if you are certain it is accurate
  and matches the official LOINC database.
- For each LOINC entry, provide:
  • code: the LOINC numeric code (e.g. "2160-0")
  • name: the full official LOINC long name exactly as it appears in the LOINC database
    (e.g. "Creatinine [Mass/volume] in Serum or Plasma")
- If you are not certain the code and name are accurate → return empty array [].
- NEVER guess, approximate, or fabricate LOINC codes or names.
- A hallucinated LOINC code or mismatched name is worse than no code
  and will directly cause insurance claim rejection.
- suggested_loinc[] MUST contain objects, not strings.

═══════════════════════════════
DOMAIN 3: MEDICATION SAFETY (CONDITIONAL)
═══════════════════════════════

- Only applicable if medications_from_dictation is non-empty. If empty,
  omit this entire domain per CONDITIONAL OUTPUT RULE.
- Validate every medication from Step 0 extraction — and ONLY those.
- REMINDER: agentic_json may list its own suggested or recommended
  medications. If a medication appears in agentic_json but NOT as literal text
  in dictation, it must NOT appear here, and must NOT be mentioned in
  interaction_risks, dose_concerns, contraindications, or multi_specialty_impact
  as something to add or consider. Ignore it completely for this domain.
- Compare EACH dictated medication against ALL OTHER dictated medications for
  interactions. Do not compare against or reference any non-dictated drug.
- Use clinical data present in dictation and agentic_output before invoking fallback.

  interaction_risks:
  - Check each dictated medication against every other dictated medication.
  - State specific interaction mechanism if found.
  - If none → explicitly state why with drug class reasoning.

  dose_concerns:
  - Evaluate dose, frequency, duration against patient-specific factors from dictation
    (age, weight, organ function if available).
  - If specific data missing → state exactly which data is missing.

  contraindications:
  - Evaluate against: age, renal status, hepatic status, comorbidities, disease state.
  - Use drug-specific contraindication criteria.
  - Generic statements like "no contraindications noted" are FORBIDDEN.
    Must explain WHY based on available clinical data.
  - If patient data missing → state exactly what is missing.

  multi_specialty_impact:
  - State which specialties are impacted and why.
  - Reference specific drug effects relevant to that specialty.
  - If none → state explicitly with drug class reasoning.

- All array fields must contain objects per schema. No plain strings.

═══════════════════════════════
DOMAIN 4: INSURANCE RISK
═══════════════════════════════

- Assess coherence across: diagnosis ↔ investigations ↔ procedures ↔ medications
  (using only what is present in dictation for investigations/medications).
- Assign overall_risk: low / medium / high.
- Use clinical data from dictation and agentic_output before invoking fallback.

risk_factors:
- State what increases or decreases rejection risk.
- Reference specific diagnosis-investigation-Rx alignment or gaps.
- Explain what insurers typically require for this clinical scenario.

missing_documentation:
- State exactly what document, report, or data is absent.
- Explain why it is required for insurance approval.
- State which domain it affects (diagnosis, investigation, Rx, monitoring).
- Do NOT list a missing medication or investigation itself as "missing
  documentation" — that would smuggle a non-dictated item into the output
  through the back door. This field is for documents/reports, not for new
  drug or test names.

potential_rejection_reasons:
- State the exact reason an insurer may reject.
- Explain whether it is administrative or clinical in nature.
- Link to specific missing or weak documentation.

suggested_corrections:
- State what action reduces rejection risk.
- Explain what documentation or clarification should be added.
- Do NOT suggest adding a new medication or investigation name here either —
  suggest clarifying documentation only, never a new clinical order.

explainability:
- Minimum 3-4 complete sentences.
- Synthesize diagnosis, investigations (if any), Rx (if any), and documentation gaps.
- Justify the assigned overall_risk level with specific clinical-insurance reasoning.
- Must NOT use any forbidden phrase.

═══════════════════════════════
ARRAY OBJECT SCHEMA (STRICT)
═══════════════════════════════

All arrays must contain objects. Plain strings are FORBIDDEN.

suggested_loinc:        [ {{ "code": "...", "name": "..." }} ]
interaction_risks:      [ {{ "interaction_text": "..." }} ]
dose_concerns:          [ {{ "dose_text": "..." }} ]
contraindications:      [ {{ "contraindication_text": "..." }} ]
multi_specialty_impact: [ {{ "specialty_text": "..." }} ]
risk_factors:           [ {{ "risk_factor_text": "..." }} ]
missing_documentation:  [ {{ "missing_documentation_text": "..." }} ]
potential_rejection_reasons: [ {{ "rejection_reason_text": "..." }} ]
suggested_corrections:  [ {{ "correction_text": "..." }} ]
issues:                 [ {{ "issue_text": "..." }} ]

If no issue exists → return ONE object stating why explicitly. Empty arrays are FORBIDDEN
within a section that IS present in the output.
Exception: suggested_loinc[] may be empty [] if no verified code is available
(this only applies when investigation_validation itself is present).

═══════════════════════════════
FINAL GATE (CHECK BEFORE OUTPUT)
═══════════════════════════════

Before generating JSON, verify, item by item:
0. NON-NEGOTIABLE RULE #1 + STEP 0.5 re-confirmed: for every drug_name and
   test_name you are about to output, you can point to literal text in
   DOCTOR DICTATION that names it. Any item you cannot point to in dictation
   text is deleted now, before output — even if it came from agentic_json,
   even if it is clinically sensible, even if it is "commonly ordered for
   this condition." If this check conflicts with any other instruction,
   Rule #1 / Step 0.5 wins.
1. Every medication in dictation has a corresponding rx_validation entry, and
   no medication appears that is not in dictation.
2. Every investigation in dictation has a corresponding investigation_validation
   entry, and no investigation appears that is not in dictation.
3. If medications_from_dictation is empty, "rx_validation" key is fully omitted
   from output.
4. If investigations_from_dictation is empty, "investigation_validation" key is
   fully omitted from output.
5. No ICD-10 codes are duplicated within the same diagnosis.
6. Every ICD-10 code name exactly matches official ICD-10-CM description.
7. Every LOINC entry has both code and full official name, or array is empty [].
8. No LOINC codes or names are guessed or fabricated.
9. No issues[], interaction_risks[], dose_concerns[], contraindications[],
   or multi_specialty_impact[] arrays are empty within a present section.
10. No forbidden phrases appear in any field.
11. Fallback phrase used ONLY where data is genuinely absent from all inputs.
12. All explainability fields reference specific clinical factors from the case.
13. Insurance explainability is minimum 3-4 sentences.
14. missing_documentation and suggested_corrections contain no new drug or
    test names — only documentation/clarification items.

If any check fails → regenerate before returning output.

═══════════════════════════════
OUTPUT SCHEMA (FIXED — DO NOT ALTER STRUCTURE OF PRESENT SECTIONS)
═══════════════════════════════

"investigation_validation" and "rx_validation" are CONDITIONAL keys:
include them ONLY if the corresponding dictation extraction is non-empty.
When included, their internal structure must exactly match the schema below.
When the corresponding extraction is empty, omit the key entirely — do not
include it with an empty array.

{{
  "clinical_validation": {{
    "diagnosis_validation": {{
      "diagnoses": [
        {{
          "diagnosis_text": "",
          "icd10_codes": [
            {{ "code": "", "name": "", "explanation": "", "rank": 1 }},
            {{ "code": "", "name": "", "explanation": "", "rank": 2 }},
            {{ "code": "", "name": "", "explanation": "", "rank": 3 }}
          ],
          "confidence": 0.0,
          "validation_status": "valid | needs_review | mismatch",
          "issues": [ {{ "issue_text": "" }} ],
          "explainability": "",
          "editable": true
        }}
      ]
    }},
    "investigation_validation": {{
      "investigations": [
        {{
          "test_name": "",
          "suggested_loinc": [
            {{ "code": "", "name": "" }}
          ],
          "clinical_justification": "",
          "necessity_status": "appropriate | redundant | missing | unclear",
          "issues": [ {{ "issue_text": "" }} ],
          "explainability": "",
          "editable": true
        }}
      ]
    }},
    "rx_validation": {{
      "medications": [
        {{
          "drug_name": "",
          "safety_status": "safe | caution | high_risk",
          "interaction_risks": [ {{ "interaction_text": "" }} ],
          "dose_concerns": [ {{ "dose_text": "" }} ],
          "contraindications": [ {{ "contraindication_text": "" }} ],
          "multi_specialty_impact": [ {{ "specialty_text": "" }} ],
          "explainability": "",
          "editable": true
        }}
      ]
    }},
    "insurance_risk_analysis": {{
      "overall_risk": "low | medium | high",
      "risk_factors": [ {{ "risk_factor_text": "" }} ],
      "missing_documentation": [ {{ "missing_documentation_text": "" }} ],
      "potential_rejection_reasons": [ {{ "rejection_reason_text": "" }} ],
      "suggested_corrections": [ {{ "correction_text": "" }} ],
      "explainability": ""
    }},
    "summary_flags": {{
      "clinical_safety": "green | amber | red",
      "insurance_readiness": "green | amber | red",
      "requires_doctor_review": true
    }}
  }}
}}

Remember: "investigation_validation" and "rx_validation" appear in the actual
output ONLY when the dictation contains at least one investigation / medication
respectively. Otherwise omit that key entirely while keeping every other key
and its internal structure exactly as specified.

Return ONLY the JSON above (with conditional keys applied). Nothing else.
"""
        
        elif feature_id == "documentation-discharge-summary":

            # ---------------------------------------------------------
            # 1️⃣ FETCH PREVIOUS DOCUMENTATION DATA
            # ---------------------------------------------------------

            treatment_plan_doc = await documentation_treatment_plan_collection.find_one(
                {"patient_id": patient_id},
                {"_id": 0}
            )

            medication_analysis_doc = await documentation_medication_analysis_collection.find_one(
                {"patient_id": patient_id},
                {"_id": 0}
            )

            investigation_doc = await documentation_investigation_notes_collection.find_one(
                {"patient_id": patient_id},
                {"_id": 0}
            )

            treatment_summary_doc = await documentation_treatment_summary_collection.find_one(
                {"patient_id": patient_id},
                {"_id": 0}
            )

            clinical_notes_doc = await documentation_clinical_notes_collection.find_one(
                {"patient_id": patient_id},
                {"_id": 0}
            )

            dictation_doc = await dictation_collection.find_one(
                {"patient_id": patient_id},
                {"_id": 0}
            )
            # ---------------------------------------------------------
            # 1️⃣.5 FETCH CHIEF COMPLAINT FROM PATIENT APPOINTMENTS
            # ---------------------------------------------------------

            chief_complaint = ""

            doc = await patient_appointments_collection.find_one(
                {"sys_user_id": patient_id},
                {"_id": 0, "appointments": 1}
            )

            if doc and doc.get("appointments"):
                latest_appointment = max(
                    doc["appointments"],
                    key=lambda a: a.get("updated_at", "")
                )
                chief_complaint = latest_appointment.get("chief_complaint", "")



            # ---------------------------------------------------------
            # 2️⃣ SAFE EXTRACTION
            # ---------------------------------------------------------

            treatment_plan_data = treatment_plan_doc.get("finaloutput") if treatment_plan_doc else {}
            medication_analysis_data = medication_analysis_doc.get("finaloutput") if medication_analysis_doc else {}
            investigation_data = investigation_doc.get("finaloutput") if investigation_doc else {}
            treatment_summary_data = treatment_summary_doc.get("finaloutput") if treatment_summary_doc else {}
            clinical_notes_data = clinical_notes_doc.get("finaloutput") if clinical_notes_doc else {}

            dictation_text = dictation if dictation else (
                dictation_doc.get("dictation") if dictation_doc else "No dictation provided."
            )

            agentic_json = json.dumps(agentic_output, indent=2, default=str) \
                if agentic_output else "No agentic data provided."

            temp_data_text = json.dumps(temp_data, indent=2, default=str) \
                if temp_data else "No cached data available."

            # ---------------------------------------------------------
            # 3️⃣ CONTEXT SERIALIZATION
            # ---------------------------------------------------------

            treatment_plan_text = json.dumps(treatment_plan_data, indent=2, default=str) \
                if treatment_plan_data else "No treatment plan available."

            medication_analysis_text = json.dumps(medication_analysis_data, indent=2, default=str) \
                if medication_analysis_data else "No medication analysis available."

            investigation_text = json.dumps(investigation_data, indent=2, default=str) \
                if investigation_data else "No investigation data available."

            treatment_summary_text = json.dumps(treatment_summary_data, indent=2, default=str) \
                if treatment_summary_data else "No treatment summary available."

            clinical_notes_text = json.dumps(clinical_notes_data, indent=2, default=str) \
                if clinical_notes_data else "No clinical notes available."

            # ---------------------------------------------------------
            # 4️⃣ PROMPT CONSTRUCTION
            # ---------------------------------------------------------

            prompt = f"""

You are a PRODUCTION-GRADE CLINICAL DISCHARGE SUMMARY GENERATION ENGINE.

You operate inside a hospital EHR system.

This discharge summary is a LEGAL MEDICAL DOCUMENT.
Doctor authority is ABSOLUTE.
You are NOT allowed to invent, infer, optimize, or modify clinical decisions.

You must synthesize ONLY documented inpatient care.

════════════════════════════════════
CLINICAL GOVERNANCE PRINCIPLES
════════════════════════════════════

1️⃣ No hallucinations.
2️⃣ No new diagnoses.
3️⃣ No new medications.
4️⃣ No new investigations.
5️⃣ No retrospective optimization.
6️⃣ No AI suggestions.
7️⃣ No safety commentary.
8️⃣ No treatment analysis.
9️⃣ No assumptions beyond provided documentation.
🔟 If information is missing → leave field empty or return empty array.

This document must reflect COMPLETED inpatient care only.

════════════════════════════════════
AUTHORITATIVE INPUT HIERARCHY
════════════════════════════════════

Primary sources of truth (in order of authority):

1. Treatment Plan
2. Clinical Notes
3. Doctor Dictation
4. Medication Analysis
5. Investigation Notes
6. Treatment Summary
7. Agentic Context (reference only – never source of new facts)
8. Temp Data (reference only – never source of new decisions)

════════════════════════════════════
AGENTIC CLINICAL CONTEXT (REFERENCE ONLY)
════════════════════════════════════
{agentic_json}

════════════════════════════════════
TEMP PATIENT DATA (REFERENCE ONLY)
════════════════════════════════════
{temp_data_text}

════════════════════════════════════
TREATMENT PLAN (AUTHORITATIVE)
════════════════════════════════════
{treatment_plan_text}

════════════════════════════════════
MEDICATION ANALYSIS (AUTHORITATIVE)
════════════════════════════════════
{medication_analysis_text}

════════════════════════════════════
INVESTIGATION NOTES (AUTHORITATIVE)
════════════════════════════════════
{investigation_text}

════════════════════════════════════
TREATMENT SUMMARY (AUTHORITATIVE)
════════════════════════════════════
{treatment_summary_text}

════════════════════════════════════
CLINICAL NOTES (AUTHORITATIVE)
════════════════════════════════════
{clinical_notes_text}

════════════════════════════════════
DOCTOR DICTATION
════════════════════════════════════
{dictation_text}

════════════════════════════════════
MANDATORY INTERNAL VALIDATION PROCESS
════════════════════════════════════

Before generating output, you MUST internally:

1️⃣ Extract all documented:
   - Admission reasons
   - Diagnoses
   - Procedures
   - Investigations
   - Medications
   - Clinical progress notes
   - Discharge condition statements
   - Follow-up instructions

2️⃣ Perform cross-source reconciliation:
   - Ensure diagnoses appear in authoritative documents
   - Ensure discharge medications match medication_analysis
   - Ensure investigations summary reflects investigation_notes
   - Ensure procedures match treatment_plan or clinical_notes
   - Ensure hospital course reflects documented inpatient events only

3️⃣ Eliminate:
   - Outpatient-only content
   - Predictive commentary
   - Risk analysis
   - AI interpretation
   - Duplicate statements

4️⃣ Validate consistency:
   - Discharge medications must be traceable to inpatient medication records
   - Final diagnosis must not exceed documented diagnoses
   - Procedures must have documented performance
   - Follow-up must be explicitly documented

If any section lacks documentation:
→ Leave the field empty ("") or return [].

════════════════════════════════════
CLINICAL LANGUAGE REQUIREMENTS
════════════════════════════════════

• Use formal hospital discharge tone
• Use medically precise terminology
• Avoid conversational language
• Avoid redundancy
• Avoid vague wording
• Avoid defensive or speculative phrasing
• No guideline references
• No medico-legal commentary

════════════════════════════════════
CHIEF COMPLAINT (AUTHORITATIVE – APPOINTMENT SOURCE)
════════════════════════════════════

{chief_complaint if chief_complaint else "No documented chief complaint available."}

ABSOLUTE ENFORCEMENT — DISCHARGE MEDICATIONS

If the assistant attempts to include:
- medication objects
- dosage_form
- route
- strength
- brand_name
- intravenous medications

the output is INVALID.

discharge_medications MUST be:
- an array of plain strings
- OR an empty array []

Example:
[
  "Aspirin 75 mg once daily",
  "Atorvastatin 40 mg at night"
]


════════════════════════════════════
OUTPUT STRUCTURE (PRODUCTION READY – FIXED)
════════════════════════════════════

Return ONLY valid JSON in the following structure:

{{
  "discharge_summary": {{
    "admission_reason": "",
    "final_diagnosis": [],
    "icd10_codes": [],
    "hospital_course": "",
    "chief_complaint": "",
    "procedures_performed": [],
    "investigations_summary": "",
    "treatment_given": "",
    "discharge_medications": [],
    "condition_at_discharge": "",
    "discharge_instructions": "",
    "follow_up_plan": ""
  }}
}}

════════════════════════════════════
FIELD GENERATION RULES
════════════════════════════════════

admission_reason:
- Concise paragraph
- Based only on documented presenting complaint or reason for admission

final_diagnosis:
- Array
- Each diagnosis must be explicitly documented
- No inferred diagnoses

hospital_course:
- Chronological narrative of inpatient events
- Must reflect documented progression only
- No interpretation

procedures_performed:
- Array
- Include only documented completed procedures

investigations_summary:
- Summary paragraph of major investigations performed
- No interpretation of results beyond documentation

treatment_given:
- Summary of inpatient therapies administered
- Must reflect documented medications, procedures, supportive care

discharge_medications:
- Array
- MUST match medication_analysis prescriptions
- No additions
- No removals

condition_at_discharge:
- Clinical status as documented
- Stable / improved / guarded ONLY if documented

discharge_instructions:
- Include only documented instructions
- No newly generated advice

follow_up_plan:
- Must reflect explicitly documented follow-up recommendations

chief_complaint:
- MUST be copied verbatim from the CHIEF COMPLAINT section above.
- MUST NOT be inferred from admission_reason.
- MUST NOT be rewritten.
- If section says "No documented chief complaint available." → return "".

If chief_complaint and admission_reason are clinically inconsistent,
do NOT override admission_reason.
chief_complaint must remain as appointment data.

If no structured diagnosis is present in authoritative sources,
you may extract diagnosis directly from Doctor Dictation,
but only if explicitly described.


ICD10 CODE GENERATION (MANDATORY)

For each item in final_diagnosis:

1️⃣ Map the diagnosis to the most appropriate ICD-10 code.
2️⃣ Do NOT create new diagnoses.
3️⃣ If diagnosis text is vague:
   - Select the closest appropriate ICD-10 code.
4️⃣ Include:
   - diagnosis (exact text from final_diagnosis)
   - code (ICD-10 format, e.g., I50.1)
   - description (official short ICD description)
   - confidence (high | moderate | low)

If ICD mapping cannot be confidently determined:
- Still provide best possible mapping.
- Set confidence = "low".

ICD mapping must align exactly with final_diagnosis.
No extra diagnoses allowed.
ICD VALIDATION RULES:

- Number of icd10_codes entries MUST equal number of final_diagnosis entries.
- ICD codes MUST correspond to documented diagnoses.
- If final_diagnosis is empty → icd10_codes must be [].
- Do NOT hallucinate rare subtypes unless explicitly documented.


════════════════════════════════════
STRICT OUTPUT RULES
════════════════════════════════════

• JSON only
• No extra keys
• No commentary outside JSON
• No analysis
• No AI suggestions
• No null values (use "" or [] instead)
• Must be syntactically valid JSON

FINAL SELF-VALIDATION (MANDATORY)

Before returning JSON:
- If discharge_medications contains objects → regenerate
- If discharge_medications contains IV medications → remove them
- If discharge instructions are generic → replace with ""
- If follow_up_plan is vague → replace with ""
- If chief_complaint is inferred → replace with ""

If unable to populate safely:
→ Return empty structured fields without fabrication.

BEGIN GENERATION.
"""


        


        elif feature_id == "documentation-clinical-summary":

           # ---------------------------------------------------------
            # 1️⃣ FETCH CHIEF COMPLAINT (LATEST APPOINTMENT)
            # ---------------------------------------------------------

            chief_complaint = ""

            appointment_doc = await patient_appointments_collection.find_one(
                {"sys_user_id": patient_id}
            )

            if appointment_doc and appointment_doc.get("appointments"):
                latest_appointment = sorted(
                    appointment_doc["appointments"],
                    key=lambda x: x.get("updated_at", ""),
                    reverse=True
                )[0]
                chief_complaint = latest_appointment.get("chief_complaint", "")

            # ---------------------------------------------------------
            # 2️⃣ FETCH DOCUMENT CATEGORIES (FULL PROCESSED DATA)
            # ---------------------------------------------------------

            key_findings_documents = []

            document_cursor = document_categories_collection.find(
                {"patient_id": patient_id}
            ).sort("_id", -1).limit(3)


            async for doc in document_cursor:

                processed_list = doc.get("processed_data", [])

                for item in processed_list:
                    content_str = item.get("content")

                    if not content_str:
                        continue

                    try:
                        parsed_content = json.loads(content_str)
                        key_findings_documents.append(parsed_content)
                    except Exception:
                        key_findings_documents.append(content_str)

            key_findings_text = json.dumps(
                key_findings_documents,
                indent=2,
                default=str
            ) if key_findings_documents else "No document findings available."

            # ---------------------------------------------------------
            # 3️⃣ FETCH LATEST PROGNOSIS DATA
            # ---------------------------------------------------------

            prognosis_doc = await prognosis_data_collection.find_one(
                {"patient_id": patient_id},
                sort=[("created_at", -1)]
            )

            prognosis_text = ""

            if prognosis_doc:
                final_output = prognosis_doc.get("prognosis_data", {}).get("finaloutput", {})
                prognosis_section = final_output.get("prognosis_analysis", {})
                if prognosis_section:
                    prognosis_text = json.dumps(
                        prognosis_section,
                        indent=2,
                        default=str
                    )

            if not prognosis_text:
                prognosis_text = "No documented prognosis available."

            # ---------------------------------------------------------
            # 4️⃣ FETCH LATEST TREATMENT PLAN
            # ---------------------------------------------------------

            treatment_plan_doc = await documentation_treatment_plan_collection.find_one(
                {"patient_id": patient_id},
                sort=[("created_at", -1)]
            )

            treatment_plan_text = json.dumps(
                treatment_plan_doc.get("finaloutput", {}),
                indent=2,
                default=str
            ) if treatment_plan_doc else "No documented treatment plan available."

            # ---------------------------------------------------------
            # 5️⃣ DICTATION / AGENTIC / TEMP DATA
            # ---------------------------------------------------------

            dictation_text = dictation if dictation else (
                dictation_doc.get("dictation") if dictation_doc else "No dictation provided."
            )

            agentic_json = json.dumps(
                agentic_output,
                indent=2,
                default=str
            ) if agentic_output else "No agentic data provided."

            temp_data_text = json.dumps(
                temp_data,
                indent=2,
                default=str
            ) if temp_data else "No cached data available."

            # ---------------------------------------------------------
            # 6️⃣ BUILD PRODUCTION-GRADE PROMPT
            # ---------------------------------------------------------

            prompt = f"""

        You are a HOSPITAL-GRADE CLINICAL SUMMARY GENERATION ENGINE.

        This system operates inside a regulated EHR environment.

        Doctor authority is ABSOLUTE.

        This clinical summary is a structured medical document.
        It must reflect documented data only.
        It must be safe for medico-legal and audit review.

        ════════════════════════════════════
        CLINICAL GOVERNANCE RULES (NON-NEGOTIABLE)
        ════════════════════════════════════

        You MUST:

        1. Use ONLY documented input provided below.
        2. NOT invent diagnoses.
        3. NOT combine separate diagnoses into new composite phrases.
        4. NOT infer new clinical relationships.
        5. NOT generate new follow-up advice.
        6. NOT interpret lab values (no abnormality commentary).
        7. NOT assign severity unless explicitly documented.
        8. NOT synthesize prognosis beyond documented structured fields.
        9. NOT create causal linkage between unrelated data.
        10. If information is missing → return "" or [] exactly.

        If inconsistency is detected:
        → Do NOT reconcile.
        → Do NOT attempt correction.
        → Preserve documented fields independently.

        ════════════════════════════════════
        AUTHORITATIVE INPUT (USE ONLY THESE)
        ════════════════════════════════════

        Chief Complaint:
        {chief_complaint if chief_complaint else "Not documented."}

        Key Findings (Raw Processed Document Data):
        {key_findings_text}

        Prognosis Data:
        {prognosis_text}

        Treatment Plan:
        {treatment_plan_text}

        ════════════════════════════════════
        MANDATORY EXTRACTION LOGIC
        ════════════════════════════════════

        DIAGNOSES:

        - Extract ONLY diagnoses explicitly documented in:
        • Treatment Plan
        • Prognosis Data
        - Diagnosis text must match documented wording.
        - Do NOT rephrase.
        - Do NOT merge.
        - If none documented → return [].

        KEY FINDINGS:

        - Extract tests strictly from provided document data.
        KEY FINDINGS PRESENTATION RULE:

        - Summarize extracted tests into a concise clinical paragraph.
        - Group related laboratory parameters logically (e.g., CBC, differential count).
        - Preserve documented numeric values.
        - Do NOT interpret results.
        - Do NOT comment on abnormality.
        - Do NOT repeat duplicated entries.
        - Do NOT omit documented parameters.
        - Maintain formal clinical tone.


        - Do NOT fabricate missing values.
        - Do NOT normalize units.
        - Do NOT mark abnormal.
        - Do NOT add flags.
        - Do NOT interpret.

        TEST TYPE CLASSIFICATION RULE:

        You MAY classify each test into:

        - "laboratory"
        - "imaging"
        - "functional"
        - "other"

        Classification MUST be based strictly on test_name wording.

        Examples:
        - CBC, Hemoglobin, TLC, Platelets → laboratory
        - X-ray, CT, MRI, Ultrasound, Echocardiogram → imaging
        - ECG, Stress Test → functional

        If uncertain → classify as "other".

        Do NOT guess modality beyond the literal test name.

        PROGNOSIS:

        - Extract ONLY documented structured fields:
        • prognosis_category
        • severity (if explicitly present)
        • trend_direction (if explicitly present)

        - Return as structured object.
        - Do NOT compress into a narrative sentence.
        - Do NOT add risk interpretation.
        - If prognosis not documented → return:
        {{
            "category": "",
            "severity": "",
            "trend_direction": ""
        }}

        TREATMENT PLAN SUMMARY:

        - Include ALL documented treatment components:
        • Pharmacologic
        • Non-pharmacologic
        • Monitoring measures
        - Preserve documented wording.
        - Do NOT omit documented components.
        - Do NOT optimize phrasing.
        - Do NOT add additional therapy.

        FOLLOW-UP PLAN:

        - Extract ONLY if explicitly documented in Treatment Plan.
        - The follow-up statement must appear clearly and explicitly.
        - Generic statements like "regular follow-up" are FORBIDDEN unless explicitly written.
        - If no explicit follow-up exists → return "".

        ════════════════════════════════════
        FINAL VALIDATION BEFORE OUTPUT
        ════════════════════════════════════

        Before returning JSON, internally verify:

        ✔ Diagnoses are traceable to documented sources.
        ✔ No composite diagnosis was created.
        ✔ Key findings exist only if document data exists.
        ✔ No lab interpretation was added.
        ✔ Prognosis structure matches required schema.
        ✔ No follow-up was invented.
        ✔ No field contains null (use "" or [] only).

        If validation fails → regenerate correctly.

        ════════════════════════════════════
        OUTPUT STRUCTURE (STRICT JSON ONLY)
        ════════════════════════════════════

        Return ONLY valid JSON:

        {{
        "clinical_summary": {{
            "chief_complaint": "",
            "diagnoses": [],
            "key_findings_summary": "",
            "prognosis": {{
            "category": "",
            "severity": "",
            "trend_direction": ""
            }},
            "treatment_plan_summary": "",
            "follow_up_plan": ""
        }}
        }}

        STRICT OUTPUT RULES:

        - JSON only
        - No commentary
        - No additional keys
        - No explanation
        - No interpretation
        - No null values
        - If no findings → return []
        - If no diagnoses → return []
        - If no follow-up → return ""

        BEGIN GENERATION.
        """


        elif feature_id == "documentation-treatment-summary" and empty_output_json:
            prompt = f"""
You are a STRICT CLINICAL TREATMENT SUMMARY ASSISTANT.


This task is a FALLBACK MODE where NO structured output_json
is available.


Your responsibility is to generate a concise and accurate
TREATMENT SUMMARY using ONLY doctor-authored dictation
and documented clinical data.


════════════════════════════════════
AUTHORITATIVE INPUT HIERARCHY (STRICT)
════════════════════════════════════


1️⃣ DOCTOR-AUTHORED RULES (HIGHEST PRIORITY)


These rules ABSOLUTELY control:
- what may be summarized
- what must be excluded
- how information may be written or displayed


Rules:
{rules if rules else "No explicit rules provided by the doctor."}


MANDATORY ENFORCEMENT:
- Interpret rules BEFORE generating any summary
- Apply rules to EVERY sentence
- If rules restrict a domain → OMIT it entirely
- NEVER override, soften, or reinterpret a rule
- NEVER compensate for missing information


════════════════════════════════════
FEATURE CONTEXT
════════════════════════════════════


Feature Name: {feature_name}
Display Method: {display_method}


This defines presentation depth ONLY.
It does NOT allow content expansion.


════════════════════════════════════
PATIENT CLINICAL DATA (REFERENCE ONLY)
════════════════════════════════════


This data provides BACKGROUND CONTEXT only.
It must NOT introduce new treatment decisions.


{json.dumps(clinical_data, indent=2, default=str)}


════════════════════════════════════
DOCTOR DICTATION (PRIMARY SOURCE)
════════════════════════════════════


This is the DOCTOR’S narrative description of care.
It is the ONLY source of treatment intent.


{dictation if dictation else "No dictation provided."}


════════════════════════════════════
OUTPUT CATEGORIES (STRICT)
════════════════════════════════════


You MUST generate content ONLY under these categories.
You MUST NOT create any new categories.


{json.dumps(output_categories, indent=2)}


════════════════════════════════════
SUMMARY GENERATION RULES (ABSOLUTE)
════════════════════════════════════


✔ The treatment summary MUST be derived ONLY from:
  - Doctor dictation
  - Documented clinical data
✔ Do NOT infer, add, optimize, or restructure treatment
✔ Preserve doctor’s original intent and wording as much as possible
✔ Use clear, neutral, clinical language


MEDICATION HANDLING (STRICT):
✔ Extract medication details ONLY if explicitly mentioned
  in the dictation
✔ Do NOT assume dose, frequency, route, or duration
✔ If medication information is incomplete → summarize
  ONLY what is stated


════════════════════════════════════
CATEGORY-SPECIFIC BEHAVIOR
════════════════════════════════════


For EACH output category:
- Summarize ONLY relevant information
- If multiple items exist → list them clearly
- If no information exists → OMIT the category
- Do NOT repeat the same content across categories


════════════════════════════════════
STRICT PROHIBITIONS
════════════════════════════════════


⛔ No new diagnoses
⛔ No inferred severity or prognosis
⛔ No clinical recommendations
⛔ No guideline references
⛔ No assumptions beyond dictation and data
⛔ No JSON output
⛔ No additional headings or commentary


════════════════════════════════════
OUTPUT FORMAT (STRICT – NOT JSON)
════════════════════════════════════


Return output using ONLY the provided output categories
as section headings.


Rules:
- Each category must contain concise bullet points
- Omit categories with no valid content
- Do NOT add any text before or after the summary


BEGIN TREATMENT SUMMARY GENERATION.
"""
        

        
        else:
            raise HTTPException(400, f"Unsupported feature_id: {feature_id}")


        # ---------------------------------------------------------
        # 4️⃣ LLM EXECUTION
        # ---------------------------------------------------------
        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            frequency_penalty=0,
            presence_penalty=0,
            response_format={"type": "json_object"},
            max_tokens=4500
        )


        llm_output = json.loads(completion.choices[0].message.content)
        logger.info("LLM Output: %s", llm_output)
        
        def validate_medication_schema(output):
            if "prescriptions" not in output:
                return False
            for med in output["prescriptions"]:
                if not med.get("brand_name"):
                    return False
                if not med.get("dosage_instructions"):
                    return False
            return True




        # ---------------------------------------------------------
        # 5️⃣ FINAL RESPONSE
        # ---------------------------------------------------------
        return {
            "status": "success",
            "feature_id": feature_id,
            "feature_name": feature_name,
            "display_method": display_method,
            "finaloutput": llm_output,
            "metadata": {
                "doctor_id": doctor_id,
                "patient_id": patient_id,
                
            }
        }


    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Clinical feature processing failed")
        raise HTTPException(
            status_code=500,
            detail=f"Clinical feature processing error: {str(e)}"
        )

######################################################################################################################################################################################################


#28-01-2026#Aleena

@router.post("/clinical-procedure-workflow")
async def clinical_procedure_workflow(request: Request):
    try:
        payload = await request.json()

        doctor_id = payload.get("doctor_id")
        patient_id = payload.get("patient_id")
        selected_procedure = payload.get("selected_procedure")  # optional
        mode = payload.get("mode", "order")  # 👈 ADD HERE


        if not doctor_id or not patient_id:
            raise HTTPException(status_code=400, detail="doctor_id and patient_id required")

        if mode not in ["order", "report"]:
            raise HTTPException(status_code=400, detail="Invalid mode")

        care_mode_label = "PROCEDURE ORDERING MODE" if mode == "order" else "PROCEDURE REPORTING MODE"

        # ---------------- DOCTOR SPECIALIZATION ----------------
        doctor_doc = doctor_user_collection.find_one(
            {"sys_user_id": doctor_id},
            {"_id": 0, "specialization": 1}
        )

        if not doctor_doc:
            raise HTTPException(status_code=404, detail="Doctor not found")

        specialization = doctor_doc.get("specialization")

        # ---------------- CLINICAL DATA ----------------
        clinical_data = {}

        # medical context
        doc = await medical_context_collection.find_one(
            {"patient_id": patient_id}, {"_id": 0}
        )

        medical_context = []
        if doc:
            for ctx in doc.get("medical_contexts", []):
                if ctx.get("enabled"):
                    texts = [c.get("text") for c in ctx.get("conditions", []) if c.get("text")]
                    if texts:
                        medical_context.append({
                            "date": ctx.get("date"),
                            "conditions": texts
                        })

        if medical_context:
            clinical_data["medical_context"] = medical_context

        # current context
        doc = await current_context_collection.find_one(
            {"patient_id": patient_id}, {"_id": 0}
        )

        current_context = []
        if doc:
            for ctx in doc.get("current_contexts", []):
                if ctx.get("enabled"):
                    texts = [
                        c.get("text")
                        for c in ctx.get("current_condition", [])
                        if c.get("text")
                    ]
                    if texts:
                        current_context.append({
                            "date": ctx.get("date"),
                            "current_condition": texts
                        })

        if current_context:
            clinical_data["current_context"] = current_context

        procedure_history = []

        if selected_procedure:
            past_procedures = await procedure_notes_collection.find(
                {
                    "patient_id": patient_id,
                    "selected_procedure": selected_procedure
                },
                {
                    "_id": 0,
                    "selected_procedure": 1,
                    "mode": 1,
                    "created_at": 1,
                    "pre_procedure": 1,
                    "during_procedure": 1,
                    "post_procedure": 1,
                    "patient_abstract": 1
                }
            ).sort("created_at", 1).to_list(length=10)

            for note in past_procedures:
                procedure_history.append({
                    "date": note.get("created_at"),
                    "mode": note.get("mode"),
                    "summary": {
                        "pre": note.get("pre_procedure"),
                        "during": note.get("during_procedure"),
                        "post": note.get("post_procedure")
                    }
                })

        if procedure_history:
            clinical_data["procedure_history"] = procedure_history

        logger.info("clinical_data=%s", json.dumps(clinical_data, indent=2, default=str))

        last_order = None

        if mode == "report":
            last_order = await procedure_notes_collection.find_one(
                {
                    "patient_id": patient_id,
                    "selected_procedure": selected_procedure,
                    "mode": "order"
                },
                sort=[("created_at", -1)],
                projection={"_id": 0}
            )

            if not last_order:
                raise HTTPException(
                    status_code=400,
                    detail="No prior order found for this procedure"
                )

     
        # ---------------- REPORT MODE PROMPT BLOCK ----------------
        report_mode_block = ""

        if mode == "report":
            report_mode_block = f"""
        AUTHORITATIVE ORDER DATA (DO NOT MODIFY OR EXPAND):
        {json.dumps(last_order, indent=2, default=str)}

        REPORT MODE = EXECUTION AUDIT (STRICT)

        RULES:
        - EVERY bullet MUST map to an item present in the ORDER
        - DO NOT invent consent, exams, education, monitoring, follow-ups
        - If an ORDERED item was:
        • done → list under completed
        • partially done → state partially completed
        • not done → explicitly state not completed
        - If no issues occurred, explicitly say "No risks identified" or "No complications observed"
        - Use ONLY past-tense or neutral execution language

        MANDATORY FIELD MAPPING:

        PRE-PROCEDURE:
        - recommendations → ORDER.pre_procedure.recommendations FOLLOWED
        - tasks_completed → ORDER.pre_procedure.tasks_to_be_completed DONE
        - risks_or_gaps_found → risks ACTUALLY FOUND or "None identified"

        DURING-PROCEDURE:
        - recommendations → ORDER.during_procedure.standard_recommendations FOLLOWED
        - monitored_or_completed_tasks → ORDER.during_procedure.monitoring_tasks EXECUTED
        - complications_found → complications that OCCURRED or "None observed"
        - modifications_done → ORDER.during_procedure.suggested_modifications_if_issues_arise APPLIED or "Not required"

        POST-PROCEDURE:
        - recommendations → ORDER.post_procedure.recovery_recommendations FOLLOWED
        - pending_tasks_completed → ORDER.post_procedure.pending_tasks COMPLETED
        - handover_details → actual handover done or "No handover required"
        - documentation_points → documentation ACTUALLY completed

        DO NOT ADD NEW CONTENT.
        DO NOT REPHRASE ORDER INTO FUTURE TENSE.
        """

        if mode == "order":
            output_schema = """
        {
        "procedure": "{{selected_procedure}}",
        "mode": "order",
        "pre_procedure": {
            "recommendations": [],
            "tasks_to_be_completed": [],
            "anticipated_risks_or_gaps": []
        },
        "during_procedure": {
            "standard_recommendations": [],
            "monitoring_tasks": [],
            "possible_complications": [],
            "suggested_modifications_if_issues_arise": []
        },
        "post_procedure": {
            "recovery_recommendations": [],
            "pending_tasks": [],
            "handover_details": [],
            "documentation_or_reporting_points": []
        }
        }
        """
        else:
            output_schema = """
        {
        "procedure": "{{selected_procedure}}",
        "mode": "report",
        "pre_procedure": {
            "recommendations": [],
            "tasks_completed": [],
            "risks_or_gaps_found": []
        },
        "during_procedure": {
            "recommendations": [],
            "monitored_or_completed_tasks": [],
            "complications_found": [],
            "modifications_done": []
        },
        "post_procedure": {
            "recommendations": [],
            "pending_tasks_completed": [],
            "handover_details": [],
            "documentation_points": []
        }
        }
        """



        # ---------------- LLM PROMPT ----------------
        if not selected_procedure:
            # PHASE 1: Suggest procedures + patient abstract
            prompt = f"""
You are a HIGH-RELIABILITY CLINICAL WORKFLOW RECOMMENDATION ENGINE.

Your role is NOT to diagnose or treat.
Your role is to ANALYZE provided clinical text and suggest
RELEVANT PROCEDURAL WORKFLOWS commonly used by doctors
of the given specialization.

════════════════════════════════════
INPUT CONTEXT (AUTHORITATIVE)
════════════════════════════════════
Doctor Specialization:
{specialization}

Patient Clinical Data (verbatim, no interpretation allowed):
{json.dumps(clinical_data, indent=2, default=str)}


Historical Procedure Context (if any):
{json.dumps(clinical_data.get("procedure_history", []), indent=2)}

If prior procedures exist:
• Mention completed cycles or sessions
• Avoid repeating completed steps
• Maintain continuity of care

════════════════════════════════════
TASK 1: PROCEDURE SUGGESTION
════════════════════════════════════
• Suggest ONLY procedures that:
  - Are routinely performed within the given specialization
  - Are logically relevant to the patient’s documented conditions
• Procedures must be HIGH-LEVEL workflows, NOT medications or tests

Examples:
- Nephrology → Hemodialysis, Peritoneal Dialysis
- Oncology → Chemotherapy, Radiation Therapy
- Cardiology → Coronary Angiography, Pacemaker Implantation

For EACH procedure:
• Name must be concise and frontend-selectable
• Reason must explicitly reference provided clinical text
• Do NOT assume disease severity or diagnosis

════════════════════════════════════
TASK 2: PATIENT ABSTRACT
════════════════════════════════════
Generate a SHORT, CLINICAL ABSTRACT that:
• Summarizes the patient’s condition in 3–5 sentences
• Uses neutral, professional medical language
• Is specialty-aware but diagnosis-agnostic
• STRICTLY reflects provided clinical data only

════════════════════════════════════
CRITICAL SAFETY RULES (NON-NEGOTIABLE)
════════════════════════════════════
⛔ DO NOT invent diagnoses, stages, or lab values
⛔ DO NOT recommend emergency or rare procedures unless explicitly supported
⛔ DO NOT include treatment plans or medications
⛔ DO NOT include explanations outside JSON

════════════════════════════════════
OUTPUT FORMAT (JSON ONLY — EXACT STRUCTURE)
════════════════════════════════════
{{
  "suggested_procedures": [
    {{
      "name": "<procedure_name>",
      "reason": "<clear, data-linked justification>"
    }}
  ],
  "patient_abstract": "<concise clinical summary>"
}}
"""


        else:
            # PHASE 2: Pre / During / Post
            prompt = f"""
You are a HIGH-RELIABILITY, SPECIALTY-AWARE PROCEDURAL CARE ASSISTANT.

You are assisting a licensed doctor in:
{care_mode_label}

Your role is to SUPPORT clinical workflow documentation.
You DO NOT diagnose, interpret results, or prescribe medications.

════════════════════════════════════
AUTHORITATIVE INPUT CONTEXT
════════════════════════════════════
Doctor Specialization:
{specialization}

Selected Procedure:
{selected_procedure}

Patient Clinical Data (verbatim, no inference):
{json.dumps(clinical_data, indent=2, default=str)}



{report_mode_block}

════════════════════════════════════
TASK OBJECTIVE
════════════════════════════════════
Generate CLINICALLY STANDARD procedural content
organized into THREE PHASES of care.

The OUTPUT MUST strictly align with the active MODE.

════════════════════════════════════
MODE DEFINITIONS (STRICT – DO NOT MIX)
════════════════════════════════════

🟦 ORDERING MODE (Planning / Orders):
• Use ACTION-ORIENTED, FUTURE-FOCUSED language
• Describe what should be arranged, prepared, verified, or ordered
• Suitable for clinical order placement workflows
• NO assumptions that the procedure has already occurred

🟩 REPORTING MODE (Documentation / Report):
• Use DOCUMENTATION-ORIENTED, NEUTRAL or PAST-TENSE language
• Describe ONLY what was actually done or observed
• Treat each subsection as an EXECUTION STATUS section
• Do NOT assume planned items were completed unless stated
• NO future planning or speculative language




════════════════════════════════════
Use historical procedure data (if provided) to:
• Avoid repeating completed steps
• Adjust recommendations for next cycle or visit
• Highlight pending or incomplete items
Use the previously ordered plan as the structural reference.
For each phase:
• Convert planned items into reported outcomes
• Allow omission if not completed
• Allow completion notes
════════════════════════════════════

════════════════════════════════════
CARE PHASE STRUCTURE
════════════════════════════════════

1. PRE-PROCEDURE CARE
   • Patient readiness or preparation
   • Risk or safety considerations
   • Verification or evaluation steps

2. DURING-PROCEDURE CARE
   • Monitoring and safety checks
   • Procedural conduct considerations
   • Intra-procedural observations (non-diagnostic)

3. POST-PROCEDURE CARE
   • Immediate post-procedure monitoring
   • Recovery or observation considerations
   • Common, non-specific issues to watch for

════════════════════════════════════
OUTPUT QUALITY REQUIREMENTS
════════════════════════════════════
• Bullet points ONLY
• One clear concept per bullet
• Clinically realistic but non-diagnostic
• Specialty-relevant steps only
• No medications, dosages, or lab values
• No fabricated findings
• No assumptions beyond provided data

════════════════════════════════════
STRICT SAFETY CONSTRAINTS
════════════════════════════════════
⛔ NO diagnosis inference
⛔ NO staging or severity assumptions
⛔ NO lab value creation
⛔ NO emergency scenarios unless explicitly stated
⛔ NO narrative text outside JSON

OUTPUT FORMAT (JSON ONLY — EXACT STRUCTURE)

{output_schema}

For EACH phase:
• Populate ALL sub-headings if clinically applicable
• Do not leave arrays empty unless no relevant content exists

"""

        # ---------------------------------------------------------
        # 4️⃣ LLM EXECUTION (GROQ)
        # ---------------------------------------------------------
        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            response_format={"type": "json_object"},
            max_tokens=3500
        )

        llm_output = json.loads(completion.choices[0].message.content)
        logger.info("LLM Output: %s", json.dumps(llm_output, indent=2))

        # ---------------------------------------------------------
        # 5️⃣ FINAL RESPONSE
        # ---------------------------------------------------------
        return {
            "status": "success",
            "finaloutput": llm_output,
            "metadata": {
                "doctor_id": doctor_id,
                "patient_id": patient_id,
                "specialization": specialization,
                "selected_procedure": selected_procedure
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Clinical procedure workflow failed")
        raise HTTPException(
            status_code=500,
            detail=f"Clinical procedure workflow error: {str(e)}"
        )




# @router.post("/save-procedure-notes")
# async def save_procedure_notes(request: Request):
#     try:
#         payload = await request.json()

#         # -------------------- REQUIRED FIELDS --------------------
#         doctor_id = payload.get("doctor_id")
#         patient_id = payload.get("patient_id")
#         selected_procedure = payload.get("selected_procedure")
#         mode = payload.get("mode")

#         if not doctor_id or not patient_id or not selected_procedure or not mode:
#             raise HTTPException(
#                 status_code=400,
#                 detail="doctor_id, patient_id, selected_procedure, and mode are required"
#             )

#         # 🔥 create timestamp once (backend controlled)
#         created_at = datetime.utcnow()

#         # -------------------- DOCUMENT STRUCTURE --------------------
#         document = {
#             "doctor_id": doctor_id,
#             "patient_id": patient_id,
#             "mode": mode,
#             "selected_procedure": selected_procedure,
#             "patient_abstract": payload.get("patient_abstract", ""),
#             "pre_procedure": payload.get("pre_procedure", ""),
#             "during_procedure": payload.get("during_procedure", ""),
#             "post_procedure": payload.get("post_procedure", ""),
#             "alerts_and_important": payload.get("alerts_and_important", {}),
#             "treatment_procedure": payload.get("treatment_procedure", {}),
#             "updated_at": created_at
#         }

#         # -------------------- UPSERT LOGIC --------------------
#         result = await procedure_notes_collection.update_one(
#             {
#                 "doctor_id": doctor_id,
#                 "patient_id": patient_id,
#                 "selected_procedure": selected_procedure,
#                 "mode": mode
#             },
#             {
#                 "$set": document,
#                 "$setOnInsert": {
#                     "created_at": created_at
#                 }
#             },
#             upsert=True
#         )

        
#         # =======================================================
#         # 🔥 TEMP SAVE PROCEDURE NOTE TRIGGER
#         # =======================================================
#         temp_payload = {
#             "patient_id": patient_id,
#             "doctor_id": doctor_id,
#             "procedure_note": [
#                 {
#                     "selected_procedure": selected_procedure,
#                     "mode": mode,
#                     "patient_abstract": payload.get("patient_abstract", ""),
#                     "pre_procedure": payload.get("pre_procedure", ""),
#                     "during_procedure": payload.get("during_procedure", ""),
#                     "post_procedure": payload.get("post_procedure", "")
#                 }
#             ]
#         }

#         logger.info(f"📡 Triggering temp save for procedure note | {temp_payload}")

#         try:
#             async with httpx.AsyncClient(timeout=30) as client:
#                 temp_response = await client.post(
#                     f"{api_base_url}hms/users/data/context/general/temp/save",
#                     json=temp_payload,
#                     timeout=30
#                 )

#             if temp_response.status_code != 200:
#                 logger.error(
#                     "Temp procedure note save failed",
#                     extra={
#                         "status_code": temp_response.status_code,
#                         "response": temp_response.text
#                     }
#                 )

#         except Exception as e:
#             logger.error(f"Temp procedure note save failed: {str(e)}")
            
#         # ==========================================================
#         # 🚀 TRIGGER MONGO PROCESSING VIA CELERY (NEW)
#         # ==========================================================
#         try:
#             from users.celery_client import celery_app

#             celery_app.send_task(
#                 "legacy_lab_ai.process_mongo_batch",
#                 kwargs={
#                     "patient_id": patient_id,
#                     "doctor_id": doctor_id
#                 },
#                 queue="agentic_queue",
#                 routing_key="agentic",
#                 exchange="agentic"
#             )

#             logger.info(
#                 f"🚀 Mongo processing triggered via Celery | patient={patient_id}"
#             )

#         except Exception as e:
#             logger.error(f"❌ Mongo Celery trigger failed: {str(e)}")
#         return {
#             "status": "success",
#             "message": "Procedure notes saved successfully",
#             "upserted": bool(result.upserted_id)
#         }

#     except HTTPException:
#         raise
#     except Exception as e:
#         print("SAVE PROCEDURE NOTES ERROR:", e)
#         raise HTTPException(
#             status_code=500,
#             detail="Failed to save procedure notes"
#         )


# @router.get("/get-procedure-notes/{doctor_id}/{patient_id}")
# async def get_procedure_notes(doctor_id: str, patient_id: str):
#     """
#     Retrieve all procedure notes for a given doctor and patient
#     """

#     cursor = procedure_notes_collection.find(
#         {
#             "doctor_id": doctor_id,
#             "patient_id": patient_id
#         },
#         {"_id": 0}  # exclude MongoDB _id
#     )

#     notes = await cursor.to_list(length=None)

#     if not notes:
#         raise HTTPException(
#             status_code=404,
#             detail=f"No procedure notes found for doctor_id={doctor_id} and patient_id={patient_id}"
#         )

#     response_data = {
#         "status": "success",
#         "doctor_id": doctor_id,
#         "patient_id": patient_id,
#         "count": len(notes),
#         "procedure_notes": notes
#     }

#     return JSONResponse(
#         status_code=200,
#         content=jsonable_encoder(response_data)
#     )


@router.post("/save-procedure-notes")
async def save_procedure_notes(request: Request):
    try:
        payload = await request.json()

        # Required fields
        doctor_id = payload.get("doctor_id")
        patient_id = payload.get("patient_id")
        selected_procedure = payload.get("selected_procedure")
        mode = payload.get("mode")

        if not doctor_id or not patient_id or not selected_procedure or not mode:
            raise HTTPException(
                status_code=400,
                detail="doctor_id, patient_id, selected_procedure, and mode are required"
            )

        created_at = datetime.utcnow()

        # Complete document structure
        document = {
            "doctor_id": doctor_id,
            "patient_id": patient_id,
            "mode": mode,
            "selected_procedure": selected_procedure,
            "patient_abstract": payload.get("patient_abstract", ""),
            "pre_procedure": payload.get("pre_procedure", ""),
            "during_procedure": payload.get("during_procedure", ""),
            "post_procedure": payload.get("post_procedure", ""),
            "alerts_and_important": payload.get("alerts_and_important", {}),
            "treatment_procedure": payload.get("treatment_procedure", {}),
            "chemo_engine_data": payload.get("chemo_engine_data", {}),
            "patient_summary": payload.get("patient_summary", ""),
            "tumor_board": payload.get("tumor_board", ""),
            "updated_at": created_at
        }

        # Debug: Log what we're saving
        print(f"Saving document with keys: {list(document.keys())}")
        print(f"patient_summary length: {len(document.get('patient_summary', ''))}")
        print(f"tumor_board length: {len(document.get('tumor_board', ''))}")

        # UPDATE: Use $set to update ALL fields, including new ones
        result = await procedure_notes_collection.update_one(
            {
                "doctor_id": doctor_id,
                "patient_id": patient_id,
                "selected_procedure": selected_procedure,
                "mode": mode
            },
            {
                "$set": document,
                "$setOnInsert": {
                    "created_at": created_at
                }
            },
            upsert=True
        )

        # Verify the update worked
        updated_doc = await procedure_notes_collection.find_one(
            {
                "doctor_id": doctor_id,
                "patient_id": patient_id,
                "selected_procedure": selected_procedure,
                "mode": mode
            }
        )
        print(f"After update - document keys: {list(updated_doc.keys()) if updated_doc else 'Not found'}")
        print(f"Has patient_summary: {'patient_summary' in updated_doc if updated_doc else False}")
        print(f"Has tumor_board: {'tumor_board' in updated_doc if updated_doc else False}")

        # Rest of your existing code...
        # Temp save and Celery trigger...

        return {
            "status": "success",
            "message": "Procedure notes saved successfully",
            "upserted": bool(result.upserted_id)
        }

    except HTTPException:
        raise
    except Exception as e:
        print("SAVE PROCEDURE NOTES ERROR:", e)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save procedure notes: {str(e)}"
        )

@router.get("/get-procedure-notes/{doctor_id}/{patient_id}")
async def get_procedure_notes(doctor_id: str, patient_id: str):
    cursor = procedure_notes_collection.find(
        {"doctor_id": doctor_id, "patient_id": patient_id},
        {"_id": 0}
    )
    notes = await cursor.to_list(length=None)
    
    # Debug: Check what fields are in the first note
    if notes and len(notes) > 0:
        print(f"First note keys: {list(notes[0].keys())}")
        print(f"Has patient_summary: {'patient_summary' in notes[0]}")
        print(f"Has tumor_board: {'tumor_board' in notes[0]}")
    
    if not notes:
        raise HTTPException(
            status_code=404,
            detail=f"No procedure notes found for doctor_id={doctor_id} and patient_id={patient_id}"
        )

    response_data = {
        "status": "success",
        "doctor_id": doctor_id,
        "patient_id": patient_id,
        "count": len(notes),
        "procedure_notes": notes
    }

    return JSONResponse(
        status_code=200,
        content=jsonable_encoder(response_data)
    )

@router.post("/clinical-investigation-form-workflow")
async def clinical_investigation_form_workflow(request: Request):
    try:
        payload = await request.json()

        doctor_id = payload.get("doctor_id")
        patient_id = payload.get("patient_id")
        investigation = payload.get("investigation")

        if not doctor_id or not patient_id:
            raise HTTPException(
                status_code=400,
                detail="doctor_id and patient_id required"
            )

        if not investigation or not isinstance(investigation, dict):
            raise HTTPException(
                status_code=400,
                detail="investigation payload is required from frontend"
            )

        doctor_doc = doctor_user_collection.find_one(
            {"sys_user_id": doctor_id},
            {"_id": 0, "specialization": 1}
        )

        if not doctor_doc:
            raise HTTPException(status_code=404, detail="Doctor not found")

        specialization = doctor_doc.get("specialization")

        clinical_data = {}

        doc = await medical_context_collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0}
        )

        medical_context = []
        if doc:
            for ctx in doc.get("medical_contexts", []):
                if ctx.get("enabled"):
                    texts = [
                        c.get("text")
                        for c in ctx.get("conditions", [])
                        if c.get("text")
                    ]
                    if texts:
                        medical_context.append({
                            "date": ctx.get("date"),
                            "conditions": texts
                        })

        if medical_context:
            clinical_data["medical_context"] = medical_context

        doc = await current_context_collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0}
        )

        current_context = []
        if doc:
            for ctx in doc.get("current_contexts", []):
                if ctx.get("enabled"):
                    texts = [
                        c.get("text")
                        for c in ctx.get("current_condition", [])
                        if c.get("text")
                    ]
                    if texts:
                        current_context.append({
                            "date": ctx.get("date"),
                            "current_condition": texts
                        })

        if current_context:
            clinical_data["current_context"] = current_context

        logger.info(
            "clinical_form_context=%s",
            json.dumps(clinical_data, indent=2, default=str)
        )

        logger.info(
            "investigation_from_frontend=%s",
            json.dumps(investigation, indent=2)
        )

        prompt = f"""
You are a PHYSICIAN ORDER ENTRY ASSISTANT.

Generate a doctor-facing investigation order form inside an electronic medical record (EMR).

This system is strictly for physicians — NOT laboratories or technicians.

Only generate decisions that physicians realistically make when ordering an investigation.

Never include operational or diagnostic workflow details.

════════════════════════════════════
AUTHORITATIVE INPUT
════════════════════════════════════

Doctor Specialization: {specialization}

Investigation: {investigation.get("investigation_type")}
Clinical Intent: {investigation.get("intent")}

Patient Clinical Data:
{json.dumps(clinical_data, indent=2)}

Never fabricate clinical facts.
Never assume diagnoses unless clearly supported.

════════════════════════════════════
🚨 INVESTIGATION ADAPTATION DIRECTIVE (CRITICAL)
════════════════════════════════════

Treat EVERY investigation as structurally unique.

Do NOT reuse field structures from other investigations.

Do NOT assume this is a laboratory test.
Do NOT assume this is imaging.
Do NOT assume physiological testing.

FIRST internally determine the investigation modality, then generate fields that are native to that modality.

Fields must feel natural for the investigation being ordered.

════════════════════════════════════
🚨 INVESTIGATION-FIRST REASONING
════════════════════════════════════

Before generating fields, internally determine:

• What clinical domain does this investigation belong to?
• What factors influence interpretation?
• What decisions must a physician make?

Only after this reasoning should fields be generated.

Do NOT rely on template memory.

════════════════════════════════════
🚨 ABSOLUTE DECISION FILTER
════════════════════════════════════

Before creating ANY field, ask:

"Is this a decision MOST physicians make when ordering THIS investigation?"

If NO → DO NOT CREATE IT.

Favor HIGH-PROBABILITY outpatient physician behavior.

Avoid rare, protocol-driven, ICU, transplant, chemotherapy, or specialist-only workflows unless strongly supported by patient data.

════════════════════════════════════
❌ STRICTLY FORBIDDEN
════════════════════════════════════

Never generate fields for:

• specimen handling  
• tubes or containers  
• centrifugation  
• transport conditions  
• analyzer settings  
• machine parameters  
• lab workflows  
• technician instructions  

If the diagnostic department can decide it independently → EXCLUDE it.

════════════════════════════════════
🔥 INTENT DOMINANCE RULE
════════════════════════════════════

Clinical intent MUST strongly shape the form.

Fields should clarify WHY the investigation is being ordered.

Avoid generic forms that could apply to any patient.

════════════════════════════════════
🔥 MODALITY-AWARE FIELD GENERATION
════════════════════════════════════

Generate fields based ONLY on factors that influence clinical interpretation.

Interpretation drivers may include:

• symptom context  
• anatomical focus  
• physiological state  
• comparison requirement  
• diagnostic question  
• risk factors  

If a field does NOT influence interpretation → exclude it.

════════════════════════════════════
🔥 DIAGNOSTIC PROXIMITY RULE
════════════════════════════════════

Suggested tests MUST belong to the SAME diagnostic pathway.

Avoid broad systemic panels unless clearly justified by clinical data.

Only suggest tests physicians naturally consider together.

════════════════════════════════════
🔥 PHYSICIAN SPEED PRIORITY
════════════════════════════════════

Design the form so a physician can complete it in under 10 seconds.

✔ Prefer structured selections  
✔ Minimize typing  
✔ Provide intelligent defaults  

Every field must justify its existence.

════════════════════════════════════
🔥 CLINICAL PROBABILITY GATE
════════════════════════════════════

Favor COMMON physician decisions.

Avoid low-frequency workflows unless explicitly supported by patient data.

When uncertain — choose the more common clinical behavior.

════════════════════════════════════
FIELD STRUCTURE (MANDATORY)
════════════════════════════════════

Each field MUST follow:

{{
  "field_id": "snake_case",
  "label": "2–5 word clinical heading",
  "type": "select | radio | checkbox_group | checkbox | textarea",
  "options": [],
  "suggested_value": null
}}

Headings must be short, clinical, and decision-oriented.

════════════════════════════════════
🚨 SMART DEFAULT RULE
════════════════════════════════════

Suggested_value MUST NEVER be empty.

When patient data is neutral:

Select the SAFEST and LEAST aggressive medically appropriate option.

Avoid over-monitoring defaults.

• select → safest common option  
• checkbox_group → []  
• checkbox → true/false  
• textarea → concise clinical context  

Never return empty strings.

════════════════════════════════════
🚨 DATA TYPE ENFORCEMENT
════════════════════════════════════

checkbox_group suggested_value MUST be a JSON array — NEVER a string.

checkbox MUST use boolean true/false.

════════════════════════════════════
🚨 TEXTAREA STRICT RULE
════════════════════════════════════

Use textarea ONLY when structured input is impossible.

Maximum TWO textarea fields across the entire form.

════════════════════════════════════
SECTION STRUCTURE — STRICT
════════════════════════════════════

Return EXACTLY three sections.

--------------------------------------------------
SECTION 1 — Test Suggestions
--------------------------------------------------

Generate EXACTLY ONE field.

Use ONE checkbox_group ONLY.

Provide 3–5 diagnostically relevant tests with brief rationale.

Avoid escalation testing.

--------------------------------------------------
SECTION 2 — Physician Order Fields (PRIMARY)
--------------------------------------------------

Generate 6–8 HIGH-VALUE physician decision fields.

Ask internally:

"Would most physicians expect this field during routine ordering?"

If not → remove it.

Support physician ORDERING — not execution.

Avoid scheduling-style fields unless strongly justified.

Prefer one-time evaluation defaults.

Never hallucinate preparation requirements.

If none exist, state:

"No special preparation required."

--------------------------------------------------
SECTION 3 — Additional Clinical Notes
--------------------------------------------------

Generate EXACTLY ONE textarea.

Provide concise execution-relevant clinical context.

Do NOT summarize the chart.
Do NOT repeat structured data.

════════════════════════════════════
FINAL VALIDATION
════════════════════════════════════

Before returning, verify:

✅ Investigation-specific structure  
✅ No template reuse  
✅ High-probability physician decisions  
✅ Exactly ONE suggestions field  
✅ No empty suggested_value  
✅ No technician content  
✅ No protocol leakage  
✅ Minimal physician effort  

If ANY rule fails → regenerate internally.

════════════════════════════════════
OUTPUT FORMAT — STRICT JSON
════════════════════════════════════

Return ONLY valid JSON.

No explanations.
No markdown.
No internal reasoning.

{{
  "sections": [
    {{
      "section_id": "test_suggestions",
      "title": "Optional Additional Tests",
      "fields": []
    }},
    {{
      "section_id": "order_documentation",
      "title": "Physician Order Fields",
      "fields": []
    }},
    {{
      "section_id": "additional_notes",
      "title": "Additional Clinical Notes",
      "fields": []
    }}
  ]
}}

NOW GENERATE THE DOCTOR-FACING ORDER FORM.
"""


        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.,
            response_format={"type": "json_object"},
            max_tokens=2500
        )

        llm_output = json.loads(
            completion.choices[0].message.content
        )

        logger.info(
            "clinical_investigation_form_llm_output=%s",
            json.dumps(llm_output, indent=2)
        )

        return {
            "status": "success",
            "finaloutput": llm_output,
            "metadata": {
                "doctor_id": doctor_id,
                "patient_id": patient_id,
                "specialization": specialization
            }
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.exception("Clinical investigation form workflow failed")
        raise HTTPException(
            status_code=500,
            detail=f"Clinical investigation form workflow error: {str(e)}"
        )
#Azfar ends



# ---------------- DOCUMENTATION FEATURES (COMBINED LATEST 5) ----------------


# ---------------- DOCUMENTATION FEATURES (COMBINED LATEST 5) ----------------

async def fetch_latest_documentation_features(patient_id: str, limit: int = 5):

    collections = [
        documentation_treatment_plan_collection,
        documentation_investigation_notes_collection,
        documentation_medication_analysis_collection,
        documentation_treatment_summary_collection,
        documentation_clinical_notes_collection,
    ]

    all_docs = []

    try:
        for collection in collections:

            cursor = collection.find(
                {"patient_id": patient_id},
                {
                    "_id": 0,
                    "finaloutput": 1,
                    
                }
            )

            async for doc in cursor:
                finaloutput = doc.get("finaloutput")
                if not finaloutput:
                    continue

                # ✅ SAFE access (no KeyError)
                
                all_docs.append({
                    
                    "data": finaloutput
                })

        # ✅ SAFE SORT (handles None timestamps)
        

        latest = all_docs[:limit]

        return [item["data"] for item in latest]

    except Exception:
        logger.exception("fetch_latest_documentation_features failed")
        return []
async def fetch_all_appointments_for_patient(patient_id: str):
    """
    Fetch all appointment data for a specific patient.

    Returns:
        List of all appointment data.
    """
    try:
        logger.info("Fetching all appointment data for patient_id: %s", patient_id)

        # Use motor's find to fetch all appointments for the given patient
        cursor = patient_appointments_collection.find(
            {"sys_user_id": patient_id},  # Query for the patient
            {"_id": 0, "appointments": 1}  # Only include the appointments field
        )

        # List to store all the appointments
        all_appointments = []

        # Use async for to iterate through the cursor asynchronously
        async for doc in cursor:
            logger.info("Found document for patient_id: %s", patient_id)
            for appt in doc.get("appointments", []):
                # Collect all appointment data (no filtering)
                all_appointments.append({
                    "appointment_id": appt.get("appointment_id"),
                    "doctor_id": appt.get("doctor_id"),
                    "date": appt.get("date"),
                    "scheduled_time": appt.get("scheduled_time"),
                    "visit_type": appt.get("visit_type"),
                    "chief_complaint": appt.get("chief_complaint"),
                    "notes": appt.get("notes"),
                    "created_at": appt.get("created_at")
                })

        # Check if any appointments were found
        if not all_appointments:
            logger.warning("No appointments found for patient_id: %s", patient_id)

        # Return all appointment data
        logger.info("Returning %d appointments for patient_id: %s", len(all_appointments), patient_id)
        return all_appointments

    except Exception as e:
        logger.exception("Failed to fetch appointments for patient_id %s: %s", patient_id, str(e))
        return []



#####ThomasAgenticcontext####

# @router.post("/process-feature-with-fetched-data1")
# async def process_feature_with_fetched_data(request: Request):
#     """
#     Second-stage Feature Processing with Dynamic Prompt Generation
#     """

#     try:
#         payload = await request.json()

#         doctor_id = payload.get("doctor_id")
#         patient_id = payload.get("patient_id")
#         feature_id = payload.get("feature_id")
#         dictation = payload.get("dictation")

#         if not doctor_id or not patient_id or not feature_id:
#             raise HTTPException(
#                 status_code=400,
#                 detail="doctor_id, patient_id, feature_id are required"
#             )

#         # ---------------------------------------------------------
#         # 1️⃣ FEATURE META (SIMPLIFIED)
#         # ---------------------------------------------------------
#         feature_name = feature_id
#         rules = None
#         output_categories = None
#         display_method = None

#         FEATURE_DEFAULT_OUTPUTS = {
#             "medical-clinical-context": ["medical_context"],
#             "current-clinical-context": ["current_context"],
#             "documentation-treatment-plan": ["documentation"],
#         }

#         use_expert_summary_mode = not output_categories
#         output_categories = FEATURE_DEFAULT_OUTPUTS.get(feature_id, [])

#         # ---------------------------------------------------------
#         # 2️⃣ FETCH STRUCTURED CLINICAL DATA
#         # ---------------------------------------------------------
#         clinical_data = {}

#         # ---------------- MEDICAL CONTEXT ----------------
#         doc = await medical_context_collection.find_one(
#             {"patient_id": patient_id}, {"_id": 0}
#         )

#         if doc:
#             medical_context = []
#             for ctx in doc.get("medical_contexts", []):
#                 texts = [c.get("text") for c in ctx.get("conditions", []) if c.get("text")]
#                 if texts:
#                     medical_context.append({
#                         "date": ctx.get("date"),
#                         "conditions": texts
#                     })
#             if medical_context:
#                 clinical_data["medical_context"] = medical_context

#         # ---------------- CURRENT CONTEXT ----------------
#         doc = await current_context_collection.find_one(
#             {"patient_id": patient_id}, {"_id": 0}
#         )

#         if doc:
#             current_context = []
#             for ctx in doc.get("current_contexts", []):
#                 texts = [c.get("text") for c in ctx.get("current_condition", []) if c.get("text")]
#                 if texts:
#                     current_context.append({
#                         "date": ctx.get("date"),
#                         "current_condition": texts
#                     })
#             if current_context:
#                 clinical_data["current_context"] = current_context

#         # ---------------- VITALS ----------------
#         vitals_doc = await patient_vitals_collection.find_one(
#             {"sys_user_id": patient_id},
#             {"_id": 0, "vitals": 1}
#         )

#         if vitals_doc and vitals_doc.get("vitals"):
#             clinical_data["vitals"] = vitals_doc["vitals"]

#         # ---------------- CHIEF COMPLAINTS ----------------
#         chief_complaints = await fetch_all_appointments_for_patient(patient_id)
#         if chief_complaints:
#             clinical_data["chief_complaints"] = chief_complaints

#         # ---------------- DOCUMENTS ----------------
#         latest_documents = []
#         cursor = (
#             document_categories_collection
#             .find({"patient_id": patient_id}, {"_id": 0, "processed_data": 1})
#             .sort("_id", -1).limit(3)

#             .limit(3)
#         )

#         async for d in cursor:
#             if d.get("processed_data"):
#                 latest_documents.append(d["processed_data"])

#         if latest_documents:
#             clinical_data["documents"] = latest_documents

#         clinical_data["documentation_features"] = await fetch_latest_documentation_features(
#             patient_id, 5
#         )



#         # ---------------------------------------------------------
#         # 🧾 FETCH PATIENT DETAILS (DEMOGRAPHICS)
#         # ---------------------------------------------------------
#         patient_details = {}

#         patient_doc = patient_user_collection.find_one(
#             {"sys_user_id": patient_id},
#             {
#                 "_id": 0,
#                 "name": 1,
#                 "date_of_birth": 1,
#                 "blood_group": 1,
#                 "gender": 1,
#                 "family_history": 1
#             }
#         )

#         if patient_doc:
#             # Calculate age safely
#             age = None
#             dob_str = patient_doc.get("date_of_birth")

#             if dob_str:
#                 try:
#                     dob = datetime.strptime(dob_str, "%Y-%m-%d").date()
#                     today = datetime.utcnow().date()
#                     age = today.year - dob.year - (
#                         (today.month, today.day) < (dob.month, dob.day)
#                     )
#                 except Exception:
#                     logger.warning("Invalid DOB format while computing age")

#             patient_details = {
#                 "name": patient_doc.get("name"),
#                 "age": age,
#                 "blood_group": patient_doc.get("blood_group"),
#                 "sex": patient_doc.get("gender"),   # mapping gender → sex
#                 "family_history": patient_doc.get("family_history")
#             }
#         patient_details_json = json.dumps( patient_details if patient_details else {}, indent=2, default=str )
#         logger.info(f"patient_details_json:{patient_details_json}")    
#         # ---------------------------------------------------------
#         # 🧠 3️⃣ FETCH LATEST AGENTIC OUTPUT (NEW)
#         # ---------------------------------------------------------
#         agentic_output = None

#         agentic_doc = agentic_data_collection.find_one(
#             {
#                 "patient_id": patient_id,
#                 "doctor_id": doctor_id
#             },
#             {
#                 "_id": 0,
#                 "data": 1,
#                 "version": 1
#             },
#             sort=[("version", -1)]
#         )

#         if agentic_doc and agentic_doc.get("data"):
#             agentic_output = agentic_doc["data"]

#         has_agentic_data = agentic_output is not None
#         logger.info("has_agentic_data=%s", has_agentic_data)
#         logger.info(f"has_agentic_data:{agentic_output}")
        
#         # ---------------- TEMP REUSABLE DATA ----------------
#         temp_doc = temp_data_collection.find_one(
#             {"patient_id": patient_id},
#             {"_id": 0}
#         )

#         if temp_doc:
#             temp_clinical_data = {}

#             # dynamically extract all temp fields except identifiers
#             for key, value in temp_doc.items():
#                 if key not in ["patient_id", "doctor_id", "created_at"]:
#                     temp_clinical_data[key] = value

#             if temp_clinical_data:
#                 clinical_data["temp_data"] = temp_clinical_data
#         temp_data_json = json.dumps(
#             clinical_data.get("temp_data", {}),
#             indent=2,
#             default=str
#         )
#         logger.info(f"temp data:{temp_data_json}")
#         # ---------------------------------------------------------
#         # 4️⃣ CONVERSATION (OPTIONAL)
#         # ---------------------------------------------------------
#         conversation_text = None
#         conversation_doc = await database["conversation_user"].find_one(
#             {"patient_id": patient_id, "doctor_id": doctor_id},
#             {"_id": 0}
#         )
#         if conversation_doc:
#             conversation_text = conversation_doc.get("conversation")
#         clinical_data_json = json.dumps(clinical_data, indent=2, default=str)

#         # ---------------------------------------------------------
#         # 5️⃣ PROMPT CONSTRUCTION (UPDATED)
#         # ---------------------------------------------------------
#         if use_expert_summary_mode:

#             # ================= MEDICAL CONTEXT =================
#             if feature_id == "medical-clinical-context":

#                 if has_agentic_data:
#                     prompt = f"""
# You are a MEDICAL CONTEXT SYNTHESIZER.

# Your task:
# Construct a COMPLETE and CONCISE patient Medical Context by combining ALL documented facts from ALL provided sources, regardless of visit timing.

# ════════════════════════════════════
# DEFINITION
# ════════════════════════════════════
# Medical Context is the COMPLETE, longitudinal record of ALL documented medical facts about the patient across ALL encounters, presented in a CONCISE, dense paragraph format.

# It represents EVERYTHING RECORDED — not what it means.

# ════════════════════════════════════
# INPUT SOURCES (USE ALL PROVIDED)
# ════════════════════════════════════
# You will receive THREE inputs:

# 1) PATIENT DEMOGRAPHICS: Basic patient identification and static information
# 2) STRUCTURED CLINICAL DATA: Raw clinical data from current or previous encounters (temp data)
# 3) AGENTIC OUTPUT: Clinician-curated structured medical facts from specific encounters

# CRITICAL: These sources may represent DIFFERENT VISITS or TIMEPOINTS. You must combine ALL facts from ALL sources into ONE comprehensive medical context that reflects the patient's complete documented history.

# ════════════════════════════════════
# HANDLING MULTIPLE SOURCES / VISITS
# ════════════════════════════════════
# When sources contain information from different timepoints:

# 1. INCLUDE ALL FACTS from EVERY source
# 2. PRESERVE temporal information (dates, timing references) when present
# 3. DO NOT overwrite older data with newer data — both are part of medical history
# 4. If the same fact appears in multiple sources, include it ONCE
# 5. If facts conflict or differ, include BOTH with their respective contexts

# ════════════════════════════════════
# ABSOLUTE RULES (ZERO TOLERANCE)
# ════════════════════════════════════
# ⛔ NO interpretation, inference, or diagnosis
# ⛔ NO adding external medical knowledge
# ⛔ NO omitting ANY documented fact from ANY source
# ⛔ NO resolving contradictions — include all versions if present
# ⛔ NO prioritizing one source over another — all sources are equally valid
# ⛔ NO assuming which visit is "current" unless explicitly stated

# ✅ Condense language while preserving EVERY fact from EVERY source
# ✅ Use standard clinical abbreviations where appropriate
# ✅ Group related findings together
# ✅ Preserve ALL temporal indicators (dates, times, "since early morning", "history of", etc.)
# ✅ Include both historical and current information in ONE unified paragraph

# ════════════════════════════════════
# CONDENSATION LOGIC
# ════════════════════════════════════
# Take ALL data points from ALL sources and compress them into a single, dense paragraph by:

# 1. REMOVING redundant words:
#    - Eliminate articles (a, an, the)
#    - Remove unnecessary verbs (is, was, were, showed)
#    - Drop phrases like "patient presented with" or "findings revealed"

# 2. COMBINING related information from ALL sources:
#    - Demographics: age, gender, blood type at beginning
#    - Past medical history: all historical conditions from all sources
#    - Current presentation: symptoms, onset, associated features
#    - Vital signs: all measurements with available timing
#    - Labs: all results with available timing
#    - Imaging: all findings with available timing
#    - Medications: all medications initiated or continued, with doses and timing
#    - Family history: any documented family history
#    - Follow-up plans: all documented follow-up instructions

# 3. USING concise clinical terminology:
#    - Convert descriptions to standard medical abbreviations
#    - Use accepted short forms (DM2, HTN, CAD, CVA, etc.)

# 4. PRESERVING ALL data points:
#    - Every numerical value must remain exact
#    - Every date/time reference must be included
#    - Every diagnosis, symptom, finding must appear
#    - Every medication name, dose, route, frequency
#    - EVERY fact from EVERY source — no exceptions

# 5. ORGANIZING logically:
#    - Demographics first
#    - Past medical history next
#    - Current presentation/symptoms
#    - Vital signs, labs, imaging
#    - Medications initiated/continued
#    - Family history
#    - Follow-up plans
#    - Preserve chronology within categories when timestamps exist

# ════════════════════════════════════
# INPUT DATA
# ════════════════════════════════════
# PATIENT DEMOGRAPHICS:
# {patient_details_json}

# STRUCTURED CLINICAL DATA (may contain data from any visit):
# {temp_data_json}

# AGENTIC OUTPUT (clinician-curated facts from specific encounters):
# {agentic_output}

# ════════════════════════════════════
# CRITICAL REMINDER
# ════════════════════════════════════
# These sources may represent DIFFERENT VISITS. You are building a COMPLETE medical history that includes:
# - What was recorded in the past (historical data)
# - What is recorded now (current data)
# - Everything in between

# DO NOT discard ANY information from ANY source.

# ════════════════════════════════════
# OUTPUT REQUIREMENT
# ════════════════════════════════════
# Generate ONE dense paragraph containing ALL documented facts from ALL input sources, condensed according to the logic above.

# Return ONLY valid JSON with this exact structure:

# {{
#   "medical_context": "Single dense paragraph containing EVERY documented fact from ALL sources, compressed into minimal words while preserving all data points, temporal information, and combining historical and current information."
# }}

# If absolutely NO medical data exists across all inputs:
# {{
#   "medical_context": "No documented medical information available."
# }}
# """
#                 else:
#                     prompt = f"""
# You are a clinical documentation synthesizer.

# Your task:
# Construct the patient's Medical Context.

# ══════════════════════════════
# PATIENT DEMOGRAPHICS (AUTHORITATIVE)
# ══════════════════════════════
# {patient_details_json}

# Medical Context means:
# The complete, specialty-agnostic collection of ALL documented medical facts about the patient, gathered from every available source, without interpretation, prioritization, or clinical judgment.

# It represents ONLY what is recorded — not what it means.

# ══════════════════════════════
# SOURCE OF TRUTH
# ══════════════════════════════
# The structured JSON below contains validated clinical data.

# This is the ONLY source of information you may use.
# Every statement you produce MUST be directly supported by this data.

# If a detail is not explicitly present, DO NOT include it.

# Never:
# - invent information
# - assume missing values
# - interpret findings
# - diagnose
# - predict
# - explain significance
# - summarize meaning
# - add external knowledge

# When uncertain, omit the information.

# ══════════════════════════════
# AVAILABLE CLINICAL DOMAINS
# ══════════════════════════════
# The data may include information from multiple specialties and document types, such as:

# - diagnoses and conditions
# - symptoms and complaints
# - vital signs and measurements
# - laboratory results
# - microbiology and pathology findings
# - imaging and radiology reports
# - procedures and operative notes
# - medications and doses
# - allergies
# - comorbidities
# - clinical notes and summaries
# - treatment plans
# - investigations
# - processed documents

# All domains are equally important.
# Do NOT prioritize, interpret, or filter.

# Use everything that exists.
# Ignore domains that are empty.

# {clinical_data_json}

# ══════════════════════════════
# OPTIONAL CONTEXT (WORDING ONLY)
# ══════════════════════════════
# Conversation: {conversation_text if conversation_text else "Not available"}
# Dictation: {dictation if dictation else "Not available"}

# These may clarify wording or timing ONLY.
# They MUST NOT introduce new medical facts.

# ══════════════════════════════
# INSTRUCTIONS
# ══════════════════════════════
# 1. Extract only explicitly documented facts.
# 2. Combine information from ALL available domains.
# 3. Preserve factual wording as closely as possible.
# 4. Use neutral, objective language.
# 5. Prefer chronological ordering when appropriate.
# 6. Do not interpret, explain, or evaluate any finding.
# 7. Do not remove information based on importance — include all facts that exist.

# Think of this as creating a unified factual record, not a clinical opinion.

# ══════════════════════════════
# OUTPUT FORMAT (STRICT)
# ══════════════════════════════
# Return ONLY valid JSON:

# {{
#   "medical_context": "One concise paragraph containing only documented medical facts aggregated across all domains."
# }}

# If no validated data exists:
# {{
#   "medical_context": "No clinical data available for review."
# }}
# """

#             # ================= CURRENT CLINICAL CONTEXT =================
#             elif feature_id == "current-clinical-context":

#                 if has_agentic_data:
#                     prompt = f"""
# You are a CLINICAL CONTEXT SYNTHESIZER.

# Your task:
# Construct the patient's Clinical Context.

# ════════════════════════════════════
# DEFINITION (NON-NEGOTIABLE)
# ════════════════════════════════════
# Clinical Context is a comprehensive, problem-centered clinical interpretation that:

# - explicitly defines diagnoses (confirmed, provisional, differential)
# - identifies the PRIMARY diagnosis
# - integrates disease stage, severity, and prognosis
# - incorporates validated prognostic factors and scoring systems
# - aligns findings across specialties
# - describes current clinical goals and risks
# - supports evidence-based decision-making

# Clinical Context TRANSFORMS documented facts into unified clinical judgment.

# ════════════════════════════════════
# SOURCE OF TRUTH
# ════════════════════════════════════
# You are given THREE inputs:

# 1) STRUCTURED CLINICAL DATA (facts)
# 2) AGENTIC OUTPUT (validated clinical reasoning, staging, risk, prognosis)
# 3) OPTIONAL CONTEXT (conversation + dictation)

# You MUST reason ONLY from inputs (1) and (2).

# ════════════════════════════════════
# ROLE OF OPTIONAL CONTEXT (CRITICAL)
# ════════════════════════════════════
# Conversation and dictation:
# - MAY clarify timing, symptom evolution, or sequencing
# - MAY clarify wording or clinician intent
# - MUST NOT introduce new diagnoses, findings, tests, or values
# - MUST NOT override or contradict structured or agentic data
# - MUST be ignored if inconsistent with inputs (1) or (2)

# Optional context is SUPPORTIVE ONLY, not authoritative.

# ════════════════════════════════════
# ALLOWED REASONING
# ════════════════════════════════════
# You MAY:
# - identify and name diagnoses when supported
# - distinguish primary vs secondary diagnoses
# - integrate staging systems (e.g., GOLD, CKD, qSOFA, NEWS2)
# - describe disease severity and stability
# - summarize prognosis and risk stratification
# - correlate symptoms, vitals, investigations, and treatments
# - highlight red flags and deterioration risks
# - integrate guideline alignment and treatment validation

# ════════════════════════════════════
# STRICT PROHIBITIONS
# ════════════════════════════════════
# ⛔ NO hallucination
# ⛔ NO external knowledge
# ⛔ NO assumptions beyond provided data
# ⛔ NO fabrication of tests or values
# ⛔ NO contradiction of agentic output
# ⛔ NO omission of relevant agentic insights

# If a diagnosis, score, risk, or warning appears in AGENTIC OUTPUT,
# it MUST be reflected in the Clinical Context.

# ════════════════════════════════════
# PATIENT DEMOGRAPHICS (AUTHORITATIVE)
# ════════════════════════════════════
# {patient_details_json}


# ════════════════════════════════════
# STRUCTURED CLINICAL DATA (AUTHORITATIVE)
# ════════════════════════════════════
# {temp_data_json}

# ════════════════════════════════════
# AGENTIC OUTPUT (AUTHORITATIVE CLINICAL INTELLIGENCE)
# ════════════════════════════════════
# {agentic_output}

# ════════════════════════════════════
# OPTIONAL CONTEXT (NON-AUTHORITATIVE)
# ════════════════════════════════════
# Conversation:
# {{conversation_text}}

# Dictation:
# {{dictation}}

# ════════════════════════════════════
# INSTRUCTIONS
# ════════════════════════════════════
# 1. Identify the patient’s CURRENT clinical problem
# 2. Define confirmed, provisional, and differential diagnoses
# 3. Clearly identify the PRIMARY diagnosis
# 4. Integrate staging, severity, and prognosis
# 5. Incorporate specialty-specific scores and risk models
# 6. Describe current treatment status and response
# 7. Highlight key risks, red flags, and clinical priorities
# 8. Write a concise clinician-to-clinician summary

# ════════════════════════════════════
# OUTPUT FORMAT (STRICT)
# ════════════════════════════════════
# Return ONLY valid JSON:

# {{
#   "clinical_context": "One concise but comprehensive paragraph synthesizing diagnosis, severity, prognosis, risks, and current clinical state."
# }}

# If insufficient data:
# {{
#   "clinical_context": "Insufficient clinical information available to determine clinical context."
# }}

# """
#                 else:
#                     prompt = f"""
# You are a clinical reasoning synthesizer.

# Your task:
# Construct the patient's Clinical Context.

# ══════════════════════════════
# PATIENT DEMOGRAPHICS (AUTHORITATIVE)
# ══════════════════════════════
# {patient_details_json}


# Clinical Context means:
# A comprehensive, problem-centered clinical interpretation that integrates all available medical facts to describe the patient’s current condition, likely diagnoses, severity, risks, treatment status, and overall clinical picture.

# Unlike raw documentation summaries, this task REQUIRES thoughtful synthesis and clinical reasoning based ONLY on the validated data provided.

# ══════════════════════════════
# SOURCE OF TRUTH
# ══════════════════════════════
# The structured JSON below contains validated clinical information.

# You MUST reason ONLY from this data.
# Do NOT invent or hallucinate information.
# Do NOT use external knowledge beyond general clinical reasoning.
# If something is not supported by the data, omit it.

# {clinical_data_json}

# ══════════════════════════════
# OPTIONAL CONTEXT
# ══════════════════════════════
# Conversation: {conversation_text if conversation_text else "Not available"}
# Dictation: {dictation if dictation else "Not available"}

# These may clarify timing or wording and may update current findings.

# ══════════════════════════════
# ALLOWED REASONING (EXPECTED)
# ══════════════════════════════
# You SHOULD:
# - correlate related findings
# - identify likely diagnoses when clearly supported
# - summarize disease stage/severity when evidence exists
# - connect labs, vitals, imaging, and symptoms
# - describe treatment responses or progression
# - explain overall clinical status
# - synthesize fragmented data into a coherent picture

# You MAY:
# - interpret abnormal results
# - state clinical impressions
# - summarize risks or concerns
# - provide provisional or differential diagnoses when supported

# ══════════════════════════════
# RESTRICTIONS
# ══════════════════════════════
# Do NOT:
# - fabricate facts
# - assume undocumented findings
# - contradict provided data
# - introduce unrelated medical knowledge

# All reasoning must be traceable to the provided information.

# ══════════════════════════════
# INSTRUCTIONS
# ══════════════════════════════
# 1. Review all domains (medical history, current findings, vitals, labs, imaging, medications, notes, plans, documents).
# 2. Identify the key current problems.
# 3. Integrate related findings.
# 4. Provide a coherent clinical interpretation.
# 5. Write in professional medical language suitable for clinicians.

# ══════════════════════════════
# OUTPUT FORMAT (STRICT)
# ══════════════════════════════
# Return ONLY valid JSON:

# {{
#   "clinical_context": "A concise paragraph  summarizing the interpreted clinical situation, including key diagnoses, severity, relevant findings, and current management status."
# }}

# If insufficient data exists:
# {{
#   "clinical_context": "Insufficient clinical information available to determine clinical context."
# }}
# """

#             # ================= OTHER FEATURES =================
#             else:
#                 prompt = f"""
# Extract ONLY documented facts.

# DATA:
# {json.dumps(clinical_data, indent=2, default=str)}

# Return JSON:
# {{"summary":"Concise paragraph"}}
# """

#         # ---------------------------------------------------------
#         # STRUCTURED MODE (UNCHANGED)
#         # ---------------------------------------------------------
#         else:
#             prompt = f"""
# Generate structured outputs for:
# {output_categories}

# DATA:
# {json.dumps(clinical_data, indent=2, default=str)}
# """

#         # ---------------------------------------------------------
#         # 6️⃣ LLM EXECUTION
#         # ---------------------------------------------------------
#         completion = groq_client.chat.completions.create(
#             model="llama-3.1-8b-instant",
#             messages=[{"role": "user", "content": prompt}],
#             temperature=0.1,
#             response_format={"type": "json_object"},
#             max_tokens=4000
#         )

#         llm_output = json.loads(completion.choices[0].message.content)

#         # ---------------------------------------------------------
#         # 7️⃣ RESPONSE
#         # ---------------------------------------------------------
#         return {
#             "status": "success",
#             "feature_id": feature_id,
#             "feature_name": feature_name,
#             "display_method": display_method,
#             "mode": "expert_summary" if use_expert_summary_mode else "structured",
#             "finaloutput": llm_output,
#             "metadata": {
#                 "doctor_id": doctor_id,
#                 "patient_id": patient_id,
#                 "output_categories": output_categories if not use_expert_summary_mode else None
#             }
#         }

#     except Exception as e:
#         logger.exception("Second-stage feature processing failed")
#         raise HTTPException(
#             status_code=500,
#             detail=f"Feature processing error: {str(e)}"
#         )


# @router.post("/process-feature-with-fetched-data1")
# async def process_feature_with_fetched_data(request: Request):
#     """
#     Second-stage Feature Processing with Dynamic Prompt Generation
#     """

#     try:
#         payload = await request.json()

#         doctor_id = payload.get("doctor_id")
#         # ---------------------------------------------------------
#         # 🔎 FETCH DOCTOR SPECIALITY
#         # ---------------------------------------------------------
#         doctor_doc = doctor_user_collection.find_one(
#             {"sys_user_id": doctor_id},   # use sys_user_id
#             {"_id": 0}
#         )

#         logger.info(f"[RULE DEBUG] Doctor Document: {doctor_doc}")

#         doctor_speciality = None
#         if doctor_doc:
#             doctor_speciality = doctor_doc.get("speciality") or doctor_doc.get("specialization")

#         logger.info(f"[RULE DEBUG] Doctor Speciality: {doctor_speciality}")
#         logger.info(f"[RULE DEBUG] Doctor ID: {doctor_id}")
#         logger.info(f"[RULE DEBUG] Doctor Speciality: {doctor_speciality}")


#         # ---------------------------------------------------------
#         # 🔎 FETCH DOCTOR-SPECIFIC RULE
#         # ---------------------------------------------------------
#         doctor_rule = context_rule_doctor_collection.find_one(
#             {"doctor_id": doctor_id},
#             {"_id": 0}
#         )

#         # If doctor rule exists but inactive → ignore it
#         if doctor_rule and not doctor_rule.get("is_active", True):
#             doctor_rule = None

#         if doctor_rule:
#             logger.info("[RULE DEBUG] Doctor-specific rule FOUND and ACTIVE")
#         else:
#             logger.info("[RULE DEBUG] Doctor-specific rule NOT found or inactive")


#         # ---------------------------------------------------------
#         # 🔎 FALLBACK TO ADMIN RULE
#         # ---------------------------------------------------------
#         if not doctor_rule and doctor_speciality:
#             admin_rule = context_rule_collection.find_one(
#                 {"speciality": doctor_speciality},
#                 {"_id": 0}
#             )
#         else:
#             admin_rule = None
#         if admin_rule:
#             logger.info("[RULE DEBUG] Admin rule FOUND for speciality")
#         else:
#             logger.info("[RULE DEBUG] Admin rule NOT found")

#         final_rule = doctor_rule if doctor_rule else admin_rule
#         if doctor_rule:
#             logger.info("[RULE DEBUG] FINAL RULE SOURCE: DOCTOR CONFIGURATION")
#         elif admin_rule:
#             logger.info("[RULE DEBUG] FINAL RULE SOURCE: ADMIN DEFAULT")
#         else:
#             logger.info("[RULE DEBUG] FINAL RULE SOURCE: NONE (No rule applied)")


#         # Extract rule fields
#         medical_context_categories = None
#         medical_context_rule = None
#         current_context_categories = None
#         current_context_rule = None

#         if final_rule:
#             medical_context_categories = final_rule.get("medical_context_categories")
#             medical_context_rule = final_rule.get("medical_context_rule")
#             current_context_categories = final_rule.get("current_context_categories")
#             current_context_rule = final_rule.get("current_context_rule")
#             logger.info(f"[RULE DEBUG] Medical Categories: {medical_context_categories}")
#             logger.info(f"[RULE DEBUG] Current Categories: {current_context_categories}")

#             logger.info(f"[RULE DEBUG] Medical Rule Text: {medical_context_rule[:300] if medical_context_rule else None}")
#             logger.info(f"[RULE DEBUG] Current Rule Text: {current_context_rule[:300] if current_context_rule else None}")
#         patient_id = payload.get("patient_id")
#         feature_id = payload.get("feature_id")
#         dictation = payload.get("dictation")

#         if not doctor_id or not patient_id or not feature_id:
#             raise HTTPException(
#                 status_code=400,
#                 detail="doctor_id, patient_id, feature_id are required"
#             )

#         # ---------------------------------------------------------
#         # 1️⃣ FEATURE META (SIMPLIFIED)
#         # ---------------------------------------------------------
#         feature_name = feature_id
#         rules = None
#         output_categories = None
#         display_method = None

#         FEATURE_DEFAULT_OUTPUTS = {
#             "medical-clinical-context": ["medical_context"],
#             "current-clinical-context": ["current_context"],
#             "documentation-treatment-plan": ["documentation"],
#         }

#         use_expert_summary_mode = not output_categories
#         output_categories = FEATURE_DEFAULT_OUTPUTS.get(feature_id, [])

#         # ---------------------------------------------------------
#         # 2️⃣ FETCH STRUCTURED CLINICAL DATA
#         # ---------------------------------------------------------
#         clinical_data = {}

#         # ---------------- MEDICAL CONTEXT ----------------
#         doc = await medical_context_collection.find_one(
#             {"patient_id": patient_id}, {"_id": 0}
#         )

#         if doc:
#             medical_context = []
#             for ctx in doc.get("medical_contexts", []):
#                 texts = [c.get("text") for c in ctx.get("conditions", []) if c.get("text")]
#                 if texts:
#                     medical_context.append({
#                         "date": ctx.get("date"),
#                         "conditions": texts
#                     })
#             if medical_context:
#                 clinical_data["medical_context"] = medical_context

#         # ---------------- CURRENT CONTEXT ----------------
#         doc = await current_context_collection.find_one(
#             {"patient_id": patient_id}, {"_id": 0}
#         )

#         if doc:
#             current_context = []
#             for ctx in doc.get("current_contexts", []):
#                 texts = [c.get("text") for c in ctx.get("current_condition", []) if c.get("text")]
#                 if texts:
#                     current_context.append({
#                         "date": ctx.get("date"),
#                         "current_condition": texts
#                     })
#             if current_context:
#                 clinical_data["current_context"] = current_context

#         # ---------------- VITALS ----------------
#         vitals_doc = await patient_vitals_collection.find_one(
#             {"sys_user_id": patient_id},
#             {"_id": 0, "vitals": 1}
#         )

#         if vitals_doc and vitals_doc.get("vitals"):
#             clinical_data["vitals"] = vitals_doc["vitals"]

#         # ---------------- CHIEF COMPLAINTS ----------------
#         chief_complaints = await fetch_all_appointments_for_patient(patient_id)
#         if chief_complaints:
#             clinical_data["chief_complaints"] = chief_complaints

#         # ---------------- DOCUMENTS ----------------
#         latest_documents = []
#         cursor = (
#             document_categories_collection
#             .find({"patient_id": patient_id}, {"_id": 0, "processed_data": 1})
#             .sort("_id", -1).limit(3)

#             .limit(3)
#         )

#         async for d in cursor:
#             if d.get("processed_data"):
#                 latest_documents.append(d["processed_data"])

#         if latest_documents:
#             clinical_data["documents"] = latest_documents

#         clinical_data["documentation_features"] = await fetch_latest_documentation_features(
#             patient_id, 5
#         )



#         # ---------------------------------------------------------
#         # 🧾 FETCH PATIENT DETAILS (DEMOGRAPHICS)
#         # ---------------------------------------------------------
#         patient_details = {}

#         patient_doc = patient_user_collection.find_one(
#             {"sys_user_id": patient_id},
#             {
#                 "_id": 0,
#                 "name": 1,
#                 "date_of_birth": 1,
#                 "blood_group": 1,
#                 "gender": 1,
#                 "family_history": 1
#             }
#         )

#         if patient_doc:
#             # Calculate age safely
#             age = None
#             dob_str = patient_doc.get("date_of_birth")

#             if dob_str:
#                 try:
#                     dob = datetime.strptime(dob_str, "%Y-%m-%d").date()
#                     today = datetime.utcnow().date()
#                     age = today.year - dob.year - (
#                         (today.month, today.day) < (dob.month, dob.day)
#                     )
#                 except Exception:
#                     logger.warning("Invalid DOB format while computing age")

#             patient_details = {
#                 "name": patient_doc.get("name"),
#                 "age": age,
#                 "blood_group": patient_doc.get("blood_group"),
#                 "sex": patient_doc.get("gender"),   # mapping gender → sex
#                 "family_history": patient_doc.get("family_history")
#             }
#         patient_details_json = json.dumps( patient_details if patient_details else {}, indent=2, default=str )
#         logger.info(f"patient_details_json:{patient_details_json}")    
#         # ---------------------------------------------------------
#         # 🧠 3️⃣ FETCH LATEST AGENTIC OUTPUT (NEW)
#         # ---------------------------------------------------------
#         agentic_output = None

#         agentic_doc = agentic_data_collection.find_one(
#             {
#                 "patient_id": patient_id,
#                 "doctor_id": doctor_id
#             },
#             {
#                 "_id": 0,
#                 "data": 1,
#                 "version": 1
#             },
#             sort=[("version", -1)]
#         )

#         if agentic_doc and agentic_doc.get("data"):
#             agentic_output = agentic_doc["data"]

#         has_agentic_data = agentic_output is not None
#         logger.info("has_agentic_data=%s", has_agentic_data)
#         logger.info(f"has_agentic_data:{agentic_output}")
        
#         # ---------------- TEMP REUSABLE DATA ----------------
#         temp_doc = temp_data_collection.find_one(
#             {"patient_id": patient_id},
#             {"_id": 0}
#         )

#         if temp_doc:
#             temp_clinical_data = {}

#             # dynamically extract all temp fields except identifiers
#             for key, value in temp_doc.items():
#                 if key not in ["patient_id", "doctor_id", "created_at"]:
#                     temp_clinical_data[key] = value

#             if temp_clinical_data:
#                 clinical_data["temp_data"] = temp_clinical_data
#         temp_data_json = json.dumps(
#             clinical_data.get("temp_data", {}),
#             indent=2,
#             default=str
#         )
#         logger.info(f"temp data:{temp_data_json}")
#         # ---------------------------------------------------------
#         # 4️⃣ CONVERSATION (OPTIONAL)
#         # ---------------------------------------------------------
#         conversation_text = None
#         conversation_doc = await database["conversation_user"].find_one(
#             {"patient_id": patient_id, "doctor_id": doctor_id},
#             {"_id": 0}
#         )
#         if conversation_doc:
#             conversation_text = conversation_doc.get("conversation")
#         clinical_data_json = json.dumps(clinical_data, indent=2, default=str)

#         # ---------------------------------------------------------
#         # 5️⃣ PROMPT CONSTRUCTION (UPDATED)
#         # ---------------------------------------------------------
#         if use_expert_summary_mode:

#             # ================= MEDICAL CONTEXT =================
#             if feature_id == "medical-clinical-context":

#                 if has_agentic_data:
#                     prompt = f"""

# You are a clinical documentation synthesizer.

# ════════════════════════════════════
# SPECIALITY RULE (PRIMARY AUTHORITY)
# ════════════════════════════════════
# The following rule defines how the output MUST be written.
# You MUST strictly follow this rule.

# {medical_context_rule}

# ════════════════════════════════════
# OUTPUT CATEGORIES
# ════════════════════════════════════
# Return ONLY valid JSON.

# Use EXACTLY these keys:

# {medical_context_categories}

# Each category MUST be a SINGLE STRING PARAGRAPH.
# Do NOT create nested JSON.
# Do NOT create sub-keys.

# ════════════════════════════════════
# SOURCE DATA (FACTUAL ONLY)
# ════════════════════════════════════

# PATIENT DEMOGRAPHICS:
# {patient_details_json}

# STRUCTURED CLINICAL DATA:
# {temp_data_json}

# AGENTIC OUTPUT:
# {agentic_output}

# ════════════════════════════════════
# GLOBAL SAFETY RULES (NON-NEGOTIABLE)
# ════════════════════════════════════
# - Use ONLY information present in input data.
# - Do NOT hallucinate or invent facts.
# - Do NOT add external medical knowledge.
# - If data is missing, state that it is not available in records.
# - Maintain professional clinical language.

# ════════════════════════════════════
# OUTPUT REQUIREMENT
# ════════════════════════════════════
# Generate concise, clinically structured paragraphs according to the SPECIALITY RULE.

# Return ONLY valid JSON.
# """
#                 else:
#                     prompt = f"""
# You are a clinical documentation synthesizer.

# ══════════════════════════════
# SPECIALITY RULE (PRIMARY AUTHORITY)
# ══════════════════════════════
# Follow the speciality rule below when structuring and writing the output.
# The rule defines clinical style, structure, and expectations.

# {medical_context_rule}

# ══════════════════════════════
# PATIENT DEMOGRAPHICS (AUTHORITATIVE)
# ══════════════════════════════
# {patient_details_json}

# ══════════════════════════════
# SOURCE OF TRUTH
# ══════════════════════════════
# The structured JSON below contains validated clinical data.
# This is the ONLY source of information you may use.

# If a detail is not explicitly present, DO NOT include it.

# STRICT PROHIBITIONS:
# - No hallucination
# - No external medical knowledge
# - No interpretation beyond documented facts
# - No diagnosis unless explicitly documented
# - No assumptions

# ══════════════════════════════
# AVAILABLE CLINICAL DATA
# ══════════════════════════════
# {clinical_data_json}

# ══════════════════════════════
# OPTIONAL CONTEXT (WORDING ONLY)
# ══════════════════════════════
# Conversation:
# {conversation_text if conversation_text else "Not available"}

# Dictation:
# {dictation if dictation else "Not available"}

# Optional context may clarify wording ONLY.
# It must NEVER introduce new medical facts.

# ══════════════════════════════
# GLOBAL SYNTHESIS RULES
# ══════════════════════════════
# 1. Extract only explicitly documented facts.
# 2. Combine information from ALL available domains.
# 3. Preserve factual wording where possible.
# 4. Maintain concise, professional clinical language.
# 5. Avoid repetition or unnecessary expansion.
# 6. Organize content logically following the SPECIALITY RULE.

# ══════════════════════════════
# OUTPUT FORMAT (STRICT)
# ══════════════════════════════
# Return ONLY valid JSON.

# Use EXACTLY these keys:
# {medical_context_categories}

# Each category MUST be:
# - A SINGLE STRING PARAGRAPH
# - Clinically concise
# - Factually grounded

# STRICT JSON RULES:
# - Do NOT create nested JSON objects
# - Do NOT create sub-keys
# - Do NOT use ":" inside keys
# - Do NOT output lists or dictionaries
# - ONLY plain paragraph text as values

# Example format:
# {{
#   "{medical_context_categories[0] if medical_context_categories else "medical_context"}": "Concise clinical paragraph..."
# }}
# """

#             # ================= CURRENT CLINICAL CONTEXT =================
#             elif feature_id == "current-clinical-context":

#                 if has_agentic_data:
#                     prompt = f"""

# You are a clinical reasoning synthesizer.

# ══════════════════════════════
# SPECIALITY RULE (PRIMARY AUTHORITY)
# ══════════════════════════════
# Follow the speciality rule below when structuring and writing the output.
# This rule defines clinical interpretation style and expectations.

# {current_context_rule}

# ══════════════════════════════
# OUTPUT CATEGORIES
# ══════════════════════════════
# Return ONLY valid JSON using EXACTLY these keys:

# {current_context_categories}

# Each category MUST be a SINGLE STRING PARAGRAPH.

# ══════════════════════════════
# SOURCE DATA (AUTHORITATIVE)
# ══════════════════════════════

# PATIENT DEMOGRAPHICS:
# {patient_details_json}

# STRUCTURED CLINICAL DATA:
# {temp_data_json}

# AGENTIC OUTPUT:
# {agentic_output}

# ══════════════════════════════
# OPTIONAL CONTEXT (WORDING ONLY)
# ══════════════════════════════
# Conversation:
# {conversation_text if conversation_text else "Not available"}

# Dictation:
# {dictation if dictation else "Not available"}

# Optional context may clarify wording or timing ONLY.
# It MUST NOT introduce new diagnoses, findings, tests, or values.

# ══════════════════════════════
# GLOBAL REASONING RULES
# ══════════════════════════════
# - Reason ONLY from structured clinical data and agentic output.
# - Identify current problems, diagnoses, severity, and risks ONLY when supported.
# - Integrate staging, prognosis, and treatment context when explicitly present.
# - Maintain concise clinician-to-clinician language.
# - Avoid repetition or unnecessary expansion.

# STRICT PROHIBITIONS:
# - No hallucination
# - No external medical knowledge
# - No assumptions beyond provided data
# - No fabrication of clinical details
# - Do NOT contradict agentic output

# ══════════════════════════════
# OUTPUT FORMAT (STRICT JSON)
# ══════════════════════════════
# Return ONLY valid JSON.

# STRICT JSON RULES:
# - Each category MUST be a SINGLE STRING PARAGRAPH
# - Do NOT create nested JSON objects
# - Do NOT create sub-keys
# - Do NOT output lists or dictionaries
# - Values must be plain text paragraphs

# Example format:
# {{
#   "{current_context_categories[0] if current_context_categories else "current_context"}": "Concise clinical reasoning summary..."
# }}
# """
#                 else:
#                     prompt = f"""
# You are a clinical reasoning synthesizer.

# ══════════════════════════════
# SPECIALITY RULE (PRIMARY AUTHORITY)
# ══════════════════════════════
# Follow the speciality rule below when generating the Clinical Context.
# This rule defines clinical interpretation style and structure.

# {current_context_rule}

# ══════════════════════════════
# TASK
# ══════════════════════════════
# Construct the patient's Clinical Context as a concise clinician-to-clinician summary.

# Clinical Context integrates:
# - diagnoses
# - severity and risks
# - treatment status
# - overall clinical picture

# ══════════════════════════════
# PATIENT DEMOGRAPHICS
# ══════════════════════════════
# {patient_details_json}

# ══════════════════════════════
# SOURCE DATA (AUTHORITATIVE)
# ══════════════════════════════
# You MUST reason ONLY from the validated structured data below.

# {clinical_data_json}

# Rules:
# - Do NOT invent or hallucinate information.
# - Do NOT add external medical knowledge.
# - If a detail is absent, omit it.

# ══════════════════════════════
# OPTIONAL CONTEXT (WORDING ONLY)
# ══════════════════════════════
# Conversation:
# {conversation_text if conversation_text else "Not available"}

# Dictation:
# {dictation if dictation else "Not available"}

# Optional context may clarify wording or timing ONLY.
# It MUST NOT introduce new medical facts.

# ══════════════════════════════
# ALLOWED CLINICAL REASONING
# ══════════════════════════════
# You MAY:
# - correlate symptoms, labs, imaging, and treatments
# - identify likely diagnoses when supported
# - summarize severity or stage when evidence exists
# - integrate related findings into a coherent clinical picture
# - describe treatment status or progression

# ══════════════════════════════
# VITAL SIGNS OVERRIDE (STRICT)
# ══════════════════════════════
# For vital signs:
# - Use ONLY the most recent entry
# - Ignore historical values
# - Report numbers exactly as recorded
# - Do NOT interpret or describe trends

# ══════════════════════════════
# RESTRICTIONS
# ══════════════════════════════
# - No hallucination
# - No assumptions beyond provided data
# - No contradictions of structured data

# ══════════════════════════════
# OUTPUT FORMAT (STRICT JSON)
# ══════════════════════════════
# Return ONLY valid JSON.

# Use EXACTLY these keys:

# {current_context_categories}

# STRICT JSON RULES:
# - Each category MUST be a SINGLE STRING PARAGRAPH
# - Do NOT create nested JSON objects
# - Do NOT create sub-keys
# - Do NOT output lists or dictionaries
# - Values must be plain text paragraphs

# Example format:
# {{
#   "{current_context_categories[0] if current_context_categories else "current_context"}": "Concise clinical reasoning summary..."
# }}
# """

#             # ================= OTHER FEATURES =================
#             else:
#                 prompt = f"""
# Extract ONLY documented facts.

# DATA:
# {json.dumps(clinical_data, indent=2, default=str)}

# Return JSON:
# {{"summary":"Concise paragraph"}}
# """

#         # ---------------------------------------------------------
#         # STRUCTURED MODE (UNCHANGED)
#         # ---------------------------------------------------------
#         else:
#             prompt = f"""
# Generate structured outputs for:
# {output_categories}

# DATA:
# {json.dumps(clinical_data, indent=2, default=str)}
# """

#         # ---------------------------------------------------------
#         # 6️⃣ LLM EXECUTION
#         # ---------------------------------------------------------
#         completion = groq_client.chat.completions.create(
#             model="llama-3.1-8b-instant",
#             messages=[{"role": "user", "content": prompt}],
#             temperature=0.1,
#             response_format={"type": "json_object"},
#             max_tokens=4000
#         )

#         llm_output = json.loads(completion.choices[0].message.content)
#         # ---------------------------------------------------------
#         # 🔎 LOG CATEGORY-WISE PROCESSED OUTPUT (FIXED VERSION)
#         # ---------------------------------------------------------

#         logger.info(f"[DEBUG] FULL LLM OUTPUT: {json.dumps(llm_output, indent=2)}")

#         # ================= MEDICAL CONTEXT =================
#         if feature_id == "medical-clinical-context" and medical_context_categories:
#             logger.info("====== MEDICAL CONTEXT CATEGORY OUTPUT START ======")

#             fallback_value = (
#                 llm_output.get("medical_context")
#                 or llm_output.get("clinical_context")
#             )

#             for category in medical_context_categories:
#                 if category in llm_output:
#                     value = llm_output[category]
#                 elif fallback_value:
#                     value = f"[FALLBACK FROM SINGLE OUTPUT] {fallback_value}"
#                 else:
#                     value = "No content returned by LLM"

#                 logger.info(f"[MEDICAL CONTEXT] {category}: {value}")

#             logger.info("====== MEDICAL CONTEXT CATEGORY OUTPUT END ======")


#         # ================= CURRENT CONTEXT =================
#         if feature_id == "current-clinical-context" and current_context_categories:
#             logger.info("====== CURRENT CONTEXT CATEGORY OUTPUT START ======")

#             fallback_value = (
#                 llm_output.get("clinical_context")
#                 or llm_output.get("medical_context")
#             )

#             for category in current_context_categories:
#                 if category in llm_output:
#                     value = llm_output[category]
#                 elif fallback_value:
#                     value = f"[FALLBACK FROM SINGLE OUTPUT] {fallback_value}"
#                 else:
#                     value = "No content returned by LLM"

#                 logger.info(f"[CURRENT CONTEXT] {category}: {value}")

#             logger.info("====== CURRENT CONTEXT CATEGORY OUTPUT END ======")
#         # ---------------------------------------------------------
#         # 7️⃣ RESPONSE
#         # ---------------------------------------------------------
#         return {
#             "status": "success",
#             "feature_id": feature_id,
#             "feature_name": feature_name,
#             "display_method": display_method,
#             "mode": "expert_summary" if use_expert_summary_mode else "structured",
#             "finaloutput": llm_output,
#             "metadata": {
#                 "doctor_id": doctor_id,
#                 "patient_id": patient_id,
#                 "output_categories": output_categories if not use_expert_summary_mode else None
#             }
#         }

#     except Exception as e:
#         logger.exception("Second-stage feature processing failed")
#         raise HTTPException(
#             status_code=500,
#             detail=f"Feature processing error: {str(e)}"
#         )



@router.post("/process-feature-with-fetched-data1")
async def process_feature_with_fetched_data(request: Request):
    """
    Second-stage Feature Processing with Dynamic Prompt Generation
    """

    try:
        payload = await request.json()

        doctor_id = payload.get("doctor_id")
        # ---------------------------------------------------------
        # 🔎 FETCH DOCTOR SPECIALITY
        # ---------------------------------------------------------
        doctor_doc = doctor_user_collection.find_one(
            {"sys_user_id": doctor_id},   # use sys_user_id
            {"_id": 0}
        )

        logger.info(f"[RULE DEBUG] Doctor Document: {doctor_doc}")

        doctor_speciality = None
        if doctor_doc:
            doctor_speciality = doctor_doc.get("speciality") or doctor_doc.get("specialization")

        logger.info(f"[RULE DEBUG] Doctor Speciality: {doctor_speciality}")
        logger.info(f"[RULE DEBUG] Doctor ID: {doctor_id}")
        logger.info(f"[RULE DEBUG] Doctor Speciality: {doctor_speciality}")


        # ---------------------------------------------------------
        # 🔎 FETCH DOCTOR-SPECIFIC RULE
        # ---------------------------------------------------------
        doctor_rule = doctor_medical_current_rule_collection.find_one(
            {"doctor_id": doctor_id},
            {"_id": 0}
        )

        # If doctor rule exists but inactive → ignore it
        if doctor_rule and not doctor_rule.get("is_active", True):
            doctor_rule = None

        if doctor_rule:
            logger.info("[RULE DEBUG] Doctor-specific rule FOUND and ACTIVE")
        else:
            logger.info("[RULE DEBUG] Doctor-specific rule NOT found or inactive")


        # ---------------------------------------------------------
        # 🔎 FALLBACK TO ADMIN RULE
        # ---------------------------------------------------------
        if not doctor_rule and doctor_speciality:
            admin_rule = medical_current_rule_collection.find_one(
                {"speciality": doctor_speciality},
                {"_id": 0}
            )
        else:
            admin_rule = None
        if admin_rule:
            logger.info("[RULE DEBUG] Admin rule FOUND for speciality")
        else:
            logger.info("[RULE DEBUG] Admin rule NOT found")

        final_rule = doctor_rule if doctor_rule else admin_rule
        if doctor_rule:
            logger.info("[RULE DEBUG] FINAL RULE SOURCE: DOCTOR CONFIGURATION")
        elif admin_rule:
            logger.info("[RULE DEBUG] FINAL RULE SOURCE: ADMIN DEFAULT")
        else:
            logger.info("[RULE DEBUG] FINAL RULE SOURCE: NONE (No rule applied)")


        # Extract rule fields
        # Extract rule fields (NEW FORMAT SUPPORT)

        medical_context_categories = None
        medical_context_rule = None
        current_context_categories = None
        current_context_rule = None

        if final_rule:

            # ---------------- MEDICAL CONTEXT ----------------
            medical_rules = final_rule.get("medical_context", [])

            if medical_rules:
                medical_context_categories = [
                    item.get("medical_output_category")
                    for item in medical_rules
                ]

                medical_context_rule = "\n\n".join(
                    f"{item.get('medical_output_category')}:\n{item.get('rule_text')}"
                    for item in medical_rules
                )
                # ✅ LOGGER FOR MEDICAL RULES
                logger.info("====== MEDICAL CONTEXT RULES ======")
                for item in medical_rules:
                    logger.info(f"Category: {item.get('medical_output_category')}")
                    logger.info(f"Rule Text: {item.get('rule_text')}")
                    logger.info("-----------------------------------")
                    # ---------------- CURRENT CONTEXT ----------------
                    current_rules = final_rule.get("current_context", [])

            if current_rules:
                current_context_categories = [
                    item.get("current_output_category")
                    for item in current_rules
                ]

                current_context_rule = "\n\n".join(
                    f"{item.get('current_output_category')}:\n{item.get('rule_text')}"
                    for item in current_rules
                )
                # ✅ LOGGER FOR CURRENT RULES
                logger.info("====== CURRENT CONTEXT RULES ======")
                for item in current_rules:
                    logger.info(f"Category: {item.get('current_output_category')}")
                    logger.info(f"Rule Text: {item.get('rule_text')}")
                    logger.info("-----------------------------------")
                    logger.info(f"[RULE DEBUG] Medical Categories: {medical_context_categories}")
                    logger.info(f"[RULE DEBUG] Current Categories: {current_context_categories}")

            logger.info(
                f"[RULE DEBUG] Medical Rule Text: {medical_context_rule[:300] if medical_context_rule else None}"
            )
            logger.info(
                f"[RULE DEBUG] Current Rule Text: {current_context_rule[:300] if current_context_rule else None}"
            )
        patient_id = payload.get("patient_id")
        feature_id = payload.get("feature_id")
        dictation = payload.get("dictation")

        if not doctor_id or not patient_id or not feature_id:
            raise HTTPException(
                status_code=400,
                detail="doctor_id, patient_id, feature_id are required"
            )

        # ---------------------------------------------------------
        # 1️⃣ FEATURE META (SIMPLIFIED)
        # ---------------------------------------------------------
        feature_name = feature_id
        rules = None
        output_categories = None
        display_method = None

        FEATURE_DEFAULT_OUTPUTS = {
            "medical-clinical-context": ["medical_context"],
            "current-clinical-context": ["current_context"],
            "documentation-treatment-plan": ["documentation"],
        }

        use_expert_summary_mode = not output_categories
        output_categories = FEATURE_DEFAULT_OUTPUTS.get(feature_id, [])

        # ---------------------------------------------------------
        # 2️⃣ FETCH STRUCTURED CLINICAL DATA
        # ---------------------------------------------------------
        clinical_data = {}

        # ---------------- MEDICAL CONTEXT ----------------
        doc = await medical_context_collection.find_one(
            {"patient_id": patient_id}, {"_id": 0}
        )

        if doc:
            medical_context = []
            for ctx in doc.get("medical_contexts", []):
                texts = [c.get("text") for c in ctx.get("conditions", []) if c.get("text")]
                if texts:
                    medical_context.append({
                        "date": ctx.get("date"),
                        "conditions": texts
                    })
            if medical_context:
                clinical_data["medical_context"] = medical_context

        # ---------------- CURRENT CONTEXT ----------------
        doc = await current_context_collection.find_one(
            {"patient_id": patient_id}, {"_id": 0}
        )

        if doc:
            current_context = []
            for ctx in doc.get("current_contexts", []):
                texts = [c.get("text") for c in ctx.get("current_condition", []) if c.get("text")]
                if texts:
                    current_context.append({
                        "date": ctx.get("date"),
                        "current_condition": texts
                    })
            if current_context:
                clinical_data["current_context"] = current_context

        # ---------------- VITALS ----------------
        vitals_doc = await patient_vitals_collection.find_one(
            {"sys_user_id": patient_id},
            {"_id": 0, "vitals": 1}
        )

        if vitals_doc and vitals_doc.get("vitals"):
            clinical_data["vitals"] = vitals_doc["vitals"]

        # ---------------- CHIEF COMPLAINTS ----------------
        chief_complaints = await fetch_all_appointments_for_patient(patient_id)
        if chief_complaints:
            clinical_data["chief_complaints"] = chief_complaints

        # ---------------- DOCUMENTS ----------------
        latest_documents = []
        cursor = (
            document_categories_collection
            .find({"patient_id": patient_id}, {"_id": 0, "processed_data": 1})
            .sort("_id", -1).limit(3)

            .limit(3)
        )

        async for d in cursor:
            if d.get("processed_data"):
                latest_documents.append(d["processed_data"])

        if latest_documents:
            clinical_data["documents"] = latest_documents

        clinical_data["documentation_features"] = await fetch_latest_documentation_features(
            patient_id, 5
        )



        # ---------------------------------------------------------
        # 🧾 FETCH PATIENT DETAILS (DEMOGRAPHICS)
        # ---------------------------------------------------------
        patient_details = {}

        patient_doc = patient_user_collection.find_one(
            {"sys_user_id": patient_id},
            {
                "_id": 0,
                "name": 1,
                "date_of_birth": 1,
                "blood_group": 1,
                "gender": 1,
                "family_history": 1
            }
        )

        if patient_doc:
            # Calculate age safely
            age = None
            dob_str = patient_doc.get("date_of_birth")

            if dob_str:
                try:
                    dob = datetime.strptime(dob_str, "%Y-%m-%d").date()
                    today = datetime.utcnow().date()
                    age = today.year - dob.year - (
                        (today.month, today.day) < (dob.month, dob.day)
                    )
                except Exception:
                    logger.warning("Invalid DOB format while computing age")

            patient_details = {
                "name": patient_doc.get("name"),
                "age": age,
                "blood_group": patient_doc.get("blood_group"),
                "sex": patient_doc.get("gender"),   # mapping gender → sex
                "family_history": patient_doc.get("family_history")
            }
        patient_details_json = json.dumps( patient_details if patient_details else {}, indent=2, default=str )
        logger.info(f"patient_details_json:{patient_details_json}")    
        # ---------------------------------------------------------
        # 🧠 3️⃣ FETCH LATEST AGENTIC OUTPUT (NEW)
        # ---------------------------------------------------------
        agentic_output = None

        agentic_doc = await summary_collection.find_one(
            {
                "patient_id": patient_id,
                "doctor_id": doctor_id
            },
            {"_id": 0},
            sort=[("generated_at", -1)]
        )

        if agentic_doc:
            agentic_output = {
                "clinical_summary": agentic_doc.get("clinical_summary", ""),

                "timeline": {
                    "timeline": agentic_doc.get("timeline", {}).get("timeline", []),
                    "diagnostic_delays": agentic_doc.get("timeline", {}).get("diagnostic_delays", []),
                    "progression_markers": agentic_doc.get("timeline", {}).get("progression_markers", []),
                    "disease_velocity": agentic_doc.get("timeline", {}).get("disease_velocity", ""),
                    "velocity_rationale": agentic_doc.get("timeline", {}).get("velocity_rationale", ""),
                    "causal_narrative": agentic_doc.get("timeline", {}).get("causal_narrative", "")
                },

                "treatment_timeline": agentic_doc.get("treatment_context", {}).get("treatment_timeline", {})
            }

        has_agentic_data = agentic_output is not None

        logger.info("has_agentic_data=%s", has_agentic_data)
        logger.info("agentic_output=%s", agentic_output)
        
        # ---------------- TEMP REUSABLE DATA ----------------
        temp_doc = temp_data_collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0}
        )

        if temp_doc:
            temp_clinical_data = {}

            # dynamically extract all temp fields except identifiers
            for key, value in temp_doc.items():
                if key not in ["patient_id", "doctor_id", "created_at"]:
                    temp_clinical_data[key] = value

            if temp_clinical_data:
                clinical_data["temp_data"] = temp_clinical_data
        temp_data_json = json.dumps(
            clinical_data.get("temp_data", {}),
            indent=2,
            default=str
        )
        logger.info(f"temp data:{temp_data_json}")
        # ---------------------------------------------------------
        # 4️⃣ CONVERSATION (OPTIONAL)
        # ---------------------------------------------------------
        conversation_text = None
        conversation_doc = await database["conversation_user"].find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id},
            {"_id": 0}
        )
        if conversation_doc:
            conversation_text = conversation_doc.get("conversation")
        clinical_data_json = json.dumps(clinical_data, indent=2, default=str)

        # ---------------------------------------------------------
        # 5️⃣ PROMPT CONSTRUCTION (UPDATED)
        # ---------------------------------------------------------
        if use_expert_summary_mode:

            # ================= MEDICAL CONTEXT =================
            if feature_id == "medical-clinical-context":

                if has_agentic_data:
                    prompt = f"""

You are a clinical documentation synthesizer.

════════════════════════════════════
SPECIALITY RULE (PRIMARY AUTHORITY)
════════════════════════════════════
The following rule defines how the output MUST be written.
You MUST strictly follow this rule.

{medical_context_rule}

════════════════════════════════════
OUTPUT CATEGORIES
════════════════════════════════════
Return ONLY valid JSON.

Use EXACTLY these keys:

{medical_context_categories}

Each category MUST be a SINGLE STRING PARAGRAPH.
Do NOT create nested JSON.
Do NOT create sub-keys.

════════════════════════════════════
SOURCE DATA (FACTUAL ONLY)
════════════════════════════════════

PATIENT DEMOGRAPHICS:
{patient_details_json}

STRUCTURED CLINICAL DATA:
{temp_data_json}

AGENTIC OUTPUT:
{agentic_output}

════════════════════════════════════
GLOBAL SAFETY RULES (NON-NEGOTIABLE)
════════════════════════════════════
- Use ONLY information present in input data.
- Do NOT hallucinate or invent facts.
- Do NOT add external medical knowledge.
- If data is missing, state that it is not available in records.
- Maintain professional clinical language.

════════════════════════════════════
OUTPUT REQUIREMENT
════════════════════════════════════
Generate concise, clinically structured paragraphs according to the SPECIALITY RULE.

Return ONLY valid JSON.
"""
                else:
                    prompt = f"""
You are a clinical documentation synthesizer.

══════════════════════════════
SPECIALITY RULE (PRIMARY AUTHORITY)
══════════════════════════════
Follow the speciality rule below when structuring and writing the output.
The rule defines clinical style, structure, and expectations.

{medical_context_rule}

══════════════════════════════
PATIENT DEMOGRAPHICS (AUTHORITATIVE)
══════════════════════════════
{patient_details_json}

══════════════════════════════
SOURCE OF TRUTH
══════════════════════════════
The structured JSON below contains validated clinical data.
This is the ONLY source of information you may use.

If a detail is not explicitly present, DO NOT include it.

STRICT PROHIBITIONS:
- No hallucination
- No external medical knowledge
- No interpretation beyond documented facts
- No diagnosis unless explicitly documented
- No assumptions

══════════════════════════════
AVAILABLE CLINICAL DATA
══════════════════════════════
{clinical_data_json}

══════════════════════════════
OPTIONAL CONTEXT (WORDING ONLY)
══════════════════════════════
Conversation:
{conversation_text if conversation_text else "Not available"}

Dictation:
{dictation if dictation else "Not available"}

Optional context may clarify wording ONLY.
It must NEVER introduce new medical facts.

══════════════════════════════
GLOBAL SYNTHESIS RULES
══════════════════════════════
1. Extract only explicitly documented facts.
2. Combine information from ALL available domains.
3. Preserve factual wording where possible.
4. Maintain concise, professional clinical language.
5. Avoid repetition or unnecessary expansion.
6. Organize content logically following the SPECIALITY RULE.

══════════════════════════════
OUTPUT FORMAT (STRICT)
══════════════════════════════
Return ONLY valid JSON.

Use EXACTLY these keys:
{medical_context_categories}

Each category MUST be:
- A SINGLE STRING PARAGRAPH
- Clinically concise
- Factually grounded

STRICT JSON RULES:
- Do NOT create nested JSON objects
- Do NOT create sub-keys
- Do NOT use ":" inside keys
- Do NOT output lists or dictionaries
- ONLY plain paragraph text as values

Example format:
{{
  "{medical_context_categories[0] if medical_context_categories else "medical_context"}": "Concise clinical paragraph..."
}}
"""

            # ================= CURRENT CLINICAL CONTEXT =================
            elif feature_id == "current-clinical-context":

                if has_agentic_data:
                    prompt = f"""

You are a clinical reasoning synthesizer.

══════════════════════════════
SPECIALITY RULE (PRIMARY AUTHORITY)
══════════════════════════════
Follow the speciality rule below when structuring and writing the output.
This rule defines clinical interpretation style and expectations.

{current_context_rule}

══════════════════════════════
OUTPUT CATEGORIES
══════════════════════════════
Return ONLY valid JSON using EXACTLY these keys:

{current_context_categories}

Each category MUST be a SINGLE STRING PARAGRAPH.

══════════════════════════════
SOURCE DATA (AUTHORITATIVE)
══════════════════════════════

PATIENT DEMOGRAPHICS:
{patient_details_json}

STRUCTURED CLINICAL DATA:
{temp_data_json}

AGENTIC OUTPUT:
{agentic_output}

══════════════════════════════
OPTIONAL CONTEXT (WORDING ONLY)
══════════════════════════════
Conversation:
{conversation_text if conversation_text else "Not available"}

Dictation:
{dictation if dictation else "Not available"}

Optional context may clarify wording or timing ONLY.
It MUST NOT introduce new diagnoses, findings, tests, or values.

══════════════════════════════
GLOBAL REASONING RULES
══════════════════════════════
- Reason ONLY from structured clinical data and agentic output.
- Identify current problems, diagnoses, severity, and risks ONLY when supported.
- Integrate staging, prognosis, and treatment context when explicitly present.
- Maintain concise clinician-to-clinician language.
- Avoid repetition or unnecessary expansion.

STRICT PROHIBITIONS:
- No hallucination
- No external medical knowledge
- No assumptions beyond provided data
- No fabrication of clinical details
- Do NOT contradict agentic output

══════════════════════════════
OUTPUT FORMAT (STRICT JSON)
══════════════════════════════
Return ONLY valid JSON.

STRICT JSON RULES:
- Each category MUST be a SINGLE STRING PARAGRAPH
- Do NOT create nested JSON objects
- Do NOT create sub-keys
- Do NOT output lists or dictionaries
- Values must be plain text paragraphs

Example format:
{{
  "{current_context_categories[0] if current_context_categories else "current_context"}": "Concise clinical reasoning summary..."
}}
"""
                else:
                    prompt = f"""
You are a clinical reasoning synthesizer.

══════════════════════════════
SPECIALITY RULE (PRIMARY AUTHORITY)
══════════════════════════════
Follow the speciality rule below when generating the Clinical Context.
This rule defines clinical interpretation style and structure.

{current_context_rule}

══════════════════════════════
TASK
══════════════════════════════
Construct the patient's Clinical Context as a concise clinician-to-clinician summary.

Clinical Context integrates:
- diagnoses
- severity and risks
- treatment status
- overall clinical picture

══════════════════════════════
PATIENT DEMOGRAPHICS
══════════════════════════════
{patient_details_json}

══════════════════════════════
SOURCE DATA (AUTHORITATIVE)
══════════════════════════════
You MUST reason ONLY from the validated structured data below.

{clinical_data_json}

Rules:
- Do NOT invent or hallucinate information.
- Do NOT add external medical knowledge.
- If a detail is absent, omit it.

══════════════════════════════
OPTIONAL CONTEXT (WORDING ONLY)
══════════════════════════════
Conversation:
{conversation_text if conversation_text else "Not available"}

Dictation:
{dictation if dictation else "Not available"}

Optional context may clarify wording or timing ONLY.
It MUST NOT introduce new medical facts.

══════════════════════════════
ALLOWED CLINICAL REASONING
══════════════════════════════
You MAY:
- correlate symptoms, labs, imaging, and treatments
- identify likely diagnoses when supported
- summarize severity or stage when evidence exists
- integrate related findings into a coherent clinical picture
- describe treatment status or progression

══════════════════════════════
VITAL SIGNS OVERRIDE (STRICT)
══════════════════════════════
For vital signs:
- Use ONLY the most recent entry
- Ignore historical values
- Report numbers exactly as recorded
- Do NOT interpret or describe trends

══════════════════════════════
RESTRICTIONS
══════════════════════════════
- No hallucination
- No assumptions beyond provided data
- No contradictions of structured data

══════════════════════════════
OUTPUT FORMAT (STRICT JSON)
══════════════════════════════
Return ONLY valid JSON.

Use EXACTLY these keys:

{current_context_categories}

STRICT JSON RULES:
- Each category MUST be a SINGLE STRING PARAGRAPH
- Do NOT create nested JSON objects
- Do NOT create sub-keys
- Do NOT output lists or dictionaries
- Values must be plain text paragraphs

Example format:
{{
  "{current_context_categories[0] if current_context_categories else "current_context"}": "Concise clinical reasoning summary..."
}}
"""

            # ================= OTHER FEATURES =================
            else:
                prompt = f"""
Extract ONLY documented facts.

DATA:
{json.dumps(clinical_data, indent=2, default=str)}

Return JSON:
{{"summary":"Concise paragraph"}}
"""

        # ---------------------------------------------------------
        # STRUCTURED MODE (UNCHANGED)
        # ---------------------------------------------------------
        else:
            prompt = f"""
Generate structured outputs for:
{output_categories}

DATA:
{json.dumps(clinical_data, indent=2, default=str)}
"""
        # ---------------------------------------------------------
        # 🔎 DEBUG PROMPT VARIABLES
        # ---------------------------------------------------------

        logger.info("========== PROMPT DEBUG START ==========")

        logger.info(f"Feature ID: {feature_id}")

        # Medical context rule check
        logger.info(f"Medical Rule Present: {bool(medical_context_rule)}")
        logger.info(f"Medical Rule Text: {medical_context_rule}")

        # Medical categories check
        logger.info(f"Medical Output Categories: {medical_context_categories}")

        # Current context rule check
        logger.info(f"Current Rule Present: {bool(current_context_rule)}")
        logger.info(f"Current Rule Text: {current_context_rule}")

        # Current categories check
        logger.info(f"Current Output Categories: {current_context_categories}")

        logger.info("========== PROMPT DEBUG END ==========")

        # ---------------------------------------------------------
        # 6️⃣ LLM EXECUTION
        # ---------------------------------------------------------
        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            response_format={"type": "json_object"},
            max_tokens=4000
        )

        llm_output = json.loads(completion.choices[0].message.content)
        # ---------------------------------------------------------
        # 🔎 LOG CATEGORY-WISE PROCESSED OUTPUT (FIXED VERSION)
        # ---------------------------------------------------------

        logger.info(f"[DEBUG] FULL LLM OUTPUT: {json.dumps(llm_output, indent=2)}")

        # ================= MEDICAL CONTEXT =================
        if feature_id == "medical-clinical-context" and medical_context_categories:
            logger.info("====== MEDICAL CONTEXT CATEGORY OUTPUT START ======")

            fallback_value = (
                llm_output.get("medical_context")
                or llm_output.get("clinical_context")
            )

            for category in medical_context_categories:
                if category in llm_output:
                    value = llm_output[category]
                elif fallback_value:
                    value = f"[FALLBACK FROM SINGLE OUTPUT] {fallback_value}"
                else:
                    value = "No content returned by LLM"

                logger.info(f"[MEDICAL CONTEXT] {category}: {value}")

            logger.info("====== MEDICAL CONTEXT CATEGORY OUTPUT END ======")


        # ================= CURRENT CONTEXT =================
        if feature_id == "current-clinical-context" and current_context_categories:
            logger.info("====== CURRENT CONTEXT CATEGORY OUTPUT START ======")

            fallback_value = (
                llm_output.get("clinical_context")
                or llm_output.get("medical_context")
            )

            for category in current_context_categories:
                if category in llm_output:
                    value = llm_output[category]
                elif fallback_value:
                    value = f"[FALLBACK FROM SINGLE OUTPUT] {fallback_value}"
                else:
                    value = "No content returned by LLM"

                logger.info(f"[CURRENT CONTEXT] {category}: {value}")

            logger.info("====== CURRENT CONTEXT CATEGORY OUTPUT END ======")
        # ---------------------------------------------------------
        # 7️⃣ RESPONSE
        # ---------------------------------------------------------
        return {
            "status": "success",
            "feature_id": feature_id,
            "feature_name": feature_name,
            "display_method": display_method,
            "mode": "expert_summary" if use_expert_summary_mode else "structured",
            "finaloutput": llm_output,
            "metadata": {
                "doctor_id": doctor_id,
                "patient_id": patient_id,
                "output_categories": output_categories if not use_expert_summary_mode else None
            }
        }

    except Exception as e:
        logger.exception("Second-stage feature processing failed")
        raise HTTPException(
            status_code=500,
            detail=f"Feature processing error: {str(e)}"
        )









##########################################Alwin Prognosis section#########################################################


@router.post("/generate_prognosis_analysis")
async def generate_prognosis_analysis(request: Request):
    """
    Feature-driven clinical prognosis analysis.
    Analyzes prognosis based on aggregated documentation data from multiple collections,
    including current dictation to track progression since last visit.
    """
    
    try:
        # ---------------------------------------------------------
        # 0️⃣ EXTRACT PAYLOAD (FRONTEND DRIVEN)
        # ---------------------------------------------------------
        body = await request.json()
        
        doctor_id = body.get("doctor_id")
        patient_id = body.get("patient_id")
        objectives = body.get("objectives", "")
        current_dictation = body.get("current_dictation", "")  # NEW: Current dictation from frontend
        
        # Optional frontend overrides
        agentic_output = body.get("agentic_output")
        temp_data = body.get("temp_data")
        
        logger.info("=" * 80)
        logger.info("PROGNOSIS ANALYSIS - REQUEST START")
        logger.info("=" * 80)
        logger.info("Received payload for prognosis analysis: %s", json.dumps(body, indent=2, default=str))
        
        if not doctor_id or not patient_id:
            raise HTTPException(
                status_code=400,
                detail="doctor_id and patient_id are required"
            )
        
        logger.info(
            "Prognosis analysis started | doctor_id=%s | patient_id=%s | dictation_length=%s",
            doctor_id, patient_id, len(current_dictation) if current_dictation else 0
        )
        
        # ---------------------------------------------------------
        # 1️⃣ FETCH CLINICAL DATA (FROM DATABASE)
        # ---------------------------------------------------------
        logger.info("-" * 80)
        logger.info("1. FETCHING CLINICAL DATA")
        logger.info("-" * 80)
        
        clinical_data = {}
        
        # -------- MEDICAL CONTEXT (Historical Conditions) --------
        medical_doc = await medical_context_collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0}
        )
        
        if medical_doc:
            medical_context = []
            for ctx in medical_doc.get("medical_contexts", []):
                texts = [
                    c.get("text")
                    for c in ctx.get("conditions", [])
                    if c.get("text")
                ]
                if texts:
                    medical_context.append({
                        "date": ctx.get("date"),
                        "conditions": texts
                    })
            if medical_context:
                clinical_data["medical_context"] = medical_context
        
        # -------- CURRENT CONTEXT (Active Conditions) --------
        current_doc = await current_context_collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0}
        )
        
        if current_doc:
            current_context = []
            for ctx in current_doc.get("current_contexts", []):
                texts = [
                    c.get("text")
                    for c in ctx.get("current_condition", [])
                    if c.get("text")
                ]
                if texts:
                    current_context.append({
                        "date": ctx.get("date"),
                        "current_condition": texts
                    })
            if current_context:
                clinical_data["current_context"] = current_context
        
        logger.info("Clinical data fetched: %s", json.dumps(clinical_data, indent=2, default=str))
        
        # ---------------------------------------------------------
        # 2️⃣ FETCH DOCUMENTATION DATA FROM MULTIPLE COLLECTIONS
        # ---------------------------------------------------------
        logger.info("-" * 80)
        logger.info("2. FETCHING DOCUMENTATION DATA FROM COLLECTIONS")
        logger.info("-" * 80)
        
        aggregated_dictation = {
            "treatment_plan": None,
            "investigation_notes": None,
            "medication_analysis": None,
            "clinical_notes": None,
            "treatment_summary": None
        }
        
        # -------- 2.1 TREATMENT PLAN DATA --------
        try:
            treatment_plan_doc = await documentation_treatment_plan_collection.find_one(
                {"patient_id": patient_id, "doctor_id": doctor_id},
                {"_id": 0, "finaloutput": 1}
            )
            if treatment_plan_doc and "finaloutput" in treatment_plan_doc:
                aggregated_dictation["treatment_plan"] = treatment_plan_doc["finaloutput"]
                logger.info("✓ Found treatment plan data")
                logger.debug("Treatment plan sample: %s", 
                           json.dumps(treatment_plan_doc["finaloutput"], indent=2, default=str)[:500] + "...")
        except Exception as e:
            logger.warning("Failed to fetch treatment plan: %s", e)
        
        # -------- 2.2 INVESTIGATION NOTES DATA --------
        try:
            investigation_doc = await documentation_investigation_notes_collection.find_one(
                {"patient_id": patient_id, "doctor_id": doctor_id},
                {"_id": 0, "finaloutput": 1}
            )
            if investigation_doc and "finaloutput" in investigation_doc:
                aggregated_dictation["investigation_notes"] = investigation_doc["finaloutput"]
                logger.info("✓ Found investigation notes data")
                logger.debug("Investigation notes sample: %s", 
                           json.dumps(investigation_doc["finaloutput"], indent=2, default=str)[:500] + "...")
        except Exception as e:
            logger.warning("Failed to fetch investigation notes: %s", e)
        
        # -------- 2.3 MEDICATION ANALYSIS DATA --------
        try:
            medication_doc = await documentation_medication_analysis_collection.find_one(
                {"patient_id": patient_id, "doctor_id": doctor_id},
                {"_id": 0, "finaloutput": 1}
            )
            if medication_doc and "finaloutput" in medication_doc:
                aggregated_dictation["medication_analysis"] = medication_doc["finaloutput"]
                logger.info("✓ Found medication analysis data")
                logger.debug("Medication analysis sample: %s", 
                           json.dumps(medication_doc["finaloutput"], indent=2, default=str)[:500] + "...")
        except Exception as e:
            logger.warning("Failed to fetch medication analysis: %s", e)
        
        # -------- 2.4 CLINICAL NOTES DATA --------
        try:
            clinical_notes_doc = await documentation_clinical_notes_collection.find_one(
                {"patient_id": patient_id, "doctor_id": doctor_id},
                {"_id": 0, "finaloutput": 1}
            )
            if clinical_notes_doc and "finaloutput" in clinical_notes_doc:
                aggregated_dictation["clinical_notes"] = clinical_notes_doc["finaloutput"]
                logger.info("✓ Found clinical notes data")
                logger.debug("Clinical notes sample: %s", 
                           json.dumps(clinical_notes_doc["finaloutput"], indent=2, default=str)[:500] + "...")
        except Exception as e:
            logger.warning("Failed to fetch clinical notes: %s", e)
        
        # -------- 2.5 TREATMENT SUMMARY DATA --------
        try:
            treatment_summary_doc = await documentation_treatment_summary_collection.find_one(
                {"patient_id": patient_id, "doctor_id": doctor_id},
                {"_id": 0, "finaloutput": 1}
            )
            if treatment_summary_doc and "finaloutput" in treatment_summary_doc:
                aggregated_dictation["treatment_summary"] = treatment_summary_doc["finaloutput"]
                logger.info("✓ Found treatment summary data")
                logger.debug("Treatment summary sample: %s", 
                           json.dumps(treatment_summary_doc["finaloutput"], indent=2, default=str)[:500] + "...")
        except Exception as e:
            logger.warning("Failed to fetch treatment summary: %s", e)
        
        # -------- 2.6 SAVE CURRENT DICTATION TO DATABASE --------
        if current_dictation:
            try:
                # Save current dictation to a collection for future reference
                dictation_record = {
                    "doctor_id": doctor_id,
                    "patient_id": patient_id,
                    "dictation_text": current_dictation,
                    "timestamp": datetime.utcnow(),
                    "source": "prognosis_analysis_endpoint"
                }
                
                # Save to dictation collection
                await dictation_collection.insert_one(dictation_record)
                logger.info("✓ Current dictation saved to database (%s characters)", len(current_dictation))
                
            except Exception as e:
                logger.warning("Failed to save current dictation: %s", e)
        
        # -------- 2.7 LOG AGGREGATED DATA --------
        logger.info("=" * 80)
        logger.info("AGGREGATED DOCUMENTATION DATA SUMMARY:")
        logger.info("=" * 80)
        for key, value in aggregated_dictation.items():
            if value:
                logger.info("✓ %s: Data available (%s bytes)", 
                           key.replace('_', ' ').title(), 
                           len(json.dumps(value)) if isinstance(value, (dict, list)) else len(str(value)))
            else:
                logger.info("✗ %s: No data found", key.replace('_', ' ').title())
        
        logger.info("✓ Current dictation: %s characters", len(current_dictation) if current_dictation else 0)
        
        # Log raw aggregated data
        logger.debug("-" * 80)
        logger.debug("RAW AGGREGATED DATA DUMP:")
        logger.debug("-" * 80)
        for key, value in aggregated_dictation.items():
            if value:
                logger.debug("\n%s:\n%s", key.upper(), json.dumps(value, indent=2, default=str)[:1000])
        logger.info("=" * 80)
        
        # -------- 2.8 CREATE CONCATENATED DICTATION TEXT --------
        dictation_sections = []
        
        if aggregated_dictation["treatment_plan"]:
            dictation_sections.append("TREATMENT PLAN:\n" + json.dumps(aggregated_dictation["treatment_plan"], indent=2))
        
        if aggregated_dictation["investigation_notes"]:
            dictation_sections.append("INVESTIGATION NOTES:\n" + json.dumps(aggregated_dictation["investigation_notes"], indent=2))
        
        if aggregated_dictation["medication_analysis"]:
            dictation_sections.append("MEDICATION ANALYSIS:\n" + json.dumps(aggregated_dictation["medication_analysis"], indent=2))
        
        if aggregated_dictation["clinical_notes"]:
            dictation_sections.append("CLINICAL NOTES:\n" + json.dumps(aggregated_dictation["clinical_notes"], indent=2))
        
        if aggregated_dictation["treatment_summary"]:
            dictation_sections.append("TREATMENT SUMMARY:\n" + json.dumps(aggregated_dictation["treatment_summary"], indent=2))
        
        # Create final dictation text
        if dictation_sections:
            historical_dictation_text = "\n\n" + "═" * 50 + "\n\n".join(dictation_sections) + "\n\n" + "═" * 50
            logger.info("Created historical dictation text (%s sections, %s characters)", 
                       len(dictation_sections), len(historical_dictation_text))
        else:
            historical_dictation_text = "No historical documentation data found in any collections for this patient and doctor."
            logger.warning("No historical documentation data found for patient_id=%s, doctor_id=%s", patient_id, doctor_id)
        
        # ---------------------------------------------------------
        # 3️⃣ FETCH AGENTIC OUTPUT (FROM DB IF NOT PROVIDED)
        # ---------------------------------------------------------
        # Fetch Agentic Data
        agentic_output = None
        agentic_doc = agentic_data_collection.find_one(
            {
                "patient_id": patient_id,
                "doctor_id": doctor_id
            },
            {
                "_id": 0,
                "data": 1,
                "version": 1
            },
            sort=[("version", -1)]
        )

        if agentic_doc and agentic_doc.get("data"):
            agentic_output = agentic_doc["data"]

        has_agentic_data = agentic_output is not None
        logger.info("has_agentic_data=%s", has_agentic_data)
        logger.info(f"Agentic data: {agentic_output}")

        # Fetch Temp Data
        temp_data = None
        temp_doc = temp_data_collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0}
        )

        if temp_doc:
            temp_clinical_data = {}

            # Dynamically extract all temp fields except identifiers
            for key, value in temp_doc.items():
                if key not in ["patient_id", "doctor_id", "created_at"]:
                    temp_clinical_data[key] = value

            if temp_clinical_data:
                clinical_data["temp_data"] = temp_clinical_data

        temp_data_json = json.dumps(
            clinical_data.get("temp_data", {}),
            indent=2,
            default=str
        )
        logger.info(f"Temp data: {temp_data_json}")
        
        # ---------------------------------------------------------
        # 5️⃣ PROMPT CONSTRUCTION FOR PROGNOSIS ANALYSIS
        # ---------------------------------------------------------
        logger.info("-" * 80)
        logger.info("5. CONSTRUCTING PROMPT FOR LLM")
        logger.info("-" * 80)
        
        # Prepare data for prompt
        agentic_json = json.dumps(agentic_output, indent=2, default=str) \
            if agentic_output else "No agentic intelligence available."
        
        temp_data_text = json.dumps(temp_data, indent=2, default=str) \
            if temp_data else "No cached patient data available."
        
        clinical_data_text = json.dumps(clinical_data, indent=2, default=str) \
            if clinical_data else "No structured clinical data available."
        
        objectives_text = objectives if objectives else "No specific objectives provided."
        
        # Create combined dictation text with progression analysis
        combined_dictation_text = f"""
════════════════════════════════════
HISTORICAL DOCUMENTATION DATA (Previous Visits)
════════════════════════════════════
{historical_dictation_text}

════════════════════════════════════
CURRENT DICTATION (Current Visit)
════════════════════════════════════
{current_dictation if current_dictation else "No current dictation provided."}
"""
        
        prompt = f"""
You are an AI-DRIVEN CLINICAL PROGNOSIS ANALYSIS AND SCORING ENGINE.
Your role is to provide OBJECTIVE, EXPLAINABLE insights on:
1. Patient prognosis considering progression since last visit
2. Quality of care delivered  
3. Treatment sufficiency & completion

DOCTOR AUTHORITY IS ABSOLUTE.
AI provides OPTIONAL, NON-INTRUSIVE suggestions only.

════════════════════════════════════
AUTHORITATIVE CONTEXT HIERARCHY (PRIORITY ORDER)
════════════════════════════════════

1️⃣ CURRENT DICTATION (MOST RECENT)
   - Latest clinical assessment
   - Current symptoms and status
   - Today's treatment decisions

2️⃣ AGENTIC CONTEXT VERSION SYSTEM (HIGHEST INTELLIGENCE)
   - Disease understanding & staging
   - Severity assessment
   - Prior clinical reasoning
   - Safety intelligence

3️⃣ HISTORICAL DOCUMENTATION DATA (PREVIOUS VISITS)
   - Treatment plans
   - Investigation notes  
   - Medication analysis
   - Clinical notes
   - Treatment summaries

4️⃣ TEMP CLINICAL CONTEXT (CACHED DATA)
   - Recent labs, vitals, trends
   - Current medications & investigations
   - Previous dictations & assessments

5️⃣ STRUCTURED CLINICAL DATA (HISTORICAL)
   - Medical history & comorbidities
   - Current active conditions
   - Treatment timeline

════════════════════════════════════
INPUT DATA
════════════════════════════════════

COMBINED DOCUMENTATION DATA (Historical + Current):
{combined_dictation_text}

TREATMENT OBJECTIVES:
{objectives_text}

AGENTIC CLINICAL INTELLIGENCE:
{agentic_json}

TEMP PATIENT CONTEXT (Cached Data):
{temp_data_text}

STRUCTURED CLINICAL DATA:
{clinical_data_text}

════════════════════════════════════
PHASE 1: PROGRESSION ANALYSIS (Last Visit → Current)
════════════════════════════════════

Analyze the progression from historical documentation to current dictation:

A) PROGRESSION PATTERN
   - Compare symptom evolution from last visit to now
   - Track investigation result trends (labs, imaging)
   - Assess treatment response and adherence
   - Note new findings or complications

B) PROGNOSIS EVOLUTION
   - Extract exact prognosis statements from historical documentation
   - Extract exact prognosis statements from current dictation
   - Identify changes in prognosis outlook
   - Note factors driving prognosis change

C) RISK FACTOR EVOLUTION
   - Compare risk factors mentioned in historical vs current
   - Identify new or resolved risk factors
   - Assess changing risk levels

D) STATUS COMPARISON
   - Historical improvement status vs current status
   - Treatment response changes
   - Functional capacity changes

IMPORTANT RULE: For ALL extracted fields, you MUST:
1. Use EXACT quotes from documentation - copy verbatim text
2. Do NOT add prefixes like "EXACT:" or "EVIDENCE:"
3. Do NOT add document references or brackets
4. Do NOT paraphrase or summarize
5. If no exact text exists, state what is missing in plain clinical language

════════════════════════════════════
PHASE 2: PROGNOSIS ANALYSIS ENGINE (CURRENT STATUS)
════════════════════════════════════

ANALYZE CURRENT STATUS BASED ON PROGRESSION:
1. Current disease stage & severity from current dictation
2. Treatment response based on progression analysis
3. Investigation trends from historical to current
4. Comorbidities impact considering progression
5. Current complications or adverse events

PROGNOSIS CATEGORIZATION (Select ONE based on CURRENT status):
- FAVORABLE: Expected positive outcome, low complication risk
- GUARDED: Uncertain outcome, moderate risk
- POOR: High risk of negative outcome
- UNCERTAIN: Insufficient data for clear prognosis

OUTPUT REQUIREMENTS:
A) Short-term outcome likelihood (0-30 days) based on current status
B) Long-term outcome likelihood (6+ months) considering progression  
C) Risk of deterioration or relapse probability based on trends
D) Confidence level in prognosis assessment

════════════════════════════════════
PHASE 3: CARE QUALITY SCORING ENGINE (OVERALL PROGRESSION)
════════════════════════════════════

EVALUATE 6 QUALITY DIMENSIONS (0-100 scale each) BASED ON OVERALL PROGRESSION:

1. GUIDELINE ADHERENCE (0-100) - based on treatment evolution
2. TIMELINESS (0-100) - based on intervention timing across visits
3. APPROPRIATENESS (0-100) - based on test/treatment adjustments
4. MEDICATION SAFETY (0-100) - based on medication changes
5. MONITORING ADEQUACY (0-100) - based on follow-up frequency
6. DOCUMENTATION COMPLETENESS (0-100) - based on documentation across visits

FOR EACH DIMENSION, YOU MUST:
1. Provide a score (0-100)
2. Give explanation using direct quotes from documentation (historical AND current)
3. Use exact text from documentation to support your scoring
4. Do NOT add "EXACT EVIDENCE:" prefix

OVERALL CARE QUALITY SCORE:
- Calculate weighted average
- Score: 0-100 numerical value

COLOR CODING:
- EXCELLENT: 85-100 (Green)
- ADEQUATE: 70-84 (Yellow)
- NEEDS IMPROVEMENT: 0-69 (Red)

DOCTOR OVERRIDE RULE:
- Score is ADVISORY only
- Doctor may accept, reject, or modify
- AI never auto-modifies without consent

════════════════════════════════════
PHASE 4: TREATMENT SUFFICIENCY & COMPLETION SCORING (CURRENT STATUS)
════════════════════════════════════

ASSESS CURRENT TREATMENT STATUS BASED ON PROGRESSION:
✔ All necessary treatment components present in current dictation
✔ Dose/duration adequacy considering historical treatment
✔ Monitoring completeness based on progression
✔ Patient adherence trends from historical to current
✔ Response assessment documented across timeline

COMPLETION STATUS (Select ONE based on CURRENT status):
- COMPLETE & ADEQUATE: All components addressed, response achieved
- PARTIALLY COMPLETE: Some elements missing but core treatment delivered
- ONGOING (EXPECTED): Treatment continuation appropriate
- INSUFFICIENT: Key components missing, inadequate response
- NEEDS ESCALATION: Current treatment insufficient, higher level needed

SCORING CRITERIA (0-100) based on CURRENT status:
1. Clinical response achieved (0-25) - use exact documentation from current dictation
2. Objective markers normalized (0-25) - use exact documentation from current
3. Symptoms resolved/controlled (0-25) - use exact documentation from current
4. Follow-up plan defined (0-25) - use exact documentation from current dictation

SUFFICIENCY SCORE: 0-100

GAP ANALYSIS:
- List specific missing components using exact documentation from current dictation
- Identify inadequate elements using exact quotes from current
- Note monitoring deficiencies using exact text from current

════════════════════════════════════
PHASE 5: INTEGRATED RECOMMENDATION ENGINE
════════════════════════════════════

Based on PROGRESSION ANALYSIS and CURRENT STATUS, create a SINGLE COMPREHENSIVE SUGGESTION:

FORMAT FOR SUGGESTION:
"Given [progression evidence], [specific clinical action] is recommended to [achieve outcome], considering [rationale based on progression and current status]."

SUGGESTION EXAMPLES:
1. "Given the progressive improvement in symptoms from last visit, continuing the current treatment plan is recommended to maintain therapeutic gains, considering the documented positive response trend."
2. "Considering the partial symptom control despite previous adjustments, optimizing the existing treatment with dosage modification is recommended to achieve full resolution, based on current lab trends and progression."  
3. "Due to persistent symptoms despite treatment progression, escalating care for specialist consultation is recommended to address refractory condition, given the documented lack of improvement across visits."
4. "Based on achieved therapeutic goals and stable progression, de-escalating treatment safely is recommended to reduce medication burden while maintaining stability, as symptoms remain well-controlled."

REQUIREMENTS FOR SUGGESTION:
✅ Must reference progression evidence (historical → current)
✅ Must include direct evidence from current dictation
✅ Must state specific clinical action without "I suggest"
✅ Must specify desired outcome with "to"
✅ Must include rationale based on progression
✅ Must be non-intrusive and optional
✅ Must respect doctor's absolute authority
✅ Use passive/clinical language without personal pronouns

════════════════════════════════════
OUTPUT FORMAT (STRICT JSON FORMAT - MUST RETURN VALID JSON)
════════════════════════════════════

YOU MUST RETURN ONLY VALID JSON OUTPUT.

Return ONLY this exact JSON structure in valid JSON format:

{{
  "documentation_analysis": {{
    "progression_analysis": {{
      "historical_prognosis": [
        "Direct quote from historical documentation about prognosis",
        "Another direct quote about historical prognosis"
      ],
      "current_prognosis": [
        "Direct quote from current dictation about prognosis",
        "Another direct quote about current prognosis"
      ],
      "progression_pattern": "improving/stable/declining/new_onset",
      "risk_factor_evolution": [
        "Direct quote about risk factor changes from historical to current"
      ],
      "treatment_response_trend": "positive/partial/negative/stable"
    }},
    "consistency_check": {{
      "inconsistencies": [],
      "data_alignment": "consistent/partially_consistent/inconsistent",
      "requires_clarification": true/false
    }}
  }},

  "prognosis_analysis": {{
    "disease_assessment": {{
      "stage": "Direct quote from current dictation about disease stage",
      "severity": "mild/moderate/severe/critical",
      "trend_direction": "improving/stable/declining"
    }},
    "prognosis_category": "favorable/guarded/poor/uncertain",
    "outcome_likelihoods": {{
      "short_term": {{
        "probability": "high/medium/low",
        "timeframe": "0-30 days",
        "key_determinants": [
          "Direct quote about determinant 1 from current dictation",
          "Direct quote about determinant 2 from current dictation"
        ]
      }},
      "long_term": {{
        "probability": "high/medium/low", 
        "timeframe": "6+ months",
        "key_determinants": [
          "Direct quote about determinant 1 considering progression",
          "Direct quote about determinant 2 considering progression"
        ]
      }}
    }},
    "risk_assessment": {{
      "deterioration_risk": "high/medium/low",
      "relapse_probability": "high/medium/low",
      "complication_risk": "high/medium/low"
    }},
    "confidence_level": "high/medium/low"
  }},

  "care_quality_score": {{
    "dimension_scores": {{
      "guideline_adherence": {{
        "score": 0-100,
        "explanation": "Direct quote from documentation supporting guideline adherence across visits"
      }},
      "timeliness": {{
        "score": 0-100,
        "explanation": "Direct quote from documentation about timeliness across progression"
      }},
      "appropriateness": {{
        "score": 0-100,
        "explanation": "Direct quote from documentation about test appropriateness considering progression"
      }},
      "medication_safety": {{
        "score": 0-100,
        "explanation": "Direct quote from documentation about medication safety across treatment changes"
      }},
      "monitoring_adequacy": {{
        "score": 0-100,
        "explanation": "Direct quote from documentation about monitoring across visits"
      }},
      "documentation_completeness": {{
        "score": 0-100,
        "explanation": "Direct quote from documentation about documentation completeness"
      }}
    }},
    "overall_score": {{
      "numerical_score": 0-100,
      "color_code": "green/yellow/red",
      "classification": "excellent/adequate/needs_improvement",
      "weighting_explanation": "Brief explanation of score weighting based on progression"
    }},
    "doctor_override_status": {{
      "can_override": true,
      "recommended_action": "accept/consider_modify/review",
      "override_justification_placeholder": "Doctor may override the quality score based on clinical judgment."
    }}
  }},

  "treatment_sufficiency_score": {{
    "completion_status": "complete_adequate/partially_complete/ongoing/insufficient/needs_escalation",
    "criteria_scores": {{
      "clinical_response": {{
        "score": 0-25,
        "achieved": true/false,
        "evidence": "Direct quote showing clinical response from current dictation"
      }},
      "objective_markers": {{
        "score": 0-25,
        "normalized": true/false,
        "evidence": "Direct quote showing objective markers from current dictation"
      }},
      "symptom_control": {{
        "score": 0-25,
        "controlled": true/false,
        "evidence": "Direct quote showing symptom control from current dictation"
      }},
      "follow_up_plan": {{
        "score": 0-25,
        "defined": true/false,
        "plan_details": "Direct quote of follow-up plan from current dictation"
      }}
    }},
    "sufficiency_score": 0-100,
    "gap_analysis": {{
      "missing_components": [
        "Direct quote about missing component from current dictation"
      ],
      "inadequate_elements": [
        "Direct quote about inadequate element from current dictation"
      ],
      "monitoring_deficiencies": [
        "Direct quote about monitoring deficiency from current dictation"
      ]
    }},
    "completion_validation": {{
      "all_required_treatments_present": true/false,
      "dose_duration_adequate": true/false,
      "monitoring_complete": true/false,
      "adherence_addressed": true/false
    }}
  }},

  "integrated_recommendations": {{
    "suggestion": "Given the progressive improvement in symptoms from last visit, continuing the current treatment plan is recommended to maintain therapeutic gains, considering the documented positive response trend.",
    "evidence_basis": "Direct quote from current dictation that supports the recommendation",
    "expected_impact": {{
      "prognosis_impact": "positive/neutral/negative",
      "quality_impact": "improves/maintains/reduces",
      "sufficiency_impact": "completes/partially_completes/no_impact"
    }},
    "suggestion_properties": {{
      "format": "single_comprehensive_tag",
      "intrusiveness": "non_intrusive",
      "authority": "doctor_has_absolute_authority"
    }}
  }},

  "meta_validation": {{
    "analysis_coherence": "high/medium/low",
    "data_sufficiency": "sufficient/partial/insufficient",
    "confidence_in_scores": "high/medium/low",
    "requires_doctor_review": true/false
  }}
}}

════════════════════════════════════
STRICT OUTPUT RULES
════════════════════════════════════

⛔ NO prefixes like "EXACT:", "EVIDENCE:", or "QUOTE:" in any field
⛔ NO document references or brackets like [Clinical Notes]
⛔ NO paraphrasing or summarizing in evidence fields
⛔ NO generic statements like "from clinical notes" or "based on documentation"

✔ ALL evidence fields MUST contain direct quotes from documentation
✔ Use verbatim text without modification
✔ Present quotes cleanly without any prefixes
✔ CURRENT DICTATION quotes must come from current dictation text
✔ HISTORICAL quotes must come from historical documentation
✔ If no exact evidence exists, state what is missing in plain clinical language
✔ Return clean, professional JSON without extraneous text

EXAMPLE FORMATS:
✅ CORRECT: "Patient's blood pressure improved from 160/100 to 120/80 after medication"
✅ CORRECT: "Follow-up scheduled in 2 weeks to monitor progress"
✅ CORRECT: "CT scan shows 30% reduction in tumor size"
❌ WRONG: "EXACT: Patient's blood pressure improved"
❌ WRONG: "Evidence: Follow-up scheduled in 2 weeks"
❌ WRONG: "From clinical notes: CT scan shows improvement"
❌ WRONG: "[Medication Analysis] Dose is appropriate"

MOST IMPORTANT: The output JSON must match the exact structure shown above.
All fields must be present with appropriate values.
Use direct quotes from the provided documentation for all evidence fields.

BEGIN PROGRESSION-BASED PROGNOSIS ANALYSIS AND RETURN VALID JSON.
"""
        
        # Log the prompt size and first/last parts
        logger.info("PROMPT SIZE: %s characters", len(prompt))
        logger.debug("-" * 80)
        logger.debug("PROMPT PREVIEW (first 1000 chars):")
        logger.debug("-" * 80)
        logger.debug(prompt[:1000])
        logger.debug("-" * 80)
        logger.debug("PROMPT PREVIEW (last 1000 chars):")
        logger.debug("-" * 80)
        logger.debug(prompt[-1000:])
        logger.debug("-" * 80)
        
        # ---------------------------------------------------------
        # 6️⃣ LLM EXECUTION
        # ---------------------------------------------------------
        logger.info("=" * 80)
        logger.info("6. SENDING TO LLM FOR PROGNOSIS ANALYSIS")
        logger.info("=" * 80)
        
        logger.info("Calling Groq API with model: llama-3.1-8b-instant")
        logger.info("Request parameters: temperature=0.3, max_tokens=3500")
        
        try:
            completion = groq_client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                response_format={"type": "json_object"},
                max_tokens=3500
            )
            
            # Log raw response
            logger.info("LLM Response received")
            logger.info("Response tokens: %s", completion.usage.total_tokens if completion.usage else "N/A")
            logger.info("Response model: %s", completion.model)
            logger.info("Response ID: %s", completion.id)
            
            llm_raw_output = completion.choices[0].message.content
            logger.debug("-" * 80)
            logger.debug("RAW LLM OUTPUT:")
            logger.debug("-" * 80)
            logger.debug(llm_raw_output)
            
            # Parse the output
            llm_output = json.loads(llm_raw_output)
            
            logger.info("=" * 80)
            logger.info("LLM OUTPUT PARSED SUCCESSFULLY")
            logger.info("=" * 80)
            
            # Log key metrics from output
            logger.info("KEY METRICS FROM LLM OUTPUT:")
            logger.info("-" * 80)
            
            # Progression Analysis
            doc_analysis = llm_output.get("documentation_analysis", {})
            progression = doc_analysis.get("progression_analysis", {})
            logger.info("Progression Pattern: %s", progression.get("progression_pattern", "Unknown"))
            logger.info("Treatment Response Trend: %s", progression.get("treatment_response_trend", "Unknown"))
            
            # Prognosis Analysis
            prognosis_data = llm_output.get("prognosis_analysis", {})
            logger.info("Prognosis Category: %s", prognosis_data.get("prognosis_category", "Unknown"))
            logger.info("Disease Severity: %s", prognosis_data.get("disease_assessment", {}).get("severity", "Unknown"))
            logger.info("Trend Direction: %s", prognosis_data.get("disease_assessment", {}).get("trend_direction", "Unknown"))
            
            # Care Quality Score
            care_quality = llm_output.get("care_quality_score", {})
            overall_score = care_quality.get("overall_score", {})
            logger.info("Care Quality Score: %s", overall_score.get("numerical_score", "N/A"))
            logger.info("Care Quality Classification: %s", overall_score.get("classification", "N/A"))
            
            # Treatment Sufficiency
            treatment_sufficiency = llm_output.get("treatment_sufficiency_score", {})
            logger.info("Treatment Sufficiency Score: %s", treatment_sufficiency.get("sufficiency_score", "N/A"))
            logger.info("Completion Status: %s", treatment_sufficiency.get("completion_status", "N/A"))
            
            # Recommendations
            recommendations = llm_output.get("integrated_recommendations", {})
            logger.info("Suggestion: %s", recommendations.get("suggestion", "N/A")[:100] + "...")
            
            # Meta Validation
            meta = llm_output.get("meta_validation", {})
            logger.info("Data Sufficiency: %s", meta.get("data_sufficiency", "N/A"))
            logger.info("Requires Doctor Review: %s", meta.get("requires_doctor_review", "N/A"))
            logger.info("=" * 80)
            
            # Log progression evidence
            if progression.get("historical_prognosis"):
                logger.info("Historical Prognosis Statements: %s found", len(progression["historical_prognosis"]))
            if progression.get("current_prognosis"):
                logger.info("Current Prognosis Statements: %s found", len(progression["current_prognosis"]))
            
        except json.JSONDecodeError as e:
            logger.error("Failed to parse LLM output as JSON: %s", e)
            logger.error("Raw output that failed to parse: %s", llm_raw_output[:500])
            raise HTTPException(
                status_code=500,
                detail=f"LLM returned invalid JSON: {str(e)}"
            )
        except Exception as e:
            logger.error("LLM execution failed: %s", e)
            raise
        
        # ---------------------------------------------------------
        # 7️⃣ LOG RAW DATA SUMMARY
        # ---------------------------------------------------------
        logger.info("=" * 80)
        logger.info("RAW DATA SUMMARY")
        logger.info("=" * 80)
        
        logger.info("1. INPUT DATA SOURCES:")
        logger.info("   - Request payload: %s bytes", len(json.dumps(body, default=str)))
        logger.info("   - Clinical data: %s collections", len(clinical_data))
        logger.info("   - Historical documentation: %s/5 collections found", 
                   sum(1 for v in aggregated_dictation.values() if v))
        logger.info("   - Current dictation: %s characters", len(current_dictation) if current_dictation else 0)
        logger.info("   - Agentic output: %s", "Available" if agentic_output else "Not available")
        logger.info("   - Temp data: %s", "Available" if temp_data else "Not available")
        
        logger.info("2. PROMPT STATISTICS:")
        logger.info("   - Total characters: %s", len(prompt))
        logger.info("   - Historical dictation: %s characters", len(historical_dictation_text))
        logger.info("   - Current dictation: %s characters", len(current_dictation) if current_dictation else 0)
        logger.info("   - Agentic data: %s characters", len(agentic_json))
        logger.info("   - Temp data: %s characters", len(temp_data_text))
        logger.info("   - Clinical data: %s characters", len(clinical_data_text))
        
        logger.info("3. LLM RESPONSE STATISTICS:")
        logger.info("   - Total tokens: %s", completion.usage.total_tokens if completion.usage else "N/A")
        logger.info("   - Output size: %s characters", len(llm_raw_output))
        logger.info("   - JSON structure: Valid")
        
        # ---------------------------------------------------------
        # 8️⃣ FINAL RESPONSE
        # ---------------------------------------------------------
        response_data = {
            "status": "success",
            "feature_id": "documentation-prognosis-analysis",
            "feature_name": "Prognosis Analysis",
            "display_method": "structured_analysis",
            "finaloutput": llm_output,
            "metadata": {
                "doctor_id": doctor_id,
                "patient_id": patient_id,
                "data_sources": {
                    "medical_context": "medical_context_collection",
                    "current_context": "current_context_collection",
                    "agentic_output": "agentic_data_collection",
                    "temp_data": "temp_data_collection",
                    "documentation_sources": {
                        "treatment_plan": bool(aggregated_dictation["treatment_plan"]),
                        "investigation_notes": bool(aggregated_dictation["investigation_notes"]),
                        "medication_analysis": bool(aggregated_dictation["medication_analysis"]),
                        "clinical_notes": bool(aggregated_dictation["clinical_notes"]),
                        "treatment_summary": bool(aggregated_dictation["treatment_summary"])
                    },
                    "current_dictation": bool(current_dictation),
                    "current_dictation_length": len(current_dictation) if current_dictation else 0
                },
                "aggregated_sections_count": len(dictation_sections),
                "progression_analysis": True,
                "data_timeline": "historical_to_current"
            }
        }
        
        logger.info("=" * 80)
        logger.info("PROGNOSIS ANALYSIS - REQUEST COMPLETE")
        logger.info("=" * 80)
        logger.info("Returning response with progression analysis: %s historical sections + current dictation", len(dictation_sections))
        
        return response_data
    
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Prognosis analysis failed with error: %s", str(e))
        logger.error("Error occurred at step: %s", traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Prognosis analysis error: {str(e)}"
        )
##########################################Alwin Prognosis section end#########################################################

###################################################Treatment Response Analysis Engine#####################################################
#azfar
#12-02-2026

@router.post("/treatment-response-analysis")
async def treatment_response_analysis(request: dict):

    try:
        patient_id = request.get("patient_id")
        doctor_id = request.get("doctor_id")

        logger.info("🔍 Starting Treatment Response Analysis")
        logger.info("Patient ID: %s | Doctor ID: %s", patient_id, doctor_id)

        if not patient_id or not doctor_id:
            raise HTTPException(
                status_code=400,
                detail="patient_id and doctor_id are required"
            )
        logger.info("🔥🔥🔥 TREATMENT RESPONSE ENDPOINT HIT 🔥🔥🔥")

        # =====================================================
        # 1️⃣ LABS (Latest 3)
        # =====================================================

        logger.info("📑 Fetching latest lab documents...")

        lab_docs = await document_categories_collection.find(
            {
                "patient_id": patient_id,
                "doctor_id": doctor_id
            }
        ).sort("_id", -1).limit(3).to_list(length=3)

        logger.info("Lab documents fetched: %d", len(lab_docs))

        latest_labs = []

        for doc in lab_docs:
            processed_data = doc.get("processed_data", [])

            for entry in processed_data:
                if entry.get("source") == "llm":
                    try:
                        parsed = json.loads(entry["content"])

                        latest_labs.append({
                            "document_id": doc.get("document_id"),
                            "created_at": doc.get("created_at"),
                            "parsed_data": parsed
                        })

                    except Exception as e:
                        logger.warning("Lab parsing error: %s", str(e))

        logger.info("Parsed labs count: %d", len(latest_labs))


        # =====================================================
        # 2️⃣ VITALS (Latest 3)
        # =====================================================

        logger.info("💓 Fetching vitals...")

        latest_vitals = []

        try:
            # Step 1: Resolve patient → get sys_user_id (SYNC)
            patient = patient_user_collection.find_one(
                {
                    "$or": [
                        {"patient_id": patient_id},
                        {"sys_user_id": patient_id}
                    ]
                },
                {"_id": 0, "sys_user_id": 1, "patient_id": 1}
            )

            if patient:
                patient_sys_user_id = patient["sys_user_id"]

                # Step 2: Fetch vitals using sys_user_id (ASYNC)
                cursor = patient_vitals_collection.find(
                    {"sys_user_id": patient_sys_user_id},
                    {"_id": 0}
                )

                vitals_list = []

                async for doc in cursor:
                    for ts_key, values in doc.get("vitals", {}).items():
                        try:
                            dt = datetime.fromisoformat(ts_key.split("_")[0])
                        except Exception:
                            dt = datetime.min

                        vitals_list.append({
                            "timestamp": ts_key,
                            "datetime": dt,
                            "vitals": values
                        })

                vitals_list.sort(key=lambda x: x["datetime"], reverse=True)
                latest_vitals = vitals_list[:3]

        except Exception as e:
            logger.warning("Vitals fetch failed: %s", str(e))
            latest_vitals = []

        logger.info("Vitals count: %d", len(latest_vitals))



        # =====================================================
        # 3️⃣ WORKFLOW (Latest 3 Only)
        # =====================================================

        logger.info("🛠 Fetching latest 3 workflow/procedure notes...")

        workflow_docs = await procedure_notes_collection.find(
            {
                "patient_id": patient_id,
                "doctor_id": doctor_id
            },
            {
                "_id": 0,
                "selected_procedure": 1,
                "mode": 1,
                "created_at": 1,
                "updated_at": 1,
                "patient_abstract": 1,
                "pre_procedure": 1,
                "during_procedure": 1,
                "post_procedure": 1
            }
        ).sort("created_at", -1).limit(3).to_list(length=3)


        latest_workflows = workflow_docs if workflow_docs else []

        logger.info("Workflow count (latest 3 max): %d", len(latest_workflows))

        # =====================================================
        # 4️⃣ SINGLE RECORD FETCHES
        # =====================================================

        logger.info("📋 Fetching latest investigation...")

        latest_investigation = await documentation_investigation_notes_collection.find_one(
            {
                "patient_id": patient_id,
                "doctor_id": doctor_id
            },
            {
                "_id": 0,
                "finaloutput": 1,
                "created_at": 1
            },
            sort=[("created_at", -1)]
        )

        if latest_investigation:
            logger.info("Investigation found")
        else:
            logger.warning("⚠️ No investigation found")


        logger.info("💊 Fetching latest prescription...")

        latest_prescription = await documentation_medication_analysis_collection.find_one(
            {
                "patient_id": patient_id,
                "doctor_id": doctor_id
            },
            {
                "_id": 0,
                "finaloutput": 1,
                "created_at": 1
            },
            sort=[("created_at", -1)]
        )

        if latest_prescription:
            logger.info("Prescription found")
        else:
            logger.warning("⚠️ No prescription found")


        logger.info("📝 Fetching latest treatment plan...")

        latest_treatment_plan = await documentation_treatment_plan_collection.find_one(
            {
                "patient_id": patient_id,
                "doctor_id": doctor_id
            },
            {
                "_id": 0,
                "finaloutput": 1,
                "status": 1,
                "created_at": 1
            },
            sort=[("created_at", -1)]
        )

        if latest_treatment_plan:
            logger.info("Treatment plan found")
        else:
            logger.warning("⚠️ No treatment plan found")


        logger.info("📊 Fetching latest prognosis...")

        latest_prognosis = await prognosis_data_collection.find_one(
            {"patient_id": patient_id},
            {
                "_id": 0,
                "created_at": 1,
                "finaloutput": 1,
                "status": 1
            },
            sort=[("created_at", -1)]
        )

        if latest_prognosis:
            logger.info("Prognosis found")
        else:
            logger.warning("⚠️ No prognosis found")



        # =====================================================
        # 🏥 FETCH LATEST INSURANCE (SYNC SAFE)
        # =====================================================

        logger.info("🏥 Fetching latest insurance...")

        latest_insurance = None

        try:
            cursor = insurance_claims_collection.find(
                {"patient_id": patient_id}
            ).sort("created_at", -1).limit(1)

            insurance_docs = list(cursor)

            if insurance_docs:
                doc = insurance_docs[0]
                doc["id"] = str(doc.get("_id"))
                doc.pop("_id", None)
                latest_insurance = doc

        except Exception as e:
            logger.warning("Insurance fetch failed: %s", str(e))
            latest_insurance = None

        logger.info("Insurance found: %s", "Yes" if latest_insurance else "No")



        # =====================================================
        # 6️⃣ AGENTIC DATA (Latest 1)
        # =====================================================

        logger.info("🧠 Fetching latest agentic data...")

        latest_agentic = None

        try:
            result = agentic_data_collection.find_one(
                {"patient_id": patient_id, "doctor_id": doctor_id},
                {"_id": 0},
                sort=[("_id", -1)]
            )

            # If async (Motor)
            if hasattr(result, "__await__"):
                latest_agentic = await result
            else:
                # Sync (PyMongo)
                latest_agentic = result

        except Exception as e:
            logger.warning("Agentic fetch failed: %s", str(e))
            latest_agentic = None

        logger.info("Agentic data found: %s", "Yes" if latest_agentic else "No")


       # =====================================================
        # 7️⃣ TEMP DATA (Latest 1)
        # =====================================================

        logger.info("🗂 Fetching temp data...")

        latest_temp = None

        try:
            result = temp_data_collection.find_one(
                {"patient_id": patient_id, "doctor_id": doctor_id},
                {"_id": 0},
                sort=[("_id", -1)]
            )

            if hasattr(result, "__await__"):
                latest_temp = await result
            else:
                latest_temp = result

        except Exception as e:
            logger.warning("Temp fetch failed: %s", str(e))
            latest_temp = None

        logger.info("Temp data found: %s", "Yes" if latest_temp else "No")

        # =====================================================
        # 🎙 FETCH LATEST DOCTOR DICTATION (Same Doctor)
        # =====================================================

        latest_dictation = None
        dictation_summary = None

        try:
            latest_dictation = await dictation_collection.find_one(
                {
                    "patient_id": patient_id,
                    "doctor_id": doctor_id
                },
                sort=[("created_at", -1)]
            )

            if latest_dictation:
                latest_dictation.pop("_id", None)

                # Extract structured content if exists
                structured_content = None
                raw_transcript = None

                processed_data = latest_dictation.get("processed_data", [])
                raw_data = latest_dictation.get("raw_data", [])

                if processed_data:
                    structured_content = processed_data[0].get("content")

                if raw_data:
                    raw_transcript = raw_data[0].get("content")

                dictation_summary = {
                    "structured_extraction": structured_content,
                    "raw_transcript": raw_transcript,
                    "created_at": latest_dictation.get("created_at")
                }

                logger.info("Dictation found and extracted.")
            else:
                logger.info("No dictation found for this doctor.")

        except Exception as e:
            logger.warning("Dictation fetch failed: %s", str(e))
            dictation_summary = None


        


    except Exception as e:
        logger.exception("❌ Treatment Response Analysis Failed")
        raise HTTPException(status_code=500, detail=str(e))

    # =====================================================
    # 2️⃣ BUILD LLM PROMPT
    # =====================================================

    aggregated_context = {
        "labs_last_3": latest_labs,
        "vitals_last_3": latest_vitals,
        "workflow_last_3": latest_workflows,
        "latest_investigation": latest_investigation,
        "latest_prescription": latest_prescription,
        "latest_treatment_plan": latest_treatment_plan,
        "latest_prognosis": latest_prognosis,
        "latest_insurance": latest_insurance,
        "latest_agentic_data": latest_agentic,
        "latest_temp_data": latest_temp
    }
    
    logger.info("AGENTIC DATA SNAPSHOT: %s", json.dumps(latest_agentic, indent=2, default=str))
    logger.info("WORKFLOW SNAPSHOT: %s", json.dumps(latest_workflows, indent=2, default=str))
    logger.info("PRESCRIPTION SNAPSHOT: %s", json.dumps(latest_prescription, indent=2, default=str))
    # =====================================================
    # DEBUG LOGGER — VERIFY DATA BEFORE PROMPT BUILD
    # =====================================================

    logger.info("🧪 ===== TREATMENT RESPONSE PROMPT INPUT DEBUG =====")

    logger.info("Agentic Context Present: %s", "Yes" if latest_agentic else "No")
    logger.info("Labs Count: %d", len(latest_labs) if latest_labs else 0)
    logger.info("Vitals Count: %d", len(latest_vitals) if latest_vitals else 0)
    logger.info("Workflows Count: %d", len(latest_workflows) if latest_workflows else 0)
    logger.info("Investigation Present: %s", "Yes" if latest_investigation else "No")
    logger.info("Prescription Present: %s", "Yes" if latest_prescription else "No")
    logger.info("Treatment Plan Present: %s", "Yes" if latest_treatment_plan else "No")
    logger.info("Prognosis Present: %s", "Yes" if latest_prognosis else "No")
    logger.info("Insurance Present: %s", "Yes" if latest_insurance else "No")
    logger.info("Temp Context Present: %s", "Yes" if latest_temp else "No")
    

    # Optional: Safe truncated preview for debugging
    logger.debug("Labs Preview: %s", json.dumps(latest_labs, default=str)[:1000])
    logger.debug("Vitals Preview: %s", json.dumps(latest_vitals, default=str)[:1000])
    logger.debug("Workflow Preview: %s", json.dumps(latest_workflows, default=str)[:1000])

    logger.info("🧪 ===== END PROMPT INPUT DEBUG =====")


    prompt = f"""


You are a STRICT CLINICAL TREATMENT RESPONSE ANALYSIS ENGINE operating as a deterministic medical intelligence system.

CORE PRINCIPLES:
- No hallucination
- No assumption of missing values
- No override of physician authority
- Use only structured data provided
- If critical trend data absent → mark affected dimension as "insufficient_data", continue analysis with remaining data
- If partial data exists → perform analysis with available data, document "limited_longitudinal_depth"

══════════════════════════════════════════════
DATA SUFFICIENCY EXECUTION STANDARD
══════════════════════════════════════════════

Absence of one dimension NEVER prevents analysis of other available dimensions.

When data incomplete:
• Analyze all available structured inputs
• Never suppress classification solely due to missing complementary data
• Mark only affected dimension as "insufficient_data"
• Document which components lacked sufficient information
• Explicitly state how missing data affects certainty
• Downgrade confidence proportionally to longitudinal depth

TIME POINT AVAILABILITY RULES:
- Single time point → cross-sectional only, no temporal claims, no sustained response confirmation
- Two time points → cautious interval comparison, document limited depth, max confidence "medium"
- Three or more → full longitudinal trend analysis permitted
- All dimensions absent → return "insufficient_data" across response classification

System MUST attempt analysis before declaring insufficiency.

══════════════════════════════════════════════
PRIMARY OBJECTIVE
══════════════════════════════════════════════

Generate:
• Objective response classification
• Longitudinal trend analysis
• Decision support
• UI-ready summary indicators
• Explainability and audit trace

OUTPUT STYLE REQUIREMENTS:
- Clear, professional, sentence-based medical language suitable for direct physician display
- Avoid single-word outputs except categorical fields requiring controlled vocabulary
- Every descriptive field must provide contextual clinical interpretation

══════════════════════════════════════════════
RESPONSE EVALUATION LOGIC
══════════════════════════════════════════════

1. Clinical Response:
   - Symptom trajectory
   - Functional status change
   - Performance trends

2. Objective Response:
   - Lab value trends (compare available points)
   - Imaging changes
   - Procedure outcomes

   Rules:
   - 1 data point → insufficient_trend_data
   - 2 data points → cautious trend, medium max confidence
   - ≥3 → full trend analysis

3. Treatment Execution Quality:
   - Protocol adherence
   - Missed sessions
   - Dose changes
   - Monitoring compliance

4. Protocol Alignment:
   - Match against monitoring_plan
   - Evaluate expected response timeline
   - Detect early failure or delayed response
   - If protocol_reference absent from AGENTIC_CONTEXT → return "insufficient_data"

5. Decision Support (choose ONE):
   - continue_current_treatment
   - optimize_dose_or_schedule
   - escalate_care
   - switch_protocol
   - de_escalate_or_stop
   - insufficient_basis

All suggestions require:
   - Clinical reasoning (full sentences connecting data to recommendation)
   - Protocol reference
   - Non-binding statement

══════════════════════════════════════════════
LONGITUDINAL TREND ANALYSIS
══════════════════════════════════════════════

Trend Pattern (controlled vocabulary):
- improvement_slope
- plateau
- decline
- fluctuating_pattern
- indeterminate

Depth Assessment (controlled vocabulary):
- adequate_longitudinal_depth
- limited_longitudinal_depth
- insufficient_data

CONFIDENCE CONSTRAINT - STRICT ENFORCEMENT:
If depth_assessment = "limited_longitudinal_depth" THEN:
- objective_response_classification.confidence MUST NOT be "high"
- summary_status_indicator.confidence_level MUST NOT be "high"
- Violation → auto-downgrade to "medium"

If insufficient time points for trend determination:
• Do not assign improvement/decline/plateau
• Use "indeterminate" or "insufficient_trend_data"
• Provide explanatory reasoning describing temporal limitation

══════════════════════════════════════════════
DOCTOR DICTATION RECONCILIATION
══════════════════════════════════════════════

If dictation exists:
- Compare AI classification vs doctor perception
- Flag discrepancy (non-blocking)
- Provide alignment/discrepancy explanation
- Always state: "Treating clinician judgment remains final."

If dictation absent:
- Explicitly state no physician dictation available for reconciliation

══════════════════════════════════════════════
INSURANCE & COMPLIANCE
══════════════════════════════════════════════

Flag:
- Continuation without measurable response
- Protocol deviation without documentation
- Missing response documentation

Generate insurance-ready summary justification in clear medical language.

If no risks present → explicitly state documentation supports continuation of care.

If measurable response parameters unavailable → explicitly state objective response confirmation limited by data insufficiency.

══════════════════════════════════════════════
EXPLAINABILITY & AUDIT TRAIL
══════════════════════════════════════════════

ai_inference_logic_summary MUST be a structured clinical audit statement containing:

• Data categories analyzed (labs, vitals, workflow events, prescriptions, investigations, treatment plan, prognosis, dictation if present)
• Whether interval comparison across time points was performed
• Whether interpretation was cross-sectional or longitudinal
• Whether longitudinal depth was adequate or limited
• Whether protocol validation was possible based strictly on structured AGENTIC_CONTEXT
• Differentiation of objective data-derived findings from physician subjective input (if dictation exists)
• Analytical limitations affecting certainty

Do NOT:
- Reference external guidelines unless explicitly present in AGENTIC_CONTEXT
- Use vague language ("combination of data")
- Use informal phrasing
- Provide simplified summaries
- Use conversational tone

Format: Formal, precise, medically defensible language suitable for legal/compliance review.

══════════════════════════════════════════════
INPUT DATA STRUCTURES
══════════════════════════════════════════════

AGENTIC_CONTEXT:
{json.dumps(latest_agentic, indent=2, default=str)}

DOCTOR_DICTATION_CONTEXT:
{json.dumps(dictation_summary, indent=2, default=str)}

LABS_LAST_3:
{json.dumps(latest_labs, indent=2, default=str)}

VITALS_LAST_3:
{json.dumps(latest_vitals, indent=2, default=str)}

WORKFLOWS_LAST_3:
{json.dumps(latest_workflows, indent=2, default=str)}

LATEST_INVESTIGATION:
{json.dumps(latest_investigation, indent=2, default=str)}

LATEST_PRESCRIPTION:
{json.dumps(latest_prescription, indent=2, default=str)}

LATEST_TREATMENT_PLAN:
{json.dumps(latest_treatment_plan, indent=2, default=str)}

LATEST_PROGNOSIS:
{json.dumps(latest_prognosis, indent=2, default=str)}

LATEST_INSURANCE:
{json.dumps(latest_insurance, indent=2, default=str)}

TEMP_CONTEXT:
{json.dumps(latest_temp, indent=2, default=str)}

══════════════════════════════════════════════
OUTPUT FORMAT - STRICT JSON ONLY
══════════════════════════════════════════════

All descriptive fields: complete, professional, sentence-based clinical explanations.
All categorical fields: strict controlled vocabulary as defined above.

{{
  "summary_status_indicator": {{
    "overall_status": "",
    "color_code": "",
    "confidence_level": "",
    "data_completeness": "",
    "limitations": ""
  }},
  "objective_response_classification": {{
    "category": "",
    "confidence": "",
    "basis_of_classification": [],
    "supporting_data_points": []
  }},
  "longitudinal_trend_analysis": {{
    "trend_pattern": "",
    "improvement_slope": "",
    "cross_workflow_response": "",
    "depth_assessment": "",
    "trend_drivers": []
  }},
  "decision_support_for_doctor": {{
    "recommended_action": "",
    "clinical_reasoning": "",
    "protocol_reference": "",
    "non_binding_statement": "Treating clinician judgment remains final."
  }},
  "key_drivers_of_response": [],
  "expandable_trend_chart_data": {{
    "labs": [],
    "vitals": [],
    "workflow_events": [],
    "medication_changes": []
  }},
  "doctor_dictation_reconciliation": {{
    "dictation_present": "",
    "ai_vs_doctor_alignment": "",
    "discrepancy_flag": "",
    "notes": ""
  }},
  "insurance_and_compliance_insight": {{
    "continuation_justification_strength": "",
    "risk_flags": [],
    "documentation_gaps": [],
    "insurance_summary": ""
  }},
  "explainability_and_audit_trail": {{
    "protocol_used": "",
    "data_points_considered": [],
    "doctor_input_used": [],
    "ai_inference_logic_summary": "",
    "audit_log_flags": {{
      "clinical_review_required": false,
      "insurance_review_flag": false,
      "legal_sensitivity_flag": false
    }}
  }}
}}

All fields must be present.
Return JSON only.
"""


    # =====================================================
    # 3️⃣ LLM CALL (YOUR STRUCTURE)
    # =====================================================

    completion = groq_client.chat.completions.create(
    model="llama-3.1-8b-instant",
    messages=[{"role": "user", "content": prompt}],
    temperature=0,
    top_p=0,
    response_format={"type": "json_object"},
    max_tokens=6000
)


    try:
        llm_output = json.loads(completion.choices[0].message.content)
    except Exception as e:
        logger.error("LLM JSON parsing failed: %s", str(e))
        raise HTTPException(
            status_code=500,
            detail="LLM returned invalid JSON"
        )


    logger.info("LLM Raw Output: %s", json.dumps(llm_output, indent=2))

    # ================================
    # VALIDATION LAYER
    # ================================

    def enforce_confidence_rules(output):
        try:
            depth = output.get("longitudinal_trend_analysis", {}).get("depth_assessment")

            if depth == "limited_longitudinal_depth":

                if output.get("objective_response_classification", {}).get("confidence") == "high":
                    output["objective_response_classification"]["confidence"] = "medium"

                if output.get("summary_status_indicator", {}).get("confidence_level") == "high":
                    output["summary_status_indicator"]["confidence_level"] = "medium"

            return output
        except Exception as e:
            logger.warning("Confidence enforcement failed: %s", str(e))
            return output


    def ensure_required_fields(output):

            # ─── Top Level ────────────────────────────────────────
            output.setdefault("summary_status_indicator", {})
            output.setdefault("objective_response_classification", {})
            output.setdefault("longitudinal_trend_analysis", {})
            output.setdefault("decision_support_for_doctor", {})
            output.setdefault("key_drivers_of_response", [])

            # ─── Expandable Chart Data ────────────────────────────
            output.setdefault("expandable_trend_chart_data", {})
            chart = output["expandable_trend_chart_data"]

            chart["labs"] = chart.get("labs") or []
            chart["vitals"] = chart.get("vitals") or []
            chart["workflow_events"] = chart.get("workflow_events") or []
            chart["medication_changes"] = chart.get("medication_changes") or []

            # ─── Doctor Dictation ─────────────────────────────────
            output.setdefault("doctor_dictation_reconciliation", {})

            # ─── Insurance ─────────────────────────────────────────
            output.setdefault("insurance_and_compliance_insight", {})
            insurance = output["insurance_and_compliance_insight"]

            insurance["risk_flags"] = insurance.get("risk_flags") or []
            insurance["documentation_gaps"] = insurance.get("documentation_gaps") or []

            # ─── Explainability & Audit ───────────────────────────
            output.setdefault("explainability_and_audit_trail", {})
            audit = output["explainability_and_audit_trail"]

            audit["protocol_used"] = audit.get("protocol_used") or ""
            audit["data_points_considered"] = audit.get("data_points_considered") or []
            audit["doctor_input_used"] = audit.get("doctor_input_used") or []
            audit["ai_inference_logic_summary"] = audit.get("ai_inference_logic_summary") or ""

            audit.setdefault("audit_log_flags", {})
            flags = audit["audit_log_flags"]

            flags["clinical_review_required"] = bool(flags.get("clinical_review_required", False))
            flags["insurance_review_flag"] = bool(flags.get("insurance_review_flag", False))
            flags["legal_sensitivity_flag"] = bool(flags.get("legal_sensitivity_flag", False))

            return output



    def enforce_protocol_guard(output):
        try:
            agentic_has_protocol = False

            if latest_agentic:
                if isinstance(latest_agentic, dict):
                    if "protocol_reference" in latest_agentic:
                        agentic_has_protocol = True

            if not agentic_has_protocol:
                output.setdefault("decision_support_for_doctor", {})
                output["decision_support_for_doctor"]["protocol_reference"] = "insufficient_data"

                output.setdefault("explainability_and_audit_trail", {})
                output["explainability_and_audit_trail"]["protocol_used"] = "insufficient_data"

            return output
        except Exception as e:
            logger.warning("Protocol guard failed: %s", str(e))
            return output

    def enforce_audit_flags(output):
        try:
            # Ensure structure exists
            output.setdefault("explainability_and_audit_trail", {})
            output["explainability_and_audit_trail"].setdefault("audit_log_flags", {
                "clinical_review_required": False,
                "insurance_review_flag": False,
                "legal_sensitivity_flag": False
            })

            flags = output["explainability_and_audit_trail"]["audit_log_flags"]

            # Insurance risk
            risk_flags = output.get("insurance_and_compliance_insight", {}).get("risk_flags", [])
            if risk_flags:
                flags["insurance_review_flag"] = True

            # Doctor discrepancy
            discrepancy = output.get("doctor_dictation_reconciliation", {}).get("discrepancy_flag")
            if str(discrepancy).lower() == "true":
                flags["clinical_review_required"] = True

            # Missing protocol
            protocol_used = output.get("explainability_and_audit_trail", {}).get("protocol_used")
            if protocol_used == "insufficient_data":
                flags["legal_sensitivity_flag"] = True

            return output

        except Exception as e:
            logger.warning("Audit enforcement failed: %s", str(e))
            return output

    def enforce_dictation_flag(output):
        try:
            output.setdefault("doctor_dictation_reconciliation", {})

            if dictation_summary:
                output["doctor_dictation_reconciliation"]["dictation_present"] = "true"
            else:
                output["doctor_dictation_reconciliation"]["dictation_present"] = "false"

            return output
        except:
            return output

    def enforce_response_classification_guard(output):
        try:
            has_structured_data = False

            if latest_labs or latest_vitals or latest_workflows:
                has_structured_data = True

            category = output.get("objective_response_classification", {}).get("category")

            if has_structured_data and category in ["insufficient_data", None, ""]:
                output["objective_response_classification"]["category"] = "indeterminate"

                output["objective_response_classification"]["basis_of_classification"] = [
                    "Structured clinical data available; however, longitudinal confirmation is limited."
                ]

                output["objective_response_classification"]["confidence"] = "low"

            return output

        except Exception as e:
            logger.warning("Response classification guard failed: %s", str(e))
            return output


    # APPLY VALIDATIONS
    llm_output = ensure_required_fields(llm_output)
    llm_output = enforce_confidence_rules(llm_output)
    llm_output = enforce_protocol_guard(llm_output)
    llm_output = enforce_dictation_flag(llm_output)
    llm_output = enforce_audit_flags(llm_output)
    llm_output = enforce_response_classification_guard(llm_output)


    logger.info("LLM Validated Output: %s", json.dumps(llm_output, indent=2))

     


    # =====================================================
    # 4️⃣ FINAL RESPONSE
    # =====================================================

    return {
        "status": "success",
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "analysis": llm_output
    }

###############################################################################################################################################################################################



###Aleena

###Aleena

@router.post("/process-clinical-dictation")
async def process_clinical_dictation(request: Request):
    """
    Process doctor dictation and extract structured clinical elements
    for EMR and RCM workflows.
    """

    try:
        data = await request.json()

        doctor_id = data.get("doctor_id")
        patient_id = data.get("patient_id")
        # encounter_id = data.get("encounter_id")
        dictation_text = data.get("dictation")

        if not dictation_text:
            raise HTTPException(status_code=400, detail="dictation is required")

        # ---------------------------------------------------
        # LLM PROMPT
        # ---------------------------------------------------
        prompt = f"""
You are a hospital-grade Clinical Documentation Intelligence System.

Your responsibility is to transform raw doctor dictation 
into structured, medically accurate clinical data 
for EMR storage and Revenue Cycle Management workflows.

You must strictly extract information ONLY from the dictation provided.
Do NOT hallucinate.
Do NOT infer unstated diagnoses.
Do NOT add medical knowledge beyond what is explicitly mentioned.
If a field is not clearly mentioned, return empty string "" or empty array [].

------------------------------------------------------------
CLINICAL EXTRACTION OBJECTIVES
------------------------------------------------------------

From the dictation, identify and structure:

1. Primary Diagnosis
   - The main confirmed working diagnosis
   - If uncertain, mark as stated (e.g., "Suspected ...")

2. Differential Diagnoses
   - Alternate conditions being considered
   - Preserve wording exactly as dictated

3. Symptoms
   - Patient-reported complaints only
   - Do not mix with objective findings

4. Clinical Findings
   - Physical exam findings
   - Measured vitals
   - Lab abnormalities mentioned
   - Imaging findings mentioned

5. Clinical Assessment / Hypothesis
   - Doctor’s reasoning
   - Clinical impression
   - Disease severity classification if mentioned

6. SOAP Note Reconstruction
   - Subjective → symptoms & complaints
   - Objective → exam findings, vitals, test results
   - Assessment → diagnostic impression
   - Plan → management decisions

7. Treatment Plan
   - Non-pharmacological advice
   - Procedures planned
   - Follow-up instructions
   - Referrals

8. Prescription Details
   Extract each medication separately with:
   - medicine_name
   - strength (if mentioned)
   - dosage
   - frequency
   - duration
   - route
   - special_instructions

   Do NOT combine multiple medicines into one entry.

9. Investigations
   Extract each lab or imaging order separately with:
   - test_name
   - category (Laboratory / Imaging / Procedure)
   - urgency (Routine / Urgent / Stat if mentioned)
   - clinical_reason (why it is ordered, if stated)

------------------------------------------------------------
STRICT EXTRACTION RULES
------------------------------------------------------------

- Preserve exact medical terminology.
- Do NOT normalize drug names.
- Do NOT generate ICD codes.
- Do NOT add interpretations.
- Do NOT rewrite medically.
- If diagnosis is uncertain, keep wording like "rule out", "probable", "suspected".
- If no prescriptions are mentioned, return empty list [].
- If no investigations are mentioned, return empty list [].
- If SOAP structure is incomplete, populate available sections only.

------------------------------------------------------------
DICTATION INPUT
------------------------------------------------------------
{dictation_text}
------------------------------------------------------------

------------------------------------------------------------
MANDATORY OUTPUT FORMAT (VALID JSON ONLY)
------------------------------------------------------------

{{
  "primary_diagnosis": "",
  "differential_diagnoses": [],
  "symptoms": [],
  "clinical_findings": [],
  "clinical_assessment": "",
  "soap_note": {{
      "subjective": "",
      "objective": "",
      "assessment": "",
      "plan": ""
  }},
  "treatment_plan": "",
  "prescriptions": [
      {{
          "medicine_name": "",
          "strength": "",
          "dosage": "",
          "frequency": "",
          "duration": "",
          "route": "",
          "special_instructions": ""
      }}
  ],
  "investigations": [
      {{
          "test_name": "",
          "category": "",
          "urgency": "",
          "clinical_reason": ""
      }}
  ]
}}

Output MUST be valid JSON.
Do NOT include explanation text.
Do NOT wrap JSON in markdown.
Return JSON object only.
"""

        # ---------------------------------------------------
        # LLM CALL
        # ---------------------------------------------------
        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            temperature=0.1,
            max_tokens=2000,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
        )

        structured_output = json.loads(
            completion.choices[0].message.content
        )
        logger.info("LLM structured output generated successfully")
        logger.info(f"Structured Output: {structured_output}")
        # ---------------------------------------------------
        # STRUCTURED ENCOUNTER DOCUMENT
        # ---------------------------------------------------

        encounter_id = data.get("encounter_id")

        if not encounter_id:
            encounter_id = str(uuid.uuid4())

        existing_report = await clinical_element_collection.find_one({
            "encounter_id": encounter_id
        })


        if existing_report:
            # -----------------------
            # UPDATE EXISTING REPORT
            # -----------------------
            new_version = existing_report.get("version", 1) + 1

            await clinical_element_collection.update_one(
                {"encounter_id": encounter_id},
                {
                    "$set": {
                        "clinical_data": structured_output,
                        "updated_at": datetime.utcnow(),
                        "version": new_version
                    },
                    "$push": {
                        "audit_trail": {
                            "version": new_version,
                            "updated_by": doctor_id,
                            "updated_at": datetime.utcnow(),
                            "action": "Dictation updated"
                        }
                    }
                }
            )

            return {
                "status": "updated",
                "encounter_id": encounter_id,
                "version": new_version,
                "clinical_data": structured_output
            }

        else:
            # -----------------------
            # INSERT NEW REPORT
            # -----------------------
            report_id = str(uuid.uuid4())

            consultation_document = {
                "report_id": report_id,
                "encounter_id": encounter_id,
                "doctor_id": doctor_id,
                "patient_id": patient_id,
                "raw_dictation": dictation_text,
                "clinical_data": structured_output,
                "status": "draft",
                "version": 1,
                "audit_trail": [
                    {
                        "version": 1,
                        "updated_by": doctor_id,
                        "updated_at": datetime.utcnow(),
                        "action": "Initial dictation"
                    }
                ],
                "finalized_at": None,
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow()
            }

            await clinical_element_collection.insert_one(consultation_document)

            return {
                "status": "created",
                "report_id": report_id,
                "encounter_id": encounter_id,
                "clinical_data": structured_output
            }


        # Optional: Save to Mongo
        # encounter_collection.insert_one(encounter_document)

        

    except Exception as e:
        logger.exception("Clinical dictation processing failed")
        raise HTTPException(
            status_code=500,
            detail=f"Clinical dictation processing failed: {str(e)}"
        )


@router.get("/patient/{patient_id}/consultations")
async def get_patient_consultations(
    patient_id: str, 
    page: int = 1, 
    limit: int = 20  # Default to 20, but make it configurable
):
    skip = (page - 1) * limit
    
    cursor = (
        clinical_element_collection
        .find({"patient_id": patient_id})
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
    )
    
    reports = await cursor.to_list(length=limit)
    
    # Get total count for pagination info
    total_count = await clinical_element_collection.count_documents(
        {"patient_id": patient_id}
    )
    
    for report in reports:
        report["_id"] = str(report["_id"])
        if isinstance(report.get("created_at"), datetime):
            report["created_at"] = report["created_at"].strftime("%Y-%m-%d %H:%M:%S")
        if isinstance(report.get("updated_at"), datetime):
            report["updated_at"] = report["updated_at"].isoformat()
    
    return {
        "reports": reports,
        "pagination": {
            "total": total_count,
            "page": page,
            "limit": limit,
            "pages": (total_count + limit - 1) // limit
        }
    }

@router.put("/consultation/{report_id}")
async def update_consultation(report_id: str, request: Request):

    data = await request.json()
    updated_clinical_data = data.get("clinical_data")
    doctor_id = data.get("doctor_id")

    existing = clinical_element_collection.find_one({"report_id": report_id})

    if not existing:
        raise HTTPException(status_code=404, detail="Report not found")

    if existing["status"] == "finalized":
        raise HTTPException(status_code=400, detail="Finalized report cannot be edited")

    new_version = existing["version"] + 1

    clinical_element_collection.update_one(
        {"report_id": report_id},
        {
            "$set": {
                "clinical_data": updated_clinical_data,
                "version": new_version,
                "updated_at": datetime.utcnow()
            },
            "$push": {
                "audit_trail": {
                    "version": new_version,
                    "updated_by": doctor_id,
                    "updated_at": datetime.utcnow(),
                    "action": "Doctor edited report"
                }
            }
        }
    )

    return {"status": "updated", "version": new_version}


#############################################################################WORKFLOW REPORT ENGINE######################################################################################################################
#azfar
#16/02/2026



@router.post("/workflow-report-analysis")
async def workflow_report_analysis(request: dict):

    try:
        patient_id = request.get("patient_id")
        doctor_id = request.get("doctor_id")

        logger.info("🔍 Starting Workflow Report Analysis")
        logger.info("Patient ID: %s | Doctor ID: %s", patient_id, doctor_id)

        if not patient_id or not doctor_id:
            raise HTTPException(
                status_code=400,
                detail="patient_id and doctor_id are required"
            )

        logger.info("🔥🔥🔥 WORKFLOW REPORT ENDPOINT HIT 🔥🔥🔥")

        # =====================================================
        # 1️⃣ FETCH ALL REQUIRED MODULE DATA
        # =====================================================

        async def fetch_medical_context():
            return await medical_context_collection.find_one(
                {"patient_id": patient_id}, {"_id": 0}
            )

        async def fetch_current_context():
            return await current_context_collection.find_one(
                {"patient_id": patient_id}, {"_id": 0}
            )

        async def fetch_documents():
            cursor = document_categories_collection.find(
                {"patient_id": patient_id}
            ).sort("created_at", 1)
            return await cursor.to_list(length=None)

        async def fetch_procedures():
            cursor = procedure_notes_collection.find(
                {"patient_id": patient_id, "doctor_id": doctor_id},
                {"_id": 0}
            ).sort("created_at", 1)
            return await cursor.to_list(length=None)

        async def fetch_prognosis():
            cursor = prognosis_data_collection.find(
                {"patient_id": patient_id},
                {"_id": 0}
            ).sort("created_at", 1)
            return await cursor.to_list(length=None)

        async def fetch_medications():
            cursor = documentation_medication_analysis_collection.find(
                {"patient_id": patient_id, "doctor_id": doctor_id},
                {"_id": 0}
            ).sort("created_at", 1)
            return await cursor.to_list(length=None)

        async def fetch_treatment_plans():
            cursor = documentation_treatment_plan_collection.find(
                {"patient_id": patient_id, "doctor_id": doctor_id},
                {"_id": 0}
            ).sort("created_at", 1)
            return await cursor.to_list(length=None)

        (
            medical_context,
            current_context,
            documents,
            procedures,
            prognosis,
            medications,
            treatment_plans
        ) = await asyncio.gather(
            fetch_medical_context(),
            fetch_current_context(),
            fetch_documents(),
            fetch_procedures(),
            fetch_prognosis(),
            fetch_medications(),
            fetch_treatment_plans()
        )

        logger.info("Documents: %d", len(documents) if documents else 0)
        logger.info("Procedures: %d", len(procedures) if procedures else 0)
        logger.info("Prognosis: %d", len(prognosis) if prognosis else 0)
        logger.info("Medications: %d", len(medications) if medications else 0)
        logger.info("Treatment plans: %d", len(treatment_plans) if treatment_plans else 0)

    except Exception as e:
        logger.exception("❌ Workflow Report Data Fetch Failed")
        raise HTTPException(status_code=500, detail=str(e))

    # =====================================================
    # 2️⃣ BUILD PROMPT
    # =====================================================

    aggregated_context = {
        "medical_context": medical_context,
        "current_context": current_context,
        "documents": documents,
        "procedure_notes": procedures,
        "prognosis_history": prognosis,
        "medication_history": medications,
        "treatment_plans": treatment_plans
    }

    prompt = f"""

You are a STRICT CLINICAL WORKFLOW RECONSTRUCTION ENGINE operating in PRODUCTION MODE.

══════════════════════════════════════════════
CORE RULES (MANDATORY)
══════════════════════════════════════════════

• Use ONLY explicitly provided structured data.
• Do NOT invent information.
• Do NOT assume missing dates.
• Do NOT fabricate workflow types.
• Do NOT fabricate intent.
• Do NOT fabricate outcomes.
• Do NOT fabricate scores.
• Do NOT fabricate overlaps.
• If insufficient evidence exists → DO NOT create workflow.

If a required field cannot be determined:
→ Leave it as empty string "" or empty array [].
→ Never guess.

══════════════════════════════════════════════
WORKFLOW CREATION RULES
══════════════════════════════════════════════

A workflow may ONLY be created if at least ONE of the following exists in DATA:

• Explicit procedure note
• Explicit treatment plan
• Explicit medication regimen with execution
• Explicit therapy documentation

Diagnosis alone is NOT sufficient.

If no execution evidence exists → workflows must be [].

══════════════════════════════════════════════
STRICT WORKFLOW TYPE CLASSIFICATION
══════════════════════════════════════════════

Assign workflow_type ONLY if supported by explicit evidence:

• Chemotherapy →
  ONLY if chemotherapy drug names (cisplatin, carboplatin, paclitaxel,
  cyclophosphamide, docetaxel, or explicit "chemotherapy session") are present.

• Radiotherapy →
  ONLY if radiation planning or radiation session documentation exists.

• Surgery →
  ONLY if surgical procedure documentation exists.

• Dialysis →
  ONLY if dialysis session documentation exists.

• Long-term therapy plans →
  ONLY if structured chronic therapy plan documentation exists.

• Interventional procedures →
  DEFAULT fallback for non-surgical treatment workflows.

If evidence does NOT support chemo/radiation/surgery/dialysis:
→ workflow_type MUST be "Interventional procedures".

NEVER assign Chemotherapy unless chemo drugs are explicitly documented.

══════════════════════════════════════════════
INTENT RULE
══════════════════════════════════════════════

Allowed intent values:
Curative
Palliative
Supportive
Diagnostic

• If biopsy / imaging-guided diagnostic procedure → intent = "Diagnostic".
• If treatment intent is not explicitly documented → leave empty "".
• Do NOT infer intent from improvement language.

══════════════════════════════════════════════
STATUS RULE
══════════════════════════════════════════════

Allowed status values ONLY:

Planned
Ongoing
Paused
Modified
Completed
Discontinued

Do NOT use "Active".
Do NOT invent new status labels.

• If end_date exists and completion documented → Completed.
• If treatment ongoing and no end documented → Ongoing.
• If status cannot be determined → leave empty "".

══════════════════════════════════════════════
TEMPORAL RULE
══════════════════════════════════════════════

• start_date = first execution event date.
• end_date = last documented event date.
• Do NOT create artificial dates.
• If no date → leave empty "".

══════════════════════════════════════════════
OUTCOME RULE
══════════════════════════════════════════════

• For therapeutic workflows → include response ONLY if explicitly documented.
• For diagnostic workflows → describe diagnostic result only.
• Do NOT convert imaging findings into treatment response.
• If no response documented → leave empty "".

══════════════════════════════════════════════
SCORES RULE
══════════════════════════════════════════════

• Include quality_score or sufficiency_score ONLY if explicitly present.
• Otherwise set both to null.
• Never fabricate scores.

══════════════════════════════════════════════
OVERLAP RULE
══════════════════════════════════════════════

Only detect overlap if:
• Both workflows have start_date AND end_date.
• Date ranges intersect.

Otherwise:
→ overlap_flags must be []
→ global_overlaps must be []

Do NOT infer contraindications.

══════════════════════════════════════════════
DATA
══════════════════════════════════════════════

{json.dumps(aggregated_context, indent=2, default=str)}

══════════════════════════════════════════════
OUTPUT STRICT JSON ONLY
══════════════════════════════════════════════
OUTPUT STRICT JSON ONLY.

{{
  "generated_at": "",
  "patient_summary": "",
  "workflows": [
    {{
      "workflow_id": "",
      "workflow_type": "",
      "indication": "",
      "intent": "",
      "specialty": "",
      "responsible_doctor": "",
      "start_date": "",
      "end_date": "",
      "status": "",
      "pre": [],
      "during": [],
      "post": [],
      "clinical_details": {{}},
      "operational_details": {{}},
      "outcome": {{
        "response": "",
        "complications": [],
        "completion_notes": ""
      }},
      "linked_data": {{
        "labs": [],
        "imaging": [],
        "procedures": [],
        "prescriptions": []
      }},
      "scores": {{
        "quality_score": null,
        "sufficiency_score": null
      }},
      "audit_history": [],
      "overlap_flags": []
    }}
  ],
  "global_overlaps": []
}}
"""

    completion = groq_client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": prompt}],
        temperature=0,
        top_p=0,
        response_format={"type": "json_object"},
        max_tokens=6000
    )

    try:
        llm_output = json.loads(completion.choices[0].message.content)
    except Exception:
        logger.error("LLM JSON parsing failed")
        raise HTTPException(status_code=500, detail="LLM returned invalid JSON")

    logger.info("LLM Raw Workflow Output: %s", json.dumps(llm_output, indent=2))

    # =====================================================
    # 3️⃣ VALIDATION & ENFORCEMENT
    # =====================================================

    VALID_TYPES = {
        "Chemotherapy",
        "Radiotherapy",
        "Surgery",
        "Dialysis",
        "Interventional procedures",
        "Long-term therapy plans",
        "Custom workflows"
    }

    def ensure_structure(output):
        output.setdefault("generated_at", "")
        output.setdefault("patient_summary", "")
        output.setdefault("workflows", [])
        output.setdefault("global_overlaps", [])

        for wf in output["workflows"]:
            wf.setdefault("workflow_id", "")
            wf.setdefault("workflow_type", "")
            wf.setdefault("indication", "")
            wf.setdefault("intent", "")
            wf.setdefault("specialty", "")
            wf.setdefault("responsible_doctor", "")
            wf.setdefault("start_date", "")
            wf.setdefault("end_date", "")
            wf.setdefault("status", "")
            wf.setdefault("pre", [])
            wf.setdefault("during", [])
            wf.setdefault("post", [])
            wf.setdefault("clinical_details", {})
            wf.setdefault("operational_details", {})
            wf.setdefault("outcome", {"response": "", "complications": [], "completion_notes": ""})
            wf.setdefault("linked_data", {"labs": [], "imaging": [], "procedures": [], "prescriptions": []})
            wf.setdefault("scores", {"quality_score": None, "sufficiency_score": None})
            wf.setdefault("audit_history", [])
            wf.setdefault("overlap_flags", [])

        return output

    def enforce_valid_workflow_type(output):
        for wf in output.get("workflows", []):
            if wf.get("workflow_type") not in VALID_TYPES:
                wf["workflow_type"] = "Interventional procedures"
        return output

    def enforce_score_integrity(output):
        for wf in output.get("workflows", []):
            wf["scores"] = {
                "quality_score": None,
                "sufficiency_score": None
            }
        return output

    def enforce_overlap_integrity(output):
        workflows = output.get("workflows", [])
        overlaps = []

        for i in range(len(workflows)):
            for j in range(i + 1, len(workflows)):
                w1 = workflows[i]
                w2 = workflows[j]

                s1 = w1.get("start_date")
                e1 = w1.get("end_date")
                s2 = w2.get("start_date")
                e2 = w2.get("end_date")

                if s1 and e1 and s2 and e2:
                    if s1 <= e2 and s2 <= e1:
                        overlaps.append({
                            "workflow_1": w1.get("workflow_id"),
                            "workflow_2": w2.get("workflow_id")
                        })

        output["global_overlaps"] = overlaps
        return output

    def remove_patient_name(output):
        patient_summary = output.get("patient_summary")
        if isinstance(patient_summary, dict):
            patient_summary.pop("name", None)
            patient_summary.pop("full_name", None)
            patient_summary.pop("patient_name", None)
        return output
    
    def enforce_patient_summary_structure(output, patient_id):
        output["patient_summary"] = {
            "patient_id": patient_id,
            "conditions": [],
            "medications": []
        }
        return output
    


    llm_output = ensure_structure(llm_output)
    llm_output = enforce_valid_workflow_type(llm_output)
    llm_output = enforce_score_integrity(llm_output)
    llm_output = enforce_overlap_integrity(llm_output)
    llm_output = remove_patient_name(llm_output)
    llm_output = ensure_structure(llm_output)
    llm_output = enforce_patient_summary_structure(llm_output, patient_id)



    logger.info("LLM Validated Workflow Output: %s", json.dumps(llm_output, indent=2))

    # =====================================================
    # 4️⃣ FINAL RESPONSE
    # =====================================================

    return {
        "status": "success",
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "workflow_report": llm_output
    }

##########################################################################################################################################################################

@router.post("/prescription-investigation-master")
async def prescription_investigation_master(request: Request):

    try:
        body = await request.json()

        doctor_id = body.get("doctor_id")
        patient_id = body.get("patient_id")
        output_json = body.get("output_json")
        dictation = body.get("dictation")
        agentic_output = body.get("agentic_output")
        temp_data = body.get("temp_data")

        if not doctor_id or not patient_id:
            raise HTTPException(
                status_code=400,
                detail="doctor_id and patient_id are required"
            )

        logger.info("Starting Prescription-Investigation Master")
        logger.info("doctor_id=%s | patient_id=%s", doctor_id, patient_id)

        # ---------------------------------------------------------
        # 2️⃣.5 FETCH AGENTIC OUTPUT (SAFE & CORRECT)  ✅ YOUR BLOCK
        # ---------------------------------------------------------

        agentic_doc = None

        if not agentic_output:
            agentic_doc = agentic_data_collection.find_one(
                {"patient_id": patient_id},
                {"_id": 0}
            )

        if agentic_doc:
            agentic_output = agentic_doc.get("agentic_output") or agentic_doc.get("data")

        logger.info(
            "agentic_output=%s",
            json.dumps(agentic_output, indent=2, default=str)
        )

        # ---------------------------------------------------------
        # 2️⃣.6 FETCH TEMP DATA (IF NOT PROVIDED IN REQUEST) ✅ YOUR BLOCK
        # ---------------------------------------------------------

        temp_doc = temp_data_collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0}
        )

        if temp_doc:
            temp_data = temp_doc.get("data")

        logger.info(
            "temp_data=%s",
            json.dumps(temp_data, indent=2, default=str)
        )

        # ---------------------------------------------------------
        # 3️⃣ FETCH LATEST VITALS (FOR MEDICATION ENGINE)
        # ---------------------------------------------------------

        vitals_cursor = patient_vitals_collection.find(
            {"sys_user_id": patient_id},
            {"_id": 0}
        ).sort("recorded_at", -1).limit(3)

        latest_vitals = await vitals_cursor.to_list(length=3)

        vitals_text = (
            json.dumps(latest_vitals, indent=2, default=str)
            if latest_vitals else "No recent vitals available."
        )

        logger.info("latest_vitals=%s", vitals_text)

        # ---------------------------------------------------------
        # 3️⃣.5 FETCH RELEVANT TEMPLATES
        # ---------------------------------------------------------

        selected_condition = body.get("condition")
        selected_specialty = body.get("specialty")

        # ------------------------------
        # MEDICATION TEMPLATE QUERY
        # ------------------------------

        medication_query = {
            "doctor_id": doctor_id,
            "template_type": "medication",
            "is_active": True
        }

        if selected_condition:
            medication_query["condition"] = selected_condition

        if selected_specialty:
            medication_query["specialty"] = selected_specialty

        medication_templates = await template_master_collection.find(
            medication_query
        ).to_list(length=10)


        # ------------------------------
        # INVESTIGATION TEMPLATE QUERY
        # ------------------------------

        investigation_query = {
            "doctor_id": doctor_id,
            "template_type": "investigation",
            "is_active": True
        }

        if selected_condition:
            investigation_query["condition"] = selected_condition

        if selected_specialty:
            investigation_query["specialty"] = selected_specialty

        investigation_templates = await template_master_collection.find(
            investigation_query
        ).to_list(length=10)

        # ---------------------------------
        # FETCH TEMPLATE ITEMS
        # ---------------------------------

        # ---------------------------------
        # FETCH MEDICATION TEMPLATE ITEMS (OPTIMIZED)
        # ---------------------------------

        med_template_ids = [t["_id"] for t in medication_templates]

        if med_template_ids:
            all_med_items = await template_items_collection.find(
                {"template_id": {"$in": med_template_ids}}
            ).to_list(length=500)

            # group by template_id
            med_items_map = {}
            for item in all_med_items:
                med_items_map.setdefault(item["template_id"], []).append(item)

            # attach items
            for template in medication_templates:
                template["items"] = med_items_map.get(template["_id"], [])

        # ---------------------------------
        # FETCH INVESTIGATION TEMPLATE ITEMS (OPTIMIZED)
        # ---------------------------------

        inv_template_ids = [t["_id"] for t in investigation_templates]

        if inv_template_ids:
            all_inv_items = await template_items_collection.find(
                {"template_id": {"$in": inv_template_ids}}
            ).to_list(length=500)

            # group by template_id
            inv_items_map = {}
            for item in all_inv_items:
                inv_items_map.setdefault(item["template_id"], []).append(item)

            # attach items
            for template in investigation_templates:
                template["items"] = inv_items_map.get(template["_id"], [])


        # ---------------------------------------------------------
        # 4️⃣ BUILD MEDICATION PROMPT
        # ---------------------------------------------------------

        medication_prompt = build_medication_prompt(
            output_json=output_json,
            dictation=dictation,
            agentic_output=agentic_output,
            temp_data=temp_data,
            vitals_text=vitals_text
        )

        try:
            medication_completion = groq_client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[{"role": "user", "content": medication_prompt}],
                temperature=0,
                top_p=0,
                response_format={"type": "json_object"},
                max_tokens=6000
            )

            medication_raw = medication_completion.choices[0].message.content
            medication_json = json.loads(medication_raw)

        except json.JSONDecodeError:
            logger.error("Medication LLM returned invalid JSON")
            logger.error("Raw output: %s", medication_raw if 'medication_raw' in locals() else "No output")
            raise HTTPException(
                status_code=500,
                detail="Medication engine returned invalid JSON"
            )

        except Exception as e:
            logger.exception("Medication LLM execution failed")
            raise HTTPException(
                status_code=500,
                detail="Medication engine execution failed"
            )

        logger.info("Medication LLM parsed successfully")

        required_medication_keys = [
            "prescriptions",
            "safety_alerts",
            "safe_rx",
            "evidence_at_bedside",
            "overall_analysis"
        ]

        for key in required_medication_keys:
            if key not in medication_json:
                raise HTTPException(
                    status_code=500,
                    detail=f"Medication output missing key: {key}"
                )

        # ---------------------------------------------------------
        # 5️⃣ BUILD INVESTIGATION PROMPT
        # ---------------------------------------------------------

        investigation_prompt = build_investigation_prompt(
            feature_name="prescription-investigation-master",
            output_json=output_json,
            dictation=dictation,
            agentic_output=agentic_output,
            temp_data=temp_data
        )

        try:
            investigation_completion = groq_client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[{"role": "user", "content": investigation_prompt}],
                temperature=0,
                top_p=0,
                response_format={"type": "json_object"},
                max_tokens=6000
            )

            investigation_raw = investigation_completion.choices[0].message.content
            investigation_json = json.loads(investigation_raw)

        except json.JSONDecodeError:
            logger.error("Investigation LLM returned invalid JSON")
            logger.error("Raw output: %s", investigation_raw if 'investigation_raw' in locals() else "No output")
            raise HTTPException(
                status_code=500,
                detail="Investigation engine returned invalid JSON"
            )

        except Exception as e:
            logger.exception("Investigation LLM execution failed")
            raise HTTPException(
                status_code=500,
                detail="Investigation engine execution failed"
            )

        logger.info("Investigation LLM parsed successfully")

        required_investigation_keys = [
            "investigation_orders",
            "metadata"
        ]

        for key in required_investigation_keys:
            if key not in investigation_json:
                raise HTTPException(
                    status_code=500,
                    detail=f"Investigation output missing key: {key}"
                )


        # ---------------------------------------------------------
        # 6️⃣ RUN SAFETY ENGINE (INTERNAL)
        # ---------------------------------------------------------

        safety_json, audit_id = await run_drug_safety_engine(
            doctor_id=doctor_id,
            patient_id=patient_id,
            new_medications=medication_json.get("prescriptions", []),
            dictation=dictation
        )

        # ---------------------------------------------------------
        # 7️⃣ MERGE LAB MONITORING INTO INVESTIGATIONS (SAFE & DEDUPED)
        # ---------------------------------------------------------

        investigation_orders = investigation_json.get("investigation_orders", [])

        existing_names = {
            inv.get("investigation_name", "").strip().lower()
            for inv in investigation_orders
        }

        for lab in safety_json.get("lab_monitoring_plan", []):
            lab_name = lab.get("lab_name", "").strip()

            if not lab_name or lab_name.lower() in existing_names:
                continue

            # 🔍 Lookup in Investigation Master
            master_lab = await investigation_master_collection.find_one({
                "investigation_name": lab_name
            })

            if master_lab:
                investigation_orders.append({
                    "investigation_name": master_lab.get("investigation_name"),
                    "loinc_code": master_lab.get("loinc_code"),
                    "category": master_lab.get("category"),
                    "subcategory": master_lab.get("subcategory"),
                    "standard_indications": lab.get("clinical_reason"),
                    "sample_type": master_lab.get("sample_type"),
                    "fasting_required": master_lab.get("fasting_required", "Not specified"),
                    "priority": lab.get("priority", "Routine")
                })
            else:
                # fallback safe default
                investigation_orders.append({
                    "investigation_name": lab_name,
                    "loinc_code": None,
                    "category": "Lab",
                    "subcategory": "Not specified",
                    "standard_indications": lab.get("clinical_reason"),
                    "sample_type": None,
                    "fasting_required": "Not specified",
                    "priority": lab.get("priority", "Routine")
                })

            existing_names.add(lab_name.lower())


        # Update list back
        investigation_json["investigation_orders"] = investigation_orders

        # Ensure metadata exists
        if "investigation_orders" not in investigation_json:
            investigation_json["investigation_orders"] = []

        if "metadata" not in investigation_json:
            investigation_json["metadata"] = {}

        investigation_json["metadata"]["total_investigations"] = len(investigation_orders)


        # ---------------------------------------------------------
        # 8️⃣ RETURN UNIFIED MASTER RESPONSE
        # ---------------------------------------------------------

        return {
            "status": "success",
            "feature_id": "prescription-investigation-master",
            "audit_id": str(audit_id),


            # 🔹 TEMPLATE SUGGESTIONS FOR UI
            "available_templates": {
                "medication_templates": medication_templates,
                "investigation_templates": investigation_templates
            },

            # 🔹 LLM OUTPUT
            "medication_section": medication_json,
            "investigation_section": investigation_json,
            "safety_section": safety_json,

            # 🔹 COUNTS
            "metadata": {
                "medications_count": len(
                    medication_json.get("prescriptions", [])
                ),
                "investigations_count": len(
                    investigation_json.get("investigation_orders", [])
                )
            }
        }



    except Exception as e:
        logger.exception("Prescription Investigation Master Error")
        raise HTTPException(status_code=500, detail=str(e))
    


#--------------------------------------------------------------------------------------------#

def build_medication_prompt(
    output_json,
    dictation,
    agentic_output,
    temp_data,
    vitals_text
):

    agentic_json = json.dumps(agentic_output, indent=2, default=str) \
        if agentic_output else "No agentic output available."

    temp_data_text = json.dumps(temp_data, indent=2, default=str) \
        if temp_data else "No cached patient context available."

    # ✅ USE THE PASSED VALUE DIRECTLY
    vitals_section = vitals_text or "No recent vitals available."

    output_json_text = json.dumps(output_json, indent=2, default=str)

    dictation_text = dictation if dictation else "No dictation provided."

    # ⬇️ PASTE YOUR EXACT MEDICATION PROMPT HERE
    prompt = f""" 
    You are a STRICT CLINICAL MEDICATION ENTITY EXTRACTION
AND PER-MEDICATION ANALYSIS ASSISTANT.


OPERATING MODE: STRUCTURED CLINICAL EXTRACTION


You function strictly as a medical information extraction engine.
You are NOT a conversational AI.


Creativity is prohibited.
Uncontrolled speculation or reasoning beyond stated rules is prohibited.
Only structured clinical reasoning within defined rules is allowed.


Your tasks are to:


1. Extract ALL explicitly mentioned CURRENT prescriptions from output_json.
2. Structure each prescription using Master Medication Data fields.
3. Preserve exact prescribed dosage instructions.
4. Perform comprehensive SafeRx safety validation.
5. Analyze EACH medication individually.
6. Generate structured output exactly matching the required JSON schema.


You must separate:
- CURRENT prescriptions
- PREVIOUS medications (if mentioned)
- Safety findings
- Evidence and guideline validation


All content MUST be returned in the predefined JSON structure.


════════════════════════════════════
AGENTIC CLINICAL INTELLIGENCE (REFERENCE ONLY)
════════════════════════════════════


This data is structured clinical intelligence.
It is provided for contextual awareness ONLY.


⚠️ CRITICAL RULE:
- You MUST NOT extract medications from this section.
- You MUST NOT introduce new medications from this section.
- You MUST NOT modify medication list based on this section.
- You MAY use it ONLY for safety analysis context.


{agentic_json}


════════════════════════════════════
TEMP_DATA (CACHED PATIENT CONTEXT)
════════════════════════════════════


This section contains cached longitudinal patient context.
It may be valid for up to one month or until next update.


It may include:
- Baseline renal function
- Baseline hepatic function
- Weight trends
- Chronic comorbidities
- Known allergies
- Long-term medication tolerability
- Monitoring history


⚠️ RULES:
- Use ONLY for safety analysis and dose personalization.
- Do NOT extract medication names from this section.
- Do NOT override prescriptions with this section.
- If conflict exists, output_json is source of truth.


{temp_data_text}


════════════════════════════════════
LATEST VITAL SIGNS (LAST 3 RECORDS)
════════════════════════════════════


This section contains the most recent 3 recorded vital entries.


These may include:
- Blood pressure
- Heart rate
- Respiratory rate
- Temperature
- Oxygen saturation
- Weight
- BMI


⚠️ CRITICAL RULES:


- DO NOT extract medications from this section.
- DO NOT invent diagnoses from this section.
- Use vitals ONLY for:
    • Dose safety validation
    • Hemodynamic risk assessment
    • Fever-related antibiotic relevance
    • Hypertension or hypotension considerations
    • Weight-based dose validation
    • Insulin safety assessment
- If vitals conflict with prescription,
  highlight concern in safety_alerts.
- If vitals missing → explicitly state insufficiency
  where clinically required.


{vitals_text}




════════════════════════════════════
RAW CLINICAL DICTATION (SUPPORTING CONTEXT)
════════════════════════════════════


Extraction MUST be based ONLY on output_json.
Dictation may assist wording interpretation only.


Dictation:
{dictation_text}


════════════════════════════════════
DICTATION MEDICATION RECONCILIATION RULE (ZERO-MISS ENFORCEMENT)
════════════════════════════════════


This is a CRITICAL extraction safeguard.


You MUST perform a reconciliation scan between:
- RAW CLINICAL DICTATION
- DOCTOR-AUTHORED MEDICATION TEXT (output_json)


MANDATORY EXTRACTION LOGIC:


1. Scan the ENTIRE dictation text line-by-line.
2. Identify ANY explicitly prescribed medication that includes:
   - Drug name
   - OR drug class with dose
   - OR brand name
   - OR strength
   - OR route
   - OR frequency
   - OR duration
3. If a medication appears in dictation AND also appears in output_json:
   → Extract it normally from output_json.
4. If a medication appears clearly prescribed in dictation
   BUT is missing from output_json:
   → It MUST STILL be extracted as CURRENT medication.
   → Use exact wording from dictation.
   → Do NOT modify the dosage language.
5. If dictation mentions:
   - "Start"
   - "Begin"
   - "Add"
   - "Continue"
   - "Prescribe"
   - "Give"
   - "Increase to"
   - "Decrease to"
   → Treat as ACTIVE prescription unless explicitly marked as historical.


6. If dictation states:
   - "Stop"
   - "Discontinue"
   - "Hold"
   - "Previously on"
   → Do NOT classify as current prescription.


7. It is STRICTLY FORBIDDEN to miss any explicitly prescribed medication.


8. If even ONE medication from dictation is omitted:
   → OUTPUT MUST BE REGENERATED.


9. Partial extraction is NOT permitted.
   All active medications must appear in "prescriptions" array.


10. After extraction, perform a final validation step:
    - Count medications identified in dictation.
    - Count medications in prescriptions array.
    - If mismatch → REGENERATE.


This is a ZERO-MISS SYSTEM.
Medication omission is considered a critical failure.


════════════════════════════════════
DOCTOR-AUTHORED MEDICATION TEXT (SOURCE OF TRUTH)
════════════════════════════════════


Extraction MUST occur ONLY from the following:


{output_json_text}


════════════════════════════════════
PRESCRIPTION DETAILS
════════════════════════════════════


- Extract only NEW/CURRENT medications prescribed.
- Keep exact drug name and strength as written.
- Include dosage instructions covering dose, route, frequency, duration.
- Include quantity only if explicitly stated.
- Include refills only if explicitly stated.
- DO NOT modify prescribed dose or instructions.


Each medication must:
- Be handled separately.
- Have its own structured fields completed.
- Be analyzed independently in safety logic.


════════════════════════════════════
ROUTE RULE
════════════════════════════════════


For EACH medication:
- If route explicitly stated → extract verbatim.
- If not stated → determine most clinically standard route.
- Only one route allowed.
- If unclear → use "".
- Route must match dosage_form consistency.


════════════════════════════════════
FOLLOW-UP RULE
════════════════════════════════════


For EACH medication:
- If duration is provided → follow-up aligns with duration.
- If chronic medication → include appropriate monitoring follow-up.
- If medication requires lab monitoring → include relevant follow-up note.
- Do NOT invent unrelated follow-ups.
- If not applicable → use "".


════════════════════════════════════
PRESCRIPTION DETAILS
════════════════════════════════════


- Extract only the NEW/CURRENT medications prescribed.
- Keep exact drug name and strength as written.
- Include dosage instructions covering dose, route, frequency, and duration.
- Include quantity only if explicitly stated.
- Include refills only if explicitly stated.
- DO NOT modify prescribed dose or instructions.


════════════════════════════════════
MASTER MEDICATION DATA RULES
════════════════════════════════════


For EACH prescription include:


- generic_name
- brand_name (widely recognized, single brand only)
- category
- strength
- dosage_form
- route
- standard_frequency_options (array)
- standard_duration_options (array)
- special_instructions
- dosage_instructions (exact as prescribed)
- quantity
- refills


Do NOT invent missing strengths.
Leave unknown scalar fields as "".
Leave unknown arrays as [].


════════════════════════════════════
SAFETY ALERTS
════════════════════════════════════


- Identify safety concerns (allergy, interaction, renal/hepatic risk).
- Specify severity: danger | moderate | normal.
- Provide concise patient-specific reason.
- Cite authoritative references.
- Evaluate each medication individually AND cross-interactions.


════════════════════════════════════
SAFE RX ANALYSIS
════════════════════════════════════


- Use both current and previous medications for safety analysis.
- Use temp_data for renal/hepatic/weight-based dose adjustment.
- Report interaction, contraindication, dose error, antimicrobial misuse, allergy.
- Provide concise evidence-backed recommendations.


For antibiotics_analysis:
- If antibiotics present → return full object with:
  appropriateness, spectrum, resistance_risk,
  duration_check, allergy_interaction, references.
- If no antibiotics present → return "antibiotics_analysis": "none".


════════════════════════════════════
EVIDENCE AT BEDSIDE
════════════════════════════════════


- Provide concise guideline-based summary.
- Include relevant guidelines with year and section.
- Include key peer-reviewed studies when applicable.


════════════════════════════════════
OVERALL ANALYSIS
════════════════════════════════════


Provide concise integrated summary confirming consideration of:
- Age
- Gender
- Allergies
- Renal function
- Hepatic function
- Weight


════════════════════════════════════
SAFE_RX COMPLETENESS ENFORCEMENT (MANDATORY)
════════════════════════════════════


The "safe_rx" section MUST be fully evaluated.
If required patient data is unavailable, explicitly state:
"Insufficient data available to determine adjustment."
DO NOT fabricate clinical findings.




1. "principles" MUST contain:
   - A clear 1-line clinical safety summary.
   - It MUST reference medication safety principles.
   - It MUST NOT be empty.


2. "dose_personalization":
   - MUST evaluate renal function.
   - MUST evaluate hepatic function.
   - MUST evaluate weight if relevant.
   - If no adjustment required → explicitly state:
     "No renal dose adjustment required based on available data."
   - Each field MUST contain a sentence.
    If patient data is unavailable, explicitly state:
    "Insufficient clinical data available to determine adjustment."


   - Include authoritative references ONLY if a specific adjustment
    or safety concern is identified.
    DO NOT fabricate citations.




3. "issues_found":
   - MUST evaluate:
       ✔ interaction
       ✔ contraindication
       ✔ dose error
       ✔ antimicrobial misuse
       ✔ allergy conflict
   - If none found → return [].
   - Do NOT leave as null.


4. If ANY medication has monitoring requirement
   → mention in either:
      - dose_personalization
      OR
      - issues_found


5. If insulin is present:
   - Evaluate hypoglycemia monitoring need.
   - Include glucose monitoring consideration.
   - If no patient-specific data available,
     state monitoring recommendation without inventing risk history.




════════════════════════════════════
EVIDENCE AT BEDSIDE ENFORCEMENT
════════════════════════════════════


The "evidence_at_bedside" section MUST NOT be empty.


1. "summary":
   - 1-line evidence-based contextual summary.


2. guidelines:
   - Include guideline references ONLY if clinically applicable.
   - If no guideline directly relevant → return [].
   - DO NOT fabricate or use placeholder references.


   - Include:
       source
       section
       relevance


3. key_studies:
   - Include peer-reviewed study ONLY if clinically required.
   - If not required → return [].
   - DO NOT fabricate citations.


   - Must include:
       full citation
       short finding


If no major study required:
   - guidelines array MUST still contain at least one authoritative guideline reference.


════════════════════════════════════
OVERALL_ANALYSIS ENFORCEMENT
════════════════════════════════════


"overall_analysis" MUST:


- Be 1–2 sentences.
- Explicitly confirm consideration of:
   ✔ Age
   ✔ Gender
   ✔ Allergies
   ✔ Renal function
   ✔ Hepatic function
   ✔ Weight
- Integrate safety + appropriateness + monitoring.


It MUST NOT be empty.


════════════════════════════════════
CLINICAL DEPTH ENFORCEMENT (MANDATORY)
════════════════════════════════════


Superficial, placeholder, or generic outputs are STRICTLY FORBIDDEN.


The following will trigger regeneration:


- Empty reasoning fields
- Placeholder phrases (e.g., “Medication safety principles applied”)
- Generic guideline labels (e.g., “Clinical guideline”, “Section 1”)
- Alert objects with "none"
- Blank severity values
- Incomplete dosage instructions
- Missing monitoring considerations when clinically required


All reasoning must be medication-specific and patient-contextual.


════════════════════════════════════
DOSAGE INSTRUCTION ENFORCEMENT
════════════════════════════════════


For EACH medication:


"dosage_instructions" MUST include, when available in source:
- Dose
- Route
- Frequency
- Duration


If strength is present in the prescription,
dosage_instructions MUST reflect it.


If duration is provided in any form,
it must be integrated into dosage_instructions.


If any of the above are available but omitted,
the output MUST be regenerated.


- "frequency" MUST be extracted explicitly if present in source.
- If frequency exists in prescription text, it MUST populate both:
    1. "frequency"
    2. "dosage_instructions"
- If not stated → use "".


════════════════════════════════════
SAFETY_ALERTS ENFORCEMENT
════════════════════════════════════


1. If no real safety concern exists:
   → return "safety_alerts": [].
   → DO NOT create placeholder alert objects.


2. If a safety concern exists:
   Each alert MUST include:
   - medication
   - alert (specific clinical issue)
   - reason (patient-specific context)
   - severity (danger | moderate | normal)
   - references (authoritative source with year)


3. Alert objects with "none"




4. Generic or empty alerts are NOT permitted.


════════════════════════════════════
MEDICATION-SPECIFIC SAFETY ENFORCEMENT
════════════════════════════════════


For EACH medication:


The system MUST evaluate:
- Known class-based risks
- Organ function impact (renal/hepatic)
- Monitoring requirements
- Dose appropriateness
- Cross-medication interactions


If a medication inherently requires monitoring,
that monitoring must be addressed in:
- safety_alerts
OR
- dose_personalization
OR
- issues_found


If clinically expected safety evaluation is missing,
the output MUST be regenerated.


════════════════════════════════════
SAFE_RX DEPTH ENFORCEMENT
════════════════════════════════════


1. "principles" MUST:
   - Mention multiple safety dimensions such as:
       renal review
       hepatic review
       interaction screening
       dose validation
       monitoring plan
   - Be medication-specific.
   - Generic statements are FORBIDDEN.


2. "dose_personalization":
   - MUST evaluate renal function if medication is renally cleared.
   - MUST evaluate hepatic function if hepatically metabolized.
   - MUST evaluate weight if dosing is weight-sensitive.
   - If no adjustment required → justification is mandatory.
   - Cannot be empty or generic.


3. "issues_found":
   - MUST evaluate interaction and contraindication risk.
   - If none found → return [].
   - Do NOT fabricate issues.


4. Vitals Review:
   - Evaluate last 3 vitals for:
       blood pressure stability
       heart rate abnormalities
       fever
       hypoxia
       weight change
   - If medication affects hemodynamics
     → MUST consider BP/HR.
   - If insulin or antidiabetic present
     → MUST consider weight.
   - If antibiotic present
     → MUST consider temperature.
   - If abnormal vitals clinically relevant
     → address in safety_alerts OR dose_personalization.
   - If vitals unavailable
     → explicitly state:
       "Insufficient recent vitals available for assessment."




════════════════════════════════════
EVIDENCE AT BEDSIDE ENFORCEMENT
════════════════════════════════════


1. "summary":
   - Must be medication-specific.
   - Must reflect clinical rationale.


2. "guidelines":
   - Must reference recognized authoritative clinical bodies.
   - Must include publication year.
   - Must include a meaningful section reference.
   - Placeholder labels are NOT permitted.


3. "key_studies":
   - Required if medication carries significant safety or outcome implications.
   - Must include real citation format.
   - If not required, may return [].


Generic evidence sections are FORBIDDEN.


════════════════════════════════════
OVERALL_ANALYSIS ENFORCEMENT
════════════════════════════════════


"overall_analysis" MUST:


- Integrate:
    age
    gender
    allergies
    renal function
    hepatic function
    weight
- Mention monitoring when relevant.
- Confirm safety validation was performed.
- Be clinically meaningful.
- Must NOT be generic.


════════════════════════════════════
FINAL VALIDATION CHECK
════════════════════════════════════


Before returning JSON:


- If a reasoning field is clinically required and omitted → REGENERATE.
- If clinical data is unavailable → explicitly state insufficiency.
- If any section contains generic filler language → REGENERATE.
- If dosage_instructions incomplete → REGENERATE.
- If safety analysis is superficial → REGENERATE.
- If authoritative references are missing when required → REGENERATE.


Return JSON ONLY after all validations pass.


════════════════════════════════════
OUTPUT FORMAT (HARD JSON LOCK – MASTER RX + SAFERX)
════════════════════════════════════


Return ONLY valid JSON.


Response MUST:
- Start with {{
- End with }}
- Contain EXACTLY these keys:
  "prescriptions",
  "safety_alerts",
  "safe_rx",
  "evidence_at_bedside",
  "overall_analysis"


Structure:


{{
  "prescriptions": [
    {{
      "medication": "",
      "generic_name": "",
      "brand_name": "",
      "category": "",
      "strength": "",
      "dosage_form": "",
      "route": "",
      "frequency": "",
      "follow_up": "",
      "standard_frequency_options": [],
      "standard_duration_options": [],
      "special_instructions": "",
      "dosage_instructions": "",
      "quantity": "",
      "refills": ""
    }}
  ],
  "safety_alerts": [],
  "safe_rx": {{
    "principles": "",
    "dose_personalization": {{
      "renal_adjustment": "",
      "hepatic_adjustment": "",
      "weight_adjustment": "",
      "references": []
    }},
    "antibiotics_analysis": "none",
    "issues_found": []
  }},
  "evidence_at_bedside": {{
    "summary": "",
    "guidelines": [],
    "key_studies": []
  }},
  "overall_analysis": ""
}}


CRITICAL VALIDATION RULES:


1. If no medications → "prescriptions": [].
2. Each medication must be analyzed separately.
3. Route must follow Route Rule.
4. Follow-up must follow Follow-Up Rule.
5. If no safety alerts → "safety_alerts": [].
6. If no issues found → "issues_found": [].
7. If no antibiotics → keep "antibiotics_analysis": "none".
8. Leave unknown scalar fields as "".
9. Leave unknown arrays as [].
10. Ensure strict JSON validity.


════════════════════════════════════
BRAND NAME RULE (MANDATORY & STRICT)
════════════════════════════════════


For EACH prescription:


1. If "medication" field is NOT empty:
   - "brand_name" MUST NOT be empty.
   - You MUST predict the most widely recognized and commonly used brand name.
   - Only ONE brand name is allowed.
   - Do NOT output multiple brand names.
   - Do NOT include dosage strength in the brand_name field.
   - Brand name must be a real, commercially recognized brand.


2. If the medication is a generic compound:
   - Map it to the most globally recognized brand.
   - Example:
       paracetamol → Crocin / Tylenol (choose ONE)
       metformin → Glucophage
       amoxicillin → Amoxil


3. If medication is biologic (e.g., insulin):
   - Predict the most commonly used branded formulation.
   - Example:
       insulin regular → Humulin R
       insulin glargine → Lantus


4. brand_name MUST be:
   - A single string
   - Capitalized properly
   - Free of strength or dosing information
   - Free of route information


5. It is NOT permitted to leave "brand_name" as "" if medication exists.


6. If multiple brands exist:
   - Choose the most globally recognized brand.
    If no reliable brand mapping exists:
    - Use "".
    DO NOT fabricate unknown brands.




7. If medication field is empty:
   - brand_name MUST be "".


════════════════════════════════════
MANDATORY FINAL VALIDATION
════════════════════════════════════


Before returning JSON:


1. Ensure EACH prescription contains ALL fields:
   - medication
   - generic_name
   - brand_name (MUST NOT be empty)
   - category
   - strength
   - dosage_form
   - route
   - follow_up
   - standard_frequency_options
   - standard_duration_options
   - special_instructions
   - dosage_instructions
   - quantity
   - refills


2. Ensure EACH safety_alert contains:
   - medication
   - alert
   - reason
   - severity
   - references


3. If brand_name is empty while medication exists → REGENERATE.


4. If follow_up missing → REGENERATE.


5. If dosage_instructions does not include dose + route + frequency + duration → REGENERATE.


6. If antibiotics present → antibiotics_analysis MUST be object.


Only after all checks pass → return JSON.




════════════════════════════════════
JSON SCALAR TYPE ENFORCEMENT (MANDATORY)
════════════════════════════════════


This system feeds a strict React UI.


The following fields MUST ALWAYS be returned as STRING scalars
and MUST NEVER be objects or arrays:


- overall_analysis
- safe_rx.principles
- evidence_at_bedside.summary
- follow_up
- special_instructions
- dosage_instructions
- category
- strength
- dosage_form
- route
- frequency


If structured or multi-point reasoning exists for any of the above:
→ Convert it into a concise, human-readable sentence.
→ Do NOT return JSON, objects, bullet lists, or arrays.


Violation of scalar type requirements REQUIRES REGENERATION.






════════════════════════════════════
ANTIBIOTICS_ANALYSIS TYPE RULE (MANDATORY)
════════════════════════════════════


If antibiotics are present:


- "antibiotics_analysis" MUST be a JSON OBJECT
  with the EXACT keys:
    appropriateness
    spectrum
    resistance_risk
    duration_check
    allergy_interaction
    references


- Each non-reference value MUST be a STRING.
- "references" MUST be an ARRAY of STRINGS.


If no antibiotics are present:
- "antibiotics_analysis" MUST be the STRING "none".


No other formats are permitted.






════════════════════════════════════
ARRAY CONTENT ENFORCEMENT (MANDATORY)
════════════════════════════════════


For ALL array fields:


- Arrays MUST contain ONLY STRINGS.
- Arrays MUST NOT contain objects.
- Arrays MUST NOT contain nested arrays.


If array elements are complex:
→ Flatten into concise string representations.


Violation requires regeneration.




════════════════════════════════════
FINAL SCHEMA VALIDATION (HARD LOCK)
════════════════════════════════════


Before returning JSON:


- Ensure safe_rx.principles is NOT empty.
- Ensure evidence_at_bedside.summary is NOT empty.
- Ensure overall_analysis is NOT empty.
- Ensure each medication analyzed individually.
- If any required field is empty when it should contain clinical reasoning → REGENERATE.
- Do NOT return partially populated sections.
  Only after all checks pass → return JSON.
BEGIN EXTRACTION.
"""


    return prompt

#---------------------------------------------------------------------------------------------#

def build_investigation_prompt(
    feature_name,
    output_json,
    dictation,
    agentic_output,
    temp_data
):

    agentic_json = json.dumps(agentic_output, indent=2, default=str) \
        if agentic_output else "No agentic data provided."

    temp_data_text = json.dumps(temp_data, indent=2, default=str) \
        if temp_data else "No cached data available."

    output_json_text = json.dumps(output_json, indent=2, default=str)

    dictation_text = dictation if dictation else "No dictation provided."

    # ⬇️ PASTE YOUR EXACT INVESTIGATION PROMPT HERE
    prompt = f"""
You are a CLINICAL INVESTIGATION ORDER PROCESSOR.


Your role is to TRANSFORM doctor-authored investigation data
into structured, executable, frontend-ready investigation orders.


════════════════════════════════════
FEATURE CONTEXT
════════════════════════════════════
Feature Name: {feature_name}


════════════════════════════════════
PRIMARY INVESTIGATION SOURCE (AUTHORITATIVE)
════════════════════════════════════
This is the ONLY source of investigations.
You MUST NOT introduce new tests.


{output_json_text}




════════════════════════════════════
AGENTIC DATA (CLARIFICATION ONLY)
════════════════════════════════════
This data may clarify grouping or intent.
It MUST NOT introduce new investigations.


{agentic_json}




════════════════════════════════════
TEMP DATA (REFERENCE ONLY)
════════════════════════════════════
This data may contain cached or previously structured information.
Use only for clarification.
Do NOT expand investigation scope.


{temp_data_text}




════════════════════════════════════
DOCTOR DICTATION (CLARITY ONLY)
════════════════════════════════════
The dictation may clarify purpose or grouping.
It MUST NOT introduce new investigations.


{dictation_text}




════════════════════════════════════
GENERATION RULES (STRICT)
════════════════════════════════════


1️⃣ Extract investigations from:
   - OUTPUT_JSON (primary source)
   - Doctor dictation (secondary source)


2️⃣ If an investigation appears in both sources:
   - Merge them
   - Do NOT duplicate


3️⃣ Normalize investigations:


   - If a statement contains multiple investigations
     connected by "and", commas, or similar connectors,
     they MUST be separated into individual entries.


   - Do NOT keep combined investigation names.


   - Remove words such as "Repeat", "urgent",
     or "as per protocol" from investigation_name.
     These should influence priority only.




4️⃣ Classify and enrich each investigation using standard
   medical knowledge when not explicitly documented:


   - "category":
        • Lab → Tests requiring a biological specimen
                 (blood, urine, tissue, etc.)
        • Imaging → Radiological imaging studies
                    (X-ray, CT, MRI, Ultrasound)
        • Other → Functional or non-radiological diagnostic tests
                  (e.g., ECG, EEG, Spirometry)


   - "subcategory":
        • For Lab → Use laboratory discipline
                    (Hematology, Biochemistry, Microbiology, etc.)
        • For Imaging → Use Radiology or modality grouping
        • For Other → Use clinical domain
                      (e.g., Cardiology, Pulmonology)


   - "sample_type":
        • Use standard specimen type if applicable
          (Blood, Urine, Tissue, etc.)
        • If no specimen is collected → set to null


   - "standard_indications":
        • Provide ONE concise clinical purpose phrase
        • Do NOT list multiple textbook conditions
        • Do NOT generate long explanations


   - "fasting_required":
        • "Yes" if typically required
        • "No" if typically not required
        • "Not specified" if variable or unclear


   - "priority":
        • "Urgent" if explicitly stated in source


        • OR if the documented clinical context suggests
        the investigation is required for immediate
        evaluation of a potentially serious or unstable condition


        • Otherwise "Routine"
   
   - "loinc_code":
        • Provide the most commonly used ORDER-LEVEL LOINC code 
          for placing a diagnostic order.
          Do NOT provide:
            - Result-level LOINC codes
            - Interpretation codes
            - Panel component codes
            If uncertain, set loinc_code to null.

        • If multiple LOINC variants exist, select the most commonly used generic order code
        • If no appropriate LOINC exists → set to null
        • Do NOT fabricate non-existent codes




5️⃣ If explicit instructions exist in dictation,
   they override predicted values.


6️⃣ Use agentic_data and temp_data ONLY for clarification.
   Do NOT introduce new investigations.


7️⃣ DO NOT:
   ⛔ Invent new investigations
   ⛔ Generate exaggerated clinical reasoning
   ⛔ Create non-standard categories
   ⛔ Add fields outside the defined schema
8️⃣ Medication Safety Filter:


If an extracted item represents a medication, drug, dosage, formulation, brand name, or therapeutic instruction,
it MUST NOT be included as an investigation.


Medications must be completely excluded from investigation_orders.


Only diagnostic tests, imaging studies, or functional investigations are allowed as investigation_name.
9️⃣ LOINC Assignment Rules:


- Assign a valid standard LOINC code when available.
- Prefer commonly used order-level LOINC codes.
- Do NOT invent or guess fabricated codes.
- If uncertain → set loinc_code to null.
- Imaging studies should only include LOINC if a valid radiology LOINC exists.
- ECG/EEG and functional studies may have LOINC if standardized.

Vitals (heart rate, blood pressure, urine output) are NOT investigations.
They must NOT appear in investigation_orders.


════════════════════════════════════
OUTPUT FORMAT (STRICT JSON ONLY)
════════════════════════════════════


Return ONLY valid JSON in this exact structure:


{{
  "status": "success",
  "feature_id": "documentation-investigation-notes",
  "feature_name": "<feature_name>",
  "display_method": "structured_table",
  "investigation_orders": [
    {{
      "investigation_name": "",
      "loinc_code": null,
      "category": "",
      "subcategory": "",
      "standard_indications": null,
      "sample_type": null,
      "fasting_required": "Not specified",
      "priority": "Not specified"
    }}
  ],
  "metadata": {{
    "total_investigations": 0
  }}
}}


STRICT OUTPUT RULES:
- investigation_orders MUST be a LIST
- Each object MUST contain ONLY:
    • investigation_name
    • loinc_code
    • category
    • subcategory
    • standard_indications
    • sample_type
    • fasting_required
    • priority
- No additional fields are allowed
- If a field is not explicitly documented → set it to null
- fasting_required MUST be one of:
    "Yes", "No", "Not specified"
- priority MUST be one of:
    "Routine", "Urgent", "Not specified"
- total_investigations MUST match the list length
- Output JSON only
- Do NOT include explanations




BEGIN TRANSFORMATION.
"""

    return prompt




async def run_drug_safety_engine(
        doctor_id: str,
        patient_id: str,
        new_medications: list,
        dictation: str
    ):


    try:

        # ---------------------------------------------------------
        # 1️⃣ FETCH EXISTING MEDICATIONS FROM DB
        # ---------------------------------------------------------

        cursor = documentation_medication_analysis_collection.find(
            {"patient_id": patient_id},
            {"_id": 0}
        ).sort("_id", -1).limit(5)

        existing_medications = []

        async for doc in cursor:
            meds = doc.get("prescriptions", [])
            if isinstance(meds, list):
                existing_medications.extend(meds)

        # Final safety cap (optional but safe)
        existing_medications = existing_medications[:5]
        
        # ---------------------------------------------------------
        # 2️⃣.5 COMPARE NEW vs EXISTING MEDICATIONS
        # ---------------------------------------------------------

        comparison_summary = {
            "continued": [],
            "newly_added": [],
            "dose_changed": [],
            "route_changed": []
        }

        for new_med in new_medications:
            name = new_med.get("medication")

            match = next(
                (m for m in existing_medications if m.get("medication") == name),
                None
            )

            if not match:
                comparison_summary["newly_added"].append(new_med)
            else:
                if new_med.get("strength") != match.get("strength"):
                    comparison_summary["dose_changed"].append(new_med)

                elif new_med.get("route") != match.get("route"):
                    comparison_summary["route_changed"].append(new_med)

                else:
                    comparison_summary["continued"].append(new_med)


        # ---------------------------------------------------------
        # 3️⃣ FETCH LATEST VITALS
        # ---------------------------------------------------------

        vitals_cursor = patient_vitals_collection.find(
            {"sys_user_id": patient_id},
            {"_id": 0}
        ).sort("recorded_at", -1).limit(3)

        latest_vitals = await vitals_cursor.to_list(length=3)

        # ---------------------------------------------------------
        # 4️⃣ BUILD SAFETY COMPARISON PROMPT
        # ---------------------------------------------------------

        safety_prompt = f"""
You are a STRICT CLINICAL DRUG SAFETY ENGINE.

Perform interaction comparison between:

MEDICATION COMPARISON SUMMARY:
{json.dumps(comparison_summary, indent=2, default=str)}

EXISTING MEDICATIONS:
{json.dumps(existing_medications, indent=2, default=str)}

NEW MEDICATIONS:
{json.dumps(new_medications, indent=2, default=str)}

LATEST VITALS:
{json.dumps(latest_vitals, indent=2, default=str)}

You must:
- Simulate Stockley-style interaction checking
- Provide severity grading (danger | moderate | normal)
- Provide mechanism explanation
- Provide clinical management advice
- Provide monitoring requirements
- Validate IV compatibility if injectable
- Highlight additive ADR risks
- If a medication appears pharmacologically similar but not identical
  to an existing medication, evaluate whether it represents substitution.
- Highlight formulation differences and therapeutic duplication.
- Return STRICT JSON
- LAB MONITORING GENERATION (MANDATORY):

    - Generate lab monitoring recommendations based on:
        • Medication mechanism
        • Known ADR risks
        • Clinical condition from dictation
        • Vital sign trends
        • Organ function monitoring needs

    - Each lab recommendation must include:
        • lab_name
        • clinical_reason
        • suggested_frequency
        • priority (Routine | Urgent)

    - If no lab monitoring required:
        Return empty array [].

    - Do NOT fabricate irrelevant labs.
    - Do NOT suggest labs unrelated to medications or dictation.
- Simulate a global drug database (Martindale-style).
- Provide alternative brand names and international preparations.
- Identify therapeutic duplication.
- Therapeutic duplication applies ONLY when:
    • Two medications belong to the SAME pharmacological class
    • AND no evidence-based guideline supports combined use

- Guideline-supported combinations (e.g., dual antiplatelet therapy)
  MUST NOT be labeled as duplication.

- Evaluate duplication based on drug class,
  not merely on therapeutic indication overlap.

- Detect same-class substitutions.
- Highlight formulation differences (IR vs ER, oral vs IV).
- Provide ADR reference profile.
- Flag psychotropic medications and apply psychiatric prescribing safeguards.
- Provide lab monitoring suggestions linked to parameters.
- Suggest follow-up interval if monitoring required.
- Standard cardiology regimens (dual antiplatelet + statin + beta blocker + diuretic)
  should NOT automatically be labeled as "danger".
  Escalate severity only when patient-specific instability is present.

════════════════════════════════════
STRUCTURE ENFORCEMENT (MANDATORY)
════════════════════════════════════

- Each object inside "alerts" MUST contain ONLY:
    medication
    severity
    mechanism
    clinical_management
    monitoring_requirements
    additive_ADR_risks

- DO NOT nest substitution_analysis inside alerts.
- DO NOT nest drug_reference inside alerts.
- substitution_analysis must exist ONLY at root level.
- drug_reference must exist ONLY at root level.

- lab_name MUST represent a measurable laboratory parameter.
  (e.g., Serum potassium, Creatine kinase, ALT, INR)
  Do NOT return symptoms such as "hearing loss".

- Do NOT suggest obsolete tests (e.g., bleeding time).

- Injectable compatibility applies ONLY when two IV drugs
  are co-administered through the same line.
  If not applicable:
      {{
        "compatible": null,
        "reason": "Not applicable"
      }}
- overall_severity MUST equal the highest severity
  among all alert objects.

    If any alert = danger → overall_severity = danger
    Else if any alert = moderate → overall_severity = moderate
    Else → overall_severity = normal

- Do NOT over-label overall_severity as "danger".
  Use "danger" ONLY when immediate life-threatening risk exists.


Return ONLY:

{{
  "alerts": [],
  "lab_monitoring_plan": [
    {{
      "lab_name": "",
      "clinical_reason": "",
      "suggested_frequency": "",
      "follow_up_interval": "",
      "priority": "Routine"
    }}
  ],
  "injectable_compatibility": {{
      "compatible": true,
      "reason": ""
  }},
  "substitution_analysis": {{
      "therapeutic_duplication": [],
      "possible_alternatives": [],
      "formulation_differences": []
  }},
  "drug_reference": {{
      "adr_profile": [],
      "psychotropic_flag": false,
      "international_brands": []
  }},
  "overall_severity": ""
}}


"""

        safety_completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": safety_prompt}],
            temperature=0,
            response_format={"type": "json_object"},
            max_tokens=2000
        )

        safety_json = json.loads(safety_completion.choices[0].message.content)
        
        # ---------------------------------------------------------
        # 4️⃣.5 DETERMINISTIC SEVERITY AGGREGATION
        # ---------------------------------------------------------

        severity_rank = {
            "normal": 1,
            "moderate": 2,
            "danger": 3
        }

        highest = 1

        for alert in safety_json.get("alerts", []):
            level = alert.get("severity", "normal")
            highest = max(highest, severity_rank.get(level, 1))

        for key, value in severity_rank.items():
            if value == highest:
                safety_json["overall_severity"] = key
                break
        
        # ---------------------------------------------------------
        # 4️⃣.6 INJECTABLE VALIDATION GUARDRAIL
        # ---------------------------------------------------------

        iv_meds = [
            m for m in new_medications
            if m.get("route", "").lower() in ["iv", "intravenous"]
        ]

        if len(iv_meds) < 2:
            safety_json["injectable_compatibility"] = {
                "compatible": None,
                "reason": "No concurrent IV co-administration scenario identified."
            }

        
        # ---------------------------------------------------------
        # 4️⃣.7 LAB VALIDATION FILTER
        # ---------------------------------------------------------

        filtered_labs = []

        for lab in safety_json.get("lab_monitoring_plan", []):
            if (
                isinstance(lab, dict)
                and isinstance(lab.get("lab_name"), str)
                and lab.get("lab_name").strip() != ""
                and isinstance(lab.get("clinical_reason"), str)
                and isinstance(lab.get("suggested_frequency"), str)
                and isinstance(lab.get("follow_up_interval"), str)
                and lab.get("priority") in ["Routine", "Urgent"]
            ):
                filtered_labs.append(lab)

        safety_json["lab_monitoring_plan"] = filtered_labs
        
        # ---------------------------------------------------------
        # 4️⃣.8 DUPLICATION SANITY CHECK
        # ---------------------------------------------------------

        if "substitution_analysis" in safety_json:
            duplication = safety_json["substitution_analysis"].get("therapeutic_duplication", [])

            # remove duplicates that are also in 'continued'
            med_names = {m["medication"].lower() for m in new_medications}

            cleaned = []
            for d in duplication:
                if d.get("medication", "").lower() in med_names:
                    cleaned.append(d)

            safety_json["substitution_analysis"]["therapeutic_duplication"] = cleaned

        # ---------------------------------------------------------
        # 4️⃣.9 MONITORING TRACKER (COMPLETE & SAFE)
        # ---------------------------------------------------------

        monitoring_flags = []

        for lab in safety_json.get("lab_monitoring_plan", []):
            lab_name = lab.get("lab_name")

            if not lab_name:
                continue

            last_lab = await database["lab-results"].find_one(
                {
                    "patient_id": patient_id,
                    "lab_name": lab_name
                },
                sort=[("recorded_at", -1)]
            )

            if last_lab:
                monitoring_flags.append({
                    "lab_name": lab_name,
                    "status": "Previously performed",
                    "last_performed_at": last_lab.get("recorded_at"),
                    "suggested_frequency": lab.get("suggested_frequency"),
                    "follow_up_interval": lab.get("follow_up_interval")
                })
            else:
                monitoring_flags.append({
                    "lab_name": lab_name,
                    "status": "Never performed",
                    "last_performed_at": None,
                    "suggested_frequency": lab.get("suggested_frequency"),
                    "follow_up_interval": lab.get("follow_up_interval")
                })

        safety_json["monitoring_status"] = monitoring_flags


        # ---------------------------------------------------------
        # 5️⃣ AUDIT LOGGING
        # ---------------------------------------------------------

        audit_record = await documentation_medication_analysis_collection.insert_one({
            "doctor_id": doctor_id,
            "patient_id": patient_id,
            "prescriptions": new_medications,
            "comparison_summary": comparison_summary,
            "safety_analysis": safety_json,
            "created_at": datetime.utcnow(),
            "overrides": []
        })



        return safety_json, audit_record.inserted_id


    except Exception as e:
        logger.exception("Drug Safety Check Error")
        raise HTTPException(status_code=500, detail=str(e))
@router.post("/medication-safety/override")
async def override_interaction(request: Request):
    try:
        body = await request.json()

        audit_id = body.get("audit_id")
        alert_index = body.get("alert_index")
        override_reason = body.get("override_reason")
        doctor_id = body.get("doctor_id")

        if not all([audit_id, alert_index is not None, override_reason, doctor_id]):
            raise HTTPException(status_code=400, detail="Missing required fields")

        await documentation_medication_analysis_collection.update_one(
            {"_id": ObjectId(audit_id)},
            {
                "$push": {
                    "overrides": {
                        "alert_index": alert_index,
                        "override_reason": override_reason,
                        "doctor_id": doctor_id,
                        "timestamp": datetime.utcnow()
                    }
                }
            }
        )


        return {"status": "override_logged"}

    except Exception as e:
        logger.exception("Override logging failed")
        raise HTTPException(status_code=500, detail=str(e))

#azfar
#17-02-2026

########################################################################################################################################################################

#######################################################Alwin new treatment plan new function with treatment indent ########################################################################################################################################################################



@router.post("/generate_treatment_plan")
async def generate_treatment_plan(request: Request):
    """
    Generate clinical treatment plan from doctor dictation with AI enhancements.
    
    REQUIRED: Treatment Intent must be selected by doctor
    Options: curative, palliative, supportive, diagnostic
    
    Processes doctor dictation, validates against agentic intelligence,
    and provides optional AI suggestions without overriding doctor authority.
    """
    try:
        # ---------------------------------------------------------
        # 0️⃣ EXTRACT PAYLOAD
        # ---------------------------------------------------------
        body = await request.json()

        doctor_id = body.get("doctor_id")
        patient_id = body.get("patient_id")
        dictation = body.get("dictation")
        treatment_intent = body.get("treatment_intent")  # REQUIRED field
        temp_data = body.get("temp_data")
        agentic_output = body.get("agentic_output")

        logger.info("Received payload for treatment plan generation: %s", body)

        # Validate required fields
        if not doctor_id or not patient_id:
            raise HTTPException(
                status_code=400,
                detail="doctor_id and patient_id are required"
            )

        # TREATMENT INTENT IS REQUIRED
        if not treatment_intent:
            raise HTTPException(
                status_code=400,
                detail="treatment_intent is REQUIRED. Must be one of: curative, palliative, supportive, diagnostic"
            )

        # Validate treatment_intent value
        valid_intents = ["curative", "palliative", "supportive", "diagnostic"]
        if treatment_intent not in valid_intents:
            raise HTTPException(
                status_code=400,
                detail=f"treatment_intent must be one of: {', '.join(valid_intents)}"
            )

        # ---------------------------------------------------------
        # 3️⃣ FETCH AGENTIC OUTPUT (FROM DB IF NOT PROVIDED)
        # ---------------------------------------------------------
        # Fetch Agentic Data
        agentic_output = None
        agentic_doc = agentic_data_collection.find_one(
            {
                "patient_id": patient_id,
                "doctor_id": doctor_id
            },
            {
                "_id": 0,
                "data": 1,
                "version": 1
            },
            sort=[("version", -1)]
        )

        if agentic_doc and agentic_doc.get("data"):
            agentic_output = agentic_doc["data"]

        has_agentic_data = agentic_output is not None
        logger.info("has_agentic_data=%s", has_agentic_data)
        logger.info(f"Agentic data: {agentic_output}")

        # ---------------------------------------------------------
        # 3️⃣ FETCH TEMP DATA
        # ---------------------------------------------------------
        clinical_data = {}  # Initialize clinical_data before referencing it

        temp_data = None
        temp_doc = temp_data_collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0}
        )

        if temp_doc:
            temp_clinical_data = {}

            # Dynamically extract all temp fields except identifiers
            for key, value in temp_doc.items():
                if key not in ["patient_id", "doctor_id", "created_at"]:
                    temp_clinical_data[key] = value

            if temp_clinical_data:
                clinical_data["temp_data"] = temp_clinical_data

        temp_data_json = json.dumps(
            clinical_data.get("temp_data", {}),
            indent=2,
            default=str
        )
        logger.info(f"Temp data: {temp_data_json}")
        # ---------------------------------------------------------
        # 3️⃣ FETCH CLINICAL DATA
        # ---------------------------------------------------------
        clinical_data = {}

        # Medical Context
        doc = await medical_context_collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0}
        )

        if doc:
            medical_context = []
            for ctx in doc.get("medical_contexts", []):
                texts = [
                    c.get("text")
                    for c in ctx.get("conditions", [])
                    if c.get("text")
                ]
                if texts:
                    medical_context.append({
                        "date": ctx.get("date"),
                        "conditions": texts
                    })
            if medical_context:
                clinical_data["medical_context"] = medical_context

        # Current Context
        doc = await current_context_collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0}
        )

        if doc:
            current_context = []
            for ctx in doc.get("current_contexts", []):
                texts = [
                    c.get("text")
                    for c in ctx.get("current_condition", [])
                    if c.get("text")
                ]
                if texts:
                    current_context.append({
                        "date": ctx.get("date"),
                        "current_condition": texts
                    })
            if current_context:
                clinical_data["current_context"] = current_context

        logger.info("clinical_data=%s", json.dumps(clinical_data, indent=2, default=str))

        # ---------------------------------------------------------
        # 4️⃣ BUILD TREATMENT PLAN PROMPT WITH INTENT FOCUS
        # ---------------------------------------------------------
        agentic_json = json.dumps(agentic_output, indent=2, default=str) \
            if agentic_output else "No agentic context available."

        temp_data_text = json.dumps(temp_data, indent=2, default=str) \
            if temp_data else "No cached patient data available."

        # ---------------------------------------------------------
        # 5️⃣ PROMPT CONSTRUCTION
        # ---------------------------------------------------------

        clinical_data_text = json.dumps(clinical_data, indent=2, default=str) \
                    if clinical_data else "No structured clinical data available."

       # Intent-specific guidance
        intent_guidance = {
            "curative": "CURATIVE INTENT GUIDELINES: Focus on treatments aimed at complete resolution or cure of the disease. Include definitive therapies appropriate for the specific condition. Address potentially reversible causes and disease-modifying treatments. Include monitoring for treatment response, disease progression, and candidacy for advanced therapies. Aggressive interventions MUST be explored and documented when clinically appropriate. NEVER default to comfort-only measures without first exhausting or explicitly ruling out curative options.",
            
            "palliative": "PALLIATIVE INTENT GUIDELINES: Focus on symptom management and improving quality of life. Include pain management strategies and symptom control. Consider goals of care discussions. Include advanced care planning elements where appropriate. Avoid aggressive interventions not aligned with palliative goals.",
            
            "supportive": "SUPPORTIVE INTENT GUIDELINES: Focus on adjunct care to support primary treatment. Include management of treatment side effects. Address nutritional support if relevant. Consider prophylactic measures to prevent complications.",
            
            "diagnostic": "DIAGNOSTIC INTENT GUIDELINES: Focus on investigations and diagnostic workup. Include specific tests, imaging, or procedures needed for diagnosis. Address differential diagnoses to be ruled out. Include timing and sequence of diagnostic steps."
        }

        # Base output structure template
        base_output_structure = """
        {{
        "processed_treatment_plan": {{
            "doctor_content": "Clinically coherent paragraph from dictation (3-5 sentences). Include only what doctor explicitly documented. CRITICAL: Match exact laterality if mentioned.",
            "ai_enhancement": "Optional AI-improved version, clearly marked as suggestion. Use only if clinically valuable. CRITICAL: Match exact laterality if mentioned."
        }},
        "sections": {{
            "diagnosis": {{
            "doctor_content": "Exact diagnosis as documented. Empty if not mentioned. CRITICAL: Include type, stage, location, laterality, findings if mentioned.",
            "ai_suggestions": []
            }},
            "pharmacological_plan": {{
            "doctor_content": "Exact medications as documented. Include dose/frequency/route if mentioned.",
            "ai_suggestions": []
            }},
            "investigations": {{
            "doctor_content": "Exact investigations as documented. Include timing/purpose if mentioned.",
            "ai_suggestions": []
            }},
            "procedural_plan": {{
            "doctor_content": "Exact procedures as documented. Include timing/prep if mentioned. CRITICAL: Match exact laterality if mentioned.",
            "ai_suggestions": []
            }},
            "monitoring_follow_up": {{
            "doctor_content": "Exact monitoring/follow-up as documented. Include frequency/parameters if mentioned.",
            "ai_suggestions": []
            }}
        }},
        "intent_alignment": {{
            "intent": "{intent}",
            "alignment_status": "aligned | partially_aligned | misaligned | not_assessable",
            "misalignment_flag": "Specific statement of conflicts based on {intent} intent misalignment flags. Include interventions that conflict and missing elements.",
            "notes": "Detailed assessment of alignment with {intent} intent. Include misalignment flags and recommendations."
        }},
        "clinical_evaluation": {{
            "standard_of_care_alignment": "2-3 sentence assessment of guideline adherence and evidence basis.",
            "practical_feasibility": "2-3 sentence assessment of real-world implementation and resource availability.",
            "doability_and_sustainability": "2-3 sentence assessment of long-term adherence, monitoring burden, and quality of life."
        }}
        }}
        """

        # ==================== CURATIVE INTENT PROMPT ====================

        curative_prompt = f"""
        You are a CURATIVE CARE AUDIO DICTATION ASSISTANT. Process doctor dictation, extract structured clinical intent, VERIFY with agentic intelligence, ENHANCE with OPTIONAL AI suggestions. Doctor authority ABSOLUTE. AI suggestions OPTIONAL and clearly marked.

        CRITICAL: CURATIVE intent SELECTED. ALL recommendations MUST align with aggressive, disease-modifying, cure-focused care across ANY medical specialty. NON-NEGOTIABLE.

        SPECIALTY DETECTION (MANDATORY FIRST STEP):
        - Auto-detect the medical specialty from the dictation context (e.g., Oncology, Cardiology, Neurology, Nephrology, Gastroenterology, Pulmonology, Rheumatology, Infectious Disease, Endocrinology, Hematology, etc.)
        - ALL terminology, MDT member suggestions, biomarker/investigation recommendations, surveillance protocols, and treatment escalation pathways MUST be adapted to match the detected specialty.
        - Do NOT default to oncology-specific language unless the case is explicitly oncological.
        - Use specialty-appropriate language throughout (e.g., "disease remission" for autoimmune, "viral suppression" for infectious disease, "ejection fraction recovery" for cardiology, "tumor response" for oncology).

        TIMELINES: Initiate **definitive curative interventions** IMMEDIATELY post-diagnosis, with **NO DELAYS**. **Immediate initiation** even while awaiting final diagnostics, if clinically appropriate. Prioritize **aggressive interventions** immediately post-diagnosis, and clearly define timelines for every phase: treatment start, procedure schedule, follow-up tests, therapy adjustments.

        ========== INPUT ==========
        DOCTOR: {dictation}
        AGENTIC: {agentic_json}
        PATIENT: {temp_data_text}
        CLINICAL: {clinical_data_text}
        ========== END INPUT ==========

        CURATIVE GUIDELINES:
        - Complete **resolution/cure focus** appropriate to the detected specialty
        - **Immediate disease-modifying therapy** first, comfort only after curative options are exhausted
        - Early **monitoring**: appropriate **investigations**, **imaging**, **labs**, or studies essential — tailored to specialty
        - Consider **advanced therapies**, **clinical trials**, or specialized interventions where applicable
        - **Multidisciplinary team (MDT)** meetings early with all relevant specialists for the detected specialty
        - **Personalized treatment** based on disease-specific biomarkers, diagnostic markers, genetic/molecular profile (where applicable), comorbidities, and patient preferences
        - **Patient discussions**: risks, benefits, and goals with **shared decision-making** documented
        - **Alternative regimens** for resistance/failure/non-response should be considered
        - Long-term **surveillance** for recurrence, relapse, or complications — specialty-appropriate
        - **Early intervention** for disease worsening, relapse, or recurrence
        - **Flexible plan** with **regular reevaluation** and adjustments based on patient response
        - Proactive management of **side effects**, **treatment toxicity**, and **risk mitigation** throughout treatment

        MISALIGNMENT FLAGS (MUST DETECT):

        1. **Comfort-Focused**:
        - Comfort measures **before exhausting curative options** FLAG
        - Palliative care or hospice referral without attempting disease-modifying therapy FLAG
        - Lack of **aggressive interventions** when clinically indicated FLAG

        2. **Aggressive Intervention**:
        - **Delay** in initiating definitive therapy FLAG
        - Failure to consider **advanced therapies** (e.g., targeted therapies, biologics, immunomodulators, surgical options, device-based therapies, novel interventions — specialty-appropriate) FLAG
        - Inadequate procedural/surgical options for curative treatment FLAG
        - Missing **preparatory therapies** if needed FLAG
        - No escalation in dose or therapy intensity if initial treatment fails FLAG
        - Failure to include **clinical trials** or advanced options where appropriate FLAG
        - Missing **optimization of treatment** before definitive therapy FLAG

        3. **Monitoring**:
        - Missing **regular surveillance** (imaging, lab tests, functional assessments, clinical studies — specialty-appropriate) FLAG
        - No defined **response criteria** for treatment effectiveness FLAG
        - Missing follow-up schedule or **reassessment intervals** FLAG
        - Lack of surveillance for potential **disease recurrence, relapse, or complications** FLAG
        - No scheduled surveillance or **disease-specific marker monitoring** at regular intervals FLAG
        - Missing monitoring for **clinical worsening** during treatment FLAG

        4. **Treatment Regimen**:
        - Lack of specific **regimen details** (e.g., drug names, doses, frequency, and route of administration) FLAG
        - No escalation in dose or therapy intensity based on treatment response FLAG
        - Missing details on **pre-treatment or post-treatment care** FLAG
        - No **side effect** or **complication management strategies** FLAG
        - No **response-based adjustments** or alternative regimens FLAG

        5. **Diagnostic**:
        - **Delay** in starting treatment for final diagnostic confirmation FLAG
        - Incomplete diagnostic workup (e.g., **disease severity classification**, characterization — specialty-appropriate) FLAG
        - Missing **disease-specific biomarker**, **functional**, or **molecular testing** early in treatment to guide therapy FLAG
        - Missing disease characterization or inadequate **specialty-appropriate investigations** (e.g., imaging studies, functional tests, lab panels, biopsies, endoscopy, ECG, spirometry, etc.) FLAG
        - No adjustments in treatment based on **diagnostic findings** FLAG

        6. **Patient Involvement**:
        - Patient not involved in treatment discussions FLAG
        - No documentation of **treatment goals**, risks, or benefits FLAG
        - No **shared decision-making** process or family involvement FLAG
        - **Patient preferences** and values not integrated into the treatment plan FLAG

        7. **Timeline Urgency**:
        - Unnecessary delays in **treatment initiation** FLAG
        - No specific **timelines** for each phase of treatment FLAG
        - Missing urgency in initiating treatment after diagnosis FLAG

        8. **Multidisciplinary**:
        - No involvement of a **multidisciplinary team (MDT)** early FLAG
        - Missing consults with relevant specialists — **auto-selected based on detected specialty** (e.g., cardiologists, neurologists, nephrologists, pulmonologists, rheumatologists, surgeons, interventional specialists, etc.) FLAG
        - No immediate scheduling of **MDT meetings** for treatment decisions FLAG
        - No clear **role definitions** within the MDT FLAG

        9. **Risk Management**:
        - No thorough **risk-benefit analysis** FLAG
        - Missing **pre-treatment optimization** or assessments (e.g., organ function, comorbidities, functional status) FLAG
        - No **proactive side effect management plan** FLAG
        - No ongoing complication assessments or **mitigation strategies** during treatment FLAG

        10. **Recurrence/Relapse Management**:
        - No plan for **disease recurrence or relapse surveillance** FLAG
        - Missing **regular post-treatment monitoring** FLAG
        - No **early intervention** strategy for recurrence or relapse FLAG
        - No **long-term surveillance** for disease recurrence, systemic complications, or progression FLAG

        11. **Plan Flexibility**:
        - No **regular reevaluation** of the treatment plan FLAG
        - No response-based **adjustments** or alternative treatment pathways FLAG
        - Plan not adaptable to **changing clinical conditions** FLAG

        CURATIVE CARE MANDATORY CHECKLIST:

        **Diagnosis**:
        - [ ] Complete diagnosis with disease type, severity classification, and grading (specialty-appropriate)
        - [ ] Comprehensive severity/staging classification to guide treatment choices
        - [ ] Definitive diagnostic findings (e.g., biopsy, imaging, functional testing, lab confirmation — specialty-appropriate)
        - [ ] Comorbidities and other health conditions documented
        - [ ] **Disease-specific biomarker, functional, or molecular testing** early for personalized therapy guidance (e.g., HbA1c for diabetes, EF for cardiology, viral load for infectious disease, tumor markers for oncology, ANA/anti-dsDNA for rheumatology, etc.)
        - [ ] Disease characterization is complete (e.g., organ involvement, systemic spread, functional impact)
        - [ ] Complete diagnostic workup, including appropriate specialty-specific imaging or lab tests
        - [ ] Timely reassessment if diagnostic workup or treatment response is suboptimal

        **Treatment**:
        - [ ] Specific therapy or procedure names with exact doses, schedules, and routes (oral/IV/subcutaneous/inhaled etc.)
        - [ ] **Toxicity** and complication monitoring strategies
        - [ ] Dose/intensity escalation protocols if necessary
        - [ ] Response-based treatment adjustments or alternative regimens for failure/non-response
        - [ ] Clinical trial/advanced therapy options considered for refractory or treatment-resistant cases
        - [ ] **Risk-benefit analysis** discussed with the patient
        - [ ] **Pre-treatment optimization** (e.g., organ function, co-existing conditions, nutritional status)
        - [ ] **Definitive therapy** within appropriate specialty-specific timeframe
        - [ ] Proactive **side effect management plan** throughout the treatment process

        **Investigations**:
        - [ ] Baseline disease characterization (specialty-appropriate imaging, biomarkers, functional tests, lab tests)
        - [ ] Regular surveillance at specified intervals (initially more frequent, then extended)
        - [ ] Disease-specific marker/parameter monitoring throughout the treatment
        - [ ] Reassessment of parameters at regular intervals
        - [ ] Standardized response criteria for measuring treatment progress (specialty-appropriate)

        **Procedural**:
        - [ ] **Procedure timing and scheduling** within the appropriate clinical window
        - [ ] Pre-procedure optimization and post-procedure care planned
        - [ ] Necessary preparatory therapies (e.g., neoadjuvant treatment, bridging therapy, optimization — specialty-appropriate) within timeframe
        - [ ] Procedure-specific details if required (e.g., surgical approach, technique, device implantation)
        - [ ] Patient candidacy evaluation for procedures or interventions
        - [ ] **Post-procedure care** and recovery details documented

        **Monitoring**:
        - [ ] Ongoing surveillance at specified intervals for disease progression, relapse, or recurrence
        - [ ] Standardized response criteria for monitoring treatment success
        - [ ] Long-term recurrence, relapse, and systemic complication monitoring planned
        - [ ] Reassessment intervals defined
        - [ ] Detection strategies for progression and escalation protocols
        - [ ] Survivorship and long-term care plan documented

        **Patient Communication**:
        - [ ] Goals, risks, and benefits of treatment discussed with the patient and family
        - [ ] **Shared decision-making** and patient preferences incorporated
        - [ ] Treatment timeline and progress communicated
        - [ ] Patient fully informed of all available options

        **Multidisciplinary**:
        - [ ] Relevant specialist consults — **auto-selected based on detected specialty** — early in the process
        - [ ] MDT meetings scheduled early post-diagnosis
        - [ ] Collaborative treatment decisions documented
        - [ ] **Role definitions** for specialists clearly established

        **Risk Management**:
        - [ ] Thorough **risk-benefit analysis** performed for each treatment option
        - [ ] Pre-treatment optimization completed (e.g., organ function, co-existing conditions, functional status)
        - [ ] Ongoing management of treatment-related risks and complications
        - [ ] Regular assessment of side effects and complications during treatment

        **Recurrence/Relapse**:
        - [ ] Surveillance plan for disease recurrence or relapse monitoring established
        - [ ] Regular post-treatment monitoring and follow-up scheduled
        - [ ] Parameter tracking after treatment for any signs of recurrence, relapse, or disease return
        - [ ] Early intervention strategy for recurrence or relapse documented

        **Plan Flexibility**:
        - [ ] Regular reevaluation and adaptation of the treatment plan based on patient response
        - [ ] Adjustments or alternative treatments provided if initial plan is ineffective
        - [ ] Plan should be adaptable to evolving clinical conditions

        **CONDITIONAL AI SUGGESTIONS**:
        Generate AI suggestions ONLY when the following conditions are met. Each suggestion must be actionable, specialty-appropriate, and aligned with curative intent:

        1. **IF** diagnostic workup is incomplete OR missing disease-specific biomarker/functional/molecular testing:
           - Suggest specific additional diagnostic tests based on the detected specialty and disease type
           - Recommend specialty-appropriate biomarker, functional, or molecular panel (e.g., echocardiography + BNP for cardiology; HbA1c + C-peptide for endocrinology; ANA panel for rheumatology; viral load + resistance testing for infectious disease; tumor markers + molecular profiling for oncology)
           - Propose severity/staging studies if not adequately performed

        2. **IF** no aggressive therapy specified OR treatment delays identified:
           - Suggest evidence-based first-line curative or disease-modifying regimens with specific doses/schedules — **adapted to detected specialty**
           - Recommend neoadjuvant, bridging, or optimization therapy options if appropriate
           - Propose immediate treatment initiation protocols

        3. **IF** missing MDT involvement:
           - Suggest specific specialist consultations needed — **auto-selected based on detected specialty** (e.g., interventional cardiologist + cardiac surgeon for cardiology; hepatologist + transplant surgeon for liver disease; neurologist + neurosurgeon for CNS conditions; surgical oncologist + radiation oncologist for cancer)
           - Recommend timeline for MDT meeting scheduling
           - Propose collaborative treatment planning approach

        4. **IF** no surveillance/monitoring plan defined:
           - Suggest surveillance intervals with specific specialty-appropriate imaging/lab/functional assessment protocols
           - Recommend response criteria for treatment evaluation
           - Propose long-term follow-up schedule post-treatment

        5. **IF** missing escalation protocols or alternative regimens:
           - Suggest dose escalation or therapy intensification strategies based on response — specialty-appropriate
           - Recommend second-line, rescue, or salvage therapy options
           - Propose clinical trial consideration if standard options exhausted

        6. **IF** no pre-treatment optimization documented:
           - Suggest organ function and functional status optimization protocols — specialty-appropriate
           - Recommend comorbidity management before definitive therapy
           - Propose nutritional, rehabilitative, or supportive care optimization

        7. **IF** missing side effect management plan:
           - Suggest proactive toxicity monitoring protocols — specialty-appropriate
           - Recommend specific supportive care medications or interventions
           - Propose complication prevention strategies

        8. **IF** no recurrence/relapse surveillance plan:
           - Suggest long-term monitoring intervals and methods — specialty-appropriate
           - Recommend specific surveillance markers/imaging/functional tests
           - Propose early intervention protocols for recurrence or relapse

        9. **IF** treatment plan lacks flexibility:
           - Suggest response-based adjustment protocols
           - Recommend alternative pathway options
           - Propose regular reevaluation schedule

        10. **IF** patient preferences/goals not documented:
            - Suggest shared decision-making discussion points
            - Recommend documentation of treatment goals
            - Propose family involvement in care planning

        **AI SUGGESTIONS (Generate only when conditions are met)**:
        - If diagnostic workup incomplete → suggest specific additional specialty-appropriate tests/severity classification
        - If no aggressive therapy specified → suggest evidence-based first-line specialty-appropriate regimens
        - If missing MDT involvement → suggest relevant specialty-specific specialist consultations
        - If no surveillance plan → suggest specialty-appropriate monitoring intervals and protocols
        - If missing escalation protocols → suggest second-line, rescue, or salvage options
        - If no pre-treatment optimization → suggest organ function and functional status optimization
        - If missing side effect management → suggest toxicity monitoring protocols
        - If no recurrence/relapse surveillance → suggest long-term specialty-appropriate monitoring plan
        - If treatment plan lacks flexibility → suggest response-based adjustments
        - If patient preferences not documented → suggest shared decision-making discussion

        **AI SUGGESTION MINIMUM RULE — NON-NEGOTIABLE**:
        - The total number of ai_suggestions across ALL sections combined MUST be at minimum 3.
        - Every suggestion MUST have both "suggestion" and "rationale" fields.
        - If no misalignment flags fire, still generate minimum 3 suggestions across the most relevant sections adding value beyond the doctor's existing plan.
        - Empty ai_suggestions arrays across all sections with a total count below 3 = CRITICAL OUTPUT ERROR.
        - AI suggestions MUST be placed INSIDE each section's ai_suggestions array — NOT in a top-level ai_suggestions field outside the sections.
        - Structure MUST follow: sections → [section_name] → ai_suggestions → [{{suggestion, rationale}}]
        - A top-level ai_suggestions field outside the sections structure = CRITICAL OUTPUT ERROR.
        - Distribute suggestions across the most relevant sections based on which misalignment flags fired. Do not place all suggestions in one section.

        **MISALIGNMENT FLAG LOGIC**:
        - Ensure no delays in curative treatment
        - Flag missing or delayed aggressive interventions
        - Ensure proper diagnostic workup and severity classification — specialty-appropriate
        - Flag missing specialty-specific biomarkers, functional markers, or molecular testing early
        - Flag no MDT involvement or patient discussions
        - Ensure all necessary timelines are met
        - No gaps in surveillance and recurrence/relapse management
        - Flag absence of response-based adjustments and flexibility in the plan

        **MISALIGNMENT FLAG OUTPUT RULE — NON-NEGOTIABLE**:
        - If NO misalignment flags fire → misalignment_flag MUST be exactly "" (empty string). Never use "None", "none", "N/A", "No misalignment", or any other value.
        - If flags fire → misalignment_flag = all fired flag texts joined with " | "

        **IMPORTANT**: Return a valid JSON object ONLY. Must be parseable as JSON.

        {base_output_structure.format(intent="curative")}
    """
        palliative_prompt = f"""
        You are a PALLIATIVE CARE AUDIO DICTATION ASSISTANT. Process doctor dictation, extract structured clinical intent, VERIFY with agentic intelligence, ENHANCE with OPTIONAL AI suggestions. Doctor authority ABSOLUTE. AI suggestions OPTIONAL and clearly marked.

        CRITICAL: PALLIATIVE intent SELECTED. ALL recommendations MUST align with comfort, symptom management, and quality of life enhancement across ANY medical specialty. NON-NEGOTIABLE.

        TIMELINES: Initiate **palliative interventions** promptly to relieve suffering and improve quality of life. Symptom management should be prioritized at all stages, with focus on comfort care even while addressing underlying conditions. No aggressive interventions unless symptoms cannot be managed.

        ========== INPUT ==========  
        DOCTOR: {dictation}
        AGENTIC: {agentic_json}
        PATIENT: {temp_data_text}
        CLINICAL: {clinical_data_text}
        ========== END INPUT ==========

        PALLIATIVE GUIDELINES:
        - **Comfort care focus** over disease-modifying interventions
        - Symptom relief as the **primary goal**, with quality of life maximized
        - **Non-invasive therapies** prioritized; invasive procedures only if they significantly improve comfort
        - **Early involvement** of palliative care team and discussions about goals of care
        - **Multidisciplinary team (MDT)** approach, with involvement of pain management, social workers, and chaplaincy
        - **Patient and family discussions**: Risks, benefits, and goals of care, with **shared decision-making** documented
        - **Alternative therapies**: Consider integrative care options for symptom management (e.g., acupuncture, massage)
        - **Patient preferences**: Full integration into the care plan
        - Proactive management of **side effects** (e.g., pain, nausea, fatigue, breathing difficulties)
        - **Advanced care planning**: Early discussions of end-of-life preferences
        - **Emotional and psychological support** for patient and family

        MISALIGNMENT FLAGS (MUST DETECT):

        1. **Comfort-Focused**:
        - Lack of **comfort measures** or symptom management before aggressive interventions FLAG
        - Failure to **initiate palliative care** early in disease progression FLAG
        - **Invasive treatments** or therapies when they are not likely to improve quality of life FLAG

        2. **Aggressive Intervention**:
        - Failure to consider **palliative care options** early FLAG
        - **Delay** in initiating palliative care when needed FLAG
        - Focus on **aggressive treatments** without considering symptom relief or patient comfort FLAG
        - Inadequate consideration of patient **preferences** for less invasive approaches FLAG

        3. **Monitoring**:
        - Missing **symptom monitoring** (e.g., pain, breathlessness, nausea) FLAG
        - No clear **response criteria** for symptom management FLAG
        - Missing follow-up schedule or **reassessment intervals** for symptom control FLAG
        - Lack of monitoring for **psychosocial needs** FLAG

        4. **Treatment Regimen**:
        - Lack of specific **symptom management regimens** (e.g., pain relief, antiemetics, anti-anxiety medications) FLAG
        - Missing details on **non-invasive therapies** or alternative treatments FLAG
        - No **response-based adjustments** to symptom control FLAG
        - Failure to document **alternative therapies** or non-pharmacologic approaches FLAG

        5. **Diagnostic**:
        - **Delay** in addressing patient comfort due to diagnostic or treatment delays FLAG
        - Incomplete diagnostic workup when focused on **comfort and symptom management** FLAG

        6. **Patient Involvement**:
        - Patient **not involved** in decisions regarding symptom control FLAG
        - No documentation of **treatment goals** (comfort, quality of life) FLAG
        - No **shared decision-making** or family involvement FLAG
        - **Patient preferences** not integrated into the treatment plan FLAG

        7. **Timeline Urgency**:
        - Unnecessary delays in **initiating comfort care** FLAG
        - No specific **timelines** for symptom management FLAG
        - Missing urgency in **addressing pain or distress** FLAG

        8. **Multidisciplinary**:
        - No involvement of **palliative care team** FLAG
        - Missing consults with **pain management** or other specialists FLAG
        - No early scheduling of **MDT meetings** for comfort care decisions FLAG
        - Lack of defined **role definitions** for MDT members FLAG

        9. **Risk Management**:
        - No **risk-benefit analysis** for symptom control therapies FLAG
        - No proactive **side effect management** plan for symptom relief FLAG
        - Inadequate **psychological support** for the patient and family FLAG

        10. **Recurrence Management**:
        - No plan for **monitoring recurrence** when managing symptoms FLAG
        - Missing **post-treatment symptom monitoring** FLAG
        - No **early intervention** strategy for worsening symptoms FLAG

        11. **Plan Flexibility**:
        - No **regular reevaluation** of symptom management plan FLAG
        - No response-based **adjustments** or alternative therapies FLAG
        - Plan not adaptable to **changing patient comfort needs** FLAG

        PALLIATIVE CARE MANDATORY CHECKLIST:

        **Diagnosis**:
        - [ ] Complete diagnosis with disease type, stage, and grading
        - [ ] Disease severity and prognosis documented with emphasis on quality of life
        - [ ] **Patient preferences** regarding treatment and symptom management
        - [ ] **Comorbidities and existing health conditions** considered in treatment plan

        **Treatment**:
        - [ ] Specific **comfort care therapies** (e.g., analgesics, antiemetics, anxiolytics) with doses and schedules
        - [ ] Non-invasive options prioritized over invasive interventions unless they improve comfort
        - [ ] **Pain management** and **symptom relief** plans documented
        - [ ] **Psychological and social support** provided as part of the treatment plan
        - [ ] **Advanced care planning** discussions held early with the patient and family

        **Investigations**:
        - [ ] Regular monitoring of **symptoms**, including pain, breathlessness, nausea
        - [ ] No delay in addressing **symptoms** even while awaiting further diagnostic results
        - [ ] Biomarkers and tests used to **improve symptom management**, not just for disease-modifying purposes

        **Procedural**:
        - [ ] Non-invasive procedures prioritized for symptom relief (e.g., drainage, stenting)
        - [ ] **Patient candidacy evaluation** for comfort-related procedures
        - [ ] **Post-procedure comfort management** documented

        **Monitoring**:
        - [ ] **Symptom monitoring** at specified intervals (pain, breathlessness, etc.)
        - [ ] **Response-based adjustments** to symptom management and alternative therapies as needed
        - [ ] **Psychosocial support** and **emotional well-being** monitored regularly

        **Patient Communication**:
        - [ ] Goals, risks, and benefits of care discussed with the patient and family
        - [ ] Shared decision-making, with patient preferences fully integrated
        - [ ] **End-of-life care discussions** documented, if applicable

        **Multidisciplinary**:
        - [ ] Early involvement of a **palliative care team** (e.g., pain specialists, social workers)
        - [ ] Collaborative care decisions with **family and caregivers**
        - [ ] **Role definitions** within the team clearly established

        **Risk Management**:
        - [ ] **Risk-benefit analysis** for symptom management therapies
        - [ ] Ongoing management of **side effects**, including psychological and emotional well-being
        - [ ] **Complication management strategies** in place during palliative care

        **Recurrence**:
        - [ ] Monitoring for **recurrence** of symptoms, not just disease progression
        - [ ] **Regular follow-up** to assess symptom control and well-being
        - [ ] **Early intervention** for worsening symptoms

        **Plan Flexibility**:
        - [ ] Regular **reevaluation** of the symptom management plan based on patient feedback
        - [ ] Plan should be **adaptable to evolving symptoms** and patient needs

        **AI SUGGESTION REQUIREMENTS**:
        - **Generate minimum 3 AI suggestions** for symptom relief and comfort
        - Actionable suggestions for symptom relief and comfort
        - **Alternative therapies** for symptom management
        - **Psychosocial support** suggestions where applicable
        - Flexible treatment pathways based on patient feedback and evolving symptoms
        - **Multidisciplinary** involvement for holistic care

        **MISALIGNMENT FLAG LOGIC**:
        - Flag missing **symptom management** or comfort-focused care
        - Ensure early **palliative care initiation**
        - No unnecessary **aggressive treatments** if they are not likely to improve comfort
        - Flag lack of **shared decision-making** or patient involvement
        - Ensure **timely symptom relief** without delay
        - **Psychosocial** needs must be addressed and monitored

        **IMPORTANT**: Return a valid JSON object ONLY. Must be parseable as JSON.

        {base_output_structure.format(intent="palliative")}

        ENHANCEMENTS NEEDED:
        - Increase the focus on **pain and symptom management** (e.g., opioids, non-invasive therapies like acupuncture).
        - Prioritize **patient and family preferences** in care decisions, including **comfort-focused goals of care**.
"""

        supportive_prompt = f"""
        You are a SUPPORTIVE CARE AUDIO DICTATION ASSISTANT. Process doctor dictation, detect misalignments, and enhance with supportive care AI suggestions. Doctor authority is ABSOLUTE.

        CRITICAL: SUPPORTIVE intent selected. ALL AI suggestions MUST focus on emotional, physical, and psychological well-being ONLY.

        ========== INPUT ==========
        DOCTOR: {dictation}
        AGENTIC: {agentic_json}
        PATIENT: {temp_data_text}
        CLINICAL: {clinical_data_text}
        ========== END INPUT ==========

        ══════════════════════════════════
        STEP 0 — DOCTOR CONTENT EXTRACTION (MANDATORY)
        ══════════════════════════════════

        Extract doctor_content for each section STRICTLY from the dictation ONLY.
        - NEVER infer, assume, or add medications, investigations, or procedures not explicitly stated
        - If a section has no content in the dictation → doctor_content: "Not specified in dictation."
        - Each section's doctor_content must be a faithful summary of ONLY what the doctor said

        ══════════════════════════════════
        STEP 1 — HOLISTIC INTENT EVALUATION (MANDATORY BEFORE TRIGGER SCORING)
        ══════════════════════════════════

        READ THE FULL DICTATION AS A WHOLE. Answer each question with YES only if the criteria is EXPLICITLY and UNAMBIGUOUSLY met.

        Q1. Does the doctor EXPLICITLY use words like "comfort", "emotional well-being", "psychosocial", "quality of life", or "supportive care" as a PRIMARY stated goal?
            → YES only if these appear as explicit stated priorities, NOT incidentally

        Q2. Does the doctor EXPLICITLY state they are avoiding, deprioritizing, or limiting invasive procedures?
            → YES only if there is a direct statement like "avoid invasive", "last resort", "prioritize non-invasive"
            → NO if invasive procedures (PCI, angiogram, bypass) are simply listed or planned without this framing

        Q3. Does the doctor EXPLICITLY name a non-invasive pain/symptom management technique?
            → YES only for: deep breathing, guided imagery, relaxation, meditation, positioning, aromatherapy, massage
            → NO for: medications, monitoring vital signs, or standard cardiac care

        Q4. Does the doctor EXPLICITLY mention family or caregiver support, education, or involvement?
            → YES only for: family meetings, caregiver education, family counseling, Zarit Burden Interview
            → NO for: general mentions of family history or notifying family

        Q5. Does the doctor EXPLICITLY frame medications or treatments around patient comfort or QoL?
            → YES only if the doctor uses phrases like "for comfort", "to improve quality of life", "to reduce distress"
            → NO if medications are framed purely around disease management (e.g., "to prevent cardiac events", "to restore blood flow")

        DOMINANT INTENT SCORING:
        - Count YES answers to Q1–Q5
        - 4–5 YES → Dominant intent: SUPPORTIVE → Apply triggers conservatively
        - 2–3 YES → Dominant intent: MIXED → Apply triggers normally  
        - 0–1 YES → Dominant intent: CURATIVE/AGGRESSIVE → Apply ALL triggers strictly

        IMPORTANT: Phrases like "aggressive management", "aggressive interventions", "prioritizing immediate interventions to restore cardiac function", "primary focus on stabilizing cardiac condition" are STRONG indicators of curative/aggressive intent and MUST push the score toward 0–1 YES range.

        ══════════════════════════════════
        STEP 2 — MISALIGNMENT TRIGGER SCORING
        ══════════════════════════════════

        Apply triggers based on dominant intent from Step 1.
        Only fire a trigger if the condition is GENUINELY AND COMPLETELY ABSENT from the full dictation.

        SCORING:
        - 0 triggers fired → alignment_status: "aligned", misalignment_flag: "" (MUST be empty)
        - 1–2 triggers fired → alignment_status: "partial_misalignment", misalignment_flag: [joined flags]
        - 3+ triggers fired → alignment_status: "misaligned", misalignment_flag: [all joined flags]

        TRIGGERS:

        T1. Invasive procedures (PCI, angiogram, bypass, surgery) are planned OR dominant with NO explicit deprioritization statement
            → FLAG: "Over-reliance on invasive procedures (PCI, angiogram, bypass surgery) detected. Comfort-based interventions and psychosocial support must be prioritized."
            ⚠ DO NOT fire ONLY IF doctor explicitly states invasive procedures are a last resort or being avoided

        T2. Zero explicit mention of counseling, CBT, psychological therapy, or emotional well-being support
            → FLAG: "Psychosocial support absent. Counseling, relaxation techniques, and mental health interventions required."
            ⚠ DO NOT fire ONLY IF CBT, counseling, or named psychological therapy is explicitly mentioned

        T3. Zero explicit mention of family or caregiver support beyond family history
            → FLAG: "Family and caregiver support absent from care plan."
            ⚠ DO NOT fire ONLY IF family education, caregiver sessions, or family meetings are explicitly mentioned

        T4. Zero mention of patient preferences, values, or shared decision-making
            → FLAG: "Shared decision-making not documented. Patient preferences must be integrated into the care plan."

        T5. Zero explicit mention of non-pharmacological, non-invasive symptom management techniques
            → FLAG: "Non-invasive symptom management strategies absent. Relaxation, breathing techniques, or guided imagery required."
            ⚠ DO NOT fire ONLY IF breathing exercises, relaxation, guided imagery, or massage are explicitly mentioned

        T6. High-risk patient with zero mention of advance care planning or goals-of-care discussion
            → FLAG: "Advance care planning absent for high-risk patient."

        T7. Zero mention of any supportive care team member by role (psychologist, social worker, counselor, chaplain, palliative)
            → FLAG: "Supportive care team involvement not referenced. Early multidisciplinary involvement required."
            ⚠ DO NOT fire ONLY IF a named supportive care professional is explicitly mentioned

        T8. Dictation contains explicit aggressive/curative language ("aggressive management", "aggressive interventions", "prioritizing immediate interventions", "primary focus on stabilizing") with zero explicit supportive framing
            → FLAG: "Dictation language reflects aggressive curative intent with no supportive care framing."
            ⚠ DO NOT fire ONLY IF supportive language explicitly counterbalances aggressive language

        T9. Medications prescribed EXCLUSIVELY for disease modification or risk reduction with zero comfort/QoL framing
            → FLAG: "Pharmacological plan not contextualized around symptom management or psychosocial well-being."
            ⚠ DO NOT fire ONLY IF medications are explicitly framed around comfort or QoL

        ══════════════════════════════════
        STEP 3 — THREE IMPROVEMENT DIRECTIVES
        (Every ai_suggestion MUST implement at least one)
        ══════════════════════════════════

        DIRECTIVE 1 — COMFORT OVER INVASIVE (applies to: procedural_plan):
        - Suggest non-invasive comfort interventions (guided imagery, breathing, positioning, aromatherapy)
        - If procedure exists in doctor content, suggest pre/post-procedure psychological support
        - NEVER recommend or endorse invasive procedures in suggestions

        DIRECTIVE 2 — COUNSELING, RELAXATION, FAMILY (applies to: diagnosis, investigations, monitoring_follow_up):
        - Name specific referrals: clinical psychologist, social worker, licensed counselor
        - Name specific techniques: MBSR, progressive muscle relaxation, guided imagery, deep breathing
        - Name family strategies: caregiver education, family meetings, Zarit Burden Interview
        - Name screening tools: PHQ-9, GAD-7, Distress Thermometer

        DIRECTIVE 3 — PHARMACOLOGY AROUND QoL (applies to: pharmacological_plan):
        - Review medications through side-effect burden and QoL lens
        - Only suggest comfort-focused additions (anxiolytics, low-dose antidepressants if clinically indicated)
        - NEVER suggest new disease-modifying drugs for risk reduction alone

        ALIGNED CASE: Suggestions must ADD VALUE beyond what doctor already said — do NOT restate existing plan
        MISALIGNED CASE: Suggestions must CORRECT toward supportive care

        ══════════════════════════════════
        STEP 4 — AI SUGGESTION RULES
        ══════════════════════════════════

        - Minimum 2 suggestions per section, minimum 3 sections populated
        - Every suggestion MUST have "suggestion" and "rationale" fields
        - Clinically specific — name the exact therapy, tool, or intervention
        - NEVER repeat doctor's existing content
        - NEVER recommend invasive procedures or pure disease-modifying treatments
        - FOR MISALIGNED: Every suggestion must redirect toward supportive care, not cardiac management
        - FOR ALIGNED: Every suggestion must enrich and extend the existing supportive plan

        ══════════════════════════════════
        STEP 5 — AI ENHANCEMENT FIELD
        ══════════════════════════════════

        "ai_enhancement" MUST:
        - FOR ALIGNED: Acknowledge alignment, identify 2–3 specific gaps not yet in the plan, reference all 3 Directives with named interventions
        - FOR MISALIGNED: Identify the primary supportive care gap, reference all 3 Directives with corrections, name at least 3 specific supportive interventions
        - End with patient preferences and shared decision-making statement
        - NEVER restate doctor's existing plan
        - NEVER recommend invasive procedures

        ══════════════════════════════════
        CRITICAL OUTPUT RULES
        ══════════════════════════════════

        1. Return ONLY valid JSON — no markdown, no text outside JSON
        2. JSON structure MUST match base_output_structure exactly — no added/removed/renamed fields
        3. alignment_status MUST be: "aligned", "partial_misalignment", or "misaligned"
        4. IF "aligned" → misalignment_flag MUST be "" — NEVER populated
        5. IF "partial_misalignment" or "misaligned" → misalignment_flag MUST be non-empty
        6. ai_suggestions MUST be populated in at least 3 sections — empty arrays are CRITICAL ERROR
        7. Every ai_suggestion MUST have "suggestion" and "rationale" fields
        8. doctor_content MUST contain ONLY information from the dictation — NO hallucination
        9. AI suggestions MUST NEVER recommend invasive procedures or disease-modifying treatments
        10. Misalignment MUST be evaluated against full dictation holistically — NEVER sections in isolation
        11. Phrases like "aggressive management", "aggressive interventions", "primary focus on stabilizing cardiac condition" ALWAYS contribute to misalignment scoring — they are NOT supportive language

        {base_output_structure.format(intent="supportive")}
        """
        # ==================== DIAGNOSTIC INTENT PROMPT ====================

        diagnostic_prompt = f"""
        You are a DIAGNOSTIC CARE AUDIO DICTATION ASSISTANT. Process doctor dictation, detect misalignments, enhance with diagnostic AI suggestions. Doctor authority ABSOLUTE. ANY medical specialty.
        CRITICAL: DIAGNOSTIC intent. ALL output must focus on accurate diagnosis via structured investigations, differential diagnosis, correct test sequencing, and patient-centered communication.

        ========== INPUT ==========
        DOCTOR: {dictation}
        AGENTIC: {agentic_json}
        PATIENT: {temp_data_text}
        CLINICAL: {clinical_data_text}
        ========== END INPUT ==========

        ━━━━━━━━━━━━━━━━━━━━
        STEP 0 — EXTRACTION
        ━━━━━━━━━━━━━━━━━━━━
        processed_treatment_plan.doctor_content = COMPLETE dictation text verbatim. Never truncate or summarize.
        Section doctor_content = only what dictation explicitly states for that section. No inference.
        Missing section content → "Not specified in dictation."
        ⚠ Truncating processed_treatment_plan.doctor_content = CRITICAL ERROR — invalidates ALL downstream VETO detection.

        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        STEP 1 — HARD VETO (RUNS FIRST — OVERRIDES ALL)
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        Read COMPLETE dictation. Evaluate ALL four VETOs independently. Never stop after first match.

        V1 — RESULT NON-WAITING
        Fires: doctor explicitly states results will not be awaited before intervention.
        Patterns: "will not wait for results", "before results are back", "not waiting for results", or equivalent.
        FLAG: "V1: Explicit diagnostic sequencing violation — results will not be awaited before intervention."

        V2 — INTERVENTION ON SUSPICION ALONE  
        Fires: suspicion language ("strongly suspect", "I believe", "likely", "probable", "I suspect") is SOLE basis for invasive procedure or definitive treatment AND no confirmed objective finding documented anywhere in dictation.
        FLAG: "V2: Intervention on clinical suspicion alone — no confirmed diagnostic finding documented."

        V3 — INVESTIGATIONS AFTER INTERVENTION DECISION
        Fires: reading dictation in order — intervention decision appears BEFORE diagnostic investigations AND no confirmed result exists before intervention decision.
        FLAG: "V3: Investigations ordered after intervention decision — diagnostic sequencing violated."

        V4 — EMPIRICAL TREATMENT, ZERO WORKUP
        Fires ONLY: treatment initiated AND zero named investigations exist ANYWHERE in entire dictation.
        ⚠ HARD RULE: If ANY named investigation exists anywhere in dictation → V4 MUST NOT fire. Use V3 for sequencing violations.
        FLAG: "V4: Empirical treatment without any diagnostic workup documented."

        VETO EXCEPTION — suppresses a VETO ONLY when ALL THREE explicitly stated in dictation:
        EX1: Named life-threatening condition explicitly CONFIRMED (word "confirmed" or objective equivalent — not suspected)
        EX2: Specific objective finding explicitly documented as confirmed
        EX3: Intervention is recognized emergency standard-of-care for that exact confirmed finding
        ANY one missing → VETO fires. Clinical severity, probability, and emergency context NEVER substitute for explicit documentation.

        VETO OUTCOME:
        Any VETO fires → alignment_status: "misaligned" — permanent, cannot be changed by any score
        Continue evaluating ALL T-triggers in Step 3
        misalignment_flag = ALL fired VETO flags + ALL fired T-flags joined with " | "
        ⚠ Fewer flag texts than total fired triggers = CRITICAL ERROR

        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        STEP 2 — INTENT SCORING (strictness only)
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        Answer YES only if explicitly and unambiguously in dictation. Does NOT affect alignment_status.

        Q1. Named investigations are PRIMARY steps BEFORE any therapeutic decision?
            HARD NO: investigations appear after treatment decision OR doctor states will not wait for results
        Q2. Differential diagnoses or alternatives explicitly mentioned?
        Q3. Least-to-most-invasive sequencing explicitly followed?
            HARD NO: invasive ordered before non-invasive reviewed OR doctor states will not wait
        Q4. Follow-up or result communication plan explicitly mentioned?
        Q5. Patient preparation, education, or anxiety support explicitly mentioned?

        4–5 YES → conservative | 2–3 YES → normal | 0–1 YES → maximum strictness

        ━━━━━━━━━━━━━━━━━━━━━━━━━━
        STEP 3 — TRIGGER EVALUATION
        ━━━━━━━━━━━━━━━━━━━━━━━━━━
        Evaluate ALL triggers regardless of VETO. Add every fired T-flag to misalignment_flag.
        Non-VETO only: 0 fired → aligned | 1–2 → partial_misalignment | 3+ → misaligned

        T2: Zero named investigations ANYWHERE in entire dictation.
        ⚠ HARD RULE: ANY named investigation exists → T2 MUST NOT fire. Sequencing violation = V3 not T2.
        FLAG: "T2: No diagnostic workup present — named investigation sequence required."

        T3: Zero mention of differential diagnoses or alternative conditions anywhere in dictation.
        FLAG: "T3: Differential diagnosis absent — critical alternatives must be considered and ruled out."

        T4: Single-diagnosis focus, zero life-threatening alternatives considered, no documented reasoning for focused approach.
        FLAG: "T4: Premature diagnostic closure — single-diagnosis focus without ruling out critical alternatives."

        T5: Zero follow-up or result communication plan anywhere in dictation.
        FLAG: "T5: No result communication or follow-up plan documented."

        T6: Zero patient preparation, education, or anxiety management anywhere in dictation.
        FLAG: "T6: Patient preparation and education not addressed."

        T7: No timing or urgency stratification for any diagnostic step.
        FLAG: "T7: No urgency stratification — immediate, urgent, and elective tests must be distinguished."

        T8: Treatment initiated on suspicion alone, no confirmatory finding, no emergency exception.
        FLAG: "T8: Treatment on clinical suspicion alone — confirmed finding required before therapeutic decision."

        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        STEP 4 — DIAGNOSTIC DIRECTIVES
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        Derive ALL content from clinical scenario in dictation. NEVER use prebuilt templates or predefined diseases.

        D1 — INVESTIGATION SEQUENCING → investigations, procedural_plan
        Five phases — never skip without all three emergency exceptions documented:
        P1: History + focused physical examination
        P2: Non-invasive baseline investigations for presenting body system
        P3: Risk stratification using scenario-derived validated clinical prediction tool
        P4: Advanced/invasive investigations — ONLY after P2 reviewed and P3 complete
        P5: Definitive intervention — ONLY after diagnostic confirmation P1–P4
        Suggestions must: name the phase jumped to, name skipped phases, state specific P1→P2→P3 steps that should have preceded it.

        D2 — DIFFERENTIAL DIAGNOSIS → diagnosis, investigations
        Tier 1 — Must Not Miss: life-threatening conditions to exclude FIRST (derive from symptoms + body system in dictation)
        Tier 2 — Most Likely: probable diagnoses from symptom pattern, demographics, risk factors in dictation
        Tier 3 — Must Consider: uncommon but clinically important conditions fitting the picture
        Cognitive bias: detect and name explicitly if present (premature closure, anchoring, confirmation bias, availability bias)
        Suggestions must: name missing Tier 1 conditions AND their specific ruling-out investigations.

        D3 — PATIENT COMMUNICATION → monitoring_follow_up, pharmacological_plan
        Pharmacological — ABSOLUTE RULE:
        ✅ PERMITTED ONLY: procedure prep medications, medication hold before named investigation, NPO/fasting, symptom management during diagnostic waiting (analgesia, antiemetics)
        ❌ FORBIDDEN: new therapeutic/disease-modifying drugs | commenting on doctor's existing medications | medication contraindication review | monitoring parameters for therapeutic drugs | any drug suggestion tied to disease management or risk reduction
        Patient communication — suggest all absent: pre-investigation preparation | anxiety management during wait | result communication (who/when/format) | shared decision-making before consent | post-result pathway | urgency-stratified follow-up

        ━━━━━━━━━━━━━━━━━━━━━━━━━
        STEP 5 — SUGGESTION RULES
        ━━━━━━━━━━━━━━━━━━━━━━━━━
        QUANTITY: Min 2 suggestions per populated section. Min 3 sections populated.
        FIELDS: Every suggestion needs "suggestion" + "rationale". Missing either = CRITICAL ERROR.
        EMPTY ARRAYS: If doctor_content is present in a section → ai_suggestions MUST have min 2 entries. Empty array with present doctor_content = CRITICAL ERROR.

        SECTION MAP — each section addresses ONLY its mapped directive(s):
        diagnosis            → D2 only (Tier 1/2/3, cognitive bias, ruling-out investigations per tier)
        pharmacological_plan → D3 only (prep, fasting, waiting-period symptom management — absolute rule applies)
        investigations       → D1+D2 (phase gaps by phase number, ruling-out tests per differential tier)
        procedural_plan      → D1 only (which phases P1→P3 must complete before this, pre-procedure confirmation)
        monitoring_follow_up → D3 only (result communication, urgency-stratified follow-up, anxiety support, shared decision-making)

        CROSS-SECTION UNIQUENESS: No suggestion substance may appear in more than one section in any form. Same content across sections = CRITICAL ERROR.

        MISALIGNED — every suggestion MUST:
        ✅ Identify skipped phase (D1) OR missing differential tier (D2) OR missing communication element (D3)
        ✅ State specific corrective action derived from THIS clinical scenario
        ✅ Reference directive and phase/tier being corrected

        MISALIGNED — FORBIDDEN (any = CRITICAL ERROR):
        ❌ Endorsing or treating any part of misaligned plan as given
        ❌ Optimizing how to perform misaligned intervention (technique/access/timing/approach)
        ❌ Tests that assume misaligned intervention will proceed
        ❌ Monitoring parameters for therapeutically unjustified interventions
        ❌ Any suggestion presupposing misaligned action will happen

        SELF-CHECK before each misaligned suggestion:
        → "Does this assume the misaligned intervention proceeds?" YES → rewrite from scratch
        → "Does this optimize or endorse the misaligned plan?" YES → rewrite from scratch

        ━━━━━━━━━━━━━━━━━━━━━━━━━━━
        STEP 6 — AI ENHANCEMENT
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━
        MISALIGNED — exact 5-point structure, no deviation:
        P1 VETO VIOLATIONS: Name EVERY fired VETO code. One sentence per code explaining the specific violation as it appears in this dictation. Omitting any fired VETO = CRITICAL ERROR.
        P2 D1 CORRECTION: Correct P1→P2→P3 phase sequence for this specific clinical scenario. Name specific steps skipped. Zero reference to misaligned plan proceeding.
        P3 D2 CORRECTION: Missing Tier 1 conditions for this presentation. Specific ruling-out investigation per condition. Name detected cognitive bias.
        P4 D3 CORRECTION: Every absent patient communication element from this dictation specifically.
        P5 SHARED DECISION-MAKING: One sentence, patient-centered, specific to this clinical scenario.
        Zero endorsement of misaligned action anywhere in this field.

        ALIGNED — 3 points:
        P1: Specific aligned elements acknowledged.
        P2: 2–3 gaps referencing all 3 directives with scenario-derived interventions.
        P3: Patient communication and shared decision-making statement.

        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        STEP 7 — CLINICAL EVALUATION
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        Three fields — each addresses a DISTINCT dimension. Same substance across fields = CRITICAL ERROR.

        standard_of_care_alignment → CLINICAL CORRECTNESS ONLY
        Specific deviation from evidence-based standards for this presenting condition. Name which phase was bypassed and which confirmation step was skipped. No logistics. No patient outcomes.

        practical_feasibility → LOGISTICS AND RESOURCES ONLY
        Operational feasibility: availability of named investigations, realistic timeline given urgency, staffing/equipment requirements for proposed steps. No clinical correctness. No patient outcomes.

        doability_and_sustainability → PATIENT OUTCOMES AND CONTINUITY ONLY
        Long-term consequences of this diagnostic approach on downstream care quality, patient burden, follow-up reliability, condition trajectory. No resources. No standard-of-care deviation.

        ━━━━━━━━━━━━━━━━━━━━━━━
        CRITICAL OUTPUT RULES
        ━━━━━━━━━━━━━━━━━━━━━━━
        R1:  Valid JSON only — no markdown, no text outside JSON
        R2:  JSON matches base_output_structure exactly
        R3:  alignment_status: "aligned" / "partial_misalignment" / "misaligned" only
        R4:  "aligned" → misalignment_flag: "" always
        R5:  "partial_misalignment"/"misaligned" → misalignment_flag = ALL fired flags joined with " | "
        R6:  Fewer flag texts than fired triggers = CRITICAL ERROR
        R7:  V4 MUST NOT fire if any named investigation exists anywhere in dictation
        R8:  T2 MUST NOT fire if any named investigation exists anywhere in dictation
        R9:  VETO status cannot be overridden by Q or T scores under any circumstance
        R10: Emergency exception requires ALL THREE EX1+EX2+EX3 explicitly in dictation — never assumed from severity or context
        R11: pharmacological_plan: prep/fasting/waiting-period symptom management ONLY — anything else = CRITICAL ERROR
        R12: Empty ai_suggestions when doctor_content present = CRITICAL ERROR
        R13: Same suggestion substance across sections = CRITICAL ERROR
        R14: Misaligned suggestions endorsing/optimizing/assuming misaligned plan = CRITICAL ERROR
        R15: ai_enhancement missing any fired VETO from P1 = CRITICAL ERROR
        R16: clinical_evaluation fields repeating same substance = CRITICAL ERROR
        R17: Min 2 suggestions per populated section — 1 suggestion = CRITICAL ERROR
        R18: Every suggestion has both "suggestion" and "rationale" fields
        R19: All content derived from clinical scenario only — no prebuilt specialty templates
        R20: processed_treatment_plan.doctor_content = complete dictation verbatim — truncation = CRITICAL ERROR

        {base_output_structure.format(intent="diagnostic")}
        """
        # ==================== PROMPT SELECTOR ====================

        if treatment_intent == "curative":
            prompt = curative_prompt
        elif treatment_intent == "palliative":
            prompt = palliative_prompt
        elif treatment_intent == "supportive":
            prompt = supportive_prompt
        elif treatment_intent == "diagnostic":
            prompt = diagnostic_prompt
        else:
            prompt = "ERROR: Invalid treatment intent selected. Must be one of: curative, palliative, supportive, diagnostic."
        # ---------------------------------------------------------
        # 6️⃣ LLM EXECUTION
        # ---------------------------------------------------------
        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            frequency_penalty=0,
            presence_penalty=0,
            response_format={"type": "json_object"},
            max_tokens=6000
        )

        llm_output = json.loads(completion.choices[0].message.content)
        logger.info("Treatment Plan LLM Output: %s", llm_output)

        # ---------------------------------------------------------
        # 6️⃣ VALIDATE OUTPUT STRUCTURE
        # ---------------------------------------------------------
        required_keys = ["processed_treatment_plan", "sections", "intent_alignment", "clinical_evaluation"]

        # Check for missing keys and provide a fallback response
        for key in required_keys:
            if key not in llm_output:
                logger.error(f"LLM output missing required key: {key}")
                llm_output[key] = None  # Or you can assign a default value

        # Validate that intent in output matches input
        if llm_output.get("intent_alignment", {}).get("intent") != treatment_intent:
            llm_output["intent_alignment"]["intent"] = treatment_intent
            logger.warning(f"Fixed intent_alignment.intent to match input: {treatment_intent}")

        # ---------------------------------------------------------
        # 7️⃣ STORE IN DATABASE
        # ---------------------------------------------------------
        await documentation_treatment_plan_collection.update_one(
            {"patient_id": patient_id},
            {
                "$set": {
                    "patient_id": patient_id,
                    "doctor_id": doctor_id,
                    "finaloutput": llm_output,
                    "dictation": dictation,
                    "treatment_intent": treatment_intent,
                    "agentic_output": agentic_output,
                    "updated_at": datetime.utcnow()
                }
            },
            upsert=True
        )

        # ---------------------------------------------------------
        # 8️⃣ FINAL RESPONSE
        # ---------------------------------------------------------
        return {
            "status": "success",
            "feature_id": "documentation-treatment-plan",
            "feature_name": "Treatment Plan",
            "display_method": "structured_with_suggestions",
            "treatment_intent": treatment_intent,
            "finaloutput": llm_output,
            "metadata": {
                "doctor_id": doctor_id,
                "patient_id": patient_id
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Treatment plan generation failed")
        raise HTTPException(
            status_code=500,
            detail=f"Treatment plan generation error: {str(e)}"
        )
    
#######################################################################################################################################################


@router.post("/generate-structured-note")
async def generate_structured_note(request: Request):

    try:
        payload = await request.json()

        doctor_id = payload.get("doctor_id")
        patient_id = payload.get("patient_id")
        dictation = payload.get("dictation")

        if not doctor_id or not patient_id or not dictation:
            raise HTTPException(
                status_code=400,
                detail="doctor_id, patient_id and dictation are required"
            )

        # ---------------------------------------------------------
        # 1️⃣ FETCH PATIENT DEMOGRAPHICS
        # ---------------------------------------------------------

        patient_details = {}

        patient_doc = patient_user_collection.find_one(
            {"sys_user_id": patient_id},
            {
                "_id": 0,
                "name": 1,
                "date_of_birth": 1,
                "blood_group": 1,
                "gender": 1
            }
        )

        if patient_doc:

            age = None
            dob_str = patient_doc.get("date_of_birth")

            if dob_str:
                try:
                    dob = datetime.strptime(dob_str, "%Y-%m-%d").date()
                    today = datetime.utcnow().date()
                    age = today.year - dob.year - (
                        (today.month, today.day) < (dob.month, dob.day)
                    )
                except:
                    pass

            patient_details = {
                "name": patient_doc.get("name"),
                "age": age,
                "sex": patient_doc.get("gender"),
                "blood_group": patient_doc.get("blood_group")
            }

        patient_details_json = json.dumps(patient_details, indent=2, default=str)

        # ---------------------------------------------------------
        # 2️⃣ PROMPT (shortened, zero-omission mandate strengthened)
        # ---------------------------------------------------------

        prompt = f"""
You are a hospital clinical documentation assistant. Convert the DICTATION
below into a structured clinical note (JSON), formatted like a real hospital
EMR note.

RULE 1 — SOURCE OF TRUTH
The dictation is the ONLY source of clinical content. Include a
field/section only if it is explicitly stated in the dictation. Never add a
recommendation, suggestion, treatment, investigation, or follow-up step the
doctor did not explicitly say. You are structuring speech, not practicing
medicine — no clinical judgment, no "typical" additions, no auto-completing
a picture the doctor didn't finish.

RULE 2 — ZERO OMISSION (equally important as Rule 1)
Every clinically relevant detail the doctor actually said must appear
somewhere in the output. This is not limited to a fixed set of fields —
for EVERY item (a medication, a procedure, an investigation, a plan,
a follow-up instruction, etc.) capture ALL of its stated qualifiers as
nested keys named to match what was said: e.g. guideline/citation mentioned,
rationale or patient-specific reasoning given, dose/technique/margins/cycles,
prerequisites, contraindications, possible complications, post-procedure
care steps, supporting trial or reference named, risk level, timing/urgency,
evidence grade, monitoring parameters and frequency, success criteria,
escalation criteria and the action to take. Do NOT restrict yourself to a
short example field list — if the dictation states more than a name/dose,
capture the rest too, as additional nested keys under that item. When in
doubt about whether a detail is clinically relevant, INCLUDE it. When in
doubt about whether something was actually said (vs. implied), LEAVE IT OUT.
Never duplicate the same fact across two sections. Never output empty
sections, empty lists, or null placeholders — omit the key instead.

RULE 3 — DYNAMIC STRUCTURE
There is no fixed schema. Choose section names yourself based on what's in
the dictation (e.g. chief_complaint, history_of_present_illness,
past_medical_history, past_surgical_history, allergies, medications,
examination_findings, vital_signs, investigations, diagnosis, assessment,
primary_survey [A/B/C/D/E, trauma notes only], treatment_goals,
proposed_treatment_plans, lifestyle_modifications, counselling_and_consent,
follow_up_plan, clinical_summary, or any other clinically appropriate name).
Adapt to the encounter type (OPD, ER, ward round, oncology consult,
discharge summary, procedure note, etc.). Use lists of nested objects
wherever an item repeats (medications, investigations, procedures, plans,
monitoring items, escalation criteria).

RULE 4 — CLEANUP
- Strip filler words ("uh", "um") and false starts; keep only the final
  corrected statement.
- Convert spoken numbers to numerals; normalize units (mmHg, bpm, %, °F/°C).
- Merge fragments of one clinical concept into a single entry (don't split
  "chest pain" / "two hours" / "radiates to left arm" into separate items).
- Never include raw system timestamps or database IDs. Convert relative
  time references into clinical phrases (e.g. "started 2 hours ago").

PATIENT DEMOGRAPHICS (context only — do not alter, will be reattached by
the system separately, do not repeat them as a section in your output):
{patient_details_json}

DICTATION:
{dictation}

OUTPUT: Return ONLY valid JSON — no prose, no comments, no markdown fences.
Include every section supported by the dictation, each with every stated
detail nested inside it, and nothing that wasn't said.
"""

        # ---------------------------------------------------------
        # 3️⃣ LLM CALL
        # ---------------------------------------------------------

        completion = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            response_format={"type": "json_object"},
            max_tokens=6000
        )

        llm_output = json.loads(completion.choices[0].message.content)
        print(llm_output)

        # ---------------------------------------------------------
        # 4️⃣ RESPONSE (patient demographics always retained)
        # ---------------------------------------------------------

        final_output = {
            "patient_demographics": patient_details,
            **llm_output
        }
        # ---------------------------------------------------------
        # 5️⃣ APPEND STRUCTURED NOTE TO PATIENT DOCUMENT
        # ---------------------------------------------------------

        structured_note_collection.update_one(
            {
                "patient_id": patient_id,
                "doctor_id": doctor_id
            },
            {
                "$push": {
                    "structured_notes": {
                        "dictation": dictation,
                        "structured_note": final_output,
                        "created_at": datetime.utcnow()
                    }
                },
                "$set": {
                    "updated_at": datetime.utcnow()
                },
                "$setOnInsert": {
                    "patient_id": patient_id,
                    "doctor_id": doctor_id,
                    "created_at": datetime.utcnow()
                }
            },
            upsert=True
        )
        return {
            "status": "success",
            "feature_name": "structured_note",
            "finaloutput": final_output,
            "metadata": {
                "doctor_id": doctor_id,
                "patient_id": patient_id
            }
        }

    except Exception as e:

        logger.exception("Structured note generation failed")

        raise HTTPException(
            status_code=500,
            detail=f"Structured note generation error: {str(e)}"
        )


#################################Alwin Patient Portal Edits 2024-06-17########################################

@router.post("/patient-triage")
async def patient_triage(request: Request):
    """
    Unified triage endpoint.

    Phase 1 – { hms_id, reason }
                → creates session, returns first question

    Phase 2 – { hms_id, session_id, question, answer }
                → saves Q&A pair, returns next question
                → when all questions answered, auto-triggers assessment +
                  recommends top 3 matching doctors from the hospital
    """
    try:
        data       = await request.json()
        hms_id     = data.get("hms_id", "").strip()
        session_id = data.get("session_id")

        if not hms_id:
            raise HTTPException(status_code=400, detail="hms_id is required")

        # ══════════════════════════════════════════════════════════
        # PHASE 2 – save answer, check if all done, maybe assess
        # ══════════════════════════════════════════════════════════
        if session_id and "question" in data and "answer" in data:

            incoming_question = data.get("question", "").strip()
            incoming_answer   = data.get("answer", "").strip()

            if not incoming_question or not incoming_answer:
                raise HTTPException(
                    status_code=400,
                    detail="Both question and answer are required"
                )

            # ── 1. Load history doc ───────────────────────────────
            history_doc = patient_triage_history.find_one({"hms_id": hms_id})
            if not history_doc:
                raise HTTPException(
                    status_code=404,
                    detail=f"No triage history found for hms_id={hms_id}"
                )

            # ── 2. Find the current visit ─────────────────────────
            visits = history_doc.get("visits", [])
            visit  = next((v for v in visits if v["session_id"] == session_id), None)

            if not visit:
                raise HTTPException(
                    status_code=404,
                    detail=f"No visit found for session_id={session_id}"
                )
            if visit.get("status") == "completed":
                raise HTTPException(
                    status_code=409,
                    detail="This triage session is already completed"
                )

            # ── 3. Match incoming question against DB questions ───
            all_questions  = visit.get("questions", [])
            saved_qa_pairs = visit.get("qa_pairs", [])
            answered_texts = {pair["question"] for pair in saved_qa_pairs}

            matched_question = next(
                (q for q in all_questions
                 if q["question"].strip() == incoming_question
                 and q["question"].strip() not in answered_texts),
                None
            )

            if not matched_question:
                raise HTTPException(
                    status_code=400,
                    detail="Question does not match any unanswered question in this session"
                )

            # ── 4. Append Q&A pair ────────────────────────────────
            now    = datetime.now(timezone.utc)
            new_qa = {
                "question_id" : matched_question["id"],
                "question"    : matched_question["question"],
                "answer"      : incoming_answer,
                "answered_at" : now.isoformat(),
            }

            updated_qa_pairs = saved_qa_pairs + [new_qa]

            patient_triage_history.update_one(
                {
                    "hms_id"            : hms_id,
                    "visits.session_id" : session_id,
                },
                {
                    "$set": {
                        "visits.$.qa_pairs"   : updated_qa_pairs,
                        "visits.$.updated_at" : now.isoformat(),
                    }
                }
            )

            # ── 5. Check if all questions are answered ────────────
            all_answered = len(updated_qa_pairs) >= len(all_questions)

            if not all_answered:
                answered_ids  = {pair["question_id"] for pair in updated_qa_pairs}
                next_question = next(
                    (q for q in all_questions if q["id"] not in answered_ids),
                    None
                )

                return {
                    "phase"         : "answering",
                    "session_id"    : session_id,
                    "hms_id"        : hms_id,
                    "answered"      : len(updated_qa_pairs),
                    "total"         : len(all_questions),
                    "next_question" : next_question,
                }

            # ── 6. All answered → run assessment ──────────────────
            patient_context = history_doc.get("patient_context", {})
            hospital_id     = history_doc.get("hospital_id")
            reason          = visit.get("reason", "")

            qa_for_prompt = [{"question": p["question"], "answer": p["answer"]} for p in updated_qa_pairs]

            assessment_prompt = f"""
    You are a clinical triage assessment AI operating inside a Hospital Management System.

    You have been given a patient's background information, their reason for visit,
    and their answers to structured follow-up questions.

    Your task is to:
    1. Determine the clinical severity of the patient's condition.
    2. Recommend the most appropriate medical speciality for the patient to consult.
    3. Provide a brief clinical reasoning summary for both decisions.

    # PATIENT CONTEXT
    {json.dumps(patient_context, indent=2)}

    # REASON FOR VISIT
    {reason}

    # FOLLOW-UP Q&A
    {json.dumps(qa_for_prompt, indent=2)}

    # SEVERITY SCALE  (choose exactly one)
    - "low"      : Minor/non-urgent; manageable in general outpatient or primary care
    - "moderate" : Requires timely specialist attention but not an emergency
    - "high"     : Requires urgent specialist attention within hours
    - "critical" : Requires immediate emergency intervention

    # SPECIALITY SELECTION
    - Recommend exactly one primary speciality using standard hospital department names.
    - Optionally recommend one secondary speciality only if clearly warranted, else null.

    # STRICT RULES
    - Base your assessment ONLY on the information provided above.
    - Do NOT invent patient data.
    - Do NOT provide specific diagnoses.
    - Do NOT recommend specific medications or treatments.
    - Output valid JSON only — no text outside the JSON object.

    # OUTPUT FORMAT
    {{
    "severity": "<low|moderate|high|critical>",
    "severity_reasoning": "<1-3 sentence clinical rationale>",
    "recommended_speciality": "<primary speciality>",
    "secondary_speciality": "<secondary speciality or null>",
    "speciality_reasoning": "<1-3 sentence clinical rationale>",
    "urgency_note": "<brief plain-language note for the front desk>"
    }}
    """

            completion = groq_client.chat.completions.create(
                model="llama-3.1-8b-instant",
                temperature=0.1,
                max_tokens=1200,
                response_format={"type": "json_object"},
                messages=[{"role": "user", "content": assessment_prompt}],
            )

            _raw       = completion.choices[0].message.content
            _cleaned   = re.sub(r"```(?:json)?|```", "", _raw).strip()
            assessment = json.loads(_cleaned)

            # ── 7. Fetch all doctors from the same hospital ───────
            recommended_doctors = []

            if hospital_id:
                all_doctors = list(
                    doctor_user_collection.find(
                        {"hospital_id": hospital_id},
                        {"_id": 0}
                    )
                )

                if all_doctors:
                    primary_speciality   = assessment.get("recommended_speciality", "").lower()
                    secondary_speciality = (assessment.get("secondary_speciality") or "").lower()

                    # Build a structured list for the LLM to rank
                    doctors_for_llm = [
                        {
                            "sys_user_id"           : d.get("sys_user_id"),
                            "doctor_id"             : d.get("doctor_id"),
                            "name"                  : d.get("name"),
                            "specialization"        : d.get("specialization"),
                            "qualifications"        : d.get("qualifications"),
                        }
                        for d in all_doctors
                    ]

                    doctor_ranking_prompt = f"""
You are a clinical triage assistant inside a Hospital Management System.

A patient has been assessed and requires a doctor with a specific speciality.
Your task is to select the best 3 doctors from the list below for this patient.

# ASSESSMENT SUMMARY
- Primary speciality needed : {assessment.get("recommended_speciality")}
- Secondary speciality      : {assessment.get("secondary_speciality") or "None"}
- Severity                  : {assessment.get("severity")}
- Clinical reasoning        : {assessment.get("speciality_reasoning")}

# AVAILABLE DOCTORS
{json.dumps(doctors_for_llm, indent=2)}

# SELECTION RULES
- Prioritise doctors whose specialization closely matches the primary speciality needed.
- If fewer than 3 exact matches exist, fill remaining slots with doctors matching
  the secondary speciality or the closest related speciality.
- If total available doctors < 3, return all of them.
- Rank by best speciality fit first.
- Output valid JSON only — no text outside the JSON object.

# OUTPUT FORMAT
{{
  "recommended_doctors": [
    {{
      "rank"           : 1,
      "sys_user_id"    : "<doctor sys_user_id>",
      "doctor_id"      : "<doctor_id>",
      "name"           : "<doctor name>",
      "specialization" : "<doctor specialization>",
      "qualifications" : "<doctor qualifications>",
      "match_reason"   : "<1 sentence why this doctor fits>"
    }}
  ]
}}
"""

                    doc_completion = groq_client.chat.completions.create(
                        model="llama-3.1-8b-instant",
                        temperature=0.1,
                        max_tokens=1000,
                        response_format={"type": "json_object"},
                        messages=[{"role": "user", "content": doctor_ranking_prompt}],
                    )

                    _doc_raw            = doc_completion.choices[0].message.content
                    _doc_cleaned        = re.sub(r"```(?:json)?|```", "", _doc_raw).strip()
                    recommended_doctors = json.loads(_doc_cleaned).get("recommended_doctors", [])

            # ── 8. Mark visit completed ───────────────────────────
            patient_triage_history.update_one(
                {
                    "hms_id"            : hms_id,
                    "visits.session_id" : session_id,
                },
                {
                    "$set": {
                        "visits.$.assessment"           : assessment,
                        "visits.$.recommended_doctors"  : recommended_doctors,
                        "visits.$.status"               : "completed",
                        "visits.$.updated_at"           : now.isoformat(),
                    }
                }
            )

            logger.info(
                f"[TRIAGE] Assessment done | session={session_id} | "
                f"severity={assessment.get('severity')} | "
                f"speciality={assessment.get('recommended_speciality')} | "
                f"doctors_matched={len(recommended_doctors)}"
            )

            return {
                "phase"               : "assessment",
                "session_id"          : session_id,
                "hms_id"              : hms_id,
                "reason"              : reason,
                "assessment"          : assessment,
                "recommended_doctors" : recommended_doctors,
            }

        # ══════════════════════════════════════════════════════════
        # PHASE 1 – new visit, generate questions
        # ══════════════════════════════════════════════════════════
        reason = data.get("reason", "").strip()

        if not reason:
            raise HTTPException(
                status_code=400,
                detail="reason is required to start a triage session"
            )

        # ── 1. Fetch patient ──────────────────────────────────────
        patient = patient_user_collection.find_one({"hms_id": hms_id}, {"_id": 0})
        if not patient:
            raise HTTPException(
                status_code=404,
                detail=f"No patient found for hms_id={hms_id}"
            )

        # ── 2. Build patient context ──────────────────────────────
        age = None
        try:
            from datetime import date
            dob   = datetime.strptime(patient.get("date_of_birth", ""), "%Y-%m-%d").date()
            today = date.today()
            age   = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
        except Exception:
            age = None

        patient_context = {
            "age"            : age,
            "gender"         : patient.get("gender"),
            "blood_group"    : patient.get("blood_group"),
            "marital_status" : patient.get("marital_status"),
            "occupation"     : patient.get("occupation"),
            "education"      : patient.get("education"),
            "family_history" : patient.get("family_history"),
        }

        # ── 3. LLM – generate follow-up questions ─────────────────
        questions_prompt = f"""
You are a clinical triage assistant operating inside a Hospital Management System.

A patient has arrived and provided their reason for visit.
Generate a precise set of follow-up questions to determine severity
and the most appropriate medical speciality.

# PATIENT CONTEXT
{json.dumps(patient_context, indent=2)}

# REASON FOR VISIT
{reason}

# YOUR TASK
Generate between 5 and 10 concise, clinically relevant follow-up questions.
- Directly derived from the reason for visit and patient context.
- Do NOT ask anything already answered by the patient context above.
- Cover: severity, onset, duration, progression, associated symptoms,
  aggravating/relieving factors, and relevant risk factors.
- Write in plain language a non-medical person can easily understand.
- Do NOT provide any diagnosis, risk assessment, or treatment advice.
- Output valid JSON only — no text outside the JSON object.

# OUTPUT FORMAT
{{
  "questions": [
    {{
      "id": 1,
      "question": "<question text>"
    }}
  ]
}}
"""

        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            temperature=0.2,
            max_tokens=1200,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": questions_prompt}],
        )

        _raw      = completion.choices[0].message.content
        _cleaned  = re.sub(r"```(?:json)?|```", "", _raw).strip()
        questions = json.loads(_cleaned).get("questions", [])

        # ── 4. Build new visit entry ──────────────────────────────
        now        = datetime.now(timezone.utc)
        session_id = f"TRIAGE-{patient['sys_user_id']}-{int(now.timestamp())}"

        new_visit = {
            "session_id"          : session_id,
            "visit_date"          : now.date().isoformat(),
            "created_at"          : now.isoformat(),
            "updated_at"          : now.isoformat(),
            "status"              : "awaiting_answers",
            "reason"              : reason,
            "questions"           : questions,
            "qa_pairs"            : [],
            "assessment"          : None,
            "recommended_doctors" : [],
        }

        # ── 5. Upsert patient history doc, push new visit ─────────
        patient_triage_history.update_one(
            {"hms_id": hms_id},
            {
                "$setOnInsert": {
                    "hms_id"      : hms_id,
                    "sys_user_id" : patient["sys_user_id"],
                    "patient_id"  : patient.get("patient_id"),
                    "hospital_id" : patient.get("hospital_id"),
                },
                "$set":  {"patient_context": patient_context},
                "$push": {"visits": new_visit},
            },
            upsert=True,
        )

        logger.info(
            f"[TRIAGE] Session created | session={session_id} | "
            f"patient={patient['sys_user_id']} | questions={len(questions)}"
        )

        return {
            "phase"           : "questions",
            "session_id"      : session_id,
            "hms_id"          : hms_id,
            "patient_name"    : patient.get("name"),
            "reason"          : reason,
            "first_question"  : questions[0] if questions else None,
            "total_questions" : len(questions),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("patient_triage failed")
        raise HTTPException(
            status_code=500,
            detail=f"Patient triage failed: {str(e)}"
        )

############################Alwin Patient Portal Edits End 2024-06-17########################################


CASE_HISTORY_SCHEMA = """
{
  "registration": {
    "routine_screening": "Yes" | "No" | null,
    "asymptomatic": "Yes" | "No" | null,
    "symptoms": ["General" | "Breast Symptoms" | "Cervical Symptoms" | "Oral Symptoms" |
                 "Gastro Intestinal Symptoms" | "Urinary Symptoms" | "Respiratory Symptoms" | "Others"] | null,
    "symptoms_other_detail": string | null,
    "duration_of_symptoms": { "value": number, "unit": "Years" | "Months" | "Weeks" | "Days" } | null
  },
  "history": {
    "comorbidities_present": "Yes" | "No" | "Unknown" | null,
    "comorbidities": [
      { "name": string, "age_at_onset": number | null,
        "duration": { "value": number, "unit": "Years" | "Months" | "Weeks" | "Days" } | null }
    ] | null,
    "remarks": string | null
  },
  "family_history": {
    "family_history_of_cancer": "Yes" | "No" | "Unknown" | null,
    "relation_with_patient": string | null,
    "cancer_site": string | null,
    "laterality": string | null,
    "age_at_onset": number | null,
    "duration_months_years": string | null,
    "status": "Death" | "Disease free" | "Palliative Care" | "Others" | null
  },
  "substance_abuse": {
    "substance_abuse_history": "Yes" | "No" | "Unknown" | null,
    "habits": [
      { "name": string, "quantity": string | null, "age_started": number | null,
        "duration": { "value": number, "unit": "Days" | "Weeks" | "Month" | "Years" } | null,
        "quit": "Yes" | "No" | null, "age_quit": number | null,
        "duration_since_quit": { "value": number, "unit": "Days" | "Weeks" | "Month" | "Years" } | null }
    ] | null,
    "occupational_exposure": string | null,
    "remarks": string | null
  },
  "previous_cancer": {
    "history_of_previous_cancer": "Yes" | "No" | "Unknown" | null,
    "diagnosis": string | null,
    "cancer_site": string | null,
    "stage_at_diagnosis": string | null,
    "type_of_treatment": ["Bone Marrow Transplant" | "Stenting" | "Hormone Therapy" | "Symptomatic" |
                           "Radiology Intervention" | "Endoscopy Intervention" | "Chemotherapy" |
                           "Radiation therapy" | "Surgery"] | null,
    "remarks": string | null
  },
  "menstrual_history": {
    "menstrual_history": "Yes" | "No" | "Unknown" | null,
    "menopause_status": "Pre Menarchal" | "Pre-Menopausal" | "Peri Menopausal" | "Post Menopausal" | null,
    "lmp_date": string | null,
    "marital_status": "Married" | "Unmarried" | "Separated" | "Divorced" | null,
    "age_at_marriage": number | null,
    "hysterectomy_done": "Yes" | "No" | null,
    "indications_for_hysterectomy": string | null,
    "age_at_hysterectomy": number | null
  },
  "obstetric_history": {
    "obstetric_history": "Yes" | "No" | "Unknown" | null,
    "gravida": number | null,
    "para": number | null,
    "abortion": number | null,
    "living_children": number | null,
    "normal_delivery": number | null,
    "caesarean_section": number | null,
    "dead_children": number | null,
    "still_births": number | null,
    "breastfed": "Yes" | "No" | null,
    "breastfeeding_duration_months": number | null
  },
  "contraceptive_history": {
    "contraceptives": "Yes" | "No" | "Unknown" | null,
    "contraceptive_type": ["Oral Pills" | "Tubal ligation" | "Vasectomy" | "Natural method" |
                           "Barrier" | "Sterilization" | "I.U.D" | "Injectables" | "Others"] | null,
    "duration_of_contraceptive": string | null,
    "remarks": string | null
  },
  "hrt_history": {
    "hrt_history": "Yes" | "No" | "Unknown" | null,
    "type_of_therapy": "Oestrogen only" | "Oestrogen-Progestogen Sequential" |
                        "Oestrogen-Progestogen Continuous Combined" | "Tibolone" | "SERMs" | null,
    "from_date": string | null,
    "route_of_administration": string | null,
    "remarks": string | null
  }
}
"""

EXAMINATION_SCHEMA = """
{
  "general_examination": {
    "height_cm": number | null,
    "weight_kg": number | null,
    "vitals": { "spo2": string | null, "blood_pressure": string | null, "others": string | null },
    "findings": ["Oedema" | "Cyanosis" | "Clubbing" | "Purpura" | "Obesity" | "Icterus" | "Pallor"] | null,
    "nutrition": string | null,
    "hydration": string | null,
    "oral_cavity_findings": string | null,
    "dental_hygiene": string | null,
    "mouth_opening_cm": number | null
  },
  "breast_examination": {
    "left": { "signs_of_surgery": "Yes" | "No" | null, "axilla": "Normal" | "Abnormal" | "Others" | null,
              "palpation": string | null, "nipple_discharge": string | null,
              "nipple_retraction": string | null, "other_findings": string | null },
    "right": { "signs_of_surgery": "Yes" | "No" | null, "axilla": "Normal" | "Abnormal" | "Others" | null,
               "palpation": string | null, "nipple_discharge": string | null,
               "nipple_retraction": string | null, "other_findings": string | null }
  },
  "cervical_examination": {
    "via": "Positive" | "Negative" | "Inconclusive" | null,
    "vili": string | null,
    "colposcopy": string | null,
    "impression": "Normal" | "Invasive Cancer" | "CIN 3" | "CIN 2" | "CIN I" | "HPV Changes" |
                  "Polyp" | "Cervicitis" | "Ectropion" | "Frank Growth" | "Atrophy" | "Others" | null,
    "remarks": string | null
  },
  "investigations_advised": {
    "oral": ["Oral Brush Cytology" | "Oral Punch Biopsy" | "USG Neck" | "Others"] | null,
    "breast": ["Bilateral Mammography" | "USG B/L Breast & Axilla" | "Nipple Discharge Cytology" |
               "FNAC" | "Biopsy" | "Others"] | null,
    "cervical": ["PAP Smear" | "HPV DNA" | "Cervical Punch Biopsy" | "Endocervical Curetage" |
                 "Colposcopy" | "Colposcopy guided biopsy" | "Others"] | null,
    "prostate": ["Sr. PSA" | "USG Pelvis" | "Others"] | null,
    "abdomen": ["USG Abdomen" | "USG Pelvis" | "Others"] | null,
    "thorax": ["Chest X-Ray" | "CT Thorax" | "Others"] | null,
    "usg_other_sites": string | null,
    "tumor_markers": ["CA 125" | "CA 19.9" | "CEA" | "AFP" | "Others"] | null,
    "other_investigations": ["CBC" | "RFT" | "LFT" | "Sr Electrolytes" | "FBS" | "PPBS" |
                             "HbA1c" | "Lipid Profile" | "Others"] | null
  },
  "prescription": string | null,
  "follow_up_advise": {
    "tobacco_cessation_details": string | null,
    "lifestyle_modification_details": string | null,
    "others": string | null
  },
  "follow_up_visit": {
    "oral": "After 3 months" | "After 6 months" | "After 1 year" | null,
    "breast": "After 3 months" | "After 6 months" | "After 1 year" | "After 2 years" | null,
    "cervical": "After 3 months" | "After 6 months" | "After 1 year" | "After 2 years" | null
  },
  "refer_to_other_departments": string | null,
  "refer_outside_hospital": string | null
}
"""


def _get_patient_context(patient_id: str) -> dict:
    """Small demographic lookup, mirrors the pattern used in generate-structured-note."""
    doc = patient_user_collection.find_one(
        {"sys_user_id": patient_id},
        {"_id": 0, "name": 1, "date_of_birth": 1, "gender": 1},
    ) or {}

    age = None
    dob_str = doc.get("date_of_birth")
    if dob_str:
        try:
            dob = datetime.strptime(dob_str, "%Y-%m-%d").date()
            today = datetime.utcnow().date()
            age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
        except Exception:
            pass

    return {"name": doc.get("name"), "age": age, "sex": doc.get("gender")}


def _call_llm(prompt: str) -> dict:
    completion = groq_client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        response_format={"type": "json_object"},
        max_tokens=5000,
    )
    return json.loads(completion.choices[0].message.content)


# ---------------------------------------------------------------------------
# 1) PO Part A + Part B  — from patient/nurse conversation
# ---------------------------------------------------------------------------

@router.post("/generate-case-history")
async def generate_case_history(request: Request):
    try:
        payload = await request.json()
        doctor_id = payload.get("doctor_id")
        patient_id = payload.get("patient_id")
        conversation = payload.get("conversation")

        if not doctor_id or not patient_id or not conversation:
            raise HTTPException(
                status_code=400,
                detail="doctor_id, patient_id and conversation are required",
            )

        patient_context = _get_patient_context(patient_id)
        is_female = str(patient_context.get("sex", "")).lower().startswith("f")

        prompt = f"""
You are a hospital clinical documentation assistant specialising in Preventive
Oncology screening (NCG-KCDO Preventive Oncology Template v2.0).

Convert the PATIENT-NURSE CONVERSATION below into a structured case history.

You MUST follow the FIXED OUTPUT STRUCTURE exactly. Do not add, rename, or
remove top-level or nested keys. If information for a field is not present in
the conversation, set its value to null (do not omit the key, do not guess,
do not invent).

The patient's sex is: {"female" if is_female else "male/unspecified"}.
{"Populate menstrual_history, obstetric_history, contraceptive_history and hrt_history only from what is explicitly said; if nothing is said for a sub-field, use null." if is_female else "The patient is not female — set menstrual_history, obstetric_history, contraceptive_history and hrt_history to null."}

----------------------------------------
FIXED OUTPUT STRUCTURE (JSON schema)
----------------------------------------
{CASE_HISTORY_SCHEMA}

----------------------------------------
PATIENT CONTEXT
----------------------------------------
{json.dumps(patient_context, default=str)}

----------------------------------------
PATIENT-NURSE CONVERSATION
----------------------------------------
{conversation}

----------------------------------------
RULES
----------------------------------------
1. Remove filler words, repetitions, and speech corrections; do not quote verbatim.
2. Do NOT invent, infer, or assume any clinical detail not explicitly stated.
3. Convert spoken numbers to numeric values (e.g. "twenty two" -> 22).
4. Only mark a checkbox-style field as populated if the conversation clearly supports it.
5. Return ONLY valid JSON — no commentary, no markdown fences.
"""

        llm_output = _call_llm(prompt)

        return {
            "status": "success",
            "feature_name": "preventive_case_history",
            "is_female": is_female,
            "finaloutput": llm_output,
            "metadata": {"doctor_id": doctor_id, "patient_id": patient_id},
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Preventive case-history generation failed")
        raise HTTPException(status_code=500, detail=f"Case history generation error: {str(e)}")


# ---------------------------------------------------------------------------
# 2) PO Part C — from nurse examination notes ONLY
# ---------------------------------------------------------------------------

@router.post("/generate-examination")
async def generate_examination(request: Request):
    try:
        payload = await request.json()
        doctor_id = payload.get("doctor_id")
        patient_id = payload.get("patient_id")
        nurse_notes = payload.get("nurse_notes")

        if not doctor_id or not patient_id or not nurse_notes:
            raise HTTPException(
                status_code=400,
                detail="doctor_id, patient_id and nurse_notes are required",
            )

        patient_context = _get_patient_context(patient_id)
        is_female = str(patient_context.get("sex", "")).lower().startswith("f")

        prompt = f"""
You are a hospital clinical documentation assistant specialising in Preventive
Oncology screening (NCG-KCDO Preventive Oncology Template v2.0).

Convert the NURSE EXAMINATION NOTES below into a structured examination
record (PO Part C: Examination Details).

You MUST follow the FIXED OUTPUT STRUCTURE exactly. Do not add, rename, or
remove keys. If information for a field is not present, set its value to
null (do not omit the key, do not guess, do not invent).

{"Populate breast_examination and cervical_examination only from what is explicitly stated; if a sub-field is not mentioned, use null." if is_female else "The patient is not female — set breast_examination and cervical_examination to null."}

----------------------------------------
FIXED OUTPUT STRUCTURE (JSON schema)
----------------------------------------
{EXAMINATION_SCHEMA}

----------------------------------------
PATIENT CONTEXT
----------------------------------------
{json.dumps(patient_context, default=str)}

----------------------------------------
NURSE EXAMINATION NOTES
----------------------------------------
{nurse_notes}

----------------------------------------
RULES
----------------------------------------
1. Remove filler words and system timestamps.
2. Convert spoken/written numbers to numeric values (height, weight, mouth opening etc).
3. Do NOT invent findings that are not stated (e.g. do not assume "Normal" if not said).
4. Only include checkbox-style items that are clearly supported by the notes.
5. Return ONLY valid JSON — no commentary, no markdown fences.
"""

        llm_output = _call_llm(prompt)

        return {
            "status": "success",
            "feature_name": "preventive_examination",
            "is_female": is_female,
            "finaloutput": llm_output,
            "metadata": {"doctor_id": doctor_id, "patient_id": patient_id},
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Preventive examination generation failed")
        raise HTTPException(status_code=500, detail=f"Examination generation error: {str(e)}")
    
    


@router.get("/oncology-investigations/pending")
async def get_pending_investigations(patient_id: str, doctor_id: str):
    """
    Return all pending oncology investigations for a given patient + doctor.
    
    """
    
    try:
       
        cursor = oncology_investigations_collection.find(
            {
                "patient_id": patient_id,
                "doctor_id": doctor_id,
                "status": "pending",
            }
        ).sort("id", 1)

        docs = await cursor.to_list(length=None)
        logger.info(f"docs:{docs}")
        results = []
        for doc in docs:
            # Fallback if older records don't have investigation_name stored
            name = doc.get("investigation_name")
            if not name:
                raw = doc.get("investigation", "")
                name = raw.rsplit("_", 2)[0] if raw else "—"

            results.append({
                "id": doc.get("id"),
                "investigation_name": name,
                "date_of_order": doc.get("date_of_order"),
                "clinical_indication": doc.get("clinical_indication"),
                "parameters": doc.get("parameters", []),
            })

        return {
            "status": "success",
            "count": len(results),
            "investigations": results,
        }

    except Exception as e:
        logger.error(f"Error fetching pending investigations: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch pending investigations")





@router.post("/tumor-board-presentation-workflow")
async def tumor_board_presentation_workflow(request: Request):
    try:
        payload = await request.json()

        doctor_id = payload.get("doctor_id")
        raw_patient_id = payload.get("patient_id")

        doctor_id = str(doctor_id) if doctor_id is not None else None
        patient_id = str(raw_patient_id) if raw_patient_id is not None else None

        if not doctor_id or not patient_id:
            raise HTTPException(
                status_code=400,
                detail="doctor_id and patient_id required"
            )

        # ── Doctor lookup — kept only for validation/audit, not used in the prompt ──
        doctor_result = doctor_user_collection.find_one(
            {"sys_user_id": doctor_id},
            {"_id": 0, "name": 1}
        )
        doctor_doc = await doctor_result if inspect.isawaitable(doctor_result) else doctor_result

        if not doctor_doc:
            raise HTTPException(status_code=404, detail="Doctor not found")

        # ── Patient demographics ──
        patient_result = patient_user_collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0, "gender": 1, "date_of_birth": 1, "name": 1}
        )
        patient_doc = await patient_result if inspect.isawaitable(patient_result) else patient_result

        if not patient_doc:
            patient_result = patient_user_collection.find_one(
                {"sys_user_id": patient_id},
                {"_id": 0, "gender": 1, "date_of_birth": 1, "name": 1}
            )
            patient_doc = await patient_result if inspect.isawaitable(patient_result) else patient_result

        patient_age = calculate_age(patient_doc.get("date_of_birth")) if patient_doc else None
        patient_sex = patient_doc.get("gender") if patient_doc else None

        # ── Latest patient summary document — this is the ONLY clinical source used below ──
        summary_cursor = summary_collection.find(
            {"patient_id": patient_id}
        ).sort("generated_at", -1).limit(1)

        if hasattr(summary_cursor, "to_list"):
            # Motor (async) cursor
            summary_result = summary_cursor.to_list(1)
            summary_docs = await summary_result if inspect.isawaitable(summary_result) else summary_result
        else:
            # PyMongo (sync) cursor
            summary_docs = list(summary_cursor)

        if not summary_docs:
            raise HTTPException(
                status_code=404,
                detail=f"No patient summary found for patient_id={patient_id}"
            )

        patient_summary = summary_docs[0]
        patient_summary["_id"] = str(patient_summary["_id"])

        # ── Clinical summary narrative ──
        summary_block = patient_summary.get("summary", {}) if isinstance(patient_summary, dict) else {}
        clinical_summary_paragraphs = summary_block.get("paragraphs", []) if isinstance(summary_block, dict) else []
        clinical_summary_text = "\n\n".join(clinical_summary_paragraphs)

        # ── Timeline ──
        timeline_block = patient_summary.get("timeline", {}) if isinstance(patient_summary, dict) else {}
        timeline_entries = timeline_block.get("timeline", []) if isinstance(timeline_block, dict) else []

        # ── Length guard for clinical summary only ──
        MAX_CLINICAL_SUMMARY_CHARS = 6000

        clinical_summary_truncated = len(clinical_summary_text) > MAX_CLINICAL_SUMMARY_CHARS
        if clinical_summary_truncated:
            clinical_summary_text = (
                clinical_summary_text[:MAX_CLINICAL_SUMMARY_CHARS]
                + "\n\n[...clinical summary truncated for length...]"
            )

        # ── Timeline: process in batches of 5 entries so ALL data is considered,
        # summarizing each batch instead of truncating for length ──
        def _format_timeline_entry(entry):
            if isinstance(entry, dict):
                return f"- {entry.get('date', 'undated')}: {entry.get('narrative', entry.get('event', entry))}"
            return f"- {entry}"

        TIMELINE_BATCH_SIZE = 5
        batch_summaries = []

        if timeline_entries:
            for i in range(0, len(timeline_entries), TIMELINE_BATCH_SIZE):
                batch = timeline_entries[i:i + TIMELINE_BATCH_SIZE]
                batch_text = "\n".join(_format_timeline_entry(entry) for entry in batch)

                batch_prompt = f"""Summarize the following chronological clinical timeline entries into a
concise clinical narrative. Preserve every distinct clinical fact, date, and event mentioned.
Do not invent or infer anything not present below.

{batch_text}

Return ONLY the summarized narrative, no preamble, no markdown."""

                batch_completion = groq_client.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=[{"role": "user", "content": batch_prompt}],
                    temperature=0.2,
                    max_tokens=300
                )
                batch_summaries.append(batch_completion.choices[0].message.content.strip())

        timeline_text = "\n\n".join(batch_summaries) if batch_summaries else "No timeline entries recorded."
        timeline_truncated = False

        logger.info(
            "tumor_board_clinical_summary=%s",
            clinical_summary_text[:1000]
        )
        logger.info(
            "tumor_board_timeline=%s",
            timeline_text[:1000]
        )

        demographic_line = f"Age: {patient_age if patient_age is not None else 'not documented'} | Sex: {patient_sex or 'not documented'}"

        prompt = f"""
You are presenting this patient's case at a multidisciplinary tumor board meeting, exactly the
way it is presented in real tumor board rounds — a clear, spoken, clinically dense case summary
delivered to the room before the discussion begins.

Base the presentation STRICTLY on the patient data provided below. Never invent, assume, or fill
in any clinical fact, value, or history detail that is not present in this data. If something
relevant is not documented, simply omit it rather than guessing or defaulting to a typical value.
Some sections below may be marked as truncated for length — if so, present only what is visible
and do not speculate about what was cut off.

════════════════════════════════════
PATIENT DEMOGRAPHICS
════════════════════════════════════
{demographic_line}

════════════════════════════════════
CLINICAL SUMMARY (narrative)
════════════════════════════════════
{clinical_summary_text or "No clinical summary narrative recorded."}

════════════════════════════════════
PATIENT TIMELINE (chronological clinical events, most recent prioritized)
════════════════════════════════════
{timeline_text}

════════════════════════════════════
HOW TO PRESENT THE CASE
════════════════════════════════════
Structure the presentation the way tumor board case presentations are structured, covering
whichever of the following are actually supported by the data above — do not include a
section if the data doesn't support it, and do not pad it with assumptions:

1. Patient overview — age, sex, and functional/performance status, only if documented.
2. Clinical history — presenting complaints and duration, comorbidities, family history,
   personal history (e.g. tobacco/alcohol), only as documented.
3. Physical examination findings — primary site, size, mobility, nodal status, only as documented.
4. Investigations and imaging — key findings that established the diagnosis and staging,
   described the way a clinician would narrate them, not as a raw data dump.
5. Diagnosis and staging — confirmed or working diagnosis, stage, and biomarker/receptor
   status, exactly as documented.
6. Treatment received so far — procedures, surgeries, or medications already given, and
   response if noted; if nothing has been given yet, state that plainly.
7. Reason this case is being brought to the board — derive this only from what the timeline
   and record actually indicate about where the patient currently stands in their care.

════════════════════════════════════
DELIVERY RULES
════════════════════════════════════
- Deliver this as continuous spoken prose — the way a clinician actually talks in rounds.
- No markdown, no headers, no bullet points, no numbered lists in the output.
- Do not offer a treatment recommendation or opinion — your role here is to present the case;
  the board decides.
- Do not fabricate or infer any value not present in the data above, including performance
  status, risk factors, or history details.

════════════════════════════════════
OUTPUT
════════════════════════════════════
Return ONLY the spoken presentation text. No preamble, no headers, no markdown, no JSON.
"""

        completion = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=800
        )

        presentation_text = completion.choices[0].message.content.strip()

        logger.info(
            "tumor_board_presentation_output=%s",
            presentation_text[:1000]
        )

        # ── Persist this presentation — STRICT INSERT ONLY, never update ──
        generated_at = datetime.utcnow()

        presentation_record = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "summary_id": patient_summary["_id"],
            "presentation": presentation_text,
            "clinical_summary_truncated": clinical_summary_truncated,
            "timeline_truncated": timeline_truncated,
            "generated_at": generated_at,
        }

        insert_result = tumor_board_presentation_collection.insert_one(presentation_record)
        insert_result = await insert_result if inspect.isawaitable(insert_result) else insert_result

        inserted_id = str(insert_result.inserted_id)

        return {
            "status": "success",
            "presentation": presentation_text,
            "metadata": {
                "doctor_id": doctor_id,
                "patient_id": patient_id,
                "summary_id": patient_summary["_id"],
                "clinical_summary_truncated": clinical_summary_truncated,
                "timeline_truncated": timeline_truncated,
                "presentation_record_id": inserted_id,
                "generated_at": generated_at.isoformat(),
            }
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.exception("Tumor board presentation workflow failed")
        raise HTTPException(
            status_code=500,
            detail=f"Tumor board presentation workflow error: {str(e)}"
        )
###
@router.get("/tumor-board-presentation/{patient_id}")
async def get_tumor_board_presentations(patient_id: str, latest_only: bool = False):
    try:
        patient_id = patient_id.strip()
        cursor = tumor_board_presentation_collection.find(
            {"patient_id": patient_id}
        ).sort("generated_at", -1)

        if latest_only:
            cursor = cursor.limit(1)

        if hasattr(cursor, "to_list"):
            # Motor (async) cursor
            docs_result = cursor.to_list(length=None if not latest_only else 1)
            docs = await docs_result if inspect.isawaitable(docs_result) else docs_result
        else:
            # PyMongo (sync) cursor
            docs = list(cursor)

        if not docs:
            raise HTTPException(
                status_code=404,
                detail=f"No tumor board presentations found for patient_id={patient_id}"
            )

        for doc in docs:
            doc["_id"] = str(doc["_id"])
            if isinstance(doc.get("generated_at"), datetime):
                doc["generated_at"] = doc["generated_at"].isoformat()

        return {
            "status": "success",
            "patient_id": patient_id,
            "count": len(docs),
            "presentations": docs if not latest_only else docs[0]
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.exception("Tumor board presentation retrieval failed")
        raise HTTPException(
            status_code=500,
            detail=f"Tumor board presentation retrieval error: {str(e)}"
        )