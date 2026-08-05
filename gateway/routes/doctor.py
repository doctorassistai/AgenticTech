from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, WebSocket, status, File, Form, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse, FileResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field, EmailStr, validator
from typing import Any, Dict, List, Optional, Union
from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, date, timedelta, timezone
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
import uuid
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
from gateway.middlewares.encryption import EncryptionService
from shared.audit.schema import AuditEvent
from shared.audit.utils import emit_audit

from gateway.middlewares.models import Users, Doctor, Nurse
from gateway.middlewares.encryption import encrypt_data, decrypt_data
from gateway.middlewares.utils import get_client_ip
from fastapi.encoders import jsonable_encoder


from dotenv import load_dotenv
import os

load_dotenv()
api_base_url = os.getenv("VITE_BACKEND_URL")
api_url = os.getenv("FRONTEND_URL")

router = APIRouter(
    prefix="/hms/users/doctors",
    tags=["doctor"],
    responses={404: {"description": "Not found"}},
)

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
stream_handler = logging.StreamHandler(sys.stdout)
log_formatter = logging.Formatter("%(asctime)s [%(processName)s: %(process)d] [%(threadName)s: %(thread)d] [%(levelname)s] %(name)s: %(message)s")
stream_handler.setFormatter(log_formatter)
logger.addHandler(stream_handler)

logger.info('API is starting up')

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"
SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
ACCESS_TOKEN_EXPIRE_DAYS = int(os.getenv("ACCESS_TOKEN_EXPIRE_DAYS", 1))

mongodb_client = AsyncIOMotorClient(MONGO_URI)  # async (Motor)
database = mongodb_client[MONGO_DB]

client = MongoClient(MONGO_URI)  # sync (PyMongo)
db = client[MONGO_DB]

user_auth_collection = db["user_auth"]

hospital_user_collection = db["hospital_users"]
structured_note_rule_collection = db["structured_note_admin_rules"]
doctor_user_collection = db["doctor_users"]

nurse_user_collection = db["nurse_users"]

patient_user_collection = db["patient_users"]
medical_current_rule_collection = db["medical_current_admin_rules"]
patient_appointments_collection = db["patient_appointments"]

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

status_appointment_collection = db["status_appointment"]
context_rule_collection = db["context_admin_rules"]
#######################################################################Doctor Skills Doctor Details Collection#######################################################################
doctor_details_collection = database["doctor_details"]


#################################################################################PATIENT REGISTERATION TEST STARTS#################################################################################
doctor_rule_agent_collection = db["doctor_rule_agent"]

admin_rule_agent_collection = db["admin_rule_agent"]

quality_admin_collection = db["quality_admin"]
field_officer_collection = db["field_officer"]
# important should remove later
current_user = {}
current_user["sys_user_id"] = "rem_unknown_id"
current_user["role"] = "rem_unknown_type"

def get_current_user(request: Request):
    token = request.cookies.get("access_token")

    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

        user_id: str = payload.get("sub")
        role: str = payload.get("role")

        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")

        user = user_auth_collection.find_one({"sys_user_id": user_id})
        logger.info(f"Current User Retrieved: {user}")

        if not user:
            raise HTTPException(status_code=401, detail="User not found")

        return user

    except JWTError:
        raise HTTPException(
            status_code=401,
            detail="Token expired or invalid"
        )

def require_doctor(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "doctor":
        raise HTTPException(
            status_code=403,
            detail="Only doctors can access this resource"
        )
    return current_user

def get_logged_in_doctor(
    current_user: dict = Depends(require_doctor)
):
    doctor = doctor_user_collection.find_one(
        {"sys_user_id": current_user["sys_user_id"]}
    )

    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor profile not found")

    return doctor


################################################################################PATIENT REGISTERATION TEST ENDS#################################################################################




def generate_random_string(length=10):
    return ''.join(random.choices(string.ascii_letters + string.digits, k=length))

def hash_password(password: str):
    return pwd_context.hash(password)

def generate_doctor_id():
    return f"DOC-{uuid.uuid4()}"

def generate_nurse_id():
    return f"NUR-{uuid.uuid4()}"

def generate_quality_checker_id():
    return f"QUA-{uuid.uuid4()}"

def generate_field_officer_id():
    return f"FO-{uuid.uuid4()}"


def convert_mongo_document(doc):
    if not doc:
        return doc
    doc["_id"] = str(doc["_id"])
    return doc

def generate_doctor_id():
    return f"DOC-{uuid.uuid4()}"

@router.get("/verify")
async def verify_user(
    request: Request,
    doctor=Depends(get_logged_in_doctor),
    current_user=Depends(get_current_user),
):

    emit_audit(request.app, AuditEvent(
        timestamp=datetime.utcnow(),
        level="INFO",
        source={"service": "gateway", "component": "doctor_route"},
        actor={
            "type": current_user["role"],
            "id": current_user["sys_user_id"]
        },
        context={
            "trace_id": request.state.trace_id,
            "ip": get_client_ip(request),
            "endpoint": "/verify"
        },
        clinical_context={
            "data_sensitivity": "PHI",
            "hospital_id": doctor.get("hospital_id")
        },
        action={
            "type": "VERIFY_DOCTOR",
            "status": "SUCCESS",
            "doctor_sys_user_id": doctor["sys_user_id"]
        }
    ))
    return {
        "status": "authenticated",
        "user": {
            "sys_user_id": current_user["sys_user_id"],
            "role": current_user["role"]
        },
        "doctor": {
            "sys_user_id": doctor["sys_user_id"],
            "name": doctor["name"],
            "specialization": doctor["specialization"]
        }
    }

# @router.post("/doctoradd")
# async def doctor_add_post(request: Request, current_user=Depends(get_current_user)):
#     """
#     Create a Hospital Admin and insert into both MongoDB collections.
#     hospital_id is auto-generated using UUID: HSP-<uuid4>.
#     """
#     try:
#         data = await request.json()

#         logger.info("Doctor Registration Started")
        
#         username = data["username"]
#         email = data.get("email") or None
#         phone = data["phone_number"]

#         existing_username = user_auth_collection.find_one({"username": username})
#         if existing_username:
#             emit_audit(request.app, AuditEvent(
#                 timestamp=datetime.utcnow(),
#                 level="ERROR",
#                 source={"service": "gateway", "component": "doctor_route"},
#                 actor={
#                     "type": current_user["role"],
#                     "id": current_user["sys_user_id"]
#                 },
#                 context={
#                     "trace_id": request.state.trace_id,
#                     "ip": get_client_ip(request),
#                     "endpoint": "/doctoradd"
#                 },
#                 clinical_context={
#                     "data_sensitivity": "PHI",
#                     "hospital_id": data.get("hospital_id")
#                 },
#                 action={
#                     "type": "CREATE_DOCTOR",
#                     "status": "FAILED",
#                     "reason": f"Username '{username}' already exists"
#                 }
#             ))
#             return JSONResponse(
#                 status_code=400,
#                 content={
#                     "status": "error",
#                     "message": f"Username '{username}' already exists"
#                 }
#             )

#         if email != None:
#             existing_email = user_auth_collection.find_one({"email": email})
#             if existing_email:
#                 emit_audit(request.app, AuditEvent(
#                     timestamp=datetime.utcnow(),
#                     level="ERROR",
#                     source={"service": "gateway", "component": "doctor_route"},
#                     actor={
#                         "type": current_user["role"],
#                         "id": current_user["sys_user_id"]
#                     },
#                     context={
#                         "trace_id": request.state.trace_id,
#                         "ip": get_client_ip(request),
#                         "endpoint": "/doctoradd"
#                     },
#                     clinical_context={
#                         "data_sensitivity": "PHI",
#                         "hospital_id": data.get("hospital_id")
#                     },
#                     action={
#                         "type": "CREATE_DOCTOR",
#                         "status": "FAILED",
#                         "reason": f"Email '{email}' already exists"
#                     }
#                 ))
#                 return JSONResponse(
#                     status_code=400,
#                     content={
#                         "status": "error",
#                         "message": f"Email '{email}' already exists"
#                     }
#                 )

#         existing_phone = user_auth_collection.find_one({"phone_number": phone})
#         if existing_phone:
#             emit_audit(request.app, AuditEvent(
#                 timestamp=datetime.utcnow(),
#                 level="ERROR",
#                 source={"service": "gateway", "component": "doctor_route"},
#                 actor={
#                     "type": current_user["role"],
#                     "id": current_user["sys_user_id"]
#                 },
#                 context={
#                     "trace_id": request.state.trace_id,
#                     "ip": get_client_ip(request),
#                     "endpoint": "/doctoradd"
#                 },
#                 clinical_context={
#                     "data_sensitivity": "PHI",
#                     "hospital_id": data.get("hospital_id")
#                 },
#                 action={
#                     "type": "CREATE_DOCTOR",
#                     "status": "FAILED",
#                     "reason": f"Phone number '{phone}' already exists"
#                 }
#             ))
#             return JSONResponse(
#                 status_code=400,
#                 content={
#                     "status": "error",
#                     "message": f"Phone number '{phone}' already exists"
#                 }
#             )

#         # -----------------------------------------
#         # 4️⃣ PROCEED WITH CREATION
#         # -----------------------------------------

#         sys_user_id = generate_doctor_id()
#         doctor_assist_id = generate_random_string()
#         logger.info(f"RAW PASSWORD RECEIVED: {data['password']} - LENGTH: {len(data['password'])}")

#         hashed_pw = hash_password(data["password"])
#         created_at = data.get("created_at", datetime.now())
#         hospital_id = data["hospital_id"]
#         hospital = hospital_user_collection.find_one({"sys_user_id": hospital_id})
#         if not hospital:
#             emit_audit(request.app, AuditEvent(
#                 timestamp=datetime.utcnow(),
#                 level="ERROR",
#                 source={"service": "gateway", "component": "doctor_route"},
#                 actor={
#                     "type": current_user["role"],
#                     "id": current_user["sys_user_id"]
#                 },
#                 context={
#                     "trace_id": request.state.trace_id,
#                     "ip": get_client_ip(request),
#                     "endpoint": "/doctoradd"
#                 },
#                 clinical_context={
#                     "data_sensitivity": "PHI",
#                     "hospital_id": data.get("hospital_id")
#                 },
#                 action={
#                     "type": "CREATE_DOCTOR",
#                     "status": "FAILED",
#                     "reason": f"Hospital ID '{hospital_id}' does not exist"
#                 }
#             ))
#             return JSONResponse(
#                 status_code=400,
#                 content={
#                     "status": "error",
#                     "message": f"Hospital ID '{hospital_id}' does not exist"
#                 }
#             )
#         hospital_name = hospital.get("name", "")
#         # ---- 1️⃣ Create Doctor Model Object ----
#         doctor_obj = Doctor(
#             name=data["name"],
#             hospital_id=data["hospital_id"],
#             sys_user_id=sys_user_id,      # unique id
#             doctor_id=doctor_assist_id,      # Auto-generated UUID ID
#             email=data.get("email") or None,
#             phone_number=data["phone_number"],
#             username=data["username"],
#             address=data.get("address"),
#             hospital_name=hospital_name,
#             country_code=data["country_code"],
#             qualifications=data.get("qualifications"),
#             specialization=data["specialization"],
#             registeration_number=data.get("registeration_number"),
#             created_at=created_at
#         )

#         # ---- 2️⃣ Create Users Model Object ----
#         user_obj = Users(
#             sys_user_id=sys_user_id,
#             doctor_assist_id = doctor_assist_id,
#             email=data.get("email") or None,
#             phone_number=data["phone_number"],
#             username=data["username"],
#             password=hashed_pw,
#             role="doctor",
#             user_type="first_account",
#             status="active",
#             created_at=created_at,
#             renewed_at=created_at
#         )

#         # ---- 4️⃣ Insert into MongoDB ----
#         doctor_user_collection.insert_one(doctor_obj.model_dump())
#         user_auth_collection.insert_one(user_obj.model_dump())

#         logger.info("Doctor and User Auth inserted successfully")
        
#         emit_audit(request.app, AuditEvent(
#             timestamp=datetime.utcnow(),
#             level="INFO",
#             source={"service": "gateway", "component": "doctor_route"},
#             actor={
#                 "type": current_user["role"],
#                 "id": current_user["sys_user_id"]
#             },
#             context={
#                 "trace_id": request.state.trace_id,
#                 "ip": get_client_ip(request),
#                 "endpoint": "/doctoradd"
#             },
#             clinical_context={
#                 "data_sensitivity": "PHI",
#                 "hospital_id": data.get("hospital_id")
#             },
#             action={
#                 "type": "CREATE_DOCTOR",
#                 "status": "SUCCESS",
#                 "doctor_sys_user_id": sys_user_id
#             }
#         ))

#         return {
#             "status": "success",
#             "message": "Doctor registered successfully.",
#             "doctor_id": sys_user_id
#         }

#     except Exception as e:
#         emit_audit(request.app, AuditEvent(
#             timestamp=datetime.utcnow(),
#             level="ERROR",
#             source={"service": "gateway", "component": "doctor_route"},
#             actor={
#                 "type": current_user["role"],
#                 "id": current_user["sys_user_id"]
#             },
#             context={
#                 "trace_id": request.state.trace_id,
#                 "ip": get_client_ip(request),
#                 "endpoint": "/doctoradd"
#             },
#             clinical_context={
#                 "data_sensitivity": "PHI",
#                 "hospital_id": data.get("hospital_id")
#             },
#             action={
#                 "type": "CREATE_DOCTOR",
#                 "status": "FAILED",
#                 "reason": str(e)
#             }
#         ))
#         logger.exception("Doctor Creation Failed: %s", str(e))
#         raise HTTPException(status_code=500, detail=f"Error: {str(e)}")


#LATEST 16-03-2026
# @router.post("/doctoradd")
# async def doctor_add_post(request: Request, current_user=Depends(get_current_user)):
#     try:
#         data = await request.json()

#         logger.info("Doctor Registration Started")

#         username = data["username"]
#         email = data.get("email") or None
#         phone = data["phone_number"]

#         # -----------------------------
#         # CHECK USERNAME
#         # -----------------------------
#         existing_username = user_auth_collection.find_one({"username": username})
#         if existing_username:
#             logger.info(f"Username already exists: {username}")
#             return JSONResponse(
#                 status_code=400,
#                 content={"status": "error", "message": f"Username '{username}' already exists"}
#             )

#         # -----------------------------
#         # CHECK EMAIL
#         # -----------------------------
#         if email:
#             existing_email = user_auth_collection.find_one({"email": email})
#             if existing_email:
#                 logger.info(f"Email already exists: {email}")
#                 return JSONResponse(
#                     status_code=400,
#                     content={"status": "error", "message": f"Email '{email}' already exists"}
#                 )

#         # -----------------------------
#         # CHECK PHONE
#         # -----------------------------
#         existing_phone = user_auth_collection.find_one({"phone_number": phone})
#         if existing_phone:
#             logger.info(f"Phone number already exists: {phone}")
#             return JSONResponse(
#                 status_code=400,
#                 content={"status": "error", "message": f"Phone number '{phone}' already exists"}
#             )

#         # -----------------------------
#         # GENERATE IDS
#         # -----------------------------
#         sys_user_id = generate_doctor_id()
#         doctor_assist_id = generate_random_string()
#         hashed_pw = hash_password(data["password"])
#         created_at = data.get("created_at", datetime.now())

#         logger.info(f"Generated Doctor SYS ID: {sys_user_id}")

#         hospital_id = data["hospital_id"]

#         hospital = hospital_user_collection.find_one({"sys_user_id": hospital_id})

#         if not hospital:
#             logger.info(f"Hospital ID not found: {hospital_id}")
#             return JSONResponse(
#                 status_code=400,
#                 content={"status": "error", "message": f"Hospital ID '{hospital_id}' does not exist"}
#             )

#         hospital_name = hospital.get("name", "")

#         # -----------------------------
#         # CREATE DOCTOR OBJECT
#         # -----------------------------
#         doctor_obj = Doctor(
#             name=data["name"],
#             hospital_id=data["hospital_id"],
#             sys_user_id=sys_user_id,
#             doctor_id=doctor_assist_id,
#             email=data.get("email") or None,
#             phone_number=data["phone_number"],
#             username=data["username"],
#             address=data.get("address"),
#             hospital_name=hospital_name,
#             country_code=data["country_code"],
#             qualifications=data.get("qualifications"),
#             specialization=data["specialization"],
#             registeration_number=data.get("registeration_number"),
#             created_at=created_at
#         )

#         # -----------------------------
#         # CREATE USER AUTH OBJECT
#         # -----------------------------
#         user_obj = Users(
#             sys_user_id=sys_user_id,
#             doctor_assist_id=doctor_assist_id,
#             email=data.get("email") or None,
#             phone_number=data["phone_number"],
#             username=data["username"],
#             password=hashed_pw,
#             role="doctor",
#             user_type="first_account",
#             status="active",
#             created_at=created_at,
#             renewed_at=created_at
#         )

#         # -----------------------------
#         # INSERT DOCTOR + USER
#         # -----------------------------
#         doctor_user_collection.insert_one(doctor_obj.model_dump())
#         user_auth_collection.insert_one(user_obj.model_dump())

#         logger.info(f"Doctor inserted successfully: {sys_user_id}")

#         # =====================================================
#         # COPY ADMIN MEDICAL + CURRENT RULE BASED ON SPECIALITY
#         # =====================================================

#         try:
#             speciality = data["specialization"]

#             logger.info(f"Checking admin rules for speciality: {speciality}")

#             admin_rule = medical_current_rule_collection.find_one(
#                 {"speciality": speciality}
#             )

#             if admin_rule:

#                 logger.info(f"Admin rule found for speciality: {speciality}")

#                 doctor_rule_doc = {
#                     "doctor_sys_user_id": sys_user_id,
#                     "hospital_id": hospital_id,
#                     "speciality": speciality,
#                     "medical_context": admin_rule.get("medical_context", []),
#                     "current_context": admin_rule.get("current_context", []),
#                     "source_admin_rule_id": str(admin_rule.get("_id")),
#                     "created_at": datetime.utcnow()
#                 }

#                 medical_current_rule_collection.insert_one(doctor_rule_doc)

#                 logger.info(
#                     f"Admin medical+current rules copied successfully for doctor {sys_user_id}"
#                 )

#             else:
#                 logger.info(
#                     f"No admin rules found for speciality: {speciality}"
#                 )

#         except Exception as context_error:

#             logger.error(
#                 f"Failed to copy admin rules for doctor {sys_user_id}: {str(context_error)}"
#             )

#         # -----------------------------
#         # SUCCESS RESPONSE
#         # -----------------------------
#         logger.info(f"Doctor Registration Completed Successfully: {sys_user_id}")

#         return {
#             "status": "success",
#             "message": "Doctor registered successfully.",
#             "doctor_id": sys_user_id
#         }

#     except Exception as e:

#         logger.exception("Doctor Creation Failed: %s", str(e))

#         raise HTTPException(
#             status_code=500,
#             detail=f"Error: {str(e)}"
#         )




@router.post("/doctoradd")
async def doctor_add_post(request: Request, current_user=Depends(get_current_user)):
    try:
        data = await request.json()

        logger.info("Doctor Registration Started")

        username = data["username"]
        email = data.get("email") or None
        phone = data["phone_number"]

        # -----------------------------
        # CHECK USERNAME
        # -----------------------------
        existing_username = user_auth_collection.find_one({"username": username})
        if existing_username:
            logger.info(f"Username already exists: {username}")
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": f"Username '{username}' already exists"}
            )

        # -----------------------------
        # CHECK EMAIL
        # -----------------------------
        if email:
            existing_email = user_auth_collection.find_one({"email": email})
            if existing_email:
                logger.info(f"Email already exists: {email}")
                return JSONResponse(
                    status_code=400,
                    content={"status": "error", "message": f"Email '{email}' already exists"}
                )

        # -----------------------------
        # CHECK PHONE
        # -----------------------------
        if phone not in [None, ""]:
            existing_phone = user_auth_collection.find_one({"phone_number": phone})
            
            if existing_phone:
                logger.info(f"Phone number already exists: {phone}")
                return JSONResponse(
                    status_code=400,
                    content={"status": "error", "message": f"Phone number '{phone}' already exists"}
                )

        # -----------------------------
        # GENERATE IDS
        # -----------------------------
        sys_user_id = generate_doctor_id()
        doctor_assist_id = generate_random_string()
        hashed_pw = hash_password(data["password"])
        created_at = data.get("created_at", datetime.now())

        logger.info(f"Generated Doctor SYS ID: {sys_user_id}")

        hospital_id = data["hospital_id"]

        hospital = hospital_user_collection.find_one({"sys_user_id": hospital_id})

        if not hospital:
            logger.info(f"Hospital ID not found: {hospital_id}")
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": f"Hospital ID '{hospital_id}' does not exist"}
            )

        hospital_name = hospital.get("name", "")

        # -----------------------------
        # CREATE DOCTOR OBJECT
        # -----------------------------
        doctor_obj = Doctor(
            name=data["name"],
            hospital_id=data["hospital_id"],
            sys_user_id=sys_user_id,
            doctor_id=doctor_assist_id,
            email=data.get("email") or None,
            phone_number=data["phone_number"],
            username=data["username"],
            address=data.get("address"),
            hospital_name=hospital_name,
            country_code=data["country_code"],
            qualifications=data.get("qualifications"),
            specialization=data["specialization"],
            registeration_number=data.get("registeration_number"),
            created_at=created_at
        )

        # -----------------------------
        # CREATE USER AUTH OBJECT
        # -----------------------------
        user_obj = Users(
            sys_user_id=sys_user_id,
            doctor_assist_id=doctor_assist_id,
            email=data.get("email") or None,
            phone_number=data["phone_number"],
            username=data["username"],
            password=hashed_pw,
            role="doctor",
            user_type="first_account",
            status="active",
            created_at=created_at,
            renewed_at=created_at
        )

        # -----------------------------
        # INSERT DOCTOR + USER
        # -----------------------------
        doctor_user_collection.insert_one(doctor_obj.model_dump())
        user_auth_collection.insert_one(user_obj.model_dump())

        logger.info(f"Doctor inserted successfully: {sys_user_id}")

        # =====================================================
        # COPY ADMIN MEDICAL + CURRENT RULE BASED ON SPECIALITY
        # =====================================================

        try:
            speciality = data["specialization"]

            logger.info(f"Checking admin rules for speciality: {speciality}")

            admin_rule = medical_current_rule_collection.find_one(
                {"speciality": speciality}
            )

            if admin_rule:

                logger.info(f"Admin rule found for speciality: {speciality}")

                doctor_rule_doc = {
                    "doctor_sys_user_id": sys_user_id,
                    "hospital_id": hospital_id,
                    "speciality": speciality,
                    "medical_context": admin_rule.get("medical_context", []),
                    "current_context": admin_rule.get("current_context", []),
                    "source_admin_rule_id": str(admin_rule.get("_id")),
                    "created_at": datetime.utcnow()
                }

                medical_current_rule_collection.insert_one(doctor_rule_doc)

                logger.info(
                    f"Admin medical+current rules copied successfully for doctor {sys_user_id}"
                )

            else:
                logger.info(
                    f"No admin rules found for speciality: {speciality}"
                )

        except Exception as context_error:

            logger.error(
                f"Failed to copy admin rules for doctor {sys_user_id}: {str(context_error)}"
            )

        # =====================================================
        # COPY STRUCTURED NOTE RULE BASED ON SPECIALITY
        # =====================================================

        try:
            logger.info(f"Checking structured note rule for speciality: {speciality}")

            structured_rule = structured_note_rule_collection.find_one(
                {"speciality": speciality}
            )

            if structured_rule:

                logger.info(f"Structured note rule found for speciality: {speciality}")

                doctor_structured_rule = {
                    "doctor_sys_user_id": sys_user_id,
                    "hospital_id": hospital_id,
                    "speciality": speciality,
                    "rule_text": structured_rule.get("rule_text", ""),
                    "source_admin_rule_id": str(structured_rule.get("_id")),
                    "created_at": datetime.utcnow()
                }

                # save doctor specific structured note rule
                structured_note_rule_collection.insert_one(doctor_structured_rule)

                logger.info(
                    f"Structured note rule copied successfully for doctor {sys_user_id}"
                )

            else:

                logger.info(
                    f"No structured note rule found for speciality: {speciality}"
                )

        except Exception as structured_error:

            logger.error(
                f"Failed to copy structured note rule for doctor {sys_user_id}: {str(structured_error)}"
            )
        # -----------------------------
        # SUCCESS RESPONSE
        # -----------------------------
        logger.info(f"Doctor Registration Completed Successfully: {sys_user_id}")

        return {
            "status": "success",
            "message": "Doctor registered successfully.",
            "doctor_id": sys_user_id
        }

    except Exception as e:

        logger.exception("Doctor Creation Failed: %s", str(e))

        raise HTTPException(
            status_code=500,
            detail=f"Error: {str(e)}"
        )




# @router.post("/doctoradd")
# async def doctor_add_post(request: Request, current_user=Depends(get_current_user)):
#     try:
#         data = await request.json()

#         logger.info("Doctor Registration Started")
        
#         username = data["username"]
#         email = data.get("email") or None
#         phone = data["phone_number"]

#         # -----------------------------
#         # CHECK USERNAME
#         # -----------------------------
#         existing_username = user_auth_collection.find_one({"username": username})
#         if existing_username:
#             return JSONResponse(
#                 status_code=400,
#                 content={"status": "error", "message": f"Username '{username}' already exists"}
#             )

#         # -----------------------------
#         # CHECK EMAIL
#         # -----------------------------
#         if email:
#             existing_email = user_auth_collection.find_one({"email": email})
#             if existing_email:
#                 return JSONResponse(
#                     status_code=400,
#                     content={"status": "error", "message": f"Email '{email}' already exists"}
#                 )

#         # -----------------------------
#         # CHECK PHONE
#         # -----------------------------
#         existing_phone = user_auth_collection.find_one({"phone_number": phone})
#         if existing_phone:
#             return JSONResponse(
#                 status_code=400,
#                 content={"status": "error", "message": f"Phone number '{phone}' already exists"}
#             )

#         # -----------------------------
#         # GENERATE IDS
#         # -----------------------------
#         sys_user_id = generate_doctor_id()
#         doctor_assist_id = generate_random_string()
#         hashed_pw = hash_password(data["password"])
#         created_at = data.get("created_at", datetime.now())

#         hospital_id = data["hospital_id"]
#         hospital = hospital_user_collection.find_one({"sys_user_id": hospital_id})

#         if not hospital:
#             return JSONResponse(
#                 status_code=400,
#                 content={"status": "error", "message": f"Hospital ID '{hospital_id}' does not exist"}
#             )

#         hospital_name = hospital.get("name", "")

#         # -----------------------------
#         # CREATE DOCTOR OBJECT (UNCHANGED STRUCTURE)
#         # -----------------------------
#         doctor_obj = Doctor(
#             name=data["name"],
#             hospital_id=data["hospital_id"],
#             sys_user_id=sys_user_id,
#             doctor_id=doctor_assist_id,
#             email=data.get("email") or None,
#             phone_number=data["phone_number"],
#             username=data["username"],
#             address=data.get("address"),
#             hospital_name=hospital_name,
#             country_code=data["country_code"],
#             qualifications=data.get("qualifications"),
#             specialization=data["specialization"],
#             registeration_number=data.get("registeration_number"),
#             created_at=created_at
#         )

#         # -----------------------------
#         # CREATE USER AUTH OBJECT
#         # -----------------------------
#         user_obj = Users(
#             sys_user_id=sys_user_id,
#             doctor_assist_id=doctor_assist_id,
#             email=data.get("email") or None,
#             phone_number=data["phone_number"],
#             username=data["username"],
#             password=hashed_pw,
#             role="doctor",
#             user_type="first_account",
#             status="active",
#             created_at=created_at,
#             renewed_at=created_at
#         )

#         # -----------------------------
#         # INSERT DOCTOR + USER
#         # -----------------------------
#         doctor_user_collection.insert_one(doctor_obj.model_dump())
#         user_auth_collection.insert_one(user_obj.model_dump())
#         logger.info("Doctor and User Auth inserted successfully")
#         await apply_admin_rules_to_doctor_service(
#             doctor_id=sys_user_id,
#             doctor_specialty=data["specialization"],
#             admin_rule_agent_collection=admin_rule_agent_collection,
#             doctor_rule_agent_collection=doctor_rule_agent_collection
#         )
#         # =====================================================
#         # COPY CONTEXT RULE BASED ON SPECIALIZATION
#         # =====================================================
#         try:
#             speciality = data["specialization"]

#             context_rule = context_rule_collection.find_one(
#                 {"speciality": speciality}
#             )

#             if context_rule:
#                 doctor_context_doc = {
#                     "doctor_sys_user_id": sys_user_id,
#                     "hospital_id": hospital_id,
#                     "speciality": speciality,
#                     "medical_context_categories": context_rule.get("medical_context_categories", []),
#                     "medical_context_rule": context_rule.get("medical_context_rule", ""),
#                     "current_context_categories": context_rule.get("current_context_categories", []),
#                     "current_context_rule": context_rule.get("current_context_rule", ""),
#                     "source_context_rule_id": str(context_rule.get("_id")),
#                     "created_at": datetime.utcnow()
#                 }

#                 context_rule_collection.insert_one(doctor_context_doc)

#                 logger.info(f"Context rules copied for doctor {sys_user_id}")

#             else:
#                 logger.info(f"No context rules found for speciality {speciality}")

#         except Exception as context_error:
#             logger.error(
#                 f"Failed to copy context rules for doctor {sys_user_id}: {str(context_error)}"
#             )

#         # -----------------------------
#         # SUCCESS RESPONSE
#         # -----------------------------
#         return {
#             "status": "success",
#             "message": "Doctor registered successfully.",
#             "doctor_id": sys_user_id
#         }

#     except Exception as e:
#         logger.exception("Doctor Creation Failed: %s", str(e))
#         raise HTTPException(status_code=500, detail=f"Error: {str(e)}")

@router.get("/hospital/{hospital_id}/doctors")
async def get_doctors_by_hospital(
    hospital_id: str,
    request: Request,
    current_user=Depends(get_current_user)
):
    """
    Retrieve all doctors under a specific hospital.
    """

    try:
        logger.info(f"Fetching doctors for hospital_id: {hospital_id}")

        # 1️⃣ Validate hospital exists
        hospital = hospital_user_collection.find_one({"sys_user_id": hospital_id})
        if not hospital:
            emit_audit(request.app, AuditEvent(
                timestamp=datetime.utcnow(),
                level="ERROR",
                source={"service": "gateway", "component": "doctor_route"},
                actor={
                    "type": current_user["role"],
                    "id": current_user["sys_user_id"]
                },
                context={
                    "trace_id": request.state.trace_id,
                    "ip": get_client_ip(request),
                    "endpoint": f"/hospital/{hospital_id}/doctors"
                },
                clinical_context={
                    "data_sensitivity": "PHI",
                    "hospital_id": hospital_id
                },
                action={
                    "type": "GET_DOCTORS",
                    "status": "FAILED",
                    "reason": "Hospital not found"
                }
            ))

            return JSONResponse(
                status_code=404,
                content={
                    "status": "error",
                    "message": "Hospital not found"
                }
            )

        # 2️⃣ Fetch doctors
        doctors_cursor = doctor_user_collection.find(
            {"hospital_id": hospital_id},
            {"_id": 0}  # exclude MongoDB internal ID
        ).sort("created_at", -1)

        doctors = list(doctors_cursor)

        logger.info(f"Total doctors found: {len(doctors)}")

        # 3️⃣ Audit Success
        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="INFO",
            source={"service": "gateway", "component": "doctor_route"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": f"/hospital/{hospital_id}/doctors"
            },
            clinical_context={
                "data_sensitivity": "PHI",
                "hospital_id": hospital_id
            },
            action={
                "type": "GET_DOCTORS",
                "status": "SUCCESS",
                "count": len(doctors)
            }
        ))

        return {
            "status": "success",
            "hospital_id": hospital_id,
            "total_doctors": len(doctors),
            "doctors": doctors
        }

    except Exception as e:
        logger.exception("Doctor Retrieval Failed: %s", str(e))

        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="ERROR",
            source={"service": "gateway", "component": "doctor_route"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": f"/hospital/{hospital_id}/doctors"
            },
            clinical_context={
                "data_sensitivity": "PHI",
                "hospital_id": hospital_id
            },
            action={
                "type": "GET_DOCTORS",
                "status": "FAILED",
                "reason": str(e)
            }
        ))

        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")


@router.delete("/delete_all_doctors")
async def delete_all_doctors(confirm: bool = False):
    """
    Delete ALL documents in doctor_users collection.
    Must pass ?confirm=true to allow deletion.
    """
    try:
        if not confirm:
            emit_audit(request.app, AuditEvent(
                timestamp=datetime.utcnow(),
                level="ERROR",
                source={"service": "gateway", "component": "doctor_route"},
                actor={
                    "type": current_user["role"],
                    "id": current_user["sys_user_id"]
                },
                context={
                    "trace_id": request.state.trace_id,
                    "ip": get_client_ip(request),
                    "endpoint": "/delete_all_doctors"
                },
                clinical_context={
                    "data_sensitivity": "PHI",
                    "hospital_id": None
                },
                action={
                    "type": "DELETE_ALL_DOCTORS",
                    "status": "FAILED",
                    "reason": "Confirmation not provided"
                }
            ))
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "message": "Confirmation required. Add ?confirm=true to proceed."
                }
            )

        result = doctor_user_collection.delete_many({})

        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="INFO",
            source={"service": "gateway", "component": "doctor_route"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/delete_all_doctors"
            },
            clinical_context={
                "data_sensitivity": "PHI",
                "hospital_id": None
            },
            action={
                "type": "DELETE_ALL_DOCTORS",
                "status": "SUCCESS",
                "deleted_count": result.deleted_count
            }
        ))

        return {
            "status": "success",
            "message": f"Deleted {result.deleted_count} doctors from doctor_users."
        }

    except Exception as e:
        logger.exception("Error deleting all doctors: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/get_all_doctors")
async def get_all_doctors():
    """
    Fetch all documents from 'doctor_users' collection.
    """
    try:
        logger.info("Fetching all doctors from doctor_users collection")

        cursor = database["doctor_users"].find({})
        doctors_list = []

        async for doctor in cursor:
            doctors_list.append(convert_mongo_document(doctor))

        logger.info("Total %d doctors retrieved", len(doctors_list))

        return {
            "status": "success",
            "total_doctors": len(doctors_list),
            "doctors": doctors_list
        }

    except Exception as e:
        logger.exception("Error fetching all doctors: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/get_doctor/{doctor_id}")
async def get_doctor_by_id(doctor_id: str):
    doctor = await database["doctor_users"].find_one(
        {"sys_user_id": doctor_id}
    )

    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")

    return {
        "status": "success",
        "doctor": convert_mongo_document(doctor)
    }


@router.post("/take_appointment")
async def take_appointment(request: Request):
    try:
        data = await request.json()

        doctor_id = data.get("doctor_id")
        sys_user_id = data.get("sys_user_id")
        appointment_date = data.get("date")
        scheduled_time = data.get("scheduled_time")
        visit_type = data.get("visit_type")
        chief_complaint = data.get("chief_complaint")

        # -----------------------------
        # 1️⃣ VALIDATION
        # -----------------------------
        if not all([doctor_id, sys_user_id, appointment_date]):
            emit_audit(request.app, AuditEvent(
                timestamp=datetime.utcnow(),
                level="ERROR",
                source={"service": "gateway", "component": "doctor_route"},
                actor={
                    "type": current_user["role"],
                    "id": current_user["sys_user_id"]
                },
                context={
                    "trace_id": request.state.trace_id,
                    "ip": get_client_ip(request),
                    "endpoint": "/take_appointment"
                },
                clinical_context={
                    "data_sensitivity": "PHI",
                    "hospital_id": None
                },
                action={
                    "type": "TAKE_APPOINTMENT",
                    "status": "FAILED",
                    "reason": "Missing required fields"
                }
            ))
            raise HTTPException(
                status_code=400,
                detail="doctor_id, sys_user_id and date are required"
            )

        # -----------------------------
        # 2️⃣ FETCH PATIENT
        # -----------------------------
        patient = patient_user_collection.find_one(
            {"sys_user_id": sys_user_id},
            {"_id": 0}
        )
        hospital_id = patient.get("hospital_id") 
        if not patient:
            emit_audit(request.app, AuditEvent(
                timestamp=datetime.utcnow(),
                level="ERROR",
                source={"service": "gateway", "component": "doctor_route"},
                actor={
                    "type": current_user["role"],
                    "id": current_user["sys_user_id"]
                },
                context={
                    "trace_id": request.state.trace_id,
                    "ip": get_client_ip(request),
                    "endpoint": "/take_appointment"
                },
                clinical_context={
                    "data_sensitivity": "PHI",
                    "hospital_id": None
                },
                action={
                    "type": "TAKE_APPOINTMENT",
                    "status": "FAILED",
                    "reason": f"Patient with sys_user_id '{sys_user_id}' not found"
                }
            ))
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "message": f"Patient with sys_user_id '{sys_user_id}' not found"
                }
            )

        patient_id = patient.get("patient_id")
        patient_name = patient.get("full_name") or patient.get("name") or "Unknown"
        patient_phone = patient.get("phone") or patient.get("mobile") or ""


        if visit_type == "IP":
            # Pass the entire data to handle_ip_appointment function
            return await handle_ip_appointment(data)


        # ==========================================================
        # 3️⃣ PREPARE DATA FOR FEATURE CONTEXT LLM
        # ==========================================================
        # Parse appointment date
        try:
            # Assuming appointment_date is in YYYY-MM-DD format
            parsed_date = datetime.strptime(appointment_date, "%Y-%m-%d").date()
        except ValueError:
            # If parsing fails, use today's date
            parsed_date = datetime.utcnow().date()
            logger.warning(
                f"Could not parse appointment date '{appointment_date}', using today's date",
                extra={
                    "patient_id": sys_user_id,
                    "doctor_id": doctor_id
                }
            )

        # Create context payload
        feature_payload = {
            "doctor_id": doctor_id,
            "patient_id": sys_user_id,
            "contexts": [
                {
                    "date": parsed_date.isoformat(),  # ISO format date string
                    "current_condition": [
                        {
                            "id": str(uuid.uuid4()),
                            "text": chief_complaint or "No chief complaint provided"
                        }
                    ]
                }
            ]
        }

        # ==========================================================
        # 4️⃣ LOGGER — EXACT DATA BEING SENT
        # ==========================================================
        logger.info(
            "Sending appointment data to feature context LLM",
            extra={
                "endpoint": "current_context_save",
                "patient_id": sys_user_id,
                "doctor_id": doctor_id,
                "payload": feature_payload
            }
        )

        # ==========================================================
        # 5️⃣ CALL FEATURE CONTEXT LLM ENDPOINT
        # ==========================================================
        async with httpx.AsyncClient(timeout=10.0) as client:
            llm_response = await client.post(
                f"{api_base_url}hms/users/data/context/current_context_save",
                json=feature_payload,
                headers={"Content-Type": "application/json"}
            )

        if llm_response.status_code != 200:
            logger.error(
                "Feature context LLM failed for appointment data",
                extra={
                    "status_code": llm_response.status_code,
                    "response": llm_response.text,
                    "patient_id": sys_user_id,
                    "doctor_id": doctor_id
                }
            )

        # -----------------------------
        # 3️⃣ TRY UPDATE (STRICT MATCH)
        # same patient + same doctor + same date
        # -----------------------------
        update_result = patient_appointments_collection.update_one(
            {"sys_user_id": sys_user_id},
            {
                "$set": {
                    "appointments.$[appt].scheduled_time": scheduled_time,
                    "appointments.$[appt].visit_type": visit_type,
                    "appointments.$[appt].chief_complaint": chief_complaint,
                    "appointments.$[appt].updated_at": datetime.utcnow()
                }
            },
            array_filters=[
                {
                    "appt.doctor_id": doctor_id,
                    "appt.date": appointment_date
                }
            ]
        )

        # -----------------------------
        # 4️⃣ IF UPDATED → RETURN
        # -----------------------------
        if update_result.modified_count > 0:

            # Get appointment_id from existing appointment
            existing_doc = patient_appointments_collection.find_one(
                {"sys_user_id": sys_user_id},
                {"appointments": 1}
            )

            appointment_id = None
            for appt in existing_doc.get("appointments", []):
                if appt.get("doctor_id") == doctor_id and appt.get("date") == appointment_date:
                    appointment_id = appt.get("appointment_id")
                    break

            # Save to status_appointment collection
            await save_status_appointment(
                appointment_id=appointment_id,
                patient_id=patient_id,
                hospital_id=hospital_id,
                sys_user_id=sys_user_id,
                patient_name=patient_name,
                patient_phone=patient_phone,
                doctor_id=doctor_id,
                appointment_date=appointment_date,
                scheduled_time=scheduled_time,
                visit_type=visit_type,
                chief_complaint=chief_complaint,
                status="Pending"
            )

            emit_audit(request.app, AuditEvent(
                timestamp=datetime.utcnow(),
                level="INFO",
                source={"service": "gateway", "component": "doctor_route"},
                actor={
                    "type": current_user["role"],
                    "id": current_user["sys_user_id"]
                },
                context={
                    "trace_id": request.state.trace_id,
                    "ip": get_client_ip(request),
                    "endpoint": "/take_appointment"
                },
                clinical_context={
                    "data_sensitivity": "PHI",
                },
                action={
                    "type": "TAKE_APPOINTMENT",
                    "status": "SUCCESS",
                    "patient_sys_user_id": sys_user_id,
                    "doctor_id": doctor_id,
                    "date": appointment_date
                }
            ))
            return {
                "status": "success",
                "message": "Appointment updated successfully",
                "doctor_id": doctor_id,
                "patient_id": patient_id,
                "date": appointment_date,
                "scheduled_time": scheduled_time,
                "visit_type": visit_type,
                "chief_complaint": chief_complaint
            }

        # -----------------------------
        # 5️⃣ CREATE NEW APPOINTMENT
        # (doctor or date did not exist)
        # -----------------------------
        appointment_id = f"APT-{str(ObjectId())}"

        new_appointment = {
            "appointment_id": appointment_id,
            "doctor_id": doctor_id,
            "date": appointment_date,
            "scheduled_time": scheduled_time,
            "visit_type": visit_type,
            "chief_complaint": chief_complaint,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }

        # ==========================================================
        # 3️⃣ PREPARE DATA FOR FEATURE CONTEXT LLM
        # ==========================================================
        # Parse appointment date
        try:
            # Assuming appointment_date is in YYYY-MM-DD format
            parsed_date = datetime.strptime(appointment_date, "%Y-%m-%d").date()
        except ValueError:
            # If parsing fails, use today's date
            parsed_date = datetime.utcnow().date()
            logger.warning(
                f"Could not parse appointment date '{appointment_date}', using today's date",
                extra={
                    "patient_id": sys_user_id,
                    "doctor_id": doctor_id
                }
            )

        # Create context payload
        feature_payload = {
            "doctor_id": doctor_id,
            "patient_id": sys_user_id,
            "contexts": [
                {
                    "date": parsed_date.isoformat(),  # ISO format date string
                    "current_condition": [
                        {
                            "id": str(uuid.uuid4()),
                            "text": chief_complaint or "No chief complaint provided"
                        }
                    ]
                }
            ]
        }

        # ==========================================================
        # 4️⃣ LOGGER — EXACT DATA BEING SENT
        # ==========================================================
        logger.info(
            "Sending appointment data to feature context LLM",
            extra={
                "endpoint": "current_context_save",
                "patient_id": sys_user_id,
                "doctor_id": doctor_id,
                "payload": feature_payload
            }
        )

        # ==========================================================
        # 5️⃣ CALL FEATURE CONTEXT LLM ENDPOINT
        # ==========================================================
        async with httpx.AsyncClient(timeout=10.0) as client:
            llm_response = await client.post(
                f"{api_base_url}hms/users/data/context/current_context_save",
                json=feature_payload,
                headers={"Content-Type": "application/json"}
            )

        if llm_response.status_code != 200:
            logger.error(
                "Feature context LLM failed for appointment data",
                extra={
                    "status_code": llm_response.status_code,
                    "response": llm_response.text,
                    "patient_id": sys_user_id,
                    "doctor_id": doctor_id
                }
            )

        patient_appointments_collection.update_one(
            {"sys_user_id": sys_user_id},  # Match the patient document by sys_user_id
            {
                # Update the root level to include hospital_id if it's not already there
                "$set": {
                    "hospital_id": hospital_id  # Only set this at the root level of the patient document
                },
                "$push": {
                    "appointments": new_appointment  # Add the new appointment to the appointments array
                }
            },
            upsert=True  # Create a new document if it doesn't exist
        )

        # Save to status_appointment collection
        
        await save_status_appointment(
            appointment_id=appointment_id,
            patient_id=patient_id,
            hospital_id=hospital_id,
            sys_user_id=sys_user_id,
            patient_name=patient_name,
            patient_phone=patient_phone,
            doctor_id=doctor_id,
            appointment_date=appointment_date,
            scheduled_time=scheduled_time,
            visit_type=visit_type,
            chief_complaint=chief_complaint,
            status="Pending"
        )


        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="INFO",
            source={"service": "gateway", "component": "doctor_route"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/take_appointment"
            },
            clinical_context={
                "data_sensitivity": "PHI",
            },
            action={
                "type": "TAKE_APPOINTMENT",
                "status": "SUCCESS",
                "patient_sys_user_id": sys_user_id,
                "doctor_id": doctor_id,
                "date": appointment_date
            }
        ))

        return {
            "status": "success",
            "message": "Appointment created successfully",
            "appointment_id": appointment_id,
            "doctor_id": doctor_id,
            "patient_id": patient_id,
            "date": appointment_date,
            "scheduled_time": scheduled_time,
            "visit_type": visit_type,
            "chief_complaint": chief_complaint
        }

    except Exception as e:
        logger.exception("Appointment Creation Failed: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/appointment/latest")
async def get_latest_appointment(
    patient_id: str = Query(...),
    doctor_id: str = Query(...)
):
    try:

        doc = patient_appointments_collection.find_one(
            {"sys_user_id": patient_id},
            {"appointments": 1, "_id": 0}
        )

        if not doc or not doc.get("appointments"):
            return {
                "status": "success",
                "latest_appointment": None,
                "is_follow_up": False
            }

        doctor_appointments = [
            appt
            for appt in doc["appointments"]
            if appt.get("doctor_id") == doctor_id
        ]

        if not doctor_appointments:
            return {
                "status": "success",
                "latest_appointment": None,
                "is_follow_up": False
            }

        latest = sorted(
            doctor_appointments,
            key=lambda x: x.get("date", ""),
            reverse=True
        )[0]

        visit_type = (latest.get("visit_type") or "").lower()

        return {
            "status": "success",
            "latest_appointment": latest,
            "visit_type": latest.get("visit_type"),
            "is_follow_up": visit_type in [
                "follow_up",
                "followup",
                "followup_visit"
            ]
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )

async def handle_ip_appointment(data):
    # Extract necessary fields from the data
    doctor_id = data.get("doctor_id")
    sys_user_id = data.get("sys_user_id")
    patient_id = sys_user_id
    appointment_date = data.get("date")
    scheduled_time = data.get("scheduled_time")
    visit_type = data.get("visit_type")
    chief_complaint = data.get("chief_complaint")
    admission_type = data.get("admission_type")

    # Ensure 'admission_type' is valid
    if admission_type not in ["ICU", "Ward", "Room"]:
        raise HTTPException(status_code=400, detail=f"Invalid admission_type: {admission_type}")
    
    patient_status = "Admitted"  # Set patient status as "Admitted" for IP appointments

    # Set the appropriate field based on admission_type
    if admission_type == "ICU":
        admission_field = "icu_type"
        admission_value = data.get("room_number")  # ICU uses room_number for ICU type
    elif admission_type == "Ward":
        admission_field = "ward_number"
        admission_value = data.get("ward_number")  # Ward uses ward_number
    elif admission_type == "Room":
        admission_field = "room_number"
        admission_value = data.get("room_number")  # Room uses room_number

    # Prepare IP-specific appointment data to save to the database
    new_appointment = {
        "appointment_id": f"APT-{str(ObjectId())}",
        "doctor_id": doctor_id,
        "date": appointment_date,
        "scheduled_time": scheduled_time,
        "visit_type": visit_type,
        "chief_complaint": chief_complaint,
        "admission_type": admission_type,
        admission_field: admission_value,
        "patient_status": patient_status,  # Set patient status to "Admitted"
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }

    # Save to the patient appointments collection (no strict check for IP appointments)
    patient_appointments_collection.update_one(
        {"sys_user_id": sys_user_id},
        {
            "$setOnInsert": {"patient_id": patient_id, "created_at": datetime.utcnow()},
            "$push": {"appointments": new_appointment}
        },
        upsert=True
    )

    return {
        "status": "success",
        "message": "IP appointment created successfully",
        "appointment_id": new_appointment["appointment_id"],
        "doctor_id": doctor_id,
        "patient_id": patient_id,
        "date": appointment_date,
        "scheduled_time": scheduled_time,
        "visit_type": visit_type,
        "chief_complaint": chief_complaint
    }




async def save_status_appointment(
    appointment_id: str,
    patient_id: str,
    sys_user_id: str,
    hospital_id: str,
    patient_name: str,
    patient_phone: str,
    doctor_id: str,
    appointment_date: str,
    scheduled_time: str,
    visit_type: str,
    chief_complaint: str,
    status: str = "Pending"
):
    try:
        logger.info("🔵 save_status_appointment started")
        logger.info(
            "Input received",
            extra={
                "appointment_id": appointment_id,
                "patient_id": patient_id,
                "doctor_id": doctor_id,
                "date": appointment_date,
                "scheduled_time": scheduled_time,
                "status": status
            }
        )

        now = datetime.utcnow()
        logger.info("Current UTC time generated", extra={"now": str(now)})

        logger.info("Checking if appointment already exists in status collection")

        existing = status_appointment_collection.find_one(
            {"appointment_id": appointment_id}
        )

        if not existing:
            logger.info("No existing record found — inserting new document")

            status_doc = {
                "appointment_id": appointment_id,
                "hospital_id": hospital_id,
                "patient_id": patient_id,
                "sys_user_id": sys_user_id,
                "patient_name": patient_name,
                "patient_phone": patient_phone,
                "doctor_id": doctor_id,
                "date": appointment_date,
                "scheduled_time": scheduled_time,
                "visit_type": visit_type,
                "status": status,
                "chief_complaint": chief_complaint,
                "created_at": now,
                "updated_at": now
            }

            logger.info("Prepared status document", extra={"status_doc": status_doc})

            result = status_appointment_collection.insert_one(status_doc)

            logger.info(
                "New status appointment inserted successfully",
                extra={
                    "appointment_id": appointment_id,
                    "inserted_id": str(result.inserted_id)
                }
            )

        else:
            logger.info("Existing record found — updating document")

            update_data = {
                "scheduled_time": scheduled_time,
                "visit_type": visit_type,
                "chief_complaint": chief_complaint,
                "status": status,
                "updated_at": now
            }

            logger.info("Update data prepared", extra={"update_data": update_data})

            result = status_appointment_collection.update_one(
                {"appointment_id": appointment_id},
                {"$set": update_data}
            )

            logger.info(
                "Status appointment updated successfully",
                extra={
                    "appointment_id": appointment_id,
                    "matched_count": result.matched_count,
                    "modified_count": result.modified_count
                }
            )

        logger.info("🟢 save_status_appointment completed successfully")

    except Exception as e:
        logger.exception(
            "🔴 Error in save_status_appointment",
            extra={
                "appointment_id": appointment_id,
                "error": str(e)
            }
        )
        raise



@router.get("/doctor_today_appointments/{doctor_id}")
async def get_todays_appointments_for_doctor(doctor_id: str):
    try:
        today = date.today().isoformat()  # YYYY-MM-DD

        cursor = patient_appointments_collection.find(
            {
                "appointments": {
                    "$elemMatch": {
                        "doctor_id": doctor_id,
                        "date": today,
                        "visit_type": {"$ne": "IP"}
                    }
                }
            },
            {
                "_id": 0,
                "sys_user_id": 1,
                "patient_id": 1,
                "appointments": 1
            }
        )

        appointments_today = []

        for doc in cursor:
            for appt in doc.get("appointments", []):
                if (
                    appt.get("doctor_id") == doctor_id
                    and appt.get("date") == today
                    and appt.get("visit_type") != "IP"
                ):
                    patients= patient_user_collection.find_one(
                        {"sys_user_id": doc.get("sys_user_id")}
                    )

                    # patients = decrypt_data(patients)

                    patients_name= patients.get("name") if patients else "Unknown"
                    patient_dob= patients.get("date_of_birth") if patients else "Unknown"
                    patients_phone= patients.get("phone_number") if patients else "Unknown"
                    appointments_today.append({
                        "appointment_id": appt.get("appointment_id"),
                        "patient_id": doc.get("patient_id"),
                        "sys_user_id": doc.get("sys_user_id"),
                        "date": appt.get("date"),
                        "scheduled_time": appt.get("scheduled_time"),
                        "visit_type": appt.get("visit_type"),
                        "updated_at": appt.get("updated_at"),
                        "chief_complaint": appt.get("chief_complaint"),
                        "patient_name": patients_name,
                        "patient_dob": patient_dob,
                        "patient_phone": patients_phone
                    })

        return {
            "status": "success",
            "doctor_id": doctor_id,
            "date": today,
            "total_appointments": len(appointments_today),
            "appointments": appointments_today
        }

    except Exception as e:
        logger.exception("Failed to fetch today's appointments: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))




@router.get("/doctor_today_ip_appointments/{doctor_id}")
async def get_todays_ip_appointments(doctor_id: str):
    try:
        today = date.today().isoformat()  # Get current date in YYYY-MM-DD format

        # Fetch all appointments for the doctor where patient status is "Admitted"
        # and appointment date is today or in the past (not future dates)
        cursor = patient_appointments_collection.find(
            {
                "appointments": {
                    "$elemMatch": {
                        "doctor_id": doctor_id,
                        "patient_status": "Admitted",  # Check if patient is admitted
                        "date": {"$lte": today}  # Ensure the appointment date is today or in the past
                    }
                }
            },
            {
                "_id": 0,
                "sys_user_id": 1,
                "patient_id": 1,
                "appointments": 1
            }
        )

        appointments_today = []

        for doc in cursor:
            latest_appointment = None
            # Loop through appointments to find the latest one
            for appt in doc.get("appointments", []):
                # Check if appt is not None and meets the required conditions
                if appt is not None and appt.get("doctor_id") == doctor_id and appt.get("patient_status") == "Admitted" and appt.get("date") <= today:
                    # If no latest appointment or this one is more recent, update it
                    if not latest_appointment or appt.get("updated_at", "") > latest_appointment.get("updated_at", ""):
                        latest_appointment = appt

            if latest_appointment:
                # Fetch the patient data
                patients = patient_user_collection.find_one(
                    {"sys_user_id": doc.get("sys_user_id")}
                )

                # Check if patients is None before accessing its values
                patients_name = patients.get("name") if patients else "Unknown"
                patient_dob = patients.get("date_of_birth") if patients else "Unknown"
                patients_phone = patients.get("phone_number") if patients else "Unknown"
                
                # Initialize admission-related fields to None by default
                ward_number = None
                icu_type = None
                room_number = None
                
                # Retrieve the relevant admission field based on admission type
                if latest_appointment.get("admission_type") == "Ward":
                    ward_number = latest_appointment.get("ward_number")
                elif latest_appointment.get("admission_type") == "ICU":
                    icu_type = latest_appointment.get("icu_type")
                elif latest_appointment.get("admission_type") == "Room":
                    room_number = latest_appointment.get("room_number")
                
                appointments_today.append({
                    "appointment_id": latest_appointment.get("appointment_id"),
                    "patient_id": doc.get("patient_id"),
                    "sys_user_id": doc.get("sys_user_id"),
                    "date": latest_appointment.get("date"),
                    "scheduled_time": latest_appointment.get("scheduled_time"),
                    "visit_type": latest_appointment.get("visit_type"),
                    "updated_at": latest_appointment.get("updated_at"),
                    "chief_complaint": latest_appointment.get("chief_complaint"),
                    "patient_name": patients_name,
                    "patient_dob": patient_dob,
                    "patient_phone": patients_phone,
                    "patient_status": latest_appointment.get("patient_status"),  # Pass patient status
                    "admission_type": latest_appointment.get("admission_type"),
                    "ward_number": ward_number,
                    "icu_type": icu_type,
                    "room_number": room_number
                })

        return {
            "status": "success",
            "doctor_id": doctor_id,
            "total_appointments": len(appointments_today),
            "appointments": appointments_today
        }

    except Exception as e:
        logger.exception("Failed to fetch today's IP appointments: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/doctor_appointments/{doctor_id}")
async def get_doctor_appointments(
    doctor_id: str,
    selected_date: str = Query(None),
    status_filter: str = Query(None)
):
    try:

        # -----------------------------------------
        # 1️⃣ BUILD BASE QUERY
        # -----------------------------------------
        elem_match_query = {
            "doctor_id": doctor_id
        }

        # If date is provided → filter by date
        if selected_date:
            elem_match_query["date"] = selected_date

        cursor = patient_appointments_collection.find(
            {
                "appointments": {
                    "$elemMatch": elem_match_query
                }
            },
            {
                "_id": 0,
                "sys_user_id": 1,
                "patient_id": 1,
                "appointments": 1
            }
        )

        appointment_list = []

        # Summary counters
        total = 0
        new_count = 0
        followup_count = 0
        completed = 0
        cancelled = 0
        pending = 0

        # -----------------------------------------
        # 2️⃣ LOOP THROUGH DOCUMENTS
        # -----------------------------------------
        for doc in cursor:
            sys_user_id = doc.get("sys_user_id")
            patient_id = doc.get("patient_id")

            patient_data = patient_user_collection.find_one(
                {"sys_user_id": sys_user_id}
            )

            patient_name = patient_data.get("name") if patient_data else "Unknown"
            patient_phone = patient_data.get("phone_number") if patient_data else "Unknown"

            for appt in doc.get("appointments", []):

                # Filter doctor
                if appt.get("doctor_id") != doctor_id:
                    continue

                # Filter date only if selected_date is provided
                if selected_date and appt.get("date") != selected_date:
                    continue

                status = appt.get("status", "Pending")

                # Summary count
                total += 1

                if appt.get("visit_type") == "New":
                    new_count += 1
                elif appt.get("visit_type") == "Follow-up":
                    followup_count += 1

                if status == "Completed":
                    completed += 1
                elif status == "Cancelled":
                    cancelled += 1
                elif status == "Pending":
                    pending += 1

                # Apply status filter for listing only
                if status_filter and status != status_filter:
                    continue

                appointment_list.append({
                    "appointment_id": appt.get("appointment_id"),
                    "patient_id": patient_id,
                    "sys_user_id": sys_user_id,
                    "patient_name": patient_name,
                    "patient_phone": patient_phone,
                    "date": appt.get("date"),
                    "scheduled_time": appt.get("scheduled_time"),
                    "visit_type": appt.get("visit_type"),
                    "status": status,
                    "chief_complaint": appt.get("chief_complaint"),
                    "updated_at": appt.get("updated_at")
                })

        # -----------------------------------------
        # 3️⃣ SORT BY DATE + TIME
        # -----------------------------------------
        appointment_list.sort(
            key=lambda x: (x.get("date") or "", x.get("scheduled_time") or "")
        )

        # -----------------------------------------
        # 4️⃣ RESPONSE
        # -----------------------------------------
        return {
            "status": "success",
            "doctor_id": doctor_id,
            "date_filter": selected_date if selected_date else "All Dates",
            "summary": {
                "total": total,
                "new_count": new_count,
                "followup_count": followup_count,
                "completed": completed,
                "cancelled": cancelled,
                "pending": pending
            },
            "appointments": appointment_list
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/doctor_status_appointments/{doctor_id}")
async def get_doctor_status_appointments(
    doctor_id: str,
    date: str = Query(None),          # 🔥 CHANGED HERE
    status_filter: str = Query(None)
):
    try:

        # -----------------------------------------
        # 1️⃣ BUILD QUERY
        # -----------------------------------------
        query = {"doctor_id": doctor_id}

        # 🔥 DATE FILTER (FIXED)
        if date:
            query["date"] = date

        # Optional status filter
        if status_filter:
            query["status"] = status_filter

        cursor = status_appointment_collection.find(query, {"_id": 0})

        appointments = list(cursor)

        # -----------------------------------------
        # 2️⃣ SUMMARY COUNTERS
        # -----------------------------------------
        total = 0
        new_count = 0
        followup_count = 0
        completed = 0
        cancelled = 0
        pending = 0

        sys_user_ids = [a.get("sys_user_id") for a in appointments]

        patients = patient_user_collection.find(
            {"sys_user_id": {"$in": sys_user_ids}},
            {"_id": 0, "sys_user_id": 1, "phone_number": 1}
        )

        patient_map = {
            p["sys_user_id"]: p.get("phone_number", "")
            for p in patients
        }

        appointment_list = []

        # -----------------------------------------
        # 3️⃣ LOOP THROUGH FILTERED APPOINTMENTS
        # -----------------------------------------
        for appt in appointments:

            total += 1

            visit_type = appt.get("visit_type")
            status = appt.get("status", "Pending")

            if visit_type == "New":
                new_count += 1
            elif visit_type == "Follow-up":
                followup_count += 1

            if status == "Completed":
                completed += 1
            elif status == "Cancelled":
                cancelled += 1
            elif status == "Pending":
                pending += 1

            appointment_list.append({
                "appointment_id": appt.get("appointment_id"),
                "patient_id": appt.get("patient_id"),
                "sys_user_id": appt.get("sys_user_id"),
                "doctor_id": appt.get("doctor_id"),
                "patient_name": appt.get("patient_name"),
                "patient_phone": patient_map.get(appt.get("sys_user_id"), ""),
                "date": appt.get("date"),
                "scheduled_time": appt.get("scheduled_time"),
                "visit_type": visit_type,
                "status": status,
                "chief_complaint": appt.get("chief_complaint"),
                "updated_at": appt.get("updated_at")
            })

        # -----------------------------------------
        # 4️⃣ SORT BY TIME ONLY (since already date-filtered)
        # -----------------------------------------
        appointment_list.sort(
            key=lambda x: x.get("scheduled_time") or ""
        )

        # -----------------------------------------
        # 5️⃣ RESPONSE
        # -----------------------------------------
        return {
            "status": "success",
            "doctor_id": doctor_id,
            "date_filter": date if date else "All Dates",
            "summary": {
                "total": total,
                "new_count": new_count,
                "followup_count": followup_count,
                "completed": completed,
                "cancelled": cancelled,
                "pending": pending
            },
            "appointments": appointment_list
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@router.put("/complete-appointment/{doctor_id}/{patient_id}")
async def complete_appointment(
    doctor_id: str,
    patient_id: str
):
    try:
        # -----------------------------------------
        # 1️⃣ GET SERVER SYSTEM DATE (NOT UTC)
        # -----------------------------------------
        today_date = datetime.now().strftime("%Y-%m-%d")

        # -----------------------------------------
        # 2️⃣ BUILD UPDATE QUERY
        # -----------------------------------------
        query = {
            "doctor_id": doctor_id,
            "sys_user_id": patient_id,
            "date": today_date,
            "status": {"$in": ["Scheduled", "Pending"]}
        }

        update = {
            "$set": {
                "status": "Completed",
                "updated_at": datetime.now()
            }
        }

        # -----------------------------------------
        # 3️⃣ UPDATE DOCUMENT
        # -----------------------------------------
        result = status_appointment_collection.update_one(query, update)

        if result.matched_count == 0:
            raise HTTPException(
                status_code=404,
                detail=f"No scheduled appointment found for {today_date}"
            )

        return {
            "status": "success",
            "message": "Appointment marked as Completed",
            "doctor_id": doctor_id,
            "patient_id": patient_id,
            "date": today_date
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/delete_all_doctors")
async def delete_all_doctors(confirm: bool = False):
    """
    Delete ALL documents in doctor_users collection.
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

        result = doctor_user_collection.delete_many({})

        return {
            "status": "success",
            "message": f"Deleted {result.deleted_count} doctors from doctor_users."
        }

    except Exception as e:
        logger.exception("Error deleting all doctors: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/delete_all_appointments")
async def delete_all_appointments(confirm: bool = False):
    """
    Delete ALL documents in appointments collection.
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

        result = patient_appointments_collection.delete_many({})

        return {
            "status": "success",
            "message": f"Deleted {result.deleted_count} appointments from patient_appointments."
        }

    except Exception as e:
        logger.exception("Error deleting all appointments: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))



@router.get("/get_doctor_speciality/{sys_user_id}")
async def get_doctor_speciality(sys_user_id: str, request: Request):
    """
    Fetch doctor speciality using sys_user_id
    """
    try:
        doctor = doctor_user_collection.find_one(
            {"sys_user_id": sys_user_id},
            {"_id": 0, "specialization": 1, "name": 1, "hospital_id": 1}
        )

        if not doctor:
            return JSONResponse(
                status_code=404,
                content={
                    "status": "error",
                    "message": f"Doctor with sys_user_id '{sys_user_id}' not found"
                }
            )

        return {
            "status": "success",
            "sys_user_id": sys_user_id,
            "doctor_name": doctor.get("name"),
            "specialization": doctor.get("specialization"),
            "hospital_id": doctor.get("hospital_id")
        }

    except Exception as e:
        logger.exception("Failed to fetch doctor speciality")

        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "Failed to fetch doctor speciality",
                "reason": str(e)
            }
        )



@router.get("/search")
async def search_patients(request: Request):
    try:
        term = (request.query_params.get("term") or "").strip()
        doctor_sys_user_id = request.query_params.get("doctor_id")

        if not doctor_sys_user_id:
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": "doctor_id is required"}
            )

        if len(term) < 2:
            return JSONResponse(
                status_code=200,
                content={"status": "success", "patients": []}
            )

        # -----------------------------
        # Fetch doctor
        # -----------------------------
        doctor = doctor_user_collection.find_one(
            {"sys_user_id": doctor_sys_user_id}
        )
        if not doctor:
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": "Doctor not found"}
            )

        hospital_sys_id = doctor.get("hospital_id")

        if not hospital_sys_id:
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": "Doctor has no hospital"}
            )

        # 🔥 ALLOW BOTH OLD & NEW HOSPITAL IDS
        hospital_ids = [
            hospital_sys_id,                     # correct
            doctor.get("hospital_assist_id")     # legacy (if exists)
        ]

        # -----------------------------
        # Search query
        # -----------------------------
        query = {
            "$and": [
                {
                    "$or": [
                        {"hospital_id": hid}
                        for hid in hospital_ids if hid
                    ]
                },
                {
                    "$or": [
                        {"hms_id": {"$regex": term, "$options": "i"}},
                        {"name": {"$regex": term, "$options": "i"}},
                        {"phone_number": {"$regex": term, "$options": "i"}},
                        {"email": {"$regex": term, "$options": "i"}}
                    ]
                }
            ]
        }

        logger.info(f"[SEARCH] Mongo Query: {query}")

        cursor = patient_user_collection.find(query).limit(10)

        patients = [{
            "sys_user_id": p.get("sys_user_id"),
            "patient_id": p.get("patient_id"),
            "name": p.get("name", ""),
            "hms_id": p.get("hms_id", ""),
            "phone_number": p.get("phone_number", ""),
            "email": p.get("email", "")
        } for p in cursor]

        logger.info(f"[SEARCH] Results found: {len(patients)}")

        return JSONResponse(
            status_code=200,
            content={"status": "success", "patients": patients}
        )

    except Exception as e:
        logger.exception("Patient search failed")
        return JSONResponse(
            status_code=500,
            content={"status": "error", "message": str(e), "patients": []}
        )




##############################################Nurse functions##############################################

@router.post("/nurseadd")
async def nurse_add_post(request: Request, current_user=Depends(get_current_user)):
    """
    Create a Nurse and insert into both MongoDB collections.
    nurse_id is auto-generated using the generate_nurse_id function.
    doctor_id is passed in the request body.
    """
    try:
        data = await request.json()

        logger.info("Nurse Registration Started")
        
        username = data["username"]
        email = data.get("email") or None
        phone = data["phone_number"]
        doctor_id = data["doctor_id"]  # Added doctor_id

        # Check if the username already exists
        existing_username = user_auth_collection.find_one({"username": username})
        if existing_username:
            emit_audit(request.app, AuditEvent(
                timestamp=datetime.utcnow(),
                level="ERROR",
                source={"service": "gateway", "component": "nurse_route"},
                actor={
                    "type": current_user["role"],
                    "id": current_user["sys_user_id"]
                },
                context={
                    "trace_id": request.state.trace_id,
                    "ip": get_client_ip(request),
                    "endpoint": "/nurseadd"
                },
                clinical_context={
                    "data_sensitivity": "PHI",
                    "hospital_id": data.get("hospital_id")
                },
                action={
                    "type": "CREATE_NURSE",
                    "status": "FAILED",
                    "reason": f"Username '{username}' already exists"
                }
            ))
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "message": f"Username '{username}' already exists"
                }
            )

        if email:
            existing_email = user_auth_collection.find_one({"email": email})
            if existing_email:
                emit_audit(request.app, AuditEvent(
                    timestamp=datetime.utcnow(),
                    level="ERROR",
                    source={"service": "gateway", "component": "nurse_route"},
                    actor={
                        "type": current_user["role"],
                        "id": current_user["sys_user_id"]
                    },
                    context={
                        "trace_id": request.state.trace_id,
                        "ip": get_client_ip(request),
                        "endpoint": "/nurseadd"
                    },
                    clinical_context={
                        "data_sensitivity": "PHI",
                        "hospital_id": data.get("hospital_id")
                    },
                    action={
                        "type": "CREATE_NURSE",
                        "status": "FAILED",
                        "reason": f"Email '{email}' already exists"
                    }
                ))
                return JSONResponse(
                    status_code=400,
                    content={
                        "status": "error",
                        "message": f"Email '{email}' already exists"
                    }
                )

        # Check if the phone number is already in use
        existing_phone = user_auth_collection.find_one({"phone_number": phone})
        if existing_phone:
            emit_audit(request.app, AuditEvent(
                timestamp=datetime.utcnow(),
                level="ERROR",
                source={"service": "gateway", "component": "nurse_route"},
                actor={
                    "type": current_user["role"],
                    "id": current_user["sys_user_id"]
                },
                context={
                    "trace_id": request.state.trace_id,
                    "ip": get_client_ip(request),
                    "endpoint": "/nurseadd"
                },
                clinical_context={
                    "data_sensitivity": "PHI",
                    "hospital_id": data.get("hospital_id")
                },
                action={
                    "type": "CREATE_NURSE",
                    "status": "FAILED",
                    "reason": f"Phone number '{phone}' already exists"
                }
            ))
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "message": f"Phone number '{phone}' already exists"
                }
            )

        # Proceed with the nurse creation
        sys_user_id = generate_nurse_id()
        nurse_assist_id = generate_random_string()
        logger.info(f"RAW PASSWORD RECEIVED: {data['password']} - LENGTH: {len(data['password'])}")

        hashed_pw = hash_password(data["password"])
        created_at = data.get("created_at", datetime.now())
        hospital_id = data["hospital_id"]
        hospital = hospital_user_collection.find_one({"sys_user_id": hospital_id})
        if not hospital:
            emit_audit(request.app, AuditEvent(
                timestamp=datetime.utcnow(),
                level="ERROR",
                source={"service": "gateway", "component": "nurse_route"},
                actor={
                    "type": current_user["role"],
                    "id": current_user["sys_user_id"]
                },
                context={
                    "trace_id": request.state.trace_id,
                    "ip": get_client_ip(request),
                    "endpoint": "/nurseadd"
                },
                clinical_context={
                    "data_sensitivity": "PHI",
                    "hospital_id": data.get("hospital_id")
                },
                action={
                    "type": "CREATE_NURSE",
                    "status": "FAILED",
                    "reason": f"Hospital ID '{hospital_id}' does not exist"
                }
            ))
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "message": f"Hospital ID '{hospital_id}' does not exist"
                }
            )
        hospital_name = hospital.get("name", "")

        # Create Nurse Model Object
        nurse_obj = Nurse(
            name=data["name"],
            hospital_id=data["hospital_id"],
            sys_user_id=sys_user_id,  # unique id
            nurse_id=nurse_assist_id,  # Auto-generated UUID ID
            doctor_id=doctor_id,  # New doctor_id field
            email=data.get("email") or None,
            phone_number=data["phone_number"],
            username=data["username"],
            address=data.get("address"),
            hospital_name=hospital_name,
            country_code=data["country_code"],
            qualifications=data.get("qualifications"),
            registeration_number=data.get("registeration_number"),
            created_at=created_at
        )

        # Create Users Model Object
        user_obj = Users(
            sys_user_id=sys_user_id,
            doctor_assist_id=nurse_assist_id,
            email=data.get("email") or None,
            phone_number=data["phone_number"],
            username=data["username"],
            password=hashed_pw,
            role="nurse",  # role for nurse
            user_type="first_account",
            status="active",
            created_at=created_at,
            renewed_at=created_at
        )

        # Insert into MongoDB
        nurse_user_collection.insert_one(nurse_obj.model_dump())  # Using the same collection to insert nurse
        user_auth_collection.insert_one(user_obj.model_dump())

        logger.info("Nurse and User Auth inserted successfully")
        
        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="INFO",
            source={"service": "gateway", "component": "nurse_route"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/nurseadd"
            },
            clinical_context={
                "data_sensitivity": "PHI",
                "hospital_id": data.get("hospital_id")
            },
            action={
                "type": "CREATE_NURSE",
                "status": "SUCCESS",
                "nurse_sys_user_id": sys_user_id
            }
        ))

        return {
            "status": "success",
            "message": "Nurse registered successfully.",
            "nurse_id": sys_user_id
        }

    except Exception as e:
        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="ERROR",
            source={"service": "gateway", "component": "nurse_route"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/nurseadd"
            },
            clinical_context={
                "data_sensitivity": "PHI",
                "hospital_id": data.get("hospital_id")
            },
            action={
                "type": "CREATE_NURSE",
                "status": "FAILED",
                "reason": str(e)
            }
        ))
        logger.exception("Nurse Creation Failed: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")




@router.get("/nurses")
async def get_all_nurses():
    try:
        # Fetch all nurse data from the nurse_user_collection
        nurses = list(nurse_user_collection.find())  # Retrieve all records from the collection

        # Convert ObjectId to string for JSON serialization
        for nurse in nurses:
            nurse["_id"] = str(nurse["_id"])

        return {"status": "success", "data": nurses}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")


@router.get("/get_doctor_nurse/{nurse_id}")
async def get_doctor_by_nurse_id(nurse_id: str):
    try:
        # Query the nurse_user_collection for the provided nurse_id
        nurse = nurse_user_collection.find_one({"sys_user_id": nurse_id})

        if nurse is None:
            raise HTTPException(status_code=404, detail="Nurse not found")

        # Return both doctor_id and name associated with the nurse
        return {
            "status": "success",
            "doctor_id": nurse["doctor_id"],
            "name": nurse["name"]
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")




############################################Nurse functions end##############################################



########adminrulee transfer to doctor rule#######3


async def apply_admin_rules_to_doctor_service(
    doctor_id: str,
    doctor_specialty: str,
    admin_rule_agent_collection,
    doctor_rule_agent_collection
):
    """
    Apply ADMIN rules to doctor based on specialty.
    """

    try:
        logger.info(
            f"🚀 Applying admin rules | doctor={doctor_id} | specialty={doctor_specialty}"
        )

        # ==============================
        # GET ADMIN RULE DOCUMENT
        # ==============================
        admin_doc = admin_rule_agent_collection.find_one(
            {"type": "admin_agent_rules"},
            {"_id": 0}
        )

        if not admin_doc:
            logger.warning("⚠️ No admin rules found")
            return

        all_rules = admin_doc.get("rules", {})

        # ==============================
        # GET ONLY DOCTOR SPECIALTY RULES
        # ==============================
        specialty_rules = all_rules.get(doctor_specialty, {})

        if not specialty_rules:
            logger.warning(
                f"⚠️ No admin rules found for specialty={doctor_specialty}"
            )
            return

        # ==============================
        # APPLY EACH AGENT RULE
        # ==============================
        for agent, rule_text in specialty_rules.items():

            await save_single_agent_rule(
                doctor_id=doctor_id,
                agent=agent,
                rule=rule_text,
                doctor_rule_agent_collection=doctor_rule_agent_collection
            )

        logger.info(
            f"✅ Admin rules applied | doctor={doctor_id} | specialty={doctor_specialty}"
        )

    except Exception as e:
        logger.error(f"❌ Failed applying admin rules: {str(e)}")
        
        
async def save_single_agent_rule(
    doctor_id: str,
    agent: str,
    rule: str,
    doctor_rule_agent_collection
):

    try:
        logger.info(
            f"🧾 Saving doctor agent rule | doctor={doctor_id} | agent={agent}"
        )

        update_doc = {
            "$set": {
                f"rules.{agent}": rule,
                "doctor_id": doctor_id,
                "updated_at": datetime.utcnow().isoformat()
            }
        }

        # ✅ pymongo sync call
        result = doctor_rule_agent_collection.update_one(
            {"doctor_id": doctor_id},
            update_doc,
            upsert=True
        )

        return {
            "status": "success",
            "doctor_id": doctor_id,
            "agent": agent
        }

    except Exception as e:
        logger.error(f"❌ Failed saving doctor rule: {str(e)}")
        return {"status": "error", "error": str(e)}


class SingleDoctorAgentRuleRequest(BaseModel):
    doctor_id: str
    agent: str
    rule: str
from fastapi import Form

@router.post("/doctor-agent-rules/save-single")
async def save_single_doctor_agent_rule_endpoint(
    doctor_id: str = Form(...),
    agent: str = Form(...),
    rule: str = Form(...)
):

    try:
        logger.info(
            f"📥 API Request | doctor_id={doctor_id} | agent={agent}"
        )

        result = await save_single_agent_rule(
            doctor_id=doctor_id,
            agent=agent,
            rule=rule,
            doctor_rule_agent_collection=doctor_rule_agent_collection
        )

        return result

    except Exception as e:
        logger.error(f"❌ API Failed | error={str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


def store_registration_pincode(user_id: str, pincode: str, district: str = None, initial_status: str = "Unavailable") -> None:
    if not pincode:
        return
    field_officer_availability_collection.update_one(
        {"userId": user_id},
        {
            "$setOnInsert": {
                "userId":        user_id,
                "pincode":       pincode.strip(),
                "district":      district,
                "status":        initial_status,
                "lastLoginDate": None,
                "latitude":      None,
                "longitude":     None,
                "availableFrom": "09:00",
                "availableTo":   "18:00",
                "lastUpdated":   datetime.now(timezone.utc),
            }
        },
        upsert=True,
    )
# important should remove later
current_user = {}
current_user["sys_user_id"] = "rem_unknown_id"
current_user["role"] = "rem_unknown_type"
field_officer_availability_collection = db["field_officer_availability"]

@router.post("/quality-checker/add")
async def add_user(request: Request, current_user=Depends(get_current_user)):
    """
    Create user based on role:
    - quality-checker → quality_admin_collection
    - field-officer → field_officer_collection
    - user_auth_collection (common for both)
    """

    try:
        data = await request.json()
        logger.info("User Registration Started")

        # ============================
        # EXTRACT FIELDS
        # ============================

        full_name = data["fullName"]
        username = data["username"]
        email = data.get("email")
        phone = data["phoneNumber"]
        password = data["password"]
        role = data.get("role")  # 🔥 NEW

        company_name = data["companyName"]
        street_address = data["streetAddress"]
        city = data["city"]
        state = data.get("state")
        postal_code = data.get("postalCode")
        country = data["country"]

        # ============================
        # VALIDATE ROLE
        # ============================

        if role not in ["quality-checker", "field-officer"]:
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": "Invalid role"}
            )

        # ============================
        # DUPLICATE CHECKS (COMMON)
        # ============================

        if user_auth_collection.find_one({"username": username}):
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": f"Username '{username}' already exists"}
            )

        if email and user_auth_collection.find_one({"email": email}):
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": f"Email '{email}' already exists"}
            )

        if user_auth_collection.find_one({"phone_number": phone}):
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": f"Phone '{phone}' already exists"}
            )

        # ============================
        # GENERATE IDS
        # ============================

        if role == "quality-checker":
            sys_user_id = generate_quality_checker_id()

        elif role == "field-officer":
            sys_user_id = generate_field_officer_id()
        user_unique_id = generate_random_string()

        hashed_password = hash_password(password)
        created_at = datetime.utcnow()

        # ============================
        # COMMON USER OBJECT (AUTH)
        # ============================

        user_obj = {
            "sys_user_id": sys_user_id,
            "doctor_assist_id": user_unique_id,
            "email": email,
            "full_name": full_name,   # ✅ ADD THIS
            "phone_number": phone,
            "username": username,
            "password": hashed_password,
            "role": role,
            "user_type": "first_account",
            "status": "active",
            "created_at": created_at,
            "renewed_at": created_at
        }
        
        # ============================
        # ROLE BASED OBJECT + INSERT
        # ============================

        if role == "quality-checker":

            quality_checker_obj = {
                "sys_user_id": sys_user_id,
                "quality_checker_id": user_unique_id,
                "name": full_name,
                "username": username,
                "email": email,
                "phone_number": phone,
                "company_name": company_name,
                "address": {
                    "street": street_address,
                    "city": city,
                    "state": state,
                    "postal_code": postal_code,
                    "country": country
                },
                "created_at": created_at,
                "created_by": current_user["sys_user_id"]
            }

            quality_admin_collection.insert_one(quality_checker_obj)

        elif role == "field-officer":

            field_officer_obj = {
                "sys_user_id": sys_user_id,
                "field_officer_id": user_unique_id,
                "name": full_name,
                "username": username,
                "email": email,
                "phone_number": phone,
                "company_name": company_name,
                "address": {
                    "street": street_address,
                    "city": city,
                    "state": state,
                    "postal_code": postal_code,
                    "country": country
                },
                "created_at": created_at,
                "created_by": current_user["sys_user_id"]
            }

            field_officer_collection.insert_one(field_officer_obj)
            if role == "field-officer":
                registration_pincode = data.get("pincode", "")
                registration_district = data.get("district", "")
                initial_status = data.get("initialStatus", "Unavailable")
                if initial_status not in ("Available", "Unavailable"):
                    initial_status = "Unavailable"
                if registration_pincode:
                    store_registration_pincode(
                        user_id=sys_user_id,
                        pincode=registration_pincode,
                        district=registration_district or None,
                        initial_status=initial_status,
                    )

        # ============================
        # INSERT AUTH (COMMON)
        # ============================

        user_auth_collection.insert_one(user_obj)

        logger.info(f"{role} Registered Successfully")

        return {
            "status": "success",
            "message": f"{role} registered successfully",
            "user_id": sys_user_id
        }

    except Exception as e:
        logger.exception("User Registration Failed: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))




@router.get("/users/all")
async def get_all_users(role: str):
    """
    Fetch all users based on role
    """

    try:
        if role == "quality-checker":
            collection = quality_admin_collection

        elif role == "field-officer":
            collection = field_officer_collection

        else:
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": "Invalid role"}
            )

        data = list(collection.find({}, {"_id": 0}))

        return {
            "status": "success",
            "role": role,
            "count": len(data),
            "data": data
        }

    except Exception as e:
        logger.exception("Error fetching users: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))
   
@router.get("/users/{user_id}")
async def get_user_by_id(user_id: str, role: str):
    """
    Fetch single user by sys_user_id and role
    """

    try:
        if role == "quality-checker":
            collection = quality_admin_collection

        elif role == "field-officer":
            collection = field_officer_collection

        else:
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": "Invalid role"}
            )

        user = collection.find_one(
            {"sys_user_id": user_id},
            {"_id": 0}
        )

        if not user:
            return JSONResponse(
                status_code=404,
                content={"status": "error", "message": f"{role} not found"}
            )

        return {
            "status": "success",
            "role": role,
            "data": user
        }

    except Exception as e:
        logger.exception("Error fetching user: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))



@router.get("/status-appointments/{hospital_id}")
def get_status_appointments(hospital_id: str):
    """
    Get all status appointments from the collection based on the hospital_id
    """
    try:
        # Get all data filtered by hospital_id from your synchronous collection
        all_data = status_appointment_collection.find({"hospital_id": hospital_id})

        # Convert ObjectId to string for JSON serialization
        all_data = list(all_data)  # Convert cursor to list

        # Convert all ObjectId to string
        for item in all_data:
            if "_id" in item and isinstance(item["_id"], ObjectId):
                item["_id"] = str(item["_id"])

        return {
            "success": True,
            "message": "Status appointments retrieved successfully",
            "data": all_data,
            "count": len(all_data)
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "success": False,
                "message": "Failed to retrieve status appointments",
                "error": str(e)
            }
        )

@router.get("/patients_by_hospital/{hospital_id}")
def get_patients_by_hospital(hospital_id: str):
    """
    Get all patients from the collection based on the hospital_id
    """
    try:
        # Get all data filtered by hospital_id from the collection
        patients_cursor = patient_user_collection.find({"hospital_id": hospital_id})

        # Convert cursor to list
        patients_list = list(patients_cursor)

        # Convert all ObjectId to string explicitly
        for patient in patients_list:
            if "_id" in patient and isinstance(patient["_id"], ObjectId):
                patient["_id"] = str(patient["_id"])

        # Use jsonable_encoder to handle other complex types
        patients_list = jsonable_encoder(patients_list)

        return {
            "success": True,
            "message": "Patients retrieved successfully",
            "data": patients_list,
            "count": len(patients_list)
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "success": False,
                "message": "Failed to retrieve patients",
                "error": str(e)
            }
        )



class RegisterHospitalDoctorRequest(BaseModel):
    hospital_name: str
    doctor_name: str
    doctor_email: str
    doctor_specialty: str = "General Medicine"  # Default to "General Medicine" if not provided
    doctor_phone: str = None  # Optional phone number

@router.post("/register-hospital-doctor")
async def register_hospital_doctor(data: RegisterHospitalDoctorRequest):
    # Get the backend and frontend URLs from environment variables
    api_base_url = os.getenv("VITE_BACKEND_URL")
    api_url = os.getenv("FRONTEND_URL")
    admin_username = os.getenv("ADMIN_USERNAME")  # Admin username from env variable
    admin_password = os.getenv("ADMIN_PASSWORD")  # Admin password from env variable

    # Step 1: Admin login to obtain the token from cookies
    login_url = f"{api_base_url}/hms/users/auth/login"
    login_payload = {
        "username": admin_username,
        "password": admin_password
    }

    async with httpx.AsyncClient() as client:
        # Sending request to login and get the cookies with the token
        login_response = await client.post(login_url, json=login_payload)

        if login_response.status_code != 200:
            raise HTTPException(status_code=401, detail="Unauthorized: Admin login failed")

        # Extracting the access token from cookies
        token = login_response.cookies.get("access_token")

        if not token:
            raise HTTPException(status_code=401, detail="Unauthorized: No access token received in cookies")

        # Step 2: Create hospital with the obtained token
        hospital_data = {
            "name": data.hospital_name,
            "address": "",
            "headquarters": "",
            "username": f"{data.hospital_name}_inst",
            "password": "Dra@2026",
            "email": "",
            "phone_number": "",
            "no_of_staff": 1,
            "no_of_beds": 1,
            "country_code": "IN",
            "hospital_user_type": "da_user",
        }

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }

        hospital_response = await client.post(
            f"{api_base_url}/hms/users/hospitals/hospitaladd",
            json=hospital_data,
            headers=headers
        )

        # if hospital_response.status_code != 200:
        #     raise HTTPException(status_code=500, detail="Hospital registration failed")

        hospital_response_data = hospital_response.json()
        hospital_id = hospital_response_data.get("hospital_id")

        if not hospital_id:
            raise HTTPException(status_code=500, detail="Hospital ID not returned")

        # Step 3: Create doctor using the hospital ID
        doctor_data = {
            "name": data.doctor_name,
            "username": f"{data.doctor_name.split()[0].lower()}@dra",  # First name as username
            "email": data.doctor_email,
            "country_code": "IN",
            "phone_number": data.doctor_phone if data.doctor_phone else "",  # If phone provided, else empty string
            "password": "Dra@2026",  # Predefined password
            "specialization": data.doctor_specialty,  # Use provided or default
            "qualifications": "",  # Optional (you can make it required if needed)
            "registeration_number": "",  # Optional
            "address": "",  # Optional
            "hospital_id": hospital_id,  # Add the hospital ID from the previous step
        }

        doctor_response = await client.post(
            f"{api_base_url}/hms/users/doctors/doctoradd",
            json=doctor_data,
            headers=headers
        )

        if doctor_response.status_code != 200:
            raise HTTPException(status_code=500, detail="Doctor registration failed")
        
        # Construct the login URLs for both hospital and doctor
        hospital_login_url = f"{api_url}/login"
        doctor_login_url = f"{api_url}/login"
        
        return {
            "status": "success",
            "message": "Hospital and Doctor registered successfully",
            "hospital": {
                "username": f"{data.hospital_name}_inst",
                "password": "Dra@2026",
                "login_url": hospital_login_url
            },
            "doctor": {
                "name": data.doctor_name,
                "username": f"{data.doctor_name.split()[0].lower()}@dra",
                "password": "Dra@2026",
                "login_url": doctor_login_url
            }
        }



@router.post("/doctor-details")
async def save_doctor_details(request: Request):
    try:
        # Parse the request JSON data
        data = await request.json()
        
        # Extract individual fields from the request data
        name = data.get("name")
        phone_number = data.get("phone_number")
        email = data.get("email")
        speciality = data.get("speciality")
        hospital = data.get("hospital")

        # Check if any field is missing
        if not all([name, phone_number, email, speciality, hospital]):
            raise HTTPException(status_code=400, detail="Missing required fields")

        # Prepare the data to be inserted into MongoDB
        doctor_data = {
            "name": name,
            "phone_number": phone_number,
            "email": email,
            "speciality": speciality,
            "hospital": hospital
        }

        # Insert the doctor details into the MongoDB collection
        result = await doctor_details_collection.insert_one(doctor_data)

        # Return success response with the inserted ID
        return {"message": "Doctor details saved successfully", "doctor_id": str(result.inserted_id)}

    except Exception as e:
        # Handle any errors during insert operation
        raise HTTPException(status_code=500, detail=f"An error occurred: {e}")
    