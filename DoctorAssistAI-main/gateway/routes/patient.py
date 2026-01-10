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

        

        # 🔐 Encrypt only sensitive fields
        # encrypted_patient_payload = encrypt_data(patient_payload)

        # patient_obj = PatientDemoGraphic(**encrypted_patient_payload)

        # -----------------------------
        # DATABASE INSERTS
        # -----------------------------
        patient_user_collection.insert_one(patient_obj.model_dump())
        user_auth_collection.insert_one(user_obj.model_dump())

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



@router.get("/get_all_patients")
async def get_all_patients(request: Request):
    """
    Fetch all documents from 'patient_users' collection.
    """
    try:
        logger.info("Fetching all patients from patient_users collection")

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
                "endpoint": "/get_all_patients"
            },
            clinical_context={
                "data_sensitivity": "PHI"
            },
            action={
                "type": "FETCH_ALL_PATIENTS",
                "status": "INITIATED"
            }
        ))

        cursor = database["patient_users"].find({})
        patients_list = []

        async for patient in cursor:
            # patients_list.append(convert_mongo_document(patient))
            patient = convert_mongo_document(patient)

            # 🔓 Decrypt sensitive fields
            # patient = decrypt_data(patient)

            patients_list.append(patient)

        logger.info("Total %d patients retrieved", len(patients_list))

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
                "endpoint": "/get_all_patients"
            },
            clinical_context={
                "data_sensitivity": "PHI"
            },
            action={
                "type": "FETCH_ALL_PATIENTS",
                "status": "SUCCESS",
                "total_patients": len(patients_list)
            }
        ))

        return {
            "status": "success",
            "total_patients": len(patients_list),
            "patients": patients_list
        }

    except Exception as e:
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
                "endpoint": "/get_all_patients"
            },
            clinical_context={
                "data_sensitivity": "PHI"
            },
            action={
                "type": "FETCH_ALL_PATIENTS",
                "status": "ERROR"
            }
        ))
        logger.exception("Error fetching all patients: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))