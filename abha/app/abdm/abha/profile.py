import requests
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Header, HTTPException
from abdm.auth.gateway_auth import get_gateway_token
from pydantic import BaseModel
from typing import Optional
from fastapi.responses import Response
from core.config import ABDM_BASE_URL
import base64
import logging

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/profile", tags=["ABDM-Profile"])


# -------------------------
# Helpers
# -------------------------
def common_headers(access_token: str, x_token: str):
    return {
        "Authorization": f"Bearer {access_token}",
        "X-Token": f"Bearer {x_token}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
    }


@router.get("")
def get_profile(
    x_token: str = Header(...),
):
    access_token = get_gateway_token()
    x_token = x_token.replace("Bearer ", "")

    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/account"

    headers = common_headers(access_token, x_token)
    logger.info("headderslogging: %s", headers)

    res = requests.get(url, headers=headers)
    if not res.ok:
        raise HTTPException(res.status_code, res.text)

    return res.json()

@router.get("/qrcode")
def get_profile_qrcode(x_token: str = Header(...)):
    access_token = get_gateway_token()
    x_token = x_token.replace("Bearer ", "")

    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/account/qrCode"
    headers = common_headers(access_token, x_token)

    res = requests.get(url, headers=headers)

    if not res.ok:
        raise HTTPException(res.status_code, res.text)

    # ✅ Convert PNG bytes to base64
    encoded = base64.b64encode(res.content).decode("utf-8")

    return {
        "qrCode": encoded,
        "format": "image/png"
    }



class ProfilePhotoUpdate(BaseModel):
    profilePhoto: str  # encrypted base64 image

@router.put("/photo")
def update_profile_photo(
    body: ProfilePhotoUpdate,
    x_token: str = Header(...),
):
    access_token = get_gateway_token()
    x_token = x_token.replace("Bearer ", "")

    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/account"

    headers = common_headers(access_token, x_token)
    logger.info("Updating profile photo for user with x_token: %s", x_token)
    logger.info("profileheader: %s", headers)
    res = requests.put(url, json=body.dict(), headers=headers)
    if not res.ok:
        raise HTTPException(res.status_code, res.text)

    return res.json()


@router.get("/abha-card")
def get_abha_card(
    x_token: str = Header(...),
):
    logger.info("Received request to download ABHA card with x_token: %s", x_token)
    access_token = get_gateway_token()
    x_token = x_token.replace("Bearer ", "")
    logger.info("Fetching ABHA card for user with x_token: %s", x_token)

    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/account/abha-card"
    headers = common_headers(access_token, x_token)
    logger.info("Headers for ABHA card request: %s", headers)
    res = requests.get(url, headers=headers)
    if not res.ok:
        raise HTTPException(res.status_code, res.text)

    return Response(
        content=res.content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": "attachment; filename=ABHA-Card.pdf"
        }
    )


@router.get("/health")
def health():
    return {"status": "healthy",
            "service": "integration",
            "timestamp": datetime.now().isoformat()}

