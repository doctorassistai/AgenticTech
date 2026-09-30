import logging

from fastapi import APIRouter, HTTPException, Header
#from .service import  login_search_by_abha, request_mobile_otp, conform_enrol_otp, request_login_otp, verify_login_otp, abha_address_suggestions,verify_user
# Change Line 4 to:
from .service import login_search_by_abha, request_mobile_otp, conform_enrol_otp, abha_address_suggestions, verify_user, request_mobile_login_otp_v2, verify_mobile_login_otp_v2, request_aadhaar_login_otp_v2, verify_aadhaar_login_otp_v2, verify_login_password, enrol_by_document, enrol_by_biometric, search_abha_by_mobile, find_abha_request_otp, find_abha_verify_otp, get_child_abha_details, create_child_abha, update_child_abha, set_abha_password

from pydantic import BaseModel, Field, field_validator
from typing import List, Literal
import logging

logger = logging.getLogger(__name__)


def format_abha_number(raw: str) -> str:
    """Normalize any ABHA number input (with/without dashes, spaces) into
    ABDM's canonical 'XX-XXXX-XXXX-XXXX' format. ABDM rejects loginId / ABHANumber
    values that omit the dashes with 'LoginId is invalid'."""
    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) != 14:
        raise ValueError("ABHA number must contain 14 digits (format: XX-XXXX-XXXX-XXXX)")
    return f"{digits[0:2]}-{digits[2:6]}-{digits[6:10]}-{digits[10:14]}"


def _extract_bearer_token(authorization: str) -> str:
    """Pull the session X-token out of an 'Authorization: Bearer <token>' header."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header (expected: Bearer <X-token>)")
    parts = authorization.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return authorization


router = APIRouter(prefix="/auth", tags=["ABDM-M1"])


class AadhaarRequest(BaseModel):
    aadhaar_number: str = Field(..., min_length=12, max_length=12)

    @field_validator("aadhaar_number", mode="before")
    @classmethod
    def strip_non_digits(cls, v):
        if isinstance(v, str):
            return "".join(ch for ch in v if ch.isdigit())
        return v

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
    mobile_number: str = Field(..., min_length=10, max_length=20)
    login_hint: Literal["mobile", "abha-number"] = "mobile"

    @field_validator("mobile_number", mode="before")
    @classmethod
    def strip_non_digits(cls, v):
        if not isinstance(v, str):
            return v
        digits = "".join(ch for ch in v if ch.isdigit())
        if len(digits) not in (10, 14):
            raise ValueError("Must be a 10-digit mobile or 14-digit ABHA number")
        return digits

class MobileLoginVerifyRequest(BaseModel):
    txnId: str = Field(..., min_length=1)
    otp: str = Field(..., min_length=4, max_length=6, pattern=r"^\d{4,6}$")
    login_hint: Literal["mobile", "abha-number"] = "mobile"

class LoginSearchRequest(BaseModel):
    abha_number: str

    @field_validator("abha_number", mode="before")
    @classmethod
    def normalize_abha_number(cls, v):
        if isinstance(v, str):
            return format_abha_number(v)
        return v


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
    return request_mobile_login_otp_v2(req.mobile_number, login_hint=req.login_hint)


@router.post("/login/mobile/verify-otp")
def mobile_login_verify_otp(req: MobileLoginVerifyRequest):
    """Dedicated endpoint for verifying Mobile OTP Login.

    ABDM behaves differently depending on which loginHint was used to request the OTP:
    - loginHint="mobile": Verify OTP returns a SHORT-lived token (expiresIn=300, no
      refreshToken) plus a list of accounts. You must follow up with Verify User,
      picking one ABHA number, to get the real session token.
    - loginHint="abha-number": Verify OTP already returns the FULL session token
      (expiresIn=1800, refreshToken present) directly — no Verify User call needed,
      since the ABHA number was already known going in.
    """
    logger.info(f"Verifying mobile login OTP for txnId: {req.txnId}, hint: {req.login_hint}")

    otp_res = verify_mobile_login_otp_v2(txn_id=req.txnId, otp=req.otp)

    if otp_res.get("authResult") != "success":
        logger.warning(f"Mobile OTP verification failed: {otp_res.get('message')}")
        raise HTTPException(
            status_code=400,
            detail=otp_res.get("message", "OTP verification failed"),
        )

    # ABHA-number hint: ABDM already returns the final session token — done.
    if req.login_hint == "abha-number":
        if not otp_res.get("token"):
            raise HTTPException(status_code=400, detail="ABDM did not return a session token")
        return {
            "X-token": otp_res.get("token"),
            "refreshToken": otp_res.get("refreshToken"),
            "expiresIn": otp_res.get("expiresIn"),
        }

    # Plain "mobile" hint: token is temporary, must exchange via Verify User.
    if not otp_res.get("accounts"):
        raise HTTPException(
            status_code=400,
            detail="ABDM did not return account details for this mobile number",
        )

    abha_number = otp_res["accounts"][0].get("ABHANumber")
    new_txn_id = otp_res.get("txnId")
    temp_token = otp_res.get("token")

    if not abha_number or not temp_token:
        raise HTTPException(
            status_code=400,
            detail="ABDM did not return account details for this mobile number",
        )

    logger.info(f"Proceeding to verify_user for ABHA: {abha_number}")
    final_res = verify_user(abha_number=abha_number, txn_id=new_txn_id, access_token=temp_token)

    return {
        "X-token": final_res.get("token"),
        "refreshToken": final_res.get("refreshToken"),
        "expiresIn": final_res.get("expiresIn"),
    }


class AbhaMobileOtpRequest(BaseModel):
    """ABHA Number login via Mobile OTP (loginHint=abha-number, otpSystem=abdm)."""
    abha_number: str

    @field_validator("abha_number", mode="before")
    @classmethod
    def normalize_abha_number(cls, v):
        if isinstance(v, str):
            return format_abha_number(v)
        return v


class AbhaMobileOtpVerifyRequest(BaseModel):
    txnId: str = Field(..., min_length=1)
    otp: str = Field(..., min_length=4, max_length=6, pattern=r"^\d{4,6}$")


@router.post("/login/abha-mobile/request-otp")
def abha_mobile_login_request_otp(req: AbhaMobileOtpRequest):
    """Dedicated endpoint: ABHA Number login via Mobile OTP."""
    logger.info(f"Requesting ABHA+Mobile login OTP for ABHA ending in {req.abha_number[-4:]}")
    return request_mobile_login_otp_v2(req.abha_number, login_hint="abha-number")


@router.post("/login/abha-mobile/verify-otp")
def abha_mobile_login_verify_otp(req: AbhaMobileOtpVerifyRequest):
    """Dedicated endpoint: ABHA Number login via Mobile OTP — verify step.

    Unlike plain Mobile OTP, ABDM already returns the full session token here
    (expiresIn=1800, refreshToken present) since the ABHA number is already
    known via loginHint=abha-number. No Verify User step needed.
    """
    logger.info(f"Verifying ABHA+Mobile login OTP for txnId: {req.txnId}")
    otp_res = verify_mobile_login_otp_v2(txn_id=req.txnId, otp=req.otp)

    if otp_res.get("authResult") != "success" or not otp_res.get("token"):
        logger.warning(f"ABHA+Mobile OTP verification failed: {otp_res.get('message')}")
        raise HTTPException(
            status_code=400,
            detail=otp_res.get("message", "OTP verification failed"),
        )

    return {
        "X-token": otp_res.get("token"),
        "refreshToken": otp_res.get("refreshToken"),
        "expiresIn": otp_res.get("expiresIn"),
    }


@router.post("/login/search")
def login_search(req: LoginSearchRequest):
    return login_search_by_abha(req.abha_number)


class PasswordLoginRequest(BaseModel):
    abha_number: str
    password: str

    @field_validator("abha_number", mode="before")
    @classmethod
    def normalize_abha_number(cls, v):
        if isinstance(v, str):
            return format_abha_number(v)
        return v

    @field_validator("password", mode="before")
    @classmethod
    def strip_password(cls, v):
        if isinstance(v, str):
            return v.strip()
        return v


@router.post("/login/verify-password")
def login_verify_password(req: PasswordLoginRequest):
    logger.info(f"Password login attempt for ABHA: {req.abha_number}")
    res = verify_login_password(abha_number=req.abha_number, password=req.password)
    if not res.get("token"):
        raise HTTPException(status_code=400, detail=res.get("message", "Invalid ABHA number or password"))
    return {
        "X-token": res.get("token"),
        "refreshToken": res.get("refreshToken"),
        "expiresIn": res.get("expiresIn"),
        "txnId": res.get("txnId"),
    }

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
    login_hint: Literal["aadhaar", "abha-number"] = "aadhaar"

    @field_validator("aadhaar_number", mode="before")
    @classmethod
    def strip_non_digits(cls, v):
        if not isinstance(v, str):
            return v
        digits = "".join(ch for ch in v if ch.isdigit())
        if len(digits) not in (12, 14):
            raise ValueError("Must be a 12-digit Aadhaar or 14-digit ABHA number")
        return digits

class AadhaarLoginVerifyRequest(BaseModel):
    txnId: str
    otp: str

@router.post("/login/aadhaar/request-otp")
def aadhaar_login_request_otp(req: AadhaarLoginRequest):
    """Dedicated endpoint for Aadhaar OTP Login requests"""
    logger.info("Requesting Aadhaar login OTP")
    return request_aadhaar_login_otp_v2(req.aadhaar_number, login_hint=req.login_hint)

@router.post("/login/aadhaar/verify-otp")
def aadhaar_login_verify_otp(req: AadhaarLoginVerifyRequest):
    """Dedicated endpoint for verifying Aadhaar OTP Login"""
    logger.info(f"Verifying Aadhaar login OTP for txnId: {req.txnId}")
    return verify_aadhaar_login_otp_v2(txn_id=req.txnId, otp=req.otp)


class AbhaAadhaarOtpRequest(BaseModel):
    """ABHA Number login via Aadhaar OTP (loginHint=abha-number, otpSystem=aadhaar)."""
    abha_number: str

    @field_validator("abha_number", mode="before")
    @classmethod
    def normalize_abha_number(cls, v):
        if isinstance(v, str):
            return format_abha_number(v)
        return v


class AbhaAadhaarOtpVerifyRequest(BaseModel):
    txnId: str = Field(..., min_length=1)
    otp: str = Field(..., min_length=4, max_length=6, pattern=r"^\d{4,6}$")


@router.post("/login/abha-aadhaar/request-otp")
def abha_aadhaar_login_request_otp(req: AbhaAadhaarOtpRequest):
    """Dedicated endpoint: ABHA Number login via Aadhaar OTP."""
    logger.info(f"Requesting ABHA+Aadhaar login OTP for ABHA ending in {req.abha_number[-4:]}")
    return request_aadhaar_login_otp_v2(req.abha_number, login_hint="abha-number")


@router.post("/login/abha-aadhaar/verify-otp")
def abha_aadhaar_login_verify_otp(req: AbhaAadhaarOtpVerifyRequest):
    """Dedicated endpoint: ABHA Number login via Aadhaar OTP — verify step."""
    logger.info(f"Verifying ABHA+Aadhaar login OTP for txnId: {req.txnId}")
    otp_res = verify_aadhaar_login_otp_v2(txn_id=req.txnId, otp=req.otp)

    if otp_res.get("authResult") != "success" or not otp_res.get("token"):
        logger.warning(f"ABHA+Aadhaar OTP verification failed: {otp_res.get('message')}")
        raise HTTPException(
            status_code=400,
            detail=otp_res.get("message", "OTP verification failed"),
        )

    return {
        "X-token": otp_res.get("token"),
        "refreshToken": otp_res.get("refreshToken"),
        "expiresIn": otp_res.get("expiresIn"),
    }


# --- GAP #5: Alternative ID Creation (ABHA via Driving Licence / other document) ---
class EnrolByDocumentRequest(BaseModel):
    txnId: str = Field(..., min_length=1)
    document_type: str = Field(default="DRIVING_LICENCE")
    document_id: str
    first_name: str
    middle_name: str = None
    last_name: str
    dob: str
    gender: str
    front_side_photo: str
    back_side_photo: str = None
    address: str = None
    state: str = None
    district: str = None
    pin_code: str = None


@router.post("/enrol/document")
def enrol_via_document(req: EnrolByDocumentRequest):
    """Alternative ID Creation — ABHA enrolment via Driving Licence / other document."""
    logger.info(f"Enrolling by document ({req.document_type}) for txnId: {req.txnId}")
    return enrol_by_document(
        txn_id=req.txnId,
        document_type=req.document_type,
        document_id=req.document_id,
        first_name=req.first_name,
        middle_name=req.middle_name,
        last_name=req.last_name,
        dob=req.dob,
        gender=req.gender,
        front_side_photo=req.front_side_photo,
        back_side_photo=req.back_side_photo,
        address=req.address,
        state=req.state,
        district=req.district,
        pin_code=req.pin_code,
    )


# --- GAP #6: Kiosk Biometric Hooks (fingerprint / face / iris enrolment) ---
class BiometricEnrolRequest(BaseModel):
    txnId: str = Field(..., min_length=1)
    method: Literal["bio", "face", "iris"]
    encrypted_aadhaar: str
    pid_data: str
    mobile_number: str


@router.post("/enrol/biometric")
def enrol_via_biometric(req: BiometricEnrolRequest):
    """Kiosk Biometric Hooks — ABHA enrolment via fingerprint / face / iris."""
    logger.info(f"Enrolling by biometric ({req.method}) for txnId: {req.txnId}")
    return enrol_by_biometric(
        txn_id=req.txnId,
        method=req.method,
        encrypted_aadhaar=req.encrypted_aadhaar,
        pid_data=req.pid_data,
        mobile_number=req.mobile_number,
    )

class SetPasswordRequest(BaseModel):
    new_password: str = Field(..., min_length=1)


@router.post("/set-password")
def set_password_route(req: SetPasswordRequest, authorization: str = Header(None)):
    """Set/reset the ABHA password. Requires 'Authorization: Bearer <X-token>' —
    the X-token from the OTP verify that just happened, not an old stored session."""
    x_token = _extract_bearer_token(authorization)
    logger.info("Setting ABHA password via authenticated session")
    return set_abha_password(x_token=x_token, new_password=req.new_password)


class ReactivateOtpRequest(BaseModel):
    abha_number: str

    @field_validator("abha_number", mode="before")
    @classmethod
    def normalize_abha_number(cls, v):
        if isinstance(v, str):
            return format_abha_number(v)
        return v

class ReactivateVerifyRequest(BaseModel):
    txnId: str
    otp: str

class ReactivatePasswordRequest(BaseModel):
    abha_number: str
    password: str

    @field_validator("abha_number", mode="before")
    @classmethod
    def normalize_abha_number(cls, v):
        if isinstance(v, str):
            return format_abha_number(v)
        return v


# --- Reactivate ABHA: 3 methods, all reusing existing login functions ---
@router.post("/reactivate/aadhaar/request-otp")
def reactivate_via_aadhaar_request(req: ReactivateOtpRequest):
    logger.info("Requesting reactivate OTP via Aadhaar")
    return request_aadhaar_login_otp_v2(req.abha_number, login_hint="abha-number", extra_scope=["re-activate"])

@router.post("/reactivate/aadhaar/verify-otp")
def reactivate_via_aadhaar_verify(req: ReactivateVerifyRequest):
    logger.info(f"Verifying reactivate OTP (Aadhaar) for txnId: {req.txnId}")
    return verify_aadhaar_login_otp_v2(req.txnId, req.otp, extra_scope=["re-activate"])

@router.post("/reactivate/mobile/request-otp")
def reactivate_via_mobile_request(req: ReactivateOtpRequest):
    logger.info("Requesting reactivate OTP via Mobile/ABHA")
    return request_mobile_login_otp_v2(req.abha_number, login_hint="abha-number", extra_scope=["re-activate"])

@router.post("/reactivate/mobile/verify-otp")
def reactivate_via_mobile_verify(req: ReactivateVerifyRequest):
    logger.info(f"Verifying reactivate OTP (Mobile) for txnId: {req.txnId}")
    return verify_mobile_login_otp_v2(req.txnId, req.otp, extra_scope=["re-activate"])

@router.post("/reactivate/password")
def reactivate_via_password(req: ReactivatePasswordRequest):
    logger.info("Reactivating via Password")
    return verify_login_password(abha_number=req.abha_number, password=req.password, extra_scope=["re-activate"])


# ============================================================================
# FIND ABHA — search by mobile number, pick an account, log in via OTP.
# Frontend flow: search() -> show account list -> request_otp(txnId, index) ->
# collect OTP -> verify_otp(txnId, otp) -> store X-token like any other login.
# ============================================================================

class FindAbhaSearchRequest(BaseModel):
    mobile_number: str = Field(..., min_length=10, max_length=10, pattern=r"^\d{10}$")


@router.post("/find-abha/search")
def find_abha_search(req: FindAbhaSearchRequest):
    """Step 1: search for ABHA accounts linked to a mobile number."""
    logger.info(f"Find ABHA search for mobile ending in {req.mobile_number[-4:]}")
    return search_abha_by_mobile(req.mobile_number)


class FindAbhaOtpRequest(BaseModel):
    txnId: str = Field(..., min_length=1)
    index: int = Field(..., ge=1)


@router.post("/find-abha/request-otp")
def find_abha_request_otp_route(req: FindAbhaOtpRequest):
    """Step 2: request OTP for the account picked from the search results.
    'index' is the 1-based position of the chosen account in the search response's ABHA array."""
    logger.info(f"Find ABHA request-otp for txnId: {req.txnId}, index: {req.index}")
    return find_abha_request_otp(req.txnId, req.index)


class FindAbhaVerifyRequest(BaseModel):
    txnId: str = Field(..., min_length=1)
    otp: str = Field(..., min_length=4, max_length=6, pattern=r"^\d{4,6}$")


@router.post("/find-abha/verify-otp")
def find_abha_verify_otp_route(req: FindAbhaVerifyRequest):
    """Step 3: verify OTP, returns the full login session."""
    logger.info(f"Find ABHA verify-otp for txnId: {req.txnId}")
    otp_res = find_abha_verify_otp(req.txnId, req.otp)

    if otp_res.get("authResult") != "success" or not otp_res.get("token"):
        logger.warning(f"Find ABHA OTP verification failed: {otp_res.get('message')}")
        raise HTTPException(status_code=400, detail=otp_res.get("message", "OTP verification failed"))

    # On the search-abha path ABDM often hands back a SHORT-lived token
    # (expiresIn=300, no refreshToken) plus the account list, exactly like the
    # plain mobile-login path. That token expires mid-session. If we see that
    # shape, exchange it for a real one via Verify User.
    needs_exchange = not otp_res.get("refreshToken") and otp_res.get("accounts")

    if needs_exchange:
        abha_number = otp_res["accounts"][0].get("ABHANumber") or otp_res["accounts"][0].get("abhaNumber")
        if abha_number:
            logger.info(f"Find ABHA: exchanging temp token via verify_user for {abha_number}")
            final = verify_user(
                abha_number=abha_number,
                txn_id=otp_res.get("txnId", req.txnId),
                access_token=otp_res["token"],
            )
            return {
                "X-token": final.get("token"),
                "refreshToken": final.get("refreshToken"),
                "expiresIn": final.get("expiresIn"),
                "accounts": otp_res.get("accounts"),
            }

    return {
        "X-token": otp_res.get("token"),
        "refreshToken": otp_res.get("refreshToken"),
        "expiresIn": otp_res.get("expiresIn"),
        "accounts": otp_res.get("accounts"),
    }


# ============================================================================
# CHILD ABHA — requires the parent's session X-token in the Authorization
# header on every call: "Authorization: Bearer <xToken>".
# ============================================================================

@router.get("/child-abha")
def get_child_abha(authorization: str = Header(None)):
    """List children linked to the authenticated parent's ABHA account."""
    x_token = _extract_bearer_token(authorization)
    return get_child_abha_details(x_token)


class CreateChildAbhaRequest(BaseModel):
    day_of_birth: str = Field(..., min_length=1, max_length=2)
    month_of_birth: str = Field(..., min_length=1, max_length=2)
    year_of_birth: str = Field(..., min_length=4, max_length=4)
    gender: Literal["M", "F", "O"]
    name: str = Field(..., min_length=1)


@router.post("/child-abha")
def create_child_abha_route(req: CreateChildAbhaRequest, authorization: str = Header(None)):
    """Create a new child ABHA account under the authenticated parent."""
    x_token = _extract_bearer_token(authorization)
    logger.info(f"Creating child ABHA: {req.name}")
    return create_child_abha(
        x_token=x_token,
        day_of_birth=req.day_of_birth,
        month_of_birth=req.month_of_birth,
        year_of_birth=req.year_of_birth,
        gender=req.gender,
        name=req.name,
    )


class UpdateChildAbhaRequest(BaseModel):
    abha_number: str
    dob: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    gender: Literal["M", "F", "O"]

    @field_validator("abha_number", mode="before")
    @classmethod
    def normalize_abha_number(cls, v):
        if isinstance(v, str):
            return format_abha_number(v)
        return v


@router.patch("/child-abha")
def update_child_abha_route(req: UpdateChildAbhaRequest, authorization: str = Header(None)):
    """Update a child ABHA account's profile details. Note: a non-KYC child ABHA
    can only be updated once — ABDM rejects a second attempt with ABDM-1160."""
    x_token = _extract_bearer_token(authorization)
    logger.info(f"Updating child ABHA: {req.abha_number}")
    return update_child_abha(
        x_token=x_token,
        abha_number=req.abha_number,
        dob=req.dob,
        name=req.name,
        gender=req.gender,
    )