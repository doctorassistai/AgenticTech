"""
integration/mact/seed.py

Loads the sample portfolio ONCE, marked is_sample=True so it can be deleted
later (DELETE /hms/mact/cases/samples).

Source file: integration/mact/samples/samples.json, produced from the React app's
cases.js by tools/export_mact_samples.mjs (see README).

"Once" is enforced with a marker document in mact_meta (inserted atomically, so
several integration workers starting together seed only once). Deleting the samples
does NOT clear the marker, so they never come back on restart.

Set MACT_SEED_SAMPLES=false to skip seeding entirely (e.g. production).
"""

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from pymongo.errors import BulkWriteError, DuplicateKeyError

from .db import cases, meta

logger = logging.getLogger("mact.seed")

SAMPLES_PATH = Path(__file__).parent / "samples" / "samples.json"
_MARKER_ID = "samples_seeded"


async def seed_samples() -> None:
    if os.getenv("MACT_SEED_SAMPLES", "true").strip().lower() not in {"1", "true", "yes", "on"}:
        logger.info("sample seeding disabled (MACT_SEED_SAMPLES)")
        return
    if not SAMPLES_PATH.exists():
        logger.warning("no samples file at %s, skipping seed (see README)", SAMPLES_PATH)
        return
    try:
        if await meta.find_one({"_id": _MARKER_ID}):
            return
        now = datetime.now(timezone.utc)
        try:
            await meta.insert_one({"_id": _MARKER_ID, "at": now})
        except DuplicateKeyError:
            return  # another worker got there first

        docs = json.loads(SAMPLES_PATH.read_text(encoding="utf-8"))
        for d in docs:
            d["is_sample"] = True
            d["source"] = "sample"
            d["created_at"] = now
            d["created_by"] = "seed"
        try:
            await cases.insert_many(docs, ordered=False)
        except BulkWriteError as e:
            # e.g. a real case already uses a sample's CNR / id: skip those, keep the rest
            logger.warning("some samples were skipped: %s", len(e.details.get("writeErrors", [])))
        logger.info("seeded %d sample cases", len(docs))
    except Exception:
        logger.exception("sample seeding failed; will retry on next start")
        try:
            await meta.delete_one({"_id": _MARKER_ID})
        except Exception:
            pass