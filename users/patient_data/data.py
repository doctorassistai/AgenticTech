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
from collections import defaultdict
from dotenv import load_dotenv
import os

load_dotenv()
api_base_url = os.getenv("VITE_BACKEND_URL")


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
    appointment_id: str
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

doctor_user_collection = database["doctor_users"]

tumor_board_collection = database["tumor_board_cases"]

doctor_referrals_collection = database["doctor_referrals"]


patient_images_collection = database["patient_images"]



# @router.get("/patient_basic_screening_details/{patient_id}/{doctor_id}")
# async def get_patient_basic_demographics(patient_id: str, doctor_id: str):
#     """
#     Fetch basic demographic details of a patient
#     + today's latest appointment for a given doctor
#     """
#     try:
#         if not patient_id or not doctor_id:
#             raise HTTPException(
#                 status_code=400,
#                 detail="patient_id and doctor_id are required."
#             )

#         # 🧍‍♂️ Patient Demographics
#         patient = patient_user_collection.find_one(
#             {"sys_user_id": patient_id},
#             {"_id": 0, "name": 1, "date_of_birth": 1, "patient_id": 1, "gender": 1}
#         )

#         if not patient:
#             raise HTTPException(status_code=404, detail="Patient not found.")

#         # 📅 Today's date (UTC)
#         today = datetime.utcnow().strftime("%Y-%m-%d")

#         # 📄 Appointment document
#         appt_doc = patient_appointments_collection.find_one(
#             {"sys_user_id": patient_id},
#             {"_id": 0, "appointments": 1}
#         )

#         latest_appointment = None

#         if appt_doc and appt_doc.get("appointments"):
#             # 🎯 Filter ONLY today's appointment for this doctor
#             todays_appointments = [
#                 appt for appt in appt_doc["appointments"]
#                 if appt.get("doctor_id") == doctor_id
#                 and appt.get("date") == today
#             ]

#             if todays_appointments:
#                 # 🕒 Latest update today
#                 todays_appointments.sort(
#                     key=lambda x: x.get("updated_at", datetime.min),
#                     reverse=True
#                 )
#                 latest_appointment = todays_appointments[0]

#         response_payload = {
#             "status": "success",
#             "data": {
#                 "demographics": patient,
#                 "today_latest_appointment": latest_appointment
#             }
#         }

#         return JSONResponse(
#             status_code=200,
#             content=jsonable_encoder(response_payload)
#         )

#     except HTTPException:
#         raise
#     except Exception:
#         logger.exception("Error fetching today's appointment")
#         raise HTTPException(status_code=500, detail="Internal server error.")




@router.get("/patient_basic_screening_details/{patient_id}/{doctor_id}")
async def get_patient_basic_demographics(patient_id: str, doctor_id: str):
    """
    Fetch basic demographic details of a patient
    + latest appointment for a given doctor
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

        # 📄 Appointment document
        appt_doc = patient_appointments_collection.find_one(
            {"sys_user_id": patient_id},
            {"_id": 0, "appointments": 1}
        )

        latest_appointment = None

        if appt_doc and appt_doc.get("appointments"):
            # 🎯 Filter appointments for this doctor
            doctor_appointments = [
                appt for appt in appt_doc["appointments"]
                if appt.get("doctor_id") == doctor_id
            ]

            if doctor_appointments:
                # 🕒 Latest update
                doctor_appointments.sort(
                    key=lambda x: x.get("updated_at", datetime.min),
                    reverse=True
                )
                latest_appointment = doctor_appointments[0]

        response_payload = {
            "status": "success",
            "data": {
                "demographics": patient,
                "latest_appointment": latest_appointment
            }
        }

        return JSONResponse(
            status_code=200,
            content=jsonable_encoder(response_payload)
        )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error fetching appointment")
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
    
    # ✅ VALIDATE APPOINTMENT EXISTS
    if not appointment_id:
        raise HTTPException(status_code=400, detail="appointment_id is required")
    
    appointment_doc = patient_appointments_collection.find_one(
        {
            "sys_user_id": sys_user_id,
            "appointments.appointment_id": appointment_id
        },
        {"_id": 0, "appointments.$": 1}
    )
    
    if not appointment_doc:
        raise HTTPException(
            status_code=404,
            detail=f"Appointment with ID '{appointment_id}' not found for this patient"
        )
    
    appointment_details = appointment_doc["appointments"][0]

    # ==========================================================
    # 1️⃣ PREPARE DATA FOR FEATURE CONTEXT LLM
    # ==========================================================
    latest_timestamp = max(vitals.keys())
    latest_vitals = vitals[latest_timestamp]

    doctor_id = latest_vitals.get("doctor_id")
    
    # ✅ Verify doctor matches appointment
    if doctor_id != appointment_details.get("doctor_id"):
        raise HTTPException(
            status_code=403,
            detail=f"Doctor ID {doctor_id} does not match appointment's doctor {appointment_details.get('doctor_id')}"
        )

    feature_payload = {
        "patient_id": sys_user_id,
        "doctor_id": doctor_id,
        "feature_id": "current-vitals-context",  # ✅ constant
        "new_data": {
            "timestamp": latest_timestamp,
            "vitals": latest_vitals
        }
    }

    # ==========================================================
    # 2️⃣ LOGGER — EXACT DATA BEING SENT
    # ==========================================================
    logger.info(
        "Sending vitals to feature context LLM",
        extra={
            "endpoint": "process_feature_context_llm",
            "payload": feature_payload
        }
    )

    # ==========================================================
    # 3️⃣ CALL FEATURE CONTEXT LLM ENDPOINT
    # ==========================================================
    async with httpx.AsyncClient(timeout=10.0) as client:
        llm_response = await client.post(
            f"{api_base_url}hms/users/data/context/process_feature_context_llm",
            json=feature_payload
        )

    if llm_response.status_code != 200:
        logger.error(
            "Feature context LLM failed",
            extra={
                "status_code": llm_response.status_code,
                "response": llm_response.text
            }
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to process vitals context"
        )


    # 🔒 Mongo-safe datetime keys
    # 🔒 Mongo-safe datetime keys
    update_fields = {}
    for timestamp, data in vitals.items():
        safe_timestamp = timestamp.replace(".", "_")
        # ✅ Add appointment metadata to each vitals entry
        data["appointment_id"] = appointment_id
        data["visit_type"] = appointment_details.get("visit_type")
        update_fields[f"vitals.{safe_timestamp}"] = data

    update_doc = {
        "$set": {
            **update_fields,
            "appointment_id": appointment_id,
            "last_appointment_id": appointment_id,
            "last_doctor_id": doctor_id,
            "last_visit_type": appointment_details.get("visit_type"),
            "last_vitals_timestamp": latest_timestamp
        },
        "$setOnInsert": {
            "sys_user_id": sys_user_id,
            "patient_id": sys_user_id,
            "created_at": datetime.utcnow()
        },
        "$currentDate": {"updated_at": True}
    }

    await patient_vitals_collection.update_one(
        {"sys_user_id": sys_user_id},
        update_doc,
        upsert=True
    )
     # ==========================================================
    # 🔥 3️⃣ ADD CLINICAL TRIGGER HERE (NEW)
    # ==========================================================
    
    # ==========================================================
    # 🔥 TEMP DATA SAVE TRIGGER (NEW)
    # ==========================================================
    temp_payload = {
        "patient_id": sys_user_id,   # ⚠️ use real patient_id
        "doctor_id": doctor_id,
        "vitals": [latest_vitals]   # temp API expects LIST
    }

    logger.info(f"temp_save_payload:{temp_payload}")

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            temp_response = await client.post(
                f"{api_base_url}hms/users/data/context/general/temp/save",
                json=temp_payload
            )

        if temp_response.status_code != 200:
            logger.error(
                "Temp save trigger failed",
                extra={
                    "status_code": temp_response.status_code,
                    "response": temp_response.text
                }
            )

    except Exception as e:
        logger.error(f"Temp save exception: {str(e)}")

    # ==========================================================
    # 🚀 TRIGGER MONGO PROCESSING VIA CELERY (NEW)
    # ==========================================================
    try:
        from users.celery_client import celery_app

        celery_app.send_task(
            "legacy_lab_ai.process_mongo_batch",
            kwargs={
                "patient_id": sys_user_id,   # ⚠️ IMPORTANT (same as temp save)
                "doctor_id": doctor_id
            },
            queue="agentic_queue",
            routing_key="agentic",
            exchange="agentic"
        )

        logger.info(f"🚀 Mongo processing triggered via Celery | patient={sys_user_id}")

    except Exception as e:
        logger.error(f"❌ Mongo Celery trigger failed: {str(e)}")
    

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
# @router.get("/get_patient_vitals/{patient_id}")
# async def get_patient_vitals(patient_id: str):

#     cursor = patient_vitals_collection.find(
#         {"patient_id": patient_id}
#     )

#     results = []

#     async for doc in cursor:
#         # convert _id
#         doc["id"] = str(doc["_id"])
#         del doc["_id"]

#         # convert dictation_id if exists
#         if "dictation_id" in doc and doc["dictation_id"]:
#             doc["dictation_id"] = str(doc["dictation_id"])

#         results.append(doc)

#     if not results:
#         raise HTTPException(
#             status_code=404,
#             detail=f"No vitals found for patient_id={patient_id}"
#         )

#     return {
#         "status": "success",
#         "patient_id": patient_id,
#         "vitals": results
#     }



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



########################################################Alwin Section##########################################################
@router.get("/get_patient_vitals/{patient_id}/{doctor_id}")
async def get_patient_vitals(patient_id: str, doctor_id: str):
    """
    Retrieve patient vitals for a specific patient_id and doctor_id.
    The data will be grouped by date, and each vital will be separated.
    """

    # Fetch the patient's vitals document
    vitals_doc = await patient_vitals_collection.find_one(
        {"sys_user_id": patient_id},
        {"_id": 0}  # exclude MongoDB _id field
    )

    if not vitals_doc or "vitals" not in vitals_doc:
        raise HTTPException(status_code=404, detail=f"No vitals found for patient_id={patient_id}")

    vitals = vitals_doc["vitals"]

    # List to store vitals separated by date
    separated_vitals = []

    # Iterate over each timestamp in the vitals
    for timestamp, data in vitals.items():
        if data.get("doctor_id") == doctor_id:
            # Extract the date part (YYYY-MM-DD) from the timestamp
            date = timestamp.split("T")[0]

            # Append the vital data entry with the date and corresponding vital data
            separated_vitals.append({
                "date": date,
                "vital_data": data
            })

    if not separated_vitals:
        raise HTTPException(status_code=404, detail=f"No vitals found for patient_id={patient_id} and doctor_id={doctor_id}")

    # Return the vitals with date separated from timestamp
    return separated_vitals








@router.get("/get_patient_vitals_v2/{patient_id}")
async def get_patient_vitals(patient_id: str):
    """
    Retrieve patient vitals for a specific patient_id.
    The data will be grouped by date, and each vital will be separated.
    The doctor_id will be removed from the returned vital data.
    """

    # Fetch the patient's vitals document
    vitals_doc = await patient_vitals_collection.find_one(
        {"sys_user_id": patient_id},
        {"_id": 0}  # exclude MongoDB _id field
    )

    if not vitals_doc or "vitals" not in vitals_doc:
        raise HTTPException(status_code=404, detail=f"No vitals found for patient_id={patient_id}")

    vitals = vitals_doc["vitals"]

    # List to store vitals separated by date
    separated_vitals = []

    # Iterate over each timestamp in the vitals
    for timestamp, data in vitals.items():
        # Extract the date part (YYYY-MM-DD) from the timestamp
        date = timestamp.split("T")[0]

        # Remove the doctor_id from the vital data
        vital_data = {key: value for key, value in data.items() if key != "doctor_id"}

        # Append the vital data entry with the date and corresponding vital data (no doctor_id)
        separated_vitals.append({
            "date": date,
            "vital_data": vital_data
        })

    if not separated_vitals:
        raise HTTPException(status_code=404, detail=f"No vitals found for patient_id={patient_id}")

    # Return the vitals with date separated from timestamp, without doctor_id
    return separated_vitals

#############################################################################################################################


##################################################Endpoint to get doctors list from hospital id##########################################################
@router.get("/get_doctors_list/{hospital_id}")
async def get_doctors_list(hospital_id: str):
    """
    Retrieve a list of doctors for a given hospital_id.
    """

    # Fetch the doctors associated with the hospital_id
    doctors_cursor = doctor_user_collection.find(
        {"hospital_id": hospital_id},
        {"_id": 0, "sys_user_id": 1, "name": 1, "specialization": 1}  # Only return doctor_id and name
    )

    doctors_list = await doctors_cursor.to_list(length=None)

    if not doctors_list:
        raise HTTPException(status_code=404, detail=f"No doctors found for hospital_id={hospital_id}")

    return {
        "status": "success",
        "hospital_id": hospital_id,
        "doctors": doctors_list
    }



#############################################################################################################################


######################################################Tumor board functions and endpoints#####################################

@router.get("/get-doctor-info/{sys_user_id}")
async def get_doctor_info(sys_user_id: str):
    # Query the collection to fetch the doctor data
    doctor = await doctor_user_collection.find_one({"sys_user_id": sys_user_id})
    
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")
    
    # Prepare the response data
    doctor_data = {
        "doctor_name": doctor.get("name"),
        "specialization": doctor.get("specialization"),
        "doctor_id": doctor.get("sys_user_id"),
        "hospital_id": doctor.get("hospital_id"),
        "hospital_name": doctor.get("hospital_name")
    }
    
    return JSONResponse(content=doctor_data)

@router.post("/save-doctors-recommendation")
async def save_doctors_recommendation(request: Request):
    try:
        # Extract the JSON payload directly
        data = await request.json()
        
        # Ensure required fields are present
        doctor_id = data.get("doctor_id")
        patient_id = data.get("patient_id")
        hospital_id = data.get("hospital_id")
        speciality = data.get("speciality")
        doctor_recommendation = data.get("doctor_recommendation")

        if not all([doctor_id, patient_id, hospital_id, speciality, doctor_recommendation]):
            raise HTTPException(status_code=400, detail="Missing required fields")

        created_at = datetime.now()  # Get the current date and time

        # Prepare the data to be inserted
        insert_data = {
            "doctor_id": doctor_id,
            "patient_id": patient_id,
            "hospital_id": hospital_id,
            "speciality": speciality,
            "doctor_recommendation": doctor_recommendation,
            "created_at": created_at
        }

        # Insert the data into the tumor_board_cases collection
        tumor_board_collection.insert_one(insert_data)
        return {"message": "Doctor's recommendation saved successfully."}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saving data: {e}")




@router.get("/tumor_board_cases")
async def get_tumor_board_cases():
    # Fetch all documents from the collection
    cursor = tumor_board_collection.find()
    tumor_board_cases = await cursor.to_list(length=None)  # No length limit, retrieve all documents

    # Convert all ObjectId fields and datetime objects to strings
    for case in tumor_board_cases:
        case["_id"] = str(case["_id"])  # Convert ObjectId to string
        for key, value in case.items():
            if isinstance(value, ObjectId):
                case[key] = str(value)
            elif isinstance(value, datetime):
                case[key] = value.isoformat()  # Convert datetime to ISO string format

    return JSONResponse(content={"data": tumor_board_cases})



@router.get("/latest_doctor_recommendations/{hospital_id}/{patient_id}")
async def get_latest_doctor_recommendations(hospital_id: str, patient_id: str):
    # MongoDB aggregation pipeline
    pipeline = [
        # Match patient and hospital ID
        {
            "$match": {
                "patient_id": patient_id,
                "hospital_id": hospital_id
            }
        },
        # Sort by `created_at` in descending order to get the latest first
        {
            "$sort": {"created_at": -1}
        },
        # Group by doctor_id and take the first (latest) recommendation for each doctor
        {
            "$group": {
                "_id": "$doctor_id",
                "latest_recommendation": {"$first": "$$ROOT"}  # $$ROOT refers to the whole document
            }
        },
        # Project the necessary fields, if required
        {
            "$project": {
                "_id": 0,  # Exclude _id field from the response
                "doctor_id": "$latest_recommendation.doctor_id",
                "patient_id": "$latest_recommendation.patient_id",
                "hospital_id": "$latest_recommendation.hospital_id",
                "speciality": "$latest_recommendation.speciality",
                "doctor_recommendation": "$latest_recommendation.doctor_recommendation",
                "created_at": "$latest_recommendation.created_at"
            }
        }
    ]

    # Perform the aggregation
    result = await tumor_board_collection.aggregate(pipeline).to_list(length=None)

    if not result:
        raise HTTPException(status_code=404, detail="No recommendations found for this patient in this hospital")

    # Convert ObjectId and datetime fields to string for JSON serialization
    for doc in result:
        doc["created_at"] = doc["created_at"].isoformat() if isinstance(doc["created_at"], datetime) else doc["created_at"]

    return JSONResponse(content={"data": result})


@router.post("/refer_patient")
async def refer_patient(request: Request):
    try:
        # Get the data from the request body
        data = await request.json()

        # Log the incoming data
        logger.info(f"Data received: {data}")

        # Extract data from the request body
        from_doctor_id = data.get("from_doctor_id")
        to_doctor_id = data.get("to_doctor_id")
        patient_id = data.get("patient_id")
        reason = data.get("reason")

        # Check if all required fields are provided
        if not all([from_doctor_id, to_doctor_id, patient_id, reason]):
            logger.error("Missing required fields in the request.")
            raise HTTPException(status_code=400, detail="Missing required fields")

        # Save referral data into MongoDB
        referral_data = {
            "from_doctor_id": from_doctor_id,
            "to_doctor_id": to_doctor_id,
            "patient_id": patient_id,
            "reason": reason,
            "status": "pending",  # Initial status of the referral
            "referral_date": datetime.utcnow()  # Capture the current time as referral date
        }

        # Insert the referral data into the MongoDB collection and await the result
        result = await doctor_referrals_collection.insert_one(referral_data)
        logger.info(f"Referral successful, inserted ID: {result.inserted_id}")
        return {"message": "Referral successful", "referral_id": str(result.inserted_id)}

    except Exception as e:
        # Log the exception error
        logger.error(f"Error while saving referral: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error while saving referral: {str(e)}")


@router.get("/get_referrals")
async def get_referrals():
    try:
        # Fetch all referral data from the MongoDB collection
        referrals_cursor = await doctor_referrals_collection.find().to_list(None)  # to_list(None) fetches all documents
        
        # Convert ObjectId to string for each referral
        for referral in referrals_cursor:
            referral["_id"] = str(referral["_id"])  # Convert _id to string
        
        # If there are no referrals, return a message
        if not referrals_cursor:
            raise HTTPException(status_code=404, detail="No referrals found")

        # Return the referral data
        return {"message": "Referral data fetched successfully", "referrals": referrals_cursor}

    except Exception as e:
        # Log and raise an error if something goes wrong
        logger.error(f"Error while fetching referrals: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error while fetching referrals: {str(e)}")






@router.get("/get_referrals_by_doctor/{doctor_id}")
async def get_referrals_by_doctor(doctor_id: str):
    try:
        # Fetch referrals where the 'to_doctor_id' matches the provided doctor_id and status is 'pending'
        referrals_cursor = await doctor_referrals_collection.find(
            {"to_doctor_id": doctor_id, "status": "pending"}
        ).to_list(None)

        # Convert ObjectId to string for each referral
        for referral in referrals_cursor:
            referral["_id"] = str(referral["_id"])  # Convert _id to string
        
        # If there are no pending referrals for the given doctor_id, return a message
        if not referrals_cursor:
            raise HTTPException(status_code=404, detail=f"No pending referrals found for doctor with ID: {doctor_id}")

        # Return the filtered referral data
        return {"message": "Referral data fetched successfully", "referrals": referrals_cursor}

    except Exception as e:
        # Log and raise an error if something goes wrong
        logger.error(f"Error while fetching referrals: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error while fetching referrals: {str(e)}")




@router.put("/update_referral_status/{doctor_id}/{patient_id}")
async def update_referral_status(doctor_id: str, patient_id: str):
    try:
        # Update all referrals with the given doctor_id and patient_id where the status is "pending"
        update_result = await doctor_referrals_collection.update_many(
            {
                "to_doctor_id": doctor_id,
                "patient_id": patient_id,
                "status": "pending"
            },
            {"$set": {"status": "completed"}}
        )

        # If no referrals were updated, raise an exception
        if update_result.matched_count == 0:
            raise HTTPException(status_code=404, detail=f"No pending referrals found for doctor {doctor_id} and patient {patient_id}")

        # Return success message
        return {"message": f"Referral status updated to 'completed' for doctor {doctor_id} and patient {patient_id}"}

    except Exception as e:
        # Log and raise an error if something goes wrong
        logger.error(f"Error while updating referral status: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error while updating referral status: {str(e)}")


#####################################################Tumor board functions and endpoints#####################################


###################################patient profile and portal endpoints##########################################################

class HMSIdRequest(BaseModel):
    hms_id: str
@router.post("/check-patient-by-hms-id")
async def check_patient_by_hms_id(request: HMSIdRequest):
    patient =  patient_user_collection.find_one(
        {"hms_id": request.hms_id},
        {"_id": 0}
    )

    return {
        "found": patient is not None
    }





class PatientVerificationRequest(BaseModel):
    hms_id: str
    date_of_birth: str  # DD-MM-YYYY


@router.post("/verify-patient")
async def verify_patient(request: PatientVerificationRequest):
    try:
        # Convert DD-MM-YYYY -> YYYY-MM-DD
        formatted_dob = datetime.strptime(
            request.date_of_birth,
            "%d-%m-%Y"
        ).strftime("%Y-%m-%d")

    except ValueError:
        return {
            "success": False,
            "message": "Invalid date format. Use DD-MM-YYYY"
        }

    patient =  patient_user_collection.find_one(
        {
            "hms_id": request.hms_id,
            "date_of_birth": formatted_dob
        },
        {"_id": 0}
    )

    if not patient:
        return {
            "success": False,
            "message": "Patient not found or DOB does not match"
        }

    return {
        "success": True,
        "message": "Patient verified successfully",
        "patient": patient
    }



class PatientDetailsRequest(BaseModel):
    sys_user_id: str


@router.post("/patient/details")
async def get_patient_details(payload: PatientDetailsRequest):
    
    patient = patient_user_collection.find_one(
        {"sys_user_id": payload.sys_user_id},
        {"_id": 0}
    )

    if not patient:
        raise HTTPException(
            status_code=404,
            detail="Patient not found"
        )

    return {
        "success": True,
        "patient": patient
    }


###########################patient portal and profile endpoints##########################################################
@router.get("/patient-images/{doctor_id}/{patient_id}")
async def get_patient_images(
    doctor_id: str,
    patient_id: str,
):
    try:
        images = await patient_images_collection.find(
            {
                "doctor_id": doctor_id,
                "patient_id": patient_id,
                "status": "active",
            }
        ).sort("created_at", -1).to_list(length=None)

        for image in images:
            image["_id"] = str(image["_id"])

        return {
            "status": "success",
            "count": len(images),
            "data": images,
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch images: {str(e)}"
        )




@router.put("/doctor/update-speciality")
async def update_doctor_speciality(request: Request):
    try:
        data = await request.json()

        sys_user_id = data.get("sys_user_id")
        speciality = data.get("speciality")

        if not sys_user_id or not speciality:
            raise HTTPException(status_code=400, detail="Missing fields")

        doctor = await doctor_user_collection.find_one({
            "sys_user_id": sys_user_id
        })

        if not doctor:
            raise HTTPException(status_code=404, detail="Doctor not found")

        await doctor_user_collection.update_one(
            {"sys_user_id": sys_user_id},
            {"$set": {"specialization": speciality}}
        )

        updated_doctor = await doctor_user_collection.find_one({
            "sys_user_id": sys_user_id
        })

        updated_doctor["_id"] = str(updated_doctor["_id"])

        return {
            "message": "Speciality updated successfully",
            "doctor": updated_doctor
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))