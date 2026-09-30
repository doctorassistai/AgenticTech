"""
store.py — Persistent, versioned cache for generated chemotherapy workflow data.

Saved results are stored in `chemo_agentic_store` collection so agents do not re-run
on every page visit. Insert-only pattern: each generation pushes a new versioned document,
keeping previous versions in silent history.
"""

import os
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from .data_sources import get_mongo_db

COLLECTION_NAME = "chemo_agentic_store"

# In-memory fallback if MongoDB is not connected
_IN_MEMORY_STORE: Dict[str, List[Dict[str, Any]]] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _get_collection():
    db = get_mongo_db()
    if db is not None:
        return db[COLLECTION_NAME]
    return None


def get_latest(patient_id: str, slug: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Retrieves the newest saved generation for a patient (or patient + module slug).
    """
    coll = _get_collection()
    query: Dict[str, Any] = {"patient_id": patient_id}
    if slug:
        query["slug"] = slug

    if coll is not None:
        try:
            doc = coll.find_one({**query, "latest": True})
            if not doc:
                doc = coll.find_one(query, sort=[("version", -1)])
            if doc:
                doc["_id"] = str(doc["_id"])
                return doc
        except Exception as e:
            print(f"[chemo_store] Mongo get_latest warning: {e}")

    # In-memory fallback
    key = f"{patient_id}:{slug or 'full'}"
    history = _IN_MEMORY_STORE.get(key, [])
    return history[-1] if history else None


def save(
    data: Dict[str, Any],
    *,
    patient_id: str,
    doctor_id: Optional[str] = None,
    slug: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Inserts a NEW version of generated chemotherapy workflow data.
    Never overwrites existing records; demotes prior latest to preserve history.
    """
    coll = _get_collection()
    query: Dict[str, Any] = {"patient_id": patient_id}
    if slug:
        query["slug"] = slug

    if coll is not None:
        try:
            prev = coll.find_one(query, sort=[("version", -1)])
            next_version = (prev.get("version", 0) + 1) if prev else 1

            coll.update_many({**query, "latest": True}, {"$set": {"latest": False}})

            doc = {
                "patient_id": patient_id,
                "doctor_id": doctor_id,
                "slug": slug or "full_workflow",
                "version": next_version,
                "generatedAt": _now_iso(),
                "latest": True,
                "data": data,
            }
            res = coll.insert_one(doc)
            doc["_id"] = str(res.inserted_id)
            return doc
        except Exception as e:
            print(f"[chemo_store] Mongo save error, using fallback: {e}")

    # Fallback in memory
    key = f"{patient_id}:{slug or 'full'}"
    history = _IN_MEMORY_STORE.setdefault(key, [])
    next_version = len(history) + 1
    doc = {
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "slug": slug or "full_workflow",
        "version": next_version,
        "generatedAt": _now_iso(),
        "latest": True,
        "data": data,
    }
    history.append(doc)
    return doc


def list_history(patient_id: str, slug: Optional[str] = None, limit: int = 20) -> List[Dict[str, Any]]:
    """
    Returns historical versions metadata for a patient (newest first).
    """
    coll = _get_collection()
    query: Dict[str, Any] = {"patient_id": patient_id}
    if slug:
        query["slug"] = slug

    if coll is not None:
        try:
            cursor = coll.find(query, {"data": 0}).sort("version", -1).limit(limit)
            out = []
            for d in cursor:
                d["_id"] = str(d["_id"])
                out.append(d)
            return out
        except Exception as e:
            print(f"[chemo_store] Mongo list_history error: {e}")

    key = f"{patient_id}:{slug or 'full'}"
    history = _IN_MEMORY_STORE.get(key, [])
    return [
        {
            "patient_id": h["patient_id"],
            "slug": h["slug"],
            "version": h["version"],
            "generatedAt": h["generatedAt"],
            "latest": h.get("latest", False),
        }
        for h in reversed(history[:limit])
    ]
