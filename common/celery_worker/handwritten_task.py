import os
import base64
import threading
from datetime import datetime
from celery import Celery
from celery.signals import worker_process_init, worker_process_shutdown
import requests
import tempfile
import json
import hashlib
from typing import Union
from typing import Dict, List, Optional
from pydantic import BaseModel
from groq import Groq
from functools import partial
from loguru import logger
from uuid import uuid4
from common.llm.enhanced_knowledge_graph import EnhancedMedicalKnowledgeGraph
import asyncio
from common.llm.build_visit_timeline_task import build_timeline_incremental
from pdf2image import convert_from_bytes
from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient


# ------------------- CONFIG -------------------
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB")

sync_client = MongoClient(MONGO_URI)
temp_documents_collection = sync_client[MONGO_DB].temp_documents
processed_documents = sync_client[MONGO_DB].processed_documents
semantic_chunks = sync_client[MONGO_DB].semantic_chunks
timeline_events = sync_client[MONGO_DB].timeline_events
document_evidence = sync_client[MONGO_DB].document_evidence
processing_tracker = sync_client[MONGO_DB].processing_tracker
appointments_collection = sync_client[MONGO_DB].patient_appointments
neo4j_uri = os.getenv("NEO4J_URI", "bolt://neo4j:7687")
neo4j_user = os.getenv("NEO4J_USER", "neo4j")
neo4j_password = os.getenv("NEO4J_PASSWORD", "password")

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client = Groq(api_key=GROQ_API_KEY)

# ------------------- OPENROUTER (GPT-4o) CONFIG ------------------
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "openai/gpt-4o")

# Vision model: how many PDF pages to send per API request.
# GPT-4o supports up to 10 images per message; we batch in groups
# of VISION_BATCH_SIZE and concatenate the transcriptions.
VISION_BATCH_SIZE = int(os.getenv("VISION_BATCH_SIZE", "8"))

# DPI used when rasterising PDF pages for the vision model.
# 200 dpi gives a good balance between readability and token cost.
VISION_DPI = int(os.getenv("VISION_DPI", "200"))


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
# PERSISTENT EVENT LOOP (one per worker process)
# =====================================================================
_worker_loop: Optional[asyncio.AbstractEventLoop] = None
_worker_loop_thread: Optional[threading.Thread] = None

async_client: Optional[AsyncIOMotorClient] = None
db = None
patient_user_collection = None
knowledge_graph: Optional[EnhancedMedicalKnowledgeGraph] = None


def _start_worker_loop():
    """Runs forever in a background thread, hosting the persistent event loop."""
    global _worker_loop
    _worker_loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_worker_loop)
    logger.info("🔁 Persistent asyncio event loop started for this worker process")
    _worker_loop.run_forever()


def _ensure_worker_loop_running():
    """Starts the background loop thread once per process, idempotently."""
    global _worker_loop_thread
    if _worker_loop_thread is None or not _worker_loop_thread.is_alive():
        _worker_loop_thread = threading.Thread(
            target=_start_worker_loop, name="persistent-asyncio-loop", daemon=True
        )
        _worker_loop_thread.start()
        while _worker_loop is None:
            pass


async def _init_async_clients():
    """
    Creates Motor client + EnhancedMedicalKnowledgeGraph (and therefore the
    Neo4j async driver) INSIDE the persistent loop, exactly once.
    """
    global async_client, db, patient_user_collection, knowledge_graph

    if knowledge_graph is not None:
        return  # already initialized

    async_client = AsyncIOMotorClient(MONGO_URI)
    db = async_client[MONGO_DB]
    patient_user_collection = db["patient_users"]

    knowledge_graph = EnhancedMedicalKnowledgeGraph(
        uri=neo4j_uri,
        user=neo4j_user,
        password=neo4j_password,
        mongo_db=db
    )
    logger.info("✅ Async Mongo + Neo4j knowledge graph clients initialized on persistent loop")


def run_coroutine_on_worker_loop(coro):
    """
    Submits a coroutine to the persistent worker-process event loop and
    blocks the calling (Celery task) thread until it's done.
    """
    _ensure_worker_loop_running()
    future = asyncio.run_coroutine_threadsafe(coro, _worker_loop)
    return future.result()  # blocks this thread, NOT the event loop thread


@worker_process_init.connect
def _on_worker_process_init(**kwargs):
    """Celery calls this once per forked worker process — start our loop here."""
    _ensure_worker_loop_running()
    run_coroutine_on_worker_loop(_init_async_clients())


@worker_process_shutdown.connect
def _on_worker_process_shutdown(**kwargs):
    """Best-effort cleanup when a worker process exits."""
    global _worker_loop
    try:
        if knowledge_graph is not None:
            run_coroutine_on_worker_loop(knowledge_graph.close())
    except Exception as e:
        logger.warning(f"Error closing knowledge_graph driver on shutdown: {e}")

    if _worker_loop is not None:
        _worker_loop.call_soon_threadsafe(_worker_loop.stop)


# ------------------- CELERY APP -------------------
celery_app = Celery(
    "handwritten_tasks",
    broker=os.getenv("CELERY_BROKER_URL"),
    backend=None
)


# =====================================================================
# STAGE 1: RAW, LITERAL TRANSCRIPTION VIA GPT-4o VISION
# =====================================================================
# Each PDF page is rasterised to a JPEG image and sent to GPT-4o Vision
# via OpenRouter.  The model reads the images and returns a complete,
# literal, unstructured transcription — no grouping by date, no JSON.
# This approach gives superior handwriting recognition vs. the native
# PDF text-extraction plugin, and lets us explicitly instruct the model
# to skip decorative / non-clinical visual elements.

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
    (e.g. "☑ Diabetes" — transcribe as "☑ Diabetes"; do NOT transcribe an unchecked
    blank box on its own)
  - Clinical images or diagrams only when they contain embedded text or annotations
    (transcribe the text/annotation; do NOT describe the image itself)

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
    """
    Converts raw PDF bytes into a list of base64-encoded JPEG strings
    (one entry per page) using pdf2image / poppler.

    Returns:
        List[str]: each element is a pure base64 string (no data-URI prefix).
    """
    pages = convert_from_bytes(pdf_bytes, dpi=dpi, fmt="jpeg")
    b64_pages = []
    for page_img in pages:
        buf = tempfile.SpooledTemporaryFile(max_size=10 * 1024 * 1024)
        page_img.save(buf, format="JPEG", quality=85)
        buf.seek(0)
        b64_pages.append(base64.b64encode(buf.read()).decode("utf-8"))
        buf.close()
    return b64_pages


def _call_vision_api_for_pages(
    b64_images: List[str],
    page_offset: int,
    total_pages: int,
) -> str:
    """
    Sends a batch of base64 JPEG page images to GPT-4o Vision via OpenRouter
    and returns the raw transcription text for those pages.

    Args:
        b64_images:   List of base64-encoded JPEG strings for the batch.
        page_offset:  0-based index of the first page in this batch
                      (used only for logging / error messages).
        total_pages:  Total number of pages in the document
                      (used only for logging / error messages).

    Returns:
        str: Raw transcription text returned by the model.
    """
    if not OPENROUTER_API_KEY:
        raise Exception("OPENROUTER_API_KEY is not set")

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "HTTP-Referer": "https://your-site.com",
        "X-Title": "Medical Document Analyzer",
        "Content-Type": "application/json",
    }

    # Build the content list: text prompt first, then one image block per page.
    content: List[Dict] = [{"type": "text", "text": STAGE1_TRANSCRIPTION_PROMPT}]

    for idx, b64 in enumerate(b64_images):
        content.append({
            "type": "image_url",
            "image_url": {
                "url": f"data:image/jpeg;base64,{b64}",
                "detail": "high",   # use high-detail mode for handwriting accuracy
            },
        })
        # After each image block, inject a lightweight page-label hint so the
        # model knows which physical page it is looking at.
        global_page_num = page_offset + idx + 1
        content.append({
            "type": "text",
            "text": f"[The image above is Page {global_page_num} of {total_pages}]",
        })

    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [{"role": "user", "content": content}],
        "temperature": 0.0,
        # No response_format — stage 1 returns plain text, not JSON.
    }

    response = requests.post(
        url=OPENROUTER_URL, headers=headers, json=payload, timeout=300
    )
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
        raise Exception(
            f"Unexpected OpenRouter response shape (stage 1 vision): {result}"
        ) from e

    return (content_text or "").strip()


def extract_raw_transcription_openai(file_url: str, filename: str) -> str:
    """
    STAGE 1 — GPT-4o Vision transcription.

    Workflow:
      1. Download the PDF from file_url.
      2. Rasterise every page to a JPEG image via pdf2image / poppler.
      3. Send pages in batches of VISION_BATCH_SIZE to GPT-4o Vision
         via OpenRouter.
      4. Concatenate the per-batch transcriptions in page order and
         return the combined plain-text transcription.

    The Vision approach replaces the previous native-PDF-plugin approach
    and gives materially better results on handwritten / mixed documents.
    """
    # ── 1. Download the PDF ────────────────────────────────────────────
    dl_response = requests.get(file_url, timeout=120)
    if dl_response.status_code != 200:
        raise Exception(
            f"Stage 1: failed to download PDF for vision processing: "
            f"{file_url} (HTTP {dl_response.status_code})"
        )
    pdf_bytes = dl_response.content
    logger.info(f"Stage 1: downloaded PDF ({len(pdf_bytes):,} bytes) — converting to images")

    # ── 2. Rasterise pages ────────────────────────────────────────────
    try:
        b64_pages = _pdf_bytes_to_base64_images(pdf_bytes, dpi=VISION_DPI)
    except Exception as e:
        raise Exception(f"Stage 1: PDF→image conversion failed: {e}") from e

    total_pages = len(b64_pages)
    logger.info(f"Stage 1: {total_pages} page(s) rasterised at {VISION_DPI} dpi")

    if total_pages == 0:
        raise Exception("Stage 1: PDF produced zero pages after rasterisation")

    # ── 3. Call Vision API in batches ─────────────────────────────────
    transcription_parts: List[str] = []

    for batch_start in range(0, total_pages, VISION_BATCH_SIZE):
        batch = b64_pages[batch_start: batch_start + VISION_BATCH_SIZE]
        batch_end = batch_start + len(batch)
        logger.info(
            f"Stage 1: sending pages {batch_start + 1}–{batch_end} "
            f"of {total_pages} to GPT-4o Vision"
        )

        batch_text = _call_vision_api_for_pages(
            b64_images=batch,
            page_offset=batch_start,
            total_pages=total_pages,
        )

        # Strip stray markdown fences if the model added them
        if batch_text.startswith("```"):
            batch_text = batch_text.strip("`").strip()
            if batch_text.lower().startswith("text"):
                batch_text = batch_text[4:].strip()

        if not batch_text:
            logger.warning(
                f"Stage 1: vision API returned empty text for pages "
                f"{batch_start + 1}–{batch_end}"
            )
        else:
            transcription_parts.append(batch_text)

    # ── 4. Combine batch results ─────────────────────────────────────
    raw_transcription = "\n\n".join(transcription_parts).strip()

    if not raw_transcription:
        raise Exception("Stage 1 vision transcription returned empty content for all pages")

    return raw_transcription


# =====================================================================
# STAGE 2: SPLIT THE RAW TRANSCRIPTION INTO DATE-WISE JSON
# =====================================================================
# Takes the literal Stage 1 transcription (plain text) and asks GPT-4o
# to segment it by every date/time it finds, without re-reading the PDF
# or re-doing OCR — purely a structuring pass over text it has already
# faithfully extracted.

STAGE2_DATE_SPLIT_PROMPT = """You are a meticulous medical document date-segmentation engine.

You will be given a RAW_TRANSCRIPTION below — a literal, already-faithful transcription of a medical
document, in its original page order. Your job is to split this transcription into date-wise entries.
You are NOT re-reading any image or PDF — work only from the text given to you. Do not add, remove, or
reword any content; only reorganize/segment it.

=== ABSOLUTE FIDELITY RULES (HIGHEST PRIORITY) ===
1. NEVER invent, guess, or "auto-correct" a date that is not legibly present in RAW_TRANSCRIPTION.
   - If a date is partially illegible, smudged, or ambiguous (including ones already marked
     "[unclear: ...]" in the transcription), keep it as-is and set "date_confidence": "low". Do NOT
     silently normalize it to a different, cleaner-looking date.
   - Only convert to YYYY-MM-DD format if you are confident in every digit. If not fully confident,
     put your best-effort raw transcription in "date" AND copy the literal text into "date_raw_text".
   - It is FAR better to under-commit to a date than to fabricate one. A wrong date is worse than
     "Unknown".
   - Indian medical records commonly use DD/MM/YY or DD/MM/YYYY format — do not assume US MM/DD format.
2. Every single date that appears in RAW_TRANSCRIPTION must produce its own entry. Do not merge two
   distinct dates into one, and do not drop a date because its content seems short or repetitive.
3. DO NOT summarize, shorten, paraphrase, or "clean up" any wording from RAW_TRANSCRIPTION. Copy the
   content verbatim into each date's "content" field, preserving medical abbreviations, symbols (☐, →,
   x, /, ②, ①, etc.) and structure exactly as they appear in RAW_TRANSCRIPTION.
4. DO NOT omit ANY text, value, table, note, bullet point, checkbox, drug name, dose, instruction, or
   paragraph associated with a date — including content that looks repetitive, illegible, or unclear.
5. If content for the same date appears in multiple places in RAW_TRANSCRIPTION, merge it into a
   single entry, preserving the original order it appears in.
6. Include EVERYTHING tied to that date: names, numbers, IDs, amounts, timestamps, addresses, remarks,
   medication names/doses/frequencies, lab values, impressions, findings, checkbox states, and
   signatures with their associated dates.
7. If a section visually continues after a page break under the same date heading, keep that content
   under the same date until a new date clearly begins in RAW_TRANSCRIPTION.
8. Ignore ONLY page numbers, repeated headers/footers, watermarks, and QR-code/barcode boilerplate
   that carry no clinical or date-specific content. Do NOT skip letterhead text that contains a date
   (e.g. a printed visit date) — extract the date even if the surrounding text (doctor name,
   registration number) is otherwise excluded from "content".
9. If a date is written in different formats (e.g. 01/02/2024, February 1 2024, 2024-02-01) and you
   are confident they refer to the same calendar date, normalize them to the SAME canonical date.
10. If a piece of information cannot be confidently assigned to any specific date, place it under
    "date": "Unknown" — do not force it onto the nearest date as a guess.
11. DO NOT add any interpretation, diagnosis, or clinical inference that is not explicitly present in
    RAW_TRANSCRIPTION. You are segmenting, not diagnosing.
12. Checkboxes (☐/☑) or blank fields are NOT findings by themselves — keep their visual state
    (checked/unchecked/blank) as transcribed, but do not convert an unchecked or blank box into a
    clinical statement ("no X") unless RAW_TRANSCRIPTION explicitly states a negative finding in words.

=== OUTPUT FORMAT ===
Return ONLY valid JSON, no commentary, no markdown fences:
{
  "dates": [
    {
      "date": "YYYY-MM-DD or best-effort raw text if uncertain",
      "date_raw_text": "literal text/handwriting as it appears (omit if date was fully unambiguous)",
      "date_confidence": "high | low",
      "content": "Complete, exhaustive, original content for this date without omitting anything."
    }
  ]
}

CRITICAL REQUIREMENT:
The segmentation must be exhaustive and faithful to RAW_TRANSCRIPTION. Do not skip, summarize, or
fabricate any content or any date. Every sentence, table row, list item, value, annotation, checkbox,
and note associated with a date must be included in that date's "content". If you are not sure a date
is correct, say so via date_confidence rather than presenting a guess as fact. Return only the JSON
object and no additional explanation.

=== RAW_TRANSCRIPTION ===
__RAW_TRANSCRIPTION_PLACEHOLDER__
"""


def split_transcription_into_dates_openai(raw_transcription: str) -> List[Dict]:
    """
    STAGE 2: Sends the Stage 1 raw transcription (plain text) to GPT-4o via
    OpenRouter and asks it to segment that text into date-wise JSON entries.
    Returns a list of {"date": ..., "date_raw_text":..., "date_confidence":..., "content": ...} dicts.
    """
    if not OPENROUTER_API_KEY:
        raise Exception("OPENROUTER_API_KEY is not set")

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "HTTP-Referer": "https://your-site.com",
        "X-Title": "Medical Document Analyzer",
        "Content-Type": "application/json"
    }

    prompt = STAGE2_DATE_SPLIT_PROMPT.replace("__RAW_TRANSCRIPTION_PLACEHOLDER__", raw_transcription)

    messages = [
        {
            "role": "user",
            "content": prompt
        }
    ]

    payload = {
        "model": OPENROUTER_MODEL,
        "messages": messages,
        "temperature": 0.0,
        "response_format": {"type": "json_object"}
    }

    response = requests.post(url=OPENROUTER_URL, headers=headers, json=payload, timeout=180)
    if response.status_code != 200:
        raise Exception(f"OpenRouter (stage 2 - date split) request failed: {response.status_code} | {response.text}")

    result = response.json()

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
        raise Exception(f"Failed to parse date-wise JSON from OpenRouter (stage 2): {e} | raw={content_text[:500]}")

    dates = parsed.get("dates", [])
    if not isinstance(dates, list):
        raise Exception("OpenRouter response 'dates' field is not a list (stage 2)")

    normalized = []
    for d in dates:
        date_val = d.get("date") or "Unknown"
        content_val = (d.get("content") or "").strip()
        if content_val:
            normalized.append({
                "date": date_val,
                "date_raw_text": d.get("date_raw_text"),
                "date_confidence": d.get("date_confidence", "high"),
                "content": content_val
            })

    return normalized


def extract_datewise_content_openai(file_url: str, filename: str) -> Dict:
    """
    Runs the full two-stage extraction:
      Stage 1 — GPT-4o Vision: rasterise PDF pages and get a literal,
                unstructured plain-text transcription (decorative elements ignored).
      Stage 2 — GPT-4o Text: split that transcription into date-wise JSON entries.

    Returns {"raw_transcription": str, "datewise_content": List[Dict]}
    so callers have access to both the literal transcription AND the
    structured date-wise breakdown.
    """
    raw_transcription = extract_raw_transcription_openai(file_url, filename)
    logger.info(f"Stage 1 (vision) transcription complete ({len(raw_transcription)} chars)")
    if len(raw_transcription) < 200:
        logger.warning(f"Stage 1 transcription looks suspiciously short, full content: {raw_transcription!r}")

    datewise_content = split_transcription_into_dates_openai(raw_transcription)
    logger.info(f"Stage 2 date-split complete ({len(datewise_content)} date entries)")

    return {
        "raw_transcription": raw_transcription,
        "datewise_content": datewise_content
    }


# ------------------- SINGLE ASYNC PIPELINE -------------------
# All async work for a task is combined into one coroutine, which gets
# submitted to the persistent worker-process event loop (see above)
# instead of being run via asyncio.run().

async def run_full_async_pipeline(
    datewise_content: List[Dict],
    file_url: str,
    filename: str,
    patient_id: str,
    doctor_id: str,
    appointment_id: str,
    structure: dict,
):
    """
    For each date entry:
      1. extract entities via Groq LLM
      2. validate entities (cross-check vs original content for missing/extra)
      3. push validated entities to the knowledge graph

    Returns combined results across all dates.
    """
    await _init_async_clients()  # no-op if already initialized

    file_hash = hashlib.sha256(file_url.encode()).hexdigest()
    document_id = f"doc_{file_hash[:10]}"
    file_name = file_url.split("/")[-1]

    valid_dates = sorted([
        d["date"] for d in datewise_content
        if d["date"] != "Unknown" and d.get("date_confidence", "high") == "high"
    ])
    primary_document_date = valid_dates[0] if valid_dates else None

    metadata = {
        "document_id": document_id,
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "file_name": file_name,
        "file_hash": file_hash,
        "processing_date": datetime.utcnow(),
        "document_date": primary_document_date
    }

    demographics = await get_patient_demographics(patient_id)

    await knowledge_graph.create_patient_node(
        patient_id=patient_id,
        demographics=demographics,
        visit_date=datetime.utcnow().isoformat()
    )

    all_entities_with_date = []  # list of (entity, date)

    for entry in datewise_content:
        entry_date = entry["date"]
        entry_content = entry["content"]

        # Step 1 — entity extraction for this date's content
        raw_entities, _ = await extract_entities_llm(entry_content)
        logger.info(f"[{entry_date}] Extracted {len(raw_entities)} raw entities")

        # Step 2 — validate (check for missing / hallucinated / extra entities)
        validated_entities = await validate_entities_llm(entry_content, raw_entities)
        logger.info(f"[{entry_date}] {len(validated_entities)} entities after validation")

        # Step 3 — push this date's entities to the graph
        await push_entities_to_graph(
            patient_id,
            document_id,
            validated_entities,
            metadata,
            entry_date if entry_date != "Unknown" else primary_document_date
        )
        await build_timeline_incremental(
            patient_id=patient_id,
            doctor_id=doctor_id,
            appointment_id=appointment_id,
            document_id=document_id,
            report_date=entry_date,
            report_content=entry_content,
            file_name=file_name,
        )
        for e in validated_entities:
            all_entities_with_date.append((e, entry_date))

    return all_entities_with_date, primary_document_date, document_id, file_name, metadata


# ------------------- TASK -------------------
@celery_app.task(name="handwritten.process_handwritten_document")
def process_handwritten_document(
    filename: str,
    doc_type: str = None,
    category_key: str = None,
    subcategory_key: str = None,
    report_date: str = None,
    file_url: str = None,
    patient_id: str = None,
    appointment_id: str = None,
    doctor_id: str = None,
    hospital_id: str = None,
    structure: dict = None
):
    temp_file_path = None
    document_id = None

    try:
        # -------------------------------------------------------
        # STEP 1: Two-stage GPT-4o extraction
        #   Stage 1 — GPT-4o Vision: literal full transcription (plain text)
        #             PDF pages are rasterised and sent as images;
        #             decorative elements are ignored by the model.
        #   Stage 2 — GPT-4o Text: split transcription into date-wise
        #             content (JSON).
        # -------------------------------------------------------
        extraction_result = extract_datewise_content_openai(file_url, filename)
        raw_transcription = extraction_result["raw_transcription"]
        datewise_content = extraction_result["datewise_content"]

        if not datewise_content:
            raise Exception("No date-wise content extracted from document")

        # full_markdown is now the literal Stage 1 transcription — the
        # most faithful representation of the original document — with a
        # date-wise rendering kept alongside it for readability/debugging.
        full_markdown = raw_transcription
        datewise_markdown = "\n\n".join(
            f"### Date: {d['date']}\n{d['content']}" for d in datewise_content
        )

        sections = [{"heading": d["date"], "content": d["content"]} for d in datewise_content]
        tables = []

        response = requests.get(file_url, timeout=60)
        if response.status_code != 200:
            raise Exception(f"Failed to download file: {file_url}")

        with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(filename)[1]) as tmp:
            tmp.write(response.content)
            temp_file_path = tmp.name

        # -------------------------------------------------------
        # STEP 2: run the async pipeline on the PERSISTENT worker
        # event loop (not asyncio.run()) — entity extraction +
        # validation + graph pipeline, per date
        # -------------------------------------------------------
        entities_with_date = []
        try:
            entities_with_date, document_date, document_id, file_name, metadata = run_coroutine_on_worker_loop(
                run_full_async_pipeline(
                    datewise_content=datewise_content,
                    file_url=file_url,
                    filename=filename,
                    patient_id=patient_id,
                    doctor_id=doctor_id,
                    appointment_id=appointment_id,
                    structure=structure or {},
                )
            )

            entities = [e for e, _ in entities_with_date]

            chunks = create_chunks(sections, document_id)
            timeline = create_timeline_datewise(entities_with_date, document_id)

            temp_documents_collection.insert_one({
                "patient_id": patient_id,
                "doctor_id": doctor_id,
                "appointment_id": appointment_id,
                "file_name": filename,
                "file_url": file_url,
                "upload_mode": "handwritten",
                "parsed_text": full_markdown,
                "status": "parsed",
                "created_at": datetime.utcnow()
            })

            processed_documents.insert_one({
                "document_id": document_id,
                "patient_id": patient_id,
                "doctor_id": doctor_id,
                "appointment_id": appointment_id,
                "file_url": file_url,
                "file_name": file_name,
                "og_file_name": filename,
                "metadata": metadata,
                "structure": structure or {},
                "raw_markdown": full_markdown,
                "datewise_markdown": datewise_markdown,
                "sections": {"tables": tables, "sections": sections},
                "datewise_content": datewise_content,
                "entities": [e.dict() for e in entities]
            })
            
            
            for c in chunks:
                c["patient_id"] = patient_id
                semantic_chunks.insert_one(c)

            for t in timeline:
                t["patient_id"] = patient_id
                timeline_events.insert_one(t)

            for e, e_date in entities_with_date:
                document_evidence.insert_one({
                    "patient_id": patient_id,
                    "document_id": document_id,
                    "entity_type": e.entity_type,
                    "entity_name": e.entity_name,
                    "evidence_text": e.evidence_text,
                    "confidence": e.confidence,
                    "document_date": e_date
                })

        except Exception as graph_err:
            logger.error(f"Graph pipeline error | doc={document_id} | {graph_err}", exc_info=True)

        if temp_file_path and os.path.exists(temp_file_path):
            os.remove(temp_file_path)

        update_processing_progress_sync(patient_id, doctor_id)

        return {
            "status": "success",
            "file_url": file_url,
            "raw_transcription": raw_transcription,
            "datewise_content": datewise_content,
            "full_markdown": full_markdown
        }

    except Exception as e:
        logger.error(f"process_handwritten_document failed | {e}", exc_info=True)
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except Exception:
                pass
        return {
            "status": "failed",
            "error": str(e),
            "file_url": file_url
        }


# ------------------- HELPERS -------------------

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
   investigation, and treatment instruction — MUST become an entity. Skipping a real clinical fact
   is a patient safety risk. Before finalizing, re-read the text line by line and confirm each
   clinical statement has a corresponding entity.
B) OVER-EXTRACTION (fabricated data): you must NEVER create an entity for something that is not
   explicitly, literally present in the text. No inference, no "this probably means X", no filling
   in normal/expected values, no creating an entity from an empty checkbox, blank field, or printed
   form label that has no handwritten content next to it.

Both failure modes are equally serious. Re-check your output against both before returning it.

STRICT RULE: Extract ONLY what is explicitly written in the text below.
If a field (dose, range, unit, date, etc.) is not present in the text — leave it out entirely.
Do NOT infer, assume, hallucinate, or fill in missing values from external knowledge.
Do NOT copy values from examples into output.

=== ENTITY TYPES ===

- Symptom
- Finding
- Diagnosis
- Procedure
- Medication
- Lab Result
- Vital Sign
- Anatomy
- Measurement
- Investigation
- Treatment
- Document Date

=== NON-CLINICAL CONTENT — DO NOT EXTRACT ===
Ignore and do NOT create entities from any of the following, even if they contain numbers, dates, or capitalized words:
  - Doctor/staff names, qualifications, designations (e.g. "MBBS", "MD", "DM", "DNB", "Consultant Radiologist", "Pathologist")
  - Registration/license/council numbers (e.g. "Reg No", "Registration No", "MMC No", "Council Reg No", any state medical council ID)
  - Signature blocks, letterhead text, hospital/lab/clinic names, logos, addresses, phone numbers, emails, websites
  - Image/markdown placeholders such as "<!-- image -->", "[image]", "[logo]", scan artifacts
  - Page numbers, "Page X of Y", headers/footers repeated across pages
  - Report generation/print timestamps that are NOT a Report Date, Collection Date, Procedure Date, Order Date,
    Visit Date, Admission Date, or Discharge Date (e.g. "Printed on", "Generated on", a bare time-of-day stamp
    attached to a signature line)
  - Disclaimers, watermark text, "This is a computer-generated report" type boilerplate
  - Any line that is administrative/non-clinical in nature and does not describe the patient's condition,
    test results, findings, treatment, or care
  - If a line or phrase mixes a name/title with a number (e.g. "Dr. X ... Reg No: 2021/03/1871"), treat the
    WHOLE line as non-clinical noise — do NOT extract a fragment of it (such as a stray word like "Bee") as
    an Anatomy, Finding, or any other entity. When in doubt about whether something is clinical content or
    letterhead/signature noise, DO NOT extract it.
  - Printed/blank form field labels with no handwritten or filled-in content next to them (e.g. a printed
    "Diagnosis:" label followed by nothing, or an unchecked/blank checkbox ☐ with no accompanying text) are
    NOT entities. A category label is not itself clinical data — only extract what was actually written,
    checked, or circled.

=== MAPPING RULES FOR COMPLEX CLINICAL DATA ===

STAGING & GRADING → map to "Diagnosis"
  - TNM, FIGO, Ann Arbor, Gleason, ISUP, CKD stage, NYHA, Child-Pugh, BIRADS, LIVERADS, APACHE II
  - entity_name  = staging system name
  - entity_value = stage/grade exactly as written in the text

RADIOLOGY / PATHOLOGY IMPRESSIONS → map to "Finding"
  - entity_name  = "Radiologist Impression" or "Pathology Impression"
  - entity_value = full impression text exactly as written

IMAGING OBSERVATIONS (individual findings) → map to "Finding"
  - One entity per distinct observation
  - entity_name  = finding label
  - entity_value = descriptive detail as written

LESION / ORGAN SIZES & DIMENSIONS → map to "Measurement"
  - entity_name  = what is being measured
  - entity_value = value and unit exactly as written

FOLLOW-UP / RECOMMENDATIONS → map to "Treatment"
  - entity_name  = "Recommendation" or specific action
  - entity_value = instruction exactly as written

ABNORMALITY FLAGS → embed inside "Lab Result" entity_value only
  - Derive flag from the normal range IF the range is explicitly stated in the text
  - If no range is present in the text, do NOT add a flag
  - Flag logic (apply only when range is present in text):
      Result > upper limit           → "| flag: HIGH"
      Result < lower limit           → "| flag: LOW"
      Result in borderline zone      → "| flag: BORDERLINE"
      Critically out of range        → "| flag: CRITICAL HIGH" or "| flag: CRITICAL LOW"
      Result within normal range     → "| flag: NORMAL"
  - entity_value format (include only parts present in text):
    "<result> <unit> | range: <normal range> | flag: <derived flag>"

=== ENTITY-SPECIFIC RULES ===

Lab Result:
  - Every test with a result value = one Lab Result entity
  - entity_name  = test name exactly as written
  - entity_value = result and unit as written; append range and flag only if present in text
  - evidence_text = reconstruct as: "Test: [name], Result: [value] [unit], Range: [range if present]"
  - Do NOT merge multiple tests into one entity

Vital Sign:
  - Only: BP, HR, RR, SpO2, Temperature, Height, Weight, BMI, Pulse
  - Do NOT extract Age, Sex, Gender, or Patient ID as Vital Sign

Diagnosis:
  - Confirmed or suspected conditions AND all staging/grading mentioned in text
  - NEVER extract a diagnosis that the text negates (see NEGATION RULES below)

Finding:
  - Imaging observations, exam findings, pathology findings
  - One entity per distinct finding
  - Includes NEGATIVE findings (see NEGATION RULES below)

Measurement:
  - Sizes, dimensions, volumes, ejection fraction, or numeric clinical parameters
    that are NOT lab results or vital signs

Investigation:
  - Ordered, recommended, pending, or follow-up investigations mentioned in text
  - entity_name  = investigation name
  - entity_value = purpose or instruction exactly as written

Medication:
  - Every distinct drug mentioned with a dose, frequency, route, or duration = one Medication entity
  - entity_value = include only the parts present in text: drug, dose, frequency, route, duration
  - Do not skip any medication in a list, even short ones (e.g. "T. DOLO 650 1-1-1 x 3 Days")

Treatment:
  - Non-pharmacological interventions, planned procedures, recommendations, follow-ups, consultations
    advised (e.g. "Radiotherapy consultation for further management", "Cardiology consultation")

Document Date:
  - Extract every date found in the text that is tied to a clinical event
    (Report Date, Collection Date, Procedure Date, Order Date, Visit Date, Admission Date, Discharge Date)
  - Do NOT extract print/generation timestamps or signature-line timestamps as Document Date

=== NEGATION RULES ===

If the report explicitly states a negative using language such as:
- No evidence of ...
- No ...
- Absent ...
- Negative for ...
- Without ...
- Not seen ...
- No obvious ...

DO NOT extract the condition/abnormality itself as a Diagnosis.

Instead, extract it as a Finding:
  entity_name  = "No <condition>" (preserve the exact negated phrasing)
  entity_value = the full negated sentence exactly as written

Example:
  Text: "No obvious destructive bony lesion is seen on this study."
  ❌ WRONG → Diagnosis: "destructive bony lesion"
  ✅ CORRECT → Finding: entity_name="No destructive bony lesion",
                entity_value="No obvious destructive bony lesion is seen on this study."

This applies consistently to all negated findings (e.g. "No pleural effusion", "No pneumothorax",
"No mediastinal lymphadenopathy", "No pericardial effusion", "No acute aortic abnormality", "no stridor").

IMPORTANT: negation only applies when the text EXPLICITLY contains negating words. An unchecked/blank
checkbox with NO accompanying text is not a negation — it is simply not extracted at all (see
NON-CLINICAL CONTENT rules above).

=== STRICT PROHIBITIONS ===
- Do NOT extract any value not explicitly written in the text
- Do NOT use external medical knowledge to fill gaps
- Do NOT add entity types beyond the 11 listed above
- Do NOT merge distinct findings or results into one entity
- Do NOT split a single fact into multiple redundant entities
- Do NOT add flags, ranges, doses, or units unless they appear in the text
- Do NOT extract anything from doctor credentials, registration numbers, letterhead, signature blocks,
  image placeholders, or other non-clinical content described above
- Do NOT create duplicate entities for the same fact — if the same fragment appears multiple times
  due to OCR repetition, extract it only ONCE
- Do NOT convert a negated finding into a positive Diagnosis
- Do NOT invent a "No X" finding unless the text contains an explicit negation word

=== SELF-CHECK BEFORE RETURNING (perform silently, do not output this section) ===
1. Re-read the INPUT TEXT line by line. For every clinical statement, confirm an entity exists.
2. For every entity in your draft output, confirm the exact supporting phrase exists in INPUT TEXT.
   If you cannot point to the supporting text, delete the entity.
3. Confirm no entity was created from a doctor name, registration number, letterhead, blank checkbox,
   or empty form label.
4. Confirm no Diagnosis entity contradicts a negation in the text.
5. Confirm no duplicate entities exist for the same fact.

=== OUTPUT FORMAT ===
Return ONLY valid JSON. No commentary, no markdown fences.

{{
  "entities": [
    {{
      "entity_type": "<one of the 11 types>",
      "entity_name": "<name exactly from text>",
      "entity_value": "<value exactly from text>",
      "confidence": 0.00,
      "evidence_text": "<verbatim or reconstructed text from document>"
    }}
  ]
}}

=== INPUT TEXT (single date's content) ===
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
        return entities, None
    except Exception as e:
        logger.error(f"LLM entity parsing error: {e}")
        return [], None


async def validate_entities_llm(original_text: str, entities: List[ExtractedEntity]) -> List[ExtractedEntity]:
    """
    Cross-checks extracted entities against the original date-content:
    - removes entities NOT supported by the text (hallucinated / extra)
    - adds any clearly missed clinical entity that should have been extracted
    - fixes negation errors (Diagnosis that should be a negative Finding)
    Returns the corrected entity list. On any failure, falls back to the
    original (unvalidated) entity list so the pipeline never loses data.
    """
    if not entities:
        return entities

    entities_json = json.dumps([e.dict() for e in entities], indent=2)

    validation_prompt = f"""
You are a strict clinical data QA auditor performing a final accuracy pass. Your single most important
job is to make the entity list match the ORIGINAL_TEXT exactly — nothing missing, nothing extra,
nothing misclassified.

You will be given:
1. ORIGINAL_TEXT — the source clinical text for a single date.
2. EXTRACTED_ENTITIES — entities a junior model extracted from ORIGINAL_TEXT.

=== YOUR TASKS, IN ORDER ===

STEP 1 — REMOVE FABRICATIONS:
For every entity in EXTRACTED_ENTITIES, check if its entity_name and entity_value are actually,
literally supported by ORIGINAL_TEXT. If you cannot point to the specific words in ORIGINAL_TEXT that
justify the entity, DELETE it. This includes:
  - Entities built from blank/unchecked checkboxes or empty form labels with no handwritten content
  - Entities that paraphrase or "interpret" rather than reflect what's actually written
  - Duplicate entities representing the same fact twice

STEP 2 — RECOVER MISSED ENTITIES:
Re-read ORIGINAL_TEXT line by line. For every clinical fact (matching one of these 11 types: Symptom,
Finding, Diagnosis, Procedure, Medication, Lab Result, Vital Sign, Anatomy, Measurement, Investigation,
Treatment) that does NOT already have a corresponding entity in EXTRACTED_ENTITIES, ADD it as a new
entity. This includes:
  - Medications in a numbered list where only some were extracted
  - Individual imaging findings within a longer impression where only the overall impression was captured
  - Measurements, lab values, or vital signs embedded in running text
  - Any symptom, finding, or instruction mentioned only once and easy to miss
entity_value/evidence_text for newly added entities must be taken exactly from ORIGINAL_TEXT — never
invent values for an added entity.

STEP 3 — FIX NEGATIONS:
If the ORIGINAL_TEXT contains a negation phrase ("No evidence of", "No", "Without", "Absent",
"Negative for", "Not seen", "No obvious") connected to a condition, and EXTRACTED_ENTITIES lists that
condition as a positive Diagnosis, then:
  - remove the Diagnosis entity
  - replace it with a Finding entity, entity_name = "No <condition>" preserving exact wording,
    entity_value = the full negated sentence as written
  - never leave a negated condition as a positive Diagnosis

Example:
  Text: "No pleural effusion."
  ❌ Diagnosis: "Pleural effusion"  → must become →  ✅ Finding: "No pleural effusion"

STEP 4 — LEAVE CORRECT ENTITIES UNTOUCHED:
Do not alter, reword, or "improve" any entity that is already accurate and well-supported.

=== FINAL SELF-CHECK (perform silently) ===
- Does every entity in your final list have a literal anchor in ORIGINAL_TEXT? If not, remove it.
- Does every clinical fact in ORIGINAL_TEXT have a corresponding entity in your final list? If not, add it.
- Are there zero duplicate entities for the same fact?
- Are there zero positive Diagnosis entities for explicitly negated conditions?

Return ONLY valid JSON in this format, no commentary, no markdown fences:
{{
  "entities": [
    {{
      "entity_type": "<one of the 11 types>",
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
    for e in entities:
        evidence = Evidence(
            evidence_id=f"ev_{uuid4().hex[:10]}",
            document_id=document_id,
            document_name=metadata["file_name"],
            document_type="clinical_document",
            document_date=document_date,
            evidence_text=e.evidence_text,
            confidence=e.confidence,
            extraction_date=datetime.utcnow()
        )

        entity_type = e.entity_type.lower()

        if entity_type == "diagnosis":
            await knowledge_graph.add_diagnosis_with_evidence(
                patient_id=patient_id,
                diagnosis=e.entity_name,
                diagnosis_date=document_date,
                record_type="current",
                confidence=str(e.confidence),
                evidence=evidence
            )
        elif entity_type == "medication":
            await knowledge_graph.add_medication_with_evidence(
                patient_id=patient_id,
                drug_name=e.entity_name,
                dose=e.entity_value or "",
                indication="",
                start_date=document_date,
                record_type="current",
                evidence=evidence
            )
        elif entity_type == "symptom":
            await knowledge_graph.add_symptom_with_evidence(
                patient_id=patient_id,
                symptom=e.entity_name,
                onset_date=document_date,
                severity=None,
                record_type="current",
                evidence=evidence
            )
        elif entity_type == "lab result":
            await knowledge_graph.add_lab_result_with_evidence(
                patient_id=patient_id,
                test_name=e.entity_name,
                value=e.entity_value or "",
                test_date=document_date,
                record_type="current",
                is_abnormal=False,
                evidence=evidence
            )
        elif entity_type == "vital sign":
            await knowledge_graph.add_vital_sign_with_evidence(
                patient_id=patient_id,
                vital_type=e.entity_name,
                value=e.entity_value or "",
                measurement_date=document_date,
                is_abnormal=False,
                evidence=evidence
            )
        elif entity_type == "anatomy":
            await knowledge_graph.add_anatomy_with_evidence(
                patient_id, e.entity_name, document_date, evidence
            )
        elif entity_type == "finding":
            await knowledge_graph.add_finding_with_evidence(
                patient_id, e.entity_name, document_date, evidence
            )
        elif entity_type == "procedure":
            await knowledge_graph.add_procedure_with_evidence(
                patient_id, e.entity_name, document_date, evidence
            )
        elif entity_type == "measurement":
            await knowledge_graph.add_measurement_with_evidence(
                patient_id, e.entity_name, document_date, evidence
            )
        elif entity_type == "treatment":
            await knowledge_graph.add_treatment_with_evidence(
                patient_id, e.entity_name, e.entity_value or "", document_date, evidence
            )


def create_chunks(sections: List[dict], document_id: str):
    chunks = []
    for sec in sections:
        content = sec.get("content", "")
        heading = sec.get("heading", "general")
        for sentence in content.split("."):
            sentence = sentence.strip()
            if len(sentence) > 30:
                chunks.append({
                    "document_id": document_id,
                    "section": heading,
                    "text": sentence
                })
    return chunks


def create_timeline_datewise(entities_with_date, document_id):
    timeline = []
    for e, e_date in entities_with_date:
        timeline.append({
            "document_id": document_id,
            "event_type": e.entity_type,
            "entity": e.entity_name,
            "date": e_date if e_date and e_date != "Unknown" else None,
            "recorded_at": datetime.utcnow()
        })
    return timeline


def update_processing_progress_sync(patient_id: str, doctor_id: str):
    tracker = processing_tracker.find_one({
        "patient_id": patient_id,
        "doctor_id": doctor_id
    })

    if not tracker:
        return

    processing_tracker.update_one(
        {"patient_id": patient_id, "doctor_id": doctor_id},
        {"$inc": {"processed_documents": 1}}
    )

    updated = processing_tracker.find_one({
        "patient_id": patient_id,
        "doctor_id": doctor_id
    })

    if not updated:
        return

    processed = updated.get("processed_documents", 0)
    total = updated.get("total_documents", 0)

    if processed >= total:
        processing_tracker.update_one(
            {"patient_id": patient_id, "doctor_id": doctor_id},
            {"$set": {"status": "completed"}}
        )