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
from fastapi.encoders import jsonable_encoder
from fastapi import APIRouter, HTTPException, Request
from datetime import datetime
SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
ACCESS_TOKEN_EXPIRE_DAYS = os.getenv("ACCESS_TOKEN_EXPIRE_DAYS")

api_key = os.getenv("GROQ_API_KEY")

groq_client = Groq(api_key=api_key)



router = APIRouter(
    prefix="",
    tags=["doctor"],
    responses={404: {"description": "Not found"}},
)



# templates = Jinja2Templates(directory="templates")
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
stream_handler = logging.StreamHandler(sys.stdout)
log_formatter = logging.Formatter("%(asctime)s [%(processName)s: %(process)d] [%(threadName)s: %(thread)d] [%(levelname)s] %(name)s: %(message)s")
stream_handler.setFormatter(log_formatter)
logger.addHandler(stream_handler)

logger.info('API is starting up')



#######################################################################HEADER OF FILE ########################################################################################


MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"
NODES_DB = "doctorassistai_nodes"

mongodb_client = AsyncIOMotorClient(MONGO_URI)  # async (Motor)
database = mongodb_client[MONGO_DB]

client = MongoClient(MONGO_URI)  # sync (PyMongo)
db = client[MONGO_DB]

nodes_database = mongodb_client[NODES_DB]        # async nodes db
nodes_db = client[NODES_DB]                 # sync nodes db

conversation_collection = nodes_database["conversations"]
quicknotecollection = db["quick_note"]
@router.post("/conversation/savew")
async def save_conversation(request: Request):
    """
    Save conversation for a patient.
    Payload example:
    {
        "patient_id": "patient_123",
        "message": {
            "text": "Patient reports mild cough and fever",
            "sender": "doctor"
        }
    }
    """
    data = await request.json()

    patient_id = data.get("patient_id")
    message = data.get("message")

    if not patient_id or not message or not message.get("text"):
        raise HTTPException(status_code=400, detail="patient_id and message.text are required")

    # Add timestamp if not provided
    if "timestamp" not in message:
        message["timestamp"] = datetime.utcnow()

    # Check if conversation exists
    existing = await conversation_collection.find_one({"patient_id": patient_id})

    if existing:
        # Append new message
        result = await conversation_collection.update_one(
            {"patient_id": patient_id},
            {"$push": {"messages": message}}
        )
        if result.modified_count == 1:
            return {"status": "success", "message": "Message appended"}
        else:
            raise HTTPException(status_code=500, detail="Failed to append message")
    else:
        # Create new conversation document
        doc = {
            "patient_id": patient_id,
            "messages": [message],
            "created_at": datetime.utcnow(),
        }
        result = await conversation_collection.insert_one(doc)
        if result.inserted_id:
            return {"status": "success", "message": "Conversation created"}
        else:
            raise HTTPException(status_code=500, detail="Failed to create conversation")
        
        
        
        


def merge_notes(existing_notes: List[Dict[str, Any]], new_notes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    next_si_no = len(existing_notes) + 1
    for note in new_notes:
        note["si_no"] = next_si_no
        next_si_no += 1
    existing_notes.extend(new_notes)
    return existing_notes


# --- Request Model ---
class QuickNoteRequest(BaseModel):
    patient_id: str
    doctor_id: str
    text: str
    priority: str  # Critical, Medium, Normal


# --- POST /quick_notes ---
@router.post("/quick_notes")
async def quick_notes(request: QuickNoteRequest):
    """
    Append the typed or dictated text to the corresponding priority group.
    """
    try:
        if not request.text.strip():
            raise HTTPException(status_code=400, detail="Quick Note text is empty.")
        if request.priority not in ["Critical", "Medium", "Normal"]:
            raise HTTPException(status_code=400, detail="Invalid priority. Must be Critical, Medium, or Normal.")

        query = {"patient_id": request.patient_id, "doctor_id": request.doctor_id}
        existing_doc = quicknotecollection.find_one(query)
        new_note = {"note": request.text.strip()}

        if existing_doc:
            existing_suggestions = existing_doc.get(request.priority, {}).get("suggestions", [])
            merged = merge_notes(existing_suggestions, [new_note])
            existing_doc[request.priority] = {"suggestions": merged}
            existing_doc["updated_at"] = datetime.utcnow()
            result =  quicknotecollection.update_one(query, {"$set": existing_doc})
            db_status = "updated" if result.modified_count else "no_change"
        else:
            new_entry = {
                "patient_id": request.patient_id,
                "doctor_id": request.doctor_id,
                "Critical": {"suggestions": []},
                "Medium": {"suggestions": []},
                "Normal": {"suggestions": []},
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow()
            }
            new_entry[request.priority]["suggestions"].append({"si_no": 1, "note": request.text.strip()})
            quicknotecollection.insert_one(new_entry)
            db_status = "inserted"

        return {"status": "success", "database_action": db_status}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Unhandled error in quick_notes: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
    
    
@router.get("/get_quick_notes")
async def get_quick_notes(patient_id: str, doctor_id: str):
    """
    Retrieve all Quick Notes for a given patient_id and doctor_id.
    """
    try:
        query = {"patient_id": patient_id, "doctor_id": doctor_id}
        doc = quicknotecollection.find_one(query)

        if not doc:
            raise HTTPException(status_code=404, detail=f"No quick notes found for patient {patient_id} and doctor {doctor_id}.")

        # Remove MongoDB internal fields
        doc.pop("_id", None)

        return {
            "status": "success",
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "quick_notes": doc
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error retrieving quick notes: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

class QuickNoteDeleteRequest(BaseModel):
    patient_id: str = Field(..., description="Unique patient identifier")
    doctor_id: str = Field(..., description="Unique doctor identifier")
    priority: str = Field(..., description="Priority section: Critical, Medium, or Normal")
    si_no: int = Field(..., description="Serial number of the note to delete")

@router.post("/delete_quick_note")
async def delete_quick_note(request: QuickNoteDeleteRequest):
    """
    Delete a specific Quick Note (by si_no and priority) for a given patient and doctor.
    Uses MongoDB $pull for efficiency — no Python-side looping.
    """
    try:
        query = {"patient_id": request.patient_id, "doctor_id": request.doctor_id}
        priority_field = f"{request.priority}.suggestions"

        # Attempt to remove the note directly from MongoDB array
        update_result =  quicknotecollection.update_one(
            query,
            {
                "$pull": {priority_field: {"si_no": int(request.si_no)}},
                "$set": {"updated_at": datetime.utcnow()}
            }
        )

        if update_result.modified_count == 0:
            raise HTTPException(status_code=404, detail=f"No note found with si_no={request.si_no} under {request.priority}.")

        return {
            "status": "success",
            "message": f"Note #{request.si_no} deleted successfully from {request.priority} notes."
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error deleting quick note: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")