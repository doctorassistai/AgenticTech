"""
store.py — Persistent, versioned cache for generated dashboard data.

Generated module results are saved to the `radiation_onco_agentic` collection so the
agents do NOT re-run on every page visit. The store is INSERT-ONLY: each generation
pushes a new versioned document, so prior versions remain as a silent history.

Read/write pattern used by the API:
    load latest   → get_latest(patientId, slug)          # page visit
    if missing    → agent.run(...) then save(...)         # first generation
    regenerate    → agent.run(...) then save(...)         # button → new version

A document looks like:
    {
      "_id": ObjectId,
      "patientId": "PAT-...",
      "doctorId": "DOC-...",
      "moduleId": "m9",
      "slug": "documentation",
      "version": 3,                 # monotonic per (patientId, slug)
      "generatedAt": "2026-08-10T09:14:00Z",
      "data": { ...ModuleResult.to_dict()... },   # exactly what the frontend renders
      "latest": true                # only the newest version per key is flagged
    }

Nothing here touches rt-record-details / radiotherapy_records (reference-only).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .data_sources import get_mongo_db

COLLECTION = "radiation_onco_agentic"


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _coll():
    return get_mongo_db()[COLLECTION]


def _key(patient_id: Optional[str], slug: str) -> Dict[str, Any]:
    return {"patientId": patient_id, "slug": slug}


async def get_latest(patient_id: Optional[str], slug: str) -> Optional[Dict[str, Any]]:
    """Newest saved generation for (patient, module), or None if never generated."""
    doc = await _coll().find_one(
        {**_key(patient_id, slug), "latest": True},
    )
    if doc is None:
        # Fallback for records saved before the `latest` flag existed.
        doc = await _coll().find_one(_key(patient_id, slug), sort=[("version", -1)])
    return _clean(doc)


async def save(
    module_data: Dict[str, Any],
    *,
    patient_id: Optional[str],
    doctor_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Insert a NEW version of a module's generated data. Never overwrites; the prior
    latest is demoted so history is preserved. Returns the stored document.
    """
    slug = module_data.get("slug") or ""
    coll = _coll()

    prev = await coll.find_one(_key(patient_id, slug), sort=[("version", -1)])
    next_version = (prev.get("version", 0) + 1) if prev else 1

    # Demote any current "latest" for this key (kept, just no longer newest).
    await coll.update_many(
        {**_key(patient_id, slug), "latest": True},
        {"$set": {"latest": False}},
    )

    document = {
        "patientId": patient_id,
        "doctorId": doctor_id,
        "moduleId": module_data.get("moduleId"),
        "slug": slug,
        "version": next_version,
        "generatedAt": _now_iso(),
        "data": module_data,
        "latest": True,
    }
    result = await coll.insert_one(document)
    document["_id"] = result.inserted_id
    return _clean(document)


async def list_versions(
    patient_id: Optional[str], slug: str, limit: int = 20
) -> List[Dict[str, Any]]:
    """History of generations for a module, newest first (metadata only)."""
    cursor = _coll().find(
        _key(patient_id, slug),
        {"data": 0},
    ).sort("version", -1).limit(limit)
    return [_clean(d) async for d in cursor]


async def ensure_indexes() -> None:
    """Idempotent index setup; safe to call at app startup."""
    coll = _coll()
    await coll.create_index([("patientId", 1), ("slug", 1), ("version", -1)])
    await coll.create_index([("patientId", 1), ("slug", 1), ("latest", 1)])


def _clean(doc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Stringify _id so the document is JSON-serializable for the API."""
    if doc is None:
        return None
    doc = dict(doc)
    if "_id" in doc:
        doc["_id"] = str(doc["_id"])
    return doc
