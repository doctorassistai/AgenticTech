# onco_pathology.py — Onco-Pathology Module API
# ─────────────────────────────────────────────────────────────────────────────
# Consolidated backend for the pathology "case" workflow (accessioning →
# grossing → synoptic → TNM → sign-out). Modelled on surgical_oncology.py:
#   • one document per case in the `onco_pathology` collection, keyed by a
#     generated case_id (append-only history per patient — new cases do NOT
#     overwrite older ones).
#   • a single whitelisted section-save endpoint (mirrors save_section).
#   • Motor async client + env-based config (no hardcoded secrets, no local
#     MongoClient, no local-disk file writes).
#
# Ported/consolidated from templates/pathology.py, which used one collection
# per stage. This phase implements the CASE REGISTRY tab end-to-end; later tabs
# (grossing, synoptic, tnm) reuse the same case document + section-save.
#
# ─────────────────────────────────────────────────────────────────────────────

import os
import uuid
import json
import logging
from typing import Any, Dict, Optional
from datetime import datetime

import httpx
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorClient

logger = logging.getLogger(__name__)

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB", "doctorassistai")

# Base URL of the file storage service (upload proxy + file serving).
STORAGE_BASE_URL = os.getenv("STORAGE_BASE_URL")
# Base URL of this HMS API (used to proxy internal reads: patient summary, etc.)
API_BASE_URL = os.getenv("API_BASE_URL", "https://doctorassist.ai/api/")
# Groq API key — read from env; never hardcode (the old pathology.py leaked one).
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]
    onco_pathology_collection = database["onco_pathology"]
    onco_pathology_documents_collection = database["onco_pathology_documents"]
except Exception as e:  # pragma: no cover
    logger.error(f"Error initializing MongoDB in onco_pathology_api: {e}")

router = APIRouter(prefix="/onco-pathology", tags=["Onco Pathology"])


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _serialize_case(doc: dict) -> dict:
    """Prepare a case document for JSON output."""
    if not doc:
        return {}
    doc["_id"] = str(doc["_id"])
    for k in ("created_at", "updated_at"):
        if k in doc and hasattr(doc[k], "isoformat"):
            doc[k] = doc[k].isoformat()
    return doc


def _serialize_document(doc: dict) -> dict:
    """Prepare a documents-collection record for JSON output."""
    doc["_id"] = str(doc["_id"])
    if "uploaded_at" in doc and hasattr(doc["uploaded_at"], "isoformat"):
        doc["uploaded_at"] = doc["uploaded_at"].isoformat()
    return doc


def _groq_client():
    """Lazily build a Groq client; raise a clear error if the key is missing."""
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured on server")
    from groq import Groq
    return Groq(api_key=GROQ_API_KEY)


# ─── Pydantic Models ─────────────────────────────────────────────────────────


class CreateCasePayload(BaseModel):
    patient_id: str
    doctor_id: str
    hospital_id: Optional[str] = None
    data: Dict[str, Any]  # the case_register section


class SaveSectionPayload(BaseModel):
    data: Any


# Whitelist of section paths the frontend may write via save_section.
# `frozen_section` is reserved for the deferred Procedure-tab form (unused now).
ALLOWED_SECTIONS = {
    "case_register",
    "grossing",
    "synoptic",
    "final_diagnosis",
    "frozen_section",
    "tnm.latest",
    "cap_validation.grossing",
    "cap_validation.synoptic",
}


# ═════════════════════════════════════════════════════════════════════════════
# ACCESSION ID
# ═════════════════════════════════════════════════════════════════════════════


@router.get("/accession-id/{patient_id}")
async def get_accession_id(patient_id: str):
    """
    Return a stable display accession ID for a patient.
    Format: TMH-YYYY-XXXXXX (last 6 chars of the patient_id, upper-cased).
    Deterministic — the same patient always maps to the same accession ID,
    so it can be shown before a case document exists.
    """
    year = datetime.utcnow().year
    last = (patient_id or "").replace("-", "")[-6:].upper().rjust(6, "0")
    return {"status": "success", "accession_id": f"TMH-{year}-{last}"}


# ═════════════════════════════════════════════════════════════════════════════
# CASE CRUD
# ═════════════════════════════════════════════════════════════════════════════


@router.post("/case")
async def create_case(payload: CreateCasePayload):
    """
    Create a new pathology case. Generates a UUID case_id. One document per case;
    the newest case for a patient becomes the active one.
    """
    try:
        case_id = str(uuid.uuid4())
        now = datetime.utcnow()

        # New case becomes active; older cases for this patient are deactivated
        # so the frontend consistently opens the latest one.
        await onco_pathology_collection.update_many(
            {"patient_id": payload.patient_id},
            {"$set": {"is_active": False, "updated_at": now}},
        )

        document = {
            "patient_id": payload.patient_id,
            "doctor_id": payload.doctor_id,
            "hospital_id": payload.hospital_id,
            "case_id": case_id,
            "accession_id": (payload.data or {}).get("accession_id", ""),
            "created_at": now,
            "updated_at": now,
            "status": "Accessioned",
            "is_active": True,
            "case_register": payload.data or {},
        }

        await onco_pathology_collection.insert_one(document)

        return {"status": "success", "case_id": case_id, "message": "Case created"}

    except Exception as e:
        logger.error(f"Error creating pathology case: {e}")
        raise HTTPException(status_code=500, detail="Failed to create case")


@router.get("/case/{case_id}")
async def get_case(case_id: str):
    """Get the full document for a single pathology case (all sections)."""
    try:
        doc = await onco_pathology_collection.find_one({"case_id": case_id})
        if not doc:
            return {"status": "success", "data": {}}
        return {"status": "success", "data": _serialize_case(doc)}
    except Exception as e:
        logger.error(f"Error fetching case {case_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch case")


@router.get("/patient/{patient_id}/cases")
async def get_patient_cases(patient_id: str):
    """All pathology cases for a patient (history), newest first."""
    try:
        cursor = onco_pathology_collection.find({"patient_id": patient_id}).sort(
            "created_at", -1
        )
        docs = await cursor.to_list(length=1000)
        cases = [_serialize_case(d) for d in docs]
        return {"status": "success", "cases": cases}
    except Exception as e:
        logger.error(f"Error fetching cases for patient {patient_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch cases")


@router.get("/patient/{patient_id}/latest-case")
async def get_latest_case(patient_id: str):
    """
    Get the active case for a patient, or the newest one if none is flagged
    active. Returns { data: {} } when the patient has no cases yet.
    """
    try:
        doc = await onco_pathology_collection.find_one(
            {"patient_id": patient_id, "is_active": True}
        )
        if not doc:
            doc = await onco_pathology_collection.find_one(
                {"patient_id": patient_id}, sort=[("created_at", -1)]
            )
        return {"status": "success", "data": _serialize_case(doc) if doc else {}}
    except Exception as e:
        logger.error(f"Error fetching latest case for patient {patient_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch latest case")


@router.put("/case/{case_id}/sign-out")
async def sign_out_case(case_id: str):
    """
    Mark a case as 'Signed-out' and deactivate it. Called when the pathologist
    finalizes the report (typically from the TNM tab after final diagnosis).
    """
    try:
        result = await onco_pathology_collection.update_one(
            {"case_id": case_id},
            {
                "$set": {
                    "status": "Signed-out",
                    "is_active": False,
                    "updated_at": datetime.utcnow(),
                }
            },
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Case not found")
        return {"status": "success", "message": "Case signed out"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error signing out case {case_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to sign out case")


@router.get("/cases/{doctor_id}")
async def get_cases_by_doctor(doctor_id: str, patient_id: Optional[str] = None):
    """Worklist: all cases for a doctor, optionally filtered by patient."""
    try:
        query: Dict[str, Any] = {"doctor_id": doctor_id}
        if patient_id:
            query["patient_id"] = patient_id
        cursor = onco_pathology_collection.find(query).sort("created_at", -1)
        docs = await cursor.to_list(length=1000)

        cases = []
        for i, doc in enumerate(docs):
            cr = doc.get("case_register", {})
            cases.append(
                {
                    "sno": i + 1,
                    "case_id": doc.get("case_id", ""),
                    "patient_id": doc.get("patient_id", ""),
                    "accession_id": doc.get("accession_id", ""),
                    "patientName": cr.get("patient_name", ""),
                    "department": cr.get("department", ""),
                    "orderingClinician": cr.get("ordering_clinician", ""),
                    "dateReceived": cr.get("date_received", ""),
                    "status": doc.get("status", "Accessioned"),
                    "is_active": doc.get("is_active", False),
                }
            )
        return {"status": "success", "cases": cases}
    except Exception as e:
        logger.error(f"Error fetching cases for doctor {doctor_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch cases")


@router.put("/patient/{patient_id}/active-case/{case_id}")
async def set_active_case(patient_id: str, case_id: str):
    """Set a specific case active and all others for the patient inactive."""
    try:
        await onco_pathology_collection.update_many(
            {"patient_id": patient_id},
            {"$set": {"is_active": False, "updated_at": datetime.utcnow()}},
        )
        result = await onco_pathology_collection.update_one(
            {"case_id": case_id, "patient_id": patient_id},
            {"$set": {"is_active": True, "updated_at": datetime.utcnow()}},
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Case not found")
        return {"status": "success", "message": "Active case updated"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error setting active case: {e}")
        raise HTTPException(status_code=500, detail="Failed to set active case")


# ═════════════════════════════════════════════════════════════════════════════
# SECTION SAVE (whitelisted)
# ═════════════════════════════════════════════════════════════════════════════


@router.put("/case/{case_id}/section/{section_path:path}")
async def save_section(case_id: str, section_path: str, payload: SaveSectionPayload):
    """
    Save a specific section of a case document.

    section_path examples: "case_register", "grossing", "synoptic",
    "tnm.latest", "final_diagnosis", "cap_validation.grossing".

    MongoDB operation: { "$set": { "{section_path}": data } }
    """
    if section_path not in ALLOWED_SECTIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid section path: {section_path}. "
                f"Allowed: {', '.join(sorted(ALLOWED_SECTIONS))}"
            ),
        )
    try:
        update = {
            "$set": {
                section_path: payload.data,
                "updated_at": datetime.utcnow(),
            }
        }
        result = await onco_pathology_collection.update_one(
            {"case_id": case_id}, update
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Case not found")

        # Keep the top-level accession_id mirror in sync when case_register saves.
        if section_path == "case_register" and isinstance(payload.data, dict):
            acc = payload.data.get("accession_id")
            if acc:
                await onco_pathology_collection.update_one(
                    {"case_id": case_id}, {"$set": {"accession_id": acc}}
                )

        return {"status": "success", "message": f"Section '{section_path}' saved"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving section '{section_path}': {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to save section '{section_path}'"
        )


# ═════════════════════════════════════════════════════════════════════════════
# PATIENT INFO / PREFILL
# ═════════════════════════════════════════════════════════════════════════════


@router.get("/get-patient-info")
async def get_patient_info(patient_id: str):
    """
    Fetch patient info from patient_users, shaped for Case Registry prefill:
    name, mrn, dob, sex, department, ordering clinician.
    """
    try:
        patient_users = database["patient_users"]
        doc = await patient_users.find_one({"patient_id": patient_id})
        if not doc:
            doc = await patient_users.find_one({"sys_user_id": patient_id})
        if not doc:
            raise HTTPException(status_code=404, detail="Patient not found")

        first = doc.get("first_name", "")
        last = doc.get("last_name", "")
        full_name = doc.get("name") or f"{first} {last}".strip()

        return {
            "status": "success",
            "patient_id": patient_id,
            "patient_name": full_name,
            "mrn": doc.get("mrn", ""),
            "dob": doc.get("date_of_birth", "") or doc.get("dob", ""),
            "sex": (doc.get("gender", "") or "").lower(),
            "department": doc.get("department", ""),
            "ordering_clinician": doc.get("doctor_name", ""),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching patient info: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch patient info")


@router.get("/visit-summary/{patient_id}")
async def get_visit_summary(patient_id: str, appointment_id: Optional[str] = None):
    """
    Proxy the oncology visit-summary read used by the "Generate" button on the
    Clinical Indication field. Returns { status, overall_summary }.
    """
    try:
        url = f"{API_BASE_URL}hms/users/oncology/get_visit_summary"
        params = {"patient_id": patient_id}
        if appointment_id:
            params["appointment_id"] = appointment_id

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url, params=params)
        if resp.status_code != 200:
            return {"status": "error", "overall_summary": "", "message": resp.text}

        data = resp.json()
        overall = ""
        if data.get("type") == "single_visit":
            overall = (data.get("summary", {}) or {}).get("summary", {}).get(
                "overall_visit_summary", ""
            )
        elif data.get("type") == "all_visits":
            summaries = data.get("summaries") or []
            if summaries:
                overall = (summaries[-1].get("summary", {}) or {}).get(
                    "overall_visit_summary", ""
                )
        return {"status": "success", "overall_summary": overall}
    except Exception as e:
        logger.error(f"Error fetching visit summary for {patient_id}: {e}")
        return {"status": "error", "overall_summary": "", "message": str(e)}


# ═════════════════════════════════════════════════════════════════════════════
# REFERRAL DOCUMENTS (storage proxy — no local disk)
# ═════════════════════════════════════════════════════════════════════════════


@router.post("/documents/upload")
async def upload_document(
    doctor_id: str = Form(...),
    patient_id: str = Form(...),
    hospital_id: Optional[str] = Form(None),
    doc_type: Optional[str] = Form("referral"),
    remarks: Optional[str] = Form(None),
    file: UploadFile = File(...),
):
    """
    Upload a referral / requisition document. Proxies the binary to the storage
    service (STORAGE_BASE_URL) and records a history entry in
    `onco_pathology_documents`. Does NOT write to local disk.
    """
    if not STORAGE_BASE_URL:
        raise HTTPException(status_code=500, detail="STORAGE_BASE_URL not configured on server")
    try:
        file_bytes = await file.read()
        params = {"doctor_id": doctor_id, "patient_id": patient_id, "doc_type": doc_type}

        async with httpx.AsyncClient(timeout=60.0) as client:
            storage_response = await client.post(
                f"{STORAGE_BASE_URL}/upload",
                params=params,
                files={"file": (file.filename, file_bytes, file.content_type)},
            )
        if storage_response.status_code != 200:
            raise HTTPException(
                status_code=storage_response.status_code, detail=storage_response.text
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
        await onco_pathology_documents_collection.insert_one(record)

        return {
            "status": "success",
            "file_url": file_url,
            "document": _serialize_document(dict(record)),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Referral upload failed for patient {patient_id}: {e}")
        raise HTTPException(status_code=500, detail=f"File upload failed: {str(e)}")


@router.get("/documents/{patient_id}")
async def get_documents(patient_id: str, doctor_id: Optional[str] = None):
    """Referral/document history for a patient, newest first."""
    try:
        query: Dict[str, Any] = {"patient_id": patient_id}
        if doctor_id:
            query["doctor_id"] = doctor_id
        cursor = onco_pathology_documents_collection.find(query).sort("uploaded_at", -1)
        docs = await cursor.to_list(length=500)
        return {"status": "success", "documents": [_serialize_document(d) for d in docs]}
    except Exception as e:
        logger.error(f"Error fetching documents for patient {patient_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch documents")


@router.delete("/documents/{document_id}")
async def delete_document(document_id: str):
    """Delete a document history record (stored file left in place)."""
    try:
        result = await onco_pathology_documents_collection.delete_one(
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


@router.get("/process-referral-letters/{patient_id}")
async def process_referral_letters(patient_id: str):
    """
    Extract text from the patient's uploaded referral PDFs and summarise each
    with the LLM. Returns { status, count, results: [{ llm_output: {...} }] }.

    The frontend reads results[0].llm_output.overall_summary to populate the
    Clinical Indication field.
    """
    try:
        cursor = onco_pathology_documents_collection.find(
            {"patient_id": patient_id, "doc_type": "referral"}
        ).sort("uploaded_at", -1)
        pdfs = await cursor.to_list(length=None)
        if not pdfs:
            return {"status": "success", "count": 0, "results": [], "message": "No referral letters found"}

        from PyPDF2 import PdfReader  # imported lazily; optional dependency
        import io

        client = _groq_client()
        results = []
        for pdf in pdfs:
            doc_id = pdf.get("document_id")
            try:
                # Fetch the stored file from the storage service.
                async with httpx.AsyncClient(timeout=60.0) as http:
                    file_resp = await http.get(pdf["file_url"])
                if file_resp.status_code != 200:
                    raise ValueError(f"Could not fetch stored file ({file_resp.status_code})")

                reader = PdfReader(io.BytesIO(file_resp.content))
                extracted_text = "".join((page.extract_text() or "") for page in reader.pages)
                if not extracted_text.strip():
                    raise ValueError("No text extracted from PDF")

                prompt = f"""
You are an expert medical assistant.

Extract the essential medical meaning of the referral letter below and produce
ONE SINGLE structured output summarizing all clinically relevant information.

TEXT:
{extracted_text}

Return JSON with exactly these fields:
- referred_from: (doctor or specialty)
- referred_to: (specialty)
- overall_summary: A single, merged summary that includes reason for referral,
  key clinical findings, investigations mentioned, treatments mentioned, and any
  identifiable patient information.
"""
                completion = client.chat.completions.create(
                    model="llama-3.1-8b-instant",
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.0,
                    response_format={"type": "json_object"},
                    max_tokens=2048,
                )
                output_json = json.loads(completion.choices[0].message.content)
                results.append(
                    {
                        "document_id": doc_id,
                        "file_name": pdf.get("original_filename"),
                        "processed_at": datetime.utcnow().isoformat(),
                        "llm_output": output_json,
                    }
                )
            except Exception as pdf_error:
                logger.error(f"Referral processing failed for {doc_id}: {pdf_error}")
                results.append({"document_id": doc_id, "error": str(pdf_error)})

        return {"status": "success", "count": len(results), "results": results}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing referral letters for {patient_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")


# ═════════════════════════════════════════════════════════════════════════════
# LLM STRUCTURING (Groq)
# ═════════════════════════════════════════════════════════════════════════════


class StructurePayload(BaseModel):
    text: str


@router.post("/grossing/structure")
async def structure_grossing(payload: StructurePayload):
    """
    Convert free-text grossing dictation into structured JSON fields.
    Extracts specimen handling, measurements, tumor description, margins, nodes.
    """
    try:
        if not payload.text:
            raise HTTPException(status_code=400, detail="Dictation text is required")

        client = _groq_client()
        prompt = f"""
You are a pathology grossing assistant AI.
Extract structured grossing details from the dictation below.

Return STRICT JSON with these keys (use empty string "" for missing values).

For the fields marked "one of", you MUST copy one option EXACTLY as written
(including capitalization and punctuation), or "" if none applies.

For numeric fields (marked "number only"), strip any units or words and return
only the bare number (e.g. "22 hours" → "22", "4.5 cm" → "4.5").

{{
  "container_type": "",        // one of: Jar | Cassette | Bag
  "fixative_used": "",         // one of: 10% Neutral Buffered Formalin | Alcohol | Fresh (Not Fixed)
  "fixation_date": "",         // YYYY-MM-DD format
  "fixation_time": "",         // HH:MM format (24-hour)
  "fixation_duration": "",     // number only (hours)

  "length_cm": "",             // number only
  "width_cm": "",              // number only
  "depth_cm": "",              // number only
  "weight_g": "",              // number only

  "color": "",                 // one of: Grey-white | Tan | Pink | Yellow | Brown | Hemorrhagic | Mixed
  "consistency": "",           // one of: Soft | Firm | Hard | Friable | Rubbery

  "tumor_greatest_dimension": "",    // number only (cm)
  "additional_dimensions": "",
  "tumor_configuration": "",          // one of: Ulcerated | Polypoid | Fungating | Flat | Infiltrative
  "tumor_location": "",
  "gross_description": "",

  "proximal_margin": "",       // number only (cm)
  "distal_margin": "",         // number only (cm)
  "radial_margin": "",         // number only (cm)
  "other_margins": "",

  "total_lymph_nodes": "",     // number only (count)
  "lymph_node_stations": "",
  "lymph_node_description": ""
}}

DICTATION:
\"\"\"{payload.text}\"\"\"
"""
        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            response_format={"type": "json_object"},
            max_tokens=1500,
        )
        structured = json.loads(completion.choices[0].message.content)
        return {"status": "success", "data": structured}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Grossing dictation structuring failed: {e}")
        raise HTTPException(status_code=500, detail=f"Structuring failed: {e}")


@router.post("/synoptic/structure")
async def structure_synoptic(payload: StructurePayload):
    """
    Convert pathologist dictation into CAP-compliant synoptic report fields.
    Extracts procedure, tumor type, WHO classification, grade, tumor extent,
    margins, lymph nodes, and additional findings. Default: colorectal protocol.
    """
    try:
        if not payload.text:
            raise HTTPException(status_code=400, detail="Dictation text is required")

        client = _groq_client()
        prompt = f"""
You are an expert Surgical Pathology Extraction AI specializing in colorectal carcinoma.
Convert the narrative pathology dictation into STRICT JSON following the CAP Colorectal
Carcinoma Protocol v4.2.0.0 and WHO 5th Edition Digestive System Tumor Classification.

Return STRICT JSON with these keys (use empty string "" for missing values):

{{
  "procedure": "",
  "tumor_site": "",

  "histologic_type": "",
  "icdo_code": "",
  "clinical_findings": "",
  "pathological_findings": "",

  "grade": "",
  "tumor_greatest_dimension_cm": "",
  "tumor_additional_dimensions": "",
  "depth_of_invasion": "",

  "proximal_margin_status": "",
  "proximal_margin_distance_cm": "",
  "distal_margin_status": "",
  "distal_margin_distance_cm": "",
  "circumferential_margin_status": "",
  "circumferential_margin_distance_cm": "",

  "total_nodes_examined": "",
  "positive_nodes": "",
  "lymph_node_stations": "",

  "lymphovascular_invasion": "",
  "perineural_invasion": "",
  "tumor_deposits": "",
  "tumor_deposits_number": "",

  "warnings": [],
  "confidence": ""
}}

EXTRACTION STANDARDS:

1. **Procedure**: Right/left/sigmoid/transverse colectomy, total colectomy, etc.
2. **Tumor Site**: Cecum, ascending colon, hepatic flexure, transverse, splenic flexure,
   descending, sigmoid, rectosigmoid, rectum.
3. **WHO Tumor Type**: Adenocarcinoma NOS (8140/3), Mucinous (8480/3), Signet-ring (8490/3), etc.
4. **Grade**: G1 (well differentiated), G2 (moderately), G3 (poorly), G4 (undifferentiated).
5. **Tumor Size**: Greatest dimension in cm + additional dimensions if present.
6. **Depth of Invasion**: Lamina propria, muscularis mucosae, submucosa (pT1),
   muscularis propria (pT2), subserosa/pericolic fat (pT3), visceral peritoneum (pT4a),
   adjacent organ (pT4b).
7. **Margins**: Status (uninvolved/involved/cannot be assessed) + distance in cm.
8. **Lymph Nodes**: Total examined and positive for metastasis.
9. **Additional Findings**: Lymphovascular invasion, perineural invasion, tumor deposits.
10. **Clinical vs Pathological Findings**:
    - clinical_findings: pre-op clinical context (symptoms, imaging, indication)
    - pathological_findings: gross + microscopic diagnostic findings (WHO type, grade, invasion, nodes, margins)
11. **Warnings**: Add warnings for missing tumor size, grade, WHO type, ICD-O code, margins, nodes,
    depth of invasion, or procedure.
12. **Confidence**: Float 0–1 based on extraction certainty.

DICTATION:
\"\"\"{payload.text}\"\"\"
"""
        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            response_format={"type": "json_object"},
            max_tokens=2000,
        )
        structured = json.loads(completion.choices[0].message.content)
        return {"status": "success", "data": structured}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Synoptic dictation structuring failed: {e}")
        raise HTTPException(status_code=500, detail=f"Structuring failed: {e}")


# ═════════════════════════════════════════════════════════════════════════════
# TNM STAGING (AJCC 8th Edition — Colon & Rectum)
# ═════════════════════════════════════════════════════════════════════════════


class TNMDerivePayload(BaseModel):
    synoptic: Dict[str, Any] = {}


class CalculateStagePayload(BaseModel):
    t_stage: str
    n_stage: str
    m_stage: str


@router.post("/tnm/derive")
async def derive_tnm(payload: TNMDerivePayload):
    """
    Auto-suggest T/N/M from a synoptic report (depth of invasion + node counts).
    Pure rules — no DB read; the frontend passes the current synoptic section.
    The pathologist confirms/overrides before calculating the final stage.
    """
    s = payload.synoptic or {}

    # ── T stage from depth of invasion ──────────────────────────────────────
    depth = (s.get("depth_of_invasion") or "").lower()
    t_map = [
        ("lamina propria", ("Tis", "Tumor limited to lamina propria / intramucosal")),
        ("muscularis mucosae", ("Tis", "Carcinoma in situ / intramucosal")),
        ("submucosa", ("T1", "Invasion into submucosa")),
        ("muscularis propria", ("T2", "Invades muscularis propria")),
        ("subserosa", ("T3", "Extends into subserosa / pericolic tissues")),
        ("pericolic", ("T3", "Extends into subserosa / pericolic tissues")),
        ("visceral peritoneum", ("T4a", "Penetrates visceral peritoneum")),
        ("adjacent organ", ("T4b", "Invades adjacent organs / structures")),
    ]
    t_stage, t_desc = "", "Unable to determine T stage from depth of invasion"
    for key, (stg, desc) in t_map:
        if key in depth:
            t_stage, t_desc = stg, desc
            break

    # ── N stage from positive node count ────────────────────────────────────
    def _int(v):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0

    positive = _int(s.get("positive_nodes"))
    total = _int(s.get("total_nodes_examined"))
    if positive == 0:
        n_stage, n_desc = "N0", f"No regional lymph node metastasis (0/{total})"
    elif positive == 1:
        n_stage, n_desc = "N1a", "Metastasis in 1 regional lymph node"
    elif 2 <= positive <= 3:
        n_stage, n_desc = "N1b", f"Metastasis in {positive} regional lymph nodes"
    elif 4 <= positive <= 6:
        n_stage, n_desc = "N2a", f"Metastasis in {positive} regional lymph nodes"
    else:
        n_stage, n_desc = "N2b", f"Metastasis in ≥7 regional lymph nodes ({positive})"

    return {
        "status": "success",
        "data": {
            "t_stage": t_stage,
            "t_description": t_desc,
            "n_stage": n_stage,
            "n_description": n_desc,
            "m_stage": "M0",
            "m_description": "No distant metastasis (default — confirm clinically)",
            "node_adequate": total >= 12,
        },
    }


@router.post("/tnm/calculate-stage")
async def calculate_stage(payload: CalculateStagePayload):
    """
    Compute the AJCC 8th Edition pathologic stage group from T/N/M.
    Pure function — the frontend persists the result via saveSection('tnm.latest').
    """
    t, n, m = payload.t_stage, payload.n_stage, payload.m_stage
    if not t or not n or not m:
        raise HTTPException(status_code=400, detail="Missing TNM values")

    # Distant metastasis overrides everything.
    if m != "M0":
        final_stage = {"M1a": "IVA", "M1b": "IVB", "M1c": "IVC"}.get(m, "IV")
    elif n.startswith("N1") or n.startswith("N2"):
        # Stage III groups
        if t in ["T1", "T2"] and n in ["N1a", "N1b", "N1c"]:
            final_stage = "IIIA"
        elif t == "T1" and n == "N2a":
            final_stage = "IIIA"
        elif t in ["T3", "T4a"] and n in ["N1a", "N1b", "N1c"]:
            final_stage = "IIIB"
        elif t in ["T2", "T3"] and n == "N2a":
            final_stage = "IIIB"
        elif t in ["T4a", "T4b"] and n in ["N2a", "N2b"]:
            final_stage = "IIIC"
        else:
            final_stage = "III"
    else:
        # Stage 0 / I / II groups
        if t == "Tis":
            final_stage = "0"
        elif t in ["T1", "T2"]:
            final_stage = "I"
        elif t == "T3":
            final_stage = "IIA"
        elif t == "T4a":
            final_stage = "IIB"
        elif t == "T4b":
            final_stage = "IIC"
        else:
            final_stage = "Unknown"

    return {
        "status": "success",
        "data": {
            "final_stage": final_stage,
            "tnm_code": f"p{t} p{n} {m}",
            "confidence": "95%",
            "message": "Stage computed per AJCC 8th Edition. Pathologist confirmation required.",
        },
    }


# ═════════════════════════════════════════════════════════════════════════════
# FINAL DIAGNOSIS + AI REVIEW
# ═════════════════════════════════════════════════════════════════════════════


class FinalDiagnosisPayload(BaseModel):
    synoptic: Dict[str, Any] = {}
    grossing: Dict[str, Any] = {}
    tnm: Dict[str, Any] = {}


class AIReviewPayload(BaseModel):
    synoptic: Dict[str, Any] = {}
    grossing: Dict[str, Any] = {}
    tnm: Dict[str, Any] = {}


@router.post("/final-diagnosis/generate")
async def generate_final_diagnosis(payload: FinalDiagnosisPayload):
    """
    Assemble a templated final pathologic diagnosis narrative from the synoptic
    report, grossing bench, and TNM staging. Returns text for the editable
    Final Diagnosis field (persisted via saveSection('final_diagnosis')).
    """
    d = payload.synoptic or {}
    g = payload.grossing or {}
    t = payload.tnm or {}

    site = (d.get("tumor_site") or "SPECIMEN").upper()
    text = f"""{site}, {d.get('procedure', '')}:

- {d.get('histologic_type', 'Tumor')}, {d.get('grade', '')}
- Tumor size: {d.get('tumor_greatest_dimension_cm') or g.get('tumor_greatest_dimension') or 'NA'} cm
- Depth of invasion: {d.get('depth_of_invasion') or t.get('t_description') or 'NA'} ({t.get('t_stage', '')})
- Margins:
    • Proximal: {d.get('proximal_margin_distance_cm') or g.get('proximal_margin') or 'NA'} cm ({d.get('proximal_margin_status', '')})
    • Distal: {d.get('distal_margin_distance_cm') or g.get('distal_margin') or 'NA'} cm ({d.get('distal_margin_status', '')})
    • Circumferential/Radial: {d.get('circumferential_margin_distance_cm') or g.get('radial_margin') or 'NA'} cm
- Lymph nodes: {d.get('positive_nodes') or 0} positive of {d.get('total_nodes_examined') or g.get('total_lymph_nodes') or 'NA'} examined ({t.get('n_stage', '')})
- Lymphovascular invasion: {d.get('lymphovascular_invasion', 'Not reported')}
- Perineural invasion: {d.get('perineural_invasion', 'Not reported')}
- Pathologic stage: {t.get('final_stage', '')} ({t.get('tnm_code', '')})

COMMENT:
{t.get('message', 'Findings correlated across grossing, synoptic, and staging data.')}""".strip()

    return {"status": "success", "data": {"final_diagnosis": text}}


@router.post("/ai-review")
async def ai_review(payload: AIReviewPayload):
    """
    AI correlation + CAP validation across synoptic, grossing, and TNM staging.
    Returns structured correlation, CAP checks, TNM analysis, and a consolidated
    final review. Advisory only — the pathologist signs out the report.
    """
    try:
        client = _groq_client()
        prompt = f"""
You are an AI Pathologist specializing in colorectal cancer histopathology reporting.
Analyze the Synoptic Report, Grossing Bench Report, and TNM Staging below and produce
a STRICT JSON output using this exact structure:

{{
  "correlation": {{
    "gross_synoptic_consistency": "string",
    "size_correlation": "string",
    "margin_correlation": "string",
    "ln_correlation": "string",
    "depth_correlation": "string"
  }},
  "cap_validation": [
    {{ "rule": "string", "status": "pass | warning | fail", "message": "string" }}
  ],
  "tnm_analysis": {{
    "tnm_consistency": "string",
    "stage_interpretation": "string",
    "stage_recommendation": "string"
  }},
  "final_review": {{
    "overall_summary": "string",
    "final_diagnosis": "string",
    "ai_confidence": "string"
  }}
}}

Validate CAP requirements: node adequacy (≥12), margin involvement/clearance,
depth vs T-stage compatibility, node positivity vs N-stage, tumor size correlation
(gross vs synoptic). For each rule set status to pass/warning/fail with a short message.

# INPUT DATA
## Synoptic Report
{json.dumps(payload.synoptic, indent=2, default=str)}

## Grossing (Macroscopy)
{json.dumps(payload.grossing, indent=2, default=str)}

## TNM (Latest Staging)
{json.dumps(payload.tnm, indent=2, default=str)}
"""
        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            response_format={"type": "json_object"},
            max_tokens=2500,
        )
        result = json.loads(completion.choices[0].message.content)
        return {
            "status": "success",
            "correlation": result.get("correlation", {}),
            "cap_validation": result.get("cap_validation", []),
            "tnm_analysis": result.get("tnm_analysis", {}),
            "final_review": result.get("final_review", {}),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"AI pathology review failed: {e}")
        raise HTTPException(status_code=500, detail=f"AI review failed: {e}")
