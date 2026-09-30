"""
rheumatology_timeline_api.py
─────────────────────────────────────────────────────────────────────────────
DoctorAssist.AI — Rheumatology AI Workflow, Module 15: Longitudinal
Rheumatology Patient Timeline (v1.0).

A true chronological visual timeline — Symptoms → Diagnosis → Biomarkers →
Imaging → Disease Scores → Medications → Procedures → Response → Flare →
Follow-up — distinct from Module 16 (Follow-up Agent), which only diffs
the two most recent visits per domain. This module is a read-only
aggregator that pulls chronological entries from every module's own
collection and merges them into one flat, date-sorted event list.

No new structured data is owned here — no save/history routes, nothing to
persist, mirrors the dashboard-style read-only aggregation pattern of
Module 15/Treat-to-Target and Module 16/Follow-up (per the handoff
prompt's own framing).

ROUTES IN THIS FILE
---------------------
  GET /rheumatology-timeline/{patient_id}/{doctor_id}

⚠️ ASSUMPTIONS MADE WHILE ASSEMBLING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. ROUTER MOUNT: same convention as every other rheumatology file —
     `prefix="/context"`, mount with `app.include_router(...)` in main.py.

  2. NO OWN COLLECTION: pure read-and-merge aggregator over eleven
     upstream collections. No save/history routes — same reasoning as
     Module 15 (Treat-to-Target Dashboard) / Module 16 (Follow-up Agent),
     both of which are also read-only rollups.

  3. SORT ORDER IS ASCENDING (OLDEST FIRST), NOT "MOST RECENT FIRST":
     every other history-style endpoint in this codebase sorts most-
     recent-first per house convention. This endpoint deliberately
     inverts that — it's explicitly a chronological VISUAL timeline per
     the requirements, so oldest-first is the correct default for a
     left-to-right or top-to-bottom timeline render. The frontend can
     reverse client-side if a different order is wanted.

  4. TRACK → COLLECTION MAPPING, INCLUDING TWO DELIBERATE FOLDS:
       - "Medications" track aggregates THREE collections — treatment
         ledger start/stop events (rheumatology_treatment_ledger),
         steroid course start/stop events (rheumatology_steroid_courses),
         and DMARD safety yellow/red monitoring flags
         (rheumatology_dmard_safety). The 10-category list in the
         handoff prompt has no separate "Steroid" or "Safety" track, but
         the same prompt's own requirements text explicitly asks for
         "steroid exposure" and "toxicity events" to be visible on the
         timeline — folding both into Medications was the most
         contextually fitting home. Flag if you'd rather split these
         into their own tracks.
       - "Procedures" track sources rheumatology_procedure_log — the
         Module 12 file built in this same session, not in your
         originally-given collection list, but obviously the correct
         source now that it exists.
     All other tracks map 1:1 to the collection(s) you specified:
       Symptoms      → rheumatology_intake
       Diagnosis     → rheumatology_differential_diagnosis
       Biomarkers    → rheumatology_biomarker_analyses +
                        rheumatology_qualitative_biomarkers
       Imaging       → rheumatology_imaging_studies +
                        rheumatology_imaging_comparisons
       Disease Scores→ rheumatology_disease_activity
       Response      → rheumatology_treatment_responses
       Flare         → rheumatology_flare_predictions +
                        rheumatology_flare_events
       Follow-up     → rheumatology_followup_briefings

  5. EVERY COLLECTION READ IS WRAPPED IN TRY/EXCEPT AT THE QUERY LEVEL
     AND DEGRADES TO SKIPPING THAT TRACK/EVENT, per house convention — a
     broken or missing collection never blocks the rest of the timeline.
     Every field access uses .get() with a fallback.

  6. DATE NORMALIZATION / SORT-KEY CAVEAT: dates come from mixed field
     types across collections — some are plain "YYYY-MM-DD" strings
     (ledger start_date/stop_date, steroid course dates, procedure log
     date, flare event_date), others are full ISO datetime strings
     converted from `created_at` via `.isoformat()`. Sorting is done as
     plain string comparison, which works correctly across different
     days, but a date-only event on the SAME calendar day as a full-
     timestamp event will sort marginally earlier (being a string
     prefix). Negligible for a multi-track clinical timeline; flagged
     for completeness rather than silently assumed correct.

  7. DIAGNOSIS EVENT SUMMARY IS TRUNCATED: shows up to 3 condition names
     from the "likely" tier of the saved differential for brevity — full
     detail remains in Module 3's own saved record, one click away via
     the Differential Diagnosis module.

  8. IMAGING CROSS-REFERENCE CAVEAT: same region-string mismatch caveat
     as Module 12's ASSUMPTION #6 — Module 11's REGION_ALLOWED and
     Module 12's JOINT_REGION_ALLOWED are not identical vocabularies.
     This file surfaces both collections' events independently by their
     own recorded region string rather than attempting to reconcile them.

  9. NO PAGINATION OR DATE-RANGE FILTERING IN V1: returns the full
     history every call. Fine for now since nothing is live yet (per
     your note, no data has been stored for this whole feature) —
     revisit if a patient's event count grows large enough to matter.
─────────────────────────────────────────────────────────────────────────
"""

import os
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from motor.motor_asyncio import AsyncIOMotorClient

logger = logging.getLogger(__name__)

# ─── Mongo setup ────────────────────────────────────────────────────────────
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    intake_collection = database["rheumatology_intake"]
    differential_collection = database["rheumatology_differential_diagnosis"]
    biomarker_analysis_collection = database["rheumatology_biomarker_analyses"]
    qualitative_biomarker_collection = database["rheumatology_qualitative_biomarkers"]
    imaging_studies_collection = database["rheumatology_imaging_studies"]
    imaging_comparison_collection = database["rheumatology_imaging_comparisons"]
    disease_activity_collection = database["rheumatology_disease_activity"]
    treatment_ledger_collection = database["rheumatology_treatment_ledger"]
    steroid_course_collection = database["rheumatology_steroid_courses"]
    dmard_safety_collection = database["rheumatology_dmard_safety"]
    treatment_response_collection = database["rheumatology_treatment_responses"]
    flare_prediction_collection = database["rheumatology_flare_predictions"]
    flare_event_collection = database["rheumatology_flare_events"]
    followup_briefing_collection = database["rheumatology_followup_briefings"]
    procedure_log_collection = database["rheumatology_procedure_log"]
except Exception as e:
    logger.error(f"Error initializing MongoDB in rheumatology_timeline_api: {e}")

router = APIRouter(prefix="/context", tags=["Rheumatology Longitudinal Patient Timeline"])

TRACKS_ALL = [
    "Symptoms", "Diagnosis", "Biomarkers", "Imaging", "Disease Scores",
    "Medications", "Procedures", "Response", "Flare", "Follow-up",
]

SCORE_PREFERENCE_ORDER = ["das28_crp", "das28_esr", "cdai", "sdai", "asdas", "basdai", "sledai"]


def _iso(value):
    return value.isoformat() if isinstance(value, datetime) else value


def _event(date, track, label, summary, source_module):
    return {"date": date, "track": track, "label": label, "summary": summary, "source_module": source_module}


# ═════════════════════════════════════════════════════════════════════════════
# TRACK 1 — SYMPTOMS (rheumatology_intake)
# ═════════════════════════════════════════════════════════════════════════════

async def _symptom_events(patient_id: str, doctor_id: str) -> list:
    events = []
    try:
        cursor = intake_collection.find({"patient_id": patient_id, "doctor_id": doctor_id})
        async for doc in cursor:
            intake = doc.get("rheumatology_intake") or {}
            summary = intake.get("chief_complaint") or intake.get("onset") or "Rheumatology intake completed"
            events.append(_event(_iso(doc.get("created_at")), "Symptoms", "Intake recorded", str(summary)[:300], "rheumatology_intake"))
    except Exception as e:
        logger.warning(f"Timeline: intake lookup failed for {patient_id}: {e}")
    return events


# ═════════════════════════════════════════════════════════════════════════════
# TRACK 2 — DIAGNOSIS (rheumatology_differential_diagnosis)
# ═════════════════════════════════════════════════════════════════════════════

async def _diagnosis_events(patient_id: str, doctor_id: str) -> list:
    events = []
    try:
        cursor = differential_collection.find({"patient_id": patient_id, "doctor_id": doctor_id})
        async for doc in cursor:
            working_dx = doc.get("working_diagnosis") or ""
            likely = (doc.get("differential_diagnosis") or {}).get("likely") or []
            top_conditions = [c.get("condition") for c in likely if isinstance(c, dict) and c.get("condition")][:3]
            label = f"Working diagnosis: {working_dx}" if working_dx else "Differential diagnosis reviewed"
            summary = f"Likely: {', '.join(top_conditions)}" if top_conditions else "Differential reviewed, no likely-tier conditions recorded"
            events.append(_event(_iso(doc.get("created_at")), "Diagnosis", label, summary, "rheumatology_differential_diagnosis"))
    except Exception as e:
        logger.warning(f"Timeline: differential lookup failed for {patient_id}: {e}")
    return events


# ═════════════════════════════════════════════════════════════════════════════
# TRACK 3 — BIOMARKERS
# ═════════════════════════════════════════════════════════════════════════════

async def _biomarker_events(patient_id: str, doctor_id: str) -> list:
    events = []
    try:
        cursor = biomarker_analysis_collection.find({"patient_id": patient_id, "doctor_id": doctor_id})
        async for doc in cursor:
            numeric_flags = doc.get("numeric_flags") or []
            abnormal = [f for f in numeric_flags if f.get("flag") in ("high", "low")]
            combo = doc.get("combination_flags") or []
            parts = []
            if abnormal:
                parts.append(f"{len(abnormal)} abnormal lab flag(s)")
            if combo:
                parts.append("; ".join(c.get("flag", "") for c in combo if isinstance(c, dict)))
            summary = "; ".join(parts) if parts else "Biomarker analysis reviewed, no abnormal flags"
            events.append(_event(_iso(doc.get("created_at")), "Biomarkers", "Biomarker analysis reviewed", summary[:300], "rheumatology_biomarker_analyses"))
    except Exception as e:
        logger.warning(f"Timeline: biomarker analysis lookup failed for {patient_id}: {e}")

    try:
        cursor = qualitative_biomarker_collection.find({"patient_id": patient_id, "doctor_id": doctor_id})
        async for doc in cursor:
            label = f"{doc.get('marker_name', 'Marker')}: {doc.get('result', '')}"
            summary = doc.get("titer") or ""
            events.append(_event(doc.get("date"), "Biomarkers", label, summary[:300], "rheumatology_qualitative_biomarkers"))
    except Exception as e:
        logger.warning(f"Timeline: qualitative biomarker lookup failed for {patient_id}: {e}")

    return events


# ═════════════════════════════════════════════════════════════════════════════
# TRACK 4 — IMAGING
# ═════════════════════════════════════════════════════════════════════════════

async def _imaging_events(patient_id: str, doctor_id: str) -> list:
    events = []
    try:
        cursor = imaging_studies_collection.find({"patient_id": patient_id, "doctor_id": doctor_id})
        async for doc in cursor:
            label = f"{doc.get('modality', 'Imaging')} — {doc.get('region', '')}"
            summary = doc.get("radiologist_impression") or "Structured finding logged"
            events.append(_event(doc.get("date"), "Imaging", label, str(summary)[:300], "rheumatology_imaging_studies"))
    except Exception as e:
        logger.warning(f"Timeline: imaging studies lookup failed for {patient_id}: {e}")

    try:
        cursor = imaging_comparison_collection.find({"patient_id": patient_id, "doctor_id": doctor_id})
        async for doc in cursor:
            comparisons = doc.get("comparisons") or []
            worsening = sum(1 for c in comparisons if c.get("direction") == "worsening")
            improving = sum(1 for c in comparisons if c.get("direction") == "improving")
            summary = f"{worsening} region(s) worsening, {improving} improving" if comparisons else "Imaging comparison reviewed"
            events.append(_event(_iso(doc.get("created_at")), "Imaging", "Imaging comparison reviewed", summary, "rheumatology_imaging_comparisons"))
    except Exception as e:
        logger.warning(f"Timeline: imaging comparison lookup failed for {patient_id}: {e}")

    return events


# ═════════════════════════════════════════════════════════════════════════════
# TRACK 5 — DISEASE SCORES (rheumatology_disease_activity)
# ═════════════════════════════════════════════════════════════════════════════

async def _disease_score_events(patient_id: str, doctor_id: str) -> list:
    events = []
    try:
        cursor = disease_activity_collection.find({"patient_id": patient_id, "doctor_id": doctor_id})
        async for doc in cursor:
            scores = doc.get("scores") or {}
            metric_used = next((m for m in SCORE_PREFERENCE_ORDER if scores.get(m)), None)
            if metric_used:
                item = scores[metric_used]
                summary = f"{metric_used.upper()}: {item.get('value')} ({item.get('category')})"
            else:
                summary = "Disease activity assessed"
            events.append(_event(_iso(doc.get("created_at")), "Disease Scores", "Disease activity assessed", summary, "rheumatology_disease_activity"))
    except Exception as e:
        logger.warning(f"Timeline: disease activity lookup failed for {patient_id}: {e}")
    return events


# ═════════════════════════════════════════════════════════════════════════════
# TRACK 6 — MEDICATIONS (ledger + steroid courses + DMARD safety) — see ASSUMPTION #4
# ═════════════════════════════════════════════════════════════════════════════

async def _medication_events(patient_id: str, doctor_id: str) -> list:
    events = []

    try:
        cursor = treatment_ledger_collection.find({"patient_id": patient_id, "doctor_id": doctor_id})
        async for doc in cursor:
            drug = doc.get("drug_name", "Medication")
            dose = doc.get("dose", "")
            if doc.get("start_date"):
                events.append(_event(doc["start_date"], "Medications", f"Started {drug}", dose[:200], "rheumatology_treatment_ledger"))
            if doc.get("stop_date"):
                reason = doc.get("reason_stopped") or ""
                events.append(_event(doc["stop_date"], "Medications", f"Stopped {drug}", reason[:200], "rheumatology_treatment_ledger"))
    except Exception as e:
        logger.warning(f"Timeline: treatment ledger lookup failed for {patient_id}: {e}")

    try:
        cursor = steroid_course_collection.find({"patient_id": patient_id, "doctor_id": doctor_id})
        async for doc in cursor:
            drug = doc.get("drug", "Steroid")
            dose = doc.get("dose_mg")
            dose_str = f"{dose}mg" if dose is not None else ""
            if doc.get("start_date"):
                events.append(_event(doc["start_date"], "Medications", f"Started steroid: {drug}", f"{dose_str} — {doc.get('indication', '')}"[:200], "rheumatology_steroid_courses"))
            if doc.get("end_date"):
                events.append(_event(doc["end_date"], "Medications", f"Stopped steroid: {drug}", dose_str, "rheumatology_steroid_courses"))
    except Exception as e:
        logger.warning(f"Timeline: steroid course lookup failed for {patient_id}: {e}")

    try:
        cursor = dmard_safety_collection.find({"patient_id": patient_id, "doctor_id": doctor_id})
        async for doc in cursor:
            date = _iso(doc.get("created_at"))
            for item in (doc.get("panel") or []):
                status = item.get("status")
                if status in ("yellow", "red"):
                    reasons = "; ".join((item.get("reasons") or [])[:2])
                    events.append(_event(date, "Medications", f"{item.get('name', 'Drug')}: monitoring {status}", reasons[:300], "rheumatology_dmard_safety"))
    except Exception as e:
        logger.warning(f"Timeline: DMARD safety lookup failed for {patient_id}: {e}")

    return events


# ═════════════════════════════════════════════════════════════════════════════
# TRACK 7 — PROCEDURES (rheumatology_procedure_log)
# ═════════════════════════════════════════════════════════════════════════════

async def _procedure_events(patient_id: str, doctor_id: str) -> list:
    events = []
    try:
        cursor = procedure_log_collection.find({"patient_id": patient_id, "doctor_id": doctor_id})
        async for doc in cursor:
            label = f"{doc.get('procedure_type', 'Procedure')} — {doc.get('joint_region', '')}"
            summary = f"Indication: {doc.get('indication', '')}; Outcome: {doc.get('outcome', '')}"
            events.append(_event(doc.get("date"), "Procedures", label, summary[:300], "rheumatology_procedure_log"))
    except Exception as e:
        logger.warning(f"Timeline: procedure log lookup failed for {patient_id}: {e}")
    return events


# ═════════════════════════════════════════════════════════════════════════════
# TRACK 8 — RESPONSE (rheumatology_treatment_responses)
# ═════════════════════════════════════════════════════════════════════════════

async def _response_events(patient_id: str, doctor_id: str) -> list:
    events = []
    try:
        cursor = treatment_response_collection.find({"patient_id": patient_id, "doctor_id": doctor_id})
        async for doc in cursor:
            classification = doc.get("classification", "")
            summary = doc.get("narrative") or "Treatment response evaluated"
            events.append(_event(_iso(doc.get("created_at")), "Response", f"Treatment response: {classification}", str(summary)[:300], "rheumatology_treatment_responses"))
    except Exception as e:
        logger.warning(f"Timeline: treatment response lookup failed for {patient_id}: {e}")
    return events


# ═════════════════════════════════════════════════════════════════════════════
# TRACK 9 — FLARE (predictions + events)
# ═════════════════════════════════════════════════════════════════════════════

async def _flare_events(patient_id: str, doctor_id: str) -> list:
    events = []
    try:
        cursor = flare_prediction_collection.find({"patient_id": patient_id, "doctor_id": doctor_id})
        async for doc in cursor:
            label = f"Flare risk: {doc.get('risk_level', '')} (score {doc.get('score', '')})"
            summary = "; ".join((doc.get("factors") or [])[:2])
            events.append(_event(_iso(doc.get("created_at")), "Flare", label, summary[:300], "rheumatology_flare_predictions"))
    except Exception as e:
        logger.warning(f"Timeline: flare prediction lookup failed for {patient_id}: {e}")

    try:
        cursor = flare_event_collection.find({"patient_id": patient_id, "doctor_id": doctor_id})
        async for doc in cursor:
            label = f"Flare event ({doc.get('severity', '')})"
            summary = doc.get("notes", "")
            events.append(_event(doc.get("event_date"), "Flare", label, summary[:300], "rheumatology_flare_events"))
    except Exception as e:
        logger.warning(f"Timeline: flare event lookup failed for {patient_id}: {e}")

    return events


# ═════════════════════════════════════════════════════════════════════════════
# TRACK 10 — FOLLOW-UP (rheumatology_followup_briefings)
# ═════════════════════════════════════════════════════════════════════════════

async def _followup_events(patient_id: str, doctor_id: str) -> list:
    events = []
    try:
        cursor = followup_briefing_collection.find({"patient_id": patient_id, "doctor_id": doctor_id})
        async for doc in cursor:
            briefing = doc.get("briefing") or {}
            summary = briefing.get("narrative") or "Follow-up briefing reviewed and saved"
            events.append(_event(_iso(doc.get("created_at")), "Follow-up", "Follow-up briefing saved", str(summary)[:300], "rheumatology_followup_briefings"))
    except Exception as e:
        logger.warning(f"Timeline: followup briefing lookup failed for {patient_id}: {e}")
    return events


# ═════════════════════════════════════════════════════════════════════════════
# MAIN ROUTE
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-timeline/{patient_id}/{doctor_id}")
async def get_rheumatology_timeline(patient_id: str, doctor_id: str):
    """
    Returns a flat, date-sorted (oldest first — see ASSUMPTION #3) list of
    {date, track, label, summary, source_module} events across all ten
    tracks. Read-only, nothing persisted.
    """
    try:
        events = []
        events += await _symptom_events(patient_id, doctor_id)
        events += await _diagnosis_events(patient_id, doctor_id)
        events += await _biomarker_events(patient_id, doctor_id)
        events += await _imaging_events(patient_id, doctor_id)
        events += await _disease_score_events(patient_id, doctor_id)
        events += await _medication_events(patient_id, doctor_id)
        events += await _procedure_events(patient_id, doctor_id)
        events += await _response_events(patient_id, doctor_id)
        events += await _flare_events(patient_id, doctor_id)
        events += await _followup_events(patient_id, doctor_id)

        events = [e for e in events if e.get("date")]
        events.sort(key=lambda e: e["date"])

        tracks_present = sorted(set(e["track"] for e in events))

        return {
            "status": "success",
            "count": len(events),
            "data": events,
            "tracks": TRACKS_ALL,
            "tracks_present": tracks_present,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))