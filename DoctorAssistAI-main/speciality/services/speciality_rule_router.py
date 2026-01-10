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
from typing import Optional, Literal
from pydantic import BaseModel



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
#PRE


@router.post("/pre-save-clinical-configuration")
async def save_clinical_configuration(payload: dict):

    # rules_collection: Collection = rules_database["rules_settings"]

    # -----------------------------
    # REQUIRED FIELDS
    # -----------------------------
    doctor_id = payload.get("doctor_id")
    doctor_name = payload.get("doctor_name")
    doctor_speciality = payload.get("doctor_speciality")
    feature_id = payload.get("feature_id")
    form_id = payload.get("form_id")
    consultation_phase = payload.get("consultation_phase")
        # ✅ NEW SUMMARY FIELDS
    enabled_feature_count = payload.get("enabled_feature_count", 0)
    enabled_form_count = payload.get("enabled_form_count", 0)
    enabled_features = payload.get("enabled_features", [])

    if not doctor_id or not feature_id or not form_id or not consultation_phase:
        raise HTTPException(status_code=400, detail="doctor_id, feature_id, form_id are required")

    rules_selected = payload.get("rules_selected", [])

    # -----------------------------
    # FIND EXISTING CONFIG
    # -----------------------------
    query = {
        "doctor_id": doctor_id,
        "feature_id": feature_id,
        "form_id": form_id,
        "consultation_phase": consultation_phase,  # ✅ NEW
    }

    existing_doc = await rules_collection.find_one(query)

    now = datetime.utcnow()

    # -----------------------------
    # FIRST TIME → INSERT
    # -----------------------------
    if not existing_doc:
        payload["enabled_feature_count"] = enabled_feature_count
        payload["enabled_form_count"] = enabled_form_count
        payload["enabled_features"] = enabled_features
        payload["created_at"] = now
        payload["updated_at"] = now

        await rules_collection.insert_one(payload)

        return {
            "status": "created",
            "message": "Configuration created successfully"
        }

    # -----------------------------
    # EXISTING → APPEND RULES
    # -----------------------------
    existing_rules = existing_doc.get("rules_selected", [])

    existing_rule_ids = {r["ruleId"] for r in existing_rules}

    # only add new rules
    new_rules = [
        rule for rule in rules_selected
        if rule["ruleId"] not in existing_rule_ids
    ]

    update_fields = {
        "updated_at": now,
        "doctor_name": doctor_name,
        "doctor_speciality": doctor_speciality,
        "feature_name": payload.get("feature_name"),
        "form_name": payload.get("form_name"),
        "trigger_method": payload.get("trigger_method"),
        "button_label": payload.get("button_label"),
        "output_format": payload.get("output_format"),
        "date_filter": payload.get("date_filter"),
        "rule_text": payload.get("rule_text"),


             # ✅ SAVE SUMMARY DATA
        "enabled_feature_count": enabled_feature_count,
        "enabled_form_count": enabled_form_count,
        "enabled_features": enabled_features,
        "action_mode": payload.get("action_mode"),
        "through": payload.get("through")
    }

    update_query = {
        "$set": update_fields
    }

    if new_rules:
        update_query["$push"] = {
            "rules_selected": {"$each": new_rules}
        }

    await rules_collection.update_one(query, update_query)

    return {
        "status": "updated",
        "added_rules": len(new_rules),
        "message": "Configuration updated successfully"
    }



@router.get("/pre-get-clinical-configuration/{doctor_id}")
async def get_clinical_configuration(doctor_id: str, consultation_phase: str):

    query = {"doctor_id": doctor_id, "consultation_phase": consultation_phase}

    configs = await rules_collection.find(query).to_list(length=None)

    if not configs:
        raise HTTPException(
            status_code=404,
            detail="No clinical configuration found for this doctor"
        )

    # Clean Mongo ObjectId for frontend
    def clean_doc(doc):
        doc["_id"] = str(doc["_id"])
        return doc

    configs = [clean_doc(doc) for doc in configs]

    return {
        "status": "success",
        "doctor_id": doctor_id,
        "consultation_phase": consultation_phase,
        "total_configs": len(configs),
        "data": configs
    }



@router.get("/pre-get-clinical-configuration")
async def get_clinical_configuration_filtered(
    doctor_id: str,
    consultation_phase: str,
    feature_id: str | None = None,
    form_id: str | None = None
):

    if not doctor_id:
        raise HTTPException(status_code=400, detail="doctor_id is required")

    query = {"doctor_id": doctor_id , "consultation_phase": consultation_phase}

    if feature_id:
        query["feature_id"] = feature_id

    if form_id:
        query["form_id"] = form_id

    configs = await rules_collection.find(query).to_list(length=None)

    if not configs:
        return {
            "status": "success",
            "data": [],
            "message": "No matching configuration found"
        }

    for doc in configs:
        doc["_id"] = str(doc["_id"])

    return {
        "status": "success",
        "count": len(configs),
        "data": configs
    }







# DURING


@router.post("/during-save-clinical-configuration")
async def save_clinical_configuration(payload: dict):

    # rules_collection: Collection = rules_database["rules_settings"]

    # -----------------------------
    # REQUIRED FIELDS
    # -----------------------------
    doctor_id = payload.get("doctor_id")
    doctor_name = payload.get("doctor_name")
    doctor_speciality = payload.get("doctor_speciality")
    feature_id = payload.get("feature_id")
    form_id = payload.get("form_id")
    consultation_phase = payload.get("consultation_phase")
        # ✅ NEW SUMMARY FIELDS
    enabled_feature_count = payload.get("enabled_feature_count", 0)
    enabled_form_count = payload.get("enabled_form_count", 0)
    enabled_features = payload.get("enabled_features", [])

    if not doctor_id or not feature_id or not form_id or not consultation_phase:
        raise HTTPException(status_code=400, detail="doctor_id, feature_id, form_id are required")

    rules_selected = payload.get("rules_selected", [])

    # -----------------------------
    # FIND EXISTING CONFIG
    # -----------------------------
    query = {
        "doctor_id": doctor_id,
        "feature_id": feature_id,
        "form_id": form_id,
        "consultation_phase": consultation_phase,  # ✅ NEW
    }

    existing_doc = await rules_collection.find_one(query)

    now = datetime.utcnow()

    # -----------------------------
    # FIRST TIME → INSERT
    # -----------------------------
    if not existing_doc:
        payload["enabled_feature_count"] = enabled_feature_count
        payload["enabled_form_count"] = enabled_form_count
        payload["enabled_features"] = enabled_features
        payload["created_at"] = now
        payload["updated_at"] = now

        await rules_collection.insert_one(payload)

        return {
            "status": "created",
            "message": "Configuration created successfully"
        }

    # -----------------------------
    # EXISTING → APPEND RULES
    # -----------------------------
    existing_rules = existing_doc.get("rules_selected", [])

    existing_rule_ids = {r["ruleId"] for r in existing_rules}

    # only add new rules
    new_rules = [
        rule for rule in rules_selected
        if rule["ruleId"] not in existing_rule_ids
    ]

    update_fields = {
        "updated_at": now,
        "doctor_name": doctor_name,
        "doctor_speciality": doctor_speciality,
        "feature_name": payload.get("feature_name"),
        "form_name": payload.get("form_name"),
        "trigger_method": payload.get("trigger_method"),
        "button_label": payload.get("button_label"),
        "output_format": payload.get("output_format"),
        "date_filter": payload.get("date_filter"),
        "rule_text": payload.get("rule_text"),


               # ✅ SAVE SUMMARY DATA
        "enabled_feature_count": enabled_feature_count,
        "enabled_form_count": enabled_form_count,
        "enabled_features": enabled_features,
        "action_mode": payload.get("action_mode"),
        "through": payload.get("through")
    }

    update_query = {
        "$set": update_fields
    }

    if new_rules:
        update_query["$push"] = {
            "rules_selected": {"$each": new_rules}
        }

    await rules_collection.update_one(query, update_query)

    return {
        "status": "updated",
        "added_rules": len(new_rules),
        "message": "Configuration updated successfully"
    }



@router.get("/during-get-clinical-configuration/{doctor_id}")
async def get_clinical_configuration(doctor_id: str, consultation_phase: str):

    query = {"doctor_id": doctor_id, "consultation_phase": consultation_phase}

    configs = await rules_collection.find(query).to_list(length=None)

    if not configs:
        raise HTTPException(
            status_code=404,
            detail="No clinical configuration found for this doctor"
        )

    # Clean Mongo ObjectId for frontend
    def clean_doc(doc):
        doc["_id"] = str(doc["_id"])
        return doc

    configs = [clean_doc(doc) for doc in configs]

    return {
        "status": "success",
        "doctor_id": doctor_id,
        "consultation_phase": consultation_phase,
        "total_configs": len(configs),
        "data": configs
    }



@router.get("/during-get-clinical-configuration")
async def get_clinical_configuration_filtered(
    doctor_id: str,
    consultation_phase: str,
    feature_id: str | None = None,
    form_id: str | None = None
):

    if not doctor_id:
        raise HTTPException(status_code=400, detail="doctor_id is required")

    query = {"doctor_id": doctor_id , "consultation_phase": consultation_phase}

    if feature_id:
        query["feature_id"] = feature_id

    if form_id:
        query["form_id"] = form_id

    configs = await rules_collection.find(query).to_list(length=None)

    if not configs:
        return {
            "status": "success",
            "data": [],
            "message": "No matching configuration found"
        }

    for doc in configs:
        doc["_id"] = str(doc["_id"])

    return {
        "status": "success",
        "count": len(configs),
        "data": configs
    }



#POST


@router.post("/post-save-clinical-configuration")
async def save_clinical_configuration(payload: dict):

    # rules_collection: Collection = rules_database["rules_settings"]

    # -----------------------------
    # REQUIRED FIELDS
    # -----------------------------
    doctor_id = payload.get("doctor_id")
    doctor_name = payload.get("doctor_name")
    doctor_speciality = payload.get("doctor_speciality")
    feature_id = payload.get("feature_id")
    form_id = payload.get("form_id")
    consultation_phase = payload.get("consultation_phase")
        # ✅ NEW SUMMARY FIELDS
    enabled_feature_count = payload.get("enabled_feature_count", 0)
    enabled_form_count = payload.get("enabled_form_count", 0)
    enabled_features = payload.get("enabled_features", [])

    if not doctor_id or not feature_id or not form_id or not consultation_phase:
        raise HTTPException(status_code=400, detail="doctor_id, feature_id, form_id are required")

    rules_selected = payload.get("rules_selected", [])

    # -----------------------------
    # FIND EXISTING CONFIG
    # -----------------------------
    query = {
        "doctor_id": doctor_id,
        "feature_id": feature_id,
        "form_id": form_id,
        "consultation_phase": consultation_phase,  # ✅ NEW
    }

    existing_doc = await rules_collection.find_one(query)

    now = datetime.utcnow()

    # -----------------------------
    # FIRST TIME → INSERT
    # -----------------------------
    if not existing_doc:
        payload["enabled_feature_count"] = enabled_feature_count
        payload["enabled_form_count"] = enabled_form_count
        payload["enabled_features"] = enabled_features
        payload["created_at"] = now
        payload["updated_at"] = now

        await rules_collection.insert_one(payload)

        return {
            "status": "created",
            "message": "Configuration created successfully"
        }

    # -----------------------------
    # EXISTING → APPEND RULES
    # -----------------------------
    existing_rules = existing_doc.get("rules_selected", [])

    existing_rule_ids = {r["ruleId"] for r in existing_rules}

    # only add new rules
    new_rules = [
        rule for rule in rules_selected
        if rule["ruleId"] not in existing_rule_ids
    ]

    update_fields = {
        "updated_at": now,
        "doctor_name": doctor_name,
        "doctor_speciality": doctor_speciality,
        "feature_name": payload.get("feature_name"),
        "form_name": payload.get("form_name"),
        "trigger_method": payload.get("trigger_method"),
        "button_label": payload.get("button_label"),
        "output_format": payload.get("output_format"),
        "date_filter": payload.get("date_filter"),
        "rule_text": payload.get("rule_text"),
             # ✅ SAVE SUMMARY DATA
        "enabled_feature_count": enabled_feature_count,
        "enabled_form_count": enabled_form_count,
        "enabled_features": enabled_features,
        "action_mode": payload.get("action_mode"),
        "through": payload.get("through")
    }

    update_query = {
        "$set": update_fields
    }

    if new_rules:
        update_query["$push"] = {
            "rules_selected": {"$each": new_rules}
        }

    await rules_collection.update_one(query, update_query)

    return {
        "status": "updated",
        "added_rules": len(new_rules),
        "message": "Configuration updated successfully"
    }



@router.get("/post-get-clinical-configuration/{doctor_id}")
async def get_clinical_configuration(doctor_id: str, consultation_phase: str):

    query = {"doctor_id": doctor_id, "consultation_phase": consultation_phase}

    configs = await rules_collection.find(query).to_list(length=None)

    if not configs:
        raise HTTPException(
            status_code=404,
            detail="No clinical configuration found for this doctor"
        )

    # Clean Mongo ObjectId for frontend
    def clean_doc(doc):
        doc["_id"] = str(doc["_id"])
        return doc

    configs = [clean_doc(doc) for doc in configs]

    return {
        "status": "success",
        "doctor_id": doctor_id,
        "consultation_phase": consultation_phase,
        "total_configs": len(configs),
        "data": configs
    }



@router.get("/post-get-clinical-configuration")
async def get_clinical_configuration_filtered(
    doctor_id: str,
    consultation_phase: str,
    feature_id: str | None = None,
    form_id: str | None = None
):

    if not doctor_id:
        raise HTTPException(status_code=400, detail="doctor_id is required")

    query = {"doctor_id": doctor_id , "consultation_phase": consultation_phase}

    if feature_id:
        query["feature_id"] = feature_id

    if form_id:
        query["form_id"] = form_id

    configs = await rules_collection.find(query).to_list(length=None)

    if not configs:
        return {
            "status": "success",
            "data": [],
            "message": "No matching configuration found"
        }

    for doc in configs:
        doc["_id"] = str(doc["_id"])

    return {
        "status": "success",
        "count": len(configs),
        "data": configs
    }




##26-12-2025



@router.post("/get-pre-rule-suggestions")
async def rule_suggestion_engine(request: Request):
    """
    AI Rule Suggestion Engine (Speciality-Aware)

    Input:
    - doctor_id
    - doctor_speciality
    - consultation_phase
    - feature_name
    - form_name

    Output:
    - 8 intelligent clinical rules tailored to the feature + form context
    """

    try:
        payload = await request.json()

        doctor_id = payload.get("doctor_id")
        speciality = payload.get("doctor_speciality")
        consultation_phase = payload.get("consultation_phase")
        feature_name = payload.get("feature_name")
        form_name = payload.get("form_name")

        if not all([doctor_id, speciality, consultation_phase, feature_name, form_name]):
            raise ValueError("Missing required rule generation inputs")

        logger.info(
            "Rule Engine Triggered | %s | %s | %s | %s",
            speciality, consultation_phase, feature_name, form_name
        )

        # -------------------------------
        # LLM PROMPT (RULE GENERATION)
        # -------------------------------
        prompt = f"""
You are an AI Clinical Intelligence Engine for {speciality}.

Your task is to generate **exactly 8 intelligent clinical rules**
for the following context:

- Consultation Phase: {consultation_phase}
- Feature: {feature_name}
- Form: {form_name}

Purpose of rules:
- Help doctors identify risks, correlations, alerts, gaps, or insights
- Assist clinical reasoning BEFORE consultation
- Be concise, actionable, and speciality-specific

Rule Characteristics:
- Focus on vitals, chief complaint, labs, medications, history, or documents
- Highlight correlations, missing data, safety concerns, or screening insights
- Avoid generic statements
- Phrase rules as decision-support logic (not explanations)

---

### OUTPUT FORMAT (STRICT JSON ONLY)

{{
  "rules": [
    {{ "rule_text": "One concise actionable clinical rule" }}
  ]
}}

Rules:
- Generate EXACTLY 8 rules
- No commentary outside JSON
- No numbering outside JSON
"""

        # -------------------------------
        # CALL LLM
        # -------------------------------
        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            response_format={"type": "json_object"},
            max_tokens=2500
        )

        llm_response = completion.choices[0].message.content
        rule_output = json.loads(llm_response)

        rules = rule_output.get("rules", [])

        if not isinstance(rules, list) or len(rules) != 8:
            raise ValueError("LLM did not return exactly 8 rules")

        # -------------------------------
        # FINAL RESPONSE
        # -------------------------------
        return {
            "status": "success",
            "doctor_speciality": speciality,
            "consultation_phase": consultation_phase,
            "feature_name": feature_name,
            "form_name": form_name,
            "rules": rules,
            "metadata": {
                "generated_at": datetime.utcnow().isoformat(),
                "engine": "AI Rule Suggestion Engine"
            }
        }

    except Exception as e:
        logger.exception("Rule generation failed")
        raise HTTPException(
            status_code=500,
            detail=f"Rule suggestion generation failed: {str(e)}"
        )



@router.post("/get-during-rule-suggestions")
async def rule_suggestion_engine(request: Request):
    """
    AI Rule Suggestion Engine (Speciality-Aware)

    Input:
    - doctor_id
    - doctor_speciality
    - consultation_phase
    - feature_name
    - form_name

    Output:
    - 8 intelligent clinical rules tailored to the feature + form context
    """

    try:
        payload = await request.json()

        doctor_id = payload.get("doctor_id")
        speciality = payload.get("doctor_speciality")
        consultation_phase = payload.get("consultation_phase")
        feature_name = payload.get("feature_name")
        form_name = payload.get("form_name")

        if not all([doctor_id, speciality, consultation_phase, feature_name, form_name]):
            raise ValueError("Missing required rule generation inputs")

        logger.info(
            "Rule Engine Triggered | %s | %s | %s | %s",
            speciality, consultation_phase, feature_name, form_name
        )

        # -------------------------------
        # LLM PROMPT (RULE GENERATION)
        # -------------------------------
        prompt = f"""
You are an AI Clinical Intelligence Engine for {speciality}.

Your task is to generate **exactly 8 intelligent clinical rules**
for the following context:

- Consultation Phase: {consultation_phase}
- Feature: {feature_name}
- Form: {form_name}

Purpose of rules:
- Help doctors identify risks, correlations, alerts, gaps, or insights
- Assist clinical reasoning BEFORE consultation
- Be concise, actionable, and speciality-specific

Rule Characteristics:
- Focus on vitals, chief complaint, labs, medications, history, or documents
- Highlight correlations, missing data, safety concerns, or screening insights
- Avoid generic statements
- Phrase rules as decision-support logic (not explanations)

---

### OUTPUT FORMAT (STRICT JSON ONLY)

{{
  "rules": [
    {{ "rule_text": "One concise actionable clinical rule" }}
  ]
}}

Rules:
- Generate EXACTLY 8 rules
- No commentary outside JSON
- No numbering outside JSON
"""

        # -------------------------------
        # CALL LLM
        # -------------------------------
        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            response_format={"type": "json_object"},
            max_tokens=2500
        )

        llm_response = completion.choices[0].message.content
        rule_output = json.loads(llm_response)

        rules = rule_output.get("rules", [])

        if not isinstance(rules, list) or len(rules) != 8:
            raise ValueError("LLM did not return exactly 8 rules")

        # -------------------------------
        # FINAL RESPONSE
        # -------------------------------
        return {
            "status": "success",
            "doctor_speciality": speciality,
            "consultation_phase": consultation_phase,
            "feature_name": feature_name,
            "form_name": form_name,
            "rules": rules,
            "metadata": {
                "generated_at": datetime.utcnow().isoformat(),
                "engine": "AI Rule Suggestion Engine"
            }
        }

    except Exception as e:
        logger.exception("Rule generation failed")
        raise HTTPException(
            status_code=500,
            detail=f"Rule suggestion generation failed: {str(e)}"
        )



@router.post("/get-post-rule-suggestions")
async def rule_suggestion_engine(request: Request):
    """
    AI Rule Suggestion Engine (Speciality-Aware)

    Input:
    - doctor_id
    - doctor_speciality
    - consultation_phase
    - feature_name
    - form_name

    Output:
    - 8 intelligent clinical rules tailored to the feature + form context
    """

    try:
        payload = await request.json()

        doctor_id = payload.get("doctor_id")
        speciality = payload.get("doctor_speciality")
        consultation_phase = payload.get("consultation_phase")
        feature_name = payload.get("feature_name")
        form_name = payload.get("form_name")

        if not all([doctor_id, speciality, consultation_phase, feature_name, form_name]):
            raise ValueError("Missing required rule generation inputs")

        logger.info(
            "Rule Engine Triggered | %s | %s | %s | %s",
            speciality, consultation_phase, feature_name, form_name
        )

        # -------------------------------
        # LLM PROMPT (RULE GENERATION)
        # -------------------------------
        prompt = f"""
You are an AI Clinical Intelligence Engine for {speciality}.

Your task is to generate **exactly 8 intelligent clinical rules**
for the following context:

- Consultation Phase: {consultation_phase}
- Feature: {feature_name}
- Form: {form_name}

Purpose of rules:
- Help doctors identify risks, correlations, alerts, gaps, or insights
- Assist clinical reasoning BEFORE consultation
- Be concise, actionable, and speciality-specific

Rule Characteristics:
- Focus on vitals, chief complaint, labs, medications, history, or documents
- Highlight correlations, missing data, safety concerns, or screening insights
- Avoid generic statements
- Phrase rules as decision-support logic (not explanations)

---

### OUTPUT FORMAT (STRICT JSON ONLY)

{{
  "rules": [
    {{ "rule_text": "One concise actionable clinical rule" }}
  ]
}}

Rules:
- Generate EXACTLY 8 rules
- No commentary outside JSON
- No numbering outside JSON
"""

        # -------------------------------
        # CALL LLM
        # -------------------------------
        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            response_format={"type": "json_object"},
            max_tokens=2500
        )

        llm_response = completion.choices[0].message.content
        rule_output = json.loads(llm_response)

        rules = rule_output.get("rules", [])

        if not isinstance(rules, list) or len(rules) != 8:
            raise ValueError("LLM did not return exactly 8 rules")

        # -------------------------------
        # FINAL RESPONSE
        # -------------------------------
        return {
            "status": "success",
            "doctor_speciality": speciality,
            "consultation_phase": consultation_phase,
            "feature_name": feature_name,
            "form_name": form_name,
            "rules": rules,
            "metadata": {
                "generated_at": datetime.utcnow().isoformat(),
                "engine": "AI Rule Suggestion Engine"
            }
        }

    except Exception as e:
        logger.exception("Rule generation failed")
        raise HTTPException(
            status_code=500,
            detail=f"Rule suggestion generation failed: {str(e)}"
        )



@router.post("/users/patient/get_doctor_details")
async def get_doctor_details(request: Request):
    """
    Returns doctor name and speciality for patient app
    """
    try:
        data = await request.json()
        doctor_id = data.get("doctor_id")
        logger.info(f"Fetching details for doctor_id: {doctor_id}")
        if not doctor_id:
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": "doctor_id is required"}
            )

        doctor = doctor_user_collection.find_one(
            {"sys_user_id": doctor_id},
            {"_id": 0, "name": 1, "specialization": 1}
        )
        
        if not doctor:
            return JSONResponse(
                status_code=404,
                content={"status": "error", "message": "Doctor not found"}
            )

        return {
            "status": "success",
            "doctor_name": doctor.get("name", ""),
            "doctor_speciality": doctor.get("specialization", "")
        }

    except Exception as e:
        logger.exception("Get doctor details failed: %s", str(e))
        raise HTTPException(status_code=500, detail="Internal Server Error")


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


async def get_doctor_details_internal(doctor_id: str) -> dict:
    """
    Internal helper to fetch doctor name & speciality
    """
    if not doctor_id:
        raise HTTPException(status_code=400, detail="doctor_id is required")

    doctor = doctor_user_collection.find_one(
        {"sys_user_id": doctor_id},
        {"_id": 0, "name": 1, "specialization": 1}
    )

    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")

    return {
        "doctor_name": doctor.get("name", ""),
        "doctor_speciality": doctor.get("specialization", "")
    }


class SpecialtyFeatureExecutionRequest(BaseModel):
    patient_id: str
    doctor_id: str
    feature_id: str
    form_id: str       # 👈 NEW
    consultation_phase: Literal[
        "PRE_CONSULTATION",
        "DURING_CONSULTATION",
        "POST_CONSULTATION"
    ]

@router.post("/execute-specialty-feature-db")
async def execute_specialty_feature_db(
    request: SpecialtyFeatureExecutionRequest
):
    patient_id = request.patient_id
    doctor_id = request.doctor_id
    feature_id = request.feature_id
    form_id = request.form_id
    consultation_phase = request.consultation_phase

    # ----------------------------------
    # Fetch patient basic info
    # ----------------------------------
    patient =  patient_user_collection.find_one(
        {"sys_user_id": patient_id},
        {"_id": 0, "date_of_birth": 1, "gender": 1, "patient_id": 1, "name": 1}
    )

    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    age = calculate_age(patient.get("date_of_birth"))
    gender = patient.get("gender")

    logger.info(f"Patient {patient_id} | Age: {age} | Gender: {gender}")

    # ----------------------------------
    # Fetch doctor info
    # ----------------------------------
    # doctor = doctor_user_collection.find_one(
    #     {"doctor_id": doctor_id},
    #     {"_id": 0, "doctor_name": 1, "doctor_speciality": 1}
    # )
    # logger.info(f"Fetched doctor info for doctor_id: {doctor_id}")
    # logger.info(f"Doctor Info: {doctor}")

    # if not doctor:
    #     raise HTTPException(status_code=404, detail="Doctor not found")

    # ----------------------------------
    # Fetch doctor info (REUSED LOGIC)
    # ----------------------------------
    doctor_details = await get_doctor_details_internal(doctor_id)

    logger.info(
        f"Doctor fetched | Name: {doctor_details['doctor_name']} | "
        f"Speciality: {doctor_details['doctor_speciality']}"
    )


    # ----------------------------------
    # Fetch specialty configs (rules_settings)
    # ----------------------------------
    query = {
        "doctor_id": doctor_id,
        "feature_id": feature_id,
        "form_id": form_id,
        "consultation_phase": consultation_phase
    }

    # if form_id:
    #     # 🔥 tolerant matching (old + new configs)
    #     query["$or"] = [
    #         {"form_id": form_id},
    #         {"form_id": {"$exists": False}},
    #         {"form_id": None}
    #     ]

    logger.info(f"Rules query: {query}")

    cursor = rules_collection.find(query, {"_id": 0})
    configs = await cursor.to_list(length=None)

    if not configs:
        raise HTTPException(
            status_code=404,
            detail="No configurations found for this feature / form"
        )

    logger.info(f"Matched {len(configs)} rule configurations")

    # # ----------------------------------
    # # Fetch latest vitals
    # # ----------------------------------
    # vitals_doc = await patient_vitals_collection.find_one(
    #     {"sys_user_id": patient_id},
    #     {"_id": 0}
    # )

    # vitals_list = []
    # if vitals_doc and "vitals" in vitals_doc:
    #     vitals_list = sorted(
    #         [
    #             {"recorded_at": ts, **values}
    #             for ts, values in vitals_doc["vitals"].items()
    #         ],
    #         key=lambda x: x.get("recorded_at", ""),
    #         reverse=True
    #     )[:5]

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
    data_fetched = {
        "lab_reports": lab_reports,
        "radiology": radiology,
        "biopsy": biopsy
    }

    logger.info(f"Fetched documents for patient_id: {patient_id}")
    logger.info(f"Lab Reports: {len(lab_reports)}, Radiology: {len(radiology)}, Biopsy: {len(biopsy)}")

    # ----------------------------------
    # Build execution payload
    # ----------------------------------
    execution_payload = {
        "doctor_id": doctor_id,
        "doctor_name": doctor_details["doctor_name"],
        "doctor_speciality": doctor_details["doctor_speciality"],

        "patient_id": patient_id,
        "patient_context": {
            "age": age,
            "gender": gender
        },
        "consultation_phase": consultation_phase,
        "feature_id": feature_id,
        "feature_name": configs[0].get("feature_name"),
        "forms": [],
        "vitals": vitals_list,
        "data_fetched": data_fetched
    }

    logger.info(f"Built execution payload for feature_id: {feature_id}")
    logger.info(f"Number of form configurations: {len(configs)}")
    logger.info(f"full payload: {execution_payload}")

    # ----------------------------------
    # Attach form configurations
    # ----------------------------------
    for cfg in configs:
        execution_payload["forms"].append({
            "form_id": cfg.get("form_id"),
            "form_name": cfg.get("form_name"),
            "rules_selected": cfg.get("rules_selected", []),
            "rule_text": cfg.get("rule_text"),
            "trigger_method": cfg.get("trigger_method"),
            "button_label": cfg.get("button_label"),
            "output_format": cfg.get("output_format"),
            "date_filter": cfg.get("date_filter"),
            "action_mode": cfg.get("action_mode"),
            "through": cfg.get("through"),
            "created_at": cfg.get("created_at"),
            "updated_at": cfg.get("updated_at")
        })

    logger.info(f"full payload: {execution_payload}")

    # ----------------------------------
    # Send to AI engine
    # ----------------------------------
    phase_to_ai_url = {
        "PRE_CONSULTATION": "http://ai_service:8000/execute-specialty-feature-pre",
        "DURING_CONSULTATION": "http://ai_service:8000/execute-specialty-feature-during",
        "POST_CONSULTATION": "http://ai_service:8000/execute-specialty-feature-post",
    }
    ANALYSIS_URL = phase_to_ai_url.get(consultation_phase)
    logger.info(f"Sending execution payload to AI engine at: {ANALYSIS_URL}")

    if not ANALYSIS_URL:
        raise HTTPException(status_code=400, detail="Invalid consultation phase")

    async with httpx.AsyncClient(timeout=60) as client:
        safe_payload = sanitize_for_json(execution_payload)
        response = await client.post(ANALYSIS_URL, json=safe_payload)

    if response.status_code != 200:
        raise HTTPException(
            status_code=500,
            detail="Specialty analysis engine failed"
        )

    analysis_result = response.json()

    # ----------------------------------
    # Final response
    # ----------------------------------
    return {
        "status": "success",
        "consultation_phase": consultation_phase,
        "feature_id": feature_id,
        "feature_name": execution_payload["feature_name"],
        "form_id": form_id,               # 👈 explicitly returned
        "analysis_result": analysis_result,
        "execution_payload": execution_payload
    }




@router.get("/get-clinical-configuration/{doctor_id}")
async def get_clinical_configuration(
    doctor_id: str,
    consultation_phase: Optional[str] = None,  # pre | during | post | None
    feature_id: Optional[str] = None,
    form_id: Optional[str] = None
):
    if not doctor_id:
        raise HTTPException(status_code=400, detail="doctor_id is required")

    # Base query
    query = {"doctor_id": doctor_id}

    # Optional filters
    if consultation_phase:
        query["consultation_phase"] = consultation_phase

    if feature_id:
        query["feature_id"] = feature_id

    if form_id:
        query["form_id"] = form_id

    configs = await rules_collection.find(query).to_list(length=None)

    if not configs:
        return {
            "status": "success",
            "doctor_id": doctor_id,
            "count": 0,
            "data": [],
            "message": "No clinical configuration found"
        }

    # Clean Mongo ObjectId
    for doc in configs:
        doc["_id"] = str(doc["_id"])

    return {
        "status": "success",
        "doctor_id": doctor_id,
        "consultation_phase": consultation_phase or "ALL",
        "count": len(configs),
        "data": configs
    }