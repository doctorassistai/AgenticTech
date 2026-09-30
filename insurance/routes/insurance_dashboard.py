from fastapi import APIRouter, HTTPException, Request
from jose import jwt, JWTError
from passlib.context import CryptContext
from bson import ObjectId
import re
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError
from datetime import datetime, timezone, date
from pydantic import BaseModel, Field, validator
from typing import Optional, List, Dict, Any
from twilio.rest import Client as TwilioClient
import os
import uuid
import secrets
import asyncio
import logging
logger = logging.getLogger(__name__)
from dotenv import load_dotenv
from datetime import datetime, timezone, timedelta

IST = timezone(timedelta(hours=5, minutes=30))
# -------------------- INIT --------------------
load_dotenv()

router = APIRouter(prefix="/web", tags=["Insurance"])

MD_ROLES = {"md", "managing-director", "super-admin"}
OPERATIONS_ROLE = "operations-head"

# Spec roles (TPA_Verification_System_Functional_Requirements.md §2, §8, §9, §13, §16)
STATE_TEAM_ROLE = "state-team"
REPORTING_MANAGER_ROLES = {"reporting-manager"}  # spec §87: one today, do not hard-limit to one
QC_MANAGER_ROLE = "qc-manager"
PORTAL_TEAM_ROLE = "portal-team"
DOCTOR_ROLE = "auditing-doctor-new"

# Roles the Operations Head may provision (spec §16 matrix: Operations Head is the sole user-registration authority)
PROVISIONABLE_ROLES = {STATE_TEAM_ROLE, "reporting-manager", QC_MANAGER_ROLE, PORTAL_TEAM_ROLE, "field-officer"}

_INACTIVE_STATUSES = {"inactive", "deactivated", "disabled"}
_passwords = CryptContext(schemes=["bcrypt"], deprecated="auto")


class MDLogin(BaseModel):
    username: str
    password: str


class MDRegistration(BaseModel):
    username: str
    password: str
    full_name: str
    email: Optional[str] = None


class OperationsHeadAssignment(MDRegistration):
    pass


@router.post("/md/register", status_code=201)
async def register_first_md(body: MDRegistration):
    """Create the first MD account; registration closes after initial use."""
    username = body.username.strip()
    full_name = body.full_name.strip()
    email = body.email.strip().lower() if body.email else None
    if not re.fullmatch(r"[A-Za-z0-9._-]{3,64}", username):
        raise HTTPException(status_code=400, detail="Username must be 3–64 letters, numbers, dots, underscores or hyphens")
    if not full_name:
        raise HTTPException(status_code=400, detail="Full name is required")
    if len(body.password) < 12 or len(body.password.encode("utf-8")) > 72:
        raise HTTPException(status_code=400, detail="Password must be at least 12 characters and at most 72 bytes")
    if email and ("@" not in email or len(email) > 254):
        raise HTTPException(status_code=400, detail="Invalid email address")

    users = db["user_auth"]
    if await users.find_one({"role": {"$in": list(MD_ROLES)}}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="A Managing Director account already exists")
    identifiers = [{"username": username}]
    if email:
        identifiers.append({"email": email})
    if await users.find_one({"$or": identifiers}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="Username or email already in use")

    guard = db["setup_guards"]
    try:
        await guard.insert_one({"_id": "first-md-account", "created_at": datetime.now(timezone.utc)})
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="MD registration has already been used")

    user_id = str(uuid.uuid4())
    try:
        user = {
            "sys_user_id": user_id,
            "username": username,
            "full_name": full_name,
            "password": _passwords.hash(body.password),
            "role": "managing-director",
            "status": "active",
            "created_at": datetime.now(timezone.utc),
        }
        if email:
            user["email"] = email
        await users.insert_one(user)
    except Exception:
        await guard.delete_one({"_id": "first-md-account"})
        logger.exception("MD registration failed")
        raise HTTPException(status_code=500, detail="Unable to create Managing Director account")

    return {"message": "Managing Director account created", "username": username, "user_id": user_id}


async def _require_md(request: Request):
    authorization = request.headers.get("Authorization", "")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Sign in as Managing Director")
    try:
        payload = jwt.decode(
            authorization[7:], os.getenv("SECRET_KEY"),
            algorithms=[os.getenv("ALGORITHM", "HS256")],
        )
    except (JWTError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    if payload.get("role") not in MD_ROLES:
        raise HTTPException(status_code=403, detail="Managing Director access required")
    subject = payload.get("sub")
    if not subject:
        raise HTTPException(status_code=401, detail="Invalid session")
    identifiers = [{"sys_user_id": subject}]
    if ObjectId.is_valid(subject):
        identifiers.append({"_id": ObjectId(subject)})
    user = await db["user_auth"].find_one({"$or": identifiers})
    if not user or user.get("role") not in MD_ROLES or str(user.get("status", "active")).lower() in {"inactive", "deactivated", "disabled"}:
        raise HTTPException(status_code=403, detail="Managing Director access required")
    return payload


@router.post("/md/login")
async def md_login(body: MDLogin):
    return await _login_for_roles(body, MD_ROLES)


async def _login_for_roles(body: MDLogin, roles: set[str]):
    username = body.username.strip()
    if not username or not body.password:
        raise HTTPException(status_code=400, detail="Username and password are required")
    user = await db["user_auth"].find_one({
        "$or": [{"username": username}, {"email": username}],
        "role": {"$in": list(roles)},
    })
    password_hash = user.get("password") if user else None
    try:
        valid_password = bool(password_hash and _passwords.verify(body.password, password_hash))
    except (ValueError, TypeError):
        valid_password = False
    if not valid_password or str(user.get("status", "active")).lower() in {"inactive", "deactivated", "disabled"}:
        raise HTTPException(status_code=401, detail="Invalid credentials or inactive account")
    secret = os.getenv("SECRET_KEY")
    if not secret:
        raise HTTPException(status_code=503, detail="Authentication is unavailable")
    now = datetime.now(timezone.utc)
    token = jwt.encode({
        "sub": str(user.get("sys_user_id") or user["_id"]),
        "role": user["role"],
        "iat": now,
        "exp": now + timedelta(hours=8),
    }, secret, algorithm=os.getenv("ALGORITHM", "HS256"))
    return {
        "access_token": token,
        "token_type": "bearer",
        "role": user["role"],
        "user_id": str(user.get("sys_user_id") or user["_id"]),
        "full_name": user.get("full_name") or user.get("fullName") or username,
    }


@router.post("/operations/login")
async def operations_login(body: MDLogin):
    return await _login_for_roles(body, {OPERATIONS_ROLE})


async def _require_operations(request: Request):
    authorization = request.headers.get("Authorization", "")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Sign in as Operations Head")
    try:
        payload = jwt.decode(
            authorization[7:], os.getenv("SECRET_KEY"),
            algorithms=[os.getenv("ALGORITHM", "HS256")],
        )
    except (JWTError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    if payload.get("role") != OPERATIONS_ROLE:
        raise HTTPException(status_code=403, detail="Operations Head access required")
    user = await db["user_auth"].find_one({"sys_user_id": payload.get("sub"), "role": OPERATIONS_ROLE})
    if not user or str(user.get("status", "active")).lower() in {"inactive", "deactivated", "disabled"}:
        raise HTTPException(status_code=403, detail="Operations Head access required")
    return payload


@router.get("/md/operations-heads")
async def list_operations_heads(request: Request):
    await _require_md(request)
    cursor = db["user_auth"].find(
        {"role": OPERATIONS_ROLE},
        {"_id": 0, "username": 1, "full_name": 1, "email": 1, "status": 1, "created_at": 1},
    )
    return {"users": await cursor.to_list(length=100)}


@router.post("/md/operations-heads", status_code=201)
async def assign_operations_head(request: Request, body: OperationsHeadAssignment):
    md = await _require_md(request)
    username = body.username.strip()
    full_name = body.full_name.strip()
    email = body.email.strip().lower() if body.email else None
    if not re.fullmatch(r"[A-Za-z0-9._-]{3,64}", username):
        raise HTTPException(status_code=400, detail="Username must be 3–64 letters, numbers, dots, underscores or hyphens")
    if not full_name:
        raise HTTPException(status_code=400, detail="Full name is required")
    if len(body.password) < 12 or len(body.password.encode("utf-8")) > 72:
        raise HTTPException(status_code=400, detail="Password must be at least 12 characters and at most 72 bytes")
    if email and ("@" not in email or len(email) > 254):
        raise HTTPException(status_code=400, detail="Invalid email address")
    identifiers = [{"username": username}]
    if email:
        identifiers.append({"email": email})
    users = db["user_auth"]
    if await users.find_one({"$or": identifiers}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="Username or email already in use")
    user_id = str(uuid.uuid4())
    record = {
        "sys_user_id": user_id,
        "username": username,
        "full_name": full_name,
        "password": _passwords.hash(body.password),
        "role": OPERATIONS_ROLE,
        "status": "active",
        "created_at": datetime.now(timezone.utc),
        "created_by": md["sub"],
    }
    if email:
        record["email"] = email
    try:
        await users.insert_one(record)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Username or email already in use")
    return {"message": "Operations Head assigned", "username": username, "user_id": user_id}


# -------------------- SPEC ROLES: guards, logins, provisioning --------------------

async def _require_roles(request: Request, allowed: set, label: str):
    """Shared Bearer-token guard: decode, check role claim, re-verify the user is active."""
    authorization = request.headers.get("Authorization", "")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail=f"Sign in as {label}")
    try:
        payload = jwt.decode(
            authorization[7:], os.getenv("SECRET_KEY"),
            algorithms=[os.getenv("ALGORITHM", "HS256")],
        )
    except (JWTError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    if payload.get("role") not in allowed:
        raise HTTPException(status_code=403, detail=f"{label} access required")
    subject = payload.get("sub")
    if not subject:
        raise HTTPException(status_code=401, detail="Invalid session")
    identifiers = [{"sys_user_id": subject}]
    if ObjectId.is_valid(subject):
        identifiers.append({"_id": ObjectId(subject)})
    user = await db["user_auth"].find_one({"$or": identifiers})
    if not user or user.get("role") not in allowed or str(user.get("status", "active")).lower() in _INACTIVE_STATUSES:
        raise HTTPException(status_code=403, detail=f"{label} access required")
    return payload


async def _require_state_team(request: Request):
    return await _require_roles(request, {STATE_TEAM_ROLE}, "State Team")


async def _require_reporting_manager(request: Request):
    return await _require_roles(request, REPORTING_MANAGER_ROLES, "Reporting Manager")


async def _require_qc_manager(request: Request):
    return await _require_roles(request, {QC_MANAGER_ROLE}, "QC Manager")


async def _require_portal_team(request: Request):
    return await _require_roles(request, {PORTAL_TEAM_ROLE}, "Portal Team")


@router.post("/state-team/login")
async def state_team_login(body: MDLogin):
    return await _login_for_roles(body, {STATE_TEAM_ROLE})


@router.post("/reporting-manager/login")
async def reporting_manager_login(body: MDLogin):
    return await _login_for_roles(body, REPORTING_MANAGER_ROLES)


@router.post("/qc-manager/login")
async def qc_manager_login(body: MDLogin):
    return await _login_for_roles(body, {QC_MANAGER_ROLE})


@router.post("/portal-team/login")
async def portal_team_login(body: MDLogin):
    return await _login_for_roles(body, {PORTAL_TEAM_ROLE})


class RoleUserCreate(BaseModel):
    role: str
    username: str
    password: str
    full_name: Optional[str] = None
    email: Optional[str] = None
    states: Optional[List[str]] = None


@router.get("/operations/users")
async def list_role_users(request: Request, role: Optional[str] = None):
    await _require_operations(request)
    if role:
        if role not in PROVISIONABLE_ROLES:
            raise HTTPException(status_code=400, detail="Unknown role")
        query = {"role": role}
    else:
        query = {"role": {"$in": list(PROVISIONABLE_ROLES)}}
    cursor = db["user_auth"].find(
        query,
        {"_id": 0, "sys_user_id": 1, "username": 1, "full_name": 1, "email": 1,
         "role": 1, "status": 1, "states": 1, "created_at": 1},
    )
    return {"users": await cursor.to_list(length=500)}


@router.post("/operations/users", status_code=201)
async def create_role_user(request: Request, body: RoleUserCreate):
    """Operations Head provisions a spec-role user (spec §16). Minimal: username + password."""
    ops = await _require_operations(request)
    role = body.role.strip()
    if role not in PROVISIONABLE_ROLES:
        raise HTTPException(status_code=400, detail="Role is not provisionable here")
    username = body.username.strip()
    full_name = (body.full_name or "").strip() or username
    email = body.email.strip().lower() if body.email else None
    if not re.fullmatch(r"[A-Za-z0-9._-]{3,64}", username):
        raise HTTPException(status_code=400, detail="Username must be 3–64 letters, numbers, dots, underscores or hyphens")
    if len(body.password) < 8 or len(body.password.encode("utf-8")) > 72:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters and at most 72 bytes")
    if email and ("@" not in email or len(email) > 254):
        raise HTTPException(status_code=400, detail="Invalid email address")
    states = None
    if role == STATE_TEAM_ROLE:
        states = [s.strip() for s in (body.states or []) if s and s.strip()]
        if not states:
            raise HTTPException(status_code=400, detail="At least one state is required for a State Team user")
    identifiers = [{"username": username}]
    if email:
        identifiers.append({"email": email})
    users = db["user_auth"]
    if await users.find_one({"$or": identifiers}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="Username or email already in use")
    user_id = str(uuid.uuid4())
    record = {
        "sys_user_id": user_id,
        "username": username,
        "full_name": full_name,
        "password": _passwords.hash(body.password),
        "role": role,
        "status": "active",
        "created_at": datetime.now(timezone.utc),
        "created_by": ops.get("sub"),
    }
    if email:
        record["email"] = email
    if states is not None:
        record["states"] = states
    try:
        await users.insert_one(record)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Username or email already in use")
    return {"message": "User created", "username": username, "user_id": user_id, "role": role}


class RoleUserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    status: Optional[str] = None
    states: Optional[List[str]] = None


# Human-friendly generated passwords: an easy-to-read word + separator + digits.
# Deliberately simple (spec: minimal provisioning) — copy/paste and share, then
# the user can change it later. Avoids ambiguous characters.
_PWD_WORDS = ["Falcon", "Harbor", "Maple", "Orbit", "Pine", "River", "Summit", "Willow", "Cobalt", "Ember"]


def _generate_password() -> str:
    word = secrets.choice(_PWD_WORDS)
    digits = "".join(secrets.choice("23456789") for _ in range(4))
    return f"{word}-{digits}"


async def _find_provisioned_user(user_id: str):
    user = await db["user_auth"].find_one({"sys_user_id": user_id})
    if not user or user.get("role") not in PROVISIONABLE_ROLES:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.patch("/operations/users/{user_id}")
async def update_role_user(request: Request, user_id: str, body: RoleUserUpdate):
    """Operations Head edits an existing provisioned user's fields."""
    await _require_operations(request)
    users = db["user_auth"]
    user = await _find_provisioned_user(user_id)
    update: Dict[str, Any] = {}

    new_role = user.get("role")
    if body.role is not None:
        new_role = body.role.strip()
        if new_role not in PROVISIONABLE_ROLES:
            raise HTTPException(status_code=400, detail="Role is not provisionable here")
        update["role"] = new_role

    if body.full_name is not None:
        update["full_name"] = body.full_name.strip() or user.get("username")

    if body.email is not None:
        email = body.email.strip().lower()
        if email:
            if "@" not in email or len(email) > 254:
                raise HTTPException(status_code=400, detail="Invalid email address")
            clash = await users.find_one({"email": email, "sys_user_id": {"$ne": user_id}}, {"_id": 1})
            if clash:
                raise HTTPException(status_code=409, detail="Email already in use")
            update["email"] = email
        else:
            update["email"] = None

    if body.status is not None:
        status = body.status.strip().lower()
        if status not in {"active", "inactive"}:
            raise HTTPException(status_code=400, detail="Status must be 'active' or 'inactive'")
        update["status"] = status

    # State restriction (spec §89) applies to State Team users. Keep states
    # consistent with the effective role after any role change.
    if new_role == STATE_TEAM_ROLE:
        if body.states is not None:
            states = [s.strip() for s in body.states if s and s.strip()]
            if not states:
                raise HTTPException(status_code=400, detail="At least one state is required for a State Team user")
            update["states"] = states
        elif not user.get("states"):
            raise HTTPException(status_code=400, detail="At least one state is required for a State Team user")
    elif body.role is not None and new_role != STATE_TEAM_ROLE:
        update["states"] = []
    elif body.states is not None:
        update["states"] = [s.strip() for s in body.states if s and s.strip()]

    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    update["updated_at"] = datetime.now(timezone.utc)
    await users.update_one({"sys_user_id": user_id}, {"$set": update})
    return {"message": "User updated", "user_id": user_id}


@router.post("/operations/users/{user_id}/reset-password")
async def reset_role_user_password(request: Request, user_id: str):
    """Operations Head resets a user's password to a fresh auto-generated one.
    Returns the plaintext once so it can be copied and shared securely."""
    ops = await _require_operations(request)
    user = await _find_provisioned_user(user_id)
    new_password = _generate_password()
    await db["user_auth"].update_one(
        {"sys_user_id": user_id},
        {"$set": {
            "password": _passwords.hash(new_password),
            "password_reset_at": datetime.now(timezone.utc),
            "password_reset_by": ops.get("sub"),
        }},
    )
    return {"message": "Password reset", "username": user.get("username"), "password": new_password}


# ==================== Doctor registration + probation (Operations Head) ====================
# Doctors are user_auth docs with role DOCTOR_ROLE. Probation is configuration-driven
# (spec §25): a global default duration (operations_config singleton) that Operations
# Head can edit, applied at registration, with per-doctor extend / end-early actions.
# Dates are stored as ISO date strings (YYYY-MM-DD) in IST to keep this date-granular
# concept free of the UTC/IST datetime ambiguity elsewhere in this file.

DEFAULT_PROBATION_MONTHS = 3
_OPS_CONFIG_ID = "operations-config"


async def _get_operations_config() -> Dict[str, Any]:
    doc = await db["operations_config"].find_one({"_id": _OPS_CONFIG_ID}) or {}
    return {"probation_months": int(doc.get("probation_months", DEFAULT_PROBATION_MONTHS))}


def _today_ist() -> date:
    return datetime.now(IST).date()


def _add_months(iso_date: str, months: int) -> str:
    """Add calendar months to an ISO date string, clamping the day to month length."""
    d = date.fromisoformat(iso_date)
    total = (d.year * 12 + (d.month - 1)) + months
    year, month = divmod(total, 12)
    month += 1
    # Clamp day to the last valid day of the target month.
    if month == 12:
        next_month_first = date(year + 1, 1, 1)
    else:
        next_month_first = date(year, month + 1, 1)
    last_day = (next_month_first - timedelta(days=1)).day
    return date(year, month, min(d.day, last_day)).isoformat()


def _effective_probation_status(doc: Dict[str, Any]) -> str:
    """Derive the current status: an explicit end stays; otherwise auto-complete once
    the end date has passed."""
    status = doc.get("probation_status")
    if status == "ended-early":
        return "ended-early"
    end = doc.get("probation_end")
    if end and _today_ist().isoformat() >= end:
        return "completed"
    return status or "active"


def _doctor_query(user_id: str) -> Dict[str, Any]:
    """Match a doctor by our own sys_user_id or by Mongo _id, so doctors created
    here AND ones registered through the external HMS flow (which only have an
    _id) are all manageable from the one Operations page — a single doctor pool."""
    ors: List[Dict[str, Any]] = [{"sys_user_id": user_id}]
    try:
        ors.append({"_id": ObjectId(user_id)})
    except Exception:
        pass
    return {"role": DOCTOR_ROLE, "$or": ors}


async def _find_doctor(user_id: str) -> Dict[str, Any]:
    doc = await db["user_auth"].find_one(_doctor_query(user_id))
    if not doc:
        raise HTTPException(status_code=404, detail="Doctor not found")
    return doc


def _doctor_public(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        # Stable handle for actions: prefer our UUID, else the Mongo _id string.
        "id": doc.get("sys_user_id") or str(doc.get("_id")),
        "sys_user_id": doc.get("sys_user_id"),
        "full_name": doc.get("full_name"),
        "username": doc.get("username"),
        "email": doc.get("email"),
        "phone_number": doc.get("phone_number"),
        "specialization": doc.get("specialization"),
        "qualification": doc.get("qualification"),
        "registration_number": doc.get("registration_number"),
        "experience": doc.get("experience"),
        "status": doc.get("status", "active"),
        "date_of_joining": doc.get("date_of_joining"),
        "probation_months": doc.get("probation_months"),
        "probation_end": doc.get("probation_end"),
        "probation_status": _effective_probation_status(doc),
    }


class OpsConfigUpdate(BaseModel):
    probation_months: int


@router.get("/operations/config")
async def get_operations_config(request: Request):
    await _require_operations(request)
    return await _get_operations_config()


@router.put("/operations/config")
async def update_operations_config(request: Request, body: OpsConfigUpdate):
    ops = await _require_operations(request)
    if body.probation_months < 1 or body.probation_months > 36:
        raise HTTPException(status_code=400, detail="Probation duration must be between 1 and 36 months")
    await db["operations_config"].update_one(
        {"_id": _OPS_CONFIG_ID},
        {"$set": {
            "probation_months": body.probation_months,
            "updated_at": datetime.now(timezone.utc),
            "updated_by": ops.get("sub"),
        }},
        upsert=True,
    )
    return await _get_operations_config()


class DoctorCreate(BaseModel):
    full_name: str
    username: str
    password: str
    email: Optional[str] = None
    phone_number: Optional[str] = None
    specialization: Optional[str] = None
    qualification: Optional[str] = None
    registration_number: Optional[str] = None
    experience: Optional[str] = None
    date_of_joining: Optional[str] = None
    probation_months: Optional[int] = None


@router.get("/operations/doctors")
async def list_doctors(request: Request):
    await _require_operations(request)
    cursor = db["user_auth"].find({"role": DOCTOR_ROLE})
    return {"doctors": [_doctor_public(d) for d in await cursor.to_list(length=500)]}


@router.post("/operations/doctors", status_code=201)
async def create_doctor(request: Request, body: DoctorCreate):
    """Operations Head registers an auditing doctor with an auto-calculated probation."""
    ops = await _require_operations(request)
    username = body.username.strip()
    full_name = (body.full_name or "").strip() or username
    email = body.email.strip().lower() if body.email else None
    if not re.fullmatch(r"[A-Za-z0-9._-]{3,64}", username):
        raise HTTPException(status_code=400, detail="Username must be 3–64 letters, numbers, dots, underscores or hyphens")
    if len(body.password) < 8 or len(body.password.encode("utf-8")) > 72:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters and at most 72 bytes")
    if email and ("@" not in email or len(email) > 254):
        raise HTTPException(status_code=400, detail="Invalid email address")

    # Date of joining defaults to today (IST); probation duration defaults to config.
    if body.date_of_joining:
        try:
            doj = date.fromisoformat(body.date_of_joining).isoformat()
        except ValueError:
            raise HTTPException(status_code=400, detail="Date of joining must be YYYY-MM-DD")
    else:
        doj = _today_ist().isoformat()
    cfg = await _get_operations_config()
    months = body.probation_months if body.probation_months is not None else cfg["probation_months"]
    if months < 1 or months > 36:
        raise HTTPException(status_code=400, detail="Probation duration must be between 1 and 36 months")

    identifiers = [{"username": username}]
    if email:
        identifiers.append({"email": email})
    users = db["user_auth"]
    if await users.find_one({"$or": identifiers}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="Username or email already in use")

    user_id = str(uuid.uuid4())
    record = {
        "sys_user_id": user_id,
        "username": username,
        "full_name": full_name,
        "password": _passwords.hash(body.password),
        "role": DOCTOR_ROLE,
        "status": "active",
        "specialization": (body.specialization or "").strip() or None,
        "qualification": (body.qualification or "").strip() or None,
        "registration_number": (body.registration_number or "").strip() or None,
        "experience": (body.experience or "").strip() or None,
        "date_of_joining": doj,
        "probation_months": months,
        "probation_end": _add_months(doj, months),
        "probation_status": "active",
        "probation_history": [],
        "created_at": datetime.now(timezone.utc),
        "created_by": ops.get("sub"),
    }
    if email:
        record["email"] = email
    if body.phone_number and body.phone_number.strip():
        record["phone_number"] = body.phone_number.strip()
    try:
        await users.insert_one(record)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Username or email already in use")
    return {"message": "Doctor registered", "username": username, "user_id": user_id,
            "probation_end": record["probation_end"]}


class DoctorUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone_number: Optional[str] = None
    specialization: Optional[str] = None
    qualification: Optional[str] = None
    registration_number: Optional[str] = None
    experience: Optional[str] = None
    status: Optional[str] = None


@router.patch("/operations/doctors/{user_id}")
async def update_doctor(request: Request, user_id: str, body: DoctorUpdate):
    await _require_operations(request)
    users = db["user_auth"]
    doctor = await _find_doctor(user_id)
    update: Dict[str, Any] = {}

    if body.full_name is not None:
        update["full_name"] = body.full_name.strip() or doctor.get("username")
    if body.email is not None:
        email = body.email.strip().lower()
        if email:
            if "@" not in email or len(email) > 254:
                raise HTTPException(status_code=400, detail="Invalid email address")
            clash = await users.find_one({"email": email, "sys_user_id": {"$ne": user_id}}, {"_id": 1})
            if clash:
                raise HTTPException(status_code=409, detail="Email already in use")
            update["email"] = email
        else:
            update["email"] = None
    if body.status is not None:
        status = body.status.strip().lower()
        if status not in {"active", "inactive"}:
            raise HTTPException(status_code=400, detail="Status must be 'active' or 'inactive'")
        update["status"] = status
    for field in ("phone_number", "specialization", "qualification", "registration_number", "experience"):
        value = getattr(body, field)
        if value is not None:
            update[field] = value.strip() or None

    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    update["updated_at"] = datetime.now(timezone.utc)
    await users.update_one({"_id": doctor["_id"]}, {"$set": update})
    return {"message": "Doctor updated", "user_id": user_id}


@router.post("/operations/doctors/{user_id}/reset-password")
async def reset_doctor_password(request: Request, user_id: str):
    ops = await _require_operations(request)
    doctor = await _find_doctor(user_id)
    new_password = _generate_password()
    await db["user_auth"].update_one(
        {"_id": doctor["_id"]},
        {"$set": {
            "password": _passwords.hash(new_password),
            "password_reset_at": datetime.now(timezone.utc),
            "password_reset_by": ops.get("sub"),
        }},
    )
    return {"message": "Password reset", "username": doctor.get("username"), "password": new_password}


class ProbationAction(BaseModel):
    action: str  # set-duration | extend | end-early
    months: Optional[int] = None
    end_date: Optional[str] = None


@router.post("/operations/doctors/{user_id}/probation")
async def update_doctor_probation(request: Request, user_id: str, body: ProbationAction):
    """Change probation duration, extend, or end early. Every action is recorded."""
    ops = await _require_operations(request)
    doctor = await _find_doctor(user_id)
    doj = doctor.get("date_of_joining") or _today_ist().isoformat()
    action = body.action.strip()
    set_fields: Dict[str, Any] = {}
    history: Dict[str, Any] = {"action": action, "at": datetime.now(timezone.utc), "by": ops.get("sub")}

    if action == "set-duration":
        if body.months is None or body.months < 1 or body.months > 36:
            raise HTTPException(status_code=400, detail="months must be between 1 and 36")
        set_fields["probation_months"] = body.months
        set_fields["probation_end"] = _add_months(doj, body.months)
        set_fields["probation_status"] = "active"
        history["months"] = body.months
    elif action == "extend":
        if body.end_date:
            try:
                new_end = date.fromisoformat(body.end_date).isoformat()
            except ValueError:
                raise HTTPException(status_code=400, detail="end_date must be YYYY-MM-DD")
        elif body.months and body.months > 0:
            current_end = doctor.get("probation_end") or _add_months(doj, doctor.get("probation_months") or DEFAULT_PROBATION_MONTHS)
            new_end = _add_months(current_end, body.months)
        else:
            raise HTTPException(status_code=400, detail="Provide months (>0) or an end_date to extend")
        set_fields["probation_end"] = new_end
        set_fields["probation_status"] = "extended"
        history["end_date"] = new_end
        if body.months:
            history["months"] = body.months
    elif action == "end-early":
        set_fields["probation_end"] = _today_ist().isoformat()
        set_fields["probation_status"] = "ended-early"
        history["end_date"] = set_fields["probation_end"]
    else:
        raise HTTPException(status_code=400, detail="Unknown action")

    await db["user_auth"].update_one(
        {"_id": doctor["_id"]},
        {"$set": set_fields, "$push": {"probation_history": history}},
    )
    refreshed = await _find_doctor(user_id)
    return {"message": "Probation updated", "user_id": user_id,
            "probation_end": refreshed.get("probation_end"),
            "probation_status": _effective_probation_status(refreshed)}

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB  = os.getenv("MONGO_DB", "doctorassistai")

motor_client = AsyncIOMotorClient(MONGO_URI)
db = motor_client[MONGO_DB]
collection = db["insurance_claims_new"]

CASE_LIST_PROJECTION = {
    "_id": 0,
    "caseId": 1,
    "insurerRef": 1,
    "insurer": 1,
    "policyNumber": 1,
    "claimantName": 1,
    "claimantMobile": 1,
    "hospitalDetails.name": 1,
    "hospitalDetails.type": 1,
    "doctor_assigned": 1,
    "tags": 1,
    "claimedAmount": 1,
    "claimPriority": 1,
    "status": 1,
    "investigations": 1,
    "targetDate": 1,
    "createdAt": 1,
    "updatedAt": 1,
}


async def ensure_indexes():
    """Call once at startup (from lifespan or startup event)."""
    await collection.create_index("caseId", unique=True)
    await collection.create_index("claimantMobile")
    await collection.create_index("createdAt")
    await collection.create_index("status")
    await collection.create_index("tags")


# -------------------- MODEL --------------------

class InsuranceCase(BaseModel):
    caseId: Optional[str] = None

    # Step 1 — Insurer
    insurer: str
    policyNumber: str
    policyType: Optional[str] = "Individual"
    insurerRef: str
    insurerContact: Optional[str] = None
    insurerContactInfo: Optional[str] = None
    policyDetails: Optional[Dict[str, Any]] = None

    # Step 2 — Claimant
    claimantName: str
    claimantMobile: str
    claimantEmail: Optional[str] = None
    altContact: Optional[str] = None
    claimantAge: Optional[int] = None
    relationship: Optional[str] = None
    idProofType: Optional[str] = None
    idProofNumber: Optional[str] = None
    claimantAddress: Optional[str] = None
    city: Optional[str] = None
    district: Optional[str] = None
    pinCode: str

    # Step 3 — Claim
    dateOfIncident: Optional[date] = None
    dateOfIntimation: Optional[date] = None
    claimedAmount: Optional[float] = None
    sumInsured: Optional[float] = None
    claimPriority: Optional[str] = None
    description: str
    claimMode: str
    claimSubtype: str
    # Nested claim details
    accidentDetails: Optional[Dict[str, Any]] = None
    deathDetails: Optional[Dict[str, Any]] = None
    criticalDetails: Optional[Dict[str, Any]] = None
    cashlessDetails: Optional[Dict[str, Any]] = None
    reimbursementDetails: Optional[Dict[str, Any]] = None
    hospitalDetails: Optional[Dict[str, Any]] = None
    locationDetails: Optional[Dict[str, Any]] = None
    additionalMedicalDetails: Optional[Dict[str, Any]] = None
    investigationDetails: Optional[Dict[str, Any]] = None
    medicalStaff: Optional[Dict[str, Any]] = None
    billingDetails: Optional[Dict[str, Any]] = None

    # Additional claim metadata
    claimSource: Optional[str] = None
    slaCategory: Optional[str] = None

    # Step 4 — Assignment
    investigations: Dict[str, Any] = Field(default_factory=dict)
    targetDate: Optional[str] = None  # was Optional[date]
    assignmentNotes: Optional[str] = None
    claimTriggers: List[str] = Field(default_factory=list)
    doctor_assigned: Optional[str] = None
    conclusion: Optional[str] = None
    tpaName: Optional[str] = None
    # Should be added to InsuranceCase model
    railwayDetails: Optional[Dict[str, Any]] = None
    pastHospitalDetails: Optional[Dict[str, Any]] = None
    pastHospitalPincode: Optional[str] = None
    digiPincode: Optional[str] = None
    hospitalPincode: Optional[str] = None
    billingDetails: Optional[Dict[str, Any]] = None
    medicalStaff: Optional[Dict[str, Any]] = None
    riskDetails: Optional[Dict[str, Any]] = None
    checklist: Optional[Dict[str, Any]] = None
    obstetricDetails: Optional[Dict[str, Any]] = None
    additionalMedicalDetails: Optional[Dict[str, Any]] = None
    investigationDetails: Optional[Dict[str, Any]] = None  # already present
    pre_extracted_facts: Optional[Dict[str, Any]] = None
    raw_llama_markdown: Optional[str] = None
    tags: List[str] = Field(default_factory=list)  # MISSING from model!
    claimSubMode: Optional[str] = None
    

    # ------------------------------------------------------------------ #
    # VALIDATORS                                                           #
    # ------------------------------------------------------------------ #
    @validator("dateOfIncident", "dateOfIntimation", pre=True)  # removed targetDate here
    def normalise_date(cls, v):
        if not v:
            return None
        if isinstance(v, date):
            return v
        s = str(v).strip()
        if len(s) == 10 and s[2] == "/" and s[5] == "/":
            dd, mm, yyyy = s.split("/")
            return f"{yyyy}-{mm}-{dd}"
        return s

    @validator("claimedAmount", pre=True)
    def coerce_claimed_amount(cls, v):
        if v in (None, ""):
            return None
        try:
            result = float(v)
        except (TypeError, ValueError):
            raise ValueError("claimedAmount must be a number")
        if result < 0:
            raise ValueError("claimedAmount cannot be negative")
        return result

    @validator("sumInsured", pre=True)
    def coerce_sum_insured(cls, v):
        if v in (None, ""):
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            raise ValueError("sumInsured must be a number")

    @validator("claimantAge", pre=True)
    def coerce_age(cls, v):
        if v in (None, ""):
            return None
        try:
            return int(v)
        except (TypeError, ValueError):
            raise ValueError("claimantAge must be an integer")

    @validator("claimantMobile")
    def validate_mobile(cls, v):
        if v is None:
            raise ValueError("claimantMobile is required")
        cleaned = str(v).strip()
        if not cleaned.isdigit() or len(cleaned) != 10:
            raise ValueError("claimantMobile must be exactly 10 digits")
        return cleaned

    @validator("pinCode")
    def validate_pincode(cls, v):
        if v is None:
            raise ValueError("pinCode is required")
        cleaned = str(v).strip()
        if not cleaned.isdigit() or len(cleaned) != 6:
            raise ValueError("pinCode must be exactly 6 digits")
        return cleaned

    @validator("investigations")
    def validate_investigations(cls, v):
        for inv_type, assignments in v.items():
            for assignment in assignments:
                if assignment.get("investigatorId"):
                    if not assignment["investigatorId"].strip():
                        raise ValueError(f"Investigator selection required for {inv_type}")
        return v

    @validator("claimMode")
    def validate_claim_mode(cls, v):
        valid = [
            "cashless", "reimbursement",
            "personal_accident", "death", "railway_accident",
            "sme_verification", "critical_illness",
            "asset_verification", "bill_verification",
        ]
        if v not in valid:
            raise ValueError("Invalid claim mode")
        return v

    @validator("deathDetails")
    def validate_death_details(cls, v, values):
        return v

    @validator("cashlessDetails")
    def validate_cashless_details(cls, v, values):
        # No longer enforce admissionType or estimatedCost
        return v

    @validator("reimbursementDetails")
    def validate_reimbursement_details(cls, v, values):
    # Allow submission without bank details — they can be filled later
        return v

    class Config:
        anystr_strip_whitespace = True
        extra = "allow"
        json_encoders = {
            date: lambda v: v.isoformat(),
            datetime: lambda v: v.isoformat()
        }


# -------------------- HELPERS --------------------

def _build_document(data: InsuranceCase) -> dict:
    raw = data.dict()
    doc = {k: v for k, v in raw.items() if v is not None}

    for k, v in doc.items():
        if isinstance(v, date) and not isinstance(v, datetime):
            doc[k] = v.isoformat()
        elif isinstance(v, dict):
            for sub_k, sub_v in v.items():
                if isinstance(sub_v, date) and not isinstance(sub_v, datetime):
                    v[sub_k] = sub_v.isoformat()
        elif isinstance(v, list):
            for item in v:
                if isinstance(item, dict):
                    for sub_k, sub_v in item.items():
                        if isinstance(sub_v, date) and not isinstance(sub_v, datetime):
                            item[sub_k] = sub_v.isoformat()

    doc["caseId"]    = f"CIMS-{uuid.uuid4().hex[:8].upper()}"
    doc["createdAt"] = datetime.now(IST)
    doc["status"]    = "ALLOCATED"
    doc["updatedAt"] = datetime.now(IST)


    return doc

def _get_document_list(tags: list, claim_mode: str) -> list:
    docs = [
        "Duly filled & signed claim form",
        "Photo ID proof of claimant (Aadhaar / PAN / Passport)",
        "Policy document / insurance certificate",
        "Original hospital bills & receipts",
        "Discharge summary",
        "All investigation reports (blood, imaging, etc.)",
        "Treating doctor's certificate",
        "Prescription copies",
        # BILL docs merged in
        "Discharge bill", "Lab bill", "Seal verification",
        "Bill genuineness verification", "Discount verification",
        "Non-medical expenses verification",
    ]

    if claim_mode == "cashless":
        docs += [
            "Pre-authorisation approval letter",
            "TPA network ID card",
        ]

    if claim_mode == "reimbursement":
        docs += [
            "Cancelled cheque / bank passbook copy",
            "NEFT authorisation form",
        ]

    if "Accident" in tags:
        docs += [
            "FIR / MLC copy",
            "Medico-Legal Certificate (MLC)",
            "Driving licence (if vehicle accident)",
            "Vehicle RC book",
            "Spot / accident photographs (if available)",
            "Police station certificate",
        ]

    if "Death" in tags:
        docs += [
            "Death certificate (original)",
            "Post-mortem report (if conducted)",
            "Burial / cremation certificate",
            "Nominee / legal heir ID & relationship proof",
            "SDF (Statement of Death Facts) signed by nominee",
            "Claimant's statement",
        ]

    if "Critical Illness" in tags:
        docs += [
            "Specialist's diagnosis certificate",
            "Histopathology / biopsy report (if applicable)",
            "Oncologist / cardiologist report",
        ]

    return docs


def _normalise_to_e164(number: str) -> Optional[str]:
    """
    Accepts any of:
      "9876543210"      → bare 10-digit Indian mobile
      "919876543210"    → with country code, no +
      "+919876543210"   → full E.164
      "09876543210"     → leading STD 0

    Returns digits-only E.164 string (without +), e.g. "919876543210".
    Returns None if the number cannot be parsed.
    """
    clean = number.strip().lstrip("+").replace(" ", "").replace("-", "")
    if not clean.isdigit():
        return None
    if clean.startswith("0"):           # strip leading STD zero
        clean = clean[1:]
    if len(clean) == 10:                # bare 10-digit → prepend India code
        clean = "91" + clean
    if not (10 <= len(clean) <= 15):    # ITU-T E.164 max is 15 digits
        return None
    return clean


def _send_whatsapp(to_number: str, message: str) -> dict:
    """
    
    """
    account_sid = os.getenv("TWILIO_ACCOUNT_SID")
    auth_token  = os.getenv("TWILIO_AUTH_TOKEN")
    from_number = os.getenv("TWILIO_WHATSAPP_NUMBER", "")

    if not account_sid or not auth_token or not from_number:
        print("[Twilio] Missing credentials in .env — skipping send")
        return {"sent": False, "error": "credentials_missing"}

    e164 = _normalise_to_e164(to_number)
    if not e164:
        print(f"[Twilio] Cannot parse number: {to_number!r} — skipping")
        return {"sent": False, "error": f"unparseable_number: {to_number}"}

    # Twilio WhatsApp format → "whatsapp:+<E.164>"
    from_wa = (
        from_number if from_number.startswith("whatsapp:")
        else f"whatsapp:{from_number}"
    )
    to_wa = f"whatsapp:+{e164}"

    try:
        client = TwilioClient(account_sid, auth_token)
        msg    = client.messages.create(body=message, from_=from_wa, to=to_wa)
        print(f"[Twilio] ✓ Sent to {to_wa}  sid={msg.sid}")
        return {"sent": True, "sid": msg.sid}
    except Exception as exc:
        print(f"[Twilio] ✗ Failed to send to {to_wa}: {exc}")
        return {"sent": False, "error": str(exc)}


# -------------------- ROUTES --------------------

@router.post("/create-case")
async def create_case(data: InsuranceCase):
    """
    1. Save case to MongoDB.
    2. Generate public checklist link:  <FRONTEND_URL>/checklist/<caseId>
    3. Send WhatsApp (via Twilio) to:
         • insurer  — insurerContactInfo  (if it contains digits)
         • hospital — hospitalDetails.hospitalContactNumber
    """
    try:
     

        doc = _build_document(data)
        result = await collection.insert_one(doc)
        case_id = doc["caseId"]
        

        # ── 2. Build checklist link ───────────────────────────────────────────
        frontend_url = os.getenv("FRONTEND_URL").rstrip("/")
        checklist_url = f"{frontend_url}/checklist/{case_id}"

        # ── 3. Build document bullet list ─────────────────────────────────────
        doc_items  = _get_document_list(tags=data.tags, claim_mode=data.claimMode)
        doc_bullet = "\n".join(f"• {d}" for d in doc_items)

        # ── 4. Compose messages ───────────────────────────────────────────────
        hospital_name = (data.hospitalDetails or {}).get("name", "the hospital")

        insurer_msg = (
            f"📋 *New Claim — {case_id}*\n\n"
            f"*Claimant:* {data.claimantName}\n"
            f"*Policy No:* {data.policyNumber}\n"
            f"*Insurer:* {data.insurer}\n"
            f"*Mode:* {data.claimMode.title()}  |  *Tags:* {', '.join(data.tags)}\n\n"
            f"*Documents Required:*\n{doc_bullet}\n\n"
            f"🔗 Full checklist:\n{checklist_url}"
        )

        hospital_msg = (
            f"📋 *Insurance Claim Notification — {case_id}*\n\n"
            f"A claim has been registered for a patient at *{hospital_name}*.\n\n"
            f"*Claimant:* {data.claimantName}\n"
            f"*Mode:* {data.claimMode.title()}  |  *Tags:* {', '.join(data.tags)}\n\n"
            f"*Documents Required from Hospital:*\n{doc_bullet}\n\n"
            f"🔗 Full checklist:\n{checklist_url}"
        )

        # ── 5. Send WhatsApp messages ─────────────────────────────────────────
        wa_results: dict = {}

        # Insurer — insurerContactInfo may be email or phone; only send if it has digits
        insurer_contact = (data.insurerContactInfo or "").strip()
        if insurer_contact and any(ch.isdigit() for ch in insurer_contact):
            wa_results["insurer"] = _send_whatsapp(insurer_contact, insurer_msg)
        else:
            wa_results["insurer"] = {"sent": False, "error": "no_phone_number_provided"}

        # Hospital — dedicated hospitalContactNumber field
        hospital_phone = (data.hospitalDetails or {}).get("hospitalContactNumber", "").strip()
        if hospital_phone:
            wa_results["hospital"] = _send_whatsapp(hospital_phone, hospital_msg)
        else:
            wa_results["hospital"] = {"sent": False, "error": "no_phone_number_provided"}

        # ── 6. Respond ────────────────────────────────────────────────────────
        return {
            "message":       "Case created successfully",
            "id":            str(result.inserted_id),
            "caseId":        case_id,
            "status":        doc["status"],
            "checklistUrl":  checklist_url,
            "createdAt":     doc["createdAt"].isoformat(),
            "notifications": wa_results,
        }

    except DuplicateKeyError:
        raise HTTPException(status_code=400, detail="Duplicate caseId — please retry")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("/checklist/{case_id}")
async def get_checklist_data(case_id: str):
    """
    Public endpoint — no authentication required.
    The caseId in the URL is the only secret; never expose sensitive fields here.
    Called by the React /checklist/:caseId page that recipients open from WhatsApp.
    """
    case = await collection.find_one(
        {"caseId": case_id},
        {
            "_id": 0,
            "caseId": 1,
            "claimantName": 1,
            "policyNumber": 1,
            "insurer": 1,
            "claimMode": 1,
            "claimSubtype": 1,
            "tags": 1,
            "claimPriority": 1,
            "hospitalDetails.name": 1,
            "hospitalDetails.admissionDate": 1,
            "targetDate": 1,
            "status": 1,
            "createdAt": 1,
        }
    )

    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    case["requiredDocuments"] = _get_document_list(
        tags=case.get("tags", []),
        claim_mode=case.get("claimMode", ""),
    )

    if isinstance(case.get("createdAt"), datetime):
        case["createdAt"] = case["createdAt"].isoformat()

    return case


@router.get("/cases")
async def get_cases(
    limit: int = 100,
    skip: int = 0,
    status: Optional[str] = None,
    tag: Optional[str] = None,
    search: Optional[str] = None,   # ← NEW: server-side search
):
    """Get all insurance cases with optional filtering, search, and pagination."""
    try:
        query = {}
        if status:
            query["status"] = status
        if tag:
            query["tags"] = tag
        if search:
            query["$or"] = [
                {"caseId":         {"$regex": search, "$options": "i"}},
                {"claimantName":   {"$regex": search, "$options": "i"}},
                {"insurer":        {"$regex": search, "$options": "i"}},
                {"insurerRef":     {"$regex": search, "$options": "i"}},
                {"claimantMobile": {"$regex": search, "$options": "i"}},
            ]

        cursor = collection.find(query, CASE_LIST_PROJECTION).sort("createdAt", -1).skip(skip).limit(limit)
        cases  = await cursor.to_list(length=limit)

        for case in cases:
            if isinstance(case.get("createdAt"), datetime):
                case["createdAt"] = case["createdAt"].isoformat()
            if isinstance(case.get("updatedAt"), datetime):
                case["updatedAt"] = case["updatedAt"].isoformat()

        total_count = await collection.count_documents(query)
        return {"cases": cases, "total": total_count, "limit": limit, "skip": skip}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching cases: {str(e)}")
@router.get("/cases/stats")
async def get_case_stats():
    """
    Lightweight counts for the Dashboard stat cards. Kept separate from
    /cases so the cards stay accurate once /cases is paginated (it only
    returns one page's worth of documents at a time).
    """
    try:
        start_of_day_ist = datetime.now(IST).replace(hour=0, minute=0, second=0, microsecond=0)

        total, active, completed, today = await asyncio.gather(
            collection.count_documents({}),
            collection.count_documents({"status": {"$nin": ["COMPLETED", "CLOSED", "DRAFT"]}}),
            collection.count_documents({"status": "COMPLETED"}),
            collection.count_documents({"createdAt": {"$gte": start_of_day_ist}}),
        )

        return {"total": total, "active": active, "today": today, "completed": completed}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching stats: {str(e)}")

@router.get("/cases/{case_id}")
async def get_case_by_id(case_id: str):
    """Get a single insurance case by caseId."""
    try:
        case = await collection.find_one({"caseId": case_id})
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")
        case["_id"] = str(case["_id"])
        if isinstance(case.get("createdAt"), datetime):
            case["createdAt"] = case["createdAt"].isoformat()
        if isinstance(case.get("updatedAt"), datetime):
            case["updatedAt"] = case["updatedAt"].isoformat()
        return case
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching case: {str(e)}")


@router.put("/cases/{case_id}")
async def update_case(case_id: str, data: InsuranceCase):
    try:
        existing = await collection.find_one({"caseId": case_id})
        if not existing:
            raise HTTPException(status_code=404, detail="Case not found")

        # exclude_unset (not exclude_none!) — a field explicitly sent as
        # null (e.g. tpaName cleared, accidentDetails cleared when the
        # Accident tag is removed) must still reach $set so it actually
        # clears in Mongo. Only fields genuinely absent from the request
        # body (e.g. conclusion, which buildPayload() never sends) get
        # skipped, so they don't get wiped out on every save.
        update_data = data.dict(exclude_unset=True)
        update_data["updatedAt"] = datetime.now(IST)
        update_data["status"]    = "ALLOCATED"

        # ── NEW: stamp doctor_assigned_at whenever the assigned doctor
        # actually changes (first assignment or reassignment). Needed so
        # /web/doctors/stats can build a time-based chart — doctor_assigned
        # alone has no associated timestamp. ────────────────────────────────
        new_doctor = update_data.get("doctor_assigned")
        if new_doctor and new_doctor != existing.get("doctor_assigned"):
            update_data["doctor_assigned_at"] = datetime.now(IST)

        # Serialise date objects to ISO strings for MongoDB
        for k, v in update_data.items():
            if isinstance(v, date) and not isinstance(v, datetime):
                update_data[k] = v.isoformat()
            elif isinstance(v, dict):
                for sub_k, sub_v in v.items():
                    if isinstance(sub_v, date) and not isinstance(sub_v, datetime):
                        v[sub_k] = sub_v.isoformat()

        await collection.update_one(
            {"caseId": case_id},
            {"$set": update_data}
        )

        return {
            "success": True,
            "caseId":  case_id,
            "message": "Case updated successfully",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("update_case error for %s: %s", case_id, e)
        raise HTTPException(status_code=500, detail=f"Error updating case: {str(e)}")


@router.get("/health")
async def health():
    """Health check — pings MongoDB."""
    try:
        await motor_client.admin.command("ping")
        return {
            "status": "healthy",
            "database": "connected",
            "timestamp": datetime.now(IST).isoformat()
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "database": "disconnected",
            "detail": str(e),
            "timestamp": datetime.now(IST).isoformat()
        }


@router.delete("/cases/{case_id}")
async def delete_case(case_id: str):
    """
    Hard-delete a single case from insurance_claims_new by caseId.
    Called by the dashboard Delete button after user confirms.
    """
    result = await collection.delete_one({"caseId": case_id})
 
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found.")
 
    return {
        "success": True,
        "caseId":  case_id,
        "message": f"Case {case_id} deleted successfully.",
    }
 
@router.get("/doctors")
async def get_auditing_doctors():
    """Return all active auditing doctors from user_auth collection."""
    user_auth_col = db["user_auth"]
    cursor = user_auth_col.find(
        {"role": "auditing-doctor-new", "status": "active"},
        {"_id": 0, "sys_user_id": 1, "full_name": 1, "email": 1, "phone_number": 1}
    )
    doctors = await cursor.to_list(length=200)
 
    return {"success": True, "doctors": doctors, "count": len(doctors)}

@router.get("/doctors/stats")
async def get_doctor_stats(
    range: Optional[str] = None,       # "today" | "yesterday" | "custom" | None (all-time)
    start_date: Optional[str] = None,  # "YYYY-MM-DD", required if range == "custom"
    end_date: Optional[str] = None,    # "YYYY-MM-DD", required if range == "custom"
):
    user_auth_col = db["user_auth"]
    doctors_cursor = user_auth_col.find(
        {"role": "auditing-doctor-new", "status": "active"},
        {"_id": 0, "sys_user_id": 1, "full_name": 1},
    )
    doctors = await doctors_cursor.to_list(length=200)
    doctor_names = {d["sys_user_id"]: d.get("full_name", "Unknown") for d in doctors}

    cursor = collection.find(
        {"doctor_assigned": {"$exists": True, "$nin": [None, ""]}},
        {
            "_id": 0, "caseId": 1, "doctor_assigned": 1, "doctor_assigned_at": 1,
            "createdAt": 1, "generated_pdf_at": 1, "generated_docx_at": 1,
            "generated_formatted_docx_at": 1, "generated_pdf_url": 1,
            "generated_docx_url": 1, "generated_formatted_docx_url": 1,
        },
    )
    cases = await cursor.to_list(length=5000)

    # ── Resolve the requested date window (IST) ────────────────────────────
    now_ist = datetime.now(IST)
    today_start = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)
    window_start = window_end = None  # None = no filtering (all-time)

    if range == "today":
        window_start = today_start
        window_end = today_start + timedelta(days=1)
    elif range == "yesterday":
        window_start = today_start - timedelta(days=1)
        window_end = today_start
    elif range == "custom":
        if not start_date or not end_date:
            raise HTTPException(status_code=400, detail="start_date and end_date required for range=custom")
        window_start = datetime.fromisoformat(start_date).replace(tzinfo=IST)
        window_end = datetime.fromisoformat(end_date).replace(tzinfo=IST) + timedelta(days=1)

    def _in_window(dt):
        if window_start is None:
            return True
        if not isinstance(dt, datetime):
            return False
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return window_start <= dt < window_end

    def _to_day(dt):
        if not isinstance(dt, datetime):
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc).astimezone(IST)
        return dt.date().isoformat()

    per_doctor: Dict[str, Dict[str, int]] = {}
    doctor_daily: Dict[str, Dict[str, Dict[str, int]]] = {}  # doctor_id -> day -> {assigned, generated}
    assigned_dates, generated_dates = [], []

    for c in cases:
        doc_id = c.get("doctor_assigned")
        if not doc_id:
            continue

        assigned_at = c.get("doctor_assigned_at") or c.get("createdAt")

        has_report = any([
            c.get("generated_pdf_url"), c.get("generated_docx_url"), c.get("generated_formatted_docx_url"),
        ])
        gen_ts = [t for t in (c.get("generated_pdf_at"), c.get("generated_docx_at"), c.get("generated_formatted_docx_at")) if isinstance(t, datetime)]
        generated_at = min(gen_ts) if gen_ts else assigned_at

        # Table/breakdown rows respect the date-range filter (assignment date);
        # the combined timeline below stays all-time so the chart shows full history.
        if not _in_window(assigned_at):
            continue

        stats = per_doctor.setdefault(doc_id, {"assigned_count": 0, "generated_count": 0})
        stats["assigned_count"] += 1
        if has_report:
            stats["generated_count"] += 1

        day = _to_day(assigned_at)
        if day:
            bucket = doctor_daily.setdefault(doc_id, {}).setdefault(day, {"assigned": 0, "generated": 0})
            bucket["assigned"] += 1
            if has_report and generated_at and _to_day(generated_at) == day:
                bucket["generated"] += 1

        if isinstance(assigned_at, datetime):
            assigned_dates.append(assigned_at)
        if has_report and generated_at:
            generated_dates.append(generated_at)

    doctors_out = [
        {"doctor_id": doc_id, "name": doctor_names.get(doc_id, doc_id), **s}
        for doc_id, s in per_doctor.items()
    ]
    doctors_out.sort(key=lambda d: d["assigned_count"], reverse=True)

    # ── Combined cumulative timeline (kept all-time, unaffected by range) ──
    all_cases = cases  # recompute unfiltered so the chart always shows full trend
    assigned_dates_full, generated_dates_full = [], []
    for c in all_cases:
        a = c.get("doctor_assigned_at") or c.get("createdAt")
        if isinstance(a, datetime):
            assigned_dates_full.append(a)
        gen_ts = [t for t in (c.get("generated_pdf_at"), c.get("generated_docx_at"), c.get("generated_formatted_docx_at")) if isinstance(t, datetime)]
        if gen_ts or any([c.get("generated_pdf_url"), c.get("generated_docx_url"), c.get("generated_formatted_docx_url")]):
            generated_dates_full.append(min(gen_ts) if gen_ts else a)

    from collections import Counter
    assigned_per_day = Counter(d for d in (_to_day(x) for x in assigned_dates_full) if d)
    generated_per_day = Counter(d for d in (_to_day(x) for x in generated_dates_full) if d)
    all_days = sorted(set(assigned_per_day) | set(generated_per_day))

    timeline = []
    running_a = running_g = 0
    for day in all_days:
        running_a += assigned_per_day.get(day, 0)
        running_g += generated_per_day.get(day, 0)
        timeline.append({"date": day, "assigned_cumulative": running_a, "generated_cumulative": running_g})

    return {
        "success": True,
        "doctors": doctors_out,
        "doctor_daily": doctor_daily,   # NEW: { doctor_id: { "2026-08-04": {assigned, generated}, ... } }
        "timeline": timeline,
        "totals": {
            "assigned": sum(d["assigned_count"] for d in doctors_out),
            "generated": sum(d["generated_count"] for d in doctors_out),
        },
        "range": range,
        "window": {
            "start": window_start.isoformat() if window_start else None,
            "end": window_end.isoformat() if window_end else None,
        },
    }

@router.patch("/debug-case/{case_id}/fields")
async def debug_patch_fields(case_id: str, request: Request):
    """
    TEST-ONLY endpoint: patch arbitrary top-level fields on a case without
    the full InsuranceCase validation (no required-field checks). Use this
    from Postman to quickly try different insurer / tpaName combinations
    and confirm the format lands correctly in Mongo.

    Body: any subset of top-level fields, e.g.
      { "insurer": "Niva Bupa Health Insurance", "tpaName": "Optimus Medical Services" }

    Notes:
    - Does NOT touch nested cashlessDetails.tpaName — pass that explicitly
      too if you want both in sync, e.g.
        {
          "insurer": "...",
          "tpaName": "...",
          "cashlessDetails.tpaName": "..."   <-- dotted key, handled below
        }
    - Does NOT run TPA_OPTIONS / insurer-list validation — this is raw,
      so you can also test *invalid* values to see how the frontend
      dropdowns react to unexpected strings.
    - Remove or gate this behind an env flag before shipping to prod.
    """
    body = await request.json()
    if not isinstance(body, dict) or not body:
        raise HTTPException(status_code=400, detail="Body must be a non-empty JSON object")

    existing = await collection.find_one({"caseId": case_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Case not found")

    set_doc = {}
    for k, v in body.items():
        # allow dotted keys like "cashlessDetails.tpaName" to reach nested fields
        set_doc[k] = v

    set_doc["updatedAt"] = datetime.now(IST)

    await collection.update_one({"caseId": case_id}, {"$set": set_doc})

    # read back so you can immediately confirm the stored format in Postman
    updated = await collection.find_one(
        {"caseId": case_id},
        {"_id": 0, "caseId": 1, "insurer": 1, "tpaName": 1, "cashlessDetails.tpaName": 1}
    )

    return {"success": True, "caseId": case_id, "applied": body, "current": updated}
    
@router.get("/debug-case/{case_id}")
async def debug_case(case_id: str):

    try:
        data = await collection.find_one({
            "caseId": case_id
        })

        if not data:
            raise HTTPException(
                status_code=404,
                detail="Case not found"
            )

        # convert ObjectId
        data["_id"] = str(data["_id"])

        # convert datetime fields
        for key, value in list(data.items()):
            if isinstance(value, datetime):
                data[key] = value.isoformat()

        return {
            "success": True,
            "data": data
        }

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )
        
@router.patch("/cases/{case_id}/reassign-investigation")
async def reassign_investigation(case_id: str, request: Request):
    """
    Reassign a specific inv_type to a new officer.
    Body: { inv_type, old_investigator_id, new_investigator_id, new_investigator_name }
    """
    body = await request.json()
    inv_type         = body.get("inv_type")
    old_id           = body.get("old_investigator_id")
    new_id           = body.get("new_investigator_id")
    new_name         = body.get("new_investigator_name")

    if not all([inv_type, new_id, new_name]):
        raise HTTPException(status_code=400, detail="inv_type, new_investigator_id, new_investigator_name required")

    claim = await collection.find_one({"caseId": case_id})
    if not claim:
        raise HTTPException(status_code=404, detail="Case not found")

    inv_list = claim.get("investigations", {}).get(inv_type, [])

    # Find the entry to replace
    new_list = []
    replaced = False
    for entry in inv_list:
        if isinstance(entry, dict) and entry.get("investigatorId") == old_id:
            new_list.append({
                **entry,
                "investigatorId":        new_id,
                "investigatorName":      new_name,
                "assignmentResponse":    None,   # reset — new officer hasn't responded
                "assignmentResponseAt":  None,
                "declineReason":         "",
                "reassignedAt":          datetime.now(IST),
                "reassignedFrom":        old_id,
            })
            replaced = True
        else:
            new_list.append(entry)

    # If old_id not found (e.g. first assignment), just append
    if not replaced:
        new_list.append({
            "investigatorId":   new_id,
            "investigatorName": new_name,
            "customDocs":       [],
            "note":             "",
            "assignmentResponse": None,
            "assignmentResponseAt": None,
        })

    await collection.update_one(
        {"caseId": case_id},
        {"$set": {
            f"investigations.{inv_type}": new_list,
            "updatedAt": datetime.now(IST),
        }}
    )

    return {"success": True, "case_id": case_id, "inv_type": inv_type, "new_investigator": new_name}

@router.get("/analytics/overview")
async def get_analytics_overview():
    """
    Aggregate stats for the Analytics/Stats sidebar page: KPI cards,
    status/tag/priority/claim-mode breakdowns, insurer breakdown, and a
    30-day new-case trend.

    NOTE: the case document only has createdAt/updatedAt — no per-stage
    timestamp log — so this deliberately does NOT compute TAT or a
    genuine/suspicious/repudiated split. Those fields don't exist on the
    model; add stage timestamps first if you want real TAT later.
    """
    try:
        cursor = collection.find({}, {
            "_id": 0, "status": 1, "tags": 1, "claimPriority": 1,
            "claimMode": 1, "claimSubtype": 1, "insurer": 1,
            "claimedAmount": 1, "createdAt": 1, "updatedAt": 1, "targetDate": 1,
            "claimSource": 1,
        })
        cases = await cursor.to_list(length=100000)

        now_ist = datetime.now(IST)
        today_start = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)
        week_start  = today_start - timedelta(days=today_start.weekday())
        month_start = today_start.replace(day=1)

        def _aware(dt):
            if not isinstance(dt, datetime):
                return None
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(IST)

        def _parse_target(v):
            # targetDate is stored exactly as the frontend sent it (often
            # DD/MM/YYYY) — never normalised server-side, unlike
            # dateOfIncident/dateOfIntimation. Handle both shapes here.
            if not v:
                return None
            s = str(v).strip()
            try:
                if len(s) == 10 and s[2] == "/" and s[5] == "/":
                    dd, mm, yyyy = s.split("/")
                    s = f"{yyyy}-{mm}-{dd}"
                d = datetime.fromisoformat(s)
                return d if d.tzinfo else d.replace(tzinfo=IST)
            except Exception:
                return None

        total = len(cases)
        status_counts, tag_counts, priority_counts, mode_counts, source_counts = {}, {}, {}, {}, {}
        insurer_agg: Dict[str, Dict[str, Any]] = {}
        total_claimed = 0.0
        claimed_n = 0
        today_n = week_n = month_n = 0
        sla_breached = 0
        daily_new: Dict[str, int] = {}

        OPEN_STATUSES = {"ALLOCATED", "IN_PROGRESS", "EVIDENCE_COLLECTION", "UNDER_REVIEW", "QC_PENDING"}

        for c in cases:
            status = c.get("status") or "UNKNOWN"
            status_counts[status] = status_counts.get(status, 0) + 1
            source = c.get("claimSource") or "Unspecified"
            source_counts[source] = source_counts.get(source, 0) + 1

            for t in (c.get("tags") or []):
                tag_counts[t] = tag_counts.get(t, 0) + 1

            pri = c.get("claimPriority") or "Normal"
            priority_counts[pri] = priority_counts.get(pri, 0) + 1

            mode = c.get("claimMode") or "unspecified"
            mode_counts[mode] = mode_counts.get(mode, 0) + 1

            amt = c.get("claimedAmount")
            if isinstance(amt, (int, float)):
                total_claimed += amt
                claimed_n += 1

            insurer = c.get("insurer") or "Unknown"
            bucket = insurer_agg.setdefault(insurer, {
                "count": 0, "total_claimed": 0.0, "claimed_n": 0, "status_counts": {},
            })
            bucket["count"] += 1
            if isinstance(amt, (int, float)):
                bucket["total_claimed"] += amt
                bucket["claimed_n"] += 1
            bucket["status_counts"][status] = bucket["status_counts"].get(status, 0) + 1

            created = _aware(c.get("createdAt"))
            if created:
                if created >= today_start:
                    today_n += 1
                if created >= week_start:
                    week_n += 1
                if created >= month_start:
                    month_n += 1
                day = created.date().isoformat()
                daily_new[day] = daily_new.get(day, 0) + 1

            if status in OPEN_STATUSES:
                td = _parse_target(c.get("targetDate"))
                if td and td < now_ist:
                    sla_breached += 1

        insurer_breakdown = [
            {
                "insurer": name,
                "count": b["count"],
                "total_claimed": round(b["total_claimed"], 2),
                "avg_claimed": round(b["total_claimed"] / b["claimed_n"], 2) if b["claimed_n"] else None,
                "status_counts": b["status_counts"],
            }
            for name, b in insurer_agg.items()
        ]
        insurer_breakdown.sort(key=lambda x: x["count"], reverse=True)

        last_30_days = sorted(daily_new.keys())[-30:]
        daily_trend = [{"date": d, "new_cases": daily_new[d]} for d in last_30_days]

        return {
            "success": True,
            "kpis": {
                "total_cases": total,
                "active": sum(status_counts.get(s, 0) for s in OPEN_STATUSES),
                "completed": status_counts.get("COMPLETED", 0),
                "draft": status_counts.get("DRAFT", 0),
                "closed": status_counts.get("CLOSED", 0),
                "total_claimed_amount": round(total_claimed, 2),
                "avg_claimed_amount": round(total_claimed / claimed_n, 2) if claimed_n else None,
                "today": today_n,
                "this_week": week_n,
                "this_month": month_n,
                "sla_breached": sla_breached,
            },
            "status_breakdown": [{"status": s, "count": n} for s, n in status_counts.items()],
            "source_breakdown": [{"source": s, "count": n} for s, n in source_counts.items()],
            "priority_breakdown": [{"priority": p, "count": n} for p, n in priority_counts.items()],
            "tag_breakdown": [{"tag": t, "count": n} for t, n in tag_counts.items()],
            "claim_mode_breakdown": [{"mode": m, "count": n} for m, n in mode_counts.items()],
            "insurer_breakdown": insurer_breakdown,
            "daily_trend": daily_trend,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error building analytics overview: {str(e)}")


@router.get("/md/analytics/overview")
async def get_md_analytics_overview(request: Request):
    await _require_md(request)
    return await get_analytics_overview()


@router.get("/md/doctors/stats")
async def get_md_doctor_stats(request: Request):
    await _require_md(request)
    return await get_doctor_stats()


@router.get("/operations/analytics/overview")
async def get_operations_analytics_overview(request: Request):
    await _require_operations(request)
    return await get_analytics_overview()


@router.get("/operations/doctors/stats")
async def get_operations_doctor_stats(request: Request):
    await _require_operations(request)
    return await get_doctor_stats()


# ─────────────────────────────────────────────────────────────────────────────
# Extended MD / Operations analytics (spec §20.1 / §20.2)
#
# Plain async function — deliberately NOT exposed as an unguarded /web route.
# Only the guarded /md and /operations wrappers below call it, so this
# (heavier, privileged) data never leaks to the public dashboard overview.
#
# Only the analytics whose data actually exists in the current model are
# computed. The `blocked` list explains, per spec section, why the rest are
# not — they need per-stage audit timestamps and a per-visit `state` field
# that the schema does not yet capture. The frontend renders `blocked` as an
# explicit "requires stage/audit logging" stub rather than hiding it.
# ─────────────────────────────────────────────────────────────────────────────
async def get_performance_overview():
    try:
        cases = await collection.find({}, {
            "_id": 0, "caseId": 1, "status": 1, "insurer": 1,
            "targetDate": 1, "investigations": 1, "qcDecision": 1,
            "claimPriority": 1,
        }).to_list(length=100000)

        # ── Field Officer performance + reassignment (from investigations) ──
        fo_agg: Dict[str, Dict[str, Any]] = {}
        reassign_total = 0
        reassign_by_type: Dict[str, int] = {}
        decline_reasons: Dict[str, int] = {}

        def _fo_bucket(oid, name):
            b = fo_agg.setdefault(oid, {
                "officer_id": oid, "name": name or oid,
                "assigned": 0, "accepted": 0, "declined": 0,
                "reassigned_away": 0, "pending": 0,
            })
            # Backfill a real name if a later entry carries one.
            if name and b["name"] == oid:
                b["name"] = name
            return b

        for c in cases:
            invs = c.get("investigations") or {}
            if not isinstance(invs, dict):
                continue
            for inv_type, entries in invs.items():
                for e in (entries or []):
                    if not isinstance(e, dict):
                        continue
                    oid = e.get("investigatorId")
                    if not oid:
                        continue
                    b = _fo_bucket(oid, e.get("investigatorName"))
                    b["assigned"] += 1
                    resp = e.get("assignmentResponse")
                    if resp == "accepted":
                        b["accepted"] += 1
                    elif resp == "declined":
                        b["declined"] += 1
                    else:
                        b["pending"] += 1

                    reason = (e.get("declineReason") or "").strip()
                    if reason:
                        decline_reasons[reason] = decline_reasons.get(reason, 0) + 1

                    if e.get("reassignedFrom"):
                        reassign_total += 1
                        reassign_by_type[inv_type] = reassign_by_type.get(inv_type, 0) + 1
                        prev = _fo_bucket(e.get("reassignedFrom"), None)
                        prev["reassigned_away"] += 1

        # Join current availability / leave status onto each officer.
        avail = await db["field_officer_availability"].find({}, {
            "_id": 0, "userId": 1, "status": 1, "leaveFrom": 1,
        }).to_list(length=10000)
        avail_by_id = {a.get("userId"): a for a in avail}
        for oid, b in fo_agg.items():
            a = avail_by_id.get(oid)
            b["availability"] = a.get("status") if a else "Unknown"
            b["on_leave"] = bool(a and a.get("leaveFrom"))

        field_officers = sorted(fo_agg.values(), key=lambda x: x["assigned"], reverse=True)

        # ── SLA / overdue open cases (targetDate parse mirrors overview) ──
        now_ist = datetime.now(IST)
        OPEN_STATUSES = {"ALLOCATED", "IN_PROGRESS", "EVIDENCE_COLLECTION", "UNDER_REVIEW", "QC_PENDING"}

        def _parse_target(v):
            if not v:
                return None
            s = str(v).strip()
            try:
                if len(s) == 10 and s[2] == "/" and s[5] == "/":
                    dd, mm, yyyy = s.split("/")
                    s = f"{yyyy}-{mm}-{dd}"
                d = datetime.fromisoformat(s)
                return d if d.tzinfo else d.replace(tzinfo=IST)
            except Exception:
                return None

        overdue = []
        for c in cases:
            if c.get("status") in OPEN_STATUSES:
                td = _parse_target(c.get("targetDate"))
                if td and td < now_ist:
                    overdue.append({
                        "caseId": c.get("caseId"),
                        "insurer": c.get("insurer") or "Unknown",
                        "status": c.get("status"),
                        "priority": c.get("claimPriority") or "Normal",
                        "targetDate": c.get("targetDate"),
                        "days_overdue": (now_ist - td).days,
                    })
        overdue.sort(key=lambda x: x["days_overdue"], reverse=True)

        # ── QC performance (from qcDecision written by the QC router) ──
        qc_approve = qc_reinvestigate = 0
        qc_by_doctor: Dict[str, Dict[str, Any]] = {}
        for c in cases:
            qc = c.get("qcDecision")
            if not isinstance(qc, dict):
                continue
            action = qc.get("action")
            if action == "APPROVE":
                qc_approve += 1
            elif action == "REINVESTIGATE":
                qc_reinvestigate += 1
            docname = qc.get("doctor") or qc.get("doctor_id")
            if docname:
                d = qc_by_doctor.setdefault(docname, {"doctor": docname, "approved": 0, "reinvestigate": 0})
                if action == "APPROVE":
                    d["approved"] += 1
                elif action == "REINVESTIGATE":
                    d["reinvestigate"] += 1

        return {
            "success": True,
            "field_officers": field_officers,
            "reassignment": {
                "total": reassign_total,
                "by_type": [{"inv_type": t, "count": n} for t, n in sorted(reassign_by_type.items(), key=lambda x: -x[1])],
                "decline_reasons": [{"reason": r, "count": n} for r, n in sorted(decline_reasons.items(), key=lambda x: -x[1])],
            },
            "sla": {
                "overdue_count": len(overdue),
                "overdue": overdue[:100],
            },
            "qc": {
                "approved": qc_approve,
                "reinvestigate": qc_reinvestigate,
                "reviewed": qc_approve + qc_reinvestigate,
                "by_doctor": sorted(qc_by_doctor.values(), key=lambda x: (x["approved"] + x["reinvestigate"]), reverse=True),
            },
            "blocked": [
                {"key": "stage_tat", "label": "Stage turnaround & minute-level timing",
                 "reason": "Cases store only createdAt/updatedAt — no per-stage timestamp/audit log yet (spec §15.1)."},
                {"key": "state_performance", "label": "State performance",
                 "reason": "No per-visit `state` field exists on cases yet (spec §6)."},
                {"key": "reporting_manager", "label": "Reporting Manager performance",
                 "reason": "No reporting-manager allocation records are captured yet (spec §9)."},
                {"key": "portal_team", "label": "Portal Team performance",
                 "reason": "No portal download/processing events are logged yet (spec §11.2)."},
                {"key": "no_resource_events", "label": "No-available-doctor / field-officer events",
                 "reason": "These conditions are not persisted as events yet (spec §20.1)."},
            ],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error building performance overview: {str(e)}")


@router.get("/md/analytics/performance")
async def get_md_performance_overview(request: Request):
    await _require_md(request)
    return await get_performance_overview()


@router.get("/operations/analytics/performance")
async def get_operations_performance_overview(request: Request):
    await _require_operations(request)
    return await get_performance_overview()
