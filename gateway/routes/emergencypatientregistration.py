from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import Optional, List, Dict
from datetime import datetime, timezone, timedelta
from bson import ObjectId
import logging
import sys
import uuid
import os
from passlib.context import CryptContext
from dotenv import load_dotenv
from pymongo import MongoClient, ReturnDocument
import requests
import httpx
import re
import json

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage

load_dotenv()

router = APIRouter(
    prefix="/hms/users/emergencypatients",
    tags=["patient_registration"],
    responses={404: {"description": "Not found"}},
)

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
stream_handler = logging.StreamHandler(sys.stdout)
log_formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
stream_handler.setFormatter(log_formatter)
logger.addHandler(stream_handler)

# MongoDB Connection
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = "doctorassistai"

client = MongoClient(MONGO_URI)
db = client[MONGO_DB]

# SINGLE COLLECTION - This is all you need!
emergency_patients_collection = db["patients"]
# Per-day sequence counters used to generate system-issued patient IDs
patient_id_counters_collection = db["patient_id_counters"]
# ✅ PERFORMANCE INDEXES

emergency_patients_collection.create_index(
    [("ambulance_driver.driver_id", 1)]
)

emergency_patients_collection.create_index(
    [("status", 1)]
)

emergency_patients_collection.create_index(
    [("accidentDetails.accidentDate", 1)]
)

emergency_patients_collection.create_index(
    [("metadata.created_at", -1)]
)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ============================================
# CHIEF COMPLAINT CLASSIFICATION — LLM (Groq)
# ============================================

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

llm_complaint = ChatGroq(
    model="openai/gpt-oss-120b",
    temperature=0.1,
    max_tokens=500,
    groq_api_key=GROQ_API_KEY,
)

CHIEF_COMPLAINT_LABELS = {
    "Medical": [
        "Chest Pain", "Difficulty Breathing", "Stroke Symptoms", "Seizure",
        "Pregnancy", "Poisoning", "Psychiatric Emergency", "Allergic Reaction",
        "Abdominal Pain", "Fever", "Heat Stroke",
    ],
    "Trauma": [
        "Burns", "Falls", "Motor Vehicle Accident", "Motorcycle Accident",
        "Bicycle Accident", "Drowning", "Choking", "Electrocution",
        "Pedestrian Vehicle Accident", "Industrial Accident", "Head Injury",
        "Penetrating Injury", "Crush Injury", "Chest Injury", "Sports Injury",
        "Gunshot Wound", "Animal Bite", "Haemorrhage / Bleeding", "Assault",
        "Entrapment", "Building Collapse", "Facial Injury", "Blunt Trauma",
        "Laceration / Soft Tissue Injury",
    ],
}

_ALL_LABELS_FLAT = [l for group in CHIEF_COMPLAINT_LABELS.values() for l in group]

# ============================================
# AUTOMATIC 4-TIER PRIORITY (SOW §7)
# ============================================
# Deterministic table lookup, NOT LLM-decided — same "system decides, dispatcher
# doesn't override" principle as the Medical/Trauma classification above, but
# kept out of the model entirely so it can never drift between calls.
# ⚠️ First-pass mapping — needs clinical sign-off before it governs live dispatch.
PRIORITY_MAP = {
    # Red — Critical / immediate life-threatening
    "Chest Pain": "Red",
    "Difficulty Breathing": "Red",
    "Stroke Symptoms": "Red",
    "Seizure": "Red",
    "Poisoning": "Red",
    "Drowning": "Red",
    "Choking": "Red",
    "Electrocution": "Red",
    "Gunshot Wound": "Red",
    "Haemorrhage / Bleeding": "Red",
    "Crush Injury": "Red",
    "Chest Injury": "Red",
    "Building Collapse": "Red",
    "Entrapment": "Red",
    "Penetrating Injury": "Red",
    # Orange — Urgent / potentially life-threatening
    "Pregnancy": "Orange",
    "Psychiatric Emergency": "Orange",
    "Allergic Reaction": "Orange",
    "Heat Stroke": "Orange",
    "Burns": "Orange",
    "Falls": "Orange",
    "Motor Vehicle Accident": "Orange",
    "Motorcycle Accident": "Orange",
    "Pedestrian Vehicle Accident": "Orange",
    "Industrial Accident": "Orange",
    "Head Injury": "Orange",
    "Assault": "Orange",
    "Blunt Trauma": "Orange",
    "Animal Bite": "Orange",
    # Yellow — Moderate / stable but needs assessment
    "Abdominal Pain": "Yellow",
    "Fever": "Yellow",
    "Bicycle Accident": "Yellow",
    # Green — Delayed / stable, non-life-threatening
    "Sports Injury": "Green",
    "Facial Injury": "Green",
    "Laceration / Soft Tissue Injury": "Green",
}

# Safety net only — PRIORITY_MAP already covers every label in
# CHIEF_COMPLAINT_LABELS, this just guards against future schema drift.
_PRIORITY_CATEGORY_FALLBACK = {"Medical": "Yellow", "Trauma": "Orange"}

CHIEF_COMPLAINT_SYSTEM = (
    "You classify a single free-text emergency chief complaint sentence, "
    "dictated by a dispatch agent based on what a caller reported. You do "
    "NOT diagnose beyond this classification — you only categorize and, "
    "if a clear match exists, map to the closest predefined label. If the "
    "sentence is ambiguous or does not clearly match any category, say so "
    "honestly rather than guessing.\n\n"
    "Classify into exactly one of: 'Medical', 'Trauma', or "
    "'Unconscious Collapse'. Use 'Unconscious Collapse' ONLY if the "
    "sentence's primary description is that the patient is unconscious, "
    "unresponsive, or found collapsed, with no clearer alternate chief "
    "complaint stated (e.g. 'found unconscious on the floor', 'not "
    "responding, collapsed at work'). If the sentence describes an "
    "unconscious patient but ALSO gives a clear separate cause/complaint "
    "(e.g. 'fell off a ladder and is now unconscious'), classify by that "
    "underlying cause instead (here: Trauma / Falls) rather than "
    "'Unconscious Collapse'.\n\n"
    f"Fixed label list you may map to:\nMedical: {CHIEF_COMPLAINT_LABELS['Medical']}\n"
    f"Trauma: {CHIEF_COMPLAINT_LABELS['Trauma']}\n\n"
    "Pick the SINGLE closest matching label from the fixed list above, or "
    "null if nothing reasonably matches. Do not invent a label not in "
    "this list.\n\n"
    "Respond with valid JSON only, exactly this shape: "
    '{"category": "Medical" | "Trauma" | "Unconscious Collapse", '
    '"matched_label": "string from the fixed list, or null", '
    '"confidence": "high" | "medium" | "low", '
    '"rationale": "one short sentence citing the specific words that drove this classification"}'
)


def _parse_llm_json(text: str) -> Dict:
    if not text:
        return {"_parse_error": True}
    text = text.strip()
    text = re.sub(r"```json", "", text)
    text = re.sub(r"```", "", text)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        text = match.group(0)
    try:
        return json.loads(text)
    except Exception:
        logger.error(f"Failed to parse chief-complaint LLM output: {text[:300]}")
        return {"_parse_error": True, "raw_output": text}


class ChiefComplaintClassifyRequest(BaseModel):
    text: str


@router.post("/classify-chief-complaint")
async def classify_chief_complaint(req: ChiefComplaintClassifyRequest):
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="text is required")

    try:
        response = await llm_complaint.ainvoke([
            SystemMessage(content=CHIEF_COMPLAINT_SYSTEM),
            HumanMessage(content=req.text.strip()),
        ])
        result = _parse_llm_json(response.content)
    except Exception as e:
        logger.error(f"Chief complaint classification failed: {e}")
        raise HTTPException(status_code=502, detail="Classification service failed")

    if result.get("_parse_error"):
        raise HTTPException(status_code=502, detail="Could not parse classification result")

    if result.get("category") not in ("Medical", "Trauma", "Unconscious Collapse"):
        raise HTTPException(status_code=502, detail="Invalid classification category returned")

    matched = result.get("matched_label")
    if matched is not None and matched not in _ALL_LABELS_FLAT:
        result["matched_label"] = None  # never trust a label outside our fixed list
        matched = None

    # Unconscious Collapse has no matched_label at this stage (breathing
    # status isn't known yet) — the frontend already forces Red once "Not
    # Breathing" is selected, so priority stays null until then rather than
    # guessing.
    if result["category"] == "Unconscious Collapse":
        priority = None
    elif matched and matched in PRIORITY_MAP:
        priority = PRIORITY_MAP[matched]
    else:
        priority = _PRIORITY_CATEGORY_FALLBACK.get(result["category"], "Yellow")

    result["priority"] = priority

    return {"status": "success", **result}


# ============================================
# VOICE → INCIDENT EXTRACTION — LLM (Groq)
# ============================================
# Mirrors the field keys in the frontend's IFT_SECTIONS config exactly.
# If you add/rename a field there, update this list too.
IFT_FIELD_KEYS = [
    "requestDateTime", "requestingFacility", "callerName", "callerDesignation", "callerContact",
    "patientFullName", "patientRecordNumber", "patientAge", "patientSex", "patientDob",
    "referringHospitalName", "referringWardUnit", "referringBedNumber", "referringAddress", "referringContact",
    "receivingHospitalName", "receivingDeptUnit", "receivingPhysician", "receivingContact", "reasonForTransfer",
    "primaryDiagnosis", "patientCondition", "vitalsBP", "vitalsHR", "vitalsRR", "vitalsSpO2", "vitalsTemp",
    "vitalsGCS", "vitalsPainScore", "airwayStatus", "breathingSupport", "circulationAccess", "neuroStatus",
    "monitoringRequired", "medicationsDuringTransport", "isolationRequirements", "specialEquipmentNeeded",
    "mobility", "patientWeight", "specialRisks", "escortRequirements", "clinicalDocuments", "priorityLevel",
    "requestedTransportTime", "ambulanceTypeRequired", "estimatedTravelInfo", "billingAuthorization", "handoverInfo",
]

_IFT_SCHEMA_JSON = ", ".join(f'"{k}": ""' for k in IFT_FIELD_KEYS)

VOICE_EXTRACTION_SYSTEM = (
    "You are assisting an emergency dispatch agent. You will receive a raw voice "
    "transcript dictated by the dispatch agent describing an incoming call. Your "
    "job is ONLY to extract information the transcript actually states — never "
    "invent, infer beyond what is said, or fill in plausible-sounding defaults. "
    "Leave any field blank (empty string) if it is not clearly stated in the "
    "transcript.\n\n"
    "First, decide whether this call describes a NEW EMERGENCY (a 'primary' case "
    "— an ambulance needs to go pick up a patient from a scene) or an "
    "INTER-FACILITY TRANSFER (an 'ift' case — moving an existing patient between "
    "two healthcare facilities). Signals for IFT: a referring hospital/ward/bed, a "
    "receiving hospital or physician, a request to transfer a patient already "
    "admitted somewhere. Signals for primary: a scene/street/location where "
    "someone is hurt or unwell right now, a caller reporting an accident or "
    "medical event.\n\n"
    "For primary_case, in addition to location/contact/complaint, also extract, "
    "only when explicitly stated: fullName (the patient's name, if given — leave "
    "blank if the patient is described as unknown/unidentified), age (as a plain "
    "number string, e.g. '45' from 'approximately 45 years old'), gender (map "
    "explicitly stated wording to exactly 'male', 'female', or 'other' — e.g. "
    "'he', 'the worker', 'a man' all indicate 'male' only if the transcript "
    "itself uses a gendered noun/pronoun for the patient; do not guess gender "
    "from an occupation or scenario alone if no gendered word is used), and "
    "incidentTime (any explicitly stated timing of when the incident occurred, "
    "restated as given — e.g. 'just now', '10 minutes ago', '2:30 PM' — leave "
    "blank if no timing is mentioned; do not compute or convert this into a "
    "clock time yourself).\n\n"
    "Respond with valid JSON only, exactly this shape:\n"
    "{\n"
    '  "case_type": "primary" | "ift",\n'
    '  "primary_case": {"incidentLocation": "", "contactNumber": "", "chiefComplaintText": "", "fullName": "", "age": "", "gender": "", "incidentTime": ""},\n'
    f'  "ift_form": {{{_IFT_SCHEMA_JSON}}}\n'
    "}\n\n"
    "Always include both primary_case and ift_form keys regardless of case_type "
    "— just leave the ones that don't apply as empty strings. Only fill fields "
    "you are confident are explicitly stated in the transcript."
)

llm_extraction = ChatGroq(
    model="openai/gpt-oss-120b",
    temperature=0.1,
    max_tokens=1500,
    groq_api_key=GROQ_API_KEY,
)


class VoiceExtractionRequest(BaseModel):
    text: str


@router.post("/extract-incident-from-voice")
async def extract_incident_from_voice(req: VoiceExtractionRequest):
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="text is required")

    try:
        response = await llm_extraction.ainvoke([
            SystemMessage(content=VOICE_EXTRACTION_SYSTEM),
            HumanMessage(content=req.text.strip()),
        ])
        result = _parse_llm_json(response.content)
    except Exception as e:
        logger.error(f"Voice extraction failed: {e}")
        raise HTTPException(status_code=502, detail="Voice extraction service failed")

    if result.get("_parse_error"):
        raise HTTPException(status_code=502, detail="Could not parse extraction result")

    if result.get("case_type") not in ("primary", "ift"):
        result["case_type"] = "primary"

    primary_case = result.get("primary_case") or {}
    ift_form = result.get("ift_form") or {}

    # Never trust keys/values outside the known schema
    safe_primary = {
        k: (primary_case.get(k) or "")
        for k in ("incidentLocation", "contactNumber", "chiefComplaintText", "fullName", "age", "gender", "incidentTime")
    }
    safe_ift = {k: (ift_form.get(k) or "") for k in IFT_FIELD_KEYS}

    return {
        "status": "success",
        "case_type": result["case_type"],
        "primary_case": safe_primary,
        "ift_form": safe_ift,
    }


# ============================================
# Pydantic Models matching Frontend structure
# ============================================

class EmergencyContactModel(BaseModel):
    name: str = ""
    relationship: str = ""
    phoneNumber: str = ""

class AccidentDetailsModel(BaseModel):
    accidentDate: str
    accidentTime: str
    location: str
    latitude: float = None
    longitude: float = None
    accidentType: str = ""
    condition: str = ""
    priority: Optional[str] = None  # "Red" | "Orange" | "Yellow" | "Green"

class PatientRegistrationRequest(BaseModel):
    id: Optional[str] = None  # Patient ID / HMS ID — omit to have the server generate one
    fullName: str = "Unknown"
    age: str
    gender: str
    phoneNumber: str = ""
    address: str = ""
    accidentDetails: AccidentDetailsModel
    emergencyContact: EmergencyContactModel
    registrationDate: str
    status: str = "registered"

# ============================================
# Helper Functions
# ============================================
def generate_sys_user_id():
    """Generate a unique system user ID"""
    return f"SYS-{uuid.uuid4().hex[:12].upper()}"


def generate_patient_id() -> str:
    """
    Atomically generates a sequential, formatted patient ID: ED-YYYYMMDD-NNN.
    Uses a per-day counter document with findOneAndUpdate so concurrent
    registrations never collide — no separate "peek at next ID" call needed.
    """
    ist_offset = timezone(timedelta(hours=5, minutes=30))
    today_str = datetime.now(ist_offset).strftime("%Y%m%d")
    counter = patient_id_counters_collection.find_one_and_update(
        {"_id": today_str},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    seq = counter["seq"]
    return f"ED-{today_str}-{seq:03d}"



GOOGLE_API_KEY = "AIzaSyA3VwLT1IQxhUeGKxKstHw-dZ2uJ4Hta7w"
def get_distance_and_time(origin_lat, origin_lng, dest_lat, dest_lng):
    try:
        url = (
            "https://maps.googleapis.com/maps/api/distancematrix/json"
            f"?origins={origin_lat},{origin_lng}"
            f"&destinations={dest_lat},{dest_lng}"
            f"&mode=driving"
            f"&departure_time=now"
            f"&key={GOOGLE_API_KEY}"
        )

        res = requests.get(url).json()
        logger.info("hsdhshjas",res)
        logger.info("hsdhshjas",res)
        element = res["rows"][0]["elements"][0]

        distance = element["distance"]["text"]
        duration = element.get("duration_in_traffic", element["duration"])["text"]

        return distance, duration

    except:
        return "N/A", "N/A"


# 🔥 convert "1 hour 10 mins" → 70 mins
def duration_to_minutes(duration_str):
    if duration_str == "N/A":
        return 9999
    minutes = 0

    hours = re.search(r"(\d+)\s*hour", duration_str)
    mins = re.search(r"(\d+)\s*min", duration_str)

    if hours:
        minutes += int(hours.group(1)) * 60

    if mins:
        minutes += int(mins.group(1))

    return minutes


@router.get("/emergency/nearby-hospitals")
def get_emergency_hospitals(lat: float, lng: float):
    try:
        url = (
            f"https://maps.googleapis.com/maps/api/place/nearbysearch/json"
            f"?location={lat},{lng}"
            f"&radius=20000"
            f"&keyword=emergency hospital"
            f"&key={GOOGLE_API_KEY}"
        )

        response = requests.get(url)
        logger.info("hsdhshjas",response)
        data = response.json()

        if "results" not in data:
            raise HTTPException(status_code=500, detail="Invalid response from Google API")

        hospitals = []

        places = data["results"][:5]  # 🔥 limit

        for place in places:
            hospital_lat = place["geometry"]["location"]["lat"]
            hospital_lng = place["geometry"]["location"]["lng"]

            distance, duration = get_distance_and_time(
                lat, lng, hospital_lat, hospital_lng
            )

            hospitals.append({
                "hospital_name": place.get("name"),
                "latitude": hospital_lat,
                "longitude": hospital_lng,
                "address": place.get("vicinity"),
                "rating": place.get("rating", 0),
                "distance": distance,
                "duration": duration,
                "duration_minutes": duration_to_minutes(duration)  # 👈 for sorting
            })

        # 🚑 SORT BY FASTEST (LOWEST TIME)
        hospitals.sort(key=lambda x: x["duration_minutes"])

        return {
            "status": "success",
            "count": len(hospitals),
            "hospitals": hospitals
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
# ============================================
# Main Registration Endpoint
# ============================================
@router.post("/register")
async def register_patient(request: Request, patient_data: PatientRegistrationRequest):
    """
    Register a new patient from ambulance/emergency service
    Matches the React Native frontend structure
    Stores everything in a SINGLE collection
    """
    try:
        logger.info("=" * 60)
        logger.info("NEW PATIENT REGISTRATION REQUEST")
        logger.info("=" * 60)

        # If the frontend omitted an ID, the server issues a sequential one.
        # Server-side generation avoids the race condition of a separate
        # "peek at next ID" call followed by a delayed submit.
        if patient_data.id and patient_data.id.strip():
            patient_id = patient_data.id.strip()
            # Only caller-supplied IDs need a duplicate check — generated
            # IDs are unique by construction (atomic per-day counter).
            existing_patient = emergency_patients_collection.find_one({
                "patient_id": patient_id
            })
            if existing_patient:
                logger.warning(f"Patient with ID {patient_id} already exists")
                raise HTTPException(
                    status_code=400,
                    detail=f"Patient with Incident ID '{patient_id}' already exists. Please use a different Incident ID."
                )
        else:
            patient_id = generate_patient_id()

        logger.info(f"Patient ID: {patient_id}")
        logger.info(f"Full Name: {patient_data.fullName}")

        # Generate unique system user ID
        sys_user_id = generate_sys_user_id()
        
        # Process accident type
        accident_type = patient_data.accidentDetails.accidentType
        if accident_type == "Other" and patient_data.accidentDetails.accidentType:
            accident_type = patient_data.accidentDetails.accidentType
        
        # 🔥 SPLIT LOCATION STRING INTO LATITUDE AND LONGITUDE
        location_lat = None
        location_lng = None
        location_string = patient_data.accidentDetails.location or ""
        
        # Check if location contains comma (lat,lng format)
        if location_string and "," in location_string:
            try:
                parts = location_string.split(",")
                if len(parts) >= 2:
                    location_lat = float(parts[0].strip())
                    location_lng = float(parts[1].strip())
                    logger.info(f"Parsed location - Lat: {location_lat}, Lng: {location_lng}")
            except (ValueError, TypeError) as e:
                logger.warning(f"Could not parse location string: {location_string}, Error: {e}")
        
        # Also use the direct latitude/longitude if provided (from frontend)
        direct_lat = patient_data.accidentDetails.latitude
        direct_lng = patient_data.accidentDetails.longitude
        
        # Prefer direct values if available, otherwise use parsed values
        final_latitude = direct_lat if direct_lat is not None else location_lat
        final_longitude = direct_lng if direct_lng is not None else location_lng
        
        patient_document = {
            "patient_id": patient_id,
            "sys_user_id": sys_user_id,
            "fullName": patient_data.fullName,
            "age": patient_data.age,
            "gender": patient_data.gender,
            "phoneNumber": patient_data.phoneNumber,
            "address": patient_data.address,
            "ambulance_driver": None,
            "accidentDetails": {
                "accidentDate": patient_data.accidentDetails.accidentDate,
                "accidentTime": patient_data.accidentDetails.accidentTime,
                "location": patient_data.accidentDetails.location or (f"{final_latitude},{final_longitude}" if final_latitude is not None and final_longitude is not None else ""),
                "latitude": final_latitude,   # 🔥 Now properly set
                "longitude": final_longitude,  # 🔥 Now properly set
                "accidentType": accident_type,
                "condition": patient_data.accidentDetails.condition,
                "priority": patient_data.accidentDetails.priority
            },
            "emergencyContact": {
                "name": patient_data.emergencyContact.name,
                "relationship": patient_data.emergencyContact.relationship,
                "phoneNumber": patient_data.emergencyContact.phoneNumber
            },
            "metadata": {
                "registrationDate": patient_data.registrationDate,
                "status": patient_data.status,
                "created_at": datetime.now(),
                "updated_at": datetime.now(),
                "registration_source": "ambulance_mobile_app",
                "is_active": True
            }
        }
        
        # Insert into database
        result = emergency_patients_collection.insert_one(patient_document)
        
        logger.info(f"Patient registered successfully with ID: {patient_id}")
        logger.info(f"Location saved - Lat: {final_latitude}, Lng: {final_longitude}")
        
        # Return the registered patient data
        registered_patient = emergency_patients_collection.find_one(
            {"_id": result.inserted_id},
            {"_id": 0}
        )

        # Notify any open dashboard tabs so the patient list updates live
        # instead of waiting for its own poll timer to catch up. Runs in a
        # separate service (ambulance_routes.py), hence the HTTP call
        # rather than a direct function call — same cross-container
        # pattern as the doctor/driver notify calls used elsewhere.
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                await client.post(
                    "https://doctorassist.ai/api/hms/users/ambulance/notify-new-patient",
                    json={"patient_id": patient_id, "fullName": patient_data.fullName},
                )
        except Exception as notify_err:
            logger.warning(f"New-patient dashboard notify failed (non-critical): {notify_err}")

        return {
            "status": "success",
            "message": "Patient registered successfully",
            "patient_id": patient_id,
            "sys_user_id": sys_user_id,
            "registration_id": str(result.inserted_id),
            "patient_data": registered_patient,
            "is_existing": False
        }
 
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Patient Registration Failed: {str(e)}")
        logger.exception(e)
        raise HTTPException(status_code=500, detail=f"Registration failed: {str(e)}")
# ============================================
# Additional Endpoints for Frontend
# ============================================
@router.get("/get_all_patients")
async def get_all_patients(
    limit: int = 100,
    skip: int = 0,
    search: Optional[str] = None
):

    try:

        logger.info(
            f"Fetching patients "
            f"(limit={limit}, skip={skip})"
        )

        # ✅ prevent huge payloads
        if limit > 200:
            limit = 200

        query = {}

        if search:

            query["$or"] = [

                {
                    "fullName": {
                        "$regex": search,
                        "$options": "i"
                    }
                },

                {
                    "patient_id": {
                        "$regex": search,
                        "$options": "i"
                    }
                },

                {
                    "phoneNumber": {
                        "$regex": search,
                        "$options": "i"
                    }
                }
            ]

        # ✅ return only required fields
        projection = {

            "_id": 0,

            "patient_id": 1,
            "fullName": 1,
            "age": 1,
            "gender": 1,
            "phoneNumber": 1,
            "address": 1,
            "status": 1,
            "ambulance_driver": 1,
            "emergencyContact": 1,

            "accidentDetails.accidentDate": 1,
            "accidentDetails.accidentTime": 1,
            "accidentDetails.location": 1,
            "accidentDetails.latitude": 1,
            "accidentDetails.longitude": 1,
            "accidentDetails.accidentType": 1,
            "accidentDetails.priority": 1,
            "accidentDetails.condition": 1,

            "metadata.registrationDate": 1,
            "metadata.created_at": 1
        }

        patients = list(

            emergency_patients_collection.find(
                query,
                projection
            )

            # ✅ FIXED SORT
            .sort("metadata.created_at", -1)

            .skip(skip)

            .limit(limit)
        )

        # ✅ frontend compatibility
        for patient in patients:

            metadata = patient.get("metadata", {})

            patient["registrationDate"] = metadata.get(
                "registrationDate"
            )

        total_count = emergency_patients_collection.count_documents(query)

        return {

            "status": "success",

            "total": total_count,

            "patients": patients
        }

    except Exception as e:

        logger.error(
            f"Failed to fetch patients: {str(e)}"
        )

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )

@router.get("/patient/{patient_id}")
async def get_patient_by_id(patient_id: str):
    """
    Get a specific patient by ID from SINGLE collection
    """
    try:
        logger.info(f"Fetching patient with ID: {patient_id}")
        
        patient = emergency_patients_collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0}
        )
        
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found")
        
        return {
            "status": "success",
            "patient": patient
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch patient: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/patient/phone/{phone_number}")
async def get_patient_by_phone(phone_number: str):
    """
    Get a specific patient by phone number
    """
    try:
        logger.info(f"Fetching patient with phone: {phone_number}")
        
        patient = emergency_patients_collection.find_one(
            {"phoneNumber": phone_number},
            {"_id": 0}
        )
        
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found")
        
        return {
            "status": "success",
            "patient": patient
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch patient: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/patient/{patient_id}")
async def update_patient(patient_id: str, patient_data: PatientRegistrationRequest):
    """
    Update an existing patient in SINGLE collection
    """
    try:
        logger.info(f"Updating patient with ID: {patient_id}")
        
        # Check if patient exists
        existing = emergency_patients_collection.find_one({"patient_id": patient_id})
        if not existing:
            raise HTTPException(status_code=404, detail="Patient not found")
        
        # Process accident type
        accident_type = patient_data.accidentDetails.accidentType
        if accident_type == "Other" and patient_data.accidentDetails.accidentType:
            accident_type = patient_data.accidentDetails.accidentType
        
        # Update document
        update_data = {
            "fullName": patient_data.fullName,
            "age": patient_data.age,
            "gender": patient_data.gender,
            "phoneNumber": patient_data.phoneNumber,
            "address": patient_data.address,
            "accidentDetails": {
                "accidentDate": patient_data.accidentDetails.accidentDate,
                "accidentTime": patient_data.accidentDetails.accidentTime,
                "location": patient_data.accidentDetails.location,
                "accidentType": accident_type,
                "condition": patient_data.accidentDetails.condition
            },
            "emergencyContact": {
                "name": patient_data.emergencyContact.name,
                "relationship": patient_data.emergencyContact.relationship,
                "phoneNumber": patient_data.emergencyContact.phoneNumber
            },
            "status": patient_data.status,
            "updated_at": datetime.now()
        }
        
        emergency_patients_collection.update_one(
            {"patient_id": patient_id},
            {"$set": update_data}
        )
        
        # Get updated patient
        updated_patient = emergency_patients_collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0}
        )
        
        logger.info(f"Patient updated successfully: {patient_id}")
        
        return {
            "status": "success",
            "message": "Patient updated successfully",
            "patient_id": patient_id,
            "patient": updated_patient
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update patient: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/patient/{patient_id}")
async def delete_patient(patient_id: str):
    """
    Delete a patient record from SINGLE collection
    """
    try:
        logger.info(f"Deleting patient with ID: {patient_id}")
        
        result = emergency_patients_collection.delete_one({"patient_id": patient_id})
        
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Patient not found")
        
        logger.info(f"Patient deleted successfully: {patient_id}")
        
        return {
            "status": "success",
            "message": "Patient deleted successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete patient: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/stats")
async def get_registration_stats():
    """
    Get registration statistics from SINGLE collection
    """
    try:
        logger.info("Fetching registration statistics")
        
        total_patients = emergency_patients_collection.count_documents({})
        
        # Gender statistics
        male_count = emergency_patients_collection.count_documents({"gender": "Male"})
        female_count = emergency_patients_collection.count_documents({"gender": "Female"})
        other_count = emergency_patients_collection.count_documents({"gender": "Other"})
        
        # Accident type statistics
        pipeline = [
            {"$match": {"accidentDetails.accidentType": {"$exists": True, "$ne": ""}}},
            {"$group": {
                "_id": "$accidentDetails.accidentType",
                "count": {"$sum": 1}
            }}
        ]
        
        accident_types = list(emergency_patients_collection.aggregate(pipeline))
        
        accident_stats = {}
        for item in accident_types:
            accident_stats[item["_id"] or "Not Specified"] = item["count"]
        
        # Today's registrations
        today = datetime.now().strftime("%Y-%m-%d")
        today_registrations = emergency_patients_collection.count_documents({
            "registrationDate": {"$regex": f"^{today}"}
        })
        
        return {
            "status": "success",
            "stats": {
                "total_patients": total_patients,
                "gender_distribution": {
                    "Male": male_count,
                    "Female": female_count,
                    "Other": other_count
                },
                "accident_type_distribution": accident_stats,
                "today_registrations": today_registrations
            }
        }
        
    except Exception as e:
        logger.error(f"Failed to fetch stats: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/search")
async def search_patients(
    query: str,
    limit: int = 50
):
    """
    Search patients by name, ID, or phone number
    """
    try:
        logger.info(f"Searching patients with query: {query}")
        
        patients = list(emergency_patients_collection.find(
            {
                "$or": [
                    {"fullName": {"$regex": query, "$options": "i"}},
                    {"patient_id": {"$regex": query, "$options": "i"}},
                    {"phoneNumber": {"$regex": query, "$options": "i"}},
                    {"address": {"$regex": query, "$options": "i"}}
                ]
            },
            {"_id": 0}
        ).limit(limit))
        
        return {
            "status": "success",
            "total": len(patients),
            "patients": patients
        }
        
    except Exception as e:
        logger.error(f"Failed to search patients: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# ============================================
# Health Check Endpoint
# ============================================

@router.get("/health")
async def health_check():
    """
    Health check endpoint
    """
    try:
        # Test database connection
        emergency_patients_collection.count_documents({})
        db_status = "connected"
    except:
        db_status = "disconnected"
    
    return {
        "status": "healthy",
        "service": "patient_registration_api",
        "timestamp": datetime.now().isoformat(),
        "database": db_status,
        "collection": "patients"
    }

@router.delete("/delete_patient/{patient_id}")
async def delete_patient(patient_id: str):
    """
    Delete a patient record by patient_id from SINGLE collection
    """
    try:
        logger.info(f"Attempting to delete patient with ID: {patient_id}")
        
        # Check if patient exists
        existing_patient = emergency_patients_collection.find_one({"patient_id": patient_id})
        
        if not existing_patient:
            logger.warning(f"Patient with ID {patient_id} not found")
            raise HTTPException(status_code=404, detail=f"Patient with ID {patient_id} not found")
        
        # Delete the patient
        result = emergency_patients_collection.delete_one({"patient_id": patient_id})
        
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Failed to delete patient")
        
        logger.info(f"Patient deleted successfully: {patient_id}")
        
        return {
            "status": "success",
            "message": f"Patient with ID {patient_id} deleted successfully",
            "patient_id": patient_id,
            "deleted_count": result.deleted_count
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete patient: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Deletion failed: {str(e)}")
@router.delete("/delete_all_patients")
async def delete_all_patients():
    """
    DELETE ALL PATIENTS - NO CONFIRMATION REQUIRED
    WARNING: This is dangerous for production use!
    """
    try:
        logger.warning("=" * 60)
        logger.warning("DELETE ALL PATIENTS REQUESTED - NO CONFIRMATION")
        logger.warning("=" * 60)
        
        total_patients_before = emergency_patients_collection.count_documents({})
        
        if total_patients_before == 0:
            return {
                "status": "success",
                "message": "No patients found to delete",
                "deleted_count": 0
            }
        
        result = emergency_patients_collection.delete_many({})
        
        return {
            "status": "success",
            "message": f"Successfully deleted all {result.deleted_count} patients",
            "deleted_count": result.deleted_count,
            "total_before": total_patients_before
        }
        
    except Exception as e:
        logger.error(f"Failed to delete all patients: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Deletion failed: {str(e)}")

@router.get("/get_today_patients")
async def get_today_patients():
    """
    Get only today's registered patients from SINGLE collection
    """
    try:
        logger.info("Fetching today's patients")
        
        # Get today's date in YYYY-MM-DD format
        today = datetime.now().strftime("%Y-%m-%d")
        
        logger.info(f"Filtering for date: {today}")
        
        # Query patients registered today
        patients = list(emergency_patients_collection.find(
            {
                "metadata.registrationDate": today
            },
            {"_id": 0}
        ).sort("created_at", -1))
        
        logger.info(f"Found {len(patients)} patients registered today")
        
        return {
            "status": "success",
            "date": today,
            "total": len(patients),
            "patients": patients
        }
        
    except Exception as e:
        logger.error(f"Failed to fetch today's patients: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# UPDATE PATIENT STATUS
# ============================================

class UpdatePatientStatusRequest(BaseModel):
    patient_id: str
    status: str

@router.post("/update-status")
async def update_patient_status(
    request: UpdatePatientStatusRequest
):
    """
    Update patient status
    """

    try:

        logger.info(
            f"🔄 Updating patient status: "
            f"{request.patient_id} -> {request.status}"
        )

        result = emergency_patients_collection.update_one(

            {
                "patient_id": request.patient_id
            },

            {
                "$set": {

                    "status": request.status,

                    "metadata.status": request.status,

                    "updated_at": datetime.now()
                }
            }
        )

        logger.info(
            f"✅ Modified count: "
            f"{result.modified_count}"
        )

        if result.modified_count == 0:

            return {
                "status": "failed",
                "message": "Patient not found"
            }

        return {

            "status": "success",

            "patient_id": request.patient_id,

            "updated_status": request.status
        }

    except Exception as e:

        logger.error(
            f"❌ Failed to update status: {str(e)}"
        )

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )

from fastapi import Query

@router.get("/get_today_patients-with-timestamp-and-withotut-limit")
async def get_today_patients(
    date: Optional[str] = Query(None, description="YYYY-MM-DD — filter to a single date"),
    start_date: Optional[str] = Query(None, description="YYYY-MM-DD — range start (inclusive)"),
    end_date: Optional[str] = Query(None, description="YYYY-MM-DD — range end (inclusive)")
):
    try:
        # Get today's date in IST (UTC+5:30)
        ist_offset = timezone(timedelta(hours=5, minutes=30))
        today_ist = datetime.now(ist_offset).strftime("%Y-%m-%d")

        # Decide what date filter to apply
        if start_date and end_date:
            date_filter = {"$gte": start_date, "$lte": end_date}
            logger.info(f"Fetching patients for range: {start_date} to {end_date}")
        elif date:
            date_filter = date
            logger.info(f"Fetching patients for single date: {date}")
        else:
            date_filter = today_ist
            logger.info(f"Fetching today's patients for date: {today_ist} (IST)")

        # Filter by registrationDate in metadata OR top-level registrationDate
        query = {
            "$or": [
                {"metadata.registrationDate": date_filter},
                {"registrationDate": date_filter}
            ]
        }

        projection = {
            "_id": 0,
            "patient_id": 1,
            "fullName": 1,
            "age": 1,
            "gender": 1,
            "phoneNumber": 1,
            "address": 1,
            "status": 1,
            "ambulance_driver": 1,
            "emergencyContact": 1,
            "accidentDetails.accidentDate": 1,
            "accidentDetails.accidentTime": 1,
            "accidentDetails.location": 1,
            "accidentDetails.latitude": 1,
            "accidentDetails.longitude": 1,
            "accidentDetails.accidentType": 1,
            "accidentDetails.priority": 1,
            "accidentDetails.condition": 1,
            "metadata.registrationDate": 1,
            "metadata.created_at": 1
        }

        patients = list(
            emergency_patients_collection.find(query, projection)
            .sort("metadata.created_at", -1)
            .limit(1000)
        )

        # Frontend compatibility — expose registrationDate at top level
        for patient in patients:
            metadata = patient.get("metadata", {})
            patient["registrationDate"] = metadata.get("registrationDate") or patient.get("registrationDate")

        total_count = len(patients)

        logger.info(f"Found {total_count} patients")

        return {
            "status": "success",
            "date": date_filter if isinstance(date_filter, str) else f"{start_date} to {end_date}",
            "total": total_count,
            "patients": patients
        }

    except Exception as e:
        logger.error(f"Failed to fetch patients: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))