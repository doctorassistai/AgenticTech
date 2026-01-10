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

screening_settings_collection = nodes_database["screening_settings"]

doctor_nodes_collection = nodes_database["doctor_feature_configurations"]

patient_user_collection = db["patient_users"]

doctor_user_collection = db["doctor_users"]

patient_vitals_collection = database["patient_vitals"]

patient_nodes_collection = nodes_database["patient_profile_configurations"]


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
Treatment plan documentation generator.

Focus on:
- Structured plan formatting
- Logical sequencing
- Specialty-aligned language

No independent clinical decisions.
""",

    "documentation-treatment-summary": """
Treatment course summary generator.

Focus on:
- Chronological treatment documentation
- Objective summarization
- Completeness and clarity

No interpretation or recommendations.
""",

    "documentation-medication-analysis": """
Medication documentation analysis.

Focus on:
- Medication lists
- Dosing schedules
- Temporal consistency
- Documentation accuracy

No interaction checking or advice.
""",

    "documentation-investigation-notes": """
Investigation order documentation generator.

Focus on:
- Test names and categories
- Ordering rationale (as documented)
- Structured formatting

No clinical justification.
""",

    "documentation-clinical-notes": """
Structured clinical note generation.

Focus on:
- Problem-oriented documentation
- Objective tone
- Specialty-appropriate phrasing

No inference beyond provided data.
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

Your role is NOT to perform analysis.
Your role is to DESIGN EXECUTION-READY ANALYSIS PROMPTS
that will later be used by another AI to analyze clinical data.

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

----------------------------------------------------------------
EXPECTED INPUT DATA (ASSUME STRUCTURED OBJECTS)
----------------------------------------------------------------
Assume the downstream AI will receive structured clinical data such as:
- Nested JSON objects
- Clearly labeled sections (e.g., biopsy_details, microscopic_findings)
- Temporal or categorical fields where applicable

You must explicitly reference ONLY the data types relevant to this feature.
Do NOT mention unrelated data sources.

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
- Define DISTINCT ANALYTICAL APPROACHES appropriate to the feature
- Describe HOW data is examined, not WHAT sections exist
- Represent different review strategies a clinician may choose
- Be reusable even if report sections or output categories change
- Focus on analytical method, sequencing, or comparison logic

Templates MUST NOT:
- Be named after domain concepts or report sections
- Mirror or correspond to output categories
- Represent a single section or data block


IMPORTANT:
- Do NOT label templates as “default” or “system” in output
- Do NOT omit or reorder templates
- Do NOT generate more or fewer than 5 templates


Each template represents a DIFFERENT but VALID way
a doctor might want this feature to analyze or summarize data.

Examples of variation (choose appropriately):
- Section-focused vs holistic review
- Descriptive vs structured summarization
- Morphology-first vs correlation-first (if applicable)

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
   This MUST be a COMPLETE SYSTEM PROMPT that:
   - Assigns a clinical analytical role to the AI
   - Restates the doctor’s speciality
   - States the exact analytical intent of this feature
   - Lists the EXPECTED INPUT SECTIONS explicitly
   - Explains HOW EACH SECTION should be reviewed
     (e.g., descriptive summary, pattern recognition, consistency check)
   - Explains how sections relate to each other (if applicable)
   

----------------------------------------------------------------
ANALYSIS PROMPT DEPTH REQUIREMENT (MANDATORY)
----------------------------------------------------------------
Each analysis_prompt MUST be a DETAILED, EXECUTION-GRADE SYSTEM PROMPT.

Minimum requirements for EACH analysis_prompt:
- At least 8–12 explicit instructional steps or bullet points
- Explicit review instructions for EACH relevant data type
- Clear description of SEQUENCE of analysis
- Explicit instructions for cross-variable comparison (if applicable)
- Explicit instructions for language normalization
- Explicit prohibition of interpretation repeated inside the prompt
- Explicit definition of the FINAL OUTPUT JSON structure
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
            temperature=0.03,   # 🔑 Lower = more deterministic, less generic
            max_tokens=3000,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
        )

        return {
            "doctor_id": doctor_id,
            "speciality": speciality,
            "feature": feature,
            "analysis_templates": json.loads(
                completion.choices[0].message.content
            )
        }

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

        return {
            "doctor_id": doctor_id,
            "feature_output_categories": json.loads(
                completion.choices[0].message.content
            )
        }

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
    """
    Retrieve patient feature configuration EXACTLY as stored in DB
    """

    doctor_doc = await patient_nodes_collection.find_one(
        {"doctor_id": doctor_id},
        {"_id": 0}
    )

    if not doctor_doc:
        raise HTTPException(
            status_code=404,
            detail=f"No patient features found for doctor_id={doctor_id}"
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

async def get_patient_profile_internal(patient_id: str, doctor_id: str):
    """
    Internal function to fetch patient profile for a given patient_id and doctor_id
    """
    try:
        # ----------------------------------
        # 1️⃣ Fetch doctor patient-profile config
        # ----------------------------------
        profile_config =await patient_nodes_collection.find_one(
            {"doctor_id": doctor_id}
        )

        if not profile_config:
            return {
                "error": "No patient profile configuration found for this doctor"
            }

        selected_fields = []

        for feature in profile_config.get("features", []):
            if feature.get("feature_id") == "patient-profile":
                patient_profile = feature.get("patient_profile", {})
                selected_fields = patient_profile.get("fields", [])
                display_mode = patient_profile.get("display_mode", "Compact View")
                break

        if not selected_fields:
            return {
                "error": "No fields configured for patient profile"
            }

        # ----------------------------------
        # 2️⃣ Fetch patient context
        # ----------------------------------
        patient_context = patient_user_collection.find_one(
            {"sys_user_id": patient_id}
        )

        if not patient_context:
            return {
                "error": "Patient context not found"
            }

        # ----------------------------------
        # 3️⃣ Extract requested fields
        # ----------------------------------
        

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
        return {
            "error": f"Failed to fetch patient profile: {str(e)}"
        }


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