"""
rheumatology_treatment_ledger_api.py
─────────────────────────────────────────────────────────────────────────────
DoctorAssist.AI — Rheumatology AI Workflow, Module 9: Medication Timeline /
Treatment Ledger (v1.0).

The roadmap frames this as solving a concrete, recurring problem: doctors
reconstructing years of treatment history from free-text notes. Unlike
Modules 1-8, this module has NO LLM step — drug name, dose, start/stop
dates, response, and reason-stopped are exactly the kind of data a doctor
enters once, deliberately, and the system should never guess or infer.
This file is a straightforward CRUD ledger, plus one read-only,
deterministic (no LLM) prefill lookup against the existing medication
analysis collection so the doctor isn't retyping a drug name/dose that's
already on file.

Mirrors the naming/response/error-handling convention of the eight prior
rheumatology modules 1:1, but is intentionally the simplest file in the
set — see ASSUMPTION #3.

ROUTES IN THIS FILE
---------------------
  GET    /rheumatology-treatment-ledger/suggest-from-medications/{patient_id}
  POST   /rheumatology-treatment-ledger/add-entry
  PUT    /rheumatology-treatment-ledger/entry/{entry_id}
  DELETE /rheumatology-treatment-ledger/entry/{entry_id}
  GET    /rheumatology-treatment-ledger/{patient_id}/{doctor_id}

⚠️ ASSUMPTIONS MADE WHILE ASSEMBLING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. ROUTER MOUNT: same convention as the other eight rheumatology files —
     `prefix="/context"`, mount with `app.include_router(...)` in main.py.

  2. COLLECTION NAME: "rheumatology_treatment_ledger". Change
     LEDGER_COLLECTION_NAME below if you want a different name.

  3. NO LLM STEP, DELIBERATELY: every other module in this set has a
     generate/calculate step because the input is unstructured (dictation,
     lab series, a differential) and needs interpretation. A treatment
     ledger entry is the opposite — drug name, dose, dates, response, and
     reason-stopped are facts the doctor already knows and is entering
     directly. Running that through an LLM would add latency and a
     hallucination surface for zero benefit. The only "smart" behavior
     here is the prefill suggestion endpoint below, and even that is a
     deterministic field copy, not a generated summary.

  4. PREFILL IS SUGGEST-ONLY, NEVER AUTO-CREATES A LEDGER ENTRY: 
     GET /suggest-from-medications/{patient_id} reads the most recent
     documentation-medication-analysis record (same collection/lookup
     pattern as Modules 1, 6, 7, 8) and returns drug name + dose per
     prescription as candidates. The frontend is expected to let the
     doctor pick one to prefill the add-entry form — nothing is written
     to the ledger until the doctor explicitly submits add-entry with a
     start_date and confirms it. This keeps medication-analysis (which
     doesn't track start/stop/response) and the ledger (which does)
     cleanly separated, same separation principle as Module 3's
     ASSUMPTION #5 (not writing into an unrelated collection directly).

  5. drug_name IS FREE TEXT, NOT A CLOSED VOCABULARY: unlike the DMARD
     keyword classification in Module 8, this ledger is meant to capture
     ANY rheumatology medication (including ones outside the DMARD/
     biologic keyword map — e.g. NSAIDs, PPIs given alongside a DMARD,
     analgesics), so drug_name is deliberately not validated against a
     closed list. If you want ledger entries to also carry Module 8's
     drug_class where it happens to match, tell me and I'll add an
     optional best-effort classification tag using the same
     DMARD_KEYWORD_MAP, purely for filtering/display — not a hard
     requirement to save an entry.

  6. status IS DERIVED, NOT STORED: "Active" vs "Stopped" is computed
     from whether stop_date is null, not saved as its own field — this
     avoids the two ever going out of sync (e.g. a stop_date present but
     status still "Active" because a doctor forgot to also flip a
     dropdown). Setting/clearing stop_date via PUT is how a drug is
     marked stopped/reactivated.

  7. reason_stopped IS A CLOSED LIST WITH A FREE-TEXT DETAIL FIELD: kept
     closed (see REASON_STOPPED_ALLOWED) so the ledger can eventually be
     queried/aggregated ("how many patients stopped a TNF inhibitor for
     inadequate response"), with reason_stopped_detail as an escape hatch
     for anything that needs elaboration. reason_stopped is only
     meaningful (and only required) when stop_date is set.

  8. response IS A CLOSED LIST, MANUALLY SET, NOT AUTO-COMPUTED: Module 7
     already computes a deterministic EULAR response classification from
     two DAS28 records for its own treatment-options context (see that
     file's ASSUMPTION #5) — this module does NOT duplicate or re-run
     that logic, because the ledger's "response" field is meant to be a
     doctor's own holistic judgment for a *specific drug trial* over its
     *entire* duration (which may span many disease-activity readings),
     not a two-point DAS28 delta. If you want the ledger to show Module
     7's computed response alongside the doctor's manual entry as a
     cross-check, tell me and I'll add it as a read-only reference field
     on GET, not something this module writes.
─────────────────────────────────────────────────────────────────────────
"""

import os
import logging
from datetime import datetime
from typing import Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, HTTPException
from motor.motor_asyncio import AsyncIOMotorClient

logger = logging.getLogger(__name__)

# ─── Mongo setup ────────────────────────────────────────────────────────────
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

LEDGER_COLLECTION_NAME = "rheumatology_treatment_ledger"  # see ASSUMPTION #2

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    ledger_collection = database[LEDGER_COLLECTION_NAME]
    documentation_medication_analysis_collection = database["documentation-medication-analysis"]
except Exception as e:
    logger.error(f"Error initializing MongoDB in rheumatology_treatment_ledger_api: {e}")

router = APIRouter(prefix="/context", tags=["Rheumatology Treatment Ledger"])

# ─── Closed vocabularies — see ASSUMPTIONS #5, #7, #8 ────────────────────────
RESPONSE_ALLOWED = {"Good response", "Partial response", "No response", "Not yet assessed"}

REASON_STOPPED_ALLOWED = {
    "Inadequate response",
    "Adverse effect / toxicity",
    "Remission achieved — de-escalation",
    "Patient preference",
    "Cost / access issue",
    "Pregnancy / conception planning",
    "Intercurrent infection",
    "Surgery — perioperative hold",
    "Other",
}


def _serialize(doc: dict) -> dict:
    doc["_id"] = str(doc["_id"])
    if isinstance(doc.get("created_at"), datetime):
        doc["created_at"] = doc["created_at"].isoformat()
    if isinstance(doc.get("updated_at"), datetime):
        doc["updated_at"] = doc["updated_at"].isoformat()
    doc["status"] = "Active" if not doc.get("stop_date") else "Stopped"  # see ASSUMPTION #6
    return doc


def _validate_date(value: Optional[str], field_name: str) -> Optional[str]:
    if value in (None, ""):
        return None
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{field_name} must be in YYYY-MM-DD format")
    return value


# ═════════════════════════════════════════════════════════════════════════════
# 1. SUGGEST-FROM-MEDICATIONS (read-only, deterministic prefill — see ASSUMPTION #4)
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-treatment-ledger/suggest-from-medications/{patient_id}")
async def suggest_ledger_entries_from_medications(patient_id: str):
    """
    Read-only. Returns drug name + dose/frequency candidates pulled straight
    from the most recent documentation-medication-analysis record — a plain
    field copy, no LLM involved. The frontend offers these as one-click
    prefills for /add-entry; nothing is written here.
    """
    try:
        doc = await documentation_medication_analysis_collection.find_one(
            {"patient_id": patient_id}, sort=[("created_at", -1)]
        )
        if not doc:
            return {"status": "success", "suggestions": []}

        prescriptions = (doc.get("finaloutput") or {}).get("prescriptions") or []
        suggestions = []
        for p in prescriptions:
            name = p.get("medication") or p.get("generic_name") or p.get("brand_name") or ""
            if not name:
                continue
            dose_parts = [str(p["dose"])] if p.get("dose") else []
            if p.get("frequency"):
                dose_parts.append(str(p["frequency"]))
            suggestions.append({"drug_name": name, "dose": " ".join(dose_parts)})

        return {"status": "success", "suggestions": suggestions}
    except Exception as e:
        logger.warning(f"Treatment ledger: medication suggestion lookup failed for {patient_id}: {e}")
        return {"status": "success", "suggestions": []}


# ═════════════════════════════════════════════════════════════════════════════
# 2. ADD ENTRY
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-treatment-ledger/add-entry")
async def add_ledger_entry(payload: dict):
    """
    Expected payload:
    {
        "patient_id": "...", "doctor_id": "...",
        "drug_name": "Methotrexate",
        "dose": "15mg weekly",                 # free text
        "start_date": "2026-01-15",             # required, YYYY-MM-DD
        "stop_date": null,                      # optional — omit/null = still active
        "response": "Not yet assessed",         # optional, one of RESPONSE_ALLOWED
        "reason_stopped": null,                 # required only if stop_date is set
        "reason_stopped_detail": "",            # optional free text
        "notes": "optional free text"
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        drug_name = str(payload.get("drug_name", "")).strip()
        dose = str(payload.get("dose", "")).strip()
        notes = str(payload.get("notes", "")).strip()

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if not drug_name:
            raise HTTPException(status_code=400, detail="drug_name is required")

        start_date = _validate_date(payload.get("start_date"), "start_date")
        if not start_date:
            raise HTTPException(status_code=400, detail="start_date is required")
        stop_date = _validate_date(payload.get("stop_date"), "stop_date")

        if stop_date and stop_date < start_date:
            raise HTTPException(status_code=400, detail="stop_date cannot be before start_date")

        response = str(payload.get("response") or "Not yet assessed")
        if response not in RESPONSE_ALLOWED:
            raise HTTPException(status_code=400, detail=f"response must be one of: {sorted(RESPONSE_ALLOWED)}")

        reason_stopped = payload.get("reason_stopped")
        if stop_date and reason_stopped not in REASON_STOPPED_ALLOWED:
            raise HTTPException(
                status_code=400,
                detail=f"reason_stopped is required when stop_date is set, and must be one of: {sorted(REASON_STOPPED_ALLOWED)}",
            )
        if not stop_date:
            reason_stopped = None  # see ASSUMPTION #7 — only meaningful once stopped

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "drug_name": drug_name[:200],
            "dose": dose[:200],
            "start_date": start_date,
            "stop_date": stop_date,
            "response": response,
            "reason_stopped": reason_stopped,
            "reason_stopped_detail": str(payload.get("reason_stopped_detail", ""))[:500],
            "notes": notes[:1000],
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
            "type": "rheumatology_treatment_ledger",
        }
        result = await ledger_collection.insert_one(document)

        return {"status": "success", "message": "Treatment ledger entry added", "id": str(result.inserted_id)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 3. UPDATE ENTRY
# ═════════════════════════════════════════════════════════════════════════════

@router.put("/rheumatology-treatment-ledger/entry/{entry_id}")
async def update_ledger_entry(entry_id: str, payload: dict):
    """
    Partial update — only fields present in the payload are changed.
    Typical uses: setting stop_date + reason_stopped to discontinue a drug,
    clearing stop_date to reactivate, or updating response/dose/notes.

    Expected payload: any subset of
    { "drug_name", "dose", "start_date", "stop_date", "response",
      "reason_stopped", "reason_stopped_detail", "notes" }
    """
    try:
        try:
            oid = ObjectId(entry_id)
        except InvalidId:
            raise HTTPException(status_code=400, detail="Invalid entry_id")

        existing = await ledger_collection.find_one({"_id": oid})
        if not existing:
            raise HTTPException(status_code=404, detail="Ledger entry not found")

        updates = {}

        if "drug_name" in payload:
            drug_name = str(payload["drug_name"]).strip()
            if not drug_name:
                raise HTTPException(status_code=400, detail="drug_name cannot be empty")
            updates["drug_name"] = drug_name[:200]

        if "dose" in payload:
            updates["dose"] = str(payload["dose"])[:200]

        if "notes" in payload:
            updates["notes"] = str(payload["notes"])[:1000]

        if "reason_stopped_detail" in payload:
            updates["reason_stopped_detail"] = str(payload["reason_stopped_detail"])[:500]

        start_date = updates.get("start_date") if "start_date" in updates else existing.get("start_date")
        if "start_date" in payload:
            start_date = _validate_date(payload["start_date"], "start_date")
            if not start_date:
                raise HTTPException(status_code=400, detail="start_date cannot be cleared")
            updates["start_date"] = start_date

        if "stop_date" in payload:
            stop_date = _validate_date(payload["stop_date"], "stop_date")
            if stop_date and stop_date < start_date:
                raise HTTPException(status_code=400, detail="stop_date cannot be before start_date")
            updates["stop_date"] = stop_date
            if not stop_date:
                updates["reason_stopped"] = None  # reactivating clears the stop reason — see ASSUMPTION #6/#7

        if "response" in payload:
            response = str(payload["response"])
            if response not in RESPONSE_ALLOWED:
                raise HTTPException(status_code=400, detail=f"response must be one of: {sorted(RESPONSE_ALLOWED)}")
            updates["response"] = response

        if "reason_stopped" in payload:
            reason_stopped = payload["reason_stopped"]
            effective_stop_date = updates.get("stop_date", existing.get("stop_date"))
            if effective_stop_date and reason_stopped not in REASON_STOPPED_ALLOWED:
                raise HTTPException(status_code=400, detail=f"reason_stopped must be one of: {sorted(REASON_STOPPED_ALLOWED)}")
            updates["reason_stopped"] = reason_stopped if effective_stop_date else None

        if not updates:
            raise HTTPException(status_code=400, detail="No valid fields to update")

        updates["updated_at"] = datetime.utcnow()
        await ledger_collection.update_one({"_id": oid}, {"$set": updates})

        updated = await ledger_collection.find_one({"_id": oid})
        return {"status": "success", "message": "Treatment ledger entry updated", "data": _serialize(updated)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 4. DELETE ENTRY
# ═════════════════════════════════════════════════════════════════════════════

@router.delete("/rheumatology-treatment-ledger/entry/{entry_id}")
async def delete_ledger_entry(entry_id: str):
    """Removes a single mistaken/duplicate ledger entry."""
    try:
        try:
            oid = ObjectId(entry_id)
        except InvalidId:
            raise HTTPException(status_code=400, detail="Invalid entry_id")

        result = await ledger_collection.delete_one({"_id": oid})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Ledger entry not found")

        return {"status": "success", "message": "Treatment ledger entry deleted"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 5. GET LEDGER
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-treatment-ledger/{patient_id}/{doctor_id}")
async def get_treatment_ledger(patient_id: str, doctor_id: str):
    """
    Returns the full treatment ledger for this patient, most recent
    start_date first, split into active vs stopped for a quick "what are
    they on right now" view.
    """
    try:
        cursor = ledger_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("start_date", -1)

        entries = [_serialize(doc) async for doc in cursor]
        active = [e for e in entries if e["status"] == "Active"]
        stopped = [e for e in entries if e["status"] == "Stopped"]

        return {
            "status": "success",
            "count": len(entries),
            "data": entries,
            "active": active,
            "stopped": stopped,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))