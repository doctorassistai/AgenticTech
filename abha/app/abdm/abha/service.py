import requests
from core.config import ABDM_BASE_URL, ABDM_CLIENT_ID, ABDM_CLIENT_SECRET
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
        "txnId": "",
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

        # You can also raise the error if needed
        raise HTTPException(res.status_code, res.text)

    except Exception as err:
        # Log any other errors that occur
        logger.error(f"An error occurred: {err}")
        raise

def conform_enrol_otp(txn_id: str, otp: str, phone_number: str = None):
    token = get_gateway_token()
    url = f"{ABDM_BASE_URL}/abha/api/v3/enrollment/enrol/byAadhaar"

    encrypted_otp = encrypt_aadhaar_number(otp)
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
,
              }
    payload = {
                "authData": {
                    "authMethods": [
                        "otp"
                    ],
                    "otp": {
                    
                        "txnId": txn_id,
                        "otpValue": encrypted_otp,
                        "mobile": phone_number
                    }
                },
                "consent": {
                    "code": "abha-enrollment",
                    "version": "1.4"
                }
            }

    # res = requests.post(url, json=payload, headers=headers)
    # res.raise_for_status()
    # return res.json()
    res = requests.post(url, json=payload, headers=headers)
    res.raise_for_status()

    data = res.json()

    # 🔥 IMPORTANT: this txnId is the ENROLMENT txnId
    return {
        "txnId": data["txnId"],
        "status": data.get("status"),
        "tokens": data.get("tokens"),
        "message": data.get("message"),
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

def request_mobile_login_otp_v2(mobile_number: str):
    """
    Dedicated function for handling Mobile OTP login requests.
    Hardcodes loginHint="mobile" and otpSystem="abdm" for safety.
    """
    token = get_gateway_token()
    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/login/request/otp"
    
    encrypted_mobile = encrypt_aadhaar_number(mobile_number)
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
    }
    
    payload = {
        "scope": ["abha-login", "mobile-verify"],
        "loginHint": "mobile",
        "loginId": encrypted_mobile,
        "otpSystem": "abdm",
    }
    
    res = requests.post(url, json=payload, headers=headers)
    if not res.ok:
        logger.error(f"Mobile OTP request failed: {res.text}")
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=res.text)
        
    return res.json()


def verify_mobile_login_otp_v2(txn_id: str, otp: str):
    """
    Dedicated function for verifying Mobile OTP.
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
        "scope": ["abha-login", "mobile-verify"],
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
        ],
        "authData": {
            "authMethods": ["password"],
            "password": {
                "ABHANumber": abha_number,
                "password": encrypted_password
            }
        }
    }

    res = requests.post(url, json=payload, headers=headers)
    res.raise_for_status()
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
    token = get_gateway_token()

    url = f"{ABDM_BASE_URL}/abha/api/v3/enrollment/enrol/suggestion"

    headers = {
        "Authorization": f"Bearer {token}",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
    }

    # ✅ txnId MUST be a query param
    params = {
        "txnId": txn_id
    }

    # ✅ MUST be GET
    res = requests.get(url, headers=headers, params=params)

    res.raise_for_status()
    return res.json()


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

def request_aadhaar_login_otp_v2(aadhaar_number: str):
    """
    Dedicated function for handling Aadhaar OTP login requests.
    Hardcodes loginHint="aadhaar" and otpSystem="aadhaar" for safety.
    """
    token = get_gateway_token()
    url = f"{ABDM_BASE_URL}/abha/api/v3/profile/login/request/otp"
    
    encrypted_aadhaar = encrypt_aadhaar_number(aadhaar_number)
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
    }
    
    payload = {
        "scope": ["abha-login", "aadhaar-verify"],
        "loginHint": "aadhaar",
        "loginId": encrypted_aadhaar,
        "otpSystem": "aadhaar",
    }
    
    res = requests.post(url, json=payload, headers=headers)
    if not res.ok:
        logger.error(f"Aadhaar OTP request failed: {res.text}")
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=res.text)
        
    return res.json()


def verify_aadhaar_login_otp_v2(txn_id: str, otp: str):
    """
    Dedicated function for verifying Aadhaar OTP.
    Unlike Mobile Login, Aadhaar Login directly returns the session token (X-Token).
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
        "scope": ["abha-login", "aadhaar-verify"],
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