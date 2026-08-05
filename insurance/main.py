from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, Request, WebSocket, status, File, Form, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse, FileResponse
from pydantic import BaseModel, Field, EmailStr, validator
from typing import Any, Dict, List, Optional, Union
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
from typing import Optional
from fastapi import Query, Response
from jose import jwt, JWTError
from datetime import datetime, timedelta

from routes.insurance_dashboard import router as insurance_dashboard_router, ensure_indexes
from routes.users_routes import router as users_router
from routes.insurance_app import router as insurance_app_router
from routes.insurance_app_2 import router as insurance_app_router_2
from routes.qc_review import router as qc_review
from routes.doctor_review import router as doctor_review_router
from routes.evidence_vault import router as evidence_router
from routes.auditing_doctor import router as auditing_doctor_new_router
# ── NEW ──────────────────────────────────────────────────────────────────────
from routes.case_documents_router import router as case_docs_router, ensure_case_doc_indexes
from routes.conclusion import router as conclusion_router

logger = logging.getLogger("uvicorn.error")

SECRET_KEY               = os.getenv("SECRET_KEY")
ALGORITHM                = os.getenv("ALGORITHM")
ACCESS_TOKEN_EXPIRE_DAYS = os.getenv("ACCESS_TOKEN_EXPIRE_DAYS")

api_key     = os.getenv("GROQ_API_KEY")
groq_client = Groq(api_key=api_key)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ensure_indexes()
    await ensure_case_doc_indexes()
    task = asyncio.create_task(auto_expire_availability())
    task.add_done_callback(_log_task_crash)
    yield


def _log_task_crash(task: asyncio.Task):
    # Runs only if the task ever exits (it shouldn't, thanks to the
    # try/except inside the loop) — makes sure a crash is loud instead
    # of silently surfacing later as "Task exception was never retrieved".
    if task.cancelled():
        return
    exc = task.exception()
    if exc:
        logger.error("auto_expire_availability crashed", exc_info=exc)


async def auto_expire_availability():
    motor = AsyncIOMotorClient(
        os.getenv("MONGO_URI"),
        serverSelectionTimeoutMS=5000,   # fail fast instead of hanging 20-30s
    )
    col = motor["doctorassistai"]["field_officer_availability"]
    while True:
        try:
            now_str = datetime.now().strftime("%H:%M")
            result = await col.update_many(
                {"status": "Available", "availableTo": {"$lt": now_str}},
                {"$set": {"status": "Unavailable", "lastUpdated": datetime.utcnow()}}
            )
            if result.modified_count:
                print(f"[auto_expire] Marked {result.modified_count} officers Unavailable")
        except Exception as e:
            logger.error(f"[auto_expire] update_many failed: {e!r}")
        await asyncio.sleep(300)

app = FastAPI(lifespan=lifespan)

app.include_router(users_router)
app.include_router(insurance_dashboard_router)
app.include_router(insurance_app_router)
app.include_router(insurance_app_router_2)
app.include_router(evidence_router)
app.include_router(doctor_review_router, prefix="/app")
app.include_router(qc_review, prefix="/app")
app.include_router(case_docs_router)   # ← NEW
app.include_router(auditing_doctor_new_router)   # ← NEW
app.include_router(conclusion_router)

@app.get("/health")
def health():
    return {"status": "healthy"}

@app.get("/debug/routes")
async def debug_routes():
    routes_list = []
    for route in app.routes:
        routes_list.append({
            "path": route.path,
            "method": list(route.methods)[0] if route.methods else "ANY",
            "name": route.name if hasattr(route, 'name') else None
        })
    return {
        "total_routes": len(routes_list),
        "routes": routes_list
    }