"""
rheumatology_ai_consultation_api.py
─────────────────────────────────────────────────────────────────────────────
DoctorAssist.AI — Rheumatology AI Workflow, Module 1: Audio-to-Text &
Consultation Intelligence (v1.0).

Two capture modes, per the roadmap:
  - Consultation Mode: physician dictation, single speaker.
  - Conversation Mode: doctor + patient exchange, speaker-separated.

This file does NOT reimplement transcription. Both modes' actual audio
capture and ASR already exist and work — the frontend
(RheumatologyAIConsultation.jsx) calls them directly:
  - Consultation Mode -> POST /elevenlabs/api/transcribe_labs
  - Conversation Mode -> POST /elevenlabs/api/transcribe_with_diarization
    (enable_speaker_diarization=true)
This file implements only the NEW piece: turning a transcript (plain or
speaker-segmented) into structured, clinically-relevant rheumatology data,
and saving/retrieving that.

Mirrors the naming/response/error-handling convention of every prior
rheumatology module 1:1.

ROUTES IN THIS FILE
---------------------
  GET  /rheumatology-ai-consultation/context-preview/{patient_id}/{doctor_id}
  POST /rheumatology-ai-consultation/extract
  POST /rheumatology-ai-consultation/save
  GET  /rheumatology-ai-consultation/history/{patient_id}/{doctor_id}

⚠️ ASSUMPTIONS MADE WHILE ASSEMBLING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. ROUTER MOUNT: same convention as every prior rheumatology file —
     `prefix="/context"`, mount with `app.include_router(...)` in main.py.

  2. COLLECTION NAME: "rheumatology_ai_consultation". Change
     CONSULTATION_COLLECTION_NAME below if you want a different name.

  3. NO TRANSCRIPTION LOGIC HERE — see module docstring. This file trusts
     whatever transcript/speaker_segments the frontend sends it (already
     produced by the confirmed-working elevenlabs_api.py endpoints) and
     does not call ElevenLabs itself. This avoids duplicating audio-
     handling logic that already works, across two backend files.

  4. SPEAKER LABELS ARE A HEURISTIC, NOT A VERIFIED IDENTITY: the
     diarization endpoint (elevenlabs_api.py's transcribe_with_diarization)
     assumes whichever speaker talks first is the doctor, and force-swaps
     labels to enforce that — there is no real speaker-identity
     verification underneath it. This file passes speaker_segments
     through as-is and does NOT treat "doctor" vs "patient" labels as
     ground truth when extracting — the extraction prompt is told
     explicitly that labels may be wrong and to extract patient-reported
     clinical content based on what's actually said, not blindly trust
     the label. The frontend is expected to show a "verify speaker
     labels" caveat to the doctor before they rely on it — not
     something this backend file can enforce, flagging here so it isn't
     silently dropped.

  5. EXTRACTION FIELDS ARE FREE TEXT, NOT A CLOSED VOCABULARY — a
     deliberate departure from every other rheumatology module's closed-
     vocabulary convention. Reasoning: this step summarizes what was
     actually said in ONE specific consultation (the patient's own words
     about pain location, duration, etc.), which is inherently free-form
     narrative — not a categorical decision among a fixed set of
     options like a diagnosis tier (Module 3) or an investigation name
     (Module 4). This module does NOT attempt to map extracted symptoms
     into those other modules' closed vocabularies itself — that
     categorization remains Module 3/4's job, working from whatever the
     doctor ends up entering into Intake.

  6. NO AUTOMATIC WRITE INTO MODULE 1 INTAKE OR THE STRUCTURED NOTE
     COLLECTIONS: saving stays self-contained in this module's own
     collection. rheumatology_intake_api.py has not been reviewed, so
     this file does not guess at its schema and write into it directly —
     same "don't touch another module's contract without reviewing the
     real file" rule this build has followed throughout. A bridging
     write, or a "pull into Intake" action on the Intake form that reads
     this collection, could be added later once rheumatology_intake_api.py
     is reviewed — flagged as a known follow-up, not built here.

  7. LANGUAGE CODE HANDLING: this file does not validate or touch
     language codes at all — that validation already happens (with a
     minor inconsistency between the two ElevenLabs endpoints' allowed
     lists) inside elevenlabs_api.py, which is out of scope for this
     session's task. Flagging, not fixing.

  8. NO ALERTING/NOTIFICATION PIPELINE, same as every prior module —
     this module surfaces its output in the doctor's own UI only.

  9. "IRRELEVANT CONTENT REMOVAL" (per the roadmap's Module 1 spec) is
     handled entirely inside the extraction prompt below (the LLM is
     instructed to extract only clinically relevant content and omit
     small talk, greetings, etc.) — it is not a separate pre-processing
     step, and the RAW transcript/speaker_segments are saved unedited
     alongside the extraction, so nothing is silently deleted from the
     record — only the STRUCTURED fields are filtered for relevance.
─────────────────────────────────────────────────────────────────────────
"""

import os
import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from motor.motor_asyncio import AsyncIOMotorClient
from groq import Groq

logger = logging.getLogger(__name__)

# ─── Mongo setup ────────────────────────────────────────────────────────────
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

CONSULTATION_COLLECTION_NAME = "rheumatology_ai_consultation"  # see ASSUMPTION #2

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    consultation_collection = database[CONSULTATION_COLLECTION_NAME]
except Exception as e:
    logger.error(f"Error initializing MongoDB in rheumatology_ai_consultation_api: {e}")

# ─── Groq setup ─────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client: Optional[Groq] = None
try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        logger.warning("GROQ_API_KEY not set — AI consultation extraction endpoint will fail at call time.")
except Exception as e:
    logger.error(f"Error initializing Groq client in rheumatology_ai_consultation_api: {e}")

router = APIRouter(prefix="/context", tags=["Rheumatology AI Consultation"])

MODE_ALLOWED = {"consultation", "conversation"}

EXTRACTION_FIELDS = [
    "chief_complaints", "symptoms", "duration", "pain_location",
    "morning_stiffness", "joint_involvement", "swelling",
    "functional_limitations", "previous_diagnosis", "medication_history",
    "family_history", "autoimmune_history",
]
LIST_FIELDS = {
    "chief_complaints", "symptoms", "pain_location", "joint_involvement",
    "swelling", "functional_limitations", "previous_diagnosis",
    "medication_history", "family_history", "autoimmune_history",
}
STRING_FIELDS = {"duration", "morning_stiffness"}


# ═════════════════════════════════════════════════════════════════════════════
# 1. CONTEXT PREVIEW
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-ai-consultation/context-preview/{patient_id}/{doctor_id}")
async def get_ai_consultation_context_preview(patient_id: str, doctor_id: str):
    """Read-only preview of the most recently SAVED consultation, if any."""
    try:
        doc = await consultation_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        if not doc:
            return {"status": "success", "data": None}
        return {
            "status": "success",
            "data": {
                "mode": doc.get("mode"),
                "extracted": doc.get("extracted"),
                "saved_at": doc.get("created_at").isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
            },
        }
    except Exception as e:
        logger.warning(f"AI consultation: context preview lookup failed for {patient_id}: {e}")
        return {"status": "success", "data": None}


# ═════════════════════════════════════════════════════════════════════════════
# 2. EXTRACT
# ═════════════════════════════════════════════════════════════════════════════

EXTRACTION_PROMPT = """
You are a clinical assistant supporting a rheumatologist. You will be
given a consultation transcript — either plain physician dictation
(Consultation Mode) or a speaker-separated doctor/patient exchange
(Conversation Mode, where speaker labels may be provisional/incorrect —
extract based on what is actually said, not blindly on the label).

Extract only clinically relevant rheumatology information. OMIT small
talk, greetings, scheduling chatter, and anything not clinically
relevant.

Return a JSON object with EXACTLY these keys:
  - "chief_complaints": list of short strings — the patient's main
    presenting complaint(s), in their own words where possible.
  - "symptoms": list of short strings — other reported symptoms.
  - "duration": one string describing how long symptoms have been
    present (e.g. "3 months, worsening over the last 2 weeks"). Empty
    string if not mentioned.
  - "pain_location": list of short strings — specific body/joint
    locations of pain mentioned.
  - "morning_stiffness": one string describing morning stiffness if
    mentioned (duration/severity), empty string if not mentioned.
  - "joint_involvement": list of short strings — specific joints
    reported as involved/affected.
  - "swelling": list of short strings — specific locations of reported
    swelling.
  - "functional_limitations": list of short strings — activities the
    patient reports difficulty with.
  - "previous_diagnosis": list of short strings — any prior diagnoses
    the patient mentions having received.
  - "medication_history": list of short strings — medications mentioned
    (current or past), as reported, not inferred.
  - "family_history": list of short strings — family history of relevant
    conditions if mentioned.
  - "autoimmune_history": list of short strings — the patient's own past
    autoimmune-relevant history if mentioned (separate from family
    history above).

Rules:
- Every list field should be an empty list [] if nothing relevant is
  mentioned — do not invent content.
- Do not diagnose, categorize into named rheumatological conditions, or
  suggest a differential — that is a separate clinical step performed
  elsewhere. Only extract what was actually reported.
- Return valid JSON only — no markdown, no commentary, no extra keys.
"""


def _build_transcript_text(payload: dict) -> str:
    """Builds a single text block for the LLM from either input shape."""
    speaker_segments = payload.get("speaker_segments")
    if isinstance(speaker_segments, list) and speaker_segments:
        lines = []
        for seg in speaker_segments:
            if not isinstance(seg, dict):
                continue
            label = str(seg.get("speaker_label", "unknown")).upper()
            text = str(seg.get("text", "")).strip()
            if text:
                lines.append(f"{label}: {text}")
        return "\n".join(lines)
    return str(payload.get("transcript", "")).strip()


@router.post("/rheumatology-ai-consultation/extract")
async def extract_consultation_data(payload: dict):
    """
    Expected payload:
    {
        "doctor_id": "...", "patient_id": "...",
        "mode": "consultation" | "conversation",
        "transcript": "..."                    # Consultation Mode (plain text)
        # OR
        "speaker_segments": [{"speaker_label": "doctor", "text": "..."}, ...]  # Conversation Mode
    }

    Returns:
    { "status": "success", "finaloutput": { <EXTRACTION_FIELDS> } }
    """
    if groq_client is None:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured on server")

    patient_id = payload.get("patient_id")
    doctor_id = payload.get("doctor_id")
    mode = payload.get("mode", "")

    if not patient_id or not doctor_id:
        raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
    if mode not in MODE_ALLOWED:
        raise HTTPException(status_code=400, detail=f"mode must be one of: {sorted(MODE_ALLOWED)}")

    transcript_text = _build_transcript_text(payload)
    if not transcript_text.strip():
        raise HTTPException(status_code=400, detail="No transcript or speaker_segments content to extract from")

    try:
        completion = groq_client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[
                {"role": "system", "content": EXTRACTION_PROMPT},
                {"role": "user", "content": transcript_text},
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )
        raw_content = completion.choices[0].message.content
        try:
            parsed = json.loads(raw_content)
        except (json.JSONDecodeError, TypeError):
            logger.error(f"AI consultation extraction returned non-JSON: {raw_content}")
            parsed = {}
        if not isinstance(parsed, dict):
            parsed = {}

        clean = {}
        for field in EXTRACTION_FIELDS:
            val = parsed.get(field)
            if field in LIST_FIELDS:
                clean[field] = [str(v)[:300] for v in val][:30] if isinstance(val, list) else []
            else:
                clean[field] = str(val)[:500] if isinstance(val, str) else ""

        return {"status": "success", "finaloutput": clean}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"AI consultation extraction failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 3. SAVE
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-ai-consultation/save")
async def save_ai_consultation(payload: dict):
    """
    Expected payload (doctor-reviewed/edited version of /extract's output,
    plus the raw transcript/segments for the permanent record):
    {
        "patient_id": "...", "doctor_id": "...",
        "mode": "consultation" | "conversation",
        "transcript": "..."                    # if consultation mode
        "speaker_segments": [...],              # if conversation mode
        "extracted": { <EXTRACTION_FIELDS>, doctor-edited }
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        mode = payload.get("mode", "")
        extracted = payload.get("extracted") or {}

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if mode not in MODE_ALLOWED:
            raise HTTPException(status_code=400, detail=f"mode must be one of: {sorted(MODE_ALLOWED)}")

        clean_extracted = {}
        for field in EXTRACTION_FIELDS:
            val = extracted.get(field)
            if field in LIST_FIELDS:
                clean_extracted[field] = [str(v)[:300] for v in val][:30] if isinstance(val, list) else []
            else:
                clean_extracted[field] = str(val)[:500] if isinstance(val, str) else ""

        has_content = any(clean_extracted[f] for f in LIST_FIELDS) or any(clean_extracted[f] for f in STRING_FIELDS)
        if not has_content:
            raise HTTPException(status_code=400, detail="No extracted content to save")

        speaker_segments = payload.get("speaker_segments")
        clean_segments = None
        if isinstance(speaker_segments, list):
            clean_segments = [
                {
                    "speaker_label": str(s.get("speaker_label", ""))[:50],
                    "text": str(s.get("text", ""))[:5000],
                }
                for s in speaker_segments if isinstance(s, dict)
            ][:200]

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "mode": mode,
            "transcript": str(payload.get("transcript", ""))[:20000] if mode == "consultation" else "",
            "speaker_segments": clean_segments if mode == "conversation" else None,
            "extracted": clean_extracted,
            "created_at": datetime.utcnow(),
            "type": "rheumatology_ai_consultation",
        }
        result = await consultation_collection.insert_one(document)

        return {"status": "success", "message": "AI consultation saved", "id": str(result.inserted_id)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 4. HISTORY
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-ai-consultation/history/{patient_id}/{doctor_id}")
async def get_ai_consultation_history(patient_id: str, doctor_id: str):
    """Fetch all saved AI Consultation records for a patient, most recent first."""
    try:
        cursor = consultation_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("created_at", -1)

        records = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            if isinstance(doc.get("created_at"), datetime):
                doc["created_at"] = doc["created_at"].isoformat()
            records.append(doc)

        return {"status": "success", "count": len(records), "data": records}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))