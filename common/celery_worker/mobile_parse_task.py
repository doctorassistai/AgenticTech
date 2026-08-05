import base64
import io
import logging
import os
import re
from datetime import datetime, timezone, timedelta
from functools import partial

import requests
from pymongo import MongoClient

from .celery_app import celery_app

logger = logging.getLogger(__name__)
IST = timezone(timedelta(hours=5, minutes=30))

MONGO_URI = os.getenv("MONGO_URI")
_client = MongoClient(MONGO_URI)
_db = _client["doctorassistai"]
parse_tasks_collection = _db["parse_tasks"]

# ── OpenRouter config — same env vars as case_documents_router.py ──────────
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_URL      = os.getenv("OPENROUTER_URL", "https://openrouter.ai/api/v1/chat/completions")
OPENROUTER_MODEL    = os.getenv("OPENROUTER_MODEL", "openai/gpt-4o")
VISION_BATCH_SIZE   = int(os.getenv("OPENROUTER_VISION_BATCH_SIZE", "8"))
VISION_DPI          = int(os.getenv("OPENROUTER_VISION_DPI", "200"))

# Same literal-transcription prompt used by the web advanced-upload path —
# kept identical so mobile and web parsing behave the same way.
OPENROUTER_DOC_PARSE_PROMPT = """You are a meticulous document transcription engine for an insurance
investigation company. You are given one or more page images from a document, which may be a hospital
record, insurance policy, ID card, accident report, bill, prescription, or similar.

Transcribe EVERY piece of text visible on each page, completely and literally:
  - All printed and handwritten text, including headers, footers, letterhead, tables, and labels
  - Names, titles, designations, registration/license numbers
  - Policy numbers, claim numbers, reference numbers, dates, amounts
  - ID card numbers (e.g. Aadhaar, PAN, Voter ID, Driving Licence) — transcribe the full number exactly
    as printed, including any grouping (e.g. "9813 1170 0414")
  - Contact details: phone numbers, mobile numbers, email addresses, addresses
  - Table contents, checkbox states (only if checked/ticked and labelled), stamps (transcribe the text
    inside a stamp, not the stamp graphic itself)
  - Clinical content: diagnoses, findings, medications, vitals, lab values, procedures, instructions

Do NOT:
  - Summarize, paraphrase, or rewrite anything
  - Correct spelling, grammar, or normalize abbreviations
  - Infer or fill in missing/unclear text — if a fragment is unreadable, write [unclear: <visible part>]
  - Describe purely decorative elements (logos as images, watermarks, background patterns, QR/barcodes
    as graphics) — but DO transcribe any text contained within them
  - Add commentary, interpretation, or explanations of any kind

Preserve the original reading order and all symbols exactly as they appear (→ ← × ☑ ☐ + - / % ° @ # &).
Preserve all dates, times, and numbers exactly as written — do not reformat them.

OUTPUT FORMAT — you MUST use exactly this format, with one block per page image provided:

<!-- PAGE_START: N -->
<complete literal transcription of page N>
<!-- PAGE_END: N -->

Repeat for every page image given to you, using the page number stated alongside each image. Do not
add any text before the first block or after the last block — no preamble, no summary, no explanation.
"""


def _pdf_bytes_to_base64_images(pdf_bytes: bytes, dpi: int = VISION_DPI) -> list[str]:
    from pdf2image import convert_from_bytes

    pages = convert_from_bytes(pdf_bytes, dpi=dpi, fmt="jpeg")
    b64_pages = []
    for page_img in pages:
        buf = io.BytesIO()
        page_img.save(buf, format="JPEG", quality=85)
        buf.seek(0)
        b64_pages.append(base64.b64encode(buf.read()).decode("utf-8"))
    return b64_pages


def _call_openrouter_vision(b64_images: list[str], page_offset: int, total_pages: int) -> str:
    if not OPENROUTER_API_KEY:
        raise ValueError("OPENROUTER_API_KEY is not configured")

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "HTTP-Referer": "https://your-site.com",
        "X-Title": "Insurance Document Analyzer",
        "Content-Type": "application/json",
    }

    content: list[dict] = [{"type": "text", "text": OPENROUTER_DOC_PARSE_PROMPT}]
    for idx, b64 in enumerate(b64_images):
        global_page_num = page_offset + idx + 1
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "high"},
        })
        content.append({
            "type": "text",
            "text": f"[The image above is Page {global_page_num} of {total_pages}]",
        })

    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [{"role": "user", "content": content}],
        "temperature": 0.0,
    }

    response = requests.post(OPENROUTER_URL, headers=headers, json=payload, timeout=300)
    if response.status_code != 200:
        raise Exception(
            f"OpenRouter vision request failed (pages {page_offset + 1}-"
            f"{page_offset + len(b64_images)} of {total_pages}): "
            f"{response.status_code} | {response.text}"
        )

    result = response.json()
    try:
        text = result["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as e:
        raise Exception(f"Unexpected OpenRouter response shape: {result}") from e

    text = (text or "").strip()
    if text.startswith("```"):
        text = text.strip("`").strip()
        if text.lower().startswith(("markdown", "text")):
            text = text.split("\n", 1)[1] if "\n" in text else ""
    return text


def _openrouter_parse_sync(content: bytes, filename: str) -> tuple[str, int]:
    """Synchronous version for use inside a Celery (non-async) task."""
    is_pdf = filename.lower().endswith(".pdf")

    if is_pdf:
        b64_pages = _pdf_bytes_to_base64_images(content, VISION_DPI)
    else:
        b64_pages = [base64.b64encode(content).decode("utf-8")]

    total_pages = len(b64_pages)
    if total_pages == 0:
        raise ValueError("Document produced zero pages after conversion")

    transcription_parts = []
    for batch_start in range(0, total_pages, VISION_BATCH_SIZE):
        batch = b64_pages[batch_start: batch_start + VISION_BATCH_SIZE]
        batch_text = _call_openrouter_vision(batch, batch_start, total_pages)
        if batch_text:
            transcription_parts.append(batch_text)
        else:
            logger.warning(
                "OpenRouter vision returned empty text for pages %d-%d of %d",
                batch_start + 1, batch_start + len(batch), total_pages,
            )

    pages_markdown = "\n\n".join(transcription_parts).strip()
    if not pages_markdown:
        raise Exception("OpenRouter vision transcription returned empty content for all pages")

    return pages_markdown, total_pages


# Matches <!-- PAGE_START: N -->...<!-- PAGE_END: N --> blocks and turns
# each one into a section — more useful here than heading-based splitting,
# since this transcription format doesn't use markdown headers.
_PAGE_BLOCK_RE = re.compile(
    r"<!--\s*PAGE_START:\s*(\d+)\s*-->(.*?)<!--\s*PAGE_END:\s*\1\s*-->",
    re.DOTALL,
)


def _split_pages_into_sections(pages_markdown: str) -> list[dict]:
    matches = _PAGE_BLOCK_RE.findall(pages_markdown)
    sections = [
        {"heading": f"Page {num}", "content": text.strip()}
        for num, text in matches
        if text.strip()
    ]
    if not sections:
        # Fallback — no page markers found for some reason, keep it all together
        sections = [{"heading": "Document Content", "content": pages_markdown.strip()}]
    return sections


@celery_app.task(
    name="mobile_parse.parse_document",
    bind=True,
    max_retries=1,
    default_retry_delay=30,
)
def parse_document(self, task_id, file_b64, file_name, step_key, case_id):
    parse_tasks_collection.update_one(
        {"task_id": task_id},
        {"$set": {"status": "processing", "updated_at": datetime.now(IST)}}
    )
    try:
        content = base64.b64decode(file_b64)

        pages_markdown, page_count = _openrouter_parse_sync(content, file_name)
        sections = _split_pages_into_sections(pages_markdown)

        parse_tasks_collection.update_one(
            {"task_id": task_id},
            {"$set": {
                "status": "success",
                "result": {
                    "file_name":    file_name,
                    "page_count":   page_count,
                    "raw_markdown": pages_markdown,
                    "sections":     sections,
                    "char_count":   len(pages_markdown),
                    "step_key":     step_key,
                    "case_id":      case_id,
                },
                "error":      None,
                "updated_at": datetime.now(IST),
            }}
        )
        logger.info("mobile_parse.parse_document succeeded for task %s (%d pages)", task_id, page_count)

    except Exception as exc:
        logger.error("mobile_parse.parse_document failed for task %s: %s", task_id, exc)
        parse_tasks_collection.update_one(
            {"task_id": task_id},
            {"$set": {
                "status":     "failed",
                "error":      str(exc),
                "updated_at": datetime.now(IST),
            }}
        )