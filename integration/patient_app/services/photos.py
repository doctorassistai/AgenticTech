"""
patient_app/services/photos.py

Photo capture + vision extraction (REWRITTEN).

- Runs for EVERY patient (consent line added on the consent screen); the
  patient always reviews and edits the result before anything is sent.
- The model detects the photo type itself: food / body / medicine / other,
  and returns short editable items (dishes, visible findings, medicine name).
- Items come back in the patient's language (items_local) AND English
  (items_en). When the patient edits items, routes.py translates only the
  edited ones to English for the doctor (translate_to_english below).
- The doctor only ever sees the patient-CONFIRMED version.
- Fail-closed: any failure leaves status "failed"/"skipped_no_key" with
  nothing invented; the patient can still type items by hand and send.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from base64 import b64encode
from datetime import datetime, timezone
from typing import Optional

import httpx
import requests

from ..config import MAX_PHOTO_SUMMARY_CHARS, OPENAI_API_KEY, PHOTO_VISION_MODEL, STORAGE_BASE_URL
from ..db import patient_checkin_photos

logger = logging.getLogger("patient_app.photos")

VALID_CATEGORIES = {"food", "body", "medicine", "other"}
LANG_NAMES = {"en": "English", "hi": "Hindi", "ml": "Malayalam"}

_PHOTO_SYSTEM_PROMPT = """You look at ONE photo that a cancer patient sent to their care team from a
follow-up app. Decide what the photo is, then list what is visible so the patient can confirm it.

category, exactly one of:
- "food": a meal, plate, snack or drink
- "body": skin, wound, swelling, mouth, hands, feet, or any other body part (or stool/urine)
- "medicine": a tablet, strip, bottle, prescription or injection
- "other": anything else

items: 1 to 8 short entries (max 6 words each).
- food: one entry per dish, food or drink ("Rice", "Dal", "Banana").
- body: one entry per visible finding, with location if visible ("Bruise on left forearm",
  "Red rash on palm", "Swelling near ankle", "Sore on tongue", "Peeling skin on foot").
  Use plain visual words (bruise, rash, redness, swelling, blister, peeling, wound, sore).
  Do NOT name a disease, a cause, a diagnosis or any advice.
- medicine: name and strength exactly as printed ("Pantoprazole 40 mg tablet"). If it cannot
  be read, say "Tablet strip (name not readable)".
- other: what is visible.
If the photo is unclear, return one item "Photo not clear".

Return ONLY JSON, no markdown:
{"category": "food|body|medicine|other",
 "items_en": ["..."],
 "items_local": ["... same order and count, written in __LANG__ ..."],
 "summary_en": "one neutral sentence",
 "summary_local": "one plain sentence in __LANG__",
 "diagnosis_relevant": true or false}
diagnosis_relevant is true only for a body finding a clinician should look at.
If __LANG__ is English, items_local equals items_en."""

_TRANSLATE_PROMPT = """Translate each string from __LANG__ to plain English. Keep medicine names and
numbers unchanged. Return ONLY JSON: {"items": ["..."]} with exactly the same number of entries,
in the same order."""

_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


def _strip_fence(text: str) -> str:
    return _FENCE_RE.sub("", text or "").strip()


async def _mark(photo_id: str, **fields) -> None:
    fields["updated_at"] = datetime.now(timezone.utc)
    await patient_checkin_photos.update_one({"photo_id": photo_id}, {"$set": fields})


def _upload_to_storage_sync(content: bytes, filename: str, content_type: str, patient_id: str) -> tuple:
    if not STORAGE_BASE_URL:
        raise RuntimeError("STORAGE_BASE_URL is not configured")
    files = {"file": (filename, content, content_type)}
    params = {
        "doctor_id": patient_id,
        "patient_id": patient_id,
        "doc_type": "checkin_photo",
        "category": None,
        "subcategory": None,
    }
    response = requests.post(f"{STORAGE_BASE_URL}/upload", params=params, files=files, timeout=60)
    if response.status_code != 200:
        raise RuntimeError(f"storage upload failed: {response.status_code} {response.text}")
    full_path = response.json().get("filename", "")
    if not full_path:
        raise RuntimeError("storage service returned no filename")
    stored_filename = full_path.split("/")[-1]
    return (
        f"{STORAGE_BASE_URL}/files/{patient_id}/{stored_filename}",
        f"{patient_id}/{stored_filename}",
    )


def _clean_list(v, limit: int = 8, maxlen: int = 120) -> list:
    if not isinstance(v, list):
        return []
    out = [str(x).strip()[:maxlen] for x in v if isinstance(x, (str, int, float)) and str(x).strip()]
    return out[:limit]


def _describe_photo_sync(content: bytes, content_type: str, lang: str) -> Optional[dict]:
    if not OPENAI_API_KEY:
        return None
    try:
        from openai import OpenAI
    except Exception:
        logger.exception("openai package unavailable")
        return None

    client = OpenAI(api_key=OPENAI_API_KEY)
    data_uri = f"data:{content_type};base64,{b64encode(content).decode('ascii')}"
    prompt = _PHOTO_SYSTEM_PROMPT.replace("__LANG__", LANG_NAMES.get(lang, "English"))

    for attempt in range(2):
        try:
            resp = client.chat.completions.create(
                model=PHOTO_VISION_MODEL,
                temperature=0.2,
                max_tokens=600,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": [
                        {"type": "text", "text": "Photo from the patient."},
                        {"type": "image_url", "image_url": {"url": data_uri}},
                    ]},
                ],
            )
            parsed = json.loads(_strip_fence(resp.choices[0].message.content or ""))
            if not isinstance(parsed, dict):
                continue
            items_en = _clean_list(parsed.get("items_en"))
            items_local = _clean_list(parsed.get("items_local"))
            if not items_en:
                logger.warning("photo extraction: no items on attempt %d/2", attempt + 1)
                continue
            if lang == "en" or len(items_local) != len(items_en):
                items_local = list(items_en)
            category = parsed.get("category") if parsed.get("category") in VALID_CATEGORIES else "other"
            return {
                "category": category,
                "items_en": items_en,
                "items_local": items_local,
                "summary_en": str(parsed.get("summary_en", "")).strip()[:300],
                "summary_local": str(parsed.get("summary_local", "")).strip()[:300],
                "diagnosis_relevant": bool(parsed.get("diagnosis_relevant", False)),
            }
        except Exception as e:
            logger.warning("photo extraction attempt %d/2 failed: %s", attempt + 1, e)
    return None


def _translate_sync(texts: list, lang: str) -> list:
    """Best effort. On any failure returns the original strings so the doctor
    still gets what the patient wrote."""
    if not texts or lang == "en" or not OPENAI_API_KEY:
        return list(texts)
    try:
        from openai import OpenAI
        client = OpenAI(api_key=OPENAI_API_KEY)
        resp = client.chat.completions.create(
            model=PHOTO_VISION_MODEL,
            temperature=0,
            max_tokens=600,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": _TRANSLATE_PROMPT.replace("__LANG__", LANG_NAMES.get(lang, "English"))},
                {"role": "user", "content": json.dumps({"items": texts}, ensure_ascii=False)},
            ],
        )
        out = json.loads(_strip_fence(resp.choices[0].message.content or "")).get("items")
        if isinstance(out, list) and len(out) == len(texts) and all(isinstance(x, str) for x in out):
            return [x.strip()[:200] or texts[i] for i, x in enumerate(out)]
    except Exception as e:
        logger.warning("translate_to_english failed: %s", e)
    return list(texts)


async def translate_to_english(texts: list, lang: str) -> list:
    return await asyncio.to_thread(_translate_sync, texts, lang)


async def fetch_image(doc: dict) -> Optional[tuple]:
    """(bytes, content_type) from the storage service, or None. The storage
    service is reachable from the integration container without auth
    (same GET caseDocuments.retry uses)."""
    url = (doc or {}).get("photo_url")
    if not url:
        return None
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(url)
        if r.status_code != 200:
            return None
        return r.content, r.headers.get("content-type", "image/jpeg")
    except Exception as e:
        logger.warning("photo fetch failed: %s", e)
        return None


async def process_checkin_photo(
    *,
    photo_id: str,
    patient_id: str,
    content: bytes,
    content_type: str,
    filename: str,
    lang: str,
) -> None:
    """Scheduled via BackgroundTasks. Never raises; always ends in a terminal status."""
    await _mark(photo_id, status="processing")

    try:
        stored_url, storage_path = await asyncio.to_thread(
            _upload_to_storage_sync, content, filename, content_type, patient_id
        )
        await _mark(photo_id, photo_url=stored_url, storage_path=storage_path)
    except Exception as e:
        logger.error("photo %s: storage upload failed: %s", photo_id, e)
        await _mark(photo_id, status="failed", error=f"storage upload failed: {e}")
        return

    if not OPENAI_API_KEY:
        await _mark(photo_id, status="skipped_no_key")
        return

    extracted = await asyncio.to_thread(_describe_photo_sync, content, content_type, lang)
    if extracted is None:
        await _mark(photo_id, status="failed", error="vision extraction failed")
        return

    await _mark(
        photo_id,
        status="success",
        ai=extracted,
        category=extracted["category"],
        patient_description=extracted["summary_local"],
        clinical_note=extracted["summary_en"][:MAX_PHOTO_SUMMARY_CHARS] or None,
    )