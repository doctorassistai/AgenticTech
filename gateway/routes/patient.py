from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, WebSocket, status, File, Form, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse, FileResponse
from fastapi.templating import Jinja2Templates
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
from gateway.middlewares.encryption import EncryptionService
from shared.audit.schema import AuditEvent
from shared.audit.utils import emit_audit
from gateway.middlewares.encryption import encrypt_data, decrypt_data
from gateway.middlewares.utils import get_client_ip
from gateway.middlewares.models import Users, PatientDemoGraphic

from dotenv import load_dotenv
import os

load_dotenv()
api_base_url = os.getenv("VITE_BACKEND_URL")

router = APIRouter(
    prefix="/hms/users/patients",
    tags=["patient"],
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

######################################################################HEADER OF FILE ########################################################################################



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

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

#################################################################################PATIENT REGISTERATION TEST STARTS#################################################################################

# important should remove later
current_user = {}
current_user["sys_user_id"] = "rem_unknown_id"
current_user["role"] = "rem_unknown_type"


################################################################################PATIENT REGISTERATION TEST ENDS#################################################################################



def hash_password(password: str):
    return pwd_context.hash(password)


def generate_patient_id():
    return f"PAT-{uuid.uuid4()}"

def convert_mongo_document(doc):
    if not doc:
        return doc
    doc["_id"] = str(doc["_id"])
    return doc
 
def calculate_age(dob: str) -> int:
    dob_date = datetime.strptime(dob, "%Y-%m-%d").date()
    today = date.today()
    return today.year - dob_date.year - (
        (today.month, today.day) < (dob_date.month, dob_date.day)
    )
    

@router.post("/patientadd")
async def patient_add_post(request: Request):
    """
    Create Patient User, Patient Demographics, and Initial Appointment
    - Inserts into user_auth_collection
    - Inserts into patient_demographics
    - Inserts into patient_appointments
    """
    try:
        data = await request.json()
        logger.info("Patient Registration Started")
        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="INFO",
            source={"service": "gateway", "component": "patient"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/patientadd"
            },
            clinical_context={
                "data_sensitivity": "PHI",
                "hospital_id": data.get("hospital_id")
            },
            action={
                "type": "CREATE_PATIENT",
                "status": "INITIATED"
            }
        ))


        # -----------------------------
        # REQUIRED FIELDS
        # -----------------------------
        username = data.get("hms_id")
        phone = data.get("phone_number")

        if not username or not phone:
            emit_audit(request.app, AuditEvent(
                timestamp=datetime.utcnow(),
                level="ERROR",
                source={"service": "gateway", "component": "patient"},
                actor={
                    "type": current_user["role"],
                    "id": current_user["sys_user_id"]
                },
                context={
                    "trace_id": request.state.trace_id,
                    "ip": request.client.host,
                    "endpoint": "/patientadd"
                },
                clinical_context={
                    "data_sensitivity": "PHI",
                    "hospital_id": data.get("hospital_id")
                },
                action={
                    "type": "CREATE_PATIENT",
                    "status": "FAILED",
                    "reason": "Missing required fields"
                }
            ))
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": "hms_id and phone_number are required"}
            )

        hospital_id = data.get("hospital_id")
        doctor_id = data.get("doctor_id")
        if not doctor_id:
            emit_audit(request.app, AuditEvent(
                timestamp=datetime.utcnow(),
                level="ERROR",
                source={"service": "gateway", "component": "patient"},
                actor={
                    "type": current_user["role"],
                    "id": current_user["sys_user_id"]
                },
                context={
                    "trace_id": request.state.trace_id,
                    "ip": request.client.host,
                    "endpoint": "/patientadd"
                },
                clinical_context={
                    "data_sensitivity": "PHI",
                    "hospital_id": data.get("hospital_id")
                },
                action={
                    "type": "CREATE_PATIENT",
                    "status": "FAILED",
                    "reason": "Missing doctor_id"
                }
            ))
            return JSONResponse(
                    status_code=400,
                    content={"status": "error", "message": "doctor_id must be provided"}
                )
        if not hospital_id:
            doctor = doctor_user_collection.find_one({"sys_user_id": doctor_id})
            if not doctor:
                emit_audit(request.app, AuditEvent(
                    timestamp=datetime.utcnow(),
                    level="ERROR",
                    source={"service": "gateway", "component": "patient"},
                    actor={
                        "type": current_user["role"],
                        "id": current_user["sys_user_id"]
                    },
                    context={
                        "trace_id": request.state.trace_id,
                        "ip": request.client.host,
                        "endpoint": "/patientadd"
                    },
                    clinical_context={
                        "data_sensitivity": "PHI",
                        "hospital_id": data.get("hospital_id")
                    },
                    action={
                        "type": "CREATE_PATIENT",
                        "status": "FAILED",
                        "reason": f"Doctor '{doctor_id}' not found"
                    }
                ))
                return JSONResponse(
                    status_code=400,
                    content={"status": "error", "message": f"Doctor '{doctor_id}' not found"}
                )

            hospital_id = doctor.get("hospital_id")
            if not hospital_id:
                emit_audit(request.app, AuditEvent(
                    timestamp=datetime.utcnow(),
                    level="ERROR",
                    source={"service": "gateway", "component": "patient"},
                    actor={
                        "type": current_user["role"],
                        "id": current_user["sys_user_id"]
                    },
                    context={
                        "trace_id": request.state.trace_id,
                        "ip": request.client.host,
                        "endpoint": "/patientadd"
                    },
                    clinical_context={
                        "data_sensitivity": "PHI",
                        "hospital_id": data.get("hospital_id")
                    },
                    action={
                        "type": "CREATE_PATIENT",
                        "status": "FAILED",
                        "reason": f"Doctor '{doctor_id}' has no associated hospital"
                    }
                ))
                return JSONResponse(
                    status_code=400,
                    content={"status": "error", "message": "Doctor has no associated hospital"}
                )

        email = data.get("email")
        family_history = data.get("family_history")

        # -----------------------------
        # VALIDATIONS
        # -----------------------------
        if user_auth_collection.find_one({"username": username}):
            emit_audit(request.app, AuditEvent(
                timestamp=datetime.utcnow(),
                level="ERROR",
                source={"service": "gateway", "component": "patient"},
                actor={
                    "type": current_user["role"],
                    "id": current_user["sys_user_id"]
                },
                context={
                    "trace_id": request.state.trace_id,
                    "ip": request.client.host,
                    "endpoint": "/patientadd"
                },
                clinical_context={
                    "data_sensitivity": "PHI",
                    "hospital_id": data.get("hospital_id")
                },
                action={
                    "type": "CREATE_PATIENT",
                    "status": "FAILED",
                    "reason": f"hms_id '{username}' already exists"
                }
            ))
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": f"hms_id '{username}' already exists"}
            )

        if email and user_auth_collection.find_one({"email": email}):
            emit_audit(request.app, AuditEvent(
                timestamp=datetime.utcnow(),
                level="ERROR",
                source={"service": "gateway", "component": "patient"},
                actor={
                    "type": current_user["role"],
                    "id": current_user["sys_user_id"]
                },
                context={
                    "trace_id": request.state.trace_id,
                    "ip": request.client.host,
                    "endpoint": "/patientadd"
                },
                clinical_context={
                    "data_sensitivity": "PHI",
                    "hospital_id": data.get("hospital_id")
                },
                action={
                    "type": "CREATE_PATIENT",
                    "status": "FAILED",
                    "reason": f"Email '{email}' already exists"
                }
            ))
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": f"Email '{email}' already exists"}
            )

        if user_auth_collection.find_one({"phone_number": phone}):
            emit_audit(request.app, AuditEvent(
                timestamp=datetime.utcnow(),
                level="ERROR",
                source={"service": "gateway", "component": "patient"},
                actor={
                    "type": current_user["role"],
                    "id": current_user["sys_user_id"]
                },
                context={
                    "trace_id": request.state.trace_id,
                    "ip": request.client.host,
                    "endpoint": "/patientadd"
                },
                clinical_context={
                    "data_sensitivity": "PHI",
                    "hospital_id": data.get("hospital_id")
                },
                action={
                    "type": "CREATE_PATIENT",
                    "status": "FAILED",
                    "reason": f"Phone number '{phone}' already exists"
                }
            ))
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": f"Phone number '{phone}' already exists"}
            )

        # -----------------------------
        # ID GENERATION
        # -----------------------------
        sys_user_id = generate_patient_id()
        patient_id = f"PAT-{str(ObjectId())}"
        created_at = data.get("created_at", datetime.now())

        # -----------------------------
        # PASSWORD
        # -----------------------------
        hashed_pw = hash_password(phone)

        # -----------------------------
        # PATIENT DEMOGRAPHICS
        # -----------------------------
        patient_obj = PatientDemoGraphic(
            sys_user_id=sys_user_id,
            patient_id=patient_id,
            hospital_id=hospital_id,
            doctor_id=doctor_id,
            name=data["name"],
            date_of_birth=data["date_of_birth"],
            gender=data["gender"],
            email=email,
            phone_number=phone,
            blood_group=data.get("blood_group"),
            marital_status=data.get("marital_status"),
            address=data.get("address"),
            education=data.get("education"),
            occupation=data.get("occupation"),
            annual_income=data.get("annual_income"),
            family_history=data.get("family_history"),
            hms_id=username,
            created_at=created_at
        )

        # patient_payload = {
        #     "sys_user_id": sys_user_id,
        #     "patient_id": patient_id,
        #     "hospital_id": hospital_id,
        #     "name": data["name"],
        #     "date_of_birth": data["date_of_birth"],
        #     "gender": data["gender"],  # NOT encrypted
        #     "email": email,
        #     "phone_number": phone,
        #     "blood_group": data.get("blood_group"),  # NOT encrypted
        #     "marital_status": data.get("marital_status"),  # NOT encrypted
        #     "address": data.get("address"),
        #     "education": data.get("education"),
        #     "occupation": data.get("occupation"),
        #     "annual_income": data.get("annual_income"),
        #     "family_history": data.get("family_history"),
        #     "hms_id": username,
        #     "created_at": created_at
        # }

        # -----------------------------
        # USERS AUTH
        # -----------------------------
        user_obj = Users(
            sys_user_id=sys_user_id,
            doctor_assist_id=patient_id,
            email=email,
            phone_number=phone,
            username=username,
            password=hashed_pw,
            role="patient",
            user_type="first_account",
            status="active",
            created_at=created_at,
            renewed_at=created_at
        )


   
    
  
        # -----------------------------
        # SAVE FAMILY HISTORY AS CLINICAL CONTEXT
        # -----------------------------
        # if family_history:
        #     try:
        #         feature_payload = {
        #             "doctor_id": doctor_id,
        #             "patient_id": sys_user_id,
        #             "current_context": [
        #                 {
        #                     "date": datetime.utcnow().date().isoformat(),
        #                     "condition": [
        #                         {
        #                             "id": str(uuid.uuid4()),
        #                             "text": family_history
        #                         }
        #                     ]
        #                 }
        #             ]
        #         }

        #         logger.info(
        #             "Sending family history to feature context LLM (patient registration)",
        #             extra={
        #                 "endpoint": "current_context_save",
        #                 "patient_id": sys_user_id,
        #                 "doctor_id": doctor_id,
        #                 "payload": feature_payload
        #             }
        #         )

        #         async with httpx.AsyncClient(timeout=10.0) as client:
        #             llm_response = await client.post(
        #                 "https://demo.doctorassist.ai/api/hms/users/data/context/medical_context_save",
        #                 json=feature_payload,d
        #                 headers={"Content-Type": "application/json"}
        #             )

        #         if llm_response.status_code != 200:
        #             logger.error(
        #                 "Family history context save failed",
        #                 extra={
        #                     "status_code": llm_response.status_code,
        #                     "response": llm_response.text,
        #                     "patient_id": sys_user_id,
        #                     "doctor_id": doctor_id
        #                 }
        #             )

        #     except Exception as ctx_err:
        #         logger.exception(
        #             "Failed to save family history context during patient registration",
        #             extra={
        #                 "patient_id": sys_user_id,
        #                 "doctor_id": doctor_id
        #             }
        #         )

        

        # 🔐 Encrypt only sensitive fields
        # encrypted_patient_payload = encrypt_data(patient_payload)

        # patient_obj = PatientDemoGraphic(**encrypted_patient_payload)

        # -----------------------------
        # DATABASE INSERTS
        # -----------------------------
        patient_user_collection.insert_one(patient_obj.model_dump())
        user_auth_collection.insert_one(user_obj.model_dump())

        logger.info("Patient registration completed successfully")
        

        # ==========================================================
        # SAVE PATIENT DEMOGRAPHICS TO CONTEXT (FIXED PAYLOADS)
        # ==========================================================
        try:
            context_date = datetime.utcnow().date()
            text_parts = []

            if data.get("date_of_birth"):
                try:
                    dob = datetime.strptime(data["date_of_birth"], "%Y-%m-%d").date()
                    today = datetime.utcnow().date()
                    age = today.year - dob.year - (
                        (today.month, today.day) < (dob.month, dob.day)
                    )
                    text_parts.append(f"Age: {age} years")
                except ValueError:
                    logger.warning(
                        f"Invalid DOB format '{data.get('date_of_birth')}', skipping age",
                        extra={"patient_id": sys_user_id}
                    )

            if data.get("gender"):
                text_parts.append(f"Gender: {data['gender']}")

            if data.get("blood_group"):
                text_parts.append(f"Blood group: {data['blood_group']}")

            if data.get("family_history"):
                text_parts.append(f"Family history: {data['family_history']}")

            if not text_parts:
                raise ValueError("No demographics data available")

            clinical_text = ", ".join(text_parts) + "."
            context_id = str(uuid.uuid4())
            date_str = context_date.isoformat()

            # -----------------------------
            # CURRENT CONTEXT PAYLOAD
            # -----------------------------
            current_context_payload = {
                "doctor_id": None,
                "patient_id": sys_user_id,
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

            # -----------------------------
            # MEDICAL CONTEXT PAYLOAD (FIXED)
            # -----------------------------
            medical_context_payload = {
                "doctor_id": None,
                "patient_id": sys_user_id,
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
                    "patient_id": sys_user_id,
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

        except Exception:
            logger.exception(
                "Failed to save patient demographics to context",
                extra={"patient_id": sys_user_id}
            )

        logger.info("Patient registration completed successfully")


        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="INFO",
            source={"service": "gateway", "component": "patient"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": request.client.host,
                "endpoint": "/patientadd"
            },
            clinical_context={
                "data_sensitivity": "PHI",
                "hospital_id": data.get("hospital_id")
            },
            action={
                "type": "CREATE_PATIENT",
                "status": "SUCCESS"
            }
        ))

        return {
            "status": "success",
            "message": "Patient registered successfully",
            "patient_id": patient_id,
            "sys_user_id": sys_user_id,
            "hospital_id": hospital_id
        }

    except Exception as e:
        logger.exception("Patient Registration Failed: %s", str(e))
        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="ERROR",
            source={"service": "gateway", "component": "patient"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": request.client.host,
                "endpoint": "/patientadd"
            },
            clinical_context={
                "data_sensitivity": "PHI",
                "hospital_id": data.get("hospital_id")
            },
            action={
                "type": "CREATE_PATIENT",
                "status": "ERROR"
            }
        ))
        raise HTTPException(status_code=500, detail=str(e))



@router.get("/patient/{patient_id}")
async def get_patient_by_patient_id(
    patient_id: str,
    request: Request
):
    """
    Retrieve Patient Details using patient_id
    - Fetch from patient_demographics
    - Fetch from user_auth
    """

    try:
        logger.info(f"Fetching patient details for patient_id={patient_id}")

        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="INFO",
            source={"service": "gateway", "component": "patient"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": f"/patient/{patient_id}"
            },
            clinical_context={
                "data_sensitivity": "PHI"
            },
            action={
                "type": "FETCH_PATIENT",
                "status": "INITIATED"
            }
        ))

        # -----------------------------
        # FETCH PATIENT DEMOGRAPHICS
        # -----------------------------
        patient = patient_user_collection.find_one(
            {"sys_user_id": patient_id},
            {"_id": 0}
        )

        if not patient:
            emit_audit(request.app, AuditEvent(
                timestamp=datetime.utcnow(),
                level="ERROR",
                source={"service": "gateway", "component": "patient"},
                actor={
                    "type": current_user["role"],
                    "id": current_user["sys_user_id"]
                },
                context={
                    "trace_id": request.state.trace_id,
                    "ip": get_client_ip(request),
                    "endpoint": f"/patient/{patient_id}"
                },
                clinical_context={
                    "data_sensitivity": "PHI"
                },
                action={
                    "type": "FETCH_PATIENT",
                    "status": "FAILED",
                    "reason": "Patient not found"
                }
            ))

            raise HTTPException(status_code=404, detail="Patient not found")

        sys_user_id = patient.get("sys_user_id")

        # -----------------------------
        # FETCH AUTH DETAILS
        # -----------------------------
        user_auth = user_auth_collection.find_one(
            {"sys_user_id": sys_user_id},
            {"_id": 0, "password": 0}  # never expose password
        )

        # -----------------------------
        # RESPONSE
        # -----------------------------
        response = {
            "patient_id": patient_id,
            "sys_user_id": sys_user_id,
            "hospital_id": patient.get("hospital_id"),
            "demographics": patient,
            "auth": user_auth
        }

        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="INFO",
            source={"service": "gateway", "component": "patient"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": f"/patient/{patient_id}"
            },
            clinical_context={
                "data_sensitivity": "PHI"
            },
            action={
                "type": "FETCH_PATIENT",
                "status": "SUCCESS"
            }
        ))

        return {
            "status": "success",
            "data": response
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.exception("Patient Retrieval Failed: %s", str(e))

        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="ERROR",
            source={"service": "gateway", "component": "patient"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": f"/patient/{patient_id}"
            },
            clinical_context={
                "data_sensitivity": "PHI"
            },
            action={
                "type": "FETCH_PATIENT",
                "status": "ERROR"
            }
        ))

        raise HTTPException(status_code=500, detail="Internal server error")



@router.get("/get_all_patients")
async def get_all_patients(
    request: Request,
    doctor_id: str = Query(...)
):
    try:
        logger.info(f"Fetching patients for doctor_id={doctor_id}")

        # 1️⃣ Fetch doctor
        doctor = doctor_user_collection.find_one(
            {"sys_user_id": doctor_id}
        )

        if not doctor:
            return JSONResponse(
                status_code=404,
                content={"status": "error", "message": "Doctor not found"}
            )

        # 2️⃣ Get hospital
        hospital_id = doctor.get("hospital_id")

        if not hospital_id:
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": "Doctor has no hospital mapping"}
            )

        # 3️⃣ 🔥 FETCH ALL HOSPITAL PATIENTS (THIS IS THE FIX)
        patients = list(
            patient_user_collection.find(
                { "hospital_id": hospital_id },
                { "_id": 0 }
            )
        )

        return {
            "status": "success",
            "total_patients": len(patients),
            "patients": patients
        }

    except Exception as e:
        logger.exception("Failed to fetch patients")
        raise HTTPException(status_code=500, detail=str(e))



@router.get("/hospital/{hospital_id}/appointments")
async def get_hospital_appointments(hospital_id: str):
    try:
        # 1️⃣ Get all patients of hospital
        patients = list(
            patient_user_collection.find(
                {"hospital_id": hospital_id},
                {"_id": 0, "sys_user_id": 1, "patient_id": 1}
            )
        )

        if not patients:
            return {
                "status": "success",
                "total_appointments": 0,
                "appointments": []
            }

        patient_sys_ids = [p["sys_user_id"] for p in patients]

        # 2️⃣ Fetch all doctors once
        doctors = list(
            doctor_user_collection.find(
                {},
                {"_id": 0, "sys_user_id": 1, "name": 1, "specialization": 1}
            )
        )

        doctor_map = {
            d["sys_user_id"]: {
                "name": d.get("name"),
                "specialization": d.get("specialization")
            }
            for d in doctors
        }

        # 3️⃣ Get appointment documents
        appointment_docs = list(
            patient_appointments_collection.find(
                {"sys_user_id": {"$in": patient_sys_ids}},
                {"_id": 0}
            )
        )

        all_appointments = []

        for doc in appointment_docs:
            for appt in doc.get("appointments", []):

                doctor_id = appt.get("doctor_id")
                doctor_info = doctor_map.get(doctor_id)

                all_appointments.append({
                    "sys_user_id": doc.get("sys_user_id"),
                    "patient_id": doc.get("patient_id"),
                    "doctor_id": doctor_id,
                    "doctor_name": doctor_info["name"] if doctor_info else None,
                    "department": doctor_info["specialization"] if doctor_info else None,
                    "date": appt.get("date"),
                    "scheduled_time": appt.get("scheduled_time"),
                    "visit_type": appt.get("visit_type"),
                    "chief_complaint": appt.get("chief_complaint")
                })

        return {
            "status": "success",
            "total_appointments": len(all_appointments),
            "appointments": all_appointments
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/patient/sys-user/{sys_user_id}")
async def get_patient_by_sys_user_id(
    sys_user_id: str,
    request: Request
):
    """
    Retrieve Patient Details using sys_user_id
    - Fetch from patient_demographics
    - Fetch from user_auth
    """

    try:
        logger.info(f"Fetching patient details for sys_user_id={sys_user_id}")

        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="INFO",
            source={"service": "gateway", "component": "patient"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": f"/patient/sys-user/{sys_user_id}"
            },
            clinical_context={
                "data_sensitivity": "PHI"
            },
            action={
                "type": "FETCH_PATIENT_BY_SYS_USER",
                "status": "INITIATED"
            }
        ))

        # -----------------------------
        # FETCH PATIENT DEMOGRAPHICS
        # -----------------------------
        patient = patient_user_collection.find_one(
            {"sys_user_id": sys_user_id},
            {"_id": 0}
        )

        if not patient:
            emit_audit(request.app, AuditEvent(
                timestamp=datetime.utcnow(),
                level="ERROR",
                source={"service": "gateway", "component": "patient"},
                actor={
                    "type": current_user["role"],
                    "id": current_user["sys_user_id"]
                },
                context={
                    "trace_id": request.state.trace_id,
                    "ip": get_client_ip(request),
                    "endpoint": f"/patient/sys-user/{sys_user_id}"
                },
                clinical_context={
                    "data_sensitivity": "PHI"
                },
                action={
                    "type": "FETCH_PATIENT_BY_SYS_USER",
                    "status": "FAILED",
                    "reason": "Patient not found"
                }
            ))

            raise HTTPException(status_code=404, detail="Patient not found")

        patient_id = patient.get("patient_id")

        # -----------------------------
        # FETCH AUTH DETAILS
        # -----------------------------
        user_auth = user_auth_collection.find_one(
            {"sys_user_id": sys_user_id},
            {"_id": 0, "password": 0}
        )

        # -----------------------------
        # RESPONSE
        # -----------------------------
        response = {
            "patient_id": patient_id,
            "sys_user_id": sys_user_id,
            "hospital_id": patient.get("hospital_id"),
            "demographics": patient,
            "auth": user_auth
        }

        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="INFO",
            source={"service": "gateway", "component": "patient"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": f"/patient/sys-user/{sys_user_id}"
            },
            clinical_context={
                "data_sensitivity": "PHI"
            },
            action={
                "type": "FETCH_PATIENT_BY_SYS_USER",
                "status": "SUCCESS"
            }
        ))

        return {
            "status": "success",
            "data": response
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.exception("Patient Retrieval Failed: %s", str(e))

        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="ERROR",
            source={"service": "gateway", "component": "patient"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": f"/patient/sys-user/{sys_user_id}"
            },
            clinical_context={
                "data_sensitivity": "PHI"
            },
            action={
                "type": "FETCH_PATIENT_BY_SYS_USER",
                "status": "ERROR"
            }
        ))

        raise HTTPException(status_code=500, detail="Internal server error")





@router.put("/patient/update-dob/{sys_user_id}")
async def update_patient_dob(sys_user_id: str, request: Request):
    try:
        data = await request.json()
        new_dob = data.get("date_of_birth")

        if not new_dob:
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": "date_of_birth is required"}
            )

        # Validate DOB format (YYYY-MM-DD)
        try:
            parsed_dob = datetime.strptime(new_dob, "%Y-%m-%d").date()
        except ValueError:
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": "Invalid DOB format. Use YYYY-MM-DD"}
            )

        # Check if patient exists
        patient = patient_user_collection.find_one({"sys_user_id": sys_user_id})
        if not patient:
            return JSONResponse(
                status_code=404,
                content={"status": "error", "message": "Patient not found"}
            )

        # Update DOB
        patient_user_collection.update_one(
            {"sys_user_id": sys_user_id},
            {
                "$set": {
                    "date_of_birth": new_dob,
                    "updated_at": datetime.utcnow()
                }
            }
        )

        logger.info(f"DOB updated for patient {sys_user_id}")

        return {
            "status": "success",
            "message": "Date of birth updated successfully",
            "sys_user_id": sys_user_id,
            "date_of_birth": new_dob
        }

    except Exception as e:
        logger.exception("Failed to update DOB: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))