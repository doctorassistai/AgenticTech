"""
integration/mact/db.py

Async Mongo access (Motor) for the MACT module. Same database as the rest of
the platform ("doctorassistai"); all MACT collections are prefixed `mact_`.

  mact_cases      one document per case (same shape the React app uses)
  mact_counters   per-year sequence for case numbers: _id "case:2026" -> {seq}
  mact_events     activity / audit log (Sync page "Event log")
  mact_meta       one-off markers, e.g. "samples_seeded"
  mact_documents  one row per uploaded file (metadata, storage path, parse status)
  mact_doc_pages  parsed page text (markdown) per document page, for extraction and citations

SHARED WITH THE CLAIMS SERVICE (MACT only reads it and adds to its counter):
  llama_usage_stats   {_id: "global_total", credits_used}: LlamaCloud credit budget

READ-ONLY (owned by the login system, never written from here):
  user_auth      used only to confirm a JWT belongs to a real, active user

This code lives inside the `integration` container, which also runs hospital
imports and patient_app. Nothing here may raise at import time: a missing
MONGO_URI is logged and requests fail later instead of stopping the service.
"""

import logging
import os

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING

logger = logging.getLogger("mact.db")

_RAW_MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

if _RAW_MONGO_URI:
    MONGO_URI = _RAW_MONGO_URI
else:
    logger.error("MONGO_URI is not set: MACT routes will fail on use")
    MONGO_URI = "mongodb://mongo-not-configured.invalid:27017"  # fails on use, never hits a wrong DB

client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=5000)
db = client[MONGO_DB]

# ---------------- READ-ONLY ----------------
user_auth = db["user_auth"]

# ---------------- SHARED (claims service owns it) ----------------
llama_stats = db["llama_usage_stats"]

# ---------------- WRITABLE (mact only) ----------------
cases = db["mact_cases"]
counters = db["mact_counters"]
events = db["mact_events"]
meta = db["mact_meta"]
documents = db["mact_documents"]
doc_pages = db["mact_doc_pages"]


async def ensure_indexes() -> None:
    """Idempotent. Failures are logged, not raised, so the service still starts
    if Mongo is briefly unreachable."""
    specs = [
        (cases, [("id", ASCENDING)], {"unique": True}),
        # CNR is the natural key of a petition: one case per CNR.
        (cases, [("cnr", ASCENDING)], {"unique": True}),
        (cases, [("created_at", DESCENDING), ("id", DESCENDING)], {}),
        (cases, [("is_sample", ASCENDING)], {}),
        (cases, [("type", ASCENDING)], {}),
        (events, [("case_id", ASCENDING), ("created_at", DESCENDING)], {}),
        (documents, [("id", ASCENDING)], {"unique": True}),
        (documents, [("case_id", ASCENDING), ("uploaded_at", ASCENDING)], {}),
        # The same file cannot be uploaded twice to one case (a removed file may be uploaded again).
        (documents, [("case_id", ASCENDING), ("sha256", ASCENDING)],
         {"unique": True, "partialFilterExpression": {"deleted": False}}),
        (doc_pages, [("doc_id", ASCENDING), ("page_number", ASCENDING)], {}),
    ]
    for coll, keys, opts in specs:
        try:
            await coll.create_index(keys, **opts)
        except Exception:
            logger.exception("index creation failed on %s", coll.name)
    logger.info("mact indexes ensured")