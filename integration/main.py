from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, WebSocket, status, File, Form, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse, FileResponse
# from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field, EmailStr, validator
from typing import Any, Dict, List, Optional, Union
from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, date, timedelta
from bson import ObjectId
from enum import Enum
import logging
import random
import string
import sys
import pytz
import socket
import platform
import httpx
import asyncio
import json
import queue
import threading
from passlib.context import CryptContext
from functools import wraps, partial
import uuid
import os
import aiofiles
import shutil
import re
import copy
import traceback
from PIL import Image
import fitz  # PyMuPDF
import pytesseract
import PyPDF2
from groq import Groq
from fastapi import Query
from typing import Optional
from fastapi import Response
from jose import jwt, JWTError
from datetime import datetime, timedelta
from shared.audit.client import AuditClient
from .integration import router as integration_router
from .patient_app.routes import router as patient_app_router
from .patient_app.routes_doctor import router as patient_app_doctor_router
from .patient_app.db import ensure_indexes as patient_app_ensure_indexes
from .mact.routes import router as mact_router
from .mact.db import ensure_indexes as mact_ensure_indexes
from .mact.seed import seed_samples as mact_seed_samples
from fastapi.middleware.cors import CORSMiddleware

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
ACCESS_TOKEN_EXPIRE_DAYS = os.getenv("ACCESS_TOKEN_EXPIRE_DAYS")

api_key = os.getenv("GROQ_API_KEY")

groq_client = Groq(api_key=api_key)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "healthy",
            "service": "integration",
            "timestamp": datetime.now().isoformat()}

@app.on_event("startup")
def startup_event():
    app.state.audit = AuditClient(
        os.getenv("RABBITMQ_URL")
    )

# Separate handler (not merged into the sync one above) so a slow/failed
# Mongo connection for patient_app indexes never blocks or breaks audit-client
# startup for the rest of the integration service. ensure_indexes() itself
# never raises — failures are logged and patient routes return 503 until
# Mongo is reachable (see patient_app/db.py).
@app.on_event("startup")
async def patient_app_startup_event():
    await patient_app_ensure_indexes()


@app.on_event("startup")
async def mact_startup_event():
    await mact_ensure_indexes()
    await mact_seed_samples()

app.include_router(integration_router)
app.include_router(patient_app_router)
app.include_router(patient_app_doctor_router)
app.include_router(mact_router)