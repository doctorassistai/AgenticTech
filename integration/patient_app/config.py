"""
patient_app/config.py

All settings come from environment variables (the shared .env via env_file).

IMPORTANT: this code lives inside the `integration` container, which also runs
hospital imports. A bad patient_app setting must never stop that service from
starting, so nothing here raises at import time. Instead problems are logged and
the patient routes answer 503 (see AUTH_CONFIGURED and auth.py).
"""

import logging
import os
from datetime import timedelta, timezone
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("patient_app.config")


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        logger.error("%s=%r is not an integer, using %s", name, raw, default)
        return default


# ---------- shared with the gateway (which signs the patient JWTs) ----------
SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
_RAW_MONGO_URI = os.getenv("MONGO_URI")

# DB name is hard-coded across the whole codebase
MONGO_DB = "doctorassistai"

AUTH_CONFIGURED = bool(SECRET_KEY) and bool(ALGORITHM) and ALGORITHM.strip().lower() != "none"
if not AUTH_CONFIGURED:
    logger.error("SECRET_KEY / ALGORITHM missing or invalid: patient routes will return 503")

if _RAW_MONGO_URI:
    MONGO_URI = _RAW_MONGO_URI
else:
    logger.error("MONGO_URI is not set: patient routes will return 503")
    MONGO_URI = "mongodb://mongo-not-configured.invalid:27017"  # fails on use, never hits a wrong DB

# ---------- behaviour ----------
PATIENT_TZ = os.getenv("PATIENT_TZ", "Asia/Kolkata")
try:
    TZ = ZoneInfo(PATIENT_TZ)
except Exception:
    # tzdata missing in the image, or a bad name. All patients are in India (no DST),
    # so a fixed +05:30 offset is a correct stand-in until tzdata is installed.
    logger.error("PATIENT_TZ=%r unavailable (is tzdata installed?), falling back to fixed IST +05:30", PATIENT_TZ)
    TZ = timezone(timedelta(hours=5, minutes=30))

SHOW_DIAGNOSIS_TO_PATIENT = _bool("SHOW_DIAGNOSIS_TO_PATIENT", True)
CHECKIN_MAX_SYMPTOMS = 40      # hard ceiling used by validation
CHECKIN_TARGET_SYMPTOMS = 18   # what the model is asked for
CHECKIN_LLM_MAX_TOKENS = 8000  # gpt-oss reasoning tokens count against this
# ---------- check-in question generation (step 3) ----------
GROQ_API_KEY = os.getenv("GROQ_API_KEY")  # without it, rule-based questions are used
CHECKIN_LLM_MODEL = os.getenv("CHECKIN_LLM_MODEL", "openai/gpt-oss-20b")

# ---------- check-in photo capture + vision extraction ----------
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")  # without it, photo extraction is skipped entirely
PHOTO_VISION_MODEL = os.getenv("PHOTO_VISION_MODEL", "gpt-4o-mini")
STORAGE_BASE_URL = os.getenv("STORAGE_BASE_URL")
MAX_PHOTO_BYTES = _int("PATIENT_APP_MAX_PHOTO_BYTES", 8_000_000)  # 8 MB
# Clinical note text is already meant to be concise (per the vision prompt); this
# is a hard backstop cap on what ever reaches build_llm_context, same role as
# MAX_FREE_TEXT_SUMMARY_CHARS plays for the note/free-text summaries.
MAX_PHOTO_SUMMARY_CHARS = 240
# ---------- request limits (rule 7) ----------
MAX_BODY_BYTES = _int("PATIENT_APP_MAX_BODY_BYTES", 262_144)  # 256 KB
MAX_NOTE_CHARS = 2000
# Free-text answers to individual questions reuse the note character limit
# (same risk profile as the note field, so no separate cap needed there).
MAX_FREE_TEXT_CHARS = MAX_NOTE_CHARS

# The condensed "LLM version" of any free text (note + per-question answers)
# that gets fed back into future build_llm_context() calls. Deliberately
# much shorter than MAX_NOTE_CHARS/MAX_FREE_TEXT_CHARS — this is a summary,
# not a copy, and a hard cap here is a second line of defence if the
# summarization call ever returns something longer than asked.
MAX_FREE_TEXT_SUMMARY_CHARS = 240
MAX_ARRAY_ITEMS = 200

SUPPORTED_LANGS = ("en", "hi", "ml")