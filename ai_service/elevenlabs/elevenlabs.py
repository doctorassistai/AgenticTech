import httpx
from typing import Dict, Any
from datetime import datetime, date, timedelta
import re
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, WebSocket, status, File, Form, UploadFile
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
from pathlib import Path
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
import requests
from groq import Groq
from fastapi import Query
from typing import Optional
from fastapi import Response
from jose import jwt, JWTError
from datetime import datetime, timedelta
from fastapi.encoders import jsonable_encoder
from elevenlabs import ElevenLabs
from elevenlabs.client import ElevenLabs
import os
import tempfile
from io import BytesIO
from fastapi import WebSocketDisconnect

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/elevenlabs",
    tags=["audio"],
    responses={404: {"description": "Not found"}},
)



#***************************************
#***********Elevenlabs start****************************
#***************************************


ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
client = ElevenLabs(api_key=ELEVENLABS_API_KEY)

# Configure audio upload directory
AUDIO_UPLOAD_DIR = os.path.join(tempfile.gettempdir(), "elevenlabs_audio")
os.makedirs(AUDIO_UPLOAD_DIR, exist_ok=True)
logger.info(f"Using audio directory: {AUDIO_UPLOAD_DIR}")


#Eleven labs start
# Store active ElevenLabs sessions
active_elevenlabs_sessions = {}

# ElevenLabs API Key - Store in environment variables for security
ELEVENLABS_API_KEY = "sk_af55a51c232b3a1483c8eaaf3d8e4fbe4a45ec35f46f5675"

@router.websocket("/ws/audio_elevenlabs")
async def websocket_endpoint_elevenlabs(websocket: WebSocket):
    connection_id = str(uuid.uuid4())
    
    try:
        await websocket.accept()
        logger.info(f"WebSocket connection accepted for ElevenLabs: {connection_id}")
        
        client = ElevenLabs(api_key=ELEVENLABS_API_KEY)
        
        # Use asyncio Queue for thread-safe audio processing
        audio_queue = asyncio.Queue(maxsize=100)  # Limit queue size
        
        active_elevenlabs_sessions[connection_id] = {
            "client_websocket": websocket,
            "is_connected": True,
            "client": client,
            "audio_queue": audio_queue
        }
        
        await websocket.send_json({
            "status": "connected",
            "message": "Connected to ElevenLabs transcription service"
        })
        
        # Start consumer task
        consumer_task = asyncio.create_task(
            audio_consumer(connection_id, audio_queue)
        )
        
        # Producer: receive audio and put in queue
        try:
            async for audio_data in websocket.iter_bytes():
                try:
                    # Non-blocking put with timeout
                    await asyncio.wait_for(
                        audio_queue.put(audio_data),
                        timeout=1.0
                    )
                except asyncio.TimeoutError:
                    logger.warning(f"Audio queue full for {connection_id}")
                    await websocket.send_json({
                        "warning": "Processing backlog, dropping audio"
                    })
                    
        except WebSocketDisconnect:
            logger.info(f"Client disconnected: {connection_id}")
            
    except Exception as e:
        logger.error(f"Error in ElevenLabs WebSocket: {str(e)}")
    finally:
        # Cleanup
        if 'consumer_task' in locals():
            consumer_task.cancel()
        await cleanup_elevenlabs_connection(connection_id)

async def audio_consumer(connection_id, audio_queue):
    """Consume audio from queue and process"""
    accumulated_audio = BytesIO()
    
    while connection_id in active_elevenlabs_sessions:
        try:
            # Wait for audio with timeout
            try:
                audio_chunk = await asyncio.wait_for(
                    audio_queue.get(),
                    timeout=1.0
                )
                accumulated_audio.write(audio_chunk)
                
                # Process when we have enough data
                if accumulated_audio.tell() >= 16384:
                    await process_accumulated_audio(connection_id, accumulated_audio)
                    accumulated_audio = BytesIO()  # Reset
                    
            except asyncio.TimeoutError:
                # Process any remaining audio
                if accumulated_audio.tell() > 0:
                    await process_accumulated_audio(connection_id, accumulated_audio)
                    accumulated_audio = BytesIO()
                continue
                
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Error in audio consumer: {str(e)}")
async def process_elevenlabs_audio(connection_id):
    """Process audio data with ElevenLabs API"""
    if connection_id not in active_elevenlabs_sessions:
        logger.error(f"Connection {connection_id} not found in active sessions")
        return
    
    session = active_elevenlabs_sessions[connection_id]
    
    try:
        # Get audio data from buffer
        audio_buffer = session["audio_buffer"]
        audio_buffer.seek(0)  # Reset position to beginning of buffer
        audio_data = audio_buffer.getvalue()
        
        # Reset buffer for next chunk
        session["audio_buffer"] = BytesIO()
        
        # Create a new BytesIO object for ElevenLabs API
        audio_file = BytesIO(audio_data)
        
        # Call ElevenLabs API for transcription
        transcription = session["client"].speech_to_text.convert(
            file=audio_file,
            model_id="scribe_v1",
            tag_audio_events=False,
            language_code="eng",
            diarize=False,
        )
        
        # Extract transcription text
        if transcription and "text" in transcription:
            # Send partial transcription to client
            await session["client_websocket"].send_json({
                "type": "partial",
                "text": transcription["text"]
            })
            
            # If we have word timing, use it to determine if this is a final segment
            is_final = False
            if "words" in transcription and transcription["words"]:
                # Consider it final if there's a longer pause at the end
                last_word = transcription["words"][-1]
                if "end" in last_word and last_word.get("type") == "word":
                    is_final = True
            
            # Send final transcription when appropriate
            if is_final:
                await session["client_websocket"].send_json({
                    "type": "final",
                    "text": transcription["text"]
                })
        
    except Exception as e:
        logger.error(f"Error processing ElevenLabs audio: {str(e)}")
        try:
            await session["client_websocket"].send_json({
                "error": str(e),
                "type": "error",
                "message": "Error processing audio with ElevenLabs"
            })
        except:
            logger.error("Failed to send error to client")

async def cleanup_elevenlabs_connection(connection_id):
    """Clean up resources associated with an ElevenLabs connection"""
    if connection_id in active_elevenlabs_sessions:
        logger.info(f"Cleaning up ElevenLabs connection: {connection_id}")
        
        try:
            # Mark connection as inactive
            active_elevenlabs_sessions[connection_id]["is_connected"] = False
            
            # Close client websocket if still open
            websocket = active_elevenlabs_sessions[connection_id]["client_websocket"]
            if websocket and not websocket.client_state.disconnected:
                await websocket.close(code=1000)
        except Exception as e:
            logger.error(f"Error during ElevenLabs cleanup: {str(e)}")
        
        # Remove from active sessions
        del active_elevenlabs_sessions[connection_id]
        logger.info(f"Removed ElevenLabs session {connection_id}")


#Eleven labs ends

#Eleven labs new start

# app.mount("/static", StaticFiles(directory="static"), name="static")x

# Initialize ElevenLabs client
ELEVENLABS_API_KEY = "sk_af55a51c232b3a1483c8eaaf3d8e4fbe4a45ec35f46f5675"
client = ElevenLabs(api_key=ELEVENLABS_API_KEY)

# Configure audio upload directory - MODIFIED TO USE TEMP DIR
AUDIO_UPLOAD_DIR = os.path.join(tempfile.gettempdir(), "elevenlabs_audio")
os.makedirs(AUDIO_UPLOAD_DIR, exist_ok=True)
logger.info(f"Using audio directory: {AUDIO_UPLOAD_DIR}")


@router.post("/api/transcribe_labs")
async def transcribe_audio(
    file: UploadFile = File(...),
    language_code: str = Form("eng")
):
    file_path = None
    temp_file = None
    
    try:
        # Log request details
        logger.info(f"Received transcription request: filename={file.filename}, language={language_code}")
        logger.info(f"File content type: {file.content_type}")
        
        # Generate a unique filename
        filename = f"{uuid.uuid4()}.wav"
        file_path = os.path.join(AUDIO_UPLOAD_DIR, filename)
        logger.info(f"Generated temporary file path: {file_path}")
        
        # Save the uploaded file temporarily - using a safer approach with tempfile first
        try:
            # Create a temporary file first
            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.wav')
            temp_path = temp_file.name
            temp_file.close()  # Close the file so we can write to it
            
            logger.info(f"Created temporary file at: {temp_path}")
            
            # Write the uploaded file to the temporary file
            file_size = 0
            with open(temp_path, "wb") as buffer:
                # Read and write in chunks to avoid memory issues with large files
                chunk = await file.read(1024)
                while chunk:
                    file_size += len(chunk)
                    buffer.write(chunk)
                    chunk = await file.read(1024)
            
            logger.info(f"Saved audio to temporary file: {temp_path}, size: {file_size} bytes")
            
            # Or just use the temp file directly
            file_path = temp_path
            
        except Exception as e:
            logger.error(f"Error saving file: {str(e)}")
            raise Exception(f"Error saving file: {str(e)}")
        
        # Validate language code
        valid_languages = ["eng", "ara", "hin", "mal"]
        if language_code not in valid_languages:
            logger.warning(f"Invalid language code: {language_code}, defaulting to 'eng'")
            language_code = "eng"  # Default to English if invalid
        
        # Verify file exists and is readable
        if not os.path.exists(file_path):
            logger.error(f"File not found at path: {file_path}")
            raise Exception("Saved file not found")
            
        if os.path.getsize(file_path) == 0:
            logger.error(f"File is empty: {file_path}")
            raise Exception("Audio file is empty")
        
        # Log file details before processing
        file_stats = os.stat(file_path)
        logger.info(f"File stats - Size: {file_stats.st_size} bytes, Permissions: {oct(file_stats.st_mode)}")
        
        # Process with ElevenLabs
        logger.info(f"Sending file to ElevenLabs for transcription: model=scribe_v1, language={language_code}")
        
        try:
            with open(file_path, "rb") as audio_file:
                # Get file size for logging
                audio_file.seek(0, os.SEEK_END)
                size = audio_file.tell()
                audio_file.seek(0)
                logger.info(f"Audio file size being sent to ElevenLabs: {size} bytes")
                
                # Perform the transcription
                transcription = client.speech_to_text.convert(
                    file=audio_file,
                    model_id="scribe_v1",
                    language_code=language_code,
                )
                
                # Get the text result
                logger.info("Transcription successful")
                transcribed_text = transcription.text
                logger.info(f"Transcribed text length: {len(transcribed_text)} characters")
                
                # Return the transcription
                logger.info("Returning transcription result")
                return {"text": transcribed_text, "language_code": language_code}
        except Exception as e:
            logger.error(f"Error during ElevenLabs transcription: {str(e)}")
            raise Exception(f"Error during transcription: {str(e)}")
    
    except Exception as e:
        # Log the full exception with traceback
        logger.error(f"Transcription failed: {str(e)}")
        
        # Check if it's an ElevenLabs API error
        if hasattr(e, 'response') and hasattr(e.response, 'text'):
            logger.error(f"ElevenLabs API error response: {e.response.text}")
        
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
    
    finally:
        # Clean up all temporary files
        try:
            if file_path and os.path.exists(file_path):
                os.remove(file_path)
                logger.info(f"Cleaned up file: {file_path}")
            
            if temp_file and temp_file.name and os.path.exists(temp_file.name):
                os.remove(temp_file.name)
                logger.info(f"Cleaned up temporary file: {temp_file.name}")
        except Exception as cleanup_error:
            logger.error(f"Error cleaning up files: {str(cleanup_error)}")









@router.post("/api/transcribe_with_diarization")
async def diarization_speech_text(
    file: UploadFile = File(...),
    language_code: str = Form("eng"),
    enable_speaker_diarization: bool = Form(True)
):
    """
    Transcribe audio with speaker diarization using ElevenLabs API.
    Always ensures the first speaker is identified as the doctor.
    """
    file_path = None
    temp_file = None
    
    try:
        # Log request details
        logger.info(f"Received diarization request: filename={file.filename}, language={language_code}, diarization={enable_speaker_diarization}")
        
        # FIXED: Correct language code mapping for ElevenLabs
        ELEVENLABS_LANGUAGE_MAP = {
            'eng': 'en',        # English
            'mal': 'malayalam', # Malayalam - CORRECTED
            'hin': 'hindi',     # Hindi - CORRECTED
            'ara': 'arabic',    # Arabic - CORRECTED
            'tam': 'tamil',     # Tamil - CORRECTED
            'kan': 'kannada'    # Kannada - CORRECTED
        }
        
        # Validate language code
        valid_languages = ["eng", "mal", "hin", "ara", "tam", "kan"]
        if language_code not in valid_languages:
            logger.warning(f"Invalid language code: {language_code}, defaulting to 'eng'")
            language_code = "eng"
        
        # Convert to ElevenLabs format
        elevenlabs_lang = ELEVENLABS_LANGUAGE_MAP.get(language_code, 'en')
        logger.info(f"Language mapping: {language_code} -> {elevenlabs_lang}")
        
        # Generate a unique filename and create temporary file
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.wav')
        temp_path = temp_file.name
        temp_file.close()
        
        logger.info(f"Created temporary file: {temp_path}")
        
        # Write the uploaded file to the temporary file
        file_size = 0
        with open(temp_path, "wb") as buffer:
            chunk = await file.read(1024)
            while chunk:
                file_size += len(chunk)
                buffer.write(chunk)
                chunk = await file.read(1024)
        
        logger.info(f"Saved audio file: {temp_path}, size: {file_size} bytes")
        
        # Verify file exists and is not empty
        if not os.path.exists(temp_path):
            raise Exception("Temporary file was not created properly")
            
        if os.path.getsize(temp_path) == 0:
            raise Exception("Audio file is empty")
        
        # FIXED: Use the ElevenLabs Python client instead of direct HTTP requests
        logger.info(f"Processing with ElevenLabs client: language={elevenlabs_lang}, diarization={enable_speaker_diarization}")
        
        try:
            with open(temp_path, "rb") as audio_file:
                # Use the ElevenLabs client directly for better reliability
                transcription = client.speech_to_text.convert(
                    file=audio_file,
                    model_id="scribe_v1",
                    language_code=elevenlabs_lang,
                    diarize=enable_speaker_diarization,
                    tag_audio_events=False  # ADDED: Disable audio events for cleaner results
                )
                
                logger.info(f"ElevenLabs transcription successful")
                logger.info(f"Transcription object type: {type(transcription)}")
                
                # FIXED: Handle both diarization and non-diarization responses properly
                if enable_speaker_diarization:
                    # Check if we have speaker segments in the response
                    if hasattr(transcription, 'segments') and transcription.segments:
                        logger.info(f"Processing {len(transcription.segments)} segments with diarization")
                        
                        # Extract segments with speaker information
                        segments = transcription.segments
                        
                        # Process segments to ensure first speaker is doctor
                        speakers = []
                        speaker_map = {}  # Maps ElevenLabs speaker IDs to our roles
                        speaker_roles = ["doctor", "patient", "supporter", "nurse"]  # Order matters
                        
                        for segment in segments:
                            speaker_id = getattr(segment, 'speaker', 'speaker_1')
                            text = getattr(segment, 'text', '').strip()
                            start_time = getattr(segment, 'start', 0)
                            end_time = getattr(segment, 'end', 0)
                            
                            if not text:
                                continue
                                
                            # If this is a new speaker, assign a role
                            if speaker_id not in speaker_map:
                                role_index = len(speaker_map)
                                if role_index < len(speaker_roles):
                                    speaker_map[speaker_id] = speaker_roles[role_index]
                                else:
                                    # If we have more than 4 speakers, alternate between patient and supporter
                                    speaker_map[speaker_id] = "patient" if role_index % 2 == 0 else "supporter"
                                
                                logger.info(f"Mapped speaker {speaker_id} to role: {speaker_map[speaker_id]}")
                            
                            # Find existing speaker entry or create new one
                            existing_speaker = next((s for s in speakers if s["speaker_tag"] == speaker_id), None)
                            
                            if existing_speaker:
                                # Append to existing speaker text with proper spacing
                                existing_speaker["text"] += " " + text
                                existing_speaker["end_time"] = end_time  # Update end time
                            else:
                                # Add new speaker entry
                                speakers.append({
                                    "speaker_label": speaker_map[speaker_id],
                                    "speaker_tag": speaker_id,
                                    "text": text,
                                    "start_time": start_time,
                                    "end_time": end_time
                                })
                        
                        # Sort speakers by their first appearance (start_time)
                        speakers.sort(key=lambda x: x.get("start_time", 0))
                        
                        # Ensure the first speaker is always labeled as doctor
                        if speakers and speakers[0]["speaker_label"] != "doctor":
                            # Find the current doctor and swap
                            doctor_speaker = next((s for s in speakers if s["speaker_label"] == "doctor"), None)
                            if doctor_speaker:
                                # Swap labels
                                original_first_label = speakers[0]["speaker_label"]
                                speakers[0]["speaker_label"] = "doctor"
                                doctor_speaker["speaker_label"] = original_first_label
                                logger.info(f"Swapped speaker labels to ensure first speaker is doctor")
                        
                        # Clean up the response - remove timing info for frontend
                        cleaned_speakers = []
                        for speaker in speakers:
                            cleaned_speakers.append({
                                "speaker_label": speaker["speaker_label"],
                                "speaker_tag": speaker["speaker_tag"],
                                "text": speaker["text"]
                            })
                        
                        logger.info(f"Returning {len(cleaned_speakers)} speakers with diarization")
                        return {
                            "speakers": cleaned_speakers,
                            "language_code": language_code,
                            "diarization_enabled": True
                        }
                
                # FIXED: Handle text-only response (no diarization or diarization failed)
                transcribed_text = ""
                if hasattr(transcription, 'text'):
                    transcribed_text = transcription.text
                elif hasattr(transcription, 'transcript'):
                    transcribed_text = transcription.transcript
                elif isinstance(transcription, dict):
                    transcribed_text = transcription.get('text', transcription.get('transcript', ''))
                elif isinstance(transcription, str):
                    transcribed_text = transcription
                
                logger.info(f"Extracted text length: {len(transcribed_text)} characters")
                logger.info(f"Text content preview: {transcribed_text[:100]}...")
                
                if not transcribed_text:
                    # FIXED: If no text found, try to extract from any available attributes
                    logger.warning("No text found in transcription response, checking all attributes")
                    for attr_name in dir(transcription):
                        if not attr_name.startswith('_'):
                            attr_value = getattr(transcription, attr_name)
                            logger.info(f"Transcription.{attr_name}: {type(attr_value)} = {str(attr_value)[:100]}")
                    
                    raise Exception("No transcribed text found in ElevenLabs response")
                
                return {
                    "text": transcribed_text,
                    "language_code": language_code,
                    "diarization_enabled": False
                }
                
        except Exception as elevenlabs_error:
            logger.error(f"ElevenLabs API error: {str(elevenlabs_error)}")
            # FIXED: More detailed error logging
            if hasattr(elevenlabs_error, 'response'):
                logger.error(f"ElevenLabs response status: {elevenlabs_error.response.status_code}")
                logger.error(f"ElevenLabs response text: {elevenlabs_error.response.text}")
            raise Exception(f"ElevenLabs transcription failed: {str(elevenlabs_error)}")
                
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Log the full exception with traceback
        error_detail = f"Diarization failed: {str(e)}"
        logger.error(f"{error_detail}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=error_detail)
    
    finally:
        # Clean up temporary files - JUST DELETE THEM
        try:
            # Delete temp file created by tempfile.NamedTemporaryFile
            if temp_file and temp_file.name and os.path.exists(temp_file.name):
                os.remove(temp_file.name)
                logger.info(f"Cleaned up temporary file: {temp_file.name}")
        except Exception as cleanup_error:
            logger.error(f"Error cleaning up temporary file: {str(cleanup_error)}")











#***************************************
#************Elevenlabs ends***************************
#***************************************