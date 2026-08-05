from fastapi import FastAPI, Request
from .patient_data.data import router as patient_data_router
from .patient_data.watsapp import router as watsapp_router
from .patient_data.patientcontext import router as patientcontext_router
from .patient_data.surgical_oncology import router as surgical_router
from users.integration.integration_data import router as integration_router
from .patient_data.palliative_assessment_api import router as palliative_router
from .patient_data.protocol_master import router as protocol_master_router
from .patient_data.Radiotherapy_protocol_master import router as radiotherapy_protocol_master_router
from .patient_data.anaesthesia import router as anaesthesia_router
from .patient_data.onco_pathology import router as oncopatho_router

from .scheduler import router as scheduler_router
from fastapi.staticfiles import StaticFiles
import os
from fastapi.middleware.cors import CORSMiddleware

from fastapi import FastAPI, Path, HTTPException
from fastapi.responses import FileResponse
import os, mimetypes

app = FastAPI()

UPLOAD_DIR = "/root/AiEngine/4.1.7_beta/DoctorAssist-AiEngine/users/patient_data/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
# Mount the folder at /uploads URL
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")



@app.get("/view/{file_path:path}")
async def view_file(file_path: str = Path(...)):
    full_path = os.path.join(UPLOAD_DIR, file_path)
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="File not found")
    
    media_type, _ = mimetypes.guess_type(full_path)
    media_type = media_type or "application/octet-stream"
    return FileResponse(full_path, media_type=media_type)

@app.get("/")
def root():
    return {"message": "Access uploaded files at /uploads/<filename>"}

app.include_router(patient_data_router)
app.include_router(watsapp_router)
app.include_router(integration_router)
app.include_router(patientcontext_router)
app.include_router(scheduler_router)
app.include_router(surgical_router)
app.include_router(palliative_router)   # ← ADD THIS
app.include_router(protocol_master_router)
app.include_router(radiotherapy_protocol_master_router)
app.include_router(anaesthesia_router)
app.include_router(oncopatho_router)

@app.get("/health")
def health():
    return {"status": "healthy"}