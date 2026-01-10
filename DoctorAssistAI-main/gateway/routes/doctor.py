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

from gateway.middlewares.models import Users, Doctor
from gateway.middlewares.encryption import encrypt_data, decrypt_data
from gateway.middlewares.utils import get_client_ip

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

doctor_user_collection = db["doctor_users"]

patient_user_collection = db["patient_users"]

patient_appointments_collection = db["patient_appointments"]

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

#################################################################################PATIENT REGISTERATION TEST STARTS#################################################################################

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


@router.post("/doctoradd")
async def doctor_add_post(request: Request, current_user=Depends(get_current_user)):
    """
    Create a Hospital Admin and insert into both MongoDB collections.
    hospital_id is auto-generated using UUID: HSP-<uuid4>.
    """
    try:
        data = await request.json()

        logger.info("Doctor Registration Started")
        
        username = data["username"]
        email = data.get("email") or None
        phone = data["phone_number"]


        existing_username = user_auth_collection.find_one({"username": username})
        if existing_username:
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
                    "endpoint": "/doctoradd"
                },
                clinical_context={
                    "data_sensitivity": "PHI",
                    "hospital_id": data.get("hospital_id")
                },
                action={
                    "type": "CREATE_DOCTOR",
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

        if email != None:
            existing_email = user_auth_collection.find_one({"email": email})
            if existing_email:
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
                        "endpoint": "/doctoradd"
                    },
                    clinical_context={
                        "data_sensitivity": "PHI",
                        "hospital_id": data.get("hospital_id")
                    },
                    action={
                        "type": "CREATE_DOCTOR",
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

        existing_phone = user_auth_collection.find_one({"phone_number": phone})
        if existing_phone:
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
                    "endpoint": "/doctoradd"
                },
                clinical_context={
                    "data_sensitivity": "PHI",
                    "hospital_id": data.get("hospital_id")
                },
                action={
                    "type": "CREATE_DOCTOR",
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

        # -----------------------------------------
        # 4️⃣ PROCEED WITH CREATION
        # -----------------------------------------

        sys_user_id = generate_doctor_id()
        doctor_assist_id = generate_random_string()
        logger.info(f"RAW PASSWORD RECEIVED: {data['password']} - LENGTH: {len(data['password'])}")

        hashed_pw = hash_password(data["password"])
        created_at = data.get("created_at", datetime.now())
        hospital_id = data["hospital_id"]
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
                    "endpoint": "/doctoradd"
                },
                clinical_context={
                    "data_sensitivity": "PHI",
                    "hospital_id": data.get("hospital_id")
                },
                action={
                    "type": "CREATE_DOCTOR",
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
        # ---- 1️⃣ Create Doctor Model Object ----
        doctor_obj = Doctor(
            name=data["name"],
            hospital_id=data["hospital_id"],
            sys_user_id=sys_user_id,
            doctor_id=doctor_assist_id,      # Auto-generated UUID ID
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

        # ---- 2️⃣ Create Users Model Object ----
        user_obj = Users(
            sys_user_id=sys_user_id,
            doctor_assist_id = doctor_assist_id,
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

        # ---- 4️⃣ Insert into MongoDB ----
        doctor_user_collection.insert_one(doctor_obj.model_dump())
        user_auth_collection.insert_one(user_obj.model_dump())

        logger.info("Doctor and User Auth inserted successfully")
        
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
                "endpoint": "/doctoradd"
            },
            clinical_context={
                "data_sensitivity": "PHI",
                "hospital_id": data.get("hospital_id")
            },
            action={
                "type": "CREATE_DOCTOR",
                "status": "SUCCESS",
                "doctor_sys_user_id": sys_user_id
            }
        ))

        return {
            "status": "success",
            "message": "Doctor registered successfully.",
            "doctor_id": sys_user_id
        }

    except Exception as e:
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
                "endpoint": "/doctoradd"
            },
            clinical_context={
                "data_sensitivity": "PHI",
                "hospital_id": data.get("hospital_id")
            },
            action={
                "type": "CREATE_DOCTOR",
                "status": "FAILED",
                "reason": str(e)
            }
        ))
        logger.exception("Doctor Creation Failed: %s", str(e))
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

        patient_appointments_collection.update_one(
            {"sys_user_id": sys_user_id},
            {
                "$setOnInsert": {
                    "patient_id": patient_id,
                    "created_at": datetime.utcnow()
                },
                "$push": {"appointments": new_appointment}
            },
            upsert=True
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


@router.get("/doctor_today_appointments/{doctor_id}")
async def get_todays_appointments_for_doctor(doctor_id: str):
    try:
        today = date.today().isoformat()  # YYYY-MM-DD

        cursor = patient_appointments_collection.find(
            {
                "appointments": {
                    "$elemMatch": {
                        "doctor_id": doctor_id,
                        "date": today
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
