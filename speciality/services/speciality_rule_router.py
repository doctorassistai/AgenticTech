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
import chromadb
from rank_bm25 import BM25Okapi




SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
ACCESS_TOKEN_EXPIRE_DAYS = os.getenv("ACCESS_TOKEN_EXPIRE_DAYS")

api_key = os.getenv("GROQ_API_KEY")

groq_client = Groq(api_key=api_key)

import pathlib

_CHROMA_DIR = pathlib.Path(__file__).resolve().parent / "patient_rag"
_CHROMA_DIR.mkdir(parents=True, exist_ok=True)

chroma_client = chromadb.PersistentClient(
    path=str(_CHROMA_DIR)
)


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
patient_images_collection = database["patient_images"]
client = MongoClient(MONGO_URI)  # sync (PyMongo)
db = client[MONGO_DB]

rules_database = mongodb_client[RULE_DB]        # async nodes db
rules_db = client[RULE_DB]                 # sync nodes db

rules_collection = rules_database["rules_settings"]

doctor_user_collection = db["doctor_users"]

patient_user_collection = db["patient_users"]

patient_vitals_collection = database["patient_vitals"]
#PRE
temp_documents_collection = database["temp_documents"]

processed_documents_collection = database["processed_documents"]

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

    # Clean Mongo ObjectId for fronte
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
            model="openai/gpt-oss-20b",
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
            model="openai/gpt-oss-20b",
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
            model="openai/gpt-oss-20b",
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
            {"_id": 0, "name": 1, "specialization": 1,"hospital_id": 1}
        )
        
        if not doctor:
            return JSONResponse(
                status_code=404,
                content={"status": "error", "message": "Doctor not found"}
            )

        return {
            "status": "success",
            "doctor_name": doctor.get("name", ""),
            "doctor_speciality": doctor.get("specialization", ""),
            "hospital_id": doctor.get("hospital_id")   # ✅ SAFE
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


from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import Optional
from datetime import datetime
from llama_cloud import LlamaCloud
import requests
import tempfile
import os



STORAGE_BASE_URL = "https://doctorassist.ai/uploads"

# ------------------------------------------------------------
# HANDWRITTEN OCR ENDPOINT
# ------------------------------------------------------------
import os
import re
import base64
import tempfile
import requests
from typing import List, Dict, Optional
from datetime import datetime

from fastapi import APIRouter, Form, File, UploadFile, HTTPException
from pdf2image import convert_from_bytes
from loguru import logger



# ------------------- CONFIG -------------------

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

if not OPENROUTER_API_KEY:
    raise RuntimeError("OPENROUTER_API_KEY is not configured")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "openai/gpt-4o")

# GPT-4o supports up to 10 images per message; we batch in groups
# of VISION_BATCH_SIZE and concatenate the transcriptions.
VISION_BATCH_SIZE = int(os.getenv("VISION_BATCH_SIZE", "8"))

# DPI used when rasterising PDF pages for the vision model.
VISION_DPI = int(os.getenv("VISION_DPI", "200"))


# =====================================================================
# STAGE 1 PROMPT — RAW, LITERAL TRANSCRIPTION VIA GPT-4o VISION
# =====================================================================
STAGE1_TRANSCRIPTION_PROMPT = """You are a meticulous medical document transcription engine.
You are processing one or more page images from a medical document.

VISUAL CONTENT — IGNORE COMPLETELY
Ignore ALL decorative and non-clinical visual elements. Do NOT describe, mention, or transcribe:
  - Hospital / clinic / lab logos and branding graphics
  - Page borders, ruled lines, box outlines, and background patterns
  - Watermarks (including "CONFIDENTIAL", "COPY", institution watermarks)
  - Background graphics, colour fills, and decorative artwork
  - QR codes and barcodes
  - Blank areas, empty fields, and whitespace
  - Signature images (ignore the signature graphic itself; DO transcribe the printed name
    or date written beside or below a signature if clinically relevant)
  - Stamp images (transcribe only the text inside a stamp if it carries clinical data)
Do NOT describe these elements. Do NOT write "[logo]", "[barcode]", "[watermark]",
"[blank]", or any placeholder for them.

WHAT TO TRANSCRIBE
Transcribe ONLY patient-related textual content, which includes:
  - All handwritten text (clinical notes, annotations, corrections)
  - All printed / typed text (headers, body text, tables, form labels with filled values)
  - Handwritten or typed dates, times, measurements, lab values, medications, doses
  - Findings, impressions, diagnoses, instructions, remarks
  - Checkbox states only when a box is clearly checked/ticked AND has a label beside it
    (e.g. "☑ Diabetes" — transcribe as "☑ Diabetes"; do NOT transcribe an unchecked
    blank box on its own)
  - Clinical images or diagrams only when they contain embedded text or annotations
    (transcribe the text/annotation; do NOT describe the image itself)

STRICT TRANSCRIPTION RULES
1.  DO NOT summarize.
2.  DO NOT paraphrase.
3.  DO NOT rewrite sentences.
4.  DO NOT correct spelling or grammar.
5.  DO NOT normalize abbreviations.
6.  DO NOT infer or fill in missing words.
7.  DO NOT interpret medical meaning.
8.  DO NOT omit any patient-related text content.
9.  DO NOT remove duplicate text.
10. Preserve the original reading order (top-to-bottom, left-to-right,
    then continuation columns if present).
11. Preserve headings, tables, handwritten notes, printed text,
    signatures (text portion), dates, times, medications, doses,
    findings, impressions, instructions, and remarks.
12. Preserve symbols exactly as they appear:
    →  ←  ×  ☑  ☐  +  -  ( )  [ ]  /  %  °  @  #  &
13. Preserve all dates exactly as written (do NOT reformat).
14. Preserve all times exactly as written.
15. Preserve all numbers exactly as written.
16. If text is partially unreadable, transcribe what is visible and mark:
      [unclear: <visible fragment>]
17. If multiple clinical entries exist on the same page,
    preserve them separately in the order they appear.
18. Preserve page boundaries using the output format below.

OUTPUT FORMAT

Page 1
--------------------------------
<Complete transcription of page 1 — patient-related text only>

Page 2
--------------------------------
<Complete transcription of page 2 — patient-related text only>

Continue until every page has been completely transcribed.

Do NOT provide explanations.
Do NOT provide summaries.
Do NOT provide interpretations.
Do NOT describe any visual / decorative element.

Return only the transcription.
"""


# =====================================================================
# STAGE 1 HELPERS
# =====================================================================
def _pdf_bytes_to_base64_images(pdf_bytes: bytes, dpi: int = VISION_DPI) -> List[str]:
    """
    Converts raw PDF bytes into a list of base64-encoded JPEG strings
    (one entry per page) using pdf2image / poppler.
    """
    pages = convert_from_bytes(pdf_bytes, dpi=dpi, fmt="jpeg")
    b64_pages = []
    for page_img in pages:
        buf = tempfile.SpooledTemporaryFile(max_size=10 * 1024 * 1024)
        page_img.save(buf, format="JPEG", quality=85)
        buf.seek(0)
        b64_pages.append(base64.b64encode(buf.read()).decode("utf-8"))
        buf.close()
    return b64_pages


def _call_vision_api_for_pages(
    b64_images: List[str],
    page_offset: int,
    total_pages: int,
) -> str:
    """
    Sends a batch of base64 JPEG page images to GPT-4o Vision via OpenRouter
    and returns the raw transcription text for those pages.
    """
    if not OPENROUTER_API_KEY:
        raise Exception("OPENROUTER_API_KEY is not set")

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "HTTP-Referer": "https://your-site.com",
        "X-Title": "Medical Document Analyzer",
        "Content-Type": "application/json",
    }

    content: List[Dict] = [{"type": "text", "text": STAGE1_TRANSCRIPTION_PROMPT}]

    for idx, b64 in enumerate(b64_images):
        content.append({
            "type": "image_url",
            "image_url": {
                "url": f"data:image/jpeg;base64,{b64}",
                "detail": "high",
            },
        })
        global_page_num = page_offset + idx + 1
        content.append({
            "type": "text",
            "text": f"[The image above is Page {global_page_num} of {total_pages}]",
        })

    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [{"role": "user", "content": content}],
        "temperature": 0.0,
    }

    response = requests.post(
        url=OPENROUTER_URL, headers=headers, json=payload, timeout=300
    )
    if response.status_code != 200:
        raise Exception(
            f"OpenRouter (stage 1 vision, pages {page_offset + 1}–"
            f"{page_offset + len(b64_images)} of {total_pages}) "
            f"request failed: {response.status_code} | {response.text}"
        )

    result = response.json()
    try:
        content_text = result["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as e:
        raise Exception(
            f"Unexpected OpenRouter response shape (stage 1 vision): {result}"
        ) from e

    return (content_text or "").strip()


def extract_raw_transcription_openai(file_url: str, filename: str) -> str:
    """
    STAGE 1 — GPT-4o Vision transcription.

    Workflow:
      1. Download the PDF from file_url.
      2. Rasterise every page to a JPEG image via pdf2image / poppler.
      3. Send pages in batches of VISION_BATCH_SIZE to GPT-4o Vision
         via OpenRouter.
      4. Concatenate the per-batch transcriptions in page order and
         return the combined plain-text transcription.
    """
    # ── 1. Download the PDF ────────────────────────────────────────
    dl_response = requests.get(file_url, timeout=120)
    if dl_response.status_code != 200:
        raise Exception(
            f"Stage 1: failed to download PDF for vision processing: "
            f"{file_url} (HTTP {dl_response.status_code})"
        )
    pdf_bytes = dl_response.content
    logger.info(f"Stage 1: downloaded PDF ({len(pdf_bytes):,} bytes) — converting to images")

    # ── 2. Rasterise pages ──────────────────────────────────────────
    try:
        b64_pages = _pdf_bytes_to_base64_images(pdf_bytes, dpi=VISION_DPI)
    except Exception as e:
        raise Exception(f"Stage 1: PDF→image conversion failed: {e}") from e

    total_pages = len(b64_pages)
    logger.info(f"Stage 1: {total_pages} page(s) rasterised at {VISION_DPI} dpi")

    if total_pages == 0:
        raise Exception("Stage 1: PDF produced zero pages after rasterisation")

    # ── 3. Call Vision API in batches ────────────────────────────────
    transcription_parts: List[str] = []

    for batch_start in range(0, total_pages, VISION_BATCH_SIZE):
        batch = b64_pages[batch_start: batch_start + VISION_BATCH_SIZE]
        batch_end = batch_start + len(batch)
        logger.info(
            f"Stage 1: sending pages {batch_start + 1}–{batch_end} "
            f"of {total_pages} to GPT-4o Vision"
        )

        batch_text = _call_vision_api_for_pages(
            b64_images=batch,
            page_offset=batch_start,
            total_pages=total_pages,
        )

        if batch_text.startswith("```"):
            batch_text = batch_text.strip("`").strip()
            if batch_text.lower().startswith("text"):
                batch_text = batch_text[4:].strip()

        if not batch_text:
            logger.warning(
                f"Stage 1: vision API returned empty text for pages "
                f"{batch_start + 1}–{batch_end}"
            )
        else:
            transcription_parts.append(batch_text)

    # ── 4. Combine batch results ──────────────────────────────────────
    raw_transcription = "\n\n".join(transcription_parts).strip()

    if not raw_transcription:
        raise Exception("Stage 1 vision transcription returned empty content for all pages")

    return raw_transcription


# =====================================================================
# ENDPOINT
# =====================================================================
@router.post("/proxy/upload/handwritten")
async def upload_handwritten_document(
    doctor_id: str = Form(...),
    patient_id: str = Form(...),
    appointment_id: Optional[str] = Form(None),
    doc_type: Optional[str] = Form("handwritten_notes"),
    category: Optional[str] = Form(None),
    subcategory: Optional[str] = Form(None),
    report_date: Optional[str] = Form(None),
    hospital_id: Optional[str] = Form(None),
    file: UploadFile = File(...),
):
    try:

        # --------------------------------------------------
        # 1️⃣ Upload file to storage service
        # --------------------------------------------------
        upload_url = f"{STORAGE_BASE_URL}/upload"

        files = {
            "file": (
                file.filename,
                await file.read(),
                file.content_type
            )
        }

        params = {
            "doctor_id": doctor_id,
            "patient_id": patient_id,
            "doc_type": doc_type,
            "category": category,
            "subcategory": subcategory,
        }

        upload_response = requests.post(
            upload_url,
            params=params,
            files=files,
            timeout=120
        )

        if upload_response.status_code != 200:
            raise HTTPException(
                status_code=upload_response.status_code,
                detail=upload_response.text
            )

        upload_result = upload_response.json()

        stored_filename = upload_result["filename"]

        file_url = (
            f"{STORAGE_BASE_URL}/files/"
            f"{patient_id}/{stored_filename}"
        )

        # --------------------------------------------------
        # 2️⃣ Stage 1 — GPT-4o Vision transcription via OpenRouter
        # --------------------------------------------------
        try:
            full_markdown = extract_raw_transcription_openai(
                file_url=file_url,
                filename=file.filename
            )
        except Exception as vision_err:
            logger.error(f"Vision transcription failed | file_url={file_url} | {vision_err}", exc_info=True)
            raise HTTPException(
                status_code=502,
                detail=f"Vision transcription failed: {vision_err}"
            )

        if not full_markdown or len(full_markdown.strip()) < 1:
            raise HTTPException(
                status_code=502,
                detail="Vision transcription returned empty content"
            )

        # Split into per-page chunks based on the "Page N" markers
        # emitted by STAGE1_TRANSCRIPTION_PROMPT.
        parsed_pages = []
        page_chunks = re.split(r"\n(?=Page\s+\d+\s*\n-+)", full_markdown)
        for chunk in page_chunks:
            chunk = chunk.strip()
            if not chunk:
                continue
            match = re.match(r"Page\s+(\d+)", chunk)
            page_num = int(match.group(1)) if match else len(parsed_pages) + 1
            parsed_pages.append({
                "page": page_num,
                "markdown": chunk
            })

        # --------------------------------------------------
        # 3️⃣ Optional DB Save
        # --------------------------------------------------
        await temp_documents_collection.insert_one({
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "appointment_id": appointment_id,
            "file_name": file.filename,
            "file_url": file_url,
            "doc_type": doc_type,
            "category": category,
            "subcategory": subcategory,
            "parsed_text": full_markdown,
            "upload_mode": "handwritten",
            "status": "parsed",
            "created_at": datetime.utcnow()
        })

        # --------------------------------------------------
        # 4️⃣ RETURN RESULT
        # --------------------------------------------------
        return {
            "success": True,
            "message": "Handwritten document parsed successfully",
            "file_url": file_url,
            "doc_type": doc_type,
            "category": category,
            "subcategory": subcategory,
            "parsed_result": {
                "pages": parsed_pages,
                "full_markdown": full_markdown
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )

import os
import pickle
import faiss
from sentence_transformers import SentenceTransformer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

INDEX_FILE = os.path.join(
    BASE_DIR,
    "vector_index.faiss"
)

METADATA_FILE = os.path.join(
    BASE_DIR,
    "vector_metadata.pkl"
)

print("INDEX_FILE =", INDEX_FILE)
print("METADATA_FILE =", METADATA_FILE)

model = SentenceTransformer("all-MiniLM-L6-v2")

index = faiss.read_index(INDEX_FILE)

with open(METADATA_FILE, "rb") as f:
    metadata = pickle.load(f)

rows = metadata["rows"]
MASTER_DIR = "/speciality/services/doctor_medication_master"

class SearchRequest(BaseModel):
    doctor_id: str
    query: str
    top_k: int = 5

@router.post("/search_medical_rag")
async def search_medical_rag(
    request: SearchRequest
):

    faiss_file = os.path.join(
        MASTER_DIR,
        f"{request.doctor_id}.faiss"
    )

    pkl_file = os.path.join(
        MASTER_DIR,
        f"{request.doctor_id}.pkl"
    )

    if not os.path.exists(faiss_file):

        raise HTTPException(
            status_code=404,
            detail="Medication master not uploaded"
        )

    index = faiss.read_index(
        faiss_file
    )

    with open(
        pkl_file,
        "rb"
    ) as f:

        metadata = pickle.load(f)

    rows = metadata["rows"]

    query_embedding = model.encode(
        [request.query],
        convert_to_numpy=True
    ).astype("float32")

    faiss.normalize_L2(
        query_embedding
    )

    scores, indices = index.search(
        query_embedding,
        request.top_k
    )

    results = []

    for score, idx in zip(
        scores[0],
        indices[0]
    ):

        if idx == -1:
            continue

        results.append({
            "score": float(score),
            "data": rows[idx]
        })

    return {
        "results": results
    }
@router.get(
    "/all_medications/{doctor_id}"
)
async def all_medications(
    doctor_id: str
):

    pkl_file = os.path.join(
        MASTER_DIR,
        f"{doctor_id}.pkl"
    )

    if not os.path.exists(
        pkl_file
    ):
        return []

    with open(
        pkl_file,
        "rb"
    ) as f:

        metadata = pickle.load(f)

    rows = metadata["rows"]

    medicines = []

    for row in rows:

        medicines.append({
            "condition":
                row.get(
                    "Condition / Indication"
                ),
            "generic_name":
                row.get(
                    "Generic Name"
                ),
            "brand_name":
                row.get(
                    "Brand Name (Common)"
                ),
            "strength":
                row.get(
                    "Strength"
                ),
            "frequency":
                row.get(
                    "Frequency"
                ),
            "duration":
                row.get(
                    "Duration"
                ),
            "instructions":
                row.get(
                    "Remarks / Instructions"
                )
        })

    return medicines



from fastapi import UploadFile, File, Form
import pandas as pd
import pickle
import faiss
import os

import os

BASE_DIR = os.path.dirname(
    os.path.abspath(__file__)
)

MASTER_DIR = os.path.join(
    BASE_DIR,
    "doctor_medication_master"
)

os.makedirs(
    MASTER_DIR,
    exist_ok=True
)

print("MASTER_DIR =", MASTER_DIR)

os.makedirs(
    MASTER_DIR,
    exist_ok=True
)


@router.post("/upload_medication_master")
async def upload_medication_master(
    doctor_id: str = Form(...),
    file: UploadFile = File(...)
):

    try:

        # -------------------------
        # LOAD EXCEL
        # -------------------------

        df = pd.read_excel(
            file.file,
            sheet_name=0,
            header=2
        )

        # Remove empty rows
        df = df.dropna(how="all")

        # Remove empty columns
        df = df.dropna(axis=1, how="all")

        print("Columns Found:")
        print(list(df.columns))

        # -------------------------
        # CREATE ROW DATA
        # -------------------------

        rows = []

        for _, row in df.iterrows():

            row_dict = {}

            for col in df.columns:

                value = row[col]

                if pd.isna(value):
                    value = ""

                row_dict[str(col)] = str(value)

            rows.append(row_dict)

        print(f"Rows Loaded: {len(rows)}")

        # -------------------------
        # CREATE SEARCH DOCUMENTS
        # -------------------------

        texts = []

        for row in rows:

            parts = []

            for key, value in row.items():

                if not value:
                    continue

                parts.append(
                    f"{key}: {value}"
                )

            texts.append(
                "\n".join(parts).lower()
            )

        print(f"Documents Created: {len(texts)}")

        # -------------------------
        # EMBEDDINGS
        # -------------------------

        embeddings = model.encode(
            texts,
            convert_to_numpy=True,
            show_progress_bar=True
        ).astype("float32")

        faiss.normalize_L2(
            embeddings
        )

        # -------------------------
        # CREATE INDEX
        # -------------------------

        dimension = embeddings.shape[1]

        index = faiss.IndexFlatIP(
            dimension
        )

        index.add(
            embeddings
        )

        # -------------------------
        # SAVE FILES
        # -------------------------

        faiss_file = os.path.join(
            MASTER_DIR,
            f"{doctor_id}.faiss"
        )

        pkl_file = os.path.join(
            MASTER_DIR,
            f"{doctor_id}.pkl"
        )

        faiss.write_index(
            index,
            faiss_file
        )

        with open(
            pkl_file,
            "wb"
        ) as f:

            pickle.dump(
                {
                    "doctor_id": doctor_id,
                    "columns": list(df.columns),
                    "rows": rows,
                    "documents": texts
                },
                f
            )

        print(
            f"FAISS SAVED: {faiss_file}"
        )

        print(
            f"PKL SAVED: {pkl_file}"
        )

        return {
            "status": "success",
            "doctor_id": doctor_id,
            "rows": len(rows),
            "columns": list(df.columns),
            "faiss_file": faiss_file,
            "pkl_file": pkl_file
        }

    except Exception as e:

        logger.exception(str(e))

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )
        
        
STORAGE_BASE_URL = "https://doctorassist.ai/uploads"




@router.post("/proxy/upload")
async def proxy_upload(
    request: Request,
    doctor_id: str = Form(...),
    patient_id: str = Form(...),
    appointment_id: Optional[str] = Form(None),
    doc_type: Optional[str] = Form(None),
    category: Optional[str] = Form(None),
    subcategory: Optional[str] = Form(None),
    report_date: Optional[str] = Form(None),
    upload_mode: str = Form(...),
    hospital_id: Optional[str] = Form(None),
    file: UploadFile = File(...),
):
    try:

        # --------------------------------------------------
        # Normalize Optional Fields
        # --------------------------------------------------
        category = (
            category.strip()
            if category and category.strip()
            else "patient-image"
        )

        subcategory = (
            subcategory.strip()
            if subcategory and subcategory.strip()
            else "none"
        )

        doc_type = (
            doc_type.strip()
            if doc_type and doc_type.strip()
            else "image"
        )

        # --------------------------------------------------
        # Upload File To Storage Service
        # --------------------------------------------------
        upload_url = f"{STORAGE_BASE_URL}/upload"

        logger.info(
            f"Uploading file | patient={patient_id} | doctor={doctor_id}"
        )

        file_content = await file.read()

        files = {
            "file": (
                file.filename,
                file_content,
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
            upload_url,
            params=params,
            files=files,
            timeout=60,
        )

        logger.info(
            f"Storage Upload Response: {response.status_code}"
        )

        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=response.text,
            )

        upload_result = response.json()

        stored_filename = upload_result["filename"]

        file_url = (
            f"{STORAGE_BASE_URL}/files/"
            f"{patient_id}/"
            f"{stored_filename}"
        )

        # --------------------------------------------------
        # Resolve Appointment
        # --------------------------------------------------
        INVALID_VALUES = {
            None,
            "",
            "null",
            "undefined",
            "fail",
        }

        
        # --------------------------------------------------
        # Save Metadata To MongoDB
        # --------------------------------------------------
        image_document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "appointment_id": None,
            "hospital_id": hospital_id,
            "upload_mode": upload_mode,
            "file_url": file_url,
            "filename": stored_filename,
            "doc_type": doc_type,
            "category": category,
            "subcategory": subcategory,
            "report_date": report_date,
            "status": "active",
            "created_at": datetime.utcnow(),
        }

        mongo_result = await patient_images_collection.insert_one(
            image_document
        )

        logger.info(
            f"Mongo Insert Success: {mongo_result.inserted_id}"
        )

        # --------------------------------------------------
        # Return Success
        # --------------------------------------------------
        return {
            "status": "success",
            "message": "Image uploaded successfully",
            "mongo_id": str(mongo_result.inserted_id),
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "appointment_id": None,
            "file_url": file_url,
            "filename": stored_filename,
            "category": category,
            "subcategory": subcategory,
            "upload_mode": upload_mode,
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.exception("UPLOAD ERROR")

        raise HTTPException(
            status_code=500,
            detail=f"Upload failed: {str(e)}",
        )





################################################### RAG FLOW BY ALWIN ################################

MAX_ENTITY_GROUP_SIZE = 5


def _dedupe_and_cap_entities(entities: list) -> list:
    """
    Upstream extraction can occasionally produce runaway duplicate
    entities that share the same entity_type/entity_name but
    increment a counter in entity_value (e.g. "cycle 1 of 4" through
    "cycle 415 of 4" for what should be a 4-cycle regimen). Left
    unfiltered these drown out real clinical entities and blow up
    chunk size. Cap each (entity_type, entity_name) group to a small
    sample instead of dropping by length, since legitimate entities
    (e.g. "ER: Positive") are often short and must not be filtered.
    """
    if not entities:
        return entities

    groups: dict = {}
    order: list = []

    for e in entities:
        key = (e.get("entity_type"), e.get("entity_name"))
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(e)

    result = []
    for key in order:
        group = groups[key]
        if len(group) <= MAX_ENTITY_GROUP_SIZE:
            result.extend(group)
        else:
            kept = group[:2] + group[-1:]
            result.extend(kept)
            entity_type, entity_name = key
            result.append({
                "entity_type": entity_type,
                "entity_name": entity_name,
                "entity_value": f"(+{len(group) - len(kept)} more similar entries omitted)"
            })

    return result


def _is_narrative_string(value) -> bool:
    """
    Heuristic for 'this is a prose sentence' vs 'this is a code,
    id, date, or structured field value' — used to pull real
    clinical narrative out of embedded JSON without dragging in
    the surrounding structural noise (lab order codes, drug lists,
    device ids, beam parameters, etc).
    """
    return (
        isinstance(value, str)
        and len(value) >= 30
        and value.count(" ") >= 4
    )


def _humanize_key(key) -> str:
    """tumor_size_leftBreast -> 'tumor size left breast' (so BM25's
    whitespace tokenizer can actually match on individual words)."""
    if not key:
        return ""
    s = re.sub(r"[_\-]+", " ", str(key))
    s = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", s)
    return s.strip().lower()


def _extract_narrative_from_json(data) -> str:
    """
    Recursively walk a parsed JSON structure and pull out narrative
    free-text strings (doctor notes, transcripts, AI summaries) in
    full, and short structured leaf values (tumor size, staging,
    lab values, dates, numbers, booleans, etc.) tagged with a
    humanized key name so they stay searchable — without dragging
    in raw JSON syntax or bulky structured sub-trees (labOrderFields,
    beamParameters, etc.).
    """
    found = []

    def walk(node, key_hint=None):
        if isinstance(node, dict):
            for k, value in node.items():
                walk(value, key_hint=k)
        elif isinstance(node, list):
            for item in node:
                walk(item, key_hint=key_hint)
        elif node is None:
            return
        elif isinstance(node, bool):
            if key_hint:
                found.append(f"{_humanize_key(key_hint)}: {node}")
        elif isinstance(node, (int, float)):
            if key_hint:
                found.append(f"{_humanize_key(key_hint)}: {node}")
        elif isinstance(node, str) and node.strip():
            if _is_narrative_string(node):
                found.append(node)
            elif key_hint:
                found.append(f"{_humanize_key(key_hint)}: {node.strip()}")

    walk(data)

    # Preserve order but drop exact duplicate sentences (the source
    # data repeats the same narrative under multiple nested paths).
    seen = set()
    deduped = []
    for s in found:
        if s not in seen:
            seen.add(s)
            deduped.append(s)

    return "\n".join(deduped)


def _normalize_section_content(content) -> str:
    """
    Section content shows up in three shapes across different doc
    sources/specialties:
      1. plain prose (str)                  -> use as-is
      2. a JSON string embedding nested data -> json.loads, extract
      3. an already-parsed dict/list (Mongo stores nested docs
         natively - this is common, not an edge case) -> extract
         directly
    Previously only case 2 was handled - a native dict/list fell
    through to str(content), embedding raw Python repr instead of
    the actual field values (tumor size, staging, labs, etc.).
    """
    if isinstance(content, (dict, list)):
        narrative = _extract_narrative_from_json(content)
        return narrative if narrative else (str(content) if content else "")

    if not isinstance(content, str):
        return str(content) if content else ""

    stripped = content.strip()

    if stripped.startswith("{") or stripped.startswith("["):
        try:
            parsed = json.loads(stripped)
        except (json.JSONDecodeError, ValueError):
            return content
        narrative = _extract_narrative_from_json(parsed)
        return narrative if narrative else content

    return content


async def get_patient_processed_documents(
    patient_id: str
):
    """
    Fetch all processed documents
    belonging to one patient (doctor_id no longer
    used for scoping the fetch)
    """

    query = {
        "patient_id": patient_id
    }


    documents = await processed_documents_collection.find(
        query
    ).to_list(None)


    return documents



async def extract_patient_documents_text(
    patient_id: str
):


    documents = await get_patient_processed_documents(
        patient_id
    )


    if not documents:
        return []


    rag_documents = []


    for doc in documents:


        document_id = str(doc.get("_id"))


        text_parts = []


        # -------------------
        # Raw markdown
        # -------------------

        raw_markdown = doc.get(
            "raw_markdown",
            ""
        )


        if raw_markdown:
            text_parts.append(
                "DOCUMENT CONTENT:\n"
                + raw_markdown
            )


        # -------------------
        # Sections (handle both dict and list shapes)
        # -------------------

        sections_field = doc.get("sections", {})

        if isinstance(sections_field, dict):
            sections = sections_field.get("sections", [])
            tables = sections_field.get("tables", [])
        elif isinstance(sections_field, list):
            # legacy/alternate shape: "sections" itself is the list of section dicts
            sections = sections_field
            tables = []
        else:
            sections = []
            tables = []

        classification_sample = raw_markdown or ""
        if not classification_sample and sections:
            first = sections[0] if isinstance(sections[0], dict) else {}
            classification_sample = str(first.get("content", ""))[:2000]

        document_type = await _llm_classify_document_type(classification_sample)
        text_parts.append(f"DOCUMENT TYPE: {document_type}")

        for section in sections:

            if not isinstance(section, dict):
                continue

            heading = section.get(
                "heading",
                ""
            )

            content = _normalize_section_content(
                section.get("content", "")
            )


            text_parts.append(
                f"""
SECTION:
{heading}

{content}
"""
            )

        # Tables were parsed above but never included - this is
        # where structured measurements (tumor size, staging, lab
        # panels, dosage tables, etc.) often live, across every
        # specialty, not something to special-case per document type.
        for table in tables:
            table_text = _table_to_text(table)
            if table_text:
                text_parts.append(
                    f"""
TABLE:
{table_text}
"""
                )

        final_text = "\n\n".join(
            text_parts
        )


        rag_documents.append(
            {
                "id":
                f"{patient_id}_{document_id}",


                "patient_id":
                patient_id,


                "document_id":
                document_id,


                "document_type":
                document_type,


                "text":
                final_text
            }
        )


    return rag_documents


async def chunk_patient_documents(
    documents
):


    chunks=[]


    MAX_CHARS = 15000


    for doc in documents:


        text = doc["text"]


        for i in range(
            0,
            len(text),
            MAX_CHARS
        ):


            chunk=text[
                i:i+MAX_CHARS
            ]


            chunks.append(
                {

                "id":
                f"{doc['id']}_{i}",


                "patient_id":
                doc["patient_id"],


                "document_type":
                doc.get("document_type", "other"),


                "text":
                chunk

                }
            )


    return chunks



OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_EMBED_URL = "https://openrouter.ai/api/v1/embeddings"
EMBEDDING_MODEL = "openai/text-embedding-3-large"
EMBEDDING_DIMENSION = 3072


# Keep well under OpenRouter's 300,000 token/request cap.
# Uses a rough chars/4 ~ tokens heuristic with headroom, since we
# don't have an exact tokenizer for text-embedding-3-large wired up.
EMBED_MAX_TOKENS_PER_REQUEST = 250_000
EMBED_CHARS_PER_TOKEN_ESTIMATE = 4
EMBED_MAX_ITEMS_PER_REQUEST = 100  # extra safety net regardless of size


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // EMBED_CHARS_PER_TOKEN_ESTIMATE)


def _batch_texts_for_embedding(texts: list[str]) -> list[list[str]]:

    batches = []
    current_batch = []
    current_tokens = 0

    max_tokens = EMBED_MAX_TOKENS_PER_REQUEST

    for text in texts:

        text_tokens = _estimate_tokens(text)

        # A single text alone exceeds the budget - send it solo
        # rather than looping forever trying to batch it with others.
        if text_tokens >= max_tokens:
            if current_batch:
                batches.append(current_batch)
                current_batch = []
                current_tokens = 0
            batches.append([text])
            continue

        would_exceed_tokens = (
            current_tokens + text_tokens > max_tokens
        )
        would_exceed_items = (
            len(current_batch) + 1 > EMBED_MAX_ITEMS_PER_REQUEST
        )

        if current_batch and (would_exceed_tokens or would_exceed_items):
            batches.append(current_batch)
            current_batch = []
            current_tokens = 0

        current_batch.append(text)
        current_tokens += text_tokens

    if current_batch:
        batches.append(current_batch)

    return batches


async def _embed_texts_batch(texts: list[str]) -> list[list[float]]:

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": EMBEDDING_MODEL,
        "input": texts,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            OPENROUTER_EMBED_URL,
            headers=headers,
            json=payload,
        )

    print("Status Code:", response.status_code)
    print("Response:", response.text)

    response.raise_for_status()

    data = response.json()

    if "data" not in data:
        raise Exception(f"Embedding API Error: {data}")

    return [item["embedding"] for item in data["data"]]


async def embed_texts(texts: list[str]) -> list[list[float]]:

    if not texts:
        return []

    batches = _batch_texts_for_embedding(texts)

    all_embeddings: list[list[float]] = []

    for batch in batches:
        batch_embeddings = await _embed_texts_batch(batch)
        all_embeddings.extend(batch_embeddings)

    return all_embeddings


async def generate_patient_embeddings(
    patient_id
):


    documents = await extract_patient_documents_text(
        patient_id
    )


    chunks = await chunk_patient_documents(
        documents
    )


    texts=[
        c["text"]
        for c in chunks
    ]


    embeddings = await embed_texts(
        texts
    )


    for chunk, embedding in zip(
        chunks,
        embeddings
    ):

        chunk["embedding"]=embedding


    return chunks


import hashlib
import math


async def store_patient_rag(
    patient_id
):


    collection_key = (
        f"{patient_id}"
    )


    collection_hash = hashlib.md5(
        collection_key.encode()
    ).hexdigest()



    collection_name = (
        f"patient_{collection_hash}"
    )



    # Drop any stale collection so we never serve chunks that were
    # built with an older/lossy extraction pipeline.
    try:
        chroma_client.delete_collection(name=collection_name)
    except Exception:
        pass

    collection = (
        chroma_client
        .get_or_create_collection(
            name=collection_name
        )
    )



    documents = await generate_patient_embeddings(
        patient_id
    )



    if not documents:

        return {
            "status":"error",
            "message":
            "No documents found"
        }



    collection.upsert(

        ids=[
            d["id"]
            for d in documents
        ],


        documents=[
            d["text"]
            for d in documents
        ],


        embeddings=[
            d["embedding"]
            for d in documents
        ],


        metadatas=[

            {
                "patient_id":
                d["patient_id"],


                "document_type":
                d.get("document_type", "other")

            }

            for d in documents

        ]

    )



    return {

        "status":"success",

        "collection":
        collection_name,

        "chunks":
        len(documents)

    }


DEFAULT_CLINICAL_SYSTEM_PROMPT = (
    "You are an expert oncology clinical assistant. "
    "Answer only using the provided clinical context. "
    "Do not make up facts. "
    "If the answer is not present in the context, reply: "
    "'I could not find enough information in the available patient summaries.'"
)


def _call_llm_sync(
    prompt: str,
    system_prompt: str = DEFAULT_CLINICAL_SYSTEM_PROMPT,
    temperature: float = 0.2,
    max_tokens: int = 5000,
) -> str:

    response = groq_client.chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ],
        temperature=temperature,
        max_tokens=max_tokens
    )

    return response.choices[0].message.content.strip()


async def call_llm(
    prompt: str,
    system_prompt: str = DEFAULT_CLINICAL_SYSTEM_PROMPT,
    temperature: float = 0.2,
    max_tokens: int = 5000,
) -> str:
    return await asyncio.to_thread(
        _call_llm_sync, prompt, system_prompt, temperature, max_tokens
    )


def _extract_json(text: str) -> dict:
    """LLMs sometimes wrap JSON in prose despite instructions. Try a
    direct parse first, fall back to pulling the first {...} block."""
    if not text:
        return {}
    try:
        return json.loads(text.strip())
    except (json.JSONDecodeError, ValueError):
        pass
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except (json.JSONDecodeError, ValueError):
            return {}
    return {}


def _cosine_similarity(a: list, b: list) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


async def _llm_classify_document_type(sample_text: str) -> str:
    """
    Free-form classification - no predefined category list. The model
    describes what the document actually is, in its own words, so any
    new report type (any specialty, any hospital's phrasing, any
    language) is handled automatically with nothing to maintain.
    """
    if not sample_text or not sample_text.strip():
        return "other"

    system_prompt = (
        "You are a clinical document classifier.\n"
        "Read the document snippet and describe what KIND of clinical "
        "document it is, in your own words - e.g. 'histopathology "
        "report', 'radiology imaging report', 'chemotherapy "
        "administration record', 'vitals record', 'consultation "
        "dictation'. Judge by the actual content and structure - there "
        "is no fixed list to match against. Use the term a clinician "
        "would naturally use for this document type.\n"
        "Output rules (follow exactly):\n"
        "- Respond with ONLY a short label, 2-5 words, lowercase.\n"
        "- No punctuation, no explanation, no quotes.\n"
        "- Use standard clinical terminology so the same type of "
        "document is described the same way each time."
    )

    raw = await call_llm(
        sample_text[:2000], system_prompt=system_prompt,
        temperature=0.0, max_tokens=20,
    )
    label = raw.strip().lower().strip(" .\"'\n")
    return label if label else "other"


async def _llm_infer_query_target_type(question: str):
    """
    Free-form, question side: what kind of document is this question
    about, described in the model's own words, or None for a general
    question. Matching this against what actually exists for the
    patient happens separately, via embeddings - not string equality,
    so it never needs to match the classifier's exact wording.
    """
    system_prompt = (
        "You are a query-understanding assistant for a clinical search "
        "system used by oncologists.\n\n"
        "Read the doctor's question. First strip away conversational "
        "scaffolding that carries no classification meaning - phrases "
        "like 'give me', 'show me', 'can you provide', 'details of', "
        "'information about', 'of this patient', 'please', 'tell me "
        "about', etc. Classify based ONLY on the underlying clinical "
        "document type being asked about, not the phrasing used to "
        "ask for it. Two questions that request the same document "
        "type in different words MUST produce the exact same label.\n\n"
        "If it is clearly asking about the contents of ONE specific "
        "type of clinical document, describe that document type using "
        "the canonical clinical term, 2-3 words, lowercase (e.g. "
        "'histopathology report', 'imaging report', 'chemotherapy "
        "record'). Always prefer the shortest standard clinical name "
        "for the document type - do not include request-related words "
        "like 'details', 'summary', 'information', or 'record' unless "
        "they are part of the standard term itself.\n\n"
        "If the question is a general clinical question not tied to "
        "one specific report type, respond with exactly: null\n\n"
        "Output rules (follow exactly):\n"
        "- Respond with ONLY the label or the word null - no prose, "
        "no quotes, no punctuation.\n\n"
        "Examples:\n"
        "Q: give histopathology details of this patient -> histopathology report\n"
        "Q: histopathology details of this patient -> histopathology report\n"
        "Q: can you show me the biopsy report -> histopathology report\n"
        "Q: what chemo cycles has the patient completed -> chemotherapy record\n"
        "Q: how is the patient doing overall -> null"
    )
    raw = await call_llm(
        question, system_prompt=system_prompt,
        temperature=0.0, max_tokens=20,
    )
    label = raw.strip().lower().strip(" .\"'\n")
    return None if label in ("", "null", "none") else label


async def _normalize_query_text(question: str) -> str:
    """Expand abbreviations, normalize spelling/regional variants,
    make intent explicit - for the BM25/embedding fallback search."""
    system_prompt = (
        "Rewrite the clinical question into ONE precise, self-contained "
        "search query for a keyword search engine (BM25). Expand "
        "abbreviations and normalize regional spelling variants only. "
        "Do NOT change the grammatical form of clinical terms (e.g. "
        "keep 'histopathology' as 'histopathology', never "
        "'histopathological'; keep 'biopsy' as 'biopsy', never "
        "'biopsied'). Do NOT add generic words, categories, or facts "
        "that are not present in the original question - this is a "
        "keyword search query, not a paraphrase or explanation. Keep "
        "it as close to the original wording as possible while "
        "stripping only conversational filler like 'give me', 'can "
        "you show', 'please'.\n"
        "Output rules: respond with ONLY the rewritten query - no "
        "prose, no quotes, no explanation."
    )
    raw = await call_llm(
        question, system_prompt=system_prompt,
        temperature=0.0, max_tokens=100,
    )
    return raw.strip() or question


async def _match_query_type_to_available(
    requested_label: str,
    available_labels: list,
    threshold: float = 0.80,
):
    """
    Matches the question's free-form target type against whatever
    free-form type labels actually exist for this patient, via
    embedding similarity - so 'biopsy report' matches a document
    labelled 'histopathology report', 'pathology result' matches the
    same thing, etc. Neither side is ever constrained to a fixed list.
    """
    if not requested_label or not available_labels:
        return None

    vectors = await embed_texts([requested_label] + available_labels)
    requested_vec = vectors[0]
    label_vecs = vectors[1:]

    best_label = None
    best_score = 0.0
    for label, vec in zip(available_labels, label_vecs):
        score = _cosine_similarity(requested_vec, vec)
        if score > best_score:
            best_score = score
            best_label = label

    print(f"[RAG DEBUG] requested_label={requested_label!r} best_label={best_label!r} best_score={best_score:.4f} threshold={threshold}")

    return best_label if best_score >= threshold else None


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def _build_bm25_index(chunk_texts: list[str]):
    tokenized = [_tokenize(t) for t in chunk_texts]
    return BM25Okapi(tokenized)


def _bm25_rank(bm25: BM25Okapi, chunk_ids: list[str], query: str) -> list[str]:
    scores = bm25.get_scores(_tokenize(query))
    ranked = sorted(zip(chunk_ids, scores), key=lambda x: x[1], reverse=True)
    return [cid for cid, _ in ranked]


def _reciprocal_rank_fusion(rank_lists: list[list[str]], k: int = 60) -> list[str]:
    scores: dict[str, float] = {}
    for ranked_ids in rank_lists:
        for rank, doc_id in enumerate(ranked_ids):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank + 1)
    fused = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    return [doc_id for doc_id, _ in fused]



async def search_patient_rag(
    patient_id,
    question,
    top_k=5,
    fetch_k=30
):


    collection_key = f"{patient_id}"

    collection_hash = hashlib.md5(
        collection_key.encode()
    ).hexdigest()

    collection_name = f"patient_{collection_hash}"

    all_ids = []
    all_texts = []

    try:
        collection = (
            chroma_client
            .get_collection(
                name=collection_name
            )
        )

        all_data = collection.get(include=["documents", "metadatas"])
        all_ids = all_data["ids"]
        all_texts = all_data["documents"]
        all_metadatas = all_data.get("metadatas") or [{} for _ in all_ids]

        if not all_ids:
            raise ValueError("Empty collection")

    except Exception:

        build_result = await store_patient_rag(
            patient_id
        )

        if build_result.get("status") != "success":
            return {
                "patient_id": patient_id,
                "answer": (
                    "I could not find enough information in the "
                    "available patient summaries."
                )
            }

        collection = (
            chroma_client
            .get_collection(
                name=collection_name
            )
        )

        all_data = collection.get(include=["documents", "metadatas"])
        all_ids = all_data["ids"]
        all_texts = all_data["documents"]
        all_metadatas = all_data.get("metadatas") or [{} for _ in all_ids]

    id_to_type = {
        cid: (meta or {}).get("document_type", "other")
        for cid, meta in zip(all_ids, all_metadatas)
    }
    available_types = sorted(set(id_to_type.values()))

    normalized_query = await _normalize_query_text(question)

    inferred_target = await _llm_infer_query_target_type(normalized_query)
    requested_type = None
    if inferred_target:
        requested_type = await _match_query_type_to_available(
            inferred_target, available_types
        )
    print(f"[RAG DEBUG] question={question!r}")
    print(f"[RAG DEBUG] normalized_query={normalized_query!r}")
    print(f"[RAG DEBUG] inferred_target={inferred_target!r}")
    print(f"[RAG DEBUG] available_types={available_types!r}")
    print(f"[RAG DEBUG] requested_type={requested_type!r}")

    id_to_text = dict(zip(all_ids, all_texts))

    if requested_type:
        typed_ids = [cid for cid in all_ids if id_to_type.get(cid) == requested_type]
        if typed_ids:
            REPORT_CONTEXT_CAP = 20
            top_texts = [id_to_text[i] for i in typed_ids[:REPORT_CONTEXT_CAP] if i in id_to_text]
            context = "\n\n".join(top_texts)

            answer = await call_llm(
                f"""

You are a clinical assistant.

Answer only from patient records.

Patient Clinical Data:

{context}


Question:

{question}

"""
            )

            return {
                "patient_id": patient_id,
                "answer": answer
            }

    bm25 = _build_bm25_index(all_texts)
    bm25_query = f"{question} {normalized_query}"
    bm25_ranked_ids = _bm25_rank(bm25, all_ids, bm25_query)[:fetch_k]


    query_embedding = (
        await embed_texts(
            [normalized_query]
        )
    )[0]



    dense_results = collection.query(

        query_embeddings=[
            query_embedding
        ],

        n_results=fetch_k

    )

    dense_ranked_ids = dense_results.get("ids", [[]])[0]

    fused_ids = _reciprocal_rank_fusion(
        [bm25_ranked_ids, dense_ranked_ids]
    )[:top_k]

    top_texts = [id_to_text[i] for i in fused_ids if i in id_to_text]


    context="\n\n".join(
        top_texts
    )



    prompt=f"""

You are a clinical assistant.

Answer only from patient records.

Patient Clinical Data:

{context}


Question:

{question}

"""


    answer = await call_llm(
        prompt
    )


    return {

        "patient_id":
        patient_id,


        "answer":
        answer

    }

# -----------------------------------------------------------------
# Router endpoints - doctor_id is still accepted here (per your note
# that you'll keep passing it in), but it's intentionally NOT
# forwarded into the fetch/search/store pipeline below. Everything
# from this point down is scoped by patient_id only.
# -----------------------------------------------------------------

@router.post(
"/patient-rag/build/{doctor_id}/{patient_id}"
)
async def build_patient_rag(
    doctor_id:str,
    patient_id:str
):

    return await store_patient_rag(
        patient_id
    )


@router.get(
"/patient-rag/debug/{doctor_id}/{patient_id}"
)
async def debug_patient_rag(
    doctor_id: str,
    patient_id: str,
    keyword: str = "tumor"
):
    """
    Temporary diagnostic endpoint - traces a keyword through
    Mongo -> extraction -> Chroma to find exactly which layer
    is dropping the data. Remove once the underlying bug is fixed.
    """
    kw = keyword.lower()
    result = {"keyword": keyword}

    # 1. Raw Mongo docs
    docs = await get_patient_processed_documents(patient_id)
    result["mongo_doc_count"] = len(docs)

    mongo_findings = []
    for d in docs:
        entry = {"doc_id": str(d.get("_id"))}

        rm = d.get("raw_markdown", "") or ""
        entry["raw_markdown_has_keyword"] = kw in rm.lower()

        sf = d.get("sections", {})
        entry["sections_field_type"] = str(type(sf))
        secs = (
            sf.get("sections", []) if isinstance(sf, dict)
            else sf if isinstance(sf, list)
            else []
        )
        tabs = sf.get("tables", []) if isinstance(sf, dict) else []
        entry["num_sections"] = len(secs)
        entry["num_tables"] = len(tabs)

        section_hits = []
        for s in secs:
            if not isinstance(s, dict):
                continue
            c = s.get("content", "")
            blob = c if isinstance(c, str) else json.dumps(c, default=str)
            if kw in blob.lower():
                section_hits.append({
                    "heading": s.get("heading"),
                    "content_type": str(type(c)),
                    "snippet": blob[:500]
                })
        entry["section_hits"] = section_hits

        table_hits = []
        for t in tabs:
            blob = json.dumps(t, default=str)
            if kw in blob.lower():
                table_hits.append(blob[:500])
        entry["table_hits"] = table_hits

        mongo_findings.append(entry)

    result["mongo_findings"] = mongo_findings

    # 2. What extraction actually produces
    extracted = await extract_patient_documents_text(patient_id)
    result["extracted"] = [
        {
            "document_id": e["document_id"],
            "has_keyword": kw in e["text"].lower(),
            "text_len": len(e["text"]),
            "snippet_around_keyword": (
                e["text"][max(0, e["text"].lower().find(kw) - 100):e["text"].lower().find(kw) + 200]
                if kw in e["text"].lower() else None
            )
        }
        for e in extracted
    ]

    # 3. What's actually stored in Chroma right now
    collection_hash = hashlib.md5(f"{patient_id}".encode()).hexdigest()
    collection_name = f"patient_{collection_hash}"
    chroma_info = {"collection_name": collection_name}
    try:
        collection = chroma_client.get_collection(name=collection_name)
        data = collection.get(include=["documents"])
        chroma_info["total_chunks"] = len(data["documents"])
        hits = [t for t in data["documents"] if kw in t.lower()]
        chroma_info["chunks_with_keyword"] = len(hits)
        chroma_info["sample_hits"] = [h[:500] for h in hits[:2]]
    except Exception as ex:
        chroma_info["error"] = str(ex)

    result["chroma"] = chroma_info

    return result



class PatientRAGRequest(BaseModel):

    doctor_id:str
    patient_id:str
    question:str
    top_k:int=5



@router.post(
"/patient-rag/search"
)
async def patient_rag_search(
    request:PatientRAGRequest
):


    return await search_patient_rag(

        request.patient_id,

        request.question,

        request.top_k

    )
    
    

# ============================================================
# INSURANCE CLAIM RAG
# SERVICE CODE + SERVICE DESCRIPTION ONLY
# ============================================================

# ============================================================
# INSURANCE CLAIM RAG
# CONDITION + SERVICE CODE + SERVICE DESCRIPTION
# ============================================================

import os
import math
import uuid
import asyncio
import httpx
import pandas as pd
import time

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel

import chromadb


# ============================================================
# ROUTER
# ============================================================




# ============================================================
# CONFIGURATION
# ============================================================

OPENROUTER_API_KEY = os.getenv(
    "OPENROUTER_API_KEY",
    ""
)

OPENROUTER_EMBED_URL = (
    "https://openrouter.ai/api/v1/embeddings"
)

EMBEDDING_MODEL = (
    "openai/text-embedding-3-large"
)

EMBEDDING_DIMENSION = 3072

# Rate limiting configuration
MAX_RETRIES = 5
INITIAL_RETRY_DELAY = 5  # seconds
MAX_RETRY_DELAY = 60  # seconds
RATE_LIMIT_BATCH_SIZE = 10  # Reduced batch size to avoid rate limits
BATCH_DELAY = 2  # Seconds between batches


# ============================================================
# EXCEL FILE
# ============================================================

INSURANCE_EXCEL_PATH = os.getenv(
    "INSURANCE_EXCEL_PATH",
    "speciality/services/ALKOOT AUG 2025 BATCH DETAILS.xls"
)


# ============================================================
# CHROMA
# ============================================================

INSURANCE_COLLECTION_NAME = (
    "insurance_claims_rag"
)

_CHROMA_DIR = os.path.join(
    os.path.dirname(__file__),
    "insurance_rag"
)

os.makedirs(
    _CHROMA_DIR,
    exist_ok=True
)

chroma_client = chromadb.PersistentClient(
    path=_CHROMA_DIR
)


# ============================================================
# DEFAULT SIMILARITY THRESHOLD
# ============================================================

DEFAULT_SIMILARITY_THRESHOLD = float(
    os.getenv(
        "INSURANCE_RAG_THRESHOLD",
        "0.70"
    )
)


# ============================================================
# REQUEST MODEL
# ============================================================

class InsuranceRAGRequest(BaseModel):
    patient_id: str
    icd_description: str
    service_description: str
    service_code: Optional[str] = None
    top_k: Optional[int] = 10
    similarity_threshold: Optional[float] = None


# ============================================================
# BACKGROUND TASK STORAGE
# ============================================================

_task_status: Dict[str, Dict[str, Any]] = {}


# ============================================================
# SAFE VALUE
# ============================================================

def safe_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        if math.isnan(value):
            return ""
    return str(value).strip()


# ============================================================
# BUILD INSURANCE RAG DOCUMENT
# ============================================================

def build_insurance_rag_text(row: Dict[str, Any]) -> str:
    icd_description = safe_value(row.get("ICD DESCRIPTION"))
    service_code = safe_value(row.get("INTERNAL  SERVICE CODE"))
    service_description = safe_value(row.get("SERVICE DESCRIPTION"))
    
    return (
        f"Condition / ICD Description: {icd_description}\n"
        f"Internal Service Code: {service_code}\n"
        f"Service Description: {service_description}"
    ).strip()


# ============================================================
# BUILD SEARCH QUERY
# ============================================================

def build_insurance_query(
    icd_description: str,
    service_description: str,
    service_code: Optional[str] = None
) -> str:
    icd_description_text = safe_value(icd_description)
    service_code_text = safe_value(service_code)
    service_description_text = safe_value(service_description)
    
    return (
        f"Condition / ICD Description: {icd_description_text}\n"
        f"Internal Service Code: {service_code_text}\n"
        f"Service Description: {service_description_text}"
    ).strip()


# ============================================================
# OPENROUTER BATCH EMBEDDINGS WITH RETRY AND RATE LIMITING
# ============================================================

async def get_openrouter_embeddings_with_retry(
    texts: List[str],
    retry_count: int = 0
) -> List[List[float]]:
    """
    Get embeddings with retry logic for rate limiting.
    """
    if not OPENROUTER_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="OPENROUTER_API_KEY is not configured"
        )

    if not texts:
        return []

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": EMBEDDING_MODEL,
        "input": texts
    }

    try:
        async with httpx.AsyncClient(timeout=300) as client:
            response = await client.post(
                OPENROUTER_EMBED_URL,
                headers=headers,
                json=payload
            )

        # Handle rate limiting (429)
        if response.status_code == 429:
            if retry_count >= MAX_RETRIES:
                raise HTTPException(
                    status_code=429,
                    detail=f"Rate limit exceeded after {MAX_RETRIES} retries"
                )
            
            # Parse retry-after if available
            retry_after = response.headers.get("retry-after")
            if retry_after:
                try:
                    delay = int(retry_after)
                except ValueError:
                    delay = INITIAL_RETRY_DELAY * (2 ** retry_count)
            else:
                # Exponential backoff
                delay = min(
                    INITIAL_RETRY_DELAY * (2 ** retry_count),
                    MAX_RETRY_DELAY
                )
            
            # Add jitter to prevent thundering herd
            delay += random.uniform(0, 1)
            
            # Update status
            task_id = get_current_task_id()
            if task_id and task_id in _task_status:
                _task_status[task_id]["message"] = (
                    f"Rate limited. Retrying in {delay:.1f}s "
                    f"(attempt {retry_count + 1}/{MAX_RETRIES})"
                )
            
            await asyncio.sleep(delay)
            
            # Retry with incremented retry count
            return await get_openrouter_embeddings_with_retry(
                texts,
                retry_count + 1
            )

        if response.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail={
                    "message": "OpenRouter batch embedding failed",
                    "status_code": response.status_code,
                    "response": response.text[:1000]
                }
            )

        result = response.json()
        
        try:
            data = result["data"]
            data = sorted(data, key=lambda x: x["index"])
            embeddings = [item["embedding"] for item in data]
        except (KeyError, TypeError, IndexError):
            raise HTTPException(
                status_code=502,
                detail="Invalid batch embedding response"
            )

        if len(embeddings) != len(texts):
            raise HTTPException(
                status_code=502,
                detail=f"Expected {len(texts)} embeddings, got {len(embeddings)}"
            )

        for embedding in embeddings:
            if len(embedding) != EMBEDDING_DIMENSION:
                raise HTTPException(
                    status_code=502,
                    detail="Invalid embedding dimension"
                )

        return embeddings

    except httpx.TimeoutException:
        if retry_count >= MAX_RETRIES:
            raise HTTPException(
                status_code=504,
                detail=f"Timeout after {MAX_RETRIES} retries"
            )
        
        delay = min(INITIAL_RETRY_DELAY * (2 ** retry_count), MAX_RETRY_DELAY)
        await asyncio.sleep(delay)
        return await get_openrouter_embeddings_with_retry(texts, retry_count + 1)
    
    except Exception as e:
        if retry_count < MAX_RETRIES:
            delay = min(INITIAL_RETRY_DELAY * (2 ** retry_count), MAX_RETRY_DELAY)
            await asyncio.sleep(delay)
            return await get_openrouter_embeddings_with_retry(texts, retry_count + 1)
        raise


# ============================================================
# GET CURRENT TASK ID (Context)
# ============================================================

_current_task_id = None

def get_current_task_id() -> Optional[str]:
    return _current_task_id

def set_current_task_id(task_id: Optional[str]):
    global _current_task_id
    _current_task_id = task_id


# ============================================================
# GET CHROMA COLLECTION
# ============================================================

def get_insurance_collection():
    return chroma_client.get_or_create_collection(
        name=INSURANCE_COLLECTION_NAME,
        metadata={
            "hnsw:space": "cosine",
            "description": "Insurance claims RAG using ICD description + service code + service description"
        }
    )


# ============================================================
# CONVERT EXCEL ROW TO METADATA
# ============================================================

def insurance_row_to_metadata(row: pd.Series, excel_row_number: int) -> Dict[str, Any]:
    metadata = {
        "excel_row": excel_row_number,
        "s_no": safe_value(row.get("S.NO")),
        "invoice_no": safe_value(row.get("INVOICE NO.")),
        "member_name": safe_value(row.get("MEMBER NAME")),
        "member_id": safe_value(row.get("MEMBER ID")),
        "preapproval_no": safe_value(row.get("PREAPPROVAL NO.")),
        "icd_description": safe_value(row.get("ICD DESCRIPTION")),
        "principal_icd_code": safe_value(row.get("PRINCIPAL ICD CODE")),
        "secondary_icd_code_1": safe_value(row.get("SECONDARY ICD CODE 1")),
        "secondary_icd_code_2": safe_value(row.get("SECONDARY ICD CODE 2")),
        "secondary_icd_code_3": safe_value(row.get("SECONDARY ICD CODE 3")),
        "secondary_icd_code_4": safe_value(row.get("SECONDARY ICD CODE 4")),
        "secondary_icd_code_5": safe_value(row.get("SECONDARY ICD CODE 5")),
        "symptoms": safe_value(row.get("SYMPTOMS")),
        "internal_service_code": safe_value(row.get("INTERNAL  SERVICE CODE")),
        "service_description": safe_value(row.get("SERVICE DESCRIPTION")),
        "cpt_code": safe_value(row.get("CPT CODE")),
        "activity_type": safe_value(row.get("ACTIVITY TYPE")),
        "status": safe_value(row.get("STATUS")),
        "amount_claimed": safe_value(row.get("AMOUNT CLAIMED")),
        "quantity": safe_value(row.get("QUANTITY")),
        "tariff_amount": safe_value(row.get("TARIFF AMOUNT")),
        "discount_amount": safe_value(row.get("DISCOUNT AMOUNT")),
        "patient_share": safe_value(row.get("PATIENT SHARE")),
        "disallowed_amount": safe_value(row.get("DISALLOWED AMOUNT")),
        "denial_reason": safe_value(row.get("DENIAL REASON")),
        "approved_amount": safe_value(row.get(" APPROVED AMOUNT")),
        "final_remarks": safe_value(row.get("FINAL REMARKS")),
        "payment_reference_number": safe_value(row.get("PAYMENT REFERENCE NUMBER")),
        "payment_date": safe_value(row.get("PAYMENT DATE")),
        "payment_status": safe_value(row.get("PAYMENT STATUS ")),
        "provider_name": safe_value(row.get("Provider Name")),
        "provider_invoice_number": safe_value(row.get("PROVIDER INVOICE NUMBER")),
        "claim_number": safe_value(row.get("CLAIM NUMBER")),
        "batch_number": safe_value(row.get("BATCH NUMBER")),
        "mode_of_claim": safe_value(row.get("MODE OF CLAIM")),
        "benefit_type": safe_value(row.get("BENEFIT TYPE")),
        "encounter_type": safe_value(row.get("ENCOUNTER TYPE")),
        "system_of_medicine": safe_value(row.get("SYSTEM OF MEDICINE")),
        "date_of_treatment": safe_value(row.get("DATE OF TREATMENT /ADMISSION")),
        "date_of_discharge": safe_value(row.get("DATE OF DISCHARGE")),
        "service_date": safe_value(row.get("SERVICE DATE")),
        "submitted_date": safe_value(row.get("SUBMITTED DATE")),
        "policy_no": safe_value(row.get("POLICY NO")),
        "corporate_group_name": safe_value(row.get("CORPORATE / GROUP NAME")),
        "empanelment_id": safe_value(row.get("EMPANELMENT ID"))
    }
    return metadata


# ============================================================
# PARSE AMOUNT
# ============================================================

def parse_amount(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        text = str(value).strip()
        if not text:
            return None
        text = text.replace(",", "").replace("₹", "")
        return float(text)
    except (ValueError, TypeError):
        return None


# ============================================================
# DETERMINE CLAIM APPROVAL
# ============================================================

def get_claim_approval(metadata: Dict[str, Any]) -> str:
    approved_amount = parse_amount(metadata.get("approved_amount"))
    if approved_amount is None:
        return "UNKNOWN"
    if approved_amount > 0:
        return "APPROVED"
    return "NOT_APPROVED"


# ============================================================
# INDEX INSURANCE CLAIMS (BACKGROUND TASK)
# ============================================================

async def index_insurance_claims_background(
    task_id: str,
    force_reindex: bool = False
):
    """
    Background task to index insurance claims with rate limiting.
    """
    global _current_task_id
    
    try:
        # Set current task ID for status updates
        set_current_task_id(task_id)
        
        # Update status: started
        _task_status[task_id] = {
            "status": "processing",
            "message": "Indexing started",
            "progress": 0,
            "total_rows": 0,
            "processed_rows": 0,
            "skipped_rows": 0,
            "error": None
        }

        # Get collection
        collection = get_insurance_collection()
        
        existing_count = collection.count()
        
        if existing_count > 0 and not force_reindex:
            _task_status[task_id] = {
                "status": "completed",
                "message": "Already indexed",
                "documents_indexed": existing_count,
                "rows_skipped": 0,
                "progress": 100
            }
            return

        # Delete old collection if force reindex
        if force_reindex:
            try:
                chroma_client.delete_collection(name=INSURANCE_COLLECTION_NAME)
            except Exception:
                pass
            collection = get_insurance_collection()
            _task_status[task_id]["message"] = "Deleted old collection"

        # Check file
        if not os.path.exists(INSURANCE_EXCEL_PATH):
            _task_status[task_id] = {
                "status": "failed",
                "message": f"Excel file not found: {INSURANCE_EXCEL_PATH}",
                "error": "FileNotFoundError"
            }
            return

        # Read Excel
        try:
            df = pd.read_excel(INSURANCE_EXCEL_PATH)
        except Exception as e:
            _task_status[task_id] = {
                "status": "failed",
                "message": f"Failed to read Excel: {str(e)}",
                "error": str(e)
            }
            return

        # Required RAG columns
        required_columns = [
            "ICD DESCRIPTION",
            "INTERNAL  SERVICE CODE",
            "SERVICE DESCRIPTION"
        ]
        
        missing = [col for col in required_columns if col not in df.columns]
        
        if missing:
            _task_status[task_id] = {
                "status": "failed",
                "message": f"Missing columns: {missing}",
                "error": "MissingColumnsError",
                "available_columns": list(df.columns)
            }
            return

        # Build documents
        rows = []
        skipped_rows = 0
        total_rows = len(df)
        
        _task_status[task_id]["total_rows"] = total_rows
        
        for dataframe_index, row in df.iterrows():
            rag_row = row.to_dict()
            document = build_insurance_rag_text(rag_row)
            
            # Skip rows where all three RAG values are empty
            icd_value = safe_value(row.get("ICD DESCRIPTION"))
            service_code_value = safe_value(row.get("INTERNAL  SERVICE CODE"))
            service_description_value = safe_value(row.get("SERVICE DESCRIPTION"))
            
            if not (icd_value or service_code_value or service_description_value):
                skipped_rows += 1
                continue
            
            # Historical claim metadata
            metadata = insurance_row_to_metadata(
                row,
                excel_row_number=dataframe_index + 2
            )
            
            # Claim number
            claim_number = safe_value(row.get("CLAIM NUMBER"))
            if not claim_number:
                claim_number = f"excel_row_{dataframe_index + 2}"
            
            # Chroma ID
            chroma_id = f"insurance_{dataframe_index}_{claim_number}"
            
            rows.append((chroma_id, document, metadata))
            
            # Update progress every 100 rows
            if len(rows) % 100 == 0:
                _task_status[task_id]["processed_rows"] = len(rows)
                _task_status[task_id]["progress"] = int((len(rows) / total_rows) * 50)

        # Embedding batches with rate limiting
        batch_size = RATE_LIMIT_BATCH_SIZE  # Use smaller batch size
        total_rows_to_index = len(rows)
        
        _task_status[task_id]["message"] = f"Indexing {total_rows_to_index} rows with embeddings"
        _task_status[task_id]["progress"] = 50
        
        failed_batches = []
        
        for start in range(0, total_rows_to_index, batch_size):
            batch = rows[start:start + batch_size]
            
            batch_documents = [item[1] for item in batch]
            
            try:
                # Use retry logic for embeddings
                embeddings = await get_openrouter_embeddings_with_retry(batch_documents)
                
                batch_ids = [item[0] for item in batch]
                batch_metadata = [item[2] for item in batch]
                
                collection.add(
                    ids=batch_ids,
                    documents=batch_documents,
                    embeddings=embeddings,
                    metadatas=batch_metadata
                )
                
                # Update progress
                processed = min(start + batch_size, total_rows_to_index)
                progress = int((processed / total_rows_to_index) * 50) + 50
                _task_status[task_id]["processed_rows"] = processed
                _task_status[task_id]["progress"] = progress
                _task_status[task_id]["message"] = f"Indexing {processed}/{total_rows_to_index} rows"
                
                # Add delay between batches to prevent rate limiting
                if start + batch_size < total_rows_to_index:
                    await asyncio.sleep(BATCH_DELAY)
                    
            except Exception as e:
                failed_batches.append({
                    "batch_start": start,
                    "batch_size": len(batch),
                    "error": str(e)
                })
                
                # If too many failures, stop
                if len(failed_batches) > 3:
                    _task_status[task_id] = {
                        "status": "failed",
                        "message": f"Too many failures ({len(failed_batches)} batches)",
                        "error": str(e),
                        "progress": progress,
                        "failed_batches": failed_batches
                    }
                    return
                
                # Continue with next batch
                _task_status[task_id]["message"] = (
                    f"Batch {start//batch_size + 1} failed, continuing... "
                    f"({len(failed_batches)} failures)"
                )
                await asyncio.sleep(BATCH_DELAY * 2)

        # Complete
        _task_status[task_id] = {
            "status": "completed",
            "message": "Indexing completed successfully",
            "documents_indexed": total_rows_to_index,
            "rows_skipped": skipped_rows,
            "total_rows": total_rows,
            "progress": 100,
            "embedding_model": EMBEDDING_MODEL,
            "collection": INSURANCE_COLLECTION_NAME,
            "chroma_directory": _CHROMA_DIR,
            "excel_file": INSURANCE_EXCEL_PATH,
            "rag_columns": required_columns,
            "failed_batches": failed_batches if failed_batches else None
        }
        
    except Exception as e:
        _task_status[task_id] = {
            "status": "failed",
            "message": f"Indexing failed: {str(e)}",
            "error": str(e),
            "progress": _task_status.get(task_id, {}).get("progress", 0)
        }
    finally:
        # Clear current task ID
        set_current_task_id(None)


# ============================================================
# SEARCH INSURANCE RAG
# ============================================================

async def search_insurance_rag(
    patient_id: str,
    icd_description: str,
    service_description: str,
    service_code: Optional[str] = None,
    top_k: Optional[int] = 10,
    similarity_threshold: Optional[float] = None
):
    try:
        if not icd_description:
            raise HTTPException(status_code=400, detail="icd_description is required")
        
        if not service_description:
            raise HTTPException(status_code=400, detail="service_description is required")
        
        threshold = similarity_threshold if similarity_threshold is not None else DEFAULT_SIMILARITY_THRESHOLD
        
        if threshold < 0 or threshold > 1:
            raise HTTPException(status_code=400, detail="similarity_threshold must be between 0 and 1")
        
        query_text = build_insurance_query(
            icd_description=icd_description,
            service_description=service_description,
            service_code=service_code
        )
        
        query_embedding = await get_openrouter_embeddings_with_retry([query_text])
        query_embedding = query_embedding[0]
        
        collection = get_insurance_collection()
        total_documents = collection.count()
        
        if total_documents == 0:
            return {
                "status": "success",
                "patient_id": patient_id,
                "query": {
                    "icd_description": icd_description,
                    "service_code": service_code,
                    "service_description": service_description
                },
                "total_matches": 0,
                "matches": [],
                "message": "Insurance claims have not been indexed"
            }
        
        n_results = total_documents if (top_k is None or top_k <= 0) else min(int(top_k), total_documents)
        
        search_result = collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results,
            include=["documents", "metadatas", "distances"]
        )
        
        documents = search_result.get("documents", [[]])[0]
        metadatas = search_result.get("metadatas", [[]])[0]
        distances = search_result.get("distances", [[]])[0]
        ids = search_result.get("ids", [[]])[0]
        
        matches = []
        for i in range(len(documents)):
            metadata = metadatas[i] if i < len(metadatas) else {}
            document = documents[i] if i < len(documents) else ""
            distance = distances[i] if i < len(distances) else None
            claim_id = ids[i] if i < len(ids) else None
            
            similarity = None
            if distance is not None:
                similarity = max(0.0, min(1.0, 1.0 - float(distance)))
            
            if similarity is not None and similarity < threshold:
                continue
            
            approval = get_claim_approval(metadata)
            
            matches.append({
                "rank": len(matches) + 1,
                "claim_id": claim_id,
                "similarity": round(similarity, 4) if similarity is not None else None,
                "approval": approval,
                "claim": metadata,
                "rag_document": document
            })
        
        approved_count = sum(1 for m in matches if m["approval"] == "APPROVED")
        not_approved_count = sum(1 for m in matches if m["approval"] == "NOT_APPROVED")
        unknown_count = sum(1 for m in matches if m["approval"] == "UNKNOWN")
        
        decided_count = approved_count + not_approved_count
        approval_rate = round((approved_count / decided_count) * 100, 2) if decided_count > 0 else None
        
        return {
            "status": "success",
            "patient_id": patient_id,
            "query": {
                "icd_description": icd_description,
                "service_code": service_code,
                "service_description": service_description
            },
            "search": {
                "embedding_model": EMBEDDING_MODEL,
                "rag_columns": ["ICD DESCRIPTION", "INTERNAL  SERVICE CODE", "SERVICE DESCRIPTION"],
                "similarity_threshold": threshold,
                "requested_top_k": top_k,
                "indexed_documents": total_documents
            },
            "summary": {
                "matched_claims": len(matches),
                "approved": approved_count,
                "not_approved": not_approved_count,
                "unknown": unknown_count,
                "historical_approval_rate": approval_rate
            },
            "matches": matches
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Insurance RAG search failed: {str(e)}"
        )


# ============================================================
# GET TASK STATUS
# ============================================================

@router.get("/insurance-rag/status/{task_id}")
async def get_indexing_status(task_id: str):
    if task_id not in _task_status:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    
    return {
        "task_id": task_id,
        **_task_status[task_id]
    }


# ============================================================
# LIST ALL TASKS
# ============================================================

@router.get("/insurance-rag/tasks")
async def list_indexing_tasks():
    return {
        "tasks": [
            {
                "task_id": task_id,
                "status": status.get("status"),
                "message": status.get("message"),
                "progress": status.get("progress", 0),
                "created_at": status.get("created_at")
            }
            for task_id, status in _task_status.items()
        ]
    }


# ============================================================
# INSURANCE SEARCH ENDPOINT
# ============================================================

@router.post("/insurance-rag/search")
async def insurance_rag_search(request: InsuranceRAGRequest):
    return await search_insurance_rag(
        patient_id=request.patient_id,
        icd_description=request.icd_description,
        service_description=request.service_description,
        service_code=request.service_code,
        top_k=request.top_k,
        similarity_threshold=request.similarity_threshold
    )


# ============================================================
# INSURANCE INDEX ENDPOINT (WITH BACKGROUND TASK)
# ============================================================

@router.post("/insurance-rag/index")
async def index_insurance_rag(
    background_tasks: BackgroundTasks,
    force_reindex: bool = False
):
    task_id = str(uuid.uuid4())
    
    _task_status[task_id] = {
        "status": "queued",
        "message": "Task queued for processing",
        "progress": 0,
        "created_at": pd.Timestamp.now().isoformat()
    }
    
    background_tasks.add_task(
        index_insurance_claims_background,
        task_id=task_id,
        force_reindex=force_reindex
    )
    
    return {
        "status": "queued",
        "message": "Indexing started in background",
        "task_id": task_id,
        "check_status_url": f"/insurance-rag/status/{task_id}",
        "force_reindex": force_reindex
    }


# ============================================================
# INSURANCE HEALTH CHECK ENDPOINT
# ============================================================

@router.get("/insurance-rag/health")
async def insurance_rag_health_check():
    try:
        collection = get_insurance_collection()
        doc_count = collection.count()
        
        return {
            "status": "healthy",
            "document_count": doc_count,
            "collection_name": INSURANCE_COLLECTION_NAME,
            "chroma_directory": _CHROMA_DIR,
            "embedding_model": EMBEDDING_MODEL,
            "is_indexed": doc_count > 0
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e)
        }


# ============================================================
# CLEAR TASK STATUS
# ============================================================

@router.delete("/insurance-rag/tasks/{task_id}")
async def clear_task_status(task_id: str):
    if task_id not in _task_status:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    
    task_status = _task_status.pop(task_id)
    
    return {
        "message": f"Task {task_id} cleared",
        "task": task_status
    }


# ============================================================
# RETRY FAILED TASK (Resume from where it left off)
# ============================================================

@router.post("/insurance-rag/retry/{task_id}")
async def retry_failed_task(
    background_tasks: BackgroundTasks,
    task_id: str
):
    """
    Retry a failed indexing task.
    """
    if task_id not in _task_status:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    
    task = _task_status[task_id]
    
    if task["status"] != "failed":
        raise HTTPException(
            status_code=400,
            detail=f"Task {task_id} is not in failed state (current status: {task['status']})"
        )
    
    # Update status to queued
    _task_status[task_id] = {
        "status": "queued",
        "message": "Retry queued",
        "progress": task.get("progress", 0),
        "created_at": pd.Timestamp.now().isoformat(),
        "original_progress": task.get("progress", 0)
    }
    
    # Queue the retry
    background_tasks.add_task(
        index_insurance_claims_background,
        task_id=task_id,
        force_reindex=False  # Don't force reindex, continue from where it left off
    )
    
    return {
        "status": "queued",
        "message": "Retry started",
        "task_id": task_id,
        "check_status_url": f"/insurance-rag/status/{task_id}"
    }