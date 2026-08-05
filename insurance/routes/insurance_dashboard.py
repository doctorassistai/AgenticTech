from fastapi import APIRouter, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError
from datetime import datetime, timezone, date
from pydantic import BaseModel, Field, validator
from typing import Optional, List, Dict, Any
from twilio.rest import Client as TwilioClient
import os
import uuid
import logging
logger = logging.getLogger(__name__)
from dotenv import load_dotenv
from datetime import datetime, timezone, timedelta

IST = timezone(timedelta(hours=5, minutes=30))
# -------------------- INIT --------------------
load_dotenv()

router = APIRouter(prefix="/web", tags=["Insurance"])

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB  = os.getenv("MONGO_DB", "doctorassistai")

motor_client = AsyncIOMotorClient(MONGO_URI)
db = motor_client[MONGO_DB]
collection = db["insurance_claims_new"]
case_documents_col = db["case_documents"]   # ← add this


async def ensure_indexes():
    """Call once at startup (from lifespan or startup event)."""
    await collection.create_index("caseId", unique=True)
    await collection.create_index("claimantMobile")
    await collection.create_index("createdAt")


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

        cursor = collection.find(query).sort("createdAt", -1).skip(skip).limit(limit)
        cases  = await cursor.to_list(length=limit)

        for case in cases:
            case["_id"] = str(case["_id"])
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
        total     = await collection.count_documents({})
        active    = await collection.count_documents(
            {"status": {"$nin": ["COMPLETED", "CLOSED", "DRAFT"]}}
        )
        completed = await collection.count_documents({"status": "COMPLETED"})

        start_of_day_ist = datetime.now(IST).replace(hour=0, minute=0, second=0, microsecond=0)
        today = await collection.count_documents({"createdAt": {"$gte": start_of_day_ist}})

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