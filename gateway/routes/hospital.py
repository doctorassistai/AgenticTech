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
# from .gateway.middlewares.encryption import EncryptionService
from shared.audit.schema import AuditEvent
from shared.audit.utils import emit_audit
from gateway.core.config import SECRET_KEY, ALGORITHM
from gateway.middlewares.models import Users, Hospital, ClinicUserSource
from gateway.middlewares.utils import get_client_ip



router = APIRouter(
    prefix="/hms/users/hospitals",
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

mongodb_client = AsyncIOMotorClient(MONGO_URI)  # async (Motor)
database = mongodb_client[MONGO_DB]

client = MongoClient(MONGO_URI)  # sync (PyMongo)
db = client[MONGO_DB]

user_auth_collection = db["user_auth"]

hospital_user_collection = db["hospital_users"]

doctor_user_collection = db["doctor_users"]

patient_user_collection = db["patient_users"]

patient_appointments_collection = db["patient_appointments"]

clinic_user_source_collection = database["clinic_user_source"]

report_rule_collection = database["report_rule"]

hospital_report_rule_collection = database["hospital_report_rules"]

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


#################################################################################PATIENT REGISTERATION TEST STARTS#################################################################################

# important should remove later
current_user = {}
current_user["sys_user_id"] = "rem_unknown_id"
current_user["role"] = "rem_unknown_type"


################################################################################PATIENT REGISTERATION TEST ENDS#################################################################################



def generate_random_string(length=10):
    return ''.join(random.choices(string.ascii_letters + string.digits, k=length))

def generate_hospital_id():
    return f"HSP-{uuid.uuid4()}"

def hash_password(password: str):
    return pwd_context.hash(password)

def convert_mongo_document(doc):
    if not doc:
        return doc
    doc["_id"] = str(doc["_id"])
    return doc


def get_current_user(request: Request):
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        sys_user_id = payload.get("sub")
        role = payload.get("role")

        if not sys_user_id or not role:
            raise HTTPException(status_code=401, detail="Invalid token")

        user = user_auth_collection.find_one({"sys_user_id": sys_user_id})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")

        return user

    except JWTError:
        raise HTTPException(status_code=401, detail="Token expired or invalid")


def require_hospital(current_user: dict = Depends(get_current_user)):
    if current_user["role"] not in ["hospital", "clinic"]:
        raise HTTPException(
            status_code=403,
            detail="Only hospitals can access this resource"
        )
    return current_user


def get_logged_in_hospital(
    current_user: dict = Depends(require_hospital)
):
    hospital = hospital_user_collection.find_one(
        {"sys_user_id": current_user["sys_user_id"]}
    )

    if not hospital:
        raise HTTPException(status_code=404, detail="Hospital profile not found")

    return hospital


@router.get("/verify")
async def verify_hospital(
    request: Request,
    hospital=Depends(get_logged_in_hospital),
    current_user=Depends(get_current_user),
):

    emit_audit(request.app, AuditEvent(
        timestamp=datetime.utcnow(),
        level="INFO",
        source={"service": "gateway", "component": "hospital_route"},
        actor={
            "type": current_user["role"],
            "id": current_user["sys_user_id"]
        },
        context={
            "trace_id": request.state.trace_id,
            "ip": get_client_ip(request),
            "endpoint": "/hms/users/hospitals/verify"
        },
        clinical_context={
            "data_sensitivity": "PHI",
        },
        action={
            "type": "VERIFY_HOSPITAL",
            "status": "SUCCESS",
            "hospital_id": current_user["sys_user_id"]
        }
    ))
    return {
        "status": "authenticated",
        "user": {
            "sys_user_id": current_user["sys_user_id"],
            "role": current_user["role"]
        },
        "hospital": {
            "sys_user_id": hospital["sys_user_id"],
            "name": hospital["name"]
        }
    }


@router.post("/hospitaladd")
async def hospital_add_post(request: Request, current_user: dict = Depends(get_current_user)):
    """
    Create a Hospital Admin and insert into both MongoDB collections.
    hospital_id is auto-generated using UUID: HSP-<uuid4>.
    """
    try:
        data = await request.json()

        logger.info("Hospital Admin Registration Started")
        
        username = data["username"]
        email = data.get("email") or None
        phone = data["phone_number"]


        existing_username = user_auth_collection.find_one({"username": username})
        if existing_username:
            emit_audit(request.app, AuditEvent(
                timestamp=datetime.utcnow(),
                level="ERROR",
                source={"service": "gateway", "component": "hospital_route"},
                actor={
                    "type": current_user["role"],
                    "id": current_user["sys_user_id"]
                },
                context={
                    "trace_id": request.state.trace_id,
                    "ip": get_client_ip(request),
                    "endpoint": "/hms/users/hospitals/hospitaladd"
                },
                clinical_context={
                    "data_sensitivity": "PHI",
                },
                action={
                    "type": "CREATE_HOSPITAL",
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
                    source={"service": "gateway", "component": "hospital_route"},
                    actor={
                        "type": current_user["role"],
                        "id": current_user["sys_user_id"]
                    },
                    context={
                        "trace_id": request.state.trace_id,
                        "ip": get_client_ip(request),
                        "endpoint": "/hms/users/hospitals/hospitaladd"
                    },
                    clinical_context={
                        "data_sensitivity": "PHI",
                    },
                    action={
                        "type": "CREATE_HOSPITAL",
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

        existing_phone = None

        # Check if the phone number is neither None nor an empty string
        if phone not in [None, ""]:
            existing_phone = user_auth_collection.find_one({"phone_number": phone})

        # Proceed with the rest of the logic only if the phone exists and is not empty or None
        if existing_phone:
            emit_audit(request.app, AuditEvent(
                timestamp=datetime.utcnow(),
                level="ERROR",
                source={"service": "gateway", "component": "hospital_route"},
                actor={
                    "type": current_user["role"],
                    "id": current_user["sys_user_id"]
                },
                context={
                    "trace_id": request.state.trace_id,
                    "ip": get_client_ip(request),
                    "endpoint": "/hms/users/hospitals/hospitaladd"
                },
                clinical_context={
                    "data_sensitivity": "PHI",
                },
                action={
                    "type": "CREATE_HOSPITAL",
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

        sys_user_id = generate_hospital_id()
        doctor_assist_id = generate_random_string()
        logger.info(f"RAW PASSWORD RECEIVED: {data['password']} - LENGTH: {len(data['password'])}")

        hashed_pw = hash_password(data["password"])
        created_at = data.get("created_at", datetime.now())
        # ---- 1️⃣ Create Hospital Model Object ----
        hospital_obj = Hospital(
            name=data["name"],
            address=data.get("address"),
            headquarters=data.get("headquarters"),
            username=data["username"],
            hospital_id=doctor_assist_id,      # Auto-generated UUID ID
            sys_user_id=sys_user_id,
            email=data.get("email") or None,
            phone_number=data["phone_number"],
            no_of_staff=data["no_of_staff"],
            no_of_beds=data["no_of_beds"],
            country_code=data["country_code"],
            hospital_user_type=data["hospital_user_type"],
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
            role="hospital",
            user_type="first_account",
            status="active",
            created_at=created_at,
            renewed_at=created_at
        )

        # ---- 4️⃣ Insert into MongoDB ----
        hospital_user_collection.insert_one(hospital_obj.model_dump())
        user_auth_collection.insert_one(user_obj.model_dump())

        # ---- 4️⃣ Copy all report rules for this hospital ----
        try:
            # Get all rules from master collection - CORRECT WAY for Motor
            master_rules = await report_rule_collection.find({}).to_list(length=None)
            
            if master_rules:
                # Prepare hospital-specific rules
                hospital_rules = []
                for rule in master_rules:
                    hospital_rule = {
                        "hospital_id": sys_user_id,
                        "category": rule.get("category"),
                        "subcategory": rule.get("subcategory"),
                        "values": rule.get("values", []),
                        "rule_text": rule.get("rule_text", ""),
                        "created_at": datetime.now(),
                        "source_rule_id": str(rule.get("_id"))
                    }
                    hospital_rules.append(hospital_rule)
                
                # Insert all hospital rules
                if hospital_rules:
                    await hospital_report_rule_collection.insert_many(hospital_rules)
                    logger.info(f"Successfully copied {len(hospital_rules)} rules for hospital {sys_user_id}")
            else:
                logger.info(f"No master rules found to copy for hospital {sys_user_id}")
                
        except Exception as rule_error:
            logger.error(f"Failed to copy report rules for hospital {sys_user_id}: {str(rule_error)}")
        
        logger.info("Hospital Admin and User Auth inserted successfully")

        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="INFO",
            source={"service": "gateway", "component": "hospital_route"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/hms/users/hospitals/hospitaladd"
            },
            clinical_context={
                "data_sensitivity": "PHI",
            },
            action={
                "type": "CREATE_HOSPITAL",
                "status": "SUCCESS",
                "hospital_id": sys_user_id
            }
        ))

        return {
            "status": "success",
            "message": "Hospital Admin registered successfully.",
            "hospital_id": sys_user_id
        }

    except Exception as e:
        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="ERROR",
            source={"service": "gateway", "component": "hospital_route"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/hms/users/hospitals/hospitaladd"
            },
            clinical_context={
                "data_sensitivity": "PHI",
            },
            action={
                "type": "CREATE_HOSPITAL",
                "status": "FAILED",
                "reason": str(e)
            }
        ))
        logger.exception("Hospital Admin Creation Failed: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")



@router.delete("/delete_all_hospitals")
async def delete_all_hospitals(confirm: bool = False):
    """
    Delete ALL documents in hospital_users collection.
    Must pass ?confirm=true to allow deletion.
    """
    try:
        if not confirm:
            emit_audit(request.app, AuditEvent(
                timestamp=datetime.utcnow(),
                level="WARNING",
                source={"service": "gateway", "component": "hospital_route"},
                actor={
                    "type": current_user["role"],
                    "id": current_user["sys_user_id"]
                },
                context={
                    "trace_id": request.state.trace_id,
                    "ip": get_client_ip(request),
                    "endpoint": "/hms/users/hospitals/delete_all_hospitals"
                },
                clinical_context={
                    "data_sensitivity": "PHI",
                },
                action={
                    "type": "DELETE_ALL_HOSPITALS",
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

        result = hospital_user_collection.delete_many({})
        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="INFO",
            source={"service": "gateway", "component": "hospital_route"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/hms/users/hospitals/delete_all_hospitals"
            },
            clinical_context={
                "data_sensitivity": "PHI",
            },
            action={
                "type": "DELETE_ALL_HOSPITALS",
                "status": "SUCCESS",
                "deleted_count": result.deleted_count
            }
        ))

        return {
            "status": "success",
            "message": f"Deleted {result.deleted_count} hospitals from hospital_users."
        }

    except Exception as e:
        logger.exception("Error deleting all hospitals: %s", str(e))
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
            source={"service": "gateway", "component": "hospital_route"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/hms/users/hospitals/get_all_hospitals"
            },
            clinical_context={
                "data_sensitivity": "PHI",
            },
            action={
                "type": "GET_ALL_HOSPITALS",
                "status": "SUCCESS",
                "total_hospitals": len(hospitals_list)
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
            source={"service": "gateway", "component": "hospital_route"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/hms/users/hospitals/get_all_hospitals"
            },
            clinical_context={
                "data_sensitivity": "PHI",
            },
            action={
                "type": "GET_ALL_HOSPITALS",
                "status": "FAILED",
                "reason": str(e)
            }
        ))
        logger.exception("Error fetching all hospitals: %s", str(e))
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
            source={"service": "gateway", "component": "hospital_route"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/hms/users/hospitals/get_all_hospitals"
            },
            clinical_context={
                "data_sensitivity": "PHI",
            },
            action={
                "type": "GET_ALL_HOSPITALS",
                "status": "SUCCESS",
                "total_hospitals": len(hospitals_list)
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
            source={"service": "gateway", "component": "hospital_route"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/hms/users/hospitals/get_all_hospitals"
            },
            clinical_context={
                "data_sensitivity": "PHI",
            },
            action={
                "type": "GET_ALL_HOSPITALS",
                "status": "FAILED",
                "reason": str(e)
            }
        ))
        logger.exception("Error fetching all hospitals: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/delete_all_hospitals")
async def delete_all_hospitals(confirm: bool = False):
    """
    Delete ALL documents in hospital_users collection.
    Must pass ?confirm=true to allow deletion.
    """
    try:
        if not confirm:
            emit_audit(request.app, AuditEvent(
                timestamp=datetime.utcnow(),
                level="WARNING",
                source={"service": "gateway", "component": "hospital_route"},
                actor={
                    "type": current_user["role"],
                    "id": current_user["sys_user_id"]
                },
                context={
                    "trace_id": request.state.trace_id,
                    "ip": get_client_ip(request),
                    "endpoint": "/hms/users/hospitals/delete_all_hospitals"
                },
                clinical_context={
                    "data_sensitivity": "PHI",
                },
                action={
                    "type": "DELETE_ALL_HOSPITALS",
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

        result = hospital_user_collection.delete_many({})

        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="INFO",
            source={"service": "gateway", "component": "hospital_route"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/hms/users/hospitals/delete_all_hospitals"
            },
            clinical_context={
                "data_sensitivity": "PHI",
            },
            action={
                "type": "DELETE_ALL_HOSPITALS",
                "status": "SUCCESS",
                "deleted_count": result.deleted_count
            }
        ))

        return {
            "status": "success",
            "message": f"Deleted {result.deleted_count} hospitals from hospital_users."
        }

    except Exception as e:
        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="ERROR",
            source={"service": "gateway", "component": "hospital_route"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": request.state.trace_id,
                "ip": get_client_ip(request),
                "endpoint": "/hms/users/hospitals/delete_all_hospitals"
            },
            clinical_context={
                "data_sensitivity": "PHI",
            },
            action={
                "type": "DELETE_ALL_HOSPITALS",
                "status": "FAILED",
                "reason": str(e)
            }
        ))
        logger.exception("Error deleting all hospitals: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))




#################Add clinical user#####################

# @router.post("/clinicaluseradd")
# async def clinical_user_add_post(request: Request, current_user: dict = Depends(get_current_user)):
#     logger.info("Clinical User Registration Started")
#     logger.info("Current User: %s", current_user)
#     """
#     Create a Clinical User and insert into both MongoDB collections.
#     hospital_id is auto-generated using UUID: HSP-<uuid4>.
#     """
#     try:
#         data = await request.json()

#         logger.info("clinical Admin Registration Started")
        
#         username = data["username"]
#         email = data.get("email") or None
#         phone = data["phone_number"]


#         existing_username = user_auth_collection.find_one({"username": username})
#         if existing_username:
#             emit_audit(request.app, AuditEvent(
#                 timestamp=datetime.utcnow(),
#                 level="ERROR",
#                 source={"service": "gateway", "component": "hospital_route"},
#                 actor={
#                     "type": current_user["role"],
#                     "id": current_user["sys_user_id"]
#                 },
#                 context={
#                     "trace_id": request.state.trace_id,
#                     "ip": get_client_ip(request),
#                     "endpoint": "/hms/users/hospitals/clinicaluseradd"
#                 },
#                 clinical_context={
#                     "data_sensitivity": "PHI",
#                 },
#                 action={
#                     "type": "CREATE_CLINICAL_USER",
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
#                     source={"service": "gateway", "component": "hospital_route"},
#                     actor={
#                         "type": current_user["role"],
#                         "id": current_user["sys_user_id"]
#                     },
#                     context={
#                         "trace_id": request.state.trace_id,
#                         "ip": get_client_ip(request),
#                         "endpoint": "/hms/users/hospitals/hospitaladd"
#                     },
#                     clinical_context={
#                         "data_sensitivity": "PHI",
#                     },
#                     action={
#                         "type": "CREATE_HOSPITAL",
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
#                 source={"service": "gateway", "component": "hospital_route"},
#                 actor={
#                     "type": current_user["role"],
#                     "id": current_user["sys_user_id"]
#                 },
#                 context={
#                     "trace_id": request.state.trace_id,
#                     "ip": get_client_ip(request),
#                     "endpoint": "/hms/users/hospitals/hospitaladd"
#                 },
#                 clinical_context={
#                     "data_sensitivity": "PHI",
#                 },
#                 action={
#                     "type": "CREATE_HOSPITAL",
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

#         sys_user_id = generate_hospital_id()
#         doctor_assist_id = generate_random_string()
#         logger.info(f"RAW PASSWORD RECEIVED: {data['password']} - LENGTH: {len(data['password'])}")

#         hashed_pw = hash_password(data["password"])
#         created_at = data.get("created_at", datetime.now())
#         # ---- 1️⃣ Create Hospital Model Object ----
#         hospital_obj = Hospital(
#             name=data["name"],
#             address=data.get("address"),
#             headquarters=data.get("headquarters"),
#             username=data["username"],
#             hospital_id=doctor_assist_id,      # Auto-generated UUID ID
#             sys_user_id=sys_user_id,
#             email=data.get("email") or None,
#             phone_number=data["phone_number"],
#             no_of_staff=data["no_of_staff"],
#             no_of_beds=data["no_of_beds"],
#             country_code=data["country_code"],
#             hospital_user_type=data["hospital_user_type"],
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
#             role="clinic",
#             user_type="first_account",
#             status="active",
#             created_at=created_at,
#             renewed_at=created_at
#         )

#         # ---- 4️⃣ Insert into MongoDB ----
#         hospital_user_collection.insert_one(hospital_obj.model_dump())
#         user_auth_collection.insert_one(user_obj.model_dump())

#         logger.info("Clinical Admin and User Auth inserted successfully")

#         emit_audit(request.app, AuditEvent(
#             timestamp=datetime.utcnow(),
#             level="INFO",
#             source={"service": "gateway", "component": "hospital_route"},
#             actor={
#                 "type": current_user["role"],
#                 "id": current_user["sys_user_id"]
#             },
#             context={
#                 "trace_id": request.state.trace_id,
#                 "ip": get_client_ip(request),
#                 "endpoint": "/hms/users/hospitals/clinicaluseradd"
#             },
#             clinical_context={
#                 "data_sensitivity": "PHI",
#             },
#             action={
#                 "type": "CREATE_Clinic",
#                 "status": "SUCCESS",
#                 "hospital_id": sys_user_id
#             }
#         ))

#         return {
#             "status": "success",
#             "message": "Clinical Admin registered successfully.",
#             "hospital_id": sys_user_id
#         }

#     except Exception as e:
#         emit_audit(request.app, AuditEvent(
#             timestamp=datetime.utcnow(),
#             level="ERROR",
#             source={"service": "gateway", "component": "hospital_route"},
#             actor={
#                 "type": current_user["role"],
#                 "id": current_user["sys_user_id"]
#             },
#             context={
#                 "trace_id": request.state.trace_id,
#                 "ip": get_client_ip(request),
#                 "endpoint": "/hms/users/hospitals/clinicaluseradd"
#             },
#             clinical_context={
#                 "data_sensitivity": "PHI",
#             },
#             action={
#                 "type": "CREATE_HOSPITAL",
#                 "status": "FAILED",
#                 "reason": str(e)
#             }
#         ))
#         logger.exception("Hospital Admin Creation Failed: %s", str(e))
#         raise HTTPException(status_code=500, detail=f"Error: {str(e)}")



######################Clinical add without auth##########################

@router.post("/clinicaluseradd")
async def clinical_user_add_post(request: Request):
    logger.info("Clinical User Registration Started")
    """
    Create a Clinical User and insert into both MongoDB collections.
    hospital_id is auto-generated using UUID: HSP-<uuid4>.
    """
    try:
        data = await request.json()

        logger.info("Clinical Admin Registration Started")
        
        username = data["username"]
        email = data.get("email") or None
        phone = data["phone_number"]
        source = data["source"]  # Get source from request data

        existing_username = user_auth_collection.find_one({"username": username})
        if existing_username:
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
                return JSONResponse(
                    status_code=400,
                    content={
                        "status": "error",
                        "message": f"Email '{email}' already exists"
                    }
                )

        existing_phone = user_auth_collection.find_one({"phone_number": phone})
        if existing_phone:
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

        sys_user_id = generate_hospital_id()
        doctor_assist_id = generate_random_string()
        logger.info(f"RAW PASSWORD RECEIVED: {data['password']} - LENGTH: {len(data['password'])}")

        hashed_pw = hash_password(data["password"])
        created_at = data.get("created_at", datetime.now())
        
        # ---- 1️⃣ Create Hospital Model Object ----
        hospital_obj = Hospital(
            name=data["name"],
            address=data.get("address"),
            headquarters=data.get("headquarters"),
            username=data["username"],
            hospital_id=doctor_assist_id,      # Auto-generated UUID ID
            sys_user_id=sys_user_id,
            email=data.get("email") or None,
            phone_number=data["phone_number"],
            no_of_staff=data["no_of_staff"],
            no_of_beds=data["no_of_beds"],
            country_code=data["country_code"],
            hospital_user_type=data["hospital_user_type"],
            created_at=created_at
        )

        # ---- 2️⃣ Create Users Model Object ----
        user_obj = Users(
            sys_user_id=sys_user_id,
            doctor_assist_id=doctor_assist_id,
            email=data.get("email") or None,
            phone_number=data["phone_number"],
            username=data["username"],
            password=hashed_pw,
            role="clinic",
            user_type="first_account",
            status="active",
            created_at=created_at,
            renewed_at=created_at
        )

        # ---- 3️⃣ Create Clinic User Source Model Object ----
        clinic_source_obj = ClinicUserSource(
            # Replicating hospital_obj structure and adding source field
            name=data["name"],
            address=data.get("address"),
            headquarters=data.get("headquarters"),
            username=data["username"],
            hospital_id=doctor_assist_id,      # Auto-generated UUID ID
            sys_user_id=sys_user_id,
            email=data.get("email") or None,
            phone_number=data["phone_number"],
            no_of_staff=data["no_of_staff"],
            no_of_beds=data["no_of_beds"],
            country_code=data["country_code"],
            hospital_user_type=data["hospital_user_type"],
            created_at=created_at,
            source=source  # The additional source field
        )

        # ---- 4️⃣ Insert into MongoDB ----
        hospital_user_collection.insert_one(hospital_obj.model_dump())
        user_auth_collection.insert_one(user_obj.model_dump())
        clinic_user_source_collection.insert_one(clinic_source_obj.model_dump())  # Insert into new collection

        logger.info("Clinical Admin, User Auth, and Clinic Source inserted successfully")

        return {
            "status": "success",
            "message": "Clinical Admin registered successfully.",
            "hospital_id": sys_user_id
        }

    except Exception as e:
        logger.exception("Hospital Admin Creation Failed: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")



@router.get("/clinicusersource", response_model=List[dict])
async def get_all_clinic_user_sources():
    """
    Retrieve all clinic user source data from the clinic_user_source_collection.
    """
    try:
        # Query the clinic_user_source_collection to get all entries
        clinic_source_data_cursor = clinic_user_source_collection.find()

        # Convert the cursor to a list of dictionaries
        clinic_source_data = await clinic_source_data_cursor.to_list(length=None)

        if not clinic_source_data:
            raise HTTPException(
                status_code=404,
                detail="No clinic user source data found"
            )

        # Convert ObjectId to string for JSON serialization if necessary
        for record in clinic_source_data:
            record["_id"] = str(record["_id"])

        return clinic_source_data

    except Exception as e:
        logger.exception("Error fetching clinic user source data: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")
