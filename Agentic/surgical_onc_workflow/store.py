"""Persistence for generated dashboards — the ONLY writable surface in this package.

Design: the 12-agent pipeline is expensive, so we do NOT run it on every page visit.
Instead each generated dashboard is stored as an immutable SNAPSHOT in the
`surgical_onco_agentic` collection (inside the existing `doctorassistai` DB). A page
visit LOADS the latest snapshot; the "Regenerate" button INSERTS a new one. We never
update or delete, so every regeneration silently keeps history (versioned per patient).

SCOPE OF WRITES: this module writes to `surgical_onco_agentic` and nothing else. Every
other collection (`surgical_oncology`, `oncology_investigations`, `processed_documents`)
is touched read-only by `data_sources.py`. We reuse that module's motor client so there
is a single connection pool.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .data_sources import _database, mongo_safe

# The one writable collection. Snapshots only ever get inserted here.
dashboard_collection = _database["surgical_onco_agentic"]


async def get_latest_dashboard(patient_id: str) -> Optional[Dict[str, Any]]:
    """The most recent stored snapshot for a patient, or None if none exists yet.

    Sorted by `version` desc (monotonic per patient) so it is robust even if two
    snapshots share a timestamp.
    """
    doc = await dashboard_collection.find_one(
        {"patient_id": patient_id},
        sort=[("version", -1)],
    )
    return mongo_safe(doc) if doc else None


async def _next_version(patient_id: str) -> int:
    """Next monotonic version number for this patient (1-based)."""
    latest = await dashboard_collection.find_one(
        {"patient_id": patient_id},
        sort=[("version", -1)],
        projection={"version": 1},
    )
    return int((latest or {}).get("version", 0)) + 1


async def save_dashboard(patient_id: str, result: Dict[str, Any]) -> Dict[str, Any]:
    """Insert a new snapshot (never update). `result` is the plain-dict pipeline
    output: {patient, kpis, modules, warnings}. Returns the stored doc (JSON-safe),
    including its assigned `generated_at` and `version`.
    """
    version = await _next_version(patient_id)
    doc: Dict[str, Any] = {
        "patient_id": patient_id,
        "version": version,
        "generated_at": datetime.now(timezone.utc),
        "patient": result.get("patient", {}),
        "kpis": result.get("kpis", {}),
        "modules": result.get("modules", {}),
        "warnings": result.get("warnings", []),
    }
    insert = await dashboard_collection.insert_one(doc)
    doc["_id"] = insert.inserted_id
    return mongo_safe(doc)


async def list_dashboard_history(patient_id: str) -> List[Dict[str, Any]]:
    """Lightweight history for a patient — metadata only (no module payload),
    newest first. Powers a future 'previous versions' picker in the UI.
    """
    cursor = dashboard_collection.find(
        {"patient_id": patient_id},
        projection={"version": 1, "generated_at": 1, "warnings": 1},
    ).sort("version", -1)
    docs = await cursor.to_list(length=100)
    return [mongo_safe(d) for d in docs]
