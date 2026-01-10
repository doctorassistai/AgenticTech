from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, WebSocket, status, File, Form, UploadFile
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, WebSocket, status, File, Form, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse, FileResponse
# from fastapi.templating import Jinja2Templates
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


class PatientVitals(BaseModel):
    sys_user_id: str
    appointment_id: Optional[str] = None
    vitals: Dict[str, Dict[str, Any]]

class ConsultationPayload(BaseModel):
    doctor_id: str
    patient_id: str
    dictation: Optional[str] = ""
    features: List[Dict[str, Any]]
    timestamp: str



MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

mongodb_client = AsyncIOMotorClient(MONGO_URI)  # async (Motor)
database = mongodb_client[MONGO_DB]

client = MongoClient(MONGO_URI)  # sync (PyMongo)
db = client[MONGO_DB]


patient_user_collection = db["patient_users"]

patient_appointments_collection = db["patient_appointments"]

patient_vitals_collection = database["patient_vitals"]

patient_reports_collection = database["patient_report_documents"]

patient_consultation_collection = database["patient_consultations"]



@router.get("/patient_basic_screening_details/{patient_id}/{doctor_id}")
async def get_patient_basic_demographics(patient_id: str, doctor_id: str):
    """
    Fetch basic demographic details of a patient
    + today's latest appointment for a given doctor
    """
    try:
        if not patient_id or not doctor_id:
            raise HTTPException(
                status_code=400,
                detail="patient_id and doctor_id are required."
            )

        # 🧍‍♂️ Patient Demographics
        patient = patient_user_collection.find_one(
            {"sys_user_id": patient_id},
            {"_id": 0, "name": 1, "date_of_birth": 1, "patient_id": 1, "gender": 1}
        )

        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found.")

        # 📅 Today's date (UTC)
        today = datetime.utcnow().strftime("%Y-%m-%d")

        # 📄 Appointment document
        appt_doc = patient_appointments_collection.find_one(
            {"sys_user_id": patient_id},
            {"_id": 0, "appointments": 1}
        )

        latest_appointment = None

        if appt_doc and appt_doc.get("appointments"):
            # 🎯 Filter ONLY today's appointment for this doctor
            todays_appointments = [
                appt for appt in appt_doc["appointments"]
                if appt.get("doctor_id") == doctor_id
                and appt.get("date") == today
            ]

            if todays_appointments:
                # 🕒 Latest update today
                todays_appointments.sort(
                    key=lambda x: x.get("updated_at", datetime.min),
                    reverse=True
                )
                latest_appointment = todays_appointments[0]

        response_payload = {
            "status": "success",
            "data": {
                "demographics": patient,
                "today_latest_appointment": latest_appointment
            }
        }

        return JSONResponse(
            status_code=200,
            content=jsonable_encoder(response_payload)
        )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error fetching today's appointment")
        raise HTTPException(status_code=500, detail="Internal server error.")


@router.post("/save_patient_vitals")
async def save_patient_vitals(payload: PatientVitals):
    sys_user_id = payload.sys_user_id
    appointment_id = payload.appointment_id
    vitals = payload.vitals

    if not vitals:
        raise HTTPException(status_code=400, detail="Vitals cannot be empty")

    # 🔍 Fetch patient_id using sys_user_id
    patient = patient_user_collection.find_one(
        {"sys_user_id": sys_user_id},
        {"_id": 0, "patient_id": 1}
    )

    if not patient:
        raise HTTPException(status_code=400, detail="No patient found in the system")

    patient_id = patient["patient_id"]

    # 🔒 Mongo-safe datetime keys
    update_fields = {}
    for timestamp, data in vitals.items():
        safe_timestamp = timestamp.replace(".", "_")
        update_fields[f"vitals.{safe_timestamp}"] = data

    update_doc = {
        "$set": {
            **update_fields,
            "appointment_id": appointment_id
        },
        "$setOnInsert": {
            "sys_user_id": sys_user_id,
            "patient_id": patient_id
        },
        "$currentDate": {"updated_at": True}
    }

    await patient_vitals_collection.update_one(
        {"sys_user_id": sys_user_id},
        update_doc,
        upsert=True
    )


    return {
        "status": "success",
        "sys_user_id": sys_user_id,
        "patient_id": patient_id,
        "appointment_id": payload.appointment_id,
        "stored_timestamps": list(update_fields.keys())
    }



@router.get("/get_patient_vitals/{sys_user_id}")
async def get_patient_vitals(sys_user_id: str):
    """
    Retrieve patient vitals EXACTLY as stored in DB
    """

    vitals_doc = await patient_vitals_collection.find_one(
        {"sys_user_id": sys_user_id},
        {"_id": 0}  # exclude MongoDB _id only
    )

    if not vitals_doc:
        raise HTTPException(
            status_code=404,
            detail=f"No vitals found for sys_user_id={sys_user_id}"
        )

    # ✅ RETURN RAW DOCUMENT (NO WRAPPING)
    return vitals_doc




@router.delete("/delete_all_vitals")
async def delete_all_vitals(confirm: bool = False):
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

        result = await patient_vitals_collection.delete_many({})

        return {
            "status": "success",
            "message": f"Deleted {result.deleted_count} appointments from patient_appointments."
        }

    except Exception as e:
        logger.exception("Error deleting all vitals: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))



@router.get("/documents_patient_retrieval/{patient_id}")
async def get_patient_documents(patient_id: str):
    """
    Retrieve all uploaded documents for a given patient_id
    """

    try:
        cursor = database["patient_report_documents"].find(
            {"patient_id": patient_id},
            {"_id": 0}  # Exclude MongoDB _id
        )

        # ✅ Motor async cursor → use to_list()
        documents = await cursor.to_list(length=None)

        return {
            "status": "success",
            "patient_id": patient_id,
            "total_documents": len(documents),
            "documents": documents
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch patient documents: {str(e)}"
        )



@router.get("/documents_patient_retrieval_by_type/{patient_id}/{doc_type}")
async def get_patient_documents_by_type(patient_id: str, doc_type: str):
    """
    Retrieve all uploaded documents for a given patient_id filtered by document type
    """

    try:
        cursor = database["patient_report_documents"].find(
            {
                "patient_id": patient_id,
                "type": doc_type
            },
            {"_id": 0}  # Exclude MongoDB _id
        )

        documents = await cursor.to_list(length=None)

        return {
            "status": "success",
            "patient_id": patient_id,
            "type": doc_type,
            "total_documents": len(documents),
            "documents": documents
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch patient documents by type: {str(e)}"
        )



@router.post("/patient_save_consultation")
async def patient_save_consultation(payload: ConsultationPayload):
    doctor_id = payload.doctor_id
    patient_id = payload.patient_id

    if not payload.features:
        raise HTTPException(
            status_code=400,
            detail="features cannot be empty"
        )

    # 🔥 BACKEND-GENERATED UNIQUE TIMESTAMP (APPEND GUARANTEED)
    stored_at = datetime.now(timezone.utc).isoformat()
    safe_timestamp = stored_at.replace(".", "_")

    consultation_entry = {
        "timestamp": payload.timestamp,     # frontend timestamp (optional)
        "stored_at": stored_at,              # backend timestamp (KEY SOURCE)
        "dictation": payload.dictation,
        "data": payload.features             # 👈 EXACTLY AS RECEIVED
    }

    await patient_consultation_collection.update_one(
        {
            "doctor_id": doctor_id,
            "patient_id": patient_id
        },
        {
            "$set": {
                f"consultations.{safe_timestamp}": consultation_entry
            },
            "$setOnInsert": {
                "doctor_id": doctor_id,
                "patient_id": patient_id,
                "created_at": datetime.utcnow()
            },
            "$currentDate": {
                "updated_at": True
            }
        },
        upsert=True
    )

    return {
        "status": "success",
        "doctor_id": doctor_id,
        "patient_id": patient_id,
        "stored_at": stored_at
    }

@router.get("/get_saved_consultations/{doctor_id}/{patient_id}")
async def get_saved_consultations(doctor_id: str, patient_id: str):
    doc = await patient_consultation_collection.find_one(
        {
            "doctor_id": doctor_id,
            "patient_id": patient_id
        },
        {"_id": 0}
    )

    if not doc:
        raise HTTPException(
            status_code=404,
            detail="No consultations found"
        )

    return doc




@router.delete("/delete_all_consultation")
async def delete_all_consultation(confirm: bool = False):
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

        result = await patient_consultation_collection.delete_many({})

        return {
            "status": "success",
            "message": f"Deleted {result.deleted_count} consultation from patient_consultations."
        }

    except Exception as e:
        logger.exception("Error deleting all vitals: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))

