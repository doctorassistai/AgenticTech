import httpx
from typing import Dict, Any
from datetime import datetime, date, timedelta
import re
from fastapi import (
    APIRouter,
    Depends,
    FastAPI,
    HTTPException,
    Request,
    WebSocket,
    status,
    File,
    Form,
    UploadFile,
)
from fastapi import (
    APIRouter,
    Depends,
    FastAPI,
    HTTPException,
    Request,
    WebSocket,
    status,
    File,
    Form,
    UploadFile,
)
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


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
ACCESS_TOKEN_EXPIRE_DAYS = os.getenv("ACCESS_TOKEN_EXPIRE_DAYS")

api_key = os.getenv("GROQ_API_KEY")

groq_client = Groq(api_key=api_key)


router = APIRouter(
    prefix="/whatsapp",
    tags=["doctor"],
    responses={404: {"description": "Not found"}},
)
TWILIO_KEY = os.environ.get("TWILIO_KEY")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")



# Dummy doctor data (replace this with your actual doctor list or database query)
DOCTORS = [
    {"doctor_id": "1", "name": "Dr. John Doe"},
    {"doctor_id": "2", "name": "Dr. Jane Smith"},
    {"doctor_id": "3", "name": "Dr. Alan Walker"},
]


# Twilio WhatsApp number (sender's number)
TWILIO_WHATSAPP_NUMBER = "+14155238886"

# # Base directory for uploads
# BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")

# # Ensure the upload directory exists
# Path(UPLOAD_DIR).mkdir(parents=True, exist_ok=True)


UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")

# Ensure the upload directory exists
os.makedirs(UPLOAD_DIR, exist_ok=True)


MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

mongodb_client = AsyncIOMotorClient(MONGO_URI)  # async (Motor)
database = mongodb_client[MONGO_DB]

client = MongoClient(MONGO_URI)  # sync (PyMongo)
db = client[MONGO_DB]
whatsapp_message_collection = database["whatsapp_messages"]
patient_user_collection = database["patient_users"]
patient_appointments_collection = database["patient_appointments"]
doctor_user_collection = database["doctor_users"]


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


# ==================== CONVERSATION STATES ====================
# ==================== CONVERSATION STATES ====================
class ConversationState:
    MAIN_MENU = "main_menu"
    LAB_REPORTS = "lab_reports"
    LAB_REPORTS_UPLOAD = "lab_reports_upload"
    LAB_REPORTS_MORE = "lab_reports_more"
    APPOINTMENT = "appointment"
    APPOINTMENT_METHOD = "appointment_method"
    APPOINTMENT_HMS_ID = "appointment_hms_id"
    APPOINTMENT_VERIFY = "appointment_verify"
    APPOINTMENT_DOCTOR_TYPE = "appointment_doctor_type"
    APPOINTMENT_SELECT_SPECIALITY = "appointment_select_speciality"
    APPOINTMENT_SELECT_DOCTOR = "appointment_select_doctor"
    APPOINTMENT_SELECT_DATE = "appointment_select_date"
    APPOINTMENT_SELECT_TIME = "appointment_select_time"
    APPOINTMENT_CHIEF_COMPLAINT = "appointment_chief_complaint"
    APPOINTMENT_CONFIRM = "appointment_confirm"
    APPOINTMENT_VISIT_TYPE = "appointment_visit_type"
    # New states for rescheduling
    RESCHEDULE_CONFIRM = "reschedule_confirm"
    RESCHEDULE_CONFIRM_NO_APPOINTMENTS = (
        "reschedule_confirm_no_appointments"  # ADD THIS LINE
    )
    RESCHEDULE_SELECT_APPOINTMENT = "reschedule_select_appointment"
    RESCHEDULE_SELECT_DATE = "reschedule_select_date"
    RESCHEDULE_SELECT_TIME = "reschedule_select_time"
    RESCHEDULE_CONFIRM_CHANGES = "reschedule_confirm_changes"


# Store user sessions
user_sessions = {}
# Predefined list of specialities
SPECIALITIES = [
    "Cardiology",
    "General Medicine",
    "Pediatrics",
    "Orthopedics",
    "Gynecology",
]


# Function to sanitize the WhatsApp number (replace invalid characters like "+", ":")
def sanitize_filename(filename):
    # Replace invalid characters (e.g., ":", "/", "+") and other unsafe characters
    sanitized = (
        filename.replace(":", "_")
        .replace("/", "_")
        .replace("+", "_")
        .replace("?", "_")
        .replace("&", "_")
    )
    sanitized = re.sub(
        r"[^\w\s-]", "", sanitized
    )  # Remove all non-alphanumeric characters
    logger.debug(f"Sanitized filename: {sanitized}")
    return sanitized


# Function to save the media file from the URL with the correct file extension
async def save_media(media_url, from_number):
    try:
        # Twilio credentials for authentication
        TWILIO_ACCOUNT_SID = TWILIO_KEY  # Replace with your Twilio Account SID
        TWILIO_AUTH_TOKEN = TWILIO_AUTH_TOKEN  # Replace with your Twilio Auth Token

        # Extract the file name from the URL (last part of the URL)
        media_filename = media_url.split("/")[
            -1
        ]  # Extracts the last part after the last "/"

        # Log the attempt to download the media
        logger.info(f"Attempting to download media from {from_number}...")

        # Download the media file from the provided URL with authentication
        response = requests.get(
            media_url,
            auth=HTTPBasicAuth(
                TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
            ),  # Use Twilio credentials for authentication
            stream=True,
        )

        # Ensure the request was successful
        if response.status_code == 200:
            # Get the file extension from the Content-Type header
            content_type = response.headers.get(
                "Content-Type", "application/octet-stream"
            )
            if "pdf" in content_type:
                file_extension = ".pdf"
            elif "jpeg" in content_type or "jpg" in content_type:
                file_extension = ".jpg"
            elif "png" in content_type:
                file_extension = ".png"
            else:
                file_extension = ".bin"  # Default to .bin if the type is not recognized

            # Construct the file path directly in the uploads folder
            media_file_path = os.path.join(
                "/app/uploads", f"{media_filename}{file_extension}"
            )

            # Log the successful download
            logger.info(
                f"Successfully downloaded media from {from_number}. Saving file..."
            )

            # Save the file to the uploads folder (correct path)
            with open(media_file_path, "wb") as f:
                f.write(response.content)  # Write the entire file content to disk
            logger.info(f"Media file saved successfully: {media_file_path}")

            # Prepare the file metadata (if needed)
            saved_file = {
                "filename": f"{media_filename}{file_extension}",  # The original filename with extension
                "content_type": response.headers.get(
                    "Content-Type", "unknown"
                ),  # File type (e.g., application/pdf)
                "size": len(response.content),  # Size of the file in bytes
                "file_path": media_file_path,  # Full path where the file is saved
            }
            return saved_file
        else:
            # Log failure with status code
            logger.error(
                f"Failed to download media from {from_number}. Status code: {response.status_code}"
            )
            return None

    except Exception as e:
        # Log the exception error
        logger.error(f"Error downloading media from {from_number}: {e}")
        return None


# Webhook to handle incoming messages
# @router.post("/webhook")  # This should be your correct endpoint
# async def handle_incoming_message(request: Request):
#     # Log incoming request headers for debugging
#     headers = dict(request.headers)
#     logger.info(f"Received request headers: {headers}")

#     # Extract incoming message data
#     form = await request.form()
#     body = form.get("Body", "").strip()  # Text message from the patient
#     from_number = form.get("From")  # Patient's WhatsApp number
#     num_media = int(form.get("NumMedia", 0))  # Number of media files sent
#     resp = MessagingResponse()  # This is where the reply is generated

#     # Initialize the response data structure
#     message_data = {
#         "number": from_number if from_number else None,
#         "messages": []
#     }

#     media_files = []  # Initialize media_files to avoid UnboundLocalError

#     logger.info(f"Number of media files: {num_media}")

#     if num_media > 0:
#         for i in range(num_media):
#             media_url = form.get(f"MediaUrl{i}")
#             media_type = form.get(f"MediaContentType{i}")

#             logger.info(f"Received media: {media_url}, type: {media_type}")

#             # Save the media and get file info (await the asynchronous function)
#             file_info = await save_media(media_url, from_number)
#             if file_info:
#                 media_files.append(file_info)  # Add the file info to the list

#         message_data["messages"].append({
#             "message": body if body else None,
#             "date": datetime.utcnow() if body else None,
#             "files": media_files
#         })

#     else:
#         message_data["messages"].append({
#             "message": body if body else None,
#             "date": datetime.utcnow() if body else None,
#             "files": None
#         })

#     # Insert or update message data in the database
#     existing_message = whatsapp_message_collection.find_one({"number": from_number})

#     if existing_message:
#         whatsapp_message_collection.update_one(
#             {"_id": existing_message["_id"]},
#             {"$push": {"messages": {"message": body, "date": datetime.utcnow(), "files": media_files}}}
#         )
#     else:
#         whatsapp_message_collection.insert_one(message_data)

#     # Respond back to WhatsApp
#     resp.message("✅ Your message has been received. Our team will get back to you soon.")
#     return JSONResponse(content=str(resp))


async def book_appointment_api(appointment_data: Dict[str, Any]) -> Dict[str, Any]:
    """Call the appointment booking API endpoint"""
    try:
        # Extract doctor information
        doctor_info = appointment_data.get("doctor", {})

        # Get patient's sys_user_id from patient_info
        patient_info = appointment_data.get("patient_info", {})
        patient_sys_user_id = patient_info.get("sys_user_id", "")

        # If patient_info doesn't have sys_user_id, try to get it from the patient_user_collection
        if not patient_sys_user_id and "hms_id" in appointment_data:
            # Fetch patient from database to get their sys_user_id
            patient = patient_user_collection.find_one(
                {"hms_id": appointment_data["hms_id"]}
            )
            if patient:
                patient_sys_user_id = patient.get("sys_user_id", "")

        # Prepare the data exactly as your API expects
        api_payload = {
            "doctor_id": doctor_info.get("sys_user_id", ""),
            "sys_user_id": patient_sys_user_id,  # ← Corrected: Use patient's sys_user_id
            "date": appointment_data.get("date", ""),
            "scheduled_time": appointment_data.get("time", ""),
            "visit_type": appointment_data.get("visit_type", "New Visit"),
            "chief_complaint": appointment_data.get("chief_complaint", ""),
        }

        # Log the payload
        logger.info(
            f"📤 Calling appointment API with payload: {json.dumps(api_payload, indent=2)}"
        )

        # Make the API call to your existing endpoint
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://demo.doctorassist.ai/api/hms/users/doctors/take_appointment",
                json=api_payload,
                headers={"Content-Type": "application/json"},
            )

            # Log response
            logger.info(f"📥 API Response Status: {response.status_code}")

            if response.status_code == 200:
                result = response.json()
                logger.info(f"✅ Appointment booked successfully: {result}")
                return {
                    "success": True,
                    "appointment_id": result.get("appointment_id") or result.get("id"),
                    "appointment_number": result.get("appointment_number"),
                    "message": result.get("message", "Appointment booked successfully"),
                    "data": result,
                }
            else:
                error_msg = f"API Error: {response.status_code} - {response.text}"
                logger.error(f"❌ {error_msg}")
                return {
                    "success": False,
                    "error": error_msg,
                    "status_code": response.status_code,
                }

    except Exception as e:
        error_msg = f"Exception: {str(e)}"
        logger.error(f"❌ {error_msg}")
        return {"success": False, "error": error_msg}


# ==================== MESSAGE HANDLER ====================
async def handle_message_logic(
    from_number: str, body: str, num_media: int, media_files: list = None
) -> str:
    """
    Main logic handler for incoming WhatsApp messages
    Returns: Message to send back to user
    """
    # Remove 'whatsapp:' prefix if present for session key
    session_key = (
        from_number.replace("whatsapp:", "")
        if from_number.startswith("whatsapp:")
        else from_number
    )

    if session_key not in user_sessions:
        user_sessions[session_key] = {
            "state": ConversationState.MAIN_MENU,
            "data": {},
            "lab_reports": [],
            "appointment_details": {},
            "last_activity": datetime.now(),
        }

    session = user_sessions[session_key]
    session["last_activity"] = datetime.now()

    # Handle media uploads (lab reports)
    if num_media > 0 and media_files:
        logger.info(
            f"Handling media upload for {session_key}, state: {session['state']}"
        )
        return await handle_media_upload(session_key, session, media_files)

    # Get current state BEFORE processing input
    state = session["state"]

    # Preserve case for HMS ID input only
    if state == ConversationState.APPOINTMENT_HMS_ID:
        user_input = body.strip()
        logger.info(f"🔤 HMS ID input (preserved case): '{user_input}'")
    else:
        user_input = body.strip().lower()
        logger.info(f"📝 General input (lowercased): '{user_input}'")

    # Handle "hi", "hello", etc. as main menu (case-insensitive)
    if user_input.lower() in ["hi", "hello", "hey"]:
        session["state"] = ConversationState.MAIN_MENU
        return handle_main_menu("", session)

    # If empty message but not first interaction, show current state
    if not user_input:
        return get_state_prompt(session)

    logger.info(f"Processing input '{user_input}' for state: {state}")

    # Use if-elif chain for async/await handling
    if state == ConversationState.MAIN_MENU:
        return handle_main_menu(user_input.lower(), session)

    elif state == ConversationState.APPOINTMENT_METHOD:
        return handle_appointment_method(user_input.lower(), session)

    elif state == ConversationState.LAB_REPORTS_UPLOAD:
        return handle_lab_reports_upload(user_input.lower(), session)

    elif state == ConversationState.LAB_REPORTS_MORE:
        return handle_lab_reports_more(user_input.lower(), session)

    elif state == ConversationState.APPOINTMENT_HMS_ID:
        # This is an async function, need to await it
        return await handle_appointment_hms_id(user_input, session)

    elif state == ConversationState.APPOINTMENT_VERIFY:
        # Check if user wants to reschedule existing appointments
        is_reschedule = session.get("appointment_details", {}).get(
            "is_reschedule", False
        )

        if is_reschedule:
            # User specifically chose to reschedule
            return await check_and_handle_reschedule(session_key, session)
        else:
            # Regular booking flow - check for appointments and ask if they want to reschedule
            return await handle_appointment_verify(user_input.lower(), session)

    # Add new state for when no appointments are found during reschedule
    elif (
        state == ConversationState.RESCHEDULE_CONFIRM_NO_APPOINTMENTS
    ):  # ADD THIS BLOCK
        return await handle_reschedule_confirm_no_appointments(
            user_input.lower(), session
        )

    elif state == ConversationState.RESCHEDULE_CONFIRM:
        return await handle_reschedule_confirm(user_input.lower(), session)

    elif state == ConversationState.RESCHEDULE_SELECT_APPOINTMENT:
        return await handle_reschedule_select_appointment(user_input.lower(), session)

    elif state == ConversationState.RESCHEDULE_SELECT_DATE:
        return await handle_reschedule_select_date(user_input.lower(), session)

    elif state == ConversationState.RESCHEDULE_SELECT_TIME:
        return await handle_reschedule_select_time(user_input.lower(), session)

    elif state == ConversationState.RESCHEDULE_CONFIRM_CHANGES:
        return await handle_reschedule_confirm_changes(user_input.lower(), session)

    # Existing states...
    elif state == ConversationState.APPOINTMENT_DOCTOR_TYPE:
        return handle_appointment_doctor_type(user_input.lower(), session)

    elif state == ConversationState.APPOINTMENT_VISIT_TYPE:
        return handle_appointment_visit_type(user_input.lower(), session)

    elif state == ConversationState.APPOINTMENT_SELECT_SPECIALITY:
        return await handle_appointment_select_speciality(user_input.lower(), session)

    elif state == ConversationState.APPOINTMENT_SELECT_DOCTOR:
        return handle_appointment_select_doctor(user_input.lower(), session)

    elif state == ConversationState.APPOINTMENT_SELECT_DATE:
        return handle_appointment_select_date(user_input.lower(), session)

    elif state == ConversationState.APPOINTMENT_SELECT_TIME:
        return handle_appointment_select_time(user_input.lower(), session)

    elif state == ConversationState.APPOINTMENT_CHIEF_COMPLAINT:
        return handle_appointment_chief_complaint(user_input, session)

    elif state == ConversationState.APPOINTMENT_CONFIRM:
        # This is also an async function
        return await handle_appointment_confirm(user_input.lower(), session)

    # Default fallback
    return get_state_prompt(session)


def get_state_prompt(session: dict) -> str:
    """Get the appropriate prompt based on current state"""
    state = session["state"]

    if state == ConversationState.APPOINTMENT_SELECT_TIME:
        current_page = session.get("time_slot_page", 0)
        time_groups = session.get("time_groups", [])
        all_time_slots = session.get("all_time_slots", [])
        display_date = session.get("appointment_details", {}).get(
            "display_date", "Selected Date"
        )

        total_pages = len(time_groups)

        if time_groups and current_page < total_pages:
            # Get the current time slots display
            current_display = time_groups[current_page]

            # Calculate page numbers and options
            page_num = current_page + 1

            # Count how many time slots are on this page (max 6)
            start_index = current_page * 6
            slots_on_page = min(6, len(all_time_slots) - start_index)

            # Determine what options are available
            has_next_page = current_page < total_pages - 1
            has_previous_page = current_page > 0

            # Build options text
            options_text = "### Options:\n"
            options_text += "- Select time (1-6)\n"

            if has_next_page:
                # Option 7 for next page
                options_text += "- Type '7' for next slots\n"

            if has_previous_page:
                # Option 8 for previous page
                options_text += "- Type '8' for previous slots\n"

            options_text += "- Type 'back' to change date"

            # Format current time for display
            current_time = datetime.now().strftime("%I:%M %p").lstrip("0")

            # Build the complete message
            return (
                f"# Date Selected: {display_date}\n\n"
                f"## Select Time Slot\n\n"
                f"{current_display}\n\n"
                f"{options_text}\n\n"
                f"{current_time}"
            )

        return "Please select a time slot:"

    elif state == ConversationState.RESCHEDULE_SELECT_TIME:
        current_page = session.get("time_slot_page", 0)
        time_groups = session.get("time_groups", [])
        all_time_slots = session.get("all_time_slots", [])
        display_date = session.get("new_display_date", "Selected Date")

        total_pages = len(time_groups)

        if time_groups and current_page < total_pages:
            # Get the current time slots display
            current_display = time_groups[current_page]

            # Calculate page numbers and options
            page_num = current_page + 1

            # Count how many time slots are on this page (max 6)
            start_index = current_page * 6
            slots_on_page = min(6, len(all_time_slots) - start_index)

            # Determine what options are available
            has_next_page = current_page < total_pages - 1
            has_previous_page = current_page > 0

            # Build options text
            options_text = "### Options:\n"
            options_text += "- Select time (1-6)\n"

            if has_next_page:
                # Option 7 for next page
                options_text += "- Type '7' for next slots\n"

            if has_previous_page:
                # Option 8 for previous page
                options_text += "- Type '8' for previous slots\n"

            options_text += "- Type 'back' to change date"

            # Format current time for display
            current_time = datetime.now().strftime("%I:%M %p").lstrip("0")

            # Build the complete message
            return (
                f"# Date Selected: {display_date}\n\n"
                f"## Select New Time Slot\n\n"
                f"{current_display}\n\n"
                f"{options_text}\n\n"
                f"{current_time}"
            )

        return "Please select a time slot:"

    elif state == ConversationState.MAIN_MENU:
        return "🏥 *Main Menu*\n\n1. 📄 Upload Lab Reports\n2. 📅 Book/Reschedule Appointment\n\nReply with 1 or 2"

    elif state == ConversationState.APPOINTMENT_METHOD:
        return (
            "📅 *Appointment Services*\n\n"
            "1. 🗣️ Voice Call\n"
            "2. 💬 Chat - Book New Appointment\n"
            "3. 🔄 Chat - Reschedule Appointment\n\n"
            "Reply with 1, 2, or 3"
        )

    elif state == ConversationState.LAB_REPORTS_UPLOAD:
        return "Please upload your lab report file (image/PDF)."

    elif state == ConversationState.LAB_REPORTS_MORE:
        return "Do you want to upload more lab reports?\n\n1. Yes\n2. No"

    elif state == ConversationState.APPOINTMENT_HMS_ID:
        is_reschedule = session.get("appointment_details", {}).get(
            "is_reschedule", False
        )
        if is_reschedule:
            return "🔄 *Appointment Rescheduling*\n\nPlease enter your *HMS ID exactly as it appears*:\n(e.g., HMS-PAT-1004)\n\n_Note: HMS ID is case-sensitive_"
        else:
            return "💬 *Appointment Booking*\n\nPlease enter your *HMS ID exactly as it appears*:\n(e.g., HMS-PAT-1004)\n\n_Note: HMS ID is case-sensitive_"

    elif state == ConversationState.APPOINTMENT_VERIFY:
        return "Please choose:\n1. Previous Doctor\n2. New Doctor"

    elif state == ConversationState.APPOINTMENT_DOCTOR_TYPE:
        return "Would you like to see a new doctor?\n\n1. Yes\n2. No"

    elif state == ConversationState.APPOINTMENT_VISIT_TYPE:
        return "Is this visit a:\n\n1. Follow-up\n2. New Visit"

    elif state == ConversationState.APPOINTMENT_SELECT_SPECIALITY:
        specialities = session.get("available_specialities", SPECIALITIES)
        speciality_list = "\n".join(
            [f"{i+1}. {spec}" for i, spec in enumerate(specialities)]
        )
        return f"🏥 *Select Speciality*\n\n{speciality_list}\n\nPlease choose a speciality (1, 2, 3, etc.):"

    elif state == ConversationState.APPOINTMENT_SELECT_DOCTOR:
        doctors = session.get("available_doctors", [])
        doctor_list = "\n".join(
            [f"{i+1}. {doc.get('name', 'N/A')}" for i, doc in enumerate(doctors)]
        )
        return f"👨‍⚕️ *Select Doctor*\n\n{doctor_list}\n\nPlease select a doctor (1, 2, etc.):"

    elif state == ConversationState.APPOINTMENT_SELECT_DATE:
        return generate_date_selection_message()

    elif state == ConversationState.APPOINTMENT_CHIEF_COMPLAINT:
        return "📝 *Chief Complaint*\n\nPlease describe your main medical concern or symptoms (e.g., fever for 3 days, headache, etc.):"

    elif state == ConversationState.APPOINTMENT_CONFIRM:
        return (
            "Please confirm your appointment:\n\n1. ✅ Yes, Confirm\n2. ❌ No, Cancel"
        )

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
        return (
            "📋 *No Upcoming Appointments Found*\n\n"
            "You don't have any upcoming appointments to reschedule.\n\n"
            "Would you like to book a new appointment instead?\n\n"
            "1. ✅ Yes, book new appointment\n"
            "2. ❌ No, return to main menu"
        )

    elif state == ConversationState.RESCHEDULE_SELECT_APPOINTMENT:
        appointments = session.get("upcoming_appointments", [])
        message = "📋 *Select Appointment to Reschedule*\n\n"
        for i, appointment in enumerate(appointments, 1):
            message += f"{i}. {appointment.get('date', 'N/A')} at {appointment.get('scheduled_time', 'N/A')}\n"
        message += "\nPlease select the appointment number:"
        return message

    elif state == ConversationState.RESCHEDULE_SELECT_DATE:
        return generate_date_selection_message_reschedule()

    elif state == ConversationState.RESCHEDULE_CONFIRM_CHANGES:
        appointment = session.get("selected_appointment", {})
        return (
            f"📋 *Reschedule Confirmation*\n\n"
            f"Appointment ID: {appointment.get('appointment_id', 'N/A')}\n\n"
            f"Do you want to confirm this reschedule?\n\n"
            f"1. ✅ Yes, confirm reschedule\n"
            f"2. ❌ No, cancel"
        )

    return "❌ I didn't understand that. Please try again."


async def handle_media_upload(
    session_key: str, session: dict, media_files: list
) -> str:
    """Handle media uploads (lab reports)"""
    if session["state"] == ConversationState.LAB_REPORTS_UPLOAD:
        # Track uploaded files in session
        for file_info in media_files:
            session["lab_reports"].append(
                {
                    "filename": file_info.get("filename"),
                    "uploaded_at": datetime.utcnow().isoformat(),
                    "file_path": file_info.get("file_path"),
                    "count": len(session["lab_reports"]) + 1,
                }
            )

        session["state"] = ConversationState.LAB_REPORTS_MORE
        report_count = len(session["lab_reports"])

        return f"✅ Report {report_count} uploaded successfully!\n\nDo you want to upload more lab reports?\n\n1. Yes\n2. No"

    return "Please select an option first before uploading."


def handle_main_menu(user_input: str, session: dict) -> str:
    """Handle main menu selection"""
    logger.info(f"Handling main menu input: {user_input}")

    if user_input == "1":  # Upload Lab Reports
        session["state"] = ConversationState.LAB_REPORTS_UPLOAD
        session["lab_reports"] = []
        session["data"] = {"flow": "lab_reports"}
        return "📄 *Lab Reports Section*\n\nPlease upload your lab reports one by one. After each upload, I'll ask if you have more.\n\nSend your first lab report now (image/PDF)."

    elif user_input == "2":  # Book/Reschedule Appointment
        # Go to appointment method selection
        session["state"] = ConversationState.APPOINTMENT_METHOD
        session["appointment_details"] = {}
        session["data"] = {"flow": "appointment"}
        return (
            "📅 *Appointment Services*\n\n"
            "*Please choose:*\n\n"
            "1. 🗣️ *Voice Call* - Talk to our voice agent\n"
            "2. 💬 *Chat* - Book new appointment\n"
            "3. 🔄 *Chat* - Reschedule existing appointment\n\n"
            "_Reply with 1, 2, or 3_"
        )
    else:
        # Show main menu
        return (
            "🏥 *Welcome to Hospital Services*\n\n"
            "*Please choose an option:*\n\n"
            "1. 📄 Upload Lab Reports\n"
            "2. 📅 Book/Reschedule Appointment\n\n"
            "_Reply with 1 or 2_"
        )


def handle_lab_reports_upload(user_input: str, session: dict) -> str:
    """Handle after lab report upload"""
    return "Please upload your lab report file (image/PDF)."


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

        return (
            f"✅ Successfully uploaded {report_count} lab report(s). "
            f"Our team will review them shortly.\n\n"
            f"🏥 *Main Menu*\n\n"
            f"1. 📄 Upload Lab Reports\n"
            f"2. 📅 Book Appointment\n\n"
            f"Reply with 1 or 2"
        )

    return "Please choose:\n1. Yes\n2. No"


def handle_appointment_menu(user_input: str, session: dict) -> str:
    """Handle appointment section start"""
    session["state"] = ConversationState.APPOINTMENT_HMS_ID
    return "Please enter your HMS ID (e.g., HMS0001):"


async def handle_appointment_hms_id(user_input: str, session: dict) -> str:
    """Handle HMS ID input - ASYNC version"""
    hms_id = user_input.strip()

    logger.info(f"📥 HMS ID received: '{hms_id}'")

    if not hms_id:
        return "❌ *Please enter your HMS ID:*"

    session["appointment_details"]["hms_id"] = hms_id

    # Check if this is for rescheduling
    is_reschedule = session["appointment_details"].get("is_reschedule", False)

    if is_reschedule:
        # Check for upcoming appointments
        upcoming_appointments = await get_upcoming_appointments(hms_id)

        if not upcoming_appointments:
            # Set state to handle no appointments case
            session["state"] = ConversationState.RESCHEDULE_CONFIRM_NO_APPOINTMENTS
            session["upcoming_appointments"] = []  # Empty list

            return (
                "📋 *No Upcoming Appointments Found*\n\n"
                "You don't have any upcoming appointments to reschedule.\n\n"
                "Would you like to book a new appointment instead?\n\n"
                "1. ✅ Yes, book new appointment\n"
                "2. ❌ No, return to main menu"
            )

        # Store appointments in session
        session["upcoming_appointments"] = upcoming_appointments
        session["state"] = ConversationState.RESCHEDULE_CONFIRM

        # Build appointment list
        message = "📋 *Your Upcoming Appointments*\n\n"
        for i, appointment in enumerate(upcoming_appointments, 1):
            message += (
                f"{i}. *Appointment ID:* {appointment.get('appointment_id', 'N/A')}\n"
            )
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

        # Search patient - async call
        patient = await get_patient_by_hms_id(hms_id)

        if patient:
            logger.info(f"✅ Patient found: {patient.get('name')}")

            session["appointment_details"]["patient_info"] = patient

            # Get latest appointment - async call
            latest_appointment = await get_latest_appointment(patient["patient_id"])

            if latest_appointment:
                doctor_sys_user_id = latest_appointment.get("doctor_id")
                logger.info(
                    f"🔍 Looking for doctor with sys_user_id: '{doctor_sys_user_id}'"
                )

                previous_doctor = None
                if doctor_sys_user_id:
                    # Search by sys_user_id - async call
                    previous_doctor = await get_doctor_by_id(doctor_sys_user_id)

                session["appointment_details"]["previous_doctor"] = previous_doctor
                session["appointment_details"][
                    "latest_appointment"
                ] = latest_appointment
                session["appointment_details"][
                    "doctor_sys_user_id"
                ] = doctor_sys_user_id

            # Build verification message
            verification_msg = f"🔍 *HMS ID:* {hms_id}\n\n"
            verification_msg += "✅ *Patient Verified!*\n\n"
            verification_msg += f"👤 *Name:* {patient.get('name', 'N/A')}\n"
            verification_msg += f"📅 *DOB:* {patient.get('date_of_birth', 'N/A')}\n"
            verification_msg += f"⚧️ *Gender:* {patient.get('gender', 'N/A')}\n"
            verification_msg += (
                f"🩸 *Blood Group:* {patient.get('blood_group', 'N/A')}\n"
            )

            # Add previous appointment info
            if latest_appointment:
                verification_msg += f"\n📋 *Last Visit:*\n"
                verification_msg += (
                    f"   • Date: {latest_appointment.get('date', 'N/A')}\n"
                )

                if previous_doctor:
                    verification_msg += (
                        f"   • Doctor: {previous_doctor.get('name', 'N/A')}\n"
                    )
                    verification_msg += f"   • Specialization: {previous_doctor.get('specialization', 'N/A')}\n"
                    verification_msg += f"   • Qualifications: {previous_doctor.get('qualifications', 'N/A')}\n"
                else:
                    verification_msg += f"   • Doctor: Dr. Thomas (General Physician)\n"

                verification_msg += (
                    f"   • Reason: {latest_appointment.get('visit_type', 'N/A')}\n"
                )
                verification_msg += (
                    f"   • Time: {latest_appointment.get('scheduled_time', 'N/A')}\n"
                )

            verification_msg += "\n*Choose doctor:*\n\n"
            verification_msg += "1. 👨‍⚕️ Previous Doctor\n"
            verification_msg += "2. 🆕 New Doctor"

            return verification_msg
        else:
            session["appointment_details"]["is_new_patient"] = True

            return (
                f"🔍 *HMS ID: {hms_id}*\n\n"
                f"❌ *Not found in our records.*\n\n"
                f"*Please check:*\n"
                f"• HMS ID format (HMS-PAT-XXXX)\n"
                f"• Case doesn't matter\n\n"
                f"*Options:*\n\n"
                f"1. 🔄 Try different HMS ID\n"
                f"2. ❌ Cancel"
            )


async def handle_appointment_verify(user_input: str, session: dict) -> str:
    """Handle verification response - ASYNC version"""

    # Handle re-entry option (for not found patients)
    if "is_new_patient" in session["appointment_details"]:
        if user_input == "1":  # Re-enter HMS ID
            session["state"] = ConversationState.APPOINTMENT_HMS_ID
            session["appointment_details"] = {"is_reschedule": False}
            return "Please re-enter your HMS ID exactly as it appears:"
        elif user_input == "2":  # Cancel
            return handle_cancel_appointment(session)

    # Check if user has upcoming appointments first
    hms_id = session.get("appointment_details", {}).get("hms_id")
    if hms_id:
        upcoming_appointments = await get_upcoming_appointments(hms_id)
        if upcoming_appointments:
            # Store appointments and ask if they want to reschedule
            session["upcoming_appointments"] = upcoming_appointments
            session["state"] = ConversationState.RESCHEDULE_CONFIRM

            # Build message
            message = "📋 *You have upcoming appointments!*\n\n"
            for i, appointment in enumerate(upcoming_appointments[:3], 1):
                message += f"{i}. {appointment.get('date', 'N/A')} at {appointment.get('scheduled_time', 'N/A')}\n"
                message += f"   Doctor: {appointment.get('doctor_name', 'N/A')}\n\n"

            message += (
                "Would you like to reschedule an appointment or book a new one?\n\n"
            )
            message += "1. 🔄 Reschedule existing appointment\n"
            message += "2. 📅 Book new appointment"

            return message

    # Original logic for existing patients (no upcoming appointments)
    if user_input == "1":  # Previous Doctor
        previous_doctor = session["appointment_details"].get("previous_doctor")

        if previous_doctor:
            # Store doctor info
            session["appointment_details"]["doctor"] = {
                "doctor_id": previous_doctor.get("doctor_id"),
                "sys_user_id": previous_doctor.get("sys_user_id"),
                "name": previous_doctor.get("name"),
                "specialization": previous_doctor.get("specialization", ""),
                "qualifications": previous_doctor.get("qualifications", ""),
            }
            session["state"] = ConversationState.APPOINTMENT_VISIT_TYPE

            # Get appointment context for message
            latest_appointment = session["appointment_details"].get(
                "latest_appointment", {}
            )
            last_visit_date = latest_appointment.get("date", "N/A")
            last_visit_type = latest_appointment.get("visit_type", "N/A")

            return (
                f"👨‍⚕️ *Previous Doctor Selected*\n\n"
                f"   • Name: {previous_doctor.get('name', 'N/A')}\n"
                f"   • Specialization: {previous_doctor.get('specialization', 'N/A')}\n"
                f"   • Qualifications: {previous_doctor.get('qualifications', 'N/A')}\n\n"
                f"Last visit: {last_visit_date} ({last_visit_type})\n\n"
                f"*Is this visit a:*\n\n"
                f"1. 🔄 Follow-up\n"
                f"2. 🆕 New Visit"
            )
        else:
            # Previous doctor not found in database
            session["state"] = ConversationState.APPOINTMENT_DOCTOR_TYPE
            return (
                "❌ *Previous doctor information not available*\n\n"
                "Would you like to see a new doctor?\n\n"
                "1. ✅ Yes\n"
                "2. ❌ No"
            )

    elif user_input == "2":  # New Doctor
        # Use predefined specialities
        session["state"] = ConversationState.APPOINTMENT_SELECT_SPECIALITY
        session["available_specialities"] = SPECIALITIES

        # Format options for display using list comprehension
        speciality_list = "\n".join(
            [f"{i+1}. {spec}" for i, spec in enumerate(SPECIALITIES)]
        )

        return (
            f"🏥 *Select Speciality*\n\n"
            f"{speciality_list}\n\n"
            f"*Please choose a speciality (1, 2, 3, etc.):*"
        )

    # Default response if input not recognized
    return "*Please choose:*\n\n" "1. 👨‍⚕️ Previous Doctor\n" "2. 🆕 New Doctor"


def handle_appointment_doctor_type(user_input: str, session: dict) -> str:
    """Handle doctor type selection"""
    if user_input == "1":  # Yes, see new doctor
        session["state"] = ConversationState.APPOINTMENT_SELECT_SPECIALITY
        session["available_specialities"] = SPECIALITIES

        speciality_list = "\n".join(
            [f"{i+1}. {spec}" for i, spec in enumerate(SPECIALITIES)]
        )

        return f"🏥 *Select Speciality*\n\n{speciality_list}\n\nPlease choose a speciality (1, 2, 3, etc.):"
    else:  # No
        return handle_cancel_appointment(session)


def handle_appointment_visit_type(user_input: str, session: dict) -> str:
    """Handle visit type selection for both previous and new doctors"""
    if user_input == "1":  # Follow-up
        session["appointment_details"]["visit_type"] = "follow-up"
    elif user_input == "2":  # New Visit
        session["appointment_details"]["visit_type"] = "new visit"
    else:
        return "Please choose:\n1. Follow-up\n2. New Visit"

    # After selecting visit type, go to date selection
    session["state"] = ConversationState.APPOINTMENT_SELECT_DATE
    return generate_date_selection_message()


async def handle_appointment_select_speciality(user_input: str, session: dict) -> str:
    """Handle speciality selection - ASYNC version"""
    try:
        choice = int(user_input) - 1

        # Get specialities from session
        specialities = session.get("available_specialities", SPECIALITIES)

        if 0 <= choice < len(specialities):
            selected_speciality = specialities[choice]
            session["appointment_details"]["speciality"] = selected_speciality
            session["state"] = ConversationState.APPOINTMENT_SELECT_DOCTOR

            # Get doctors from database - async call
            hms_id = session["appointment_details"].get("hms_id")
            doctors = await get_doctors_by_speciality(selected_speciality, hms_id)

            if doctors:
                # Store doctors in session
                session["available_doctors"] = doctors

                # Create doctor list for display
                doctor_options = [
                    f"{i+1}. {doc.get('name', 'N/A')}"
                    + (
                        f" ({doc.get('qualifications', '')})"
                        if doc.get("qualifications")
                        else ""
                    )
                    for i, doc in enumerate(doctors)
                ]

                doctor_list = "\n".join(doctor_options)

                return (
                    f"👨‍⚕️ *Doctors in {selected_speciality}*\n\n"
                    f"{doctor_list}\n\n"
                    f"Please select a doctor (1, 2, etc.):"
                )
            else:
                return (
                    f"❌ No doctors available in {selected_speciality}.\n\n"
                    f"Please choose another speciality or contact the hospital."
                )
        else:
            return "❌ Invalid choice. Please select a valid number."
    except ValueError:
        return "❌ Please enter a valid number."


def handle_appointment_select_doctor(user_input: str, session: dict) -> str:
    """Handle doctor selection"""
    try:
        choice = int(user_input) - 1
        doctors = session.get("available_doctors", [])

        if 0 <= choice < len(doctors):
            selected_doctor = doctors[choice]

            # Store doctor info in appointment details
            session["appointment_details"]["doctor"] = {
                "doctor_id": selected_doctor.get("doctor_id"),
                "sys_user_id": selected_doctor.get("sys_user_id"),
                "name": selected_doctor.get("name"),
                "specialization": selected_doctor.get("specialization", ""),
                "qualifications": selected_doctor.get("qualifications", ""),
            }

            # For NEW DOCTOR, ask if it's follow-up or new visit
            if (
                "previous_doctor" not in session["appointment_details"]
                or session["appointment_details"].get("previous_doctor") is None
            ):
                session["state"] = ConversationState.APPOINTMENT_VISIT_TYPE
                return (
                    f"👨‍⚕️ *Doctor Selected*\n\n"
                    f"   • Name: {selected_doctor.get('name', 'N/A')}\n"
                    f"   • Specialization: {selected_doctor.get('specialization', 'N/A')}\n"
                    f"   • Qualifications: {selected_doctor.get('qualifications', 'N/A')}\n\n"
                    f"*Is this visit a:*\n\n"
                    f"1. 🔄 Follow-up\n"
                    f"2. 🆕 New Visit"
                )
            else:
                # For previous doctor, we already asked visit type, so go to date selection
                session["state"] = ConversationState.APPOINTMENT_SELECT_DATE
                return generate_date_selection_message()

        else:
            return "❌ Invalid choice. Please select a valid number."
    except ValueError:
        return "❌ Please enter a valid number."


def handle_appointment_select_time(user_input: str, session: dict) -> str:
    """Handle time slot selection with proper pagination"""
    user_input = user_input.lower().strip()

    current_page = session.get("time_slot_page", 0)
    time_groups = session.get("time_groups", [])
    all_time_slots = session.get("all_time_slots", [])
    display_date = session.get("appointment_details", {}).get(
        "display_date", "Selected Date"
    )

    total_pages = len(time_groups)

    # If there are no time groups, something went wrong
    if not time_groups:
        return "❌ No time slots available. Please go back and select a different date."

    # Handle "back" command to change date
    if user_input == "back" or user_input == "change date":
        session["state"] = ConversationState.APPOINTMENT_SELECT_DATE
        session.pop("time_slot_page", None)
        session.pop("time_groups", None)
        session.pop("all_time_slots", None)
        return generate_date_selection_message()

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
                return (
                    "✅ *Time Selected:* " + selected_time + "\n\n"
                    "📝 *Chief Complaint*\n\n"
                    "Please describe your main medical concern or symptoms (e.g., fever for 3 days, headache, etc.):"
                )
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
            return (
                "❌ No more time slots available. Please select from the options above."
            )

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


async def handle_appointment_confirm(user_input: str, session: dict) -> str:
    """Handle appointment confirmation with API integration"""
    if user_input == "1":  # Confirm

        # FIRST: Try to book via API
        details = session["appointment_details"]
        logger.info(
            f"📋 Attempting to book appointment via API for HMS ID: {details.get('hms_id')}"
        )

        api_result = await book_appointment_api(details)

        # Generate appointment ID
        appointment_id = f"APT-WHATSAPP-{datetime.now().strftime('%Y%m%d%H%M%S')}"

        # Build success message
        success_msg = ""

        if api_result.get("success"):
            success_msg += "✅ *Appointment Confirmed!*\n\n"
            success_msg += f"📋 *Appointment ID:* {api_result.get('appointment_id', appointment_id)}\n\n"
        else:
            success_msg += "⚠️ *Appointment Pending*\n\n"
            success_msg += f"📋 *Reference ID:* {appointment_id}\n\n"
            success_msg += "*Note:* System encountered an issue. Hospital will contact you to confirm.\n\n"

        # Patient info
        if "patient_info" in details:
            patient = details["patient_info"]
            success_msg += f"👤 *Patient:* {patient.get('name', 'N/A')}\n"

        success_msg += f"🆔 *HMS ID:* {details.get('hms_id', 'N/A')}\n"

        # Doctor info
        doctor = details.get("doctor", {})
        success_msg += f"👨‍⚕️ *Doctor:* {doctor.get('name', 'N/A')}\n"
        success_msg += f"🏥 *Specialization:* {doctor.get('specialization', details.get('speciality', 'N/A'))}\n"

        # Appointment details
        success_msg += (
            f"📅 *Date:* {details.get('display_date', details.get('date', 'N/A'))}\n"
        )
        success_msg += f"⏰ *Time:* {details.get('time', 'N/A')}\n"
        success_msg += (
            f"📝 *Visit Type:* {details.get('visit_type', 'New Visit').title()}\n"
        )

        # Add Chief Complaint if exists
        if "chief_complaint" in details:
            complaint = details["chief_complaint"]
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

        # Reset session
        session["state"] = ConversationState.MAIN_MENU
        session["appointment_details"] = {}
        session["available_specialities"] = []
        session["available_doctors"] = []
        session.pop("time_slot_page", None)
        session.pop("all_time_slots", None)

        return success_msg

    elif user_input == "2":  # Cancel
        return handle_cancel_appointment(session)

    return "Please choose:\n1. ✅ Yes, Book Appointment\n2. ❌ No, Cancel"


def handle_cancel_appointment(session: dict) -> str:
    """Handle appointment cancellation"""
    session["state"] = ConversationState.MAIN_MENU
    session["appointment_details"] = {}
    session["data"] = {}

    return (
        "❌ Appointment cancelled.\n\n"
        "🏥 *Main Menu*\n\n"
        "1. 📄 Upload Lab Reports\n"
        "2. 📅 Book Appointment\n\n"
        "Reply with 1 or 2"
    )


@router.post("/webhook")
async def handle_incoming_message(request: Request):
    # Log incoming request headers for debugging
    headers = dict(request.headers)
    logger.info(f"Received request headers: {headers}")

    # Extract incoming message data
    form = await request.form()
    body = form.get("Body", "").strip()  # Text message from the patient
    from_number = form.get("From")  # Patient's WhatsApp number
    num_media = int(form.get("NumMedia", 0))  # Number of media files sent

    logger.info(f"Received message from {from_number}: {body}")
    logger.info(f"Number of media files: {num_media}")

    # Format the phone number for WhatsApp
    formatted_recipient_number = f"whatsapp:{from_number}"

    # Remove 'whatsapp:' prefix for session key
    session_key = (
        from_number.replace("whatsapp:", "")
        if from_number.startswith("whatsapp:")
        else from_number
    )

    # Initialize media_files list
    media_files = []

    # Handle media files if present
    if num_media > 0:
        logger.info("Processing media files...")
        for i in range(num_media):
            media_url = form.get(f"MediaUrl{i}")
            media_type = form.get(f"MediaContentType{i}")

            logger.info(f"Received media: {media_url}, type: {media_type}")

            # Save the media using your existing save_media function
            file_info = await save_media(media_url, from_number)
            if file_info:
                media_files.append(file_info)

    # ================ HANDLE FIRST MESSAGE ================
    # Check if this is first interaction
    session_key_clean = (
        from_number.replace("whatsapp:", "")
        if from_number.startswith("whatsapp:")
        else from_number
    )

    if session_key_clean not in user_sessions:
        # First time user, send welcome message
        # Find this in your webhook endpoint and update:
        welcome_msg = (
            "🏥 *Welcome to Hospital Services*\n\n"
            "I'm your healthcare assistant. I can help you with:\n\n"
            "1. 📄 Upload Lab Reports\n"
            "2. 📅 Book Appointment (via Voice or Chat)\n\n"
            "*Reply with 1 or 2*"
        )
        await send_whatsapp_message(welcome_msg, formatted_recipient_number)

        # Initialize session
        user_sessions[session_key_clean] = {
            "state": ConversationState.MAIN_MENU,
            "data": {},
            "lab_reports": [],
            "appointment_details": {},
            "last_activity": datetime.now(),
        }

        # Save to database
        await save_to_database(from_number, body, media_files)

        resp = MessagingResponse()
        return JSONResponse(content=str(resp))

    # ================ USE THE MESSAGE HANDLER LOGIC ================
    try:
        # Get response from message handler
        response_message = await handle_message_logic(
            from_number=from_number,
            body=body,
            num_media=num_media,
            media_files=media_files,
        )

        # Send the response back to user
        await send_whatsapp_message(response_message, formatted_recipient_number)

    except Exception as e:
        logger.error(f"Error in message handler: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")

        # Send error message to user
        error_msg = "❌ Sorry, there was an error processing your request. Please try again.\n\n"
        error_msg += "🏥 *Main Menu*\n\n1. 📄 Upload Lab Reports\n2. 📅 Book Appointment\n\nReply with 1 or 2"
        await send_whatsapp_message(error_msg, formatted_recipient_number)

    # ================ DATABASE STORAGE ================
    try:
        # Prepare message data for database
        message_data = {
            "number": from_number,
            "messages": [
                {
                    "message": body if body else None,
                    "date": datetime.utcnow(),
                    "files": media_files,
                }
            ],
        }

        # Insert or update message data in the database
        existing_message = whatsapp_message_collection.find_one({"number": from_number})

        if existing_message:
            whatsapp_message_collection.update_one(
                {"_id": existing_message["_id"]},
                {
                    "$push": {
                        "messages": {
                            "message": body,
                            "date": datetime.utcnow(),
                            "files": media_files,
                        }
                    }
                },
            )
        else:
            whatsapp_message_collection.insert_one(message_data)

    except Exception as e:
        logger.error(f"Error saving to database: {str(e)}")

    # Return empty TwiML response since we're sending messages asynchronously
    resp = MessagingResponse()
    return JSONResponse(content=str(resp))


async def send_whatsapp_message(content_variables: str, recipient_number: str):
    try:
        # Twilio credentials
        client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

        # Remove the 'whatsapp:' prefix if it exists in the recipient_number
        if recipient_number.startswith("whatsapp:"):
            recipient_number = recipient_number[len("whatsapp:") :]

        # Add 'whatsapp:' prefix here only once
        formatted_recipient_number = f"{recipient_number}"

        # Log the formatted recipient number to ensure it's correct
        logger.info(f"Sending message to: {formatted_recipient_number}")

        # Send the WhatsApp message
        message = client.messages.create(
            from_=f"whatsapp:{TWILIO_WHATSAPP_NUMBER}",  # Twilio WhatsApp number with 'whatsapp:' prefix
            body=content_variables,  # The message content
            to=formatted_recipient_number,  # Recipient's WhatsApp number
        )

        logger.info(f"Message sent to {recipient_number} with SID: {message.sid}")
        return {"status": "success", "sid": message.sid}

    except Exception as e:
        logger.error(f"Error sending WhatsApp message: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error sending WhatsApp message: {str(e)}"
        )


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


async def save_to_database(from_number: str, body: str, media_files: list):
    """Helper function to save messages to database - ASYNC version"""
    try:
        # Prepare message data for database
        message_data = {
            "number": from_number,
            "messages": [
                {
                    "message": body if body else None,
                    "date": datetime.utcnow(),
                    "files": media_files,
                }
            ],
        }

        # Insert or update message data in the database
        existing_message = await whatsapp_message_collection.find_one(
            {"number": from_number}
        )

        if existing_message:
            await whatsapp_message_collection.update_one(
                {"_id": existing_message["_id"]},
                {
                    "$push": {
                        "messages": {
                            "message": body,
                            "date": datetime.utcnow(),
                            "files": media_files,
                        }
                    }
                },
            )
        else:
            await whatsapp_message_collection.insert_one(message_data)

    except Exception as e:
        logger.error(f"Error saving to database: {str(e)}")


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


async def get_patient_by_hms_id(hms_id: str):
    """ASYNC version - Search patient by HMS ID"""
    try:
        search_id = hms_id.strip()

        logger.info(f"🔍 Database search for: '{search_id}'")

        # SINGLE OPTIMIZED QUERY with $or condition
        patient = await patient_user_collection.find_one(
            {
                "$or": [
                    {"hms_id": search_id},
                    {"hms_id": search_id.upper()},
                    {
                        "hms_id": {
                            "$regex": f"^{re.escape(search_id)}$",
                            "$options": "i",
                        }
                    },
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
            },
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


async def get_latest_appointment(patient_id: str):
    """ASYNC - Get latest appointment"""
    try:
        logger.info(f"🔍 Looking for appointments for patient: '{patient_id}'")

        # Use aggregation pipeline for sorting in database
        pipeline = [
            {"$match": {"patient_id": patient_id}},
            {"$unwind": "$appointments"},
            {"$sort": {"appointments.date": -1}},
            {"$limit": 1},
            {
                "$project": {
                    "doctor_id": "$appointments.doctor_id",
                    "date": "$appointments.date",
                    "scheduled_time": "$appointments.scheduled_time",
                    "visit_type": "$appointments.visit_type",
                }
            },
        ]

        cursor = patient_appointments_collection.aggregate(pipeline)
        result = await cursor.to_list(length=1)

        if result:
            latest = result[0]
            doctor_sys_user_id = latest.get("doctor_id")
            logger.info(f"📋 Latest appointment found")
            logger.info(f"   • Date: {latest.get('date')}")
            logger.info(f"   • Doctor (sys_user_id): {doctor_sys_user_id}")
            logger.info(f"   • Visit Type: {latest.get('visit_type')}")
            return latest

        logger.info(f"❌ No appointments found")
        return None
    except Exception as e:
        logger.error(f"❌ Error: {e}")
        return None


async def get_doctor_by_id(doctor_sys_user_id: str):
    """ASYNC - Get doctor by sys_user_id"""
    try:
        logger.info(f"🔍 Looking up doctor by sys_user_id: '{doctor_sys_user_id}'")

        # Search by sys_user_id
        doctor = await doctor_user_collection.find_one(
            {"sys_user_id": doctor_sys_user_id}
        )

        if doctor:
            logger.info(f"✅ Doctor found: {doctor.get('name')}")
            doctor["_id"] = str(doctor["_id"])
            return doctor
        else:
            logger.warning(
                f"⚠️ No doctor found with sys_user_id: '{doctor_sys_user_id}'"
            )

            # Fallback: Try doctor_id field
            doctor = await doctor_user_collection.find_one(
                {"doctor_id": doctor_sys_user_id}
            )
            if doctor:
                logger.info(f"✅ Found by doctor_id fallback: {doctor.get('name')}")
                doctor["_id"] = str(doctor["_id"])
                return doctor

            return None
    except Exception as e:
        logger.error(f"❌ Error getting doctor: {e}")
        return None


async def get_doctors_by_speciality(speciality: str, hms_id: str = None):
    """ASYNC - Get all doctors by speciality"""
    try:
        # Build query
        query = {
            "specialization": {"$regex": f"^{re.escape(speciality)}$", "$options": "i"}
        }

        # Add hospital_id filter
        if hms_id:
            hospital_id = await get_hospital_id_from_patient(hms_id)
            if hospital_id:
                query["hospital_id"] = hospital_id
                logger.info(f"🔍 Filtering doctors by hospital_id: {hospital_id}")

        # Async query
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
            },
        ).limit(10)

        doctors = await cursor.to_list(length=10)

        # Convert ObjectId to string
        for doctor in doctors:
            doctor["_id"] = str(doctor["_id"])

        logger.info(f"Found {len(doctors)} doctors for speciality '{speciality}'")
        return doctors
    except Exception as e:
        logger.error(f"Error getting doctors by speciality: {str(e)}")
        return []


async def get_hospital_id_from_patient(hms_id: str):
    """ASYNC - Get hospital_id from patient record"""
    try:
        patient = await get_patient_by_hms_id(hms_id)
        if patient and patient.get("hospital_id"):
            return patient.get("hospital_id")
        return None
    except Exception as e:
        logger.error(f"Error getting hospital_id from patient: {e}")
        return None


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
        "availability": [
            "09:00 AM",
            "11:00 AM",
            "02:00 PM",
            "04:00 PM",
        ],  # Default times
    }


def generate_date_selection_message():
    """Generate message for date selection (next 7 days)"""
    today = datetime.now()

    # Single list comprehension for all date options
    date_options = [
        f"{i+1}. {'Today' if i == 0 else 'Tomorrow' if i == 1 else (today + timedelta(days=i)).strftime('%A')} - {(today + timedelta(days=i)).strftime('%d %b %Y')}"
        for i in range(7)
    ]

    date_list = "\n".join(date_options)

    return (
        f"📅 *Select Appointment Date*\n\n"
        f"{date_list}\n\n"
        f"Please select a date (1, 2, 3, etc.):"
    )


def generate_time_slots():
    """Generate time slots from 12:00 AM to 11:30 PM in 30-minute intervals"""
    time_slots = []

    # Generate ALL time slots for 24 hours (12:00 AM to 11:30 PM)
    for hour in range(24):  # 0 to 23 hours
        for minute in [0, 30]:
            # Format the time
            if hour == 0:
                time_str = f"12:{minute:02d} AM"
            elif hour < 12:
                time_str = f"{hour}:{minute:02d} AM"
            elif hour == 12:
                time_str = f"12:{minute:02d} PM"
            else:
                time_str = f"{hour-12}:{minute:02d} PM"

            time_slots.append(time_str)

    # Split into groups of 6 for WhatsApp display
    grouped_times = []
    for i in range(0, len(time_slots), 6):
        group = time_slots[i : i + 6]

        # Number each slot in the group from 1-6
        formatted_group = []
        for j, time_slot in enumerate(group, 1):
            formatted_group.append(f"{j}. {time_slot}")

        # Build the group text
        group_text = "\n".join(formatted_group)

        # Check if there are more slots AFTER this group
        has_more_slots = i + 6 < len(time_slots)

        # Check if there are slots BEFORE this group
        has_previous_slots = i > 0

        # Add "more" option ONLY if there are more slots
        if has_more_slots:
            # The "more" option is always slot count + 1
            more_option_num = len(group) + 1
            group_text += f"\n{more_option_num}. More slots"

        # Add "back" option ONLY if there are previous slots
        if has_previous_slots:
            # The "back" option is slot count + 2 if "more" exists, otherwise slot count + 1
            back_option_num = len(group) + (2 if has_more_slots else 1)
            group_text += f"\n{back_option_num}. Previous slots"

        grouped_times.append(group_text)

    return grouped_times, time_slots


def build_appointment_confirmation(session: dict) -> str:
    """Build appointment confirmation message"""
    details = session["appointment_details"]

    confirmation = f"📋 *Appointment Summary*\n\n"

    # Patient information
    if "patient_info" in details:
        patient = details["patient_info"]
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

    if doctor.get("qualifications"):
        confirmation += f"   • Qualifications: {doctor.get('qualifications')}\n"

    # Appointment details
    confirmation += f"\n📅 *Appointment Details*\n"
    confirmation += (
        f"   • Date: {details.get('display_date', details.get('date', 'N/A'))}\n"
    )
    confirmation += f"   • Time: {details.get('time', 'N/A')}\n"
    confirmation += (
        f"   • Visit Type: {details.get('visit_type', 'New Visit').title()}\n"
    )

    # Add Chief Complaint if exists
    if "chief_complaint" in details:
        # Truncate if too long
        complaint = details["chief_complaint"]
        if len(complaint) > 100:
            complaint = complaint[:97] + "..."
        confirmation += f"   • Chief Complaint: {complaint}\n"
    confirmation += f"\n"

    confirmation += "*Please confirm:*\n\n"
    confirmation += "1. ✅ Yes, Book Appointment\n"
    confirmation += "2. ❌ No, Cancel"

    return confirmation


def generate_date_selection_message():
    """Generate message for date selection (next 7 days)"""
    today = datetime.now()

    # Single list comprehension for all date options
    date_options = [
        f"{i+1}. {'Today' if i == 0 else 'Tomorrow' if i == 1 else (today + timedelta(days=i)).strftime('%A')} - {(today + timedelta(days=i)).strftime('%d %b %Y')}"
        for i in range(7)
    ]

    date_list = "\n".join(date_options)

    return (
        f"📅 *Select Appointment Date*\n\n"
        f"{date_list}\n\n"
        f"Please select a date (1, 2, 3, etc.):"
    )


def generate_time_slots():
    """Generate time slots from 12:00 AM to 11:30 PM in 30-minute intervals, grouped by 6"""
    time_slots = []

    # Generate ALL time slots for 24 hours (12:00 AM to 11:30 PM)
    for hour in range(24):  # 0 to 23 hours
        for minute in [0, 30]:
            # Format the time
            if hour == 0:
                time_str = f"12:{minute:02d} AM"
            elif hour < 12:
                time_str = f"{hour}:{minute:02d} AM"
            elif hour == 12:
                time_str = f"12:{minute:02d} PM"
            else:
                time_str = f"{hour-12}:{minute:02d} PM"

            time_slots.append(time_str)

    # Split into groups of 6 for WhatsApp display
    grouped_times = []
    for i in range(0, len(time_slots), 6):
        group = time_slots[i : i + 6]

        # Number each slot in the group from 1-6
        formatted_group = []
        for j, time_slot in enumerate(group, 1):
            formatted_group.append(f"{j}. {time_slot}")

        # Build the group text
        group_text = "\n".join(formatted_group)

        # Check if there are more slots AFTER this group
        has_more_slots = i + 6 < len(time_slots)

        # Check if there are slots BEFORE this group
        has_previous_slots = i > 0

        # Add "more" option ONLY if there are more slots
        if has_more_slots:
            # The "more" option is always slot count + 1
            more_option_num = len(group) + 1
            group_text += f"\n{more_option_num}. More slots"

        # Add "back" option ONLY if there are previous slots
        if has_previous_slots:
            # The "back" option is slot count + 2 if "more" exists, otherwise slot count + 1
            back_option_num = len(group) + (2 if has_more_slots else 1)
            group_text += f"\n{back_option_num}. Previous slots"

        grouped_times.append(group_text)

    return grouped_times, time_slots


def format_time_slot_page(
    page_index: int,
    time_groups: list,
    total_pages: int,
    all_time_slots: list,
    display_date: str = "Selected Date",
    error: bool = False,
) -> str:
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
    has_more_pages = page_index < total_pages - 1
    has_previous_pages = page_index > 0

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


def handle_appointment_select_date(user_input: str, session: dict) -> str:
    """Handle date selection"""
    try:
        choice = int(user_input) - 1

        if 0 <= choice < 7:  # Next 7 days
            selected_date = datetime.now() + timedelta(days=choice)
            date_str = selected_date.strftime("%Y-%m-%d")
            display_date = selected_date.strftime("%d %b %Y")

            session["appointment_details"]["date"] = date_str
            session["appointment_details"]["display_date"] = display_date
            session["state"] = ConversationState.APPOINTMENT_SELECT_TIME

            # Generate time slots
            time_groups, all_time_slots = generate_time_slots()

            # Store for pagination
            session["time_slot_page"] = 0
            session["time_groups"] = time_groups
            session["all_time_slots"] = all_time_slots

            # Build message EXACTLY as requested
            return (
                f"# Date Selected: {display_date}\n\n"
                f"## Select Time Slot\n\n"
                f"{time_groups[0]}\n\n"
                f"**Options:**\n\n"
                f"- Select time (1-6)\n"
                f"- Type 'more' for more options\n"
                f"- Type 'back' to change date"
            )
        else:
            return "❌ Invalid choice. Please select a valid date (1-7)."
    except ValueError:
        return "❌ Please enter a valid number."


def build_appointment_confirmation(session: dict) -> str:
    """Build appointment confirmation message"""
    details = session["appointment_details"]

    confirmation = f"📋 *Appointment Summary*\n\n"

    # Patient information
    if "patient_info" in details:
        patient = details["patient_info"]
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

    if doctor.get("qualifications"):
        confirmation += f"   • Qualifications: {doctor.get('qualifications')}\n"

    # Appointment details
    confirmation += f"\n📅 *Appointment Details*\n"
    confirmation += (
        f"   • Date: {details.get('display_date', details.get('date', 'N/A'))}\n"
    )
    confirmation += f"   • Time: {details.get('time', 'N/A')}\n"
    confirmation += (
        f"   • Visit Type: {details.get('visit_type', 'New Visit').title()}\n\n"
    )

    confirmation += "*Please confirm:*\n\n"
    confirmation += "1. ✅ Yes, Book Appointment\n"
    confirmation += "2. ❌ No, Cancel"

    return confirmation


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


@router.post("/elevenlabs-hms-id-webhook")
async def handle_incoming_hms(request: Request):
    """
    Endpoint for ElevenLabs integration matching their exact schema
    Four-stage workflow as per ElevenLabs tool configuration
    """
    try:
        # ==================== LOG INCOMING FROM ELEVENLABS ====================
        logger.info("=" * 80)
        logger.info("📥 DATA FROM ELEVENLABS")
        logger.info("=" * 80)

        # Get raw request body for logging
        body_bytes = await request.body()
        body_str = body_bytes.decode("utf-8")

        logger.info("📦 Raw JSON from ElevenLabs:")
        logger.info(body_str)

        # Parse JSON
        try:
            payload = json.loads(body_str) if body_str else {}
        except json.JSONDecodeError as e:
            logger.error(f"❌ Invalid JSON from ElevenLabs: {e}")
            payload = {}

        logger.info("📊 Parsed payload from ElevenLabs:")
        logger.info(json.dumps(payload, indent=2))
        logger.info("-" * 80)

        # Extract parameters
        hms_id = payload.get("HMS_ID")
        doctor_sys_user_id = payload.get("Doctor_Sys_User_Id")
        speciality = payload.get("speciality")
        appointment_date = payload.get("appointment_date")
        appointment_time = payload.get("appointment_time")
        chief_complaint = payload.get("chief_complaint")
        visit_type = payload.get("visit_type", "new visit")  # Default to new visit

        logger.info("🔍 Parameters extracted:")
        logger.info(f"   • HMS_ID: '{hms_id}'")
        logger.info(f"   • speciality: '{speciality}'")
        logger.info(f"   • Doctor_Sys_User_Id: '{doctor_sys_user_id}'")
        logger.info(f"   • appointment_date: '{appointment_date}'")
        logger.info(f"   • appointment_time: '{appointment_time}'")
        logger.info(f"   • chief_complaint: '{chief_complaint}'")
        logger.info(f"   • visit_type: '{visit_type}'")

        # Validate HMS_ID (always required)
        if not hms_id:
            logger.error("❌ HMS_ID is required")
            error_response = {
                "success": False,
                "error": "HMS_ID is required",
                "instructions": "Please provide HMS_ID parameter",
            }
            return JSONResponse(status_code=400, content=error_response)

        # ==================== STAGE 1: HMS_ID ONLY (GET PATIENT INFO + SPECIALITIES) ====================
        if not speciality and not doctor_sys_user_id:
            logger.info(
                "🎯 STAGE 1: HMS_ID only - Fetching patient info and specialities"
            )
            logger.info(f"   Processing HMS_ID: '{hms_id}'")

            # Get patient from database - ASYNC
            patient = await get_patient_by_hms_id(hms_id)
            if not patient:
                logger.warning(f"⚠️ Patient not found for HMS_ID: '{hms_id}'")
                error_response = {
                    "success": False,
                    "error": f"Patient with HMS_ID '{hms_id}' not found",
                    "hms_id": hms_id,
                    "stage": "patient_info",
                }
                return JSONResponse(status_code=404, content=error_response)

            logger.info(f"✅ Patient found: {patient.get('name')}")

            # Get latest appointment - ASYNC
            patient_id = patient.get("patient_id")
            latest_appointment = (
                await get_latest_appointment(patient_id) if patient_id else None
            )
            previous_doctor = None

            if latest_appointment and latest_appointment.get("doctor_id"):
                appointment_doctor_id = latest_appointment.get("doctor_id")
                logger.info(f"🩺 Doctor ID from appointment: '{appointment_doctor_id}'")
                previous_doctor = await get_doctor_by_id(appointment_doctor_id)

                if previous_doctor:
                    logger.info(
                        f"✅ Previous doctor found: {previous_doctor.get('name')}"
                    )

            # Get available specialities for patient's hospital - ASYNC
            available_specialities = await get_available_specialities_for_elevenlabs(
                hms_id
            )

            # ==================== BUILD STAGE 1 RESPONSE ====================
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
                    "phone_number": patient.get("phone_number"),
                },
                "latest_appointment": (
                    {
                        "date": (
                            latest_appointment.get("date")
                            if latest_appointment
                            else None
                        ),
                        "time": (
                            latest_appointment.get("scheduled_time")
                            if latest_appointment
                            else None
                        ),
                        "doctor_id": (
                            latest_appointment.get("doctor_id")
                            if latest_appointment
                            else None
                        ),
                        "visit_type": (
                            latest_appointment.get("visit_type")
                            if latest_appointment
                            else None
                        ),
                    }
                    if latest_appointment
                    else None
                ),
                "previous_doctor": (
                    {
                        "doctor_id": (
                            previous_doctor.get("doctor_id")
                            if previous_doctor
                            else None
                        ),
                        "sys_user_id": (
                            previous_doctor.get("sys_user_id")
                            if previous_doctor
                            else None
                        ),
                        "name": (
                            previous_doctor.get("name") if previous_doctor else None
                        ),
                        "specialization": (
                            previous_doctor.get("specialization")
                            if previous_doctor
                            else None
                        ),
                        "qualifications": (
                            previous_doctor.get("qualifications")
                            if previous_doctor
                            else None
                        ),
                    }
                    if previous_doctor
                    else None
                ),
                "available_specialities": available_specialities,
                "instructions": "Select a speciality from 'available_specialities' and provide 'speciality' parameter in next request",
                "example_next_request": {
                    "HMS_ID": hms_id,
                    "speciality": "Cardiology",  # Example: Choose from available_specialities
                },
                "timestamp": datetime.now().isoformat(),
            }

            return JSONResponse(status_code=200, content=response_data)

        # ==================== STAGE 2: HMS_ID + SPECIALITY (GET DOCTORS) ====================
        elif speciality and not doctor_sys_user_id:
            logger.info("🎯 STAGE 2: HMS_ID + speciality - Getting doctors")
            logger.info(f"   Speciality from ElevenLabs: '{speciality}'")

            # Verify patient exists - ASYNC
            patient = await get_patient_by_hms_id(hms_id)
            if not patient:
                logger.warning(f"⚠️ Patient not found for HMS_ID: '{hms_id}'")
                error_response = {
                    "success": False,
                    "error": f"Patient with HMS_ID '{hms_id}' not found",
                    "hms_id": hms_id,
                    "speciality": speciality,
                    "stage": "doctor_selection",
                }
                return JSONResponse(status_code=404, content=error_response)

            logger.info(f"✅ Patient verified: {patient.get('name')}")

            # Get doctors for the selected speciality and patient's hospital - ASYNC
            doctors = await get_doctors_for_elevenlabs(speciality, hms_id)

            if not doctors:
                logger.warning(f"⚠️ No doctors found for speciality: '{speciality}'")
                error_response = {
                    "success": False,
                    "error": f"No doctors available for speciality '{speciality}'",
                    "hms_id": hms_id,
                    "speciality": speciality,
                    "stage": "doctor_selection",
                    "suggestion": "Try a different speciality from available_specialities",
                }
                return JSONResponse(status_code=404, content=error_response)

            logger.info(
                f"✅ Found {len(doctors)} doctors for speciality: '{speciality}'"
            )

            # ==================== BUILD STAGE 2 RESPONSE ====================
            response_data = {
                "success": True,
                "stage": "doctor_selection",
                "hms_id": hms_id,
                "speciality": speciality,
                "patient": {
                    "patient_id": patient.get("patient_id"),
                    "name": patient.get("name"),
                    "sys_user_id": patient.get("sys_user_id"),
                },
                "doctors": doctors,
                "instructions": "Select a doctor from 'doctors' list and provide 'Doctor_Sys_User_Id' parameter in next request",
                "example_next_request": {
                    "HMS_ID": hms_id,
                    "Doctor_Sys_User_Id": (
                        doctors[0].get("sys_user_id")
                        if doctors
                        else "DOCTOR_SYS_USER_ID_HERE"
                    ),
                },
                "timestamp": datetime.now().isoformat(),
            }

            return JSONResponse(status_code=200, content=response_data)

        # ==================== STAGE 3: HMS_ID + DOCTOR_SYS_USER_ID (GET AVAILABILITY) ====================
        elif doctor_sys_user_id and not appointment_date:
            logger.info(
                "🎯 STAGE 3: HMS_ID + Doctor_Sys_User_Id - Getting doctor availability"
            )
            logger.info(
                f"   Doctor_Sys_User_Id from ElevenLabs: '{doctor_sys_user_id}'"
            )

            # Verify patient exists - ASYNC
            patient = await get_patient_by_hms_id(hms_id)
            if not patient:
                logger.warning(f"⚠️ Patient not found for HMS_ID: '{hms_id}'")
                error_response = {
                    "success": False,
                    "error": f"Patient with HMS_ID '{hms_id}' not found",
                    "hms_id": hms_id,
                    "doctor_sys_user_id": doctor_sys_user_id,
                    "stage": "doctor_availability",
                }
                return JSONResponse(status_code=404, content=error_response)

            logger.info(f"✅ Patient verified: {patient.get('name')}")

            # Get doctor by sys_user_id (filtered by patient's hospital) - ASYNC
            logger.info(
                f"🔍 Looking for doctor with sys_user_id: '{doctor_sys_user_id}'"
            )
            doctor = await get_doctor_by_sys_user_id(doctor_sys_user_id, hms_id)

            if not doctor:
                logger.warning(
                    f"⚠️ Doctor not found with sys_user_id: '{doctor_sys_user_id}'"
                )
                error_response = {
                    "success": False,
                    "error": f"Doctor not found with sys_user_id: '{doctor_sys_user_id}'",
                    "hms_id": hms_id,
                    "doctor_sys_user_id": doctor_sys_user_id,
                    "stage": "doctor_availability",
                    "suggestion": "Check if this is the correct sys_user_id from previous response",
                }
                return JSONResponse(status_code=404, content=error_response)

            logger.info(f"✅ Doctor found: {doctor.get('name')}")

            # Get doctor availability with dates and time slots
            logger.info(f"📅 Generating availability for doctor: {doctor.get('name')}")
            availability = get_doctor_availability_for_elevenlabs(doctor_sys_user_id)

            # ==================== BUILD STAGE 3 RESPONSE ====================
            response_data = {
                "success": True,
                "stage": "doctor_availability",
                "hms_id": hms_id,
                "patient": {
                    "patient_id": patient.get("patient_id"),
                    "name": patient.get("name"),
                    "sys_user_id": patient.get("sys_user_id"),
                },
                "doctor": {
                    "sys_user_id": doctor.get("sys_user_id"),
                    "doctor_id": doctor.get("doctor_id"),
                    "name": doctor.get("name"),
                    "specialization": doctor.get("specialization"),
                    "qualifications": doctor.get("qualifications"),
                },
                "availability": availability,
                "instructions": "Select a date and time slot from 'availability' and provide appointment details in next request",
                "example_next_request": {
                    "HMS_ID": hms_id,
                    "Doctor_Sys_User_Id": doctor_sys_user_id,
                    "appointment_date": "2026-01-06",
                    "appointment_time": "4:00 PM",
                    "chief_complaint": "chest pain",
                    "visit_type": "new visit",
                },
                "timestamp": datetime.now().isoformat(),
            }

            return JSONResponse(status_code=200, content=response_data)

        # ==================== STAGE 4: COMPLETE APPOINTMENT BOOKING ====================
        elif doctor_sys_user_id and appointment_date and appointment_time:
            logger.info("🎯 STAGE 4: Complete appointment booking")
            logger.info(f"   Booking appointment for HMS_ID: '{hms_id}'")

            # Get patient from database - ASYNC
            patient = await get_patient_by_hms_id(hms_id)
            if not patient:
                logger.warning(f"⚠️ Patient not found for HMS_ID: '{hms_id}'")
                error_response = {
                    "success": False,
                    "error": f"Patient with HMS_ID '{hms_id}' not found",
                    "hms_id": hms_id,
                    "stage": "appointment_booking",
                }
                return JSONResponse(status_code=404, content=error_response)

            logger.info(f"✅ Patient found: {patient.get('name')}")
            logger.info(f"   • Patient sys_user_id: {patient.get('sys_user_id')}")

            # Get doctor by sys_user_id (filtered by patient's hospital) - ASYNC
            logger.info(
                f"🔍 Looking for doctor with sys_user_id: '{doctor_sys_user_id}'"
            )
            doctor = await get_doctor_by_sys_user_id(doctor_sys_user_id, hms_id)

            if not doctor:
                logger.warning(
                    f"⚠️ Doctor not found with sys_user_id: '{doctor_sys_user_id}'"
                )
                error_response = {
                    "success": False,
                    "error": f"Doctor not found with sys_user_id: '{doctor_sys_user_id}'",
                    "hms_id": hms_id,
                    "doctor_sys_user_id": doctor_sys_user_id,
                    "stage": "appointment_booking",
                }
                return JSONResponse(status_code=404, content=error_response)

            logger.info(f"✅ Doctor found: {doctor.get('name')}")
            logger.info(f"   • Doctor sys_user_id: {doctor.get('sys_user_id')}")

            # Validate visit_type
            if visit_type not in ["follow-up", "new visit"]:
                visit_type = "new visit"  # Default to new visit if invalid

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
                    "phone_number": patient.get("phone_number"),
                },
                "doctor": {
                    "doctor_id": doctor.get("doctor_id"),
                    "sys_user_id": doctor.get("sys_user_id"),
                    "name": doctor.get("name"),
                    "specialization": doctor.get("specialization", ""),
                    "qualifications": doctor.get("qualifications", ""),
                },
            }

            # Call the appointment booking API - ASYNC
            logger.info("📤 Calling appointment booking API...")
            api_result = await book_appointment_api(appointment_data)

            if api_result.get("success"):
                logger.info("✅ Appointment booked successfully")

                response_data = {
                    "success": True,
                    "stage": "appointment_booking",
                    "message": "Appointment booked successfully",
                    "appointment_details": {
                        "appointment_id": api_result.get("appointment_id"),
                        "appointment_number": api_result.get("appointment_number"),
                        "date": appointment_date,
                        "time": appointment_time,
                        "chief_complaint": chief_complaint,
                        "visit_type": visit_type,
                        "status": "booked",
                    },
                    "patient": {
                        "hms_id": hms_id,
                        "sys_user_id": patient.get("sys_user_id"),
                        "name": patient.get("name"),
                    },
                    "doctor": {
                        "sys_user_id": doctor.get("sys_user_id"),
                        "name": doctor.get("name"),
                        "specialization": doctor.get("specialization"),
                    },
                    "timestamp": datetime.now().isoformat(),
                }

                return JSONResponse(status_code=200, content=response_data)
            else:
                logger.error(
                    f"❌ Failed to book appointment: {api_result.get('error')}"
                )

                error_response = {
                    "success": False,
                    "stage": "appointment_booking",
                    "error": api_result.get("error", "Unknown error"),
                    "message": "Failed to book appointment",
                    "details": {
                        "hms_id": hms_id,
                        "patient_sys_user_id": patient.get("sys_user_id"),
                        "doctor_sys_user_id": doctor.get("sys_user_id"),
                        "date": appointment_date,
                        "time": appointment_time,
                        "chief_complaint": chief_complaint,
                        "visit_type": visit_type,
                    },
                    "timestamp": datetime.now().isoformat(),
                }

                return JSONResponse(status_code=500, content=error_response)

        else:
            logger.error("❌ Invalid parameter combination")
            error_response = {
                "success": False,
                "error": "Invalid parameter combination",
                "instructions": "Please provide valid parameters as per the workflow",
                "workflow_stages": [
                    "Stage 1: Send HMS_ID only (get patient info and specialities)",
                    "Stage 2: Send HMS_ID + speciality (get doctors)",
                    "Stage 3: Send HMS_ID + Doctor_Sys_User_Id (get availability)",
                    "Stage 4: Send HMS_ID + Doctor_Sys_User_Id + appointment_date + appointment_time + chief_complaint (book appointment)",
                ],
                "timestamp": datetime.now().isoformat(),
            }
            return JSONResponse(status_code=400, content=error_response)

    except Exception as e:
        logger.error("=" * 80)
        logger.error("❌ UNEXPECTED ERROR")
        logger.error(f"Error: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        logger.error("=" * 80)
        error_response = {
            "success": False,
            "error": "Internal server error",
            "details": str(e),
            "timestamp": datetime.now().isoformat(),
        }
        return JSONResponse(status_code=500, content=error_response)


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
        "address": patient.get("address"),
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
        "consultation_fee": doctor.get("consultation_fee"),
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
        "notes": appointment.get("notes"),
    }


@router.get("/test-hms-webhook")
async def test_hms_webhook():
    """Test endpoint to verify webhook format"""
    test_payload = {
        "HMS_ID": "HMS-PAT-1004",
        "test": True,
        "timestamp": datetime.now().isoformat(),
    }

    return {
        "description": "Test payload format for /elevenlabs-hms-id-webhook",
        "example_request": test_payload,
        "expected_response_fields": [
            "success",
            "hms_id",
            "patient",
            "latest_appointment",
            "previous_doctor",
        ],
        "curl_example": 'curl -X POST "https://your-domain.com/whatsapp/elevenlabs-hms-id-webhook" -H "Content-Type: application/json" -d \'{"HMS_ID": "HMS-PAT-1004"}\'',
    }


def get_previous_doctor_for_patient(patient_id: str):
    """Get previous doctor info for a patient"""
    if not patient_id:
        return None

    latest_appointment = get_latest_appointment(patient_id)
    if not latest_appointment or not latest_appointment.get("doctor_id"):
        return None

    doctor_sys_user_id = latest_appointment.get("doctor_id")
    doctor = get_doctor_by_id(doctor_sys_user_id)

    if not doctor:
        return None

    return {
        "doctor_id": doctor.get("doctor_id"),
        "sys_user_id": doctor.get("sys_user_id"),
        "name": doctor.get("name"),
        "specialization": doctor.get("specialization"),
        "qualifications": doctor.get("qualifications"),
    }


def format_patient_for_response(patient: dict):
    """Format patient data for API response"""
    return {
        "patient_id": patient.get("patient_id"),
        "sys_user_id": patient.get("sys_user_id"),
        "name": patient.get("name"),
        "date_of_birth": patient.get("date_of_birth"),
        "gender": patient.get("gender"),
        "blood_group": patient.get("blood_group"),
        "phone_number": patient.get("phone_number"),
    }


async def get_doctor_by_sys_user_id(sys_user_id: str, hms_id: str = None):
    """ASYNC - Get doctor by sys_user_id"""
    try:
        logger.info(f"🔍 Database lookup for doctor with sys_user_id: '{sys_user_id}'")

        # Build query
        query = {
            "$or": [
                {"sys_user_id": sys_user_id},
                {
                    "sys_user_id": {
                        "$regex": f"^{re.escape(sys_user_id)}$",
                        "$options": "i",
                    }
                },
            ]
        }

        # Add hospital_id filter
        if hms_id:
            hospital_id = await get_hospital_id_from_patient(hms_id)
            if hospital_id:
                query["hospital_id"] = hospital_id
                logger.info(f"🔍 Filtering doctor by hospital_id: {hospital_id}")

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
                "hospital_id": 1,
            },
        )

        if doctor:
            logger.info(f"✅ Doctor found by sys_user_id: {doctor.get('name')}")
            doctor["_id"] = str(doctor["_id"])
            return doctor

        logger.warning(f"⚠️ No doctor found with sys_user_id: '{sys_user_id}'")
        return None

    except Exception as e:
        logger.error(f"❌ Error in get_doctor_by_sys_user_id: {e}")
        return None


async def get_available_specialities_for_elevenlabs(hms_id: str):
    """ASYNC - Get available specialities for a patient"""
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
            {"$sort": {"_id": 1}},
        ]

        cursor = doctor_user_collection.aggregate(pipeline)
        specialities = [doc["_id"] async for doc in cursor]

        if specialities:
            logger.info(
                f"Found {len(specialities)} specialities for hospital_id: {hospital_id}"
            )
            return specialities
        else:
            logger.info(
                f"No specialities found for hospital_id: {hospital_id}, using default"
            )
            return SPECIALITIES

    except Exception as e:
        logger.error(f"Error getting specialities for hospital: {e}")
        return SPECIALITIES


async def get_doctors_for_elevenlabs(speciality: str, hms_id: str):
    """ASYNC - Get doctors for ElevenLabs"""
    try:
        # Get hospital_id from patient
        hospital_id = await get_hospital_id_from_patient(hms_id)

        # Build query
        query = {
            "specialization": {"$regex": f"^{re.escape(speciality)}$", "$options": "i"}
        }
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
                "consultation_fee": 1,
            },
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
                "consultation_fee": doctor.get("consultation_fee", ""),
            }
            for doctor in doctors
        ]

        logger.info(
            f"Found {len(formatted_doctors)} doctors for speciality '{speciality}'"
        )
        return formatted_doctors

    except Exception as e:
        logger.error(f"Error getting doctors for ElevenLabs: {e}")
        return []


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
            "elevenlabs_request": {"HMS_ID": "HMS-PAT-1004"},
            "expected_response_fields": [
                "success",
                "stage",
                "patient",
                "previous_doctor",
                "instructions",
            ],
        },
        "stage_2_example": {
            "description": "Stage 2: ElevenLabs sends HMS_ID + Doctor_Sys_User_Id",
            "elevenlabs_request": {
                "HMS_ID": "HMS-PAT-1004",
                "Doctor_Sys_User_Id": "DOC-81e80897-85f1-4540-ab20-80baff67725e",
            },
            "expected_response_fields": [
                "success",
                "stage",
                "doctor",
                "availability",
                "booking_instructions",
            ],
        },
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
                    "description": "Extract from conversation",
                },
                {
                    "name": "Doctor_Sys_User_Id",
                    "type": "string",
                    "required": False,
                    "description": "Only for stage 2, from previous response",
                },
            ],
        },
        "test_cases": test_cases,
        "curl_test_commands": [
            "# Stage 1 Test",
            "curl -X POST 'https://demo.doctorassist.ai/api/hms/users/data/whatsapp/elevenlabs-hms-id-webhook' \\",
            "  -H 'Content-Type: application/json' \\",
            '  -d \'{"HMS_ID": "HMS-PAT-1004"}\'',
            "",
            "# Stage 2 Test",
            "curl -X POST 'https://demo.doctorassist.ai/api/hms/users/data/whatsapp/elevenlabs-hms-id-webhook' \\",
            "  -H 'Content-Type: application/json' \\",
            '  -d \'{"HMS_ID": "HMS-PAT-1004", "Doctor_Sys_User_Id": "DOC-81e80897-85f1-4540-ab20-80baff67725e"}\'',
        ],
    }


def get_available_specialities_for_elevenlabs(hms_id: str):
    """
    Get available specialities for a patient based on their hospital
    """
    try:
        # Get hospital_id from patient
        hospital_id = get_hospital_id_from_patient(hms_id)
        if not hospital_id:
            logger.warning(f"No hospital_id found for HMS_ID: {hms_id}")
            return SPECIALITIES  # Return default if no hospital_id found

        # Single aggregation query
        pipeline = [
            {"$match": {"hospital_id": hospital_id}},
            {"$group": {"_id": "$specialization"}},
            {"$sort": {"_id": 1}},
        ]

        specialities_cursor = doctor_user_collection.aggregate(pipeline)
        specialities = [doc["_id"] for doc in specialities_cursor]

        if specialities:
            logger.info(
                f"Found {len(specialities)} specialities for hospital_id: {hospital_id}"
            )
            return specialities
        else:
            logger.info(
                f"No specialities found for hospital_id: {hospital_id}, using default"
            )
            return SPECIALITIES  # Fallback to default specialities

    except Exception as e:
        logger.error(f"Error getting specialities for hospital: {e}")
        return SPECIALITIES  # Fallback to default specialities


def handle_appointment_method(user_input: str, session: dict) -> str:
    """Handle appointment method selection"""
    if user_input == "1":  # Voice
        session["state"] = (
            ConversationState.MAIN_MENU
        )  # Reset to main menu after providing info

        voice_agent_url = "https://demo.doctorassist.ai/voice-agent"

        return (
            f"🗣️ *Voice Appointment Agent*\n\n"
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
            f"Reply with 1 or 2"
        )

    elif user_input == "2":  # Chat - Book new appointment
        session["state"] = ConversationState.APPOINTMENT_HMS_ID
        session["appointment_details"] = {"is_reschedule": False}
        return (
            "💬 *Chat Appointment Booking*\n\n"
            "Please enter your *HMS ID exactly as it appears*:\n"
            "(e.g., HMS-PAT-1004)\n\n"
            "_Note: HMS ID is case-sensitive_"
        )

    elif user_input == "3":  # Chat - Reschedule
        session["state"] = ConversationState.APPOINTMENT_HMS_ID
        session["appointment_details"] = {"is_reschedule": True}
        return (
            "🔄 *Appointment Rescheduling*\n\n"
            "Please enter your *HMS ID exactly as it appears*:\n"
            "(e.g., HMS-PAT-1004)\n\n"
            "_Note: HMS ID is case-sensitive_"
        )

    else:
        return (
            "*Please choose:*\n\n"
            "1. 🗣️ Voice Call\n"
            "2. 💬 Chat - Book New\n"
            "3. 🔄 Chat - Reschedule\n\n"
            "Reply with 1, 2, or 3"
        )


async def get_upcoming_appointments(hms_id: str):
    """ASYNC - Get upcoming appointments for a patient (today or future)"""
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
            if (
                appointment_date
                and appointment_date >= today
                and appointment_status in ["scheduled", "booked", "confirmed"]
            ):

                # Get doctor info
                doctor = await get_doctor_by_id(appointment.get("doctor_id"))

                # Get appointment ID - use existing or generate one
                appointment_id = (
                    appointment.get("appointment_id")
                    or appointment.get("id")
                    or f"APT-{patient_id}-{appointment_date}"
                )

                upcoming_appointments.append(
                    {
                        "appointment_id": appointment_id,
                        "appointment_number": appointment.get(
                            "appointment_number", "N/A"
                        ),
                        "date": appointment_date,
                        "scheduled_time": appointment.get("scheduled_time", "N/A"),
                        "doctor_name": (
                            doctor.get("name") if doctor else "Unknown Doctor"
                        ),
                        "specialization": (
                            doctor.get("specialization") if doctor else ""
                        ),
                        "visit_type": appointment.get("visit_type", "New Visit"),
                        "status": appointment_status,
                        "doctor_id": appointment.get("doctor_id"),
                    }
                )

        # Sort by date and time (nearest first)
        upcoming_appointments.sort(key=lambda x: (x["date"], x["scheduled_time"]))

        return upcoming_appointments[:5]  # Return max 5 upcoming appointments

    except Exception as e:
        logger.error(f"❌ Error getting upcoming appointments: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return []


async def update_appointment_in_database(
    appointment_id: str, new_date: str, new_time: str
):
    """ASYNC - Update appointment date and time in database"""
    try:
        logger.info(
            f"🔄 Updating appointment {appointment_id} to {new_date} at {new_time}"
        )

        # First find the appointment
        result = await patient_appointments_collection.update_one(
            {"appointments.appointment_id": appointment_id},
            {
                "$set": {
                    "appointments.$.date": new_date,
                    "appointments.$.scheduled_time": new_time,
                    "appointments.$.status": "rescheduled",
                    "appointments.$.rescheduled_at": datetime.now().isoformat(),
                }
            },
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
                        "appointments.$.rescheduled_at": datetime.now().isoformat(),
                    }
                },
            )

            if result.modified_count > 0:
                logger.info(
                    f"✅ Appointment {appointment_id} updated successfully (using id field)"
                )
                return True

            logger.warning(f"⚠️ No appointment found with ID: {appointment_id}")
            return False

    except Exception as e:
        logger.error(f"❌ Error updating appointment: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return False


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
            message += (
                f"{i}. *Appointment ID:* {appointment.get('appointment_id', 'N/A')}\n"
            )
            message += f"   • Date: {appointment.get('date', 'N/A')}\n"
            message += f"   • Time: {appointment.get('scheduled_time', 'N/A')}\n"
            message += f"   • Doctor: {appointment.get('doctor_name', 'N/A')}\n"
            message += (
                f"   • Specialization: {appointment.get('specialization', 'N/A')}\n"
            )
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
            message += (
                f"   Appointment ID: {appointment.get('appointment_id', 'N/A')}\n\n"
            )

        message += "Please select the appointment number (1, 2, etc.):"
        return message

    elif user_input == "2":  # No, book new appointment instead
        session["state"] = ConversationState.APPOINTMENT_VERIFY
        # Clear reschedule data
        session.pop("upcoming_appointments", None)
        return await handle_appointment_verify("", session)

    return "❌ Please choose:\n1. ✅ Yes, reschedule\n2. ❌ No, book new appointment instead"


async def handle_reschedule_select_appointment(user_input: str, session: dict) -> str:
    """Handle appointment selection for rescheduling"""
    try:
        choice = int(user_input) - 1
        appointments = session.get("upcoming_appointments", [])

        if 0 <= choice < len(appointments):
            selected_appointment = appointments[choice]

            # Store selected appointment in session
            session["selected_appointment"] = selected_appointment
            session["state"] = ConversationState.RESCHEDULE_SELECT_DATE

            # Show current appointment details
            message = f"📋 *Selected Appointment*\n\n"
            message += f"*Appointment ID:* {selected_appointment.get('appointment_id', 'N/A')}\n"
            message += f"*Current Date:* {selected_appointment.get('date', 'N/A')}\n"
            message += (
                f"*Current Time:* {selected_appointment.get('scheduled_time', 'N/A')}\n"
            )
            message += f"*Doctor:* {selected_appointment.get('doctor_name', 'N/A')}\n"
            message += f"*Specialization:* {selected_appointment.get('specialization', 'N/A')}\n\n"
            message += "*Select new date:*\n\n"

            # Generate date selection message
            message += generate_date_selection_message_reschedule()

            return message
        else:
            return "❌ Invalid selection. Please choose a valid appointment number (1, 2, etc.)."
    except ValueError:
        return "❌ Please enter a valid number (1, 2, etc.)."


def generate_date_selection_message_reschedule():
    """Generate date selection for rescheduling (next 14 days)"""
    today = datetime.now()

    # Show next 14 days
    date_options = []
    for i in range(14):
        current_date = today + timedelta(days=i)
        date_str = current_date.strftime("%Y-%m-%d")
        display_date = current_date.strftime("%d %b %Y")

        if i == 0:
            date_options.append(f"1. Today - {display_date}")
        elif i == 1:
            date_options.append(f"2. Tomorrow - {display_date}")
        else:
            day_name = current_date.strftime("%A")
            date_options.append(f"{i+1}. {day_name} - {display_date}")

    date_list = "\n".join(date_options)

    return (
        f"📅 *Select New Appointment Date*\n\n"
        f"{date_list}\n\n"
        f"Please select a date (1, 2, 3, etc.):"
    )


async def handle_reschedule_select_date(user_input: str, session: dict) -> str:
    """Handle date selection for rescheduling"""
    try:
        choice = int(user_input) - 1

        if 0 <= choice < 14:  # Next 14 days
            selected_date = datetime.now() + timedelta(days=choice)
            date_str = selected_date.strftime("%Y-%m-%d")
            display_date = selected_date.strftime("%d %b %Y")

            # Store new date in session
            session["new_appointment_date"] = date_str
            session["new_display_date"] = display_date

            # Go to time selection
            session["state"] = ConversationState.RESCHEDULE_SELECT_TIME

            # Generate time slots
            time_groups, all_time_slots = generate_time_slots()

            # Show first group of time slots
            session["time_slot_page"] = 0
            session["time_groups"] = time_groups
            session["all_time_slots"] = all_time_slots

            total_pages = len(time_groups)

            return (
                f"📅 *New Date Selected:* {display_date}\n\n"
                f"⏰ *Select New Time Slot (Page 1/{total_pages})*\n\n"
                f"{time_groups[0]}\n\n"
                f"*Options:*\n"
                f"• Select time (1-6)\n"
                f"• Type '7' for more slots"
            )
        else:
            return "❌ Invalid choice. Please select a valid date (1-14)."
    except ValueError:
        return "❌ Please enter a valid number."


async def handle_reschedule_select_time(user_input: str, session: dict) -> str:
    """Handle time selection for rescheduling"""
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
        return generate_date_selection_message_reschedule()

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

            return (
                f"# Date Selected: {display_date}\n\n"
                f"## Select New Time Slot\n\n"
                f"{current_display}\n\n"
                f"**Options:**\n\n"
                f"- Select time (1-6)\n"
                f"- Type 'more' for more options\n"
                f"- Type 'back' to change date"
            )

        # Handle "Previous slots" option
        elif (
            choice == slots_on_page + (2 if (current_page < total_pages - 1) else 1)
            and current_page > 0
        ):
            session["time_slot_page"] = current_page - 1
            current_display = time_groups[current_page - 1]

            return (
                f"# Date Selected: {display_date}\n\n"
                f"## Select New Time Slot\n\n"
                f"{current_display}\n\n"
                f"**Options:**\n\n"
                f"- Select time (1-6)\n"
                f"- Type 'more' for more options\n"
                f"- Type 'back' to change date"
            )

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

                return (
                    f"📋 *Reschedule Confirmation*\n\n"
                    f"*Appointment ID:* {appointment.get('appointment_id', 'N/A')}\n\n"
                    f"*Current Schedule:*\n"
                    f"📅 Date: {current_date}\n"
                    f"⏰ Time: {current_time}\n\n"
                    f"*New Schedule:*\n"
                    f"📅 Date: {display_date}\n"
                    f"⏰ Time: {selected_time}\n\n"
                    f"Do you want to confirm this reschedule?\n\n"
                    f"1. ✅ Yes, confirm reschedule\n"
                    f"2. ❌ No, cancel reschedule"
                )
            else:
                # Invalid slot number
                return (
                    f"# Date Selected: {display_date}\n\n"
                    f"## Select New Time Slot\n\n"
                    f"{time_groups[current_page]}\n\n"
                    f"**Options:**\n\n"
                    f"- Select time (1-6)\n"
                    f"- Type 'more' for more options\n"
                    f"- Type 'back' to change date\n\n"
                    f"❌ Please enter a valid time slot number (1-6)"
                )
        else:
            # Invalid number choice
            return (
                f"# Date Selected: {display_date}\n\n"
                f"## Select New Time Slot\n\n"
                f"{time_groups[current_page]}\n\n"
                f"**Options:**\n\n"
                f"- Select time (1-6)\n"
                f"- Type 'more' for more options\n"
                f"- Type 'back' to change date\n\n"
                f"❌ Please enter a valid option."
            )

    # Handle text commands
    elif user_input == "more" or user_input == "next":
        if current_page < total_pages - 1:
            session["time_slot_page"] = current_page + 1
            current_display = time_groups[current_page + 1]

            return (
                f"# Date Selected: {display_date}\n\n"
                f"## Select New Time Slot\n\n"
                f"{current_display}\n\n"
                f"**Options:**\n\n"
                f"- Select time (1-6)\n"
                f"- Type 'more' for more options\n"
                f"- Type 'back' to change date"
            )
        else:
            return (
                f"# Date Selected: {display_date}\n\n"
                f"## Select New Time Slot\n\n"
                f"{time_groups[current_page]}\n\n"
                f"**Options:**\n\n"
                f"- Select time (1-6)\n"
                f"- Type 'back' to change date\n\n"
                f"❌ No more time slots available."
            )

    elif user_input == "previous" or user_input == "prev":
        if current_page > 0:
            session["time_slot_page"] = current_page - 1
            current_display = time_groups[current_page - 1]

            return (
                f"# Date Selected: {display_date}\n\n"
                f"## Select New Time Slot\n\n"
                f"{current_display}\n\n"
                f"**Options:**\n\n"
                f"- Select time (1-6)\n"
                f"- Type 'more' for more options\n"
                f"- Type 'back' to change date"
            )
        else:
            return (
                f"# Date Selected: {display_date}\n\n"
                f"## Select New Time Slot\n\n"
                f"{time_groups[current_page]}\n\n"
                f"**Options:**\n\n"
                f"- Select time (1-6)\n"
                f"- Type 'more' for more options\n"
                f"- Type 'back' to change date\n\n"
                f"❌ You're already on the first page."
            )

    # Invalid input (not a number or recognized command)
    return (
        f"# Date Selected: {display_date}\n\n"
        f"## Select New Time Slot\n\n"
        f"{time_groups[current_page]}\n\n"
        f"**Options:**\n\n"
        f"- Select time (1-6)\n"
        f"- Type 'more' for more options\n"
        f"- Type 'back' to change date\n\n"
        f"❌ Invalid input. Please enter a valid option."
    )


async def handle_reschedule_confirm_changes(user_input: str, session: dict) -> str:
    """Handle final confirmation of rescheduling"""
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
        success = await update_appointment_in_database(
            appointment_id, new_date, new_time
        )

        if success:
            # Build success message
            success_msg = "✅ *Appointment Rescheduled Successfully!*\n\n"
            success_msg += f"📋 *Appointment ID:* {appointment_id}\n"
            success_msg += f"👨‍⚕️ *Doctor:* {appointment.get('doctor_name', 'N/A')}\n"
            success_msg += (
                f"🏥 *Specialization:* {appointment.get('specialization', 'N/A')}\n"
            )
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
            return (
                "❌ Failed to reschedule appointment. "
                "Please contact the hospital directly or try again later.\n\n"
                "🏥 *Main Menu*\n\n"
                "1. 📄 Upload Lab Reports\n"
                "2. 📅 Book/Reschedule Another Appointment\n\n"
                "Reply with 1 or 2"
            )

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

        return (
            "❌ Reschedule cancelled.\n\n"
            "🏥 *Main Menu*\n\n"
            "1. 📄 Upload Lab Reports\n"
            "2. 📅 Book/Reschedule Appointment\n\n"
            "Reply with 1 or 2"
        )

    return (
        "❌ Please choose:\n1. ✅ Yes, confirm reschedule\n2. ❌ No, cancel reschedule"
    )


async def handle_reschedule_confirm_no_appointments(
    user_input: str, session: dict
) -> str:
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

        return (
            "🏥 *Main Menu*\n\n"
            "1. 📄 Upload Lab Reports\n"
            "2. 📅 Book/Reschedule Appointment\n\n"
            "Reply with 1 or 2"
        )

    return (
        "❌ Please choose:\n\n"
        "1. ✅ Yes, book new appointment\n"
        "2. ❌ No, return to main menu"
    )
