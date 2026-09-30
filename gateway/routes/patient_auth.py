"""
gateway/routes/patient_auth.py

Patient-facing authentication for the mobile app.

Flow (OTP removed for now):
  1. POST /hms/users/patients/login
       body: { "hms_id": "...", "phone_number": "..." }
       -> validates against user_auth_collection (role == "patient"), or —
          when there is no user_auth record at all — falls back to
          patient_users matched by hms_id + last-10-digit phone. Patients
          created via the HMS integration endpoint (integration.py::
          create_patient_demographics) are inserted into patient_users only,
          with no user_auth record, so they were previously locked out.
       -> on success: issues a long-lived JWT (same scheme as doctor login),
          sets it as an httponly cookie, and returns the patient's profile
          plus their list of doctors (a patient can have more than one)

  2. GET /hms/users/patients/verify
       -> mirrors /hms/users/auth/verify for doctors, with the same
          user_auth -> patient_users fallback as /login.

Drop this file in gateway/routes/, then in gateway/main.py add:
    from gateway.routes.patient_auth import router as patient_auth_router
    app.include_router(patient_auth_router)

SECURITY NOTE:
HMS ID + phone number is a weak credential (both are fairly easy to learn,
and the phone number is also the initial password set in /patientadd), and
the token below lasts 365 days by default. This is fine for a demo/pilot.
Before real patients use it, bring back OTP (or another second factor) and
add rate limiting on /login to block guessing.
"""

import logging
import os
import sys
from datetime import datetime, timedelta

from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from jose import jwt, JWTError
from pymongo import MongoClient

load_dotenv()

# ==================== ENV ====================
SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

# Patient session token lifetime. No re-auth after first login,
# so this is long-lived rather than the 1-day default used for doctors.
PATIENT_TOKEN_EXPIRE_DAYS = int(os.getenv("PATIENT_TOKEN_EXPIRE_DAYS", 365))

# ==================== DB ====================
client = MongoClient(MONGO_URI)
db = client[MONGO_DB]

user_auth_collection = db["user_auth"]
patient_user_collection = db["patient_users"]
doctor_user_collection = db["doctor_users"]
patient_appointments_collection = db["patient_appointments"]

# ==================== LOGGING ====================
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
if not logger.handlers:
    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(logging.Formatter(
        "%(asctime)s [%(processName)s: %(process)d] [%(threadName)s: %(thread)d] [%(levelname)s] %(name)s: %(message)s"
    ))
    logger.addHandler(stream_handler)

# ==================== ROUTER ====================
router = APIRouter(
    prefix="/hms/users/patients",
    tags=["patient-auth"],
    responses={404: {"description": "Not found"}},
)


# ==================== HELPERS ====================

def create_patient_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """Same signing scheme as gateway/routes/login.py's create_access_token,
    just kept local here so this file has no cross-import dependency."""
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(days=PATIENT_TOKEN_EXPIRE_DAYS))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def _last10(phone: str) -> str:
    return "".join(filter(str.isdigit, phone or ""))[-10:]


def get_patient_doctors(patient_sys_user_id: str, patient_short_id: str) -> list:
    """A patient can be under more than one doctor. Collect every distinct
    doctor_id seen in their appointment history, plus the doctor set at
    registration, and return full doctor profiles."""
    doctor_ids = set()

    patient_doc = patient_user_collection.find_one({"sys_user_id": patient_sys_user_id})
    if patient_doc and patient_doc.get("doctor_id"):
        doctor_ids.add(patient_doc["doctor_id"])

    appt_doc = patient_appointments_collection.find_one({"sys_user_id": patient_sys_user_id}) \
        or patient_appointments_collection.find_one({"patient_id": patient_short_id})
    if appt_doc:
        for appt in appt_doc.get("appointments", []):
            if appt.get("doctor_id"):
                doctor_ids.add(appt["doctor_id"])

    doctors = []
    for doc_id in doctor_ids:
        doctor = doctor_user_collection.find_one({"sys_user_id": doc_id}, {"_id": 0})
        if doctor:
            doctors.append({
                "doctor_id": doctor.get("doctor_id"),
                "sys_user_id": doctor.get("sys_user_id"),
                "name": doctor.get("name"),
                "specialization": doctor.get("specialization"),
                "hospital_id": doctor.get("hospital_id"),
            })
    return doctors


# ==================== ENDPOINTS ====================

@router.post("/login")
async def patient_login(request: Request):
    """
    Validate hms_id + phone_number against user_auth, falling back to
    patient_users (hms_id is a string there, e.g. "51252") when no user_auth
    record exists at all. patient_users has no status field, so existence +
    phone match is the check for that path — the same rule patient_app/auth.py
    already applies to tokens issued this way.
    """
    try:
        data = await request.json()
        hms_id = (data.get("hms_id") or "").strip()
        phone_number = (data.get("phone_number") or "").strip()

        if not hms_id or not phone_number:
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": "hms_id and phone_number are required"},
            )

        input_digits = _last10(phone_number)

        user = user_auth_collection.find_one({
            "username": hms_id,
            "role": "patient",
            "status": "active",
        })

        sys_user_id = None
        username = hms_id
        patient_profile = None

        if user:
            stored_digits = _last10(user.get("phone_number", ""))
            if not stored_digits or stored_digits != input_digits:
                logger.warning(f"Patient login failed for hms_id '{hms_id}'")
                return JSONResponse(
                    status_code=401,
                    content={"status": "error", "message": "HMS ID and phone number do not match our records"},
                )
            sys_user_id = user["sys_user_id"]
            username = user["username"]
            patient_profile = patient_user_collection.find_one({"sys_user_id": sys_user_id}, {"_id": 0})

        else:
            # No user_auth record: patient was created via the HMS integration
            # endpoint and only exists in patient_users.
            patient_profile = patient_user_collection.find_one({"hms_id": hms_id}, {"_id": 0})
            if not patient_profile:
                logger.warning(f"Patient login failed for hms_id '{hms_id}' (no user_auth or patient_users match)")
                return JSONResponse(
                    status_code=401,
                    content={"status": "error", "message": "HMS ID and phone number do not match our records"},
                )
            stored_digits = _last10(patient_profile.get("phone_number", ""))
            if not stored_digits or stored_digits != input_digits:
                logger.warning(f"Patient login failed for hms_id '{hms_id}' (fallback phone mismatch)")
                return JSONResponse(
                    status_code=401,
                    content={"status": "error", "message": "HMS ID and phone number do not match our records"},
                )
            sys_user_id = patient_profile.get("sys_user_id")
            username = hms_id

        if not sys_user_id:
            # patient_users row with no sys_user_id is a data problem, not a
            # credential mismatch — still answer generically to the client.
            logger.error(f"Patient profile for hms_id '{hms_id}' has no sys_user_id")
            return JSONResponse(
                status_code=401,
                content={"status": "error", "message": "HMS ID and phone number do not match our records"},
            )

        access_token = create_patient_access_token(
            data={
                "sub": sys_user_id,
                "role": "patient",
                "username": username,
            }
        )

        doctors = get_patient_doctors(
            sys_user_id,
            patient_profile.get("patient_id") if patient_profile else None,
        )

        resp = JSONResponse(content={
            "status": "success",
            "message": "Login successful",
            "access_token": access_token,  # RN can't rely on cookies; store this client-side
            "user_id": sys_user_id,
            "hms_id": username,
            "name": patient_profile.get("name") if patient_profile else None,
            "hospital_id": patient_profile.get("hospital_id") if patient_profile else None,
            "doctors": doctors,
        })

        resp.set_cookie(
            key="access_token",
            value=access_token,
            httponly=True,
            secure=True,
            samesite="none",
            max_age=60 * 60 * 24 * PATIENT_TOKEN_EXPIRE_DAYS,
            path="/",
        )

        logger.info(f"Patient login successful: {username}")
        return resp

    except Exception as e:
        logger.exception("Patient login failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/verify")
async def patient_verify_session(request: Request):
    """
    Lets the app silently check on launch: "is this device still logged in?"
    Mirrors /hms/users/auth/verify used by the doctor web app, with the same
    user_auth -> patient_users fallback as /login.
    """
    token = None
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1]
    if not token:
        token = request.cookies.get("access_token")

    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        role = payload.get("role")

        if role != "patient" or not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")

        user = user_auth_collection.find_one({"sys_user_id": user_id})
        patient_profile = patient_user_collection.find_one({"sys_user_id": user_id}, {"_id": 0})

        if user:
            username = user["username"]
        else:
            # No user_auth record: fall back to patient_users existing at all.
            if not patient_profile:
                raise HTTPException(status_code=401, detail="User not found")
            username = patient_profile.get("hms_id")

        doctors = get_patient_doctors(
            user_id,
            patient_profile.get("patient_id") if patient_profile else None,
        )

        return {
            "status": "authenticated",
            "user": {
                "sys_user_id": user_id,
                "hms_id": username,
                "name": patient_profile.get("name") if patient_profile else None,
                "hospital_id": patient_profile.get("hospital_id") if patient_profile else None,
            },
            "doctors": doctors,
        }

    except JWTError:
        raise HTTPException(status_code=401, detail="Token expired or invalid")