import httpx
from typing import Dict, Any
from datetime import datetime, date, timedelta
import re
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, WebSocket, status, File, Form, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse, FileResponse
from pydantic import BaseModel, Field, EmailStr, validator
from typing import Any, Dict, List, Optional, Union
from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient
from fastapi.responses import StreamingResponse
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
from groq import Groq
from fastapi import Query
from typing import Optional
from fastapi import Response
from jose import jwt, JWTError
from datetime import datetime, timedelta
from fastapi.encoders import jsonable_encoder
from twilio.twiml.messaging_response import MessagingResponse
from twilio.rest import Client
from twilio.request_validator import RequestValidator
from requests.auth import HTTPBasicAuth
from dotenv import load_dotenv
import os
import mimetypes

load_dotenv()
api_base_url = os.getenv("VITE_BACKEND_URL")

# ==================== LOGGING SETUP ====================
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ==================== ENVIRONMENT VARIABLES ====================
SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
ACCESS_TOKEN_EXPIRE_DAYS = os.getenv("ACCESS_TOKEN_EXPIRE_DAYS")
api_key = os.getenv("GROQ_API_KEY")
groq_client = Groq(api_key=api_key)

# ==================== TWILIO CONFIGURATION ====================
import os

TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_WHATSAPP_NUMBER = os.getenv("TWILIO_WHATSAPP_NUMBER")

if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN:
    raise RuntimeError("Twilio credentials are not configured")

# ==================== FILE UPLOAD CONFIGURATION ====================
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
# ==================== DATABASE CONFIGURATION ====================
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

# Async MongoDB client (Motor)
mongodb_client = AsyncIOMotorClient(MONGO_URI)
database = mongodb_client[MONGO_DB]

# Sync MongoDB client (PyMongo)
client = MongoClient(MONGO_URI)
db = client[MONGO_DB]

# Collections
whatsapp_message_collection = database["whatsapp_messages"]
OPD_Doctor_timings_collection = database["OPD_Doctor_timings"]
patient_user_collection = database["patient_users"]
patient_appointments_collection = database["patient_appointments"]
doctor_user_collection = database["doctor_users"]
doctor_screening_questions_collection = database["doctor_screening_questions"]
doctor_screening_results_collection = database["doctor_screening_results"]
hospital_user_collection = db["hospital_users"]
appointment_records_collection = database["appointment_records"]
whatsapp_followup_collection = database["whatsapp_followup"]
patient_education_collection = database["patient_education"] 
doctor_patient_messages_collection = database["doctor_patient_messages"]


# ==================== GLOBAL CONFIGURATIONS FOR FOLLOW-UP ====================
MAX_CONCURRENT_MESSAGES = 50  # Limit concurrent WhatsApp API calls
MESSAGE_BATCH_SIZE = 100  # Process follow-ups in batches
DOCTOR_AVAILABILITY_CACHE = {}  # Cache for doctor availability
CACHE_TIMEOUT = 300  # 5 minutes cache timeout
USER_RESPONSE_SESSIONS = {}  # Store patient responses for follow-up flow


# ==================== FASTAPI ROUTER SETUP ====================
router = APIRouter(
    prefix="/whatsapp",
    tags=["doctor"],
    responses={404: {"description": "Not found"}},
)

# ==================== PYDANTIC MODELS ====================
class File(BaseModel):
    uuid: Optional[str] = None
    url: Optional[str] = None
    type: Optional[str] = None

class Message(BaseModel):
    message: Optional[str] = None
    date: Optional[datetime] = None
    files: Optional[List[File]] = None

class WhatsAppMessage(BaseModel):
    number: Optional[str] = None
    messages: Optional[List[Message]] = None

class TimingSlot(BaseModel):
    day: Optional[str]
    from_time: Optional[str]
    to_time: Optional[str]
    interval: Optional[str]

class DoctorTiming(BaseModel):
    doctor_id: Optional[str]
    timings: Optional[List[TimingSlot]]

class Result(BaseModel):
    question: Optional[str] = None
    answer: Optional[str] = None

class DoctorScreeningResult(BaseModel):
    appointment_id: Optional[str] = None
    doctor_id: Optional[str] = None
    HMS_Id: Optional[str] = None
    result: Optional[List[Result]] = None
    created_at: Optional[datetime] = None



class AppointmentRecord(BaseModel):
    hms_id: Optional[str] = None
    hospital_id: Optional[str] = None
    phone_number: Optional[str] = None
    appointment_id: Optional[str] = None
    appointment_date: Optional[str] = None
    appointment_time: Optional[str] = None
    patient_name: Optional[str] = None
    # ==================== NEW FIELDS ====================
    doctor_id: Optional[str] = None  # Doctor's sys_user_id
    doctor_name: Optional[str] = None  # Doctor's name for easy access
    specialization: Optional[str] = None  # Doctor's specialization
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

class FollowUpDB(BaseModel):
    patient_id: Optional[str] = None
    doctor_id: Optional[str] = None
    followup_date: Optional[str] = None
    reminded: Optional[bool] = None
    created_at: Optional[str] = None



# ==================== UPDATE PATIENT EDUCATION MODEL ====================
class PatientEducation(BaseModel):
    """Model for patient education questions and answers"""
    education_id: Optional[str] = None
    patient_id: Optional[str] = None  # Patient's sys_user_id
    patient_name: Optional[str] = None
    hms_id: Optional[str] = None
    phone_number: Optional[str] = None
    # ==================== NEW FIELDS ====================
    doctor_id: Optional[str] = None  # Treating doctor's sys_user_id
    doctor_name: Optional[str] = None  # Treating doctor's name
    hospital_id: Optional[str] = None  # Hospital ID
    appointment_id: Optional[str] = None  # Latest appointment ID
    appointment_date: Optional[str] = None  # Latest appointment date
    # ==================== EXISTING FIELDS ====================
    question: str
    answer: str
    medical_context: Optional[dict] = None
    question_timestamp: Optional[datetime] = None
    answer_timestamp: Optional[datetime] = None
    question_source: Optional[str] = "whatsapp"
    session_id: Optional[str] = None
    question_number: Optional[int] = 1
    

# ==================== CONVERSATION STATES ====================
# Add this to your ConversationState class
# ==================== CONVERSATION STATES ====================
class ConversationState:
    MAIN_MENU = "main_menu"
    LAB_REPORTS = "lab_reports"
    LAB_REPORTS_UPLOAD = "lab_reports_upload"
    LAB_REPORTS_MORE = "lab_reports_more"
    APPOINTMENT = "appointment"
    APPOINTMENT_METHOD = "appointment_method"
    APPOINTMENT_HMS_ID = "appointment_hms_id"
    APPOINTMENT_DOB_VERIFY = "appointment_dob_verify"
    APPOINTMENT_VERIFY = "appointment_verify"
    APPOINTMENT_DOCTOR_TYPE = "appointment_doctor_type"
    APPOINTMENT_SELECT_SPECIALITY = "appointment_select_speciality"
    APPOINTMENT_SELECT_DOCTOR = "appointment_select_doctor"
    APPOINTMENT_SELECT_DATE = "appointment_select_date"
    APPOINTMENT_SELECT_TIME = "appointment_select_time"
    APPOINTMENT_CHIEF_COMPLAINT = "appointment_chief_complaint"
    APPOINTMENT_CONFIRM = "appointment_confirm"
    APPOINTMENT_VISIT_TYPE = "appointment_visit_type"
    RESCHEDULE_CONFIRM = "reschedule_confirm"
    RESCHEDULE_CONFIRM_NO_APPOINTMENTS = "reschedule_confirm_no_appointments"
    RESCHEDULE_SELECT_APPOINTMENT = "reschedule_select_appointment"
    RESCHEDULE_SELECT_DATE = "reschedule_select_date"
    RESCHEDULE_SELECT_TIME = "reschedule_select_time"
    RESCHEDULE_CONFIRM_CHANGES = "reschedule_confirm_changes"
    # ==================== NEW EDUCATION STATE ====================
    EDUCATION_ASK_QUESTION = "education_ask_question"
    # ==================== NEW CLINIC REGISTRATION STATE ====================
    CLINIC_REGISTRATION = "clinic_registration"
# ==================== GLOBAL VARIABLES ====================
user_sessions = {}
SPECIALITIES = [
    "Cardiology",
    "General",
    "Pediatrics",
    "Orthopedics",
    "Gynecology",
]

# ==========================================================
# ==================== HELPER FUNCTIONS ======================
# ============================================================
import mimetypes
import os


@router.get("/view/{filename}")
async def view_file(filename: str, request: Request):
    file_path = os.path.join(UPLOAD_DIR, filename)

    if not os.path.exists(file_path):
        logger.error(f"File not found: {file_path}")
        raise HTTPException(status_code=404, detail="File not found")

    # Determine MIME type
    media_type, _ = mimetypes.guess_type(file_path)
    if not media_type:
        ext = os.path.splitext(filename)[1].lower()
        media_type = "video/webm" if ext == ".webm" else "application/octet-stream"

    file_size = os.path.getsize(file_path)
    range_header = request.headers.get("range")

    def iter_file(start=0, end=file_size-1):
        with open(file_path, "rb") as f:
            f.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                chunk_size = min(4096, remaining)
                data = f.read(chunk_size)
                if not data:
                    break
                remaining -= len(data)
                yield data

    if range_header:
        # Parse range: bytes=start-end
        range_match = range_header.replace("bytes=", "").split("-")
        start = int(range_match[0])
        end = int(range_match[1]) if range_match[1] else file_size - 1
        content_length = end - start + 1
        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(content_length),
            "Content-Type": media_type
        }
        return StreamingResponse(iter_file(start, end), status_code=206, headers=headers)
    else:
        headers = {
            "Content-Length": str(file_size),
            "Accept-Ranges": "bytes",
            "Content-Type": media_type
        }
        return StreamingResponse(iter_file(), headers=headers)

def sanitize_filename(filename: str) -> str:
    """Sanitize filename by removing invalid characters"""
    sanitized = filename.replace(":", "_").replace("/", "_").replace("+", "_").replace("?", "_").replace("&", "_")
    sanitized = re.sub(r'[^\w\s-]', '', sanitized)
    logger.debug(f"Sanitized filename: {sanitized}")
    return sanitized

def _parse_time(time_str: str) -> datetime.time:
    """Helper to parse time string to time object"""
    try:
        return datetime.strptime(time_str, "%I:%M %p").time()
    except:
        return datetime.min.time()

def format_doctor_for_display(doctor: dict) -> dict:
    """Format doctor data for display with default availability"""
    return {
        "doctor_id": doctor.get("doctor_id"),
        "name": doctor.get("name"),
        "qualifications": doctor.get("qualifications", ""),
        "specialization": doctor.get("specialization", ""),
        "availability": ["09:00 AM", "11:00 AM", "02:00 PM", "04:00 PM"]
    }

def format_patient_for_response(patient: dict) -> dict:
    """Format patient data for API response"""
    return {
        "patient_id": patient.get("patient_id"),
        "hms_id": patient.get("hms_id"),
        "name": patient.get("name"),
        "date_of_birth": patient.get("date_of_birth"),
        "gender": patient.get("gender"),
        "blood_group": patient.get("blood_group"),
        "phone_number": patient.get("phone_number"),
        "email": patient.get("email"),
        "address": patient.get("address")
    }

def format_doctor_for_response(doctor: dict) -> dict:
    """Format doctor data for API response"""
    if not doctor:
        return None
    
    return {
        "doctor_id": doctor.get("doctor_id"),
        "sys_user_id": doctor.get("sys_user_id"),
        "name": doctor.get("name"),
        "specialization": doctor.get("specialization"),
        "qualifications": doctor.get("qualifications"),
        "department": doctor.get("department"),
        "phone_number": doctor.get("phone_number"),
        "email": doctor.get("email"),
        "years_of_experience": doctor.get("years_of_experience"),
        "consultation_fee": doctor.get("consultation_fee")
    }

def format_appointment_for_response(appointment: dict) -> dict:
    """Format appointment data for API response"""
    if not appointment:
        return None
    
    return {
        "appointment_id": appointment.get("appointment_id"),
        "date": appointment.get("date"),
        "scheduled_time": appointment.get("scheduled_time"),
        "actual_time": appointment.get("actual_time"),
        "visit_type": appointment.get("visit_type"),
        "status": appointment.get("status"),
        "chief_complaint": appointment.get("chief_complaint"),
        "diagnosis": appointment.get("diagnosis"),
        "prescription": appointment.get("prescription"),
        "notes": appointment.get("notes")
    }

def format_time_slot_page(page_index: int, time_groups: list, total_pages: int, 
                         all_time_slots: list, display_date: str = "Selected Date", 
                         error: bool = False) -> str:
    """Format a time slot page with proper options"""
    if page_index >= len(time_groups) or not time_groups:
        return "❌ No time slots available for this date."
    
    current_group = time_groups[page_index]
    page_num = page_index + 1
    
    # Calculate how many actual slots are on this page
    start_index = page_index * 6
    slots_on_page = min(6, len(all_time_slots) - start_index)
    
    # Build the main message
    message = f"# Date Selected: {display_date}\n\n"
    message += "## Select Time Slot\n\n"
    message += f"{current_group}\n\n"
    
    # Build options text dynamically
    options_text = "### Options:\n"
    options_text += "- Select time (1-6)\n"
    
    # Calculate option numbers
    has_more_pages = (page_index < total_pages - 1)
    has_previous_pages = (page_index > 0)
    
    # Add "more" option ONLY if there are more pages
    if has_more_pages:
        more_option_num = slots_on_page + 1
        options_text += f"- Type '{more_option_num}' or 'more' for more options\n"
    
    # Add "back" option ONLY if not on first page
    if has_previous_pages:
        # Calculate correct back option number
        back_option_num = slots_on_page + (2 if has_more_pages else 1)
        options_text += f"- Type '{back_option_num}' or 'back' for previous slots\n"
    
    # Always show "back to date" option
    options_text += "- Type 'change date' to select a different date\n"
    
    message += options_text
    
    # Add error message if needed
    if error:
        error_msg = "\n❌ Invalid selection. "
        
        # Build helpful error message based on available options
        valid_options = ["1-6"]
        if has_more_pages:
            more_option_num = slots_on_page + 1
            valid_options.append(f"'{more_option_num}' for more slots")
        if has_previous_pages:
            back_option_num = slots_on_page + (2 if has_more_pages else 1)
            valid_options.append(f"'{back_option_num}' for previous slots")
        
        error_msg += f"Please choose: {', '.join(valid_options)}, or 'change date'."
        message += error_msg
    
    # Add current time for reference
    current_time = datetime.now().strftime("%I:%M %p").lstrip("0")
    message += f"\n\n{current_time}"
    
    return message

def generate_date_selection_message(available_days: set = None):
    """Generate message for date selection (next 7 days) filtered by doctor availability"""
    today = datetime.now()
    
    # Filter dates based on availability
    date_options = []
    available_dates = []  # Store for session
    
    logger.info(f"📅 Generating dates with available_days: {available_days}")
    
    for i in range(7):
        current_date = today + timedelta(days=i)
        day_name = current_date.strftime("%A")
        
        # Check if doctor works on this day (if available_days is provided)
        if available_days is None or day_name.lower() in available_days:
            display_date = current_date.strftime("%d %b %Y")
            option_num = len(date_options) + 1
            
            if i == 0:
                date_text = f"{option_num}. Today - {display_date}"
            elif i == 1:
                date_text = f"{option_num}. Tomorrow - {display_date}"
            else:
                date_text = f"{option_num}. {day_name} - {display_date}"
            
            date_options.append(date_text)
            available_dates.append({
                "date": current_date.strftime("%Y-%m-%d"),
                "display_date": display_date,
                "day_name": day_name
            })
    
    logger.info(f"📅 Generated {len(date_options)} available dates")
    
    if not date_options:
        logger.info("❌ No date options generated")
        return None, []  # No available dates
    
    date_list = "\n".join(date_options)
    
    message = (f"📅 *Select Appointment Date*\n\n"
               f"{date_list}\n\n"
               f"Please select a date (1, 2, 3, etc.):")
    
    logger.info(f"📅 Date message: {message}")
    return message, available_dates

def generate_date_selection_message_reschedule(available_days: set = None):
    """Generate date selection for rescheduling (next 14 days) filtered by availability"""
    today = datetime.now()
    
    # Filter dates based on availability
    date_options = []
    available_dates = []  # Store for session
    
    for i in range(14):
        current_date = today + timedelta(days=i)
        day_name = current_date.strftime("%A")
        
        # Check if doctor works on this day
        if available_days is None or day_name.lower() in available_days:
            display_date = current_date.strftime("%d %b %Y")
            option_num = len(date_options) + 1
            
            if i == 0:
                date_text = f"{option_num}. Today - {display_date}"
            elif i == 1:
                date_text = f"{option_num}. Tomorrow - {display_date}"
            else:
                date_text = f"{option_num}. {day_name} - {display_date}"
            
            date_options.append(date_text)
            available_dates.append({
                "date": current_date.strftime("%Y-%m-%d"),
                "display_date": display_date,
                "day_name": day_name
            })
    
    if not date_options:
        return None, []  # No available dates
    
    date_list = "\n".join(date_options)
    
    return (f"📅 *Select New Appointment Date*\n\n"
            f"{date_list}\n\n"
            f"Please select a date (1, 2, 3, etc.):"), available_dates

def build_appointment_confirmation(session: dict) -> str:
    """Build appointment confirmation message"""
    details = session["appointment_details"]
    
    confirmation = f"📋 *Appointment Summary*\n\n"
    
    # Patient information
    if "patient_info" in details:
        patient = details['patient_info']
        confirmation += f"👤 *Patient Details*\n"
        confirmation += f"   • Name: {patient.get('name', 'N/A')}\n"
        confirmation += f"   • DOB: {patient.get('date_of_birth', 'N/A')}\n"
        confirmation += f"   • Gender: {patient.get('gender', 'N/A')}\n"
        confirmation += f"   • Blood Group: {patient.get('blood_group', 'N/A')}\n"
        confirmation += f"   • Phone: {patient.get('phone_number', 'N/A')}\n"
    
    confirmation += f"\n🆔 *HMS ID:* {details.get('hms_id', 'N/A')}\n"
    
    # Doctor information
    doctor = details.get("doctor", {})
    confirmation += f"\n👨‍⚕️ *Doctor Details*\n"
    confirmation += f"   • Name: {doctor.get('name', 'N/A')}\n"
    confirmation += f"   • Specialization: {doctor.get('specialization', details.get('speciality', 'N/A'))}\n"
    
    if doctor.get('qualifications'):
        confirmation += f"   • Qualifications: {doctor.get('qualifications')}\n"
    
    # Appointment details
    confirmation += f"\n📅 *Appointment Details*\n"
    confirmation += f"   • Date: {details.get('display_date', details.get('date', 'N/A'))}\n"
    confirmation += f"   • Time: {details.get('time', 'N/A')}\n"
    confirmation += f"   • Visit Type: {details.get('visit_type', 'New Visit').title()}\n"
    
    # Add Chief Complaint if exists
    if "chief_complaint" in details:
        # Truncate if too long
        complaint = details['chief_complaint']
        if len(complaint) > 100:
            complaint = complaint[:97] + "..."
        confirmation += f"   • Chief Complaint: {complaint}\n"
    confirmation += f"\n"
    
    confirmation += "*Please confirm:*\n\n"
    confirmation += "1. ✅ Yes, Book Appointment\n"
    confirmation += "2. ❌ No, Cancel"
    
    return confirmation

def build_patient_verification_message_after_dob(session: dict) -> str:
    """Build the patient verification message after DOB confirmation"""
    details = session["appointment_details"]
    patient = details.get("patient_info", {})
    hms_id = details.get("hms_id", "N/A")
    has_previous_doctor = details.get("previous_doctor") is not None
    
    # Check if DOB was verified
    dob_verified = details.get("dob_verified", False)
    verification_status = "✅ Identity Verified Successfully!" if dob_verified else "⚠️ Identity Verification Skipped"
    
    verification_msg = f"{verification_status}\n\n"
    verification_msg += f"🔐 *HMS ID:* {hms_id}\n"
    verification_msg += f"👤 *Name:* {patient.get('name', 'N/A')}\n"
    verification_msg += f"📅 *DOB:* {patient.get('date_of_birth', 'N/A')}\n"
    verification_msg += f"⚧️ *Gender:* {patient.get('gender', 'N/A')}\n"
    verification_msg += f"🩸 *Blood Group:* {patient.get('blood_group', 'N/A')}\n"
    
    # Add previous appointment info only if exists
    latest_appointment = details.get("latest_appointment")
    previous_doctor = details.get("previous_doctor")
    
    if latest_appointment and previous_doctor:
        verification_msg += f"\n📋 *Last Visit:*\n"
        verification_msg += f"   • Date: {latest_appointment.get('date', 'N/A')}\n"
        verification_msg += f"   • Doctor: {previous_doctor.get('name', 'N/A')}\n"
        verification_msg += f"   • Specialization: {previous_doctor.get('specialization', 'N/A')}\n"
        verification_msg += f"   • Qualifications: {previous_doctor.get('qualifications', 'N/A')}\n"
        verification_msg += f"   • Reason: {latest_appointment.get('visit_type', 'N/A')}\n"
        verification_msg += f"   • Time: {latest_appointment.get('scheduled_time', 'N/A')}\n"
    
    # Show appropriate options based on whether there's a previous doctor
    verification_msg += "\n*Choose doctor:*\n\n"
    
    if has_previous_doctor:
        verification_msg += "1. 👨‍⚕️ Previous Doctor (from your last visit)\n"
        verification_msg += "2. 🆕 New Doctor (different doctor)"
    else:
        verification_msg += "1. 🆕 Select a Doctor (New Appointment)\n"
        verification_msg += "2. 🔄 Return to Main Menu"
    
    return verification_msg
def get_doctor_availability_for_elevenlabs(doctor_sys_user_id: str):
    """Get doctor availability for ElevenLabs API response"""
    try:
        # Get doctor OPD timings from database using sync client
        doctor_timings = db["OPD_Doctor_timings"].find_one({"doctor_id": doctor_sys_user_id})
        
        if doctor_timings and "timings" in doctor_timings:
            opd_timings = doctor_timings["timings"]
        else:
            # Use default timings if not found
            opd_timings = [
                {"day": "Monday", "from_time": "9:00 AM", "to_time": "5:00 PM", "interval": "30"},
                {"day": "Tuesday", "from_time": "9:00 AM", "to_time": "5:00 PM", "interval": "30"},
                {"day": "Wednesday", "from_time": "9:00 AM", "to_time": "5:00 PM", "interval": "30"},
                {"day": "Thursday", "from_time": "9:00 AM", "to_time": "5:00 PM", "interval": "30"},
                {"day": "Friday", "from_time": "9:00 AM", "to_time": "5:00 PM", "interval": "30"}
            ]
        
        # Build availability for next 7 days
        today = datetime.now()
        availability = []
        
        for i in range(7):
            current_date = today + timedelta(days=i)
            date_str = current_date.strftime("%Y-%m-%d")
            day_of_week = current_date.strftime("%A")
            
            # Find timing for this day
            day_timing = None
            for timing in opd_timings:
                if timing.get("day", "").lower() == day_of_week.lower():
                    day_timing = timing
                    break
            
            if day_timing:
                # Add to availability
                availability.append({
                    "date": date_str,
                    "day": day_of_week,
                    "from_time": day_timing.get("from_time", "9:00 AM"),
                    "to_time": day_timing.get("to_time", "5:00 PM"),
                    "interval_minutes": int(day_timing.get("interval", "30")),
                    "available": True
                })
            else:
                # Doctor not available on this day
                availability.append({
                    "date": date_str,
                    "day": day_of_week,
                    "from_time": None,
                    "to_time": None,
                    "interval_minutes": None,
                    "available": False,
                    "reason": "Doctor not available on this day"
                })
        
        return availability
        
    except Exception as e:
        logger.error(f"Error getting doctor availability: {e}")
        # Return default availability
        today = datetime.now()
        availability = []
        
        for i in range(7):
            current_date = today + timedelta(days=i)
            date_str = current_date.strftime("%Y-%m-%d")
            day_of_week = current_date.strftime("%A")
            
            # Default: Monday to Friday, 9 AM - 5 PM
            if day_of_week in ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]:
                availability.append({
                    "date": date_str,
                    "day": day_of_week,
                    "from_time": "9:00 AM",
                    "to_time": "5:00 PM",
                    "interval_minutes": 30,
                    "available": True
                })
            else:
                availability.append({
                    "date": date_str,
                    "day": day_of_week,
                    "from_time": None,
                    "to_time": None,
                    "interval_minutes": None,
                    "available": False,
                    "reason": "Weekend (default schedule)"
                })
        
        return availability

async def get_doctor_available_dates_with_cache(doctor_sys_user_id: str, days_ahead: int = 14) -> List[Dict]:
    """
    Get doctor's available dates with caching
    WHAT IT DOES:
    - Caches doctor availability for 5 minutes to reduce database calls
    - Only fetches from DB if cache expired or not present
    - Returns formatted available dates
    """
    cache_key = f"doctor_dates_{doctor_sys_user_id}_{days_ahead}"
    current_time = datetime.now().timestamp()
    
    # Check cache first
    if cache_key in DOCTOR_AVAILABILITY_CACHE:
        cached_data, timestamp = DOCTOR_AVAILABILITY_CACHE[cache_key]
        if current_time - timestamp < CACHE_TIMEOUT:
            logger.info(f"✅ Using cached availability for doctor {doctor_sys_user_id}")
            return cached_data
    
    # Get from database if not in cache
    available_dates = []
    today = datetime.now()
    
    # Get doctor's OPD timings
    doctor_timings = await get_doctor_opd_timings(doctor_sys_user_id)
    if not doctor_timings:
        DOCTOR_AVAILABILITY_CACHE[cache_key] = ([], current_time)
        return []
    
    # Get doctor's available days
    available_days = {timing.get("day", "").strip().lower() for timing in doctor_timings}
    
    # Generate available dates for next N days
    for i in range(days_ahead):
        current_date = today + timedelta(days=i)
        day_name = current_date.strftime("%A").lower()
        
        if day_name in available_days:
            available_dates.append({
                "date": current_date.strftime("%Y-%m-%d"),
                "display_date": current_date.strftime("%B %d, %Y"),
                "day_name": current_date.strftime("%A"),
                "is_available": True
            })
    
    # Update cache
    DOCTOR_AVAILABILITY_CACHE[cache_key] = (available_dates, current_time)
    return available_dates

async def find_nearest_available_date(doctor_sys_user_id: str, target_date_str: str) -> Dict:
    """
    Find nearest available date for doctor
    WHAT IT DOES:
    - Takes target follow-up date and doctor ID
    - Finds closest available date (before or after)
    - Returns nearest date info or None if no dates
    """
    try:
        target_date = datetime.strptime(target_date_str, "%Y-%m-%d")
        
        # Get available dates with cache
        available_dates = await get_doctor_available_dates_with_cache(doctor_sys_user_id)
        
        if not available_dates:
            logger.warning(f"⚠️ No available dates found for doctor {doctor_sys_user_id}")
            return None
        
        # Find the nearest date (before or after)
        nearest_date = None
        min_days_diff = float('inf')
        
        for date_info in available_dates:
            if date_info.get("is_available", False):
                available_date = datetime.strptime(date_info["date"], "%Y-%m-%d")
                days_diff = abs((available_date - target_date).days)
                
                if days_diff < min_days_diff:
                    min_days_diff = days_diff
                    nearest_date = date_info
        
        if nearest_date:
            logger.info(f"✅ Nearest available date for {target_date_str}: {nearest_date['date']} ({min_days_diff} days difference)")
        else:
            logger.warning(f"⚠️ No nearest date found for {target_date_str}")
            
        return nearest_date
        
    except Exception as e:
        logger.error(f"❌ Error finding nearest date: {str(e)}")
        return None

async def send_bulk_whatsapp_messages(messages_data: List[Dict]) -> Dict:
    """
    Send WhatsApp messages in bulk with rate limiting
    WHAT IT DOES:
    - Uses semaphore to limit concurrent API calls
    - Processes messages in batches to avoid overload
    - Returns success/failure statistics
    """
    results = {
        "total": len(messages_data),
        "success": 0,
        "failed": 0,
        "failed_numbers": []
    }
    
    # Use semaphore to limit concurrent API calls
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_MESSAGES)
    
    async def send_single_message(message_info: Dict):
        """Send single message with semaphore"""
        async with semaphore:
            try:
                phone_number = message_info.get("phone_number")
                patient_id = message_info.get("patient_id")
                patient_name = message_info.get("patient_name", "Unknown")
                template_variables = message_info.get("template_variables")
                follow_up_id = message_info.get("follow_up_id")
                session_key = message_info.get("session_key")
                yes_button_id = message_info.get("yes_button_id")
                no_button_id = message_info.get("no_button_id")
                
                if not phone_number:
                    logger.error(f"❌ Missing phone number for patient {patient_id}")
                    return {"success": False, "error": "Missing phone number", "patient_id": patient_id}
                
                if not template_variables:
                    logger.error(f"❌ Missing template variables for patient {patient_id}")
                    return {"success": False, "error": "Missing template variables", "patient_id": patient_id}
                
                logger.info(f"📤 Sending followup to {patient_name} ({patient_id})")
                logger.info(f"   • Follow-up ID: {follow_up_id}")
                logger.info(f"   • Session Key: {session_key}")
                logger.info(f"   • Yes Button ID: {yes_button_id} (will be sent as {{1}})")
                logger.info(f"   • No Button ID: {no_button_id} (will be sent as {{2}})")
                
                # Use the updated followup function with template variables
                result = await send_followup_whatsapp_message(
                    phone_number=phone_number,
                    template_variables=template_variables
                )
                
                if result.get("status") == "success":
                    logger.info(f"✅ Followup template message sent successfully to patient {patient_name} ({patient_id})")
                    return {
                        "success": True, 
                        "patient_id": patient_id, 
                        "sid": result.get("sid"),
                        "template_used": True,
                        "follow_up_id": follow_up_id
                    }
                else:
                    logger.error(f"❌ Failed to send followup to {patient_name} ({patient_id}): {result.get('error')}")
                    return {
                        "success": False, 
                        "patient_id": patient_id, 
                        "error": result.get("error"),
                        "follow_up_id": follow_up_id
                    }
                    
            except Exception as e:
                logger.error(f"❌ Error sending followup to {message_info.get('patient_id', 'unknown')}: {str(e)}")
                return {"success": False, "error": str(e), "patient_id": message_info.get("patient_id")}
    
    # Process messages in batches
    for i in range(0, len(messages_data), MESSAGE_BATCH_SIZE):
        batch = messages_data[i:i + MESSAGE_BATCH_SIZE]
        logger.info(f"📦 Processing followup batch {i//MESSAGE_BATCH_SIZE + 1}: {len(batch)} messages")
        
        # Create tasks for batch
        tasks = [send_single_message(msg) for msg in batch]
        
        # Wait for batch completion
        batch_results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Count results
        for result in batch_results:
            if isinstance(result, dict) and result.get("success"):
                results["success"] += 1
            else:
                results["failed"] += 1
                if isinstance(result, dict) and result.get("patient_id"):
                    results["failed_numbers"].append(result.get("patient_id"))
        
        # Small delay between batches
        if i + MESSAGE_BATCH_SIZE < len(messages_data):
            await asyncio.sleep(1)
    
    logger.info(f"📊 Followup bulk send completed: {results['success']} successful, {results['failed']} failed")
    logger.info(f"📋 Template used: Yes (HX0aef647da42a454a2be9d246319f2b48)")
    return results
def extract_variables_from_message(message_content: str):
    """Extract variables from message content for template"""
    patient_name = "Patient"
    doctor_name = "Doctor"
    appointment_date = datetime.now().strftime("%d-%m-%Y")
    day_name = datetime.now().strftime("%A")
    
    try:
        lines = message_content.split('\n')
        
        for line in lines:
            line_lower = line.lower()
            
            # Extract patient name from "Hello {patient_name},"
            if 'hello' in line_lower and ',' in line:
                # Try to extract text after Hello and before comma
                parts = line.split(',')
                if len(parts) > 0:
                    # Remove "Hello" and any greeting words
                    name_part = parts[0].replace('Hello', '').replace('hello', '').strip()
                    if name_part:
                        patient_name = name_part
                        logger.info(f"📋 Extracted patient_name from greeting: {patient_name}")
            
            # Extract doctor name from "Dr. {doctor_name}"
            elif 'dr.' in line_lower or 'doctor' in line_lower:
                # Look for pattern like "Dr. Smith" or "Doctor Smith"
                match = re.search(r'(?:Dr\.|Doctor)\s+([A-Za-z\s\.\-]+)', line, re.IGNORECASE)
                if match:
                    doctor_name = match.group(1).strip()
                    logger.info(f"📋 Extracted doctor_name: {doctor_name}")
            
            # Extract appointment date (look for date patterns)
            elif '📅' in line or 'date:' in line_lower:
                # Try to find date pattern like "Date: 25-12-2023"
                date_match = re.search(r'(\d{2}-\d{2}-\d{4})', line)
                if date_match:
                    appointment_date = date_match.group(1)
                    logger.info(f"📋 Extracted appointment_date: {appointment_date}")
                else:
                    # Look for text after "Date:" or similar
                    date_parts = re.split(r'date:\s*', line_lower, flags=re.IGNORECASE)
                    if len(date_parts) > 1 and date_parts[1].strip():
                        appointment_date = date_parts[1].strip()
                        logger.info(f"📋 Extracted appointment_date from text: {appointment_date}")
            
            # Extract day name
            elif 'monday' in line_lower or 'tuesday' in line_lower or 'wednesday' in line_lower or \
                 'thursday' in line_lower or 'friday' in line_lower or 'saturday' in line_lower or 'sunday' in line_lower:
                for day in ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']:
                    if day.lower() in line_lower:
                        day_name = day
                        logger.info(f"📋 Extracted day_name: {day_name}")
                        break
        
        # Method 2: If we didn't find doctor name, try to extract from message context
        if doctor_name == "Doctor":
            for line in lines:
                if 'follow-up' in line_lower or 'appointment' in line_lower:
                    words = line.split()
                    for i, word in enumerate(words):
                        if word.lower() in ['with', 'dr.', 'doctor'] and i + 1 < len(words):
                            potential_name = words[i + 1]
                            if len(potential_name) > 2:  # Simple validation
                                doctor_name = potential_name
                                logger.info(f"📋 Extracted doctor_name from context: {doctor_name}")
                                break
        
        logger.info(f"📋 Final extracted variables: patient_name={patient_name}, doctor_name={doctor_name}, appointment_date={appointment_date}, day_name={day_name}")
        
        return patient_name, doctor_name, appointment_date, day_name
        
    except Exception as e:
        logger.error(f"❌ Error extracting variables from message: {str(e)}")
        # Return default values
        return patient_name, doctor_name, appointment_date, day_name

# ============================================================
# ==================== DATABASE FUNCTIONS ====================
# ============================================================

async def get_patient_by_hms_id(hms_id: str) -> Optional[dict]:
    """Search patient by HMS ID"""
    try:
        search_id = hms_id.strip()
        
        logger.info(f"🔍 Database search for: '{search_id}'")
        
        # SINGLE OPTIMIZED QUERY with $or condition
        patient = await patient_user_collection.find_one(
            {
                "$or": [
                    {"hms_id": search_id},
                    {"hms_id": search_id.upper()},
                    {"hms_id": {"$regex": f"^{re.escape(search_id)}$", "$options": "i"}}
                ]
            },
            {
                "_id": 1,
                "hms_id": 1,
                "sys_user_id": 1,
                "name": 1,
                "date_of_birth": 1,
                "gender": 1,
                "blood_group": 1,
                "phone_number": 1,
                "patient_id": 1,
                "hospital_id": 1
            }
        )
        
        if patient:
            patient["_id"] = str(patient["_id"])
            logger.info(f"✅ Patient found: {patient.get('name')}")
            return patient
        
        logger.info(f"❌ No patient found")
        return None
    except Exception as e:
        logger.error(f"❌ Database error: {e}")
        return None

async def get_latest_appointment(patient_id: str) -> Optional[dict]:
    """Get latest appointment with appointment ID"""
    try:
        logger.info(f"🔍 Looking for appointments for patient: '{patient_id}'")
        
        # Use aggregation pipeline for sorting in database
        pipeline = [
            {"$match": {"patient_id": patient_id}},
            {"$unwind": "$appointments"},
            {"$sort": {"appointments.date": -1}},
            {"$limit": 1},
            {"$project": {
                "appointment_id": "$appointments.appointment_id",
                "doctor_id": "$appointments.doctor_id",
                "date": "$appointments.date",
                "scheduled_time": "$appointments.scheduled_time",
                "visit_type": "$appointments.visit_type"
            }}
        ]
        
        cursor = patient_appointments_collection.aggregate(pipeline)
        result = await cursor.to_list(length=1)
        
        if result:
            latest = result[0]
            doctor_sys_user_id = latest.get("doctor_id")
            appointment_id = latest.get("appointment_id", "")
            
            logger.info(f"📋 Latest appointment found")
            logger.info(f"   • Appointment ID: {appointment_id}")
            logger.info(f"   • Date: {latest.get('date')}")
            logger.info(f"   • Doctor (sys_user_id): {doctor_sys_user_id}")
            logger.info(f"   • Visit Type: {latest.get('visit_type')}")
            return latest
        
        logger.info(f"❌ No appointments found")
        return None
    except Exception as e:
        logger.error(f"❌ Error: {e}")
        return None

async def get_doctor_by_id(doctor_sys_user_id: str, hms_id: str = None) -> Optional[dict]:
    """Get doctor by sys_user_id AND verify hospital_id matches patient"""
    try:
        logger.info(f"🔍 Looking up doctor by sys_user_id: '{doctor_sys_user_id}'")
        
        # Get patient's hospital_id if hms_id is provided
        patient_hospital_id = None
        if hms_id:
            patient = await get_patient_by_hms_id(hms_id)
            if patient:
                patient_hospital_id = patient.get("hospital_id")
                logger.info(f"🏥 Patient hospital_id: {patient_hospital_id}")
            else:
                logger.warning(f"⚠️ Patient not found for HMS_ID: {hms_id}")
                return None
        
        # Search by sys_user_id
        doctor = await doctor_user_collection.find_one({"sys_user_id": doctor_sys_user_id})
        
        if doctor:
            doctor_hospital_id = doctor.get("hospital_id")
            doctor_name = doctor.get("name")
            
            # If patient hospital_id is provided, verify they match
            if patient_hospital_id and doctor_hospital_id:
                if patient_hospital_id != doctor_hospital_id:
                    logger.warning(f"⚠️ Hospital mismatch! Patient: {patient_hospital_id}, Doctor: {doctor_hospital_id}")
                    return None
            
            logger.info(f"✅ Doctor found: {doctor_name} (hospital: {doctor_hospital_id})")
            doctor["_id"] = str(doctor["_id"])
            return doctor
        else:
            logger.warning(f"⚠️ No doctor found with sys_user_id: '{doctor_sys_user_id}'")
            
            # Fallback: Try doctor_id field (but still check hospital_id if provided)
            doctor = await doctor_user_collection.find_one({"doctor_id": doctor_sys_user_id})
            if doctor:
                # Verify hospital_id if patient info available
                if patient_hospital_id:
                    doctor_hospital_id = doctor.get("hospital_id")
                    if doctor_hospital_id != patient_hospital_id:
                        logger.warning(f"⚠️ Hospital mismatch in fallback! Patient: {patient_hospital_id}, Doctor: {doctor_hospital_id}")
                        return None
                
                logger.info(f"✅ Found by doctor_id fallback: {doctor.get('name')}")
                doctor["_id"] = str(doctor["_id"])
                return doctor
            
            return None
    except Exception as e:
        logger.error(f"❌ Error getting doctor: {e}")
        return None

async def get_doctors_by_speciality(speciality: str, hospital_id: str) -> List[dict]:
    """Get all doctors by speciality AND hospital_id"""
    try:
        logger.info("╔" + "═" * 78 + "╗")
        logger.info("║" + " " * 25 + "📥 GET DOCTORS BY SPECIALITY INPUT" + " " * 25 + "║")
        logger.info("╚" + "═" * 78 + "╝")
        logger.info(f"📋 Input Parameters:")
        logger.info(f"   • Speciality: '{speciality}'")
        logger.info(f"   • Hospital ID: '{hospital_id}'")
        
        # Validate inputs
        if not speciality or not isinstance(speciality, str):
            logger.error("❌ Speciality is required and must be a string")
            return []
        
        if not hospital_id or not isinstance(hospital_id, str):
            logger.error("❌ Hospital ID is required and must be a string")
            return []
        
        # Clean inputs
        speciality_clean = speciality.strip()
        hospital_id_clean = hospital_id.strip()
        
        # Build database query
        query = {
            "$and": [
                {"specialization": {"$regex": f"^{re.escape(speciality_clean)}$", "$options": "i"}},
                {"hospital_id": hospital_id_clean}
            ]
        }
        
        logger.info(f"📋 Database Query:")
        logger.info(json.dumps(query, indent=2))
        
        # Execute database query
        logger.info(f"🔍 Executing database query...")
        start_time = datetime.now()
        
        cursor = doctor_user_collection.find(
            query,
            {
                "_id": 1,
                "doctor_id": 1,
                "sys_user_id": 1,
                "name": 1,
                "specialization": 1,
                "qualifications": 1,
                "hospital_id": 1,
                "years_of_experience": 1,
                "consultation_fee": 1,
                "department": 1
            }
        ).sort("name", 1).limit(20)
        
        doctors = await cursor.to_list(length=20)
        
        end_time = datetime.now()
        execution_time = (end_time - start_time).total_seconds()
        logger.info(f"⏱️ Query execution time: {execution_time:.3f} seconds")
        
        # Format response
        formatted_doctors = []
        for doctor in doctors:
            doctor_copy = doctor.copy()
            doctor_copy["_id"] = str(doctor_copy["_id"])
            
            # Only include doctors that match the hospital_id filter
            if str(doctor_copy.get("hospital_id", "")) == hospital_id_clean:
                formatted_doctors.append(doctor_copy)
            else:
                logger.warning(f"   ⚠️ Excluding doctor '{doctor_copy.get('name')}' - hospital_id mismatch")
        
        logger.info(f"📊 Response Formatting:")
        logger.info(f"   • Raw doctors found: {len(doctors)}")
        logger.info(f"   • After hospital filtering: {len(formatted_doctors)}")
        
        return formatted_doctors
        
    except Exception as e:
        logger.error(f"❌ Error in get_doctors_by_speciality: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return []

async def get_hospital_id_from_patient(hms_id: str) -> Optional[str]:
    """Get hospital_id from patient record using HMS_ID"""
    try:
        logger.info("╔" + "═" * 78 + "╗")
        logger.info("║" + " " * 25 + "🏥 GET HOSPITAL_ID FROM PATIENT" + " " * 24 + "║")
        logger.info("╚" + "═" * 78 + "╝")
        
        hms_id_clean = hms_id.strip()
        logger.info(f"🔍 Looking for patient with HMS_ID: '{hms_id_clean}'")
        
        # Try exact match first
        patient = await patient_user_collection.find_one(
            {"hms_id": hms_id_clean},
            {
                "_id": 0,
                "hospital_id": 1,
                "name": 1,
                "hms_id": 1,
                "patient_id": 1,
                "sys_user_id": 1
            }
        )
        
        if not patient:
            # Try case-insensitive search
            logger.info(f"🔍 Trying case-insensitive search for HMS_ID: '{hms_id_clean}'")
            patient = await patient_user_collection.find_one(
                {"hms_id": {"$regex": f"^{re.escape(hms_id_clean)}$", "$options": "i"}},
                {
                    "_id": 0,
                    "hospital_id": 1,
                    "name": 1,
                    "hms_id": 1
                }
            )
        
        if patient:
            hospital_id = patient.get("hospital_id")
            patient_name = patient.get("name", "Unknown")
            found_hms_id = patient.get("hms_id")
            
            logger.info(f"✅ Patient found:")
            logger.info(f"   • Name: {patient_name}")
            logger.info(f"   • HMS_ID (found): {found_hms_id}")
            logger.info(f"   • Hospital ID: '{hospital_id}'")
            
            if hospital_id:
                if isinstance(hospital_id, str) and hospital_id.strip():
                    logger.info(f"✅ Valid hospital_id found: '{hospital_id}'")
                    return hospital_id
                else:
                    logger.warning(f"⚠️ hospital_id exists but is empty/invalid")
                    return None
            else:
                logger.warning(f"⚠️ Patient found but hospital_id field is missing")
                return None
        else:
            logger.error(f"❌ Patient NOT FOUND with HMS_ID: '{hms_id_clean}'")
            return None
            
    except Exception as e:
        logger.error(f"❌ Error in get_hospital_id_from_patient: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return None

async def get_upcoming_appointments(hms_id: str) -> List[dict]:
    """Get upcoming appointments for a patient (today or future)"""
    try:
        today = datetime.now().strftime("%Y-%m-%d")
        
        # Find patient by HMS_ID
        patient = await get_patient_by_hms_id(hms_id)
        if not patient:
            return []
        
        patient_id = patient.get("patient_id")
        if not patient_id:
            return []
        
        # Get appointments for this patient
        patient_appointments = await patient_appointments_collection.find_one(
            {"patient_id": patient_id}
        )
        
        if not patient_appointments or "appointments" not in patient_appointments:
            return []
        
        # Filter upcoming appointments (today or future)
        upcoming_appointments = []
        for appointment in patient_appointments["appointments"]:
            appointment_date = appointment.get("date")
            appointment_status = appointment.get("status", "scheduled").lower()
            
            # Only include scheduled appointments that are today or in the future
            if (appointment_date and appointment_date >= today and 
                appointment_status in ["scheduled", "booked", "confirmed"]):
                
                # Get doctor info
                doctor = await get_doctor_by_id(appointment.get("doctor_id"))
                
                # Get appointment ID - use existing or generate one
                appointment_id = appointment.get("appointment_id") or appointment.get("id") or f"APT-{patient_id}-{appointment_date}"
                
                upcoming_appointments.append({
                    "appointment_id": appointment_id,
                    "appointment_number": appointment.get("appointment_number", "N/A"),
                    "date": appointment_date,
                    "scheduled_time": appointment.get("scheduled_time", "N/A"),
                    "doctor_name": doctor.get("name") if doctor else "Unknown Doctor",
                    "specialization": doctor.get("specialization") if doctor else "",
                    "visit_type": appointment.get("visit_type", "New Visit"),
                    "status": appointment_status,
                    "doctor_id": appointment.get("doctor_id")
                })
        
        # Sort by date and time (nearest first)
        upcoming_appointments.sort(key=lambda x: (x["date"], x["scheduled_time"]))
        
        return upcoming_appointments[:5]  # Return max 5 upcoming appointments
        
    except Exception as e:
        logger.error(f"❌ Error getting upcoming appointments: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return []

async def get_doctor_opd_timings(doctor_sys_user_id: str) -> Optional[list]:
    """Get doctor OPD timings from database"""
    try:
        logger.info(f"🔍 Fetching OPD timings for doctor: {doctor_sys_user_id}")
        
        # Query the OPD timings collection
        doctor_timings = await OPD_Doctor_timings_collection.find_one(
            {"doctor_id": doctor_sys_user_id}
        )
        
        if doctor_timings and "timings" in doctor_timings:
            logger.info(f"✅ Found OPD timings for doctor: {doctor_sys_user_id}")
            logger.info(f"📋 Timings data: {doctor_timings.get('timings')}")
            return doctor_timings["timings"]
        else:
            logger.warning(f"⚠️ No OPD timings found for doctor: {doctor_sys_user_id}")
            return None
            
    except Exception as e:
        logger.error(f"❌ Error fetching doctor timings: {e}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return None

async def get_doctor_available_days(doctor_sys_user_id: str) -> set:
    """Get doctor's available days from OPD timings"""
    try:
        doctor_timings = await get_doctor_opd_timings(doctor_sys_user_id)
        if not doctor_timings:
            return set()  # Empty set if no timings
        
        # Use set comprehension for O(1) lookups
        return {timing.get("day", "").strip().lower() for timing in doctor_timings}
    except Exception:
        return set()

async def get_doctor_by_sys_user_id(sys_user_id: str, hms_id: str = None) -> Optional[dict]:
    """Get doctor by sys_user_id with hospital_id verification"""
    try:
        logger.info(f"🔍 Database lookup for doctor with sys_user_id: '{sys_user_id}'")
        
        # Get patient's hospital_id
        patient_hospital_id = None
        if hms_id:
            patient = await get_patient_by_hms_id(hms_id)
            if patient:
                patient_hospital_id = patient.get("hospital_id")
                logger.info(f"🏥 Patient hospital_id: {patient_hospital_id}")
            else:
                logger.warning(f"⚠️ Patient not found for HMS_ID: {hms_id}")
                return None
        
        # Build query
        query = {
            "$or": [
                {"sys_user_id": sys_user_id},
                {"sys_user_id": {"$regex": f"^{re.escape(sys_user_id)}$", "$options": "i"}}
            ]
        }
        
        # Async query
        doctor = await doctor_user_collection.find_one(
            query,
            {
                "_id": 1,
                "doctor_id": 1,
                "sys_user_id": 1,
                "name": 1,
                "specialization": 1,
                "qualifications": 1,
                "hospital_id": 1
            }
        )
        
        if doctor:
            # Verify hospital_id matches
            doctor_hospital_id = doctor.get("hospital_id")
            
            if patient_hospital_id and doctor_hospital_id:
                if patient_hospital_id != doctor_hospital_id:
                    logger.warning(f"⚠️ Hospital mismatch! Patient: {patient_hospital_id}, Doctor: {doctor_hospital_id}")
                    return None
            
            logger.info(f"✅ Doctor found by sys_user_id: {doctor.get('name')} (hospital: {doctor_hospital_id})")
            doctor["_id"] = str(doctor["_id"])
            return doctor
        
        logger.warning(f"⚠️ No doctor found with sys_user_id: '{sys_user_id}'")
        return None
        
    except Exception as e:
        logger.error(f"❌ Error in get_doctor_by_sys_user_id: {e}")
        return None

async def get_available_specialities_for_elevenlabs(hms_id: str) -> List[str]:
    """Get available specialities for a patient"""
    try:
        # Get hospital_id from patient
        hospital_id = await get_hospital_id_from_patient(hms_id)
        if not hospital_id:
            logger.warning(f"No hospital_id found for HMS_ID: {hms_id}")
            return SPECIALITIES
        
        # Async aggregation query
        pipeline = [
            {"$match": {"hospital_id": hospital_id}},
            {"$group": {"_id": "$specialization"}},
            {"$sort": {"_id": 1}}
        ]
        
        cursor = doctor_user_collection.aggregate(pipeline)
        specialities = [doc["_id"] async for doc in cursor]
        
        if specialities:
            logger.info(f"Found {len(specialities)} specialities for hospital_id: {hospital_id}")
            return specialities
        else:
            logger.info(f"No specialities found for hospital_id: {hospital_id}, using default")
            return SPECIALITIES
            
    except Exception as e:
        logger.error(f"Error getting specialities for hospital: {e}")
        return SPECIALITIES

async def get_doctors_for_elevenlabs(speciality: str, hms_id: str) -> List[dict]:
    """Get doctors for ElevenLabs"""
    try:
        # Get hospital_id from patient
        hospital_id = await get_hospital_id_from_patient(hms_id)
        
        # Build query
        query = {"specialization": {"$regex": f"^{re.escape(speciality)}$", "$options": "i"}}
        if hospital_id:
            query["hospital_id"] = hospital_id
        
        # Async query
        cursor = doctor_user_collection.find(
            query,
            {
                "doctor_id": 1,
                "sys_user_id": 1,
                "name": 1,
                "specialization": 1,
                "qualifications": 1,
                "department": 1,
                "years_of_experience": 1,
                "consultation_fee": 1
            }
        ).limit(10)
        
        doctors = await cursor.to_list(length=10)
        
        # Format response using list comprehension
        formatted_doctors = [
            {
                "doctor_id": doctor.get("doctor_id"),
                "sys_user_id": doctor.get("sys_user_id"),
                "name": doctor.get("name"),
                "specialization": doctor.get("specialization"),
                "qualifications": doctor.get("qualifications", ""),
                "department": doctor.get("department", ""),
                "experience_years": doctor.get("years_of_experience", ""),
                "consultation_fee": doctor.get("consultation_fee", "")
            }
            for doctor in doctors
        ]
        
        logger.info(f"Found {len(formatted_doctors)} doctors for speciality '{speciality}'")
        return formatted_doctors
        
    except Exception as e:
        logger.error(f"Error getting doctors for ElevenLabs: {e}")
        return []

async def update_appointment_in_database(appointment_id: str, new_date: str, new_time: str) -> bool:
    """Update appointment date and time in database"""
    try:
        logger.info(f"🔄 Updating appointment {appointment_id} to {new_date} at {new_time}")
        
        # First find the appointment
        result = await patient_appointments_collection.update_one(
            {"appointments.appointment_id": appointment_id},
            {
                "$set": {
                    "appointments.$.date": new_date,
                    "appointments.$.scheduled_time": new_time,
                    "appointments.$.status": "rescheduled",
                    "appointments.$.rescheduled_at": datetime.now().isoformat()
                }
            }
        )
        
        if result.modified_count > 0:
            logger.info(f"✅ Appointment {appointment_id} updated successfully")
            return True
        else:
            # Try alternative field names
            result = await patient_appointments_collection.update_one(
                {"appointments.id": appointment_id},
                {
                    "$set": {
                        "appointments.$.date": new_date,
                        "appointments.$.scheduled_time": new_time,
                        "appointments.$.status": "rescheduled",
                        "appointments.$.rescheduled_at": datetime.now().isoformat()
                    }
                }
            )
            
            if result.modified_count > 0:
                logger.info(f"✅ Appointment {appointment_id} updated successfully (using id field)")
                return True
            
            logger.warning(f"⚠️ No appointment found with ID: {appointment_id}")
            return False
            
    except Exception as e:
        logger.error(f"❌ Error updating appointment: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return False

async def generate_time_slots_for_doctor(doctor_sys_user_id: str, selected_date_str: str) -> tuple:
    """Generate time slots for a specific doctor based on their OPD schedule"""
    try:
        # Parse selected date
        selected_date = datetime.strptime(selected_date_str, "%Y-%m-%d")
        day_of_week = selected_date.strftime("%A")  # e.g., "Monday"
        
        logger.info(f"📅 Generating time slots for {selected_date_str} ({day_of_week}) for doctor: {doctor_sys_user_id}")
        
        # Get doctor OPD timings from database
        doctor_timings = await get_doctor_opd_timings(doctor_sys_user_id)
        
        if not doctor_timings:
            logger.warning(f"❌ No OPD timings found in database for doctor: {doctor_sys_user_id}")
            return [], []  # Return empty lists
        
        # Find timing for the specific day
        day_timing = None
        for timing in doctor_timings:
            timing_day = timing.get("day", "").strip().lower()
            if timing_day == day_of_week.lower():
                day_timing = timing
                break
        
        if not day_timing:
            logger.info(f"📅 Doctor {doctor_sys_user_id} doesn't work on {day_of_week}")
            return [], []  # Return empty lists
        
        # Extract timing details
        from_time_str = day_timing.get("from_time", "").strip()
        to_time_str = day_timing.get("to_time", "").strip()
        interval_str = day_timing.get("interval", "30").strip()
        
        logger.info(f"📋 Doctor schedule for {day_of_week}: {from_time_str} to {to_time_str}, interval: {interval_str}min")
        
        if not from_time_str or not to_time_str:
            logger.error("Missing from_time or to_time in timing data")
            return [], []
        
        # Parse times
        def parse_time(time_str):
            try:
                time_str = time_str.strip().upper()
                # Remove any extra spaces
                time_str = time_str.replace(" ", "")
                
                # Try different formats
                formats = ["%I:%M%p", "%I%p", "%H:%M", "%H:%M:%S"]
                for fmt in formats:
                    try:
                        return datetime.strptime(time_str, fmt).time()
                    except ValueError:
                        continue
                return None
            except Exception as e:
                logger.error(f"Error parsing time '{time_str}': {e}")
                return None
        
        from_time = parse_time(from_time_str)
        to_time = parse_time(to_time_str)
        
        if not from_time or not to_time:
            logger.error(f"Failed to parse time strings: '{from_time_str}' or '{to_time_str}'")
            return [], []
        
        # Parse interval
        try:
            interval = int(interval_str)
        except ValueError:
            logger.error(f"Invalid interval: {interval_str}, using default 30")
            interval = 30
        
        # Generate time slots based on OPD schedule
        time_slots = []
        current_time = from_time
        
        while current_time <= to_time:
            # Format time as string
            hour = current_time.hour
            minute = current_time.minute
            
            if hour == 0:
                time_str = f"12:{minute:02d} AM"
            elif hour < 12:
                time_str = f"{hour}:{minute:02d} AM"
            elif hour == 12:
                time_str = f"12:{minute:02d} PM"
            else:
                time_str = f"{hour-12}:{minute:02d} PM"
            
            time_slots.append(time_str)
            
            # Add interval minutes
            current_dt = datetime.combine(datetime.today(), current_time) + timedelta(minutes=interval)
            current_time = current_dt.time()
            
            # Safety check to avoid infinite loop
            if len(time_slots) > 100:
                logger.warning("Safety break - too many time slots generated")
                break
        
        logger.info(f"✅ Generated {len(time_slots)} time slots for {day_of_week}")
        
        if not time_slots:
            logger.warning(f"No time slots generated for {day_of_week}")
            return [], []
        
        # Split into groups of 6 for WhatsApp display
        grouped_times = []
        for i in range(0, len(time_slots), 6):
            group = time_slots[i:i+6]
            
            # Number each slot in the group from 1-6
            formatted_group = []
            for j, time_slot in enumerate(group, 1):
                formatted_group.append(f"{j}. {time_slot}")
            
            # Build the group text
            group_text = "\n".join(formatted_group)
            
            # Check if there are more slots AFTER this group
            has_more_slots = (i + 6 < len(time_slots))
            
            # Check if there are slots BEFORE this group
            has_previous_slots = (i > 0)
            
            # Add "more" option ONLY if there are more slots
            if has_more_slots:
                more_option_num = len(group) + 1
                group_text += f"\n{more_option_num}. More slots"
            
            # Add "back" option ONLY if there are previous slots
            if has_previous_slots:
                back_option_num = len(group) + (2 if has_more_slots else 1)
                group_text += f"\n{back_option_num}. Previous slots"
            
            grouped_times.append(group_text)
        
        return grouped_times, time_slots
        
    except Exception as e:
        logger.error(f"❌ Error generating time slots: {e}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return [], []  # Return empty lists on error

# ============================================================
# ============ UPDATED: SAVE APPOINTMENT WITH DOCTOR ID ======
# ============================================================

# ============================================================
# ============ COMPLETE UPDATED SAVE TO DATABASE ============
# ============================================================

async def save_to_database(
    hms_id: str = None,
    hospital_id: str = None,
    phone_number: str = None,
    appointment_id: str = None,
    appointment_date: str = None,
    appointment_time: str = None,
    patient_name: str = None,
    from_number: str = None,
    body: str = None,
    source: str = "whatsapp",
    # ==================== DOCTOR FIELDS ====================
    doctor_id: str = None,
    doctor_name: str = None,
    specialization: str = None,
    # ==================== PATIENT SYS_USER_ID ====================
    patient_sys_user_id: str = None
):
    """
    COMPLETE UPDATED FUNCTION: Saves appointment records with doctor information AND patient sys_user_id
    Now saves BOTH patient_sys_user_id AND patient_id for compatibility
    """
    try:
        # ==================== LOGGING WITH SOURCE ====================
        logger.info("╔" + "═" * 78 + "╗")
        logger.info("║" + " " * 25 + f"💾 SAVING APPOINTMENT RECORD [{source.upper()}]" + " " * 24 + "║")
        logger.info("╚" + "═" * 78 + "╝")
        logger.info(f"📋 Source: {source}")
        
        # ==================== SESSION TRACKING ====================
        if from_number:
            logger.info(f"📱 Session activity from: {from_number}")
            if body:
                logger.info(f"   Message: {body[:50]}{'...' if len(body) > 50 else ''}")
        
        # ==================== VALIDATE REQUIRED FIELDS ====================
        required_fields = {
            "hms_id": hms_id,
            "hospital_id": hospital_id,
            "phone_number": phone_number,
            "appointment_id": appointment_id,
            "appointment_date": appointment_date,
            "appointment_time": appointment_time
        }
        
        missing_fields = [field for field, value in required_fields.items() if not value]
        
        if missing_fields:
            logger.warning(f"⚠️ Missing required fields: {', '.join(missing_fields)}")
            logger.info("ℹ️ No complete appointment data to save")
            logger.info("╚" + "═" * 78 + "╝")
            return False
        
        # ==================== FETCH PATIENT NAME AND SYS_USER_ID IF NOT PROVIDED ====================
        final_patient_name = patient_name
        final_patient_sys_user_id = patient_sys_user_id
        
        if not final_patient_name or not final_patient_sys_user_id:
            try:
                patient = await get_patient_by_hms_id(hms_id)
                if patient:
                    if not final_patient_name:
                        final_patient_name = patient.get('name')
                    if not final_patient_sys_user_id:
                        final_patient_sys_user_id = patient.get('sys_user_id')
                    logger.info(f"✅ Fetched patient data from DB: Name={final_patient_name}, sys_user_id={final_patient_sys_user_id}")
                else:
                    logger.warning(f"⚠️ Could not find patient in DB for HMS ID: {hms_id}")
            except Exception as e:
                logger.error(f"❌ Error fetching patient data: {str(e)}")
        
        # ==================== FETCH DOCTOR INFO IF NOT PROVIDED ====================
        final_doctor_id = doctor_id
        final_doctor_name = doctor_name
        final_specialization = specialization
        
        if not final_doctor_id and appointment_id:
            try:
                appointment_doc = await patient_appointments_collection.find_one(
                    {"appointments.appointment_id": appointment_id}
                )
                
                if appointment_doc and "appointments" in appointment_doc:
                    for apt in appointment_doc["appointments"]:
                        if apt.get("appointment_id") == appointment_id:
                            doctor_sys_user_id = apt.get("doctor_id")
                            if doctor_sys_user_id:
                                final_doctor_id = doctor_sys_user_id
                                doctor = await get_doctor_by_id(doctor_sys_user_id)
                                if doctor:
                                    final_doctor_name = doctor.get("name")
                                    final_specialization = doctor.get("specialization")
                                break
            except Exception as e:
                logger.error(f"❌ Error fetching doctor from appointment: {str(e)}")
        
        # ==================== CLEAN PHONE NUMBER ====================
        clean_phone = phone_number
        if phone_number:
            if isinstance(phone_number, str):
                if phone_number.startswith("whatsapp:"):
                    clean_phone = phone_number[len("whatsapp:"):]
                else:
                    clean_phone = phone_number
            logger.info(f"📱 Cleaned phone number: {clean_phone}")
        
        # ==================== CHECK FOR DUPLICATES ====================
        existing_record = await appointment_records_collection.find_one({
            "appointment_id": appointment_id
        })
        
        if existing_record:
            logger.warning(f"⚠️ Appointment record already exists for ID: {appointment_id}")
            logger.info(f"   • Existing source: {existing_record.get('source', 'unknown')}")
            logger.info(f"   • New source: {source}")
            logger.info(f"   • Skipping to avoid duplicate")
            logger.info("╚" + "═" * 78 + "╝")
            return False
        
        # ==================== PREPARE RECORD WITH DOCTOR AND PATIENT INFO ====================
        record = {
            "hms_id": hms_id.strip() if hms_id else None,
            "hospital_id": hospital_id.strip() if hospital_id else None,
            "phone_number": clean_phone,
            "appointment_id": appointment_id,
            "appointment_date": appointment_date,
            "appointment_time": appointment_time,
            "source": source,
            # ==================== DOCTOR FIELDS ====================
            "doctor_id": final_doctor_id,
            "doctor_name": final_doctor_name,
            "specialization": final_specialization,
            # ==================== PATIENT FIELDS - BOTH ID FORMATS ====================
            "patient_sys_user_id": final_patient_sys_user_id,  # This is the sys_user_id
            "patient_id": final_patient_sys_user_id,           # ALSO SAVE AS patient_id for compatibility
            "patient_name": final_patient_name,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }
        
        # Add metadata based on source
        if source == "whatsapp":
            record["metadata"] = {
                "from_number": from_number,
                "body_preview": body[:200] if body else None,
                "booking_method": "chat",
                "platform": "whatsapp"
            }
        elif source == "elevenlabs":
            record["metadata"] = {
                "booking_method": "voice_agent",
                "api_source": "elevenlabs_webhook",
                "platform": "elevenlabs"
            }
        
        # ==================== SAVE TO DATABASE ====================
        result = await appointment_records_collection.insert_one(record)
        
        if result.inserted_id:
            logger.info(f"✅ Appointment record saved successfully!")
            logger.info(f"📋 Record ID: {result.inserted_id}")
            logger.info(f"   • Source: {source}")
            logger.info(f"   • HMS ID: {hms_id}")
            logger.info(f"   • Hospital ID: {hospital_id}")
            logger.info(f"   • Phone: {clean_phone}")
            logger.info(f"   • Appointment ID: {appointment_id}")
            logger.info(f"   • Date: {appointment_date}")
            logger.info(f"   • Time: {appointment_time}")
            # ==================== PATIENT ID LOGGING ====================
            logger.info(f"   • Patient sys_user_id: {final_patient_sys_user_id or 'N/A'}")
            logger.info(f"   • Patient ID (alias): {final_patient_sys_user_id or 'N/A'}")
            logger.info(f"   • Patient Name: {final_patient_name or 'N/A'}")
            # ==================== DOCTOR LOGGING ====================
            logger.info(f"   • Doctor ID: {final_doctor_id or 'N/A'}")
            logger.info(f"   • Doctor Name: {final_doctor_name or 'N/A'}")
            logger.info(f"   • Specialization: {final_specialization or 'N/A'}")
            logger.info("╚" + "═" * 78 + "╝")
            return True
        else:
            logger.error(f"❌ Failed to save appointment record")
            logger.info("╚" + "═" * 78 + "╝")
            return False
            
    except Exception as e:
        logger.error(f"❌ Error saving to database: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        logger.info("╚" + "═" * 78 + "╝")
        return False
# ============================================================
# ============ UPDATED: BOOK APPOINTMENT API ================
# ============================================================

async def book_appointment_api(appointment_data: Dict[str, Any]) -> Dict[str, Any]:
    """Call the appointment booking API endpoint - UPDATED to capture appointment ID properly"""
    try:
        # Extract doctor information
        doctor_info = appointment_data.get("doctor", {})
        
        # Get patient's sys_user_id from patient_info
        patient_info = appointment_data.get("patient_info", {})
        patient_sys_user_id = patient_info.get("sys_user_id", "")
        
        # If patient_info doesn't have sys_user_id, try to get it from the patient_user_collection
        if not patient_sys_user_id and "hms_id" in appointment_data:
            # Fetch patient from database to get their sys_user_id
            patient = await patient_user_collection.find_one({
                "hms_id": appointment_data["hms_id"]
            })
            if patient:
                patient_sys_user_id = patient.get("sys_user_id", "")
        
        # Prepare the data exactly as your API expects
        api_payload = {
            "doctor_id": doctor_info.get("sys_user_id", ""),
            "sys_user_id": patient_sys_user_id,
            "date": appointment_data.get("date", ""),
            "scheduled_time": appointment_data.get("time", ""),
            "visit_type": appointment_data.get("visit_type", "New Visit"),
            "chief_complaint": appointment_data.get("chief_complaint", "")
        }
        
        # Log the payload
        logger.info(f"📤 Calling appointment API with payload: {json.dumps(api_payload, indent=2)}")
        
        # Make the API call to your existing endpoint
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{api_base_url}hms/users/doctors/take_appointment",
                json=api_payload,
                headers={"Content-Type": "application/json"}
            )
            
            # Log response
            logger.info(f"📥 API Response Status: {response.status_code}")
            
            if response.status_code == 200:
                result = response.json()
                logger.info(f"✅ Appointment booked successfully: {result}")
                
                # ==================== IMPROVED APPOINTMENT ID EXTRACTION ====================
                # Try multiple possible field names for appointment_id
                appointment_id = None
                
                # Check common field names
                possible_id_fields = [
                    "appointment_id", 
                    "id", 
                    "appointmentId", 
                    "booking_id", 
                    "bookingId",
                    "reference",
                    "reference_id",
                    "ref_id"
                ]
                
                for field in possible_id_fields:
                    if field in result:
                        appointment_id = result.get(field)
                        logger.info(f"✅ Found appointment_id in field '{field}': {appointment_id}")
                        break
                
                # If not found in top level, check nested structures
                if not appointment_id:
                    if "data" in result and isinstance(result["data"], dict):
                        for field in possible_id_fields:
                            if field in result["data"]:
                                appointment_id = result["data"].get(field)
                                logger.info(f"✅ Found appointment_id in data.{field}: {appointment_id}")
                                break
                    
                    elif "appointment" in result and isinstance(result["appointment"], dict):
                        for field in possible_id_fields:
                            if field in result["appointment"]:
                                appointment_id = result["appointment"].get(field)
                                logger.info(f"✅ Found appointment_id in appointment.{field}: {appointment_id}")
                                break
                
                # If still not found, generate a fallback ID
                if not appointment_id:
                    # Generate a fallback ID based on timestamp and patient info
                    timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
                    hms_id = appointment_data.get("hms_id", "UNKNOWN")
                    appointment_id = f"APT-{hms_id}-{timestamp}"
                    logger.warning(f"⚠️ No appointment_id in API response. Generated fallback: {appointment_id}")
                
                # ==================== END IMPROVED EXTRACTION ====================
                
                return {
                    "success": True,
                    "appointment_id": appointment_id,
                    "appointment_number": result.get("appointment_number") or result.get("booking_number") or result.get("reference_number"),
                    "message": result.get("message", "Appointment booked successfully"),
                    "data": result,
                    # ==================== NEW: DOCTOR DETAILS ====================
                    "doctor_id": doctor_info.get("sys_user_id"),
                    "doctor_name": doctor_info.get("name"),
                    "specialization": doctor_info.get("specialization")
                }
            else:
                error_msg = f"API Error: {response.status_code} - {response.text}"
                logger.error(f"❌ {error_msg}")
                return {
                    "success": False,
                    "error": error_msg,
                    "status_code": response.status_code
                }
                
    except Exception as e:
        error_msg = f"Exception: {str(e)}"
        logger.error(f"❌ {error_msg}")
        return {
            "success": False,
            "error": error_msg
        }
# ============================================================
# ==================== WHATSAPP HANDLERS =====================
# ============================================================

async def send_whatsapp_message(content_variables: str, recipient_number: str):
    """Send WhatsApp message using Twilio API"""
    try:
        # Twilio credentials
        client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

        # Remove the 'whatsapp:' prefix if it exists in the recipient_number
        if recipient_number.startswith("whatsapp:"):
            recipient_number = recipient_number[len("whatsapp:"):]

        # Add 'whatsapp:' prefix here only once
        formatted_recipient_number = f"{recipient_number}"

        # Log the formatted recipient number to ensure it's correct
        logger.info(f"Sending message to: {formatted_recipient_number}")

        # Send the WhatsApp message
        message = client.messages.create(
            from_=f"whatsapp:{TWILIO_WHATSAPP_NUMBER}",  # Twilio WhatsApp number with 'whatsapp:' prefix
            body=content_variables,  # The message content
            to=formatted_recipient_number  # Recipient's WhatsApp number
        )

        logger.info(f"Message sent to {recipient_number} with SID: {message.sid}")
        return {"status": "success", "sid": message.sid}

    except Exception as e:
        logger.error(f"Error sending WhatsApp message: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error sending WhatsApp message: {str(e)}")

async def handle_message_logic(from_number: str, body: str, num_media: int, media_files: list = None) -> str:
    """
    Main logic handler for incoming WhatsApp messages
    Returns: Message to send back to user
    """
    # Remove 'whatsapp:' prefix if present for session key
    session_key = from_number.replace("whatsapp:", "") if from_number.startswith("whatsapp:") else from_number
    
    # ==================== CHECK FOR FOLLOW-UP RESPONSE FIRST ====================
    for session_id, session_data in USER_RESPONSE_SESSIONS.items():
        patient = await patient_user_collection.find_one({"patient_id": session_data.get("patient_id")})
        if patient:
            patient_phone = patient.get("phone_number")
            if patient_phone and session_key in patient_phone:
                logger.info(f"📥 Follow-up response from {session_key} for session {session_id}")
                return await handle_followup_response(session_id, body, session_data)
    
    # Initialize session if not exists
    if session_key not in user_sessions:
        user_sessions[session_key] = {
            "state": ConversationState.MAIN_MENU,
            "data": {},
            "lab_reports": [],
            "appointment_details": {},
            "education_data": {},
            "last_activity": datetime.now()
        }
    
    session = user_sessions[session_key]
    session["last_activity"] = datetime.now()
    session["_key"] = session_key
    
    # Handle media uploads
    if num_media > 0 and media_files:
        logger.info(f"Handling media upload for {session_key}, state: {session['state']}")
        if session["state"] == ConversationState.LAB_REPORTS_UPLOAD:
            return ("📄 *Note:* Lab reports are now uploaded via web link.\n\n"
                    "Please enter your HMS ID to get the upload link.")
        return await handle_media_upload(session_key, session, media_files)
    
    # Get current state
    state = session["state"]
    
    # Check if we're in "no time slots" state or "no doctor dates" state
    if session.get("no_time_slots"):
        logger.info(f"⏰ In no_time_slots state with input: {body}")
        return await handle_no_time_slots(body, session)
    
    if session.get("no_doctor_dates"):
        logger.info(f"📅 In no_doctor_dates state with input: {body}")
        return await handle_no_doctor_dates(body, session)
    
    # Preserve case for HMS ID and DOB input
    if state in [ConversationState.APPOINTMENT_HMS_ID, ConversationState.APPOINTMENT_DOB_VERIFY, ConversationState.LAB_REPORTS_UPLOAD]:
        user_input = body.strip()
        logger.info(f"🔤 Input (preserved case): '{user_input}'")
    else:
        user_input = body.strip().lower()
        logger.info(f"📝 General input (lowercased): '{user_input}'")
    
    # Handle "hi", "hello", "hey" as main menu
    if user_input.lower() in ["hi", "hello", "hey"]:
        session["state"] = ConversationState.MAIN_MENU
        return handle_main_menu("", session)
    
    # If empty message, show current state prompt
    if not user_input:
        return get_state_prompt(session)
    
    logger.info(f"Processing input '{user_input}' for state: {state}")
    
    # ==================== STATE HANDLING ====================
    
    # Appointment choice state (when user has upcoming appointments)
    if state == "appointment_choice":
        logger.info(f"🔄 Processing appointment choice with input: {user_input}")
        return await handle_appointment_choice(user_input.lower(), session)
    
    # Reschedule/new choice states
    elif state == "reschedule_or_new_choice":
        logger.info(f"🔄 Processing reschedule/new choice with input: {user_input}")
        return await handle_reschedule_or_new_choice(user_input.lower(), session)
    
    elif state == "reschedule_or_new_choice_same_doctor":
        logger.info(f"🔄 Processing same-doctor appointment choice with input: {user_input}")
        return await handle_reschedule_or_new_choice_same_doctor(user_input.lower(), session)
    
    # Date generation for appointment selection
    elif state == ConversationState.APPOINTMENT_SELECT_DATE and "available_dates" not in session:
        doctor_info = session.get("appointment_details", {}).get("doctor", {})
        doctor_sys_user_id = doctor_info.get("sys_user_id")
        
        if doctor_sys_user_id:
            available_days = await get_doctor_available_days(doctor_sys_user_id)
            date_message, available_dates = generate_date_selection_message(available_days)
            
            if not date_message:
                doctor_name = doctor_info.get("name", "the doctor")
                opd_timings = await get_doctor_opd_timings(doctor_sys_user_id)
                
                if opd_timings:
                    available_days_list = [timing.get("day", "").strip() for timing in opd_timings]
                    days_text = ", ".join(available_days_list) if available_days_list else "No schedule configured"
                    
                    # Store special state for handling user response
                    session["no_doctor_dates"] = True
                    session["doctor_with_no_dates"] = {
                        "name": doctor_name,
                        "sys_user_id": doctor_sys_user_id
                    }
                    
                    return (f"❌ *No Available Dates*\n\n"
                            f"{doctor_name} is only available on: {days_text}\n\n"
                            f"**Please choose:**\n\n"
                            f"1. 📅 Select a different doctor\n"
                            f"2. 🏥 Return to main menu")
                
                # Store special state for handling user response
                session["no_doctor_dates"] = True
                session["doctor_with_no_dates"] = {
                    "name": doctor_name,
                    "sys_user_id": doctor_sys_user_id
                }
                
                return (f"❌ *No Schedule Found*\n\n"
                        f"{doctor_name} doesn't have an OPD schedule configured.\n\n"
                        f"**Please choose:**\n\n"
                        f"1. 📅 Select a different doctor\n"
                        f"2. 🏥 Return to main menu")
            
            session["available_dates"] = available_dates
            session["date_message"] = date_message
            return date_message
    
    # Main Menu
    elif state == ConversationState.MAIN_MENU:
        return handle_main_menu(user_input.lower(), session)
    
    # Appointment Method
    elif state == ConversationState.APPOINTMENT_METHOD:
        return handle_appointment_method(user_input.lower(), session)
    
    # Lab Reports
    elif state == ConversationState.LAB_REPORTS_UPLOAD:
        return await handle_appointment_hms_id_for_reports(user_input, session)
    
    elif state == ConversationState.LAB_REPORTS_MORE:
        session["state"] = ConversationState.MAIN_MENU
        return handle_main_menu("", session)
    
    # HMS ID and DOB
    elif state == ConversationState.APPOINTMENT_HMS_ID:
        return await handle_appointment_hms_id_with_dob(user_input, session)
    
    elif state == ConversationState.APPOINTMENT_DOB_VERIFY:
        return await handle_appointment_hms_id_with_dob(user_input, session)
    
    # Appointment Verification
    elif state == ConversationState.APPOINTMENT_VERIFY:
        # Check if user wants to reschedule existing appointments
        is_reschedule = session.get("appointment_details", {}).get("is_reschedule", False)
        
        if is_reschedule:
            # User specifically chose to reschedule
            return await check_and_handle_reschedule(session_key, session)
        else:
            # Regular booking flow - handle based on user input
            has_previous_doctor = session.get("appointment_details", {}).get("previous_doctor") is not None
            
            # Handle input based on whether there's a previous doctor
            if user_input == "1":
                if has_previous_doctor:
                    # User chose Previous Doctor
                    previous_doctor = session["appointment_details"].get("previous_doctor")
                    if previous_doctor:
                        session["appointment_details"]["doctor"] = {
                            "doctor_id": previous_doctor.get("doctor_id"),
                            "sys_user_id": previous_doctor.get("sys_user_id"),
                            "name": previous_doctor.get("name"),
                            "specialization": previous_doctor.get("specialization", ""),
                            "qualifications": previous_doctor.get("qualifications", "")
                        }
                        session["state"] = ConversationState.APPOINTMENT_VISIT_TYPE
                        
                        latest_appointment = session["appointment_details"].get("latest_appointment", {})
                        last_visit_date = latest_appointment.get("date", "N/A")
                        last_visit_type = latest_appointment.get("visit_type", "N/A")
                        
                        return (f"👨‍⚕️ *Previous Doctor Selected*\n\n"
                                f"   • Name: {previous_doctor.get('name', 'N/A')}\n"
                                f"   • Specialization: {previous_doctor.get('specialization', 'N/A')}\n"
                                f"   • Qualifications: {previous_doctor.get('qualifications', 'N/A')}\n\n"
                                f"Last visit: {last_visit_date} ({last_visit_type})\n\n"
                                f"*Is this visit a:*\n\n"
                                f"1. 🔄 Follow-up\n"
                                f"2. 🆕 New Visit")
                else:
                    # User chose to select a doctor (no previous doctor)
                    session["state"] = ConversationState.APPOINTMENT_SELECT_SPECIALITY
                    session["available_specialities"] = SPECIALITIES
                    
                    speciality_list = "\n".join([f"{i+1}. {spec}" for i, spec in enumerate(SPECIALITIES)])
                    return (f"🏥 *Select Speciality*\n\n"
                            f"{speciality_list}\n\n"
                            f"Please choose a speciality (1-{len(SPECIALITIES)}):")
            
            elif user_input == "2":
                if has_previous_doctor:
                    # User chose New Doctor
                    session["state"] = ConversationState.APPOINTMENT_SELECT_SPECIALITY
                    session["available_specialities"] = SPECIALITIES
                    
                    speciality_list = "\n".join([f"{i+1}. {spec}" for i, spec in enumerate(SPECIALITIES)])
                    return (f"🏥 *Select Speciality for New Doctor*\n\n"
                            f"{speciality_list}\n\n"
                            f"Please choose a speciality (1-{len(SPECIALITIES)}):")
                else:
                    # User chose Return to Main Menu
                    return handle_cancel_appointment(session)
            
            else:
                # Invalid input - show appropriate options again
                return build_patient_verification_message_after_dob(session)
    
    # Reschedule states
    elif state == ConversationState.RESCHEDULE_CONFIRM_NO_APPOINTMENTS:
        return await handle_reschedule_confirm_no_appointments(user_input.lower(), session)
    
    elif state == ConversationState.RESCHEDULE_CONFIRM:
        return await handle_reschedule_confirm(user_input.lower(), session)
    
    elif state == ConversationState.RESCHEDULE_SELECT_APPOINTMENT:
        return await handle_reschedule_select_appointment(user_input.lower(), session)
    
    elif state == ConversationState.RESCHEDULE_SELECT_DATE:
        return await handle_reschedule_select_date(user_input, session)
    
    elif state == ConversationState.RESCHEDULE_SELECT_TIME:
        return await handle_reschedule_select_time(user_input.lower(), session)
    
    elif state == ConversationState.RESCHEDULE_CONFIRM_CHANGES:
        return await handle_reschedule_confirm_changes(user_input.lower(), session)
    
    # New Appointment Booking States
    elif state == ConversationState.APPOINTMENT_DOCTOR_TYPE:
        return handle_appointment_doctor_type(user_input.lower(), session)
    
    elif state == ConversationState.APPOINTMENT_VISIT_TYPE:
        return await handle_appointment_visit_type(user_input.lower(), session)
    
    elif state == ConversationState.APPOINTMENT_SELECT_SPECIALITY:
        return await handle_appointment_select_speciality(user_input.lower(), session)
    
    elif state == ConversationState.APPOINTMENT_SELECT_DOCTOR:
        return await handle_appointment_select_doctor(user_input.lower(), session)
    
    elif state == ConversationState.APPOINTMENT_SELECT_DATE:
        return await handle_appointment_select_date(user_input, session)
    
    elif state == ConversationState.APPOINTMENT_SELECT_TIME:
        return await handle_appointment_select_time(user_input.lower(), session)
    
    elif state == ConversationState.APPOINTMENT_CHIEF_COMPLAINT:
        return handle_appointment_chief_complaint(user_input, session)
    
    elif state == ConversationState.APPOINTMENT_CONFIRM:
        return await handle_appointment_confirm(user_input.lower(), session)
    
    # Education State
    elif state == ConversationState.EDUCATION_ASK_QUESTION:
        return await handle_education_question(user_input, session, from_number)
    
    # Clinic Registration State
    elif state == ConversationState.CLINIC_REGISTRATION:
        if user_input.lower() in ["menu", "back", "main"]:
            session["state"] = ConversationState.MAIN_MENU
            return ("🏥 *Returning to Main Menu*\n\n"
                    "1. 📄 Upload Lab Reports\n"
                    "2. 📅 Book/Reschedule Appointment\n"
                    "3. 🎓 Ask the Doctor / Health Education\n"
                    "4. 🏥 Register Your Own Clinic\n\n"
                    "_Reply with 1, 2, 3, or 4_")
        else:
            return get_state_prompt(session)
    
    # Default fallback
    return get_state_prompt(session)
def get_state_prompt(session: dict) -> str:
    """Get the appropriate prompt based on current state"""
    state = session["state"]
    
    if state == ConversationState.LAB_REPORTS_UPLOAD:
        return ("📄 *Lab Reports Upload*\n\n"
                "Please enter your *HMS ID*:\n"
                "_Note: HMS ID is case-sensitive_")
    
    elif state == ConversationState.APPOINTMENT_SELECT_TIME:
        current_page = session.get("time_slot_page", 0)
        time_groups = session.get("time_groups", [])
        all_time_slots = session.get("all_time_slots", [])
        display_date = session.get("appointment_details", {}).get("display_date", "Selected Date")
        
        total_pages = len(time_groups)
        
        if time_groups and current_page < total_pages:
            current_display = time_groups[current_page]
            start_index = current_page * 6
            slots_on_page = min(6, len(all_time_slots) - start_index)
            has_next_page = (current_page < total_pages - 1)
            has_previous_page = (current_page > 0)
            
            options_text = "### Options:\n"
            options_text += "- Select time (1-6)\n"
            
            if has_next_page:
                options_text += "- Type '7' for next slots\n"
            
            if has_previous_page:
                options_text += "- Type '8' for previous slots\n"
            
            options_text += "- Type 'back' to change date"
            
            current_time = datetime.now().strftime("%I:%M %p").lstrip("0")
            
            return (f"# Date Selected: {display_date}\n\n"
                    f"## Select Time Slot\n\n"
                    f"{current_display}\n\n"
                    f"{options_text}\n\n"
                    f"{current_time}")
        
        return "Please select a time slot:"
    
    elif state == ConversationState.RESCHEDULE_SELECT_TIME:
        current_page = session.get("time_slot_page", 0)
        time_groups = session.get("time_groups", [])
        all_time_slots = session.get("all_time_slots", [])
        display_date = session.get("new_display_date", "Selected Date")
        
        total_pages = len(time_groups)
        
        if time_groups and current_page < total_pages:
            current_display = time_groups[current_page]
            start_index = current_page * 6
            slots_on_page = min(6, len(all_time_slots) - start_index)
            has_next_page = (current_page < total_pages - 1)
            has_previous_page = (current_page > 0)
            
            options_text = "### Options:\n"
            options_text += "- Select time (1-6)\n"
            
            if has_next_page:
                options_text += "- Type '7' for next slots\n"
            
            if has_previous_page:
                options_text += "- Type '8' for previous slots\n"
            
            options_text += "- Type 'back' to change date"
            
            current_time = datetime.now().strftime("%I:%M %p").lstrip("0")
            
            return (f"# Date Selected: {display_date}\n\n"
                    f"## Select New Time Slot\n\n"
                    f"{current_display}\n\n"
                    f"{options_text}\n\n"
                    f"{current_time}")
        
        return "Please select a time slot:"
    
    elif state == ConversationState.MAIN_MENU:
        return ("🏥 *Main Menu*\n\n"
                "1. 📄 Upload Lab Reports\n"
                "2. 📅 Book/Reschedule Appointment\n"
                "3. 🎓 Ask the Doctor / Health Education\n"
                "4. 🏥 Register Your Own Clinic\n\n"
                "_Reply with 1, 2, 3, or 4_")
    
    elif state == ConversationState.CLINIC_REGISTRATION:
        return ("🏥 *Register Your Own Clinic*\n\n"
                "🔗 *Registration Link:*\n"
                f"{api_base_url}clinic-login\n\n"
                "📋 *Login Credentials:*\n"
                "• Use the same link to login after registration\n"
                "• Create your account to get started\n\n"
                "Click the link above to register now!\n\n"
                "Type 'menu' to return to main menu")
    
    elif state == ConversationState.APPOINTMENT_METHOD:
        return ("📅 *Appointment Services*\n\n"
                "1. 🗣️ Voice Call\n"
                "2. 💬 Chat - Book New Appointment\n"
                "3. 🔄 Chat - Reschedule Appointment\n\n"
                "Reply with 1, 2, or 3")
    
    elif state == ConversationState.LAB_REPORTS_MORE:
        return "Do you want to upload more lab reports?\n\n1. Yes\n2. No"
    
    elif state == ConversationState.APPOINTMENT_HMS_ID:
        is_reschedule = session.get("appointment_details", {}).get("is_reschedule", False)
        if is_reschedule:
            return "🔄 *Appointment Rescheduling*\n\nPlease enter your *HMS ID*:\n_Note: HMS ID is case-sensitive_"
        else:
            return "💬 *Appointment Booking*\n\nPlease enter your *HMS ID*:\n_Note: HMS ID is case-sensitive_"
    
    elif state == ConversationState.APPOINTMENT_DOB_VERIFY:
        return ("🔐 *Date of Birth Verification*\n\n"
                "Please enter your Date of Birth to verify your identity:\n"
                "*Format:* DD-MM-YYYY\n"
                "*Example:* 15-01-1990\n\n"
                "Enter your Date of Birth:")
    
    elif state == ConversationState.APPOINTMENT_VERIFY:
        return "Please choose:\n1. Previous Doctor\n2. New Doctor"
    
    elif state == ConversationState.APPOINTMENT_DOCTOR_TYPE:
        return "Would you like to see a new doctor?\n\n1. Yes\n2. No"
    
    elif state == ConversationState.APPOINTMENT_VISIT_TYPE:
        return "Is this visit a:\n\n1. Follow-up\n2. New Visit"
    
    elif state == ConversationState.APPOINTMENT_SELECT_SPECIALITY:
        specialities = session.get("available_specialities", SPECIALITIES)
        speciality_list = "\n".join([f"{i+1}. {spec}" for i, spec in enumerate(specialities)])
        return f"🏥 *Select Speciality*\n\n{speciality_list}\n\nPlease choose a speciality (1, 2, 3, etc.):"
    
    elif state == ConversationState.APPOINTMENT_SELECT_DOCTOR:
        doctors = session.get("available_doctors", [])
        if not doctors:
            return "❌ No doctors available. Please go back and select a different speciality."
        
        doctor_list = "\n".join([f"{i+1}. {doc.get('name', 'N/A')}" for i, doc in enumerate(doctors)])
        return f"👨‍⚕️ *Select Doctor*\n\n{doctor_list}\n\nPlease select a doctor (1-{len(doctors)}):"

    elif session.get("no_doctor_dates"):
        doctor_info = session.get("doctor_with_no_dates", {})
        doctor_name = doctor_info.get("name", "the selected doctor")
        return (f"❌ *No Dates Available for {doctor_name}*\n\n"
                f"**Please choose:**\n\n"
                f"1. 📅 Select a different doctor\n"
                f"2. 🏥 Return to main menu")
    
    elif state == ConversationState.APPOINTMENT_SELECT_DATE:
        date_message = session.get("date_message")
        if date_message:
            return date_message
    
    elif state == ConversationState.EDUCATION_ASK_QUESTION:
        return ("📝 *Ask Your Health Question*\n\n"
                "What would you like to know about your health?\n\n"
                "_You can ask about:_\n"
                "• Your symptoms or condition\n"
                "• Medications you're taking\n"
                "• Test results\n"
                "• Treatment options\n"
                "• Lifestyle recommendations\n\n"
                "Type your question below (or type 'menu' to return):")
    
    elif state == ConversationState.APPOINTMENT_CHIEF_COMPLAINT:
        return "📝 *Chief Complaint*\n\nPlease describe your main medical concern or symptoms (e.g., fever for 3 days, headache, etc.):"
    
    elif state == ConversationState.APPOINTMENT_CONFIRM:
        return "Please confirm your appointment:\n\n1. ✅ Yes, Confirm\n2. ❌ No, Cancel"
    
    elif state == ConversationState.RESCHEDULE_CONFIRM:
        appointments = session.get("upcoming_appointments", [])
        message = "📋 *Your Upcoming Appointments*\n\n"
        for i, appointment in enumerate(appointments[:3], 1):
            message += f"{i}. {appointment.get('date', 'N/A')} at {appointment.get('scheduled_time', 'N/A')}\n"
        message += "\nWould you like to reschedule any of these appointments?\n\n"
        message += "1. ✅ Yes, reschedule\n"
        message += "2. ❌ No, book new appointment instead"
        return message
    
    elif state == ConversationState.RESCHEDULE_CONFIRM_NO_APPOINTMENTS:
        return ("📋 *No Upcoming Appointments Found*\n\n"
                "You don't have any upcoming appointments to reschedule.\n\n"
                "Would you like to book a new appointment instead?\n\n"
                "1. ✅ Yes, book new appointment\n"
                "2. ❌ No, return to main menu")
    
    elif state == ConversationState.RESCHEDULE_SELECT_APPOINTMENT:
        appointments = session.get("upcoming_appointments", [])
        message = "📋 *Select Appointment to Reschedule*\n\n"
        for i, appointment in enumerate(appointments, 1):
            message += f"{i}. {appointment.get('date', 'N/A')} at {appointment.get('scheduled_time', 'N/A')}\n"
        message += "\nPlease select the appointment number:"
        return message
    
    elif state == ConversationState.RESCHEDULE_SELECT_DATE:
        date_message = session.get("reschedule_date_message")
        if date_message:
            appointment = session.get("selected_appointment", {})
            if appointment:
                message = f"📋 *Selected Appointment*\n\n"
                message += f"*Appointment ID:* {appointment.get('appointment_id', 'N/A')}\n"
                message += f"*Current Date:* {appointment.get('date', 'N/A')}\n"
                message += f"*Current Time:* {appointment.get('scheduled_time', 'N/A')}\n"
                message += f"*Doctor:* {appointment.get('doctor_name', 'N/A')}\n"
                message += f"*Specialization:* {appointment.get('specialization', 'N/A')}\n\n"
                message += "*Select new date:*\n\n"
                message += date_message
                return message
        
        appointment = session.get("selected_appointment", {})
        if appointment:
            return (f"📋 *Selected Appointment*\n\n"
                    f"*Appointment ID:* {appointment.get('appointment_id', 'N/A')}\n"
                    f"*Current Date:* {appointment.get('date', 'N/A')}\n"
                    f"*Current Time:* {appointment.get('scheduled_time', 'N/A')}\n"
                    f"*Doctor:* {appointment.get('doctor_name', 'N/A')}\n"
                    f"*Specialization:* {appointment.get('specialization', 'N/A')}\n\n"
                    f"*Generating available dates...*")
        
        return "❌ No appointment selected. Please start over."
    
    elif state == ConversationState.RESCHEDULE_SELECT_TIME:
        current_page = session.get("time_slot_page", 0)
        time_groups = session.get("time_groups", [])
        all_time_slots = session.get("all_time_slots", [])
        display_date = session.get("new_display_date", "Selected Date")
        
        total_pages = len(time_groups)
        
        if time_groups and current_page < total_pages:
            current_display = time_groups[current_page]
            start_index = current_page * 6
            slots_on_page = min(6, len(all_time_slots) - start_index)
            has_next_page = (current_page < total_pages - 1)
            has_previous_page = (current_page > 0)
            
            options_text = "### Options:\n"
            options_text += "- Select time (1-6)\n"
            
            if has_next_page:
                options_text += "- Type '7' for next slots\n"
            
            if has_previous_page:
                options_text += "- Type '8' for previous slots\n"
            
            options_text += "- Type 'back' to change date"
            
            current_time = datetime.now().strftime("%I:%M %p").lstrip("0")
            
            return (f"# Date Selected: {display_date}\n\n"
                    f"## Select New Time Slot\n\n"
                    f"{current_display}\n\n"
                    f"{options_text}\n\n"
                    f"{current_time}")
        
        return "Please select a time slot:"
    
    elif state == ConversationState.RESCHEDULE_CONFIRM_CHANGES:
        appointment = session.get("selected_appointment", {})
        return (f"📋 *Reschedule Confirmation*\n\n"
                f"Appointment ID: {appointment.get('appointment_id', 'N/A')}\n\n"
                f"Do you want to confirm this reschedule?\n\n"
                f"1. ✅ Yes, confirm reschedule\n"
                f"2. ❌ No, cancel")
    
    return "❌ I didn't understand that. Please try again."

async def handle_media_upload(session_key: str, session: dict, media_files: list) -> str:
    """Handle media uploads (lab reports)"""
    if session["state"] == ConversationState.LAB_REPORTS_UPLOAD:
        # Track uploaded files in session
        for file_info in media_files:
            session["lab_reports"].append({
                "filename": file_info.get("filename"),
                "uploaded_at": datetime.utcnow().isoformat(),
                "file_path": file_info.get("file_path"),
                "count": len(session["lab_reports"]) + 1
            })
        
        session["state"] = ConversationState.LAB_REPORTS_MORE
        report_count = len(session["lab_reports"])
        
        return f"✅ Report {report_count} uploaded successfully!\n\nDo you want to upload more lab reports?\n\n1. Yes\n2. No"
    
    return "Please select an option first before uploading."

# ============================================================
# ============ REPLACE YOUR EXISTING handle_main_menu =======
# ============================================================

def handle_main_menu(user_input: str, session: dict) -> str:
    """Handle main menu selection - UPDATED WITH CLINIC REGISTRATION OPTION"""
    logger.info(f"Handling main menu input: {user_input}")
    
    if user_input == "1":  # Upload Lab Reports
        session["state"] = ConversationState.LAB_REPORTS_UPLOAD
        session["lab_reports"] = []
        session["data"] = {"flow": "lab_reports"}
        return ("📄 *Lab Reports Section*\n\n"
                "Please enter your *HMS ID*:\n"
                "_Note: HMS ID is case-sensitive_")
    
    elif user_input == "2":  # Book/Reschedule Appointment
        session["state"] = ConversationState.APPOINTMENT_METHOD
        session["appointment_details"] = {}
        session["data"] = {"flow": "appointment"}
        return ("📅 *Appointment Services*\n\n"
                "*Please choose:*\n\n"
                "1. 🗣️ *Voice Call* - Talk to our voice agent\n"
                "2. 💬 *Chat* - Book new appointment\n"
                "3. 🔄 *Chat* - Reschedule existing appointment\n\n"
                "_Reply with 1, 2, or 3_")
    
    # ==================== EDUCATION OPTION ====================
    elif user_input == "3":  # Ask the Doctor / Health Education
        session["state"] = ConversationState.APPOINTMENT_HMS_ID
        session["appointment_details"] = {"is_education": True}
        session["education_data"] = {
            "questions_asked": 0,
            "history": []
        }
        return ("🎓 *Ask the Doctor / Health Education*\n\n"
                "I can answer your health questions based on your medical records.\n\n"
                "Please enter your *HMS ID*:\n"
                "_Note: HMS ID is case-sensitive_")
    
    # ==================== CLINIC REGISTRATION OPTION ====================
    elif user_input == "4":  # Register Your Own Clinic
        session["state"] = ConversationState.CLINIC_REGISTRATION
        return ("🏥 *Register Your Own Clinic*\n\n"
                "You can register your clinic and start managing appointments online!\n\n"
                "🔗 *Registration Link:*\n"
                "https://demo.doctorassist.ai/clinic-login\n\n"
                "📋 *Login Credentials:*\n"
                "• Use the same link to login after registration\n"
                "• Create your account to get started\n\n"
                "Click the link above to register now!\n\n"
                "Type 'menu' to return to main menu")
    
    # ==================== RETURN TO MAIN MENU ====================
    elif user_input in ["menu", "back", "main", ""]:
        session["state"] = ConversationState.MAIN_MENU
        return ("🏥 *Main Menu*\n\n"
                "1. 📄 Upload Lab Reports\n"
                "2. 📅 Book/Reschedule Appointment\n"
                "3. 🎓 Ask the Doctor / Health Education\n"
                "4. 🏥 Register Your Own Clinic\n\n"
                "_Reply with 1, 2, 3, or 4_")
    
    # ==================== INVALID INPUT - SHOW MAIN MENU ====================
    else:
        return ("🏥 *Main Menu*\n\n"
                "1. 📄 Upload Lab Reports\n"
                "2. 📅 Book/Reschedule Appointment\n"
                "3. 🎓 Ask the Doctor / Health Education\n"
                "4. 🏥 Register Your Own Clinic\n\n"
                "_Reply with 1, 2, 3, or 4_")


def handle_lab_reports_more(user_input: str, session: dict) -> str:
    """Ask if user wants to upload more lab reports"""
    if user_input == "1" or user_input == "yes":
        session["state"] = ConversationState.LAB_REPORTS_UPLOAD
        return "Please upload your next lab report:"
    
    elif user_input == "2" or user_input == "no":
        session["state"] = ConversationState.MAIN_MENU
        report_count = len(session["lab_reports"])
        
        # Reset lab reports for next time
        session["lab_reports"] = []
        session["data"] = {}
        
        return (f"✅ Successfully uploaded {report_count} lab report(s). "
                f"Our team will review them shortly.\n\n"
                f"🏥 *Main Menu*\n\n"
                f"1. 📄 Upload Lab Reports\n"
                f"2. 📅 Book Appointment\n\n"
                f"Reply with 1 or 2")
    
    return "Please choose:\n1. Yes\n2. No"

def handle_appointment_method(user_input: str, session: dict) -> str:
    """Handle appointment method selection"""
    if user_input == "1":  # Voice
        session["state"] = ConversationState.MAIN_MENU  # Reset to main menu after providing info
        
        voice_agent_url = f"{api_base_url}voice-agent"
        
        return (f"🗣️ *Voice Appointment Agent*\n\n"
                f"This is an appointment agent that will help you book an appointment via voice.\n\n"
                f"🎯 *Please follow this link:*\n"
                f"🔗 {voice_agent_url}\n\n"
                f"*Features:*\n"
                f"• Natural voice conversation\n"
                f"• Easy appointment booking\n"
                f"• Available 24/7\n\n"
                f"🏥 *Main Menu*\n\n"
                f"1. 📄 Upload Lab Reports\n"
                f"2. 📅 Book/Reschedule Another Appointment\n\n"
                f"Reply with 1 or 2")
    
    elif user_input == "2":  # Chat - Book new appointment
        session["state"] = ConversationState.APPOINTMENT_HMS_ID
        session["appointment_details"] = {"is_reschedule": False}
        return ("💬 *Chat Appointment Booking*\n\n"
                "Please enter your *HMS ID*:\n"
                "_Note: HMS ID is case-sensitive_")
    
    elif user_input == "3":  # Chat - Reschedule
        session["state"] = ConversationState.APPOINTMENT_HMS_ID
        session["appointment_details"] = {"is_reschedule": True}
        return ("🔄 *Appointment Rescheduling*\n\n"
                "Please enter your *HMS ID*:\n"
                "_Note: HMS ID is case-sensitive_")
    
    else:
        return ("*Please choose:*\n\n"
                "1. 🗣️ Voice Call\n"
                "2. 💬 Chat - Book New\n"
                "3. 🔄 Chat - Reschedule\n\n"
                "Reply with 1, 2, or 3")

async def handle_appointment_hms_id_for_reports(user_input: str, session: dict) -> str:
    """Handle HMS ID input for report upload - ASYNC version using current appointment"""
    hms_id = user_input.strip()
    
    logger.info(f"📥 HMS ID received for report upload: '{hms_id}'")
    
    if not hms_id:
        return "❌ *Please enter your HMS ID:*"
    
    # Search patient - async call
    patient = await get_patient_by_hms_id(hms_id)
    
    if patient:
        logger.info(f"✅ Patient found for report upload: {patient.get('name')}")
        
        patient_name = patient.get("name", "patient")
        patient_id = patient.get("sys_user_id", "")  # This is the patient_id for URL
        
        if not patient_id:
            session["state"] = ConversationState.MAIN_MENU
            return (f"❌ *Patient ID Missing*\n\n"
                    f"Patient found: {patient_name}\n"
                    f"But patient ID (sys_user_id) is missing.\n\n"
                    f"🏥 *Main Menu*\n\n"
                    f"1. 📄 Upload Lab Reports\n"
                    f"2. 📅 Book/Reschedule Appointment\n\n"
                    f"Reply with 1 or 2")
        
        # Get latest appointment to find the current doctor
        latest_appointment = await get_latest_appointment(patient.get("patient_id"))
        
        if latest_appointment:
            doctor_sys_user_id = latest_appointment.get("doctor_id")
            appointment_date = latest_appointment.get("date", "recent")
            
            logger.info(f"🔍 Latest appointment found with doctor_id: '{doctor_sys_user_id}'")
            
            if doctor_sys_user_id:
                # Get doctor details
                doctor = await get_doctor_by_id(doctor_sys_user_id)
                
                if doctor:
                    doctor_name = doctor.get("name", "Your Doctor")
                    doctor_id = doctor.get("sys_user_id", "")  # This is the doctor_id for URL
                    
                    if not doctor_id:
                        session["state"] = ConversationState.MAIN_MENU
                        return (f"❌ *Doctor ID Missing*\n\n"
                                f"Doctor found: {doctor_name}\n"
                                f"But doctor ID (sys_user_id) is missing.\n\n"
                                f"🏥 *Main Menu*\n\n"
                                f"1. 📄 Upload Lab Reports\n"
                                f"2. 📅 Book/Reschedule Appointment\n\n"
                                f"Reply with 1 or 2")
                    
                    # Generate the report upload link with current appointment's doctor
                    upload_url = f"{api_base_url}report-upload?doctor_id={doctor_id}&patient_id={patient_id}"
                    
                    session["state"] = ConversationState.MAIN_MENU
                    session["lab_reports"] = []
                    session["data"] = {}
                    
                    return (f"📄 *Lab Reports Upload*\n\n"
                            f"✅ *Patient Verified:* {patient_name}\n"
                            f"👨‍⚕️ *Doctor:* {doctor_name}\n"
                            f"📅 *Last Visit:* {appointment_date}\n\n"
                            f"To upload lab reports for your recent consultation, please use this link:\n\n"
                            f"🔗 {upload_url}\n\n"
                            f"*Instructions:*\n"
                            f"1. Click the link above\n"
                            f"2. Select the report files to upload\n"
                            f"3. Submit the form\n"
                            f"4. Reports will be sent to {doctor_name}\n\n"
                            f"🏥 *Main Menu*\n\n"
                            f"1. 📄 Upload Lab Reports\n"
                            f"2. 📅 Book/Reschedule Appointment\n\n"
                            f"Reply with 1 or 2")
        
        # If no latest appointment found, check for upcoming appointments
        upcoming_appointments = await get_upcoming_appointments(hms_id)
        
        if upcoming_appointments and len(upcoming_appointments) > 0:
            # Use the next upcoming appointment's doctor
            next_appointment = upcoming_appointments[0]
            doctor_sys_user_id = next_appointment.get("doctor_id")
            appointment_date = next_appointment.get("date", "upcoming")
            
            if doctor_sys_user_id:
                # Get doctor details
                doctor = await get_doctor_by_id(doctor_sys_user_id)
                
                if doctor:
                    doctor_name = doctor.get("name", "Your Doctor")
                    doctor_id = doctor.get("sys_user_id", "")  # This is the doctor_id for URL
                    
                    if not doctor_id:
                        session["state"] = ConversationState.MAIN_MENU
                        return (f"❌ *Doctor ID Missing*\n\n"
                                f"Doctor found: {doctor_name}\n"
                                f"But doctor ID (sys_user_id) is missing.\n\n"
                                f"🏥 *Main Menu*\n\n"
                                f"1. 📄 Upload Lab Reports\n"
                                f"2. 📅 Book/Reschedule Appointment\n\n"
                                f"Reply with 1 or 2")
                    
                    # Generate the report upload link with upcoming appointment's doctor
                    upload_url = f"{api_base_url}report-upload?doctor_id={doctor_id}&patient_id={patient_id}"
                    
                    session["state"] = ConversationState.MAIN_MENU
                    session["lab_reports"] = []
                    session["data"] = {}
                    
                    return (f"📄 *Lab Reports Upload*\n\n"
                            f"✅ *Patient Verified:* {patient_name}\n"
                            f"👨‍⚕️ *Doctor:* {doctor_name}\n"
                            f"📅 *Upcoming Appointment:* {appointment_date}\n\n"
                            f"To upload lab reports before your appointment, please use this link:\n\n"
                            f"🔗 {upload_url}\n\n"
                            f"*Instructions:*\n"
                            f"1. Click the link above\n"
                            f"2. Select the report files to upload\n"
                            f"3. Submit the form\n"
                            f"4. Reports will be reviewed before your appointment\n\n"
                            f"🏥 *Main Menu*\n\n"
                            f"1. 📄 Upload Lab Reports\n"
                            f"2. 📅 Book/Reschedule Appointment\n\n"
                            f"Reply with 1 or 2")
        
        # If no appointments found at all, we cannot generate the link
        logger.info(f"⚠️ No appointments found for patient, cannot generate report upload link")
        
        session["state"] = ConversationState.MAIN_MENU
        return (f"❌ *Cannot Generate Upload Link*\n\n"
                f"✅ *Patient Verified:* {patient_name}\n\n"
                f"*Reason:* No appointment history found.\n\n"
                f"*Solution:*\n"
                f"1. Book an appointment first\n"
                f"2. Then you can upload reports for that doctor\n\n"
                f"🏥 *Main Menu*\n\n"
                f"1. 📄 Upload Lab Reports\n"
                f"2. 📅 Book/Reschedule Appointment\n\n"
                f"Reply with 1 or 2")
    else:
        session["state"] = ConversationState.MAIN_MENU
        return (f"🔍 *HMS ID: {hms_id}*\n\n"
                f"❌ *Not found in our records.*\n\n"
                f"*Please check:*\n"
                f"• Case doesn't matter\n\n"
                f"🏥 *Main Menu*\n\n"
                f"1. 📄 Upload Lab Reports\n"
                f"2. 📅 Book/Reschedule Appointment\n\n"
                f"Reply with 1 or 2")

# ============================================================
# ============ REPLACE YOUR EXISTING handle_appointment_hms_id_with_dob =
# ============================================================

async def handle_appointment_hms_id_with_dob(user_input: str, session: dict) -> str:
    """
    Consolidated function that handles both HMS ID input and DOB verification
    UPDATED: Fixed state transition to eliminate the HMS ID/DOB loop
    """
    # Get current state from session
    current_state = session["state"]
    hms_id = session["appointment_details"].get("hms_id", "").strip()
    
    logger.info(f"📥 State: {current_state}, HMS ID in session: '{hms_id}', User input: '{user_input}'")
    
    # ==================== STAGE 1: HMS ID INPUT ====================
    if current_state == ConversationState.APPOINTMENT_HMS_ID:
        # User is entering HMS ID
        input_hms_id = user_input.strip()
        
        if not input_hms_id:
            return "❌ *Please enter your HMS ID:*"
        
        logger.info(f"🔍 Searching for patient with HMS ID: '{input_hms_id}'")
        
        # Search patient - async call
        patient = await get_patient_by_hms_id(input_hms_id)
        
        if patient:
            # Store HMS ID and patient info temporarily
            session["appointment_details"]["hms_id"] = input_hms_id
            session["appointment_details"]["temp_patient_info"] = patient
            
            # ==================== CHECK IF THIS IS FOR EDUCATION ====================
            if session["appointment_details"].get("is_education"):
                # EDUCATION FLOW - Skip DOB, go directly to question
                session["appointment_details"]["patient_info"] = patient
                session["appointment_details"]["dob_verified"] = False
                session["appointment_details"].pop("temp_patient_info", None)
                
                # Initialize education data
                session["education_data"] = {
                    "patient_info": {
                        "hms_id": input_hms_id,
                        "patient_id": patient.get("sys_user_id"),
                        "patient_name": patient.get("name", "Patient"),
                        "phone_number": patient.get("phone_number"),
                        "hospital_id": patient.get("hospital_id")
                    },
                    "questions_asked": 0
                }
                
                session["state"] = ConversationState.EDUCATION_ASK_QUESTION
                
                patient_name = patient.get("name", "Patient")
                first_name = patient_name.split()[0] if patient_name else "there"
                
                return (f"👋 Hello {first_name}!\n\n"
                        f"🩺 *I'm your virtual health educator*\n\n"
                        f"I have access to your medical records and can answer questions about:\n"
                        f"• Your symptoms and condition\n"
                        f"• Medications you're taking\n"
                        f"• Test results and what they mean\n"
                        f"• Treatment options\n"
                        f"• Lifestyle recommendations\n\n"
                        f"📝 *What would you like to ask me today?*\n\n"
                        f"Please type your question below:")
            
            # ==================== REGULAR APPOINTMENT FLOW ====================
            # Get patient's DOB
            patient_dob = patient.get("date_of_birth")
            patient_name = patient.get("name", "Patient")
            
            if not patient_dob:
                # If DOB is not available in database, we cannot proceed
                logger.warning(f"⚠️ DOB not found for patient: {patient_name}")
                
                session["state"] = ConversationState.MAIN_MENU
                session["appointment_details"] = {}
                
                return (f"❌ *Cannot Verify Identity*\n\n"
                        f"Patient found: {patient_name}\n"
                        f"But Date of Birth information is not available in our records.\n\n"
                        f"*Please contact the hospital directly for assistance.*\n\n"
                        f"🏥 *Main Menu*\n\n"
                        f"1. 📄 Upload Lab Reports\n"
                        f"2. 📅 Book/Reschedule Appointment\n"
                        f"3. 🎓 Ask the Doctor / Health Education\n\n"
                        f"Reply with 1, 2, or 3")
            else:
                # Store expected DOB for verification
                session["appointment_details"]["expected_dob"] = patient_dob
                session["state"] = ConversationState.APPOINTMENT_DOB_VERIFY
                
                logger.info(f"✅ Patient found. Asking for DOB verification.")
                logger.info(f"📅 Expected DOB in database: {patient_dob}")
                
                return ("🔐 *Date of Birth Verification*\n\n"
                        f"Patient found for HMS ID: {input_hms_id}\n\n"
                        "For security purposes, please verify your identity by entering your Date of Birth.\n\n"
                        "*Format:* DD-MM-YYYY\n"
                        "*Example:* 15-01-1990\n\n"
                        "Enter your Date of Birth:")
        else:
            # Patient not found - offer retry or cancel
            session["appointment_details"]["is_new_patient"] = True
            
            # Store the failed HMS ID for context
            session["appointment_details"]["failed_hms_id"] = input_hms_id
            
            # Don't change state - stay in APPOINTMENT_HMS_ID to allow retry
            # But offer clear options
            return (f"🔍 *HMS ID: {input_hms_id}*\n\n"
                    f"❌ *Not found in our records.*\n\n"
                    f"*Please check:*\n"
                    f"• Case doesn't matter\n\n"
                    f"*Options:*\n\n"
                    f"1. 🔄 Try different HMS ID\n"
                    f"2. ❌ Cancel and return to main menu\n\n"
                    f"Reply with 1 or 2")
    
    # ==================== STAGE 2: DOB VERIFICATION ====================
    elif current_state == ConversationState.APPOINTMENT_DOB_VERIFY:
        # User is entering DOB for verification
        dob_input = user_input.strip()
        
        # Check if user wants to go back or cancel
        if dob_input.lower() in ["back", "cancel", "menu", "main"]:
            session["state"] = ConversationState.MAIN_MENU
            session["appointment_details"] = {}
            return ("❌ Verification cancelled.\n\n"
                    "🏥 *Main Menu*\n\n"
                    "1. 📄 Upload Lab Reports\n"
                    "2. 📅 Book/Reschedule Appointment\n"
                    "3. 🎓 Ask the Doctor / Health Education\n\n"
                    "Reply with 1, 2, or 3")
        
        # Validate DOB format (DD-MM-YYYY)
        dob_pattern = r"^\d{2}-\d{2}-\d{4}$"
        if not re.match(dob_pattern, dob_input):
            return ("❌ *Invalid Date Format*\n\n"
                    "Please enter your Date of Birth in the correct format:\n"
                    "*Format:* DD-MM-YYYY\n"
                    "*Example:* 15-01-1990\n\n"
                    "Or type 'back' to return to main menu\n\n"
                    "Enter your Date of Birth:")
        
        # Get expected DOB from session (in YYYY-MM-DD format from database)
        expected_dob = session["appointment_details"].get("expected_dob")
        
        if not expected_dob:
            logger.error("❌ Expected DOB not found in session")
            session["state"] = ConversationState.MAIN_MENU
            session["appointment_details"] = {}
            
            return ("❌ *System Error*\n\n"
                    "Date of Birth information not found. Please start over.\n\n"
                    "🏥 *Main Menu*\n\n"
                    "1. 📄 Upload Lab Reports\n"
                    "2. 📅 Book/Reschedule Appointment\n"
                    "3. 🎓 Ask the Doctor / Health Education\n\n"
                    "Reply with 1, 2, or 3")
        
        # Convert user input from DD-MM-YYYY to YYYY-MM-DD for comparison
        try:
            # Parse user input (DD-MM-YYYY)
            day, month, year = dob_input.split("-")
            
            # Validate day and month
            day_int = int(day)
            month_int = int(month)
            year_int = int(year)
            
            # Basic validation
            if day_int < 1 or day_int > 31:
                return ("❌ *Invalid Day*\n\n"
                        f"Day '{day}' is not valid. Day must be between 01 and 31.\n\n"
                        "Enter your Date of Birth (DD-MM-YYYY):")
            
            if month_int < 1 or month_int > 12:
                return ("❌ *Invalid Month*\n\n"
                        f"Month '{month}' is not valid. Month must be between 01 and 12.\n\n"
                        "Enter your Date of Birth (DD-MM-YYYY):")
            
            if year_int < 1900 or year_int > datetime.now().year:
                return (f"❌ *Invalid Year*\n\n"
                        f"Year '{year}' is not valid. Year must be between 1900 and {datetime.now().year}.\n\n"
                        "Enter your Date of Birth (DD-MM-YYYY):")
            
            # Convert to YYYY-MM-DD format for comparison
            normalized_input = f"{year}-{month.zfill(2)}-{day.zfill(2)}"
            
        except ValueError as e:
            logger.error(f"❌ Error parsing DOB '{dob_input}': {e}")
            return ("❌ *Invalid Date*\n\n"
                    "Please enter a valid date in DD-MM-YYYY format.\n\n"
                    "*Example:* 15-01-1990\n\n"
                    "Enter your Date of Birth:")
        
        logger.info(f"🔐 DOB Verification - Input (user): '{dob_input}'")
        logger.info(f"🔐 DOB Verification - Input (converted): '{normalized_input}'")
        logger.info(f"🔐 DOB Verification - Expected: '{expected_dob}'")
        
        # Compare DOBs (both should now be in YYYY-MM-DD format)
        if normalized_input == expected_dob:
            logger.info("✅ DOB verification successful")
            
            # Store patient info from temp storage
            patient = session["appointment_details"].get("temp_patient_info")
            if patient:
                session["appointment_details"]["patient_info"] = patient
                session["appointment_details"]["dob_verified"] = True
                session["appointment_details"].pop("temp_patient_info", None)
                session["appointment_details"].pop("expected_dob", None)
                session["appointment_details"].pop("dob_failed_attempts", None)  # Clear failed attempts
            
            return await proceed_to_next_step_after_dob(session)
        else:
            logger.warning(f"❌ DOB verification failed")
            
            # Count failed attempts
            failed_attempts = session["appointment_details"].get("dob_failed_attempts", 0) + 1
            session["appointment_details"]["dob_failed_attempts"] = failed_attempts
            
            if failed_attempts >= 3:
                # Too many failed attempts, return to main menu
                session["state"] = ConversationState.MAIN_MENU
                session["appointment_details"] = {}
                
                return ("❌ *Too Many Failed Attempts*\n\n"
                        "For security reasons, we cannot proceed with the appointment booking.\n"
                        "Please contact the hospital directly for assistance.\n\n"
                        "🏥 *Main Menu*\n\n"
                        "1. 📄 Upload Lab Reports\n"
                        "2. 📅 Book/Reschedule Appointment\n"
                        "3. 🎓 Ask the Doctor / Health Education\n\n"
                        "Reply with 1, 2, or 3")
            else:
                attempts_left = 3 - failed_attempts
                return (f"❌ *Date of Birth Does Not Match*\n\n"
                        f"The entered Date of Birth does not match our records.\n"
                        f"You have {attempts_left} more attempt(s) left.\n\n"
                        "Please re-enter your Date of Birth:\n"
                        "*Format:* DD-MM-YYYY\n"
                        "*Example:* 15-01-1990\n\n"
                        "Or type 'back' to cancel\n\n"
                        "Enter your Date of Birth:")
    
    # ==================== STAGE 3: HANDLE RETRY/CANCEL FROM HMS ID FAILURE ====================
    elif current_state == ConversationState.APPOINTMENT_HMS_ID and session["appointment_details"].get("is_new_patient"):
        # This handles the "Try different HMS ID" option
        if user_input == "1":  # Try different HMS ID
            # Clear the failed flag and stay in HMS ID state for new input
            session["appointment_details"]["is_new_patient"] = False
            session["appointment_details"].pop("failed_hms_id", None)
            return "Please re-enter your HMS ID exactly as it appears:"
        
        elif user_input == "2":  # Cancel
            session["state"] = ConversationState.MAIN_MENU
            session["appointment_details"] = {}
            return ("❌ Cancelled.\n\n"
                    "🏥 *Main Menu*\n\n"
                    "1. 📄 Upload Lab Reports\n"
                    "2. 📅 Book/Reschedule Appointment\n"
                    "3. 🎓 Ask the Doctor / Health Education\n\n"
                    "Reply with 1, 2, or 3")
        else:
            # Invalid option, show options again
            failed_hms_id = session["appointment_details"].get("failed_hms_id", "Unknown")
            return (f"🔍 *HMS ID: {failed_hms_id}*\n\n"
                    f"❌ *Not found in our records.*\n\n"
                    f"*Options:*\n\n"
                    f"1. 🔄 Try different HMS ID\n"
                    f"2. ❌ Cancel and return to main menu\n\n"
                    f"Reply with 1 or 2")
    
    # If we get here with an invalid state, reset to main menu
    session["state"] = ConversationState.MAIN_MENU
    session["appointment_details"] = {}
    return ("❌ Invalid state. Please start over.\n\n"
            "🏥 *Main Menu*\n\n"
            "1. 📄 Upload Lab Reports\n"
            "2. 📅 Book/Reschedule Appointment\n"
            "3. 🎓 Ask the Doctor / Health Education\n\n"
            "Reply with 1, 2, or 3")

async def proceed_to_next_step_after_dob(session: dict) -> str:
    """
    Proceed to the appropriate next step after DOB verification/skip
    UPDATED: Ensures doctor is stored for same-doctor check
    """
    # Check if this is for rescheduling
    is_reschedule = session["appointment_details"].get("is_reschedule", False)
    
    if is_reschedule:
        # Check for upcoming appointments
        hms_id = session["appointment_details"].get("hms_id")
        upcoming_appointments = await get_upcoming_appointments(hms_id)
        
        if not upcoming_appointments:
            # No appointments found
            session["state"] = ConversationState.RESCHEDULE_CONFIRM_NO_APPOINTMENTS
            session["upcoming_appointments"] = []
            
            return ("📋 *No Upcoming Appointments Found*\n\n"
                    "You don't have any upcoming appointments to reschedule.\n\n"
                    "Would you like to book a new appointment instead?\n\n"
                    "1. ✅ Yes, book new appointment\n"
                    "2. ❌ No, return to main menu")
        
        # Store appointments and move to reschedule confirmation
        session["upcoming_appointments"] = upcoming_appointments
        session["state"] = ConversationState.RESCHEDULE_CONFIRM
        
        # Build appointment list
        message = "📋 *Your Upcoming Appointments*\n\n"
        for i, appointment in enumerate(upcoming_appointments, 1):
            message += f"{i}. *Appointment ID:* {appointment.get('appointment_id', 'N/A')}\n"
            message += f"   • Date: {appointment.get('date', 'N/A')}\n"
            message += f"   • Time: {appointment.get('scheduled_time', 'N/A')}\n"
            message += f"   • Doctor: {appointment.get('doctor_name', 'N/A')}\n"
            message += f"   • Status: {appointment.get('status', 'N/A').title()}\n\n"
        
        message += "Would you like to reschedule any of these appointments?\n\n"
        message += "1. ✅ Yes, reschedule\n"
        message += "2. ❌ No, return to main menu"
        
        return message
    else:
        # Regular appointment booking flow
        session["state"] = ConversationState.APPOINTMENT_VERIFY
        
        # Get patient info
        patient = session["appointment_details"].get("patient_info")
        
        if not patient:
            return "❌ Patient information not found. Please start over."
        
        # Get latest appointment
        latest_appointment = await get_latest_appointment(patient["patient_id"])
        
        if latest_appointment:
            doctor_sys_user_id = latest_appointment.get("doctor_id")
            logger.info(f"🔍 Looking for doctor with sys_user_id: '{doctor_sys_user_id}'")
            
            previous_doctor = None
            if doctor_sys_user_id:
                previous_doctor = await get_doctor_by_id(doctor_sys_user_id)
            
            session["appointment_details"]["previous_doctor"] = previous_doctor
            session["appointment_details"]["latest_appointment"] = latest_appointment
            session["appointment_details"]["doctor_sys_user_id"] = doctor_sys_user_id
        
        # Build verification message
        return build_patient_verification_message_after_dob(session)


async def handle_appointment_verify(user_input: str, session: dict) -> str:
    """Handle verification response - FIXED for patients with no previous appointments"""
    
    # Handle re-entry option (for not found patients)
    if "is_new_patient" in session["appointment_details"]:
        if user_input == "1":  # Re-enter HMS ID
            session["state"] = ConversationState.APPOINTMENT_HMS_ID
            session["appointment_details"] = {"is_reschedule": False}
            return "Please re-enter your HMS ID exactly as it appears:"
        elif user_input == "2":  # Cancel
            return handle_cancel_appointment(session)
    
    # Get patient info
    patient = session["appointment_details"].get("patient_info")
    hms_id = session.get("appointment_details", {}).get("hms_id")
    
    if not patient or not hms_id:
        return "❌ Patient information not found. Please start over."
    
    # Check if user has upcoming/future appointments
    upcoming_appointments = await get_upcoming_appointments(hms_id)
    
    if upcoming_appointments:
        # Store all upcoming appointments
        session["upcoming_appointments"] = upcoming_appointments
        
        # Show the message with options
        message = "📋 *You have upcoming appointments!*\n\n"
        for i, appointment in enumerate(upcoming_appointments[:5], 1):
            message += f"{i}. {appointment.get('date', 'N/A')} at {appointment.get('scheduled_time', 'N/A')}\n"
            message += f"   Doctor: {appointment.get('doctor_name', 'N/A')}\n\n"
        
        message += "What would you like to do?\n\n"
        message += "1. 🔄 Reschedule an existing appointment (same doctor)\n"
        message += "2. 📅 Book a NEW appointment with a DIFFERENT doctor\n\n"
        message += "_Reply with 1 or 2_"
        
        # Set state to handle the choice
        session["state"] = "appointment_choice"
        return message
    
    # ============ NO UPCOMING APPOINTMENTS - CHECK FOR PREVIOUS DOCTOR ============
    # Get latest appointment for previous doctor option
    latest_appointment = await get_latest_appointment(patient["patient_id"])
    
    previous_doctor = None
    if latest_appointment and latest_appointment.get("doctor_id"):
        doctor_sys_user_id = latest_appointment.get("doctor_id")
        logger.info(f"🔍 Looking for doctor with sys_user_id: '{doctor_sys_user_id}'")
        previous_doctor = await get_doctor_by_id(doctor_sys_user_id)
        
        if previous_doctor:
            session["appointment_details"]["previous_doctor"] = previous_doctor
            session["appointment_details"]["latest_appointment"] = latest_appointment
            session["appointment_details"]["doctor_sys_user_id"] = doctor_sys_user_id
            logger.info(f"✅ Found previous doctor: {previous_doctor.get('name')}")
    
    # Build verification message (will show appropriate options)
    return build_patient_verification_message_after_dob(session)

def handle_appointment_doctor_type(user_input: str, session: dict) -> str:
    """Handle doctor type selection"""
    if user_input == "1":  # Yes, see new doctor
        session["state"] = ConversationState.APPOINTMENT_SELECT_SPECIALITY
        session["available_specialities"] = SPECIALITIES
        
        speciality_list = "\n".join([f"{i+1}. {spec}" for i, spec in enumerate(SPECIALITIES)])
        
        return f"🏥 *Select Speciality*\n\n{speciality_list}\n\nPlease choose a speciality (1, 2, 3, etc.):"
    else:  # No
        return handle_cancel_appointment(session)

async def handle_appointment_visit_type(user_input: str, session: dict) -> str:
    """Handle visit type selection for NEW appointments"""
    if user_input == "1":  # Follow-up
        session["appointment_details"]["visit_type"] = "follow-up"
    elif user_input == "2":  # New Visit
        session["appointment_details"]["visit_type"] = "new visit"
    else:
        return "Please choose:\n1. Follow-up\n2. New Visit"
    
    # After selecting visit type, generate filtered dates
    session["state"] = ConversationState.APPOINTMENT_SELECT_DATE
    
    # Get doctor info
    doctor_info = session.get("appointment_details", {}).get("doctor", {})
    doctor_sys_user_id = doctor_info.get("sys_user_id")
    doctor_name = doctor_info.get("name", "the doctor")
    
    if not doctor_sys_user_id:
        return "❌ Doctor information not found. Please start over."
    
    # Clear any existing date data
    session.pop("available_dates", None)
    session.pop("date_message", None)
    
    # Get doctor's available days
    available_days = await get_doctor_available_days(doctor_sys_user_id)
    
    # Generate filtered date selection (7 days for new appointments)
    date_message, available_dates = generate_date_selection_message(available_days)
    
    if not date_message:
        # No available dates for this doctor
        logger.info(f"❌ No available dates for doctor {doctor_name}")
        
        # Get doctor's OPD schedule to show which days they are available
        opd_timings = await get_doctor_opd_timings(doctor_sys_user_id)
        
        if opd_timings:
            # Extract available days from OPD timings
            available_days_list = []
            for timing in opd_timings:
                day = timing.get("day", "").strip()
                if day:
                    available_days_list.append(day)
            
            if available_days_list:
                days_text = ", ".join(available_days_list)
                message = (f"❌ *No Available Dates for {doctor_name}*\n\n"
                          f"Dr. {doctor_name} is only available on:\n"
                          f"**{days_text}**\n\n"
                          f"*Unfortunately, there are no available slots on these days in the next 7 days.*\n\n"
                          f"**Please choose:**\n\n"
                          f"1. 📅 Select a different doctor\n"
                          f"2. 🏥 Return to main menu")
            else:
                message = (f"❌ *No Available Dates for {doctor_name}*\n\n"
                          f"Dr. {doctor_name} doesn't have any available dates in the next 7 days.\n\n"
                          f"**Please choose:**\n\n"
                          f"1. 📅 Select a different doctor\n"
                          f"2. 🏥 Return to main menu")
        else:
            # No OPD timings configured
            message = (f"❌ *No Schedule Found*\n\n"
                      f"Dr. {doctor_name} doesn't have an OPD schedule configured.\n\n"
                      f"**Please choose:**\n\n"
                      f"1. 📅 Select a different doctor\n"
                      f"2. 🏥 Return to main menu")
        
        # Store special state for handling user response
        session["no_doctor_dates"] = True
        session["doctor_with_no_dates"] = {
            "name": doctor_name,
            "sys_user_id": doctor_sys_user_id
        }
        
        return message
    
    # Store available dates in session
    session["available_dates"] = available_dates
    session["date_message"] = date_message
    
    logger.info(f"✅ Found {len(available_dates)} available dates for doctor {doctor_name}")
    return date_message

async def handle_appointment_select_speciality(user_input: str, session: dict) -> str:
    """Handle speciality selection for NEW appointments - UPDATED"""
    try:
        choice = int(user_input) - 1
        
        # Get specialities from session
        specialities = session.get("available_specialities", SPECIALITIES)
        
        if 0 <= choice < len(specialities):
            selected_speciality = specialities[choice]
            session["appointment_details"]["speciality"] = selected_speciality
            session["state"] = ConversationState.APPOINTMENT_SELECT_DOCTOR
            
            # Get HMS_ID from session
            hms_id = session["appointment_details"].get("hms_id")
            
            if not hms_id:
                logger.error(f"❌ HMS_ID not found in session for speciality selection")
                session["state"] = ConversationState.APPOINTMENT_SELECT_SPECIALITY
                return ("❌ Patient information missing. "
                        "Please start the appointment booking process again.")
            
            # Get patient's hospital_id first
            logger.info(f"🔍 Getting hospital_id for patient with HMS_ID: '{hms_id}'")
            patient_hospital_id = await get_hospital_id_from_patient(hms_id)
            
            if not patient_hospital_id:
                logger.error(f"❌ Could not find hospital_id for patient with HMS_ID: '{hms_id}'")
                session["state"] = ConversationState.APPOINTMENT_SELECT_SPECIALITY
                
                # Get patient info for error message
                patient = await get_patient_by_hms_id(hms_id)
                patient_name = patient.get("name", "Patient") if patient else "Patient"
                
                return (f"❌ *Hospital Information Missing*\n\n"
                        f"Sorry {patient_name}, we couldn't find your hospital information.\n\n"
                        f"**Please contact the hospital directly or try again.**\n\n"
                        f"🏥 *Main Menu*\n\n"
                        f"1. 📄 Upload Lab Reports\n"
                        f"2. 📅 Book Appointment\n\n"
                        f"Reply with 1 or 2")
            
            logger.info(f"✅ Hospital ID found: '{patient_hospital_id}'")
            
            # Get doctors from database with hospital filtering
            logger.info(f"🔍 Getting doctors for speciality '{selected_speciality}' at hospital '{patient_hospital_id}'")
            doctors = await get_doctors_by_speciality(selected_speciality, patient_hospital_id)
            
            if doctors:
                # Store doctors in session
                session["available_doctors"] = doctors
                
                # Log for debugging
                logger.info(f"✅ Found {len(doctors)} doctors for {selected_speciality} at hospital {patient_hospital_id}")
                for i, doc in enumerate(doctors):
                    logger.info(f"   {i+1}. {doc.get('name')} (Hospital ID: {doc.get('hospital_id', 'N/A')})")
                
                # Create doctor list for display
                doctor_options = [
                    f"{i+1}. {doc.get('name', 'N/A')}" + 
                    (f" ({doc.get('qualifications', '')})" if doc.get('qualifications') else "")
                    for i, doc in enumerate(doctors)
                ]
                
                doctor_list = "\n".join(doctor_options)
                
                return (f"👨‍⚕️ *Doctors in {selected_speciality} at your hospital*\n\n"
                        f"{doctor_list}\n\n"
                        f"Please select a doctor (1-{len(doctors)}):")
            else:
                # No doctors found - go back to speciality selection
                session["state"] = ConversationState.APPOINTMENT_SELECT_SPECIALITY
                
                # Get patient info for better error message
                patient = await get_patient_by_hms_id(hms_id)
                patient_name = patient.get("name", "Patient") if patient else "Patient"
                
                speciality_list = "\n".join([f"{i+1}. {spec}" for i, spec in enumerate(specialities)])
                
                return (f"❌ *No Doctors Available*\n\n"
                        f"Sorry {patient_name},\n"
                        f"Currently there are no {selected_speciality} doctors available at your hospital.\n\n"
                        f"**Please choose another speciality:**\n\n"
                        f"{speciality_list}\n\n"
                        f"Reply with 1-{len(specialities)}")
        else:
            speciality_list = "\n".join([f"{i+1}. {spec}" for i, spec in enumerate(specialities)])
            return (f"❌ Invalid choice. Please select a valid number (1-{len(specialities)}).\n\n"
                    f"🏥 *Select Speciality*\n\n"
                    f"{speciality_list}\n\n"
                    f"Please choose a speciality (1-{len(specialities)}):")
    except ValueError:
        specialities = session.get("available_specialities", SPECIALITIES)
        speciality_list = "\n".join([f"{i+1}. {spec}" for i, spec in enumerate(specialities)])
        return (f"❌ Please enter a valid number.\n\n"
                f"🏥 *Select Speciality*\n\n"
                f"{speciality_list}\n\n"
                f"Please choose a speciality (1-{len(specialities)}):")
        
async def handle_appointment_select_doctor(user_input: str, session: dict) -> str:
    """Handle doctor selection for NEW appointments - FIXED"""
    try:
        # Get doctors list from session
        doctors = session.get("available_doctors", [])
        
        if not doctors:
            logger.error("❌ No doctors available in session")
            session["state"] = ConversationState.APPOINTMENT_SELECT_SPECIALITY
            return ("❌ No doctors available for the selected speciality.\n\n"
                    "Please select a different speciality or contact the hospital.")
        
        # Log for debugging
        logger.info(f"📋 Processing doctor selection. User input: '{user_input}'")
        logger.info(f"📋 Available doctors count: {len(doctors)}")
        
        # Parse user input
        try:
            choice = int(user_input) - 1
            logger.info(f"📋 User selected option {user_input} (index {choice})")
        except ValueError:
            # Not a number - show available doctors again
            doctor_list = "\n".join([f"{i+1}. {doc.get('name', 'N/A')}" for i, doc in enumerate(doctors)])
            return (f"❌ *Invalid Input*\n\n"
                    f"Please enter a number between 1 and {len(doctors)}.\n\n"
                    f"👨‍⚕️ *Select Doctor*\n\n"
                    f"{doctor_list}\n\n"
                    f"Please select a doctor (1-{len(doctors)}):")
        
        # Validate choice
        if choice < 0 or choice >= len(doctors):
            # Show error with available options
            doctor_list = "\n".join([f"{i+1}. {doc.get('name', 'N/A')}" for i, doc in enumerate(doctors)])
            
            return (f"❌ *Invalid Selection*\n\n"
                    f"You selected option {user_input}, but we only have {len(doctors)} doctors available.\n\n"
                    f"👨‍⚕️ *Available Doctors*\n\n"
                    f"{doctor_list}\n\n"
                    f"*Please select a number between 1 and {len(doctors)}:*")
        
        # Valid selection - process it
        selected_doctor = doctors[choice]
        
        # Store doctor info in session
        session["appointment_details"]["doctor"] = {
            "doctor_id": selected_doctor.get("doctor_id"),
            "sys_user_id": selected_doctor.get("sys_user_id"),
            "name": selected_doctor.get("name"),
            "specialization": selected_doctor.get("specialization", ""),
            "qualifications": selected_doctor.get("qualifications", "")
        }
        
        logger.info(f"✅ Doctor selected: {selected_doctor.get('name')} (ID: {selected_doctor.get('sys_user_id')})")
        
        # For NEW appointments, go directly to visit type
        session["state"] = ConversationState.APPOINTMENT_VISIT_TYPE
        return (f"👨‍⚕️ *Doctor Selected for New Appointment*\n\n"
                f"   • Name: {selected_doctor.get('name', 'N/A')}\n"
                f"   • Specialization: {selected_doctor.get('specialization', 'N/A')}\n"
                f"   • Qualifications: {selected_doctor.get('qualifications', 'N/A')}\n\n"
                f"*Is this visit a:*\n\n"
                f"1. 🔄 Follow-up\n"
                f"2. 🆕 New Visit")
            
    except Exception as e:
        logger.error(f"❌ Error in handle_appointment_select_doctor: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        
        # Fallback to showing doctors again
        doctors = session.get("available_doctors", [])
        if doctors:
            doctor_list = "\n".join([f"{i+1}. {doc.get('name', 'N/A')}" for i, doc in enumerate(doctors)])
            return (f"❌ An error occurred. Please try again.\n\n"
                    f"👨‍⚕️ *Select Doctor*\n\n"
                    f"{doctor_list}\n\n"
                    f"Please select a doctor (1-{len(doctors)}):")
        else:
            session["state"] = ConversationState.APPOINTMENT_SELECT_SPECIALITY
            return "❌ An error occurred. Please select a speciality again."

async def handle_appointment_select_date(user_input: str, session: dict) -> str:
    """Handle date selection for NEW appointments"""
    try:
        # Make sure we have available dates
        available_dates = session.get("available_dates", [])
        
        if not available_dates:
            # Try to regenerate dates
            doctor_info = session.get("appointment_details", {}).get("doctor", {})
            doctor_sys_user_id = doctor_info.get("sys_user_id")
            
            if doctor_sys_user_id:
                available_days = await get_doctor_available_days(doctor_sys_user_id)
                date_message, available_dates = generate_date_selection_message(available_days)
                session["available_dates"] = available_dates
                
                if not date_message:
                    return "❌ No available dates. Please try again later."
            
            if not available_dates:
                return "❌ No dates available. Please try again."
        
        choice = int(user_input) - 1
        
        if choice < 0 or choice >= len(available_dates):
            return f"❌ Please select a valid number (1-{len(available_dates)})."
        
        selected_date_info = available_dates[choice]
        date_str = selected_date_info["date"]
        display_date = selected_date_info["display_date"]
        
        # Store selected date
        session["appointment_details"]["date"] = date_str
        session["appointment_details"]["display_date"] = display_date
        
        # Clear any existing time slot data
        session.pop("time_slot_page", None)
        session.pop("time_groups", None)
        session.pop("all_time_slots", None)
        session.pop("no_time_slots", None)
        session.pop("no_schedule", None)
        
        # Move to time selection
        session["state"] = ConversationState.APPOINTMENT_SELECT_TIME
        
        # Get doctor info
        doctor_info = session.get("appointment_details", {}).get("doctor", {})
        doctor_sys_user_id = doctor_info.get("sys_user_id")
        
        if doctor_sys_user_id:
            # Generate time slots based on doctor's OPD schedule
            time_groups, all_time_slots = await generate_time_slots_for_doctor(
                doctor_sys_user_id, 
                date_str
            )
            
            # Store for pagination
            session["time_slot_page"] = 0
            session["time_groups"] = time_groups
            session["all_time_slots"] = all_time_slots
            
            if time_groups and all_time_slots:
                total_pages = len(time_groups)
                return (f"📅 *Date Selected:* {display_date}\n\n"
                        f"⏰ *Select Time Slot*\n\n"
                        f"{time_groups[0]}\n\n"
                        f"*Options:*\n"
                        f"• Select time (1-6)\n"
                        f"• Type 'more' for more slots\n"
                        f"• Type 'back' to change date")
            else:
                # No time slots available
                doctor_name = doctor_info.get("name", "the doctor")
                return (f"📅 *Date Selected:* {display_date}\n\n"
                        f"❌ *No time slots available*\n\n"
                        f"{doctor_name} doesn't have available time slots on {display_date}.\n\n"
                        f"**Please choose:**\n\n"
                        f"1. 📅 Select a different date\n"
                        f"2. 🏥 Return to main menu")
        else:
            return "❌ Could not find doctor information. Please try again."
            
    except ValueError:
        return "❌ Please enter a valid number."
    except Exception as e:
        logger.error(f"Error in date selection: {str(e)}")
        return "❌ An error occurred. Please try again."

async def handle_appointment_select_time(user_input: str, session: dict) -> str:
    """Handle time slot selection for NEW appointments"""
    user_input = user_input.lower().strip()
    
    # Check if we're in "no time slots" state
    if session.get("no_time_slots"):
        # This should be handled by handle_no_time_slots, but just in case
        doctor_info = session.get("appointment_details", {}).get("doctor", {})
        doctor_name = doctor_info.get("name", "the doctor")
        
        if session.get("no_schedule"):
            return (f"❌ *No Schedule Found*\n\n"
                    f"{doctor_name} doesn't have an OPD schedule configured.\n\n"
                    f"**Please choose:**\n\n"
                    f"1. 📅 Select a different doctor\n"
                    f"2. 🏥 Return to main menu\n"
                    f"3. 📞 Contact hospital")
        else:
            display_date = session.get("appointment_details", {}).get("display_date", "Selected Date")
            return (f"📅 *Date Selected:* {display_date}\n\n"
                    f"❌ *No Time Slots Available*\n\n"
                    f"{doctor_name} doesn't have available time slots on {display_date}.\n\n"
                    f"**Please choose:**\n\n"
                    f"1. 📅 Select a different date\n"
                    f"2. 🏥 Return to main menu\n"
                    f"3. 📞 Contact hospital")
    
    current_page = session.get("time_slot_page", 0)
    time_groups = session.get("time_groups", [])
    all_time_slots = session.get("all_time_slots", [])
    display_date = session.get("appointment_details", {}).get("display_date", "Selected Date")
    
    total_pages = len(time_groups)
    
    # If there are no time groups, something went wrong
    if not time_groups or not all_time_slots:
        # Go to no time slots state
        doctor_info = session.get("appointment_details", {}).get("doctor", {})
        doctor_name = doctor_info.get("name", "the doctor")
        doctor_sys_user_id = doctor_info.get("sys_user_id")
        
        # Set flags for no time slots
        session["no_time_slots"] = True
        
        # Check if doctor has OPD timings (we need to check this properly)
        # For now, assume doctor has schedule but no slots
        session["no_schedule"] = False
        
        # Also clear the time slot data
        session.pop("time_slot_page", None)
        session.pop("time_groups", None)
        session.pop("all_time_slots", None)
        
        return (f"📅 *Date Selected:* {display_date}\n\n"
                f"❌ *No Time Slots Available*\n\n"
                f"{doctor_name} doesn't have available time slots on {display_date}.\n\n"
                f"**Please choose:**\n\n"
                f"1. 📅 Select a different date\n"
                f"2. 🏥 Return to main menu\n"
                f"3. 📞 Contact hospital")
    
    # Handle "back" command to change date
    if user_input == "back" or user_input == "change date":
        session["state"] = ConversationState.APPOINTMENT_SELECT_DATE
        
        # Clear time slot data
        session.pop("time_slot_page", None)
        session.pop("time_groups", None)
        session.pop("all_time_slots", None)
        
        # Get doctor's available days to regenerate date selection
        doctor_info = session.get("appointment_details", {}).get("doctor", {})
        doctor_sys_user_id = doctor_info.get("sys_user_id")
        
        if doctor_sys_user_id:
            # Get doctor's available days
            available_days = await get_doctor_available_days(doctor_sys_user_id)
            
            # Generate filtered date selection
            date_message, available_dates = generate_date_selection_message(available_days)
            
            if date_message:
                # Store available dates in session
                session["available_dates"] = available_dates
                session["date_message"] = date_message
                return date_message
            else:
                # No available dates
                doctor_name = doctor_info.get("name", "the doctor")
                return (f"❌ *No Available Dates*\n\n"
                        f"{doctor_name} doesn't have available dates.\n\n"
                        f"**Please choose:**\n\n"
                        f"1. 📅 Select a different doctor\n"
                        f"2. 🏥 Return to main menu")
        else:
            return "❌ Could not find doctor information. Please try again."
    
    # Check if it's a number input
    if user_input.isdigit():
        choice = int(user_input)
        
        # Handle "7" for next page
        if choice == 7 and current_page < total_pages - 1:
            session["time_slot_page"] = current_page + 1
            return get_state_prompt(session)
        
        # Handle "8" for previous page
        elif choice == 8 and current_page > 0:
            session["time_slot_page"] = current_page - 1
            return get_state_prompt(session)
        
        # Handle time slot selection (1-6)
        elif 1 <= choice <= 6:
            # Calculate which time slot was actually selected
            start_index = current_page * 6
            slot_index = start_index + (choice - 1)
            
            if slot_index < len(all_time_slots):
                selected_time = all_time_slots[slot_index]
                session["appointment_details"]["time"] = selected_time
                
                # AFTER TIME SELECTION, GO TO CHIEF COMPLAINT
                session["state"] = ConversationState.APPOINTMENT_CHIEF_COMPLAINT
                return ("✅ *Time Selected:* " + selected_time + "\n\n"
                        "📝 *Chief Complaint*\n\n"
                        "Please describe your main medical concern or symptoms (e.g., fever for 3 days, headache, etc.):")
            else:
                # Invalid slot number
                error_msg = "❌ Please enter a valid time slot number (1-6)"
                
                # Add available options
                if current_page < total_pages - 1:
                    error_msg += ", '7' for next slots"
                if current_page > 0:
                    error_msg += ", '8' for previous slots"
                error_msg += ", or 'back' to change date."
                
                return error_msg
        else:
            # Invalid number choice
            error_msg = "❌ Please enter a valid option: 1-6"
            
            if current_page < total_pages - 1:
                error_msg += ", 7 for next slots"
            if current_page > 0:
                error_msg += ", 8 for previous slots"
            error_msg += ", or 'back' to change date."
            
            return error_msg
    
    # Handle text commands
    elif user_input == "more" or user_input == "next":
        if current_page < total_pages - 1:
            session["time_slot_page"] = current_page + 1
            return get_state_prompt(session)
        else:
            return "❌ No more time slots available. Please select from the options above."
    
    elif user_input == "previous" or user_input == "prev":
        if current_page > 0:
            session["time_slot_page"] = current_page - 1
            return get_state_prompt(session)
        else:
            return "❌ You're already on the first page. Please select from the options above."
    
    # Invalid input (not a number or recognized command)
    error_msg = "❌ Invalid input. Please enter: 1-6"
    
    if current_page < total_pages - 1:
        error_msg += ", 7 for next slots"
    if current_page > 0:
        error_msg += ", 8 for previous slots"
    error_msg += ", or 'back' to change date."
    
    return error_msg

def handle_appointment_chief_complaint(user_input: str, session: dict) -> str:
    """Handle chief complaint input"""
    chief_complaint = user_input.strip()

    if not chief_complaint:
        return "📝 Please describe your main medical concern or symptoms (e.g., fever for 3 days, headache, etc.):"

    # Store chief complaint
    session["appointment_details"]["chief_complaint"] = chief_complaint
    session["state"] = ConversationState.APPOINTMENT_CONFIRM

    # Build confirmation message with chief complaint
    return build_appointment_confirmation(session)
# ============================================================
# ============ UPDATED: HANDLE APPOINTMENT CONFIRM ==========
# ============================================================

# ============================================================
# ============ COMPLETE UPDATED HANDLE APPOINTMENT CONFIRM ==========
# ============================================================

async def handle_appointment_confirm(user_input: str, session: dict) -> str:
    """Handle appointment confirmation with API integration"""
    if user_input == "1":  # Confirm
        
        # FIRST: Try to book via API
        details = session["appointment_details"]
        logger.info(f"📋 Attempting to book appointment via API for HMS ID: {details.get('hms_id')}")
        
        api_result = await book_appointment_api(details)
        
        # ==================== GET APPOINTMENT ID FROM API RESULT ====================
        # Get appointment_id from API result (now properly extracted)
        final_appointment_id = api_result.get('appointment_id')
        
        # If still None, generate one as absolute fallback
        if not final_appointment_id:
            final_appointment_id = f"APT-WHATSAPP-{datetime.now().strftime('%Y%m%d%H%M%S')}"
            logger.warning(f"⚠️ Still no appointment_id, generated fallback: {final_appointment_id}")
        else:
            logger.info(f"✅ Using appointment_id from API: {final_appointment_id}")
        # ==================== END APPOINTMENT ID EXTRACTION ====================
        
        # Build success message
        success_msg = ""
        
        if api_result.get("success"):
            success_msg += "✅ *Appointment Confirmed!*\n\n"
            success_msg += f"📋 *Appointment ID:* {final_appointment_id}\n\n"
        else:
            success_msg += "⚠️ *Appointment Pending*\n\n"
            success_msg += f"📋 *Reference ID:* {final_appointment_id}\n\n"
            success_msg += "*Note:* System encountered an issue. Hospital will contact you to confirm.\n\n"
        
        # Patient info
        if "patient_info" in details:
            patient = details['patient_info']
            success_msg += f"👤 *Patient:* {patient.get('name', 'N/A')}\n"
        
        success_msg += f"🆔 *HMS ID:* {details.get('hms_id', 'N/A')}\n"
        
        # Doctor info
        doctor = details.get("doctor", {})
        doctor_name = doctor.get('name', 'N/A')
        doctor_specialization = doctor.get('specialization', details.get('speciality', 'N/A'))
        doctor_id = doctor.get('sys_user_id', '')
        
        success_msg += f"👨‍⚕️ *Doctor:* {doctor_name}\n"
        success_msg += f"🏥 *Specialization:* {doctor_specialization}\n"
        
        # Appointment details
        success_msg += f"📅 *Date:* {details.get('display_date', details.get('date', 'N/A'))}\n"
        success_msg += f"⏰ *Time:* {details.get('time', 'N/A')}\n"
        success_msg += f"📝 *Visit Type:* {details.get('visit_type', 'New Visit').title()}\n"
        
        # Add Chief Complaint if exists
        if "chief_complaint" in details:
            complaint = details['chief_complaint']
            if len(complaint) > 80:
                complaint = complaint[:77] + "..."
            success_msg += f"🩺 *Chief Complaint:* {complaint}\n"
        
        success_msg += "\n📌 *Instructions:*\n"
        success_msg += "   • Arrive 15 minutes before appointment\n"
        success_msg += "   • Bring your ID and insurance card\n"
        success_msg += "   • Bring any previous medical reports\n"
        
        if not api_result.get("success"):
            success_msg += "   • Hospital will call you to confirm\n"
        
        success_msg += "\n🏥 *Main Menu*\n\n"
        success_msg += "1. 📄 Upload Lab Reports\n"
        success_msg += "2. 📅 Book Another Appointment\n\n"
        success_msg += "Reply with 1 or 2"
        
        # ==================== SAVE APPOINTMENT RECORD WITH PATIENT SYS_USER_ID ====================
        try:
            # Get necessary data
            hms_id = details.get('hms_id')
            phone_number = session.get('_key', '')
            
            if hms_id and phone_number:
                # Get patient data to get hospital_id, patient name, and patient sys_user_id
                patient = await get_patient_by_hms_id(hms_id)
                if patient:
                    hospital_id = patient.get('hospital_id')
                    patient_name = patient.get('name', '')
                    patient_sys_user_id = patient.get('sys_user_id')  # GET PATIENT SYS_USER_ID
                    
                    logger.info(f"👤 WhatsApp Booking - Saving appointment with patient_sys_user_id: {patient_sys_user_id}")
                    logger.info(f"👤 Patient name: {patient_name}")
                    logger.info(f"🏥 Hospital ID: {hospital_id}")
                    logger.info(f"📅 Appointment Date: {details.get('date', '')}")
                    logger.info(f"⏰ Appointment Time: {details.get('time', '')}")
                    logger.info(f"👨‍⚕️ Doctor: {doctor_name} (ID: {doctor_id})")
                    logger.info(f"📋 Appointment ID being saved: {final_appointment_id}")
                    
                    if hospital_id and patient_sys_user_id:
                        # ==================== SAVE WITH PATIENT SYS_USER_ID ====================
                        await save_to_database(
                            hms_id=hms_id,
                            hospital_id=hospital_id,
                            phone_number=phone_number,
                            appointment_id=final_appointment_id,
                            appointment_date=details.get('date', ''),
                            appointment_time=details.get('time', ''),
                            patient_name=patient_name,
                            patient_sys_user_id=patient_sys_user_id,  # THIS IS CRITICAL
                            from_number=session.get('_key'),
                            body=session.get('last_message', ''),
                            source="whatsapp",
                            # ==================== DOCTOR DETAILS ====================
                            doctor_id=doctor_id,
                            doctor_name=doctor_name,
                            specialization=doctor_specialization
                        )
                        logger.info(f"✅ WhatsApp appointment saved successfully with patient_sys_user_id: {patient_sys_user_id}")
                    else:
                        logger.error(f"❌ Missing hospital_id or patient_sys_user_id for HMS ID: {hms_id}")
                else:
                    logger.error(f"❌ Patient not found for HMS ID: {hms_id}")
            else:
                logger.error(f"❌ Missing hms_id or phone_number for appointment")
                        
        except Exception as e:
            logger.error(f"❌ Failed to save appointment record: {str(e)}")
            logger.error(f"Traceback: {traceback.format_exc()}")
        # ==================== END SAVE APPOINTMENT RECORD ====================
        
        # Reset session
        session["state"] = ConversationState.MAIN_MENU
        session["appointment_details"] = {}
        session["available_specialities"] = []
        session["available_doctors"] = []
        session.pop("time_slot_page", None)
        session.pop("all_time_slots", None)
        session.pop("upcoming_appointments", None)
        
        return success_msg
    
    elif user_input == "2":  # Cancel
        return handle_cancel_appointment(session)
    
    return "Please choose:\n1. ✅ Yes, Book Appointment\n2. ❌ No, Cancel"

def handle_cancel_appointment(session: dict) -> str:
    """Handle appointment cancellation and return to main menu"""
    session["state"] = ConversationState.MAIN_MENU
    session["appointment_details"] = {}
    session["data"] = {}
    
    return ("❌ Operation cancelled.\n\n"
            "🏥 *Main Menu*\n\n"
            "1. 📄 Upload Lab Reports\n"
            "2. 📅 Book/Reschedule Appointment\n"
            "3. 🎓 Ask the Doctor / Health Education\n"
            "4. 🏥 Register Your Own Clinic\n\n"
            "_Reply with 1, 2, 3, or 4_")

async def check_and_handle_reschedule(session_key: str, session: dict) -> str:
    """ASYNC - Check if user has upcoming appointments and offer rescheduling"""
    try:
        hms_id = session.get("appointment_details", {}).get("hms_id")
        if not hms_id:
            return "No HMS ID found"
        
        # Get upcoming appointments
        upcoming_appointments = await get_upcoming_appointments(hms_id)
        
        if not upcoming_appointments:
            # No appointments found, proceed with normal booking
            session["state"] = ConversationState.APPOINTMENT_VERIFY
            return await handle_appointment_verify("", session)
        
        # Store in session for later use
        session["upcoming_appointments"] = upcoming_appointments
        
        # Build message with appointment details
        message = "📋 *Your Upcoming Appointments*\n\n"
        
        for i, appointment in enumerate(upcoming_appointments, 1):
            message += f"{i}. *Appointment ID:* {appointment.get('appointment_id', 'N/A')}\n"
            message += f"   • Date: {appointment.get('date', 'N/A')}\n"
            message += f"   • Time: {appointment.get('scheduled_time', 'N/A')}\n"
            message += f"   • Doctor: {appointment.get('doctor_name', 'N/A')}\n"
            message += f"   • Specialization: {appointment.get('specialization', 'N/A')}\n"
            message += f"   • Status: {appointment.get('status', 'N/A').title()}\n\n"
        
        message += "Would you like to reschedule any of these appointments?\n\n"
        message += "1. ✅ Yes, reschedule\n"
        message += "2. ❌ No, book new appointment instead"
        
        session["state"] = ConversationState.RESCHEDULE_CONFIRM
        return message
        
    except Exception as e:
        logger.error(f"❌ Error checking appointments: {str(e)}")
        # Fall back to normal booking
        session["state"] = ConversationState.APPOINTMENT_VERIFY
        return await handle_appointment_verify("", session)

async def handle_reschedule_confirm(user_input: str, session: dict) -> str:
    """Handle reschedule confirmation"""
    if user_input == "1":  # Yes, reschedule
        session["state"] = ConversationState.RESCHEDULE_SELECT_APPOINTMENT
        
        # Ask which appointment to reschedule
        appointments = session.get("upcoming_appointments", [])
        message = "📋 *Select Appointment to Reschedule*\n\n"
        
        for i, appointment in enumerate(appointments, 1):
            message += f"{i}. {appointment.get('date', 'N/A')} at {appointment.get('scheduled_time', 'N/A')}\n"
            message += f"   Doctor: {appointment.get('doctor_name', 'N/A')}\n"
            message += f"   Appointment ID: {appointment.get('appointment_id', 'N/A')}\n\n"
        
        message += "Please select the appointment number (1, 2, etc.):"
        return message
    
    elif user_input == "2":  # No, book new appointment instead
        session["state"] = ConversationState.APPOINTMENT_VERIFY
        # Clear reschedule data
        session.pop("upcoming_appointments", None)
        return await handle_appointment_verify("", session)
    
    return "❌ Please choose:\n1. ✅ Yes, reschedule\n2. ❌ No, book new appointment instead"

async def handle_reschedule_select_appointment(user_input: str, session: dict) -> str:
    """Handle appointment selection for rescheduling - ONLY for same doctor"""
    try:
        choice = int(user_input) - 1
        appointments = session.get("upcoming_appointments", [])
        
        if 0 <= choice < len(appointments):
            selected_appointment = appointments[choice]
            
            # Store selected appointment in session
            session["selected_appointment"] = selected_appointment
            session["state"] = ConversationState.RESCHEDULE_SELECT_DATE
            
            # Clear any previous date data
            session.pop("available_dates", None)
            session.pop("reschedule_date_message", None)
            session.pop("new_appointment_date", None)
            session.pop("new_display_date", None)
            
            # Get doctor info from the selected appointment (SAME DOCTOR for reschedule)
            doctor_sys_user_id = selected_appointment.get("doctor_id")
            doctor_name = selected_appointment.get("doctor_name", "the doctor")
            
            # Store the doctor in appointment_details for reschedule flow
            session["appointment_details"]["doctor"] = {
                "sys_user_id": doctor_sys_user_id,
                "name": doctor_name,
                "specialization": selected_appointment.get("specialization", "")
            }
            
            if not doctor_sys_user_id:
                return f"❌ Could not find doctor information for {doctor_name}. Please try again."
            
            # Get doctor's available days for rescheduling
            available_days = await get_doctor_available_days(doctor_sys_user_id)
            
            # Generate filtered date selection for rescheduling (14 days)
            date_message, available_dates = generate_date_selection_message_reschedule(available_days)
            
            if not date_message:
                # No available dates for this doctor
                return (f"❌ *No Available Dates for {doctor_name}*\n\n"
                        f"Sorry, there are no available dates for rescheduling at this time.\n\n"
                        f"**Please choose:**\n\n"
                        f"1. 🔄 Select a different appointment\n"
                        f"2. 🏥 Return to main menu")
            
            # Store available dates in session
            session["available_dates"] = available_dates
            session["reschedule_date_message"] = date_message
            
            # Show appointment details and date selection
            message = f"📋 *Reschedule Appointment*\n\n"
            message += f"*Current Appointment:*\n"
            message += f"   • Date: {selected_appointment.get('date', 'N/A')}\n"
            message += f"   • Time: {selected_appointment.get('scheduled_time', 'N/A')}\n"
            message += f"   • Doctor: {doctor_name}\n"
            message += f"   • Specialization: {selected_appointment.get('specialization', 'N/A')}\n\n"
            message += "*Select NEW Date:*\n\n"
            message += date_message
            
            return message
        else:
            return f"❌ Invalid selection. Please choose a valid appointment number (1-{len(appointments)})."
    except ValueError:
        return "❌ Please enter a valid number."

async def handle_reschedule_select_date(user_input: str, session: dict) -> str:
    """Handle date selection for rescheduling - SAME doctor only"""
    try:
        # If we have available dates, process the user's selection
        if "available_dates" in session:
            try:
                choice = int(user_input) - 1
                
                # Get available dates from session
                available_dates = session.get("available_dates", [])
                
                if not available_dates or choice < 0 or choice >= len(available_dates):
                    return "❌ Invalid choice. Please select a valid date."
                
                selected_date_info = available_dates[choice]
                date_str = selected_date_info["date"]
                display_date = selected_date_info["display_date"]
                
                # Store new date in session
                session["new_appointment_date"] = date_str
                session["new_display_date"] = display_date
                
                # Clear time slot data if any
                session.pop("time_slot_page", None)
                session.pop("time_groups", None)
                session.pop("all_time_slots", None)
                
                # Go to time selection
                session["state"] = ConversationState.RESCHEDULE_SELECT_TIME
                
                # Get doctor info from selected appointment
                appointment = session.get("selected_appointment", {})
                doctor_sys_user_id = appointment.get("doctor_id")
                
                if doctor_sys_user_id:
                    # Generate time slots based on doctor's OPD schedule
                    time_groups, all_time_slots = await generate_time_slots_for_doctor(
                        doctor_sys_user_id, 
                        date_str
                    )
                    
                    # Store for pagination
                    session["time_slot_page"] = 0
                    session["time_groups"] = time_groups
                    session["all_time_slots"] = all_time_slots
                    
                    total_pages = len(time_groups)
                    
                    if time_groups and all_time_slots:
                        return (f"📅 *New Date Selected:* {display_date}\n\n"
                                f"⏰ *Select New Time Slot (Page 1/{total_pages})*\n\n"
                                f"{time_groups[0]}\n\n"
                                f"*Options:*\n"
                                f"• Select time (1-6)\n"
                                f"• Type 'more' for more slots\n"
                                f"• Type 'back' to change date")
                    else:
                        # No time slots available
                        doctor_name = appointment.get("doctor_name", "the doctor")
                        return (f"📅 *New Date Selected:* {display_date}\n\n"
                                f"❌ *No time slots available*\n\n"
                                f"{doctor_name} doesn't have available time slots on {display_date}.\n\n"
                                f"**Please choose:**\n\n"
                                f"1. 📅 Select a different date\n"
                                f"2. 🏥 Return to main menu")
                else:
                    return "❌ Could not find doctor information. Please try again."
                    
            except ValueError:
                # If it's not a number, show the dates again
                available_dates = session.get("available_dates", [])
                date_message = session.get("reschedule_date_message", "")
                appointment = session.get("selected_appointment", {})
                
                if date_message and appointment:
                    message = f"📋 *Reschedule Appointment*\n\n"
                    message += f"*Current Appointment:*\n"
                    message += f"   • Date: {appointment.get('date', 'N/A')}\n"
                    message += f"   • Time: {appointment.get('scheduled_time', 'N/A')}\n"
                    message += f"   • Doctor: {appointment.get('doctor_name', 'N/A')}\n"
                    message += f"   • Specialization: {appointment.get('specialization', 'N/A')}\n\n"
                    message += "*Select NEW Date:*\n\n"
                    message += date_message
                    
                    return message
        
        # If we reach here, something went wrong
        return "❌ Please select a date from the available options."
        
    except Exception as e:
        logger.error(f"❌ Error in handle_reschedule_select_date: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return "❌ An error occurred. Please try again."

async def handle_reschedule_select_time(user_input: str, session: dict) -> str:
    """Handle time selection for rescheduling - SAME doctor only"""
    user_input = user_input.lower().strip()
    
    current_page = session.get("time_slot_page", 0)
    time_groups = session.get("time_groups", [])
    all_time_slots = session.get("all_time_slots", [])
    display_date = session.get("new_display_date", "Selected Date")
    
    total_pages = len(time_groups)
    
    # If there are no time groups, something went wrong
    if not time_groups:
        return "❌ No time slots available. Please go back and select a different date."
    
    # Handle "back" command to change date
    if user_input == "back" or user_input == "change date":
        session["state"] = ConversationState.RESCHEDULE_SELECT_DATE
        session.pop("time_slot_page", None)
        session.pop("time_groups", None)
        session.pop("all_time_slots", None)
        
        # Get appointment details for display
        appointment = session.get("selected_appointment", {})
        date_message = session.get("reschedule_date_message", "")
        
        if date_message and appointment:
            message = f"📋 *Reschedule Appointment*\n\n"
            message += f"*Current Appointment:*\n"
            message += f"   • Date: {appointment.get('date', 'N/A')}\n"
            message += f"   • Time: {appointment.get('scheduled_time', 'N/A')}\n"
            message += f"   • Doctor: {appointment.get('doctor_name', 'N/A')}\n"
            message += f"   • Specialization: {appointment.get('specialization', 'N/A')}\n\n"
            message += "*Select NEW Date:*\n\n"
            message += date_message
            
            return message
        return "📅 Please select a new date:"
    
    # Check if it's a number input
    if user_input.isdigit():
        choice = int(user_input)
        
        # Calculate how many slots are on current page
        start_index = current_page * 6
        slots_on_page = min(6, len(all_time_slots) - start_index)
        
        # Handle "More slots" option
        if choice == slots_on_page + 1 and current_page < total_pages - 1:
            session["time_slot_page"] = current_page + 1
            current_display = time_groups[current_page + 1]
            
            return (f"# Date Selected: {display_date}\n\n"
                    f"## Select New Time Slot\n\n"
                    f"{current_display}\n\n"
                    f"**Options:**\n\n"
                    f"- Select time (1-6)\n"
                    f"- Type 'more' for more options\n"
                    f"- Type 'back' to change date")
        
        # Handle "Previous slots" option
        elif choice == slots_on_page + (2 if (current_page < total_pages - 1) else 1) and current_page > 0:
            session["time_slot_page"] = current_page - 1
            current_display = time_groups[current_page - 1]
            
            return (f"# Date Selected: {display_date}\n\n"
                    f"## Select New Time Slot\n\n"
                    f"{current_display}\n\n"
                    f"**Options:**\n\n"
                    f"- Select time (1-6)\n"
                    f"- Type 'more' for more options\n"
                    f"- Type 'back' to change date")
        
        # Handle time slot selection (1-6)
        elif 1 <= choice <= 6:
            # Calculate which time slot was actually selected
            slot_index = start_index + (choice - 1)
            
            if slot_index < len(all_time_slots):
                selected_time = all_time_slots[slot_index]
                
                # Store new time in session
                session["new_appointment_time"] = selected_time
                session["state"] = ConversationState.RESCHEDULE_CONFIRM_CHANGES
                
                # Get appointment details for confirmation
                appointment = session.get("selected_appointment", {})
                current_date = appointment.get("date", "N/A")
                current_time = appointment.get("scheduled_time", "N/A")
                
                return (f"📋 *Reschedule Confirmation*\n\n"
                        f"*Appointment ID:* {appointment.get('appointment_id', 'N/A')}\n\n"
                        f"*Current Schedule:*\n"
                        f"📅 Date: {current_date}\n"
                        f"⏰ Time: {current_time}\n\n"
                        f"*New Schedule:*\n"
                        f"📅 Date: {display_date}\n"
                        f"⏰ Time: {selected_time}\n\n"
                        f"Do you want to confirm this reschedule?\n\n"
                        f"1. ✅ Yes, confirm reschedule\n"
                        f"2. ❌ No, cancel reschedule")
            else:
                # Invalid slot number
                return (f"# Date Selected: {display_date}\n\n"
                        f"## Select New Time Slot\n\n"
                        f"{time_groups[current_page]}\n\n"
                        f"**Options:**\n\n"
                        f"- Select time (1-6)\n"
                        f"- Type 'more' for more options\n"
                        f"- Type 'back' to change date\n\n"
                        f"❌ Please enter a valid time slot number (1-6)")
        else:
            # Invalid number choice
            return (f"# Date Selected: {display_date}\n\n"
                    f"## Select New Time Slot\n\n"
                    f"{time_groups[current_page]}\n\n"
                    f"**Options:**\n\n"
                    f"- Select time (1-6)\n"
                    f"- Type 'more' for more options\n"
                    f"- Type 'back' to change date\n\n"
                    f"❌ Please enter a valid option.")
    
    # Handle text commands
    elif user_input == "more" or user_input == "next":
        if current_page < total_pages - 1:
            session["time_slot_page"] = current_page + 1
            current_display = time_groups[current_page + 1]
            
            return (f"# Date Selected: {display_date}\n\n"
                    f"## Select New Time Slot\n\n"
                    f"{current_display}\n\n"
                    f"**Options:**\n\n"
                    f"- Select time (1-6)\n"
                    f"- Type 'more' for more options\n"
                    f"- Type 'back' to change date")
        else:
            return (f"# Date Selected: {display_date}\n\n"
                    f"## Select New Time Slot\n\n"
                    f"{time_groups[current_page]}\n\n"
                    f"**Options:**\n\n"
                    f"- Select time (1-6)\n"
                    f"- Type 'back' to change date\n\n"
                    f"❌ No more time slots available.")
    
    elif user_input == "previous" or user_input == "prev":
        if current_page > 0:
            session["time_slot_page"] = current_page - 1
            current_display = time_groups[current_page - 1]
            
            return (f"# Date Selected: {display_date}\n\n"
                    f"## Select New Time Slot\n\n"
                    f"{current_display}\n\n"
                    f"**Options:**\n\n"
                    f"- Select time (1-6)\n"
                    f"- Type 'more' for more options\n"
                    f"- Type 'back' to change date")
        else:
            return (f"# Date Selected: {display_date}\n\n"
                    f"## Select New Time Slot\n\n"
                    f"{time_groups[current_page]}\n\n"
                    f"**Options:**\n\n"
                    f"- Select time (1-6)\n"
                    f"- Type 'more' for more options\n"
                    f"- Type 'back' to change date\n\n"
                    f"❌ You're already on the first page.")
    
    # Invalid input (not a number or recognized command)
    return (f"# Date Selected: {display_date}\n\n"
            f"## Select New Time Slot\n\n"
            f"{time_groups[current_page]}\n\n"
            f"**Options:**\n\n"
            f"- Select time (1-6)\n"
            f"- Type 'more' for more options\n"
            f"- Type 'back' to change date\n\n"
            f"❌ Invalid input. Please enter a valid option.")

# ============================================================
# ============ COMPLETE UPDATED HANDLE RESCHEDULE CONFIRM CHANGES ==========
# ============================================================

async def handle_reschedule_confirm_changes(user_input: str, session: dict) -> str:
    """Handle final confirmation of rescheduling - COMPLETE UPDATED version with patient_sys_user_id"""
    if user_input == "1":  # Confirm reschedule
        appointment = session.get("selected_appointment", {})
        appointment_id = appointment.get("appointment_id")
        new_date = session.get("new_appointment_date")
        new_time = session.get("new_appointment_time")
        
        if not appointment_id:
            return "❌ Missing appointment ID. Please start over."
        
        if not new_date or not new_time:
            return "❌ Missing new date or time. Please start over."
        
        # Update appointment in database
        success = await update_appointment_in_database(appointment_id, new_date, new_time)
        
        if success:
            # ==================== SAVE RESCHEDULE RECORD WITH PATIENT SYS_USER_ID ====================
            try:
                # Get patient data from session
                details = session.get("appointment_details", {})
                hms_id = details.get('hms_id')
                phone_number = session.get('_key', '')
                
                if hms_id and phone_number:
                    patient = await get_patient_by_hms_id(hms_id)
                    if patient:
                        hospital_id = patient.get('hospital_id')
                        patient_name = patient.get('name', '')
                        patient_sys_user_id = patient.get('sys_user_id')  # GET PATIENT SYS_USER_ID
                        
                        logger.info(f"👤 WhatsApp Reschedule - Saving with patient_sys_user_id: {patient_sys_user_id}")
                        logger.info(f"👤 Patient name: {patient_name}")
                        logger.info(f"🏥 Hospital ID: {hospital_id}")
                        logger.info(f"📅 New Date: {new_date}")
                        logger.info(f"⏰ New Time: {new_time}")
                        logger.info(f"👨‍⚕️ Doctor: {appointment.get('doctor_name', 'N/A')} (ID: {appointment.get('doctor_id', 'N/A')})")
                        
                        if hospital_id and patient_sys_user_id:
                            # Save reschedule record with source = "whatsapp" and patient_sys_user_id
                            await save_to_database(
                                hms_id=hms_id,
                                hospital_id=hospital_id,
                                phone_number=phone_number,
                                appointment_id=appointment_id,
                                appointment_date=new_date,
                                appointment_time=new_time,
                                patient_name=patient_name,
                                patient_sys_user_id=patient_sys_user_id,  # THIS IS CRITICAL
                                from_number=session.get('_key'),
                                body=f"Rescheduled from {appointment.get('date', '')} {appointment.get('scheduled_time', '')}",
                                source="whatsapp",  # Explicitly set source to whatsapp
                                # Doctor details
                                doctor_id=appointment.get("doctor_id"),
                                doctor_name=appointment.get("doctor_name"),
                                specialization=appointment.get("specialization")
                            )
                            logger.info(f"✅ WhatsApp reschedule saved successfully with patient_sys_user_id: {patient_sys_user_id}")
                        else:
                            logger.error(f"❌ Missing hospital_id or patient_sys_user_id for HMS ID: {hms_id}")
                    else:
                        logger.error(f"❌ Patient not found for HMS ID: {hms_id}")
                else:
                    logger.error(f"❌ Missing hms_id or phone_number for reschedule")
            except Exception as e:
                logger.error(f"❌ Failed to save reschedule record: {str(e)}")
                logger.error(f"Traceback: {traceback.format_exc()}")
            # ==================== END SAVE RESCHEDULE RECORD ====================
            
            # Build success message
            success_msg = "✅ *Appointment Rescheduled Successfully!*\n\n"
            success_msg += f"📋 *Appointment ID:* {appointment_id}\n"
            success_msg += f"👨‍⚕️ *Doctor:* {appointment.get('doctor_name', 'N/A')}\n"
            success_msg += f"🏥 *Specialization:* {appointment.get('specialization', 'N/A')}\n"
            success_msg += f"📅 *New Date:* {session.get('new_display_date', 'N/A')}\n"
            success_msg += f"⏰ *New Time:* {new_time}\n"
            success_msg += f"📝 *Visit Type:* {appointment.get('visit_type', 'New Visit').title()}\n\n"
            success_msg += "📌 *Instructions:*\n"
            success_msg += "   • Arrive 15 minutes before appointment\n"
            success_msg += "   • Bring your ID and insurance card\n"
            success_msg += "   • Bring any previous medical reports\n\n"
            success_msg += "🏥 *Main Menu*\n\n"
            success_msg += "1. 📄 Upload Lab Reports\n"
            success_msg += "2. 📅 Book/Reschedule Another Appointment\n\n"
            success_msg += "Reply with 1 or 2"
            
            # Reset session
            session["state"] = ConversationState.MAIN_MENU
            session.pop("selected_appointment", None)
            session.pop("upcoming_appointments", None)
            session.pop("new_appointment_date", None)
            session.pop("new_appointment_time", None)
            session.pop("new_display_date", None)
            session.pop("time_slot_page", None)
            session.pop("all_time_slots", None)
            session.pop("appointment_details", None)
            
            return success_msg
        else:
            return ("❌ Failed to reschedule appointment. "
                    "Please contact the hospital directly or try again later.\n\n"
                    "🏥 *Main Menu*\n\n"
                    "1. 📄 Upload Lab Reports\n"
                    "2. 📅 Book/Reschedule Another Appointment\n\n"
                    "Reply with 1 or 2")
    
    elif user_input == "2":  # Cancel reschedule
        session["state"] = ConversationState.MAIN_MENU
        # Clear all reschedule data
        session.pop("selected_appointment", None)
        session.pop("upcoming_appointments", None)
        session.pop("new_appointment_date", None)
        session.pop("new_appointment_time", None)
        session.pop("new_display_date", None)
        session.pop("time_slot_page", None)
        session.pop("all_time_slots", None)
        session.pop("appointment_details", None)
        
        return ("❌ Reschedule cancelled.\n\n"
                "🏥 *Main Menu*\n\n"
                "1. 📄 Upload Lab Reports\n"
                "2. 📅 Book/Reschedule Appointment\n\n"
                "Reply with 1 or 2")
    
    return "❌ Please choose:\n1. ✅ Yes, confirm reschedule\n2. ❌ No, cancel reschedule"

async def handle_reschedule_confirm_no_appointments(user_input: str, session: dict) -> str:
    """Handle when user wants to reschedule but has no appointments"""
    if user_input == "1":  # Yes, book new appointment
        # Switch to regular booking flow
        session["state"] = ConversationState.APPOINTMENT_VERIFY
        # Clear the reschedule flag so it acts like a new booking
        session["appointment_details"]["is_reschedule"] = False
        # Also clear the flag that might make it think we're in reschedule flow
        session.pop("upcoming_appointments", None)
        
        # Call the verification handler with empty input to start fresh
        return await handle_appointment_verify("", session)
    
    elif user_input == "2":  # No, return to main menu
        session["state"] = ConversationState.MAIN_MENU
        session["appointment_details"] = {}
        session.pop("upcoming_appointments", None)
        
        return ("🏥 *Main Menu*\n\n"
                "1. 📄 Upload Lab Reports\n"
                "2. 📅 Book/Reschedule Appointment\n\n"
                "Reply with 1 or 2")
    
    return ("❌ Please choose:\n\n"
            "1. ✅ Yes, book new appointment\n"
            "2. ❌ No, return to main menu")

async def handle_no_time_slots(user_input: str, session: dict) -> str:
    """Handle when no time slots are available - FIXED for main menu return"""
    user_input = user_input.lower().strip()
    
    logger.info(f"🔄 Handling no time slots - Input: {user_input}")
    
    # Check if it's a number input
    if user_input.isdigit():
        choice = int(user_input)
        
        if choice == 1:  # Select different date or doctor
            if session.get("no_schedule"):
                # No schedule - go back to doctor selection
                session["state"] = ConversationState.APPOINTMENT_SELECT_DOCTOR
                session.pop("no_time_slots", None)
                session.pop("no_schedule", None)
                session.pop("time_slot_page", None)
                session.pop("time_groups", None)
                session.pop("all_time_slots", None)
                
                # Get doctors list
                doctors = session.get("available_doctors", [])
                if doctors:
                    doctor_list = "\n".join([f"{i+1}. {doc.get('name', 'N/A')}" for i, doc in enumerate(doctors)])
                    return f"👨‍⚕️ *Select a Different Doctor*\n\n{doctor_list}\n\nPlease select a doctor (1-{len(doctors)}):"
                else:
                    session["state"] = ConversationState.APPOINTMENT_SELECT_SPECIALITY
                    speciality_list = "\n".join([f"{i+1}. {spec}" for i, spec in enumerate(SPECIALITIES)])
                    return f"🏥 *Select Speciality*\n\n{speciality_list}\n\nPlease choose a speciality (1-{len(SPECIALITIES)}):"
            else:
                # Has schedule but not available - go back to date selection
                session["state"] = ConversationState.APPOINTMENT_SELECT_DATE
                session.pop("no_time_slots", None)
                session.pop("no_schedule", None)
                session.pop("time_slot_page", None)
                session.pop("time_groups", None)
                session.pop("all_time_slots", None)
                
                # Regenerate date message
                doctor_info = session.get("appointment_details", {}).get("doctor", {})
                doctor_sys_user_id = doctor_info.get("sys_user_id")
                
                if doctor_sys_user_id:
                    available_days = await get_doctor_available_days(doctor_sys_user_id)
                    date_message, available_dates = generate_date_selection_message(available_days)
                    
                    if date_message:
                        session["available_dates"] = available_dates
                        session["date_message"] = date_message
                        return date_message
                
                return "📅 Please select a different date:"
        
        elif choice == 2:  # Return to main menu
            logger.info("✅ User chose to return to main menu from no time slots")
            
            # COMPLETELY RESET THE SESSION FOR MAIN MENU
            session["state"] = ConversationState.MAIN_MENU
            
            # Clear all appointment-related data
            session.pop("no_time_slots", None)
            session.pop("no_schedule", None)
            session.pop("time_slot_page", None)
            session.pop("time_groups", None)
            session.pop("all_time_slots", None)
            session.pop("available_dates", None)
            session.pop("date_message", None)
            session.pop("available_doctors", None)
            session.pop("available_specialities", None)
            session.pop("no_doctor_dates", None)
            session.pop("doctor_with_no_dates", None)
            session.pop("upcoming_appointments", None)
            session.pop("selected_appointment", None)
            session.pop("new_appointment_date", None)
            session.pop("new_appointment_time", None)
            session.pop("new_display_date", None)
            session.pop("appointment_choice", None)
            session.pop("reschedule_or_new_choice", None)
            session.pop("reschedule_or_new_choice_same_doctor", None)
            
            # Reset appointment details completely
            session["appointment_details"] = {}
            session["data"] = {}
            
            # Return to main menu with all 4 options
            return ("🏥 *Main Menu*\n\n"
                    "1. 📄 Upload Lab Reports\n"
                    "2. 📅 Book/Reschedule Appointment\n"
                    "3. 🎓 Ask the Doctor / Health Education\n"
                    "4. 🏥 Register Your Own Clinic\n\n"
                    "_Reply with 1, 2, 3, or 4_")
        
        elif choice == 3:  # Contact hospital
            session["state"] = ConversationState.MAIN_MENU
            
            # Clear all appointment-related data
            session.pop("no_time_slots", None)
            session.pop("no_schedule", None)
            session.pop("time_slot_page", None)
            session.pop("time_groups", None)
            session.pop("all_time_slots", None)
            session.pop("available_dates", None)
            session.pop("date_message", None)
            session.pop("available_doctors", None)
            session.pop("available_specialities", None)
            session.pop("no_doctor_dates", None)
            session.pop("doctor_with_no_dates", None)
            session.pop("upcoming_appointments", None)
            session.pop("selected_appointment", None)
            session.pop("new_appointment_date", None)
            session.pop("new_appointment_time", None)
            session.pop("new_display_date", None)
            session.pop("appointment_choice", None)
            session.pop("reschedule_or_new_choice", None)
            session.pop("reschedule_or_new_choice_same_doctor", None)
            
            # Reset appointment details
            session["appointment_details"] = {}
            session["data"] = {}
            
            return ("📞 *Hospital Contact*\n\n"
                    "Please contact the hospital directly:\n"
                    "📱 Phone: +1-234-567-8900\n"
                    "📍 Address: 123 Hospital St, City\n\n"
                    "🏥 *Main Menu*\n\n"
                    "1. 📄 Upload Lab Reports\n"
                    "2. 📅 Book/Reschedule Appointment\n"
                    "3. 🎓 Ask the Doctor / Health Education\n"
                    "4. 🏥 Register Your Own Clinic\n\n"
                    "_Reply with 1, 2, 3, or 4_")
    
    # Default response for invalid input
    doctor_info = session.get("appointment_details", {}).get("doctor", {})
    doctor_name = doctor_info.get("name", "the doctor")
    
    if session.get("no_schedule"):
        return (f"❌ *No Schedule Found*\n\n"
                f"{doctor_name} doesn't have an OPD schedule configured.\n\n"
                f"**Please choose:**\n\n"
                f"1. 📅 Select a different doctor\n"
                f"2. 🏥 Return to main menu\n"
                f"3. 📞 Contact hospital")
    else:
        display_date = session.get("appointment_details", {}).get("display_date", "Selected Date")
        return (f"📅 *Date Selected:* {display_date}\n\n"
                f"❌ *No Time Slots Available*\n\n"
                f"{doctor_name} doesn't have available time slots on {display_date}.\n\n"
                f"**Please choose:**\n\n"
                f"1. 📅 Select a different date\n"
                f"2. 🏥 Return to main menu\n"
                f"3. 📞 Contact hospital")

async def handle_no_doctor_dates(user_input: str, session: dict) -> str:
    """Handle when no dates are available for selected doctor - FIXED for main menu return"""
    user_input = user_input.lower().strip()
    
    # Get doctor info
    doctor_info = session.get("doctor_with_no_dates", {})
    doctor_name = doctor_info.get("name", "the selected doctor")
    
    logger.info(f"🔄 Handling no doctor dates - Input: {user_input}, Doctor: {doctor_name}")
    
    if user_input == "1":  # Select different doctor
        logger.info("✅ User chose to select a different doctor")
        
        # Clear current doctor and go back to doctor selection
        session["state"] = ConversationState.APPOINTMENT_SELECT_DOCTOR
        
        # Clear all the no-doctor-dates related flags
        session.pop("no_doctor_dates", None)
        session.pop("doctor_with_no_dates", None)
        session.pop("available_dates", None)
        session.pop("date_message", None)
        
        # Get doctors list from session
        doctors = session.get("available_doctors", [])
        
        # Filter out the current doctor
        current_doctor_sys_id = session.get("appointment_details", {}).get("doctor", {}).get("sys_user_id")
        filtered_doctors = [doc for doc in doctors if doc.get("sys_user_id") != current_doctor_sys_id]
        
        if filtered_doctors:
            session["available_doctors"] = filtered_doctors
            
            # Create doctor list for display
            doctor_options = [
                f"{i+1}. {doc.get('name', 'N/A')}" + 
                (f" ({doc.get('qualifications', '')})" if doc.get('qualifications') else "")
                for i, doc in enumerate(filtered_doctors)
            ]
            
            doctor_list = "\n".join(doctor_options)
            
            return (f"👨‍⚕️ *Select a Different Doctor*\n\n"
                    f"*Note:* {doctor_name} has no available dates.\n\n"
                    f"{doctor_list}\n\n"
                    f"Please select a different doctor (1-{len(filtered_doctors)}):")
        else:
            # No other doctors available, go back to speciality selection
            session["state"] = ConversationState.APPOINTMENT_SELECT_SPECIALITY
            session["available_specialities"] = SPECIALITIES
            
            # Clear doctor from appointment details
            if "doctor" in session["appointment_details"]:
                session["appointment_details"].pop("doctor", None)
            
            speciality_list = "\n".join([f"{i+1}. {spec}" for i, spec in enumerate(SPECIALITIES)])
            
            return (f"👨‍⚕️ *Select Different Speciality*\n\n"
                    f"*Note:* No other doctors available in current speciality.\n\n"
                    f"🏥 *Select Speciality*\n\n"
                    f"{speciality_list}\n\n"
                    f"Please choose a different speciality (1-{len(SPECIALITIES)}):")
    
    elif user_input == "2":  # Return to main menu
        logger.info("✅ User chose to return to main menu from no doctor dates")
        
        # COMPLETELY RESET THE SESSION FOR MAIN MENU
        session["state"] = ConversationState.MAIN_MENU
        
        # Clear all appointment-related data
        session.pop("no_doctor_dates", None)
        session.pop("doctor_with_no_dates", None)
        session.pop("available_dates", None)
        session.pop("date_message", None)
        session.pop("available_doctors", None)
        session.pop("available_specialities", None)
        session.pop("time_slot_page", None)
        session.pop("time_groups", None)
        session.pop("all_time_slots", None)
        session.pop("no_time_slots", None)
        session.pop("no_schedule", None)
        session.pop("upcoming_appointments", None)
        session.pop("selected_appointment", None)
        session.pop("new_appointment_date", None)
        session.pop("new_appointment_time", None)
        session.pop("new_display_date", None)
        session.pop("appointment_choice", None)
        session.pop("reschedule_or_new_choice", None)
        session.pop("reschedule_or_new_choice_same_doctor", None)
        
        # Reset appointment details completely
        session["appointment_details"] = {}
        session["data"] = {}
        
        # Return to main menu with all 4 options
        return ("🏥 *Main Menu*\n\n"
                "1. 📄 Upload Lab Reports\n"
                "2. 📅 Book/Reschedule Appointment\n"
                "3. 🎓 Ask the Doctor / Health Education\n"
                "4. 🏥 Register Your Own Clinic\n\n"
                "_Reply with 1, 2, 3, or 4_")
    
    # Default response if invalid input
    logger.warning(f"⚠️ Invalid input for no doctor dates: {user_input}")
    return (f"❌ *No Dates Available for {doctor_name}*\n\n"
            f"**Please choose:**\n\n"
            f"1. 📅 Select a different doctor\n"
            f"2. 🏥 Return to main menu")

async def handle_followup_response(session_id: str, user_input: str, session: dict) -> str:
    """
    Handle patient responses to follow-up reminders
    Processes button clicks (YES_patientId or NO_uuid) and text responses (1, 2, 3)
    SAVES patient response with timestamp to the follow-up record
    """
    current_state = session.get("state", "date_selection")
    patient_name = session.get("patient_name", "Patient")
    doctor_name = session.get("doctor_name", "Doctor")
    doctor_sys_user_id = session.get("doctor_sys_user_id")
    follow_up_id = session.get("follow_up_id")
    followup_uuid = session.get("followup_uuid")
    yes_button_id = session.get("yes_button_id")
    no_button_id = session.get("no_button_id")
    
    user_input = user_input.strip()
    
    logger.info("=" * 80)
    logger.info(f"📥 FOLLOW-UP RESPONSE RECEIVED")
    logger.info("=" * 80)
    logger.info(f"🔑 Session ID: {session_id}")
    logger.info(f"👤 Patient: {patient_name}")
    logger.info(f"🆔 Follow-up ID: {follow_up_id}")
    logger.info(f"🔢 Follow-up UUID: {followup_uuid}")
    logger.info(f"📝 User Input: '{user_input}'")
    logger.info(f"🔄 Current State: {current_state}")
    logger.info(f"🔘 Expected Yes Button: {yes_button_id}")
    logger.info(f"🔘 Expected No Button: {no_button_id}")
    
    # ==================== PARSE BUTTON ID ====================
    response_value = None
    is_button_click = False
    patient_id_from_button = None
    uuid_from_button = None
    
    # Check if this is a button click (YES_patientId or NO_uuid)
    if user_input.startswith("YES_") or user_input.startswith("NO_"):
        is_button_click = True
        
        if user_input.startswith("YES_"):
            response_value = "yes"
            # Extract patient_id from button
            parts = user_input.split('_', 1)
            if len(parts) == 2:
                patient_id_from_button = parts[1]
                logger.info(f"🔘 Yes button clicked - Patient ID: {patient_id_from_button}")
        elif user_input.startswith("NO_"):
            response_value = "no"
            # Extract uuid from button
            parts = user_input.split('_', 1)
            if len(parts) == 2:
                uuid_from_button = parts[1]
                logger.info(f"🔘 No button clicked - UUID: {uuid_from_button}")
                # Verify UUID matches
                if uuid_from_button != followup_uuid:
                    logger.warning(f"⚠️ UUID mismatch! Button: {uuid_from_button}, Session: {followup_uuid}")
    
    # Handle text responses (1, 2, 3)
    elif user_input in ["1", "2", "3"]:
        if user_input == "1":
            response_value = "yes"
        elif user_input == "2":
            response_value = "reschedule"
        elif user_input == "3":
            response_value = "no"
    
    # ==================== SAVE RESPONSE TO DATABASE ====================
    if follow_up_id and response_value:
        try:
            current_time = datetime.utcnow().isoformat()
            
            update_data = {
                "patient_response": response_value,
                "response_time": current_time,
                "response_received": True,
                "response_type": "button" if is_button_click else "text",
                "raw_input": user_input
            }
            
            # Add button-specific data if available
            if is_button_click:
                if patient_id_from_button:
                    update_data["patient_id_from_button"] = patient_id_from_button
                if uuid_from_button:
                    update_data["uuid_from_button"] = uuid_from_button
                    # Verify UUID match in the update
                    update_data["uuid_match"] = (uuid_from_button == followup_uuid)
            
            result = await whatsapp_followup_collection.update_one(
                {"_id": ObjectId(follow_up_id)},
                {"$set": update_data}
            )
            
            if result.modified_count > 0:
                logger.info(f"✅ Saved response '{response_value}' for follow-up {follow_up_id} at {current_time}")
                logger.info(f"📊 Update data: {update_data}")
            else:
                # Try to insert the data if document wasn't modified
                await whatsapp_followup_collection.update_one(
                    {"_id": ObjectId(follow_up_id)},
                    {"$set": update_data},
                    upsert=True
                )
                logger.info(f"✅ Inserted/Updated response for follow-up {follow_up_id}")
                
        except Exception as e:
            logger.error(f"❌ Error saving response to database: {str(e)}")
            logger.error(f"Traceback: {traceback.format_exc()}")
    else:
        if not follow_up_id:
            logger.warning(f"⚠️ No follow_up_id in session for response")
        if not response_value:
            logger.warning(f"⚠️ Could not determine response value from input: '{user_input}'")
    
    # ==================== PROCESS THE RESPONSE ====================
    # State 1: Date selection (initial response)
    if current_state == "date_selection":
        if response_value == "yes":
            logger.info(f"✅ Patient {patient_name} confirmed attendance via {'button' if is_button_click else 'text'}")
            
            # Check if doctor was available
            nearest_date = session.get("nearest_date")
            original_date = session.get("original_followup_date")
            available_dates = session.get("available_dates", [])
            
            # Check if doctor was available on original date
            doctor_was_available = any(
                date_info["date"] == original_date
                for date_info in available_dates
            ) if available_dates else False
            
            if nearest_date and not doctor_was_available:
                # Doctor was not available, patient confirming nearest date
                session["selected_date"] = nearest_date
                session["state"] = "time_selection"
                
                # Get time slots
                time_groups, all_time_slots = await generate_time_slots_for_doctor(
                    doctor_sys_user_id,
                    nearest_date["date"]
                )
                
                if time_groups and all_time_slots:
                    session["time_groups"] = time_groups
                    session["all_time_slots"] = all_time_slots
                    session["time_page"] = 0
                    
                    return (f"✅ *Date Confirmed:* {nearest_date['display_date']}\n\n"
                           f"⏰ *Select Time Slot:*\n\n"
                           f"{time_groups[0]}\n\n"
                           f"*Options:*\n"
                           f"• Select time (1-6)\n"
                           f"• Type 'more' for more slots\n"
                           f"• Type 'back' to change date")
                else:
                    return (f"❌ No time slots available for {nearest_date['display_date']}\n\n"
                           f"Please contact the hospital to schedule.")
            else:
                # Doctor was available, patient confirming original date
                original_date_obj = datetime.strptime(original_date, "%Y-%m-%d")
                display_date = original_date_obj.strftime("%B %d, %Y")
                
                session["selected_date"] = {
                    "date": original_date,
                    "display_date": display_date
                }
                session["state"] = "reason_for_visit"
                return (f"✅ *Confirmed!* You'll attend on:\n"
                       f"📅 {display_date}\n\n"
                       f"📝 *Please describe the reason for your follow-up visit:*")
        
        elif response_value == "reschedule":
            logger.info(f"📅 Patient {patient_name} wants to reschedule via {'button' if is_button_click else 'text'}")
            
            available_dates = session.get("available_dates", [])
            if available_dates:
                session["state"] = "choose_different_date"
                date_list = "\n".join([f"{i+1}. {d['display_date']} ({d['day_name']})" for i, d in enumerate(available_dates[:7])])
                return (f"📅 *Available Dates for Dr. {doctor_name}:*\n\n"
                       f"{date_list}\n\n"
                       f"Please choose a date (1-{min(7, len(available_dates))}):")
            else:
                return "❌ No dates available. Please contact hospital."
        
        elif response_value == "no":
            logger.info(f"❌ Patient {patient_name} declined follow-up via {'button' if is_button_click else 'text'}")
            
            # Update follow-up record with decline reason
            if follow_up_id:
                try:
                    await whatsapp_followup_collection.update_one(
                        {"_id": ObjectId(follow_up_id)},
                        {"$set": {
                            "patient_declined": True,
                            "declined_at": datetime.utcnow().isoformat(),
                            "declined_reason": f"Patient declined via {'button' if is_button_click else 'text'} response",
                            "declined_via": "whatsapp_button" if is_button_click else "whatsapp_text"
                        }}
                    )
                    logger.info(f"✅ Updated follow-up record {follow_up_id} as declined")
                except Exception as e:
                    logger.error(f"❌ Failed to update follow-up record: {str(e)}")
            
            # Clean up session
            if session_id in USER_RESPONSE_SESSIONS:
                del USER_RESPONSE_SESSIONS[session_id]
            
            return (f"👋 Okay {patient_name},\n\n"
                   f"Your follow-up with Dr. {doctor_name} has been cancelled as requested.\n\n"
                   f"You can schedule a new appointment anytime.\n\n"
                   f"Thank you!")
        
        else:
            # Get urgency context for the reminder
            days_difference = session.get("days_difference", 0)
            if days_difference == 0:
                urgency = "TODAY - Urgent Reminder"
            elif days_difference == 1:
                urgency = "TOMORROW - Reminder"
            elif days_difference == 2:
                urgency = "Day After Tomorrow - Reminder"
            else:
                urgency = "Follow-up Reminder"
            
            return (f"❌ Please choose:\n\n"
                   f"1. ✅ Yes/Confirm ({urgency})\n"
                   f"2. 📅 Reschedule/See dates\n"
                   f"3. ❌ No/Cancel\n\n"
                   f"Reply with 1, 2, or 3")
    
    # State 2: Choose different date
    elif current_state == "choose_different_date":
        try:
            choice = int(user_input) - 1
            available_dates = session.get("available_dates", [])
            
            if 0 <= choice < len(available_dates):
                selected_date = available_dates[choice]
                session["selected_date"] = selected_date
                session["state"] = "time_selection"
                
                # Get time slots
                time_groups, all_time_slots = await generate_time_slots_for_doctor(
                    doctor_sys_user_id,
                    selected_date["date"]
                )
                
                if time_groups and all_time_slots:
                    session["time_groups"] = time_groups
                    session["all_time_slots"] = all_time_slots
                    session["time_page"] = 0
                    
                    return (f"✅ *Date Selected:* {selected_date['display_date']}\n\n"
                           f"⏰ *Select Time Slot:*\n\n"
                           f"{time_groups[0]}\n\n"
                           f"*Options:*\n"
                           f"• Select time (1-6)\n"
                           f"• Type 'more' for more slots\n"
                           f"• Type 'back' to change date")
                else:
                    return (f"❌ No time slots available for {selected_date['display_date']}\n\n"
                           f"Please select a different date.")
            else:
                return f"❌ Please choose a valid number (1-{min(7, len(available_dates))})."
        except ValueError:
            available_dates = session.get("available_dates", [])
            date_list = "\n".join([f"{i+1}. {d['display_date']} ({d['day_name']})" for i, d in enumerate(available_dates[:7])])
            return (f"❌ Please enter a valid number.\n\n"
                   f"📅 *Available Dates for Dr. {doctor_name}:*\n\n"
                   f"{date_list}\n\n"
                   f"Please choose a date (1-{min(7, len(available_dates))}):")
    
    # State 3: Time selection
    elif current_state == "time_selection":
        user_input_lower = user_input.lower()
        current_time_page = session.get("time_page", 0)
        time_groups = session.get("time_groups", [])
        all_time_slots = session.get("all_time_slots", [])
        selected_date = session.get("selected_date", {})
        
        if not time_groups or not all_time_slots:
            return "❌ No time slots available. Please go back and select a different date."
        
        # Handle navigation commands
        if user_input_lower == "back":
            session["state"] = "choose_different_date"
            available_dates = session.get("available_dates", [])
            date_list = "\n".join([f"{i+1}. {d['display_date']} ({d['day_name']})" for i, d in enumerate(available_dates[:7])])
            return (f"📅 *Available Dates for Dr. {doctor_name}:*\n\n"
                   f"{date_list}\n\n"
                   f"Please choose a date (1-{min(7, len(available_dates))}):")
        
        elif user_input_lower == "more":
            if current_time_page < len(time_groups) - 1:
                session["time_page"] = current_time_page + 1
                return (f"📅 *Date Selected:* {selected_date.get('display_date', 'Selected Date')}\n\n"
                       f"⏰ *Select Time Slot (Page {current_time_page + 2}/{len(time_groups)}):*\n\n"
                       f"{time_groups[current_time_page + 1]}\n\n"
                       f"*Options:*\n"
                       f"• Select time (1-6)\n"
                       f"• Type 'more' for more slots\n"
                       f"• Type 'back' to change date")
            else:
                return (f"❌ No more time slots available.\n\n"
                       f"{time_groups[current_time_page]}\n\n"
                       f"Please select a time slot (1-6) or type 'back' to change date.")
        
        # Handle time slot selection (1-6)
        elif user_input.isdigit():
            choice = int(user_input)
            if 1 <= choice <= 6:
                # Calculate actual time slot index
                start_index = current_time_page * 6
                slot_index = start_index + (choice - 1)
                
                if slot_index < len(all_time_slots):
                    selected_time = all_time_slots[slot_index]
                    session["selected_time"] = selected_time
                    session["state"] = "reason_for_visit"
                    
                    return (f"✅ *Time Selected:* {selected_time}\n\n"
                           f"📝 *Please describe the reason for your follow-up visit:*")
                else:
                    return f"❌ Invalid time slot. Please choose 1-6."
            else:
                return f"❌ Please choose a valid time slot (1-6)."
        else:
            return (f"❌ Invalid input.\n\n"
                   f"{time_groups[current_time_page]}\n\n"
                   f"*Options:*\n"
                   f"• Select time (1-6)\n"
                   f"• Type 'more' for more slots\n"
                   f"• Type 'back' to change date")
    
    # State 4: Reason for visit
    elif current_state == "reason_for_visit":
        if user_input.strip():
            session["reason_for_visit"] = user_input.strip()
            session["state"] = "appointment_confirmation"
            
            # Build confirmation message
            selected_date = session.get("selected_date", {})
            selected_time = session.get("selected_time", "To be selected")
            
            confirmation_msg = (f"📋 *Appointment Summary*\n\n"
                               f"👤 Patient: {patient_name}\n"
                               f"👨‍⚕️ Doctor: Dr. {doctor_name}\n"
                               f"📅 Date: {selected_date.get('display_date', 'N/A')}\n"
                               f"⏰ Time: {selected_time}\n"
                               f"📝 Reason: {user_input.strip()[:100]}{'...' if len(user_input.strip()) > 100 else ''}\n\n"
                               f"*Please confirm:*\n"
                               f"1. ✅ Yes, book appointment\n"
                               f"2. ❌ No, cancel")
            
            return confirmation_msg
        else:
            return "📝 Please describe the reason for your follow-up visit:"
    
    # State 5: Appointment confirmation
    elif current_state == "appointment_confirmation":
        if user_input in ["1", "yes", "confirm"]:
            # Book the appointment
            appointment_result = await book_followup_appointment(session)
            
            if appointment_result.get("success"):
                # Update follow-up record
                if follow_up_id:
                    try:
                        await whatsapp_followup_collection.update_one(
                            {"_id": ObjectId(follow_up_id)},
                            {"$set": {
                                "appointment_booked": True,
                                "appointment_id": appointment_result.get("appointment_id"),
                                "booked_at": datetime.utcnow().isoformat(),
                                "booked_date": session.get("selected_date", {}).get("date"),
                                "booked_time": session.get("selected_time"),
                                "booked_reason": session.get("reason_for_visit", ""),
                                "status": "booked"
                            }}
                        )
                        logger.info(f"✅ Updated follow-up record {follow_up_id} as booked")
                    except Exception as e:
                        logger.error(f"❌ Failed to update follow-up record: {str(e)}")
                
                # Clean up session
                if session_id in USER_RESPONSE_SESSIONS:
                    del USER_RESPONSE_SESSIONS[session_id]
                
                return (f"✅ *Appointment Booked!*\n\n"
                       f"📋 Appointment ID: {appointment_result.get('appointment_id')}\n"
                       f"👨‍⚕️ Doctor: Dr. {doctor_name}\n"
                       f"📅 Date: {session.get('selected_date', {}).get('display_date')}\n"
                       f"⏰ Time: {session.get('selected_time', 'N/A')}\n\n"
                       f"Please arrive 15 minutes early.\n\n"
                       f"Thank you!")
            else:
                return (f"❌ Failed to book appointment.\n\n"
                       f"Error: {appointment_result.get('error')}\n\n"
                       f"Please contact the hospital directly.")
        else:
            # Cancel
            if session_id in USER_RESPONSE_SESSIONS:
                del USER_RESPONSE_SESSIONS[session_id]
            
            return "❌ Appointment cancelled. You can schedule anytime later."
    
    # Default response for invalid state
    logger.warning(f"⚠️ Invalid response in state {current_state}: {user_input}")
    return "❌ Invalid response. Please try again or contact the hospital."

# ============================================================
# ============ MAIN EDUCATION HANDLER FUNCTION ==============
# ============================================================


async def handle_education_question(user_input: str, session: dict, from_number: str) -> str:
    """
    Handle the patient's health question and generate an answer using their medical records
    SAVES: patient_id, doctor_id, question, answer, date, time
    PLUS: hms_id, phone_number, hospital_id, appointment_id, question_source, question_number
    """
    question = user_input.strip()
    
    # ==================== CHECK FOR MENU CHOICES FIRST ====================
    # Check if user is selecting from the menu options
    if question in ["1", "2"]:
        if question == "1":  # Yes, ask another question
            # Stay in education state for next question
            session["state"] = ConversationState.EDUCATION_ASK_QUESTION
            return ("📝 *Great! Ask your next health question*\n\n"
                    "What would you like to know about your health?\n\n"
                    "Type your question below (or type 'menu' to return):")
        
        elif question == "2":  # No, return to main menu
            session["state"] = ConversationState.MAIN_MENU
            session["appointment_details"] = {}
            session["education_data"] = {}  # Clear education data
            return ("🏥 *Returning to Main Menu*\n\n"
                    "1. 📄 Upload Lab Reports\n"
                    "2. 📅 Book/Reschedule Appointment\n"
                    "3. 🎓 Ask the Doctor / Health Education\n"
                    "4. 🏥 Register Your Own Clinic\n\n"
                    "_Reply with 1, 2, 3, or 4_")
    
    # Check for exit commands
    if question.lower() in ["exit", "quit", "done", "back", "menu", "main menu", "main"]:
        session["state"] = ConversationState.MAIN_MENU
        session["appointment_details"] = {}
        session["education_data"] = {}
        return ("🏥 *Returning to Main Menu*\n\n"
                "1. 📄 Upload Lab Reports\n"
                "2. 📅 Book/Reschedule Appointment\n"
                "3. 🎓 Ask the Doctor / Health Education\n"
                "4. 🏥 Register Your Own Clinic\n\n"
                "_Reply with 1, 2, 3, or 4_")
    
    # ==================== PROCESS AS ACTUAL QUESTION ====================
    if not question:
        return "📝 Please type your health question:"
    
    # Get patient info from session
    patient_info = session.get("education_data", {}).get("patient_info", {})
    
    # If education_data doesn't exist, try to get from appointment_details
    if not patient_info:
        patient_info = {
            "hms_id": session.get("appointment_details", {}).get("hms_id"),
            "patient_id": session.get("appointment_details", {}).get("temp_patient_info", {}).get("sys_user_id"),
            "patient_name": session.get("appointment_details", {}).get("temp_patient_info", {}).get("name", "Patient"),
            "phone_number": session.get("appointment_details", {}).get("temp_patient_info", {}).get("phone_number"),
            "hospital_id": session.get("appointment_details", {}).get("temp_patient_info", {}).get("hospital_id")
        }
        session["education_data"] = {"patient_info": patient_info, "questions_asked": 0}
    
    hms_id = patient_info.get("hms_id")
    patient_id = patient_info.get("patient_id")
    patient_name = patient_info.get("patient_name", "Patient")
    phone_number = patient_info.get("phone_number")
    hospital_id = patient_info.get("hospital_id")
    
    if not hms_id or not patient_id:
        session["state"] = ConversationState.MAIN_MENU
        return ("❌ *Session Expired*\n\n"
                "Please start again from the main menu.\n\n"
                "🏥 *Main Menu*\n\n"
                "Reply with 1, 2, or 3")
    
    # Track question number
    questions_asked = session.get("education_data", {}).get("questions_asked", 0) + 1
    session["education_data"]["questions_asked"] = questions_asked
    
    logger.info(f"📝 Processing question #{questions_asked} from patient: {patient_name}")
    logger.info(f"❓ Question: {question[:100]}...")
    logger.info(f"👤 Patient ID: {patient_id}")
    logger.info(f"🆔 HMS ID: {hms_id}")
    logger.info(f"📱 Phone: {phone_number}")
    logger.info(f"🏥 Hospital ID: {hospital_id}")
    
    # ==================== FETCH MEDICAL CONTEXT ====================
    logger.info(f"🔄 Fetching medical context for patient: {patient_id}")
    medical_context = await get_patient_medical_context(patient_id)
    
    # ==================== EXTRACT ONLY WHAT WE NEED ====================
    doctor_id = None
    doctor_name = None
    appointment_date = None
    appointment_id = None
    context_summary = "No specific medical records found."
    
    if medical_context:
        logger.info("📋 Medical context response received - extracting required fields only")
        
        # Extract doctor_id from the response
        if isinstance(medical_context, dict):
            doctor_id = medical_context.get("doctor_id")
            
            # Also check if doctor_id exists in the data array
            if not doctor_id and "data" in medical_context and isinstance(medical_context["data"], list):
                if len(medical_context["data"]) > 0:
                    doctor_id = medical_context["data"][0].get("doctor_id")
                    appointment_id = medical_context["data"][0].get("appointment_id")
            
            # Get doctor name if available
            if doctor_id:
                doctor_name = medical_context.get("doctor_name")
                if not doctor_name and "data" in medical_context and isinstance(medical_context["data"], list):
                    if len(medical_context["data"]) > 0:
                        doctor_name = medical_context["data"][0].get("doctor_name")
            
            # Extract appointment date from follow_up if available
            if "data" in medical_context and isinstance(medical_context["data"], list):
                for item in medical_context["data"]:
                    processed_data = item.get("processed_data", [])
                    for pd in processed_data:
                        content = pd.get("content", {})
                        follow_up = content.get("follow_up", {})
                        if follow_up and follow_up.get("appointment_date"):
                            appointment_date = follow_up.get("appointment_date")
                            break
                        # Also check for appointment_id in the data
                        if item.get("appointment_id") and not appointment_id:
                            appointment_id = item.get("appointment_id")
            
            # Build a brief summary for the prompt (not saved to DB)
            processed_data = []
            if "data" in medical_context and isinstance(medical_context["data"], list):
                processed_data = medical_context["data"][0].get("processed_data", []) if medical_context["data"] else []
            
            if processed_data and len(processed_data) > 0:
                content = processed_data[0].get("content", {})
                summary_parts = []
                
                # Chief complaint
                complaint = content.get("presenting_complaint", {})
                if complaint.get("chief_complaint"):
                    summary_parts.append(f"Chief Complaint: {complaint.get('chief_complaint')}")
                
                # Diagnoses
                diagnoses = content.get("diagnoses", [])
                if diagnoses:
                    diag_list = [d.get("diagnosis", "Unknown") for d in diagnoses if d.get("diagnosis")]
                    if diag_list:
                        summary_parts.append(f"Diagnoses: {', '.join(diag_list[:2])}")
                
                # Medications
                medications = content.get("medications", [])
                if medications:
                    med_list = [m.get("name", "Unknown") for m in medications if m.get("name")]
                    if med_list:
                        summary_parts.append(f"Medications: {', '.join(med_list[:2])}")
                
                # Treatment plan
                treatment = content.get("treatment_plan", [])
                if treatment:
                    plan_list = [p.get("description", "") for p in treatment if p.get("description")]
                    if plan_list:
                        summary_parts.append(f"Treatment: {plan_list[0]}")
                
                if summary_parts:
                    context_summary = "\n".join(summary_parts)
        
        logger.info(f"✅ EXTRACTED DATA:")
        logger.info(f"   • Patient ID: {patient_id}")
        logger.info(f"   • HMS ID: {hms_id}")
        logger.info(f"   • Phone: {phone_number}")
        logger.info(f"   • Hospital ID: {hospital_id}")
        logger.info(f"   • Doctor ID: {doctor_id or 'NOT FOUND'}")
        logger.info(f"   • Doctor Name: {doctor_name or 'NOT FOUND'}")
        logger.info(f"   • Appointment ID: {appointment_id or 'NOT FOUND'}")
        logger.info(f"   • Appointment Date: {appointment_date or 'NOT FOUND'}")
        
    else:
        logger.warning("⚠️ No medical context found for patient")
    
    # ==================== END EXTRACTION ====================
    
    # Send typing indicator (simulated)
    await asyncio.sleep(0.5)
    
    # Generate answer using LLM
    try:
        first_name = patient_name.split()[0] if patient_name else "there"
        doctor_display_name = f"Dr. {doctor_name}" if doctor_name else "your doctor"
        appointment_ref = f"from your visit on {appointment_date}" if appointment_date else ""
        
        # Construct the prompt
        prompt = f"""You are {doctor_display_name}, a compassionate physician speaking to your patient {first_name}.

PATIENT'S MEDICAL HISTORY {appointment_ref}:
{context_summary}

PATIENT'S QUESTION:
"{question}"

YOUR RESPONSE MUST:
1. Start with "Hello {first_name},"
2. Be warm, professional, and educational
3. Reference their specific medical history if relevant
4. Be concise and clear (suitable for WhatsApp)
5. End with a caring statement or offer to help further

IMPORTANT:
- DO NOT include any disclaimers
- DO NOT mention you are an AI
- DO NOT include any signatures, "Best regards", "Sincerely", or your name at the end
- Speak as their actual doctor

Now write your response:"""
        
        logger.info(f"🤖 Calling LLaMA model to generate answer...")
        
        # ==================== LLM CALL FORMAT ====================
        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=250
        )
        
        doctor_answer = completion.choices[0].message.content.strip()
        logger.info(f"✅ Generated answer ({len(doctor_answer)} chars)")
        
    except Exception as e:
        logger.error(f"❌ Error generating doctor answer: {str(e)}")
        doctor_answer = (f"Hello {first_name}, I apologize but I'm having trouble accessing your medical records at the moment. "
                        f"Please try asking your question again in a few minutes. "
                        f"If this persists, please contact the hospital directly.")
    
    # Create unique education ID
    current_time = datetime.utcnow()
    education_id = f"EDU-{current_time.strftime('%Y%m%d%H%M%S')}-{patient_id[-6:] if patient_id and len(patient_id) > 6 else 'UNKNOWN'}"
    
    # ==================== SAVE ALL REQUIRED FIELDS ====================
    try:
        education_record = {
            # Core required fields
            "education_id": education_id,
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "question": question,
            "answer": doctor_answer,
            "created_at": current_time,
            "updated_at": current_time,
            
            # Additional fields you requested
            "hms_id": hms_id,
            "phone_number": phone_number,
            "hospital_id": hospital_id,
            "appointment_id": appointment_id,
            "question_source": "whatsapp",
            "question_number": questions_asked,
            "session_id": from_number
        }
        
        # Optional: Add patient_name and doctor_name if available for readability
        if patient_name:
            education_record["patient_name"] = patient_name
        if doctor_name:
            education_record["doctor_name"] = doctor_name
        if appointment_date:
            education_record["appointment_date"] = appointment_date
        
        # NO full_medical_context field added here!
        
        await patient_education_collection.insert_one(education_record)
        logger.info(f"✅ Q&A saved to database with ID: {education_id}")
        logger.info(f"   • Patient ID: {patient_id}")
        logger.info(f"   • HMS ID: {hms_id}")
        logger.info(f"   • Phone: {phone_number}")
        logger.info(f"   • Hospital ID: {hospital_id}")
        logger.info(f"   • Doctor ID: {doctor_id or 'N/A'}")
        logger.info(f"   • Appointment ID: {appointment_id or 'N/A'}")
        logger.info(f"   • Question #: {questions_asked}")
        logger.info(f"   • Source: whatsapp")
        logger.info(f"   • Full medical context: NOT SAVED")
        
    except Exception as e:
        logger.error(f"❌ Failed to save Q&A to database: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
    
    # Build disclaimer
    disclaimer = ("\n\n⚠️ *IMPORTANT MEDICAL DISCLAIMER* ⚠️\n"
                  "This information is for educational purposes only and may contain imperfections.\n"
                  "It is NOT a substitute for professional medical advice, diagnosis, or treatment.\n"
                  "If you have a serious medical concern, please book an appointment with your doctor.\n"
                  "Always consult with qualified healthcare providers for medical decisions.\n")
    
    # Build complete response
    complete_response = f"{doctor_answer}{disclaimer}"
    
    # Add follow-up options
    MAX_QUESTIONS_PER_SESSION = 999999
    
    if questions_asked < MAX_QUESTIONS_PER_SESSION:
        complete_response += "\n\n*Would you like to ask another question?*\n"
        complete_response += "1. ✅ Yes, ask another question\n"
        complete_response += "2. ❌ No, return to main menu"
        session["state"] = ConversationState.EDUCATION_ASK_QUESTION
    else:
        complete_response += "\n\n*Returning to main menu*\n"
        session["state"] = ConversationState.MAIN_MENU
        session["appointment_details"] = {}
    
    return complete_response
# ============================================================
# ==================== ELEVENLABS HANDLERS ===================
# ============================================================

# @router.post("/elevenlabs-hms-id-webhook")
# async def handle_incoming_hms(request: Request):
#     """
#     Endpoint for ElevenLabs integration matching their exact schema
#     Four-stage workflow as per ElevenLabs tool configuration
#     """
#     try:
#         # ==================== LOG INCOMING FROM ELEVENLABS ====================
#         logger.info("=" * 80)
#         logger.info("📥 DATA FROM ELEVENLABS")
#         logger.info("=" * 80)
        
#         # Get raw request body for logging
#         body_bytes = await request.body()
#         body_str = body_bytes.decode('utf-8')
        
#         logger.info("📦 Raw JSON from ElevenLabs:")
#         logger.info(body_str)
        
#         # Parse JSON
#         try:
#             payload = json.loads(body_str) if body_str else {}
#         except json.JSONDecodeError as e:
#             logger.error(f"❌ Invalid JSON from ElevenLabs: {e}")
#             payload = {}
        
#         logger.info("📊 Parsed payload from ElevenLabs:")
#         logger.info(json.dumps(payload, indent=2))
#         logger.info("-" * 80)
        
#         # Extract parameters
#         hms_id = payload.get("HMS_ID")
#         doctor_sys_user_id = payload.get("Doctor_Sys_User_Id")
#         speciality = payload.get("speciality")
#         appointment_date = payload.get("appointment_date")
#         appointment_time = payload.get("appointment_time")
#         chief_complaint = payload.get("chief_complaint")
#         visit_type = payload.get("visit_type", "new visit")  # Default to new visit
        
#         logger.info("🔍 Parameters extracted:")
#         logger.info(f"   • HMS_ID: '{hms_id}'")
#         logger.info(f"   • speciality: '{speciality}'")
#         logger.info(f"   • Doctor_Sys_User_Id: '{doctor_sys_user_id}'")
#         logger.info(f"   • appointment_date: '{appointment_date}'")
#         logger.info(f"   • appointment_time: '{appointment_time}'")
#         logger.info(f"   • chief_complaint: '{chief_complaint}'")
#         logger.info(f"   • visit_type: '{visit_type}'")
        
#         # Validate HMS_ID (always required)
#         if not hms_id:
#             logger.error("❌ HMS_ID is required")
#             error_response = {
#                 "success": False,
#                 "error": "HMS_ID is required",
#                 "instructions": "Please provide HMS_ID parameter"
#             }
#             return JSONResponse(status_code=400, content=error_response)
        
#         # ==================== STAGE 1: HMS_ID ONLY (GET PATIENT INFO + SPECIALITIES) ====================
#         if not speciality and not doctor_sys_user_id:
#             logger.info("🎯 STAGE 1: HMS_ID only - Fetching patient info and specialities")
#             logger.info(f"   Processing HMS_ID: '{hms_id}'")
            
#             # Get patient from database - ASYNC
#             patient = await get_patient_by_hms_id(hms_id)
#             if not patient:
#                 logger.warning(f"⚠️ Patient not found for HMS_ID: '{hms_id}'")
#                 error_response = {
#                     "success": False,
#                     "error": f"Patient with HMS_ID '{hms_id}' not found",
#                     "hms_id": hms_id,
#                     "stage": "patient_info"
#                 }
#                 return JSONResponse(status_code=404, content=error_response)
            
#             logger.info(f"✅ Patient found: {patient.get('name')}")
            
#             # Get latest appointment - ASYNC
#             patient_id = patient.get("patient_id")
#             latest_appointment = await get_latest_appointment(patient_id) if patient_id else None
#             previous_doctor = None
            
#             if latest_appointment and latest_appointment.get("doctor_id"):
#                 appointment_doctor_id = latest_appointment.get("doctor_id")
#                 logger.info(f"🩺 Doctor ID from appointment: '{appointment_doctor_id}'")
#                 previous_doctor = await get_doctor_by_id(appointment_doctor_id)
                
#                 if previous_doctor:
#                     logger.info(f"✅ Previous doctor found: {previous_doctor.get('name')}")
            
#             # Get upcoming appointments to find appointment_id
#             upcoming_appointments = await get_upcoming_appointments(hms_id)
#             existing_appointment_id = None
            
#             if upcoming_appointments and len(upcoming_appointments) > 0:
#                 # Get the most recent upcoming appointment ID
#                 existing_appointment_id = upcoming_appointments[0].get("appointment_id")
#                 logger.info(f"📋 Found existing appointment ID: {existing_appointment_id}")
            
#             # Get available specialities for patient's hospital - ASYNC
#             available_specialities = await get_available_specialities_for_elevenlabs(hms_id)
            
#             # ==================== BUILD STAGE 1 RESPONSE ====================
#             response_data = {
#                 "success": True,
#                 "stage": "patient_info",
#                 "hms_id": hms_id,
#                 "patient": {
#                     "patient_id": patient.get("patient_id"),
#                     "sys_user_id": patient.get("sys_user_id"),
#                     "name": patient.get("name"),
#                     "date_of_birth": patient.get("date_of_birth"),
#                     "gender": patient.get("gender"),
#                     "blood_group": patient.get("blood_group"),
#                     "phone_number": patient.get("phone_number")
#                 },
#                 "latest_appointment": {
#                     "date": latest_appointment.get("date") if latest_appointment else None,
#                     "time": latest_appointment.get("scheduled_time") if latest_appointment else None,
#                     "doctor_id": latest_appointment.get("doctor_id") if latest_appointment else None,
#                     "visit_type": latest_appointment.get("visit_type") if latest_appointment else None
#                 } if latest_appointment else None,
#                 "existing_appointment_id": existing_appointment_id,  # NEW: Add existing appointment ID
#                 "upcoming_appointments_count": len(upcoming_appointments) if upcoming_appointments else 0,
#                 "previous_doctor": {
#                     "doctor_id": previous_doctor.get("doctor_id") if previous_doctor else None,
#                     "sys_user_id": previous_doctor.get("sys_user_id") if previous_doctor else None,
#                     "name": previous_doctor.get("name") if previous_doctor else None,
#                     "specialization": previous_doctor.get("specialization") if previous_doctor else None,
#                     "qualifications": previous_doctor.get("qualifications") if previous_doctor else None
#                 } if previous_doctor else None,
#                 "available_specialities": available_specialities,
#                 "instructions": "Select a speciality from 'available_specialities' and provide 'speciality' parameter in next request",
#                 "example_next_request": {
#                     "HMS_ID": hms_id,
#                     "speciality": "Cardiology"  # Example: Choose from available_specialities
#                 },
#                 "timestamp": datetime.now().isoformat()
#             }
            
#             return JSONResponse(status_code=200, content=response_data)
        
#         # ==================== STAGE 2: HMS_ID + SPECIALITY (GET DOCTORS) ====================
#         elif speciality and not doctor_sys_user_id:
#             logger.info("🎯 STAGE 2: HMS_ID + speciality - Getting doctors")
#             logger.info(f"   Speciality from ElevenLabs: '{speciality}'")
            
#             # Verify patient exists - ASYNC
#             patient = await get_patient_by_hms_id(hms_id)
#             if not patient:
#                 logger.warning(f"⚠️ Patient not found for HMS_ID: '{hms_id}'")
#                 error_response = {
#                     "success": False,
#                     "error": f"Patient with HMS_ID '{hms_id}' not found",
#                     "hms_id": hms_id,
#                     "speciality": speciality,
#                     "stage": "doctor_selection"
#                 }
#                 return JSONResponse(status_code=404, content=error_response)
            
#             logger.info(f"✅ Patient verified: {patient.get('name')}")
            
#             # Get doctors for the selected speciality and patient's hospital - ASYNC
#             doctors = await get_doctors_for_elevenlabs(speciality, hms_id)
            
#             if not doctors:
#                 logger.warning(f"⚠️ No doctors found for speciality: '{speciality}'")
#                 error_response = {
#                     "success": False,
#                     "error": f"No doctors available for speciality '{speciality}'",
#                     "hms_id": hms_id,
#                     "speciality": speciality,
#                     "stage": "doctor_selection",
#                     "suggestion": "Try a different speciality from available_specialities"
#                 }
#                 return JSONResponse(status_code=404, content=error_response)
            
#             logger.info(f"✅ Found {len(doctors)} doctors for speciality: '{speciality}'")
            
#             # ==================== BUILD STAGE 2 RESPONSE ====================
#             response_data = {
#                 "success": True,
#                 "stage": "doctor_selection",
#                 "hms_id": hms_id,
#                 "speciality": speciality,
#                 "patient": {
#                     "patient_id": patient.get("patient_id"),
#                     "name": patient.get("name"),
#                     "sys_user_id": patient.get("sys_user_id")
#                 },
#                 "doctors": doctors,
#                 "instructions": "Select a doctor from 'doctors' list and provide 'Doctor_Sys_User_Id' parameter in next request",
#                 "example_next_request": {
#                     "HMS_ID": hms_id,
#                     "Doctor_Sys_User_Id": doctors[0].get("sys_user_id") if doctors else "DOCTOR_SYS_USER_ID_HERE"
#                 },
#                 "timestamp": datetime.now().isoformat()
#             }
            
#             return JSONResponse(status_code=200, content=response_data)
        
#         # ==================== STAGE 3: HMS_ID + DOCTOR_SYS_USER_ID (GET AVAILABILITY) ====================
#         elif doctor_sys_user_id and not appointment_date:
#             logger.info("🎯 STAGE 3: HMS_ID + Doctor_Sys_User_Id - Getting doctor availability")
#             logger.info(f"   Doctor_Sys_User_Id from ElevenLabs: '{doctor_sys_user_id}'")
            
#             # Verify patient exists - ASYNC
#             patient = await get_patient_by_hms_id(hms_id)
#             if not patient:
#                 logger.warning(f"⚠️ Patient not found for HMS_ID: '{hms_id}'")
#                 error_response = {
#                     "success": False,
#                     "error": f"Patient with HMS_ID '{hms_id}' not found",
#                     "hms_id": hms_id,
#                     "doctor_sys_user_id": doctor_sys_user_id,
#                     "stage": "doctor_availability"
#                 }
#                 return JSONResponse(status_code=404, content=error_response)
            
#             logger.info(f"✅ Patient verified: {patient.get('name')}")
            
#             # Get doctor by sys_user_id (filtered by patient's hospital) - ASYNC
#             logger.info(f"🔍 Looking for doctor with sys_user_id: '{doctor_sys_user_id}'")
#             doctor = await get_doctor_by_sys_user_id(doctor_sys_user_id, hms_id)
            
#             if not doctor:
#                 logger.warning(f"⚠️ Doctor not found with sys_user_id: '{doctor_sys_user_id}'")
#                 error_response = {
#                     "success": False,
#                     "error": f"Doctor not found with sys_user_id: '{doctor_sys_user_id}'",
#                     "hms_id": hms_id,
#                     "doctor_sys_user_id": doctor_sys_user_id,
#                     "stage": "doctor_availability",
#                     "suggestion": "Check if this is the correct sys_user_id from previous response"
#                 }
#                 return JSONResponse(status_code=404, content=error_response)
            
#             logger.info(f"✅ Doctor found: {doctor.get('name')}")
            
#             # Get doctor availability with dates and time slots
#             logger.info(f"📅 Generating availability for doctor: {doctor.get('name')}")
#             availability = get_doctor_availability_for_elevenlabs(doctor_sys_user_id)
            
#             # ==================== BUILD STAGE 3 RESPONSE ====================
#             response_data = {
#                 "success": True,
#                 "stage": "doctor_availability",
#                 "hms_id": hms_id,
#                 "patient": {
#                     "patient_id": patient.get("patient_id"),
#                     "name": patient.get("name"),
#                     "sys_user_id": patient.get("sys_user_id")
#                 },
#                 "doctor": {
#                     "sys_user_id": doctor.get("sys_user_id"),
#                     "doctor_id": doctor.get("doctor_id"),
#                     "name": doctor.get("name"),
#                     "specialization": doctor.get("specialization"),
#                     "qualifications": doctor.get("qualifications")
#                 },
#                 "availability": availability,
#                 "instructions": "Select a date and time slot from 'availability' and provide appointment details in next request",
#                 "example_next_request": {
#                     "HMS_ID": hms_id,
#                     "Doctor_Sys_User_Id": doctor_sys_user_id,
#                     "appointment_date": "2026-01-06",
#                     "appointment_time": "4:00 PM",
#                     "chief_complaint": "chest pain",
#                     "visit_type": "new visit"
#                 },
#                 "timestamp": datetime.now().isoformat()
#             }
            
#             return JSONResponse(status_code=200, content=response_data)
        
#         # ==================== STAGE 4: COMPLETE APPOINTMENT BOOKING ====================

#         elif doctor_sys_user_id and appointment_date and appointment_time:
#             logger.info("🎯 STAGE 4: Complete appointment booking")
#             logger.info(f"   Booking appointment for HMS_ID: '{hms_id}'")
            
#             # Get patient from database - ASYNC
#             patient = await get_patient_by_hms_id(hms_id)
#             if not patient:
#                 logger.warning(f"⚠️ Patient not found for HMS_ID: '{hms_id}'")
#                 error_response = {
#                     "success": False,
#                     "error": f"Patient with HMS_ID '{hms_id}' not found",
#                     "hms_id": hms_id,
#                     "stage": "appointment_booking"
#                 }
#                 return JSONResponse(status_code=404, content=error_response)
            
#             logger.info(f"✅ Patient found: {patient.get('name')}")
#             logger.info(f"   • Patient sys_user_id: {patient.get('sys_user_id')}")
            
#             # Get doctor by sys_user_id (filtered by patient's hospital) - ASYNC
#             logger.info(f"🔍 Looking for doctor with sys_user_id: '{doctor_sys_user_id}'")
#             doctor = await get_doctor_by_sys_user_id(doctor_sys_user_id, hms_id)
            
#             if not doctor:
#                 logger.warning(f"⚠️ Doctor not found with sys_user_id: '{doctor_sys_user_id}'")
#                 error_response = {
#                     "success": False,
#                     "error": f"Doctor not found with sys_user_id: '{doctor_sys_user_id}'",
#                     "hms_id": hms_id,
#                     "doctor_sys_user_id": doctor_sys_user_id,
#                     "stage": "appointment_booking"
#                 }
#                 return JSONResponse(status_code=404, content=error_response)
            
#             logger.info(f"✅ Doctor found: {doctor.get('name')}")
#             logger.info(f"   • Doctor sys_user_id: {doctor.get('sys_user_id')}")
            
#             # Validate visit_type
#             if visit_type not in ["follow-up", "new visit"]:
#                 visit_type = "new visit"  # Default to new visit if invalid
            
#             # Prepare appointment data
#             appointment_data = {
#                 "hms_id": hms_id,
#                 "date": appointment_date,
#                 "time": appointment_time,
#                 "chief_complaint": chief_complaint or "Not specified",
#                 "visit_type": visit_type,
#                 "patient_info": {
#                     "patient_id": patient.get("patient_id"),
#                     "sys_user_id": patient.get("sys_user_id"),
#                     "name": patient.get("name"),
#                     "date_of_birth": patient.get("date_of_birth"),
#                     "gender": patient.get("gender"),
#                     "blood_group": patient.get("blood_group"),
#                     "phone_number": patient.get("phone_number")
#                 },
#                 "doctor": {
#                     "doctor_id": doctor.get("doctor_id"),
#                     "sys_user_id": doctor.get("sys_user_id"),
#                     "name": doctor.get("name"),
#                     "specialization": doctor.get("specialization", ""),
#                     "qualifications": doctor.get("qualifications", "")
#                 }
#             }
            
#             # Call the appointment booking API - ASYNC
#             logger.info("📤 Calling appointment booking API...")
#             api_result = await book_appointment_api(appointment_data)
            
#             if api_result.get("success"):
#                 logger.info("✅ Appointment booked successfully")
                
#                 # Get the appointment ID from API response
#                 new_appointment_id = api_result.get("appointment_id")
#                 logger.info(f"📋 New appointment ID: {new_appointment_id}")
                
#                 # ==================== SAVE APPOINTMENT RECORD WITH SOURCE = ELEVENLABS ====================
#                 try:
#                     # Save appointment record with source = "elevenlabs"
#                     await save_to_database(
#                         hms_id=hms_id,
#                         hospital_id=patient.get('hospital_id'),
#                         phone_number=patient.get('phone_number'),
#                         appointment_id=new_appointment_id,
#                         appointment_date=appointment_date,
#                         appointment_time=appointment_time,
#                         patient_name=patient.get('name'),
#                         source="elevenlabs",  # Explicitly set source to elevenlabs
#                         from_number=None,  # No WhatsApp number for ElevenLabs
#                         body=None  # No message body for ElevenLabs
#                     )
#                     logger.info(f"✅ Appointment record saved with source: elevenlabs")
#                 except Exception as e:
#                     logger.error(f"❌ Failed to save appointment record for ElevenLabs: {str(e)}")
#                 # ==================== END SAVE APPOINTMENT RECORD ====================
                
#                 response_data = {
#                     "success": True,
#                     "stage": "appointment_booking",
#                     "message": "Appointment booked successfully",
#                     "appointment_details": {
#                         "appointment_id": new_appointment_id,
#                         "appointment_number": api_result.get("appointment_number"),
#                         "date": appointment_date,
#                         "time": appointment_time,
#                         "chief_complaint": chief_complaint,
#                         "visit_type": visit_type,
#                         "status": "booked",
#                         "source": "elevenlabs"  # Include source in response
#                     },
#                     "patient": {
#                         "hms_id": hms_id,
#                         "sys_user_id": patient.get("sys_user_id"),
#                         "name": patient.get("name")
#                     },
#                     "doctor": {
#                         "sys_user_id": doctor.get("sys_user_id"),
#                         "name": doctor.get("name"),
#                         "specialization": doctor.get("specialization")
#                     },
#                     "instructions": "Use this appointment_id for screening workflow",
#                     "next_steps": f"Use appointment_id '{new_appointment_id}' with doctor_id '{doctor_sys_user_id}' and hms_id '{hms_id}' in screening workflow",
#                     "timestamp": datetime.now().isoformat()
#                 }
                
#                 return JSONResponse(status_code=200, content=response_data)
#             else:
#                 logger.error(f"❌ Failed to book appointment: {api_result.get('error')}")
                
#                 error_response = {
#                     "success": False,
#                     "stage": "appointment_booking",
#                     "error": api_result.get("error", "Unknown error"),
#                     "message": "Failed to book appointment",
#                     "details": {
#                         "hms_id": hms_id,
#                         "patient_sys_user_id": patient.get("sys_user_id"),
#                         "doctor_sys_user_id": doctor.get("sys_user_id"),
#                         "date": appointment_date,
#                         "time": appointment_time,
#                         "chief_complaint": chief_complaint,
#                         "visit_type": visit_type
#                     },
#                     "timestamp": datetime.now().isoformat()
#                 }
                
#                 return JSONResponse(status_code=500, content=error_response)
        
#         else:
#             logger.error("❌ Invalid parameter combination")
#             error_response = {
#                 "success": False,
#                 "error": "Invalid parameter combination",
#                 "instructions": "Please provide valid parameters as per the workflow",
#                 "workflow_stages": [
#                     "Stage 1: Send HMS_ID only (get patient info and specialities)",
#                     "Stage 2: Send HMS_ID + speciality (get doctors)",
#                     "Stage 3: Send HMS_ID + Doctor_Sys_User_Id (get availability)",
#                     "Stage 4: Send HMS_ID + Doctor_Sys_User_Id + appointment_date + appointment_time + chief_complaint (book appointment)"
#                 ],
#                 "timestamp": datetime.now().isoformat()
#             }
#             return JSONResponse(status_code=400, content=error_response)
        
#     except Exception as e:
#         logger.error("=" * 80)
#         logger.error("❌ UNEXPECTED ERROR")
#         logger.error(f"Error: {str(e)}")
#         logger.error(f"Traceback: {traceback.format_exc()}")
#         logger.error("=" * 80)
#         error_response = {
#             "success": False,
#             "error": "Internal server error",
#             "details": str(e),
#             "timestamp": datetime.now().isoformat()
#         }
#         return JSONResponse(status_code=500, content=error_response)


# ============================================================
# ============ COMPLETE UPDATED ELEVENLABS WEBHOOK ==========
# ============================================================

@router.post("/elevenlabs-hms-id-webhook")
async def handle_incoming_hms(request: Request):
    """
    Endpoint for ElevenLabs integration matching their exact schema
    UPDATED: Now saves doctor_id in appointment records
    """
    try:
        # ==================== LOG INCOMING FROM ELEVENLABS ====================
        logger.info("=" * 80)
        logger.info("📥 DATA FROM ELEVENLABS")
        logger.info("=" * 80)
        
        # Get raw request body for logging
        body_bytes = await request.body()
        body_str = body_bytes.decode('utf-8')
        
        # Parse JSON
        try:
            payload = json.loads(body_str) if body_str else {}
        except json.JSONDecodeError as e:
            logger.error(f"❌ Invalid JSON from ElevenLabs: {e}")
            payload = {}
        
        logger.info(json.dumps(payload, indent=2))
        logger.info("-" * 80)
        
        # Extract parameters
        hms_id = payload.get("HMS_ID")
        doctor_sys_user_id = payload.get("Doctor_Sys_User_Id")
        speciality = payload.get("speciality")
        appointment_date = payload.get("appointment_date")
        appointment_time = payload.get("appointment_time")
        chief_complaint = payload.get("chief_complaint")
        visit_type = payload.get("visit_type", "new visit")
        
        logger.info(f"🔍 Parameters: HMS_ID='{hms_id}', Doctor='{doctor_sys_user_id}', Date='{appointment_date}'")
        
        # Validate HMS_ID (always required)
        if not hms_id:
            return JSONResponse(status_code=400, content={
                "success": False,
                "error": "HMS_ID is required"
            })
        
        # ==================== STAGE 1: HMS_ID ONLY ====================
        if not speciality and not doctor_sys_user_id:
            logger.info("🎯 STAGE 1: HMS_ID only")
            
            patient = await get_patient_by_hms_id(hms_id)
            if not patient:
                return JSONResponse(status_code=404, content={
                    "success": False,
                    "error": f"Patient with HMS_ID '{hms_id}' not found"
                })
            
            # Get patient's latest appointment and doctor
            patient_id = patient.get("patient_id")
            latest_appointment = await get_latest_appointment(patient_id) if patient_id else None
            previous_doctor = None
            
            if latest_appointment and latest_appointment.get("doctor_id"):
                previous_doctor = await get_doctor_by_id(latest_appointment.get("doctor_id"))
            
            # Get available specialities
            available_specialities = await get_available_specialities_for_elevenlabs(hms_id)
            
            response_data = {
                "success": True,
                "stage": "patient_info",
                "hms_id": hms_id,
                "patient": {
                    "patient_id": patient.get("patient_id"),
                    "sys_user_id": patient.get("sys_user_id"),
                    "name": patient.get("name"),
                    "date_of_birth": patient.get("date_of_birth"),
                    "gender": patient.get("gender"),
                    "blood_group": patient.get("blood_group"),
                    "phone_number": patient.get("phone_number")
                },
                "latest_appointment": {
                    "date": latest_appointment.get("date") if latest_appointment else None,
                    "time": latest_appointment.get("scheduled_time") if latest_appointment else None,
                    "doctor_id": latest_appointment.get("doctor_id") if latest_appointment else None
                } if latest_appointment else None,
                "previous_doctor": {
                    "sys_user_id": previous_doctor.get("sys_user_id") if previous_doctor else None,
                    "name": previous_doctor.get("name") if previous_doctor else None,
                    "specialization": previous_doctor.get("specialization") if previous_doctor else None
                } if previous_doctor else None,
                "available_specialities": available_specialities,
                "instructions": "Select a speciality and provide 'speciality' parameter in next request",
                "example_next_request": {
                    "HMS_ID": hms_id,
                    "speciality": "Cardiology"
                }
            }
            return JSONResponse(status_code=200, content=response_data)
        
        # ==================== STAGE 2: HMS_ID + SPECIALITY ====================
        elif speciality and not doctor_sys_user_id:
            logger.info(f"🎯 STAGE 2: HMS_ID + speciality '{speciality}'")
            
            patient = await get_patient_by_hms_id(hms_id)
            if not patient:
                return JSONResponse(status_code=404, content={
                    "success": False,
                    "error": f"Patient with HMS_ID '{hms_id}' not found"
                })
            
            doctors = await get_doctors_for_elevenlabs(speciality, hms_id)
            
            if not doctors:
                return JSONResponse(status_code=404, content={
                    "success": False,
                    "error": f"No doctors available for speciality '{speciality}'"
                })
            
            response_data = {
                "success": True,
                "stage": "doctor_selection",
                "hms_id": hms_id,
                "speciality": speciality,
                "patient": {
                    "patient_id": patient.get("patient_id"),
                    "name": patient.get("name"),
                    "sys_user_id": patient.get("sys_user_id")
                },
                "doctors": doctors,
                "instructions": "Select a doctor and provide 'Doctor_Sys_User_Id' parameter in next request",
                "example_next_request": {
                    "HMS_ID": hms_id,
                    "Doctor_Sys_User_Id": doctors[0].get("sys_user_id") if doctors else "DOCTOR_SYS_USER_ID_HERE"
                }
            }
            return JSONResponse(status_code=200, content=response_data)
        
        # ==================== STAGE 3: HMS_ID + DOCTOR_SYS_USER_ID ====================
        elif doctor_sys_user_id and not appointment_date:
            logger.info(f"🎯 STAGE 3: HMS_ID + Doctor_Sys_User_Id")
            
            patient = await get_patient_by_hms_id(hms_id)
            if not patient:
                return JSONResponse(status_code=404, content={
                    "success": False,
                    "error": f"Patient with HMS_ID '{hms_id}' not found"
                })
            
            doctor = await get_doctor_by_sys_user_id(doctor_sys_user_id, hms_id)
            if not doctor:
                return JSONResponse(status_code=404, content={
                    "success": False,
                    "error": f"Doctor not found with sys_user_id: '{doctor_sys_user_id}'"
                })
            
            availability = get_doctor_availability_for_elevenlabs(doctor_sys_user_id)
            
            response_data = {
                "success": True,
                "stage": "doctor_availability",
                "hms_id": hms_id,
                "patient": {
                    "patient_id": patient.get("patient_id"),
                    "name": patient.get("name"),
                    "sys_user_id": patient.get("sys_user_id")
                },
                "doctor": {
                    "sys_user_id": doctor.get("sys_user_id"),
                    "doctor_id": doctor.get("doctor_id"),
                    "name": doctor.get("name"),
                    "specialization": doctor.get("specialization"),
                    "qualifications": doctor.get("qualifications")
                },
                "availability": availability,
                "instructions": "Select a date and time slot and provide appointment details in next request",
                "example_next_request": {
                    "HMS_ID": hms_id,
                    "Doctor_Sys_User_Id": doctor_sys_user_id,
                    "appointment_date": "2026-01-06",
                    "appointment_time": "4:00 PM",
                    "chief_complaint": "chest pain",
                    "visit_type": "new visit"
                }
            }
            return JSONResponse(status_code=200, content=response_data)
        

        # ==================== STAGE 4: COMPLETE APPOINTMENT BOOKING ====================
        elif doctor_sys_user_id and appointment_date and appointment_time:
            logger.info("🎯 STAGE 4: Complete appointment booking")
            
            # Get patient
            patient = await get_patient_by_hms_id(hms_id)
            if not patient:
                return JSONResponse(status_code=404, content={
                    "success": False,
                    "error": f"Patient with HMS_ID '{hms_id}' not found"
                })
            
            # Get doctor
            doctor = await get_doctor_by_sys_user_id(doctor_sys_user_id, hms_id)
            if not doctor:
                return JSONResponse(status_code=404, content={
                    "success": False,
                    "error": f"Doctor not found with sys_user_id: '{doctor_sys_user_id}'"
                })
            
            # Prepare appointment data
            appointment_data = {
                "hms_id": hms_id,
                "date": appointment_date,
                "time": appointment_time,
                "chief_complaint": chief_complaint or "Not specified",
                "visit_type": visit_type,
                "patient_info": {
                    "patient_id": patient.get("patient_id"),
                    "sys_user_id": patient.get("sys_user_id"),
                    "name": patient.get("name"),
                    "date_of_birth": patient.get("date_of_birth"),
                    "gender": patient.get("gender"),
                    "blood_group": patient.get("blood_group"),
                    "phone_number": patient.get("phone_number")
                },
                "doctor": {
                    "doctor_id": doctor.get("doctor_id"),
                    "sys_user_id": doctor.get("sys_user_id"),
                    "name": doctor.get("name"),
                    "specialization": doctor.get("specialization", ""),
                    "qualifications": doctor.get("qualifications", "")
                }
            }
            
            # Call appointment API
            api_result = await book_appointment_api(appointment_data)
            
            if api_result.get("success"):
                new_appointment_id = api_result.get("appointment_id")
                
                patient_sys_user_id = patient.get('sys_user_id')
                logger.info(f"👤 ElevenLabs - Saving appointment with patient_sys_user_id: {patient_sys_user_id}")
                logger.info(f"👤 Patient name: {patient.get('name')}")
                logger.info(f"🏥 Hospital ID: {patient.get('hospital_id')}")
                logger.info(f"📅 Appointment Date: {appointment_date}")
                logger.info(f"⏰ Appointment Time: {appointment_time}")
                logger.info(f"👨‍⚕️ Doctor: {doctor.get('name')} (ID: {doctor.get('sys_user_id')})")
                
                # ==================== COMPLETE UPDATED: SAVE WITH PATIENT SYS_USER_ID ====================
                try:
                    await save_to_database(
                        hms_id=hms_id,
                        hospital_id=patient.get('hospital_id'),
                        phone_number=patient.get('phone_number'),
                        appointment_id=new_appointment_id,
                        appointment_date=appointment_date,
                        appointment_time=appointment_time,
                        patient_name=patient.get('name'),
                        patient_sys_user_id=patient_sys_user_id,  # THIS IS CRITICAL
                        source="elevenlabs",
                        # Doctor details
                        doctor_id=doctor.get('sys_user_id'),
                        doctor_name=doctor.get('name'),
                        specialization=doctor.get('specialization')
                    )
                    logger.info(f"✅ ElevenLabs appointment saved successfully with patient_sys_user_id: {patient_sys_user_id}")
                except Exception as e:
                    logger.error(f"❌ Failed to save appointment record: {str(e)}")
                    logger.error(f"Traceback: {traceback.format_exc()}")
                # ================================================================
                
                response_data = {
                    "success": True,
                    "stage": "appointment_booking",
                    "message": "Appointment booked successfully",
                    "appointment_details": {
                        "appointment_id": new_appointment_id,
                        "appointment_number": api_result.get("appointment_number"),
                        "date": appointment_date,
                        "time": appointment_time,
                        "chief_complaint": chief_complaint,
                        "visit_type": visit_type,
                        "status": "booked",
                        "source": "elevenlabs",
                        # Include doctor details in response
                        "doctor_id": doctor.get('sys_user_id'),
                        "doctor_name": doctor.get('name'),
                        "specialization": doctor.get('specialization'),
                        # Include patient sys_user_id in response
                        "patient_sys_user_id": patient_sys_user_id,
                        "patient_id": patient_sys_user_id  # Also include as patient_id for compatibility
                    },
                    "patient": {
                        "hms_id": hms_id,
                        "sys_user_id": patient.get("sys_user_id"),
                        "patient_id": patient.get("sys_user_id"),  # Also include as patient_id
                        "name": patient.get("name")
                    },
                    "doctor": {
                        "sys_user_id": doctor.get("sys_user_id"),
                        "doctor_id": doctor.get("doctor_id"),
                        "name": doctor.get("name"),
                        "specialization": doctor.get("specialization")
                    },
                    "timestamp": datetime.now().isoformat()
                }
                
                return JSONResponse(status_code=200, content=response_data)
            else:
                return JSONResponse(status_code=500, content={
                    "success": False,
                    "stage": "appointment_booking",
                    "error": api_result.get("error", "Unknown error"),
                    "details": {
                        "hms_id": hms_id,
                        "doctor_sys_user_id": doctor.get("sys_user_id"),
                        "date": appointment_date,
                        "time": appointment_time
                    }
                })
        
        else:
            return JSONResponse(status_code=400, content={
                "success": False,
                "error": "Invalid parameter combination",
                "instructions": "Valid combinations: HMS_ID only | HMS_ID+speciality | HMS_ID+Doctor_Sys_User_Id | HMS_ID+Doctor_Sys_User_Id+appointment_date+appointment_time"
            })
        
    except Exception as e:
        logger.error(f"❌ UNEXPECTED ERROR: {str(e)}")
        logger.error(traceback.format_exc())
        return JSONResponse(status_code=500, content={
            "success": False,
            "error": "Internal server error",
            "details": str(e)
        })

@router.get("/test-hms-webhook")
async def test_hms_webhook():
    """Test endpoint to verify webhook format"""
    test_payload = {
        "test": True,
        "timestamp": datetime.now().isoformat()
    }
    
    return {
        "description": "Test payload format for /elevenlabs-hms-id-webhook",
        "example_request": test_payload,
        "expected_response_fields": [
            "success",
            "hms_id",
            "patient",
            "latest_appointment",
            "previous_doctor"
        ]
    }

@router.post("/test-elevenlabs-exact-flow")
async def test_exact_elevenlabs_flow():
    """
    Test the exact flow that ElevenLabs will use
    """
    logger.info("=" * 80)
    logger.info("🧪 TESTING EXACT ELEVENLABS FLOW")
    logger.info("=" * 80)
    
    test_cases = {
        "stage_1_example": {
            "description": "Stage 1: ElevenLabs sends HMS_ID only",
            "elevenlabs_request": {
                "HMS_ID": "HMS-PAT-1004"
            },
            "expected_response_fields": ["success", "stage", "patient", "previous_doctor", "instructions"]
        },
        "stage_2_example": {
            "description": "Stage 2: ElevenLabs sends HMS_ID + Doctor_Sys_User_Id",
            "elevenlabs_request": {
                "HMS_ID": "HMS-PAT-1004",
                "Doctor_Sys_User_Id": "DOC-81e80897-85f1-4540-ab20-80baff67725e"
            },
            "expected_response_fields": ["success", "stage", "doctor", "availability", "booking_instructions"]
        }
    }
    
    return {
        "test_name": "ElevenLabs Exact Workflow Test",
        "description": "This matches the exact ElevenLabs tool configuration",
        "elevenlabs_tool_configuration": {
            "url": "https://demo.doctorassist.ai/api/hms/users/data/whatsapp/elevenlabs-hms-id-webhook",
            "method": "POST",
            "parameters": [
                {
                    "name": "HMS_ID",
                    "type": "string",
                    "required": True,
                    "description": "Extract from conversation"
                },
                {
                    "name": "Doctor_Sys_User_Id",
                    "type": "string",
                    "required": False,
                    "description": "Only for stage 2, from previous response"
                }
            ]
        },
        "test_cases": test_cases,
        "curl_test_commands": [
            "# Stage 1 Test",
            "curl -X POST 'https://demo.doctorassist.ai/api/hms/users/data/whatsapp/elevenlabs-hms-id-webhook' \\",
            "  -H 'Content-Type: application/json' \\",
            "  -d '{\"HMS_ID\": \"HMS-PAT-1004\"}'",
            "",
            "# Stage 2 Test",
            "curl -X POST 'https://demo.doctorassist.ai/api/hms/users/data/whatsapp/elevenlabs-hms-id-webhook' \\",
            "  -H 'Content-Type: application/json' \\",
            "  -d '{\"HMS_ID\": \"HMS-PAT-1004\", \"Doctor_Sys_User_Id\": \"DOC-81e80897-85f1-4540-ab20-80baff67725e\"}'"
        ]
    }

# ============================================================
# ==================== WHATSAPP WEBHOOK ======================
# ============================================================

@router.post("/webhook")
async def handle_incoming_message(request: Request):
    """
    Main webhook endpoint for receiving WhatsApp messages
    Processes button clicks with format: 
    yes-patient_id=XXX,followup_id=YYY or 
    no-patient_id=XXX,followup_id=YYY
    """
    # Log incoming request headers for debugging
    headers = dict(request.headers)
    logger.info(f"📥 WEBHOOK RECEIVED - Headers: {headers}")

    # Extract incoming message data
    form = await request.form()
    body = form.get("Body", "").strip()  # Display text from button
    button_payload = form.get("ButtonPayload", "").strip()  # ACTUAL BUTTON DATA!
    from_number = form.get("From")  # Patient's WhatsApp number
    num_media = int(form.get("NumMedia", 0))
    message_sid = form.get("MessageSid", "")
    original_message_sid = form.get("OriginalRepliedMessageSid", "")
    
    # ==================== COMPLETE BUTTON PRESS LOGGING ====================
    logger.info("=" * 80)
    logger.info("🔘 WHATSAPP BUTTON/WEBHOOK DATA RECEIVED")
    logger.info("=" * 80)
    logger.info(f"📱 From Number: {from_number}")
    logger.info(f"📝 Message Body (Display): '{body}'")
    logger.info(f"🔘 Button Payload: '{button_payload}'")
    logger.info(f"📊 Num Media: {num_media}")
    logger.info(f"🕐 Timestamp: {datetime.now().isoformat()}")
    logger.info(f"📬 Message SID: {message_sid}")
    logger.info(f"📬 Original Message SID: {original_message_sid}")
    
    # Log ALL form data
    logger.info("📦 Complete Form Data from Twilio:")
    form_dict = {}
    for key, value in form.items():
        form_dict[key] = value
        logger.info(f"   • {key}: {value}")
    
    # ==================== PROCESS BUTTON PAYLOAD ====================
    if button_payload:
        logger.info(f"✅ BUTTON PAYLOAD FOUND!")
        
        # Determine button type and parse data
        button_type = None
        patient_id = None
        followup_uuid = None
        full_response = button_payload  # Store the full response
        
        # Parse based on the actual format: yes-patient_id=XXX,followup_id=YYY
        if button_payload.startswith("yes-"):
            button_type = "yes"
            # Parse the data after "yes-"
            data_part = button_payload[4:]  # Remove "yes-"
            logger.info(f"👍 YES BUTTON CLICKED!")
            logger.info(f"   • Data part: {data_part}")
            
            # Parse key-value pairs
            pairs = data_part.split(',')
            for pair in pairs:
                if '=' in pair:
                    key, value = pair.split('=', 1)
                    if key == 'patient_id':
                        patient_id = value
                        logger.info(f"   • Extracted patient_id: {patient_id}")
                    elif key == 'followup_id':
                        followup_uuid = value
                        logger.info(f"   • Extracted followup_uuid: {followup_uuid}")
        
        elif button_payload.startswith("no-"):
            button_type = "no"
            # Parse the data after "no-"
            data_part = button_payload[3:]  # Remove "no-"
            logger.info(f"👎 NO BUTTON CLICKED!")
            logger.info(f"   • Data part: {data_part}")
            
            # Parse key-value pairs
            pairs = data_part.split(',')
            for pair in pairs:
                if '=' in pair:
                    key, value = pair.split('=', 1)
                    if key == 'patient_id':
                        patient_id = value
                        logger.info(f"   • Extracted patient_id: {patient_id}")
                    elif key == 'followup_id':
                        followup_uuid = value
                        logger.info(f"   • Extracted followup_uuid: {followup_uuid}")
        
        # ==================== FIND AND UPDATE DATABASE RECORD ====================
        if patient_id and followup_uuid and button_type:
            logger.info(f"🔍 Looking for follow-up record in database:")
            logger.info(f"   • Patient ID: {patient_id}")
            logger.info(f"   • Follow-up UUID: {followup_uuid}")
            logger.info(f"   • Button Type: {button_type}")
            logger.info(f"   • Full Response: {full_response}")
            
            try:
                # Find the record in whatsapp_followup_collection by followup_uuid
                from bson.objectid import ObjectId
                
                # Try by followup_uuid field
                follow_up_record = await whatsapp_followup_collection.find_one(
                    {"followup_uuid": followup_uuid}
                )
                
                if follow_up_record:
                    logger.info(f"✅ Found record by followup_uuid: {followup_uuid}")
                    
                    # Update the record with patient response
                    current_time = datetime.utcnow()
                    
                    update_data = {
                        "patient_response": {
                            "type": button_type,
                            "full_response": full_response,  # Store the full button payload
                            "patient_id": patient_id,
                            "followup_uuid": followup_uuid,
                            "text": body,
                            "received_at": current_time.isoformat(),
                            "message_sid": message_sid,
                            "original_message_sid": original_message_sid,
                            "from_number": from_number
                        },
                        "response_received": True,
                        "response_type": button_type,
                        "response_time": current_time,
                        "response_timestamp": current_time.isoformat(),
                        "response_date": current_time.strftime("%Y-%m-%d"),
                        "response_time_formatted": current_time.strftime("%H:%M:%S"),
                        "updated_at": current_time,
                        "button_payload": full_response
                    }
                    
                    # Remove any unwanted fields
                    unset_fields = {}
                    if "yes_button_id" in follow_up_record:
                        unset_fields["yes_button_id"] = ""
                    if "no_button_id" in follow_up_record:
                        unset_fields["no_button_id"] = ""
                    
                    if unset_fields:
                        await whatsapp_followup_collection.update_one(
                            {"_id": follow_up_record["_id"]},
                            {"$unset": unset_fields}
                        )
                        logger.info(f"✅ Removed unwanted fields")
                    
                    # Update the record with response data
                    result = await whatsapp_followup_collection.update_one(
                        {"_id": follow_up_record["_id"]},
                        {"$set": update_data}
                    )
                    
                    if result.modified_count > 0:
                        logger.info(f"✅ SUCCESS: Updated follow-up record with patient response!")
                        logger.info(f"   • Record ID: {follow_up_record['_id']}")
                        logger.info(f"   • Patient ID: {patient_id}")
                        logger.info(f"   • Response Type: {button_type}")
                        logger.info(f"   • Full Response: {full_response}")
                        logger.info(f"   • Response Time: {current_time.isoformat()}")
                        logger.info(f"   • Response Date: {current_time.strftime('%Y-%m-%d')}")
                        logger.info(f"   • Response Time: {current_time.strftime('%H:%M:%S')}")
                        
                        # Fetch and log the updated record
                        updated_record = await whatsapp_followup_collection.find_one(
                            {"_id": follow_up_record["_id"]}
                        )
                        if updated_record:
                            # Remove _id for cleaner logging
                            log_record = dict(updated_record)
                            log_record["_id"] = str(log_record["_id"])
                            logger.info(f"📊 Updated Record: {json.dumps(log_record, indent=2, default=str)}")
                    else:
                        logger.warning(f"⚠️ No changes made to record")
                    
                    # Also update in-memory session if exists
                    session_key = f"followup_{patient_id}_{follow_up_record.get('_id')}"
                    if session_key in USER_RESPONSE_SESSIONS:
                        USER_RESPONSE_SESSIONS[session_key].update({
                            "response_received": True,
                            "response_type": button_type,
                            "full_response": full_response,
                            "response_time": current_time.isoformat(),
                            "response_text": body
                        })
                        logger.info(f"✅ Updated in-memory session: {session_key}")
                else:
                    logger.error(f"❌ No follow-up record found for followup_uuid: {followup_uuid}")
                    
                    # Try by patient_id as fallback
                    fallback_record = await whatsapp_followup_collection.find_one({
                        "patient_id": patient_id,
                        "followup_date": {"$gte": datetime.now().strftime("%Y-%m-%d")}
                    })
                    
                    if fallback_record:
                        logger.info(f"⚠️ Found fallback record by patient_id:")
                        logger.info(f"   • Record ID: {fallback_record['_id']}")
                        logger.info(f"   • Follow-up Date: {fallback_record.get('followup_date')}")
                        
                        # Update with response
                        current_time = datetime.utcnow()
                        await whatsapp_followup_collection.update_one(
                            {"_id": fallback_record["_id"]},
                            {"$set": {
                                "patient_response": {
                                    "type": button_type,
                                    "full_response": full_response,
                                    "patient_id": patient_id,
                                    "followup_uuid": followup_uuid,
                                    "text": body,
                                    "received_at": current_time.isoformat(),
                                    "message_sid": message_sid
                                },
                                "response_received": True,
                                "response_type": button_type,
                                "response_time": current_time,
                                "response_timestamp": current_time.isoformat(),
                                "updated_at": current_time
                            }}
                        )
                        logger.info(f"✅ Updated fallback record with response")
                        
            except Exception as e:
                logger.error(f"❌ Error updating database record: {str(e)}")
                logger.error(f"Traceback: {traceback.format_exc()}")
        
        logger.info("=" * 80)
    
    # ==================== CONTINUE WITH NORMAL MESSAGE PROCESSING ====================
    logger.info(f"📱 Processing message from {from_number}: {body}")
    logger.info(f"📊 Number of media files: {num_media}")

    # Format the phone number for WhatsApp
    formatted_recipient_number = f"whatsapp:{from_number}"
    
    # Remove 'whatsapp:' prefix for session key
    session_key = from_number.replace("whatsapp:", "") if from_number.startswith("whatsapp:") else from_number

    # Initialize media_files list
    media_files = []

    # Handle media files if present
    if num_media > 0:
        logger.info("📸 Processing media files...")
        for i in range(num_media):
            media_url = form.get(f"MediaUrl{i}")
            media_type = form.get(f"MediaContentType{i}")
            
            logger.info(f"   • Media {i+1}: {media_url}, type: {media_type}")

            # Save the media using your existing save_media function
            file_info = await save_media(media_url, from_number)
            if file_info:
                media_files.append(file_info)

    # ================ HANDLE FIRST MESSAGE ================
    session_key_clean = from_number.replace("whatsapp:", "") if from_number.startswith("whatsapp:") else from_number
    
    if session_key_clean not in user_sessions:
        # First time user, send welcome message with 4 options
        welcome_msg = ("🏥 *Welcome to Hospital Services*\n\n"
                       "I'm your healthcare assistant. I can help you with:\n\n"
                       "1. 📄 Upload Lab Reports\n"
                       "2. 📅 Book Appointment (via Voice or Chat)\n"
                       "3. 🎓 Ask the Doctor / Health Education\n"
                       "4. 🏥 Register Your Own Clinic\n\n"
                       "*Reply with 1, 2, 3, or 4*")
        await send_whatsapp_message(welcome_msg, formatted_recipient_number)
        
        # Initialize session
        user_sessions[session_key_clean] = {
            "_key": session_key_clean,
            "state": ConversationState.MAIN_MENU,
            "data": {},
            "lab_reports": [],
            "appointment_details": {},
            "education_data": {},
            "last_activity": datetime.now()
        }
        
        logger.info(f"📱 New session started for: {session_key_clean}")
        
        resp = MessagingResponse()
        return JSONResponse(content=str(resp))

    # ================ USE THE MESSAGE HANDLER LOGIC ================
    try:
        # Get response from message handler
        response_message = await handle_message_logic(
            from_number=from_number,
            body=body,
            num_media=num_media,
            media_files=media_files
        )
        
        # Send the response back to user
        await send_whatsapp_message(response_message, formatted_recipient_number)
        
    except Exception as e:
        logger.error(f"❌ Error in message handler: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        
        # Send error message to user with 4 options
        error_msg = "❌ Sorry, there was an error processing your request. Please try again.\n\n"
        error_msg += "🏥 *Main Menu*\n\n"
        error_msg += "1. 📄 Upload Lab Reports\n"
        error_msg += "2. 📅 Book/Reschedule Appointment\n"
        error_msg += "3. 🎓 Ask the Doctor / Health Education\n"
        error_msg += "4. 🏥 Register Your Own Clinic\n\n"
        error_msg += "_Reply with 1, 2, 3, or 4_"
        await send_whatsapp_message(error_msg, formatted_recipient_number)

    # Return empty TwiML response
    resp = MessagingResponse()
    return JSONResponse(content=str(resp))
# ============================================================
# ==================== ADDITIONAL ENDPOINTS ==================
# ============================================================

@router.get("/messages", response_model=List[WhatsAppMessage])
async def get_all_messages():
    try:
        # Fetch all data from the collection - ASYNC
        cursor = whatsapp_message_collection.find()
        messages = await cursor.to_list(length=None)

        # Convert MongoDB's ObjectId to string
        for message in messages:
            message["_id"] = str(message["_id"])

        return messages
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching data: {str(e)}")

@router.get("/patient-users", response_model=List[dict])
async def get_all_patient_users():
    # Fetch all data from the collection - ASYNC
    cursor = patient_user_collection.find()
    patient_users = await cursor.to_list(length=None)
    
    # Convert ObjectId to string for JSON serialization
    for user in patient_users:
        user["_id"] = str(user["_id"])
    return patient_users

@router.get("/patient-users_appointment", response_model=List[dict])
async def get_all_patient_appointments():
    # Fetch all data from the collection - ASYNC
    cursor = patient_appointments_collection.find()
    patient_users = await cursor.to_list(length=None)
    
    # Convert ObjectId to string for JSON serialization
    for user in patient_users:
        user["_id"] = str(user["_id"])
    return patient_users

@router.get("/patient-users_doctors", response_model=List[dict])
async def get_all_patient_doctors():
    # Fetch all data from the collection - ASYNC
    cursor = doctor_user_collection.find()
    patient_users = await cursor.to_list(length=None)
    
    # Convert ObjectId to string for JSON serialization
    for user in patient_users:
        user["_id"] = str(user["_id"])
    return patient_users

@router.post("/save-opd_timings")
async def save_opd_timings(data: dict):
    """Ultra minimal endpoint"""
    logger.info(f"Received data for saving OPD timings: {data}")
    
    doctor_id = data.get("doctor_id")
    timings = data.get("timings", [])
    
    if not doctor_id:
        raise HTTPException(status_code=400, detail="doctor_id required")

    if not timings:
        raise HTTPException(status_code=400, detail="timings required")

    # Prepare data to be saved/updated
    doc = {
        "doctor_id": doctor_id,
        "timings": timings,
        "updated_at": datetime.utcnow()
    }
    
    # Check if the document exists
    existing = await OPD_Doctor_timings_collection.find_one({"doctor_id": doctor_id})
    logger.info(f"Existing record: {existing}")  # Debug log
    
    if existing:
        # Update the existing document
        await OPD_Doctor_timings_collection.update_one(
            {"doctor_id": doctor_id},
            {"$set": doc}
        )
        action = "updated"
    else:
        # Insert new document
        doc["created_at"] = datetime.utcnow()
        await OPD_Doctor_timings_collection.insert_one(doc)
        action = "created"
    
    logger.info(f"Data successfully {action} for doctor_id: {doctor_id}")
    
    return {"status": "success", "action": action, "doctor_id": doctor_id}

@router.get("/get-opd_timings/{doctor_id}", response_model=dict)
async def get_opd_timings(doctor_id: str):
    """Endpoint to fetch OPD timings for a specific doctor by doctor_id"""
    # Retrieve the doctor's timings from the collection (awaiting the query result)
    existing = await OPD_Doctor_timings_collection.find_one({"doctor_id": doctor_id})
    
    if existing:
        # Convert _id to string for the response
        existing["_id"] = str(existing["_id"])
        return {"status": "success", "doctor_id": doctor_id, "timings": existing.get("timings")}
    else:
        raise HTTPException(status_code=404, detail="Doctor ID not found")

@router.get("/doctor-timings", response_model=List[dict])
async def get_all_doctor_timings():
    # Fetch all data from the collection asynchronously
    cursor = OPD_Doctor_timings_collection.find()
    doctor_timings = await cursor.to_list(length=None)
    
    # Convert ObjectId to string for JSON serialization
    for doc in doctor_timings:
        doc["_id"] = str(doc["_id"])  # Convert ObjectId to string
    return doctor_timings

@router.post("/doctor-screening-complete")
async def doctor_screening_complete(request: Request):
    """
    Complete screening endpoint that handles both getting questions and submitting answers
    REQUIRES: doctor_id, appointment_id, and hms_id for all requests
    Creates or updates a single record per appointment
    """
    try:
        # ==================== PARSE AND VALIDATE REQUEST ====================
        payload = await request.json()
        
        # Log incoming request
        logger.info("╔" + "═" * 78 + "╗")
        logger.info("║" + " " * 30 + "📥 SCREENING REQUEST" + " " * 30 + "║")
        logger.info("╚" + "═" * 78 + "╝")
        logger.info(f"📦 Full payload: {json.dumps(payload, indent=2)}")
        
        # Extract required parameters
        doctor_id = payload.get("doctor_id")
        appointment_id = payload.get("appointment_id")
        hms_id = payload.get("hms_id")
        question_answers_str = payload.get("question_answers")
        
        logger.info("🔍 Parameter validation:")
        logger.info(f"   • Doctor ID: {doctor_id}")
        logger.info(f"   • Appointment ID: {appointment_id}")
        logger.info(f"   • HMS ID: {hms_id}")
        logger.info(f"   • Question answers provided: {'Yes' if question_answers_str else 'No'}")
        
        # Validate all three required parameters
        missing_params = []
        if not doctor_id:
            missing_params.append("doctor_id")
        if not appointment_id:
            missing_params.append("appointment_id")
        if not hms_id:
            missing_params.append("hms_id")
        
        if missing_params:
            logger.error(f"❌ Missing required parameters: {', '.join(missing_params)}")
            error_response = {
                "success": False,
                "error": f"Missing required parameters: {', '.join(missing_params)}",
                "required_parameters": ["doctor_id", "appointment_id", "hms_id"],
                "timestamp": datetime.now().isoformat()
            }
            return JSONResponse(status_code=400, content=error_response)
        
        # Verify patient exists and get their patient_id (sys_user_id)
        patient = await get_patient_by_hms_id(hms_id)
        if not patient:
            logger.error(f"❌ Patient not found with HMS ID: {hms_id}")
            return {
                "success": False,
                "error": f"Patient with HMS ID '{hms_id}' not found",
                "doctor_id": doctor_id,
                "appointment_id": appointment_id,
                "hms_id": hms_id,
                "timestamp": datetime.now().isoformat()
            }
        
        # Get patient's patient_id (sys_user_id)
        patient_id = patient.get("sys_user_id")
        if not patient_id:
            logger.error(f"❌ Patient ID (sys_user_id) not found for HMS ID: {hms_id}")
            return {
                "success": False,
                "error": f"Patient ID (sys_user_id) not found for HMS ID '{hms_id}'",
                "doctor_id": doctor_id,
                "appointment_id": appointment_id,
                "hms_id": hms_id,
                "timestamp": datetime.now().isoformat()
            }
        
        logger.info(f"✅ Patient found - HMS ID: {hms_id}, patient_id: {patient_id}")
        
        # ==================== GET DOCTOR SCREENING QUESTIONS ====================
        logger.info(f"🔍 Searching screening questions for doctor: {doctor_id}")
        
        screening_data = await doctor_screening_questions_collection.find_one(
            {"doctor_id": doctor_id}
        )
        
        if not screening_data:
            logger.warning(f"⚠️ No screening questions found for doctor: {doctor_id}")
            return {
                "success": False,
                "error": f"No screening questions found for doctor_id: {doctor_id}",
                "doctor_id": doctor_id,
                "appointment_id": appointment_id,
                "hms_id": hms_id,
                "timestamp": datetime.now().isoformat()
            }
        
        # Convert ObjectId to string
        screening_data["_id"] = str(screening_data["_id"])
        questions = screening_data.get("questions", [])
        
        logger.info(f"✅ Found {len(questions)} screening questions for doctor")
        
        # ==================== SUBMITTING ANSWERS ====================
        if question_answers_str:
            logger.info("🎯 PROCESSING SUBMITTED ANSWERS")
            logger.info("-" * 80)
            
            try:
                # Parse question_answers
                if isinstance(question_answers_str, str):
                    question_answers = json.loads(question_answers_str)
                else:
                    question_answers = question_answers_str
                
                logger.info(f"✅ Parsed {len(question_answers)} question-answer pairs")
                
                # Log each answer for debugging
                for i, qa in enumerate(question_answers, 1):
                    q_id = qa.get('question_id', f'Unknown_{i}')
                    answer = qa.get('answer', 'No answer provided')
                    logger.info(f"   {i}. Q[{q_id}]: {answer[:50]}{'...' if len(answer) > 50 else ''}")
                
                # Map answers to questions with proper question text
                results = []
                for qa in question_answers:
                    q_id = qa.get('question_id')
                    answer = qa.get('answer', '').strip()
                    
                    # Find the original question text
                    question_text = "Unknown question"
                    if isinstance(q_id, str) and q_id.startswith("Q"):
                        try:
                            q_index = int(q_id[1:]) - 1
                            if 0 <= q_index < len(questions):
                                q_data = questions[q_index]
                                if isinstance(q_data, str):
                                    question_text = q_data
                                elif isinstance(q_data, dict):
                                    question_text = q_data.get("question_text", f"Question {q_id}")
                        except (ValueError, IndexError):
                            question_text = f"Question {q_id}"
                    else:
                        question_text = f"Question {q_id}"
                    
                    results.append({
                        "question_id": q_id,
                        "question": question_text,
                        "answer": answer,
                        "status": "answered" if answer else "not_answered",
                        "answered_at": datetime.now().isoformat()
                    })
                
                # ==================== CALL PROCESS FEATURE CONTEXT ENDPOINT ====================
                logger.info("🔄 CALLING PROCESS FEATURE CONTEXT ENDPOINT")
                logger.info("-" * 80)
                
                # Prepare data for the external API call
                process_feature_data = {
                    "patient_id": patient_id,
                    "doctor_id": doctor_id,
                    "feature_id": "current-screening-context",
                    "new_data": {
                        "questions": results,
                        "appointment_id": appointment_id,
                        "screening_timestamp": datetime.now().isoformat()
                    }
                }
                
                # Log the data being sent
                logger.info("📤 DATA BEING SENT TO PROCESS FEATURE CONTEXT ENDPOINT:")
                logger.info(f"📦 Full payload: {json.dumps(process_feature_data, indent=2)}")
                logger.info(f"   • Patient ID: {patient_id}")
                logger.info(f"   • Doctor ID: {doctor_id}")
                logger.info(f"   • Feature ID: {process_feature_data['feature_id']}")
                logger.info(f"   • Questions Count: {len(results)}")
                logger.info(f"   • Appointment ID: {appointment_id}")
                
                # Make the API call
                try:
                    # Adjust the base URL based on your environment
                    endpoint_url = f"{api_base_url}hms/users/data/context/process_feature_context_llm"
                    
                    logger.info(f"🌐 Making POST request to: {endpoint_url}")
                    
                    # Make the HTTP request
                    async with httpx.AsyncClient(timeout=30.0) as client:
                        response = await client.post(
                            endpoint_url,
                            json=process_feature_data,
                            headers={"Content-Type": "application/json"}
                        )
                    
                    logger.info(f"📥 Response Status: {response.status_code}")
                    logger.info(f"📥 Response Body: {response.text}")
                    
                    if response.status_code == 200:
                        logger.info("✅ Successfully processed feature context")
                        feature_context_response = response.json()
                    else:
                        logger.warning(f"⚠️ Failed to process feature context. Status: {response.status_code}")
                        feature_context_response = None
                        
                except httpx.TimeoutException:
                    logger.error("⏰ Timeout while calling process feature context endpoint")
                    feature_context_response = None
                except httpx.RequestError as e:
                    logger.error(f"🌐 Network error while calling process feature context endpoint: {str(e)}")
                    feature_context_response = None
                except Exception as e:
                    logger.error(f"💥 Unexpected error while calling process feature context endpoint: {str(e)}")
                    feature_context_response = None
                
                logger.info("✅ COMPLETED PROCESS FEATURE CONTEXT CALL")
                logger.info("-" * 80)
                
                # ==================== CHECK IF RECORD ALREADY EXISTS ====================
                logger.info(f"🔍 Checking for existing screening record for appointment: {appointment_id}")
                
                existing_record = await doctor_screening_results_collection.find_one({
                    "appointment_id": appointment_id
                })
                
                screening_result_id = None
                action = ""
                
                if existing_record:
                    # ==================== UPDATE EXISTING RECORD ====================
                    logger.info(f"📝 Existing record found for appointment {appointment_id}, updating...")
                    
                    # Add feature context response to results if available
                    update_data = {
                        "$set": {
                            "doctor_id": doctor_id,
                            "patient_id": patient_id,
                            "question_answers": results,
                            "screening_completed": True,
                            "updated_at": datetime.now().isoformat(),
                            "last_updated": datetime.now()
                        }
                    }
                    
                    # Add feature context response if available
                    if feature_context_response:
                        update_data["$set"]["feature_context_response"] = feature_context_response
                        update_data["$set"]["feature_context_processed_at"] = datetime.now().isoformat()
                    
                    # Add created_at if not present (for backward compatibility)
                    if "created_at" not in existing_record:
                        update_data["$set"]["created_at"] = datetime.now().isoformat()
                    
                    result = await doctor_screening_results_collection.update_one(
                        {"_id": existing_record["_id"]},
                        update_data
                    )
                    
                    if result.modified_count > 0:
                        screening_result_id = str(existing_record["_id"])
                        action = "updated"
                        logger.info(f"✅ Successfully updated screening record for appointment {appointment_id}")
                    else:
                        screening_result_id = str(existing_record["_id"])
                        action = "no_changes"
                        logger.info(f"ℹ️ No changes needed for appointment {appointment_id}")
                else:
                    # ==================== INSERT NEW RECORD ====================
                    logger.info(f"🆕 No existing record found for appointment {appointment_id}, creating new...")
                    
                    screening_result = {
                        "doctor_id": doctor_id,
                        "appointment_id": appointment_id,
                        "patient_id": patient_id,
                        "question_answers": results,
                        "screening_completed": True,
                        "created_at": datetime.now().isoformat(),
                        "updated_at": datetime.now().isoformat()
                    }
                    
                    # Add feature context response if available
                    if feature_context_response:
                        screening_result["feature_context_response"] = feature_context_response
                        screening_result["feature_context_processed_at"] = datetime.now().isoformat()
                    
                    # Save to screening results collection
                    try:
                        result = await doctor_screening_results_collection.insert_one(screening_result)
                        screening_result_id = str(result.inserted_id)
                        action = "created"
                        logger.info(f"✅ New screening record created with ID: {screening_result_id}")
                    except Exception as e:
                        logger.error(f"⚠️ Failed to save screening results: {e}")
                        screening_result_id = None
                        action = "failed"
                
                # ==================== UPDATE SCREENING QUESTIONS METADATA ====================
                if screening_result_id and action in ["created", "updated"]:
                    try:
                        await doctor_screening_questions_collection.update_one(
                            {"doctor_id": doctor_id},
                            {
                                "$set": {
                                    "last_screening_at": datetime.now().isoformat(),
                                    "last_appointment_id": appointment_id,
                                    "last_patient_id": patient_id
                                }
                            }
                        )
                        logger.info(f"📊 Updated screening metadata for doctor: {doctor_id}")
                    except Exception as e:
                        logger.warning(f"⚠️ Could not update screening metadata: {e}")
                
                # Build successful response
                response = {
                    "success": True,
                    "action": "submit_answers",
                    "record_action": action,  # "created", "updated", or "no_changes"
                    "message": f"Screening {'completed' if action != 'failed' else 'failed'} successfully",
                    "doctor_id": doctor_id,
                    "appointment_id": appointment_id,
                    "patient_id": patient_id,
                    "screening_result_id": screening_result_id,
                    "screening_results": results,
                    "record_exists": existing_record is not None,
                    "feature_context_processed": feature_context_response is not None,
                    "timestamp": datetime.now().isoformat()
                }
                
                # Add feature context response details if available
                if feature_context_response:
                    response["feature_context_response"] = feature_context_response
                
                logger.info("╔" + "═" * 78 + "╗")
                logger.info("║" + " " * 30 + f"✅ ANSWERS {action.upper()} SUCCESSFULLY" + " " * 29 + "║")
                logger.info("╚" + "═" * 78 + "╝")
                logger.info(f"📋 Appointment: {appointment_id}")
                logger.info(f"👨‍⚕️ Doctor: {doctor_id}")
                logger.info(f"👤 Patient ID: {patient_id}")
                logger.info(f"📝 Action: {action}")
                logger.info(f"🔗 Feature Context Processed: {'Yes' if feature_context_response else 'No'}")
                
                return response
                
            except json.JSONDecodeError as e:
                logger.error(f"❌ Failed to parse question_answers JSON: {str(e)}")
                logger.info(f"📝 Raw question_answers: {question_answers_str}")
                
                # Fall through to return questions with error
                error_response = {
                    "success": False,
                    "error": "Invalid JSON format in question_answers",
                    "details": str(e),
                    "doctor_id": doctor_id,
                    "appointment_id": appointment_id,
                    "hms_id": hms_id,
                    "timestamp": datetime.now().isoformat()
                }
                return JSONResponse(status_code=400, content=error_response)
        
        # ==================== GET QUESTIONS (NO ANSWERS PROVIDED) ====================
        logger.info("📋 RETURNING SCREENING QUESTIONS")
        logger.info("-" * 80)
        
        # Check if screening already exists for this appointment
        existing_screening = await doctor_screening_results_collection.find_one({
            "appointment_id": appointment_id
        })
        
        existing_answers = None
        if existing_screening:
            logger.info(f"📊 Found existing screening for appointment {appointment_id}")
            existing_answers = existing_screening.get("question_answers", [])
        
        # Format questions for response
        formatted_questions = []
        for i, q in enumerate(questions, 1):
            question_id = f"Q{i}"
            
            # Check if this question already has an answer
            existing_answer = None
            if existing_answers:
                for ans in existing_answers:
                    if ans.get("question_id") == question_id:
                        existing_answer = ans.get("answer", "")
                        break
            
            if isinstance(q, str):
                formatted_questions.append({
                    "question_id": question_id,
                    "question": q,
                    "type": "text",
                    "required": True,
                    "order": i,
                    "existing_answer": existing_answer if existing_answer else None
                })
            elif isinstance(q, dict):
                formatted_questions.append({
                    "question_id": q.get("question_id", question_id),
                    "question": q.get("question_text", f"Question {i}"),
                    "type": q.get("question_type", "text"),
                    "required": q.get("required", True),
                    "options": q.get("options", []),
                    "order": i,
                    "existing_answer": existing_answer if existing_answer else None
                })
            else:
                formatted_questions.append({
                    "question_id": question_id,
                    "question": str(q),
                    "type": "text",
                    "required": True,
                    "order": i,
                    "existing_answer": existing_answer if existing_answer else None
                })
        
        # Log questions for debugging
        logger.info(f"📊 Formatted {len(formatted_questions)} questions:")
        logger.info(f"📊 Existing answers found: {len([q for q in formatted_questions if q.get('existing_answer')])}")
        
        for i, q in enumerate(formatted_questions[:5], 1):  # Log first 5
            q_text = q.get("question", "")
            if len(q_text) > 60:
                q_text = q_text[:57] + "..."
            existing_answer = q.get("existing_answer")
            answer_status = f" [Existing answer: {existing_answer[:30]}{'...' if len(existing_answer) > 30 else ''}]" if existing_answer else ""
            logger.info(f"   {i}. {q_text}{answer_status}")
        
        if len(formatted_questions) > 5:
            logger.info(f"   ... and {len(formatted_questions) - 5} more questions")
        
        # Build response
        response = {
            "success": True,
            "action": "get_questions",
            "doctor_id": doctor_id,
            "appointment_id": appointment_id,
            "patient_id": patient_id,
            "screening_exists": existing_screening is not None,
            "questions": formatted_questions,
            "question_count": len(formatted_questions),
            "instructions": "Please ask these questions to the patient and collect their answers.",
            "answer_format": {
                "required_fields": ["doctor_id", "appointment_id", "hms_id", "question_answers"],
                "question_answers_format": "JSON array of objects with 'question_id' and 'answer'",
                "example": '[{"question_id": "Q1", "answer": "Yes"}, {"question_id": "Q2", "answer": "No allergies"}]'
            },
            "timestamp": datetime.now().isoformat()
        }
        
        if existing_screening:
            response["existing_screening_id"] = str(existing_screening.get("_id"))
            response["screening_updated_at"] = existing_screening.get("updated_at", existing_screening.get("created_at"))
        
        logger.info("╔" + "═" * 78 + "╗")
        logger.info("║" + " " * 30 + "📤 QUESTIONS RETURNED" + " " * 30 + "║")
        logger.info("╚" + "═" * 78 + "╝")
        logger.info(f"✅ Prepared response with {len(formatted_questions)} questions")
        if existing_screening:
            logger.info(f"📊 Existing screening found: {existing_screening.get('_id')}")
        
        return response
        
    except json.JSONDecodeError as e:
        logger.error("=" * 80)
        logger.error("❌ INVALID JSON REQUEST")
        logger.error(f"Error: {str(e)}")
        logger.error("=" * 80)
        
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "error": "Invalid JSON format in request",
                "details": str(e),
                "timestamp": datetime.now().isoformat()
            }
        )
        
    except Exception as e:
        logger.error("=" * 80)
        logger.error("💥 UNEXPECTED ERROR")
        logger.error(f"Error: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        logger.error("=" * 80)
        
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": "Internal server error",
                "details": str(e),
                "timestamp": datetime.now().isoformat()
            }
        )

@router.get("/raw-screening-data")
async def get_raw_screening_data():
    """
    Get raw screening data - simplest possible endpoint
    """
    try:
        # Get all documents
        cursor = doctor_screening_results_collection.find({})
        results = await cursor.to_list(length=None)
        
        # Just convert _id to string
        for result in results:
            result["_id"] = str(result.get("_id"))
        
        return {
            "count": len(results),
            "results": results
        }
        
    except Exception as e:
        return {"error": str(e)}

@router.post("/delete-screening")
async def delete_screening_by_post(request: Request):
    """
    Delete screening result using POST request with JSON body
    Example: POST /whatsapp/delete-screening
    Body: {"screening_id": "6968cba2fe3159ccff4f8714"}
    """
    try:
        # Get the request body
        payload = await request.json()
        
        # Extract screening_id from the JSON payload
        screening_id = payload.get("screening_id")
        
        logger.info(f"🗑️ Deleting screening result with ID: {screening_id}")
        
        # Validate ID
        if not screening_id:
            logger.error("❌ screening_id is required in request body")
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": "screening_id is required in request body",
                    "timestamp": datetime.now().isoformat()
                }
            )
        
        # Try to delete
        try:
            # Convert string ID to ObjectId
            object_id = ObjectId(screening_id)
            
            # Delete the document
            result = await doctor_screening_results_collection.delete_one({"_id": object_id})
            
            if result.deleted_count > 0:
                logger.info(f"✅ Deleted screening result: {screening_id}")
                return {
                    "success": True,
                    "message": "Screening result deleted successfully",
                    "screening_id": screening_id,
                    "deleted_count": result.deleted_count,
                    "timestamp": datetime.now().isoformat()
                }
            else:
                logger.warning(f"⚠️ No screening result found with ID: {screening_id}")
                return JSONResponse(
                    status_code=404,
                    content={
                        "success": False,
                        "error": "Screening result not found",
                        "screening_id": screening_id,
                        "deleted_count": 0,
                        "timestamp": datetime.now().isoformat()
                    }
                )
                
        except Exception as e:
            logger.error(f"❌ Error processing screening_id: {str(e)}")
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": "Invalid screening_id",
                    "details": str(e),
                    "screening_id": screening_id,
                    "timestamp": datetime.now().isoformat()
                }
            )
            
    except json.JSONDecodeError:
        logger.error("❌ Invalid JSON in request body")
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "error": "Invalid JSON in request body",
                "timestamp": datetime.now().isoformat()
            }
        )
            
    except Exception as e:
        logger.error(f"❌ Unexpected error: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": "Internal server error",
                "details": str(e),
                "timestamp": datetime.now().isoformat()
            }
        )

@router.get("/all-screening-questions")
async def get_all_screening_questions():
    """
    Get all screening questions from the database
    """
    try:
        # Fetch all documents from the collection
        cursor = doctor_screening_questions_collection.find({})
        results = await cursor.to_list(length=None)
        
        # Just convert _id to string
        for result in results:
            result["_id"] = str(result.get("_id"))
        
        return {
            "count": len(results),
            "results": results
        }
        
    except Exception as e:
        return {"error": str(e)}

@router.delete("/delete-all-screening-questions")
async def delete_all_screening_questions():
    """
    Delete all screening questions from the database
    """
    try:
        # Delete all documents in the collection
        result = await doctor_screening_questions_collection.delete_many({})
        
        if result.deleted_count == 0:
            return {"message": "No records found to delete."}
        
        return {
            "message": f"Successfully deleted {result.deleted_count} records."
        }
    
    except Exception as e:
        return {"error": str(e)}

@router.get("/screening-questions/{doctor_id}")
async def get_screening_questions(doctor_id: str):
    """
    Get screening questions for a specific doctor by doctor_id
    """
    try:
        # Fetch the document for the given doctor_id
        result = await doctor_screening_questions_collection.find_one({"doctor_id": doctor_id})
        
        if not result:
            return {"message": "No screening questions found for this doctor."}
        
        # Extract the questions
        questions = result.get("questions", [])
        
        return {
            "doctor_id": doctor_id,
            "questions": questions
        }
        
    except Exception as e:
        return {"error": str(e)}

@router.delete("/delete-doctors-by-hospital/{hospital_id}")
async def delete_doctors_by_hospital(hospital_id: str):
    try:
        # Check if the hospital exists
        hospital = await doctor_user_collection.find_one({"hospital_id": hospital_id})
        if not hospital:
            raise HTTPException(status_code=404, detail="Hospital not found")

        # Perform the deletion
        result = await doctor_user_collection.delete_many({"hospital_id": hospital_id})

        return {
            "status": "success",
            "message": f"Deleted {result.deleted_count} doctors from hospital {hospital_id}",
            "hospital_id": hospital_id,
            "deleted_count": result.deleted_count
        }

    except Exception as e:
        logger.exception("Failed to delete doctors")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete doctors due to: {str(e)}"
        )

@router.delete("/delete-hospital-by-sys-user/{sys_user_id}")
def delete_hospital_by_sys_user(sys_user_id: str):
    try:
        # Check if the hospital exists
        hospital = hospital_user_collection.find_one({"sys_user_id": sys_user_id})
        if not hospital:
            raise HTTPException(status_code=404, detail="Hospital not found")

        # Perform the deletion
        result = hospital_user_collection.delete_one({"sys_user_id": sys_user_id})

        return {
            "status": "success",
            "message": f"Deleted hospital with sys_user_id {sys_user_id}",
            "sys_user_id": sys_user_id,
            "deleted_count": result.deleted_count
        }

    except Exception as e:
        logger.exception("Failed to delete hospital")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete hospital due to: {str(e)}"
        )

# ============================================================
# ============ COMPLETE UPDATED APPOINTMENT RECORDS ENDPOINT ==========
# ============================================================

@router.get("/appointment-records")
async def get_appointment_records(
    patient_id: Optional[str] = Query(None, description="Filter by patient ID (sys_user_id)"),
    hms_id: Optional[str] = Query(None, description="Filter by HMS ID"),
    phone_number: Optional[str] = Query(None, description="Filter by phone number"),
    source: Optional[str] = Query(None, description="Filter by source (whatsapp or elevenlabs)"),
    doctor_id: Optional[str] = Query(None, description="Filter by doctor ID"),
    appointment_id: Optional[str] = Query(None, description="Filter by appointment ID"),
    limit: int = Query(50, description="Number of records to return", ge=1, le=1000),
    skip: int = Query(0, description="Number of records to skip for pagination", ge=0)
):
    """
    COMPLETE UPDATED ENDPOINT: Get appointment records with optional filters
    Now supports filtering by patient_id, hms_id, phone_number, source, doctor_id, appointment_id
    """
    try:
        # Build query
        query = {}
        
        if patient_id:
            # Search in both possible field names for maximum compatibility
            query["$or"] = [
                {"patient_sys_user_id": patient_id.strip()},
                {"patient_id": patient_id.strip()}
            ]
            logger.info(f"🔍 Filtering by Patient ID: {patient_id}")
        
        if hms_id:
            query["hms_id"] = hms_id.strip()
            logger.info(f"🔍 Filtering by HMS ID: {hms_id}")
        
        if phone_number:
            clean_phone = phone_number.replace("whatsapp:", "") if phone_number.startswith("whatsapp:") else phone_number
            query["phone_number"] = clean_phone
            logger.info(f"🔍 Filtering by Phone: {clean_phone}")
        
        if source:
            if source not in ["whatsapp", "elevenlabs"]:
                raise HTTPException(
                    status_code=400, 
                    detail="Source must be either 'whatsapp' or 'elevenlabs'"
                )
            query["source"] = source
            logger.info(f"🔍 Filtering by Source: {source}")
        
        if doctor_id:
            query["doctor_id"] = doctor_id.strip()
            logger.info(f"🔍 Filtering by Doctor ID: {doctor_id}")
        
        if appointment_id:
            query["appointment_id"] = appointment_id.strip()
            logger.info(f"🔍 Filtering by Appointment ID: {appointment_id}")
        
        logger.info(f"📊 Executing query: {json.dumps(query, indent=2, default=str)}")
        
        # Get total count for pagination
        total_count = await appointment_records_collection.count_documents(query)
        
        # Fetch records with pagination
        cursor = appointment_records_collection.find(query).sort("created_at", -1).skip(skip).limit(limit)
        records = await cursor.to_list(length=limit)
        
        # Convert ObjectId to string and normalize field names
        for record in records:
            record["_id"] = str(record.get("_id"))
            
            # Ensure patient_id field exists (normalize from patient_sys_user_id)
            if "patient_sys_user_id" in record and "patient_id" not in record:
                record["patient_id"] = record["patient_sys_user_id"]
            elif "patient_id" in record and "patient_sys_user_id" not in record:
                record["patient_sys_user_id"] = record["patient_id"]
            
            # Convert datetime objects to ISO format strings for JSON serialization
            if "created_at" in record and isinstance(record["created_at"], datetime):
                record["created_at"] = record["created_at"].isoformat()
            if "updated_at" in record and isinstance(record["updated_at"], datetime):
                record["updated_at"] = record["updated_at"].isoformat()
        
        # Get source statistics for this query
        source_stats = {}
        if not source and records:
            whatsapp_count = len([r for r in records if r.get("source") == "whatsapp"])
            elevenlabs_count = len([r for r in records if r.get("source") == "elevenlabs"])
            unknown_count = len([r for r in records if r.get("source") not in ["whatsapp", "elevenlabs"]])
            source_stats = {
                "whatsapp": whatsapp_count,
                "elevenlabs": elevenlabs_count,
                "unknown": unknown_count
            }
        
        # Log summary of patient_id fields
        patient_id_count = len([r for r in records if r.get("patient_id")])
        patient_sys_user_id_count = len([r for r in records if r.get("patient_sys_user_id")])
        
        logger.info(f"📊 Record statistics:")
        logger.info(f"   • Total records: {len(records)}")
        logger.info(f"   • Records with patient_id: {patient_id_count}")
        logger.info(f"   • Records with patient_sys_user_id: {patient_sys_user_id_count}")
        
        return {
            "success": True,
            "count": len(records),
            "total": total_count,
            "skip": skip,
            "limit": limit,
            "filters": {
                "patient_id": patient_id,
                "hms_id": hms_id,
                "phone_number": phone_number,
                "source": source,
                "doctor_id": doctor_id,
                "appointment_id": appointment_id
            },
            "source_stats": source_stats if source_stats else None,
            "records": records
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error fetching appointment records: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Error fetching records: {str(e)}")

@router.get("/appointments/{hospital_id}", response_model=List[Dict])
async def get_appointments_by_hospital(hospital_id: str):
    # Fetch appointments for the given hospital_id
    cursor = appointment_records_collection.find({"hospital_id": hospital_id}).limit(100)  # Adjust limit as needed

    appointments = []
    
    async for appointment in cursor:
        # Ensure source field is included, default to "N/A" if missing
        appointment["source"] = appointment.get("source", "N/A")
        
        # Append the necessary fields
        appointments.append({
            "hms_id": appointment["hms_id"],
            "patient_name": appointment["patient_name"],
            "appointment_date": appointment["appointment_date"],
            "appointment_time": appointment["appointment_time"],
            "created_at": appointment["created_at"],
            "appointment_id": appointment["appointment_id"],
            "source": appointment["source"]
        })
    
    if not appointments:
        raise HTTPException(status_code=404, detail="No appointments found for this hospital")

    return appointments


@router.get("/get_doctors_by_hospital/{hospital_id}")
async def get_doctors_by_hospital(hospital_id: str) -> List[dict]:
    # Fetch doctors with the given hospital_id, and project the relevant fields
    doctors = await doctor_user_collection.find(
        {"hospital_id": hospital_id},
        {"_id": 0, "name": 1, "sys_user_id": 1, "specialization": 1}  # Only return necessary fields
    ).sort("hospital_id", 1).to_list(None)

    if not doctors:
        raise HTTPException(status_code=404, detail="No doctors found for the given hospital ID")

    return doctors



@router.post("/follow-up-date")
async def get_followup_date(request: Request):
    """
    This endpoint takes follow-up data and processes it to determine
    the follow-up date using the LLaMA model and the provided text_snippet.
    It will then save the data to the `whatsapp_followup_collection`.
    """
    try:
        # Parse the incoming request
        payload = await request.json()
        logger.info(f"📥 PAYLOAD RECEIVED: {json.dumps(payload, indent=2)}")

        # Extract the necessary fields from the payload
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        appointment_date = payload.get("appointment_date")
        appointment_time = payload.get("appointment_time")
        text_snippet = payload.get("text_snippet")

        if not patient_id or not doctor_id or not appointment_date:
            raise HTTPException(status_code=400, detail="Missing patient_id, doctor_id, or appointment_date")

        # Get the current date to send to the LLaMA model
        current_date = datetime.today().strftime("%Y-%m-%d")
        logger.info(f"📅 CURRENT DATE SET TO: {current_date}")

        # If text_snippet is provided, process it to calculate the follow-up date
        followup_date = appointment_date  # Default follow-up date to appointment_date if no snippet

        if text_snippet:
            logger.info(f"📝 TEXT SNIPPET TO PROCESS: '{text_snippet}'")
            
            # Construct the LLaMA prompt to calculate the follow-up date
            prompt = f"""
                YOU ARE A DATE CALCULATOR. CALCULATE THE EXACT DATE FROM TODAY.

                TODAY: {current_date}
                INPUT: "{text_snippet}"

                CALCULATION TABLE:
                | Input phrase | Calculation | Result |
                |-------------|-------------|---------|
                | "48-72 hours" | {current_date} + 2 days | {((datetime.strptime(current_date, '%Y-%m-%d') + timedelta(days=2)).strftime('%Y-%m-%d'))} |
                | "1 week" | {current_date} + 7 days | {((datetime.strptime(current_date, '%Y-%m-%d') + timedelta(days=7)).strftime('%Y-%m-%d'))} |
                | "2 weeks" | {current_date} + 14 days | {((datetime.strptime(current_date, '%Y-%m-%d') + timedelta(days=14)).strftime('%Y-%m-%d'))} |
                | "1 month" | {current_date} + 30 days | {((datetime.strptime(current_date, '%Y-%m-%d') + timedelta(days=30)).strftime('%Y-%m-%d'))} |
                | "tomorrow" | {current_date} + 1 day | {((datetime.strptime(current_date, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d'))} |

                NOW CALCULATE FOR: "{text_snippet}"

                **IMPORTANT: You must output your response as valid JSON with the key "followup_date".**

                Output ONLY this JSON format: {{"followup_date": "CALCULATED_DATE_HERE"}}

                REMEMBER: CALCULATE THE DATE, DON'T REPEAT THE TEXT.
                Return JSON only.
                """

            # Call the LLaMA model with the prompt to calculate the follow-up date
            completion = groq_client.chat.completions.create(
                model="llama-3.1-8b-instant",
                temperature=0.1,
                max_tokens=8000,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "user", "content": prompt}
                ],
            )

            # Get the response from LLaMA and parse it correctly
            response = completion.choices[0].message.content.strip()
            logger.info(f"📥 RAW LLAMA RESPONSE: {response}")

            try:
                # Parse the JSON response
                response_json = json.loads(response)
                logger.info(f"✅ JSON PARSED SUCCESSFULLY: {json.dumps(response_json, indent=2)}")
                
                # Extract followup_date
                followup_date = response_json.get("followup_date")
                
                if followup_date:
                    logger.info(f"🎯 EXTRACTED FOLLOWUP DATE: {followup_date}")
                else:
                    logger.warning(f"⚠️ NO FOLLOWUP_DATE KEY FOUND IN RESPONSE. Available keys: {list(response_json.keys())}")
                    # Use appointment_date as fallback
                    followup_date = appointment_date
                    logger.info(f"🔄 USING APPOINTMENT DATE AS FALLBACK: {appointment_date}")
                    
            except json.JSONDecodeError as e:
                logger.error(f"❌ FAILED TO PARSE JSON RESPONSE")
                logger.error(f"📄 RAW RESPONSE THAT FAILED: {response}")
                logger.error(f"🔍 ERROR DETAILS: {str(e)}")
                
                # Try to extract date using regex from the raw text
                import re
                date_pattern = r'\d{4}-\d{2}-\d{2}'
                match = re.search(date_pattern, response)
                
                if match:
                    followup_date = match.group(0)
                    logger.info(f"🔍 EXTRACTED DATE USING REGEX: {followup_date}")
                else:
                    logger.warning(f"⚠️ NO DATE FOUND IN RAW RESPONSE. USING APPOINTMENT DATE: {appointment_date}")
                    followup_date = appointment_date

        else:
            logger.info("📭 NO TEXT SNIPPET PROVIDED, USING APPOINTMENT DATE")

        # Prepare the data to be saved in the database using Pydantic model
        follow_up_data = FollowUpDB(
            patient_id=patient_id,
            doctor_id=doctor_id,
            followup_date=followup_date,
            reminded=False,  # Default to False
            created_at=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")  # Current timestamp
        )

        # Log the data to be saved
        logger.info(f"💾 DATA TO SAVE: {json.dumps(follow_up_data.dict(), indent=2)}")

        # Save the data to the MongoDB collection
        whatsapp_followup_collection.insert_one(follow_up_data.dict())
        logger.info(f"✅ FOLLOW-UP DATA SAVED - Patient ID: {patient_id}, Follow-up Date: {followup_date}")

        # Return the result as a response
        return {
            "status": "success",
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "appointment_date": appointment_date,
            "followup_date": followup_date,
            "appointment_time": appointment_time
        }

    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.exception("❌ FOLLOW-UP DATE CALCULATION OR SAVING FAILED")
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to calculate or save follow-up date: {str(e)}"
        )

@router.get("/follow-ups")
async def get_follow_up_data():
    try:
        # Retrieve all documents from the collection asynchronously
        follow_up_data_cursor = whatsapp_followup_collection.find()
        follow_up_data = await follow_up_data_cursor.to_list(length=None)  # Convert the cursor to a list
        
        if not follow_up_data:
            raise HTTPException(status_code=404, detail="No follow-up data found")
        
        # Convert _id to string and return the data
        for data in follow_up_data:
            data["_id"] = str(data["_id"])
        
        return follow_up_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@router.post("/receive-date")
async def receive_date(request: Request):
    """
    This endpoint takes a date and sends follow-up reminders to patients
    with follow-up appointments happening today, tomorrow, or day after tomorrow.
    Uses Twilio template HX0aef647da42a454a2be9d246319f2b48
    Sends patient_id and followup_uuid as {{1}} and {{2}} without any prefixes
    """
    try:
        # Parse the incoming JSON body
        data = await request.json()
        date_str = data.get("date")
        logger.info(f"📥 RECEIVED DATE STRING: {date_str}")
        
        # If date is not provided in the request
        if not date_str:
            raise HTTPException(status_code=400, detail="Date is required.")

        # Parse the date string into a datetime object
        current_date = datetime.strptime(date_str, "%Y-%m-%d")
        logger.info(f"📅 PARSED CURRENT DATE: {current_date.strftime('%Y-%m-%d')}")

        # Calculate today, tomorrow and day after tomorrow
        today = current_date
        tomorrow = current_date + timedelta(days=1)
        day_after_tomorrow = current_date + timedelta(days=2)
        
        logger.info(f"🎯 CHECKING FOLLOW-UPS HAPPENING BETWEEN:")
        logger.info(f"   • Today: {today.strftime('%Y-%m-%d')}")
        logger.info(f"   • Tomorrow: {tomorrow.strftime('%Y-%m-%d')}")
        logger.info(f"   • Day after tomorrow: {day_after_tomorrow.strftime('%Y-%m-%d')}")
        
        # Query: Find follow-ups happening TODAY, TOMORROW, OR DAY AFTER TOMORROW
        query = {
            "followup_date": {
                "$in": [
                    today.strftime("%Y-%m-%d"),
                    tomorrow.strftime("%Y-%m-%d"),
                    day_after_tomorrow.strftime("%Y-%m-%d")
                ]
            },
            "reminded": False  # Only patients who haven't been reminded yet
        }
        
        logger.info(f"📋 DATABASE QUERY: {json.dumps(query, indent=2)}")
        
        # Find all follow-ups that need to be reminded
        follow_ups_cursor = whatsapp_followup_collection.find(query)
        follow_ups = await follow_ups_cursor.to_list(length=None)
        
        logger.info(f"📊 FOUND {len(follow_ups)} FOLLOW-UPS TO REMIND")
        
        # Prepare messages for bulk sending
        messages_to_send = []
        follow_up_details = []  # Store follow-up details for processing
        
        for follow_up in follow_ups:
            try:
                follow_up_id = str(follow_up.get("_id"))
                patient_sys_user_id = follow_up.get("patient_id")  # This IS the sys_user_id
                doctor_id = follow_up.get("doctor_id")
                followup_date_str = follow_up.get("followup_date")
                doctor_sys_user_id = follow_up.get("doctor_sys_user_id")
                
                logger.info(f"🔍 Processing follow-up ID: {follow_up_id}")
                logger.info(f"   • Patient sys_user_id: {patient_sys_user_id}")
                logger.info(f"   • Follow-up date: {followup_date_str}")
                logger.info(f"   • Doctor sys_user_id: {doctor_sys_user_id}")
                
                # ==================== SIMPLE PATIENT LOOKUP ====================
                patient = await patient_user_collection.find_one({"sys_user_id": patient_sys_user_id})
                
                if not patient:
                    logger.warning(f"⚠️ Patient not found with sys_user_id: {patient_sys_user_id}")
                    continue
                
                logger.info(f"✅ Found patient: {patient.get('name')}")
                logger.info(f"   • Patient name: {patient.get('name')}")
                logger.info(f"   • Patient ID: {patient.get('patient_id')}")
                logger.info(f"   • HMS ID: {patient.get('hms_id')}")
                # ==================== END PATIENT LOOKUP ====================
                
                # ==================== SIMPLIFIED PHONE NUMBER HANDLING ====================
                phone_number = patient.get("phone_number")
                patient_name = patient.get("name", "Patient")

                if not phone_number:
                    logger.warning(f"⚠️ No phone number for patient: {patient_name}")
                    continue

                logger.info(f"📱 RAW phone number from DB: {phone_number}")

                # Basic cleaning: remove whatsapp: prefix if present
                phone_number = str(phone_number).strip()
                if phone_number.startswith("whatsapp:"):
                    phone_number = phone_number[len("whatsapp:"):]
                    logger.info(f"📱 Removed whatsapp: prefix: {phone_number}")

                logger.info(f"📱 Phone number ready for followup function: {phone_number}")
                # ==================== END PHONE FORMATTING ====================
                
                # ==================== GET ACTUAL DOCTOR NAME ====================
                doctor_name = "your doctor"  # Default fallback
                doctor = None
                
                # First try to get doctor from doctor_sys_user_id in follow-up record
                if doctor_sys_user_id:
                    doctor = await doctor_user_collection.find_one({"sys_user_id": doctor_sys_user_id})
                    if doctor:
                        doctor_name = doctor.get("name", "your doctor")
                        logger.info(f"👨‍⚕️ Found doctor by sys_user_id: {doctor_name}")
                
                # If not found, try doctor_id field
                if not doctor and doctor_id:
                    doctor = await doctor_user_collection.find_one({
                        "$or": [
                            {"doctor_id": doctor_id},
                            {"sys_user_id": doctor_id}
                        ]
                    })
                    if doctor:
                        doctor_name = doctor.get("name", "your doctor")
                        logger.info(f"👨‍⚕️ Found doctor by doctor_id: {doctor_name}")
                
                # If still not found, try to get from patient's latest appointment
                if not doctor:
                    latest_appointment = await get_latest_appointment(patient.get("patient_id"))
                    if latest_appointment and latest_appointment.get("doctor_id"):
                        appointment_doctor_id = latest_appointment.get("doctor_id")
                        doctor = await doctor_user_collection.find_one({
                            "$or": [
                                {"sys_user_id": appointment_doctor_id},
                                {"doctor_id": appointment_doctor_id}
                            ]
                        })
                        if doctor:
                            doctor_name = doctor.get("name", "your doctor")
                            logger.info(f"👨‍⚕️ Found doctor from latest appointment: {doctor_name}")
                
                logger.info(f"👨‍⚕️ FINAL DOCTOR NAME: {doctor_name}")
                # ==================== END DOCTOR NAME LOOKUP ====================
                
                # Format the date for display
                followup_date_obj = datetime.strptime(followup_date_str, "%Y-%m-%d")
                formatted_date = followup_date_obj.strftime("%B %d, %Y")
                day_name = followup_date_obj.strftime("%A")
                
                # Calculate days difference for the message
                days_difference = (followup_date_obj - current_date).days
                logger.info(f"📅 Days difference: {days_difference} days")
                
                # Check if doctor is available on the follow-up date
                is_doctor_available = True
                nearest_date = None
                available_dates = []
                
                if doctor_sys_user_id or (doctor and doctor.get("sys_user_id")):
                    doctor_id_for_availability = doctor_sys_user_id or doctor.get("sys_user_id")
                    # Get doctor's available dates
                    available_dates = await get_doctor_available_dates_with_cache(doctor_id_for_availability)
                    
                    # Check if doctor works on the follow-up date
                    is_doctor_available = any(
                        date_info["date"] == followup_date_str
                        for date_info in available_dates
                    )
                    
                    if not is_doctor_available:
                        # Find nearest available date
                        nearest_date = await find_nearest_available_date(doctor_id_for_availability, followup_date_str)
                        if nearest_date:
                            logger.info(f"📅 Doctor not available. Nearest date: {nearest_date['date']}")
                
                # Determine urgency based on days difference
                urgency = ""
                time_info = ""
                if days_difference == 0:
                    urgency = "⏰ *TODAY - Urgent Reminder* ⏰"
                    time_info = "is *TODAY*"
                elif days_difference == 1:
                    urgency = "⏰ *TOMORROW - Reminder* ⏰"
                    time_info = "is *TOMORROW*"
                elif days_difference == 2:
                    urgency = "⏰ *Day After Tomorrow - Reminder* ⏰"
                    time_info = "is in *2 DAYS*"
                else:
                    urgency = "📅 *Follow-up Reminder*"
                    time_info = f"is in *{days_difference} DAYS*"
                
                # ==================== GENERATE UUID FOR THIS FOLLOW-UP ====================
                followup_uuid = str(uuid.uuid4())
                
                # First, remove any existing yes_button_id and no_button_id fields
                await whatsapp_followup_collection.update_one(
                    {"_id": ObjectId(follow_up_id)},
                    {
                        "$unset": {
                            "yes_button_id": "",
                            "no_button_id": ""
                        },
                        "$set": {
                            "followup_uuid": followup_uuid
                        }
                    }
                )
                logger.info(f"🔑 Generated UUID {followup_uuid} for follow-up {follow_up_id}")
                logger.info(f"🧹 Removed yes_button_id and no_button_id fields")
                
                # Store follow-up details for session
                session_key = f"followup_{patient_sys_user_id}_{follow_up_id}"
                USER_RESPONSE_SESSIONS[session_key] = {
                    "patient_sys_user_id": patient_sys_user_id,
                    "patient_name": patient_name,
                    "doctor_id": doctor_id,
                    "doctor_sys_user_id": doctor_sys_user_id or (doctor.get("sys_user_id") if doctor else None),
                    "doctor_name": doctor_name,
                    "original_followup_date": followup_date_str,
                    "follow_up_id": follow_up_id,
                    "followup_uuid": followup_uuid,
                    "session_key": session_key,
                    "created_at": datetime.now().isoformat(),
                    "state": "date_selection",  # Initial state
                    "available_dates": available_dates[:7] if available_dates else [],  # Store first 7 days
                    "nearest_date": nearest_date,
                    "days_difference": days_difference,
                    "template_variables": {
                        "patient_name": patient_name,
                        "doctor_name": doctor_name,
                        "appointment_date": formatted_date,
                        "day_name": day_name,
                        "patient_id": patient_sys_user_id,  # Just the ID, no prefix
                        "followup_uuid": followup_uuid      # Just the UUID, no prefix
                    },
                    "urgency": urgency,
                    "time_info": time_info
                }
                
                logger.info(f"🔑 Created session: {session_key}")
                
                # ==================== PREPARE TEMPLATE VARIABLES ====================
                # Template HX0aef647da42a454a2be9d246319f2b48 expects:
                # Named variables: patient_name, doctor_name, appointment_date, day_name
                # {{1}} = patient_id (just the ID, no YES_ prefix)
                # {{2}} = followup_uuid (just the UUID, no NO_ prefix)
                template_variables = {
                    "patient_name": patient_name,
                    "doctor_name": doctor_name,
                    "appointment_date": formatted_date,
                    "day_name": day_name,
                    "yes_button_id": patient_sys_user_id,  # Just patient ID, no YES_ prefix
                    "no_button_id": followup_uuid           # Just UUID, no NO_ prefix
                }
                
                logger.info(f"📋 Template variables prepared:")
                logger.info(f"   • patient_name: {patient_name}")
                logger.info(f"   • doctor_name: {doctor_name}")
                logger.info(f"   • appointment_date: {formatted_date}")
                logger.info(f"   • day_name: {day_name}")
                logger.info(f"   • {{1}} (Patient ID - NO PREFIX): {patient_sys_user_id}")
                logger.info(f"   • {{2}} (Follow-up UUID - NO PREFIX): {followup_uuid}")
                logger.info(f"   • YES button will send: yes{patient_sys_user_id},{followup_uuid}")
                logger.info(f"   • NO button will send: no{patient_sys_user_id},{followup_uuid}")
                
                # Create message content based on doctor availability and urgency (fallback text)
                if not is_doctor_available and nearest_date:
                    # Doctor not available - suggest nearest date
                    message_content = (
                        f"👋 Hello {patient_name},\n\n"
                        f"{urgency}\n\n"
                        f"⚠️ *Schedule Change Needed*\n\n"
                        f"Your follow-up appointment with Dr. {doctor_name} {time_info}:\n"
                        f"📅 {formatted_date} ({day_name})\n\n"
                        f"But Dr. {doctor_name} is not available on that date.\n"
                        f"The nearest available date is:\n"
                        f"⭐ {nearest_date['display_date']} ({nearest_date['day_name']})\n\n"
                        f"*Please choose:*\n"
                        f"1. ✅ Confirm new date ({nearest_date['display_date']})\n"
                        f"2. 📅 See other available dates\n"
                        f"3. ❌ Cancel follow-up\n\n"
                        f"_Reply with 1, 2, or 3_"
                    )
                else:
                    # Doctor available - normal reminder with urgency
                    if days_difference == 0:
                        # TODAY - urgent message
                        message_content = (
                            f"👋 Hello {patient_name},\n\n"
                            f"{urgency}\n\n"
                            f"Your follow-up appointment with Dr. {doctor_name} is *TODAY*:\n"
                            f"📅 *{formatted_date}* ({day_name})\n\n"
                            f"⚠️ *Please confirm immediately:*\n\n"
                            f"1. ✅ Yes, I'll attend today\n"
                            f"2. 📅 Need to reschedule\n"
                            f"3. ❌ No, I can't make it\n\n"
                            f"_Reply with 1, 2, or 3_"
                        )
                    else:
                        # Tomorrow or day after - normal reminder
                        message_content = (
                            f"👋 Hello {patient_name},\n\n"
                            f"{urgency}\n\n"
                            f"Your follow-up appointment with Dr. {doctor_name} {time_info}:\n"
                            f"📅 *{formatted_date}* ({day_name})\n\n"
                            f"Please confirm your attendance:\n\n"
                            f"1. ✅ Yes, I'll attend\n"
                            f"2. 📅 Need to reschedule\n"
                            f"3. ❌ No, I can't make it\n\n"
                            f"_Reply with 1, 2, or 3_"
                        )
                
                # Add to bulk send list WITH TEMPLATE VARIABLES
                messages_to_send.append({
                    "phone_number": phone_number,
                    "message": message_content,  # Fallback text message
                    "patient_id": patient_sys_user_id,
                    "patient_name": patient_name,
                    "follow_up_id": follow_up_id,
                    "followup_uuid": followup_uuid,
                    "session_key": session_key,
                    "yes_button_id": patient_sys_user_id,  # Just patient ID, no YES_ prefix
                    "no_button_id": followup_uuid,          # Just UUID, no NO_ prefix
                    "template_variables": template_variables  # CRITICAL: Include template variables
                })
                
                follow_up_details.append({
                    "patient_sys_user_id": patient_sys_user_id,
                    "follow_up_id": follow_up_id,
                    "followup_uuid": followup_uuid,
                    "session_key": session_key,
                    "days_difference": days_difference,
                    "patient_name": patient_name,
                    "doctor_name": doctor_name,
                    "template_variables": template_variables
                })
                
                logger.info(f"📝 Prepared template message for {patient_name}")
                logger.info(f"   • Doctor: Dr. {doctor_name}")
                logger.info(f"   • Date: {followup_date_str}")
                logger.info(f"   • Urgency: {urgency}")
                logger.info(f"   • Phone: {phone_number}")
                logger.info(f"   • Session: {session_key}")
                logger.info(f"   • UUID: {followup_uuid}")
                logger.info(f"   • YES Button will send: yes{patient_sys_user_id},{followup_uuid}")
                logger.info(f"   • NO Button will send: no{patient_sys_user_id},{followup_uuid}")
                
            except Exception as patient_error:
                logger.error(f"❌ Error preparing message for patient: {str(patient_error)}")
                logger.error(f"Traceback: {traceback.format_exc()}")
                continue
        
        # ==================== BULK SEND MESSAGES USING TEMPLATE ====================
        if messages_to_send:
            logger.info(f"📤 Sending {len(messages_to_send)} messages in bulk USING TEMPLATE HX0aef647da42a454a2be9d246319f2b48")
            send_results = await send_bulk_whatsapp_messages(messages_to_send)
            logger.info(f"📊 Bulk send results: {json.dumps(send_results, indent=2)}")
        else:
            send_results = {"total": 0, "success": 0, "failed": 0}
            logger.info("📭 No messages to send")
        
        # ==================== UPDATE REMINDED STATUS ====================
        updated_count = 0
        if send_results["success"] > 0:
            logger.info(f"🔄 Updating reminded status for {send_results['success']} successful messages")
            
            for detail in follow_up_details:
                try:
                    # First remove any yes_button_id and no_button_id fields
                    await whatsapp_followup_collection.update_one(
                        {"_id": ObjectId(detail["follow_up_id"])},
                        {
                            "$unset": {
                                "yes_button_id": "",
                                "no_button_id": ""
                            }
                        }
                    )
                    
                    # Then update with reminded status
                    update_result = await whatsapp_followup_collection.update_one(
                        {"_id": ObjectId(detail["follow_up_id"])},
                        {
                            "$set": {
                                "reminded": True,
                                "reminded_at": datetime.utcnow().isoformat(),
                                "reminder_type": f"{detail['days_difference']}_day_before" if detail['days_difference'] > 0 else "today",
                                "reminder_sent": True,
                                "template_used": True,
                                "template_id": "HX0aef647da42a454a2be9d246319f2b48",
                                "doctor_name_used": detail["doctor_name"],
                                "followup_uuid": detail["followup_uuid"],
                                "template_variables": {
                                    "patient_name": detail["template_variables"]["patient_name"],
                                    "doctor_name": detail["template_variables"]["doctor_name"],
                                    "appointment_date": detail["template_variables"]["appointment_date"],
                                    "day_name": detail["template_variables"]["day_name"]
                                },
                                "last_updated": datetime.utcnow()
                            }
                        }
                    )
                    if update_result.modified_count > 0:
                        updated_count += 1
                        logger.info(f"✅ Updated reminded status for follow-up ID: {detail['follow_up_id']} with UUID: {detail['followup_uuid']}")
                        
                        # Fetch and log the updated record to verify no yes_button_id/no_button_id fields
                        updated_record = await whatsapp_followup_collection.find_one(
                            {"_id": ObjectId(detail["follow_up_id"])}
                        )
                        if updated_record:
                            # Remove _id for cleaner logging
                            log_record = dict(updated_record)
                            log_record["_id"] = str(log_record["_id"])
                            logger.info(f"📊 Updated Record: {json.dumps(log_record, indent=2, default=str)}")
                except Exception as update_error:
                    logger.error(f"❌ Failed to update reminded status for {detail['follow_up_id']}: {str(update_error)}")
        else:
            logger.warning("⚠️ No successful messages sent, not updating reminded status")
        
        # ==================== RETURN RESPONSE ====================
        response_message = f"Processed {len(follow_ups)} follow-ups, sent {send_results['success']} template messages, updated {updated_count} records"
        logger.info(f"✅ {response_message}")
        
        return {
            "message": "Date processed successfully",
            "date": current_date.strftime("%Y-%m-%d"),
            "template_id": "HX0aef647da42a454a2be9d246319f2b48",
            "checking_dates": [
                today.strftime("%Y-%m-%d"),
                tomorrow.strftime("%Y-%m-%d"),
                day_after_tomorrow.strftime("%Y-%m-%d")
            ],
            "statistics": {
                "total_follow_ups": len(follow_ups),
                "messages_prepared": len(messages_to_send),
                "messages_sent": send_results["success"],
                "messages_failed": send_results["failed"],
                "status_updated": updated_count,
                "sessions_created": len(follow_up_details),
                "template_used": True
            },
            "failed_numbers": send_results.get("failed_numbers", []),
            "next_steps": "Patients will respond via WhatsApp with yes{patient_id},{followup_uuid} or no{patient_id},{followup_uuid}",
            "button_formats": {
                "yes": f"yes{{patient_id}},{{followup_uuid}}",
                "no": f"no{{patient_id}},{{followup_uuid}}"
            },
            "sample_payloads": [
                {
                    "description": "YES button click",
                    "payload": f"yes{PATIENT_ID_EXAMPLE},{UUID_EXAMPLE}" if 'PATIENT_ID_EXAMPLE' in locals() else "yesPAT-be483ec5-a42d-4531-aec1-c1a926b2d77d,de345a91-6640-48a9-b7a6-54294015a5bf"
                },
                {
                    "description": "NO button click",
                    "payload": f"no{PATIENT_ID_EXAMPLE},{UUID_EXAMPLE}" if 'PATIENT_ID_EXAMPLE' in locals() else "noPAT-be483ec5-a42d-4531-aec1-c1a926b2d77d,de345a91-6640-48a9-b7a6-54294015a5bf"
                }
            ]
        }
        
    except ValueError:
        logger.error("❌ Invalid date format provided")
        raise HTTPException(status_code=400, detail="Invalid date format. Please use YYYY-MM-DD.")
    except Exception as e:
        logger.error(f"❌ Error in receive_date endpoint: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

async def book_followup_appointment(session: dict) -> Dict:
    """
    Book appointment for follow-up
    WHAT IT DOES:
    - Creates appointment using existing booking logic
    - Updates follow-up record with appointment ID
    - Returns booking result
    """
    try:
        patient_id = session.get("patient_id")
        doctor_sys_user_id = session.get("doctor_sys_user_id")
        selected_date = session.get("selected_date", {})
        selected_time = session.get("selected_time")
        reason_for_visit = session.get("reason_for_visit", "Follow-up appointment")
        
        if not all([patient_id, doctor_sys_user_id, selected_date, selected_time]):
            return {"success": False, "error": "Missing required information"}
        
        # Get patient details
        patient = await patient_user_collection.find_one({"patient_id": patient_id})
        if not patient:
            return {"success": False, "error": "Patient not found"}
        
        # Prepare appointment data
        appointment_data = {
            "hms_id": patient.get("hms_id", ""),
            "date": selected_date.get("date"),
            "time": selected_time,
            "chief_complaint": reason_for_visit,
            "visit_type": "follow-up",
            "patient_info": {
                "patient_id": patient.get("patient_id"),
                "sys_user_id": patient.get("sys_user_id"),
                "name": patient.get("name"),
                "date_of_birth": patient.get("date_of_birth"),
                "gender": patient.get("gender"),
                "blood_group": patient.get("blood_group"),
                "phone_number": patient.get("phone_number")
            },
            "doctor": {
                "sys_user_id": doctor_sys_user_id,
                "name": session.get("doctor_name", "Doctor")
            }
        }
        
        # Call the appointment booking API
        api_result = await book_appointment_api(appointment_data)
        
        if api_result.get("success"):
            # Update follow-up record with appointment ID
            follow_up_id = session.get("follow_up_id")
            if follow_up_id:
                await whatsapp_followup_collection.update_one(
                    {"_id": ObjectId(follow_up_id)},
                    {"$set": {
                        "appointment_booked": True,
                        "appointment_id": api_result.get("appointment_id"),
                        "booked_at": datetime.utcnow().isoformat(),
                        "booked_date": selected_date.get("date"),
                        "booked_time": selected_time
                    }}
                )
            
            return {
                "success": True,
                "appointment_id": api_result.get("appointment_id"),
                "message": "Appointment booked successfully"
            }
        else:
            return {
                "success": False,
                "error": api_result.get("error", "Failed to book appointment")
            }
            
    except Exception as e:
        logger.error(f"❌ Error booking follow-up appointment: {str(e)}")
        return {"success": False, "error": str(e)}


@router.delete("/delete-followup/{id}")
async def delete_followup(id: str):
    try:
        # Convert string ID to ObjectId
        object_id = ObjectId(id)
        
        # Attempt to delete the document
        result = await whatsapp_followup_collection.delete_one({"_id": object_id})
        
        # Check if a document was deleted
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Follow-up not found")
        
        return {"message": "Follow-up data deleted successfully"}

    except Exception as e:
        # Generic exception handling
        raise HTTPException(status_code=400, detail=f"Error: {e}")




async def send_followup_whatsapp_message(phone_number: str, template_variables: dict = None) -> Dict:
    """
    Send WhatsApp message using template HX0aef647da42a454a2be9d246319f2b48
    Template expects:
    - Named variables: patient_name, doctor_name, appointment_date, day_name
    - {{1}} = patient_id (just the ID, no YES_ prefix)
    - {{2}} = followup_uuid (just the UUID, no NO_ prefix)
    """
    try:
        # Twilio credentials
        client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

        # Clean and format the phone number
        phone_number = str(phone_number).strip()
        
        logger.info(f"📱 Followup - Raw phone number: {phone_number}")
        
        # Remove any existing 'whatsapp:' prefix
        if phone_number.startswith("whatsapp:"):
            phone_number = phone_number[len("whatsapp:"):]
            logger.info(f"📱 Followup - Removed whatsapp: prefix: {phone_number}")
        
        # Remove any non-digit characters but keep + if present
        has_plus = phone_number.startswith('+')
        digits_only = re.sub(r'\D', '', phone_number)
        
        if has_plus:
            phone_number = f"+{digits_only}"
        else:
            phone_number = digits_only
            
        logger.info(f"📱 Followup - After digit cleanup: {phone_number}")
        
        # Ensure it has country code for India
        if phone_number.startswith('+91'):
            logger.info(f"📱 Followup - Already has +91: {phone_number}")
        elif phone_number.startswith('91') and len(phone_number) >= 10:
            phone_number = f"+{phone_number}"
            logger.info(f"📱 Followup - Added + to 91 prefix: {phone_number}")
        elif len(phone_number) == 10:
            phone_number = f"+91{phone_number}"
            logger.info(f"📱 Followup - Added +91 to 10-digit: {phone_number}")
        elif phone_number.startswith('0') and len(phone_number) == 11:
            phone_number = f"+91{phone_number[1:]}"
            logger.info(f"📱 Followup - Removed leading 0, added +91: {phone_number}")
        else:
            logger.warning(f"📱 Followup - Unusual format, trying as-is: {phone_number}")
        
        # Format for Twilio WhatsApp API
        formatted_recipient = f"whatsapp:{phone_number}"
        formatted_from = f"whatsapp:{TWILIO_WHATSAPP_NUMBER}"
        
        logger.info(f"📱 Followup - Final formatted recipient: {formatted_recipient}")
        logger.info(f"📱 Followup - From number: {formatted_from}")

        # Debug: Log what we received
        logger.info(f"📋 Received template_variables: {template_variables}")
        
        # Extract data from template_variables
        if template_variables and isinstance(template_variables, dict):
            patient_name = template_variables.get("patient_name", "Patient")
            doctor_name = template_variables.get("doctor_name", "Doctor")
            appointment_date = template_variables.get("appointment_date", "")
            day_name = template_variables.get("day_name", "")
            
            # Get patient_id (remove YES_ prefix if present)
            patient_id = template_variables.get("yes_button_id", "")
            if patient_id and patient_id.startswith("YES_"):
                patient_id = patient_id.replace("YES_", "")
            
            # Get followup_uuid (remove NO_ prefix if present)
            followup_uuid = template_variables.get("no_button_id", "")
            if followup_uuid and followup_uuid.startswith("NO_"):
                followup_uuid = followup_uuid.replace("NO_", "")
        else:
            patient_name = "Patient"
            doctor_name = "Doctor"
            appointment_date = ""
            day_name = ""
            patient_id = ""
            followup_uuid = ""
        
        # Prepare content variables for the template
        # CRITICAL: Variable names must be EXACTLY as shown:
        # - patient_name, doctor_name, appointment_date, day_name (named variables)
        # - "1" = patient_id (just the ID, no prefix)
        # - "2" = followup_uuid (just the UUID, no prefix)
        content_variables = {
            "patient_name": patient_name,
            "doctor_name": doctor_name,
            "appointment_date": appointment_date,
            "day_name": day_name,
            "1": patient_id,              # Patient ID - NO PREFIX
            "2": followup_uuid             # Follow-up UUID - NO PREFIX
        }
        
        logger.info(f"📋 Final template variables being used:")
        logger.info(f"   • patient_name: {content_variables['patient_name']}")
        logger.info(f"   • doctor_name: {content_variables['doctor_name']}")
        logger.info(f"   • appointment_date: {content_variables['appointment_date']}")
        logger.info(f"   • day_name: {content_variables['day_name']}")
        logger.info(f"   • {{1}} (Patient ID - NO PREFIX): {content_variables['1']}")
        logger.info(f"   • {{2}} (Follow-up UUID - NO PREFIX): {content_variables['2']}")
        
        # Log the button formats that will be created by the template
        logger.info(f"🔘 Button formats from template:")
        logger.info(f"   • YES button will send: yes{content_variables['1']},{content_variables['2']}")
        logger.info(f"   • NO button will send: no{content_variables['1']},{content_variables['2']}")
        logger.info(f"   • Example YES payload: yes{content_variables['1']},{content_variables['2']}")
        logger.info(f"   • Example NO payload: no{content_variables['1']},{content_variables['2']}")

        # Send the WhatsApp message using the template
        content_variables_json = json.dumps(content_variables)
        
        logger.info(f"📤 Sending with content_variables JSON: {content_variables_json}")
        logger.info(f"📤 Template ID: HX0aef647da42a454a2be9d246319f2b48")
        
        message = client.messages.create(
            from_=formatted_from,
            content_sid='HX0aef647da42a454a2be9d246319f2b48',  # Template ID
            content_variables=content_variables_json,
            to=formatted_recipient
        )

        logger.info(f"✅ Followup template message sent successfully! SID: {message.sid}")
        
        # Log the complete message details
        logger.info(f"📬 Message Details:")
        logger.info(f"   • SID: {message.sid}")
        logger.info(f"   • Status: {message.status}")
        logger.info(f"   • To: {message.to}")
        logger.info(f"   • From: {message.from_}")
        logger.info(f"   • Date Created: {message.date_created}")
        
        return {
            "status": "success", 
            "sid": message.sid,
            "to": formatted_recipient,
            "from": formatted_from,
            "template_used": True,
            "template_id": "HX0aef647da42a454a2be9d246319f2b48",
            "variables": {
                "patient_name": content_variables['patient_name'],
                "doctor_name": content_variables['doctor_name'],
                "appointment_date": content_variables['appointment_date'],
                "day_name": content_variables['day_name'],
                "1": content_variables['1'],  # Patient ID
                "2": content_variables['2']   # Follow-up UUID
            },
            "button_formats": {
                "yes": f"yes{content_variables['1']},{content_variables['2']}",
                "no": f"no{content_variables['1']},{content_variables['2']}"
            }
        }

    except Exception as e:
        logger.error(f"❌ Error sending followup WhatsApp template message: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return {
            "status": "error",
            "error": str(e),
            "to": phone_number if 'formatted_recipient' not in locals() else formatted_recipient
        }
@router.post("/test-template-custom")
async def test_template_custom(request: Request):
    """
    Test with custom phone number - USING NAMED TEMPLATE VARIABLES
    Sends WhatsApp message ONLY, NO database operations
    """
    try:
        # Get custom data from request
        payload = await request.json() if await request.body() else {}
        
        # Use custom phone or default to your number
        phone_number = payload.get("phone_number", "+918123722166")
        
        # Use custom variables or default test data
        template_variables = payload.get("template_variables", {
            "patient_name": "Test Patient",
            "doctor_name": "Test Doctor", 
            "appointment_date": datetime.now().strftime("%d-%m-%Y"),
            "day_name": datetime.now().strftime("%A")
        })
        
        logger.info(f"🧪 TEST ONLY: Sending template message (NO DB SAVE)")
        logger.info(f"📱 Phone: {phone_number}")
        logger.info(f"📋 Variables: {template_variables}")
        
        # Initialize Twilio client
        client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
        
        # Clean phone number
        phone = str(phone_number).strip()
        
        # Remove whatsapp: prefix if present
        if phone.startswith("whatsapp:"):
            phone = phone[len("whatsapp:"):]
        
        # Format phone number properly
        if not phone.startswith("+"):
            if phone.startswith("91") and len(phone) >= 10:
                phone = f"+{phone}"
            elif len(phone) == 10:
                phone = f"+91{phone}"
        
        to_number = f"whatsapp:{phone}"
        from_number = f"whatsapp:{TWILIO_WHATSAPP_NUMBER}"
        
        # Prepare variables in NAMED format (matching your template)
        content_variables = json.dumps({
            "patient_name": template_variables["patient_name"],
            "doctor_name": template_variables["doctor_name"],
            "appointment_date": template_variables["appointment_date"],
            "day_name": template_variables["day_name"]
        })
        
        logger.info(f"📤 Sending with NAMED variables: {content_variables}")
        
        # Send message using your template with NAMED placeholders
        # NO DATABASE OPERATIONS HERE
        message = client.messages.create(
            from_=from_number,
            content_sid="HXfe7621e46da253b121b1b4f7e1116261",  # Your template SID
            content_variables=content_variables,  # Named variables
            to=to_number
        )
        
        logger.info(f"✅ Message sent! SID: {message.sid}")
        logger.info(f"⚠️ NOTE: No data saved to database - test only")
        
        return {
            "success": True,
            "message": "Template message sent successfully (NO DB SAVE)",
            "sid": message.sid,
            "status": message.status,
            "to": phone,
            "from": TWILIO_WHATSAPP_NUMBER,
            "template_sid": "HXfe7621e46da253b121b1b4f7e1116261",
            "template_format": "named_placeholders",
            "variables_sent": template_variables,
            "database_saved": False,  # Explicitly state no DB save
            "note": "This is a TEST ONLY endpoint. No data was saved to database.",
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"❌ Failed to send template message: {str(e)}")
        
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e),
                "message": "Failed to send template message",
                "database_saved": False,  # Still false even on error
                "note": "This is a TEST endpoint with NO database operations"
            }
        )


# ============================================================
# ============ PATIENT MEDICAL CONTEXT FUNCTION =============
# ============================================================

async def get_patient_medical_context(patient_id: str) -> Optional[dict]:
    """
    Fetch the latest medical context for a patient from the dictation endpoint
    RETURNS: Full response from endpoint which already contains doctor_id
    """
    try:
        logger.info(f"🔍 Fetching medical context for patient: {patient_id}")
        
        # Construct the API URL
        api_url = f"{api_base_url}hms/users/data/context/get_dictation_by_patient"
        
        # Make the API call with timeout
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                api_url,
                params={"patient_id": patient_id},
                headers={"Content-Type": "application/json"}
            )
        
        logger.info(f"📥 Medical Context API Response Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            
            # Log the response structure
            logger.info(f"📋 Response type: {type(data)}")
            
            if isinstance(data, list) and len(data) > 0:
                logger.info(f"✅ Found {len(data)} medical context records for patient: {patient_id}")
                
                # Log the first record's doctor_id if available
                first_record = data[0]
                doctor_id = first_record.get("doctor_id")
                logger.info(f"👨‍⚕️ Doctor ID from context: {doctor_id}")
                
                # Return the full response as-is
                return {
                    "status": "success",
                    "patient_id": patient_id,
                    "count": len(data),
                    "data": data
                }
            elif isinstance(data, dict):
                # Handle case where response is a single object
                doctor_id = data.get("doctor_id")
                logger.info(f"👨‍⚕️ Doctor ID from context: {doctor_id}")
                logger.info(f"✅ Found medical context for patient: {patient_id}")
                return data
            else:
                logger.warning(f"⚠️ Unexpected response format for patient: {patient_id}")
                return None
        else:
            logger.error(f"❌ API returned error: {response.status_code}")
            logger.error(f"Response: {response.text[:500]}")
            return None
            
    except httpx.TimeoutException:
        logger.error("⏰ Timeout while fetching patient medical context")
        return None
    except Exception as e:
        logger.error(f"❌ Error fetching patient medical context: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return None
# ============================================================
# ============ PATIENT EDUCATION API ENDPOINTS ==============
# ============================================================

@router.get("/education-records")
async def get_education_records(
    patient_id: Optional[str] = Query(None, description="Filter by patient ID"),
    hms_id: Optional[str] = Query(None, description="Filter by HMS ID"),
    doctor_id: Optional[str] = Query(None, description="Filter by doctor ID"),
    limit: int = Query(50, description="Number of records to return", ge=1, le=1000),
    skip: int = Query(0, description="Number of records to skip for pagination", ge=0)
):
    """Get all patient education Q&A records with optional filters"""
    try:
        # Build query
        query = {}
        
        if patient_id:
            query["patient_id"] = patient_id
        if hms_id:
            query["hms_id"] = hms_id.strip()
        if doctor_id:
            query["doctor_id"] = doctor_id
        
        # Get total count
        total_count = await patient_education_collection.count_documents(query)
        
        # Fetch records with pagination
        cursor = patient_education_collection.find(query).sort("question_timestamp", -1).skip(skip).limit(limit)
        records = await cursor.to_list(length=limit)
        
        # Convert ObjectId to string and format dates
        for record in records:
            record["_id"] = str(record.get("_id"))
            if "question_timestamp" in record and isinstance(record["question_timestamp"], datetime):
                record["question_timestamp"] = record["question_timestamp"].isoformat()
            if "answer_timestamp" in record and isinstance(record["answer_timestamp"], datetime):
                record["answer_timestamp"] = record["answer_timestamp"].isoformat()
        
        return {
            "success": True,
            "count": len(records),
            "total": total_count,
            "skip": skip,
            "limit": limit,
            "filters": {
                "patient_id": patient_id,
                "hms_id": hms_id,
                "doctor_id": doctor_id
            },
            "records": records
        }
        
    except Exception as e:
        logger.error(f"❌ Error fetching education records: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error fetching records: {str(e)}")


@router.get("/education-records/{education_id}")
async def get_education_record_by_id(education_id: str):
    """Get a specific education record by its ID"""
    try:
        record = await patient_education_collection.find_one({"education_id": education_id})
        
        if not record:
            raise HTTPException(status_code=404, detail=f"Education record with ID {education_id} not found")
        
        record["_id"] = str(record.get("_id"))
        
        if "question_timestamp" in record and isinstance(record["question_timestamp"], datetime):
            record["question_timestamp"] = record["question_timestamp"].isoformat()
        if "answer_timestamp" in record and isinstance(record["answer_timestamp"], datetime):
            record["answer_timestamp"] = record["answer_timestamp"].isoformat()
        
        return {
            "success": True,
            "record": record
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error fetching education record: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error fetching record: {str(e)}")


@router.get("/patient-education/{patient_id}")
async def get_patient_education_history(patient_id: str):
    """Get all education records for a specific patient"""
    try:
        cursor = patient_education_collection.find({"patient_id": patient_id}).sort("question_timestamp", -1)
        records = await cursor.to_list(length=None)
        
        for record in records:
            record["_id"] = str(record.get("_id"))
            if "question_timestamp" in record and isinstance(record["question_timestamp"], datetime):
                record["question_timestamp"] = record["question_timestamp"].isoformat()
            if "answer_timestamp" in record and isinstance(record["answer_timestamp"], datetime):
                record["answer_timestamp"] = record["answer_timestamp"].isoformat()
        
        patient_name = records[0].get("patient_name", "Unknown") if records else "Unknown"
        
        return {
            "success": True,
            "patient_id": patient_id,
            "patient_name": patient_name,
            "total_questions": len(records),
            "records": records
        }
        
    except Exception as e:
        logger.error(f"❌ Error fetching patient education history: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error fetching patient history: {str(e)}")




# @router.get("/appointments/doctor/{doctor_id}")
# async def get_appointments_by_doctor(doctor_id: str):

#     cursor = appointment_records_collection.find(
#         {"doctor_id": doctor_id}
#     ).limit(100)

#     appointments = []

#     async for appointment in cursor:
#         appointments.append({
#             "hms_id": appointment.get("hms_id"),
#             "patient_name": appointment.get("patient_name"),
#             "appointment_date": appointment.get("appointment_date"),
#             "appointment_time": appointment.get("appointment_time"),
#             "created_at": appointment.get("created_at"),
#             "appointment_id": appointment.get("appointment_id"),
#             "source": appointment.get("source", "N/A")
#         })

#     if not appointments:
#         raise HTTPException(
#             status_code=404,
#             detail="No appointments found for this doctor"
#         )

#     return appointments





@router.get("/appointment-records_all", response_model=List[dict])
async def get_appointment_records():
    # Fetch all data from the collection
    cursor = appointment_records_collection.find()
    appointment_records = await cursor.to_list(length=None)  # Retrieves all data
    
    # Convert ObjectId to string for JSON serialization
    for record in appointment_records:
        record["_id"] = str(record["_id"])
    
    return appointment_records




@router.delete("/delete-patient-education")
async def delete_patient_education():
    try:
        # Delete all documents in the collection
        result = await patient_education_collection.delete_many({})  # Empty filter deletes all documents
        if result.deleted_count > 0:
            return {"message": f"Successfully deleted {result.deleted_count} documents from patient_education_collection."}
        else:
            raise HTTPException(status_code=404, detail="No documents found to delete.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An error occurred: {e}")



@router.get("/appointments/doctor/{doctor_id}", response_model=List[dict])
async def get_appointments_by_doctor(doctor_id: str):
    # Fetch all appointment records for the specified doctor_id
    cursor = appointment_records_collection.find(
        {"doctor_id": doctor_id}
    ).limit(100)

    appointments = []

    async for appointment in cursor:
        appointments.append({
            "doctor_id": appointment.get("doctor_id"),
            "doctor_name": appointment.get("doctor_name"),  # Add doctor_name
            "specialization": appointment.get("specialization"),  # Add specialization
            "patient_id": appointment.get("patient_sys_user_id"),  # Use patient_sys_user_id as patient_id
            "hms_id": appointment.get("hms_id"),
            "patient_name": appointment.get("patient_name"),
            "appointment_date": appointment.get("appointment_date"),
            "appointment_time": appointment.get("appointment_time"),
            "created_at": appointment.get("created_at"),
            "updated_at": appointment.get("updated_at"),
            "appointment_id": appointment.get("appointment_id"),
            "source": appointment.get("source", "N/A")
        })

    if not appointments:
        raise HTTPException(
            status_code=404,
            detail="No appointments found for this doctor"
        )

    return appointments



@router.delete("/delete-whatsapp-followup", response_model=dict)
async def delete_whatsapp_followup_data():
    try:
        # Delete all data from the collection
        result = await whatsapp_followup_collection.delete_many({})
        
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="No data found to delete")
        
        return {"status": "success", "message": f"Deleted {result.deleted_count} records"}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/follow-up-data", response_model=List[dict])
async def get_follow_up_data():
    try:
        # Fetch all follow-up data from the collection
        follow_up_data_cursor = whatsapp_followup_collection.find()

        follow_up_data = await follow_up_data_cursor.to_list(length=None)

        if not follow_up_data:
            raise HTTPException(
                status_code=404,
                detail="No follow-up data found"
            )

        # Convert ObjectId to string
        for data in follow_up_data:
            data["_id"] = str(data["_id"])

        return follow_up_data

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/appointments", response_model=List[dict])
async def get_appointments():
    # Fetch all appointment records from the collection
    cursor = appointment_records_collection.find().limit(100)

    appointments = []

    async for appointment in cursor:
        appointments.append({
            "doctor_id": appointment.get("doctor_id"),
            "doctor_name": appointment.get("doctor_name"),
            "specialization": appointment.get("specialization"),
            "patient_id": appointment.get("patient_sys_user_id"),
            "hms_id": appointment.get("hms_id"),
            "patient_name": appointment.get("patient_name"),
            "appointment_date": appointment.get("appointment_date"),
            "appointment_time": appointment.get("appointment_time"),
            "created_at": appointment.get("created_at"),
            "updated_at": appointment.get("updated_at"),
            "appointment_id": appointment.get("appointment_id"),
            "source": appointment.get("source", "N/A")
        })

    if not appointments:
        raise HTTPException(
            status_code=404,
            detail="No appointments found"
        )

    return appointments

@router.get("/education-records")
async def get_education_records(
    patient_id: Optional[str] = Query(None, description="Filter by patient ID"),
    hms_id: Optional[str] = Query(None, description="Filter by HMS ID"),
    doctor_id: Optional[str] = Query(None, description="Filter by doctor ID"),
    limit: int = Query(50, description="Number of records to return", ge=1, le=1000),
    skip: int = Query(0, description="Number of records to skip for pagination", ge=0)
):
    """Get all patient education Q&A records with optional filters"""
    try:
        # Build query
        query = {}
        
        if patient_id:
            query["patient_id"] = patient_id
        if hms_id:
            query["hms_id"] = hms_id.strip()
        if doctor_id:
            query["doctor_id"] = doctor_id
        
        # Get total count
        total_count = await patient_education_collection.count_documents(query)
        
        # Fetch records with pagination
        cursor = patient_education_collection.find(query).sort("question_timestamp", -1).skip(skip).limit(limit)
        records = await cursor.to_list(length=limit)
        
        # Convert ObjectId to string and format dates
        for record in records:
            record["_id"] = str(record.get("_id"))
            if "question_timestamp" in record and isinstance(record["question_timestamp"], datetime):
                record["question_timestamp"] = record["question_timestamp"].isoformat()
            if "answer_timestamp" in record and isinstance(record["answer_timestamp"], datetime):
                record["answer_timestamp"] = record["answer_timestamp"].isoformat()
        
        return {
            "success": True,
            "count": len(records),
            "total": total_count,
            "skip": skip,
            "limit": limit,
            "filters": {
                "patient_id": patient_id,
                "hms_id": hms_id,
                "doctor_id": doctor_id
            },
            "records": records
        }
        
    except Exception as e:
        logger.error(f"❌ Error fetching education records: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error fetching records: {str(e)}")



async def handle_reschedule_or_new_choice(user_input: str, session: dict) -> str:
    """
    Handle the choice between rescheduling an existing appointment 
    and booking a completely new appointment
    """
    logger.info(f"🔄 Handling reschedule/new choice - User input: '{user_input}'")
    
    if user_input == "1":  # Reschedule existing appointment
        logger.info("✅ User chose to reschedule existing appointment")
        
        # Go to reschedule confirmation flow
        session["state"] = ConversationState.RESCHEDULE_CONFIRM
        
        # Get appointments again to be safe
        hms_id = session.get("appointment_details", {}).get("hms_id")
        upcoming_appointments = await get_upcoming_appointments(hms_id)
        session["upcoming_appointments"] = upcoming_appointments
        
        # Build appointment list for reschedule confirmation
        message = "📋 *Your Upcoming Appointments*\n\n"
        for i, appointment in enumerate(upcoming_appointments, 1):
            message += f"{i}. *Appointment ID:* {appointment.get('appointment_id', 'N/A')}\n"
            message += f"   • Date: {appointment.get('date', 'N/A')}\n"
            message += f"   • Time: {appointment.get('scheduled_time', 'N/A')}\n"
            message += f"   • Doctor: {appointment.get('doctor_name', 'N/A')}\n"
            message += f"   • Status: {appointment.get('status', 'N/A').title()}\n\n"
        
        message += "Which appointment would you like to reschedule?\n"
        message += f"Please select a number (1-{len(upcoming_appointments)}):"
        return message
    
    elif user_input == "2":  # Book new appointment
        logger.info("✅ User chose to book new appointment")
        
        # Clear any reschedule flags and proceed with new appointment booking
        session["appointment_details"]["is_reschedule"] = False
        session.pop("upcoming_appointments", None)  # Remove stored appointments
        
        # Move to doctor selection (previous or new doctor)
        session["state"] = ConversationState.APPOINTMENT_VERIFY
        
        # Get patient info
        patient = session["appointment_details"].get("patient_info")
        
        if not patient:
            return "❌ Patient information not found. Please start over."
        
        # Get latest appointment for previous doctor option
        latest_appointment = await get_latest_appointment(patient["patient_id"])
        
        if latest_appointment:
            doctor_sys_user_id = latest_appointment.get("doctor_id")
            logger.info(f"🔍 Looking for doctor with sys_user_id: '{doctor_sys_user_id}'")
            
            previous_doctor = None
            if doctor_sys_user_id:
                previous_doctor = await get_doctor_by_id(doctor_sys_user_id)
            
            session["appointment_details"]["previous_doctor"] = previous_doctor
            session["appointment_details"]["latest_appointment"] = latest_appointment
            session["appointment_details"]["doctor_sys_user_id"] = doctor_sys_user_id
        
        # Build verification message
        return build_patient_verification_message_after_dob(session)
    
    else:
        # Invalid input - show options again
        logger.warning(f"⚠️ Invalid input for reschedule/new choice: '{user_input}'")
        
        upcoming_appointments = session.get("upcoming_appointments", [])
        message = "📋 *You have upcoming appointments!*\n\n"
        for i, appointment in enumerate(upcoming_appointments[:3], 1):
            message += f"{i}. {appointment.get('date', 'N/A')} at {appointment.get('scheduled_time', 'N/A')}\n"
            message += f"   Doctor: {appointment.get('doctor_name', 'N/A')}\n\n"
        
        message += "Would you like to reschedule an appointment or book a new one?\n\n"
        message += "1. 🔄 Reschedule existing appointment\n"
        message += "2. 📅 Book new appointment\n\n"
        message += "Please reply with 1 or 2:"
        return message


async def handle_reschedule_or_new_choice_same_doctor(user_input: str, session: dict) -> str:
    """
    Handle the choice when patient has an existing appointment with the same doctor
    Only offer reschedule option prominently
    """
    logger.info(f"🔄 Handling same-doctor appointment choice - User input: '{user_input}'")
    
    if user_input == "1":  # Reschedule existing appointment
        logger.info("✅ User chose to reschedule existing appointment with same doctor")
        
        # Go to reschedule confirmation flow
        session["state"] = ConversationState.RESCHEDULE_CONFIRM
        
        # Get appointments again to be safe
        hms_id = session.get("appointment_details", {}).get("hms_id")
        upcoming_appointments = await get_upcoming_appointments(hms_id)
        
        # Filter to same doctor appointments
        current_doctor = session.get("appointment_details", {}).get("doctor", {})
        current_doctor_id = current_doctor.get("sys_user_id")
        
        same_doctor_appointments = [
            apt for apt in upcoming_appointments 
            if apt.get("doctor_id") == current_doctor_id
        ]
        session["upcoming_appointments"] = same_doctor_appointments
        
        # Build appointment list for reschedule confirmation
        message = "📋 *Your Appointments with this Doctor*\n\n"
        for i, appointment in enumerate(same_doctor_appointments, 1):
            message += f"{i}. *Appointment ID:* {appointment.get('appointment_id', 'N/A')}\n"
            message += f"   • Date: {appointment.get('date', 'N/A')}\n"
            message += f"   • Time: {appointment.get('scheduled_time', 'N/A')}\n"
            message += f"   • Status: {appointment.get('status', 'N/A').title()}\n\n"
        
        message += "Which appointment would you like to reschedule?\n"
        message += f"Please select a number (1-{len(same_doctor_appointments)}):"
        return message
    
    elif user_input == "2":  # Book new appointment anyway (create duplicate)
        logger.info("⚠️ User chose to book new appointment despite existing one")
        
        # Clear any reschedule flags and proceed with new appointment booking
        session["appointment_details"]["is_reschedule"] = False
        session.pop("upcoming_appointments", None)  # Remove stored appointments
        
        # Move to visit type selection (since doctor is already selected)
        session["state"] = ConversationState.APPOINTMENT_VISIT_TYPE
        
        # Get doctor info
        doctor = session["appointment_details"].get("doctor", {})
        doctor_name = doctor.get("name", "the doctor")
        
        return (f"👨‍⚕️ *Booking New Appointment with {doctor_name}*\n\n"
                f"⚠️ Note: You already have an existing appointment with this doctor.\n"
                f"Booking a new appointment will create a duplicate.\n\n"
                f"*Is this visit a:*\n\n"
                f"1. 🔄 Follow-up\n"
                f"2. 🆕 New Visit")
    
    else:
        # Invalid input - show options again
        logger.warning(f"⚠️ Invalid input for same-doctor choice: '{user_input}'")
        
        same_doctor_appointments = session.get("upcoming_appointments", [])
        message = "📋 *You have an existing appointment with this doctor!*\n\n"
        for i, appointment in enumerate(same_doctor_appointments[:3], 1):
            message += f"{i}. {appointment.get('date', 'N/A')} at {appointment.get('scheduled_time', 'N/A')}\n"
            message += f"   Doctor: {appointment.get('doctor_name', 'N/A')}\n\n"
        
        message += "Would you like to reschedule this existing appointment?\n\n"
        message += "1. 🔄 Reschedule existing appointment\n"
        message += "2. 📅 Book a new appointment anyway (will create duplicate)\n\n"
        message += "Please reply with 1 or 2:"
        return message


async def handle_appointment_choice(user_input: str, session: dict) -> str:
    """
    Handle the choice between rescheduling an existing appointment 
    and booking a new appointment with a different doctor
    """
    logger.info(f"🔄 Handling appointment choice - User input: '{user_input}'")
    
    if user_input == "1":  # RESCHEDULE an existing appointment
        logger.info("✅ User chose to RESCHEDULE an existing appointment")
        
        # Go to reschedule selection - this will ONLY show appointments with their current doctors
        session["state"] = ConversationState.RESCHEDULE_SELECT_APPOINTMENT
        
        # Get appointments
        appointments = session.get("upcoming_appointments", [])
        
        # Build appointment list for selection
        message = "📋 *Select Appointment to Reschedule*\n\n"
        for i, appointment in enumerate(appointments, 1):
            message += f"{i}. {appointment.get('date', 'N/A')} at {appointment.get('scheduled_time', 'N/A')}\n"
            message += f"   Doctor: {appointment.get('doctor_name', 'N/A')}\n"
            message += f"   Appointment ID: {appointment.get('appointment_id', 'N/A')}\n\n"
        
        message += "Please select the appointment number (1, 2, etc.):"
        return message
    
    elif user_input == "2":  # BOOK NEW APPOINTMENT with DIFFERENT doctor
        logger.info("✅ User chose to book a NEW appointment with a DIFFERENT doctor")
        
        # Clear any reschedule flags
        session["appointment_details"]["is_reschedule"] = False
        
        # IMPORTANT: Store the existing appointments for reference but don't use them for reschedule
        # We keep them in session but will not interfere with new booking
        
        # Go directly to speciality selection for NEW doctor
        session["state"] = ConversationState.APPOINTMENT_SELECT_SPECIALITY
        session["available_specialities"] = SPECIALITIES
        
        # Format options for display
        speciality_list = "\n".join([f"{i+1}. {spec}" for i, spec in enumerate(SPECIALITIES)])
        
        return (f"🏥 *Book New Appointment with Different Doctor*\n\n"
                f"Your existing appointments remain unchanged.\n\n"
                f"*Select Speciality for New Doctor:*\n\n"
                f"{speciality_list}\n\n"
                f"Please choose a speciality (1-{len(SPECIALITIES)}):")
    
    else:
        # Invalid input - show options again
        logger.warning(f"⚠️ Invalid input for appointment choice: '{user_input}'")
        
        upcoming_appointments = session.get("upcoming_appointments", [])
        message = "📋 *You have upcoming appointments!*\n\n"
        for i, appointment in enumerate(upcoming_appointments[:3], 1):
            message += f"{i}. {appointment.get('date', 'N/A')} at {appointment.get('scheduled_time', 'N/A')}\n"
            message += f"   Doctor: {appointment.get('doctor_name', 'N/A')}\n\n"
        
        message += "What would you like to do?\n\n"
        message += "1. 🔄 Reschedule an existing appointment (same doctor)\n"
        message += "2. 📅 Book a NEW appointment with a DIFFERENT doctor\n\n"
        message += "Please reply with 1 or 2:"
        return message


# GET endpoint to fetch data based on doctor_id
@router.get("/doctor-followups/{doctor_id}")
async def get_followups_by_doctor(doctor_id: str):
    # Query to find records for the given doctor_id (asynchronously)
    followups_cursor = whatsapp_followup_collection.find({"doctor_id": doctor_id})
    followups = await followups_cursor.to_list(length=None)  # Asynchronously fetch the results
    
    if not followups:
        raise HTTPException(status_code=404, detail="No followups found for this doctor.")
    
    # Format the result to remove MongoDB-specific fields like _id
    formatted_followups = []
    for followup in followups:
        followup["_id"] = str(followup["_id"])  # Convert ObjectId to string
        formatted_followups.append(followup)
    
    # Return the formatted followup data
    return formatted_followups



# ============================================================
# ============ DOCTOR TO PATIENT MESSAGE ENDPOINT ===========
# ============================================================

@router.post("/doctor-send-message")
async def doctor_send_message_to_patient(request: Request):
    """
    Endpoint for doctors to send WhatsApp messages to their patients
    
    Expects JSON in request body:
    {
        "doctor_id": "DOC-123456",
        "patient_id": "PAT-123456", 
        "message": "Your test results are ready"
    }
    
    ALWAYS saves to database regardless of WhatsApp send success/failure
    Sends: "Hi {patient_name}, Dr. {doctor_name} has sent you a message: {message}"
    Saves: patient_id, doctor_id, patient_name, doctor_name, message, created_at
    """
    try:
        logger.info("=" * 80)
        logger.info("DOCTOR TO PATIENT MESSAGE REQUEST")
        logger.info("=" * 80)
        
        # ==================== PARSE REQUEST BODY ====================
        payload = await request.json()
        
        doctor_id = payload.get("doctor_id")
        patient_id = payload.get("patient_id")
        message_text = payload.get("message")
        
        logger.info(f"Received: doctor_id={doctor_id}, patient_id={patient_id}, message='{message_text[:50]}...'")
        
        # ==================== VALIDATE INPUT ====================
        if not doctor_id:
            return {
                "success": False,
                "error": "doctor_id is required",
                "timestamp": datetime.now().isoformat()
            }
        
        if not patient_id:
            return {
                "success": False,
                "error": "patient_id is required",
                "timestamp": datetime.now().isoformat()
            }
        
        if not message_text:
            return {
                "success": False,
                "error": "message is required",
                "timestamp": datetime.now().isoformat()
            }
        
        # ==================== FIND DOCTOR ====================
        doctor = await doctor_user_collection.find_one({
            "$or": [
                {"sys_user_id": doctor_id},
                {"doctor_id": doctor_id}
            ]
        })
        
        if not doctor:
            logger.error(f"Doctor not found with ID: {doctor_id}")
            return {
                "success": False,
                "error": f"Doctor not found with ID: {doctor_id}",
                "timestamp": datetime.now().isoformat()
            }
        
        doctor_name = doctor.get("name", "Doctor")
        doctor_sys_user_id = doctor.get("sys_user_id", doctor.get("doctor_id"))
        logger.info(f"Doctor found: {doctor_name} (ID: {doctor_sys_user_id})")
        
        # ==================== FIND PATIENT ====================
        patient = await patient_user_collection.find_one({
            "$or": [
                {"sys_user_id": patient_id},
                {"patient_id": patient_id},
                {"hms_id": patient_id}
            ]
        })
        
        if not patient:
            logger.error(f"Patient not found with ID: {patient_id}")
            
            # Generate message ID for failed attempt
            message_id = f"MSG-{datetime.now().strftime('%Y%m%d%H%M%S')}-FAILED"
            
            # Save failed attempt to database (patient not found)
            message_record = DoctorMessageDB(
                message_id=message_id,
                doctor_id=doctor_sys_user_id,
                doctor_name=doctor_name,
                patient_id=patient_id,
                patient_name="Unknown Patient",
                message_content=message_text,
                phone_number="",
                message_sid=None,
                delivery_status="failed_patient_not_found",
                created_at=datetime.utcnow()
            )
            
            await doctor_patient_messages_collection.insert_one(message_record.dict())
            logger.info(f"Failed message saved with ID: {message_id} - Patient not found")
            
            return {
                "success": False,
                "error": f"Patient not found with ID: {patient_id}",
                "message_id": message_id,
                "doctor_name": doctor_name,
                "timestamp": datetime.now().isoformat()
            }
        
        patient_name = patient.get("name", "Patient")
        patient_sys_user_id = patient.get("sys_user_id", patient.get("patient_id"))
        phone_number = patient.get("phone_number")
        
        logger.info(f"Patient found: {patient_name} (ID: {patient_sys_user_id})")
        
        # ==================== CHECK PHONE NUMBER ====================
        if not phone_number:
            logger.error(f"No phone number found for patient: {patient_name}")
            
            # Generate message ID for failed attempt
            message_id = f"MSG-{datetime.now().strftime('%Y%m%d%H%M%S')}-{patient_sys_user_id[-6:] if patient_sys_user_id and len(patient_sys_user_id) > 6 else 'NOPHONE'}"
            
            # Save failed attempt to database (no phone number)
            message_record = DoctorMessageDB(
                message_id=message_id,
                doctor_id=doctor_sys_user_id,
                doctor_name=doctor_name,
                patient_id=patient_sys_user_id,
                patient_name=patient_name,
                message_content=message_text,
                phone_number="",
                message_sid=None,
                delivery_status="failed_no_phone",
                created_at=datetime.utcnow()
            )
            
            await doctor_patient_messages_collection.insert_one(message_record.dict())
            logger.info(f"Failed message saved with ID: {message_id} - No phone number")
            
            return {
                "success": False,
                "error": "Patient has no phone number registered",
                "message_id": message_id,
                "doctor_name": doctor_name,
                "patient_name": patient_name,
                "timestamp": datetime.now().isoformat()
            }
        
        # Clean phone number
        phone_number = str(phone_number).strip()
        if phone_number.startswith("whatsapp:"):
            phone_number = phone_number[len("whatsapp:"):]
        
        if not phone_number.startswith("+"):
            if phone_number.startswith("91") and len(phone_number) >= 10:
                phone_number = f"+{phone_number}"
            elif len(phone_number) == 10:
                phone_number = f"+91{phone_number}"
        
        logger.info(f"Formatted phone number: {phone_number}")
        
        # ==================== BUILD MESSAGE ====================
        patient_first_name = patient_name.split()[0] if patient_name else "there"
        
        message_content = (
            f"Hi {patient_first_name},\n\n"
            f"Dr. {doctor_name} has sent you a message:\n\n"
            f"\"{message_text}\"\n\n"
        )
        
        # ==================== TRY TO SEND WHATSAPP MESSAGE ====================
        message_sid = None
        delivery_status = "failed"  # Default to failed
        
        try:
            client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
            
            whatsapp_message = client.messages.create(
                from_=f"whatsapp:{TWILIO_WHATSAPP_NUMBER}",
                body=message_content,
                to=f"whatsapp:{phone_number}"
            )
            
            message_sid = whatsapp_message.sid
            delivery_status = "sent"  # Changed to sent only if successful
            logger.info(f"WhatsApp message sent! SID: {message_sid}")
            
        except Exception as e:
            logger.error(f"Failed to send WhatsApp message: {str(e)}")
            # delivery_status remains "failed" - continue to save
        
        # ==================== GENERATE MESSAGE ID ====================
        message_id = f"MSG-{datetime.now().strftime('%Y%m%d%H%M%S')}-{patient_sys_user_id[-6:] if patient_sys_user_id and len(patient_sys_user_id) > 6 else 'XXXXXX'}"
        
        # ==================== ALWAYS SAVE TO DATABASE (regardless of send status) ====================
        # Create record using the DoctorMessageDB model
        message_record = DoctorMessageDB(
            message_id=message_id,
            doctor_id=doctor_sys_user_id,
            doctor_name=doctor_name,
            patient_id=patient_sys_user_id,
            patient_name=patient_name,
            message_content=message_text,
            phone_number=phone_number,
            message_sid=message_sid,  # Will be None if failed
            delivery_status=delivery_status,  # "sent" or "failed"
            created_at=datetime.utcnow()
        )
        
        # Convert to dict and save to database
        await doctor_patient_messages_collection.insert_one(message_record.dict())
        logger.info(f"Message saved with ID: {message_id}, Status: {delivery_status}")
        
        # ==================== RETURN RESPONSE ====================
        if delivery_status == "sent":
            return {
                "success": True,
                "message": "Message sent successfully to patient",
                "message_id": message_id,
                "doctor_name": doctor_name,
                "patient_name": patient_name,
                "phone_number": phone_number,
                "message_sid": message_sid,
                "delivery_status": delivery_status,
                "timestamp": datetime.now().isoformat()
            }
        else:
            return {
                "success": False,
                "message": "Message saved but failed to send via WhatsApp",
                "error": "WhatsApp send failed",
                "message_id": message_id,
                "doctor_name": doctor_name,
                "patient_name": patient_name,
                "phone_number": phone_number,
                "message_sid": message_sid,
                "delivery_status": delivery_status,
                "timestamp": datetime.now().isoformat()
            }
        
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return {
            "success": False,
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }

# ============================================================
# ============ GET ALL MESSAGES ENDPOINT ====================
# ============================================================

@router.get("/doctor-patient-messages")
async def get_all_doctor_patient_messages(
    doctor_id: Optional[str] = None,
    patient_id: Optional[str] = None,
    limit: int = 100,
    skip: int = 0
):
    """
    Get all doctor-patient messages with optional filters
    Returns messages sorted by most recent first
    """
    try:
        # Build query with optional filters
        query = {}
        
        if doctor_id:
            query["doctor_id"] = doctor_id
        if patient_id:
            query["patient_id"] = patient_id
        
        # Get total count
        total_count = await doctor_patient_messages_collection.count_documents(query)
        
        # Fetch messages
        cursor = doctor_patient_messages_collection.find(query).sort("created_at", -1).skip(skip).limit(limit)
        messages = await cursor.to_list(length=limit)
        
        # Format for response
        formatted_messages = []
        for msg in messages:
            # Convert _id to string
            msg["_id"] = str(msg["_id"])
            
            # Format datetime
            if "created_at" in msg and isinstance(msg["created_at"], datetime):
                msg["created_at"] = msg["created_at"].isoformat()
            
            formatted_messages.append(msg)
        
        return {
            "success": True,
            "total": total_count,
            "returned": len(formatted_messages),
            "skip": skip,
            "limit": limit,
            "filters": {
                "doctor_id": doctor_id,
                "patient_id": patient_id
            },
            "messages": formatted_messages
        }
        
    except Exception as e:
        logger.error(f"Error fetching messages: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }

@router.get("/get_messages_by_doctor/{doctor_id}", response_model=List[Dict])
async def get_messages_by_doctor(doctor_id: str):
    # Fetch messages based on the provided doctor_id asynchronously
    messages_cursor = doctor_patient_messages_collection.find({"doctor_id": doctor_id})
    messages_list = await messages_cursor.to_list(length=100)  # Use async to_list

    if not messages_list:
        raise HTTPException(status_code=404, detail="No messages found for the given doctor")

    # Structure the result to return only necessary fields
    structured_messages = [
        {
            "_id": str(message["_id"]),
            "message_id": message.get("message_id"),
            "doctor_id": message.get("doctor_id"),
            "doctor_name": message.get("doctor_name"),
            "patient_id": message.get("patient_id"),
            "patient_name": message.get("patient_name"),
            "message_content": message.get("message_content"),
            "phone_number": message.get("phone_number"),
            "message_sid": message.get("message_sid"),
            "delivery_status": message.get("delivery_status"),
            "created_at": message.get("created_at"),
        }
        for message in messages_list
    ]

    return structured_messages