from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timezone, timedelta
from bson import ObjectId
import logging
import sys
import uuid
import os
from passlib.context import CryptContext
from dotenv import load_dotenv
from pymongo import MongoClient
import requests
import re

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

class PatientRegistrationRequest(BaseModel):
    id: str  # Patient ID / HMS ID from frontend
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
        logger.info(f"Patient ID: {patient_data.id}")
        logger.info(f"Full Name: {patient_data.fullName}")
        
        # Check if patient already exists by ID
        existing_patient = emergency_patients_collection.find_one({
            "patient_id": patient_data.id
        })
        
        if existing_patient:
            logger.warning(f"Patient with ID {patient_data.id} already exists")
            raise HTTPException(
                status_code=400, 
                detail=f"Patient with Incident ID '{patient_data.id}' already exists. Please use a different Incident ID."
            )
        
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
        
        # Create the complete patient document
        patient_document = {
            "patient_id": patient_data.id,
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
                # "location": patient_data.accidentDetails.location,
                "location": f"{final_latitude},{final_longitude}",  # 🔥 Store as "lat,lng" string for compatibility
                "latitude": final_latitude,   # 🔥 Now properly set
                "longitude": final_longitude,  # 🔥 Now properly set
                "accidentType": accident_type,
                "condition": patient_data.accidentDetails.condition
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
        
        logger.info(f"Patient registered successfully with ID: {patient_data.id}")
        logger.info(f"Location saved - Lat: {final_latitude}, Lng: {final_longitude}")
        
        # Return the registered patient data
        registered_patient = emergency_patients_collection.find_one(
            {"_id": result.inserted_id},
            {"_id": 0}
        )
        
        return {
            "status": "success",
            "message": "Patient registered successfully",
            "patient_id": patient_data.id,
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