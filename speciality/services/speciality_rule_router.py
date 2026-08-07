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
    doctor_id: str,
    patient_id: str
):
    """
    Fetch all processed documents
    belonging to one patient and doctor
    """

    query = {
        "doctor_id": doctor_id,
        "patient_id": patient_id
    }


    documents = await processed_documents_collection.find(
        query
    ).to_list(None)


    return documents



async def extract_patient_documents_text(
    doctor_id: str,
    patient_id: str
):


    documents = await get_patient_processed_documents(
        doctor_id,
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


                "doctor_id":
                doctor_id,


                "document_id":
                document_id,


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


                "doctor_id":
                doc["doctor_id"],


                "text":
                chunk

                }
            )


    return chunks



OPENROUTER_API_KEY = os.getenv("OPENAI_API_ROUTER_KEY", "")
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
    doctor_id,
    patient_id
):


    documents = await extract_patient_documents_text(
        doctor_id,
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


async def store_patient_rag(
    doctor_id,
    patient_id
):


    collection_key = (
        f"{doctor_id}_{patient_id}"
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
        doctor_id,
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


                "doctor_id":
                d["doctor_id"]

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


def _call_llm_sync(prompt: str) -> str:

    response = groq_client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an expert oncology clinical assistant. "
                    "Answer only using the provided clinical context. "
                    "Do not make up facts. "
                    "If the answer is not present in the context, reply: "
                    "'I could not find enough information in the available patient summaries.'"
                )
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        temperature=0.2,
        max_tokens=5000
    )

    return response.choices[0].message.content.strip()


async def call_llm(prompt: str) -> str:
    return await asyncio.to_thread(_call_llm_sync, prompt)


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
    doctor_id,
    patient_id,
    question,
    top_k=5,
    fetch_k=30
):


    collection_key = f"{doctor_id}_{patient_id}"

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

        all_data = collection.get(include=["documents"])
        all_ids = all_data["ids"]
        all_texts = all_data["documents"]

        # Collection exists but is empty (e.g. a previous build
        # failed partway) - treat same as "not built yet".
        if not all_ids:
            raise ValueError("Empty collection")

    except Exception:

        # Not built yet (or empty/corrupt) - build it now instead
        # of requiring a separate /patient-rag/build call.
        build_result = await store_patient_rag(
            doctor_id,
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

        all_data = collection.get(include=["documents"])
        all_ids = all_data["ids"]
        all_texts = all_data["documents"]

    bm25 = _build_bm25_index(all_texts)
    bm25_ranked_ids = _bm25_rank(bm25, all_ids, question)[:fetch_k]


    query_embedding = (
        await embed_texts(
            [question]
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

    id_to_text = dict(zip(all_ids, all_texts))
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

@router.post(
"/patient-rag/build/{doctor_id}/{patient_id}"
)
async def build_patient_rag(
    doctor_id:str,
    patient_id:str
):

    return await store_patient_rag(
        doctor_id,
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
    docs = await get_patient_processed_documents(doctor_id, patient_id)
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
    extracted = await extract_patient_documents_text(doctor_id, patient_id)
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
    collection_hash = hashlib.md5(f"{doctor_id}_{patient_id}".encode()).hexdigest()
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

        request.doctor_id,

        request.patient_id,

        request.question,

        request.top_k

    )