import os
import base64
import asyncio
import tempfile
import json
import hashlib
from datetime import datetime
from typing import Union, Dict, List, Optional
from functools import partial

import requests
from pydantic import BaseModel
from groq import Groq
from loguru import logger
from uuid import uuid4

from pdf2image import convert_from_bytes
from motor.motor_asyncio import AsyncIOMotorClient

from common.llm.enhanced_knowledge_graph import EnhancedMedicalKnowledgeGraph


# ------------------- CONFIG -------------------
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB")

async_client = AsyncIOMotorClient(MONGO_URI)
db = async_client[MONGO_DB]

processed_documents = db["processed_documents"]
semantic_chunks = db["semantic_chunks"]
timeline_events = db["timeline_events"]
document_evidence = db["document_evidence"]
oncology_investigations_collection = db["oncology_investigations"]
patient_user_collection = db["patient_users"]

neo4j_uri = os.getenv("NEO4J_URI", "bolt://neo4j:7687")
neo4j_user = os.getenv("NEO4J_USER", "neo4j")
neo4j_password = os.getenv("NEO4J_PASSWORD", "password")

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client = Groq(api_key=GROQ_API_KEY)

# ------------------- OPENROUTER (GPT-4o) CONFIG ------------------
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "openai/gpt-4o")

VISION_BATCH_SIZE = int(os.getenv("VISION_BATCH_SIZE", "8"))
VISION_DPI = int(os.getenv("VISION_DPI", "200"))

# Lazily-created singleton knowledge graph instance (async driver, created
# once and reused across requests in this process).
_knowledge_graph: Optional[EnhancedMedicalKnowledgeGraph] = None
_kg_lock = asyncio.Lock()


async def _get_knowledge_graph() -> EnhancedMedicalKnowledgeGraph:
    global _knowledge_graph
    if _knowledge_graph is None:
        async with _kg_lock:
            if _knowledge_graph is None:
                _knowledge_graph = EnhancedMedicalKnowledgeGraph(
                    uri=neo4j_uri,
                    user=neo4j_user,
                    password=neo4j_password,
                    mongo_db=db,
                )
                logger.info("✅ Knowledge graph (Neo4j async driver) initialized")
    return _knowledge_graph


class ExtractedEntity(BaseModel):
    entity_type: str
    entity_name: str
    entity_value: Optional[Union[str, float, int]] = None
    confidence: float = 0.9
    evidence_text: str


class Evidence(BaseModel):
    evidence_id: str
    document_id: str
    document_name: str
    document_type: str
    document_date: Optional[str] = None
    evidence_text: str
    page_number: Optional[int] = None
    confidence: float
    extraction_date: datetime


# =====================================================================
# STAGE 1: RAW, LITERAL TRANSCRIPTION VIA GPT-4o VISION  (unchanged)
# =====================================================================

STAGE1_TRANSCRIPTION_PROMPT = """You are a meticulous medical document transcription engine.
You are processing one or more page images from a medical document.

VISUAL CONTENT — IGNORE COMPLETELY
Ignore ALL decorative and non-clinical visual elements. Do NOT describe, mention, or transcribe:
  - Hospital / clinic / lab logos and branding graphics
  - Page borders, ruled lines, box outlines, and background patterns
  - Watermarks (including "CONFIDENTIAL", "COPY", institution watermarks)
  - Background graphics, colour fills, and decorative artwork
  - QR codes and barcodes
  - Blank areas, empty fields, and whitespace
  - Signature images (ignore the signature graphic itself; DO transcribe the printed name
    or date written beside or below a signature if clinically relevant)
  - Stamp images (transcribe only the text inside a stamp if it carries clinical data)
Do NOT describe these elements. Do NOT write "[logo]", "[barcode]", "[watermark]",
"[blank]", or any placeholder for them.

WHAT TO TRANSCRIBE
Transcribe ONLY patient-related textual content, which includes:
  - All handwritten text (clinical notes, annotations, corrections)
  - All printed / typed text (headers, body text, tables, form labels with filled values)
  - Handwritten or typed dates, times, measurements, lab values, medications, doses
  - Findings, impressions, diagnoses, instructions, remarks
  - Checkbox states only when a box is clearly checked/ticked AND has a label beside it
  - Clinical images or diagrams only when they contain embedded text or annotations

STRICT TRANSCRIPTION RULES
1.  DO NOT summarize.
2.  DO NOT paraphrase.
3.  DO NOT rewrite sentences.
4.  DO NOT correct spelling or grammar.
5.  DO NOT normalize abbreviations.
6.  DO NOT infer or fill in missing words.
7.  DO NOT interpret medical meaning.
8.  DO NOT omit any patient-related text content.
9.  DO NOT remove duplicate text.
10. Preserve the original reading order (top-to-bottom, left-to-right,
    then continuation columns if present).
11. Preserve headings, tables, handwritten notes, printed text,
    signatures (text portion), dates, times, medications, doses,
    findings, impressions, instructions, and remarks.
12. Preserve symbols exactly as they appear:
    →  ←  ×  ☑  ☐  +  -  ( )  [ ]  /  %  °  @  #  &
13. Preserve all dates exactly as written (do NOT reformat).
14. Preserve all times exactly as written.
15. Preserve all numbers exactly as written.
16. If text is partially unreadable, transcribe what is visible and mark:
      [unclear: <visible fragment>]
17. If multiple clinical entries exist on the same page,
    preserve them separately in the order they appear.
18. Preserve page boundaries using the output format below.

OUTPUT FORMAT

Page 1
--------------------------------
<Complete transcription of page 1 — patient-related text only>

Page 2
--------------------------------
<Complete transcription of page 2 — patient-related text only>

Continue until every page has been completely transcribed.

Do NOT provide explanations.
Do NOT provide summaries.
Do NOT provide interpretations.
Do NOT describe any visual / decorative element.

Return only the transcription.
"""


def _pdf_bytes_to_base64_images(pdf_bytes: bytes, dpi: int = VISION_DPI) -> List[str]:
    pages = convert_from_bytes(pdf_bytes, dpi=dpi, fmt="jpeg")
    b64_pages = []
    for page_img in pages:
        buf = tempfile.SpooledTemporaryFile(max_size=10 * 1024 * 1024)
        page_img.save(buf, format="JPEG", quality=85)
        buf.seek(0)
        b64_pages.append(base64.b64encode(buf.read()).decode("utf-8"))
        buf.close()
    return b64_pages


def _call_vision_api_for_pages(b64_images: List[str], page_offset: int, total_pages: int) -> str:
    if not OPENROUTER_API_KEY:
        raise Exception("OPENROUTER_API_KEY is not set")

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "HTTP-Referer": "https://your-site.com",
        "X-Title": "Medical Document Analyzer",
        "Content-Type": "application/json",
    }

    content: List[Dict] = [{"type": "text", "text": STAGE1_TRANSCRIPTION_PROMPT}]

    for idx, b64 in enumerate(b64_images):
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "high"},
        })
        global_page_num = page_offset + idx + 1
        content.append({
            "type": "text",
            "text": f"[The image above is Page {global_page_num} of {total_pages}]",
        })

    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [{"role": "user", "content": content}],
        "temperature": 0.0,
    }

    response = requests.post(url=OPENROUTER_URL, headers=headers, json=payload, timeout=300)
    if response.status_code != 200:
        raise Exception(
            f"OpenRouter (stage 1 vision, pages {page_offset + 1}–"
            f"{page_offset + len(b64_images)} of {total_pages}) "
            f"request failed: {response.status_code} | {response.text}"
        )

    result = response.json()
    try:
        content_text = result["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as e:
        raise Exception(f"Unexpected OpenRouter response shape (stage 1 vision): {result}") from e

    return (content_text or "").strip()


async def extract_raw_transcription_openai(file_url: str, filename: str) -> str:
    """
    STAGE 1 — GPT-4o Vision transcription.
    All blocking I/O (download, PDF rasterisation, HTTP call) is pushed to a
    thread executor so it never blocks the FastAPI event loop.
    """
    loop = asyncio.get_event_loop()

    def _download():
        r = requests.get(file_url, timeout=120)
        if r.status_code != 200:
            raise Exception(
                f"Stage 1: failed to download PDF for vision processing: "
                f"{file_url} (HTTP {r.status_code})"
            )
        return r.content

    pdf_bytes = await loop.run_in_executor(None, _download)
    logger.info(f"Stage 1: downloaded PDF ({len(pdf_bytes):,} bytes) — converting to images")

    try:
        b64_pages = await loop.run_in_executor(
            None, partial(_pdf_bytes_to_base64_images, pdf_bytes, VISION_DPI)
        )
    except Exception as e:
        raise Exception(f"Stage 1: PDF→image conversion failed: {e}") from e

    total_pages = len(b64_pages)
    logger.info(f"Stage 1: {total_pages} page(s) rasterised at {VISION_DPI} dpi")

    if total_pages == 0:
        raise Exception("Stage 1: PDF produced zero pages after rasterisation")

    transcription_parts: List[str] = []

    for batch_start in range(0, total_pages, VISION_BATCH_SIZE):
        batch = b64_pages[batch_start: batch_start + VISION_BATCH_SIZE]
        batch_end = batch_start + len(batch)
        logger.info(f"Stage 1: sending pages {batch_start + 1}–{batch_end} of {total_pages} to GPT-4o Vision")

        batch_text = await loop.run_in_executor(
            None,
            partial(_call_vision_api_for_pages, batch, batch_start, total_pages),
        )

        if batch_text.startswith("```"):
            batch_text = batch_text.strip("`").strip()
            if batch_text.lower().startswith("text"):
                batch_text = batch_text[4:].strip()

        if not batch_text:
            logger.warning(f"Stage 1: vision API returned empty text for pages {batch_start + 1}–{batch_end}")
        else:
            transcription_parts.append(batch_text)

    raw_transcription = "\n\n".join(transcription_parts).strip()

    if not raw_transcription:
        raise Exception("Stage 1 vision transcription returned empty content for all pages")

    return raw_transcription


# =====================================================================
# STAGE 2: SPLIT THE RAW TRANSCRIPTION BY INVESTIGATION PARAMETER
# =====================================================================
# Segment by the list of parameters recorded on the oncology_investigations
# document, AND — for each parameter — extract the date that parameter's
# result/content is tied to (collection date, report date, procedure date,
# etc). This lets entity extraction / the timeline use a per-parameter date
# instead of falling back to a single document-level date for everything.

STAGE2_PARAMETER_SPLIT_PROMPT = """You are a meticulous medical document parameter-segmentation engine.

You will be given:
1. PARAMETERS — a list of parameter/field names this investigation was ordered for.
2. RAW_TRANSCRIPTION — a literal, already-faithful transcription of a medical document.

You are NOT re-reading any image or PDF — work only from the text given to you.

Your job is to find, for EACH parameter in PARAMETERS, the clinically corresponding content in RAW_TRANSCRIPTION.

The wording in the document does NOT have to exactly match the parameter name.

You MUST recognize common medical abbreviations, alternate spellings, synonyms, expanded forms, and equivalent laboratory terminology.

For example:

- Glucose FBS = Fasting Blood Sugar = FBS
- Glucose PPBS = PPBS = Post Prandial Blood Sugar
- Total Cholesterol, Serum Or Plasma = Total Cholesterol
- Hb = Haemoglobin
- WBC = Total Leukocyte Count
- Platelets = Platelet Count
- Creatinine = Serum Creatinine
- SGOT = AST
- SGPT = ALT

If the document clearly refers to the same clinical investigation using a different name, treat it as a match.

The extracted content must still be copied VERBATIM from RAW_TRANSCRIPTION.

Also determine the date associated with that parameter (collection date, report date, order date, procedure date, etc.).

=== ABSOLUTE FIDELITY RULES (HIGHEST PRIORITY) ===
1. Do NOT invent, guess, or fabricate content.

If the document contains a clinically equivalent laboratory test written under a different name, abbreviation, synonym, or expanded form, treat it as the requested parameter.

Only return:

"found": false

if neither the exact parameter nor any clinically equivalent representation exists in RAW_TRANSCRIPTION.

When a match is found, copy ONLY the original text from RAW_TRANSCRIPTION without rewriting it.
2. Do NOT summarize, shorten, paraphrase, or "clean up" any wording from RAW_TRANSCRIPTION. Copy the
   content verbatim into each parameter's "content" field, preserving medical abbreviations, symbols
   (☐, →, x, /, ①, ②, etc.) and structure exactly as they appear.
3. Do NOT omit any text, value, table, note, bullet point, checkbox, drug name, dose, instruction, or
   paragraph that is relevant to a parameter — including content that looks repetitive or unclear.
4. If content relevant to the same parameter appears in multiple places in RAW_TRANSCRIPTION, merge it
   into a single entry, preserving the original order it appears in.
5. If a piece of information cannot be confidently matched to any parameter in PARAMETERS, place it
   under a final entry with "parameter_name": "Other", "found": true — do not force it onto an
   unrelated parameter as a guess.
6. Ignore ONLY page numbers, repeated headers/footers, watermarks, and QR-code/barcode boilerplate
   that carry no clinical content.
7. Do NOT add any interpretation, diagnosis, or clinical inference that is not explicitly present in
   RAW_TRANSCRIPTION. You are segmenting, not diagnosing.

=== CLINICAL TERMINOLOGY MATCHING ===

Medical reports frequently use different names for the same investigation.

Treat the following as equivalent whenever clinically appropriate:

Hb = Haemoglobin = Hemoglobin

PCV = Hematocrit

WBC = Total Leukocyte Count = TLC

Platelets = Platelet Count

Creatinine = Serum Creatinine

Urea = Blood Urea

Na = Sodium

K = Potassium

SGOT = AST

SGPT = ALT

FBS = Glucose FBS = Fasting Blood Sugar

PPBS = Glucose PPBS = Postprandial Blood Sugar

RBS = Random Blood Sugar

Total Cholesterol, Serum Or Plasma = Total Cholesterol

HDL Cholesterol = HDL

LDL Cholesterol = LDL

Triglycerides = TG

Use these equivalences only for matching the correct parameter.

The extracted content must always remain the exact original text from RAW_TRANSCRIPTION.

=== DATE EXTRACTION RULES (PER PARAMETER) — apply the same rigor as the content rules above ===
8. For EACH parameter entry, find the date that its content is actually tied to in RAW_TRANSCRIPTION —
   e.g. a collection date, report/result date, procedure date, or order date written next to or near
   that parameter's content. This may be a document-wide date that applies to every parameter, or a
   distinct date printed next to that specific test/section — use whichever is literally present and
   most specific to that parameter's content.
9. NEVER invent, guess, or "auto-correct" a date that is not legibly present in RAW_TRANSCRIPTION.
   - If a date is partially illegible, smudged, or ambiguous (including text already marked
     "[unclear: ...]"), keep it as-is and set "date_confidence": "low". Do NOT silently normalize it
     to a different, cleaner-looking date.
   - Only convert to YYYY-MM-DD format if you are confident in every digit. If not fully confident,
     put your best-effort raw transcription in "date" AND copy the literal text into "date_raw_text".
   - It is FAR better to under-commit to a date than to fabricate one. A wrong date is worse than
     "Unknown".
   - Indian medical records commonly use DD/MM/YY or DD/MM/YYYY format — do not assume US MM/DD format.
10. If NO date can be confidently tied to a parameter's content, set "date": "Unknown" and
    "date_confidence": "low" rather than guessing or copying an unrelated date.
11. If a date is written in different formats (e.g. 01/02/2024, February 1 2024, 2024-02-01) and you
    are confident they refer to the same calendar date, normalize them to the SAME canonical date.
12. Every parameter entry — including "found": false entries — must still include "date", "date_raw_text"
    (may be null/omitted), and "date_confidence" keys, even if the value is "Unknown"/"low".

=== OUTPUT FORMAT ===
Return ONLY valid JSON, no commentary, no markdown fences:
{
  "parameters": [
    {
      "parameter_name": "<exactly one name from PARAMETERS, or 'Other'>",
      "found": true | false,
      "date": "YYYY-MM-DD, or best-effort raw text if uncertain, or 'Unknown'",
      "date_raw_text": "literal text/handwriting as it appears (omit or null if date was fully unambiguous or Unknown)",
      "date_confidence": "high | low",
      "content": "Complete, exhaustive, original content for this parameter without omitting anything."
    }
  ]
}

Every parameter listed in PARAMETERS must produce exactly one entry, in the same order given.

=== PARAMETERS ===
__PARAMETERS_PLACEHOLDER__

=== RAW_TRANSCRIPTION ===
__RAW_TRANSCRIPTION_PLACEHOLDER__
"""


async def split_transcription_into_parameters_openai(raw_transcription: str, parameters) -> List[Dict]:
    """
    STAGE 2: Sends the Stage 1 raw transcription (plain text) + the investigation's
    parameter list to GPT-4o via OpenRouter and asks it to segment the text into
    parameter-wise JSON entries, each tagged with its own best-effort date.
    """
    if not OPENROUTER_API_KEY:
        raise Exception("OPENROUTER_API_KEY is not set")

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "HTTP-Referer": "https://your-site.com",
        "X-Title": "Medical Document Analyzer",
        "Content-Type": "application/json",
    }

    parameters_text = json.dumps(parameters, indent=2, default=str)
    logger.info(f"thomas_parameters_text:{parameters_text}")

    prompt = (
        STAGE2_PARAMETER_SPLIT_PROMPT
        .replace("__PARAMETERS_PLACEHOLDER__", parameters_text)
        .replace("__RAW_TRANSCRIPTION_PLACEHOLDER__", raw_transcription)
    )

    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.0,
        "response_format": {"type": "json_object"},
    }

    loop = asyncio.get_event_loop()

    def _call():
        r = requests.post(url=OPENROUTER_URL, headers=headers, json=payload, timeout=180)
        if r.status_code != 200:
            raise Exception(f"OpenRouter (stage 2 - parameter split) request failed: {r.status_code} | {r.text}")
        return r.json()

    result = await loop.run_in_executor(None, _call)
    logger.info("========== STAGE 2 FULL RESPONSE ==========")
    logger.info(json.dumps(result, indent=2))

    try:
        content_text = result["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as e:
        raise Exception(f"Unexpected OpenRouter response shape (stage 2): {result}") from e

    cleaned = content_text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise Exception(f"Failed to parse parameter-wise JSON from OpenRouter (stage 2): {e} | raw={content_text[:500]}")

    params_out = parsed.get("parameters", [])
    if not isinstance(params_out, list):
        raise Exception("OpenRouter response 'parameters' field is not a list (stage 2)")

    normalized = []
    for p in params_out:
        content_val = (p.get("content") or "").strip()
        if content_val:
            normalized.append({
                "parameter_name": p.get("parameter_name") or "Other",
                "found": bool(p.get("found", True)),
                "date": p.get("date") or "Unknown",
                "date_raw_text": p.get("date_raw_text"),
                "date_confidence": p.get("date_confidence", "high"),
                "content": content_val,
            })

    return normalized


async def extract_parameterwise_content_openai(file_url: str, filename: str, parameters) -> Dict:
    """
    Runs the full two-stage extraction for an oncology investigation:
      Stage 1 — GPT-4o Vision: literal plain-text transcription.
      Stage 2 — GPT-4o Text: split that transcription by investigation parameter,
                tagging each parameter with its own best-effort date.
    """
    raw_transcription = await extract_raw_transcription_openai(file_url, filename)
    logger.info(f"Stage 1 (vision) transcription complete ({len(raw_transcription)} chars)")
    if len(raw_transcription) < 200:
        logger.warning(f"Stage 1 transcription looks suspiciously short, full content: {raw_transcription!r}")

    parameterwise_content = await split_transcription_into_parameters_openai(raw_transcription, parameters)
    logger.info(f"Stage 2 parameter-split complete ({len(parameterwise_content)} parameter entries)")

    return {
        "raw_transcription": raw_transcription,
        "parameterwise_content": parameterwise_content,
    }


def resolve_parameter_date(entry: Dict, fallback_date: Optional[str]) -> Optional[str]:
    """
    Decides which date to actually use for a given parameter entry:
      - use the parameter's own extracted date if it's present, not "Unknown",
        and high-confidence
      - otherwise fall back to the investigation-level document_date
        (e.g. investigation['date_of_order'])
    """
    entry_date = entry.get("date")
    entry_confidence = entry.get("date_confidence", "high")

    if entry_date and entry_date != "Unknown" and entry_confidence == "high":
        return entry_date

    return fallback_date


# ------------------- HELPERS (entity extraction / validation / graph push) -------------------
# Same logic as the handwritten pipeline, entity-type rules unchanged.

async def get_patient_demographics(patient_id: str):
    patient = await patient_user_collection.find_one({"sys_user_id": patient_id})

    if not patient:
        return {"age": None, "sex": None}

    gender = patient.get("gender")
    dob = patient.get("date_of_birth")
    age = None

    if dob:
        try:
            if isinstance(dob, str):
                dob = datetime.strptime(dob, "%Y-%m-%d")
            today = datetime.utcnow()
            age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
        except Exception:
            age = None

    return {"age": age, "sex": gender}


async def extract_entities_llm(text: str):
    prompt = f"""
You are a clinical-grade medical information extraction engine.
Your job is to extract EVERY clinically relevant data point from the provided text — completely,
faithfully, and with zero fabrication.

=== TWO EQUALLY CRITICAL FAILURE MODES TO AVOID ===
A) UNDER-EXTRACTION (missing data): every clinical fact in the text — every symptom, finding,
   diagnosis, procedure, medication, lab value, vital sign, anatomical reference, measurement,
   investigation, and treatment instruction — MUST become an entity.
B) OVER-EXTRACTION (fabricated data): you must NEVER create an entity for something that is not
   explicitly, literally present in the text.

STRICT RULE: Extract ONLY what is explicitly written in the text below.
If a field (dose, range, unit, date, etc.) is not present in the text — leave it out entirely.
Do NOT infer, assume, hallucinate, or fill in missing values from external knowledge.

=== ENTITY TYPES ===
Symptom, Finding, Diagnosis, Procedure, Medication, Lab Result, Vital Sign, Anatomy, Measurement,
Investigation, Treatment, Document Date

=== NON-CLINICAL CONTENT — DO NOT EXTRACT ===
Doctor/staff names, qualifications, designations, registration/license numbers, signature blocks,
letterhead text, hospital/lab/clinic names, logos, addresses, phone numbers, emails, page numbers,
headers/footers, print/generation timestamps that aren't a clinical date, disclaimers, watermark
text, blank/unchecked checkboxes with no accompanying text, printed form labels with no filled content.

=== NEGATION RULES ===
If the text explicitly negates a condition ("No evidence of", "No", "Absent", "Negative for",
"Without", "Not seen", "No obvious"), do NOT extract it as a Diagnosis. Extract it as a Finding:
entity_name = "No <condition>" (exact negated phrasing), entity_value = full negated sentence.

=== STRICT PROHIBITIONS ===
- Do NOT extract any value not explicitly written in the text
- Do NOT add entity types beyond the 12 listed above
- Do NOT merge distinct findings or results into one entity
- Do NOT create duplicate entities for the same fact

=== OUTPUT FORMAT ===
Return ONLY valid JSON. No commentary, no markdown fences.
{{
  "entities": [
    {{
      "entity_type": "<one of the types>",
      "entity_name": "<name exactly from text>",
      "entity_value": "<value exactly from text>",
      "confidence": 0.00,
      "evidence_text": "<verbatim or reconstructed text from document>"
    }}
  ]
}}

=== INPUT TEXT (single parameter's content) ===
{text}
"""

    loop = asyncio.get_event_loop()
    completion = await loop.run_in_executor(
        None,
        partial(
            groq_client.chat.completions.create,
            model="llama-3.3-70b-versatile",
            temperature=0.1,
            max_tokens=5000,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
        )
    )
    response = completion.choices[0].message.content

    try:
        data = json.loads(response)
        entities = []
        for e in data.get("entities", []):
            entity_name = e.get("entity_name")
            entity_type = e.get("entity_type")
            if not entity_name or not entity_type:
                continue
            entities.append(
                ExtractedEntity(
                    entity_type=str(entity_type),
                    entity_name=str(entity_name),
                    entity_value=str(e.get("entity_value")) if e.get("entity_value") is not None else None,
                    confidence=float(e.get("confidence", 0.9)),
                    evidence_text=str(e.get("evidence_text", "")),
                )
            )
        return entities
    except Exception as e:
        logger.error(f"LLM entity parsing error: {e}")
        return []


async def validate_entities_llm(original_text: str, entities: List[ExtractedEntity]) -> List[ExtractedEntity]:
    if not entities:
        return entities

    entities_json = json.dumps([e.dict() for e in entities], indent=2)

    validation_prompt = f"""
You are a strict clinical data QA auditor performing a final accuracy pass. Make the entity list match
ORIGINAL_TEXT exactly — nothing missing, nothing extra, nothing misclassified.

STEP 1 — Remove any entity not literally supported by ORIGINAL_TEXT.
STEP 2 — Add any clinical fact in ORIGINAL_TEXT missing from EXTRACTED_ENTITIES.
STEP 3 — Fix negations: a negated condition must never remain a positive Diagnosis; convert to a
         Finding named "No <condition>".
STEP 4 — Leave already-correct entities untouched.

Return ONLY valid JSON, no commentary, no markdown fences:
{{
  "entities": [
    {{
      "entity_type": "<type>",
      "entity_name": "<name exactly from text>",
      "entity_value": "<value exactly from text>",
      "confidence": 0.00,
      "evidence_text": "<verbatim or reconstructed text from document>"
    }}
  ]
}}

=== ORIGINAL_TEXT ===
{original_text}

=== EXTRACTED_ENTITIES ===
{entities_json}
"""

    try:
        loop = asyncio.get_event_loop()
        completion = await loop.run_in_executor(
            None,
            partial(
                groq_client.chat.completions.create,
                model="llama-3.3-70b-versatile",
                temperature=0.0,
                max_tokens=5000,
                response_format={"type": "json_object"},
                messages=[{"role": "user", "content": validation_prompt}],
            )
        )
        response = completion.choices[0].message.content
        data = json.loads(response)

        validated = []
        for e in data.get("entities", []):
            entity_name = e.get("entity_name")
            entity_type = e.get("entity_type")
            if not entity_name or not entity_type:
                continue
            validated.append(
                ExtractedEntity(
                    entity_type=str(entity_type),
                    entity_name=str(entity_name),
                    entity_value=str(e.get("entity_value")) if e.get("entity_value") is not None else None,
                    confidence=float(e.get("confidence", 0.9)),
                    evidence_text=str(e.get("evidence_text", "")),
                )
            )

        if not validated and entities:
            logger.warning("Validation returned empty entity list — falling back to original extraction")
            return entities

        return validated

    except Exception as e:
        logger.error(f"Entity validation error: {e} — falling back to unvalidated entities")
        return entities


async def push_entities_to_graph(patient_id, document_id, entities, metadata, document_date):
    knowledge_graph = await _get_knowledge_graph()

    for e in entities:
        evidence = Evidence(
            evidence_id=f"ev_{uuid4().hex[:10]}",
            document_id=document_id,
            document_name=metadata["file_name"],
            document_type="oncology_investigation",
            document_date=document_date,
            evidence_text=e.evidence_text,
            confidence=e.confidence,
            extraction_date=datetime.utcnow(),
        )

        entity_type = e.entity_type.lower()

        if entity_type == "diagnosis":
            await knowledge_graph.add_diagnosis_with_evidence(
                patient_id=patient_id, diagnosis=e.entity_name, diagnosis_date=document_date,
                record_type="current", confidence=str(e.confidence), evidence=evidence,
            )
        elif entity_type == "medication":
            await knowledge_graph.add_medication_with_evidence(
                patient_id=patient_id, drug_name=e.entity_name, dose=e.entity_value or "",
                indication="", start_date=document_date, record_type="current", evidence=evidence,
            )
        elif entity_type == "symptom":
            await knowledge_graph.add_symptom_with_evidence(
                patient_id=patient_id, symptom=e.entity_name, onset_date=document_date,
                severity=None, record_type="current", evidence=evidence,
            )
        elif entity_type == "lab result":
            await knowledge_graph.add_lab_result_with_evidence(
                patient_id=patient_id, test_name=e.entity_name, value=e.entity_value or "",
                test_date=document_date, record_type="current", is_abnormal=False, evidence=evidence,
            )
        elif entity_type == "vital sign":
            await knowledge_graph.add_vital_sign_with_evidence(
                patient_id=patient_id, vital_type=e.entity_name, value=e.entity_value or "",
                measurement_date=document_date, is_abnormal=False, evidence=evidence,
            )
        elif entity_type == "anatomy":
            await knowledge_graph.add_anatomy_with_evidence(patient_id, e.entity_name, document_date, evidence)
        elif entity_type == "finding":
            await knowledge_graph.add_finding_with_evidence(patient_id, e.entity_name, document_date, evidence)
        elif entity_type == "procedure":
            await knowledge_graph.add_procedure_with_evidence(patient_id, e.entity_name, document_date, evidence)
        elif entity_type == "measurement":
            await knowledge_graph.add_measurement_with_evidence(patient_id, e.entity_name, document_date, evidence)
        elif entity_type == "treatment":
            await knowledge_graph.add_treatment_with_evidence(
                patient_id, e.entity_name, e.entity_value or "", document_date, evidence,
            )


def create_chunks(sections: List[dict], document_id: str):
    chunks = []
    for sec in sections:
        content = sec.get("content", "")
        heading = sec.get("heading", "general")
        for sentence in content.split("."):
            sentence = sentence.strip()
            if len(sentence) > 30:
                chunks.append({"document_id": document_id, "section": heading, "text": sentence})
    return chunks


def create_timeline_parameterwise(entities_with_param, document_id):
    """
    entities_with_param is now a list of (entity, param_name, param_date) tuples —
    each entity carries the date resolved for ITS OWN parameter, not a single
    document-wide date.
    """
    timeline = []
    for e, param_name, param_date in entities_with_param:
        timeline.append({
            "document_id": document_id,
            "event_type": e.entity_type,
            "entity": e.entity_name,
            "parameter": param_name,
            "date": param_date,
            "recorded_at": datetime.utcnow(),
        })
    return timeline


# =====================================================================
# MAIN ENTRY POINT — called directly with `await` from the router,
# no Celery involved.
# =====================================================================

async def process_oncology_investigation(
    file_url: str,
    filename: str,
    patient_id: str,
    doctor_id: str,
    investigation_id: int,
    parameters,
):
    document_id = None
    try:
        investigation = await oncology_investigations_collection.find_one({
            "doctor_id": doctor_id,
            "patient_id": patient_id,
            "id": investigation_id,
        })
        if not investigation:
            raise Exception(f"Investigation not found: doctor={doctor_id} patient={patient_id} id={investigation_id}")

        # This is the investigation-level fallback date — used only when a
        # given parameter's own extracted date is missing/low-confidence.
        document_date = investigation.get("date_of_order")
        document_date_str = document_date.isoformat() if isinstance(document_date, datetime) else document_date

        # -------------------------------------------------------
        # STEP 1: Two-stage GPT-4o extraction
        #   Stage 1 — GPT-4o Vision: literal full transcription
        #   Stage 2 — GPT-4o Text: split transcription by parameter,
        #             each tagged with its own best-effort date
        # -------------------------------------------------------
        extraction_result = await extract_parameterwise_content_openai(file_url, filename, parameters)
        raw_transcription = extraction_result["raw_transcription"]
        parameterwise_content = extraction_result["parameterwise_content"]

        

        full_markdown = raw_transcription
        parameterwise_markdown = "\n\n".join(
            f"### Parameter: {p['parameter_name']} (date: {p.get('date', 'Unknown')})\n{p['content']}"
            for p in parameterwise_content
        )

        sections = [{"heading": p["parameter_name"], "content": p["content"]} for p in parameterwise_content]
        tables = []

        file_hash = hashlib.sha256(file_url.encode()).hexdigest()
        document_id = f"doc_{file_hash[:10]}"
        file_name = file_url.split("/")[-1]

        metadata = {
            "document_id": document_id,
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "file_name": file_name,
            "file_hash": file_hash,
            "processing_date": datetime.utcnow(),
            "document_date": document_date_str,
        }

        # -------------------------------------------------------
        # STEP 2: entity extraction + validation + graph push,
        # per parameter — each parameter now resolves its OWN date
        # (falling back to the investigation's date_of_order only
        # when the parameter's date is missing/low-confidence)
        # -------------------------------------------------------
        demographics = await get_patient_demographics(patient_id)
        knowledge_graph = await _get_knowledge_graph()
        await knowledge_graph.create_patient_node(
            patient_id=patient_id,
            demographics=demographics,
            visit_date=datetime.utcnow().isoformat(),
        )

        entities_with_param = []  # list of (entity, param_name, resolved_date)

        for entry in parameterwise_content:
            param_name = entry["parameter_name"]
            entry_content = entry["content"]
            resolved_date = resolve_parameter_date(entry, document_date_str)

            raw_entities = await extract_entities_llm(entry_content)
            logger.info(f"[{param_name} | {resolved_date}] Extracted {len(raw_entities)} raw entities")

            validated_entities = await validate_entities_llm(entry_content, raw_entities)
            logger.info(f"[{param_name} | {resolved_date}] {len(validated_entities)} entities after validation")

            await push_entities_to_graph(
                patient_id, document_id, validated_entities, metadata, resolved_date,
            )

            for e in validated_entities:
                entities_with_param.append((e, param_name, resolved_date))

        entities = [e for e, _, _ in entities_with_param]

        chunks = create_chunks(sections, document_id)
        timeline = create_timeline_parameterwise(entities_with_param, document_id)

        # -------------------------------------------------------
        # STEP 3: persist everything
        # -------------------------------------------------------
        await processed_documents.insert_one({
            "document_id": document_id,
            "investigation_id": investigation_id,
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "file_url": file_url,
            "file_name": file_name,
            "og_file_name": filename,
            "metadata": metadata,
            "raw_markdown": full_markdown,
            "parameterwise_markdown": parameterwise_markdown,
            "sections": {"tables": tables, "sections": sections},
            "parameterwise_content": parameterwise_content,
            "entities": [e.dict() for e in entities],
        })

        for c in chunks:
            c["patient_id"] = patient_id
            await semantic_chunks.insert_one(c)

        for t in timeline:
            t["patient_id"] = patient_id
            await timeline_events.insert_one(t)

        for e, param_name, resolved_date in entities_with_param:
            await document_evidence.insert_one({
                "patient_id": patient_id,
                "document_id": document_id,
                "entity_type": e.entity_type,
                "entity_name": e.entity_name,
                "evidence_text": e.evidence_text,
                "confidence": e.confidence,
                "parameter": param_name,
                "document_date": resolved_date,
            })

        # -------------------------------------------------------
        # STEP 4: mark the investigation completed
        # -------------------------------------------------------
        await oncology_investigations_collection.update_one(
            {"doctor_id": doctor_id, "patient_id": patient_id, "id": investigation_id},
            {"$set": {"document_id": document_id, "status": "completed"}},
        )

        return {
            "status": "success",
            "file_url": file_url,
            "document_id": document_id,
            "raw_transcription": raw_transcription,
            "parameterwise_content": parameterwise_content,
        }

    except Exception as e:
        logger.error(f"process_oncology_investigation failed | investigation_id={investigation_id} | {e}", exc_info=True)
        try:
            await oncology_investigations_collection.update_one(
                {"doctor_id": doctor_id, "patient_id": patient_id, "id": investigation_id},
                {"$set": {"status": "failed", "error": str(e)}},
            )
        except Exception:
            pass
        return {"status": "failed", "error": str(e), "file_url": file_url}