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
from ai_service.cache.redis_client import redis_client
from ai_service.cache.utils import build_cache_key, get_cache, set_cache
from ai_service.layers.prompt_injection_defence import PromptInjectionDetector
from ai_service.layers.sanitizer import InputSanitizer
# from ai_service.guardian_layer.clinical_safety_rules_engine import ( run_clinical_safety_rules_engine )
# from ai_service.guardian_layer.hallucination_cross_check import HallucinationCrossCheckLayer
# from ai_service.guardian_layer.guideline_checker import GuidelineAlignmentLayer
# from ai_service.guardian_layer.factuality_confidence_scorer import FactualityConfidenceScorer





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


MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"
RULE_DB = "doctorassistai_rules"

mongodb_client = AsyncIOMotorClient(MONGO_URI)  # async (Motor)
database = mongodb_client[MONGO_DB]

client = MongoClient(MONGO_URI)  # sync (PyMongo)
db = client[MONGO_DB]

rules_database = mongodb_client[RULE_DB]        # async nodes db
rules_db = client[RULE_DB]                 # sync nodes db

rules_collection = rules_database["rules_settings"]

doctor_user_collection = db["doctor_users"]

patient_user_collection = db["patient_users"]

patient_vitals_collection = database["patient_vitals"]


def safe_json_extract(text: str):
    """
    Extract first valid JSON object from LLM output.
    """
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError("No JSON object found in LLM output")

    return json.loads(match.group())




def clean_llm_text(text: str) -> str:
    if not text:
        return ""

    # Remove markdown symbols (*, **, _, `)
    text = re.sub(r"[*_`]", "", text)

    # Remove common section headings
    text = re.sub(
        r"(Clinical Observations|Correlations and Trends|Insufficient Data|Clinical Significance)\s*:?","",
        text,
        flags=re.IGNORECASE
    )

    # Remove bullet-like spacing
    text = re.sub(r"\s*-\s*", " ", text)

    # Normalize whitespace
    text = re.sub(r"\n+", " ", text)
    text = re.sub(r"\s+", " ", text)

    return text.strip()


@router.post("/execute-specialty-feature-pre")
async def execute_specialty_feature_llm(request: Request):
    """
    Specialty-aware clinical feature execution engine.

    One FEATURE → multiple FORMS
    Each FORM is independently analyzed with:
    - Doctor speciality
    - Consultation phase
    - Form rules + output style
    - Patient vitals + documents
    """
    logger.info("Received request for specialty feature LLM execution")

    payload = await request.json()

    # --------------------------------------------------
    # 1️⃣ STRICT INPUT PARSING
    # --------------------------------------------------
    doctor_speciality = payload.get("doctor_speciality")
    consultation_phase = payload.get("consultation_phase")

    feature_id = payload.get("feature_id")
    feature_name = payload.get("feature_name")

    patient_context = payload.get("patient_context", {})
    vitals = payload.get("vitals", [])
    data_fetched = payload.get("data_fetched", {})
    forms = payload.get("forms", [])

    if not feature_id or not feature_name or not forms:
        raise HTTPException(400, "Invalid specialty feature payload")

    # --------------------------------------------------
    # 2️⃣ GLOBAL SYSTEM PROMPT (NEVER CHANGES)
    # --------------------------------------------------
    SYSTEM_PROMPT = """
You are a senior specialty-specific clinical analysis engine.

You operate under STRICT clinical governance.

GLOBAL SAFETY CONSTRAINTS (MANDATORY):
- Do NOT diagnose diseases
- Do NOT recommend treatments, medications, referrals, or investigations
- Do NOT assess risk, severity, urgency, or probability
- Do NOT predict outcomes
- Do NOT infer missing data
- Do NOT introduce external medical knowledge
- Do NOT contradict provided data

ALLOWED:
- Objective, data-backed clinical observations
- Pattern recognition and correlation ONLY when supported
- Specialty-aligned interpretation
- Clear acknowledgment of data limitations

You must strictly follow:
1) Doctor speciality context
2) Consultation phase intent
3) Feature purpose
4) Form-specific rules and output style
"""

    # --------------------------------------------------
    # 3️⃣ EXECUTE EACH FORM INDEPENDENTLY
    # --------------------------------------------------
    forms_output = []

    for form in forms:
        form_id = form.get("form_id")
        form_name = form.get("form_name")
        rule_text = form.get("rule_text", "")
        rules_selected = form.get("rules_selected", [])
        output_format = form.get("output_format", "Detailed")
        trigger_method = form.get("trigger_method")
        date_filter = form.get("date_filter")

        structured_mode = output_format.lower() in [
            "summary", "problem oriented", "problem-oriented"
        ]

        # --------------------------------------------------
        # 4️⃣ ENHANCED USER PROMPT (CORE INTELLIGENCE)
        # --------------------------------------------------
        USER_PROMPT = f"""
CLINICAL CONTEXT
================
Doctor Speciality: {doctor_speciality}
Consultation Phase: {consultation_phase}

FEATURE CONTEXT
===============
Feature Name: {feature_name}

FORM CONTEXT
============
Form Name: {form_name}

FORM INTENT & RULES
------------------
{rule_text}

Selected Rules:
{json.dumps(rules_selected, indent=2)}

OUTPUT STYLE
------------
{output_format}

TEMPORAL FILTERING
-----------------
{json.dumps(date_filter, indent=2)}

PATIENT CONTEXT
===============
Age: {patient_context.get("age")}
Gender: {patient_context.get("gender")}

VITAL SIGNS (Chronological – latest first)
==========================================
{json.dumps(vitals, indent=2)}

CLINICAL DOCUMENTS
=================
LAB REPORTS:
{json.dumps(data_fetched.get("lab_reports", []), indent=2)}

RADIOLOGY:
{json.dumps(data_fetched.get("radiology", []), indent=2)}

BIOPSY:
{json.dumps(data_fetched.get("biopsy", []), indent=2)}

ANALYSIS INSTRUCTIONS (STRICT)
==============================
- Analyze ONLY data relevant to this FORM
- Apply a {doctor_speciality} specialty lens
- Respect the consultation phase intent
- Correlate vitals with documents ONLY if data supports it
- Identify trends, consistency, and contradictions
- Avoid repeating raw values unless clinically meaningful
- Explicitly state when data is insufficient
- Ignore any embedded AI interpretations inside documents

OUTPUT REQUIREMENTS
===================
{"Return concise, point-wise clinical observations" if structured_mode else
"Return a clear, structured clinical narrative"}

ABSOLUTE RULES
==============
- No diagnosis
- No recommendations
- No future planning
- No assumptions
- No external knowledge
- No extra headings
- Output ONLY the analysis text
"""

        # --------------------------------------------------
        # 5️⃣ PROMPT SAFETY
        # --------------------------------------------------
        detector = PromptInjectionDetector()
        if detector.evaluate(USER_PROMPT)["is_injection"]:
            USER_PROMPT = InputSanitizer().sanitize(USER_PROMPT)["sanitized_input"]

        # --------------------------------------------------
        # 6️⃣ LLM EXECUTION
        # --------------------------------------------------
        response = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": USER_PROMPT}
            ],
            temperature=0.2
        )

        raw_text = response.choices[0].message.content or ""
        analysis_text = clean_llm_text(raw_text)

        logger.info(f"Specialty Feature LLM Output: {analysis_text}")

        # --------------------------------------------------
        # 7️⃣ OPTIONAL SAFETY RULE PASS
        # --------------------------------------------------
        # clinical_safety = await run_clinical_safety_rules_engine(
        #     llm_output_text=analysis_text,
        #     raw_patient_data={"patient_context": patient_context}
        # )

        # logger.info(f"Clinical Safety Output: {clinical_safety}")

        # --------------------------------------------------
        # 8️⃣ COLLECT FORM OUTPUT
        # --------------------------------------------------
        forms_output.append({
            "form_id": form_id,
            "form_name": form_name,
            "trigger_method": trigger_method,
            "output_format": output_format,
            "analysis": analysis_text,
            "clinical_safety": None
        })

    # --------------------------------------------------
    # 9️⃣ FINAL RESPONSE
    # --------------------------------------------------
    return {
        "status": "success",
        "feature_id": feature_id,
        "feature_name": feature_name,
        "consultation_phase": consultation_phase,
        "doctor_speciality": doctor_speciality,
        "forms_output": forms_output
    }


@router.post("/execute-specialty-feature-during")
async def execute_specialty_feature_llm(request: Request):
    """
    Specialty-aware clinical feature execution engine.

    One FEATURE → multiple FORMS
    Each FORM is independently analyzed with:
    - Doctor speciality
    - Consultation phase
    - Form rules + output style
    - Patient vitals + documents
    """
    logger.info("Received request for specialty feature LLM execution")

    payload = await request.json()

    # --------------------------------------------------
    # 1️⃣ STRICT INPUT PARSING
    # --------------------------------------------------
    doctor_speciality = payload.get("doctor_speciality")
    consultation_phase = payload.get("consultation_phase")

    feature_id = payload.get("feature_id")
    feature_name = payload.get("feature_name")

    patient_context = payload.get("patient_context", {})
    vitals = payload.get("vitals", [])
    data_fetched = payload.get("data_fetched", {})
    forms = payload.get("forms", [])

    if not feature_id or not feature_name or not forms:
        raise HTTPException(400, "Invalid specialty feature payload")

    # --------------------------------------------------
    # 2️⃣ GLOBAL SYSTEM PROMPT (NEVER CHANGES)
    # --------------------------------------------------
    SYSTEM_PROMPT = """
You are a senior specialty-specific clinical analysis engine.

You operate under STRICT clinical governance.

GLOBAL SAFETY CONSTRAINTS (MANDATORY):
- Do NOT diagnose diseases
- Do NOT recommend treatments, medications, referrals, or investigations
- Do NOT assess risk, severity, urgency, or probability
- Do NOT predict outcomes
- Do NOT infer missing data
- Do NOT introduce external medical knowledge
- Do NOT contradict provided data

ALLOWED:
- Objective, data-backed clinical observations
- Pattern recognition and correlation ONLY when supported
- Specialty-aligned interpretation
- Clear acknowledgment of data limitations

You must strictly follow:
1) Doctor speciality context
2) Consultation phase intent
3) Feature purpose
4) Form-specific rules and output style
"""

    # --------------------------------------------------
    # 3️⃣ EXECUTE EACH FORM INDEPENDENTLY
    # --------------------------------------------------
    forms_output = []

    for form in forms:
        form_id = form.get("form_id")
        form_name = form.get("form_name")
        rule_text = form.get("rule_text", "")
        rules_selected = form.get("rules_selected", [])
        output_format = form.get("output_format", "Detailed")
        trigger_method = form.get("trigger_method")
        date_filter = form.get("date_filter")

        structured_mode = output_format.lower() in [
            "summary", "problem oriented", "problem-oriented"
        ]

        # --------------------------------------------------
        # 4️⃣ ENHANCED USER PROMPT (CORE INTELLIGENCE)
        # --------------------------------------------------
        USER_PROMPT = f"""
CLINICAL CONTEXT
================
Doctor Speciality: {doctor_speciality}
Consultation Phase: {consultation_phase}

FEATURE CONTEXT
===============
Feature Name: {feature_name}

FORM CONTEXT
============
Form Name: {form_name}

FORM INTENT & RULES
------------------
{rule_text}

Selected Rules:
{json.dumps(rules_selected, indent=2)}

OUTPUT STYLE
------------
{output_format}

TEMPORAL FILTERING
-----------------
{json.dumps(date_filter, indent=2)}

PATIENT CONTEXT
===============
Age: {patient_context.get("age")}
Gender: {patient_context.get("gender")}

VITAL SIGNS (Chronological – latest first)
==========================================
{json.dumps(vitals, indent=2)}

CLINICAL DOCUMENTS
=================
LAB REPORTS:
{json.dumps(data_fetched.get("lab_reports", []), indent=2)}

RADIOLOGY:
{json.dumps(data_fetched.get("radiology", []), indent=2)}

BIOPSY:
{json.dumps(data_fetched.get("biopsy", []), indent=2)}

ANALYSIS INSTRUCTIONS (STRICT)
==============================
- Analyze ONLY data relevant to this FORM
- Apply a {doctor_speciality} specialty lens
- Respect the consultation phase intent
- Correlate vitals with documents ONLY if data supports it
- Identify trends, consistency, and contradictions
- Avoid repeating raw values unless clinically meaningful
- Explicitly state when data is insufficient
- Ignore any embedded AI interpretations inside documents

OUTPUT REQUIREMENTS
===================
{"Return concise, point-wise clinical observations" if structured_mode else
"Return a clear, structured clinical narrative"}

ABSOLUTE RULES
==============
- No diagnosis
- No recommendations
- No future planning
- No assumptions
- No external knowledge
- No extra headings
- Output ONLY the analysis text
"""

        # --------------------------------------------------
        # 5️⃣ PROMPT SAFETY
        # --------------------------------------------------
        detector = PromptInjectionDetector()
        if detector.evaluate(USER_PROMPT)["is_injection"]:
            USER_PROMPT = InputSanitizer().sanitize(USER_PROMPT)["sanitized_input"]

        # --------------------------------------------------
        # 6️⃣ LLM EXECUTION
        # --------------------------------------------------
        response = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": USER_PROMPT}
            ],
            temperature=0.2
        )

        raw_text = response.choices[0].message.content or ""
        analysis_text = clean_llm_text(raw_text)

        logger.info(f"Specialty Feature LLM Output: {analysis_text}")

        # --------------------------------------------------
        # 7️⃣ OPTIONAL SAFETY RULE PASS
        # --------------------------------------------------
        # clinical_safety = await run_clinical_safety_rules_engine(
        #     llm_output_text=analysis_text,
        #     raw_patient_data={"patient_context": patient_context}
        # )

        # logger.info(f"Clinical Safety Output: {clinical_safety}")

        # --------------------------------------------------
        # 8️⃣ COLLECT FORM OUTPUT
        # --------------------------------------------------
        forms_output.append({
            "form_id": form_id,
            "form_name": form_name,
            "trigger_method": trigger_method,
            "output_format": output_format,
            "analysis": analysis_text,
            "clinical_safety": None
        })

    # --------------------------------------------------
    # 9️⃣ FINAL RESPONSE
    # --------------------------------------------------
    return {
        "status": "success",
        "feature_id": feature_id,
        "feature_name": feature_name,
        "consultation_phase": consultation_phase,
        "doctor_speciality": doctor_speciality,
        "forms_output": forms_output
    }



@router.post("/execute-specialty-feature-post")
async def execute_specialty_feature_llm(request: Request):
    """
    Specialty-aware clinical feature execution engine.

    One FEATURE → multiple FORMS
    Each FORM is independently analyzed with:
    - Doctor speciality
    - Consultation phase
    - Form rules + output style
    - Patient vitals + documents
    """
    logger.info("Received request for specialty feature LLM execution")

    payload = await request.json()

    # --------------------------------------------------
    # 1️⃣ STRICT INPUT PARSING
    # --------------------------------------------------
    doctor_speciality = payload.get("doctor_speciality")
    consultation_phase = payload.get("consultation_phase")

    feature_id = payload.get("feature_id")
    feature_name = payload.get("feature_name")

    patient_context = payload.get("patient_context", {})
    vitals = payload.get("vitals", [])
    data_fetched = payload.get("data_fetched", {})
    forms = payload.get("forms", [])

    if not feature_id or not feature_name or not forms:
        raise HTTPException(400, "Invalid specialty feature payload")

    # --------------------------------------------------
    # 2️⃣ GLOBAL SYSTEM PROMPT (NEVER CHANGES)
    # --------------------------------------------------
    SYSTEM_PROMPT = """
You are a senior specialty-specific clinical analysis engine.

You operate under STRICT clinical governance.

GLOBAL SAFETY CONSTRAINTS (MANDATORY):
- Do NOT diagnose diseases
- Do NOT recommend treatments, medications, referrals, or investigations
- Do NOT assess risk, severity, urgency, or probability
- Do NOT predict outcomes
- Do NOT infer missing data
- Do NOT introduce external medical knowledge
- Do NOT contradict provided data

ALLOWED:
- Objective, data-backed clinical observations
- Pattern recognition and correlation ONLY when supported
- Specialty-aligned interpretation
- Clear acknowledgment of data limitations

You must strictly follow:
1) Doctor speciality context
2) Consultation phase intent
3) Feature purpose
4) Form-specific rules and output style
"""

    # --------------------------------------------------
    # 3️⃣ EXECUTE EACH FORM INDEPENDENTLY
    # --------------------------------------------------
    forms_output = []

    for form in forms:
        form_id = form.get("form_id")
        form_name = form.get("form_name")
        rule_text = form.get("rule_text", "")
        rules_selected = form.get("rules_selected", [])
        output_format = form.get("output_format", "Detailed")
        trigger_method = form.get("trigger_method")
        date_filter = form.get("date_filter")

        structured_mode = output_format.lower() in [
            "summary", "problem oriented", "problem-oriented"
        ]

        # --------------------------------------------------
        # 4️⃣ ENHANCED USER PROMPT (CORE INTELLIGENCE)
        # --------------------------------------------------
        USER_PROMPT = f"""
CLINICAL CONTEXT
================
Doctor Speciality: {doctor_speciality}
Consultation Phase: {consultation_phase}

FEATURE CONTEXT
===============
Feature Name: {feature_name}

FORM CONTEXT
============
Form Name: {form_name}

FORM INTENT & RULES
------------------
{rule_text}

Selected Rules:
{json.dumps(rules_selected, indent=2)}

OUTPUT STYLE
------------
{output_format}

TEMPORAL FILTERING
-----------------
{json.dumps(date_filter, indent=2)}

PATIENT CONTEXT
===============
Age: {patient_context.get("age")}
Gender: {patient_context.get("gender")}

VITAL SIGNS (Chronological – latest first)
==========================================
{json.dumps(vitals, indent=2)}

CLINICAL DOCUMENTS
=================
LAB REPORTS:
{json.dumps(data_fetched.get("lab_reports", []), indent=2)}

RADIOLOGY:
{json.dumps(data_fetched.get("radiology", []), indent=2)}

BIOPSY:
{json.dumps(data_fetched.get("biopsy", []), indent=2)}

ANALYSIS INSTRUCTIONS (STRICT)
==============================
- Analyze ONLY data relevant to this FORM
- Apply a {doctor_speciality} specialty lens
- Respect the consultation phase intent
- Correlate vitals with documents ONLY if data supports it
- Identify trends, consistency, and contradictions
- Avoid repeating raw values unless clinically meaningful
- Explicitly state when data is insufficient
- Ignore any embedded AI interpretations inside documents

OUTPUT REQUIREMENTS
===================
{"Return concise, point-wise clinical observations" if structured_mode else
"Return a clear, structured clinical narrative"}

ABSOLUTE RULES
==============
- No diagnosis
- No recommendations
- No future planning
- No assumptions
- No external knowledge
- No extra headings
- Output ONLY the analysis text
"""

        # --------------------------------------------------
        # 5️⃣ PROMPT SAFETY
        # --------------------------------------------------
        detector = PromptInjectionDetector()
        if detector.evaluate(USER_PROMPT)["is_injection"]:
            USER_PROMPT = InputSanitizer().sanitize(USER_PROMPT)["sanitized_input"]

        # --------------------------------------------------
        # 6️⃣ LLM EXECUTION
        # --------------------------------------------------
        response = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": USER_PROMPT}
            ],
            temperature=0.2
        )

        raw_text = response.choices[0].message.content or ""
        analysis_text = clean_llm_text(raw_text)

        logger.info(f"Specialty Feature LLM Output: {analysis_text}")

        # --------------------------------------------------
        # 7️⃣ OPTIONAL SAFETY RULE PASS
        # --------------------------------------------------
        # clinical_safety = await run_clinical_safety_rules_engine(
        #     llm_output_text=analysis_text,
        #     raw_patient_data={"patient_context": patient_context}
        # )

        # logger.info(f"Clinical Safety Output: {clinical_safety}")

        # --------------------------------------------------
        # 8️⃣ COLLECT FORM OUTPUT
        # --------------------------------------------------
        forms_output.append({
            "form_id": form_id,
            "form_name": form_name,
            "trigger_method": trigger_method,
            "output_format": output_format,
            "analysis": analysis_text,
            "clinical_safety": None
        })

    # --------------------------------------------------
    # 9️⃣ FINAL RESPONSE
    # --------------------------------------------------
    return {
        "status": "success",
        "feature_id": feature_id,
        "feature_name": feature_name,
        "consultation_phase": consultation_phase,
        "doctor_speciality": doctor_speciality,
        "forms_output": forms_output
    }
