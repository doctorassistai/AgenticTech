import logging

from fastapi import APIRouter
#from .service import  login_search_by_abha, request_mobile_otp, conform_enrol_otp, request_login_otp, verify_login_otp, abha_address_suggestions,verify_user
# Change Line 4 to:
from .service import login_search_by_abha, request_mobile_otp, conform_enrol_otp, abha_address_suggestions, verify_user, request_mobile_login_otp_v2, verify_mobile_login_otp_v2, request_aadhaar_login_otp_v2, verify_aadhaar_login_otp_v2

from pydantic import BaseModel, Field
from typing import List, Literal
import logging

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/auth", tags=["ABDM-M1"])


class AadhaarRequest(BaseModel):
    aadhaar_number: str = Field(..., min_length=12, max_length=12)

class AbhaConformRequest(BaseModel):
    txnId: str
    otp: str
    phone_number: str = Field(None, min_length=10, max_length=10)
#--------------------------------------------------------------------------------------------------------------------------------------------
"""class LoginOtpRequest(BaseModel):
    login_id: str
    login_hint: Literal["abha-number", "mobile", "aadhaar"]
    scope: List[str]
    otp_system: Literal["abdm", "aadhaar"]

class LoginOtpVerifyRequest(BaseModel):
    txnId: str = Field(..., min_length=1)
    otp: str = Field(..., min_length=4, max_length=6)
    scope: List[str]"""
#-----------------------------------------------------------------------------------------------------------------------------------------------
# # --- NEW CLEAN SCHEMAS---
class MobileLoginRequest(BaseModel):
    mobile_number: str = Field(..., min_length=10, max_length=10, pattern=r"^\d{10}$")

class MobileLoginVerifyRequest(BaseModel):
    txnId: str = Field(..., min_length=1)
    otp: str = Field(..., min_length=4, max_length=6, pattern=r"^\d{4,6}$")

class LoginSearchRequest(BaseModel):
    abha_number: str = Field(..., min_length=14, max_length=14)


class AbhaAddressSuggestionRequest(BaseModel):
    txnId: str

class CreateAbhaAddressRequest(BaseModel):
    txnId: str = Field(..., min_length=1)
    abha_address: str = Field(..., min_length=3)
    preferred: int = 1

@router.post("/request-otp")
def init_abha(req: AadhaarRequest):
    # encrypted_aadhaar = encrypt_aadhaar_number(req.aadhaar_number)
    return request_mobile_otp(req.aadhaar_number)

@router.post("/confirm-otp")
def confirm_abha(req: AbhaConformRequest):
    return conform_enrol_otp(req.txnId, req.otp, req.phone_number)


@router.post("/address-suggestions")
def get_address_suggestions(req: AbhaAddressSuggestionRequest):
    return abha_address_suggestions(req.txnId)

#------------------------------------------------------------------------------------------------------------------------------
"""@router.post("/login-request-otp")
def login_request_otp(req: LoginOtpRequest):
    return request_login_otp(
        login_id=req.login_id,
        login_hint=req.login_hint,
        scope=req.scope,
        otp_system=req.otp_system,
    )


@router.post("/login/verify-otp")
def verify_login_otp_handler(req: LoginOtpVerifyRequest):
    logger.info(f"Verifying login OTP for txnId: {req.txnId}, scope: {req.scope}")

    # Verify OTP using the original endpoint
    otp_verification_response = verify_login_otp(
        txn_id=req.txnId,
        otp=req.otp,
        scope=req.scope,
    )"""
#-------------------------------------------------------------------------------------------------------------------------------
# --- NEW CLEAN ROUTES ---
@router.post("/login/mobile/request-otp")
def mobile_login_request_otp(req: MobileLoginRequest):
    """Dedicated endpoint for Mobile OTP Login requests"""
    logger.info(f"Requesting mobile login OTP for number ending in {req.mobile_number[-4:]}")
    return request_mobile_login_otp_v2(mobile_number=req.mobile_number)


@router.post("/login/mobile/verify-otp")
def mobile_login_verify_otp(req: MobileLoginVerifyRequest):
    """Dedicated endpoint for verifying Mobile OTP Login"""
    logger.info(f"Verifying mobile login OTP for txnId: {req.txnId}")
    
    # 1. Verify the OTP with ABDM
    otp_res = verify_mobile_login_otp_v2(txn_id=req.txnId, otp=req.otp)
    
    # 2. Automatically verify the user to get the X-Token (since we hardcoded the 'mobile-verify' scope)
    abha_number = otp_res.get("accounts", [{}])[0].get("ABHANumber")
    new_txn_id = otp_res.get("txnId")
    temp_token = otp_res.get("token")
    
    if not abha_number or not temp_token:
        # If ABDM didn't return patient accounts, we can't do the second step
        return otp_res

    logger.info(f"Proceeding to verify_user for ABHA: {abha_number}")
    final_res = verify_user(
        abha_number=abha_number,
        txn_id=new_txn_id,
        access_token=temp_token
    )
    
    return {"X-token": final_res.get("token")}


@router.post("/login/search")
def login_search(req: LoginSearchRequest):
    return login_search_by_abha(req.abha_number)

from .service import create_abha_address

@router.post("/create-address")
def create_abha(req: CreateAbhaAddressRequest):
    logger.info(f"Creating ABHA address with txnId: {req.txnId}, abha_address: {req.abha_address}, preferred: {req.preferred}")
    return create_abha_address(
        txn_id=req.txnId,
        abha_address=req.abha_address,
        preferred=req.preferred,
    )


class AadhaarLoginRequest(BaseModel):
    aadhaar_number: str

class AadhaarLoginVerifyRequest(BaseModel):
    txnId: str
    otp: str

@router.post("/login/aadhaar/request-otp")
def aadhaar_login_request_otp(req: AadhaarLoginRequest):
    """Dedicated endpoint for Aadhaar OTP Login requests"""
    logger.info("Requesting Aadhaar login OTP")
    return request_aadhaar_login_otp_v2(aadhaar_number=req.aadhaar_number)

@router.post("/login/aadhaar/verify-otp")
def aadhaar_login_verify_otp(req: AadhaarLoginVerifyRequest):
    """Dedicated endpoint for verifying Aadhaar OTP Login"""
    logger.info(f"Verifying Aadhaar login OTP for txnId: {req.txnId}")
    return verify_aadhaar_login_otp_v2(txn_id=req.txnId, otp=req.otp)