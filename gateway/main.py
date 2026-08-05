from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import requests
import logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    force=True,
)
from fastapi import FastAPI, Request, HTTPException, WebSocket, WebSocketDisconnect,File,UploadFile,Depends,status,Form
import sys
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from typing import List
# import llama3_inference
import os
from groq import Groq
from dotenv import load_dotenv
import requests
import httpx
import shutil
import uuid
from pymongo import MongoClient
import datetime
from fastapi_login import LoginManager
import logging
from fastapi import APIRouter, Request, HTTPException, status
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
import logging
from pymongo import MongoClient
from datetime import datetime as dt, timedelta
import random
import string
import sys
from typing import Optional, Dict, Any
from functools import wraps
from bson import ObjectId # Crucial for handling MongoDB _id

import uuid
from datetime import datetime
import socket
import platform
import pytz
from fastapi import Query, HTTPException, Request
from bson import ObjectId
from fastapi.middleware.cors import CORSMiddleware

from .routes.login import router as login_router
from .middlewares.trace import trace_middleware
from shared.audit.client import AuditClient

from .routes.doctor import router as doctor_router
from .routes.hospital import router as hospital_router
from .routes.customercare import router as customercare_router
from .routes.patient import router as patient_router
from .routes.orchestration import router as orchestration_router
from .routes.speciality import router as speciality_router
from .routes.users import router as users_router
from .routes.asseration import router as asseration_router
from .routes.emergencypatientregistration import router as emergency_patient_router
from .routes.ambulancedriverregistration import router as ambulance_register_router
from .routes.upload import router as upload_router
load_dotenv()
from .routes.admin import router as admin_router
from .routes.audit_service import router as audit_service_router
from .routes.ai_service import router as ai_service_router
from .routes.workflow_Engine import router as workflow_engine_router
# from .routes.appointment import router as appointment_router
# from .routes.livelogs import router as livelogs_router
from .routes.integration import router as integration_router
from .routes.common import router as common_router  
#from .routes.agentic import router as agentic_router
from .routes.agentic import router as agentic_router
from .routes.abha import router as abha_router
from .routes.insurance_route import router as insurance_router




app = FastAPI()

# --- Include Routers Here ---
app.include_router(login_router)
app.include_router(doctor_router)
app.include_router(hospital_router)
app.include_router(customercare_router)
app.include_router(patient_router)
app.include_router(emergency_patient_router)
app.include_router(ambulance_register_router)
app.include_router(orchestration_router)
app.include_router(speciality_router)
app.include_router(users_router)
app.include_router(asseration_router)
app.include_router(upload_router)
app.include_router(admin_router)
app.include_router(audit_service_router)
app.include_router(ai_service_router)
app.include_router(workflow_engine_router)
# app.include_router(appointment_router)
# app.include_router(livelogs_router)
app.include_router(integration_router)
app.include_router(common_router)
#app.include_router(agentic_router)
app.include_router(agentic_router)
app.include_router(abha_router)
app.include_router(insurance_router)


# -----------------------------
app.middleware("http")(trace_middleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "https://doctorassist.ai",
        "https://dill-molecular-serrated.ngrok-free.dev",
        
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
MONGO_URI = os.getenv("MONGO_URI")
# MONGO_DB = os.getenv("MONGO_DB")

client = MongoClient(MONGO_URI)
db = client["doctorassistai"]

collection_users_hms = db["hms_users"]



@app.on_event("startup")
def startup_event():
    app.state.audit = AuditClient(
        os.getenv("RABBITMQ_URL")
    )

logger = logging.getLogger(__name__)

class LoginRequest(BaseModel):
    dr_username: str  # For staff/doctor: username; For patient: phone number
    dr_password: str  # For staff/doctor: password; For patient: HMS ID


from fastapi.responses import RedirectResponse

@app.get("/")
def home():
    return {
        "gateway": "DoctorAssist Gateway",
        "status": "Running"
    }

@app.get("/health")
def health():
    return {"status": "healthy"}
import os

# Get the absolute path to where main.py is located
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(CURRENT_DIR, "uploads")

# Create the directory if it doesn't exist
if not os.path.exists(UPLOAD_DIR):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    print(f"✅ Created uploads directory at: {UPLOAD_DIR}")
else:
    print(f"✅ Using existing uploads directory at: {UPLOAD_DIR}")

# Mount the static files directory
app.mount(
    "/uploads",
    StaticFiles(directory=UPLOAD_DIR),
    name="uploads"
)
# DEBUG: Endpoint to check where files are saved
@app.get("/debug-files")
async def debug_files():
    import os
    result = {}
    
    # Check multiple locations
    locations = [
        "./uploads/ambulance_images",
        "/gateway/uploads/ambulance_images",
        "/root/Project/ProjectRepo/4.1.7_beta/DoctorAssist-AiEngine/gateway/uploads/ambulance_images",
        "/tmp/ambulance_images"
    ]
    
    for loc in locations:
        if os.path.exists(loc):
            files = os.listdir(loc) if os.path.exists(loc) else []
            result[loc] = {"exists": True, "files": files[:5]}  # First 5 files
        else:
            result[loc] = {"exists": False}
    
    return result