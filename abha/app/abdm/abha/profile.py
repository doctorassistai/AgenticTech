import requests
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Header, HTTPException, Request
from abdm.auth.gateway_auth import get_gateway_token
from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Literal
from fastapi.responses import Response
from core.config import ABDM_BASE_URL
from .service import encrypt_aadhaar_number, acknowledge_profile_share
import base64
import logging

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/profile", tags=["ABDM-Profile"])


# -------------------------
# Helpers
# -------------------------

# Every outbound call to ABDM must be bounded, or a slow/unreachable ABDM
# server will hang a worker thread indefinitely in production.
ABDM_REQUEST_TIMEOUT = 15  # seconds


def _abdm_request(method: str, url: str, **kwargs):
    """Thin wrapper around requests.request() used for every ABDM call in
    this router. Enforces a timeout and turns network-level failures
    (DNS, connect, read timeout) into a clean HTTPException instead of an
    unhandled exception or an indefinitely hung request."""
    kwargs.setdefault("timeout", ABDM_REQUEST_TIMEOUT)
    try:
        return requests.request(method, url, **kwargs)
    except requests.exceptions.Timeout:
        logger.error("ABDM request timed out: %s %s", method, url)
        raise HTTPException(status_code=504, detail="ABDM server did not respond in time")
    except requests.exceptions.ConnectionError as exc:
        logger.error("ABDM connection error: %s %s - %s", method, url, exc)
        raise HTTPException(status_code=503, detail="Could not reach ABDM server")
    except requests.exceptions.RequestException as exc:
        logger.error("ABDM request failed: %s %s - %s", method, url, exc)
        raise HTTPException(status_code=502, detail="ABDM request failed")


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
    # ABDM's real "Photo Change" request (per Postman) is PATCH /profile/account,
    # not PUT. Sandbox tolerated PUT; production ABDM does not.
    res = requests.patch(url, json=body.dict(), headers=headers)
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

    upstream_ctype = res.headers.get("Content-Type", "")
    logger.info(
        "ABHA card upstream response: status=%s content-type=%s length=%s",
        res.status_code, upstream_ctype, len(res.content) if res.content else 0,
    )

    if not res.ok:
        logger.error("ABDM abha-card call failed: %s", res.text[:1000])
        raise HTTPException(res.status_code, res.text)

    if not res.content:
        raise HTTPException(status_code=502, detail="ABDM returned an empty ABHA card response")

    # ABDM's sandbox has been observed returning the card as either a PDF
    # or a PNG image depending on account/environment — accept either
    # instead of hard-requiring PDF bytes.
    content = res.content
    if content.startswith(b"%PDF"):
        media_type = "application/pdf"
        filename = "ABHA-Card.pdf"
    elif content.startswith(b"\x89PNG\r\n\x1a\n"):
        media_type = "image/png"
        filename = "ABHA-Card.png"
    elif upstream_ctype.startswith("image/"):
        media_type = upstream_ctype
        filename = "ABHA-Card." + upstream_ctype.split("/")[-1]
    else:
        logger.error(
            "ABDM returned an unrecognized ABHA card format. content-type=%s, first 500 bytes=%r",
            upstream_ctype, content[:500],
        )
        raise HTTPException(
            status_code=502,
            detail=f"ABDM did not return a recognized ABHA card format (content-type: {upstream_ctype})",
        )

    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f"attachment; filename={filename}"
        }
    )


class MobileUpdateRequest(BaseModel):
    mobile_number: str

class EmailUpdateRequest(BaseModel):
    email: str

class ProfileOtpVerifyRequest(BaseModel):
    txnId: str
    otp: str


# -------------------------
# Shared account-action helpers (mobile/email update, delete, deactivate all reuse these)
# -------------------------
def _request_profile_update_otp(
    x_token: str,
    login_hint: str,
    scope_verify: str,
    login_id: str,
    otp_system: str = "abdm",
    otp_scopes: list | None = None,
):
    access_token = get_gateway_token()

    x_token = x_token.replace("Bearer ", "")

    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/account/request/otp"

    headers = common_headers(access_token, x_token)
    logger.info(f"loooogoin_id:{login_id}")
    payload = {
        "scope": otp_scopes or ["abha-profile", scope_verify],
        "loginHint": login_hint,
        "loginId": encrypt_aadhaar_number(login_id),
        "otpSystem": otp_system,
    }

    logger.info(
        "ABDM OTP request -> url=%s scope=%s loginHint=%s otpSystem=%s",
        url, payload["scope"], payload["loginHint"], payload["otpSystem"],
    )

    res = requests.post(
        url,
        json=payload,
        headers=headers
    )

    logger.info("ABDM response: status=%s body=%s", res.status_code, res.text)

    if not res.ok:
        if "Invalid Scope" in res.text:
            logger.error(
                "ABDM rejected scope %s for client — this usually means the "
                "sandbox client isn't provisioned for this scope yet.",
                payload["scope"],
            )
        raise HTTPException(status_code=res.status_code, detail=res.text)

    return res.json()

def _verify_profile_update_otp(x_token: str, scope_verify: str, txn_id: str, otp: str, reasons: list = None):
    access_token = get_gateway_token()
    x_token = x_token.replace("Bearer ", "")

    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/account/verify"
    headers = common_headers(access_token, x_token)

    payload = {
        "scope": ["abha-profile", scope_verify],
        "authData": {
            "authMethods": ["otp"],
            "otp": {
                "txnId": txn_id,
                "otpValue": encrypt_aadhaar_number(otp),
            },
        },
    }
    if reasons:
        payload["reasons"] = reasons

    res = requests.post(url, json=payload, headers=headers)
    logger.info("Profile action verify-otp raw response: status=%s body=%s", res.status_code, res.text)
    if not res.ok:
        raise HTTPException(res.status_code, res.text)

    data = res.json()
    if data.get("authResult") != "success":
        logger.warning("Profile action OTP verification failed: %s", data.get("message"))
        raise HTTPException(status_code=400, detail=data.get("message", "OTP verification failed"))
    return data


def _verify_profile_action_by_password(x_token: str, scope_verify: str, password: str, reasons: list = None):
    """Same /profile/account/verify endpoint as _verify_profile_update_otp,
    but authMethods=['password'] - used by Delete/Deactivate via Password."""
    access_token = get_gateway_token()
    x_token = x_token.replace("Bearer ", "")

    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/account/verify"
    headers = common_headers(access_token, x_token)

    payload = {
        "scope": ["abha-profile", scope_verify],
        "authData": {
            "authMethods": ["password"],
            "password": {
                "password": encrypt_aadhaar_number(password),
            },
        },
    }
    if reasons:
        payload["reasons"] = reasons

    res = requests.post(url, json=payload, headers=headers)
    if not res.ok:
        raise HTTPException(res.status_code, res.text)

    data = res.json()
    if data.get("authResult") != "success":
        logger.warning("Profile action password verification failed: %s", data.get("message"))
        raise HTTPException(status_code=400, detail=data.get("message", "Password verification failed"))
    return data


class MobileUpdateRequest(BaseModel):
    mobile_number: str

class EmailUpdateRequest(BaseModel):
    email: str

class ProfileOtpVerifyRequest(BaseModel):
    txnId: str
    otp: str

class AccountActionOtpRequest(BaseModel):
    abha_number: str

class AccountActionVerifyRequest(BaseModel):
    txnId: str
    otp: str
    reasons: List[str] = ["User requested"]

class AccountActionPasswordRequest(BaseModel):
    password: str
    reasons: List[str] = ["User requested"]


@router.post("/mobile/request-otp")
def request_mobile_update_otp(req: MobileUpdateRequest, x_token: str = Header(...)):
    return _request_profile_update_otp(x_token, "mobile", "mobile-verify", req.mobile_number)


@router.post("/mobile/verify-otp")
def verify_mobile_update_otp(req: ProfileOtpVerifyRequest, x_token: str = Header(...)):
    return _verify_profile_update_otp(x_token, "mobile-verify", req.txnId, req.otp)


@router.post("/email/request-otp")
def request_email_update_otp(req: EmailUpdateRequest, x_token: str = Header(...)):
    return _request_profile_update_otp(x_token, "email", "email-verify", req.email)


@router.post("/email/verify-otp")
def verify_email_update_otp(req: ProfileOtpVerifyRequest, x_token: str = Header(...)):
    return _verify_profile_update_otp(x_token, "email-verify", req.txnId, req.otp)


# --- Deactivate ABHA: 3 methods ---
@router.post("/deactivate/aadhaar/request-otp")
def deactivate_via_aadhaar_request(req: AccountActionOtpRequest, x_token: str = Header(...)):
    return _request_profile_update_otp(x_token, "abha-number", "de-activate", req.abha_number, otp_system="aadhaar")

@router.post("/deactivate/aadhaar/verify-otp")
def deactivate_via_aadhaar_verify(req: AccountActionVerifyRequest, x_token: str = Header(...)):
    return _verify_profile_update_otp(x_token, "de-activate", req.txnId, req.otp, reasons=req.reasons)

@router.post("/deactivate/mobile/request-otp")
def deactivate_via_mobile_request(req: AccountActionOtpRequest, x_token: str = Header(...)):
    return _request_profile_update_otp(x_token, "abha-number", "de-activate", req.abha_number, otp_system="abdm")

@router.post("/deactivate/mobile/verify-otp")
def deactivate_via_mobile_verify(req: AccountActionVerifyRequest, x_token: str = Header(...)):
    return _verify_profile_update_otp(x_token, "de-activate", req.txnId, req.otp, reasons=req.reasons)

@router.post("/deactivate/password")
def deactivate_via_password(req: AccountActionPasswordRequest, x_token: str = Header(...)):
    return _verify_profile_action_by_password(x_token, "de-activate", req.password, reasons=req.reasons)


# --- Delete ABHA: 3 methods ---
@router.post("/delete/aadhaar/request-otp")
def delete_via_aadhaar_request(req: AccountActionOtpRequest, x_token: str = Header(...)):
    return _request_profile_update_otp(x_token, "abha-number", "delete", req.abha_number, otp_system="aadhaar")

@router.post("/delete/aadhaar/verify-otp")
def delete_via_aadhaar_verify(req: AccountActionVerifyRequest, x_token: str = Header(...)):
    return _verify_profile_update_otp(x_token, "delete", req.txnId, req.otp, reasons=req.reasons)


@router.post("/delete/mobile/request-otp")
def delete_via_mobile_request(
    req: AccountActionOtpRequest,
    x_token: str = Header(...)
):
    logger.info("Delete-via-ABHA-OTP requested for ABHA number: %s", req.abha_number)

    return _request_profile_update_otp(
        x_token,
        "abha-number",
        "delete",
        req.abha_number,
        otp_system="abdm",
    )


@router.post("/delete/mobile/verify-otp")
def delete_via_mobile_verify(
    req: AccountActionVerifyRequest,
    x_token: str = Header(...)
):
    print("========== DELETE MOBILE VERIFY OTP ==========")
    print("TXN ID:", req.txnId)
    print("OTP:", req.otp)
    print("REASONS:", req.reasons)
    print("==============================================")

    return _verify_profile_update_otp(
        x_token,
        "delete",
        req.txnId,
        req.otp,
        reasons=req.reasons
    )



@router.post("/delete/password")
def delete_via_password(req: AccountActionPasswordRequest, x_token: str = Header(...)):
    return _verify_profile_action_by_password(x_token, "delete", req.password, reasons=req.reasons)


# ============================================================================
# GAP #15: Update Metadata Links — Email Verification Link
# POST /abha/api/v3/profile/account/request/emailVerificationLink
# Distinct from the /account/request/otp email-update flow above — this sends
# a verification LINK (not an OTP) to an email already saved on the account.
# Matches Postman: "ABHA enrolment via Aadhaar / Email Verification Link"
# ============================================================================
class EmailVerificationLinkRequest(BaseModel):
    email: str  # will be encrypted before calling ABDM


@router.post("/email/verification-link")
def send_email_verification_link(req: EmailVerificationLinkRequest, x_token: str = Header(...)):
    access_token = get_gateway_token()
    x_token_clean = x_token.replace("Bearer ", "")

    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/account/request/emailVerificationLink"
    headers = common_headers(access_token, x_token_clean)

    payload = {
        "scope": ["abha-profile", "email-link-verify"],
        "loginHint": "email",
        "loginId": encrypt_aadhaar_number(req.email),
        "otpSystem": "abdm",
    }

    logger.info("Sending email verification link")
    res = requests.post(url, json=payload, headers=headers)
    if not res.ok:
        raise HTTPException(res.status_code, res.text)
    return res.json()


# ============================================================================
# GAP #16: Benefit Linking Engine
# POST /abha/api/v3/profile/benefit/linkAndDelink
# Supports all 3 Postman variants: via X-Token, via ABHA number, via xmlUid
# ============================================================================
class BenefitLinkRequest(BaseModel):
    scope: List[str]                    # ["link"] or ["de-link"]
    benefit_name: str
    login_hint: Optional[str] = None    # "abha-number" | "xmlUid" — omit when using X-Token
    login_id: Optional[str] = None      # encrypted abha-number / xmlUid — omit when using X-Token


@router.post("/benefit/link-delink")
def link_delink_benefit(req: BenefitLinkRequest, x_token: Optional[str] = Header(None)):
    access_token = get_gateway_token()

    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/benefit/linkAndDelink"

    headers = {
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
        "BENEFIT_NAME": req.benefit_name,
        "Authorization": f"Bearer {access_token}",
    }

    payload = {"scope": req.scope}

    if x_token:
        headers["X-Token"] = f"Bearer {x_token.replace('Bearer ', '')}"
    elif req.login_hint and req.login_id:
        payload["loginHint"] = req.login_hint
        payload["loginId"] = req.login_id
    else:
        raise HTTPException(
            status_code=400,
            detail="Provide either an X-Token header, or both login_hint and login_id",
        )

    logger.info(f"Benefit {req.scope} for '{req.benefit_name}'")
    res = _abdm_request("POST", url, json=payload, headers=headers)
    if not res.ok:
        raise HTTPException(res.status_code, res.text)
    return res.json()


# ============================================================================
# GAP #17: Benefit Search
# POST /abha/api/v3/profile/benefit/search           (search by loginHint)
# GET  /abha/api/v3/profile/benefit/abha/{abhaNumber} (direct lookup)
# ============================================================================
class BenefitSearchRequest(BaseModel):
    benefit_name: str
    login_hint: Literal["abha-number", "xmlUid"]
    login_id: str  # plain abha-number or xmlUid — encrypted before calling ABDM


@router.post("/benefit/search")
def search_benefit(req: BenefitSearchRequest):
    access_token = get_gateway_token()

    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/benefit/search"
    headers = {
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
        "BENEFIT_NAME": req.benefit_name,
        "Authorization": f"Bearer {access_token}",
    }

    payload = {
        "scope": ["search"],
        "loginHint": req.login_hint,
        "loginId": encrypt_aadhaar_number(req.login_id),
    }

    logger.info(f"Benefit search (loginHint={req.login_hint}) for '{req.benefit_name}'")
    res = _abdm_request("POST", url, json=payload, headers=headers)
    if not res.ok:
        raise HTTPException(res.status_code, res.text)
    return res.json()


@router.get("/benefit/abha/{abha_number}")
def get_benefit_by_abha_number(
    abha_number: str,
    benefit_name: str = Header(..., alias="Benefit-Name"),
):
    """Direct benefit lookup by ABHA number. Pass the benefit scheme name
    in the 'Benefit-Name' request header."""
    access_token = get_gateway_token()

    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/benefit/abha/{abha_number}"
    headers = {
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
        "BENEFIT_NAME": benefit_name,
        "Authorization": f"Bearer {access_token}",
    }

    res = _abdm_request("GET", url, headers=headers)
    if not res.ok:
        raise HTTPException(res.status_code, res.text)
    return res.json()


@router.post("/logout")
def logout_profile(x_token: str = Header(...)):
    access_token = get_gateway_token()
    x_token_clean = x_token.replace("Bearer ", "")

    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/account/request/logout"
    headers = common_headers(access_token, x_token_clean)

    res = requests.get(url, headers=headers)
    if not res.ok:
        raise HTTPException(res.status_code, res.text)

    return {"message": "Logged out successfully"}


# ============================================================================
# GAP #18: Refresh Token
# GET /abha/api/v3/profile/account/request/token
# Exchange a refreshToken for a fresh X-token/refreshToken pair *before* the
# current X-token expires (expiresIn is typically 1800s), so the frontend
# never has to force a full re-login just because the short-lived token aged
# out mid-session.
# ============================================================================
@router.get("/refresh-token")
def refresh_session_token(r_token: str = Header(..., alias="R-Token")):
    """Call this proactively — e.g. a couple of minutes before the current
    X-token's expiresIn elapses — with the refreshToken received at login."""
    access_token = get_gateway_token()
    r_token_clean = r_token.replace("Bearer ", "")

    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/account/request/token"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "R-token": f"Bearer {r_token_clean}",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
    }

    logger.info("Refreshing ABHA session token")
    res = _abdm_request("GET", url, headers=headers)
    if not res.ok:
        logger.error("ABDM refresh-token failed: status=%s body=%s", res.status_code, res.text)
        raise HTTPException(res.status_code, res.text)

    data = res.json()
    if not data.get("token"):
        raise HTTPException(status_code=400, detail="ABDM did not return a refreshed token — the refreshToken may be expired; ask the user to log in again")

    return {
        "X-token": data.get("token"),
        "refreshToken": data.get("refreshToken"),
        "expiresIn": data.get("expiresIn"),
    }


# ============================================================================
# GAP #19: Set Password (initial set / forgot-password-style reset via OTP)
# Distinct from /change-password above, which requires knowing the CURRENT
# password. This flow lets a user who has never set one — or who has
# forgotten it — set a new password after proving identity via OTP instead.
#
# Step 1: request/otp with loginHint="password", loginId=<new password,
#         encrypted> — ABDM ties the pending new password to the txnId.
# Step 2: verify with the OTP — on success ABDM applies the password tied
#         to that txnId.
# Reuses the same _request_profile_update_otp / _verify_profile_update_otp
# helpers already used for mobile/email update above.
# ============================================================================
import re

ABHA_PASSWORD_RE = re.compile(
    r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,20}$"
)


class SetPasswordOtpRequest(BaseModel):
    new_password: str = Field(..., min_length=1)
    # "aadhaar": OTP goes to the Aadhaar-linked mobile.
    # "abdm": OTP goes to the mobile number registered with ABDM.
    otp_system: Literal["aadhaar", "abdm"] = "abdm"

    @field_validator("new_password")
    @classmethod
    def enforce_password_policy(cls, v):
        if not ABHA_PASSWORD_RE.match(v):
            raise ValueError(
                "Password must be 8–20 characters and include at least one "
                "uppercase letter, one lowercase letter, one digit, and one "
                "special character."
            )
        return v


class SetPasswordVerifyRequest(BaseModel):
    txnId: str = Field(..., min_length=1)
    otp: str = Field(..., min_length=4, max_length=6, pattern=r"^\d{4,6}$")


@router.post("/password/set/request-otp")
def set_password_request_otp(req: SetPasswordOtpRequest, x_token: str = Header(...)):
    """Step 1 of setting a password without knowing the old one."""
    logger.info(
        "Requesting OTP to set ABHA account password (otp_system=%s), x_token ending: %s",
        req.otp_system, x_token[-12:] if x_token else "none",
    )
    return _request_profile_update_otp(
        x_token, "password", "change-password", req.new_password, otp_system=req.otp_system
    )


@router.post("/password/set/verify-otp")
def set_password_verify_otp(req: SetPasswordVerifyRequest, x_token: str = Header(...)):
    """Step 2: verifying the OTP applies the new password submitted in step 1."""
    logger.info("Verifying OTP to set ABHA account password, txnId: %s", req.txnId)
    return _verify_profile_update_otp(x_token, "change-password", req.txnId, req.otp)


# ============================================================================
# GAP #20: Re-KYC
# POST /abha/api/v3/profile/account/request/otp  (scope: re-kyc)
# POST /abha/api/v3/profile/account/verify        (scope: re-kyc)
# Required periodically by ABDM to re-confirm a patient's KYC details are
# still current. Reuses the same generic update-OTP helpers.
# ============================================================================
class ReKycOtpRequest(BaseModel):
    abha_number: str

    @field_validator("abha_number", mode="before")
    @classmethod
    def normalize_abha_number(cls, v):
        if isinstance(v, str):
            digits = "".join(ch for ch in v if ch.isdigit())
            if len(digits) != 14:
                raise ValueError("ABHA number must contain 14 digits (format: XX-XXXX-XXXX-XXXX)")
            return f"{digits[0:2]}-{digits[2:6]}-{digits[6:10]}-{digits[10:14]}"
        return v


class ReKycVerifyRequest(BaseModel):
    txnId: str = Field(..., min_length=1)
    otp: str = Field(..., min_length=4, max_length=6, pattern=r"^\d{4,6}$")


@router.post("/re-kyc/request-otp")
def re_kyc_request_otp(req: ReKycOtpRequest, x_token: str = Header(...)):
    logger.info("Requesting Re-KYC OTP for ABHA ending in %s", req.abha_number[-4:])
    return _request_profile_update_otp(x_token, "abha-number", "re-kyc", req.abha_number, otp_system="aadhaar")


@router.post("/re-kyc/verify-otp")
def re_kyc_verify_otp(req: ReKycVerifyRequest, x_token: str = Header(...)):
    logger.info("Verifying Re-KYC OTP for txnId: %s", req.txnId)
    return _verify_profile_update_otp(x_token, "re-kyc", req.txnId, req.otp)


@router.get("/health")
def health():
    return {"status": "healthy",
            "service": "integration",
            "timestamp": datetime.now().isoformat()}


# ============================================================================
# Scan & Share — Profile Share (HIP inbound callback)
# ABDM Gateway calls this when a patient scans/shares their ABHA profile
# with this facility. The bridge's registered callback URL must point to:
#   POST {{callback_url}}/api/v3/hip/patient/share
# On success we acknowledge back to CM via:
#   POST https://dev.abdm.gov.in/api/hiecm/patient-share/v3/on-share
# ============================================================================
share_router = APIRouter(tags=["Scan-and-Share"])

# In-memory store of received Scan & Share profile shares.
# Swap for a real DB table if this needs to survive a restart.
_received_shares: List[dict] = []


@share_router.post("/api/v3/hip/patient/share")
async def receive_patient_profile_share(request: Request):
    body = await request.json()
    request_id = request.headers.get("REQUEST-ID")

    logger.info(f"Received profile-share callback (intent={body.get('intent')}) requestId={request_id}")

    patient = body.get("profile", {}).get("patient", {})
    abha_address = patient.get("abhaAddress")

    _received_shares.append({
        "requestId": request_id,
        "receivedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "abhaNumber": patient.get("abhaNumber"),
        "abhaAddress": abha_address,
        "name": patient.get("name"),
        "gender": patient.get("gender"),
        "dayOfBirth": patient.get("dayOfBirth"),
        "monthOfBirth": patient.get("monthOfBirth"),
        "yearOfBirth": patient.get("yearOfBirth"),
        "phoneNumber": patient.get("phoneNumber"),
        "address": patient.get("address"),
    })

    acknowledge_profile_share(request_id=request_id, abha_address=abha_address)

    return {"status": "ACCEPTED"}


@router.get("/share/incoming")
def list_incoming_shares():
    """Provider-facing: list patient profiles received via Scan & Share, most recent first."""
    return {"shares": list(reversed(_received_shares))}





####password set#####
class ChangePasswordRequest(BaseModel):
    oldPassword: str
    newPassword: str

@router.post("/change-password")
def change_password(
    req: ChangePasswordRequest,
    x_token: str = Header(...),
):
    access_token = get_gateway_token()
    x_token_clean = x_token.replace("Bearer ", "")

    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/account/verify"

    headers = common_headers(access_token, x_token_clean)

    payload = {
        "scope": [
            "abha-profile",
            "change-password"
        ],
        "authData": {
            "authMethods": [
                "password"
            ],
            "password": {
                "newPassword": encrypt_aadhaar_number(req.newPassword),
                "oldPassword": encrypt_aadhaar_number(req.oldPassword),
            }
        }
    }

    logger.info("Changing ABHA account password")

    res = _abdm_request(
        "POST",
        url,
        json=payload,
        headers=headers,
    )

    if not res.ok:
        logger.error(
            "ABDM change-password failed: status=%s body=%s",
            res.status_code,
            res.text,
        )
        raise HTTPException(
            status_code=res.status_code,
            detail=res.text,
        )

    data = res.json()

    if data.get("authResult") != "success":
        logger.warning(
            "ABDM change-password failed: %s",
            data.get("message"),
        )
        raise HTTPException(
            status_code=400,
            detail=data.get("message", "Password change failed"),
        )

    return data








# ============================================================================
# ABDM Gateway / Scan & Share Bridge Setup
# ============================================================================
#
# This integrates the Gateway configuration APIs with the existing
# Scan & Share callback below.
#
# Existing callback:
#   POST /api/v3/hip/patient/share
#
# New provider-facing setup APIs:
#   POST /profile/scan-share/setup
#   POST /profile/scan-share/bridge-url
#   POST /profile/scan-share/facility
#   GET  /profile/scan-share/services
#   GET  /profile/scan-share/service/{service_id}
#
# IMPORTANT:
# Gateway clientId/clientSecret are NEVER sent from React.
# get_gateway_token() handles Gateway authentication.
# ============================================================================

import os


ABDM_GATEWAY_BASE_URL = os.getenv(
    "ABDM_GATEWAY_BASE_URL",
    "https://dev.abdm.gov.in/api/hiecm/gateway/v3",
)

ABDM_FACILITY_BASE_URL = os.getenv(
    "ABDM_FACILITY_BASE_URL",
    "https://facilitysbx.abdm.gov.in/v1",
)


def gateway_api_headers(access_token: str):
    """
    Headers for ABDM Gateway APIs.

    This uses the Gateway access token obtained from /sessions.
    """
    return {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
    }


def gateway_request(method: str, url: str, payload: dict = None):
    """
    Common helper for authenticated ABDM Gateway requests.
    """

    access_token = get_gateway_token()

    headers = gateway_api_headers(access_token)

    try:
        response = requests.request(
            method=method,
            url=url,
            json=payload,
            headers=headers,
            timeout=30,
        )
    except requests.RequestException as exc:
        logger.exception("ABDM Gateway request failed")

        raise HTTPException(
            status_code=502,
            detail=f"Unable to connect to ABDM Gateway: {str(exc)}",
        )

    if not response.ok:
        logger.error(
            "ABDM Gateway error: method=%s url=%s status=%s body=%s",
            method,
            url,
            response.status_code,
            response.text[:1000],
        )

        raise HTTPException(
            status_code=response.status_code,
            detail=response.text,
        )

    if not response.content:
        return {}

    try:
        return response.json()
    except ValueError:
        return {
            "status": "success",
            "response": response.text,
        }


# ============================================================================
# Request models
# ============================================================================

class ScanShareBridgeUrlRequest(BaseModel):
    """
    Public callback URL which ABDM Gateway will call when
    patient performs Scan & Share.
    """

    url: str


class ScanShareHRP(BaseModel):
    bridgeId: str
    hipName: str
    type: str = "HIP"
    active: bool = True


class ScanShareFacilityRequest(BaseModel):
    facilityId: str
    facilityName: str
    HRP: List[ScanShareHRP]


class ScanShareSetupRequest(BaseModel):
    """
    One-call setup for Scan & Share.
    """

    callbackUrl: str

    facilityId: str
    facilityName: str

    bridgeId: str
    hipName: str

    type: str = "HIP"
    active: bool = True


# ============================================================================
# 1. Register callback URL with ABDM Gateway
#
# ABDM:
# POST /api/hiecm/gateway/v3/bridge/url
#
# Body:
# {
#     "url": "{{callback_url}}"
# }
# ============================================================================

@router.post("/scan-share/bridge-url")
def configure_scan_share_bridge_url(
    req: ScanShareBridgeUrlRequest,
):
    logger.info(
        "Configuring ABDM Scan & Share callback URL"
    )

    url = f"{ABDM_GATEWAY_BASE_URL}/bridge/url"

    return gateway_request(
        method="POST",
        url=url,
        payload={
            "url": req.url,
        },
    )


# ============================================================================
# 2. Register Facility + HIP/HRP
#
# ABDM:
# POST https://facilitysbx.abdm.gov.in/v1/bridges/MutipleHRPAddUpdateServices
#
# Body:
# {
#   "facilityId": "...",
#   "facilityName": "...",
#   "HRP": [
#       {
#           "bridgeId": "...",
#           "hipName": "...",
#           "type": "HIP",
#           "active": true
#       }
#   ]
# }
# ============================================================================

@router.post("/scan-share/facility")
def configure_scan_share_facility(
    req: ScanShareFacilityRequest,
):
    logger.info(
        "Registering Scan & Share facility: facilityId=%s",
        req.facilityId,
    )

    url = (
        f"{ABDM_FACILITY_BASE_URL}"
        "/bridges/MutipleHRPAddUpdateServices"
    )

    payload = {
        "facilityId": req.facilityId,
        "facilityName": req.facilityName,
        "HRP": [
            {
                "bridgeId": item.bridgeId,
                "hipName": item.hipName,
                "type": item.type,
                "active": item.active,
            }
            for item in req.HRP
        ],
    }

    return gateway_request(
        method="POST",
        url=url,
        payload=payload,
    )


# ============================================================================
# 3. ONE-CALL Scan & Share setup
#
# This is the function I recommend your frontend calls.
#
# It performs:
#
#   Step 1 -> Register callback URL
#   Step 2 -> Register facility/HIP
#
# Both use the same Gateway authentication.
# ============================================================================

@router.post("/scan-share/setup")
def setup_scan_share(
    req: ScanShareSetupRequest,
):
    logger.info(
        "Starting complete ABDM Scan & Share setup"
    )

    # ------------------------------------------------------------------
    # STEP 1: Register callback URL
    # ------------------------------------------------------------------

    bridge_url = f"{ABDM_GATEWAY_BASE_URL}/bridge/url"

    bridge_result = gateway_request(
        method="POST",
        url=bridge_url,
        payload={
            "url": req.callbackUrl,
        },
    )

    # ------------------------------------------------------------------
    # STEP 2: Register facility/HIP
    # ------------------------------------------------------------------

    facility_url = (
        f"{ABDM_FACILITY_BASE_URL}"
        "/bridges/MutipleHRPAddUpdateServices"
    )

    facility_payload = {
        "facilityId": req.facilityId,
        "facilityName": req.facilityName,
        "HRP": [
            {
                "bridgeId": req.bridgeId,
                "hipName": req.hipName,
                "type": req.type,
                "active": req.active,
            }
        ],
    }

    facility_result = gateway_request(
        method="POST",
        url=facility_url,
        payload=facility_payload,
    )

    return {
        "success": True,
        "message": "ABDM Scan & Share bridge setup completed",
        "bridge": bridge_result,
        "facility": facility_result,
    }


# ============================================================================
# 4. Get Gateway bridge services
#
# GET /api/hiecm/gateway/v3/bridge-services
# ============================================================================

@router.get("/scan-share/services")
def get_scan_share_services():
    logger.info(
        "Fetching ABDM Gateway bridge services"
    )

    url = f"{ABDM_GATEWAY_BASE_URL}/bridge-services"

    return gateway_request(
        method="GET",
        url=url,
    )


# ============================================================================
# 5. Get a particular Gateway bridge service
#
# GET /bridge-service/serviceId/{serviceId}
# ============================================================================

@router.get("/scan-share/service/{service_id}")
def get_scan_share_service(
    service_id: str,
):
    logger.info(
        "Fetching ABDM bridge service: serviceId=%s",
        service_id,
    )

    url = (
        f"{ABDM_GATEWAY_BASE_URL}"
        f"/bridge-service/serviceId/{service_id}"
    )

    return gateway_request(
        method="GET",
        url=url,
    )