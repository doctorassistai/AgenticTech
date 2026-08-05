"""
Field Officer Availability — Backend Routes
============================================
Collection: field_officer_availability
  One document per officer, updated daily (not appended).

Document shape:
{
  userId:        str,           # sys_user_id of the field officer
  fullName:      str,
  pincode:       str,           # current service pincode (editable daily)
  district:      str|null,      # derived or stored
  latitude:      float|null,
  longitude:     float|null,
  availableFrom: str,           # "HH:MM" local time
  availableTo:   str,           # "HH:MM" local time
  status:        "Available" | "Unavailable",
  lastUpdated:   datetime (UTC),
  lastLoginDate: str  "YYYY-MM-DD"  — used to decide if today's modal is needed
}
"""

from fastapi import APIRouter, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import MongoClient
from datetime import datetime, timezone, date
from jose import jwt
from pydantic import BaseModel
from typing import Optional
import os, math, logging
from datetime import datetime, timezone, date, timedelta
from datetime import datetime, timezone, timedelta
IST = timezone(timedelta(hours=5, minutes=30))
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/app/availability", tags=["Availability"])

MONGO_URI  = os.getenv("MONGO_URI")
SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM  = os.getenv("ALGORITHM", "HS256")

# Async client for the async endpoints
motor_client = AsyncIOMotorClient(MONGO_URI)
db_async     = motor_client["doctorassistai"]
avail_col    = db_async["field_officer_availability"]
auth_col_async = db_async["user_auth"]

# Sync client reused for the lookup helper called from assignment
sync_client  = MongoClient(MONGO_URI)
db_sync      = sync_client["doctorassistai"]
avail_col_sync = db_sync["field_officer_availability"]


# ─────────────────────────────────────────────────────────────────────────────
# Auth helper
# ─────────────────────────────────────────────────────────────────────────────

def _get_user_id(request: Request) -> str:
    uid = request.headers.get("X-User-Id")
    if uid:
        return uid
    auth = request.headers.get("authorization", "")
    if not auth:
        raise HTTPException(status_code=401, detail="Missing auth")
    try:
        token = auth.split(" ")[1]
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

async def _expire_if_past_window(record: dict) -> dict:
    """
    If officer is marked Available but current IST time is past their
    availableTo window, flip status to Unavailable and persist it.
    """
    if record.get("status") != "Available":
        return record

    now_str = datetime.now(IST).strftime("%H:%M")
    available_to = record.get("availableTo", "23:59")

    if now_str > available_to:
        await avail_col.update_one(
            {"userId": record["userId"]},
            {"$set": {"status": "Unavailable", "lastUpdated": datetime.now(IST)}}
        )
        record["status"] = "Unavailable"

    return record
# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class AvailabilityUpsert(BaseModel):
    pincode:       str
    latitude:      Optional[float] = None
    longitude:     Optional[float] = None
    availableFrom: str   # "HH:MM"
    availableTo:   str   # "HH:MM"
    status:        str = "Available"
    district:      Optional[str] = None


class StatusToggle(BaseModel):
    status: str   # "Available" | "Unavailable"

class TimeUpdate(BaseModel):
    availableFrom: str   # "HH:MM"
    availableTo:   str 


# ─────────────────────────────────────────────────────────────────────────────
# POST /app/availability/checkin
# Called from the mandatory morning modal.  Upserts today's record.
# ─────────────────────────────────────────────────────────────────────────────

@router.patch("/time")
async def update_availability_time(request: Request, body: TimeUpdate):
    """
    Called from the Profile screen when the officer wants to update
    their working hours mid-day without a full re-check-in.
    """
    user_id = _get_user_id(request)

    # Basic validation
    import re
    hhmm = re.compile(r"^\d{2}:\d{2}$")
    if not hhmm.match(body.availableFrom) or not hhmm.match(body.availableTo):
        raise HTTPException(status_code=400, detail="Times must be in HH:MM format")
    if body.availableFrom >= body.availableTo:
        raise HTTPException(status_code=400, detail="End time must be after start time")

    result = await avail_col.update_one(
        {"userId": user_id},
        {"$set": {
            "availableFrom": body.availableFrom,
            "availableTo":   body.availableTo,
            "lastUpdated":   datetime.now(IST),
        }}
    )
    if result.matched_count == 0:
        raise HTTPException(
            status_code=404,
            detail="No availability record found. Complete daily check-in first."
        )

    return {"success": True, "availableFrom": body.availableFrom, "availableTo": body.availableTo}

@router.post("/login-ping")
async def record_login(request: Request):
    """Called by mobile app right after successful login to stamp lastLoginAt."""
    user_id = _get_user_id(request)
    
    result = await avail_col.update_one(
        {"userId": user_id},
        {"$set": {"lastLoginAt": datetime.now(IST)}}
    )
    # If no record yet (officer hasn't done check-in), that's fine — just skip
    return {"success": True, "updated": result.matched_count > 0}

@router.post("/checkin")
async def checkin(request: Request, body: AvailabilityUpsert):
    user_id = _get_user_id(request)
    today   = date.today().isoformat()
    now     = datetime.now(IST)

    # Fetch officer full name from user_auth
    officer = await auth_col_async.find_one(
        {"sys_user_id": user_id},
        {"full_name": 1}
    )
    full_name = (officer or {}).get("full_name", "")

    doc = {
        "userId":        user_id,
        "fullName":      full_name,
        "pincode":       body.pincode.strip(),
        "district":      body.district,
        "latitude":      body.latitude,
        "longitude":     body.longitude,
        "availableFrom": body.availableFrom,
        "availableTo":   body.availableTo,
        "status":        "Available",
        "lastUpdated":   now,
        "lastLoginDate": today,
    }

    await avail_col.update_one(
        {"userId": user_id},
        {"$set": doc},
        upsert=True,
    )

    return {"success": True, "message": "Availability confirmed", "date": today}


# ─────────────────────────────────────────────────────────────────────────────
# GET /app/availability/me
# Returns the officer's current availability record (used to pre-fill modal).
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/me")
async def get_my_availability(request: Request):
    user_id = _get_user_id(request)
    record  = await avail_col.find_one({"userId": user_id}, {"_id": 0})
    if not record:
        return {"found": False}

    record = await _expire_if_past_window(record)   # 🔥 ADD THIS

    if isinstance(record.get("lastUpdated"), datetime):
        record["lastUpdated"] = record["lastUpdated"].isoformat()
    record["found"] = True
    return record


# ─────────────────────────────────────────────────────────────────────────────
# PATCH /app/availability/status
# Manual toggle from Profile screen.
# ─────────────────────────────────────────────────────────────────────────────

@router.patch("/status")
async def toggle_status(request: Request, body: StatusToggle):
    user_id = _get_user_id(request)
    if body.status not in ("Available", "Unavailable"):
        raise HTTPException(status_code=400, detail="status must be Available or Unavailable")

    result = await avail_col.update_one(
        {"userId": user_id},
        {"$set": {"status": body.status, "lastUpdated": datetime.now(IST)}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="No availability record found. Complete daily check-in first.")

    return {"success": True, "status": body.status}


# ─────────────────────────────────────────────────────────────────────────────
# GET /web/availability/officers?pincode=&type=HVI|HV
# Used by the web assignment dropdown.
# Returns available officers for the given pincode.
# Falls back to nearby pincodes / same district when no exact match.
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/officers")
async def get_available_officers(
    request:  Request,
    pincode:  str,
    inv_type: Optional[str] = None,   # HVI | HV (informational only for now)
    search:   Optional[str] = None,
):
    """
    Returns officers who are Available + within their active time window
    and whose service pincode matches `pincode`.

    Falls back to district-level match if no exact pincode match.
    """
    IST = timezone(timedelta(hours=5, minutes=30))
    now_str = datetime.now(IST).strftime("%H:%M") # local server time; adjust to TZ if needed

    def _active_window(rec: dict) -> bool:
        """True if current time is within the officer's availability window."""
        a_from = rec.get("availableFrom", "00:00")
        a_to   = rec.get("availableTo",   "23:59")
        return a_from <= now_str <= a_to

    def _format(rec: dict) -> dict:
        return {
            "userId":        rec.get("userId"),
            "fullName":      rec.get("fullName"),
            "pincode":       rec.get("pincode"),
            "district":      rec.get("district"),
            "latitude":      rec.get("latitude"),
            "longitude":     rec.get("longitude"),
            "status":        rec.get("status"),
            "availableFrom": rec.get("availableFrom"),
            "availableTo":   rec.get("availableTo"),
            "lastUpdated":   rec.get("lastUpdated").isoformat()
                             if isinstance(rec.get("lastUpdated"), datetime) else rec.get("lastUpdated"),
            "matchType":     rec.get("_matchType", "exact"),
        }

    # ── 1. Exact pincode match ────────────────────────────────────────────
    query: dict = {"status": "Available", "pincode": pincode.strip()}
    if search:
        query["$or"] = [
            {"fullName": {"$regex": search, "$options": "i"}},
            {"pincode":  {"$regex": search, "$options": "i"}},
        ]

    cursor = avail_col.find(query, {"_id": 0})
    exact  = [r async for r in cursor]
    # 🔥 ADD: persist expiry for any Available-but-expired records, before filtering
    for r in exact:
        if r.get("status") == "Available" and not _active_window(r):
            await avail_col.update_one(
                {"userId": r["userId"]},
                {"$set": {"status": "Unavailable", "lastUpdated": datetime.now(IST)}}
            )

    exact  = [r for r in exact if _active_window(r)]

    if exact:
        for r in exact:
            r["_matchType"] = "exact"
        return {"officers": [_format(r) for r in exact], "matchLevel": "exact"}

    # ── 2. District fallback ──────────────────────────────────────────────
    # First, look up the district for the requested pincode from existing records
    ref = await avail_col.find_one({"pincode": pincode.strip()}, {"district": 1})
    district = (ref or {}).get("district")

    if district:
        query2: dict = {"status": "Available", "district": district}
        if search:
            query2["$or"] = [
                {"fullName": {"$regex": search, "$options": "i"}},
                {"pincode":  {"$regex": search, "$options": "i"}},
            ]
        cursor2 = avail_col.find(query2, {"_id": 0})
        nearby  = [r async for r in cursor2]

        # 🔥 ADD: same expiry persist as the exact-match block above
        for r in nearby:
            if r.get("status") == "Available" and not _active_window(r):
                await avail_col.update_one(
                    {"userId": r["userId"]},
                    {"$set": {"status": "Unavailable", "lastUpdated": datetime.now(IST)}}
                )

        nearby  = [r for r in nearby if _active_window(r)]
        if nearby:
            for r in nearby:
                r["_matchType"] = "district"
            return {"officers": [_format(r) for r in nearby], "matchLevel": "district"}

    # ── 3. No officers found ──────────────────────────────────────────────
    return {"officers": [], "matchLevel": "none"}


# ─────────────────────────────────────────────────────────────────────────────
# Helper used by registration endpoint (sync, called from the existing route)
# ─────────────────────────────────────────────────────────────────────────────

def store_registration_pincode(
    user_id: str,
    pincode: str,
    full_name: str = "",
    district: str = None,
    initial_status: str = "Unavailable",
) -> None:
    """
    Called once when a Field Officer is registered.
    Seeds the availability record with the service pincode so the morning
    modal can pre-fill it.
    """
    if not pincode:
        return
    avail_col_sync.update_one(
        {"userId": user_id},
        {
            "$setOnInsert": {
                "userId":        user_id,
                "fullName":      full_name,
                "pincode":       pincode.strip(),
                "district":      district,
                "status":        initial_status,
                "lastLoginDate": None,
                "latitude":      None,
                "longitude":     None,
                "availableFrom": "09:00",
                "availableTo":   "18:00",
                "lastUpdated":   datetime.now(IST),
            }
        },
        upsert=True,
    )
@router.get("/all")
async def get_all_availability(request: Request):
    cursor = avail_col.find({}, {"_id": 0})
    records = [r async for r in cursor]

    records = [await _expire_if_past_window(r) for r in records]   # 🔥 ADD THIS

    for r in records:
        if isinstance(r.get("lastUpdated"), datetime):
            r["lastUpdated"] = r["lastUpdated"].isoformat()
    return {"officers": records}

class LeaveBlock(BaseModel):
    userId:    str
    fromDate:  str   # "YYYY-MM-DD"
    toDate:    str   # "YYYY-MM-DD"
    reason:    Optional[str] = None

@router.post("/leave")
async def set_leave(request: Request, body: LeaveBlock):
    """Admin marks an officer unavailable for a date range."""
    await avail_col.update_one(
        {"userId": body.userId},
        {"$set": {
            "status":      "Unavailable",
            "leaveFrom":   body.fromDate,
            "leaveTo":     body.toDate,
            "leaveReason": body.reason or "",
            "lastUpdated": datetime.now(IST),
        }},
        upsert=True,
    )
    return {"success": True}

@router.delete("/leave/{user_id}")
async def clear_leave(user_id: str, request: Request):
    """Admin clears leave and restores officer to Available."""
    await avail_col.update_one(
        {"userId": user_id},
        {"$set": {
            "status":      "Available",
            "lastUpdated": datetime.now(IST),
        }, "$unset": {
            "leaveFrom":   "",
            "leaveTo":     "",
            "leaveReason": "",
        }}
    )
    return {"success": True}