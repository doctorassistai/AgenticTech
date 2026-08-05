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
from ai_service.guardian_layer.clinical_safety_rules_engine import ( run_clinical_safety_rules_engine )
from ai_service.guardian_layer.hallucination_cross_check import HallucinationCheckLayer
from ai_service.guardian_layer.factuality_confidence_scorer import FactualityConfidenceScorer
from ai_service.guardian_layer.guideline_checker import (
    DynamicGuidelineAlignmentLayer
)
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



hallucination_layer = HallucinationCheckLayer(llm_client=groq_client)
guideline_layer = DynamicGuidelineAlignmentLayer(
    llm_client=groq_client
)

quality_scorer = FactualityConfidenceScorer(
    groq_api_key=api_key,
    model="llama-3.1-8b-instant"
)

################################################################################STARTS################################################

#################################################################################PATIENT REGISTERATION TEST STARTS#################################################################################

# important should remove later
current_user = {}
current_user["sys_user_id"] = "rem_unknown_id"
current_user["role"] = "rem_unknown_type"


################################################################################PATIENT REGISTERATION TEST ENDS#################################################################################



def safe_json_extract(text: str):
    """
    Extract first valid JSON object from LLM output.
    """
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError("No JSON object found in LLM output")

    return json.loads(match.group())




@router.post("/execute-feature")
async def execute_feature_llm(request: Request):
    """
    Universal LLM execution engine for ALL clinical features.

    Modes:
    1️⃣ Structured Mode → selected_output_categories provided
    2️⃣ Narrative Mode  → selected_output_categories missing or empty

    Output is ALWAYS under:
    {
      "status": "success",
      "feature_id": "...",
      "feature_name": "...",
      "data": ...
    }
    """

    # ----------------------------------------------------
    # 1️⃣ Parse Input
    # ----------------------------------------------------
    payload = await request.json()
    # logger.info("Received feature execution request: %s", payload)
    feature_id = payload.get("feature_id")
    feature_name = payload.get("feature_name")
    rules = payload.get("rules", "")
    selected_output_categories = payload.get("selected_output_categories")
    data_sources = payload.get("data_sources", [])
    data_fetched = payload.get("data_fetched", [])
    patient_context = payload.get("patient_context", {})
    # print( request.headers.get("x-trace-id"), request.headers.get("x-client-ip"),  request.headers.get("x-user-id"), request.headers.get("x-user-role"))

    if not feature_id or not feature_name:
        raise HTTPException(
            status_code=400,
            detail="feature_id and feature_name are required"
        )

    
    
    # ----------------------------------------------------
    # 🔴 REDIS CACHE CHECK (BEFORE LLM)
    # ----------------------------------------------------

    cache_payload = {
        "feature_id": feature_id,
        "feature_name": feature_name,
        "rules": rules,
        "selected_output_categories": selected_output_categories,
        "data_fetched": data_fetched,
        "patient_context": patient_context
    }

    cache_key = build_cache_key(cache_payload)

    cached_response = await get_cache(redis_client, cache_key)
    if cached_response:
        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="INFO",
            source={"service": "ai_service", "component": "nodes_llm"},
            actor={
                "type": request.headers.get("x-user-role"),
                "id": request.headers.get("x-user-id")
            },
            context={
                "trace_id": request.headers.get("x-trace-id"),
                "ip": request.headers.get("x-client-ip"),
                "endpoint": "/execute-feature",
                "method": "POST",
                "feature_id": feature_id,
                "feature_name": feature_name
            },
            clinical_context={},
            action={
                "type": "FEATURE_EXECUTION_CACHE_HIT",
                "status": "SUCCESS"
            }
        ))
        logger.info("Cache HIT for feature %s", feature_id)
        return cached_response
    else:
        logger.info("Cache MISS for feature %s", feature_id)

    # ----------------------------------------------------
    # 🔴 REDIS CACHE end (BEFORE LLM)
    # ----------------------------------------------------

    structured_mode = bool(
        selected_output_categories and isinstance(selected_output_categories, list)
    )

    # ----------------------------------------------------
    # 2️⃣ SYSTEM PROMPT (GLOBAL — NEVER CHANGES)
    # ----------------------------------------------------
    SYSTEM_PROMPT = """
You are a senior clinical data analysis engine.

Your role is to perform FEATURE-DRIVEN CLINICAL ANALYSIS
using ONLY the structured data explicitly provided.

You MUST:
- Follow the feature intent defined by the feature name and rules
- Use appropriate clinical terminology
- Express findings as objective clinical observations

GLOBAL SAFETY RULES:
- Do NOT diagnose conditions
- Do NOT predict outcomes or risks
- Do NOT recommend treatments or actions
- Do NOT assign severity, probability, or urgency
- Do NOT infer missing or unstated data
- Do NOT introduce external medical knowledge
- Do NOT repeat raw values excessively

ANALYSIS RULES:
- Identify patterns, trends, variability, and consistency
- Respect temporal ordering when timestamps are present
- Correlate findings ONLY if supported by data
- If evidence is insufficient, produce no observation

ANALYSIS DEPTH RULES:
- Perform comprehensive, feature-aligned analysis using ALL relevant data provided
- Observations MUST represent completed reasoning, not partial summaries
- Integrate multiple related data elements when available
- Include relevant clinical values, ranges, or comparisons WHEN they strengthen interpretation
- Avoid listing raw values without explanation
- The level and type of analysis MUST be guided by the feature intent and rules
- If data volume is large, prioritize clinically significant findings
- If analysis is limited by missing data, state the limitation explicitly without inference

OUTPUT RULES:
- Output MUST strictly follow the requested format
- Do NOT add extra keys
- Do NOT include explanations or markdown
"""



    # ----------------------------------------------------
    # 3️⃣ BUILD USER PROMPT (STRUCTURED vs NARRATIVE)
    # ----------------------------------------------------
    if structured_mode:
        user_prompt = f"""
            FEATURE CONTEXT
            ---------------
            Feature ID: {feature_id}
            Feature Name: {feature_name}

            FEATURE INTENT & RULES
            ---------------------
            {rules}

            Interpret the data strictly according to this feature.

            PATIENT CONTEXT
            ---------------
            Age: {patient_context.get("age")}
            Gender: {patient_context.get("gender")}

            AVAILABLE DATA SOURCES
            ----------------------
            {json.dumps(data_sources, indent=2)}

            DATA FOR ANALYSIS
            ----------------
            {json.dumps(data_fetched, indent=2)}

            ANALYSIS INSTRUCTIONS
            ---------------------
            - Thoroughly analyze ALL relevant provided data before generating observations
            - Each observation should represent a complete analytical conclusion
            - Combine related findings into coherent clinical statements
            - Use clinical values, reference ranges, or comparisons where they improve clarity
            - Explain what the values indicate in context, not just that they exist
            - Use precise clinical terminology and professional tone
            - Avoid speculation or assumptions beyond the data

            OUTPUT REQUIREMENTS (STRICT)
            ----------------------------
            Return ONE JSON object with ONLY the following keys:

            {json.dumps(selected_output_categories, indent=2)}

            Rules:
            - Each key MUST map to an ARRAY OF STRINGS
            - Each string MUST be a detailed, multi-clause analytical statement
            - Statements SHOULD include relevant values or ranges when meaningful
            - Avoid one-line restatements of single data points
            - If no meaningful analysis can be produced, return an empty array
            - Do NOT add extra keys or nested objects
            - Do NOT include text outside JSON


            REQUIRED OUTPUT FORMAT:
            {{
            "<category_name>": [
                "Observation text 1",
                "Observation text 2"
            ]
            }}
            """

    else:
        user_prompt = f"""
            FEATURE CONTEXT
            ---------------
            Feature ID: {feature_id}
            Feature Name: {feature_name}

            FEATURE INTENT & RULES
            ---------------------
            {rules}

            PATIENT CONTEXT
            ---------------
            Age: {patient_context.get("age")}
            Gender: {patient_context.get("gender")}

            AVAILABLE DATA SOURCES
            ----------------------
            {json.dumps(data_sources, indent=2)}

            DATA FOR ANALYSIS
            ----------------
            {json.dumps(data_fetched, indent=2)}

            ANALYSIS INSTRUCTIONS
            ---------------------
            - Perform a comprehensive feature-aligned analysis
            - Use appropriate clinical terminology
            - Maintain neutral, observational tone
            - No diagnosis, prediction, or recommendations

            OUTPUT REQUIREMENTS
            -------------------
            Return a SINGLE detailed analytical narrative as plain text.
            Return ONLY the analysis text.
            """

    # ----------------------------------------------------
    # 🔴 PROMPT INJECTION DETECTION
    # ----------------------------------------------------

    detector = PromptInjectionDetector()

    injection_result = detector.evaluate(user_prompt)

    # print(injection_result)

    sanitizer = InputSanitizer()

    if injection_result["is_injection"]:
        sanitized = sanitizer.sanitize(user_prompt)
        final_input = sanitized["sanitized_input"]
        safety_mode = "max"
    else:
        final_input = user_prompt
        safety_mode = "normal"

    # print("SANITIZED PROMPT:", final_input)
    # print("SAFETY MODE:", safety_mode)
    # ----------------------------------------------------
    # 4️⃣ LLM CALL
    # ----------------------------------------------------

    response = groq_client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0.2
    )

    raw_output = response.choices[0].message.content.strip()

    # After feature LLM execution
    llm_text_output = raw_output

    # safety_output_categories = [
    #     "lab_abnormalities",
    #     "dose_out_of_range",
    #     "contradiction_findings",
    #     "red_flag_observations"
    # ]

    # try:
    #     clinical_safety = await run_clinical_safety_rules_engine(
    #         llm_output_text=llm_text_output,
    #         raw_patient_data={
    #             "patient_context": patient_context
    #         },
    #         output_categories=safety_output_categories
    #     )
    # except Exception as e:
    #     logger.error("Safety rules engine failed: %s", str(e))
    #     clinical_safety = {k: [] for k in safety_output_categories}

    # print("CLINICAL SAFETY FINDINGS:", clinical_safety)

    # ----------------------------------------------------
    # 5️⃣ OUTPUT NORMALIZATION
    # ----------------------------------------------------
    if structured_mode:
        try:
            try:
                llm_json = safe_json_extract(raw_output)
            except Exception as e:
                emit_audit(request.app, AuditEvent(
                    timestamp=datetime.utcnow(),
                    level="ERROR",
                    source={"service": "ai_service", "component": "nodes_llm"},
                    actor={
                        "type": request.headers.get("x-user-role"),
                        "id": request.headers.get("x-user-id")
                    },
                    context={
                        "trace_id": request.headers.get("x-trace-id"),
                        "ip": request.headers.get("x-client-ip"),
                        "endpoint": "/execute-feature",
                        "method": "POST",
                        "feature_id": feature_id,
                        "feature_name": feature_name
                    },
                    clinical_context={},
                    action={
                        "type": "FEATURE_EXECUTION_INVALID_JSON",
                        "status": "FAIL"
                    }
                ))
                raise HTTPException(
                    status_code=500,
                    detail=f"Invalid JSON from LLM: {str(e)}"
                )
        except json.JSONDecodeError:
            emit_audit(request.app, AuditEvent(
                timestamp=datetime.utcnow(),
                level="ERROR",
                source={"service": "ai_service", "component": "nodes_llm"},
                actor={
                    "type": request.headers.get("x-user-role"),
                    "id": request.headers.get("x-user-id")
                },
                context={
                    "trace_id": request.headers.get("x-trace-id"),
                    "ip": request.headers.get("x-client-ip"),
                    "endpoint": "/execute-feature",
                    "method": "POST",
                    "feature_id": feature_id,
                    "feature_name": feature_name
                },
                clinical_context={},
                action={
                    "type": "FEATURE_EXECUTION_INVALID_JSON",
                    "status": "FAIL"
                }
            ))
            raise HTTPException(
                status_code=500,
                detail="LLM returned invalid JSON"
            )

        data_output = {
            category: llm_json.get(category, [])
            for category in selected_output_categories
        }
    else:
        data_output = {
            "analysis_text": raw_output
        }
        
    # ----------------------------------------------------
    # 5️⃣ Guardian Layers
    # ----------------------------------------------------
    # hallucination_result = hallucination_layer.run(data_output)

    # if hallucination_result["status"] == "FAIL":
    #     raise HTTPException(
    #         status_code=400,
    #         detail={
    #             "layer": hallucination_result["layer"],
    #             "issues": hallucination_result["fallback_result"]["issues"]
    #         }
    #     )

    # judge_verdict = hallucination_result["result"]["verdict"]

    # if judge_verdict == "FAIL":
    #     raise HTTPException(
    #         status_code=400,
    #         detail={
    #             "layer": hallucination_result["layer"],
    #             "issues": hallucination_result["result"]["issues"]
    #         }
    #     )
    # print("HALLUCINATION LAYER PASSED, Result:", hallucination_result["result"])

    # ----------------------------------------------------
    # print("Data Output before Guideline Layer:", data_output)
    # guideline_result = guideline_layer.run(
    #                                             condition="general",     # DEFAULT SAFE MODE
    #                                             clinical_output=data_output
    #                                         )


    # # if guideline_result["status"] == "FAIL":
    # #     raise HTTPException(
    # #         status_code=400,
    # #         detail={
    # #             "layer": guideline_result["layer"],
    # #             "reason": guideline_result["reason"]
    # #         }
    # #     )

    # guideline_verdict = guideline_result["result"]["verdict"]

    # print("GUIDELINE LAYER VERDICT:", guideline_result)

    # if guideline_verdict == "FAIL":
    #     raise HTTPException(
    #         status_code=400,
    #         detail={
    #             "layer": guideline_result["layer"],
    #             "deviations": guideline_result["result"]["deviations"],
    #             "guideline": guideline_result["result"]["guideline_authority"]
    #         }
    #     )

    # if guideline_verdict == "WARN":
    #     logger.warning(
    #         "Guideline WARN (%s): %s",
    #         guideline_result["result"]["guideline_authority"],
    #         guideline_result["result"]["missing_points"]
    #     )

    # print("GUIDELINE LAYER PASSED, Result:", guideline_result["result"])

    # ----------------------------------------------------
    quality_scores = await quality_scorer.score(
        data_fetched=data_fetched,
        output_texts=(
            sum(data_output.values(), [])
            if structured_mode
            else [data_output["analysis_text"]]
        )
    )
    print("QUALITY SCORES:", quality_scores)
    # ----------------------------------------------------
    # 6️⃣ FINAL RESPONSE
    # ----------------------------------------------------
    final_response = {
        "status": "success",
        "feature_id": feature_id,
        "feature_name": feature_name,
        "user_prompt": user_prompt,
        "data": data_output
    }

    # ----------------------------------------------------
    # 🟢 STORE RESULT IN REDIS (AFTER LLM)
    # ----------------------------------------------------
    await set_cache(
        redis_client,
        cache_key,
        final_response,
        ttl=900  # 15 minutes
    )

    # ----------------------------------------------------
    # 🟢 STORE RESULT IN REDIS (AFTER LLM)
    # ----------------------------------------------------
    emit_audit(request.app, AuditEvent(
        timestamp=datetime.utcnow(),
        level="INFO",
        source={"service": "ai_service", "component": "nodes_llm"},
        actor={
            "type": request.headers.get("x-user-role"),
            "id": request.headers.get("x-user-id")
        },
        context={
            "trace_id": request.headers.get("x-trace-id"),
            "ip": request.headers.get("x-client-ip"),
            "endpoint": "/execute-feature",
            "method": "POST",
            "feature_id": feature_id,
            "feature_name": feature_name
        },
        clinical_context={},
        action={
            "type": "FEATURE_EXECUTION_COMPLETED",
            "status": "SUCCESS"
        }
    ))

    return final_response
