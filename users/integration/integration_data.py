import httpx
from typing import Dict, Any
from datetime import datetime, date, timedelta
import re
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, WebSocket, status, File, Form, UploadFile, Query
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse, FileResponse
# from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field, EmailStr, validator
from typing import Any, Dict, List, Optional, Union
from pymongo import MongoClient
from pymongo.errors import PyMongoError
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
from groq import Groq
from fastapi import Query
from typing import Optional
from fastapi import Response
# from jose import jwt, JWTError
from datetime import datetime, timedelta
from fastapi.encoders import jsonable_encoder
from requests.auth import HTTPBasicAuth
from dotenv import load_dotenv
import os
from datetime import datetime, timezone


load_dotenv()
api_base_url = os.getenv("VITE_BACKEND_URL")


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
ACCESS_TOKEN_EXPIRE_DAYS = os.getenv("ACCESS_TOKEN_EXPIRE_DAYS")

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

insurance_providers_collection = db["insurance_providers"] 

patient_appointments_collection = db["patient_appointments"]    

patient_vitals_collection = database["patient_vitals"]

integration_credentials_collection = database["integration_credentials"]

integrator_save_api_collection = database["integrator_save_api"]

integration_postman_data_collection = database["integration_postman_data"]

OPD_Doctor_timings_collection = database["OPD_Doctor_timings"]

transcription_formats_collection = database["transcription_formats"]
dictation_collection = database["dictation"]


documentation_investigation_notes_collection = database["documentation-investigation-notes"]
documentation_medication_analysis_collection = database["documentation-medication-analysis"]
patient_visit_history_collection = database["patientVisitHistory"]
integration_lab_reports_collection = database["integration_lab_reports"]



pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

class Doctor(BaseModel):
    name: str
    hospital_id: str 
    sys_user_id: str # long globally unique id
    doctor_id: str # short id unique for doctor assist system
    email: Optional[str]= None
    phone_number: Optional[str]= None
    username: str
    address: Optional[str] = None
    hospital_name: Optional[str] = None
    country_code: Optional[str] = None  # Make this Optional
    qualifications: Optional[str] = None
    specialization: str
    registeration_number: Optional[str] = None
    created_at: Optional[datetime] = None

class Users(BaseModel):
    sys_user_id: str # long globally unique id
    doctor_assist_id: str # short id unique for doctor assist system
    email: Optional[str]= None
    phone_number: Optional[str]= None
    username: str
    password: str
    role: str  # 'doctor', 'staff', 'patient'
    user_type: Optional[str] = None  # 'trial_account', 'paid_account'
    status: str  # 'active', 'inactive'
    created_at: Optional[datetime] = None
    renewed_at: Optional[datetime] = None

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
    phone_number: Optional[str]= None
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

    primary_valid_from: datetime
    primary_valid_to: datetime

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


# -------------------------------
# Excel insert
# -------------------------------
EXCEL_TO_DATA_MAP = {
    "hms_doctor_id": "doctor_id", 
    "name": "name",
    "hospital_id": "hospital_id",
    "phone_number": "phone_number",
    "username": "username",
    "email": "email",
    "password": "password",
    "address": "address",
    "country": "country_code",
    "speciality": "specialization",
    "qualification": "qualifications",
    "reg_number": "registeration_number",
}

async def handle_patient_demographics(data: dict):
    """
    INTERNAL handler (NO Request, NO router)
    """
    demographics = data.get("demographics", {})
    insurance = data.get("insurance_profile")
    hms_id = data.get("hms_patient_id")
    hospital_id = data.get("hospital_id")

    # reuse same logic you already wrote
    # but REMOVE Request() and return dict

    # return useful identifiers
    return {
        "patient_sys_user_id": patient_sys_user_id,
        "hospital_sys_user_id": hospital_sys_user_id
    }


async def handle_appointment(data: dict, patient_sys_user_id: str):
    """
    INTERNAL appointment creator
    """
    return {
        "appointment_id": appointment_id,
        "doctor_sys_user_id": doctor_id
    }


async def handle_vitals(data: dict, appointment_id: str):
    """
    INTERNAL vitals handler
    """
    return {"stored": True}


def map_excel_row_to_data(excel_row: dict) -> dict:
    data = {}
    for excel_key, value in excel_row.items():
        if excel_key in EXCEL_TO_DATA_MAP:
            # Only add to data if value exists (not empty string)
            if str(value).strip():
                data[EXCEL_TO_DATA_MAP[excel_key]] = value
    return data
def normalize_doctor_types(data: dict) -> dict:
    """
    Normalize Excel numeric values to strings
    to satisfy Pydantic models.
    """
    if "doctor_id" in data:
        data["doctor_id"] = str(data["doctor_id"]).strip()

    # Handle all optional fields
    optional_fields = [
        "phone_number", "email", "address", "country_code", 
        "qualifications", "registeration_number"
    ]
    
    for field in optional_fields:
        if field in data and data[field] is not None:
            data[field] = str(data[field]).strip()
        elif field in ["country_code", "qualifications", "registeration_number"]:
            # These might come from Excel as "country", "qualification", "reg_number"
            excel_field = None
            if field == "country_code":
                excel_field = "country"
            elif field == "qualifications":
                excel_field = "qualification"
            elif field == "registeration_number":
                excel_field = "reg_number"
            
            if excel_field and excel_field in data and data[excel_field] is not None:
                data[field] = str(data[excel_field]).strip()
            else:
                data[field] = ""

    return data


def create_doctor_from_excel_data(data: dict, hospital_sys_user_id: str):
    # 🔑 Normalize Excel types
    data = normalize_doctor_types(data)

    # 3️⃣ Duplicate check (doctor_id + hospital SYS ID)
    existing_doctor = doctor_user_collection.find_one({
        "doctor_id": data["doctor_id"],
        "hospital_id": hospital_sys_user_id
    })

    if existing_doctor:
        raise ValueError(
            f"Doctor {data['doctor_id']} already exists for hospital {hospital_sys_user_id}"
        )

    # 4️⃣ Generate doctor SYS USER ID
    sys_user_id = generate_doctor_id()
    created_at = datetime.now()
    hashed_pw = hash_password(data["password"])

    doctor_obj = Doctor(
        name=data["name"],
        hospital_id=hospital_sys_user_id,
        sys_user_id=sys_user_id,
        doctor_id=data["doctor_id"],
        email=data.get("email", ""),
        phone_number=data.get("phone_number", ""),
        username=data["username"],
        address=data.get("address", ""),
        country_code=data.get("country_code", ""),  # Add default
        qualifications=data.get("qualifications", ""),
        specialization=data["specialization"],
        registeration_number=data.get("registeration_number", ""),
        created_at=created_at
    )

    user_obj = Users(
        sys_user_id=sys_user_id,
        doctor_assist_id=data["doctor_id"],
        email=data.get("email", ""),
        phone_number=data.get("phone_number", ""),
        username=data["username"],
        password=hashed_pw,
        role="doctor",
        user_type="first_account",
        status="active",
        created_at=created_at,
        renewed_at=created_at
    )

    doctor_user_collection.insert_one(doctor_obj.model_dump())
    user_auth_collection.insert_one(user_obj.model_dump())

# def generate_random_string(length=10):
#     return ''.join(random.choices(string.ascii_letters + string.digits, k=length))


def hash_password(password: str):
    return pwd_context.hash(password)


def generate_doctor_id():
    return f"DOC-{uuid.uuid4()}"


def convert_mongo_document(doc):
    if not doc:
        return doc
    doc["_id"] = str(doc["_id"])
    return doc

def generate_patient_id():
    return f"PAT-{uuid.uuid4()}"

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")



@router.post("/upload_doctors_excel")
async def upload_doctors_excel(
    hospital_id: str = Query(...),
    file: UploadFile = File(...),
    dry_run: bool = Form(False)
):
    upload_id = str(uuid.uuid4())[:8]
    logger.info(f"[{upload_id}] Starting doctor upload process")
    logger.info(f"[{upload_id}] File received: {file.filename}")

    hospital = hospital_user_collection.find_one(
        {"sys_user_id": hospital_id}
    )

    if not hospital:
        raise HTTPException(
            status_code=404,
            detail=f"Hospital {hospital_id} not found"
        )

    try:
        if not file.filename.lower().endswith((".xlsx", ".xls")):
            raise HTTPException(status_code=400, detail="Invalid Excel file")

        contents = await file.read()
        excel_data = pd.read_excel(BytesIO(contents), sheet_name=None)

        if "Doctors" not in excel_data:
            raise HTTPException(
                status_code=400,
                detail="Excel must contain 'Doctors' sheet"
            )

        # ===================== FIX START =====================
        doctors_df = excel_data["Doctors"]

        # Remove completely empty rows
        doctors_df = doctors_df.dropna(how="all")

        # Replace NaN with empty string
        doctors_df = doctors_df.fillna("")

        required_fields = [
            "hms_doctor_id",
            "name",
            "speciality",
            "username",
            "password"
        ]


        # 🔥 Ignore rows where ONLY name is present
        def has_meaningful_data(row):
            for field in required_fields:
                if field != "name" and str(row.get(field, "")).strip():
                    return True
            return False

        doctors_df = doctors_df[doctors_df.apply(has_meaningful_data, axis=1)]
        # ====================== FIX END ======================

        doctors_list = doctors_df.to_dict(orient="records")

        preview_data = []
        has_errors = False

        for idx, doctor in enumerate(doctors_list, start=1):
            # Check for missing required fields
            missing_required = [
                field for field in required_fields
                if not str(doctor.get(field, "")).strip()
            ]

            if missing_required:
                has_errors = True
                preview_data.append({
                    "sl_no": idx,
                    "doctor_name": doctor.get("name", ""),
                    "status": "not_added",
                    "message": f"Missing required fields: {', '.join(missing_required)}"
                })
            else:
                # Check optional fields (email, phone_number, country, etc.)
                optional_issues = []
                
                # Validate email format if provided
                email = doctor.get("email", "").strip()
                if email and not re.match(r'^[\w\.-]+@[\w\.-]+\.\w+$', email):
                    optional_issues.append("Invalid email format")
                
                # Validate phone number if provided
                phone=str(doctor.get("phone_number", "")).strip()
                # phone = doctor.get("phone_number", "").strip()
                if phone and not re.match(r'^\+?[\d\s\-\(\)]{7,}$', phone):
                    optional_issues.append("Invalid phone number format")
                
                # Validate country if provided (optional validation)
                country = doctor.get("country", "").strip()
                if country and len(country) > 50:  # Example: country name too long
                    optional_issues.append("Country name too long")
                
                if optional_issues:
                    preview_data.append({
                        "sl_no": idx,
                        "doctor_name": doctor.get("name", ""),
                        "status": "validated_with_warnings",
                        "message": f"Valid with warnings: {', '.join(optional_issues)}"
                    })
                else:
                    preview_data.append({
                        "sl_no": idx,
                        "doctor_name": doctor.get("name", ""),
                        "status": "validated",
                        "message": "All required fields present"
                    })

        if has_errors:
            return {
                "summary": {
                    "total_records": len(doctors_list),
                    "inserted": 0,
                    "failed": len([d for d in preview_data if d["status"] == "not_added"]),
                    "dry_run": dry_run
                },
                "all_data": preview_data
            }

        inserted = 0
        failed = []

        for idx, doctor in enumerate(doctors_list, start=1):
            try:
                data = map_excel_row_to_data(doctor)
                data["password"] = doctor["password"]

                logger.info(f"[{upload_id}] Row {idx} mapped data: {data}")

                if not dry_run:
                    create_doctor_from_excel_data(
                        data=data,
                        hospital_sys_user_id=hospital_id
                    )

                inserted += 1

            except Exception as e:
                logger.error(f"[{upload_id}] Row {idx} failed: {str(e)}")
                failed.append({
                    "sl_no": idx,
                    "doctor_name": doctor.get("name", ""),
                    "status": "not_added",
                    "message": str(e)
                })

        return {
            "summary": {
                "total_records": len(preview_data),
                "inserted": inserted,
                "failed": len(failed),
                "dry_run": dry_run
            },
            "all_data": failed if failed else [
                {
                    "sl_no": d["sl_no"],
                    "doctor_name": d["doctor_name"],
                    "status": "added",
                    "message": "Validated and saved successfully"
                }
                for d in preview_data
            ]
        }

    except Exception as e:
        logger.exception("Upload failed")
        raise HTTPException(status_code=500, detail=str(e))







@router.post("/upload-doctors")
async def upload_doctors(file: UploadFile = File(...)):
    # 1️⃣ Validate file type
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Invalid file type")

    try:
        # 2️⃣ Read Excel
        df = pd.read_excel(file.file)

        if df.empty:
            raise HTTPException(status_code=400, detail="Excel file is empty")

        # 3️⃣ Clean data
        df = df.fillna("")

        # 4️⃣ Convert to JSON
        records = df.to_dict(orient="records")

        return {
            "status": "success",
            "total_records": len(records),
            "data": records
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))




@router.get("/doctor/{doctor_id}")
async def get_doctor_by_id(doctor_id: str):
    try:
        doctor = await database["hms_doctors"].find_one(
            {"id": doctor_id},
            {"_id": 0}  # hide MongoDB internal ID
        )

        if not doctor:
            raise HTTPException(
                status_code=404,
                detail="Doctor not found"
            )

        return {
            "status": "success",
            "data": doctor
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to fetch doctor")
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )




@router.get("/hospital-users")
def get_all_hospital_users():
    users = list(hospital_user_collection.find())

    # Convert ObjectId to string
    for user in users:
        user["_id"] = str(user["_id"])

    return {
        "count": len(users),
        "data": users
    }

@router.delete("/delete-doctors-by-hospital/{doctor_assist_id}")
def delete_doctors_by_hospital(doctor_assist_id: str):
    try:
        result = user_auth_collection.delete_many(
            {"doctor_assist_id": doctor_assist_id}
        )

        return {
            "status": "success",
            "doctor_assist_id": doctor_assist_id,
            "deleted_count": result.deleted_count
        }

    except Exception as e:
        logger.exception("Failed to delete doctors")
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )

@router.get("/user-auth_all")
def debug_get_all_user_auth():
    users = list(user_auth_collection.find({}))

    # Convert ObjectId → string
    for user in users:
        user["_id"] = str(user["_id"])

    return {
        "count": len(users),
        "data": users
    }

from fastapi import Path, Query, HTTPException

@router.delete("/patient-demographics/{hms_patient_id}")
async def delete_patient_demographics(
    hms_patient_id: str = Path(..., description="HMS patient ID"),
    hospital_id: str = Query(..., description="External hospital ID")
):
    logger.info(
        f"Patient demographics deletion initiated | "
        f"hms_patient_id={hms_patient_id} | hospital_id={hospital_id}"
    )

    try:
        # -----------------------------
        # HOSPITAL VALIDATION
        # -----------------------------
        hospital = hospital_user_collection.find_one(
            {"hospital_id": hospital_id},
            {"_id": 0, "sys_user_id": 1}
        )

        if not hospital:
            logger.warning(f"Hospital not found | hospital_id={hospital_id}")
            raise HTTPException(status_code=404, detail="Hospital not found")

        hospital_sys_user_id = hospital["sys_user_id"]

        # -----------------------------
        # PATIENT EXISTENCE CHECK
        # -----------------------------
        patient = patient_user_collection.find_one(
            {
                "hospital_id": hospital_sys_user_id,
                "patient_id": hms_patient_id
            },
            {"_id": 0, "sys_user_id": 1}
        )

        if not patient:
            logger.info(
                f"Patient not found | "
                f"hms_patient_id={hms_patient_id} | hospital_id={hospital_sys_user_id}"
            )
            raise HTTPException(status_code=404, detail="Patient not found")

        patient_sys_user_id = patient["sys_user_id"]

        # -----------------------------
        # DELETE PATIENT DEMOGRAPHICS
        # -----------------------------
        result = patient_user_collection.delete_one(
            {
                "hospital_id": hospital_sys_user_id,
                "patient_id": hms_patient_id
            }
        )

        logger.info(
            f"Patient demographics deleted | "
            f"sys_user_id={patient_sys_user_id}"
        )

        return {
            "status": "success",
            "message": "Patient demographics deleted successfully",
            "hms_patient_id": hms_patient_id,
            "sys_user_id": patient_sys_user_id,
            "hospital_id": hospital_sys_user_id,
            "deleted_count": result.deleted_count
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to delete patient demographics")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete patient demographics due to: {str(e)}"
        )



@router.delete("/patient-insurance/{hms_patient_id}")
async def delete_patient_insurance(
    hms_patient_id: str = Path(..., description="HMS patient ID"),
    hospital_id: str = Query(..., description="External hospital ID")
):
    logger.info(
        f"Patient insurance deletion initiated | "
        f"hms_patient_id={hms_patient_id} | hospital_id={hospital_id}"
    )

    try:
        # -----------------------------
        # HOSPITAL VALIDATION
        # -----------------------------
        hospital = hospital_user_collection.find_one(
            {"hospital_id": hospital_id},
            {"_id": 0, "sys_user_id": 1}
        )

        if not hospital:
            logger.warning(f"Hospital not found | hospital_id={hospital_id}")
            raise HTTPException(status_code=404, detail="Hospital not found")

        hospital_sys_user_id = hospital["sys_user_id"]

        # -----------------------------
        # INSURANCE EXISTENCE CHECK
        # -----------------------------
        insurance = insurance_providers_collection.find_one(
            {
                "hospital_id": hospital_sys_user_id,
                "patient_id": hms_patient_id
            },
            {"_id": 0}
        )

        if not insurance:
            logger.info(
                f"Insurance not found | "
                f"hms_patient_id={hms_patient_id} | hospital_id={hospital_sys_user_id}"
            )
            raise HTTPException(status_code=404, detail="Insurance record not found")

        # -----------------------------
        # DELETE INSURANCE RECORDS
        # -----------------------------
        result = insurance_providers_collection.delete_many(
            {
                "hospital_id": hospital_sys_user_id,
                "patient_id": hms_patient_id
            }
        )

        logger.info(
            f"Patient insurance deleted | "
            f"hms_patient_id={hms_patient_id} | deleted_count={result.deleted_count}"
        )

        return {
            "status": "success",
            "message": "Patient insurance deleted successfully",
            "hms_patient_id": hms_patient_id,
            "hospital_id": hospital_sys_user_id,
            "deleted_count": result.deleted_count
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to delete patient insurance")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete patient insurance due to: {str(e)}"
        )


@router.get("/patient-insurance/{hospital_id}/{hms_patient_id}")
async def get_patient_insurance(
    hospital_id: str,
    hms_patient_id: str
):
    logger.info(
        f"Insurance lookup initiated | "
        f"hms_patient_id={hms_patient_id} | hospital_id={hospital_id}"
    )

    hospital = hospital_user_collection.find_one(
        {"hospital_id": hospital_id},
        {"_id": 0, "sys_user_id": 1}
    )

    if not hospital:
        raise HTTPException(status_code=404, detail="Hospital not found")

    hospital_sys_user_id = hospital["sys_user_id"]

    insurance_records = list(
        insurance_providers_collection.find(
            {
                "hospital_id": hospital_sys_user_id,
                "patient_id": hms_patient_id
            },
            {"_id": 0}
        )
    )

    if not insurance_records:
        raise HTTPException(status_code=404, detail="Insurance record not found")

    return {
        "status": "success",
        "hospital_id": hospital_sys_user_id,
        "hms_patient_id": hms_patient_id,
        "insurance_records": insurance_records
    }


@router.get("/appointments/by-patient")
async def get_appointments_by_patient(patient_id: str):
    """
    Get all appointments for a patient
    patient_id can be sys_user_id or external patient_id
    """

    # Resolve patient
    patient = patient_user_collection.find_one(
        {
            "$or": [
                {"sys_user_id": patient_id},
                {"patient_id": patient_id}
            ]
        },
        {"_id": 0, "sys_user_id": 1, "patient_id": 1}
    )

    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    patient_sys_user_id = patient["sys_user_id"]

    doc = patient_appointments_collection.find_one(
        {"sys_user_id": patient_sys_user_id},
        {"_id": 0, "appointments": 1}
    )

    return {
        "status": "success",
        "patient_id": patient["patient_id"],
        "appointments": doc.get("appointments", []) if doc else []
    }

@router.get("/vitals/by-appointment")
async def get_vitals_by_appointment(appointment_id: str):
    if not appointment_id:
        raise HTTPException(
            status_code=400,
            detail="appointment_id is required"
        )

    vitals_doc = await patient_vitals_collection.find_one(
        {"appointment_id": appointment_id},
        {"_id": 0}
    )

    if not vitals_doc:
        raise HTTPException(
            status_code=404,
            detail=f"No vitals found for appointment_id {appointment_id}"
        )

    return {
        "status": "success",
        "appointment_id": vitals_doc.get("appointment_id"),
        "patient_id": vitals_doc.get("patient_id"),
        "doctor_sys_user_id": vitals_doc.get("doctor_sys_user_id"),
        "vitals": vitals_doc.get("vitals", {})
    }

@router.get("/vitals/by-patient")
async def get_vitals_by_patient(patient_id: str):
    if not patient_id:
        raise HTTPException(
            status_code=400,
            detail="patient_id is required"
        )

    # -----------------------------
    # RESOLVE PATIENT (SYNC)
    # -----------------------------
    patient = patient_user_collection.find_one(
        {
            "$or": [
                {"patient_id": patient_id},
                {"sys_user_id": patient_id}
            ]
        },
        {"_id": 0, "sys_user_id": 1, "patient_id": 1}
    )

    if not patient:
        raise HTTPException(
            status_code=404,
            detail=f"Patient '{patient_id}' not found"
        )

    patient_sys_user_id = patient["sys_user_id"]

    # -----------------------------
    # FETCH VITALS (ASYNC)
    # -----------------------------
    cursor = patient_vitals_collection.find(
        {"sys_user_id": patient_sys_user_id},
        {"_id": 0}
    )

    vitals_records = []
    async for doc in cursor:
        vitals_records.append({
            "appointment_id": doc.get("appointment_id"),
            "doctor_sys_user_id": doc.get("doctor_sys_user_id"),
            "vitals": doc.get("vitals", {})
        })

    if not vitals_records:
        raise HTTPException(
            status_code=404,
            detail=f"No vitals found for patient_id {patient['patient_id']}"
        )

    return {
        "status": "success",
        "patient_id": patient["patient_id"],
        "records": vitals_records
    }

########################################################################## ENDPOINTS #######################################################################################################

#Patient Demographic


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






##########################################Update Patient Demographic#################################################################################################################################################

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

                primary_valid_from=datetime.fromisoformat(primary["valid_from"]),
                primary_valid_to=datetime.fromisoformat(primary["valid_to"]),

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


#############################################APPOINTMENT#################################################################################################################################################

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


##############################################Update Appointment#################################################################################################################################################


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
        logger.info(f"Payload received for appointment: {data}")
        
        # -----------------------------
        # VALIDATE HOSPITAL (ONLY)
        # -----------------------------
        if not hospital_id_input:
            raise HTTPException(status_code=400, detail="hospital_id is required")

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
                    {"sys_user_id": doctor_id_input},
                    {"doctor_id": doctor_id_input}
                ]
            },
            {"_id": 0, "sys_user_id": 1}
        )

        if not doctor:
            raise HTTPException(
                status_code=404,
                detail=f"Doctor '{doctor_id_input}' not found"
            )

        doctor_id = doctor["sys_user_id"]

        # -----------------------------
        # RESOLVE PATIENT
        # -----------------------------
        patient = patient_user_collection.find_one(
            {
                "$or": [
                    {"sys_user_id": patient_id_input},
                    {"patient_id": patient_id_input}
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
        # VALIDATION
        # -----------------------------
        if not all([doctor_id, patient_sys_user_id, appointment_date]):
            raise HTTPException(
                status_code=400,
                detail="doctor_id, patient_id and date are required"
            )

        # -----------------------------
        # CREATE APPOINTMENT IF NOT UPDATED
        # -----------------------------
        update_result = patient_appointments_collection.update_one(
            {"sys_user_id": patient_sys_user_id},
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
        # CONTEXT AND LOGGER FOR APPOINTMENT
        # -----------------------------
        if update_result.modified_count > 0:
            feature_payload = {
                "doctor_id": doctor_id,
                "patient_id": patient_sys_user_id,
                "contexts": [
                    {
                        "date": appointment_date,  # ISO format date string
                        "current_condition": [
                            {
                                "id": str(uuid.uuid4()),
                                "text": chief_complaint or "No chief complaint provided"
                            }
                        ]
                    }
                ]
            }

            # Log and send to current context LLM
            logger.info(
                "Sending appointment data to feature context LLM",
                extra={
                    "endpoint": "current_context_save",
                    "patient_id": patient_sys_user_id,
                    "doctor_id": doctor_id,
                    "payload": feature_payload
                }
            )

            # Feature context LLM call
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
                "date": appointment_date,
                "scheduled_time": scheduled_time,
                "visit_type": visit_type,
                "chief_complaint": chief_complaint
            }

        # -----------------------------
        # CREATE NEW APPOINTMENT IF NOT FOUND
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

        # Create context payload for current & medical context
        feature_payload = {
            "doctor_id": doctor_id,
            "patient_id": patient_sys_user_id,
            "contexts": [
                {
                    "date": appointment_date,  # ISO format date string
                    "current_condition": [
                        {
                            "id": str(uuid.uuid4()),
                            "text": chief_complaint or "No chief complaint provided"
                        }
                    ]
                }
            ]
        }

        # Log and send to current context LLM
        logger.info(
            "Sending appointment data to feature context LLM",
            extra={
                "endpoint": "current_context_save",
                "patient_id": patient_sys_user_id,
                "doctor_id": doctor_id,
                "payload": feature_payload
            }
        )

        # Feature context LLM call
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
            "date": appointment_date
        }

    except Exception as e:
        logger.exception("Appointment Creation Failed: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))



###############################################VITALS#######################################################################################################################################################
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
                {"doctor_sys_user_id": doctor_id_input}
            ]
        },
        {"_id": 0, "doctor_sys_user_id": 1, "doctor_id": 1}
    )

    if not doctor:
        raise HTTPException(
            status_code=404,
            detail=f"Doctor '{doctor_id_input}' not found"
        )

    doctor_sys_user_id = doctor["doctor_sys_user_id"]
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
                    "doctor_sys_user_id": doctor_sys_user_id
                }
            }
        },
        {"_id": 0, "appointments.$": 1}
    )

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




@router.post("/hms-payload-ingest")
async def receive_and_split_hms_payload(payload: dict):
    """
    Receives HMS payload ONCE and splits it to:
    - patient-demographics
    - take_appointment
    - save_patient_vitals
    """

    import httpx
    from datetime import datetime
    logger.info("HMS Payload Ingest initiated")
    
    logger.info(f"Full payload: {payload}")
    API_BASE_URL = api_base_url + "hms/users/data"

    demographics = payload.get("demographics", {})

    async with httpx.AsyncClient(timeout=10) as client:

        # 1️⃣ Patient Demographics
        resp = await client.post(
            f"{API_BASE_URL}/system/patient-demographics",
            json=payload
        )
        resp.raise_for_status()
        demo_result = resp.json()

        patient_sys_user_id = demo_result["sys_user_id"]
        hospital_sys_user_id = demo_result["hospital_id"]

        # 2️⃣ Appointment
        appointment_payload = {
            "hospital_id": hospital_sys_user_id,
            "doctor_id": demographics.get("doctors_reg_id"),
            "patient_id": patient_sys_user_id,
            "date": demographics.get("date_of_appointment"),
            "scheduled_time": demographics.get("time_of_appointment"),
            "visit_type": "New Case",
            "chief_complaint": demographics.get("chief_complaint")
        }

        resp = await client.post(
            f"{API_BASE_URL}/system/take_appointment",
            json=appointment_payload
        )
        resp.raise_for_status()
        appointment_result = resp.json()
        appointment_id = appointment_result["appointment_id"]

        # 3️⃣ Vitals (OPTIONAL)
        if any([
            demographics.get("temperature"),
            demographics.get("blood_pressure"),
            demographics.get("pulse_rate"),
            demographics.get("oxygen_saturation")
        ]):
            vitals_payload = {
                "hospital_id": hospital_sys_user_id,
                "doctor_id": demographics.get("doctors_reg_id"),
                "patient_id": patient_sys_user_id,
                "appointment_id": appointment_id,
                "vitals": {
                    datetime.utcnow().isoformat(): {
                        "temperature": demographics.get("temperature"),
                        "blood_pressure": demographics.get("blood_pressure"),
                        "pulse_rate": demographics.get("pulse_rate"),
                        "oxygen_saturation": demographics.get("oxygen_saturation")
                    }
                }
            }

            await client.post(
                f"{API_BASE_URL}/system/save_patient_vitals",
                json=vitals_payload
            )

    return {
        
        "status": "success",
        "message": "Patient demographics, appointment and vitals processed successfully"
        
    }

@router.put("/update_hospital_id")
async def update_hospital_id(request: Request):
    # Get the JSON data from the request
    data = await request.json()

    sys_user_id = data.get("sys_user_id")
    new_hospital_id = data.get("new_hospital_id")

    if not sys_user_id or not new_hospital_id:
        raise HTTPException(status_code=400, detail="Missing sys_user_id or new_hospital_id")

    # Search for the hospital by sys_user_id
    hospital = hospital_user_collection.find_one({"sys_user_id": sys_user_id})

    if not hospital:
        raise HTTPException(status_code=404, detail="Hospital not found")

    # Update the hospital_id with the new one
    updated_hospital = hospital_user_collection.update_one(
        {"sys_user_id": sys_user_id},
        {"$set": {"hospital_id": new_hospital_id}}
    )

    if updated_hospital.modified_count == 0:
        raise HTTPException(status_code=400, detail="Hospital ID update failed")

    return {"message": "Hospital ID updated successfully"}



@router.get("/get_hospital_user/{sys_id}")
def get_hospital_user(sys_id: str):
    # Synchronous find_one
    user_doc = hospital_user_collection.find_one({"sys_user_id": sys_id})
    
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Generic inline serialization function
    def serialize(value):
        if isinstance(value, dict):
            return {k: serialize(v) for k, v in value.items()}
        elif isinstance(value, list):
            return [serialize(v) for v in value]
        elif isinstance(value, datetime):
            return value.isoformat()
        elif hasattr(value, "__class__") and value.__class__.__name__ == "ObjectId":
            return str(value)
        else:
            return value

    return JSONResponse(content=serialize(user_doc))

@router.post("/verify_integration_credentials")
async def verify_integration_credentials(request: Request):
    try:
        data = await request.json()
        logger.info(f"Incoming request data: {data}")

        hospital_sys_user_id = data.get("hospital_id")
        email = data.get("email")
        hospital_username = data.get("hospital_username")

        if not hospital_sys_user_id or not email or not hospital_username:
            logger.warning(f"Missing required fields: {data}")
            raise HTTPException(status_code=400, detail="Missing required fields")

        # ✅ Await the async find_one call
        cred_doc = await integration_credentials_collection.find_one(
            {"hospital_sys_user_id": hospital_sys_user_id}
        )
        logger.info(f"Database query completed for hospital_sys_user_id: {hospital_sys_user_id}, result: {cred_doc}")

        if not cred_doc:
            logger.warning(f"No credentials found for hospital_sys_user_id: {hospital_sys_user_id}")
            raise HTTPException(status_code=404, detail="Credentials not found")

        if cred_doc.get("email") != email or cred_doc.get("hospital_username") != hospital_username:
            logger.warning(f"Email or hospital_username mismatch. "
                           f"Expected email={cred_doc.get('email')}, username={cred_doc.get('hospital_username')}, "
                           f"Got email={email}, username={hospital_username}")
            raise HTTPException(status_code=403, detail="Email or hospital username does not match")

        response_data = {
            "hospital_id": cred_doc.get("hospital_id"),
            "client_id": cred_doc.get("client_id"),
            "client_secret": cred_doc.get("client_secret")
        }

        logger.info(f"Returning credentials for hospital_sys_user_id: {hospital_sys_user_id}")
        return JSONResponse(content=response_data)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Unexpected error while verifying credentials: {e}")
        raise HTTPException(status_code=500, detail="Internal Server Error")

@router.post("/integrator_save_api")
async def save_or_update_api(request: Request):
    try:
        data = await request.json()
        sys_user_id = data.get("sys_user_id")
        # hospital_id = data.get("hospital_id")
        save_api = data.get("save_api")

        if not sys_user_id or save_api is None:
            raise HTTPException(status_code=400, detail="Missing required fields")
        hospital_id = hospital_user_collection.find_one({"sys_user_id": sys_user_id}, {"_id": 0, "hospital_id": 1})
        if not hospital_id:
            raise HTTPException(status_code=404, detail="Hospital not found for the given sys_user_id")
        hospital_id = hospital_id["hospital_id"]

        # Check if entry exists
        existing_doc = await integrator_save_api_collection.find_one({"sys_user_id": sys_user_id})

        if existing_doc:
            # Update save_api
            await integrator_save_api_collection.update_one(
                {"sys_user_id": sys_user_id},
                {"$set": {"save_api": save_api, "updated_at": datetime.utcnow()}}
            )
            return JSONResponse(content={"message": "save_api updated successfully"})
        else:
            # Insert new document
            new_doc = {
                "sys_user_id": sys_user_id,
                "hospital_id": hospital_id,
                "save_api": save_api,
                "created_at": datetime.utcnow()
            }
            await integrator_save_api_collection.insert_one(new_doc)
            return JSONResponse(content={"message": "New save_api inserted successfully"})

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/get_save_api/{sys_user_id}")
async def get_save_api(sys_user_id: str):
    # Find the document with the given sys_user_id
    doc = await integrator_save_api_collection.find_one({"sys_user_id": sys_user_id})
    
    if not doc:
        raise HTTPException(status_code=404, detail="Save API not found")
    
    # Return only the save_api and optionally hospital_id
    response_data = {
        "hospital_id": doc.get("hospital_id"),
        "save_api": doc.get("save_api")
    }
    
    return JSONResponse(content=response_data)
@router.post("/test_integration")
async def test_integration(request: Request):
    try:
        data = await request.json()
        logger.info(f"Received test integration request: {data}")

        hospital_sys_user_id = data.get("hospital_id")
        patient_sys_user_id = data.get("patient_id")

        if not hospital_sys_user_id or not patient_sys_user_id:
            logger.warning("Missing hospital_id or patient_id in request")
            raise HTTPException(status_code=400, detail="Missing hospital_id or patient_id")

        # Fetch patient demographics for context construction
        patient = await patient_user_collection.find_one(
            {"sys_user_id": patient_sys_user_id},
            {"_id": 0, "name": 1, "age": 1, "gender": 1} )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error in test_integration: {e}")
        raise HTTPException(status_code=500, detail="Internal Server Error")


@router.post("/save_postman_collection")
async def save_postman_collection(request: Request):
    try:
        # Get JSON from request
        collection_data = await request.json()
        
        # Ensure only one JSON exists in this collection at a time
        integration_postman_data_collection.delete_many({})

        # Insert the new Postman collection JSON
        integration_postman_data_collection.insert_one(collection_data)

        return {"status": "success", "message": "Collection saved successfully"}

    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    except PyMongoError as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")
@router.get("/get_postman_collection")
async def get_postman_collection():
    try:
        # Fetch the only JSON document (exclude _id for exact structure)
        collection_data = await integration_postman_data_collection.find_one({}, {"_id": 0})

        if not collection_data:
            raise HTTPException(status_code=404, detail="No collection found")

        return collection_data

    except PyMongoError as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")


def generate_default_opd_timings():

    days = [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday"
    ]

    timings = []

    for day in days:

        timings.append({
            "day": day,
            "start_time": "09:00",
            "end_time": "17:00",
            "slot_duration": 30,
            "is_active": True
        })

    return timings



@router.post("/upload_doctors_excel_with_timings")
async def upload_doctors_excel_with_timings(
    hospital_id: str = Query(...),
    file: UploadFile = File(...),
    dry_run: bool = Form(False)
):

    upload_id = str(uuid.uuid4())[:8]

    logger.info(f"[{upload_id}] Starting doctor upload with timings")

    hospital = hospital_user_collection.find_one({
        "sys_user_id": hospital_id
    })

    if not hospital:
        raise HTTPException(
            status_code=404,
            detail=f"Hospital {hospital_id} not found"
        )

    try:

        if not file.filename.lower().endswith((".xlsx", ".xls")):
            raise HTTPException(
                status_code=400,
                detail="Invalid Excel file"
            )

        contents = await file.read()

        excel_data = pd.read_excel(
            BytesIO(contents),
            sheet_name=None
        )

        if "Doctors" not in excel_data:
            raise HTTPException(
                status_code=400,
                detail="Excel must contain 'Doctors' sheet"
            )

        doctors_df = excel_data["Doctors"]

        doctors_df = doctors_df.dropna(how="all")

        doctors_df = doctors_df.fillna("")

        required_fields = [
            "hms_doctor_id",
            "name",
            "speciality",
            "username",
            "password"
        ]

        def has_meaningful_data(row):

            for field in required_fields:

                if field != "name" and str(row.get(field, "")).strip():
                    return True

            return False

        doctors_df = doctors_df[
            doctors_df.apply(has_meaningful_data, axis=1)
        ]

        doctors_list = doctors_df.to_dict(orient="records")

        preview_data = []

        has_errors = False

        # =====================================================
        # VALIDATION PHASE
        # =====================================================

        for idx, doctor in enumerate(doctors_list, start=1):

            missing_required = [
                field for field in required_fields
                if not str(doctor.get(field, "")).strip()
            ]

            if missing_required:

                has_errors = True

                preview_data.append({
                    "sl_no": idx,
                    "doctor_name": doctor.get("name", ""),
                    "status": "not_added",
                    "message": f"Missing required fields: {', '.join(missing_required)}"
                })

            else:

                preview_data.append({
                    "sl_no": idx,
                    "doctor_name": doctor.get("name", ""),
                    "status": "validated",
                    "message": "Validated successfully"
                })

        if has_errors:

            return {
                "summary": {
                    "total_records": len(doctors_list),
                    "inserted": 0,
                    "failed": len([
                        d for d in preview_data
                        if d["status"] == "not_added"
                    ]),
                    "dry_run": dry_run
                },
                "all_data": preview_data
            }

        inserted = 0

        failed = []

        # =====================================================
        # INSERT PHASE
        # =====================================================

        for idx, doctor in enumerate(doctors_list, start=1):

            try:

                data = map_excel_row_to_data(doctor)

                data["password"] = doctor["password"]

                logger.info(
                    f"[{upload_id}] Row {idx} mapped data: {data}"
                )

                if not dry_run:

                    # ==========================================
                    # CREATE DOCTOR
                    # ==========================================

                    create_doctor_from_excel_data(
                        data=data,
                        hospital_sys_user_id=hospital_id
                    )

                    # ==========================================
                    # FETCH NEWLY CREATED DOCTOR
                    # ==========================================

                    created_doctor = doctor_user_collection.find_one({
                        "doctor_id": data["doctor_id"],
                        "hospital_id": hospital_id
                    })

                    if not created_doctor:

                        raise Exception(
                            f"Doctor not found after creation: {data['doctor_id']}"
                        )

                    doctor_sys_user_id = created_doctor.get("sys_user_id")

                    if not doctor_sys_user_id:

                        raise Exception(
                            "Doctor sys_user_id missing in DB"
                        )


                    # ==========================================
                    # CREATE DEFAULT OPD TIMINGS
                    # ==========================================

                    opd_doc = {
                        "doctor_id": doctor_sys_user_id,
                        "timings": generate_default_opd_timings(),
                        "created_at": datetime.utcnow(),
                        "updated_at": datetime.utcnow()
                    }

                    existing_opd = await OPD_Doctor_timings_collection.find_one({
                        "doctor_id": doctor_sys_user_id
                    })

                    if not existing_opd:

                        await OPD_Doctor_timings_collection.insert_one(
                            opd_doc
                        )

                        logger.info(
                            f"[{upload_id}] OPD timings created for doctor {doctor_sys_user_id}"
                        )

                inserted += 1

            except Exception as e:

                logger.error(
                    f"[{upload_id}] Row {idx} failed: {str(e)}"
                )

                failed.append({
                    "sl_no": idx,
                    "doctor_name": doctor.get("name", ""),
                    "status": "not_added",
                    "message": str(e)
                })

        return {
            "summary": {
                "total_records": len(doctors_list),
                "inserted": inserted,
                "failed": len(failed),
                "dry_run": dry_run
            },
            "all_data": failed if failed else [
                {
                    "sl_no": idx + 1,
                    "doctor_name": doctor.get("name", ""),
                    "status": "added",
                    "message": "Doctor added with default OPD timings"
                }
                for idx, doctor in enumerate(doctors_list)
            ]
        }

    except Exception as e:

        logger.exception(
            f"[{upload_id}] Upload failed"
        )

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )





############################appointment with timings############################

def parse_time(time_str: str):
    """
    Supports:
    - 14:30
    - 2:30 PM
    - 02:30 PM
    """

    time_str = time_str.strip()

    formats = [
        "%H:%M",
        "%I:%M %p",
        "%I:%M%p",
    ]

    for fmt in formats:
        try:
            return datetime.strptime(time_str, fmt)
        except:
            pass

    raise ValueError(f"Invalid time format: {time_str}")


def generate_slots(start_time, end_time, slot_duration):
    slots = []

    current = parse_time(start_time)
    end = parse_time(end_time)

    while current < end:
        slot_end = current + timedelta(minutes=slot_duration)

        if slot_end <= end:
            slots.append(current.strftime("%I:%M %p"))

        current = slot_end

    return slots


@router.get("/available-slots")
async def get_available_slots(
    doctor_id: str = Query(...),
    date: str = Query(...)
):
    """
    Example:
    /available-slots?doctor_id=DOC-123&date=2026-02-11
    """
    logger.info(f"Received request for available slots with doctor_id: {doctor_id}, date: {date}")

    # -----------------------------
    # GET DAY NAME FROM DATE
    # -----------------------------
    try:
        selected_date = datetime.strptime(date, "%Y-%m-%d")
        day_name = selected_date.strftime("%A")
    except:
        raise HTTPException(
            status_code=400,
            detail="Invalid date format. Use YYYY-MM-DD"
        )
    logger.info(f"Finding available slots for doctor_id {doctor_id} on {date} ({day_name})")

    # -----------------------------
    # GET DOCTOR TIMINGS
    # -----------------------------
    doctor_timing_doc = await OPD_Doctor_timings_collection.find_one({
        "doctor_id": doctor_id
    })
    logger.info(f"Doctor timing document for doctor_id {doctor_id}: {doctor_timing_doc}")

    if not doctor_timing_doc:
        raise HTTPException(
            status_code=404,
            detail="Doctor timings not found"
        )

    # -----------------------------
    # FIND DAY SCHEDULE
    # -----------------------------
    day_schedule = None

    for timing in doctor_timing_doc.get("timings", []):
        if (
            timing.get("day", "").lower() == day_name.lower()
            and timing.get("is_active", False)
        ):
            day_schedule = timing
            break

    if not day_schedule:
        return {
            "doctor_id": doctor_id,
            "date": date,
            "day": day_name,
            "available_slots": [],
            "message": "Doctor not available on this day"
        }

    # -----------------------------
    # GENERATE ALL SLOTS
    # -----------------------------
    all_slots = generate_slots(
        start_time=day_schedule["start_time"],
        end_time=day_schedule["end_time"],
        slot_duration=day_schedule["slot_duration"]
    )

    # -----------------------------
    # GET BOOKED APPOINTMENTS
    # -----------------------------
    booked_slots = set()

    appointment_docs = patient_appointments_collection.find({
        "appointments": {
            "$elemMatch": {
                "doctor_id": doctor_id,
                "date": date
            }
        }
    })

    for doc in appointment_docs:
        for appointment in doc.get("appointments", []):

            if (
                appointment.get("doctor_id") == doctor_id
                and appointment.get("date") == date
            ):

                try:
                    parsed_time = parse_time(
                        appointment.get("scheduled_time")
                    )

                    normalized_time = parsed_time.strftime("%I:%M %p")

                    booked_slots.add(normalized_time)

                except:
                    pass

    # -----------------------------
    # REMOVE BOOKED SLOTS
    # -----------------------------
    available_slots = [
        slot for slot in all_slots
        if slot not in booked_slots
    ]

    # -----------------------------
    # RESPONSE
    # -----------------------------
    return {
        "doctor_id": doctor_id,
        "date": date,
        "day": day_name,
        "timings": {
            "start_time": day_schedule["start_time"],
            "end_time": day_schedule["end_time"],
            "slot_duration": day_schedule["slot_duration"]
        },
        "total_slots": len(all_slots),
        "booked_slots": sorted(list(booked_slots)),
        "available_slots": available_slots
    }


@router.get("/doctors_by_hospital/{hospital_id}", response_model=List[dict])
async def get_hospital_doctors(hospital_id: str):
    """
    Example:
    /hospital/HSP-4239044e-bbc2-48d3-8510-6b51d5dc78f8/doctors
    """

    doctors_cursor = doctor_user_collection.find(
        {"hospital_id": hospital_id},
        {
            "_id": 1,
            "sys_user_id": 1,
            "name": 1,
            "specialization": 1,
            "qualifications": 1,
            "email": 1,
            "phone_number": 1,
            "hospital_id": 1,
            "hospital_name": 1,
            "doctor_id": 1
        }
    )

    doctors =  doctors_cursor.to_list(length=None)

    if not doctors:
        raise HTTPException(
            status_code=404,
            detail=f"No doctors found for hospital_id: {hospital_id}"
        )

    formatted_doctors = []

    for doctor in doctors:
        formatted_doctors.append({
            "_id": str(doctor["_id"]),
            "sys_user_id": doctor.get("sys_user_id"),
            "name": doctor.get("name"),
            "speciality": doctor.get("specialization"),
            "hospital_name": doctor.get("hospital_name")
        })

    return formatted_doctors





@router.get("/integration-credentials", response_model=List[Dict[str, Any]])
async def get_integration_credentials():
    """
    Fetch all integration credentials from MongoDB collection
    (Motor async, fully inline)
    """

    # Directly use your already-initialized collection
    cursor = integration_credentials_collection.find({})

    # Fetch all documents
    data = await cursor.to_list(length=None)

    # Optional: remove MongoDB internal _id field
    for item in data:
        item.pop("_id", None)

    return data





@router.post("/upload_transcription_format")
async def upload_transcription_format(
    file: UploadFile = File(...),
    hospital_id: str = Form(...),
):
    # 1. Validate file type
    if not file.filename.lower().endswith(".json"):
        raise HTTPException(status_code=400, detail="Only .json files are allowed.")

    # 2. Read and parse the JSON contents
    try:
        raw_bytes = await file.read()
        parsed_data = json.loads(raw_bytes.decode("utf-8"))
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Uploaded file is not valid JSON.")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Uploaded file encoding is invalid.")
    finally:
        # 3. Release/delete the temp-spooled uploaded file
        await file.close()

    # 4. Build the fields to store — keep the same shape as the uploaded JSON
    update_fields = {
        "hospital_id": hospital_id,
        "source_filename": file.filename,
        "uploaded_at": datetime.now(timezone.utc),
        "data": parsed_data,  # stored exactly as uploaded
    }

    # 5. Upsert: if this hospital already has a record, replace its data;
    #    otherwise insert a new one.
    try:
        result = await transcription_formats_collection.update_one(
            {"hospital_id": hospital_id},
            {"$set": update_fields},
            upsert=True,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to store transcription format: {str(e)}")

    if result.upserted_id is not None:
        record_id = str(result.upserted_id)
        action = "inserted"
    else:
        existing = await transcription_formats_collection.find_one(
            {"hospital_id": hospital_id}, {"_id": 1}
        )
        record_id = str(existing["_id"]) if existing else None
        action = "updated"

    return {
        "status": "success",
        "message": f"Transcription format {action} successfully.",
        "id": record_id,
    }




@router.get("/get_transcription_formats")
async def get_transcription_formats():
    try:
        cursor = transcription_formats_collection.find({})
        documents = await cursor.to_list(length=None)

        # Convert ObjectId to string for JSON serialization
        for doc in documents:
            doc["_id"] = str(doc["_id"])

        return {
            "status": "success",
            "count": len(documents),
            "data": documents,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve transcription formats: {str(e)}")


@router.get("/get_all_dictation_data")
async def get_all_dictation_data():

    try:

        logger.info("Fetching all dictation data")


        dictation_data = []


        cursor = dictation_collection.find(
            {},
            {
                "_id": 0
            }
        )


        async for document in cursor:

            dictation_data.append(document)



        logger.info(
            f"Total dictation records fetched: {len(dictation_data)}"
        )


        return {

            "status": "success",

            "total_records": len(dictation_data),

            "data": dictation_data

        }



    except Exception as e:


        logger.error(
            f"Failed fetching dictation data: {str(e)}"
        )


        raise HTTPException(

            status_code=500,

            detail="Failed to fetch dictation data"

        )
@router.get("/get_all_medication_analysis")
async def get_all_medication_analysis():

    try:

        logger.info(
            "Fetching all medication analysis data"
        )


        medication_records = []


        cursor = documentation_investigation_notes_collection.find(
            {},
            {
                "_id": 0
            }
        )


        async for document in cursor:

            medication_records.append(
                document
            )


        logger.info(
            f"Total medication records fetched: {len(medication_records)}"
        )


        return {

            "status": "success",

            "total_records": len(medication_records),

            "data": medication_records

        }



    except Exception as e:


        logger.error(
            f"Medication analysis fetch failed: {str(e)}"
        )


        raise HTTPException(

            status_code=500,

            detail="Failed to fetch medication analysis data"

        )

@router.get("/get_all_patient_visit_history")
async def get_all_patient_visit_history():

    try:

        records = await patient_visit_history_collection.find(
            {},
            {"_id": 0}
        ).to_list(length=None)

    except Exception as e:

        logger.error(
            f"Failed to fetch visit history: {str(e)}"
        )

        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch visit history: {str(e)}"
        )


    return {

        "status": "success",

        "total_records": len(records),

        "data": records

    }

@router.get("/get_all_patient_lab_reports")
async def get_all_patient_lab_reports():

    try:

        records = await integration_lab_reports_collection.find(
            {},
            {"_id": 0}
        ).to_list(length=None)

    except Exception as e:

        logger.error(
            f"Failed to fetch lab reports: {str(e)}"
        )

        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch lab reports: {str(e)}"
        )


    return {

        "status": "success",

        "total_records": len(records),

        "data": records

    }