# anaesthesia.py — Independent Anaesthesia Records API
# Separate from surgical_oncology — owns its own `anaesthesia_records` MongoDB collection.
# The surgical module can READ from this collection via the /record/active/{patient_id}
# endpoint, but all WRITES originate from the anaesthesia module's frontend.

import os
import uuid
import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any, Dict, Optional
from motor.motor_asyncio import AsyncIOMotorClient
import logging
from datetime import datetime
from groq import Groq

logger = logging.getLogger(__name__)

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]
    anaesthesia_records_collection = database["anaesthesia_records"]
except Exception as e:
    logger.error(f"Error initializing MongoDB in anaesthesia_api: {e}")


router = APIRouter(prefix="/anaesthesia", tags=["Anaesthesia"])


# ─── Pydantic Models ─────────────────────────────────────────────────────────


class CreateRecordPayload(BaseModel):
    patient_id: str
    doctor_id: str
    hospital_id: Optional[str] = None


class SaveSectionPayload(BaseModel):
    data: Dict[str, Any]


class LinkBookingPayload(BaseModel):
    """Optional body — currently empty but kept for future metadata."""
    pass


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _serialize_doc(doc: dict) -> dict:
    """Convert MongoDB _id and datetime fields for JSON serialization."""
    if doc is None:
        return {}
    doc["_id"] = str(doc["_id"])
    for dt_field in ("created_at", "updated_at", "completed_at"):
        if dt_field in doc and hasattr(doc[dt_field], "isoformat"):
            doc[dt_field] = doc[dt_field].isoformat()
    return doc


# ═════════════════════════════════════════════════════════════════════════════
# RECORD CRUD
# ═════════════════════════════════════════════════════════════════════════════


@router.post("/record")
async def create_record(payload: CreateRecordPayload):
    """
    Create a new anaesthesia record.
    
    If the patient already has an active record, that record stays active — the 
    anaesthetist must explicitly complete it first. This prevents accidental duplicates
    while still allowing a new record to be started.
    """
    try:
        record_id = str(uuid.uuid4())
        now = datetime.utcnow()

        document = {
            "record_id": record_id,
            "patient_id": payload.patient_id,
            "doctor_id": payload.doctor_id,
            "hospital_id": payload.hospital_id,
            "linked_booking_id": None,
            "status": "active",
            "created_at": now,
            "updated_at": now,
            "completed_at": None,
            # Section data — populated by save_section
            "pac": {},
            "checklist": {},
            "mm": {},
            "ga": {},
            "reg": {},
            "mac": {},
            "io": {},
            "eo": {},
        }

        await anaesthesia_records_collection.insert_one(document)

        return {
            "status": "success",
            "record_id": record_id,
            "message": "Anaesthesia record created",
        }

    except Exception as e:
        logger.error(f"Error creating anaesthesia record: {e}")
        raise HTTPException(status_code=500, detail="Failed to create anaesthesia record")


@router.get("/record/{record_id}")
async def get_record(record_id: str):
    """
    Get the full anaesthesia record document by record_id.
    """
    try:
        doc = await anaesthesia_records_collection.find_one({"record_id": record_id})
        if not doc:
            return {"status": "success", "data": None}

        return {"status": "success", "data": _serialize_doc(doc)}

    except Exception as e:
        logger.error(f"Error fetching anaesthesia record {record_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch anaesthesia record")


@router.get("/record/active/{patient_id}")
async def get_active_record(patient_id: str):
    """
    Get the latest active anaesthesia record for a patient.
    
    Used by:
    - PreAnaesthesiaCheckup & AnaesthesiaRecord to load the current working record
    - OTRecord (surgical module) to read anaesthesia data for display
    - useBookingData.js to merge checklist fields into the surgical checklist
    
    Returns null data if no active record exists — the frontend uses this to show
    the "Start New Record" prompt.
    """
    try:
        doc = await anaesthesia_records_collection.find_one(
            {"patient_id": patient_id, "status": "active"},
            sort=[("created_at", -1)],
        )

        if not doc:
            return {"status": "success", "data": None}

        return {"status": "success", "data": _serialize_doc(doc)}

    except Exception as e:
        logger.error(f"Error fetching active anaesthesia record for patient {patient_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch active anaesthesia record")


@router.get("/records/{patient_id}")
async def get_records(patient_id: str):
    """
    Get all anaesthesia records for a patient (history), ordered newest first.
    
    Used by the History accordion panel in both PreAnaesthesiaCheckup and
    AnaesthesiaRecord to show past completed records.
    """
    try:
        cursor = anaesthesia_records_collection.find(
            {"patient_id": patient_id}
        ).sort("created_at", -1)

        docs = await cursor.to_list(length=100)
        records = []

        for doc in docs:
            records.append({
                "record_id": doc.get("record_id", ""),
                "patient_id": doc.get("patient_id", ""),
                "doctor_id": doc.get("doctor_id", ""),
                "linked_booking_id": doc.get("linked_booking_id"),
                "status": doc.get("status", "active"),
                "created_at": doc["created_at"].isoformat() if hasattr(doc.get("created_at", ""), "isoformat") else "",
                "completed_at": doc["completed_at"].isoformat() if doc.get("completed_at") and hasattr(doc["completed_at"], "isoformat") else None,
                # Include section data for the history "View" dialog
                "pac": doc.get("pac", {}),
                "checklist": doc.get("checklist", {}),
                "mm": doc.get("mm", {}),
                "ga": doc.get("ga", {}),
                "reg": doc.get("reg", {}),
                "mac": doc.get("mac", {}),
                "io": doc.get("io", {}),
                "eo": doc.get("eo", {}),
            })

        return {"status": "success", "data": records}

    except Exception as e:
        logger.error(f"Error fetching anaesthesia records for patient {patient_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch anaesthesia records")


# ═════════════════════════════════════════════════════════════════════════════
# SECTION SAVE (generic — works for all sections: pac, checklist, mm, ga, etc.)
# ═════════════════════════════════════════════════════════════════════════════


@router.put("/record/{record_id}/section/{section_path}")
async def save_section(record_id: str, section_path: str, payload: SaveSectionPayload):
    """
    Save a specific section of an anaesthesia record.
    
    section_path must be one of:
      pac, checklist, mm, ga, reg, mac, io, eo
    
    This is the primary save endpoint used by both PreAnaesthesiaCheckup (section=pac)
    and AnaesthesiaRecord (section=checklist|mm|ga|reg|mac|io|eo).
    """
    allowed_sections = {"pac", "checklist", "mm", "ga", "reg", "mac", "io", "eo"}
    if section_path not in allowed_sections:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid section path: {section_path}. Allowed: {', '.join(sorted(allowed_sections))}",
        )

    try:
        filter_q = {"record_id": record_id}
        update = {
            "$set": {
                section_path: payload.data,
                "updated_at": datetime.utcnow(),
            }
        }
        result = await anaesthesia_records_collection.update_one(filter_q, update)

        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Anaesthesia record not found")

        return {"status": "success", "message": f"Section '{section_path}' saved"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving section '{section_path}' for record {record_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to save section '{section_path}'"
        )


# ═════════════════════════════════════════════════════════════════════════════
# RECORD LIFECYCLE (Complete / Re-open)
# ═════════════════════════════════════════════════════════════════════════════


@router.put("/record/{record_id}/complete")
async def complete_record(record_id: str):
    """
    Mark an anaesthesia record as completed.
    
    This is the anaesthetist's equivalent of "Complete Surgery" — it ends the 
    current session and allows a new record to be started for the same patient.
    Once completed, the record becomes read-only in the UI (shown in history).
    """
    try:
        now = datetime.utcnow()
        result = await anaesthesia_records_collection.update_one(
            {"record_id": record_id, "status": "active"},
            {
                "$set": {
                    "status": "completed",
                    "completed_at": now,
                    "updated_at": now,
                }
            },
        )

        if result.matched_count == 0:
            raise HTTPException(
                status_code=404,
                detail="Active anaesthesia record not found (may already be completed)",
            )

        return {"status": "success", "message": "Anaesthesia record completed"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error completing anaesthesia record {record_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to complete anaesthesia record")


# ═════════════════════════════════════════════════════════════════════════════
# BOOKING LINKAGE (optional — links anaesthesia record to a surgical booking)
# ═════════════════════════════════════════════════════════════════════════════


@router.put("/record/{record_id}/link-booking/{booking_id}")
async def link_booking(record_id: str, booking_id: str):
    """
    Link an anaesthesia record to a surgical booking.
    """
    try:
        target_b_id = None if booking_id.lower() in ("null", "none", "undefined", "") else booking_id
        result = await anaesthesia_records_collection.update_one(
            {"record_id": record_id},
            {
                "$set": {
                    "linked_booking_id": target_b_id,
                    "updated_at": datetime.utcnow(),
                }
            },
        )

        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Anaesthesia record not found")

        return {"status": "success", "message": f"Linked to booking {target_b_id}"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error linking anaesthesia record {record_id} to booking {booking_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to link booking")


@router.get("/record/by-booking/{booking_id}")
async def get_record_by_booking(booking_id: str):
    """
    Get the anaesthesia record linked to a specific surgical booking.
    
    Used by the OTRecord "Anaesthesia Management" tab and by useBookingData.js
    to populate checklist merge data. Falls back to the most recent record for
    the patient if no record is explicitly linked to this booking.
    """
    try:
        # First try exact link
        doc = await anaesthesia_records_collection.find_one(
            {"linked_booking_id": booking_id},
            sort=[("created_at", -1)],
        )

        if not doc:
            return {"status": "success", "data": None}

        return {"status": "success", "data": _serialize_doc(doc)}

    except Exception as e:
        logger.error(f"Error fetching anaesthesia record by booking {booking_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch anaesthesia record by booking")


# ═════════════════════════════════════════════════════════════════════════════
# AI STRUCTURING ENDPOINTS
# These are moved from surgical_oncology.py to live alongside the anaesthesia
# module. The surgical_oncology.py endpoints can be deprecated once the frontend
# switches to these routes.
# ═════════════════════════════════════════════════════════════════════════════


class AnaesthesiaChecklistStructurePayload(BaseModel):
    text: str


class AnaesthesiaProcedureStructurePayload(BaseModel):
    text: str
    section: str  # one of: mm | ga | reg | mac | io | eo


@router.post("/checklist/structure")
async def structure_anaesthesia_checklist(payload: AnaesthesiaChecklistStructurePayload):
    """
    Structure transcribed anaesthesia checklist text into JSON format for the
    AnaesthesiaChecklistTab form (Part A) using Groq LLM.

    Only returns values explicitly stated in the transcript; every other field is
    left empty. The frontend merges the returned keys into the checklist state.
    """
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500, detail="GROQ_API_KEY not configured on server"
        )

    try:
        groq_client = Groq(api_key=api_key)

        prompt = f"""
You are an expert medical assistant. Extract the following anaesthesia safety checklist data from the given text and output it as a valid JSON object. Do NOT invent details that are not mentioned in the text. If a field is not mentioned, return an empty string.

The checklist uses status rows. For every status field the value must be one of "Yes" or "No". For every "*_remark" field return a short free-text string.

Fields to extract (ensure keys match exactly):

SIGN IN (Before Induction of Anaesthesia) — each has a status ("Yes"/"No") and a "_remark" free-text field:
- "signin_consent" (Anaesthesia consent obtained), "signin_consent_remark"
- "signin_machine" (Anaesthesia Machine Check), "signin_machine_remark"
- "signin_oximeter" (Pulse Oximeter on patient and functioning), "signin_oximeter_remark"
- "signin_airway" (Difficult airway anticipated), "signin_airway_remark"
- "signin_aspiration" (Aspiration risk), "signin_aspiration_remark"
- "signin_starvation" (Adequate starvation), "signin_starvation_remark" (remark = hours NPO)
- "signin_allergy" (Any known allergy), "signin_allergy_remark" (remark = specify allergy)

TIME OUT (Before Skin Incision):
- "timeout_anaesthesia_events": String (anticipated critical events / concerns from the anaesthesia team).
- "timeout_antibiotic" (Antibiotic Prophylaxis given) status ("Yes"/"No"), "timeout_antibiotic_remark" (remark = drug / dose / time)
- "timeout_throat" (Throat pack inserted) status ("Yes"/"No"), "timeout_throat_remark"

SIGN OUT (Before Patient Leaves OT):
- "signout_concerns": String (post-op care concerns from the anaesthesia team).

BEFORE EXTUBATION:
- "extubation_throat" (Throat pack removed before extubation) status ("Yes"/"No"), "extubation_throat_remark"

Text to process:
"{payload.text}"

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
        return {"status": "success", "data": llm_output}

    except json.JSONDecodeError as e:
        logger.error(f"Error parsing LLM JSON: {e}")
        raise HTTPException(
            status_code=500, detail="Failed to parse LLM output as JSON"
        )
    except Exception as e:
        logger.error(f"Error structuring anaesthesia checklist data: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to structure data: {str(e)}"
        )


# ─── Procedure (Part B) per-sub-tab field specs ──────────────────────────────

_PROCEDURE_FIELD_SPECS = {}

_PROCEDURE_FIELD_SPECS["mm"] = """Fields to extract (Mode & Monitoring):
- "modeAnaesthesia": String (allowed: "General", "Regional", "Both (General + Regional)", "MAC").
- "monitors": Array (allowed: "ECG", "NIBP", "SpO2", "EtCO2", "Temp", "Pulse", "BP (Arterial)", "Others").
- "ivTiming": String (allowed: "Pre-Induction", "Post-Induction").
- "ivType": String (allowed: "Peripheral", "Central").
- "centralSite": Array (allowed: "Internal Jugular Vein", "Subclavian Vein", "Femoral Vein").
- "centralSize": Array (allowed: "5F", "7F", "Others").
- "centralAttempts": String (number). "centralIssues": String.
- "artSite": Array (allowed: "Radial", "Dorsalis Pedis", "Femoral").
- "artLaterality": String (allowed: "Right", "Left").
- "artSize": Array (allowed: "20G", "22G", "24G").
- "artTechnique": String (allowed: "Standard Canula", "Seldinger").
- "artAttempts": String (number). "artOperators": String (number). "artIssues": String.
- "intraOpMonitoring": Object where keys are exactly one of ["O2 (FiO2 %)", "N2O / Air", "Inhalation Agent", "IV Fluid", "Urine Output (ml)", "Blood Products"] and values are Arrays of objects containing {"time": String (HH:MM 24h format), "value": String}."""

_PROCEDURE_FIELD_SPECS["ga"] = """Fields to extract (General Anaesthesia). All are flat top-level keys.
Induction:
- "timeInduction": String (HH:MM 24h).
- "preoxygenation": String (allowed: "Yes", "No").
- "induction": String (allowed: "Intravenous", "Inhalational").
- "intubRespPrev": Array (allowed: "Opioids", "NTG", "Lignocaine", "Esmolol", "Labetalol", "Other").
- IV opioid doses (String numbers): "ivOpioidFentanyl" (mcg), "ivOpioidMorphine" (mg), "ivOpioidTramadol" (mg), "ivOpioidOther" (free text).
- IV induction agent doses (String, mg unless noted): "ivInductionPropofol", "ivInductionKetamine", "ivInductionEtomidate", "ivInductionThiopentone", "ivInductionOther" (free text).
- "carrierGas": Array (allowed: "Air + O2", "N2O + O2").
- "inhalationAgent": Array (allowed: "Isoflurane", "Sevoflurane").
- Muscle relaxant 1 (intubation) doses in mg (String): "mr1Succ", "mr1Roc", "mr1Vec", "mr1Atr", "mr1Cis".
- Muscle relaxant 2 (maintenance) doses in mg (String): "mr2Succ", "mr2Roc", "mr2Vec", "mr2Atr", "mr2Cis".
Airway & Intubation:
- "airwayDevice": Array (allowed: "ETT Standard", "ETT Preformed", "Double Lumen", "With Bronchial Blocker", "SGD Supreme", "SGD AuraGain", "SGD iGel", "SGD ProSeal", "Face Mask", "Nasal Prongs", "Hudson Mask", "Rigid Bronchoscope", "Tracheostomy Tube", "Others").
- "intubationMode": String (allowed: "Awake", "GA + Muscle Relaxant", "GA + Spont. Ventilation", "Pre-Op Tracheostomy (LA)", "Not Applicable").
- "intubationMethod": Array (allowed: "Video Laryngoscope - C Blade", "Video Laryngoscope - D Blade", "Standard Laryngoscope", "Flexible Bronchoscope", "Others").
- "clGrade": String (allowed: "1", "2A", "2B", "3", "4").
- "pogo": String (allowed: "0", "25", "50", "75", "100").
- "adjuncts": Array (allowed: "Bougie", "Stylet", "Others").
- "airwayAttempts": String (number). "airwayOperators": String (number).
- "airwayComplications": Array (allowed: "Desaturation < 90%", "Significant trauma", "Aspiration of stomach contents", "Aspiration of blood", "Others").
Maintenance & Ventilation:
- "maintInhalational": String (allowed: "O2 + N2O + Volatile", "O2 + Air + Volatile").
- "maintTiva": Array (allowed: "Propofol", "Dexmedetomidine", "Remifentanil", "Others").
- "breathingSystem": Array (allowed: "Circle Absorber", "Jackson Rees", "Magill's", "Bains").
- "ventMode": Array (allowed: "Spontaneous", "Pressure Support", "Volume Control", "Pressure Control", "Others").
- Non-opioid analgesic doses (String): "nonOpioidPara" (mg), "nonOpioidDiclo" (mg), "nonOpioidOther" (free text).
- Antiemetic doses (String): "antiemeticMetoclo" (mg), "antiemeticOndan" (mg), "antiemeticDexa" (mg), "antiemeticOther" (free text).
- "vt": String (tidal volume). "rr": String (rate/min). "ieRatio": String. "peep": String (cmH2O). "airwayPressure": String (cmH2O). "etco2": String (mmHg). "gasScavenging": String (allowed: "Yes", "No")."""

_PROCEDURE_FIELD_SPECS["reg"] = """Fields to extract (Regional Anaesthesia). This section is NESTED.
Top-level flags — set a "show*" flag to true ONLY if the transcript clearly describes that block; otherwise omit it:
- "showSpinal", "showEpidural", "showCSE", "showPNB", "showFascial", "showIVRA", "showOther" (booleans).
- "otherDetails": String (only if showOther). "raTiming": String (allowed: "Asleep", "Awake").
- "cseTechnique": String (allowed: "Spinal followed by Epidural", "Epidural followed by Spinal") — only for CSE.
Nested objects — include an object ONLY for the blocks actually described. Timing arrays allow "Start of Surgery" and "End of Surgery"; if present, add "startTime"/"endTime" (MUST BE 24h HH:MM format, e.g. "08:30" or "14:15").
- "spinal": {"posture" ("Lateral"|"Sitting"), "needleType", "needleSize", "site" ("L3-L4"|"L4-L5"|"Others"), "approach" ("Median"|"Paramedian"), "attempts", "operators", "timing" (Array), "startTime" (24h HH:MM format), "endTime" (24h HH:MM format), "la", "concentration", "volume", "adjuvants", "catheter" ("Yes"|"No"), "catheterDetails", "blockExtent" ("Checked"|"Not checked"), "blockExtentDetails", "complications" (Array allowed: "No action", "Inadequate", "High Spinal", "Total Spinal", "Severe hypotension", "Others")}.
- "epidural": {"posture" ("Lateral"|"Sitting"), "needleType", "needleSize", "site" (Array allowed: "Lumbar", "Thoracic", "Others"), "insertionDetails", "approach" ("Median"|"Paramedian"), "technique" ("Intermittent LOR - Air"|"Intermittent LOR - Saline"|"Continuous Saline"|"Hanging drop"|"Others"), "depthSpace", "catheterDepth", "attempts", "operators", "timing" (Array), "startTime" (24h HH:MM format), "endTime" (24h HH:MM format), "la", "concentration", "volume", "loadingDose", "infusion", "adjuvants", "blockExtent" ("Checked"|"Not checked"), "blockExtentDetails", "complications" (Array allowed: "None", "Inadequate", "Intravascular injection", "Dural puncture", "High block", "Others")}.
- "pnb": {"nerve" (Array allowed: "Brachial Plexus - Interscalene", "Brachial Plexus - Supraclavicular", "Brachial Plexus - Axillary", "Other Upper Limb", "Femoral", "Sciatic", "Other Lower Limb", "Others"), "posture" ("Lateral"|"Sitting"), "laterality" ("Right"|"Left"|"Bilateral"), "technique" (Array allowed: "USG Guided", "Nerve Stimulator Guided", "Landmark Technique"), "needleType", "needleSize", "site", "timing" (Array), "startTime" (24h HH:MM format), "endTime" (24h HH:MM format), "la", "concentration", "volume", "adjuvants", "catheter" ("Yes"|"No"), "blockExtent" ("Checked"|"Not checked"), "blockExtentDetails", "complications", "comments"}.
- "fascial": {"block" (Array allowed: "Thoracic", "Abdominal", "Others"), "laterality" ("Right"|"Left"|"Bilateral"), "posture" ("Lateral"|"Sitting"), "usg" ("Yes"|"No"), "needleType", "needleSize", "timing" (Array), "startTime" (24h HH:MM format), "endTime" (24h HH:MM format), "la", "concentration", "volume", "adjuvants", "catheter" ("Yes"|"No"), "blockExtent" ("Checked"|"Not checked"), "blockExtentDetails", "complications"}.
- "ivra": {"limb" ("Upper"|"Lower"), "duration" (minutes), "la", "concentration", "volume", "adjuvants", "blockExtent", "complications", "tourniquet"}."""

_PROCEDURE_FIELD_SPECS["mac"] = """Fields to extract (MAC / Local). All flat top-level keys.
- "laDrug": String. "laConc": String (%). "laVolume": String (ml).
- "laRoute": Array (allowed: "Infiltration", "Topical Application", "Others").
- "additiveDrug": String. "additiveConc": String (%). "additiveVolume": String (ml).
- Sedative doses (String): "propofol" (mg), "ketamine" (mg), "midazolam" (mg), "fentanyl" (mcg), "dexmedetomidine" (mcg).
- "ramsay": String (allowed: "1 - Anxious/agitated", "2 - Cooperative/oriented", "3 - Responds to commands", "4 - Asleep/brisk response", "5 - Asleep/sluggish response", "6 - No response").
- "oxygenSupp": String (allowed: "No", "Nasal Prongs", "Face Mask", "Others").
- "complications": Array (allowed: "Emergency Airway intervention needed", "Conversion to GA", "Others")."""

_PROCEDURE_FIELD_SPECS["io"] = """Fields to extract (Intra-op / Fluids). Mostly flat, with one nested object and one array.
- "patientPosition": Array (allowed: "Supine", "Supine with extension of head", "Supine with Lithotomy", "Trendelenberg", "Reverse Trendelenberg", "Prone", "Semi Prone", "Right Lateral", "Left Lateral", "Others").
- "pressureAreas": String (allowed: "Yes", "No"). "eyesShut": String (allowed: "Yes", "No").
- "normothermia": Array (allowed: "None", "Inline Fluid Warmer", "Warming Blanket", "Warming Mattress", "Others").
- "tempMonitoring": Array (allowed: "None", "Skin", "Nasopharyngeal", "Oro-esophageal", "Other core").
- "ivFluids": Object with String pure number (ml) values for any mentioned keys: "ringerLactate", "normalSaline", "dns", "dextrose5", "dextrose10", "plasmalyte", "gelofusine", "albumin20", "albumin5", "mannitol20", "drl1", "drl2", "others". (e.g. {"ringerLactate": "500"})
- "bloodProducts": Array of objects, one per product actually given. Each: {"product" (exact name from: "Whole Blood", "Packed Cells", "FFP", "Cryoprecipitate", "Random Donor Platelets", "Single Donor Platelets", "Tranexamic Acid", "Others"), "checked": true, "volume" (pure number in ml, e.g. "250"), "bagNo", "reaction" ("Yes"|"No"), "details"}.
- "bloodLoss": String (pure number in ml, e.g. "200"). "urineOutput": String (pure number in ml, e.g. "150"). "otherLosses": String.
- "complications": Array (allowed: "Airway related", "Cardiovascular", "Respiratory", "Haemorrhagic", "CNS", "Dyselectrolytemia", "Other Metabolic", "Others").
- "complicationDetails": String."""

_PROCEDURE_FIELD_SPECS["eo"] = """Fields to extract (End Op / Post-op). All flat top-level keys.
- "reversalTime": String (MUST BE 24h HH:MM format, e.g. "14:30"). "reversalDrug": Array (allowed: "Neostigmine + Glycopyrrolate", "Sugamadex", "None"). "reversalDose": String.
- "extubation": String (allowed: "Uneventful", "Needed Reintubation", "Not Extubated").
- "postOpVent": String (allowed: "No", "Planned", "Unplanned").
- "vasoactiveDrugs": Array (allowed: "Adrenaline", "Nor-Adrenaline", "Dobutamine", "Vasopressin", "Amiodarone", "NTG", "Labetalol", "Esmolol", "Others").
- "postExtubComps": Array (allowed: "Laryngospasm", "Bronchospasm", "Upper airway obstruction", "Hypoventilation", "Hypopnoea", "Others").
- "patientCondition": String (allowed: "Patient fully awake and obeys commands", "Patient sleepy but unobstructed airway", "Sedated on Ventilator support").
- Vitals (String pure numbers): "pr" (pure number, e.g. "72"), "bp" (e.g. "120/80"), "spo2" (pure number, e.g. "98"), "rr" (pure number, e.g. "14"), "temperature" (pure number, e.g. "36.5").
- "airwayAdjunct": String (allowed: "Endotracheal Tube", "Tracheostomy Tube", "Oropharyngeal Airway", "Nasopharyngeal Airway", "None of the above").
- "monitorLevel": String (allowed: "Routine", "High Dependency", "Intensive Care").
- "oxygenSupp": String (allowed: "Yes", "No"). "npoHours": String (pure number only, e.g. "6"). "ivfRate": String (pure number only in ml/hr, e.g. "80").
- "analgesics": String. "antiemetics": String. "chronicMeds": String.
- "investigations": Array (allowed: "CBC", "Electrolytes", "Biochemistry", "Coagulation", "TEG", "X-ray", "ECG", "Others").
- "otherComments": String."""


@router.post("/procedure/structure")
async def structure_anaesthesia_procedure(payload: AnaesthesiaProcedureStructurePayload):
    """
    Structure transcribed text for ONE Procedure (Part B) sub-tab into JSON.

    payload.section selects the sub-tab: mm | ga | reg | mac | io | eo.
    Only returns values explicitly stated in the transcript; every other field is
    left empty/omitted. The frontend merges the returned keys into that sub-tab's
    state (deep-merge for nested sections like `reg`).
    """
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500, detail="GROQ_API_KEY not configured on server"
        )

    section = (payload.section or "").strip()
    field_spec = _PROCEDURE_FIELD_SPECS.get(section)
    if not field_spec:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid section: {section}. Allowed: {', '.join(sorted(_PROCEDURE_FIELD_SPECS))}",
        )

    try:
        groq_client = Groq(api_key=api_key)

        prompt = f"""
You are an expert anaesthesia assistant. Extract the following intra-operative anaesthesia data from the given text and output it as a valid JSON object. Do NOT invent details that are not mentioned in the text. If a field is not mentioned, omit it or return an empty string (empty array for array fields, and only include boolean "show*" flags when the transcript clearly refers to that block).

For array fields, only include values from the allowed list shown in parentheses. Match the exact spelling/casing of the allowed values.

{field_spec}

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
        logger.error(f"Error parsing LLM JSON for procedure section '{section}': {e}")
        raise HTTPException(status_code=500, detail="Failed to parse LLM output as JSON")
    except Exception as e:
        logger.error(f"Error structuring anaesthesia procedure section '{section}': {e}")
        raise HTTPException(status_code=500, detail=f"Failed to structure data: {str(e)}")
