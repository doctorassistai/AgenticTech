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
from gateway.middlewares.encryption import EncryptionService
from shared.audit.schema import AuditEvent
from shared.audit.utils import emit_audit
from gateway.middlewares.encryption import encrypt_data, decrypt_data
from gateway.middlewares.utils import get_client_ip


SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
ACCESS_TOKEN_EXPIRE_DAYS = int(os.getenv("ACCESS_TOKEN_EXPIRE_DAYS", 1))

api_key = os.getenv("GROQ_API_KEY")

groq_client = Groq(api_key=api_key)



router = APIRouter(
    prefix="/hms/users/auth",
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



#########################################################################################

# SENSITIVE_PATIENT_FIELDS = {
#     "name",
#     "email",
#     "phone_number",
#     "address",
#     "date_of_birth",
#     "family_history",
#     "education",
#     "occupation",
#     "annual_income",
# }

# def encrypt_patient_data(data: dict) -> dict:
#     encrypted = data.copy()
#     for field in SENSITIVE_PATIENT_FIELDS:
#         if field in encrypted and encrypted[field] is not None:
#             encrypted[field] = EncryptionService.encrypt(str(encrypted[field]))
#     return encrypted


# def decrypt_patient_data(data: dict) -> dict:
#     decrypted = data.copy()
#     for field in SENSITIVE_PATIENT_FIELDS:
#         if field in decrypted and decrypted[field] is not None:
#             try:
#                 decrypted[field] = EncryptionService.decrypt(decrypted[field])
#             except Exception:
#                 # Fail-safe: return original if decryption fails
#                 pass
#     return decrypted



#########################################################################################



class Users(BaseModel):
    sys_user_id: str # long globally unique id
    doctor_assist_id: str # short id unique for doctor assist system
    email: Optional[str]= None
    phone_number: str
    username: str
    password: str
    role: str  # 'doctor', 'staff', 'patient'
    user_type: Optional[str] = None  # 'trial_account', 'paid_account'
    status: str  # 'active', 'inactive'
    created_at: Optional[datetime] = None
    renewed_at: Optional[datetime] = None
    
class Hospital(BaseModel):
    name: str
    address: Optional[str]
    headquarters: Optional[str]
    username: str
    hospital_id: str # short id unique for doctor assist system
    sys_user_id: str # long globally unique id
    email: Optional[str]= None
    phone_number: str
    no_of_staff: int
    no_of_beds: int
    country_code: str
    hospital_user_type: str  # 'hms_integration', 'da user', 'iframe user'
    created_at: Optional[datetime] = None

class Doctor(BaseModel):
    name: str
    hospital_id: str 
    sys_user_id: str # long globally unique id
    doctor_id: str # short id unique for doctor assist system
    email: Optional[str]= None
    phone_number: str
    username: str
    address: Optional[str] = None
    hospital_name: Optional[str] = None
    country_code: str
    qualifications: Optional[str] = None
    specialization: str
    registeration_number: Optional[str] = None
    created_at: Optional[datetime] = None

class PatientDemoGraphic(BaseModel):
    sys_user_id: str # long globally unique id
    patient_id: str # short id unique for doctor assist system
    hospital_id: str
    name: str
    date_of_birth: str
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
    created_at: Optional[datetime] = None

class SingleAppointment(BaseModel):
    appointment_id: Optional[str]
    doctor_id: str
    scheduled_time: Optional[str]
    date: Optional[str]
    visit_type: Optional[str]
    chief_complaint: Optional[str] = None


class Appointments(BaseModel):
    sys_user_id: str
    patient_id: str
    appointments: List[SingleAppointment] = []




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

def generate_random_string(length=10):
    return ''.join(random.choices(string.ascii_letters + string.digits, k=length))

def generate_api_key(length=32):
    return ''.join(random.choices(string.ascii_letters + string.digits, k=length))

def get_auth_key_validity_date():
    return (datetime.now() + timedelta(days=30)).strftime("%d-%m-%Y %H:%M:%S")

def hash_password(password: str):
    return pwd_context.hash(password)

def generate_hospital_id():
    return f"HSP-{uuid.uuid4()}"

def generate_doctor_id():
    return f"DOC-{uuid.uuid4()}"

def generate_patient_id():
    return f"PAT-{uuid.uuid4()}"

def convert_mongo_document(doc):
    if not doc:
        return doc
    doc["_id"] = str(doc["_id"])
    return doc

def verify_password(password: str, hashed_password: str) -> bool:
    return pwd_context.verify(password, hashed_password)

def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()

    expire = datetime.utcnow() + (expires_delta or timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS))
    to_encode.update({"exp": expire})

    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt



#################################################################################PATIENT REGISTERATION TEST STARTS#################################################################################

# important should remove later
current_user = {}
current_user["sys_user_id"] = "rem_unknown_id"
current_user["role"] = "rem_unknown_type"


################################################################################PATIENT REGISTERATION TEST ENDS#################################################################################

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


@router.post("/login")
async def login_user(request: Request, response: Response):
    try:
        data = await request.json()
        username = data.get("username")
        password = data.get("password")

        if not username or not password:
            raise HTTPException(status_code=400, detail="Username and password required")

        user = user_auth_collection.find_one({"username": username})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        if not verify_password(password, user["password"]):
            raise HTTPException(status_code=401, detail="Invalid password")

        access_token = create_access_token(
            data={
                "sub": user["sys_user_id"],
                "role": user["role"],
                "username": user["username"]
            }
        )

        # 👉 CREATE JSON RESPONSE
        resp = JSONResponse(content={
            "status": "success",
            "message": "Login successful",
            "user_id": user["sys_user_id"],
            "role": user["role"]
        })

        # 👉 SET COOKIE ON THAT RESPONSE
        resp.set_cookie(
            key="access_token",
            value=access_token,
            httponly=True,
            secure=True,
            samesite= "none",  #"strict" on production
            max_age=60 * 60 * 24
        )

        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="INFO",
            source={"service": "gateway", "component": "auth"},
            actor={
                "type": user["role"],
                "id": user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/login"
            },
            clinical_context={
                "username": username
            },
            action={
                "type": "LOGIN",
                "status": "SUCCESS"
            }
        ))


        return resp

    except Exception as e:
        logger.error(f"Login failed: {e}")
        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="WARNING",
            source={"service": "gateway", "component": "auth"},
            actor={"type": "unknown"},
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/login"
            },
            clinical_context={
                "username": username
            },
            action={
                "type": "LOGIN",
                "status": "FAILED",
                "reason": "INVALID_CREDENTIALS"
            }
        ))

        raise HTTPException(status_code=500, detail=str(e))

    
@router.post("/logout")
async def logout_user(request: Request, current_user: dict = Depends(get_current_user)):
    response = JSONResponse(content={
        "status": "success",
        "message": "Logged out successfully"
    })
    emit_audit(request.app, AuditEvent(
        timestamp=datetime.utcnow(),
        level="INFO",
        source={"service": "gateway", "component": "auth"},
        actor={
            "type": current_user["role"],
            "id": current_user["sys_user_id"] if current_user else None
        },
        context={
            "trace_id": request.state.trace_id,
            "ip": get_client_ip(request),
            "endpoint": "/logout"
        },
        clinical_context={},
        action={
            "type": "LOGOUT",
            "status": "SUCCESS"
        }
    ))


    # ✅ DELETE THE COOKIE
    response.delete_cookie(
        key="access_token",
        httponly=True,
        secure=True,      # ✅ TRUE in production (HTTPS)
        samesite="none" # ✅ must MATCH login cookie "strict" 
    )

    return response




@router.get("/verify")
async def verify_user(request: Request, current_user: dict = Depends(get_current_user)):
    emit_audit(request.app, AuditEvent(
        timestamp=datetime.utcnow(),
        level="INFO",
        source={"service": "gateway", "component": "auth"},
        actor={
            "type": current_user["role"],
            "id": current_user["sys_user_id"]
        },
        context={
            "trace_id": request.state.trace_id,
            "ip": get_client_ip(request),
            "endpoint": "/verify"
        },
        clinical_context={},
        action={
            "type": "TOKEN_VERIFY",
            "status": "SUCCESS"
        }
    ))

    return {
        "status": "authenticated",
        "user": {
            "sys_user_id": current_user["sys_user_id"],
            "username": current_user["username"],
            "role": current_user["role"]
        }
    }



#########################################################################GET ENDPOINTS#########################################################################



# async def get_all_users(current_user: dict = Depends(get_current_user)): //usecase of jwt

@router.get("/get_all_users")
async def get_all_users(request: Request, current_user: dict = Depends(get_current_user)):
    """
    Fetch all documents from 'user_auth' collection.
    """
    try:
        logger.info("Fetching all users from user_auth collection")

        cursor = database["user_auth"].find({}, {"password": 0})
        users_list = []

        async for user in cursor:
            users_list.append(convert_mongo_document(user))

        logger.info("Total %d users retrieved", len(users_list))

        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="INFO",
            source={"service": "gateway", "component": "user_management"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/get_all_users",
                "records_returned": len(users_list)
            },
            clinical_context={},
            action={
                "type": "READ_USERS",
                "status": "SUCCESS",
                "scope": "ALL"
            }
        ))

        return {
            "status": "success",
            "total_users": len(users_list),
            "users": users_list
        }

    except Exception as e:
        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="ERROR",
            source={"service": "gateway", "component": "user_management"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/get_all_users",
            },
            clinical_context={},
            action={
                "type": "READ_USERS",
                "status": "FAILED",
                "reason": str(e)
            }
        ))
        logger.exception("Error fetching all users: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))



@router.get("/get_all_hospitals")
async def get_all_hospitals():
    """
    Fetch all documents from 'hospital_users' collection.
    """
    try:
        logger.info("Fetching all hospitals from hospital_users collection")

        cursor = database["hospital_users"].find({})
        hospitals_list = []

        async for hospital in cursor:
            hospitals_list.append(convert_mongo_document(hospital))

        logger.info("Total %d hospitals retrieved", len(hospitals_list))

        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="INFO",
            source={"service": "gateway", "component": "hospital"},
            actor={
                "type": current_user["role"], 
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/get_all_hospitals",
                "records_returned": len(hospitals_list)
            },
            clinical_context={},
            action={
                "type": "READ_HOSPITALS",
                "status": "SUCCESS"
            }
        ))


        return {
            "status": "success",
            "total_hospitals": len(hospitals_list),
            "hospitals": hospitals_list
        }

    except Exception as e:
        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="ERROR",
            source={"service": "gateway", "component": "hospital"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/get_all_hospitals",
            },
            clinical_context={},
            action={
                "type": "READ_HOSPITALS",
                "status": "FAILED",
                "reason": str(e)
            }
        ))
        logger.exception("Error fetching all hospitals: %s", str(e))
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

        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="INFO",
            source={"service": "gateway", "component": "doctor"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/get_all_doctors",
                "records_returned": len(doctors_list)
            },
            clinical_context={},
            action={
                "type": "READ_DOCTORS",
                "status": "SUCCESS"
            }
        ))


        return {
            "status": "success",
            "total_doctors": len(doctors_list),
            "doctors": doctors_list
        }

    except Exception as e:
        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="ERROR",
            source={"service": "gateway", "component": "doctor"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/get_all_doctors",
            },
            clinical_context={},
            action={
                "type": "READ_DOCTORS",
                "status": "FAILED",
                "reason": str(e)
            }
        ))
        logger.exception("Error fetching all doctors: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))



@router.get("/get_all_patients")
async def get_all_patients():
    """
    Fetch all documents from 'patient_users' collection.
    """
    try:
        logger.info("Fetching all patients from patient_users collection")

        cursor = database["patient_users"].find({})
        patients_list = []

        async for patient in cursor:
            patients_list.append(convert_mongo_document(patient))

        logger.info("Total %d patients retrieved", len(patients_list))

        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="CRITICAL",
            source={"service": "gateway", "component": "patient"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/get_all_patients",
                "records_returned": len(patients_list),
                "data_sensitivity": "PHI"
            },
            clinical_context={},
            action={
                "type": "READ_PATIENTS",
                "status": "SUCCESS",
                "scope": "ALL"
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
                "ip": get_client_ip(request),
                "endpoint": "/get_all_patients",
            },
            clinical_context={},
            action={
                "type": "READ_PATIENTS",
                "status": "FAILED",
                "reason": str(e)
            }
        ))
        logger.exception("Error fetching all patients: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))


#########################################################################DELETE ENDPOINTS#########################################################################



# -----------------------------------------
# DELETE ALL USERS
# -----------------------------------------
@router.delete("/delete_all_users")
async def delete_all_users(confirm: bool = False):
    """
    Delete ALL documents in user_auth collection.
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

        result = user_auth_collection.delete_many({})

        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="CRITICAL",
            source={"service": "gateway", "component": "user_management"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/delete_all_users",
                "confirmation": confirm
            },
            clinical_context={},
            action={
                "type": "DELETE_USERS",
                "status": "SUCCESS",
            }
        ))


        return {
            "status": "success",
            "message": f"Deleted {result.deleted_count} users from user_auth."
        }

    except Exception as e:
        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="ERROR",
            source={"service": "gateway", "component": "user_management"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/delete_all_users",
            },
            clinical_context={},
            action={
                "type": "DELETE_USERS",
                "status": "FAILED",
                "reason": str(e)
            }
        ))
        logger.exception("Error deleting all users: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/users/search")
async def search_users(
    request: Request,
    username: Optional[str] = None,
    email: Optional[str] = None,
    role: Optional[str] = None,
    status: Optional[str] = None,
    sys_user_id: Optional[str] = None,
    created_from: Optional[datetime] = None,
    created_to: Optional[datetime] = None,
    skip: int = 0,
    limit: int = Query(50, le=200),
):
    try:
        query = {}

        if username:
            query["username"] = {"$regex": username, "$options": "i"}

        if email:
            query["email"] = {"$regex": email, "$options": "i"}

        if role:
            query["role"] = role

        if status:
            query["status"] = status

        if sys_user_id:
            query["sys_user_id"] = sys_user_id

        if created_from or created_to:
            query["created_at"] = {}
            if created_from:
                query["created_at"]["$gte"] = created_from
            if created_to:
                query["created_at"]["$lte"] = created_to

        cursor = (
            database["user_auth"]
            .find(query, {"password": 0})
            .sort("created_at", -1)
            .skip(skip)
            .limit(limit)
        )

        users = []
        async for user in cursor:
            users.append(convert_mongo_document(user))

        total = await database["user_auth"].count_documents(query)

        return {
            "status": "success",
            "total": total,
            "skip": skip,
            "limit": limit,
            "users": users
        }

    except Exception as e:
        logger.exception("User search failed")
        raise HTTPException(status_code=500, detail="Failed to search users")




#Register System Admin

@router.post("/register-system-admin")
async def register_system_admin(
    request: Request,
    secret: str = Query(...)
):
    """
    One-time system admin creation.
    Protect with ADMIN_BOOTSTRAP_SECRET.
    """

    ADMIN_BOOTSTRAP_SECRET = os.getenv("ADMIN_BOOTSTRAP_SECRET")

    if secret != ADMIN_BOOTSTRAP_SECRET:
        raise HTTPException(status_code=403, detail="Invalid bootstrap secret")

    data = await request.json()

    username = data.get("username")
    password = data.get("password")
    email = data.get("email")

    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password required")

    existing = user_auth_collection.find_one({"username": username})
    if existing:
        raise HTTPException(status_code=409, detail="Admin already exists")

    sys_user_id = f"SYSADMIN-{uuid.uuid4()}"

    admin_user = {
        "sys_user_id": sys_user_id,
        "doctor_assist_id": "SYSTEM_ADMIN",
        "username": username,
        "password": hash_password(password),
        "email": email,
        "phone_number": "NA",
        "role": "system_admin",
        "user_type": "internal",
        "status": "active",
        "created_at": datetime.utcnow()
    }

    user_auth_collection.insert_one(admin_user)

    emit_audit(request.app, AuditEvent(
        timestamp=datetime.utcnow(),
        level="CRITICAL",
        source={"service": "gateway", "component": "bootstrap"},
        actor={"type": "system"},
        context={
            "ip": get_client_ip(request),
            "endpoint": "/register-system-admin"
        },
        clinical_context={},
        action={
            "type": "CREATE_SYSTEM_ADMIN",
            "status": "SUCCESS"
        }
    ))

    return {
        "status": "success",
        "message": "System admin created successfully",
        "sys_user_id": sys_user_id
    }
