import httpx
from typing import Dict, Any
from datetime import datetime, date, timedelta
import re
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, WebSocket, status, File, Form, UploadFile,Body,Query
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse, FileResponse
# from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field, EmailStr, validator
from typing import Any, Dict, List, Optional, Union
from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, date, timedelta
from bson import ObjectId
from enum import Enum
from datetime import date
from typing import List, Optional
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
import traceback
from datetime import datetime, timedelta
import pandas as pd
from io import BytesIO
from fastapi import UploadFile, File, HTTPException, Form
import base64
from bson import ObjectId
from groq import Groq
from fastapi import Query
from typing import Optional
from fastapi import Response
from jose import jwt, JWTError
from datetime import datetime, timedelta
from fastapi.encoders import jsonable_encoder
from requests.auth import HTTPBasicAuth
from dotenv import load_dotenv
import os
from httpx import AsyncClient, ConnectError, ConnectTimeout, ReadTimeout, TimeoutException

load_dotenv()
api_base_url = os.getenv("VITE_BACKEND_URL")


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
ACCESS_TOKEN_EXPIRE_DAYS= os.getenv("ACCESS_TOKEN_EXPIRE_DAYS")
ACCESS_TOKEN_EXPIRE_DAY = int(os.getenv("ACCESS_TOKEN_EXPIRE_DAYS", 1))

api_key = os.getenv("GROQ_API_KEY")

groq_client = Groq(api_key=api_key)

router = APIRouter(
    prefix="/system",
    tags=["integration"],
    responses={404: {"description": "Not found"}},
)

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

mongodb_client = AsyncIOMotorClient(MONGO_URI)  # async (Motor)
database = mongodb_client[MONGO_DB]

client = MongoClient(MONGO_URI)  # sync (PyMongo)
db = client[MONGO_DB]


user_auth_collection = db["user_auth"]

hospital_user_collection = db["hospital_users"]

doctor_user_collection = db["doctor_users"]

patient_user_collection = db["patient_users"]

patient_appointments_collection = db["patient_appointments"]

patient_vitals_collection = db["patient_vitals"]

insurance_providers_collection = db["insurance_providers"]  

dictation_collection = database["dictation"]

documentation_treatment_plan_collection = database["documentation-treatment-plan"]
documentation_investigation_notes_collection = database["documentation-investigation-notes"]
documentation_medication_analysis_collection = database["documentation-medication-analysis"]
documentation_clinical_notes_collection = database["documentation-clinical-notes"]
patient_visit_history_collection = database["patientVisitHistory"]
integration_lab_reports_collection = database["integration_lab_reports"]

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str):
    return pwd_context.hash(password)


def generate_patient_id():
    return f"PAT-{uuid.uuid4()}"

def convert_mongo_document(doc):
    if not doc:
        return doc
    doc["_id"] = str(doc["_id"])
    return doc

def generate_patient_id():
    return f"PAT-{uuid.uuid4()}"

class BaseDocument(BaseModel):
    created_at: Optional[datetime] = None
   

class PatientDemoGraphic(BaseDocument):
    sys_user_id: str # long globally unique id
    patient_id: str # short id unique for doctor assist system
    hospital_id: str
    name: str
    date_of_birth: datetime
    gender: str
    email: Optional[str] = None
    phone_number: str
    blood_group: Optional[str] = None
    marital_status: Optional[str] = None
    address: Optional[str] = None
    education: Optional[str] = None
    occupation: Optional[str] = None
    annual_income: Optional[str] = None
    family_history: Optional[str] = None
    hms_id: Optional[str] = None
   

class PatientInsurance(BaseDocument):
    sys_user_id: str
    patient_id: str
    hospital_id: str

    payer_scheme: str
    country: str

    primary_payer_name: str
    primary_payer_code: str
    primary_policy_number: str
    primary_member_id: str

    primary_card_bin: Optional[str] = None
    primary_coverage_plan: Optional[str] = None
    primary_network_tier: Optional[str] = None

    primary_valid_from: Optional[str] = None
    primary_valid_to: Optional[str] = None

    primary_relationship_to_insured: Optional[str] = None
    primary_sponsor_name: Optional[str] = None
    primary_emirates_id_or_national_id: Optional[str] = None

    primary_co_pay_percent: Optional[int] = None
    primary_deductible_amount: Optional[float] = None
    primary_max_annual_limit: Optional[float] = None

    primary_exclusions: Optional[List[str]] = []

    primary_front_card_image_b64: Optional[str] = None
    primary_back_card_image_b64: Optional[str] = None

    primary_insurance_data_share: Optional[bool] = None
    primary_claim_submission: Optional[bool] = None



########################################################################## ENDPOINTS #######################################################################################################

#Patient Demographic


# @router.post("/patient-demographics")
# async def create_patient_demographics(request: Request):
#     logger.info("Patient demographics creation initiated")

#     try:
#         data = await request.json()
#         logger.debug(f"Incoming payload keys: {list(data.keys())}")

#         demographics = data.get("demographics", {})
#         insurance = data.get("insurance_profile")
#         hms_id = data.get("hms_patient_id")

#         # -----------------------------
#         # REQUIRED VALIDATION (NESTED PAYLOAD)
#         # -----------------------------
#         if not data.get("hospital_id"):
#             logger.warning("Validation failed: hospital_id missing")
#             raise HTTPException(status_code=400, detail="hospital_id is required")

#         if not hms_id:
#             logger.warning("Validation failed: hms_patient_id missing")
#             raise HTTPException(status_code=400, detail="hms_patient_id is required")

#         if not demographics.get("name"):
#             raise HTTPException(status_code=400, detail="demographics.name is required")

#         if not demographics.get("dob"):
#             raise HTTPException(status_code=400, detail="demographics.dob is required")

#         if not demographics.get("sex"):
#             raise HTTPException(status_code=400, detail="demographics.sex is required")

#         if not demographics.get("phone"):
#             raise HTTPException(status_code=400, detail="demographics.phone is required")

#         # -----------------------------
#         # HOSPITAL VALIDATION
#         # -----------------------------
#         external_hospital_id = data["hospital_id"]

#         hospital = hospital_user_collection.find_one(
#             {"hospital_id": external_hospital_id},
#             {"_id": 0, "sys_user_id": 1}
#         )

#         if not hospital:
#             logger.warning(f"Hospital not found | hospital_id={external_hospital_id}")
#             raise HTTPException(status_code=404, detail="Hospital not found")

#         hospital_sys_user_id = hospital["sys_user_id"]

#         # -----------------------------
#         # DUPLICATE PATIENT CHECK
#         # -----------------------------
#         existing_patient = patient_user_collection.find_one(
#             {
#                 "hospital_id": hospital_sys_user_id,
#                 "patient_id": hms_id
#             },
#             {"_id": 0, "sys_user_id": 1, "patient_id": 1}
#         )

#         if existing_patient:
#             logger.info(
#                 f"Patient already exists | "
#                 f"hms_id={hms_id} | hospital_id={hospital_sys_user_id}"
#             )
#             return {
#                 "status": "exists",
#                 "message": "Patient already exists in this hospital",
#                 "patient_id": existing_patient["patient_id"],
#                 "sys_user_id": existing_patient["sys_user_id"],
#                 "hospital_id": hospital_sys_user_id
#             }

#         # -----------------------------
#         # IDS & TIMESTAMP
#         # -----------------------------
#         patient_sys_user_id = f"PAT-{ObjectId()}"
#         created_at = datetime.utcnow()

#         logger.info(
#             f"Creating patient demographics | "
#             f"hms_id={hms_id} | "
#             f"sys_user_id={patient_sys_user_id} | "
#             f"hospital_id={hospital_sys_user_id}"
#         )

#         # -----------------------------
#         # PATIENT DEMOGRAPHICS OBJECT
#         # -----------------------------
#         patient_obj = PatientDemoGraphic(
#             sys_user_id=patient_sys_user_id,
#             patient_id=hms_id,
#             hospital_id=hospital_sys_user_id,

#             name=demographics["name"],
#             date_of_birth=datetime.fromisoformat(demographics["dob"]),
#             gender=demographics["sex"],
#             phone_number=demographics["phone"],

#             email=demographics.get("email"),
#             blood_group=demographics.get("blood_group"),
#             marital_status=demographics.get("marital_status"),
#             address=demographics.get("address"),
#             education=demographics.get("education"),
#             occupation=demographics.get("occupation"),
#             annual_income=demographics.get("annual_income"),
#             family_history=demographics.get("family_history"),

#             hms_id=hms_id,
#             created_at=created_at
#         )

#         patient_user_collection.insert_one(patient_obj.model_dump())
#         logger.info(f"Patient demographics inserted | sys_user_id={patient_sys_user_id}")

#         # -----------------------------
#         # INSURANCE (OPTIONAL)
#         # -----------------------------
#         if insurance:
#             logger.info(f"Insurance profile detected | sys_user_id={patient_sys_user_id}")
#             primary = insurance["primary"]

#             insurance_obj = PatientInsurance(
#                 sys_user_id=patient_sys_user_id,
#                 patient_id=hms_id,
#                 hospital_id=hospital_sys_user_id,

#                 payer_scheme=insurance["payer_scheme"],
#                 country=insurance["country"],

#                 primary_payer_name=primary["payer_name"],
#                 primary_payer_code=primary["payer_code"],
#                 primary_policy_number=primary["policy_number"],
#                 primary_member_id=primary["member_id"],

#                 primary_card_bin=primary.get("card_bin"),
#                 primary_coverage_plan=primary.get("coverage_plan"),
#                 primary_network_tier=primary.get("network_tier"),

#                 primary_valid_from=datetime.fromisoformat(primary["valid_from"]),
#                 primary_valid_to=datetime.fromisoformat(primary["valid_to"]),

#                 primary_relationship_to_insured=primary.get("relationship_to_insured"),
#                 primary_sponsor_name=primary.get("sponsor_name"),
#                 primary_emirates_id_or_national_id=primary.get("emirates_id_or_national_id"),

#                 primary_co_pay_percent=primary.get("co_pay_percent"),
#                 primary_deductible_amount=primary.get("deductible_amount"),
#                 primary_max_annual_limit=primary.get("max_annual_limit"),

#                 primary_exclusions=primary.get("exclusions", []),

#                 primary_front_card_image_b64=primary.get("documents", {}).get("front_card_image_b64"),
#                 primary_back_card_image_b64=primary.get("documents", {}).get("back_card_image_b64"),

#                 primary_insurance_data_share=primary.get("consents", {}).get("insurance_data_share"),
#                 primary_claim_submission=primary.get("consents", {}).get("claim_submission"),

#                 created_at=created_at
#             )

#             insurance_providers_collection.insert_one(insurance_obj.model_dump())
#             logger.info(f"Insurance profile inserted | sys_user_id={patient_sys_user_id}")

#         logger.info(f"Patient demographics creation completed | sys_user_id={patient_sys_user_id}")

#         return {
#             "status": "success",
#             "message": "Patient demographics created successfully",
#             "patient_id": hms_id,
#             "sys_user_id": patient_sys_user_id,
#             "hospital_id": hospital_sys_user_id
#         }

#     except HTTPException:
#         raise
#     except Exception:
#         logger.exception("Unexpected error during patient demographics creation")
#         raise HTTPException(status_code=500, detail="Internal server error")





# @router.post("/patient-demographics")
# async def create_patient_demographics(request: Request):
#     logger.info("Patient demographics creation initiated")

#     try:
#         data = await request.json()
#         logger.info(f"Payload received for patient demographics")
#         logger.info(f"Payload data: {data}")
#         logger.debug(f"Incoming payload keys: {list(data.keys())}")

#         demographics = data.get("demographics", {})
#         logger.info(f"Demographics data extracted: {demographics}")
#         insurance = data.get("insurance_profile")
#         logger.info(f"Insurance profile data extracted: {insurance}")
#         hms_id = data.get("hms_patient_id")
#         logger.info(f"HMS patient ID extracted: {hms_id}")

#         # -----------------------------
#         # REQUIRED VALIDATION (NESTED PAYLOAD)
#         # -----------------------------
#         if not data.get("hospital_id"):
#             logger.warning("Validation failed: hospital_id missing")
#             raise HTTPException(status_code=400, detail="hospital_id is required")

#         if not hms_id:
#             logger.warning("Validation failed: hms_patient_id missing")
#             raise HTTPException(status_code=400, detail="hms_patient_id is required")

#         if not demographics.get("name"):
#             raise HTTPException(status_code=400, detail="demographics.name is required")

#         if not demographics.get("dob"):
#             raise HTTPException(status_code=400, detail="demographics.dob is required")

#         if not demographics.get("sex"):
#             raise HTTPException(status_code=400, detail="demographics.sex is required")

#         if not demographics.get("phone"):
#             raise HTTPException(status_code=400, detail="demographics.phone is required")

#         # -----------------------------
#         # HOSPITAL VALIDATION
#         # -----------------------------
#         external_hospital_id = data["hospital_id"]

#         hospital = hospital_user_collection.find_one(
#             {"hospital_id": external_hospital_id},
#             {"_id": 0, "sys_user_id": 1}
#         )

#         if not hospital:
#             logger.warning(f"Hospital not found | hospital_id={external_hospital_id}")
#             raise HTTPException(status_code=404, detail="Hospital not found")

#         hospital_sys_user_id = hospital["sys_user_id"]

#         # -----------------------------
#         # DUPLICATE PATIENT CHECK
#         # -----------------------------
#         existing_patient = patient_user_collection.find_one(
#             {
#                 "hospital_id": hospital_sys_user_id,
#                 "patient_id": hms_id
#             },
#             {"_id": 0, "sys_user_id": 1, "patient_id": 1}
#         )

#         if existing_patient:
#             logger.info(
#                 f"Patient already exists | "
#                 f"hms_id={hms_id} | hospital_id={hospital_sys_user_id}"
#             )
#             return {
#                 "status": "exists",
#                 "message": "Patient already exists in this hospital",
#                 "patient_id": existing_patient["patient_id"],
#                 "sys_user_id": existing_patient["sys_user_id"],
#                 "hospital_id": hospital_sys_user_id
#             }

#         # -----------------------------
#         # IDS & TIMESTAMP
#         # -----------------------------
#         patient_sys_user_id = f"PAT-{ObjectId()}"
#         created_at = datetime.utcnow()

#         logger.info(
#             f"Creating patient demographics | "
#             f"hms_id={hms_id} | "
#             f"sys_user_id={patient_sys_user_id} | "
#             f"hospital_id={hospital_sys_user_id}"
#         )

#         # -----------------------------
#         # PATIENT DEMOGRAPHICS OBJECT
#         # -----------------------------
#         patient_obj = PatientDemoGraphic(
#             sys_user_id=patient_sys_user_id,
#             patient_id=hms_id,
#             hospital_id=hospital_sys_user_id,

#             name=demographics["name"],
#             date_of_birth=datetime.fromisoformat(demographics["dob"]),
#             gender=demographics["sex"],
#             phone_number=demographics["phone"],

#             email=demographics.get("email"),
#             blood_group=demographics.get("blood_group"),
#             marital_status=demographics.get("marital_status"),
#             address=demographics.get("address"),
#             education=demographics.get("education"),
#             occupation=demographics.get("occupation"),
#             annual_income=demographics.get("annual_income"),
#             family_history=demographics.get("family_history"),

#             hms_id=hms_id,
#             created_at=created_at
#         )

#         # -----------------------------
#         # EXTRACT APPOINTMENT DATA FROM PAYLOAD
#         # -----------------------------
#         appointment_data = data.get("appointment", {})
#         appointment_id = appointment_data.get("appointment_id") or f"APT-{str(ObjectId())}"
#         appointment_date = appointment_data.get("appointment_date")
#         scheduled_time = appointment_data.get("scheduled_time")
#         visit_type = appointment_data.get("visit_type")
#         chief_complaint = appointment_data.get("chief_complaint")

#         # -----------------------------
#         # CALL THE TAKE APPOINTMENT FUNCTION
#         # -----------------------------
#         appointment_payload = {
#             "hospital_id": data["hospital_id"],
#             "doctor_id": appointment_data.get("doctor_id"),
#             "patient_id": hms_id,
#             "appointment_id": appointment_id,
#             "appointment_date": appointment_date,
#             "scheduled_time": scheduled_time,
#             "visit_type": visit_type,
#             "chief_complaint": chief_complaint
#         }

#         # Assuming take_appointment is already imported or accessible
#         response = await take_appointment(appointment_payload)

#         # -----------------------------
#         # SAVE PATIENT DEMOGRAPHICS OBJECT
#         # -----------------------------

#         patient_user_collection.insert_one(patient_obj.model_dump())
#         logger.info(f"Patient demographics inserted | sys_user_id={patient_sys_user_id}")

#         # -----------------------------
#         # INSURANCE (OPTIONAL)
#         # -----------------------------
#         if insurance:
#             logger.info(f"Insurance profile detected | sys_user_id={patient_sys_user_id}")
#             primary = insurance["primary"]

#             insurance_obj = PatientInsurance(
#                 sys_user_id=patient_sys_user_id,
#                 patient_id=hms_id,
#                 hospital_id=hospital_sys_user_id,

#                 payer_scheme=insurance["payer_scheme"],
#                 country=insurance["country"],

#                 primary_payer_name=primary["payer_name"],
#                 primary_payer_code=primary["payer_code"],
#                 primary_policy_number=primary["policy_number"],
#                 primary_member_id=primary["member_id"],

#                 primary_card_bin=primary.get("card_bin"),
#                 primary_coverage_plan=primary.get("coverage_plan"),
#                 primary_network_tier=primary.get("network_tier"),

#                 primary_valid_from=datetime.fromisoformat(primary["valid_from"]),
#                 primary_valid_to=datetime.fromisoformat(primary["valid_to"]),

#                 primary_relationship_to_insured=primary.get("relationship_to_insured"),
#                 primary_sponsor_name=primary.get("sponsor_name"),
#                 primary_emirates_id_or_national_id=primary.get("emirates_id_or_national_id"),

#                 primary_co_pay_percent=primary.get("co_pay_percent"),
#                 primary_deductible_amount=primary.get("deductible_amount"),
#                 primary_max_annual_limit=primary.get("max_annual_limit"),

#                 primary_exclusions=primary.get("exclusions", []),

#                 primary_front_card_image_b64=primary.get("documents", {}).get("front_card_image_b64"),
#                 primary_back_card_image_b64=primary.get("documents", {}).get("back_card_image_b64"),

#                 primary_insurance_data_share=primary.get("consents", {}).get("insurance_data_share"),
#                 primary_claim_submission=primary.get("consents", {}).get("claim_submission"),

#                 created_at=created_at
#             )

#             insurance_providers_collection.insert_one(insurance_obj.model_dump())
#             logger.info(f"Insurance profile inserted | sys_user_id={patient_sys_user_id}")

#         # -----------------------------
#         # CONTEXT PAYLOADS (Medical & Current Context)
#         # -----------------------------
#         context_date = datetime.utcnow().date()
#         text_parts = []

#         if demographics.get("dob"):
#             try:
#                 dob = datetime.strptime(demographics["dob"], "%Y-%m-%d").date()
#                 today = datetime.utcnow().date()
#                 age = today.year - dob.year - (
#                     (today.month, today.day) < (dob.month, dob.day)
#                 )
#                 text_parts.append(f"Age: {age} years")
#             except ValueError:
#                 logger.warning(
#                     f"Invalid DOB format '{demographics.get('dob')}', skipping age",
#                     extra={"patient_id": patient_sys_user_id}
#                 )

#         if demographics.get("sex"):
#             text_parts.append(f"Gender: {demographics['sex']}")

#         if demographics.get("blood_group"):
#             text_parts.append(f"Blood group: {demographics['blood_group']}")

#         if demographics.get("family_history"):
#             text_parts.append(f"Family history: {demographics['family_history']}")

#         if not text_parts:
#             raise ValueError("No demographics data available")

#         clinical_text = ", ".join(text_parts) + "."
#         context_id = str(uuid.uuid4())
#         date_str = context_date.isoformat()

#         # Current Context Payload
#         current_context_payload = {
#             "doctor_id": None,
#             "patient_id": patient_sys_user_id,
#             "contexts": [
#                 {
#                     "date": date_str,
#                     "current_condition": [
#                         {
#                             "id": context_id,
#                             "text": clinical_text
#                         }
#                     ]
#                 }
#             ]
#         }
#         logger.info(f"Constructed current context payload: {current_context_payload}")

#         # Medical Context Payload
#         medical_context_payload = {
#             "doctor_id": None,
#             "patient_id": patient_sys_user_id,
#             "current_context": [
#                 {
#                     "date": date_str,
#                     "conditions": [
#                         {
#                             "id": context_id,
#                             "text": clinical_text
#                         }
#                     ],
#                     "enabled": True
#                 }
#             ]
#         }

#         logger.info(
#             "Sending patient demographics to current & medical context",
#             extra={
#                 "patient_id": patient_sys_user_id,
#                 "current_payload": current_context_payload,
#                 "medical_payload": medical_context_payload
#             }
#         )

#         async with httpx.AsyncClient(timeout=10.0) as client:
#             await client.post(
#                 f"{api_base_url}hms/users/data/context/current_context_save",
#                 json=current_context_payload,
#                 headers={"Content-Type": "application/json"}
#             )

#             await client.post(
#                 f"{api_base_url}hms/users/data/context/medical_context_save",
#                 json=medical_context_payload,
#                 headers={"Content-Type": "application/json"}
#             )

#         logger.info(f"Patient demographics creation completed | sys_user_id={patient_sys_user_id}")

#         return {
#             "status": "success",
#             "message": "Patient demographics created successfully",
#             "patient_id": hms_id,
#             "sys_user_id": patient_sys_user_id,
#             "hospital_id": hospital_sys_user_id
#         }

#     except HTTPException:
#         raise
#     except Exception:
#         logger.exception("Unexpected error during patient demographics creation")
#         raise HTTPException(status_code=500, detail="Internal server error")



@router.post("/patient-demographics")
async def create_patient_demographics(request: Request):
    logger.info("Patient demographics creation initiated")

    try:
        data = await request.json()
        logger.info(f"Payload received for patient demographics")
        logger.info(f"Payload data: {data}")
        logger.debug(f"Incoming payload keys: {list(data.keys())}")

        demographics = data.get("demographics", {})
        logger.info(f"Demographics data extracted: {demographics}")
        insurance = data.get("insurance_profile")
        logger.info(f"Insurance profile data extracted: {insurance}")
        hms_id = data.get("hms_patient_id")
        logger.info(f"HMS patient ID extracted: {hms_id}")

        # -----------------------------
        # REQUIRED VALIDATION (NESTED PAYLOAD)
        # -----------------------------
        if not data.get("hospital_id"):
            logger.warning("Validation failed: hospital_id missing")
            raise HTTPException(status_code=400, detail="hospital_id is required")

        if not hms_id:
            logger.warning("Validation failed: hms_patient_id missing")
            raise HTTPException(status_code=400, detail="hms_patient_id is required")

        if not demographics.get("name"):
            raise HTTPException(status_code=400, detail="demographics.name is required")

        if not demographics.get("dob"):
            raise HTTPException(status_code=400, detail="demographics.dob is required")

        if not demographics.get("sex"):
            raise HTTPException(status_code=400, detail="demographics.sex is required")

        if not demographics.get("phone"):
            raise HTTPException(status_code=400, detail="demographics.phone is required")

        # -----------------------------
        # HOSPITAL VALIDATION
        # -----------------------------
        external_hospital_id = data["hospital_id"]

        hospital = hospital_user_collection.find_one(
            {"hospital_id": external_hospital_id},
            {"_id": 0, "sys_user_id": 1}
        )

        if not hospital:
            logger.warning(f"Hospital not found | hospital_id={external_hospital_id}")
            raise HTTPException(status_code=404, detail="Hospital not found")

        hospital_sys_user_id = hospital["sys_user_id"]

        # -----------------------------
        # DUPLICATE PATIENT CHECK
        # -----------------------------
        existing_patient = patient_user_collection.find_one(
            {
                "hospital_id": hospital_sys_user_id,
                "patient_id": hms_id
            },
            {"_id": 0, "sys_user_id": 1, "patient_id": 1}
        )

        if existing_patient:
            logger.info(
                f"Patient already exists | "
                f"hms_id={hms_id} | hospital_id={hospital_sys_user_id}"
            )
            return {
                "status": "exists",
                "message": "Patient already exists in this hospital",
                "patient_id": existing_patient["patient_id"],
                "sys_user_id": existing_patient["sys_user_id"],
                "hospital_id": hospital_sys_user_id
            }

        # -----------------------------
        # IDS & TIMESTAMP
        # -----------------------------
        patient_sys_user_id = f"PAT-{ObjectId()}"
        created_at = datetime.utcnow()

        logger.info(
            f"Creating patient demographics | "
            f"hms_id={hms_id} | "
            f"sys_user_id={patient_sys_user_id} | "
            f"hospital_id={hospital_sys_user_id}"
        )

        # -----------------------------
        # PATIENT DEMOGRAPHICS OBJECT
        # -----------------------------
        patient_obj = PatientDemoGraphic(
            sys_user_id=patient_sys_user_id,
            patient_id=hms_id,
            hospital_id=hospital_sys_user_id,

            name=demographics["name"],
            date_of_birth=datetime.fromisoformat(demographics["dob"]),
            gender=demographics["sex"],
            phone_number=demographics["phone"],

            email=demographics.get("email"),
            blood_group=demographics.get("blood_group"),
            marital_status=demographics.get("marital_status"),
            address=demographics.get("address"),
            education=demographics.get("education"),
            occupation=demographics.get("occupation"),
            annual_income=demographics.get("annual_income"),
            family_history=demographics.get("family_history"),

            hms_id=hms_id,
            created_at=created_at
        )

        patient_user_collection.insert_one(patient_obj.model_dump())
        logger.info(f"Patient demographics inserted | sys_user_id={patient_sys_user_id}")

        # -----------------------------
        # INSURANCE (OPTIONAL)
        # -----------------------------
        if insurance:
            logger.info(f"Insurance profile detected | sys_user_id={patient_sys_user_id}")
            primary = insurance["primary"]

            insurance_obj = PatientInsurance(
                sys_user_id=patient_sys_user_id,
                patient_id=hms_id,
                hospital_id=hospital_sys_user_id,

                payer_scheme=insurance["payer_scheme"],
                country=insurance["country"],

                primary_payer_name=primary["payer_name"],
                primary_payer_code=primary["payer_code"],
                primary_policy_number=primary["policy_number"],
                primary_member_id=primary["member_id"],

                primary_card_bin=primary.get("card_bin"),
                primary_coverage_plan=primary.get("coverage_plan"),
                primary_network_tier=primary.get("network_tier"),

                primary_valid_from=(primary["valid_from"]),
                primary_valid_to=(primary["valid_to"]),

                primary_relationship_to_insured=primary.get("relationship_to_insured"),
                primary_sponsor_name=primary.get("sponsor_name"),
                primary_emirates_id_or_national_id=primary.get("emirates_id_or_national_id"),

                primary_co_pay_percent=primary.get("co_pay_percent"),
                primary_deductible_amount=primary.get("deductible_amount"),
                primary_max_annual_limit=primary.get("max_annual_limit"),

                primary_exclusions=primary.get("exclusions", []),

                primary_front_card_image_b64=primary.get("documents", {}).get("front_card_image_b64"),
                primary_back_card_image_b64=primary.get("documents", {}).get("back_card_image_b64"),

                primary_insurance_data_share=primary.get("consents", {}).get("insurance_data_share"),
                primary_claim_submission=primary.get("consents", {}).get("claim_submission"),

                created_at=created_at
            )

            insurance_providers_collection.insert_one(insurance_obj.model_dump())
            logger.info(f"Insurance profile inserted | sys_user_id={patient_sys_user_id}")

        # -----------------------------
        # CONTEXT PAYLOADS (Medical & Current Context)
        # -----------------------------
        context_date = datetime.utcnow().date()
        text_parts = []

        if demographics.get("dob"):
            try:
                dob = datetime.strptime(demographics["dob"], "%Y-%m-%d").date()
                today = datetime.utcnow().date()
                age = today.year - dob.year - (
                    (today.month, today.day) < (dob.month, dob.day)
                )
                text_parts.append(f"Age: {age} years")
            except ValueError:
                logger.warning(
                    f"Invalid DOB format '{demographics.get('dob')}', skipping age",
                    extra={"patient_id": patient_sys_user_id}
                )

        if demographics.get("sex"):
            text_parts.append(f"Gender: {demographics['sex']}")

        if demographics.get("blood_group"):
            text_parts.append(f"Blood group: {demographics['blood_group']}")

        if demographics.get("family_history"):
            text_parts.append(f"Family history: {demographics['family_history']}")

        if not text_parts:
            raise ValueError("No demographics data available")

        clinical_text = ", ".join(text_parts) + "."
        context_id = str(uuid.uuid4())
        date_str = context_date.isoformat()

        # Current Context Payload
        current_context_payload = {
            "doctor_id": None,
            "patient_id": patient_sys_user_id,
            "contexts": [
                {
                    "date": date_str,
                    "current_condition": [
                        {
                            "id": context_id,
                            "text": clinical_text
                        }
                    ]
                }
            ]
        }
        logger.info(f"Constructed current context payload: {current_context_payload}")

        # Medical Context Payload
        medical_context_payload = {
            "doctor_id": None,
            "patient_id": patient_sys_user_id,
            "current_context": [
                {
                    "date": date_str,
                    "conditions": [
                        {
                            "id": context_id,
                            "text": clinical_text
                        }
                    ],
                    "enabled": True
                }
            ]
        }

        logger.info(
            "Sending patient demographics to current & medical context",
            extra={
                "patient_id": patient_sys_user_id,
                "current_payload": current_context_payload,
                "medical_payload": medical_context_payload
            }
        )

        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"{api_base_url}hms/users/data/context/current_context_save",
                json=current_context_payload,
                headers={"Content-Type": "application/json"}
            )

            await client.post(
                f"{api_base_url}hms/users/data/context/medical_context_save",
                json=medical_context_payload,
                headers={"Content-Type": "application/json"}
            )

        logger.info(f"Patient demographics creation completed | sys_user_id={patient_sys_user_id}")

        return {
            "status": "success",
            "message": "Patient demographics created successfully",
            "patient_id": hms_id,
            "sys_user_id": patient_sys_user_id,
            "hospital_id": hospital_sys_user_id
        }

    except HTTPException:
        raise
    except Exception:
        logger.exception("Unexpected error during patient demographics creation")
        raise HTTPException(status_code=500, detail="Internal server error")


#######################################################################################

# @router.post("/take_appointment")
# async def take_appointment(request: Request):
#     try:
#         data = await request.json()

#         hospital_id_input = data.get("hospital_id")
#         doctor_id_input = data.get("doctor_id")
#         patient_id_input = data.get("patient_id")
#         appointment_date = data.get("date")
#         scheduled_time = data.get("scheduled_time")
#         visit_type = data.get("visit_type")
#         chief_complaint = data.get("chief_complaint")

#         # -----------------------------
#         # VALIDATE HOSPITAL (ONLY)
#         # -----------------------------
#         if not hospital_id_input:
#             raise HTTPException(status_code=400, detail="hospital_id is required")

#         hospital = hospital_user_collection.find_one(
#             {
#                 "$or": [
#                     {"hospital_id": hospital_id_input},
#                     {"sys_user_id": hospital_id_input}
#                 ]
#             },
#             {"_id": 0}
#         )

#         if not hospital:
#             raise HTTPException(
#                 status_code=404,
#                 detail=f"Hospital '{hospital_id_input}' not found"
#             )

#         # -----------------------------
#         # RESOLVE DOCTOR
#         # -----------------------------
#         doctor = doctor_user_collection.find_one(
#             {
#                 "$or": [
#                     {"sys_user_id": doctor_id_input},
#                     {"doctor_id": doctor_id_input}
#                 ]
#             },
#             {"_id": 0, "sys_user_id": 1}
#         )

#         if not doctor:
#             raise HTTPException(
#                 status_code=404,
#                 detail=f"Doctor '{doctor_id_input}' not found"
#             )

#         doctor_id = doctor["sys_user_id"]

#         # -----------------------------
#         # RESOLVE PATIENT
#         # -----------------------------
#         patient = patient_user_collection.find_one(
#             {
#                 "$or": [
#                     {"sys_user_id": patient_id_input},
#                     {"patient_id": patient_id_input}
#                 ]
#             },
#             {"_id": 0, "sys_user_id": 1, "patient_id": 1}
#         )

#         if not patient:
#             raise HTTPException(
#                 status_code=404,
#                 detail=f"Patient '{patient_id_input}' not found"
#             )

#         patient_sys_user_id = patient["sys_user_id"]
#         patient_id = patient["patient_id"]

#         # -----------------------------
#         # VALIDATION
#         # -----------------------------
#         if not all([doctor_id, patient_sys_user_id, appointment_date]):
#             raise HTTPException(
#                 status_code=400,
#                 detail="doctor_id, patient_id and date are required"
#             )

#         # -----------------------------
#         # TRY UPDATE APPOINTMENT
#         # -----------------------------
#         update_result = patient_appointments_collection.update_one(
#             {"sys_user_id": patient_sys_user_id},
#             {
#                 "$set": {
#                     "appointments.$[appt].scheduled_time": scheduled_time,
#                     "appointments.$[appt].visit_type": visit_type,
#                     "appointments.$[appt].chief_complaint": chief_complaint,
#                     "appointments.$[appt].updated_at": datetime.utcnow()
#                 }
#             },
#             array_filters=[
#                 {
#                     "appt.doctor_id": doctor_id,
#                     "appt.date": appointment_date
#                 }
#             ]
#         )

#         if update_result.modified_count > 0:
#             return {
#                 "status": "success",
#                 "message": "Appointment updated successfully",
#                 "doctor_id": doctor_id,
#                 "patient_id": patient_id,
#                 "date": appointment_date
#             }

#         # -----------------------------
#         # CREATE NEW APPOINTMENT
#         # -----------------------------
#         appointment_id = f"APT-{ObjectId()}"

#         new_appointment = {
#             "appointment_id": appointment_id,
#             "doctor_id": doctor_id,
#             "date": appointment_date,
#             "scheduled_time": scheduled_time,
#             "visit_type": visit_type,
#             "chief_complaint": chief_complaint,
#             "created_at": datetime.utcnow()
#         }

#         patient_appointments_collection.update_one(
#             {"sys_user_id": patient_sys_user_id},
#             {
#                 "$setOnInsert": {
#                     "sys_user_id": patient_sys_user_id,
#                     "created_at": datetime.utcnow()
#                 },
#                 "$push": {"appointments": new_appointment}
#             },
#             upsert=True
#         )

#         return {
#             "status": "success",
#             "message": "Appointment created successfully",
#             "appointment_id": appointment_id,
#             "doctor_id": doctor_id,
#             "patient_id": patient_id,
#             "date": appointment_date
#         }

#     except HTTPException:
#         raise
#     except Exception as e:
#         logger.exception("Appointment Creation Failed")
#         raise HTTPException(status_code=500, detail="Internal Server Error")



# @router.post("/take_appointment")
# async def take_appointment(request: Request):
#     try:
#         data = await request.json()

#         hospital_id_input = data.get("hospital_id")
#         doctor_id_input = data.get("doctor_id")
#         patient_id_input = data.get("patient_id")
#         appointment_date = data.get("date")
#         scheduled_time = data.get("scheduled_time")
#         visit_type = data.get("visit_type")
#         chief_complaint = data.get("chief_complaint")
#         appointment_id_input = data.get("appointment_id")
#         # If no ID provided or the placeholder from Postman is used, generate a new one
#         if not appointment_id_input or appointment_id_input.strip() == "{{hms_appointment_id}}":
#             appointment_id = f"APT-{str(ObjectId())}"
#         else:
#             appointment_id = appointment_id_input
#         logger.info(f"Payload received for appointment: {data}")
        
#         # -----------------------------
#         # VALIDATE HOSPITAL (ONLY)
#         # -----------------------------
#         if not hospital_id_input:
#             raise HTTPException(status_code=400, detail="hospital_id is required")

#         hospital = hospital_user_collection.find_one(
#             {
#                 "$or": [
#                     {"hospital_id": hospital_id_input},
#                     {"sys_user_id": hospital_id_input}
#                 ]
#             },
#             {"_id": 0}
#         )
#         hospital_sys_user_id = hospital["sys_user_id"] if hospital else None
#         if not hospital:
#             raise HTTPException(
#                 status_code=404,
#                 detail=f"Hospital '{hospital_id_input}' not found"
#             )

#         # -----------------------------
#         # RESOLVE DOCTOR
#         # -----------------------------
#         doctor = doctor_user_collection.find_one(
#             {
#                 "$and": [
#                     {
#                         "$or": [
#                             {"sys_user_id": doctor_id_input},
#                             {"doctor_id": doctor_id_input}
#                         ]
#                     },
#                     {"hospital_id": hospital_sys_user_id}  # ensure doctor belongs to this hospital
#                 ]
#             },
#             {"_id": 0, "sys_user_id": 1}
#         )

#         if not doctor:
#             raise HTTPException(
#                 status_code=404,
#                 detail=f"Doctor '{doctor_id_input}' not found in hospital '{hospital_id_input}'"
#             )

#         doctor_id = doctor["sys_user_id"]

#         # -----------------------------
#         # RESOLVE PATIENT
#         # -----------------------------
#         patient = patient_user_collection.find_one(
#             {
#                 "$or": [
#                     {"sys_user_id": patient_id_input},
#                     {"patient_id": patient_id_input}
#                 ]
#             },
#             {"_id": 0, "sys_user_id": 1, "patient_id": 1}
#         )

#         if not patient:
#             raise HTTPException(
#                 status_code=404,
#                 detail=f"Patient '{patient_id_input}' not found"
#             )

#         patient_sys_user_id = patient["sys_user_id"]
#         patient_id = patient["patient_id"]

#         # -----------------------------
#         # VALIDATION
#         # -----------------------------
#         if not all([doctor_id, patient_sys_user_id, appointment_date]):
#             raise HTTPException(
#                 status_code=400,
#                 detail="doctor_id, patient_id and date are required"
#             )

#         # -----------------------------
#         # CREATE APPOINTMENT IF NOT UPDATED
#         # -----------------------------
#         update_result = patient_appointments_collection.update_one(
#             {"sys_user_id": patient_sys_user_id},
#             {
#                 "$set": {
#                     "appointments.$[appt].scheduled_time": scheduled_time,
#                     "appointments.$[appt].visit_type": visit_type,
#                     "appointments.$[appt].chief_complaint": chief_complaint,
#                     "appointments.$[appt].updated_at": datetime.utcnow()
#                 }
#             },
#             array_filters=[
#                 {
#                     "appt.doctor_id": doctor_id,
#                     "appt.date": appointment_date
#                 }
#             ]
#         )

#         # -----------------------------
#         # CONTEXT AND LOGGER FOR APPOINTMENT
#         # -----------------------------
#         if update_result.modified_count > 0:
#             feature_payload = {
#                 "doctor_id": doctor_id,
#                 "patient_id": patient_sys_user_id,
#                 "contexts": [
#                     {
#                         "date": appointment_date,  # ISO format date string
#                         "current_condition": [
#                             {
#                                 "id": str(uuid.uuid4()),
#                                 "text": chief_complaint or "No chief complaint provided"
#                             }
#                         ]
#                     }
#                 ]
#             }

#             # Log and send to current context LLM
#             logger.info(
#                 "Sending appointment data to feature context LLM",
#                 extra={
#                     "endpoint": "current_context_save",
#                     "patient_id": patient_sys_user_id,
#                     "doctor_id": doctor_id,
#                     "payload": feature_payload
#                 }
#             )

#             # Feature context LLM call
#             async with httpx.AsyncClient(timeout=10.0) as client:
#                 llm_response = await client.post(
#                     f"{api_base_url}hms/users/data/context/current_context_save",
#                     json=feature_payload,
#                     headers={"Content-Type": "application/json"}
#                 )

#             if llm_response.status_code != 200:
#                 logger.error(
#                     "Feature context LLM failed for appointment data",
#                     extra={
#                         "status_code": llm_response.status_code,
#                         "response": llm_response.text,
#                         "patient_id": patient_sys_user_id,
#                         "doctor_id": doctor_id
#                     }
#                 )

#             return {
#                 "status": "success",
#                 "message": "Appointment updated successfully",
#                 "doctor_id": doctor_id,
#                 "patient_id": patient_id,
#                 "appointment_id": appointment_id,
#                 "date": appointment_date,
#                 "scheduled_time": scheduled_time,
#                 "visit_type": visit_type,
#                 "chief_complaint": chief_complaint
#             }

#         # -----------------------------
#         # CREATE NEW APPOINTMENT IF NOT FOUND
#         # -----------------------------
#         # appointment_id = f"APT-{str(ObjectId())}"

#         new_appointment = {
#             "appointment_id": appointment_id,
#             "doctor_id": doctor_id,
#             "date": appointment_date,
#             "scheduled_time": scheduled_time,
#             "visit_type": visit_type,
#             "chief_complaint": chief_complaint,
#             "created_at": datetime.utcnow(),
#             "updated_at": datetime.utcnow()
#         }

#         patient_appointments_collection.update_one(
#             {"sys_user_id": patient_sys_user_id},
#             {
#                 "$setOnInsert": {
#                     "sys_user_id": patient_sys_user_id,
#                     "created_at": datetime.utcnow()
#                 },
#                 "$push": {"appointments": new_appointment}
#             },
#             upsert=True
#         )

#         # Create context payload for current & medical context
#         feature_payload = {
#             "doctor_id": doctor_id,
#             "patient_id": patient_sys_user_id,
#             "contexts": [
#                 {
#                     "date": appointment_date,  # ISO format date string
#                     "current_condition": [
#                         {
#                             "id": str(uuid.uuid4()),
#                             "text": chief_complaint or "No chief complaint provided"
#                         }
#                     ]
#                 }
#             ]
#         }

#         # Log and send to current context LLM
#         logger.info(
#             "Sending appointment data to feature context LLM",
#             extra={
#                 "endpoint": "current_context_save",
#                 "patient_id": patient_sys_user_id,
#                 "doctor_id": doctor_id,
#                 "payload": feature_payload
#             }
#         )

#         # Feature context LLM call
#         async with httpx.AsyncClient(timeout=10.0) as client:
#             llm_response = await client.post(
#                 f"{api_base_url}hms/users/data/context/current_context_save",
#                 json=feature_payload,
#                 headers={"Content-Type": "application/json"}
#             )

#         if llm_response.status_code != 200:
#             logger.error(
#                 "Feature context LLM failed for appointment data",
#                 extra={
#                     "status_code": llm_response.status_code,
#                     "response": llm_response.text,
#                     "patient_id": patient_sys_user_id,
#                     "doctor_id": doctor_id
#                 }
#             )

#         return {
#             "status": "success",
#             "message": "Appointment created successfully",
#             "appointment_id": appointment_id,
#             "doctor_id": doctor_id,
#             "patient_id": patient_id,
#             "date": appointment_date
#         }

#     except Exception as e:
#         logger.exception("Appointment Creation Failed: %s", str(e))
#         raise HTTPException(status_code=500, detail=str(e))
@router.post("/take_appointment")
async def take_appointment(request: Request):
    try:
        data = await request.json()

        hospital_id_input = data.get("hospital_id")
        doctor_id_input = data.get("doctor_id")
        patient_id_input = data.get("patient_id")
        appointment_date = data.get("date")
        scheduled_time = data.get("scheduled_time")
        visit_type = data.get("visit_type")
        chief_complaint = data.get("chief_complaint")
        appointment_id_input = data.get("appointment_id")

        logger.info(f"Payload received for appointment: {data}")

        # -----------------------------
        # VALIDATE HOSPITAL
        # -----------------------------
        if not hospital_id_input:
            raise HTTPException(status_code=400, detail="hospital_id is required")

        hospital = hospital_user_collection.find_one(
            {"$or": [{"hospital_id": hospital_id_input}, {"sys_user_id": hospital_id_input}]},
            {"_id": 0}
        )
        hospital_sys_user_id = hospital["sys_user_id"] if hospital else None
        if not hospital:
            raise HTTPException(status_code=404, detail=f"Hospital '{hospital_id_input}' not found")

        # -----------------------------
        # RESOLVE DOCTOR
        # -----------------------------
        doctor = doctor_user_collection.find_one(
            {
                "$and": [
                    {"$or": [{"sys_user_id": doctor_id_input}, {"doctor_id": doctor_id_input}]},
                    {"hospital_id": hospital_sys_user_id}
                ]
            },
            {"_id": 0, "sys_user_id": 1}
        )

        if not doctor:
            raise HTTPException(
                status_code=404,
                detail=f"Doctor '{doctor_id_input}' not found in hospital '{hospital_id_input}'"
            )

        doctor_id = doctor["sys_user_id"]

        # -----------------------------
        # RESOLVE PATIENT
        # -----------------------------
        patient = patient_user_collection.find_one(
            {"$or": [{"sys_user_id": patient_id_input}, {"patient_id": patient_id_input}]},
            {"_id": 0, "sys_user_id": 1, "patient_id": 1}
        )

        if not patient:
            raise HTTPException(status_code=404, detail=f"Patient '{patient_id_input}' not found")

        patient_sys_user_id = patient["sys_user_id"]
        patient_id = patient["patient_id"]

        # -----------------------------
        # VALIDATION
        # -----------------------------
        if not all([doctor_id, patient_sys_user_id, appointment_date]):
            raise HTTPException(
                status_code=400,
                detail="doctor_id, patient_id and date are required"
            )

        # -----------------------------
        # HANDLE APPOINTMENT ID AND EXISTING APPOINTMENT
        # -----------------------------
        ignore_placeholder = not appointment_id_input or appointment_id_input.strip() == "{{hms_appointment_id}}"
        appointment_id = appointment_id_input if not ignore_placeholder else None

        existing_appt_doc = patient_appointments_collection.find_one(
            {
                "sys_user_id": patient_sys_user_id,
                "appointments": {"$elemMatch": {"doctor_id": doctor_id, "date": appointment_date}}
            },
            {"appointments.$": 1}
        )

        if existing_appt_doc and existing_appt_doc.get("appointments"):
            db_appointment = existing_appt_doc["appointments"][0]
            db_appointment_id = db_appointment["appointment_id"]

            if ignore_placeholder:
                # No appointment ID passed → keep existing DB ID
                appointment_id = db_appointment_id
            elif db_appointment_id != appointment_id_input:
                # Passed appointment ID differs → update DB ID
                patient_appointments_collection.update_one(
                    {"sys_user_id": patient_sys_user_id, "appointments.appointment_id": db_appointment_id},
                    {
                        "$set": {
                            "appointments.$.appointment_id": appointment_id_input,
                            "appointments.$.scheduled_time": scheduled_time,
                            "appointments.$.visit_type": visit_type,
                            "appointments.$.chief_complaint": chief_complaint,
                            "appointments.$.updated_at": datetime.utcnow()
                        }
                    }
                )
                appointment_id = appointment_id_input

            # Update only fields if ID same or after updating ID
            patient_appointments_collection.update_one(
                {"sys_user_id": patient_sys_user_id, "appointments.appointment_id": appointment_id},
                {
                    "$set": {
                        "appointments.$.scheduled_time": scheduled_time,
                        "appointments.$.visit_type": visit_type,
                        "appointments.$.chief_complaint": chief_complaint,
                        "appointments.$.updated_at": datetime.utcnow()
                    }
                }
            )

            # -----------------------------
            # CONTEXT AND LOGGER FOR EXISTING APPOINTMENT
            # -----------------------------
            feature_payload = {
                "doctor_id": doctor_id,
                "patient_id": patient_sys_user_id,
                "contexts": [
                    {
                        "date": appointment_date,
                        "current_condition": [
                            {
                                "id": str(uuid.uuid4()),
                                "text": chief_complaint or "No chief complaint provided"
                            }
                        ]
                    }
                ]
            }

            logger.info(
                "Sending appointment data to feature context LLM",
                extra={
                    "endpoint": "current_context_save",
                    "patient_id": patient_sys_user_id,
                    "doctor_id": doctor_id,
                    "payload": feature_payload
                }
            )

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
                        "patient_id": patient_sys_user_id,
                        "doctor_id": doctor_id
                    }
                )

            return {
                "status": "success",
                "message": "Appointment updated successfully",
                "doctor_id": doctor_id,
                "patient_id": patient_id,
                "appointment_id": appointment_id,
                "date": appointment_date,
                "scheduled_time": scheduled_time,
                "visit_type": visit_type,
                "chief_complaint": chief_complaint
            }

        # -----------------------------
        # CREATE NEW APPOINTMENT
        # -----------------------------
        if not appointment_id:
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

        patient_appointments_collection.update_one(
            {"sys_user_id": patient_sys_user_id},
            {
                "$setOnInsert": {
                    "sys_user_id": patient_sys_user_id,
                    "created_at": datetime.utcnow()
                },
                "$push": {"appointments": new_appointment}
            },
            upsert=True
        )

        # -----------------------------
        # CONTEXT AND LOGGER FOR NEW APPOINTMENT
        # -----------------------------
        feature_payload = {
            "doctor_id": doctor_id,
            "patient_id": patient_sys_user_id,
            "contexts": [
                {
                    "date": appointment_date,
                    "current_condition": [
                        {
                            "id": str(uuid.uuid4()),
                            "text": chief_complaint or "No chief complaint provided"
                        }
                    ]
                }
            ]
        }

        logger.info(
            "Sending appointment data to feature context LLM",
            extra={
                "endpoint": "current_context_save",
                "patient_id": patient_sys_user_id,
                "doctor_id": doctor_id,
                "payload": feature_payload
            }
        )

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
                    "patient_id": patient_sys_user_id,
                    "doctor_id": doctor_id
                }
            )

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

@router.post("/save_patient_vitals")
async def save_patient_vitals(request: Request):
    payload = await request.json()

    hospital_id_input = payload.get("hospital_id")
    doctor_id_input = payload.get("doctor_id")
    patient_id_input = payload.get("patient_id")
    appointment_id = payload.get("appointment_id")
    vitals = payload.get("vitals")

    logger.info(f"payload received: {payload}")

    # -----------------------------
    # BASIC VALIDATION
    # -----------------------------
    if not all([hospital_id_input, doctor_id_input, patient_id_input, appointment_id]):
        raise HTTPException(
            status_code=400,
            detail="hospital_id, doctor_id, patient_id, appointment_id are required"
        )

    if not vitals:
        raise HTTPException(status_code=400, detail="Vitals cannot be empty")

    # -----------------------------
    # VALIDATE HOSPITAL
    # -----------------------------
    hospital = hospital_user_collection.find_one(
        {
            "$or": [
                {"hospital_id": hospital_id_input},
                {"sys_user_id": hospital_id_input}
            ]
        },
        {"_id": 0}
    )

    if not hospital:
        raise HTTPException(
            status_code=404,
            detail=f"Hospital '{hospital_id_input}' not found"
        )

    # -----------------------------
    # RESOLVE DOCTOR
    # -----------------------------
    doctor = doctor_user_collection.find_one(
        {
            "$or": [
                {"doctor_id": doctor_id_input},
                {"sys_user_id": doctor_id_input}
            ]
        },
        {"_id": 0, "sys_user_id": 1, "doctor_id": 1}
    )

    if not doctor:
        raise HTTPException(
            status_code=404,
            detail=f"Doctor '{doctor_id_input}' not found"
        )

    doctor_sys_user_id = doctor["sys_user_id"]
    doctor_id = doctor["doctor_id"]

    # -----------------------------
    # RESOLVE PATIENT
    # -----------------------------
    patient = patient_user_collection.find_one(
        {
            "$or": [
                {"patient_id": patient_id_input},
                {"sys_user_id": patient_id_input}
            ]
        },
        {"_id": 0, "sys_user_id": 1, "patient_id": 1}
    )

    if not patient:
        raise HTTPException(
            status_code=404,
            detail=f"Patient '{patient_id_input}' not found"
        )

    patient_sys_user_id = patient["sys_user_id"]
    patient_id = patient["patient_id"]

    # -----------------------------
    # VALIDATE APPOINTMENT
    # -----------------------------
    appointment_doc = patient_appointments_collection.find_one(
        {
            "sys_user_id": patient_sys_user_id,
            "appointments": {
                "$elemMatch": {
                    "appointment_id": appointment_id,
                    "doctor_id": doctor_sys_user_id
                }
            }
        },
        {"_id": 0, "appointments.$": 1}
    )
    logger.info(f"Appointment document found for vitals update: {appointment_doc}")
    if not appointment_doc:
        raise HTTPException(
            status_code=404,
            detail="Appointment does not match patient and doctor"
        )

    # -----------------------------
    # PREPARE VITALS UPDATE
    # -----------------------------
    update_fields = {}

    for timestamp, data in vitals.items():

        safe_timestamp = timestamp.replace(".", "_")

        cleaned_data = {
            **data,
            "doctor_id": doctor_id,
            "doctor_sys_user_id": doctor_sys_user_id,
            "appointment_id": appointment_id
        }

        update_fields[f"vitals.{safe_timestamp}"] = cleaned_data

        # ==========================================================
        # TEMP DATA SAVE TRIGGER
        # ==========================================================
        temp_payload = {
            "patient_id": patient_sys_user_id,
            "doctor_id": doctor_sys_user_id,
            "vitals": [cleaned_data]
        }

        try:

            async with httpx.AsyncClient(timeout=15.0) as client:

                temp_response = await client.post(
                    f"{api_base_url}hms/users/data/context/general/temp/save",
                    json=temp_payload
                )

            if temp_response.status_code != 200:

                logger.error(
                    f"Temp save failed | status={temp_response.status_code}"
                )

        except Exception as e:

            logger.error(f"Temp save exception: {str(e)}")


        # ==========================================================
        # CELERY TRIGGER
        # ==========================================================
        try:

            from integration.celery_client import celery_app

            celery_app.send_task(

                "legacy_lab_ai.process_mongo_batch",

                kwargs={

                    "patient_id": patient_sys_user_id,

                    "doctor_id": doctor_sys_user_id
                },

                queue="agentic_queue",

                routing_key="agentic",

                exchange="agentic"
            )

        except Exception as e:

            logger.error(
                f"Mongo Celery trigger failed: {str(e)}"
            )

    update_doc = {
        "$set": {
            **update_fields,
            "appointment_id": appointment_id,
            "doctor_sys_user_id": doctor_sys_user_id,
            "sys_user_id": patient_sys_user_id,
            "patient_id": patient_id,
            "updated_at": datetime.utcnow()
        },
        "$setOnInsert": {
            "created_at": datetime.utcnow()
        }
    }

    patient_vitals_collection.update_one(
        {
            "appointment_id": appointment_id,
            "sys_user_id": patient_sys_user_id
        },
        update_doc,
        upsert=True
    )

    return {
        "status": "success",
        "hospital_id": hospital_id_input,
        "doctor_id": doctor_id_input,
        "patient_id": patient_id,
        "appointment_id": appointment_id,
        "stored_timestamps": list(update_fields.keys())
    }


@router.get("/hospital-users", response_model=List[dict])
async def get_all_patient_users():
    # Fetch all data from the collection - ASYNC
    cursor = hospital_user_collection.find()
    patient_users = await cursor.to_list(length=None)
    
    # Convert ObjectId to string for JSON serialization
    for user in patient_users:
        user["_id"] = str(user["_id"])
    return patient_users






# Function to download the file from the URL
def download_file(file_url: str, download_path: str):
    response = requests.get(file_url)
    if response.status_code == 200:
        with open(download_path, "wb") as f:
            f.write(response.content)
        return download_path
    else:
        raise Exception(f"Failed to download file from {file_url}. Status code: {response.status_code}")

# @router.post("/patient_upload_report")
# async def upload_report(request: Request):
#     try:
#         # Extract data from the incoming JSON request body
#         data = await request.json()
        
#         patient_id = data.get("patient_id")
#         hospital_id = data.get("hospital_id")
#         doctor_id = data.get("doctor_id")
#         upload_mode = data.get("upload_mode", "document")  # Default to "document"
#         reports = data.get("reports", [])
        
#         # Retrieve patient sys_user_id using patient_id
#         patient = patient_user_collection.find_one({"patient_id": patient_id})
#         if not patient:
#             return JSONResponse(status_code=404, content={"message": "Patient not found"})
        
#         sys_user_id_patient = patient["sys_user_id"]
#         logger.info(f"Resolved patient_id '{patient_id}' to sys_user_id '{sys_user_id_patient}'")

#         # Retrieve hospital sys_user_id using hospital_id
#         hospital = hospital_user_collection.find_one({"hospital_id": hospital_id})
#         if not hospital:
#             return JSONResponse(status_code=404, content={"message": "Hospital not found"})
        
#         sys_user_id_hospital = hospital["sys_user_id"]
#         logger.info(f"Resolved hospital_id '{hospital_id}' to sys_user_id '{sys_user_id_hospital}'")

#         # Retrieve doctor sys_user_id using doctor_id
#         doctor = doctor_user_collection.find_one({"doctor_id": doctor_id})
#         if not doctor:
#             return JSONResponse(status_code=404, content={"message": "Doctor not found"})
        
#         sys_user_id_doctor = doctor["sys_user_id"]

#         logger.info(f"Resolved doctor_id '{doctor_id}' to sys_user_id '{sys_user_id_doctor}'")
#         # Process each report URL and send the file one by one
#         for report in reports:
#             file_url = report.get("path")
#             file_name = os.path.basename(file_url)
#             downloaded_file_path = f"/tmp/{file_name}"  # Temporary file path

#             # Download the file from the URL
#             try:
#                 downloaded_file_path = download_file(file_url, downloaded_file_path)
#             except Exception as e:
#                 return JSONResponse(status_code=500, content={"message": f"Error downloading file: {str(e)}"})

#             # Open the downloaded file and prepare it for the upload
#             with open(downloaded_file_path, "rb") as file:
#                 # Prepare the data to send to the proxy endpoint
#                 file_data = {
#                     "doctor_id": sys_user_id_doctor,
#                     "patient_id": sys_user_id_patient,
#                     "hospital_id": sys_user_id_hospital,
#                     "report_date": report.get("date"),  # Assuming the report's date is provided
#                     "upload_mode": upload_mode,
#                     "file": file
#                 }

#                 # Construct the request to upload the file to the external endpoint
#                 response = requests.post(
#                     "https://demo.doctorassist.ai/api/hms/users/cm/storage/proxy/upload",
#                     files={"file": file_data["file"]},
#                     data={
#                         "doctor_id": sys_user_id_doctor,
#                         "patient_id": sys_user_id_patient,
#                         "hospital_id": sys_user_id_hospital,
#                         "report_date": file_data["report_date"],
#                         "upload_mode": file_data["upload_mode"]
#                     }
#                 )

#                 if response.status_code != 200:
#                     return JSONResponse(status_code=response.status_code, content={"message": response.text})
            
#         return JSONResponse(status_code=200, content={"message": "All files uploaded successfully"})

#     except Exception as e:
#         return JSONResponse(status_code=500, content={"message": str(e)})



@router.post("/patient_upload_report")
async def upload_report(request: Request):
    try:
        # Extract data from the incoming JSON request body
        data = await request.json()
        
        patient_id = data.get("patient_id")
        hospital_id = data.get("hospital_id")
        doctor_id = data.get("doctor_id")
        upload_mode = data.get("upload_mode", "document")  # Default to "document"
        reports = data.get("reports", [])
        
        # Retrieve patient sys_user_id using patient_id
        patient = patient_user_collection.find_one({"patient_id": patient_id})
        if not patient:
            return JSONResponse(status_code=404, content={"message": "Patient not found"})
        
        sys_user_id_patient = patient["sys_user_id"]
        logger.info(f"Resolved patient_id '{patient_id}' to sys_user_id '{sys_user_id_patient}'")

        # Retrieve hospital sys_user_id using hospital_id
        hospital = hospital_user_collection.find_one({"hospital_id": hospital_id})
        if not hospital:
            return JSONResponse(status_code=404, content={"message": "Hospital not found"})
        
        sys_user_id_hospital = hospital["sys_user_id"]
        logger.info(f"Resolved hospital_id '{hospital_id}' to sys_user_id '{sys_user_id_hospital}'")

        # Retrieve doctor sys_user_id using doctor_id
        doctor = doctor_user_collection.find_one({"doctor_id": doctor_id})
        if not doctor:
            return JSONResponse(status_code=404, content={"message": "Doctor not found"})
        
        sys_user_id_doctor = doctor["sys_user_id"]
        logger.info(f"Resolved doctor_id '{doctor_id}' to sys_user_id '{sys_user_id_doctor}'")

        # -----------------------------
        # Process each report sequentially
        # -----------------------------
        report_results = []

        for report in reports:
            file_url = report.get("path")
            file_name = os.path.basename(file_url)
            downloaded_file_path = f"/tmp/{file_name}"  # Temporary file path

            # Download the file
            try:
                response = requests.get(file_url)
                response.raise_for_status()
                with open(downloaded_file_path, "wb") as f:
                    f.write(response.content)
            except Exception as e:
                report_results.append({
                    "file": file_name,
                    "status": "error",
                    "message": f"Failed to download: {str(e)}"
                })
                continue  # Move to next report

            # Upload the file to the proxy endpoint
            try:
                with open(downloaded_file_path, "rb") as f:
                    response = requests.post(
                        f"{api_base_url}hms/users/cm/storage/proxy/upload",
                        files={"file": f},
                        data={
                            "doctor_id": sys_user_id_doctor,
                            "patient_id": sys_user_id_patient,
                            "hospital_id": sys_user_id_hospital,
                            "report_date": report.get("date"),
                            "upload_mode": report.get("upload_mode", upload_mode)
                        }
                    )

                if response.status_code == 200:
                    report_results.append({
                        "file": file_name,
                        "status": "uploaded"
                    })
                else:
                    report_results.append({
                        "file": file_name,
                        "status": "error",
                        "message": response.text
                    })

            except Exception as e:
                report_results.append({
                    "file": file_name,
                    "status": "error",
                    "message": f"Upload failed: {str(e)}"
                })

        return JSONResponse(status_code=200, content={
            "status": "completed",
            "reports": report_results
        })

    except Exception as e:
        return JSONResponse(status_code=500, content={"message": str(e)})




@router.get("/get_data_from_db", response_model=List[dict])
async def get_all_patient_users():
    # Fetch all data from the collection - ASYNC
    cursor = documentation_clinical_notes_collection.find()
    patient_users = await cursor.to_list(length=None)
    
    # Convert ObjectId to string for JSON serialization
    for user in patient_users:
        user["_id"] = str(user["_id"])
    return patient_users


async def get_sys_user_ids(patient_id: str, doctor_id: str) -> tuple[str, str]:
    try:
        # Fetching patient data to get the sys_user_id
        logger.info(f"Fetching sys_user_id for patient_id: {patient_id} and doctor_id: {doctor_id}")
        patient_data = patient_user_collection.find_one(
            {"patient_id": patient_id}
        )
        
        # If no patient data is found
        if not patient_data:
            raise HTTPException(status_code=404, detail="Patient not found.")
        
        # Fetching doctor data to get the sys_user_id
        doctor_data = doctor_user_collection.find_one(
            {"doctor_id": doctor_id}
        )
        
        # If no doctor data is found
        if not doctor_data:
            raise HTTPException(status_code=404, detail="Doctor not found.")
        
        # Return both sys_user_ids
        logger.info(f"Retrieved sys_user_id for patient: {patient_data['sys_user_id']} and doctor: {doctor_data['sys_user_id']}")
        return patient_data["sys_user_id"], doctor_data["sys_user_id"]
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving sys_user_ids: {str(e)}")



@router.get("/get_all_patient_data/{patient_id}/{doctor_id}")
async def get_patient_data(patient_id: str, doctor_id: str) -> Dict[str, Any]:
    try:
        # Call the get_sys_user_ids function to get the sys_user_id for both patient and doctor
        patient_sys_user_id, doctor_sys_user_id = await get_sys_user_ids(patient_id, doctor_id)

        # Function to convert ObjectId to string
        def convert_objectid_to_str(document: Dict):
            for key, value in document.items():
                if isinstance(value, ObjectId):
                    document[key] = str(value)  # Convert ObjectId to string
                elif isinstance(value, dict):
                    document[key] = convert_objectid_to_str(value)  # Recurse if value is a dictionary
                elif isinstance(value, list):
                    document[key] = [convert_objectid_to_str(item) if isinstance(item, dict) else item for item in value]  # Recurse if list contains dicts
            return document
        
        # Fetching all treatment plan data for the patient and doctor using sys_user_id
        treatment_plan_data_cursor = await documentation_treatment_plan_collection.find(
            {"patient_id": patient_sys_user_id, "doctor_id": doctor_sys_user_id}
        ).to_list(None)  # Fetch all matching records
        
        # Fetching all investigation notes data
        investigation_notes_data_cursor = await documentation_investigation_notes_collection.find(
            {"patient_id": patient_sys_user_id, "doctor_id": doctor_sys_user_id}
        ).to_list(None)  # Fetch all matching records
        
        # Fetching all medication analysis data
        medication_analysis_data_cursor = await documentation_medication_analysis_collection.find(
            {"patient_id": patient_sys_user_id, "doctor_id": doctor_sys_user_id}
        ).to_list(None)  # Fetch all matching records
        
        # Fetching all clinical notes data
        clinical_notes_data_cursor = await documentation_clinical_notes_collection.find(
            {"patient_id": patient_sys_user_id, "doctor_id": doctor_sys_user_id}
        ).to_list(None)  # Fetch all matching records
        
        # If no data found in any of the collections
        if not (treatment_plan_data_cursor or investigation_notes_data_cursor or medication_analysis_data_cursor or clinical_notes_data_cursor):
            raise HTTPException(status_code=404, detail="No data found for the given patient and doctor.")
        
        # Convert ObjectIds to string only if data is not None
        treatment_plan_data = [convert_objectid_to_str(doc) for doc in treatment_plan_data_cursor] if treatment_plan_data_cursor else []
        investigation_notes_data = [convert_objectid_to_str(doc) for doc in investigation_notes_data_cursor] if investigation_notes_data_cursor else []
        medication_analysis_data = [convert_objectid_to_str(doc) for doc in medication_analysis_data_cursor] if medication_analysis_data_cursor else []
        clinical_notes_data = [convert_objectid_to_str(doc) for doc in clinical_notes_data_cursor] if clinical_notes_data_cursor else []

        # Function to remove patient_id and doctor_id from the nested data
        def remove_patient_doctor_ids(data: Dict) -> Dict:
            if "patient_id" in data:
                del data["patient_id"]
            if "doctor_id" in data:
                del data["doctor_id"]
            return data

        # Remove patient_id and doctor_id from each collection's data
        treatment_plan_data = [remove_patient_doctor_ids(doc) for doc in treatment_plan_data] if treatment_plan_data else []
        investigation_notes_data = [remove_patient_doctor_ids(doc) for doc in investigation_notes_data] if investigation_notes_data else []
        medication_analysis_data = [remove_patient_doctor_ids(doc) for doc in medication_analysis_data] if medication_analysis_data else []
        clinical_notes_data = [remove_patient_doctor_ids(doc) for doc in clinical_notes_data] if clinical_notes_data else []

        # Function to remove unnecessary fields (including finaloutput) from the returned data
        def remove_unnecessary_fields(data: Dict) -> Dict:
            keys_to_remove = ["_id", "metadata", "status", "feature_name", "feature_id", "display_method", "finaloutput"]
            return {key: value for key, value in data.items() if key not in keys_to_remove}

        # Returning the aggregated data from all collections along with the original patient_id and doctor_id
        return {
            "patient_id": patient_id,  # Returning the original patient_id from the request
            "doctor_id": doctor_id,    # Returning the original doctor_id from the request
            "treatment_plan": [remove_unnecessary_fields(doc) for doc in treatment_plan_data] if treatment_plan_data else [],
            "investigation_notes": [remove_unnecessary_fields(doc) for doc in investigation_notes_data] if investigation_notes_data else [],
            "medication_analysis": [remove_unnecessary_fields(doc) for doc in medication_analysis_data] if medication_analysis_data else [],
            "clinical_notes": [remove_unnecessary_fields(doc) for doc in clinical_notes_data] if clinical_notes_data else [],
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving data: {str(e)}")



@router.get("/get_latest_patient_data/{patient_id}/{doctor_id}")
async def get_latest_patient_data(patient_id: str, doctor_id: str) -> Dict[str, Any]:
    try:
        # Call the get_sys_user_ids function to get the sys_user_id for both patient and doctor
        patient_sys_user_id, doctor_sys_user_id = await get_sys_user_ids(patient_id, doctor_id)

        # Function to convert ObjectId to string
        def convert_objectid_to_str(document: Dict):
            for key, value in document.items():
                if isinstance(value, ObjectId):
                    document[key] = str(value)  # Convert ObjectId to string
                elif isinstance(value, dict):
                    document[key] = convert_objectid_to_str(value)  # Recurse if value is a dictionary
                elif isinstance(value, list):
                    document[key] = [convert_objectid_to_str(item) if isinstance(item, dict) else item for item in value]  # Recurse if list contains dicts
            return document
        
        # Fetch the latest treatment plan data for the patient and doctor using sys_user_id
        treatment_plan_data = await documentation_treatment_plan_collection.find(
            {"patient_id": patient_sys_user_id, "doctor_id": doctor_sys_user_id}
        ).sort([("updated_at", -1)]).limit(1).to_list(1)  # Sort by updated_at and get the latest entry
        
        # Fetch the latest investigation notes data
        investigation_notes_data = await documentation_investigation_notes_collection.find(
            {"patient_id": patient_sys_user_id, "doctor_id": doctor_sys_user_id}
        ).sort([("updated_at", -1)]).limit(1).to_list(1)  # Sort by updated_at and get the latest entry
        
        # Fetch the latest medication analysis data
        medication_analysis_data = await documentation_medication_analysis_collection.find(
            {"patient_id": patient_sys_user_id, "doctor_id": doctor_sys_user_id}
        ).sort([("updated_at", -1)]).limit(1).to_list(1)  # Sort by updated_at and get the latest entry
        
        # Fetch the latest clinical notes data
        clinical_notes_data = await documentation_clinical_notes_collection.find(
            {"patient_id": patient_sys_user_id, "doctor_id": doctor_sys_user_id}
        ).sort([("updated_at", -1)]).limit(1).to_list(1)  # Sort by updated_at and get the latest entry
        
        # If no data found in any of the collections, skip conversion for None
        if not (treatment_plan_data or investigation_notes_data or medication_analysis_data or clinical_notes_data):
            raise HTTPException(status_code=404, detail="No data found for the given patient and doctor.")

        # Convert ObjectIds to string only if data is not None
        if treatment_plan_data:
            treatment_plan_data = convert_objectid_to_str(treatment_plan_data[0]) if treatment_plan_data else {}
        if investigation_notes_data:
            investigation_notes_data = convert_objectid_to_str(investigation_notes_data[0]) if investigation_notes_data else {}
        if medication_analysis_data:
            medication_analysis_data = convert_objectid_to_str(medication_analysis_data[0]) if medication_analysis_data else {}
        if clinical_notes_data:
            clinical_notes_data = convert_objectid_to_str(clinical_notes_data[0]) if clinical_notes_data else {}

        # Function to remove patient_id and doctor_id from the nested data
        def remove_patient_doctor_ids(data: Dict) -> Dict:
            if "patient_id" in data:
                del data["patient_id"]
            if "doctor_id" in data:
                del data["doctor_id"]
            return data

        # Remove patient_id and doctor_id from each collection's data
        if treatment_plan_data:
            treatment_plan_data = remove_patient_doctor_ids(treatment_plan_data)
        if investigation_notes_data:
            investigation_notes_data = remove_patient_doctor_ids(investigation_notes_data)
        if medication_analysis_data:
            medication_analysis_data = remove_patient_doctor_ids(medication_analysis_data)
        if clinical_notes_data:
            clinical_notes_data = remove_patient_doctor_ids(clinical_notes_data)

        # Remove unnecessary fields (metadata, _id, status, etc.) from the returned data
        def remove_unnecessary_fields(data: Dict) -> Dict:
            keys_to_remove = ["_id", "metadata", "status", "feature_name", "feature_id", "display_method"]
            return {key: value for key, value in data.items() if key not in keys_to_remove}

        # Returning the aggregated data from all collections along with the original patient_id and doctor_id
        return {
            "patient_id": patient_id,  # Returning the original patient_id from the request
            "doctor_id": doctor_id,    # Returning the original doctor_id from the request
            "treatment_plan": remove_unnecessary_fields(treatment_plan_data) if treatment_plan_data else {},
            "investigation_notes": remove_unnecessary_fields(investigation_notes_data) if investigation_notes_data else {},
            "medication_analysis": remove_unnecessary_fields(medication_analysis_data) if medication_analysis_data else {},
            "clinical_notes": remove_unnecessary_fields(clinical_notes_data) if clinical_notes_data else {},
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving data: {str(e)}")



@router.get("/get_all_dictation_data")
async def get_all_dictation_data() -> List[Dict[str, Any]]:
    try:
        # Fetch all data from the dictation collection
        dictation_data_cursor = await dictation_collection.find().to_list(None)
        
        # If no data is found
        if not dictation_data_cursor:
            raise HTTPException(status_code=404, detail="No data found in the dictation collection.")

        # Convert ObjectIds to string inside the endpoint
        for document in dictation_data_cursor:
            for key, value in document.items():
                if isinstance(value, ObjectId):
                    document[key] = str(value)  # Convert ObjectId to string
                elif isinstance(value, dict):
                    for sub_key, sub_value in value.items():
                        if isinstance(sub_value, ObjectId):
                            value[sub_key] = str(sub_value)  # Convert ObjectId to string in sub-dictionaries
                elif isinstance(value, list):
                    for i, item in enumerate(value):
                        if isinstance(item, dict):
                            for sub_key, sub_value in item.items():
                                if isinstance(sub_value, ObjectId):
                                    item[sub_key] = str(sub_value)  # Convert ObjectId to string in list of dictionaries

        # Return the aggregated data from the dictation collection
        return dictation_data_cursor

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving data: {str(e)}")

@router.get("/get_all_dictation_data/{patient_id}/{doctor_id}")
async def get_all_dictation_data(patient_id: str, doctor_id: str) -> Dict[str, Any]:
    try:
        # Ensure that the get_sys_user_ids function is called correctly with await
        patient_sys_user_id, doctor_sys_user_id = await get_sys_user_ids(patient_id, doctor_id)
        logger.info(f"Resolved patient_id '{patient_id}' to sys_user_id '{patient_sys_user_id}' and doctor_id '{doctor_id}' to sys_user_id '{doctor_sys_user_id}'")

        # Fetching all dictation data from the collection based on sys_user_id for patient and doctor
        dictation_data_cursor = await dictation_collection.find(
            {"patient_id": patient_sys_user_id, "doctor_id": doctor_sys_user_id}
        ).to_list(None)  # Get all records for the given patient and doctor
        
        # If no data found
        if not dictation_data_cursor:
            raise HTTPException(status_code=404, detail="No dictation data found for the given patient and doctor.")
        
        # Extracting and modifying the raw data from all documents
        all_raw_data = []
        for doc in dictation_data_cursor:
            raw_data = doc.get("raw_data", [])
            created_at = doc.get("created_at", "Unknown date")  # Get the created_at field (with fallback)
            
            # Process each entry in raw_data
            for data in raw_data:
                # Remove "source" and rename "content" to "dictation_data"
                dictation_entry = {
                    "dictation_data": data.get("content", ""),
                    "created_at": created_at,  # Add created_at to each entry
                }
                all_raw_data.append(dictation_entry)

        # If no raw_data is found in all documents
        if not all_raw_data:
            raise HTTPException(status_code=404, detail="No raw dictation data found for the given patient and doctor.")
        
        # Returning the patient_id, doctor_id, sys_user_ids, and all the modified raw data under the key 'data'
        return {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "data": all_raw_data  # Changed from 'all_raw_data' to 'data'
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving data: {str(e)}")

@router.get("/get_latest_dictation_data/{patient_id}/{doctor_id}")
async def get_latest_dictation_data(patient_id: str, doctor_id: str) -> Dict[str, Any]:
    try:
        # Call the get_sys_user_ids function to get the sys_user_id for both patient and doctor
        patient_sys_user_id, doctor_sys_user_id = await get_sys_user_ids(patient_id, doctor_id)
        logger.info(f"Resolved patient_id '{patient_id}' to sys_user_id '{patient_sys_user_id}' and doctor_id '{doctor_id}' to sys_user_id '{doctor_sys_user_id}'")

        # Fetching the latest dictation data from the collection based on sys_user_id for patient and doctor
        latest_dictation_data = await dictation_collection.find(
            {"patient_id": patient_sys_user_id, "doctor_id": doctor_sys_user_id}
        ).sort("created_at", -1).limit(1).to_list(1)  # Sort by created_at in descending order, and limit to 1 result
        
        # If no data found
        if not latest_dictation_data:
            raise HTTPException(status_code=404, detail="No dictation data found for the given patient and doctor.")
        
        # Extracting the raw data of the latest dictation
        latest_raw_data = latest_dictation_data[0].get("raw_data", [])
        created_at = latest_dictation_data[0].get("created_at", "Unknown date")  # Get the created_at field (with fallback)

        # If there is no raw_data in the latest document
        if not latest_raw_data:
            raise HTTPException(status_code=404, detail="No raw dictation data found for the latest document.")

        # Process and modify the raw data
        modified_data = []
        for data in latest_raw_data:
            # Remove "source" and rename "content" to "dictation_data"
            dictation_entry = {
                "dictation_data": data.get("content", ""),
                "created_at": created_at  # Add created_at to each entry
            }
            modified_data.append(dictation_entry)

        # Returning the latest raw dictation data under 'data'
        return {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "data": modified_data  # Changed from 'latest_raw_data' to 'data'
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving data: {str(e)}")


def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()

    expire = datetime.utcnow() + (expires_delta or timedelta(days=ACCESS_TOKEN_EXPIRE_DAY))
    to_encode.update({"exp": expire})

    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt
################################################Thomas Functions###########################################################
@router.post("/validate-widget-session")
async def validate_widget_session(request: Request):

    try:
        data = await request.json()

        # =====================================
        # PAYLOAD
        # =====================================

        hospital_id = data.get("hospital_id")
        doctor_id = data.get("doctor_id")
        patient_id = data.get("patient_id")

        # =====================================
        # VALIDATION
        # =====================================

        if not hospital_id:
            raise HTTPException(
                status_code=400,
                detail="hospital_id is required"
            )

        if not doctor_id:
            raise HTTPException(
                status_code=400,
                detail="doctor_id is required"
            )

        if not patient_id:
            raise HTTPException(
                status_code=400,
                detail="patient_id is required"
            )

        # =====================================
        # FIND HOSPITAL
        # =====================================

        hospital = hospital_user_collection.find_one(
            {
                "hospital_id": hospital_id
            },
            {
                "_id": 0
            }
        )

        if not hospital:
            raise HTTPException(
                status_code=404,
                detail="Hospital not found"
            )

        hospital_sys_user_id = hospital["sys_user_id"]

        # =====================================
        # FIND DOCTOR
        # =====================================

        doctor = doctor_user_collection.find_one(
            {
                "doctor_id": doctor_id,
                "hospital_id": hospital_sys_user_id
            },
            {
                "_id": 0
            }
        )

        if not doctor:
            raise HTTPException(
                status_code=404,
                detail="Doctor not found for this hospital"
            )

        doctor_sys_user_id = doctor["sys_user_id"]

        # =====================================
        # FIND PATIENT
        # =====================================

        patient = patient_user_collection.find_one(
            {
                "patient_id": patient_id,
                "hospital_id": hospital_sys_user_id
            },
            {
                "_id": 0
            }
        )

        if not patient:
            raise HTTPException(
                status_code=404,
                detail="Patient not found for this hospital"
            )

        patient_sys_user_id = patient["sys_user_id"]

        # =====================================
        # RESPONSE
        # =====================================

        return {
            "status": "success",

            "hospital": {
                "hospital_id": hospital["hospital_id"],
                "hospital_sys_user_id": hospital_sys_user_id,
                "name": hospital.get("name")
            },

            "doctor": {
                "doctor_id": doctor["doctor_id"],
                "doctor_sys_user_id": doctor_sys_user_id,
                "name": doctor.get("name")
            },

            "patient": {
                "patient_id": patient["patient_id"],
                "patient_sys_user_id": patient_sys_user_id,
                "name": patient.get("name")
            },

            "validated_at": datetime.utcnow().isoformat()
        }

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )

#################################################All in one endpoint############################################


@router.post("/unified_patient_flow")
async def unified_patient_flow(request: Request):
    """
    Unified endpoint to:
      1. Create patient demographics
      2. Create appointment
      3. Save vitals
      4. Upload multiple reports sequentially
    """
    try:
        payload = await request.json()
        logger.info(f"Unified payload received: {payload}")

        # -----------------------------
        # 1. PATIENT CREATION / EXISTING CHECK
        # -----------------------------
        patient_resp = await create_or_get_patient(payload)
        patient_sys_user_id = patient_resp["sys_user_id"]
        patient_id = patient_resp["patient_id"]
        hospital_sys_user_id = patient_resp["hospital_id"]

        # -----------------------------
        # 2. CREATE APPOINTMENT
        # -----------------------------
        appointment_data = payload.get("appointment")
        if appointment_data:
            appointment_data.update({
                "hospital_id": hospital_sys_user_id,
                "patient_id": patient_sys_user_id
            })
            appointment_resp = await create_or_update_appointment(appointment_data)
        else:
            appointment_resp = None

        # -----------------------------
        # 3. SAVE VITALS
        # -----------------------------
        vitals_data = payload.get("vitals")
        if vitals_data and appointment_resp:
            vitals_payload = {
                "hospital_id": hospital_sys_user_id,
                "doctor_id": appointment_data.get("doctor_id"),
                "patient_id": patient_sys_user_id,
                "appointment_id": appointment_resp.get("appointment_id"),
                "vitals": vitals_data
            }
            vitals_resp = await save_patient_vitals_internal(vitals_payload)
        else:
            vitals_resp = None

        # -----------------------------
        # 4. UPLOAD REPORTS SEQUENTIALLY
        # -----------------------------
        reports_data = payload.get("reports", [])
        report_responses = []
        if reports_data:
            for report in reports_data:
                report_resp = upload_single_report(
                    report,
                    patient_sys_user_id,
                    hospital_sys_user_id,
                    appointment_data.get("doctor_id")
                )
                report_responses.append(report_resp)

        return JSONResponse(status_code=200, content={
            "status": "success",
            "patient": patient_resp,
            "appointment": appointment_resp,
            "vitals": vitals_resp,
            "reports": report_responses
        })

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unified endpoint failed")
        raise HTTPException(status_code=500, detail=str(e))

# -----------------------------
# HELPER FUNCTIONS
# -----------------------------

async def create_or_get_patient(data):
    hospital_id_input = data.get("hospital_id")
    hms_id = data.get("hms_patient_id")
    demographics = data.get("demographics")
    insurance = data.get("insurance_profile")

    # Validate hospital exists
    hospital = hospital_user_collection.find_one({"hospital_id": hospital_id_input})
    if not hospital:
        raise HTTPException(status_code=404, detail="Hospital not found")
    hospital_sys_user_id = hospital["sys_user_id"]

    # Check if patient exists
    existing_patient = patient_user_collection.find_one({
        "hospital_id": hospital_sys_user_id,
        "patient_id": hms_id
    })
    if existing_patient:
        return {
            "status": "exists",
            "patient_id": existing_patient["patient_id"],
            "sys_user_id": existing_patient["sys_user_id"],
            "hospital_id": hospital_sys_user_id
        }

    # Create patient
    patient_sys_user_id = f"PAT-{ObjectId()}"
    created_at = datetime.utcnow()
    patient_obj = {
        "sys_user_id": patient_sys_user_id,
        "patient_id": hms_id,
        "hospital_id": hospital_sys_user_id,
        "name": demographics["name"],
        "date_of_birth": datetime.fromisoformat(demographics["dob"]),
        "gender": demographics["sex"],
        "phone_number": demographics["phone"],
        "email": demographics.get("email"),
        "created_at": created_at
    }
    patient_user_collection.insert_one(patient_obj)

    # Optional: handle insurance if present
    if insurance:
        primary = insurance.get("primary", {})
        insurance_obj = {
            "sys_user_id": patient_sys_user_id,
            "patient_id": hms_id,
            "hospital_id": hospital_sys_user_id,
            "primary_payer_name": primary.get("payer_name"),
            "created_at": created_at
        }
        insurance_providers_collection.insert_one(insurance_obj)

    return {
        "status": "created",
        "patient_id": hms_id,
        "sys_user_id": patient_sys_user_id,
        "hospital_id": hospital_sys_user_id
    }

async def create_or_update_appointment(data):
    patient_sys_user_id = data.get("patient_id")
    hospital_id_input = data.get("hospital_id")
    doctor_id_input = data.get("doctor_id")
    appointment_date = data.get("date")
    scheduled_time = data.get("scheduled_time")
    visit_type = data.get("visit_type")
    chief_complaint = data.get("chief_complaint")
    appointment_id = data.get("appointment_id") or f"APT-{str(ObjectId())}"

    # Resolve doctor
    doctor = doctor_user_collection.find_one({"doctor_id": doctor_id_input})
    if not doctor:
        raise HTTPException(status_code=404, detail=f"Doctor {doctor_id_input} not found")
    doctor_id = doctor["sys_user_id"]

    # Check existing appointment
    update_result = patient_appointments_collection.update_one(
        {"sys_user_id": patient_sys_user_id, "appointments.date": appointment_date, "appointments.doctor_id": doctor_id},
        {"$set": {
            "appointments.$.scheduled_time": scheduled_time,
            "appointments.$.visit_type": visit_type,
            "appointments.$.chief_complaint": chief_complaint,
            "appointments.$.updated_at": datetime.utcnow()
        }}
    )

    if update_result.modified_count > 0:
        return {"status": "updated", "appointment_id": appointment_id}

    # Create new appointment
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
    patient_appointments_collection.update_one(
        {"sys_user_id": patient_sys_user_id},
        {"$setOnInsert": {"sys_user_id": patient_sys_user_id, "created_at": datetime.utcnow()},
         "$push": {"appointments": new_appointment}},
        upsert=True
    )

    return {"status": "created", "appointment_id": appointment_id}

async def save_patient_vitals_internal(data):
    # Reuse your vitals endpoint logic here
    hospital_id_input = data.get("hospital_id")
    doctor_id_input = data.get("doctor_id")
    patient_id_input = data.get("patient_id")
    appointment_id = data.get("appointment_id")
    vitals = data.get("vitals")

    update_fields = {}
    for timestamp, v in vitals.items():
        safe_timestamp = timestamp.replace(".", "_")
        cleaned_data = {
            **v,
            "doctor_id": doctor_id_input,
            "appointment_id": appointment_id
        }
        update_fields[f"vitals.{safe_timestamp}"] = cleaned_data

    patient_vitals_collection.update_one(
        {"appointment_id": appointment_id, "sys_user_id": patient_id_input},
        {"$set": {**update_fields, "updated_at": datetime.utcnow()}},
        upsert=True
    )
    return {"status": "success", "stored_timestamps": list(update_fields.keys())}

def upload_single_report(report, patient_sys_user_id, hospital_sys_user_id, doctor_id_input):
    file_url = report.get("path")
    file_name = os.path.basename(file_url)
    downloaded_file_path = f"/tmp/{file_name}"

    # Download file
    try:
        response = requests.get(file_url)
        response.raise_for_status()
        with open(downloaded_file_path, "wb") as f:
            f.write(response.content)
    except Exception as e:
        return {"status": "error", "message": f"Failed to download {file_url}: {str(e)}"}

    # Upload to proxy
    with open(downloaded_file_path, "rb") as f:
        response = requests.post(
            f"{api_base_url}hms/users/cm/storage/proxy/upload",
            files={"file": f},
            data={
                "doctor_id": doctor_id_input,
                "patient_id": patient_sys_user_id,
                "hospital_id": hospital_sys_user_id,
                "report_date": report.get("date"),
                "upload_mode": report.get("upload_mode", "document")
            }
        )
    if response.status_code != 200:
        return {"status": "error", "message": response.text}
    return {"status": "uploaded", "file": file_name}







@router.post("/widget-login")
async def widget_login(request: Request):

    try:

      

        # =====================================
        # REQUEST BODY
        # =====================================

        data = await request.json()

        authorization = request.headers.get("Authorization")

        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(
                status_code=401,
                detail="Missing Authorization header"
            )

        bearer_token = authorization.replace("Bearer ", "", 1)
        
        
        hospital_id = data.get("hospital_id")
        doctor_id = data.get("doctor_id")
       

        if not hospital_id:
            raise HTTPException(
                status_code=400,
                detail="hospital_id is required"
            )

        if not doctor_id:
            raise HTTPException(
                status_code=400,
                detail="doctor_id is required"
            )

       
        # =====================================
        # FIND HOSPITAL
        # =====================================

        hospital = hospital_user_collection.find_one(
            {
                "hospital_id": hospital_id
            }
        )

        if not hospital:
            raise HTTPException(
                status_code=404,
                detail="Hospital not found"
            )

        hospital_sys_user_id = hospital["sys_user_id"]

        # =====================================
        # FIND DOCTOR
        # =====================================

        doctor = doctor_user_collection.find_one(
            {
                "doctor_id": doctor_id,
                "hospital_id": hospital_sys_user_id
            }
        )

        if not doctor:
            raise HTTPException(
                status_code=404,
                detail="Doctor not found for this hospital"
            )

        doctor_sys_user_id = doctor["sys_user_id"]

        # =====================================
        # FIND PATIENT
        # =====================================

        

        # =====================================
        # FIND LOGIN USER
        # =====================================

        user = user_auth_collection.find_one(
            {
                "sys_user_id": doctor_sys_user_id
            }
        )

        if not user:
            raise HTTPException(
                status_code=404,
                detail="Doctor login account not found"
            )

        # =====================================
        # CREATE ACCESS TOKEN
        # =====================================

        access_token = create_access_token(
            data={
                "sub": user["sys_user_id"],
                "role": user["role"],
                "username": user["username"]
            }
        )

        # =====================================
        # DASHBOARD URL
        # =====================================

        dashboard_url = (
            f"https://doctorassist.ai/auth-redirect"
            f"?hospitalId={hospital_id}"
            f"&doctorId={doctor_id}"
            f"&token={bearer_token}"
        )

        # =====================================
        # RESPONSE
        # =====================================

        response = JSONResponse(
            content={
                "status": "success",
                "message": "Widget login successful",

                "dashboard_url": dashboard_url,
                

                
            }
        )

        response.set_cookie(
            key="access_token",
            value=access_token,
            httponly=True,
            secure=True,
            samesite="none",
            max_age=60 * 60 * 24,
            path="/"
        )

        return response

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )





@router.post("/login-verify")
async def widget_login(request: Request):

    try:

      

        # =====================================
        # REQUEST BODY
        # =====================================

        data = await request.json()

        hospital_id = data.get("hospital_id")
        doctor_id = data.get("doctor_id")
       

        if not hospital_id:
            raise HTTPException(
                status_code=400,
                detail="hospital_id is required"
            )

        if not doctor_id:
            raise HTTPException(
                status_code=400,
                detail="doctor_id is required"
            )

       
        # =====================================
        # FIND HOSPITAL
        # =====================================

        hospital = hospital_user_collection.find_one(
            {
                "hospital_id": hospital_id
            }
        )

        if not hospital:
            raise HTTPException(
                status_code=404,
                detail="Hospital not found"
            )

        hospital_sys_user_id = hospital["sys_user_id"]

        # =====================================
        # FIND DOCTOR
        # =====================================

        doctor = doctor_user_collection.find_one(
            {
                "doctor_id": doctor_id,
                "hospital_id": hospital_sys_user_id
            }
        )

        if not doctor:
            raise HTTPException(
                status_code=404,
                detail="Doctor not found for this hospital"
            )

        doctor_sys_user_id = doctor["sys_user_id"]

        # =====================================
        # FIND PATIENT
        # =====================================

        

        # =====================================
        # FIND LOGIN USER
        # =====================================

        user = user_auth_collection.find_one(
            {
                "sys_user_id": doctor_sys_user_id
            }
        )

        if not user:
            raise HTTPException(
                status_code=404,
                detail="Doctor login account not found"
            )

        # =====================================
        # CREATE ACCESS TOKEN
        # =====================================

        access_token = create_access_token(
            data={
                "sub": user["sys_user_id"],
                "role": user["role"],
                "username": user["username"]
            }
        )

        # =====================================
        # DASHBOARD URL
        # =====================================

        dashboard_url = (
            f"https://doctorassist.ai/doctor-dashboard"
            f"?doctor_id={doctor_sys_user_id}"
        )

        # =====================================
        # RESPONSE
        # =====================================

        response = JSONResponse(
            content={
                "status": "success",
                "message": "Widget login successful",

                "dashboard_url": dashboard_url,
                "access_token": access_token

                
            }
        )

        response.set_cookie(
            key="access_token",
            value=access_token,
            httponly=True,
            secure=True,
            samesite="none",
            max_age=60 * 60 * 24,
            path="/"
        )

        return response

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )

# ============================================================
# MAIN ENDPOINT
# ============================================================

@router.post("/add_patient_lab_reports")
async def process_lab_reports(request: Request):

    payload = await request.json()

    logger.info(
        f"Lab report payload received : {payload}"
    )


    hospital_id_input = payload.get("hospital_id")
    doctor_id_input = payload.get("doctor_id")
    patient_id_input = payload.get("patient_id")
    reports = payload.get("reports")


    # -----------------------------------------
    # VALIDATION
    # -----------------------------------------

    if not all([
        hospital_id_input,
        doctor_id_input,
        patient_id_input
    ]):

        raise HTTPException(
            status_code=400,
            detail="hospital_id, doctor_id and patient_id are required"
        )


    if not reports:

        raise HTTPException(
            status_code=400,
            detail="Reports cannot be empty"
        )


    # -----------------------------------------
    # VALIDATE HOSPITAL
    # -----------------------------------------

    hospital = hospital_user_collection.find_one(
        {
            "$or":[
                {
                    "hospital_id": hospital_id_input
                },
                {
                    "sys_user_id": hospital_id_input
                }
            ]
        },
        {
            "_id":0
        }
    )


    if not hospital:

        raise HTTPException(
            status_code=404,
            detail=f"Hospital '{hospital_id_input}' not found"
        )



    # -----------------------------------------
    # RESOLVE DOCTOR
    # -----------------------------------------

    doctor = doctor_user_collection.find_one(
        {
            "$or":[
                {
                    "doctor_id": doctor_id_input
                },
                {
                    "sys_user_id": doctor_id_input
                }
            ]
        },
        {
            "_id":0,
            "doctor_id":1,
            "sys_user_id":1
        }
    )


    if not doctor:

        raise HTTPException(
            status_code=404,
            detail=f"Doctor '{doctor_id_input}' not found"
        )


    doctor_sys_user_id = doctor["sys_user_id"]
    doctor_id = doctor["doctor_id"]



    # -----------------------------------------
    # RESOLVE PATIENT
    # -----------------------------------------

    patient = patient_user_collection.find_one(
        {
            "$or":[
                {
                    "patient_id": patient_id_input
                },
                {
                    "sys_user_id": patient_id_input
                }
            ]
        },
        {
            "_id":0,
            "patient_id":1,
            "sys_user_id":1
        }
    )


    if not patient:

        raise HTTPException(
            status_code=404,
            detail=f"Patient '{patient_id_input}' not found"
        )


    patient_sys_user_id = patient["sys_user_id"]
    patient_id = patient["patient_id"]



    # -----------------------------------------
    # BUILD ALL REPORT RECORDS AT ONCE
    # -----------------------------------------

    report_records = []


    for report in reports:

        report_records.append(
            {
                "report_name": report.get("report_name"),
                "report_date": report.get("report_date"),
                "parameters": report.get("parameters", []),
                "created_at": datetime.utcnow()
            }
        )


    # -----------------------------------------
    # SAVE ALL REPORTS UNDER PATIENT_ID + DOCTOR_ID
    # NO DUPLICATE PATIENT+DOCTOR DOC, PUSH INTO ARRAY
    # -----------------------------------------

    try:

        await integration_lab_reports_collection.update_one(
            {
                "patient_id": patient_sys_user_id,
                "doctor_id": doctor_sys_user_id
            },
            {
                "$push": {
                    "reports": {"$each": report_records}
                },
                "$setOnInsert": {
                    "patient_id": patient_sys_user_id,
                    "doctor_id": doctor_sys_user_id,
                    "created_at": datetime.utcnow()
                },
                "$set": {
                    "updated_at": datetime.utcnow()
                }
            },
            upsert=True
        )

        logger.info(
            f"Saved {len(report_records)} lab reports | "
            f"Patient: {patient_sys_user_id} | Doctor: {doctor_sys_user_id}"
        )

    except Exception as e:

        logger.error(
            f"Failed to save lab reports: {str(e)}"
        )

        raise HTTPException(
            status_code=500,
            detail=f"Failed to save lab reports: {str(e)}"
        )


    processed_reports = [
        {"status": "success", "report_name": r["report_name"], "report_date": r["report_date"]}
        for r in report_records
    ]


    # -----------------------------------------
    # SAVE ALL REPORTS TO TEMP IN ONE CALL
    # -----------------------------------------

    temp_payload = {
        "patient_id": patient_sys_user_id,
        "doctor_id": doctor_sys_user_id,
        "lab_reports": [
            {
                "report_name": r.get("report_name"),
                "report_date": r.get("report_date"),
                "parameters": r.get("parameters", [])
            }
            for r in reports
        ]
    }

    try:
        async with AsyncClient() as client:
            temp_response = await client.post(
                "https://doctorassist.ai/api/hms/users/data/context/general/temp/save",
                json=temp_payload,
                timeout=30
            )

    except (ConnectError, ConnectTimeout, ReadTimeout, TimeoutException) as e:

        logger.error(
            f"Temp save unreachable for lab reports: {str(e)}"
        )

        raise HTTPException(
            status_code=503,
            detail=f"doctorassist.ai temp save service unavailable: {str(e)}"
        )

    except Exception as e:

        logger.exception(
            f"Unexpected error saving lab reports to temp: {str(e)}"
        )

        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error saving lab reports to temp storage: {str(e)}"
        )

    if temp_response.status_code != 200:

        logger.error(
            f"Temp save failed for lab reports: "
            f"{temp_response.status_code} - {temp_response.text}"
        )

        if 400 <= temp_response.status_code < 500:

            raise HTTPException(
                status_code=500,
                detail=(
                    f"Temp save rejected our request for lab reports "
                    f"(upstream {temp_response.status_code}): {temp_response.text}"
                )
            )

        raise HTTPException(
            status_code=502,
            detail=(
                f"Temp save upstream failure for lab reports "
                f"(upstream {temp_response.status_code}): {temp_response.text}"
            )
        )



    # -----------------------------------------
    # FINAL RESPONSE
    # -----------------------------------------

    return {

        "status":"success",

        "message":"All lab reports processed successfully",

        "hospital_id":hospital_id_input,

        "doctor_id":doctor_id,

        "patient_id":patient_id,

        "total_reports_processed":len(processed_reports),

        "reports":processed_reports,

        "completed_at":datetime.utcnow()

    }

async def process_single_patient_visit(
    patient_sys_user_id,
    doctor_sys_user_id,
    visit_data
):

    try:

        logger.info(
            f"Processing Patient Consultation | "
            f"Patient: {patient_sys_user_id} | "
            f"Doctor: {doctor_sys_user_id}"
        )


        # =====================================================
        # SAVE MEDICATION DATA
        # =====================================================

        medications = visit_data.get(
            "medication",
            []
        )


        if medications:


            medication_document = {

                "feature_id":
                    "documentation-medication-analysis",

                "feature_name":
                    None,

                "display_method":
                    "text",

                "patient_id":
                    patient_sys_user_id,

                "doctor_id":
                    doctor_sys_user_id,


                "finaloutput": {

                    "prescriptions":
                        medications

                },


                "metadata": {

                    "doctor_id":
                        doctor_sys_user_id,

                    "patient_id":
                        patient_sys_user_id,

                    "saved_from":
                        "doctor-dashboard"

                },


                "status":
                    "success",


                "created_at":
                    datetime.utcnow()

            }


            await documentation_medication_analysis_collection.insert_one(
                medication_document
            )


            logger.info(
                "Medication analysis data saved successfully"
            )



        # =====================================================
        # SAVE INVESTIGATION + PROCEDURES DATA
        # BOTH INSIDE investigation_orders
        # =====================================================

        investigation_orders = []


        investigations = visit_data.get(
            "investigations",
            []
        )


        procedures = visit_data.get(
            "procedures",
            []
        )



        # -----------------------------
        # INVESTIGATIONS
        # -----------------------------

        for investigation in investigations:


            if isinstance(investigation, dict):

                investigation_orders.append(
                    investigation
                )

            else:

                investigation_orders.append(

                    {
                        "investigation_name":
                            investigation,

                        "category":
                            "Lab",

                        "subcategory":
                            "",

                        "standard_indications":
                            "",

                        "sample_type":
                            "",

                        "fasting_required":
                            "Not specified",

                        "priority":
                            "Routine",

                        "loinc_code":
                            ""

                    }

                )



        # -----------------------------
        # PROCEDURES AS INVESTIGATIONS
        # -----------------------------

        for procedure in procedures:


            if isinstance(procedure, dict):

                investigation_orders.append(
                    procedure
                )

            else:

                investigation_orders.append(

                    {

                        "investigation_name":
                            procedure,

                        "category":
                            "Procedure",

                        "subcategory":
                            "",

                        "standard_indications":
                            "",

                        "sample_type":
                            "",

                        "fasting_required":
                            "Not specified",

                        "priority":
                            "Routine",

                        "loinc_code":
                            ""

                    }

                )



        if investigation_orders:


            investigation_document = {


                "feature_id":
                    "documentation-investigation-notes",


                "feature_name":
                    None,


                "display_method":
                    "text",


                "patient_id":
                    patient_sys_user_id,


                "doctor_id":
                    doctor_sys_user_id,



                "finaloutput": {


                    "investigation_orders":
                        investigation_orders

                },



                "metadata": {


                    "doctor_id":
                        doctor_sys_user_id,


                    "patient_id":
                        patient_sys_user_id,


                    "saved_from":
                        "doctor-dashboard"

                },


                "status":
                    "success",


                "created_at":
                    datetime.utcnow()

            }



            await documentation_investigation_notes_collection.insert_one(
                investigation_document
            )


            logger.info(
                "Investigation and procedure data saved successfully"
            )



        # =====================================================
        # SAVE DICTATION DATA
        # =====================================================


        dictation_document = {


            "patient_id":
                patient_sys_user_id,


            "doctor_id":
                doctor_sys_user_id,


            "processed_data":[

                {

                    "source":
                        "consultation_report",


                    "content": {


                        "visit_date":
                            visit_data.get(
                                "visit_date"
                            ),


                        "visit_summary":
                            visit_data.get(
                                "visit_summary",
                                ""
                            ),


                        "presenting_complaint":
                            visit_data.get(
                                "presenting_complaint",
                                ""
                            ),


                        "duration_of_presenting_complaint":
                            visit_data.get(
                                "duration_of_presenting_complaint",
                                ""
                            ),


                        "family_history":
                            visit_data.get(
                                "family_history",
                                ""
                            ),


                        "medication_history":
                            visit_data.get(
                                "medication_history",
                                ""
                            ),


                        "recent_abnormal_values":
                            visit_data.get(
                                "recent_abnormal_values",
                                []
                            ),


                        "primary_diagnosis":
                            visit_data.get(
                                "primary_diagnosis",
                                ""
                            ),


                        "doctor_notes":
                            visit_data.get(
                                "doctor_notes",
                                ""
                            )

                    }

                }

            ],


            "created_at":
                datetime.utcnow()

        }



        await dictation_collection.insert_one(
            dictation_document
        )


        logger.info(
            "Consultation dictation saved successfully"
        )



        # =====================================================
        # SAVE TO PATIENT VISIT HISTORY (no duplicates per date)
        # =====================================================

        history_result = await save_visit_to_patient_history(
            patient_sys_user_id=patient_sys_user_id,
            doctor_sys_user_id=doctor_sys_user_id,
            visit_data=visit_data
        )

        logger.info(
            f"History save result: {history_result}"
        )



        return {


            "status":
                "success",


            "visit_date":
                visit_data.get(
                    "visit_date"
                )

        }



    except Exception as e:


        logger.error(
            f"Visit Processing Failed : {str(e)}"
        )


        return {


            "status":
                "failed",


            "error":
                str(e)

        }


async def save_visit_to_patient_history(
    patient_sys_user_id,
    doctor_sys_user_id,
    visit_data
):
    try:

        visit_date = visit_data.get("visit_date")

        if not visit_date:
            logger.warning(
                f"Skipping history save, visit_date missing | "
                f"Patient: {patient_sys_user_id} | Doctor: {doctor_sys_user_id}"
            )
            return {"status": "skipped", "reason": "visit_date missing"}

        visit_record = {
            "visit_date": visit_date,
            "visit_summary": visit_data.get("visit_summary"),
            "presenting_complaint": visit_data.get("presenting_complaint"),
            "duration_of_presenting_complaint": visit_data.get("duration_of_presenting_complaint"),
            "family_history": visit_data.get("family_history"),
            "medication_history": visit_data.get("medication_history"),
            "recent_abnormal_values": visit_data.get("recent_abnormal_values", []),
            "primary_diagnosis": visit_data.get("primary_diagnosis"),
            "doctor_notes": visit_data.get("doctor_notes"),
            "investigations": visit_data.get("investigations", []),
            "procedures": visit_data.get("procedures", []),
            "medication": visit_data.get("medication", []),
            "saved_at": datetime.utcnow()
        }

        existing = await patient_visit_history_collection.find_one(
            {
                "patient_id": patient_sys_user_id,
                "doctor_id": doctor_sys_user_id,
                "visits.visit_date": visit_date
            },
            {"_id": 1}
        )

        if existing:
            logger.info(
                f"Duplicate visit skipped | Date: {visit_date} | "
                f"Patient: {patient_sys_user_id} | Doctor: {doctor_sys_user_id}"
            )
            return {"status": "duplicate_skipped", "visit_date": visit_date}

        await patient_visit_history_collection.update_one(
            {
                "patient_id": patient_sys_user_id,
                "doctor_id": doctor_sys_user_id
            },
            {
                "$push": {"visits": visit_record},
                "$setOnInsert": {
                    "patient_id": patient_sys_user_id,
                    "doctor_id": doctor_sys_user_id,
                    "created_at": datetime.utcnow()
                },
                "$set": {"updated_at": datetime.utcnow()}
            },
            upsert=True
        )

        logger.info(
            f"Visit saved to history | Date: {visit_date} | "
            f"Patient: {patient_sys_user_id} | Doctor: {doctor_sys_user_id}"
        )

        return {"status": "success", "visit_date": visit_date}

    except Exception as e:

        logger.error(
            f"Failed to save visit to patient history: {str(e)}"
        )

        return {
            "status": "failed",
            "error": str(e)
        }
@router.post("/add_patient_visit_history")
async def add_patient_visit_history(request: Request):


    payload = await request.json()


    logger.info(
        f"Patient visit payload received : {payload}"
    )


    hospital_id_input = payload.get("hospital_id")
    doctor_id_input = payload.get("doctor_id")
    patient_id_input = payload.get("patient_id")

    visits = payload.get("visits")



    # -----------------------------------------
    # VALIDATION
    # -----------------------------------------

    if not all([
        hospital_id_input,
        doctor_id_input,
        patient_id_input
    ]):

        raise HTTPException(
            status_code=400,
            detail="hospital_id, doctor_id and patient_id are required"
        )


    if not visits:

        raise HTTPException(
            status_code=400,
            detail="Visits cannot be empty"
        )



    # -----------------------------------------
    # VALIDATE HOSPITAL
    # -----------------------------------------

    hospital = hospital_user_collection.find_one(
        {
            "$or":[
                {
                    "hospital_id":hospital_id_input
                },
                {
                    "sys_user_id":hospital_id_input
                }
            ]
        },
        {
            "_id":0
        }
    )


    if not hospital:

        raise HTTPException(
            status_code=404,
            detail="Hospital not found"
        )



    # -----------------------------------------
    # RESOLVE DOCTOR
    # -----------------------------------------

    doctor = doctor_user_collection.find_one(
        {
            "$or":[
                {
                    "doctor_id":doctor_id_input
                },
                {
                    "sys_user_id":doctor_id_input
                }
            ]
        },
        {
            "_id":0,
            "doctor_id":1,
            "sys_user_id":1
        }
    )


    if not doctor:

        raise HTTPException(
            status_code=404,
            detail="Doctor not found"
        )


    doctor_sys_user_id = doctor["sys_user_id"]



    # -----------------------------------------
    # RESOLVE PATIENT
    # -----------------------------------------

    patient = patient_user_collection.find_one(
        {
            "$or":[
                {
                    "patient_id":patient_id_input
                },
                {
                    "sys_user_id":patient_id_input
                }
            ]
        },
        {
            "_id":0,
            "patient_id":1,
            "sys_user_id":1
        }
    )


    if not patient:

        raise HTTPException(
            status_code=404,
            detail="Patient not found"
        )


    patient_sys_user_id = patient["sys_user_id"]



    # -----------------------------------------
    # PROCESS VISITS ONE BY ONE
    # -----------------------------------------

    processed_visits=[]


    for visit in visits:


        result = await process_single_patient_visit(

            patient_sys_user_id=patient["sys_user_id"],

            doctor_sys_user_id=doctor["sys_user_id"],

            visit_data=visit

        )


        if result["status"] != "success":

            raise HTTPException(
                status_code=500,
                detail=f"Visit processing failed for {visit.get('visit_date')}: {result.get('error')}"
            )


        processed_visits.append(result)

        # -----------------------------------------
        # SAVE CURRENT VISIT TO TEMP
        # -----------------------------------------
        temp_payload = {
            "patient_id": patient_sys_user_id,
            "doctor_id": doctor_sys_user_id,
            "visit_summary": {
                "visit_date": visit.get("visit_date"),
                "visit_summary": visit.get("visit_summary"),
                "presenting_complaint": visit.get("presenting_complaint"),
                "duration_of_presenting_complaint": visit.get("duration_of_presenting_complaint"),
                "family_history": visit.get("family_history"),
                "medication_history": visit.get("medication_history"),
                "recent_abnormal_values": visit.get("recent_abnormal_values", []),
                "primary_diagnosis": visit.get("primary_diagnosis"),
                "doctor_notes": visit.get("doctor_notes"),
                "investigations": visit.get("investigations", []),
                "procedures": visit.get("procedures", []),
                "medication": visit.get("medication", [])
            }
        }

        try:
            async with AsyncClient() as client:
                temp_response = await client.post(
                    "https://doctorassist.ai/api/hms/users/data/context/general/temp/save",
                    json=temp_payload,
                    timeout=30
                )

        except (ConnectError, ConnectTimeout, ReadTimeout, TimeoutException) as e:

            logger.error(
                f"Temp save unreachable for visit {visit.get('visit_date')}: {str(e)}"
            )

            raise HTTPException(
                status_code=503,
                detail=f"doctorassist.ai temp save service unavailable for visit {visit.get('visit_date')}: {str(e)}"
            )

        except Exception as e:

            logger.exception(
                f"Unexpected error saving visit {visit.get('visit_date')} to temp: {str(e)}"
            )

            raise HTTPException(
                status_code=500,
                detail=f"Unexpected error saving visit {visit.get('visit_date')} to temp storage: {str(e)}"
            )

        if temp_response.status_code != 200:

            logger.error(
                f"Temp save failed for visit {visit.get('visit_date')}: "
                f"{temp_response.status_code} - {temp_response.text}"
            )

            if 400 <= temp_response.status_code < 500:

                raise HTTPException(
                    status_code=500,
                    detail=(
                        f"Temp save rejected our request for visit {visit.get('visit_date')} "
                        f"(upstream {temp_response.status_code}): {temp_response.text}"
                    )
                )

            raise HTTPException(
                status_code=502,
                detail=(
                    f"Temp save upstream failure for visit {visit.get('visit_date')} "
                    f"(upstream {temp_response.status_code}): {temp_response.text}"
                )
            )



    return {


        "status":"success",

        "message":
        "All patient visit history processed successfully",

        "hospital_id":
            hospital_id_input,

        "doctor_id":
            doctor_id_input,

        "patient_id":
            patient_id_input,

        "total_visits_processed":
            len(processed_visits),

        "visits":
            processed_visits

    }

