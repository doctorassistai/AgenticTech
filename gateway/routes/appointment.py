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
    prefix="/hms/users/appointment",
    tags=["appointment"],
    responses={404: {"description": "Not found"}},
)


# important should remove later
current_user = {}
current_user["sys_user_id"] = "rem_unknown_id"
current_user["role"] = "rem_unknown_type"

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
