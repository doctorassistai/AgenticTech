from fastapi import APIRouter, Request, HTTPException
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime
from bson import ObjectId
import logging
import os
from gateway.routes.login import get_current_user
from shared.audit.schema import AuditEvent
from shared.audit.utils import emit_audit
import uuid
from fastapi import Depends
from datetime import datetime, timezone

# -------------------------------------------------------------------
# Router
# -------------------------------------------------------------------

router = APIRouter(
    prefix="/hms/admin",
    tags=["admin"]
)

# -------------------------------------------------------------------
# Logging
# -------------------------------------------------------------------

logger = logging.getLogger("admin.audit")
logger.setLevel(logging.INFO)

# -------------------------------------------------------------------
# MongoDB (ASYNC – Motor)
# -------------------------------------------------------------------

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "audits"  # ✅ FIXED (was 'audts')

mongo_client = AsyncIOMotorClient(MONGO_URI)
database = mongo_client[MONGO_DB]
audit_collection = database["audit_logs"]

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
ACCESS_TOKEN_EXPIRE_DAYS = int(os.getenv("ACCESS_TOKEN_EXPIRE_DAYS", 1))

# -------------------------------------------------------------------
# TEMP user (replace with real auth later)
# -------------------------------------------------------------------

current_user = {
    "sys_user_id": "rem_unknown_id",
    "role": "rem_unknown_type"
}

# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------

def convert_mongo_document(doc: dict) -> dict:
    """
    Convert MongoDB document to JSON-safe dict.
    """
    doc["_id"] = str(doc["_id"])
    return doc




def require_system_admin(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "system_admin":
        raise HTTPException(
            status_code=403,
            detail="System admin access required"
        )
    return current_user

@router.get("/verify")
async def verify_admin(
    current_user: dict = Depends(require_system_admin)
):
    return {
        "status": "authenticated",
        "admin": {
            "sys_user_id": current_user["sys_user_id"],
            "username": current_user["username"],
            "role": current_user["role"]
        }
    }


# -------------------------------------------------------------------
# Routes
# -------------------------------------------------------------------

@router.get("/get_all_audits")
async def get_all_audits(request: Request):
    """
    Fetch all audit log entries.
    READ-ONLY | SECURITY SENSITIVE
    """
    try:
        logger.info("Fetching all audit logs")

        # ------------------ AUDIT: INIT ------------------

        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="INFO",
            source={"service": "gateway", "component": "audit"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": getattr(request.state, "trace_id", None),
                "ip": request.client.host if request.client else None,
                "endpoint": "/get_all_audits"
            },
            clinical_context={
                "data_sensitivity": "AUDIT"
            },
            action={
                "type": "FETCH_ALL_AUDITS",
                "status": "INITIATED"
            }
        ))

        # ------------------ QUERY ------------------

        cursor = audit_collection.find({}).sort("timestamp", -1)

        audits = []
        async for audit in cursor:
            audits.append(convert_mongo_document(audit))

        # ------------------ AUDIT: SUCCESS ------------------

        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="INFO",
            source={"service": "gateway", "component": "audit"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": getattr(request.state, "trace_id", None),
                "ip": request.client.host if request.client else None,
                "endpoint": "/get_all_audits"
            },
            clinical_context={
                "data_sensitivity": "AUDIT"
            },
            action={
                "type": "FETCH_ALL_AUDITS",
                "status": "SUCCESS",
                "total_records": len(audits)
            }
        ))

        return {
            "status": "success",
            "total_audits": len(audits),
            "audits": audits
        }

    except Exception as e:
        logger.exception("Error fetching audit logs")

        # ------------------ AUDIT: ERROR ------------------

        emit_audit(request.app, AuditEvent(
            timestamp=datetime.utcnow(),
            level="ERROR",
            source={"service": "gateway", "component": "audit"},
            actor={
                "type": current_user["role"],
                "id": current_user["sys_user_id"]
            },
            context={
                "trace_id": getattr(request.state, "trace_id", None),
                "ip": request.client.host if request.client else None,
                "endpoint": "/get_all_audits"
            },
            clinical_context={
                "data_sensitivity": "AUDIT"
            },
            action={
                "type": "FETCH_ALL_AUDITS",
                "status": "ERROR"
            }
        ))

        raise HTTPException(
            status_code=500,
            detail="Failed to fetch audit logs"
        )


from typing import Optional
from fastapi import Query
from datetime import datetime

@router.get("/audits/search")
async def search_audits(
    level: Optional[str] = None,
    service: Optional[str] = None,
    actor_id: Optional[str] = None,
    action_type: Optional[str] = None,
    endpoint: Optional[str] = None,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
    skip: int = 0,
    limit: int = Query(50, le=200),
):
    query = {}

    if level:
        query["level"] = level

    if service:
        query["source.service"] = service

    if actor_id:
        query["actor.id"] = actor_id

    if action_type:
        query["action.type"] = action_type

    if endpoint:
        query["context.endpoint"] = endpoint

    if start_time or end_time:
        query["timestamp"] = {}
        if start_time:
            query["timestamp"]["$gte"] = start_time.isoformat()
        if end_time:
            query["timestamp"]["$lte"] = end_time.isoformat()

    cursor = (
        audit_collection.find(query)
        .sort("timestamp", -1)
        .skip(skip)
        .limit(limit)
    )

    audits = []
    async for audit in cursor:
        audits.append(convert_mongo_document(audit))

    total = await audit_collection.count_documents(query)

    return {
        "status": "success",
        "total": total,
        "skip": skip,
        "limit": limit,
        "audits": audits,
    }


# Add these endpoints to your existing admin.py file

@router.get("/get_hospitals_with_stats")
async def get_hospitals_with_stats(
    current_user: dict = Depends(require_system_admin),
    request: Request = None
):
    """
    Get all hospitals with doctor count and stats.
    """
    try:
        logger.info("Fetching hospitals with stats")
        
        # Connect to your database
        MONGO_URI = os.getenv("MONGO_URI")
        MONGO_DB = "doctorassistai"
        mongo_client = AsyncIOMotorClient(MONGO_URI)
        database = mongo_client[MONGO_DB]
        
        # Get all hospitals
        hospitals_cursor = database["hospital_users"].find({})
        hospitals = []
        
        async for hospital in hospitals_cursor:
            hospital_id = hospital.get("sys_user_id")
            
            # Count doctors for this hospital
            doctors_count = await database["doctor_users"].count_documents({
                "hospital_id": hospital_id
            })
            
            # Count patients for this hospital
            patients_count = await database["patient_users"].count_documents({
                "hospital_id": hospital_id
            })
            
            # Count appointments for doctors in this hospital
            # First get all doctor IDs for this hospital
            doctor_ids_cursor = database["doctor_users"].find(
                {"hospital_id": hospital_id},
                {"sys_user_id": 1}
            )
            doctor_ids = []
            async for doc in doctor_ids_cursor:
                doctor_ids.append(doc["sys_user_id"])
            
            # Count appointments for these doctors
            appointments_count = 0
            if doctor_ids:
                pipeline = [
                    {"$match": {"appointments.doctor_id": {"$in": doctor_ids}}},
                    {"$unwind": "$appointments"},
                    {"$match": {"appointments.doctor_id": {"$in": doctor_ids}}},
                    {"$group": {"_id": None, "count": {"$sum": 1}}}
                ]
                appointments_result = await database["patient_appointments"].aggregate(pipeline).to_list(length=1)
                if appointments_result:
                    appointments_count = appointments_result[0].get("count", 0)
            
            hospital_data = convert_mongo_document(hospital)
            hospital_data.update({
                "doctors_count": doctors_count,
                "patients_count": patients_count,
                "appointments_count": appointments_count
            })
            
            hospitals.append(hospital_data)
        
        return {
            "status": "success",
            "hospitals": hospitals
        }
        
    except Exception as e:
        logger.exception("Error fetching hospitals with stats")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/get_hospital_doctors/{hospital_id}")
async def get_hospital_doctors(
    hospital_id: str,
    current_user: dict = Depends(require_system_admin),
    request: Request = None
):
    """
    Get all doctors for a specific hospital with their stats.
    """
    try:
        logger.info(f"Fetching doctors for hospital: {hospital_id}")
        
        # Connect to your database
        MONGO_URI = os.getenv("MONGO_URI")
        MONGO_DB = "doctorassistai"
        mongo_client = AsyncIOMotorClient(MONGO_URI)
        database = mongo_client[MONGO_DB]
        
        # Verify hospital exists
        hospital = await database["hospital_users"].find_one({"sys_user_id": hospital_id})
        if not hospital:
            raise HTTPException(status_code=404, detail="Hospital not found")
        
        # Get doctors for this hospital
        doctors_cursor = database["doctor_users"].find({"hospital_id": hospital_id})
        doctors = []
        
        async for doctor in doctors_cursor:
            doctor_id = doctor.get("sys_user_id")
            
            # Count patients for this doctor
            patients_count = await database["patient_users"].count_documents({
                "doctor_id": doctor_id
            })
            
            # Count appointments for this doctor
            pipeline = [
                {"$match": {"appointments.doctor_id": doctor_id}},
                {"$unwind": "$appointments"},
                {"$match": {"appointments.doctor_id": doctor_id}},
                {"$group": {"_id": None, "count": {"$sum": 1}}}
            ]
            appointments_result = await database["patient_appointments"].aggregate(pipeline).to_list(length=1)
            appointments_count = appointments_result[0].get("count", 0) if appointments_result else 0
            
            # Get today's appointments count
            today = datetime.now().strftime("%Y-%m-%d")
            today_pipeline = [
                {"$match": {"appointments.doctor_id": doctor_id, "appointments.date": today}},
                {"$unwind": "$appointments"},
                {"$match": {"appointments.doctor_id": doctor_id, "appointments.date": today}},
                {"$group": {"_id": None, "count": {"$sum": 1}}}
            ]
            today_appointments_result = await database["patient_appointments"].aggregate(today_pipeline).to_list(length=1)
            today_appointments_count = today_appointments_result[0].get("count", 0) if today_appointments_result else 0
            
            doctor_data = convert_mongo_document(doctor)
            doctor_data.update({
                "patients_count": patients_count,
                "total_appointments": appointments_count,
                "today_appointments": today_appointments_count
            })
            
            doctors.append(doctor_data)
        
        return {
            "status": "success",
            "hospital_name": hospital.get("name"),
            "total_doctors": len(doctors),
            "doctors": doctors
        }
        
    except Exception as e:
        logger.exception("Error fetching hospital doctors")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/server-time")
async def get_server_time(
    current_user: dict = Depends(require_system_admin)
):
    """
    Returns current server time (UTC).
    """
    now_utc = datetime.now(timezone.utc)

    return {
        "server_time_utc": now_utc.isoformat(),
        "timestamp": int(now_utc.timestamp())
    }