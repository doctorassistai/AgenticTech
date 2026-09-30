import requests
from core.config import ABDM_BASE_URL, ABDM_CLIENT_ID, ABDM_CLIENT_SECRET, ABDM_BENEFIT_NAME
from abdm.auth.gateway_auth import get_gateway_token

from core.rsa_encryption import rsa_encrypt_oaep_sha1
from abdm.auth.token_cache import get_public_key, set_public_key
from abdm.auth.gateway_auth import fetch_public_key_from_server
import uuid
from datetime import datetime, timezone
import logging


# Set up logging
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

from abdm.auth.token_cache import clear_token, clear_public_key


def abdm_headers_with_token(extra: dict = None) -> dict:
    """Standard ABDM request headers. Every ABDM call needs a fresh REQUEST-ID and
    TIMESTAMP — reusing them across a retry is itself grounds for a rejection."""
    headers = {
        "Authorization": f"Bearer {get_gateway_token()}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
    }
    if extra:
        headers.update(extra)
    return headers


def refresh_abdm_credentials():
    """Drop both caches so the next abdm_headers_with_token() call re-fetches."""
    logger.warning("ABDM returned 401 — clearing cached gateway token and public key")
    clear_token()
    clear_public_key()


def abdm_error_detail(res) -> str:
    """Turn an ABDM error body into one readable sentence.

    Without this, HTTPException(400, res.text) shows the user a raw JSON blob
    like {"error":{"code":"ABDM-1032","message":"..."}}.
    """
    try:
        body = res.json()
    except ValueError:
        return res.text or f"ABDM returned HTTP {res.status_code}"

    if isinstance(body, list):
        return "; ".join(str(b) for b in body) or f"ABDM returned HTTP {res.status_code}"

    err = body.get("error") or body

    if isinstance(err, dict):
        details = err.get("details")
        if isinstance(details, list) and details:
            msgs = [d.get("message") for d in details if isinstance(d, dict) and d.get("message")]
            if msgs:
                return "; ".join(msgs)
        code = err.get("code")
        msg = err.get("message") or err.get("detail")
        if msg:
            return f"{msg} ({code})" if code else str(msg)

    return str(err)


def ensure_public_key() -> str:
    public_key = get_public_key()

    if public_key:
        return public_key

    # Fetch from server if missing/expired
    public_key = fetch_public_key_from_server()
    set_public_key(public_key)

    return public_key

def encrypt_aadhaar_number(aadhaar_number: str) -> str:
    # Placeholder for actual encryption logic
    public_key_pem = get_public_key()

    public_key_pem = ensure_public_key()
    message = aadhaar_number

    encrypted = rsa_encrypt_oaep_sha1(message, public_key_pem)
    print(encrypted)

    return encrypted  # Simple reversal for demonstration


def encrypt_abha_number(abha_number: str) -> str:
    """Encrypt an ABHA number (format XX-XXXX-XXXX-XXXX) with ABDM's public key,
    for use as `loginId` in Delete/Deactivate ABHA flows (loginHint=abha-number).
    Same RSA-OAEP-SHA1 scheme as encrypt_aadhaar_number, just named per credential
    type so call sites are self-documenting."""
    return encrypt_aadhaar_number(abha_number)

# def request_mobile_otp(aadhaar_number: str):
#     token = get_gateway_token()
#     print("Generating Otp")
#     url = f"{ABDM_BASE_URL}/abha/api/v3/enrollment/request/otp"
#     encrypted_aadhar = encrypt_aadhaar_number(aadhaar_number)
#     headers = {
#         "Authorization": f"Bearer {token}",
#         "Content-Type": "application/json",
#         "REQUEST-ID": str(uuid.uuid4()),
#         "TIMESTAMP": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
# ,
#               }
    
#     payload = {
#                     "txnId": "",
#                     "scope": [
#                         "abha-enrol"
#                     ],
#                     "loginHint": "aadhaar",
#                     "loginId": encrypted_aadhar,
#                     "otpSystem": "aadhaar"
#                 }

#     res = requests.post(url, json=payload, headers=headers)
#     res.raise_for_status()
#     return res.json()


def request_mobile_otp(aadhaar_number: str):
    # Get the gateway token
    token = get_gateway_token()

    logger.info(f"Generating OTP for Aadhaar number: {aadhaar_number}")
    
    # URL for OTP generation
    url = f"{ABDM_BASE_URL}/abha/api/v3/enrollment/request/otp"
    
    # Encrypt the Aadhaar number before sending it
    encrypted_aadhar = encrypt_aadhaar_number(aadhaar_number)

    # Prepare headers
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }

    # Prepare payload
    payload = {
        "scope": ["abha-enrol"],
        "loginHint": "aadhaar",
        "loginId": encrypted_aadhar,
        "otpSystem": "aadhaar"
    }

    # Log the request details
    logger.info(f"Sending request to OTP API: {url}")
    logger.debug(f"Headers: {headers}")
    logger.debug(f"Payload: {payload}")
    
    try:
        # Send POST request to generate OTP
        res = requests.post(url, json=payload, headers=headers)
        res.raise_for_status()

        # Log successful response
        logger.info(f"OTP generation successful. Response: {res.json()}")
        return res.json()

    except requests.exceptions.HTTPError as http_err:
        # Log the error response
        logger.error(f"HTTP error occurred: {http_err}")
        logger.error(f"Response status code: {res.status_code}, Response: {res.text}")

        from fastapi import HTTPException
        raise HTTPException(res.status_code, res.text)

    except Exception as err:
        # Log any other errors that occur
        logger.error(f"An error occurred: {err}")
        raise

def conform_enrol_otp(txn_id: str, otp: str, phone_number: str = None):
    """POST /abha/api/v3/enrollment/enrol/byAadhaar

    Only one retry is safe here: a 401, which means our cached gateway token or
    cached public key went stale. In that case the OTP has to be re-encrypted
    with the freshly fetched key, so the payload is rebuilt inside _send().

    A 504 (ABDM-1206) is NOT retried. The Aadhaar gateway being down consumes the
    transaction — replaying the same txnId/OTP is what turns one 504 into the
    401 cascade you were seeing. The user has to request a new OTP.
    """
    from fastapi import HTTPException

    url = f"{ABDM_BASE_URL}/abha/api/v3/enrollment/enrol/byAadhaar"

    def _send():
        payload = {
            "authData": {
                "authMethods": ["otp"],
                "otp": {
                    "txnId": txn_id,
                    # re-encrypted per attempt, against whatever key is cached now
                    "otpValue": encrypt_aadhaar_number(otp),
                    "mobile": phone_number,
                },
            },
            "consent": {"code": "abha-enrollment", "version": "1.4"},
        }
        return requests.post(
            url, json=payload, headers=abdm_headers_with_token(), timeout=30
        )

    res = _send()

    if res.status_code == 401:
        refresh_abdm_credentials()
        res = _send()

    if res.status_code in (502, 503, 504):
        logger.error(
            "Aadhaar gateway unavailable on enrol/byAadhaar: %s %s",
            res.status_code,
            res.text,
        )
        raise HTTPException(
            status_code=503,
            detail=(
                "Aadhaar gateway is temporarily unavailable (ABDM-1206). "
                "This OTP can no longer be used — please request a new OTP and try again."
            ),
        )

    if not res.ok:
        logger.error("enrol/byAadhaar failed: %s %s", res.status_code, res.text)
        raise HTTPException(status_code=res.status_code, detail=abdm_error_detail(res))

    data = res.json()

    # This txnId is the ENROLMENT txnId — it is what enrol/suggestion and
    # enrol/abha-address expect, so the frontend must overwrite its stored one.
    return {
        "txnId": data.get("txnId", txn_id),
        "status": data.get("status"),
        "tokens": data.get("tokens"),
        "message": data.get("message"),
        "isNew": data.get("isNew"),
        "ABHAProfile": data.get("ABHAProfile"),
    }

from enum import Enum
from typing import List


class LoginHint(str, Enum):
    ABHA_NUMBER = "abha-number"
    MOBILE = "mobile"
    AADHAAR = "aadhaar"


class OtpSystem(str, Enum):
    AADHAAR = "aadhaar"
    ABDM = "abdm"

# Convert these lines  into comments:
"""def request_login_otp(
    *,
    login_id: str,
    login_hint: str,
    scope: List[str],
    otp_system: str,
):
    token = get_gateway_token()

    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/login/request/otp"

    encrypted_login_id = encrypt_aadhaar_number(login_id)

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
    }

    payload = {
        "scope": scope,
        "loginHint": login_hint,
        "loginId": encrypted_login_id,
        "otpSystem": otp_system,
    }

    res = requests.post(url, json=payload, headers=headers)
    res.raise_for_status()
    return res.json()





def verify_login_otp(
    *,
    txn_id: str,
    otp: str,
    scope: List[str],
):
    token = get_gateway_token()

    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/login/verify"

    encrypted_otp = encrypt_aadhaar_number(otp)

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
    }

    payload = {
        "scope": scope,
        "authData": {
            "authMethods": ["otp"],
            "otp": {
                "txnId": txn_id,
                "otpValue": encrypted_otp,
            },
        },
    }

    res = requests.post(url, json=payload, headers=headers)
    res.raise_for_status()
    print("otp verification response:", res.json())
    return res.json()

"""
# --- NEW IMPLEMENTATION Clean dedicated Mobile Login Flow) -----------------------------------------------------------------------------

def request_mobile_login_otp_v2(mobile_number: str, *, login_hint: str = "mobile", extra_scope: list = None):
    """
    Dedicated function for handling Mobile OTP login requests.
    Defaults to loginHint="mobile". Pass login_hint="abha-number" and
    extra_scope=["re-activate"] to reuse this for the Reactivate-ABHA flow.
    """
    token = get_gateway_token()
    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/login/request/otp"
    
    encrypted_login_id = encrypt_aadhaar_number(mobile_number)
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
    }
    
    payload = {
        "scope": ["abha-login", "mobile-verify"] + (extra_scope or []),
        "loginHint": login_hint,
        "loginId": encrypted_login_id,
        "otpSystem": "abdm",
    }
    
    res = requests.post(url, json=payload, headers=headers)
    if not res.ok:
        logger.error(f"Mobile OTP request failed: {res.text}")
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=res.text)
        
    return res.json()


def verify_mobile_login_otp_v2(txn_id: str, otp: str, *, extra_scope: list = None):
    """
    Dedicated function for verifying Mobile OTP.
    Pass extra_scope=["re-activate"] to reuse this for the Reactivate-ABHA flow.
    """
    token = get_gateway_token()
    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/login/verify"
    
    encrypted_otp = encrypt_aadhaar_number(otp)
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
    }
    
    payload = {
        "scope": ["abha-login", "mobile-verify"] + (extra_scope or []),
        "authData": {
            "authMethods": ["otp"],
            "otp": {
                "txnId": txn_id,
                "otpValue": encrypted_otp,
            },
        },
    }
    
    res = requests.post(url, json=payload, headers=headers)
    if not res.ok:
        logger.error(f"Mobile OTP verification failed: {res.text}")
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=res.text)
        
    return res.json()
#over -- NEW IMPLEMENTATION Clean dedicated Mobile Login Flow) -----------------------------------------------------------------------------

def verify_user(abha_number: str, txn_id: str, access_token: str):
    token = get_gateway_token()
    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/login/verify/user"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "T-Token": f"Bearer {access_token}",  # <-- FIX: Added 'Bearer ' prefix
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }

    # In M1 V3, the payload is sometimes wrapped in authData depending on the exact version,
    # but let's stick to your existing payload first since the error was specifically about the T-Token.
    payload = {
        "ABHANumber": abha_number,
        "txnId": txn_id
    }

    res = requests.post(url, json=payload, headers=headers)
    
    if not res.ok:
        logger.error(f"ABDM VERIFY USER ERROR: {res.text}")
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=res.text)
        
    logger.info(f"User verification response: {res.json()}")
    return res.json()


def set_abha_password(x_token: str, new_password: str):
    """POST /abha/api/v3/profile/account/verify — set/reset the ABHA password.

    Verified against the Postman collection ("PASSWORD_SET" under
    ABHA Profile / Set Password). ABDM reuses its generic account/verify
    endpoint for this, driven by scope + authData.authMethods, not a
    dedicated /account/password endpoint.

    Must be called right after a fresh OTP-based login (verify_mobile_login_otp_v2
    or verify_aadhaar_login_otp_v2 with login_hint="abha-number") — ABDM ties
    this action to a just-verified session, not an old stored token.
    """
    from fastapi import HTTPException

    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/account/verify"
    encrypted_password = encrypt_aadhaar_number(new_password)

    # ABDM's schema requires oldPassword to be present as a validly-encrypted
    # string even when the account has never had a password (first-time set).
    # Leaving the key out entirely fails format validation with
    # {"oldPassword": "Invalid Old Password"} before ABDM even checks whether
    # a password exists. Sending an encrypted empty string satisfies the
    # format check; adjust here if ABDM's business logic instead rejects it.
    # An empty-string oldPassword caused ABDM's sandbox to throw an
    # unhandled server-side exception (501 ABDM-9999), rather than a clean
    # validation error — so the field isn't just "required to be present",
    # it's required to be a non-empty valid ciphertext. For a genuine
    # first-time set, send the same password as both old and new.
    encrypted_old_password = encrypt_aadhaar_number(new_password)

    payload = {
        "scope": ["abha-profile", "change-password"],
        "authData": {
            "authMethods": ["password"],
            "password": {
                "newPassword": encrypted_password,
                "oldPassword": encrypted_old_password
            }
        }
    }

    def _send():
        headers = abdm_headers_with_token({"X-token": f"Bearer {x_token}"})
        return requests.post(url, json=payload, headers=headers, timeout=30)

    res = _send()
    if res.status_code == 401:
        refresh_abdm_credentials()
        res = _send()

    if not res.ok:
        logger.error(f"Set ABHA password failed: {res.status_code} {res.text}")
        raise HTTPException(status_code=res.status_code, detail=abdm_error_detail(res))

    return res.json() if res.content else {"status": "PASSWORD_SET"}


def login_search_by_abha(abha_number: str):
    token = get_gateway_token()

    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/login/search"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
    }

    payload = {
        "ABHANumber": abha_number
    }

    res = requests.post(url, json=payload, headers=headers)
    res.raise_for_status()
    return res.json()


def verify_login_password(
    *,
    abha_number: str,
    password: str,
    extra_scope: list = None,
):
    token = get_gateway_token()

    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/login/verify"

    encrypted_password = encrypt_aadhaar_number(password)

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
    }

    payload = {
        "scope": [
            "abha-login",
            "password-verify"
        ] + (extra_scope or []),
        "authData": {
            "authMethods": ["password"],
            "password": {
                "ABHANumber": abha_number,
                "password": encrypted_password
            }
        }
    }

    res = requests.post(url, json=payload, headers=headers)
    if not res.ok:
        logger.error(f"Password login failed: {res.text}")
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=res.text)
    return res.json()



# def abha_address_suggestions(txn_id: str):
#     token = get_gateway_token()

#     url = f"{ABDM_BASE_URL}/abha/api/v3/enrollment/enrol/suggestion"

#     headers = {
#         "Authorization": f"Bearer {token}",
#         "Content-Type": "application/json",
#         "REQUEST-ID": str(uuid.uuid4()),
#         "TIMESTAMP": datetime.now(timezone.utc)
#             .isoformat(timespec="milliseconds")
#             .replace("+00:00", "Z"),
#         "txnId": txn_id,   # 🔥 REQUIRED
#     }

#     res = requests.post(url, json={}, headers=headers)
#     res.raise_for_status()
#     return res.json()


def abha_address_suggestions(txn_id: str):
    """GET /abha/api/v3/enrollment/enrol/suggestion

    The enrolment txnId goes in the TRANSACTION_ID header — not a query param,
    not a body field, not a header called "txnId". ABDM replies with
    {"txnId": "...", "abhaAddressList": ["someone1234", ...]}.

    The returned addresses are bare handles with no "@" suffix; ABDM appends the
    domain itself when you POST enrol/abha-address, so pass them through as-is.
    """
    from fastapi import HTTPException

    url = f"{ABDM_BASE_URL}/abha/api/v3/enrollment/enrol/suggestion"

    def _send():
        return requests.get(
            url,
            headers=abdm_headers_with_token({"TRANSACTION_ID": txn_id}),
            timeout=30,
        )

    res = _send()

    if res.status_code == 401:
        refresh_abdm_credentials()
        res = _send()

    if not res.ok:
        logger.error("enrol/suggestion failed: %s %s", res.status_code, res.text)
        raise HTTPException(status_code=res.status_code, detail=abdm_error_detail(res))

    data = res.json() or {}

    # ABDM has shipped this as a list of strings and, on some sandbox builds, a
    # list of objects. Normalise to a flat list of strings so the frontend has
    # exactly one shape to handle.
    raw = (
        data.get("abhaAddressList")
        or data.get("suggestion")
        or data.get("suggestions")
        or []
    )

    suggestions = []
    for item in raw:
        if isinstance(item, str):
            suggestions.append(item)
        elif isinstance(item, dict):
            value = item.get("abhaAddress") or item.get("address") or item.get("value")
            if value:
                suggestions.append(value)

    logger.info("enrol/suggestion returned %d suggestion(s)", len(suggestions))

    return {
        "txnId": data.get("txnId", txn_id),
        "abhaAddressList": suggestions,
    }


def create_abha_address(
    *,
    txn_id: str,
    abha_address: str,
    preferred: int = 1,
):
    token = get_gateway_token()

    url = f"{ABDM_BASE_URL}/abha/api/v3/enrollment/enrol/abha-address"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
    }

    payload = {
        "txnId": txn_id,
        "abhaAddress": abha_address,
        "preferred": preferred,
    }

    res = requests.post(url, json=payload, headers=headers)
    res.raise_for_status()
    return res.json()


# --- NEW IMPLEMENTATION  (Clean dedicated Aadhaar Login Flow) --- v

def request_aadhaar_login_otp_v2(aadhaar_number: str, *, login_hint: str = "aadhaar", extra_scope: list = None):
    """
    Dedicated function for handling Aadhaar OTP login requests.
    Defaults to loginHint="aadhaar". Pass login_hint="abha-number" and
    extra_scope=["re-activate"] to reuse this for the Reactivate-ABHA flow.
    """
    token = get_gateway_token()
    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/login/request/otp"
    
    encrypted_login_id = encrypt_aadhaar_number(aadhaar_number)
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
    }
    
    payload = {
        "scope": ["abha-login", "aadhaar-verify"] + (extra_scope or []),
        "loginHint": login_hint,
        "loginId": encrypted_login_id,
        "otpSystem": "aadhaar",
    }
    
    res = requests.post(url, json=payload, headers=headers)
    if not res.ok:
        logger.error(f"Aadhaar OTP request failed: {res.text}")
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=res.text)
        
    return res.json()


# ============================================================================
# GAP #5: Alternative ID Creation — ABHA enrolment via Driving Licence / other doc
# POST /abha/api/v3/enrollment/enrol/byDocument
# Matches Postman: "ABHA Enrolment via DL / Create Enrolment Number"
# ============================================================================

def acknowledge_profile_share(
    *,
    request_id: str,
    abha_address: str,
    status: str = "SUCCESS",
    context: str = "5",
    token_number: str = None,
    expiry: str = "1800",
):
    """Acknowledge back to ABDM CM after receiving a Scan & Share
    profile-share callback. POST /api/hiecm/patient-share/v3/on-share
    """
    token = get_gateway_token()
    url = "https://dev.abdm.gov.in/api/hiecm/patient-share/v3/on-share"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "X-CM-ID": "sbx",
    }

    payload = {
        "acknowledgement": {
            "status": status,
            "abhaAddress": abha_address,
            "profile": {
                "context": context,
                "tokenNumber": token_number,
                "expiry": expiry,
            },
        },
        "response": {
            "requestId": request_id,
        },
    }

    logger.info(f"Acknowledging profile-share for requestId={request_id}, abhaAddress={abha_address}")
    res = requests.post(url, json=payload, headers=headers)
    if not res.ok:
        logger.error(f"profile-share acknowledgement failed: {res.text}")
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=res.text)

    return res.json() if res.content else {"status": "ACK_SENT"}


def enrol_by_document(
    *,
    txn_id: str,
    document_type: str,
    document_id: str,
    first_name: str,
    last_name: str,
    dob: str,
    gender: str,
    front_side_photo: str,
    back_side_photo: str = None,
    address: str = None,
    state: str = None,
    district: str = None,
    pin_code: str = None,
    middle_name: str = None,
):
    token = get_gateway_token()
    url = f"{ABDM_BASE_URL}/abha/api/v3/enrollment/enrol/byDocument"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
    }

    payload = {
        "txnId": txn_id,
        "documentType": document_type,
        "documentId": document_id,
        "firstName": first_name,
        "middleName": middle_name,
        "lastName": last_name,
        "dob": dob,
        "gender": gender,
        "frontSidePhoto": front_side_photo,
        "backSidePhoto": back_side_photo,
        "address": address,
        "state": state,
        "district": district,
        "pinCode": pin_code,
        "consent": {
            "code": "abha-enrollment",
            "version": "1.4",
        },
    }

    res = requests.post(url, json=payload, headers=headers)
    if not res.ok:
        logger.error(f"Enrolment by document (DL) failed: {res.text}")
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=res.text)

    return res.json()


# ============================================================================
# GAP #6: Kiosk Biometric Hooks — ABHA enrolment via fingerprint / face / iris
# POST /abha/api/v3/enrollment/enrol/byAadhaar (authMethods: bio | face | iris)
# Matches Postman: "ABHA Enrollment via Biometrics / via Aadhaar Bio | Face | Iris"
# ============================================================================

def enrol_by_biometric(
    *,
    txn_id: str,
    method: str,  # "bio" | "face" | "iris"
    encrypted_aadhaar: str,
    pid_data: str,
    mobile_number: str,
):
    token = get_gateway_token()
    url = f"{ABDM_BASE_URL}/abha/api/v3/enrollment/enrol/byAadhaar"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
    }

    # Each biometric method has its own body key, per ABDM spec:
    #   bio  -> "fingerPrintAuthPid"
    #   face -> "rdPidData"
    #   iris -> "Pid"
    if method == "bio":
        auth_block = {"aadhaar": encrypted_aadhaar, "fingerPrintAuthPid": pid_data, "mobile": mobile_number}
    elif method == "face":
        auth_block = {"aadhaar": encrypted_aadhaar, "rdPidData": pid_data, "mobile": mobile_number}
    elif method == "iris":
        auth_block = {"aadhaar": encrypted_aadhaar, "Pid": pid_data, "mobile": mobile_number}
    else:
        raise ValueError(f"Unsupported biometric method: {method}")

    payload = {
        "authData": {
            "authMethods": [method],
            method: auth_block,
        },
        "consent": {
            "code": "abha-enrollment",
            "version": "1.4",
        },
    }

    res = requests.post(url, json=payload, headers=headers)
    if not res.ok:
        logger.error(f"Biometric ({method}) enrolment failed: {res.text}")
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=res.text)

    data = res.json()
    return {
        "txnId": data.get("txnId"),
        "status": data.get("status"),
        "tokens": data.get("tokens"),
        "message": data.get("message"),
    }


def verify_aadhaar_login_otp_v2(txn_id: str, otp: str, *, extra_scope: list = None):
    """
    Dedicated function for verifying Aadhaar OTP.
    Unlike Mobile Login, Aadhaar Login directly returns the session token (X-Token).
    Pass extra_scope=["re-activate"] to reuse this for the Reactivate-ABHA flow.
    """
    token = get_gateway_token()
    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/login/verify"
    
    encrypted_otp = encrypt_aadhaar_number(otp)
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
    }
    
    payload = {
        "scope": ["abha-login", "aadhaar-verify"] + (extra_scope or []),
        "authData": {
            "authMethods": ["otp"],
            "otp": {
                "txnId": txn_id,
                "otpValue": encrypted_otp,
            },
        },
    }
    
    res = requests.post(url, json=payload, headers=headers)
    if not res.ok:
        logger.error(f"Aadhaar OTP verification failed: {res.text}")
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=res.text)
        
    return res.json()


# ============================================================================
# FIND ABHA — search for existing ABHA accounts by mobile number, then log in
# via OTP against the chosen account.
# ============================================================================

def search_abha_by_mobile(mobile_number: str):
    """Step 1: search for ABHA accounts linked to a mobile number."""
    token = get_gateway_token()
    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/account/abha/search"
    encrypted_mobile = encrypt_aadhaar_number(mobile_number)

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }
    payload = {"scope": ["search-abha"], "mobile": encrypted_mobile}

    res = requests.post(url, json=payload, headers=headers, timeout=30)
    if res.status_code == 401:
        refresh_abdm_credentials()
        headers = abdm_headers_with_token()
        payload = {"scope": ["search-abha"], "mobile": encrypt_aadhaar_number(mobile_number)}
        res = requests.post(url, json=payload, headers=headers, timeout=30)

    if not res.ok:
        logger.error(f"Find ABHA search failed: {res.text}")
        from fastapi import HTTPException
        raise HTTPException(status_code=res.status_code, detail=abdm_error_detail(res))

    data = res.json()
    logger.info("Find ABHA raw search response: %s", data)

    # Your sandbox returns a bare JSON ARRAY here, not an object — that is the
    # "'list' object has no attribute 'get'" crash. Other ABDM builds wrap it as
    # {"txnId": ..., "accounts": [...]}. Handle both.
    txn_id = None
    if isinstance(data, dict):
        raw = data.get("accounts") or data.get("ABHA") or data.get("abhaAccounts") or []
        txn_id = data.get("txnId")
    elif isinstance(data, list):
        raw = data
    else:
        raw = []

    accounts = []
    for acc in raw:
        if not isinstance(acc, dict):
            continue
        # On the bare-array shape the txnId rides on the account objects.
        txn_id = txn_id or acc.get("txnId")
        accounts.append({
            "ABHANumber": acc.get("ABHANumber") or acc.get("abhaNumber") or "",
            "name": acc.get("name") or acc.get("fullName") or "",
            "preferredAbhaAddress": acc.get("preferredAbhaAddress") or acc.get("abhaAddress") or "",
            "status": acc.get("status") or "",
            "kycVerified": acc.get("kycVerified"),
        })

    logger.info("Find ABHA search returned %d account(s), txnId=%s", len(accounts), txn_id)
    return {"txnId": txn_id, "accounts": accounts}


def find_abha_request_otp(search_txn_id: str, index: int):
    """Step 2: request OTP for the account picked from the search results.
    'index' is the 1-based position of the chosen account in the search response."""
    token = get_gateway_token()
    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/login/request/otp"
    encrypted_index = encrypt_aadhaar_number(str(index))

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }
    payload = {
        "scope": ["abha-login", "search-abha", "mobile-verify"],
        "loginHint": "index",
        "loginId": encrypted_index,
        "otpSystem": "abdm",
        "txnId": search_txn_id,
    }

    res = requests.post(url, json=payload, headers=headers, timeout=30)
    if not res.ok:
        logger.error(f"Find ABHA request-otp failed: {res.text}")
        from fastapi import HTTPException
        raise HTTPException(status_code=res.status_code, detail=abdm_error_detail(res))
    return res.json()


def find_abha_verify_otp(txn_id: str, otp: str):
    """Step 3: verify OTP, returns the full login session (token/refreshToken)."""
    token = get_gateway_token()
    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/login/verify"
    encrypted_otp = encrypt_aadhaar_number(otp)

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }
    payload = {
        "scope": ["abha-login", "mobile-verify"],
        "authData": {"authMethods": ["otp"], "otp": {"txnId": txn_id, "otpValue": encrypted_otp}},
    }

    res = requests.post(url, json=payload, headers=headers, timeout=30)
    if not res.ok:
        logger.error(f"Find ABHA verify-otp failed: {res.text}")
        from fastapi import HTTPException
        raise HTTPException(status_code=res.status_code, detail=abdm_error_detail(res))
    return res.json()


# ============================================================================
# CHILD ABHA — list, create, and update child ABHA accounts under a parent's
# authenticated session. All three require the parent's X-token.
# ============================================================================

def get_child_abha_details(x_token: str):
    token = get_gateway_token()
    url = f"{ABDM_BASE_URL}/abha/api/v3/enrollment/profile/children"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "Benefit-Name": ABDM_BENEFIT_NAME,
        "X-token": f"Bearer {x_token}",
    }

    res = requests.get(url, headers=headers)
    if not res.ok:
        logger.error(f"Get child ABHA details failed: {res.text}")
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=res.text)
    return res.json()


def create_child_abha(
    *,
    x_token: str,
    day_of_birth: str,
    month_of_birth: str,
    year_of_birth: str,
    gender: str,
    name: str,
):
    token = get_gateway_token()
    url = f"{ABDM_BASE_URL}/abha/api/v3/enrollment/enrol/byAadhaar"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "Benefit-Name": ABDM_BENEFIT_NAME,
        "X-token": f"Bearer {x_token}",
    }
    payload = {
        "authData": {
            "authMethods": ["child"],
            "child": {
                "dayOfBirth": day_of_birth,
                "monthOfBirth": month_of_birth,
                "yearOfBirth": year_of_birth,
                "gender": gender,
                "password": "",
                "name": name,
                "profilePhoto": "",
                "parentConsent": "true",
            },
        },
        "consent": {"code": "abha-enrollment", "version": "1.4"},
    }

    res = requests.post(url, json=payload, headers=headers)
    if not res.ok:
        logger.error(f"Create child ABHA failed: {res.text}")
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=res.text)
    return res.json()


def update_child_abha(
    *,
    x_token: str,
    abha_number: str,
    dob: str,
    name: str,
    gender: str,
):
    token = get_gateway_token()
    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/account"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "Benefit-Name": ABDM_BENEFIT_NAME,
        "X-token": f"Bearer {x_token}",
    }
    payload = {"abhaNumber": abha_number, "dob": dob, "name": name, "gender": gender}

    res = requests.patch(url, json=payload, headers=headers)
    if not res.ok:
        logger.error(f"Update child ABHA failed: {res.text}")
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=res.text)
    return res.json()


