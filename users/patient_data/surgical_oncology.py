import os
import uuid
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
import json
import io
from pydantic import BaseModel
from typing import Any, Dict, Optional
from motor.motor_asyncio import AsyncIOMotorClient
import logging
import re
from datetime import datetime, timedelta
from groq import Groq

logger = logging.getLogger(__name__)

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

# Base URL of the file storage service (upload proxy + file serving).
STORAGE_BASE_URL = os.getenv("STORAGE_BASE_URL")

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]
    surgical_oncology_collection = database["surgical_oncology"]
    surgical_oncology_documents_collection = database["surgical_oncology_documents"]
    ot_room_bookings_collection = database["ot_room_bookings"]
    ot_booking_prefills_collection = database["ot_booking_prefills"]
    surgical_oncology_diagrams_collection = database["surgical_oncology_diagrams"]
except Exception as e:
    logger.error(f"Error initializing MongoDB in surgical_oncology_api: {e}")

router = APIRouter(prefix="/surgical-oncology", tags=["Surgical Oncology"])


# ─── Helpers ──────────────────────────────────────────────────────────────────


def calculate_end_time(start_time: str, duration_str: str) -> str:
    if not start_time or not duration_str:
        return ""
    try:
        hours = 0
        match = re.search(r"(\d+)\s*[Hh]our", duration_str)
        if match:
            hours = int(match.group(1))
        elif "More than 8 Hours" in duration_str:
            hours = 8

        if hours == 0:
            return start_time

        dt = datetime.strptime(start_time, "%H:%M")
        dt = dt + timedelta(hours=hours)
        return dt.strftime("%H:%M")
    except Exception:
        return start_time

def format_patient_summary_text(summary_doc: dict) -> str:
    """
    Build a compact clinical summary string from the patient_summary collection's
    nested `patient_summary` field. Confirmed against real sample doc — no
    "paragraphs" array exists; the data is structured into overview + sections.
    """
    if not summary_doc:
        return ""

    ps = summary_doc.get("patient_summary", {})
    if not ps:
        return ""

    lines = []

    overview = ps.get("patient_overview", {})
    if overview.get("one_liner"):
        lines.append(overview["one_liner"])
    if overview.get("presenting_today_for"):
        lines.append(f"Presenting for: {overview['presenting_today_for']}")

    problems = ps.get("section_1_current_active_problems", [])
    if problems:
        lines.append("Active Problems:")
        for p in problems:
            desc = f"- {p.get('problem', '')} ({p.get('current_stage_or_severity', '')}) — {p.get('current_treatment_status', '')}"
            lines.append(desc)

    treatment = ps.get("section_3_treatment_history", {})
    active_tx = treatment.get("current_active_treatments", [])
    if active_tx:
        lines.append("Current Active Treatments:")
        for t in active_tx:
            lines.append(f"- {t.get('treatment', '')} (started {t.get('started', '')}), next step: {t.get('next_step', '')}")

    chronic = ps.get("section_5_chronic_ongoing_conditions", [])
    if chronic:
        lines.append("Chronic Conditions:")
        for c in chronic:
            lines.append(f"- {c.get('condition', '')} ({c.get('current_control', '')}), impact on current case: {c.get('impact_on_current_case', '')}")

    functional = ps.get("section_6_functional_status", {})
    if functional:
        lines.append(
            f"Functional Status: ECOG/KPS {functional.get('ecog_or_kps', '')}, "
            f"mobility {functional.get('mobility', '')}, ADL {functional.get('adl', '')}"
        )

    priorities = ps.get("section_7_next_visit_priorities", {})
    if priorities.get("most_important_action"):
        lines.append(f"Next Priority: {priorities['most_important_action']}")

    missing = ps.get("data_completeness", {}).get("missing_critical_data", [])
    if missing:
        lines.append(f"Missing Critical Data: {', '.join(missing)}")

    return "\n".join(lines)

# ─── Pydantic Models ─────────────────────────────────────────────────────────


class CreateBookingPayload(BaseModel):
    patient_id: str
    doctor_id: str
    hospital_id: Optional[str] = None
    data: Dict[str, Any]


class UpdateBookingPayload(BaseModel):
    data: Dict[str, Any]


class SaveSectionPayload(BaseModel):
    data: Dict[str, Any]


class UpdateStatusPayload(BaseModel):
    status: str


class CompleteBookingPayload(BaseModel):
    end_time: Optional[str] = None


class DoctorLogsPayload(BaseModel):
    doctor_id: str
    data: Any


class PatientDiagramsPayload(BaseModel):
    patient_id: str
    data: Any


class PostOpStructurePayload(BaseModel):
    text: str


class SurgicalManagementStructurePayload(BaseModel):
    text: str


class SurgicalChecklistStructurePayload(BaseModel):
    text: str





class AsaStatusPredictionPayload(BaseModel):
    chemo_data: Dict[str, Any]


class GenerateInvestigationSuggestionPayload(BaseModel):
    patient_id: str


class GenerateNarrationPayload(BaseModel):
    patient_id: str
    transcript: str


class GenerateDischargeNarrativePayload(BaseModel):
    patient_id: str
    section: str  # "course_in_hospital" | "discharge_advice"


# ═════════════════════════════════════════════════════════════════════════════
# BOOKING CRUD
# ═════════════════════════════════════════════════════════════════════════════


@router.post("/booking")
async def create_booking(payload: CreateBookingPayload):
    """
    Create a new booking. Generates a UUID booking_id.
    Also creates an OT room reservation if room/date/time are provided.
    """
    try:
        booking_id = str(uuid.uuid4())
        now = datetime.utcnow()

        # Check if this is the first booking for the patient
        existing_count = await surgical_oncology_collection.count_documents({"patient_id": payload.patient_id})
        is_active = (existing_count == 0)

        document = {
            "patient_id": payload.patient_id,
            "doctor_id": payload.doctor_id,
            "hospital_id": payload.hospital_id,
            "booking_id": booking_id,
            "created_at": now,
            "updated_at": now,
            "booking": payload.data,
            "status": "Pending",
            "surgery_finished": False,
            "is_active": is_active,
        }

        await surgical_oncology_collection.insert_one(document)

        # Create OT room reservation if scheduling data is present
        room_name = payload.data.get("otRoom")
        date = payload.data.get("surgeryDate")
        start_time = payload.data.get("startTime")
        duration_str = payload.data.get("duration")

        if room_name and date and start_time:
            end_time = calculate_end_time(start_time, duration_str)
            await ot_room_bookings_collection.insert_one(
                {
                    "booking_id": booking_id,
                    "hospital_id": payload.hospital_id,
                    "room_name": room_name,
                    "date": date,
                    "start_time": start_time,
                    "end_time": end_time,
                    "patient_id": payload.patient_id,
                    "doctor_id": payload.doctor_id,
                    "status": "Reserved",
                }
            )

        return {
            "status": "success",
            "booking_id": booking_id,
            "message": "Booking created",
        }

    except Exception as e:
        logger.error(f"Error creating booking: {e}")
        raise HTTPException(status_code=500, detail="Failed to create booking")


@router.put("/booking/{booking_id}")
async def update_booking(booking_id: str, payload: UpdateBookingPayload):
    """
    Update the booking section of an existing booking document.
    Also updates the OT room reservation if room/date/time changed.
    """
    try:
        filter_q = {"booking_id": booking_id}
        update = {
            "$set": {
                "booking": payload.data,
                "updated_at": datetime.utcnow(),
            }
        }
        result = await surgical_oncology_collection.update_one(filter_q, update)

        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Booking not found")

        # Update OT room reservation
        room_name = payload.data.get("otRoom")
        date = payload.data.get("surgeryDate")
        start_time = payload.data.get("startTime")
        duration_str = payload.data.get("duration")

        if room_name and date and start_time:
            end_time = calculate_end_time(start_time, duration_str)
            await ot_room_bookings_collection.update_one(
                {"booking_id": booking_id},
                {
                    "$set": {
                        "room_name": room_name,
                        "date": date,
                        "start_time": start_time,
                        "end_time": end_time,
                        "status": "Reserved",
                    }
                },
                upsert=True,
            )

        return {"status": "success", "message": "Booking updated"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating booking: {e}")
        raise HTTPException(status_code=500, detail="Failed to update booking")


@router.get("/booking/{booking_id}")
async def get_booking(booking_id: str):
    """
    Get the full document for a single booking (all sections).
    """
    try:
        doc = await surgical_oncology_collection.find_one({"booking_id": booking_id})
        if not doc:
            return {"status": "success", "data": {}}

        doc["_id"] = str(doc["_id"])
        if "created_at" in doc and hasattr(doc["created_at"], "isoformat"):
            doc["created_at"] = doc["created_at"].isoformat()
        if "updated_at" in doc and hasattr(doc["updated_at"], "isoformat"):
            doc["updated_at"] = doc["updated_at"].isoformat()

        return {"status": "success", "data": doc}

    except Exception as e:
        logger.error(f"Error fetching booking: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch booking")


@router.put("/patient/{patient_id}/active-booking/{booking_id}")
async def set_active_booking(patient_id: str, booking_id: str):
    """
    Set a specific booking as active and all others for the patient as inactive.
    """
    try:
        # First set all to inactive
        await surgical_oncology_collection.update_many(
            {"patient_id": patient_id},
            {"$set": {"is_active": False, "updated_at": datetime.utcnow()}}
        )
        # Then set the specific one to active
        result = await surgical_oncology_collection.update_one(
            {"booking_id": booking_id, "patient_id": patient_id},
            {"$set": {"is_active": True, "updated_at": datetime.utcnow()}}
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Booking not found")
            
        return {"status": "success", "message": "Active booking updated"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error setting active booking: {e}")
        raise HTTPException(status_code=500, detail="Failed to set active booking")

# ═════════════════════════════════════════════════════════════════════════════
# PREFILL FROM DICTATION
# ═════════════════════════════════════════════════════════════════════════════


@router.get("/patient/{patient_id}/doctor/{doctor_id}/ot-booking-prefill")
async def get_ot_booking_prefill(patient_id: str, doctor_id: str):
    """
    Get OT booking prefill data extracted from the latest clinical dictation.
    Uses a caching mechanism in the `ot_booking_prefills` collection keyed by dictation_id.
    """
    try:
        # 1. Fetch latest dictation for this patient and doctor
        latest_dictation = await database["dictation"].find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id},
            sort=[("created_at", -1)],
        )
        if not latest_dictation:
            return {"status": "success", "data": None, "message": "No dictation found"}

        dictation_id = str(latest_dictation["_id"])

        # 2. Check cache
        cached = await ot_booking_prefills_collection.find_one(
            {"dictation_id": dictation_id}
        )
        if cached:
            logger.info(
                f"OT Booking prefill cache hit for dictation_id {dictation_id}: {json.dumps(cached.get('data'))}"
            )
            return {"status": "success", "data": cached.get("data")}

        # 3. Cache Miss: Run LLM extraction
        raw_data = latest_dictation.get("raw_data", [])
        if not raw_data:
            return {
                "status": "success",
                "data": None,
                "message": "No raw dictation text found",
            }

        # Combine text
        transcript_text = "\n".join(
            [item.get("content", "") for item in raw_data if isinstance(item, dict)]
        )

        if not transcript_text.strip():
            return {
                "status": "success",
                "data": None,
                "message": "Empty dictation text",
            }

        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise HTTPException(
                status_code=500, detail="GROQ_API_KEY not configured on server"
            )

        groq_client = Groq(api_key=api_key)

        prompt = f"""
You are an expert medical assistant. Extract the following OT Booking data from the given clinical dictation and output it as a valid JSON object. Extract the maximum possible fields, but only if they are clearly supported by the text.

Fields to extract (use exactly these keys):
- "caseStatus": String (Minor, Elective, Emergency, Re-Exploration).
- "surgeryType": Array of strings (Primary, Adjunct, Reconstructive).
- "laterality": String (Right, Left, Bilateral, Not Applicable).
- "procedureName": String. The surgical procedure planned.
- "approach": Array of strings (Open, Laparoscopic, Robotic).
- "duration": String (e.g. "1 Hour", "2 Hours", etc.).
- "preOpDiagnosis": String.
- "viralMarkers": Array of strings (HBsAg, HCV, HIV, COVID).
- "insurance": String (Yes, No).
- "asaClass": String.
- "highRiskMDT": String (Yes, No, Not Applicable).
- "mdtComments": String.
- "bloodGroup": String.
- "pastTransfusion": String (Yes, No).
- "transfusionReaction": String (Yes, No).
- "remarks": String.

If a field is not mentioned, return an empty string for string fields, or an empty array for array fields. Do not invent information.

Text to process:
"{transcript_text}"

Return ONLY a valid JSON object. Do not include markdown formatting like ```json.
        """

        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            response_format={"type": "json_object"},
            max_tokens=2000,
        )

        llm_output = json.loads(completion.choices[0].message.content)

        logger.info(
            f"OT Booking prefill generated for dictation_id {dictation_id}: {json.dumps(llm_output)}"
        )

        # 4. Save to cache
        await ot_booking_prefills_collection.insert_one(
            {
                "dictation_id": dictation_id,
                "patient_id": patient_id,
                "doctor_id": doctor_id,
                "data": llm_output,
                "created_at": datetime.utcnow(),
            }
        )

        return {"status": "success", "data": llm_output}

    except json.JSONDecodeError as e:
        logger.error(f"Error parsing LLM JSON for OT booking prefill: {e}")
        raise HTTPException(
            status_code=500, detail="Failed to parse LLM output as JSON"
        )
    except Exception as e:
        logger.error(f"Error generating OT booking prefill: {e}")
        raise HTTPException(
            status_code=500, detail="Failed to fetch or generate prefill data"
        )


# ═════════════════════════════════════════════════════════════════════════════
# SECTION SAVE (generic — works for all sections)
# ═════════════════════════════════════════════════════════════════════════════


import httpx
from fastapi.encoders import jsonable_encoder

api_base_url = os.getenv("API_BASE_URL", "https://doctorassist.ai/api/")


@router.put("/booking/{booking_id}/section/{section_path:path}")
async def save_section(booking_id: str, section_path: str, payload: SaveSectionPayload):
    """
    Save a specific section of a booking document.

    section_path examples:
      - "checklist"
      - "management"
      - "doctors_note"
      - "anaesthesia.mm"
      - "anaesthesia.ga"
      - "anaesthesia.reg"
      - "anaesthesia.mac"
      - "anaesthesia.io"
      - "anaesthesia.eo"
      - "post_op"

    MongoDB operation: { "$set": { "{section_path}": data } }
    """
    # Validate section_path to prevent arbitrary writes
    allowed_sections = {
        "checklist",
        "management",
        "post_op",
        "discharge",
        "doctors_note",
        "doctors_note.narration",
        "anaesthesia.pac",   # ← add
        "anaesthesia.pi",    # ← add
        "anaesthesia.mm",
        "anaesthesia.ga",
        "anaesthesia.reg",
        "anaesthesia.mac",
        "anaesthesia.io",
        "anaesthesia.eo",
    }
    if section_path not in allowed_sections:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid section path: {section_path}. Allowed: {', '.join(sorted(allowed_sections))}",
        )

    try:
        filter_q = {"booking_id": booking_id}
        update = {
            "$set": {
                section_path: payload.data,
                "updated_at": datetime.utcnow(),
            }
        }
        result = await surgical_oncology_collection.update_one(filter_q, update)

        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Booking not found")

        # ==========================================================
        # 🔥 TEMP DATA SYNC — reflects whichever section was just saved
        # ==========================================================
        booking_doc = await surgical_oncology_collection.find_one(
            {"booking_id": booking_id}, {"patient_id": 1, "doctor_id": 1}
        )
        if booking_doc:
            temp_payload = jsonable_encoder(
                {
                    "patient_id": booking_doc["patient_id"],
                    "doctor_id": booking_doc["doctor_id"],
                    "surgery_workflow": [
                        {
                            "booking_id": booking_id,
                            "section_path": section_path,  # e.g. "checklist", "management", "anaesthesia.pi", "post_op", etc.
                            "data": payload.data,  # the exact data just saved for that section
                            "updatedAt": datetime.utcnow(),
                        }
                    ],
                }
            )
            try:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    temp_response = await client.post(
                        f"{api_base_url}hms/users/data/context/general/temp/save",
                        json=temp_payload,
                    )
                if temp_response.status_code != 200:
                    logger.error(
                        f"Temp save failed: {temp_response.status_code} - {temp_response.text}"
                    )
            except Exception as e:
                logger.error(f"Temp save exception: {str(e)}")

        return {"status": "success", "message": f"Section '{section_path}' saved"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving section '{section_path}': {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to save section '{section_path}'"
        )


# ═════════════════════════════════════════════════════════════════════════════
# WORKLIST / LIST
# ═════════════════════════════════════════════════════════════════════════════


@router.get("/bookings/{doctor_id}")
async def get_bookings(
    doctor_id: str, patient_id: Optional[str] = None, status: Optional[str] = None
):
    """
    Get all bookings for a doctor, optionally filtered by patient_id and/or status.
    Powers the OT Worklist tab.
    """
    try:
        query = {"doctor_id": doctor_id}
        if patient_id:
            query["patient_id"] = patient_id
        if status and status != "All":
            query["status"] = status

        cursor = surgical_oncology_collection.find(query).sort("created_at", 1)
        docs = await cursor.to_list(length=1000)

        bookings = []
        for i, doc in enumerate(docs):
            doc["_id"] = str(doc["_id"])
            if "created_at" in doc and hasattr(doc["created_at"], "isoformat"):
                doc["created_at"] = doc["created_at"].isoformat()
            if "updated_at" in doc and hasattr(doc["updated_at"], "isoformat"):
                doc["updated_at"] = doc["updated_at"].isoformat()

            b = doc.get("booking", {})
            bookings.append(
                {
                    "sno": i + 1,
                    "booking_id": doc.get("booking_id", ""),
                    "patient_id": doc.get("patient_id", ""),
                    "patientName": b.get("patientName", ""),
                    "ageSex": b.get("ageSex", ""),
                    "procedure": b.get("procedureName", ""),
                    "surgeon": b.get("treatingDoctor", ""),
                    "otRoom": b.get("otRoom", ""),
                    "date": b.get("surgeryDate", ""),
                    "status": doc.get("status", "Pending"),
                    "surgery_finished": doc.get("surgery_finished", False),
                    "priority": b.get("priority", 3),
                    "priorityJustification": b.get("priorityJustification", ""),
                    "cancellationReason": b.get("cancellationReason", ""),
                    "is_active": doc.get("is_active", False),
                    "fullBooking": b,
                    "checklist": doc.get("checklist"),
                    "management": doc.get("management"),
                    "post_op": doc.get("post_op"),
                    "discharge": doc.get("discharge"),
                }
            )

        return {"status": "success", "bookings": bookings}

    except Exception as e:
        logger.error(f"Error fetching bookings: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch bookings")


@router.get("/patient/{patient_id}/bookings")
async def get_patient_bookings(patient_id: str, status: Optional[str] = None):
    """
    Get all bookings for a patient, regardless of doctor.
    """
    try:
        query = {"patient_id": patient_id}
        if status and status != "All":
            query["status"] = status

        cursor = surgical_oncology_collection.find(query).sort("created_at", 1)
        docs = await cursor.to_list(length=1000)

        bookings = []
        for i, doc in enumerate(docs):
            doc["_id"] = str(doc["_id"])
            if "created_at" in doc and hasattr(doc["created_at"], "isoformat"):
                doc["created_at"] = doc["created_at"].isoformat()
            if "updated_at" in doc and hasattr(doc["updated_at"], "isoformat"):
                doc["updated_at"] = doc["updated_at"].isoformat()

            b = doc.get("booking", {})
            bookings.append(
                {
                    "sno": i + 1,
                    "booking_id": doc.get("booking_id", ""),
                    "patient_id": doc.get("patient_id", ""),
                    "patientName": b.get("patientName", ""),
                    "ageSex": b.get("ageSex", ""),
                    "procedure": b.get("procedureName", ""),
                    "surgeon": b.get("treatingDoctor", ""),
                    "otRoom": b.get("otRoom", ""),
                    "date": b.get("surgeryDate", ""),
                    "status": doc.get("status", "Pending"),
                    "surgery_finished": doc.get("surgery_finished", False),
                    "priority": b.get("priority", 3),
                    "priorityJustification": b.get("priorityJustification", ""),
                    "cancellationReason": b.get("cancellationReason", ""),
                    "is_active": doc.get("is_active", False),
                    "fullBooking": b,
                    "checklist": doc.get("checklist"),
                    "management": doc.get("management"),
                    "post_op": doc.get("post_op"),
                    "discharge": doc.get("discharge"),
                }
            )

        return {"status": "success", "bookings": bookings}

    except Exception as e:
        logger.error(f"Error fetching patient bookings: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch patient bookings")


@router.get("/patient/{patient_id}/latest-booking")
async def get_latest_booking(patient_id: str):
    """
    Get the latest active OT booking for a patient, regardless of doctor.
    """
    try:
        cursor = surgical_oncology_collection.find({"patient_id": patient_id}).sort(
            "created_at", -1
        )
        docs = await cursor.to_list(length=50)

        if not docs:
            return {"status": "success", "data": None}

        # Find first explicitly active booking, else fallback to pending/in progress
        active_doc = next(
            (doc for doc in docs if doc.get("is_active") is True),
            next((doc for doc in docs if doc.get("status") in ["Pending", "In Progress"]), docs[0]),
        )

        active_doc["_id"] = str(active_doc["_id"])
        if "created_at" in active_doc and hasattr(
            active_doc["created_at"], "isoformat"
        ):
            active_doc["created_at"] = active_doc["created_at"].isoformat()
        if "updated_at" in active_doc and hasattr(
            active_doc["updated_at"], "isoformat"
        ):
            active_doc["updated_at"] = active_doc["updated_at"].isoformat()

        b = active_doc.get("booking", {})
        result_data = {
            "booking_id": active_doc.get("booking_id", ""),
            "patient_id": active_doc.get("patient_id", ""),
            "status": active_doc.get("status", "Pending"),
            "fullBooking": b,
            # Include all sub-documents so callers can read anaesthesia.*, checklist.* etc.
            "anaesthesia": active_doc.get("anaesthesia"),
            "checklist": active_doc.get("checklist"),
            "post_op": active_doc.get("post_op"),
            "management": active_doc.get("management"),
            "doctors_note": active_doc.get("doctors_note"),
        }

        return {"status": "success", "data": result_data}

    except Exception as e:
        logger.error(f"Error fetching latest booking for patient: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch latest booking")


@router.get("/patient/{patient_id}/anaesthesia-history")
async def get_anaesthesia_history(patient_id: str):
    """
    Get the history of anaesthesia records for a patient.
    Only returns bookings that actually have anaesthesia data to save bandwidth.
    """
    try:
        cursor = surgical_oncology_collection.find({"patient_id": patient_id}).sort(
            "created_at", -1
        )

        docs = await cursor.to_list(length=100)
        history = []

        for doc in docs:
            b = doc.get("booking", {})
            history.append(
                {
                    "booking_id": doc.get("booking_id", ""),
                    "date": b.get("surgeryDate", ""),
                    "procedure": b.get("procedureName", ""),
                    "surgeon": b.get("treatingDoctor", ""),
                    "anaesthesia": doc.get("anaesthesia", {}),
                    "doctors_note": doc.get("doctors_note", {}),
                }
            )

        return {"status": "success", "data": history}

    except Exception as e:
        logger.error(f"Error fetching anaesthesia history: {e}")
        raise HTTPException(
            status_code=500, detail="Failed to fetch anaesthesia history"
        )


@router.get("/patient/{patient_id}/post-op-history")
async def get_post_op_history(patient_id: str):
    """
    Get the history of post op complications for a patient.
    Only returns bookings that actually have post_op data to save bandwidth.
    """
    try:
        cursor = surgical_oncology_collection.find({"patient_id": patient_id}).sort(
            "created_at", -1
        )

        docs = await cursor.to_list(length=100)
        history = []

        for doc in docs:
            b = doc.get("booking", {})
            history.append(
                {
                    "booking_id": doc.get("booking_id", ""),
                    "date": b.get("surgeryDate", ""),
                    "procedure": b.get("procedureName", ""),
                    "surgeon": b.get("treatingDoctor", ""),
                    "post_op": doc.get("post_op", {}),
                }
            )

        return {"status": "success", "data": history}

    except Exception as e:
        logger.error(f"Error fetching post op history: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch post op history")


@router.get("/patient/{patient_id}/doctors-note-summary")
async def get_doctors_note_summary(patient_id: str):
    """
    Get aggregated summary data from past records for a patient's Doctors Note.
    Finds the most recent non-empty values for Vitals, Labs, ASA status, etc.
    """
    try:
        cursor = surgical_oncology_collection.find({"patient_id": patient_id}).sort(
            "created_at", -1
        )

        docs = await cursor.to_list(length=100)

        summary = {
            "vitals": {},
            "labs": {},
            "past_surgeries": [],
            "assessment": {},
            "past_complications": [],
            "past_post_op_complications": [],
            "clinical_overview": {},
            "critical_alerts": [],
        }

        vitals_history = {
            "bp": [],
            "rr": [],
            "pr": [],
            "spo2": [],
            "temperature": [],
            "height": [],
            "weight": [],
        }
        labs_history = {}
        found_assessment = {
            "asaStatus": False,
            "aspirationRisk": False,
            "consciousness": False,
        }
        found_clinical = {
            "diagnosis": False,
            "findings": False,
            "tumorInfo": False,
            "highRisk": False,
        }

        for doc in docs:
            b = doc.get("booking", {})
            dn = doc.get("doctors_note", {})
            pi = doc.get("anaesthesia", {}).get("pi", {})
            mgmt = doc.get("management", {})
            chk = doc.get("checklist", {})
            surg_date = b.get("surgeryDate", "Unknown")

            # Critical Alerts (Allergies & Transfusion)
            if chk.get("signin_allergy_status") == "Yes":
                aler = chk.get("signin_allergy_remarks")
                if aler and not any(aler in a for a in summary["critical_alerts"]):
                    summary["critical_alerts"].append(
                        f"Allergy: {aler} (noted {surg_date})"
                    )

            trans_rxn = b.get("transfusionReaction")
            if trans_rxn == "Yes":
                rxn_det = b.get("reactionDetails")
                if rxn_det and not any(
                    rxn_det in a for a in summary["critical_alerts"]
                ):
                    summary["critical_alerts"].append(
                        f"Transfusion Reaction: {rxn_det} (noted {surg_date})"
                    )

            # Clinical Overview Extraction
            if not found_clinical["diagnosis"]:
                diag = (
                    mgmt.get("postOperativeDiagnosis")
                    or mgmt.get("preOperativeDiagnosis")
                    or b.get("preOpDiagnosis")
                )
                if diag:
                    summary["clinical_overview"]["diagnosis"] = diag
                    found_clinical["diagnosis"] = True

            if not found_clinical["findings"]:
                findings = mgmt.get("findings")
                if findings:
                    summary["clinical_overview"]["findings"] = findings
                    found_clinical["findings"] = True

            if not found_clinical["tumorInfo"]:
                t = mgmt.get("stagingT")
                n = mgmt.get("stagingN")
                m = mgmt.get("stagingM")
                size = mgmt.get("tumourSize")
                loc = mgmt.get("locationOfTumor") or mgmt.get("anatomicalSite")
                if t or n or m or size or loc:
                    summary["clinical_overview"]["tumorInfo"] = {
                        "staging": f"T{t or 'X'} N{n or 'X'} M{m or 'X'}"
                        if (t or n or m)
                        else None,
                        "size": size,
                        "location": loc,
                    }
                    found_clinical["tumorInfo"] = True

            if not found_clinical["highRisk"]:
                high_risk = b.get("highRiskMDT")
                if high_risk and high_risk.lower() not in ["no", "false", ""]:
                    summary["clinical_overview"]["highRiskMDT"] = high_risk
                    summary["clinical_overview"]["mdtComments"] = b.get(
                        "mdtComments", ""
                    )
                    found_clinical["highRisk"] = True

            # Past Surgeries & Blood Loss/Complications
            if b.get("procedureName") and b.get("surgeryDate"):
                surgery_info = {
                    "date": b.get("surgeryDate"),
                    "procedure": b.get("procedureName"),
                    "surgeon": b.get("treatingDoctor"),
                    "status": doc.get("status"),
                    "bloodLoss": mgmt.get("bloodLoss", ""),
                }
                summary["past_surgeries"].append(surgery_info)

            if mgmt.get("intraOpComplications") and "None" not in mgmt.get(
                "intraOpComplications", []
            ):
                summary["past_complications"].append(
                    {
                        "date": b.get("surgeryDate"),
                        "complications": mgmt.get("intraOpComplications"),
                        "details": mgmt.get("complicationDetails", ""),
                    }
                )

            # Post Op Complications
            post_op = doc.get("post_op", {})
            if post_op.get("hasComplications") == "Yes":
                comps = post_op.get("complications", [])
                if isinstance(comps, list):
                    for c in comps:
                        if c not in summary["past_post_op_complications"]:
                            summary["past_post_op_complications"].append(c)

            # Vitals
            for v_key in vitals_history.keys():
                val = dn.get(v_key) or pi.get(v_key)
                if val:
                    vitals_history[v_key].append({"date": surg_date, "value": val})

            # Labs History
            lab_results = dn.get("labResults", {}).get("values", [])
            if lab_results:
                for lab in lab_results:
                    k = lab.get("key")
                    v = lab.get("value")
                    f = lab.get("flag", "")
                    if k and v:
                        if k not in labs_history:
                            labs_history[k] = []
                        labs_history[k].append(
                            {"date": surg_date, "value": v, "flag": f}
                        )

            # Assessment
            for a_key in found_assessment.keys():
                if not found_assessment[a_key]:
                    val = dn.get(a_key) or pi.get(a_key)
                    if val:
                        summary["assessment"][a_key] = val
                        found_assessment[a_key] = True

        for k, v_list in vitals_history.items():
            if v_list:
                summary["vitals"][k] = v_list[:3]

        for k, l_list in labs_history.items():
            if l_list:
                summary["labs"][k] = l_list[:3]

        return {"status": "success", "data": summary}

    except Exception as e:
        logger.error(f"Error fetching doctors note summary: {e}")
        raise HTTPException(
            status_code=500, detail="Failed to fetch doctors note summary"
        )


# ═════════════════════════════════════════════════════════════════════════════
# STATUS MANAGEMENT
# ═════════════════════════════════════════════════════════════════════════════


@router.put("/booking/{booking_id}/status")
async def update_status(booking_id: str, payload: UpdateStatusPayload):
    """Update booking status (Pending → In Progress → Completed)."""
    try:
        result = await surgical_oncology_collection.update_one(
            {"booking_id": booking_id},
            {"$set": {"status": payload.status, "updated_at": datetime.utcnow()}},
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Booking not found")

        return {"status": "success", "message": f"Status updated to {payload.status}"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating status: {e}")
        raise HTTPException(status_code=500, detail="Failed to update status")


@router.put("/booking/{booking_id}/complete")
async def complete_booking(
    booking_id: str, payload: CompleteBookingPayload = CompleteBookingPayload()
):
    """Mark surgery as finished. Updates both the booking document and OT room status."""
    try:
        current_time = payload.end_time or datetime.utcnow().strftime("%H:%M")

        # Update main document
        await surgical_oncology_collection.update_one(
            {"booking_id": booking_id},
            {
                "$set": {
                    "surgery_finished": True,
                    "status": "Completed",
                    "updated_at": datetime.utcnow(),
                }
            },
        )

        # Update OT room booking
        await ot_room_bookings_collection.update_one(
            {"booking_id": booking_id},
            {"$set": {"status": "Completed", "end_time": current_time}},
        )

        return {"status": "success", "message": "Surgery marked as completed"}

    except Exception as e:
        logger.error(f"Error completing booking: {e}")
        raise HTTPException(status_code=500, detail="Failed to complete booking")


# ═════════════════════════════════════════════════════════════════════════════
# OT SCHEDULE (unchanged)
# ═════════════════════════════════════════════════════════════════════════════


@router.get("/ot-schedule/{room_name}/{date}")
async def get_ot_schedule(room_name: str, date: str):
    """Get OT room schedule for a specific room and date."""
    try:
        cursor = ot_room_bookings_collection.find(
            {
                "room_name": room_name,
                "date": date,
            }
        ).sort("start_time", 1)

        bookings = await cursor.to_list(length=100)
        for b in bookings:
            b["_id"] = str(b["_id"])

        return {"status": "success", "data": bookings}

    except Exception as e:
        logger.error(f"Error fetching OT schedule: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch OT schedule")


# ═════════════════════════════════════════════════════════════════════════════
# LAB ORDER FLOW (dedicated endpoints — nested under doctors_note) XXX TO BE REMOVED - LAB ORDER WAS REPLACED BY COMMON ENDPOINT XXX
# ═════════════════════════════════════════════════════════════════════════════


class LabOrderPayload(BaseModel):
    data: Dict[str, Any]  # { status, sentBy, sentAt, fields: [...] }


class LabResultsPayload(BaseModel):
    data: Dict[str, Any]  # { approved, approvedAt, approvedBy, values: [...] }


@router.put("/booking/{booking_id}/lab-order")
async def save_lab_order(booking_id: str, payload: LabOrderPayload):
    """
    Save the pre-induction lab investigation order from the Surgery doctor.
    Writes only to doctors_note.labOrder — does NOT overwrite other fields.
    """
    try:
        filter_q = {"booking_id": booking_id}
        update = {
            "$set": {
                "doctors_note.labOrder": payload.data,
                "updated_at": datetime.utcnow(),
            }
        }
        result = await surgical_oncology_collection.update_one(filter_q, update)

        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Booking not found")

        return {"status": "success", "message": "Lab order saved"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving lab order for booking {booking_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to save lab order")


@router.put("/booking/{booking_id}/lab-results")
async def save_lab_results(booking_id: str, payload: LabResultsPayload):
    """
    Save lab results filled by the Anaesthesia doctor.
    Saving automatically marks the order as approved (data.approved = True).
    Writes only to doctors_note.labResults — does NOT overwrite other fields.
    """
    try:
        filter_q = {"booking_id": booking_id}
        update = {
            "$set": {
                "doctors_note.labResults": payload.data,
                "updated_at": datetime.utcnow(),
            }
        }
        result = await surgical_oncology_collection.update_one(filter_q, update)

        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Booking not found")

        return {"status": "success", "message": "Lab results saved"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving lab results for booking {booking_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to save lab results")


# ═════════════════════════════════════════════════════════════════════════════
# DOCUMENT UPLOAD (Diagrammatic Template) — proxies to storage + Mongo history
# ═════════════════════════════════════════════════════════════════════════════


def _serialize_document(doc: dict) -> dict:
    """Prepare a documents-collection record for JSON output."""
    doc["_id"] = str(doc["_id"])
    if "uploaded_at" in doc and hasattr(doc["uploaded_at"], "isoformat"):
        doc["uploaded_at"] = doc["uploaded_at"].isoformat()
    return doc


@router.post("/documents/upload")
async def upload_document(
    doctor_id: str = Form(...),
    patient_id: str = Form(...),
    hospital_id: Optional[str] = Form(None),
    doc_type: Optional[str] = Form(None),
    remarks: Optional[str] = Form(None),
    category: Optional[str] = Form(None),
    subcategory: Optional[str] = Form(None),
    file: UploadFile = File(...),
):
    """
    Upload a document/image for the Diagrammatic Template tab.

    Proxies the binary to the storage service (STORAGE_BASE_URL) and records a
    per-file history entry in `surgical_oncology_documents` keyed by
    patient_id + doctor_id + hospital_id.
    """
    if not STORAGE_BASE_URL:
        raise HTTPException(
            status_code=500, detail="STORAGE_BASE_URL not configured on server"
        )

    try:
        file_bytes = await file.read()

        params = {
            "doctor_id": doctor_id,
            "patient_id": patient_id,
            "doc_type": doc_type,
            "category": category,
            "subcategory": subcategory,
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            storage_response = await client.post(
                f"{STORAGE_BASE_URL}/upload",
                params=params,
                files={
                    "file": (file.filename, file_bytes, file.content_type),
                },
            )

        if storage_response.status_code != 200:
            raise HTTPException(
                status_code=storage_response.status_code,
                detail=storage_response.text,
            )

        upload_result = storage_response.json()
        stored_filename = upload_result["filename"]
        file_url = f"{STORAGE_BASE_URL}/files/{patient_id}/{stored_filename}"

        record = {
            "document_id": str(uuid.uuid4()),
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "hospital_id": hospital_id,
            "doc_type": doc_type,
            "remarks": remarks,
            "original_filename": file.filename,
            "stored_filename": stored_filename,
            "file_url": file_url,
            "content_type": file.content_type,
            "uploaded_at": datetime.utcnow(),
        }
        await surgical_oncology_documents_collection.insert_one(record)

        return {
            "status": "success",
            "file_url": file_url,
            "document": _serialize_document(dict(record)),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Document upload failed for patient {patient_id}: {e}")
        raise HTTPException(status_code=500, detail=f"File upload failed: {str(e)}")


@router.get("/documents/{patient_id}")
async def get_documents(
    patient_id: str,
    doctor_id: Optional[str] = None,
    hospital_id: Optional[str] = None,
):
    """
    Get uploaded-document history for a patient, optionally scoped by
    doctor_id and/or hospital_id. Newest first.
    """
    try:
        query = {"patient_id": patient_id}
        if doctor_id:
            query["doctor_id"] = doctor_id
        if hospital_id:
            query["hospital_id"] = hospital_id

        cursor = surgical_oncology_documents_collection.find(query).sort(
            "uploaded_at", -1
        )
        docs = await cursor.to_list(length=500)
        documents = [_serialize_document(doc) for doc in docs]

        return {"status": "success", "documents": documents}

    except Exception as e:
        logger.error(f"Error fetching documents for patient {patient_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch documents")


@router.delete("/documents/{document_id}")
async def delete_document(document_id: str):
    """
    Delete a document history record. The stored file on the storage service is
    left in place (the storage service exposes no delete API).
    """
    try:
        result = await surgical_oncology_documents_collection.delete_one(
            {"document_id": document_id}
        )
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Document not found")

        return {"status": "success", "message": "Document deleted"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting document {document_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete document")


# ═════════════════════════════════════════════════════════════════════════════
# POST OP LLM STRUCTURING ENDPOINT
# ═════════════════════════════════════════════════════════════════════════════


@router.post("/post-op/structure")
async def structure_post_op(payload: PostOpStructurePayload):
    """
    Structure transcribed post-op text into JSON format for the PostOpComplicationsTab form using Groq LLM.
    """
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500, detail="GROQ_API_KEY not configured on server"
        )

    try:
        groq_client = Groq(api_key=api_key)

        prompt = f"""
You are an expert medical assistant. Extract the following post-operative data from the given text and output it as a valid JSON object. Do NOT invent details not mentioned in the text.

Post-Operative Complications fields to extract:
- "hasComplications": String. Must be either "Yes" or "No".
- "complications": Array of strings. Select from: ["Surgical Site Infection", "Wound Dehiscence", "Anastomotic Leak", "Haemorrhage", "Seroma", "Lymphoedema", "Flap Failure", "Nerve Injury", "Urinary Retention", "Pneumonia", "DVT/PE", "Cardiac Event", "Respiratory Failure", "Renal Failure", "Sepsis", "Ileus", "Others"]. If none, return an empty array.
- "description": String. A description of the complications.
- "clavienDindo": String. Must be one of: ["Grade 1", "Grade 2", "Grade 3", "Grade 3a", "Grade 3b", "Grade 4", "Grade 4a", "Grade 4b", "Grade 5"]. Leave as empty string if not mentioned.
- "readmit30": String. Must be "Yes" or "No". Default to empty string if not mentioned.
- "mortality30": String. Must be "Yes" or "No". Default to empty string if not mentioned.
- "readmit90": String. Must be "Yes" or "No". Default to empty string if not mentioned.
- "mortality90": String. Must be "Yes" or "No". Default to empty string if not mentioned.

Pathological Staging (HPR Report) fields to extract:
- "pathStagingT": String. Pathological T stage (e.g. "T1", "T2", "T3", "T4"). Leave empty if not mentioned.
- "pathStagingN": String. Pathological N stage (e.g. "N0", "N1", "N2", "N3"). Leave empty if not mentioned.
- "pathStagingM": String. Pathological M stage (e.g. "M0", "M1"). Leave empty if not mentioned.
- "pathStageGroup": String. Overall pathological AJCC stage group (e.g. "I", "IIA", "IIB", "III", "IV"). Leave empty if not mentioned.
- "pathDiagnosis": String. Final pathological diagnosis from the HPR report. Leave empty if not mentioned.
- "pathNodesExamined": String or Number. Total lymph nodes examined. Leave empty if not mentioned.
- "pathNodesPositive": String or Number. Lymph nodes positive for tumour. Leave empty if not mentioned.
- "pathResection": String. Must be one of ["R0", "R1", "R2"]. Leave empty if not mentioned.
- "pathMarginStatus": String. Must be one of ["Clear", "Involved", "Close"]. Leave empty if not mentioned.
- "pathLVI": String. Lymphovascular invasion. Must be one of ["Yes", "No", "Indeterminate"]. Leave empty if not mentioned.
- "pathPNI": String. Perineural invasion. Must be one of ["Yes", "No", "Indeterminate"]. Leave empty if not mentioned.
- "pathGrade": String. Tumour grade. Must be one of ["Well Differentiated", "Moderately Differentiated", "Poorly Differentiated", "Undifferentiated"]. Leave empty if not mentioned.
- "pathReportDate": String. Date of HPR report in YYYY-MM-DD format. Leave empty if not mentioned.
- "pathReportNotes": String. Any additional pathology notes. Leave empty if not mentioned.

If a field is not mentioned in the text, return an empty string for string fields, or an empty array for array fields.

Text to process:
"{payload.text}"

Return ONLY a valid JSON object. Do not include markdown formatting like ```json.
        """

        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            response_format={"type": "json_object"},
            max_tokens=3000,
        )

        llm_output = json.loads(completion.choices[0].message.content)
        return {"status": "success", "data": llm_output}

    except json.JSONDecodeError as e:
        logger.error(f"Error parsing LLM JSON: {e}")
        raise HTTPException(
            status_code=500, detail="Failed to parse LLM output as JSON"
        )
    except Exception as e:
        logger.error(f"Error structuring post-op data: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to structure data: {str(e)}"
        )


# ═════════════════════════════════════════════════════════════════════════════
# SURGICAL MANAGEMENT LLM STRUCTURING ENDPOINT
# ═════════════════════════════════════════════════════════════════════════════


@router.post("/surgical-management/structure")
async def structure_surgical_management(payload: SurgicalManagementStructurePayload):
    """
    Structure transcribed surgical management text into JSON format for the SurgicalManagementTab form using Groq LLM.
    """
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500, detail="GROQ_API_KEY not configured on server"
        )

    try:
        groq_client = Groq(api_key=api_key)

        prompt = f"""
You are an expert medical assistant. Extract the following surgical management data from the given text and output it as a valid JSON object. Do not invent details not mentioned in the text.

Fields to extract (ensure keys match exactly):
- "primarySurgeon": String.
- "assistantSurgeon1": String.
- "assistantSurgeon2": String.
- "assistantSurgeon3": String.
- "primaryAnaesthetist": String.
- "anaesthetist1": String.
- "anaesthetist2": String.
- "reconPrimarySurgeon": String.
- "reconAssistant1": String.
- "reconAssistant2": String.
- "reconAssistant3": String.
- "scrubNurse1": String.
- "scrubNurse2": String.
- "circulatingNurse": String.
- "operationStartDate": String (YYYY-MM-DD).
- "operationStartTime": String (HH:MM).
- "operationEndDate": String (YYYY-MM-DD).
- "operationEndTime": String (HH:MM).
- "anaesthesiaStartDate": String (YYYY-MM-DD).
- "anaesthesiaStartTime": String (HH:MM).
- "anaesthesiaEndDate": String (YYYY-MM-DD).
- "anaesthesiaEndTime": String (HH:MM).
- "nameOfProcedure": String.
- "prophylacticAntibiotics": String.
- "typeOfSurgery": Array of strings (allowed: "Primary", "Adjunct", "Reconstructive", "Node Dissection").
- "laterality": String (allowed: "Right", "Left", "Bilateral", "Not Applicable").
- "otherNameOfProcedure": String.
- "approach": String (e.g. Open/Lap/Robotic).
- "typeOfAnesthesia": Array of strings (allowed: "General (GA)", "Regional", "Local (LA)", "MAC / Sedation", "Spinal", "Epidural").
- "preOperativeDiagnosis": String.
- "caseStatus": Array of strings (allowed: "Minor", "Elective", "Emergency", "Re-Exploration").
- "skinPreparation": String.
- "woundClass": Array of strings (allowed: "Clean", "Contaminated", "Clean-Contaminated", "Dirty").
- "findings": String.
- "procedureDetails": String.
- "bloodProducts": Array of strings (allowed: "PRBC", "FFP", "SDP", "RDP", "Cryoprecipitate").
- "volumeOfBloodProducts": String or Number.
- "postOperativeDiagnosis": String.
- "materialsForwarded": String.
- "anatomicalSite": String.
- "stagingT": String.
- "stagingN": String.
- "stagingM": String.
- "bloodLoss": String or Number.
- "tumourSize": String.
- "locationOfTumor": String.
- "frozen": String ("Yes" or "No").
- "frozenReport": String.
- "resection": String (allowed: "R0", "R1", "R2").
- "margins": Array of strings (allowed: "Clear", "Involved", "Wide", "Planned Close", "Controlled", "Contaminated", "R2 Spillage", "Debulking").
- "drains": Array of strings (allowed: "Closed Suction", "Abdominal", "Chest", "Corrugated").
- "drainDetails": String.
- "intraOpCourse": String (allowed: "Uneventful", "Complicated").
- "intentOfProcedure": String (allowed: "Curative", "Non-Curative").
- "intraOpComplications": Array of strings (allowed: "None", "Nerve Injury", "Vascular Injury", "Organ Injury", "Haemorrhage", "Others").
- "complicationDetails": String.
- "intraOpReferral": String ("Yes" or "No").
- "referralDetails": String.
- "postOpAntibioticProtocol": String.
- "additionalNotes": String.
- "classification": String (allowed: "Curative", "Palliative", "Diagnostic").
- "specimensSent": String (specimen(s) sent for histopathology).
- "transferTo": String (allowed: "Ward", "ICU", "HDU", "PACU", "Day Care", "Discharge").
- "dvtProphylaxis": String ("Yes" or "No").
- "dietInstructions": String.
- "analgesiaPlan": String.
- "postOperativePlan": String (post-operative plan / specific instructions).

If a field is not mentioned, return an empty string for string fields, or an empty array for array fields.

Text to process:
"{payload.text}"

Return ONLY a valid JSON object. Do not include markdown formatting like ```json.
        """

        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            response_format={"type": "json_object"},
            max_tokens=3000,
        )

        llm_output = json.loads(completion.choices[0].message.content)
        return {"status": "success", "data": llm_output}

    except json.JSONDecodeError as e:
        logger.error(f"Error parsing LLM JSON: {e}")
        raise HTTPException(
            status_code=500, detail="Failed to parse LLM output as JSON"
        )
    except Exception as e:
        logger.error(f"Error structuring surgical management data: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to structure data: {str(e)}"
        )


# ═════════════════════════════════════════════════════════════════════════════
# SURGICAL CHECKLIST LLM STRUCTURING ENDPOINT
# ═════════════════════════════════════════════════════════════════════════════


@router.post("/surgical-checklist/structure")
async def structure_surgical_checklist(payload: SurgicalChecklistStructurePayload):
    """
    Structure transcribed surgical safety checklist text into JSON format for the
    SurgicalChecklistTab form using Groq LLM.

    NOTE: Many checklist fields are auto-populated on the frontend from other
    sources (OT booking, doctor's note, anaesthesia checklist). The frontend
    gives this voice data the LOWEST priority and only uses it to fill fields that
    are still empty. This endpoint should therefore only return values that are
    explicitly stated in the transcript and leave everything else empty.
    """
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500, detail="GROQ_API_KEY not configured on server"
        )

    try:
        groq_client = Groq(api_key=api_key)

        prompt = f"""
You are an expert medical assistant. Extract the following surgical safety checklist data from the given text and output it as a valid JSON object. Do NOT invent details that are not mentioned in the text. If a field is not mentioned, return an empty string for string fields, or an empty array for array fields.

The checklist uses status rows. For every status field ("*_status") the value must be one of "Yes", "No", or "NA" (only where noted). For every remarks field ("*_remarks") return a short free-text string.

Fields to extract (ensure keys match exactly):

Primary Details:
- "wardBed": String.
- "unitName": String.

Pre-Operative Assessment:
- "viralMarkers": Array of strings (allowed: "HBsAg", "HCV", "HIV", "COVID").
- "insurance": String ("Yes" or "No").
- "insuranceType": Array of strings (allowed: "State Insurance", "Private Insurance", "Ayushman Bharat").
- "asaClass": String.
- "highRiskMDT": String (allowed: "Yes", "No", "Not Applicable").
- "mdtComments": String.
- "bloodGroup": String.
- "pastTransfusion": String ("Yes" or "No").
- "transfusionReaction": String ("Yes" or "No").
- "reactionDetails": String.
- "remarks": String.

Pre-Induction Assessment:
- "surgery": String.
- "surgerySite": String.
- "asaStatus": String.
- "aspirationRisk": String ("Yes" or "No").
- "bloodConfirmed": String (allowed: "Yes", "No", "Not Applicable").
- "surgeryType": Array of strings (allowed: "Primary", "Adjunct", "Reconstructive").
- "machineCheck": String ("Yes" or "No").
- "informedConsent": Array of strings (allowed: "Standard", "High Risk").
- "premedication": Array of strings (allowed: "Anxiolytic", "Antisialagogues", "Analgesic", "Others").
- "premedicationDetails": String.

Pre-Induction Vitals:
- "bp": String (e.g. "120/80").
- "rr": String or Number.
- "pr": String or Number.
- "spo2": String or Number.
- "temperature": String or Number.
- "consciousness": String (allowed: "Normal", "Obtunded", "Unconscious").

SIGN IN (Before Induction of Anaesthesia) — each has a "_status" ("Yes"/"No") and "_remarks":
- "signin_identity_status", "signin_identity_remarks"
- "signin_procedure_status", "signin_procedure_remarks"
- "signin_side_status", "signin_side_remarks"
- "signin_surgical_site_status", "signin_surgical_site_remarks"
- "signin_consent_status", "signin_consent_remarks"
- "signin_site_status", "signin_site_remarks"
- "signin_viral_status", "signin_viral_remarks"
- "signin_blood_status", "signin_blood_remarks"
- "signin_instruments_status", "signin_instruments_remarks"
- "signin_position_status", "signin_position_remarks"
- "signin_machine_status", "signin_machine_remarks"
- "signin_oximeter_status", "signin_oximeter_remarks"
- "signin_airway_status", "signin_airway_remarks"
- "signin_aspiration_status", "signin_aspiration_remarks"
- "signin_starvation_status", "signin_starvation_remarks"
- "signin_allergy_status", "signin_allergy_remarks"

TIME OUT (Before Skin Incision) — "_status" ("Yes"/"No", except where "NA" allowed) and "_remarks":
- "timeout_intro_status", "timeout_intro_remarks"
- "timeout_patient_status", "timeout_patient_remarks"
- "timeout_procedure_status", "timeout_procedure_remarks"
- "timeout_side_status", "timeout_side_remarks"
- "timeout_events_surgeon": String (critical events / concerns from the surgical team).
- "timeout_events_anaesthesia": String (critical events / concerns from the anaesthesia team).
- "timeout_events_nursing": String (critical events / concerns from the nursing team).
- "timeout_mop_status", "timeout_mop_remarks"
- "timeout_antibiotic_status", "timeout_antibiotic_remarks"
- "timeout_imaging_status", "timeout_imaging_remarks"
- "timeout_hpr_status" (allowed: "Yes", "No", "NA"), "timeout_hpr_remarks"
- "timeout_tourniquet_status" (allowed: "Yes", "No", "NA"), "timeout_tourniquet_remarks"
- "timeout_throat_status", "timeout_throat_remarks"

SIGN OUT (Before Patient Leaves OT) — "_status" ("Yes"/"No") and "_remarks":
- "signout_name_status", "signout_name_remarks"
- "signout_count_status", "signout_count_remarks"
- "signout_specimen_status", "signout_specimen_remarks"
- "signout_equipment_status", "signout_equipment_remarks"
- "signout_concerns_surgeon": String (post-op care concerns from the surgical team).
- "signout_concerns_anaesthesia": String (post-op care concerns from the anaesthesia team).
- "signout_concerns_nursing": String (post-op care concerns from the nursing team).

Before Extubation:
- "extubation_throat_status" (allowed: "Yes", "No", "NA"), "extubation_throat_remarks"

Text to process:
"{payload.text}"

Return ONLY a valid JSON object. Do not include markdown formatting like ```json.
        """

        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            response_format={"type": "json_object"},
            max_tokens=3000,
        )

        llm_output = json.loads(completion.choices[0].message.content)
        return {"status": "success", "data": llm_output}

    except json.JSONDecodeError as e:
        logger.error(f"Error parsing LLM JSON: {e}")
        raise HTTPException(
            status_code=500, detail="Failed to parse LLM output as JSON"
        )
    except Exception as e:
        logger.error(f"Error structuring surgical checklist data: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to structure data: {str(e)}"
        )





# ═════════════════════════════════════════════════════════════════════════════
# ASA STATUS PREDICTION ENDPOINT
# ═════════════════════════════════════════════════════════════════════════════
@router.post("/asa-status/predict")
async def predict_asa_status(payload: AsaStatusPredictionPayload):
    """
    Predict ASA Physical Status Class based on chemotherapy data using Groq LLM.
    """
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500, detail="GROQ_API_KEY not configured on server"
        )

    try:
        groq_client = Groq(api_key=api_key)

        prompt = f"""
You are an expert medical assistant. Based on the patient's oncology (chemo) data provided below, determine the appropriate ASA Physical Status Class (e.g., ASA I, ASA II, ASA III, ASA IV, ASA V, ASA VI).

Consider the following factors to deduce the ASA status:
1. Comorbidities (Most Critical): Check for presence and severity of chronic diseases. For example, "controlled" alongside a standard oral medication (e.g., Metformin for Diabetes) indicates a mild, well-controlled systemic disease, triggering an ASA II classification.
2. Vital Organ Function: To confirm the disease is truly "mild" and hasn't caused target-organ damage (which would bump the patient to ASA III or IV), check cardiac, renal, and hepatic function (e.g., normal ECHO, Creatinine, LFTs).
3. Vital Signs: Current clinical stability influences whether a condition is "well-controlled" (e.g., normal BP).
4. Functional Status: By definition, ASA II means the condition does not limit the patient's daily functional capacity. Check performance status (e.g., ECOG 0 means fully active).
5. Demographics (Age): Extreme age can modify risk profiles, but a young/middle-aged adult does not qualify for automatic age-related risks.

Patient Chemo Data:
{json.dumps(payload.chemo_data, indent=2)}

Output ONLY a valid JSON object with the following keys:
- "asaClass": String. The determined ASA class (e.g., "ASA I", "ASA II", "ASA III").
- "reasoning": String. A brief explanation of how you arrived at this classification based on the data.

Do not include markdown formatting like ```json.
        """

        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            response_format={"type": "json_object"},
            max_tokens=1000,
        )

        llm_output = json.loads(completion.choices[0].message.content)
        return {"status": "success", "data": llm_output}

    except json.JSONDecodeError as e:
        logger.error(f"Error parsing LLM JSON: {e}")
        raise HTTPException(
            status_code=500, detail="Failed to parse LLM output as JSON"
        )
    except Exception as e:
        logger.error(f"Error predicting ASA status: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to predict ASA status: {str(e)}"
        )



# ═════════════════════════════════════════════════════════════════════════════
# ONCOLOGY RECORDS ENDPOINT
# ═════════════════════════════════════════════════════════════════════════════


@router.get("/oncology-records/{patient_id}")
async def get_oncology_records(patient_id: str):
    try:
        chemo_record = await database["chemotherapy_records"].find_one(
            {
                "doctorId": {"$exists": True},
                "patientId": patient_id,
            },  # using patientId just in case
            sort=[("updatedAt", -1)],
        )
        if not chemo_record:
            # Maybe the data field is nested
            chemo_record = await database["chemotherapy_records"].find_one(
                {"patientId": patient_id}, sort=[("updatedAt", -1)]
            )

        radio_record = await database["radiotherapy_records"].find_one(
            {"patientId": patient_id}, sort=[("updatedAt", -1)]
        )

        def transform_id(record):
            if record and "_id" in record:
                record["_id"] = str(record["_id"])
            return record

        return {
            "status": "success",
            "chemotherapy": transform_id(chemo_record),
            "radiotherapy": transform_id(radio_record),
        }
    except Exception as e:
        logger.error(f"Error fetching oncology records: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch oncology records")


# ═════════════════════════════════════════════════════════════════════════════
# PATIENT VITALS ENDPOINT
# ═════════════════════════════════════════════════════════════════════════════


@router.get("/patient-vitals/{patient_id}")
async def get_patient_vitals(patient_id: str):
    """Fetch the most recent pre-induction vitals for a patient."""
    try:
        doc = await database["patient_vitals"].find_one(
            {"patient_id": patient_id}, sort=[("updated_at", -1)]
        )
        if doc and "vitals" in doc and doc["vitals"]:
            sorted_keys = sorted(doc["vitals"].keys(), reverse=True)
            latest_key = sorted_keys[0]
            latest_vitals = doc["vitals"][latest_key]
            return {"status": "success", "data": latest_vitals}

        return {"status": "success", "data": None}
    except Exception as e:
        logger.error(f"Error fetching patient vitals: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch patient vitals")


@router.post("/booking/{booking_id}/generate-narration")
async def generate_doctors_narration(
    booking_id: str, payload: GenerateNarrationPayload
):
    """
    Generate doctors narration and synoptic text based on transcribed voice and patient context.
    Uses Groq LLM.
    """
    try:
        # Fetch the booking
        doc = await surgical_oncology_collection.find_one({"booking_id": booking_id})
        if not doc:
            raise HTTPException(status_code=404, detail="Booking not found")

        # Extract context
        b = doc.get("booking", {})
        mgmt = doc.get("management", {})

        # Keep context concise to avoid overwhelming the LLM
        patient_name = b.get("patientName") or "Unknown"
        age_sex = b.get("ageSex") or f"{b.get('age', '')}/{b.get('gender', '')}"
        procedure = b.get("procedureName", "Unknown Procedure")
        diagnosis = (
            mgmt.get("postOperativeDiagnosis")
            or mgmt.get("preOperativeDiagnosis")
            or b.get("preOpDiagnosis")
            or "Unknown Diagnosis"
        )

        try:
            summary_res = await get_doctors_note_summary(payload.patient_id)
            summary_json = json.dumps(summary_res.get("data", {}))
        except Exception:
            summary_json = "Not available"

        try:
            summary_doc = await database["patient_summary"].find_one(
                {"patient_id": payload.patient_id}, sort=[("updated_at", -1)]
            )
            clinical_summary_text = format_patient_summary_text(summary_doc)
        except Exception as e:
            logger.error(f"Error fetching clinical summary for narration: {e}")
            clinical_summary_text = ""

        context_str = (
            f"Patient: {patient_name} ({age_sex})\n"
            f"Procedure: {procedure}\n"
            f"Diagnosis: {diagnosis}\n"
            f"Medical Summary: {summary_json}\n"
            f"Clinical Summary: {clinical_summary_text or 'Not available'}\n"
        )
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise HTTPException(
                status_code=500, detail="GROQ_API_KEY not configured on server"
            )

        groq_client = Groq(api_key=api_key)

        prompt = f"""
You are an expert surgical oncologist assistant. The doctor has provided a voice dictation for their clinical note.
Please generate two versions of the note based on the transcription and the patient context.

Context:
{context_str}

Dictation Transcript:
"{payload.transcript}"

Tasks:
1. "narration": A professional, detailed narrative text of the doctor's note based on the dictation. Must be a single plain text string.
2. "synoptic": A structured, bulleted synoptic format summarizing the key findings, plan, and details from the dictation. Must be a single string. Use explicit newline characters (\n) to separate each bullet point, and start each bullet with a dash (-). Do NOT use arrays, nested JSON, or brackets.

Return ONLY a valid JSON object with EXACTLY two keys: "narration" and "synoptic", both with string values. Do not include markdown formatting like ```json.
        """

        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            response_format={"type": "json_object"},
            max_tokens=1500,
        )

        try:
            llm_output = json.loads(completion.choices[0].message.content)
        except json.JSONDecodeError:
            logger.error(
                f"Failed to parse LLM output for narration: {completion.choices[0].message.content}"
            )
            raise HTTPException(
                status_code=500, detail="Failed to parse LLM output as JSON"
            )

        return {"status": "success", "data": llm_output}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating doctors narration: {e}")
        raise HTTPException(
            status_code=500, detail="Failed to generate doctors narration"
        )


# ═════════════════════════════════════════════════════════════════════════════
# DISCHARGE SUMMARY (Surgical Oncology)
# ═════════════════════════════════════════════════════════════════════════════


def _fmt_list(val) -> str:
    """Render a list/str field as a comma-joined string, dropping empty/'None' markers."""
    if isinstance(val, list):
        items = [str(v).strip() for v in val if v and str(v).strip() and str(v).strip().lower() != "none"]
        return ", ".join(items)
    if val is None:
        return ""
    return str(val).strip()


@router.get("/patient/{patient_id}/booking/{booking_id}/discharge-summary")
async def get_discharge_summary(patient_id: str, booking_id: str):
    """
    Assemble a ready-to-render discharge summary for a single booking.

    Aggregates the already-captured clinical data (booking / management / doctors_note /
    anaesthesia / post_op) into discharge-oriented blocks, folds in demographics and any
    planned adjuvant therapy, and returns the saved `discharge` block (the doctor-entered
    fields) so the frontend can hydrate its editable state.
    """
    try:
        doc = await surgical_oncology_collection.find_one({"booking_id": booking_id})
        if not doc:
            raise HTTPException(status_code=404, detail="Booking not found")

        b = doc.get("booking", {}) or {}
        mgmt = doc.get("management", {}) or {}
        dn = doc.get("doctors_note", {}) or {}
        post_op = doc.get("post_op", {}) or {}
        discharge = doc.get("discharge", {}) or {}

        # ── Demographics (patient record + booking fallback) ──────────────────
        demographics = {
            "patientId": patient_id,
            "patientName": b.get("patientName", ""),
            "ageSex": b.get("ageSex", ""),
            "wardBed": b.get("wardBed", ""),
            "unitName": b.get("unitName") or post_op.get("unitName", ""),
            "bloodGroup": b.get("bloodGroup", ""),
            "treatingDoctor": b.get("treatingDoctor", ""),
        }
        try:
            pinfo = await patient_users_lookup(patient_id)
            if pinfo:
                if not demographics["patientName"]:
                    demographics["patientName"] = pinfo.get("patient_name") or pinfo.get("name", "")
                if not demographics["ageSex"]:
                    age = pinfo.get("age")
                    gender = pinfo.get("gender", "")
                    demographics["ageSex"] = (f"{age} / " if age else "") + (gender or "")
                if not demographics["bloodGroup"]:
                    demographics["bloodGroup"] = pinfo.get("blood_group", "")
        except Exception as e:
            logger.error(f"[discharge-summary] patient lookup failed: {e}")

        # ── Diagnosis ─────────────────────────────────────────────────────────
        t = mgmt.get("stagingT")
        n = mgmt.get("stagingN")
        m = mgmt.get("stagingM")
        staging = (
            f"T{t or 'X'} N{n or 'X'} M{m or 'X'}" if (t or n or m) else ""
        )
        diagnosis = {
            "finalDiagnosis": mgmt.get("postOperativeDiagnosis")
            or mgmt.get("preOperativeDiagnosis")
            or b.get("preOpDiagnosis", ""),
            "preOpDiagnosis": mgmt.get("preOperativeDiagnosis") or b.get("preOpDiagnosis", ""),
            "postOpDiagnosis": mgmt.get("postOperativeDiagnosis", ""),
            "tumourSite": mgmt.get("locationOfTumor") or mgmt.get("anatomicalSite", ""),
            "tumourSize": mgmt.get("tumourSize", ""),
            "staging": staging,
            "resection": mgmt.get("resection", ""),
        }

        # ── Procedure ─────────────────────────────────────────────────────────
        procedure = {
            "procedureName": mgmt.get("nameOfProcedure") or b.get("procedureName", ""),
            "surgeryDate": b.get("surgeryDate", ""),
            "primarySurgeon": mgmt.get("primarySurgeon") or b.get("surgeonName") or b.get("treatingDoctor", ""),
            "approach": _fmt_list(mgmt.get("approach") or b.get("approach")),
            "anaesthesiaType": _fmt_list(mgmt.get("typeOfAnesthesia")),
            "intent": mgmt.get("intentOfProcedure", ""),
            "laterality": b.get("laterality") or _fmt_list(mgmt.get("laterality")),
        }

        # ── Operative findings ────────────────────────────────────────────────
        findings = {
            "findings": mgmt.get("findings", ""),
            "intraOpCourse": mgmt.get("intraOpCourse", ""),
            "bloodLoss": mgmt.get("bloodLoss", ""),
            "specimensSent": mgmt.get("specimensSent") or mgmt.get("materialsForwarded", ""),
            "frozenReport": mgmt.get("frozenReport", ""),
        }

        # ── Investigations (flagged pre-op labs) ──────────────────────────────
        lab_values = dn.get("labResults", {}).get("values", []) or []
        lab_fields = {f.get("key"): f for f in (dn.get("labOrder", {}).get("fields", []) or []) if f.get("key")}
        investigations = []
        for lab in lab_values:
            k = lab.get("key")
            v = lab.get("value")
            if not (k and v):
                continue
            meta = lab_fields.get(k, {})
            investigations.append(
                {
                    "label": meta.get("label", k),
                    "value": v,
                    "unit": meta.get("unit", ""),
                    "flag": lab.get("flag", ""),
                }
            )

        # ── Complications ─────────────────────────────────────────────────────
        intra_comps = _fmt_list(mgmt.get("intraOpComplications"))
        complications = {
            "intraOp": intra_comps,
            "intraOpDetails": mgmt.get("complicationDetails", ""),
            "postOpPresent": post_op.get("hasComplications", ""),
            "postOp": _fmt_list(post_op.get("complications")),
            "postOpDetails": post_op.get("description", ""),
            "clavienDindo": post_op.get("clavienDindo", ""),
        }

        # ── Adjuvant therapy context (chemo / radiotherapy) ───────────────────
        adjuvant = {"chemotherapy": "", "radiotherapy": ""}
        try:
            onc = await get_oncology_records(patient_id)
            chemo = onc.get("chemotherapy")
            radio = onc.get("radiotherapy")
            if chemo:
                treatment = chemo.get("treatment", {}) or {}
                adjuvant["chemotherapy"] = (
                    f"Cycles {treatment.get('completedCycles', '?')}/{treatment.get('plannedCycles', '?')}"
                )
            if radio:
                adjuvant["radiotherapy"] = "Radiotherapy record on file"
        except Exception as e:
            logger.error(f"[discharge-summary] oncology records failed: {e}")

        return {
            "status": "success",
            "data": {
                "demographics": demographics,
                "diagnosis": diagnosis,
                "procedure": procedure,
                "findings": findings,
                "investigations": investigations,
                "complications": complications,
                "adjuvant": adjuvant,
                "discharge": discharge,
                "status": doc.get("status"),
                "surgery_finished": doc.get("surgery_finished", False),
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error building discharge summary: {e}")
        raise HTTPException(status_code=500, detail="Failed to build discharge summary")


async def patient_users_lookup(patient_id: str):
    """Small internal helper: fetch a patient_users doc with age derived from DOB."""
    patient_users = database["patient_users"]
    doc = await patient_users.find_one({"patient_id": patient_id})
    if not doc:
        doc = await patient_users.find_one({"sys_user_id": patient_id})
    if not doc:
        return None
    if doc.get("date_of_birth"):
        try:
            dob = datetime.strptime(doc["date_of_birth"], "%Y-%m-%d")
            today = datetime.today()
            doc["age"] = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
        except Exception:
            pass
    if "name" in doc and "patient_name" not in doc:
        doc["patient_name"] = doc["name"]
    return doc


@router.post("/booking/{booking_id}/generate-staging-commentary")
async def generate_staging_commentary(booking_id: str):
    """
    Generate a clinical LLM commentary comparing Pre-Op (cTNM), Intra-Op (sTNM),
    and Post-Op Pathological (pTNM) staging for the Discharge Summary.
    Produces an editable narrative the clinician reviews before saving.
    """
    try:
        doc = await surgical_oncology_collection.find_one({"booking_id": booking_id})
        if not doc:
            raise HTTPException(status_code=404, detail="Booking not found")

        b = doc.get("booking", {}) or {}
        mgmt = doc.get("management", {}) or {}
        post_op = doc.get("post_op", {}) or {}
        dn = doc.get("doctors_note", {}) or {}

        patient_name = b.get("patientName") or "the patient"
        age_sex = b.get("ageSex") or ""
        procedure = mgmt.get("nameOfProcedure") or b.get("procedureName", "the procedure")

        # --- Pre-Op Clinical Staging (cTNM) from doctors_note ---
        cT = dn.get("clinicalStagingT", "")
        cN = dn.get("clinicalStagingN", "")
        cM = dn.get("clinicalStagingM", "")
        cStage = dn.get("clinicalStageGroup", "")
        cDiag = dn.get("clinicalDiagnosis", "")
        cBasis = dn.get("clinicalStagingBasis", [])
        if isinstance(cBasis, list):
            cBasis = ", ".join(cBasis)

        # --- Intra-Op Surgical Staging (sTNM) from management ---
        sT = mgmt.get("stagingT", "")
        sN = mgmt.get("stagingN", "")
        sM = mgmt.get("stagingM", "")

        # --- Post-Op Pathological Staging (pTNM) from post_op ---
        pT = post_op.get("pathStagingT", "")
        pN = post_op.get("pathStagingN", "")
        pM = post_op.get("pathStagingM", "")
        pStage = post_op.get("pathStageGroup", "")
        pDiag = post_op.get("pathDiagnosis", "")
        nodes_examined = post_op.get("pathNodesExamined", "")
        nodes_positive = post_op.get("pathNodesPositive", "")
        resection = post_op.get("pathResection", "")
        margins = post_op.get("pathMarginStatus", "")
        lvi = post_op.get("pathLVI", "")
        pni = post_op.get("pathPNI", "")
        grade = post_op.get("pathGrade", "")
        report_date = post_op.get("pathReportDate", "")

        context_str = (
            f"Patient: {patient_name} ({age_sex})\n"
            f"Procedure: {procedure}\n\n"
            f"PRE-OPERATIVE CLINICAL STAGING (cTNM):\n"
            f"  cT: {cT or 'Not recorded'}, cN: {cN or 'Not recorded'}, cM: {cM or 'Not recorded'}\n"
            f"  Overall Clinical Stage: {cStage or 'Not recorded'}\n"
            f"  Clinical Diagnosis: {cDiag or 'Not recorded'}\n"
            f"  Staging basis: {cBasis or 'Not recorded'}\n\n"
            f"INTRA-OPERATIVE SURGICAL STAGING (sTNM):\n"
            f"  sT: {sT or 'Not recorded'}, sN: {sN or 'Not recorded'}, sM: {sM or 'Not recorded'}\n\n"
            f"POST-OPERATIVE PATHOLOGICAL STAGING (pTNM) — HPR Report ({report_date or 'date not recorded'}):\n"
            f"  pT: {pT or 'Not recorded'}, pN: {pN or 'Not recorded'}, pM: {pM or 'Not recorded'}\n"
            f"  Overall Pathological Stage: {pStage or 'Not recorded'}\n"
            f"  Final Pathological Diagnosis: {pDiag or 'Not recorded'}\n"
            f"  Lymph Nodes: {nodes_positive or '?'}/{nodes_examined or '?'} positive\n"
            f"  Resection (R-status): {resection or 'Not recorded'}\n"
            f"  Margin Status: {margins or 'Not recorded'}\n"
            f"  Lymphovascular Invasion (LVI): {lvi or 'Not recorded'}\n"
            f"  Perineural Invasion (PNI): {pni or 'Not recorded'}\n"
            f"  Tumour Grade: {grade or 'Not recorded'}\n"
        )

        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured on server")

        prompt = f"""
You are an expert surgical oncologist assistant writing a clinical staging commentary for a discharge summary.

Context:
{context_str}

Task:
Write a concise, professional clinical staging commentary (3–5 sentences) comparing the Pre-Op clinical staging (cTNM), Intra-Op surgical assessment (sTNM), and Post-Op pathological staging (pTNM) from the histopathology report.

The commentary should:
1. State the clinical stage at presentation and the basis (e.g., CT, MRI, biopsy)
2. Note the intra-operative surgical assessment
3. State the final pathological stage from the HPR report, including any relevant details (nodes, LVI, PNI, grade, margins)
4. Clearly state whether there was Upstaging, Downstaging, or Concordance between clinical and pathological staging — and in which component (T, N, or overall)
5. Comment on the clinical significance and any implication for adjuvant therapy if staging changed significantly

FORMAT RULES (strict):
- Write in past tense, third-person clinical style.
- Do NOT invent facts not present in the context. If a value is 'Not recorded', skip or mention it is pending.
- Do NOT use markdown. Plain text only, no **bold**, no ## headings.
- Do NOT include salutation or sign-off.

Return ONLY a valid JSON object with exactly one key: "text". The value is the commentary as a plain-text string.
        """

        groq_client = Groq(api_key=api_key)
        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            response_format={"type": "json_object"},
            max_tokens=800,
        )

        try:
            result = json.loads(completion.choices[0].message.content)
        except Exception:
            result = {"text": completion.choices[0].message.content}

        return {"status": "success", "data": result}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating staging commentary: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate staging commentary: {str(e)}")


@router.post("/booking/{booking_id}/generate-discharge-narrative")

async def generate_discharge_narrative(
    booking_id: str, payload: GenerateDischargeNarrativePayload
):
    """
    Generate an editable narrative for a discharge-summary free-text section using Groq.

    section = "course_in_hospital" → professional peri-operative course narrative.
    section = "discharge_advice"   → patient-facing advice (diet, wound care, activity,
                                      warning signs, when to return).
    The doctor edits the result before saving.
    """
    try:
        section = (payload.section or "").strip()
        if section not in ("course_in_hospital", "discharge_advice"):
            raise HTTPException(
                status_code=400,
                detail="Invalid section. Expected 'course_in_hospital' or 'discharge_advice'.",
            )

        doc = await surgical_oncology_collection.find_one({"booking_id": booking_id})
        if not doc:
            raise HTTPException(status_code=404, detail="Booking not found")

        b = doc.get("booking", {}) or {}
        mgmt = doc.get("management", {}) or {}
        post_op = doc.get("post_op", {}) or {}

        patient_name = b.get("patientName") or "the patient"
        age_sex = b.get("ageSex") or f"{b.get('age', '')}/{b.get('gender', '')}"
        procedure = mgmt.get("nameOfProcedure") or b.get("procedureName", "the procedure")
        diagnosis = (
            mgmt.get("postOperativeDiagnosis")
            or mgmt.get("preOperativeDiagnosis")
            or b.get("preOpDiagnosis")
            or "Unknown Diagnosis"
        )
        findings = mgmt.get("findings", "")
        intra_course = mgmt.get("intraOpCourse", "")
        intra_comps = _fmt_list(mgmt.get("intraOpComplications"))
        post_comps = _fmt_list(post_op.get("complications")) if post_op.get("hasComplications") == "Yes" else ""
        clavien = post_op.get("clavienDindo", "")
        disposition = mgmt.get("transferTo", "")

        context_str = (
            f"Patient: {patient_name} ({age_sex})\n"
            f"Diagnosis: {diagnosis}\n"
            f"Procedure performed: {procedure}\n"
            f"Operative findings: {findings or 'Not documented'}\n"
            f"Intra-operative course: {intra_course or 'Not documented'}\n"
            f"Intra-operative complications: {intra_comps or 'None'}\n"
            f"Post-operative complications: {post_comps or 'None'}\n"
            f"Clavien-Dindo grade: {clavien or 'N/A'}\n"
            f"Post-operative disposition: {disposition or 'Not documented'}\n"
        )

        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured on server")

        if section == "course_in_hospital":
            task = (
                "Write a concise, professional 'Course in Hospital' narrative for a surgical "
                "oncology discharge summary. Summarise the peri-operative and post-operative "
                "course in past tense, suitable for a referring physician. Do not invent facts "
                "not present in the context."
            )
        else:  # discharge_advice
            task = (
                "Write clear, patient-facing 'Discharge Advice' for a surgical oncology patient, "
                "as a section of a discharge summary document. Organise it under these short "
                "plain-text headings, each followed by its points (one per line, prefixed with "
                "'- '):\n"
                "Diet\n"
                "Wound / Dressing Care\n"
                "Activity Restrictions\n"
                "Medications\n"
                "Warning Signs (return to hospital immediately if any occur)\n"
                "Follow-up\n"
                "Use simple language appropriate to the procedure performed. Do not invent facts "
                "not present in the context."
            )

        prompt = f"""
You are an expert surgical oncologist assistant helping prepare a hospital discharge summary.

Context:
{context_str}

Task:
{task}

FORMAT RULES (strict):
- This is a SECTION inside a larger document, NOT a letter or email.
- Do NOT include any salutation (e.g. "Dear ...") or sign-off (e.g. "Sincerely", "Your
  Healthcare Team", signature placeholders).
- Do NOT address the patient by name or restate their diagnosis/procedure as an opening line.
- Do NOT use markdown formatting: no **bold**, no ## headings, no code fences. Plain text only.
- Use plain-text headings and simple "- " bullets where lists are needed.

Return ONLY a valid JSON object with EXACTLY one key: "text". The value is the section content
as a single plain-text string (use newlines for headings/paragraphs/bullets).
        """

        groq_client = Groq(api_key=api_key)
        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            response_format={"type": "json_object"},
            max_tokens=1200,
        )

        try:
            llm_output = json.loads(completion.choices[0].message.content)
        except json.JSONDecodeError:
            logger.error(
                f"Failed to parse discharge narrative LLM output: {completion.choices[0].message.content}"
            )
            raise HTTPException(status_code=500, detail="Failed to parse LLM output as JSON")

        return {"status": "success", "data": {"text": llm_output.get("text", "")}}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating discharge narrative: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate discharge narrative")


# ═════════════════════════════════════════════════════════════════════════════
# GET PATIENT INFO ENDPOINT (REVERSE COMPATIBLE)
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/get-patient-info")
async def get_patient_info(patient_id: str):
    """Fetch patient info from patient_users collection for backward compatibility"""
    try:
        patient_users = database["patient_users"]
        doc = await patient_users.find_one({"patient_id": patient_id})
        if not doc:
            doc = await patient_users.find_one({"sys_user_id": patient_id})
        
        if not doc:
            raise HTTPException(status_code=404, detail="Patient not found")
        
        if "_id" in doc:
            doc["_id"] = str(doc["_id"])
        if "created_at" in doc and hasattr(doc["created_at"], "isoformat"):
            doc["created_at"] = doc["created_at"].isoformat()
            
        # Add 'age' field for backward compatibility
        if "date_of_birth" in doc and doc["date_of_birth"]:
            try:
                dob = datetime.strptime(doc["date_of_birth"], "%Y-%m-%d")
                today = datetime.today()
                doc["age"] = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
            except Exception:
                pass
                
        # Ensure patient_name is mapped
        if "name" in doc and "patient_name" not in doc:
            doc["patient_name"] = doc["name"]
            
        return doc
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching patient info: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch patient info")


# ═════════════════════════════════════════════════════════════════════════════
# PATIENT DIAGRAMS & DOCTOR LOGS ENDPOINTS
# ═════════════════════════════════════════════════════════════════════════════


@router.post("/patient-diagrams")
async def save_patient_diagrams(payload: PatientDiagramsPayload):
    """
    Save or update patient diagrams in surgical_oncology_diagrams collection.
    """
    try:
        now = datetime.utcnow()
        document = {
            "patient_id": payload.patient_id,
            "data": payload.data,
            "updated_at": now,
        }

        await surgical_oncology_diagrams_collection.update_one(
            {"patient_id": payload.patient_id},
            {"$set": document, "$setOnInsert": {"created_at": now}},
            upsert=True,
        )

        return {
            "status": "success",
            "message": "Patient diagram saved successfully",
        }
    except Exception as e:
        logger.error(f"Error saving patient diagram: {e}")
        raise HTTPException(status_code=500, detail="Failed to save patient diagram")


@router.get("/patient-diagrams/{patient_id}")
async def get_patient_diagrams(patient_id: str):
    """
    Fetch saved patient diagrams for a given patient_id.
    """
    try:
        doc = await surgical_oncology_diagrams_collection.find_one({"patient_id": patient_id})
        if not doc:
            return {"status": "success", "data": None}

        if "_id" in doc:
            doc["_id"] = str(doc["_id"])
        if "created_at" in doc and hasattr(doc["created_at"], "isoformat"):
            doc["created_at"] = doc["created_at"].isoformat()
        if "updated_at" in doc and hasattr(doc["updated_at"], "isoformat"):
            doc["updated_at"] = doc["updated_at"].isoformat()

        return {"status": "success", "data": doc.get("data")}
    except Exception as e:
        logger.error(f"Error fetching patient diagram: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch patient diagram")
