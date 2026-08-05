"""
Ambulance Image Medical Data Extraction API
FastAPI backend endpoint using Groq Llama-4-Scout vision model
"""

from fastapi import APIRouter, HTTPException, Path
from pydantic import BaseModel
from typing import Optional
import httpx
import os
import re
import json
router = APIRouter(tags=["Ambulance Image Extraction"])
import logging
logger = logging.getLogger(__name__)
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import pytz
from datetime import datetime
import re



MONGO_URI = os.getenv("MONGO_URI")
mongo_client = AsyncIOMotorClient(MONGO_URI)
database = mongo_client["doctorassistai"]

Doctor_Suggestion_collection        = database["Doctor_Suggestion_Ambulance"]
Image_Extracted_Ambulance_collection = database["Image_Extracted_Ambulance"]
ApproveImageSuggestion_collection   = database["ApproveImageSuggestion"]

kolkata = pytz.timezone("Asia/Kolkata")

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "qwen/qwen3.6-27b"
IMAGES_API   = "https://doctorassist.ai/api/hms/users/ambulance/ambulance/image/{patient_id}"
GATEWAY_BASE = "https://doctorassist.ai/api/hms/users/ambulance"

EXTRACTION_PROMPT = """
You are reading a screenshot of a patient monitor / clinical device display
captured by an ambulance crew.

Extract ONLY clinical monitor data. Ignore browser tabs, taskbars, OS icons,
logos, watermarks, and any UI chrome unrelated to patient vitals.

Judge each vital against standard adult reference ranges:
HR 60–100 bpm | SpO2 ≥95% | RR 12–20/min | Temp 36.1–37.2°C |
SBP 90–140 mmHg | DBP 60–90 mmHg

Respond with ONLY a single valid JSON object — no prose, no reasoning,
no markdown fences, no <think> tags. Match this exact schema:

{
  "vitals": [
    {"parameter": "HR", "value": "60", "unit": "bpm", "status": "normal"},
    {"parameter": "SpO2", "value": "99", "unit": "%", "status": "normal"}
  ],
  "infusion_pumps": [
    {"pump": "Pump 1", "flow_rate": "2 ml/h", "infused": "7.46 ml", "running": true, "status": "normal"}
  ],
  "alarms": [],
  "abnormal_findings": [],
  "summary": "All visible vitals within normal limits. No abnormalities detected."
}

CRITICAL RULES:
- The "vitals" array MUST include every single vital sign visible on the monitor
  (HR, SpO2, RR, Temp, BP, etc.) — REGARDLESS of whether it is normal or abnormal.
  Do NOT omit normal values. Every visible reading gets an entry.
- The "infusion_pumps" array MUST include every pump visible, in the same way —
  regardless of status.
- status must be "normal" or "abnormal" for every vital/pump entry.
- abnormal_findings should additionally list ONLY the abnormal parameters, each with a short reason (this is a filtered subset of vitals, not a replacement for it).
- alarms should list any active device alarms only (not passive status indicators like "Stethoscope OFF" unless clinically flagged as critical).
- If NO clinical monitor is visible in the image at all (i.e. there is nothing to read), return:
  {"vitals": [], "infusion_pumps": [], "alarms": [], "abnormal_findings": [], "summary": "No clinical monitor data visible in this image."}
- Output nothing except the JSON object.
"""

# ── Response Models ────────────────────────────────────────────────────────────
class ImageExtractionResult(BaseModel):
    image_id:       Optional[str]
    image_url:      str
    extracted_text: str            # ← restored, human-readable, for legacy consumers
    extracted_data: dict           # structured, for future UI
    timestamp_iso:  Optional[str] = None
    driver_name:    Optional[str] = None

class ExtractionResponse(BaseModel):
    status:      str
    patient_id:  str
    total_images_processed: int
    extractions: list[ImageExtractionResult]

class ProcessPatientDataRequest(BaseModel):
    patient_id: str
    doctor_id:  Optional[str] = ""

class ApproveRequest(BaseModel):
    patient_id:    str
    doctor_id:     Optional[str] = ""
    processing_id: str


# ── Image fetch & extraction ───────────────────────────────────────────────────
def format_extracted_data_as_text(data: dict) -> str:
    """Convert structured extraction JSON into a clean readable string
    for legacy consumers (frontend textarea, AI analysis prompt, etc.)"""
    lines = []

    vitals = data.get("vitals", [])
    if vitals:
        lines.append("VITALS:")
        for v in vitals:
            flag = " [ABNORMAL]" if v.get("status") == "abnormal" else ""
            lines.append(f"  {v.get('parameter')}: {v.get('value')} {v.get('unit', '')}{flag}".strip())

    pumps = data.get("infusion_pumps", [])
    if pumps:
        lines.append("INFUSION PUMPS:")
        for p in pumps:
            status = "Running" if p.get("running") else "Stopped"
            flag = " [ABNORMAL]" if p.get("status") == "abnormal" else ""
            lines.append(f"  {p.get('pump')}: Flow {p.get('flow_rate')}, Infused {p.get('infused')}, {status}{flag}")

    alarms = data.get("alarms", [])
    if alarms:
        lines.append("ALARMS:")
        for a in alarms:
            lines.append(f"  ⚠ {a}")

    abnormal = data.get("abnormal_findings", [])
    if abnormal:
        lines.append("ABNORMAL FINDINGS:")
        for a in abnormal:
            lines.append(f"  • {a}")

    summary = data.get("summary", "")
    if summary:
        lines.append(f"SUMMARY: {summary}")

    return "\n".join(lines) if lines else "No clinical monitor data visible in this image."

def strip_reasoning(text: str) -> str:
    """Remove <think>...</think> blocks some models prepend to their output.

    Handles two cases:
      1. Normal — a fully closed <think>...</think> block, stripped entirely.
      2. Truncated — the model ran out of tokens mid-reasoning and never
         emitted a closing </think>. In that case there's no JSON answer
         anywhere in the output at all (it got cut off before reaching it),
         so we strip everything from <think> onward. This makes json.loads()
         fail cleanly and predictably instead of trying to parse raw
         reasoning prose as JSON.
    """
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    text = re.sub(r"<think>.*", "", text, flags=re.DOTALL)  # unclosed tag case
    return text.strip()


async def fetch_patient_images(patient_id: str) -> dict:
    url = IMAGES_API.format(patient_id=patient_id)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        data = resp.json()
    if data.get("status") != "success":
        raise HTTPException(status_code=404, detail="No images found for patient")
    return data

async def extract_from_image(image_url: str) -> dict:
    payload = {
        "model": GROQ_MODEL,
        "temperature": 0,
        # This model is a reasoning/"thinking" model — it produces a
        # <think>...</think> block before its answer. response_format:
        # json_object forces strict grammar-constrained JSON decoding from
        # token 1, which is incompatible with free-form reasoning first, so
        # it's intentionally omitted. Raised max_tokens further — a busy
        # multi-photo collage image needs a long <think> block AND the full
        # JSON answer afterward; 8192 was still truncating mid-reasoning
        # before the JSON was reached, causing "unparseable output".
        "max_tokens": 16000,
        "reasoning_effort": "none",
        "top_p": 1,
        "stream": False,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text",      "text": EXTRACTION_PROMPT},
                {"type": "image_url", "image_url": {"url": image_url}},
            ]
        }]
    }
    payload["response_format"] = {"type": "json_object"} 
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(GROQ_API_URL, json=payload, headers=headers)
            if resp.status_code != 200:
                raise HTTPException(status_code=502, detail=f"Groq API error {resp.status_code}: {resp.text}")
            result = resp.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Groq request failed: {e}")

    try:
        raw_content = result["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError) as e:
        raise HTTPException(status_code=502, detail=f"Unexpected Groq response structure: {e}")

    # Belt-and-suspenders: strip any <think> block even though json_object mode should prevent it
    cleaned = strip_reasoning(raw_content)
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned).strip()

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as e:
        # NEW: log the FULL cleaned output (not just 500 chars) plus the raw
        # (pre-strip) content, so a repeat failure shows us exactly whether
        # the model was cut off mid-<think> block (no closing tag, no JSON
        # reached) vs. some other formatting issue — instead of guessing.
        logger.error(
            f"JSON parse failed ({e}). raw_content_length={len(raw_content)} "
            f"cleaned_length={len(cleaned)}\n"
            f"--- RAW (pre-strip) last 1000 chars ---\n{raw_content[-1000:]}\n"
            f"--- CLEANED (post-strip) full ---\n{cleaned}"
        )
        # fallback so the pipeline never hard-fails — surfaces the raw text for debugging
        parsed = {
            "vitals": [], "infusion_pumps": [], "alarms": [],
            "abnormal_findings": [],
            "summary": "Extraction returned unparseable output.",
            "_raw": cleaned[:500],
        }

    return parsed


# ── Main Image Extraction Endpoint ─────────────────────────────────────────────
@router.post(
    "/extraction-ambulance-emt/ambulance/image/extract-medical-values/{patient_id}",
    response_model=ExtractionResponse,
    summary="Extract medical values from ambulance clinical images using Groq vision"
)
async def extract_medical_values(
    patient_id: str = Path(..., description="Patient ID to fetch and extract images for")
):
    images_data = await fetch_patient_images(patient_id)
    images: list[dict] = images_data.get("images", [])
    if not images:
        raise HTTPException(status_code=404, detail="No images available for this patient")

    images_sorted = sorted(images, key=lambda x: x.get("timestamp_iso", ""), reverse=True)

    extractions: list[ImageExtractionResult] = []
    for img in images_sorted:
        image_url = img.get("image_url", "")
        if not image_url:
            continue
        try:
            extracted_data = await extract_from_image(image_url)   # ← was: extracted_text = await extract_from_image(image_url)
        except Exception as e:
            detail = e.detail if isinstance(e, HTTPException) else str(e)
            logger.error(f"Extraction failed for image {img.get('image_id')} url={image_url}: {detail}")
            extracted_data = {                                      # ← was: extracted_text = "[Extraction failed for this image]"
                "vitals": [], "infusion_pumps": [], "alarms": [],
                "abnormal_findings": [],
                "summary": "[Extraction failed for this image]",
            }
        extracted_text = format_extracted_data_as_text(extracted_data)   # ← restored string

        extractions.append(ImageExtractionResult(
            image_id       = img.get("image_id"),
            image_url      = image_url,
            extracted_text = extracted_text,      # ← ADD THIS LINE
            extracted_data = extracted_data,                        # ← was: extracted_text = extracted_text
            timestamp_iso  = img.get("timestamp_iso"),
            driver_name    = img.get("driver_name"),
        ))

    return ExtractionResponse(
        status                 = "success",
        patient_id             = patient_id,
        total_images_processed = len(extractions),
        extractions            = extractions,
    )


@router.get("/health")
async def health():
    return {"status": "ok"}


# ── Fetch notes via gateway API (avoids cross-DB issue) ───────────────────────
async def get_all_notes_for_patient(patient_id: str) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{GATEWAY_BASE}/ambulance/image-extracted/all-notes/{patient_id}")
        resp.raise_for_status()
        data = resp.json()

    notes = data.get("notes", [])
    extracted_docs  = []
    suggestion_docs = []

    for note in notes:
        if note.get("type") == "extracted_data":
            extracted_docs.append({
                "extracted_text":      note.get("extracted_text", ""),
                "extracted_data":      note.get("extracted_data", {}),   # ← ADD THIS
                "image_timestamp_iso": note.get("timestamp_iso", ""),
                "image_id":            note.get("image_id", ""),
            })
        elif note.get("type") == "doctor_suggestion":
            suggestion_docs.append({
                "suggestion_text": note.get("suggestion_text", ""),
                "timestamp_iso":   note.get("timestamp_iso", ""),
            })

    return {"extracted": extracted_docs, "suggestions": suggestion_docs}

# ── Vitals timeline — AI-powered, format-agnostic ─────────────────────────────
async def extract_vitals_ai(text: str) -> dict:
    """
    Uses Groq AI to extract vital signs from any monitor text format.
    No predefined patterns or hardcoded mappings.
    Returns None for any value not explicitly present in the text.
    """
    empty = {
        "spo2": None, "hr": None, "rr": None,
        "temperature": None, "bp": None,
        "pump1_flow": None, "pump2_flow": None, "pump3_flow": None,
        "pump1_infused": None, "pump2_infused": None, "pump3_infused": None,
        "predict_hf": None,
    }

    if not text or not text.strip():
        return empty

    prompt = f"""You are a medical data extractor. Read the following text extracted from a medical monitor screen.

TEXT:
{text}

Extract ONLY values that are EXPLICITLY present in the text above.
Do NOT guess, infer, assume, or fill in any values that are not clearly stated.
If a value is absent or unclear, return null for that field.

Return a JSON object with exactly these keys:
- spo2: oxygen saturation number only, e.g. "99" (null if not found)
- hr: heart rate number only, e.g. "60" (null if not found)
- rr: respiratory rate number only, e.g. "20" (null if not found)
- temperature: temperature decimal only, e.g. "36.6" (null if not found)
- bp: blood pressure as "systolic/diastolic" only, e.g. "125/84" (null if not found)
- pump1_flow: pump 1 flow rate number only, e.g. "2" (null if not found)
- pump2_flow: pump 2 flow rate number only, e.g. "3" (null if not found)
- pump3_flow: pump 3 flow rate number only, e.g. "5" (null if not found)
- pump1_infused: pump 1 infused volume number only, e.g. "7.44" (null if not found)
- pump2_infused: pump 2 infused volume number only, e.g. "11.17" (null if not found)
- pump3_infused: pump 3 infused volume number only, e.g. "18.64" (null if not found)
- predict_hf: PREDICT-HF or similar cardiac risk score value, e.g. "Low" (null if not found)

Return ONLY the JSON object. No explanation. No markdown. No code fences."""

    payload = {
        "model":       GROQ_MODEL,
        "temperature": 0,
        "max_tokens":  512,
        "messages": [
            {
                "role": "system",
                "content": "You are a precise medical data extractor. Return only valid JSON. Never hallucinate values. Return null for anything not explicitly in the text."
            },
            {"role": "user", "content": prompt}
        ]
    }

    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(GROQ_API_URL, json=payload, headers=headers)
            if resp.status_code != 200:
                return empty
            result = resp.json()

        raw = result["choices"][0]["message"]["content"].strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
        raw = re.sub(r"\s*```$", "", raw).strip()

        parsed = json.loads(raw)

        extracted = {}
        for key in empty:
            val = parsed.get(key)
            if val is None or str(val).strip().lower() in ("null", "none", "n/a", "", "not found"):
                extracted[key] = None
            else:
                extracted[key] = str(val).strip()
        return extracted

    except Exception:
        return empty


async def parse_vitals_timeline(extracted_docs: list) -> list:
    timeline = []
    for doc in extracted_docs:
        struct_data  = doc.get("extracted_data") or {}
        image_ts_iso = doc.get("image_timestamp_iso", "")

        ts_display = image_ts_iso
        try:
            if image_ts_iso:
                dt = datetime.fromisoformat(image_ts_iso)
                ts_display = dt.astimezone(kolkata).strftime("%d %b %Y, %I:%M:%S %p")
        except Exception:
            pass

        vitals_map = {v.get("parameter", "").lower(): v.get("value") for v in struct_data.get("vitals", [])}
        pumps = struct_data.get("infusion_pumps", [])

        def pump_val(idx, key):
            return pumps[idx].get(key) if len(pumps) > idx else None

        entry = {
            "spo2":           vitals_map.get("spo2"),
            "hr":             vitals_map.get("hr"),
            "rr":             vitals_map.get("rr"),
            "temperature":    vitals_map.get("temp") or vitals_map.get("temperature"),
            "bp":             vitals_map.get("bp") or vitals_map.get("nibp"),
            "pump1_flow":     pump_val(0, "flow_rate"),
            "pump2_flow":     pump_val(1, "flow_rate"),
            "pump3_flow":     pump_val(2, "flow_rate"),
            "pump1_infused":  pump_val(0, "infused"),
            "pump2_infused":  pump_val(1, "infused"),
            "pump3_infused":  pump_val(2, "infused"),
            "predict_hf":     None,
            "timestamp_iso":      image_ts_iso,
            "timestamp_display":  ts_display,
            "raw_extracted_text": doc.get("extracted_text", ""),
            "image_id":            doc.get("image_id", ""),
        }
        # Fallback to old AI-based re-parse only if structured data is entirely absent
        if not struct_data:
            fallback = await extract_vitals_ai(doc.get("extracted_text", ""))
            entry.update({k: v for k, v in fallback.items() if k not in ("timestamp_iso", "timestamp_display", "raw_extracted_text", "image_id")})
        timeline.append(entry)
    return timeline


def build_trend(timeline: list) -> list:
    numeric_keys = ["spo2", "hr", "rr", "temperature"]
    trends = []
    for i in range(1, len(timeline)):
        prev = timeline[i]
        curr = timeline[i - 1]
        trend_entry = {
            "from_timestamp": prev.get("timestamp_display"),
            "to_timestamp":   curr.get("timestamp_display"),
            "changes": {}
        }
        for key in numeric_keys:
            pv = prev.get(key)
            cv = curr.get(key)
            if pv and cv:
                try:
                    diff = float(cv) - float(pv)
                    direction = "↑ Increased" if diff > 0 else ("↓ Decreased" if diff < 0 else "→ Stable")
                    trend_entry["changes"][key] = {
                        "previous": pv, "current": cv,
                        "diff": round(diff, 2), "direction": direction
                    }
                except Exception:
                    pass
        trends.append(trend_entry)
    return trends


# ── CORE: Rich free-text prompt → clean section parsing ───────────────────────
def build_analysis_prompt(
    patient_id: str,
    timeline: list,
    trends: list,
    doctor_suggestions: list,
    previous_approved: Optional[dict]
) -> str:

    current  = timeline[0] if timeline else {}
    previous = timeline[1] if len(timeline) > 1 else {}

    suggestions_text = "\n".join([
        f"- [{s.get('timestamp_iso', '')}] {s.get('suggestion_text', '')}"
        for s in doctor_suggestions
    ]) or "None"

    prev_approved_text = ""
    if previous_approved:
        prev_approved_text = f"""
--- PREVIOUS APPROVED AI ANALYSIS ---
Timestamp:    {previous_approved.get('timestamp_display', '')}
Impression:   {previous_approved.get('ai_impression', '')}
Comorbidities:{previous_approved.get('comorbidities', '')}
Risk Level:   {previous_approved.get('risk_level', '')}
EMT Actions:  {previous_approved.get('emt_actions', '')}
"""

    trend_text = ""
    if trends:
        for key, val in trends[0].get("changes", {}).items():
            trend_text += f"  {key.upper()}: {val['previous']} → {val['current']} ({val['direction']})\n"

    extracted_block = "\n\n".join([
        f"[{t.get('timestamp_display', 'N/A')}]:\n{t.get('raw_extracted_text', '')}"
        for t in timeline
    ])

    return f"""
PATIENT ID: {patient_id}

--- CURRENT VITALS (Latest: {current.get('timestamp_display', 'N/A')}) ---
SpO2:        {current.get('spo2', 'N/A')} %
Heart Rate:  {current.get('hr', 'N/A')} bpm
RR:          {current.get('rr', 'N/A')} breaths/min
Temperature: {current.get('temperature', 'N/A')} °C
BP:          {current.get('bp', 'N/A')} mmHg
Pump 1 Flow: {current.get('pump1_flow', 'N/A')} ml/hr
Pump 2 Flow: {current.get('pump2_flow', 'N/A')} ml/hr
Pump 3 Flow: {current.get('pump3_flow', 'N/A')} ml/hr
PREDICT-HF:  {current.get('predict_hf', 'N/A')}

--- PREVIOUS VITALS ({previous.get('timestamp_display', 'N/A') if previous else 'N/A'}) ---
SpO2:        {previous.get('spo2', 'N/A') if previous else 'N/A'} %
Heart Rate:  {previous.get('hr', 'N/A') if previous else 'N/A'} bpm
RR:          {previous.get('rr', 'N/A') if previous else 'N/A'} breaths/min
Temperature: {previous.get('temperature', 'N/A') if previous else 'N/A'} °C
BP:          {previous.get('bp', 'N/A') if previous else 'N/A'} mmHg

--- TREND CHANGES ---
{trend_text if trend_text else 'No previous data for comparison.'}

--- DOCTOR SUGGESTIONS (VERBATIM — DO NOT PARAPHRASE) ---
{suggestions_text}

{prev_approved_text}

--- FULL EXTRACTED DATA (All Images, Newest First) ---
{extracted_block}

---

You are a senior emergency medicine physician AI assistant.
Analyze the above patient data and provide a DETAILED, COMPREHENSIVE clinical analysis.
Be thorough, medically accurate, and actionable. Do NOT hallucinate values.

Respond with ONLY a single valid JSON object — no prose, no reasoning, no markdown
fences, no <think> tags, no meta-commentary about your process. Match this exact schema:

{{
  "impressive_findings": ["bullet 1", "bullet 2", "... 6-10 bullets total"],
  "comorbidities": ["bullet 1", "bullet 2", "... 4-8 bullets total"],
  "trend_analysis": ["bullet 1", "bullet 2", "... 4-6 bullets, one per vital sign"],
  "clinical_impression": "3-5 sentence paragraph summarizing the clinical picture",
  "risk_level": "LOW",
  "doctor_prescribed_medications": ["exact medication name 1", "exact medication name 2"],
  "medication_safety_review": ["bullet 1 — safety note per medication, or concern if any"],
  "emt_actions": ["bullet 1", "bullet 2", "... 5-8 bullets total"],
  "physician_alert": ["bullet 1", "bullet 2", "... 3-6 bullets total"]
}}

CRITICAL RULE FOR MEDICATIONS:
- "doctor_prescribed_medications" MUST list every medication name mentioned in the
  DOCTOR SUGGESTIONS section above, copied EXACTLY as written — do not correct spelling,
  do not paraphrase, do not omit any medication, do not add medications the doctor did
  not mention. If the doctor suggested nothing, return an empty list [].
- "medication_safety_review" must comment on each listed medication (e.g. contraindications,
  missing allergy history, interaction risk) — but must NOT alter, remove, or reject the
  medication list itself. The doctor's exact words are preserved regardless of any safety
  concern raised.

Rules:
- risk_level must be exactly one of: "LOW", "MODERATE", "HIGH", "CRITICAL"
- Every array must contain plain strings only — no nested objects, no markdown
- Do not include any text outside the JSON object
"""


async def call_groq_for_analysis(prompt_text: str) -> dict:
    """
    Calls Groq with the structured-JSON analysis prompt.
    Returns parsed sections dict + ai_raw_output.
    """
    payload = {
        "model":       GROQ_MODEL,
        "temperature": 0.3,
        # Same reasoning-model issue as extract_from_image — dropped
        # response_format json_object, raised max_tokens further since this
        # prompt is even larger (full patient timeline + trends + doctor
        # suggestions), rely on strip_reasoning()/regex cleanup below.
        "max_tokens":  16000,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a senior emergency medicine physician AI assistant. "
                    "You provide detailed, comprehensive, medically accurate clinical analyses. "
                    "You respond with valid JSON only, matching the schema given, with no "
                    "reasoning, commentary, or narration outside the JSON fields."
                )
            },
            {
                "role": "user",
                "content": prompt_text
            }
        ]
    }

    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=90) as client:
        resp = await client.post(GROQ_API_URL, json=payload, headers=headers)
        if resp.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Groq API error {resp.status_code}: {resp.text}"
            )
        result = resp.json()

    try:
        raw_content = result["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError) as e:
        raise HTTPException(status_code=502, detail=f"Unexpected Groq response: {e}")

    cleaned = strip_reasoning(raw_content)
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned).strip()

    def to_bullet_text(val) -> str:
        """Normalize list-of-strings or string into the bullet-string format
        the rest of the app (Mongo docs, PDF generator, frontend) already expects."""
        if isinstance(val, list):
            return "\n".join(f"• {item}" for item in val if item)
        return str(val or "")

    try:
        parsed_json = json.loads(cleaned)
    except json.JSONDecodeError:
        # Fallback — surfaces the issue instead of silently producing UNKNOWN/blank fields
        parsed_json = {
            "impressive_findings": [], "comorbidities": [], "trend_analysis": [],
            "clinical_impression": "Analysis could not be parsed. Please retry.",
            "risk_level": "UNKNOWN",
            "emt_actions": [], "physician_alert": [],
        }

    risk_level = str(parsed_json.get("risk_level", "UNKNOWN")).strip().upper()
    if risk_level not in {"LOW", "MODERATE", "HIGH", "CRITICAL"}:
        risk_level = "UNKNOWN"

    parsed = {
        "impressive_findings":            to_bullet_text(parsed_json.get("impressive_findings")),
        "comorbidities":                  to_bullet_text(parsed_json.get("comorbidities")),
        "trend_analysis":                 to_bullet_text(parsed_json.get("trend_analysis")),
        "clinical_impression":            str(parsed_json.get("clinical_impression", "")),
        "risk_level":                     risk_level,
        "doctor_prescribed_medications":  parsed_json.get("doctor_prescribed_medications", []),
        "medication_safety_review":       to_bullet_text(parsed_json.get("medication_safety_review")),
        "emt_actions":                    to_bullet_text(parsed_json.get("emt_actions")),
        "physician_alert":                to_bullet_text(parsed_json.get("physician_alert")),
        "ai_raw_output":                  cleaned,
    }
    return parsed





@router.post("/extraction-ambulance-emt/ambulance/image/process-patient-data/{patient_id}")
async def process_patient_data(
    patient_id: str,
    data: ProcessPatientDataRequest
):
    try:
        now_kolkata = datetime.now(kolkata)

        # 1. Fetch notes via gateway
        notes           = await get_all_notes_for_patient(patient_id)
        extracted_docs  = notes["extracted"]
        suggestion_docs = notes["suggestions"]

        if not extracted_docs:
            raise HTTPException(
                status_code=404,
                detail="No extracted image data found for this patient. Please extract images first."
            )

        # 2. Build vitals timeline & trends
        timeline = await parse_vitals_timeline(extracted_docs)
        trends   = build_trend(timeline)

        # 3. Fetch latest approved AI output
        previous_approved = await ApproveImageSuggestion_collection.find_one(
            {"patient_id": patient_id},
            sort=[("timestamp", -1)]
        )
        if previous_approved:
            previous_approved["_id"] = str(previous_approved["_id"])
            if previous_approved.get("timestamp") and hasattr(previous_approved["timestamp"], "astimezone"):
                previous_approved["timestamp_display"] = previous_approved["timestamp"].astimezone(kolkata).strftime("%d %b %Y, %I:%M:%S %p")

        # 4. Build prompt & call Groq
        prompt    = build_analysis_prompt(patient_id, timeline, trends, suggestion_docs, previous_approved)
        ai_result = await call_groq_for_analysis(prompt)

        # ── PASTE YOUR SNIPPET STARTING HERE ──────────────────────────────
        impressive_findings           = ai_result["impressive_findings"]
        comorbidities                 = ai_result["comorbidities"]
        trend_analysis                = ai_result["trend_analysis"]
        clinical_impression           = ai_result["clinical_impression"]
        risk_level                    = ai_result["risk_level"]
        doctor_prescribed_medications = ai_result["doctor_prescribed_medications"]
        medication_safety_review      = ai_result["medication_safety_review"]
        emt_actions                   = ai_result["emt_actions"]
        physician_alert                = ai_result["physician_alert"]
        ai_raw_output                  = ai_result["ai_raw_output"]

        # 5. Save to DB
        processing_doc = {
            "patient_id":                     patient_id,
            "doctor_id":                      data.doctor_id,
            "timestamp":                      now_kolkata,
            "timestamp_iso":                  now_kolkata.isoformat(),
            "timestamp_display":              now_kolkata.strftime("%d %b %Y, %I:%M:%S %p"),
            "ai_raw_output":                  ai_raw_output,
            "impressive_findings":            impressive_findings,
            "comorbidities":                  comorbidities,
            "trend_analysis":                 trend_analysis,
            "ai_impression":                  clinical_impression,
            "risk_level":                     risk_level,
            "doctor_prescribed_medications":  doctor_prescribed_medications,
            "medication_safety_review":       medication_safety_review,
            "emt_actions":                    emt_actions,
            "physician_alert":                physician_alert,
            "vitals_timeline":                timeline,
            "trends":                         trends,
            "total_images_used":              len(extracted_docs),
            "total_suggestions_used":         len(suggestion_docs),
            "approved":                       False,
            "approved_at":                    None,
        }

        result = await Doctor_Suggestion_collection.database["ProcessedPatientData_Ambulance"].insert_one(
            processing_doc
        )
        processing_id = str(result.inserted_id)

        # 6. Return — identical structure to original
        return {
            "status":                          "success",
            "processing_id":                   processing_id,
            "patient_id":                      patient_id,
            "timestamp_display":               now_kolkata.strftime("%d %b %Y, %I:%M:%S %p"),
            "impressive_findings":             impressive_findings,
            "comorbidities":                   comorbidities,
            "trend_analysis":                  trend_analysis,
            "clinical_impression":             clinical_impression,
            "risk_level":                      risk_level,
            "doctor_prescribed_medications":   doctor_prescribed_medications,
            "medication_safety_review":        medication_safety_review,
            "emt_actions":                     emt_actions,
            "physician_alert":                 physician_alert,
            "vitals_timeline":                 timeline,
            "trends":                          trends,
            "ai_raw_output":                   ai_raw_output,
        }
        # ── END OF SNIPPET ─────────────────────────────────────────────────

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── APPROVE ENDPOINT ──────────────────────────────────────────────────────────
@router.post("/extraction-ambulance-emt/ambulance/image/approve-processing/{patient_id}")
async def approve_processing(
    patient_id: str,
    data: ApproveRequest
):
    try:
        now_kolkata = datetime.now(kolkata)
        ProcessedData_collection = Doctor_Suggestion_collection.database["ProcessedPatientData_Ambulance"]

        processing_record = await ProcessedData_collection.find_one({"_id": ObjectId(data.processing_id)})
        if not processing_record:
            raise HTTPException(status_code=404, detail="Processing record not found")

        processing_record["_id"] = str(processing_record["_id"])
        if processing_record.get("timestamp"):
            processing_record["timestamp"] = processing_record["timestamp"].isoformat()

        approve_doc = {
            "patient_id":            patient_id,
            "doctor_id":             data.doctor_id,
            "processing_id":         data.processing_id,
            "timestamp":             now_kolkata,
            "timestamp_iso":         now_kolkata.isoformat(),
            "timestamp_display":     now_kolkata.strftime("%d %b %Y, %I:%M:%S %p"),
            "ai_raw_output":         processing_record.get("ai_raw_output", ""),
            "impressive_findings":   processing_record.get("impressive_findings", ""),
            "comorbidities":         processing_record.get("comorbidities", ""),
            "trend_analysis":        processing_record.get("trend_analysis", ""),
            "ai_impression":         processing_record.get("ai_impression", ""),
            "risk_level":            processing_record.get("risk_level", ""),
            "doctor_prescribed_medications": processing_record.get("doctor_prescribed_medications", []),
            "medication_safety_review":      processing_record.get("medication_safety_review", ""),
            "emt_actions":           processing_record.get("emt_actions", ""),
            "physician_alert":       processing_record.get("physician_alert", ""),
            "vitals_timeline":       processing_record.get("vitals_timeline", []),
            "trends":                processing_record.get("trends", []),
            "approved_by_doctor_id": data.doctor_id,
            "approved_at":           now_kolkata,
            "approved_at_display":   now_kolkata.strftime("%d %b %Y, %I:%M:%S %p"),
        }

        await ApproveImageSuggestion_collection.insert_one(approve_doc)
        await ProcessedData_collection.update_one(
            {"_id": ObjectId(data.processing_id)},
            {"$set": {"approved": True, "approved_at": now_kolkata, "approved_by": data.doctor_id}}
        )

        try:
            async with httpx.AsyncClient(timeout=5) as client:
                await client.post(
                    "https://doctorassist.ai/api/hms/users/ambulance/notify-driver-update",
                    json={"patient_id": patient_id, "update_type": "IMAGE_ANALYSIS_UPDATE"},
                )
        except Exception as notify_err:
            logger.warning(f"Driver notify failed (non-critical): {notify_err}")

        return {
            "status":        "success",
            "message":       "AI analysis approved and saved.",
            "patient_id":    patient_id,
            "processing_id": data.processing_id,
            "approved_at":   now_kolkata.strftime("%d %b %Y, %I:%M:%S %p"),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── GET LATEST APPROVED ───────────────────────────────────────────────────────
@router.get("/extraction-ambulance-emt/ambulance/image/approved-analysis/latest/{patient_id}")
async def get_latest_approved_analysis(patient_id: str):
    try:
        latest = await ApproveImageSuggestion_collection.find_one(
            {"patient_id": patient_id}, sort=[("timestamp", -1)]
        )
        if not latest:
            return {"status": "success", "data": None}
        latest["_id"] = str(latest["_id"])
        if latest.get("timestamp"):
            latest["timestamp"] = latest["timestamp"].isoformat()
        if latest.get("approved_at"):
            latest["approved_at"] = latest["approved_at"].isoformat()
        return {"status": "success", "data": latest}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── GET ALL APPROVED ──────────────────────────────────────────────────────────
@router.get("/extraction-ambulance-emt/ambulance/image/approved-analysis/all/{patient_id}")
async def get_all_approved_analyses(patient_id: str):
    try:
        docs = await ApproveImageSuggestion_collection.find(
            {"patient_id": patient_id}
        ).sort("timestamp", -1).to_list(length=100)
        for doc in docs:
            doc["_id"] = str(doc["_id"])
            if doc.get("timestamp"):   doc["timestamp"]   = doc["timestamp"].isoformat()
            if doc.get("approved_at"): doc["approved_at"] = doc["approved_at"].isoformat()
        return {"status": "success", "patient_id": patient_id, "total": len(docs), "data": docs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── GET PROCESSING HISTORY ────────────────────────────────────────────────────
@router.get("/extraction-ambulance-emt/ambulance/image/processing-history/{patient_id}")
async def get_processing_history(patient_id: str):
    try:
        ProcessedData_collection = Doctor_Suggestion_collection.database["ProcessedPatientData_Ambulance"]
        docs = await ProcessedData_collection.find(
            {"patient_id": patient_id}
        ).sort("timestamp", -1).to_list(length=50)
        for doc in docs:
            doc["_id"] = str(doc["_id"])
            if doc.get("timestamp"): doc["timestamp"] = doc["timestamp"].isoformat()
        return {"status": "success", "history": docs, "total": len(docs)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))