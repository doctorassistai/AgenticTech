"""
patient_app/auth.py

get_current_patient  -  the ONLY source of patient identity in this package.

Rules (handoff section 4, rule 1):
  * patient_id = token "sub" (a patient sys_user_id, "PAT-...").
  * Nothing from the URL, query string or body is ever used as an id.
  * Token role must be "patient"  -> any other role (doctor etc.) gets 403.
  * On every request the user must still exist and be active:
      - if a user_auth record exists for the sub, it must be role=patient and
        status=active (a deactivated account is NOT rescued by the fallback);
      - only if there is no user_auth record at all do we fall back to
        patient_users (patients created through the HMS integration endpoint
        have no user_auth record). patient_users has no status field, so
        existence is the check.
  * Bearer header only. The doctor cookie is deliberately not read here.
  * Logs sys_user_id and endpoint only. Never tokens, names or free text.
"""

import logging
from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException, Request
from jose import JWTError, jwt
from pymongo.errors import PyMongoError

from .config import ALGORITHM, AUTH_CONFIGURED, SECRET_KEY
from .db import doctor_users, patient_users, user_auth

logger = logging.getLogger("patient_app.auth")

@dataclass(frozen=True)
class Patient:
    sys_user_id: str
    username: Optional[str]  # HMS ID; informational only


@dataclass(frozen=True)
class Doctor:
    sys_user_id: str
    name: Optional[str]


def _unauthorized(reason: str, path: str, sub: Optional[str] = None) -> HTTPException:
    logger.warning("auth rejected (%s) sub=%s path=%s", reason, sub, path)
    return HTTPException(
        status_code=401,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_patient(request: Request) -> Patient:
    path = request.url.path

    if not AUTH_CONFIGURED:
        raise HTTPException(status_code=503, detail="Service temporarily unavailable")

    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        raise _unauthorized("missing bearer token", path)

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise _unauthorized("invalid or expired token", path)

    sub = payload.get("sub")
    role = payload.get("role")
    if not isinstance(sub, str) or not sub:
        raise _unauthorized("token has no sub", path)

    if role != "patient":
        logger.warning("auth forbidden (role=%s) sub=%s path=%s", role, sub, path)
        raise HTTPException(status_code=403, detail="Patient access only")

    try:
        record = await user_auth.find_one(
            {"sys_user_id": sub}, {"role": 1, "status": 1, "username": 1}
        )
        if record:
            if record.get("role") != "patient" or record.get("status") != "active":
                raise _unauthorized("user_auth not an active patient", path, sub)
            username = record.get("username")
        else:
            profile = await patient_users.find_one({"sys_user_id": sub}, {"hms_id": 1})
            if not profile:
                raise _unauthorized("patient not found", path, sub)
            username = profile.get("hms_id")
    except PyMongoError:
        logger.exception("auth lookup failed sub=%s path=%s", sub, path)
        raise HTTPException(status_code=503, detail="Service temporarily unavailable")

    logger.info("auth ok sub=%s path=%s", sub, path)
    return Patient(sys_user_id=sub, username=username)


async def get_current_doctor(request: Request) -> Doctor:
    """Doctor-facing counterpart to get_current_patient. NOT reached directly
    from outside the compose network: the gateway (gateway/routes/
    patient_app_doctor_proxy.py) is the only thing that can call integration
    (it has no published port — see README section 2), and the gateway
    already authenticates the doctor's session cookie itself before
    forwarding, injecting the verified sys_user_id as X-Doctor-Id. This
    function trusts that header rather than re-decoding the cookie a second
    time, since only the gateway can reach this container at all.
    Still 401s cleanly if the header is missing/empty, so a direct call
    against integration (e.g. from docker exec, or a future misconfigured
    caller) fails safe instead of silently trusting an empty doctor id."""
    path = request.url.path
    doctor_id = (request.headers.get("X-Doctor-Id") or "").strip()
    if not doctor_id:
        logger.warning("doctor auth rejected (missing X-Doctor-Id) path=%s", path)
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        record = await doctor_users.find_one({"sys_user_id": doctor_id}, {"name": 1})
    except PyMongoError:
        logger.exception("doctor auth lookup failed sub=%s path=%s", doctor_id, path)
        raise HTTPException(status_code=503, detail="Service temporarily unavailable")

    if not record:
        logger.warning("doctor auth rejected (not found) sub=%s path=%s", doctor_id, path)
        raise HTTPException(status_code=401, detail="Not authenticated")

    logger.info("doctor auth ok sub=%s path=%s", doctor_id, path)
    return Doctor(sys_user_id=doctor_id, name=record.get("name"))