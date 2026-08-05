from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request,Query
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.templating import Jinja2Templates
from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime
import aiofiles
import os
import httpx
import traceback
import logging
import sys
from pydantic import BaseModel, validator, Field
from typing import List, Optional
from typing import Optional, List
from typing import List, Dict
import io
import json


from groq import Groq
from bson import ObjectId
router = APIRouter(
    prefix="/hms/dicom",
    tags=["doctor"],
    responses={404: {"description": "Not found"}},
)


# -----------------------
# Logging
# -----------------------
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
stream_handler = logging.StreamHandler(sys.stdout)
stream_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
logger.addHandler(stream_handler)
logger.info("✅ HMS DICOM router starting up...")

# -----------------------
# MongoDB setup
# -----------------------
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"
NODES_DB = "doctorassistai_nodes"

mongodb_client = AsyncIOMotorClient(MONGO_URI)  # async (Motor)
database = mongodb_client[MONGO_DB]

client = MongoClient(MONGO_URI)  # sync (PyMongo)
db = client[MONGO_DB]
dicom_collection = db["dicom_studies"]
ecg_collection = db["ecg_pdfs"]
echo_collection = db["echo_video"]
patient_context_collection = db["patient_context"]
pathology_collection = db["pathology"]
# -----------------------
# Orthanc setup
# -----------------------
ORTHANC_STOW = "http://143.110.187.180:8042/dicom-web/studies"
ORTHANC_USER = "mapdr"
ORTHANC_PASSWORD = "changestrongpassword"

# -----------------------
# Upload folder
# -----------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# -----------------------
# Templates setup
# -----------------------
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

# -----------------------
# Routes
# -----------------------
groq_client = Groq(
    api_key=os.getenv("GROQ_API_KEY")
)

class FileEntry(BaseModel):
    filename: str = Field(..., description="Name of the uploaded file")
    study_uid: str = Field(..., description="Unique study UID from Orthanc")
    uploaded_at: datetime = Field(default_factory=datetime.utcnow, description="Upload timestamp")

class DICOMUpload(BaseModel):
    patient_id: str = Field(..., description="Patient ID")
    documents: Dict[str, List[FileEntry]] = Field(
        default_factory=dict,
        description="Mapping of document type (MRI, CT, X-ray, etc.) to list of uploaded files"
    )
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Record creation timestamp")


class ECGMODEL(BaseModel):
    """
    Metadata for diabetic foot thermal PDF reports.
    """
    patient_id: str = Field(..., description="Unique patient ID")
    doctor_id: str = Field(..., description="Doctor who uploaded the PDF")
    timestamp: datetime = Field(..., description="When the PDF was generated")
    file_name: Optional[str] = Field(None, description="Stored file name")
    file_path: Optional[str] = Field(None, description="Local file path")
    created_at: Optional[datetime] = Field(default_factory=datetime.utcnow, description="Upload timestamp")
    file_type: Optional[str] = Field(
    default=None,
    description="Type of document (pdf/mp4/mov/avi)"
)

class ECHOMODEL(BaseModel):
    """
    Metadata for diabetic foot thermal PDF reports.
    """
    patient_id: str = Field(..., description="Unique patient ID")
    doctor_id: str = Field(..., description="Doctor who uploaded the PDF")
    timestamp: datetime = Field(..., description="When the PDF was generated")
    file_name: Optional[str] = Field(None, description="Stored file name")
    file_path: Optional[str] = Field(None, description="Local file path")
    created_at: Optional[datetime] = Field(default_factory=datetime.utcnow, description="Upload timestamp")
    file_type: Optional[str] = Field(
    default=None,
    description="Type of document (pdf/mp4/mov/avi)"
)

@router.get("/upload", response_class=HTMLResponse)
async def render_upload_page(request: Request):
    """
    Render the upload HTML page.
    """
    return templates.TemplateResponse("upload.html", {"request": request})




@router.get("/test", response_class=HTMLResponse)
async def render_upload_page(request: Request):
    """
    Render the upload HTML page.
    """
    return templates.TemplateResponse("test.html", {"request": request})
# -------------------------
# Upload endpoint
# -------------------------
from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import JSONResponse
from typing import List
from datetime import datetime, timezone
import os, aiofiles, httpx, traceback

# Assuming DICOMUpload and FileEntry models are already imported
# from your models file


@router.post("/upload/")
async def upload_dicom(
    files: List[UploadFile] = File(...),
    patient_id: str = Form(...),
    document_type: str = Form(...)
):
    """Upload DICOM files to Orthanc and save record in MongoDB safely."""
    
    if not files:
        return JSONResponse(status_code=400, content={"error": "No files uploaded."})

    allowed_types = ["MRI", "CT", "X-ray", "PET scan", "Echocardiogram", "Endoscopy report"]
    if document_type not in allowed_types:
        return JSONResponse(status_code=400, content={"error": "Invalid document type."})

    try:
        # Save files temporarily
        file_contents = {}
        for file in files:
            safe_filename = os.path.basename(file.filename)
            temp_path = os.path.join(UPLOAD_DIR, safe_filename)
            os.makedirs(os.path.dirname(temp_path), exist_ok=True)
            async with aiofiles.open(temp_path, "wb") as f:
                content = await file.read()
                await f.write(content)
                file_contents[safe_filename] = content

        # Build multipart body for Orthanc STOW-RS
        boundary = f"----FastAPIBoundary{os.urandom(8).hex()}"
        body_parts = []
        for filename, content in file_contents.items():
            body_parts.append(
                f"--{boundary}\r\n"
                f'Content-Type: application/dicom\r\n'
                f'Content-Disposition: attachment; filename="{filename}"\r\n\r\n'.encode("utf-8")
            )
            body_parts.append(content)
            body_parts.append(b"\r\n")
        body_parts.append(f"--{boundary}--".encode("utf-8"))
        multipart_body = b"".join(body_parts)
        headers = {"Content-Type": f'multipart/related; type="application/dicom"; boundary={boundary}'}

        # Upload to Orthanc
        async with httpx.AsyncClient(auth=(ORTHANC_USER, ORTHANC_PASSWORD), timeout=None) as client:
            response = await client.post(ORTHANC_STOW, content=multipart_body, headers=headers)

        if response.status_code not in (200, 202):
            return JSONResponse(
                status_code=500,
                content={"error": "Orthanc STOW-RS upload failed", "details": response.text},
            )

        data = response.json()
        study_url = data["00081190"]["Value"][0]
        study_uid = study_url.rstrip("/").split("/")[-1]

        # Prepare files metadata
        now = datetime.now(timezone.utc)
        study_dict = {}

        for f in files:
    # Assuming all files in this batch belong to the same study_uid returned by Orthanc
            if study_uid not in study_dict:
                study_dict[study_uid] = {
                    "study_uid": study_uid,
                    "uploaded_at": now,
                    "files": []
                }
            study_dict[study_uid]["files"].append(f.filename)
            logger.info(f"📁 Uploaded file {f.filename} for patient {patient_id} under study {study_uid}")
# Convert dict to list for MongoDB push
        studies_to_insert = list(study_dict.values())
        logger.info(f"🗂 Preparing to insert {len(studies_to_insert)} studies for patient {patient_id}")
# Step 1: Ensure patient document exists
        dicom_collection.update_one(
            {"patient_id": patient_id},
            {"$setOnInsert": {"patient_id": patient_id}},
            upsert=True
        )

# Step 2: Ensure documents.{document_type} array exists
        dicom_collection.update_one(
            {"patient_id": patient_id, f"documents.{document_type}": {"$exists": False}},
            {"$set": {f"documents.{document_type}": []}}
        )

# Step 3: Push new studies grouped by study_uid
        for study in studies_to_insert:
            # Avoid duplicates: push only if study_uid not already present
            dicom_collection.update_one(
                {"patient_id": patient_id, f"documents.{document_type}.study_uid": {"$ne": study["study_uid"]}},
                {"$push": {f"documents.{document_type}": study}}
            )

    except Exception:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": "Upload failed."})

    finally:
        # Clean up temporary files
        for file in files:
            try:
                os.remove(os.path.join(UPLOAD_DIR, file.filename))
            except Exception:
                pass

    return JSONResponse(
        status_code=200,
        content={
            "success": True,
            "study_uid": study_uid,
            "patient_id": patient_id,
            "document_type": document_type,
            "uploaded_at": now.isoformat()
        },
    )

@router.get("/healthcheck")
async def healthcheck():
    return {"status": "ok", "service": "HMS DICOM router"}


@router.get("/studies/{patient_id}")
def get_dicom_studies(patient_id: str):
    """
    Retrieve DICOM studies from MongoDB by patient ID (sync version).
    """
    try:
        studies_cursor = dicom_collection.find({"patient_id": patient_id})
        studies = []
        for study in studies_cursor:
            study["_id"] = str(study["_id"])
            studies.append(study)

        if not studies:
            return JSONResponse(status_code=404, content={"error": "No studies found for this patient_id."})

        return JSONResponse(status_code=200, content={"patient_id": patient_id, "studies": studies})

    except Exception:
        logger.error(traceback.format_exc())
        return JSONResponse(status_code=500, content={"error": "Failed to retrieve studies."})



@router.get("/studies/search")
async def get_dicom_studies(
    patient_id: str = Query(..., description="Patient ID to search for"),
    document_type: Optional[str] = Query(None, description="Optional document type filter")
):
    """
    Retrieve DICOM studies for a patient, optionally filtered by document_type.
    Returns raw MongoDB documents without modifying _id.
    """
    try:
        query = {"patient_id": patient_id}
        if document_type:
            query["document_type"] = document_type

        studies = list(dicom_collection.find(query).sort("created_at", -1))

        if not studies:
            return JSONResponse(
                status_code=404,
                content={
                    "error": f"No studies found for patient_id '{patient_id}'" + 
                             (f" with type '{document_type}'" if document_type else "")
                }
            )

        return {"patient_id": patient_id, "studies": studies}

    except Exception:
        logger.error(traceback.format_exc())
        return JSONResponse(
            status_code=500,
            content={"error": "Failed to retrieve studies"}
        )



from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from typing import Optional

@router.get("/patient-documents/")
async def get_patient_documents(
    patient_id: str = Query(..., description="Patient ID to retrieve documents for"),
    document_type: Optional[str] = Query(None, description="Optional document type filter (MRI, X-ray, etc.)")
):
    """
    Retrieve all documents for a patient.
    If document_type is provided, returns only that type.
    Converts datetime objects to ISO strings for JSON serialization.
    Supports the new format where each study contains multiple files.
    """
    try:
        # Fetch patient record from MongoDB
        patient_record = dicom_collection.find_one({"patient_id": patient_id}, {"_id": 0})
        if not patient_record:
            return JSONResponse(status_code=404, content={"error": "Patient not found."})

        documents = patient_record.get("documents", {})

        # Helper function to serialize each study
        def serialize_studies(studies):
            return [
                {
                    "study_uid": s.get("study_uid"),
                    "uploaded_at": s.get("uploaded_at").isoformat()
                        if isinstance(s.get("uploaded_at"), datetime) else s.get("uploaded_at"),
                    "files": s.get("files", [])
                }
                for s in studies
            ]

        if document_type:
            studies = documents.get(document_type, [])
            serialized = serialize_studies(studies)
            return JSONResponse(
                status_code=200,
                content={
                    "patient_id": patient_id,
                    "document_type": document_type,
                    "files": serialized
                }
            )
        else:
            # Serialize all document types
            serialized_documents = {doc_type: serialize_studies(studies) for doc_type, studies in documents.items()}
            return JSONResponse(
                status_code=200,
                content={
                    "patient_id": patient_id,
                    "documents": serialized_documents
                }
            )

    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": "Failed to retrieve documents", "details": str(e)}
        )




@router.post("/upload-ecg")
async def upload_diabetic_foot_pdf(
    pdf_file: UploadFile = File(...),
    patient_id: str = Form(...),
    doctor_id: str = Form(...),
    timestamp: str = Form(...)
):
    """
    Upload a diabetic foot thermal PDF report and save metadata in MongoDB.
    """
    try:
        logger.info(f"📄 Uploading PDF for patient={patient_id}, doctor={doctor_id}")

        # Validate timestamp format
        try:
            timestamp_obj = datetime.fromisoformat(timestamp)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid timestamp format. Use ISO format (YYYY-MM-DDTHH:MM:SS).")

        # Validate file type
        if not pdf_file.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="Only PDF files are allowed.")

        # Generate unique filename
        unique_filename = f"{patient_id}_{doctor_id}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}.pdf"
        save_path = os.path.join(UPLOAD_DIR, unique_filename)

        # Save PDF file asynchronously
        async with aiofiles.open(save_path, "wb") as f:
            content = await pdf_file.read()
            await f.write(content)

        # Create MongoDB document
        pdf_doc = ECGModel(
            patient_id=patient_id,
            doctor_id=doctor_id,
            timestamp=timestamp_obj,
            file_name=unique_filename,
            file_path=save_path
        )

        # Insert into MongoDB
        result = await ecg_collection.insert_one(pdf_doc.model_dump())
        logger.info(f"✅ PDF metadata saved in MongoDB with _id={result.inserted_id}")

        return JSONResponse(
            status_code=200,
            content={
                "status": "success",
                "message": "PDF uploaded successfully",
                "pdf_id": str(result.inserted_id)
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Failed to upload PDF: {e}")


@router.get("/get/{patient_id}")
async def get_diabetic_foot_pdfs(patient_id: str):
    """
    Retrieve all uploaded diabetic foot PDF files for a patient.
    """
    try:
        logger.info(f"🔍 Fetching PDFs for patient_id={patient_id}")

        pdfs = await ecg_collection.find(
            {"patient_id": patient_id},
            {"_id": 1, "file_name": 1, "file_path": 1, "timestamp": 1, "created_at": 1}
        ).to_list(length=None)

        if not pdfs:
            raise HTTPException(status_code=404, detail=f"No PDFs found for patient_id={patient_id}")

        for pdf in pdfs:
            pdf["_id"] = str(pdf["_id"])
            if "timestamp" in pdf and isinstance(pdf["timestamp"], datetime):
                pdf["timestamp"] = pdf["timestamp"].isoformat()
            if "created_at" in pdf and isinstance(pdf["created_at"], datetime):
                pdf["created_at"] = pdf["created_at"].isoformat()

        return JSONResponse(
            status_code=200,
            content={
                "status": "success",
                "count": len(pdfs),
                "data": pdfs
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Failed to retrieve PDFs: {e}")
    
    
    
    
@router.post("/upload-echo")
async def upload_echo_files(
    files: List[UploadFile] = File(...),
    patient_id: str = Form(...),
    doctor_id: str = Form(...),
    timestamps: List[str] = Form(...),  # one timestamp per file
    doctype: str = Form(...)
):
    """
    Upload multiple echo files (video/PDF) for a patient.
    All files in the same request share the same `document_id` (session ID).
    Each file has a unique `_id` and is stored in MongoDB.
    PanEcho inference and LLM analysis run for each file.
    """
    if len(files) != len(timestamps):
        raise HTTPException(status_code=400, detail="Number of timestamps must match number of files.")

    uploaded_entries = []
    panecho_responses = []

    try:
        # Generate a single document_id (session ID) for this batch
        session_id = str(ObjectId())

        for idx, file in enumerate(files):
            ts = timestamps[idx]
            try:
                timestamp_obj = datetime.fromisoformat(ts)
            except ValueError:
                raise HTTPException(status_code=400, detail=f"Invalid timestamp format for file {file.filename}")

            # Validate file extension
            allowed_extensions = [".mp4", ".mov", ".avi", ".pdf"]
            filename_lower = file.filename.lower()
            if not any(filename_lower.endswith(ext) for ext in allowed_extensions):
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid file type for {file.filename}. Allowed: {allowed_extensions}"
                )

            extension = os.path.splitext(filename_lower)[1]
            unique_filename = f"{patient_id}_{doctor_id}_{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}{extension}"
            save_path = os.path.join(UPLOAD_DIR, unique_filename)

            # Save file locally
            content = await file.read()
            async with aiofiles.open(save_path, "wb") as f:
                await f.write(content)

            # Prepare echo metadata entry
            file_id = str(ObjectId())
            echo_entry = {
                "_id": file_id,
                "document_id": session_id,  # same for all files in this batch
                "file_name": unique_filename,
                "file_path": save_path,
                "file_type": extension.replace(".", ""),
                "doctor_id": doctor_id,
                "timestamp": timestamp_obj,
                "doctype": doctype,
                "created_at": datetime.utcnow()
            }

            # Insert or update patient record in MongoDB
            patient_doc = await echo_collection.find_one({"patient_id": patient_id})
            if patient_doc:
                await echo_collection.update_one(
                    {"patient_id": patient_id},
                    {"$push": {"echo_files": echo_entry}}
                )
            else:
                await echo_collection.insert_one({
                    "patient_id": patient_id,
                    "echo_files": [echo_entry]
                })

            uploaded_entries.append(echo_entry)

            # ---- PanEcho inference + LLM ----
            try:
                PANECHO_URL = "http://143.110.187.180:9010/infer"
                files_payload = {
                    "file": (
                        unique_filename,
                        content,
                        file.content_type or "application/octet-stream"
                    )
                }

                async with httpx.AsyncClient(timeout=300) as client:
                    panecho_res = await client.post(PANECHO_URL, files=files_payload)

                try:
                    panecho_json = panecho_res.json()
                    logger.info(panecho_json)
                except:
                    panecho_json = {"raw_response": panecho_res.text}

                panecho_responses.append({file.filename: panecho_json})

                # Run LLM analysis
                llm_report = await analyze_echo_llm(echo_data=panecho_json)

                # Flatten lists in LLM output to strings
                for key in ["abnormalities", "recommendations"]:
                    value = llm_report.get(key)
                    if isinstance(value, list):
                        llm_report[key] = " ".join(value)

                await extract_structured_imaging_data1(
                    patient_context_collection=patient_context_collection,
                    imaging_result=llm_report,
                    doc_type="echo",
                    patient_id=patient_id,
                    doctor_id=doctor_id,
                    file_path=save_path,
                    doc_date=ts,
                    document_id=session_id,
                    analysis_source="enhanced"
                )

            except Exception as e:
                logger.error(f"❌ PanEcho/LLM failed for {file.filename}: {e}", exc_info=True)
                panecho_responses.append({file.filename: {"error": str(e)}})

        # Convert datetimes to ISO strings before returning
        for entry in uploaded_entries:
            entry["timestamp"] = entry["timestamp"].isoformat()
            entry["created_at"] = entry["created_at"].isoformat()

        return JSONResponse(
            status_code=200,
            content={
                "status": "success",
                "message": "All echo files uploaded and processed",
                "patient_id": patient_id,
                "document_id": session_id,
                "uploaded_files": uploaded_entries,
                "panecho_responses": panecho_responses
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Failed to upload echo files: {e}")


@router.get("/echo/{patient_id}")
async def get_echo_files(patient_id: str):
    """
    Retrieve all uploaded echocardiogram files (PDF or video) for a patient.
    """
    try:
        logger.info(f"🔍 Fetching echo files for patient_id={patient_id}")

        # Fetch patient document
        patient_doc = await echo_collection.find_one({"patient_id": patient_id})

        if not patient_doc or "echo_files" not in patient_doc or not patient_doc["echo_files"]:
            raise HTTPException(
                status_code=404,
                detail=f"No echocardiogram files found for patient_id={patient_id}"
            )

        # Convert ObjectId and datetime to strings for JSON serialization
        echo_files_serializable = []
        for file in patient_doc["echo_files"]:
            file_copy = file.copy()
            if "_id" in file_copy:
                file_copy["_id"] = str(file_copy["_id"])
            if "timestamp" in file_copy and isinstance(file_copy["timestamp"], datetime):
                file_copy["timestamp"] = file_copy["timestamp"].isoformat()
            if "created_at" in file_copy and isinstance(file_copy["created_at"], datetime):
                file_copy["created_at"] = file_copy["created_at"].isoformat()
            echo_files_serializable.append(file_copy)

        return JSONResponse(
            status_code=200,
            content={
                "status": "success",
                "count": len(echo_files_serializable),
                "data": echo_files_serializable
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Failed to retrieve echo files: {e}")






import httpx
from typing import List
import os

from fastapi import UploadFile, File
import httpx

WSI_UPLOAD_URL = "http://143.110.187.180:8010/api/upload"  # WSI server endpoint

@router.post("/hms/dicom/upload-to-wsi")
async def upload_to_wsi(file: UploadFile = File(...)):

    # Read file content
    content = await file.read()

    # HTTPX strict multipart format
    files = {
        "file": (
            file.filename,
            content,
            file.content_type or "application/octet-stream"
        )
    }

    WSI_URL = "http://143.110.187.180:8010/api/upload"

    try:
        async with httpx.AsyncClient(timeout=300) as client:
            res = await client.post(WSI_URL, files=files)

        # Try decode JSON (if server returns text)
        try:
            msg = res.json()
        except:
            msg = res.text

        if res.status_code != 200:
            return {
                "error": "WSI server upload failed",
                "status": res.status_code,
                "msg": msg
            }

        return {
            "success": True,
            "response": msg
        }

    except Exception as e:
        return {"error": "Upload failed", "details": str(e)}






@router.post("/upload-echo-to-panecho")
async def upload_echo_to_panecho(file: UploadFile = File(...)):
    """
    Upload an echo file (video/PDF) to PanEcho inference API
    at http://143.110.187.180:9010/infer.
    """
    try:
        # Read file content
        content = await file.read()

        # Prepare strict multipart request (httpx compatible)
        files = {
            "file": (
                file.filename,
                content,
                file.content_type or "application/octet-stream"
            )
        }

        PANECHO_URL = "http://143.110.187.180:9010/infer"

        # Make the POST request
        async with httpx.AsyncClient(timeout=300) as client:
            response = await client.post(PANECHO_URL, files=files)

        # Parse JSON or fallback to text
        try:
            result = response.json()
        except:
            result = {"raw_response": response.text}

        # Check status
        if response.status_code != 200:
            return JSONResponse(
                status_code=response.status_code,
                content={
                    "error": "PanEcho inference failed",
                    "status": response.status_code,
                    "response": result
                }
            )

        # Success
        return JSONResponse(
            status_code=200,
            content={
                "success": True,
                "message": "Echo uploaded to PanEcho successfully",
                "response": result
            }
        )

    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": "Upload to PanEcho failed", "details": str(e)}
        )


@router.post("/analyze_echo_llm")
async def analyze_echo_llm(echo_data: dict):
    try:
        prompt = f"""
You are an expert echocardiography cardiologist. Analyze the following PanEcho measurement JSON and produce a structured clinical interpretation.

### INPUT ECHO DATA (JSON):
{json.dumps(echo_data, indent=2)}

### TASK:
Interpret the measurements and generate a clinically meaningful summary.

### RULES:
1. **EVERY item must be a complete sentence**, ending with a period.
2. Use only the provided echo values. Do not invent data.
3. Keep all explanations clinically accurate and concise.
4. Output JSON only — no commentary, no markdown, no extra text.

### REQUIRED JSON OUTPUT FORMAT:
{{
  "findings": "One paragraph summary, 2–4 complete sentences.",
  "abnormalities": [
    "Each abnormality must be a full sentence.",
    "List only true abnormalities based on echo data."
  ],
  "recommendations": [
    "Each recommendation must be a full sentence.",
    "Provide 3–6 practical clinical recommendations."
  ],
  "diagnosis": "One complete diagnostic sentence."
}}

### IMPORTANT:
- Do NOT include any values inside arrays. Only sentences.
- Do NOT return escaped strings. Return clean JSON.
- Do NOT return tuple, markdown or code fences.
- Output must be a valid JSON object.
"""

        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            response_format={"type": "json_object"},
            max_tokens=1200
        )

        llm_json = completion.choices[0].message.content

        try:
            parsed = json.loads(llm_json)
        except json.JSONDecodeError:
            logger.error(f"Invalid JSON from LLM: {llm_json}")
            raise HTTPException(status_code=500, detail="LLM returned invalid JSON")

        logger.info("✅ LLM echo report generated")
        return parsed

    except Exception as e:
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"LLM echo interpretation failed: {e}")







from fastapi import UploadFile, File, HTTPException, APIRouter
import httpx
from pathlib import Path   # <--- Make sure this is here
import logging
import tempfile 
SERVER_B_URL = "http://143.110.187.180:8010/api/upload"

@router.post("/forward-upload")
async def forward_upload(file: UploadFile = File(...)):
    """
    Receive a file on Server A and forward it to Server B.
    Handles large files safely by streaming via a temporary file.
    """
    filename = Path(file.filename).name
    content_type = file.content_type or "application/octet-stream"

    # Write upload to a temporary file
    try:
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            tmp_path = tmp.name
            await file.seek(0)
            while chunk := await file.read(8192):
                tmp.write(chunk)
    except Exception as e:
        logger.error(f"Failed to save temporary file: {e}")
        raise HTTPException(status_code=500, detail="Failed to save uploaded file")

    # Forward to Server B using a standard file object
    try:
        with open(tmp_path, "rb") as f:
            files = {"file": (filename, f, content_type)}
            async with httpx.AsyncClient(timeout=120) as client:
                response = await client.post(SERVER_B_URL, files=files)
    except httpx.RequestError as e:
        logger.error(f"Request to Server B failed: {e}")
        raise HTTPException(status_code=500, detail=f"Server B request failed: {e}")
    finally:
        # Clean up temporary file
        try:
            os.remove(tmp_path)
        except Exception:
            pass

    if response.status_code != 200:
        logger.error(f"Server B returned {response.status_code}: {response.text}")
        raise HTTPException(
            status_code=response.status_code,
            detail=f"Server B returned error: {response.text}"
        )

    return response.json()



import httpx
from fastapi import UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from pathlib import Path
from datetime import datetime

WSI_UPLOAD_URL_8010 = "http://143.110.187.180:8050/api/upload"
WSI_META_BY_NAME_URL = "http://143.110.187.180:8010/api/meta-by-name"

@router.post("/upload-pathology")
async def upload_pathology(
    file: UploadFile = File(...),
    patient_id: str = Form(...),
    doctor_id: str = Form(...),
    pathology_type: str = Form(...)
):
    # Validate type
    valid_types = ["cyto", "biopsy", "histo"]
    if pathology_type not in valid_types:
        raise HTTPException(status_code=400, detail="Invalid pathology type. Allowed: cyto, biopsy, histo")

    allowed_extensions = [
        ".svs", ".tif", ".tiff", ".ndpi", ".scn",
        ".mrxs", ".bif", ".czi", ".dcm", ".vms",
        ".vmu", ".svslide", ".png"
    ]

    filename = Path(file.filename).name
    lower_name = filename.lower()

    logger.info(f"📥 upload_pathology filename={filename}, type={pathology_type}, patient_id={patient_id}")

    if not any(lower_name.endswith(ext) for ext in allowed_extensions):
        raise HTTPException(status_code=400, detail="Invalid pathology file format")

    try:
        # Read bytes
        content = await file.read()

        # Upload to WSI backend
        files = {"file": (filename, content, file.content_type or "application/octet-stream")}

        async with httpx.AsyncClient(timeout=300) as client:
            upload_res = await client.post(WSI_UPLOAD_URL_8010, files=files)

        upload_json = upload_res.json()
        if upload_res.status_code != 200:
            raise HTTPException(status_code=500, detail=upload_json)

        slide_filename = upload_json.get("filename")
        if not slide_filename:
            raise HTTPException(status_code=500, detail="WSI JSON missing filename")

        # Fetch metadata for ID
        async with httpx.AsyncClient(timeout=60) as client:
            meta = await client.get(f"{WSI_META_BY_NAME_URL}/{slide_filename}")

        meta_json = meta.json()
        pathology_id = meta_json.get("id")

        if not pathology_id:
            raise HTTPException(status_code=500, detail="WSI meta missing id")

        # -----------------------------
        # SAVE LIKE DICOM STRUCTURE
        # -----------------------------

        entry = {
            "pathology_id": pathology_id,
            "uploaded_at": datetime.utcnow(),
            "files": [slide_filename],
            "doctor_id": doctor_id
        }

        # Initialize patient if not exists
        await pathology_collection.update_one(
            {"patient_id": patient_id},
            {"$setOnInsert": {"patient_id": patient_id}},
            upsert=True
        )

        # Ensure pathology.<type> exists
        await pathology_collection.update_one(
            {"patient_id": patient_id, f"pathology.{pathology_type}": {"$exists": False}},
            {"$set": {f"pathology.{pathology_type}": []}}
        )

        # Push new entry
        await pathology_collection.update_one(
            {"patient_id": patient_id},
            {"$push": {f"pathology.{pathology_type}": entry}}
        )

        return {
            "success": True,
            "patient_id": patient_id,
            "pathology_type": pathology_type,
            "filename": slide_filename,
            "pathology_id": pathology_id
        }

    except Exception as e:
        logger.error("❌ Pathology upload failed", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))



@router.get("/get-pathology/{patient_id}")
async def get_pathology_by_patient(patient_id: str):
    """
    Retrieve all pathology entries for a given patient_id.
    """
    try:
        record = await pathology_collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0}  # hide MongoDB ObjectId
        )

        if not record:
            raise HTTPException(
                status_code=404,
                detail=f"No pathology records found for patient_id={patient_id}"
            )

        # Convert datetime → ISO string for frontend safety
        for entry in record.get("pathology", []):
            if "created_at" in entry and isinstance(entry["created_at"], datetime):
                entry["created_at"] = entry["created_at"].isoformat()

        return JSONResponse(
            status_code=200,
            content={
                "success": True,
                "patient_id": patient_id,
                "count": len(record.get("pathology", [])),
                "data": record.get("pathology", [])
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("❌ Failed to retrieve pathology", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve pathology: {e}"
        )

@router.get("/get-pathology/{patient_id}/{type}")
async def get_pathology(
    patient_id: str,
    type: str
):
    """
    Retrieve pathology entries using:
    /get-pathology/{patient_id}/{type}

    type = cyto | histo | biopsy
    """
    try:
        valid_types = ["cyto", "histo", "biopsy"]

        if type not in valid_types:
            raise HTTPException(
                status_code=400,
                detail="Invalid pathology type. Allowed: cyto, histo, biopsy"
            )

        # Fetch pathology document
        record = await pathology_collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0}
        )

        if not record or "pathology" not in record:
            raise HTTPException(
                status_code=404,
                detail=f"No pathology records found for patient_id={patient_id}"
            )

        # Get ONLY the requested type
        entries = record["pathology"].get(type, [])

        # Convert datetime → ISO
        for e in entries:
            if "uploaded_at" in e and isinstance(e["uploaded_at"], datetime):
                e["uploaded_at"] = e["uploaded_at"].isoformat()

        return {
            "success": True,
            "patient_id": patient_id,
            "pathology_type": type,
            "count": len(entries),
            "data": entries
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("❌ Error retrieving pathology", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve pathology: {e}"
        )
