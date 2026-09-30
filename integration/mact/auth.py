"""
integration/mact/auth.py

Identity for MACT routes. The gateway already checks the login cookie before
proxying, but this service verifies the token itself too (same approach as
patient_app): the integration container must never trust "the gateway checked".

The gateway login sets an `access_token` cookie (JWT: sub, role, username).
The proxy forwards the Cookie header untouched, so we read it here. An
`Authorization: Bearer <jwt>` header is accepted as a fallback.

Only real user accounts pass: the token's `sub` must exist in `user_auth`
(integrator tokens use a different id space and are rejected).

Nothing raises at import time. Missing SECRET_KEY / ALGORITHM -> routes answer 503.
"""

import logging
import os
from typing import Optional

from fastapi import HTTPException, Request
from jose import JWTError, jwt

from .db import user_auth

logger = logging.getLogger("mact.auth")

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
AUTH_CONFIGURED = bool(SECRET_KEY) and bool(ALGORITHM) and ALGORITHM.strip().lower() != "none"
if not AUTH_CONFIGURED:
    logger.error("SECRET_KEY / ALGORITHM missing or invalid: MACT routes will return 503")


def _token_from(request: Request) -> Optional[str]:
    token = request.cookies.get("access_token")
    if token:
        return token
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip() or None
    return None


async def require_user(request: Request) -> dict:
    """Dependency: returns the user_auth document (sys_user_id, username, role, status)."""
    if not AUTH_CONFIGURED:
        raise HTTPException(status_code=503, detail="MACT service not configured")
    token = _token_from(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Token expired or invalid")
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await user_auth.find_one(
        {"sys_user_id": sub}, {"_id": 0, "sys_user_id": 1, "username": 1, "role": 1, "status": 1}
    )
    if not user or user.get("status") == "inactive":
        raise HTTPException(status_code=401, detail="User not found")
    return user


def actor_of(user: dict) -> str:
    return user.get("username") or user.get("sys_user_id") or "unknown"