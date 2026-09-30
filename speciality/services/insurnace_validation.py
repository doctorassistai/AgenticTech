from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Query
from pydantic import BaseModel
from pymongo import MongoClient, TEXT
from motor.motor_asyncio import AsyncIOMotorClient
from typing import List, Dict, Any, Optional
import pandas as pd
import os
import io
import re
import json
import hashlib
from datetime import datetime
import logging

logger = logging.getLogger(__name__)
# ============================================================
# ROUTER
# ============================================================

router = APIRouter(
    prefix="/insurance",
    tags=["insurance"]
)

# ============================================================
# MONGODB CONFIGURATION
# ============================================================

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "doctorassistai")

# Async MongoDB client
async_mongo_client = AsyncIOMotorClient(MONGO_URI)
async_db = async_mongo_client[MONGO_DB]
async_claims_collection = async_db["insurance_claims"]
async_files_collection = async_db["insurance_files"]

# Sync MongoDB client (for index creation)
sync_mongo_client = MongoClient(MONGO_URI)
sync_db = sync_mongo_client[MONGO_DB]
sync_claims_collection = sync_db["insurance_claims"]
sync_files_collection = sync_db["insurance_files"]
doctor_user_collection = sync_db["doctor_users"]
# ============================================================
# CREATE INDEXES FOR FAST SEARCH
# ============================================================

def create_indexes():
    """Create indexes for fast search"""
    try:
        # Text index for full-text search
        sync_claims_collection.create_index([
            ("icd_description", TEXT),
            ("service_description", TEXT)
        ], name="text_search_idx")
        
        # Regular indexes for filtering
        sync_claims_collection.create_index("doctor_id")
        sync_claims_collection.create_index("file_id")
        sync_claims_collection.create_index("status")
        sync_claims_collection.create_index([("doctor_id", 1), ("file_id", 1)])
        
        sync_files_collection.create_index("doctor_id")
        sync_files_collection.create_index("file_id")
        sync_files_collection.create_index([("doctor_id", 1), ("file_id", 1)], unique=True)
        
        print("✅ MongoDB indexes created")
    except Exception as e:
        print(f"⚠️ Index creation: {e}")

create_indexes()

# ============================================================
# REQUEST MODELS
# ============================================================

class SearchRequest(BaseModel):
    diagnosis: str = ""
    investigation: str = ""
    doctor_id: Optional[str] = None       # ✅ used to resolve hospital_id
    patient_id: Optional[str] = None 

class DeleteRequest(BaseModel):
    doctor_id: str
    file_id: Optional[str] = None

# ============================================================
# HELPER FUNCTIONS
# ============================================================

def _generate_file_id(filename: str, doctor_id: str) -> str:
    unique_string = f"{filename}_{doctor_id}_{datetime.now().isoformat()}"
    return hashlib.md5(unique_string.encode()).hexdigest()[:16]

def _normalize_text(text: str) -> str:
    if not text:
        return ""
    text = str(text)
    text = re.sub(r'[^\w\s]', ' ', text)
    text = ' '.join(text.split())
    return text.strip()

def _sanitize_column_name(col: str) -> str:
    if not col:
        return ""
    cleaned = re.sub(r'[^\w\s]', ' ', str(col))
    cleaned = ' '.join(cleaned.split())
    return cleaned.strip()

def _get_status(row: Dict) -> Dict:
    status = {
        "status": "Unknown",
        "denial_reason": "",
        "approved_amount": 0,
        "claimed_amount": 0,
        "final_remarks": ""
    }
    
    for field in ["STATUS", "status"]:
        if field in row:
            status["status"] = str(row[field])
            break
    
    for field in ["DENIAL REASON", "denial_reason"]:
        if field in row:
            status["denial_reason"] = str(row[field]) if row[field] else ""
            break
    
    for field in ["FINAL REMARKS", "final_remarks"]:
        if field in row:
            status["final_remarks"] = str(row[field]) if row[field] else ""
            break
    
    for field in ["APPROVED AMOUNT", "approved_amount", " APPROVED AMOUNT"]:
        if field in row and row[field]:
            try:
                status["approved_amount"] = float(row[field])
            except:
                pass
    
    for field in ["AMOUNT CLAIMED", "amount_claimed"]:
        if field in row and row[field]:
            try:
                status["claimed_amount"] = float(row[field])
            except:
                pass
    
    return status

def _read_excel_file(content: bytes, filename: str) -> pd.DataFrame:
    """Read Excel file with fallbacks"""
    filename_lower = filename.lower()
    
    if filename_lower.endswith('.csv'):
        return pd.read_csv(io.BytesIO(content))
    
    if filename_lower.endswith('.xls'):
        try:
            return pd.read_excel(io.BytesIO(content), sheet_name=0, engine='xlrd')
        except Exception as e:
            print(f"xlrd failed, trying openpyxl: {e}")
    
    return pd.read_excel(io.BytesIO(content), sheet_name=0, engine='openpyxl')

# ============================================================
# 📤 UPLOAD ENDPOINT - Upload 20+ Excel Files
# ============================================================

@router.post("/upload")
async def upload_insurance_files(
    hospital_id: str = Form(...),
    files: List[UploadFile] = File(...)
):
    """
    Upload 20+ insurance Excel files.

    Extracts ICD DESCRIPTION + SERVICE DESCRIPTION into MongoDB.
    Supports: .xlsx, .xls, .csv

    Ownership is by HOSPITAL only — no doctor_id, no patient_id.
    """

    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    if not hospital_id:
        raise HTTPException(status_code=400, detail="hospital_id is required")

    uploaded_files = []
    errors = []

    for file in files:
        try:
            filename = file.filename.lower()

            if not any(filename.endswith(ext) for ext in ['.xlsx', '.xls', '.csv']):
                errors.append({
                    "filename": file.filename,
                    "error": "Unsupported format. Use .xlsx, .xls, or .csv"
                })
                continue

            content = await file.read()

            # Read Excel
            try:
                df = _read_excel_file(content, file.filename)
            except Exception as e:
                errors.append({
                    "filename": file.filename,
                    "error": f"Failed to read file: {str(e)}"
                })
                continue

            df = df.dropna(how="all").dropna(axis=1, how="all")

            if df.empty:
                errors.append({"filename": file.filename, "error": "File is empty"})
                continue

            # file_id is derived from hospital_id + filename
            file_id = _generate_file_id(file.filename, hospital_id)

            # Convert to records
            records = []
            for idx, row in df.iterrows():
                row_dict = {}
                for col in df.columns:
                    value = row[col]
                    if pd.isna(value):
                        value = None
                    elif isinstance(value, (datetime, pd.Timestamp)):
                        value = value.isoformat()
                    row_dict[_sanitize_column_name(col)] = value

                # Extract key fields
                icd = _normalize_text(row_dict.get("ICD DESCRIPTION", ""))
                service = _normalize_text(row_dict.get("SERVICE DESCRIPTION", ""))

                status_info = _get_status(row_dict)

                records.append({
                    "hospital_id": hospital_id,      # ✅ PRIMARY KEY
                    "file_id": file_id,
                    "filename": file.filename,
                    "row_index": idx,
                    "icd_description": icd,
                    "service_description": service,
                    "status": status_info["status"],
                    "denial_reason": status_info["denial_reason"],
                    "approved_amount": status_info["approved_amount"],
                    "claimed_amount": status_info["claimed_amount"],
                    "row_data": row_dict,
                    "uploaded_at": datetime.utcnow()
                })

            # Insert into MongoDB
            if records:
                await async_claims_collection.insert_many(records)

            # Save file metadata
            await async_files_collection.update_one(
                {"hospital_id": hospital_id, "file_id": file_id},
                {
                    "$set": {
                        "hospital_id": hospital_id,   # ✅ PRIMARY KEY
                        "file_id": file_id,
                        "filename": file.filename,
                        "row_count": len(records),
                        "columns": list(df.columns),
                        "uploaded_at": datetime.utcnow()
                    }
                },
                upsert=True
            )

            uploaded_files.append({
                "file_id": file_id,
                "filename": file.filename,
                "row_count": len(records),
                "columns": list(df.columns),
                "status": "success"
            })

            print(f"✅ [{hospital_id}] {file.filename}: {len(records)} rows inserted")

        except Exception as e:
            errors.append({"filename": file.filename, "error": str(e)})

    return {
        "status": "success",
        "hospital_id": hospital_id,
        "uploaded_files": uploaded_files,
        "errors": errors,
        "total_uploaded": len(uploaded_files),
        "total_errors": len(errors)
    }
# ============================================================
# 🔍 SEARCH ENDPOINT - Search by Diagnosis + Investigation
# ============================================================

@router.post("/search")
async def search_claims(request: SearchRequest):
    """
    Search insurance claims by diagnosis and investigation.

    Flow:
        doctor_id (sys_user_id)
            -> doctor_users
            -> hospital_id
            -> insurance claims

    Insurance claims are owned by hospital_id, not doctor_id.
    """

    if not request.diagnosis and not request.investigation:
        raise HTTPException(
            status_code=400,
            detail="At least one of 'diagnosis' or 'investigation' is required"
        )

    # ---------------------------------------------------------
    # 1. Resolve hospital_id from doctor_id
    # ---------------------------------------------------------

    hospital_id = None

    if request.doctor_id:
        doctor = doctor_user_collection.find_one({
            "sys_user_id": request.doctor_id
        })

        if not doctor:
            raise HTTPException(
                status_code=404,
                detail=f"Doctor not found for sys_user_id: {request.doctor_id}"
            )

        hospital_id = doctor.get("hospital_id")

        if not hospital_id:
            raise HTTPException(
                status_code=400,
                detail=f"No hospital_id associated with doctor: {request.doctor_id}"
            )

    # ---------------------------------------------------------
    # 2. Build claims query
    # ---------------------------------------------------------

    query = {}
    conditions = []

    # Hospital filtering
    if hospital_id:
        query["hospital_id"] = hospital_id

    # Diagnosis
    if request.diagnosis:
        conditions.append({
            "icd_description": {
                "$regex": re.escape(request.diagnosis.strip()),
                "$options": "i"
            }
        })

    # Investigation
    if request.investigation:
        conditions.append({
            "service_description": {
                "$regex": re.escape(request.investigation.strip()),
                "$options": "i"
            }
        })

    if conditions:
        query["$and"] = conditions

    logger.info(
        "Insurance search | doctor_id=%s | hospital_id=%s | query=%s",
        request.doctor_id,
        hospital_id,
        query
    )

    # ---------------------------------------------------------
    # 3. Search claims
    # ---------------------------------------------------------

    cursor = async_claims_collection.find(query)

    results = await cursor.to_list(length=None)

    logger.info(
        "Insurance search completed | hospital_id=%s | results=%s",
        hospital_id,
        len(results)
    )

    # ---------------------------------------------------------
    # 4. Clean results
    # ---------------------------------------------------------

    matches = []

    for r in results:
        matches.append({
            "hospital_id": r.get("hospital_id"),
            "file_id": r.get("file_id"),
            "filename": r.get("filename"),
            "row_index": r.get("row_index"),
            "icd_description": r.get("icd_description"),
            "service_description": r.get("service_description"),
            "status": r.get("status"),
            "denial_reason": r.get("denial_reason"),
            "approved_amount": r.get("approved_amount"),
            "claimed_amount": r.get("claimed_amount"),
            "row_data": r.get("row_data", {})
        })

    # ---------------------------------------------------------
    # 5. Calculate summary
    # ---------------------------------------------------------

    approved = sum(
        1
        for r in results
        if "approved" in str(r.get("status", "")).lower()
    )

    rejected = sum(
        1
        for r in results
        if "rejected" in str(r.get("status", "")).lower()
    )

    partial = sum(
        1
        for r in results
        if "partial" in str(r.get("status", "")).lower()
    )

    total = len(matches)

    # ---------------------------------------------------------
    # 6. Response
    # ---------------------------------------------------------

    return {
        "status": "success",
        "diagnosis": request.diagnosis,
        "investigation": request.investigation,

        "doctor_id": request.doctor_id or "ALL",

        "hospital_id": hospital_id or "ALL",

        "total_matches": total,

        "summary": {
            "approved": approved,
            "rejected": rejected,
            "partial": partial,

            "approved_percentage": (
                round(approved / total * 100, 2)
                if total else 0
            ),

            "rejected_percentage": (
                round(rejected / total * 100, 2)
                if total else 0
            ),

            "partial_percentage": (
                round(partial / total * 100, 2)
                if total else 0
            )
        },

        "matches": matches
    }
# ============================================================
# 📊 LIST FILES ENDPOINT
# ============================================================

@router.get("/files/{doctor_id}")
async def list_files(doctor_id: str):
    """List all uploaded files for a doctor"""
    
    cursor = async_files_collection.find({"doctor_id": doctor_id}, {"_id": 0})
    files = await cursor.to_list(length=None)
    
    return {
        "status": "success",
        "doctor_id": doctor_id,
        "files": files,
        "total_files": len(files)
    }

# ============================================================
# 🗑️ DELETE FILE ENDPOINT
# ============================================================

@router.delete("/file/{doctor_id}/{file_id}")
async def delete_file(doctor_id: str, file_id: str):
    """Delete a file and all its rows from MongoDB"""
    
    # Delete claims
    result = await async_claims_collection.delete_many({
        "doctor_id": doctor_id,
        "file_id": file_id
    })
    
    # Delete file metadata
    await async_files_collection.delete_one({
        "doctor_id": doctor_id,
        "file_id": file_id
    })
    
    return {
        "status": "success",
        "message": f"Deleted {result.deleted_count} records",
        "doctor_id": doctor_id,
        "file_id": file_id
    }

# ============================================================
# 🗑️ DELETE ALL FILES FOR DOCTOR
# ============================================================

@router.delete("/files/{doctor_id}")
async def delete_all_files(doctor_id: str):
    """Delete all files for a doctor"""
    
    result = await async_claims_collection.delete_many({"doctor_id": doctor_id})
    await async_files_collection.delete_many({"doctor_id": doctor_id})
    
    return {
        "status": "success",
        "message": f"Deleted {result.deleted_count} records",
        "doctor_id": doctor_id
    }

# ============================================================
# 📊 GET STATISTICS
# ============================================================

@router.get("/stats/{doctor_id}")
async def get_stats(doctor_id: str):
    """Get statistics for a doctor's data"""
    
    total = await async_claims_collection.count_documents({"doctor_id": doctor_id})
    files = await async_files_collection.count_documents({"doctor_id": doctor_id})
    
    # Status breakdown
    pipeline = [
        {"$match": {"doctor_id": doctor_id}},
        {"$group": {"_id": "$status", "count": {"$sum": 1}}}
    ]
    status_counts = {}
    async for doc in async_claims_collection.aggregate(pipeline):
        status_counts[doc["_id"]] = doc["count"]
    
    return {
        "status": "success",
        "doctor_id": doctor_id,
        "total_rows": total,
        "total_files": files,
        "status_counts": status_counts
    }

# ============================================================
# 📝 DIAGNOSIS SUGGESTIONS
# ============================================================

@router.get("/diagnosis-suggestions/{doctor_id}")
async def diagnosis_suggestions(
    doctor_id: str,
    search: Optional[str] = Query(None)
):
    """Get unique diagnosis values"""
    
    match = {"doctor_id": doctor_id}
    if search:
        match["icd_description"] = {"$regex": re.escape(search), "$options": "i"}
    
    pipeline = [
        {"$match": match},
        {"$group": {"_id": "$icd_description"}},
        {"$sort": {"_id": 1}},
        {"$limit": 100}
    ]
    
    suggestions = []
    async for doc in async_claims_collection.aggregate(pipeline):
        if doc["_id"]:
            suggestions.append(doc["_id"])
    
    return {
        "status": "success",
        "diagnoses": suggestions,
        "total": len(suggestions)
    }

# ============================================================
# 📝 INVESTIGATION SUGGESTIONS
# ============================================================

@router.get("/investigation-suggestions/{doctor_id}")
async def investigation_suggestions(
    doctor_id: str,
    search: Optional[str] = Query(None)
):
    """Get unique investigation values"""
    
    match = {"doctor_id": doctor_id}
    if search:
        match["service_description"] = {"$regex": re.escape(search), "$options": "i"}
    
    pipeline = [
        {"$match": match},
        {"$group": {"_id": "$service_description"}},
        {"$sort": {"_id": 1}},
        {"$limit": 100}
    ]
    
    suggestions = []
    async for doc in async_claims_collection.aggregate(pipeline):
        if doc["_id"]:
            suggestions.append(doc["_id"])
    
    return {
        "status": "success",
        "investigations": suggestions,
        "total": len(suggestions)
    }

# ============================================================
# 📥 EXPORT SEARCH RESULTS
# ============================================================

@router.post("/export")
async def export_results(request: SearchRequest):
    """Export search results as CSV"""
    
    query = {}
    conditions = []
    
    if request.diagnosis:
        conditions.append({"icd_description": {"$regex": re.escape(request.diagnosis), "$options": "i"}})
    if request.investigation:
        conditions.append({"service_description": {"$regex": re.escape(request.investigation), "$options": "i"}})
    
    if conditions:
        query["$and"] = conditions
    if request.doctor_id:
        query["doctor_id"] = request.doctor_id
    
    cursor = async_claims_collection.find(query).limit(10000)
    results = await cursor.to_list(length=10000)
    
    if not results:
        raise HTTPException(status_code=404, detail="No matches found")
    
    # Convert to DataFrame
    rows = []
    for r in results:
        row = r.get("row_data", {}).copy()
        row["_status"] = r.get("status")
        row["_file_id"] = r.get("file_id")
        rows.append(row)
    
    df = pd.DataFrame(rows)
    output = io.StringIO()
    df.to_csv(output, index=False)
    
    from fastapi.responses import Response
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=insurance_search_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        }
    )