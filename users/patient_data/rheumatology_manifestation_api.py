"""
rheumatology_manifestation_api.py
─────────────────────────────────────────────────────────────────────────────
DoctorAssist.AI — Rheumatology AI Workflow, Module 12: Extra-Articular
Manifestation Agent (v1.0).

The roadmap's own framing is the design brief: extra-articular
manifestations (ILD, uveitis, vasculitis, renal involvement, skin,
neuropathy, cardiovascular, GI, sicca) get "buried in narrative notes."
Module 1's intake captures a one-time free-text
`extra_articular_symptoms` list at intake only — it is a snapshot, not a
longitudinal record with onset/status/severity per manifestation over
time. So, same shape as Modules 5/10/11: this module owns a manual
structured manifestation-event log (the doctor's own confirmed finding,
not an AI-detected one) plus a status-assessment engine on top of it.

Like Modules 8/10, the per-manifestation status (🟢/🟡/🔴/Resolved) is
computed by a deterministic rule engine in code, NOT the LLM. The LLM
only writes an optional plain-English narrative describing a panel
that's already been decided; it cannot change any status.

Mirrors the naming/response/error-handling convention of the eleven
prior rheumatology modules 1:1 — closest structurally to Module 10
(Flare Prediction): context-preview → event log (add/list/delete) →
assess → save → history.

ROUTES IN THIS FILE
---------------------
  GET    /rheumatology-manifestations/context-preview/{patient_id}/{doctor_id}
  POST   /rheumatology-manifestations/add-event
  GET    /rheumatology-manifestations/events/{patient_id}/{doctor_id}
  DELETE /rheumatology-manifestations/event/{event_id}
  POST   /rheumatology-manifestations/assess
  POST   /rheumatology-manifestations/save
  GET    /rheumatology-manifestations/history/{patient_id}/{doctor_id}

⚠️ ASSUMPTIONS MADE WHILE ASSEMBLING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. ROUTER MOUNT: same convention as the other eleven rheumatology
     files — `prefix="/context"`, mount with `app.include_router(...)`
     in main.py.

  2. COLLECTION NAMES: "rheumatology_manifestation_events" for the
     manual event log, "rheumatology_manifestation_assessments" for
     saved assessment panels. Change MANIFESTATION_EVENT_COLLECTION_NAME
     / ASSESSMENT_COLLECTION_NAME below if you want different names.

  3. NINE FIXED MANIFESTATION TYPES: the exact closed list from the
     roadmap — Interstitial lung disease, Uveitis, Vasculitis, Renal
     involvement, Skin manifestations, Neuropathy, Cardiovascular
     involvement, GI manifestations, Sicca symptoms. Not extensible from
     the frontend; add to MANIFESTATION_TYPES below if a tenth is
     needed.

  4. "MANIFESTATION" IS DOCTOR-CONFIRMED, NOT AI-DETECTED: same
     philosophy as Module 10's ASSUMPTION #5 for flare events — this
     module does not try to algorithmically infer from notes/labs
     whether a patient "has" a given manifestation; that's a clinical
     judgment with too many confounders to infer safely. A manifestation
     only enters the record via /add-event, logged directly by the
     doctor (type, date noted, severity, status, source, optional
     notes).

  5. INTAKE IS A HINT SOURCE ONLY, NEVER AN AUTO-LOGGED EVENT:
     context-preview keyword-matches Module 1's
     `rheumatology_intake.extra_articular_symptoms` free-text list
     against MANIFESTATION_KEYWORD_HINTS purely to surface "you may want
     to log..." suggestions for the doctor to review — see
     `_suggest_manifestation_types()`. Nothing here creates a
     manifestation event automatically; a suggested type with no
     corresponding /add-event call never appears in the assessment
     panel. This mirrors Module 13's ASSUMPTION #4 (keyword-match
     hinting, not authoritative classification) applied to suggestions
     instead of auto-detected risk factors.

  6. STATUS (🟢/🟡/🔴/Resolved) IS RULE-BASED, NOT LLM-DECIDED — see
     `_evaluate_manifestation_status()`. Only the LATEST logged event
     per manifestation type drives its current status:
       - latest event status = "Resolved" → category "Resolved"
         (informational, not counted as an active risk).
       - latest event status = "Active": base category from severity —
         Severe → 🔴, Moderate → 🟡, Mild → 🟢 — then escalated ONE
         level if the event is more than CHRONICITY_REVIEW_DAYS (180)
         days old with no newer event for that type, since an active
         manifestation nobody has re-checked in 6 months is itself a
         signal, the same "unassessed escalates" principle as Modules 8
         and 13. The LLM never decides this category — only, optionally,
         phrases a narrative describing a panel that's already decided.

  7. CHRONICITY WINDOW IS A FIXED 180 DAYS, NOT MANIFESTATION-SPECIFIC:
     a flat 6-month "needs reassessment" window across all nine types,
     the same "reasonable starting heuristic, not a validated rule"
     caveat as Module 10's ASSUMPTION #4 — some manifestations (e.g.
     uveitis flares) warrant much tighter review windows in practice;
     tell me if you want per-type intervals and I'll parameterize this.

  8. ONE PANEL ENTRY PER MANIFESTATION TYPE: a type with multiple
     historical events (e.g. two prior uveitis flares, both resolved,
     one new active one) is summarized by its single latest event only
     — the full event history remains visible via /events for the
     doctor to review, but the assessment panel does not attempt to
     score "recurrence" as its own factor in this version.

  9. NARRATIVE IS OPTIONAL AND NEVER RECOMMENDS AN ACTION: same pattern
     as every prior rheumatology module's narrative step — describes
     the already-decided panel, never suggests a referral, test, or
     treatment change (that stays with the physician).
─────────────────────────────────────────────────────────────────────────
"""

import os
import json
import logging
from datetime import datetime, date
from typing import Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, HTTPException
from motor.motor_asyncio import AsyncIOMotorClient
from groq import Groq

logger = logging.getLogger(__name__)

# ─── Mongo setup ────────────────────────────────────────────────────────────
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

MANIFESTATION_EVENT_COLLECTION_NAME = "rheumatology_manifestation_events"      # see ASSUMPTION #2
ASSESSMENT_COLLECTION_NAME = "rheumatology_manifestation_assessments"

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    manifestation_event_collection = database[MANIFESTATION_EVENT_COLLECTION_NAME]
    manifestation_assessment_collection = database[ASSESSMENT_COLLECTION_NAME]
    rheumatology_intake_collection = database["rheumatology_intake"]
except Exception as e:
    logger.error(f"Error initializing MongoDB in rheumatology_manifestation_api: {e}")

# ─── Groq setup ─────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client: Optional[Groq] = None
try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        logger.warning("GROQ_API_KEY not set — manifestation assessment narrative will be skipped (statuses still compute).")
except Exception as e:
    logger.error(f"Error initializing Groq client in rheumatology_manifestation_api: {e}")

router = APIRouter(prefix="/context", tags=["Rheumatology Extra-Articular Manifestations"])

# ─── Closed vocabularies — see ASSUMPTION #3 ─────────────────────────────────
MANIFESTATION_TYPES = [
    "Interstitial lung disease",
    "Uveitis",
    "Vasculitis",
    "Renal involvement",
    "Skin manifestations",
    "Neuropathy",
    "Cardiovascular involvement",
    "GI manifestations",
    "Sicca symptoms",
]
MANIFESTATION_TYPES_SET = set(MANIFESTATION_TYPES)

SEVERITY_ALLOWED = {"Mild", "Moderate", "Severe"}
STATUS_ALLOWED = {"Active", "Resolved"}
SOURCE_ALLOWED = {"Doctor exam", "Patient reported", "Specialist referral/report", "Investigation finding"}

CHRONICITY_REVIEW_DAYS = 180  # see ASSUMPTION #7

# ─── Keyword hints for intake cross-check — see ASSUMPTION #5 ────────────────
MANIFESTATION_KEYWORD_HINTS = {
    "Interstitial lung disease": ["lung", "dyspnea", "shortness of breath", "cough"],
    "Uveitis": ["uveitis", "eye pain", "red eye", "blurred vision"],
    "Vasculitis": ["vasculitis", "purpura", "skin ulcer", "digital ulcer"],
    "Renal involvement": ["kidney", "renal", "proteinuria", "hematuria", "foamy urine"],
    "Skin manifestations": ["rash", "psoriasis", "nodules", "skin lesion"],
    "Neuropathy": ["numbness", "tingling", "neuropathy", "pins and needles"],
    "Cardiovascular involvement": ["chest pain", "pericarditis", "palpitations"],
    "GI manifestations": ["abdominal pain", "reflux", "dysphagia", "chronic diarrhea"],
    "Sicca symptoms": ["dry eyes", "dry mouth", "sicca", "xerostomia"],
}


import re  # add to top-level imports if not already present

def _suggest_manifestation_types(extra_articular_symptoms: list) -> list:
    """
    Word-boundary keyword matching — NOT raw substring matching. A raw
    `kw in text_blob` check let short keywords like "ild" false-positive
    match inside unrelated words (e.g. "ild" inside "mild"), producing
    ungrounded suggestions like Interstitial Lung Disease from "mild
    fatigue" alone. \b...\b ensures the keyword only matches as a whole
    word/phrase, not as a substring of something else.
    """
    text_blob = " | ".join(str(s).lower() for s in (extra_articular_symptoms or []))
    matched = []
    for m_type, keywords in MANIFESTATION_KEYWORD_HINTS.items():
        for kw in keywords:
            pattern = r"\b" + re.escape(kw) + r"\b"
            if re.search(pattern, text_blob):
                matched.append(m_type)
                break
    return matched


async def _get_latest_intake(patient_id: str, doctor_id: str) -> Optional[dict]:
    try:
        doc = await rheumatology_intake_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        if doc:
            return doc.get("rheumatology_intake") or {}
    except Exception as e:
        logger.warning(f"Manifestations: intake lookup failed for {patient_id}: {e}")
    return None


def _days_since(date_str: str) -> Optional[int]:
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d").date()
        return (date.today() - d).days
    except (TypeError, ValueError):
        return None


# ═════════════════════════════════════════════════════════════════════════════
# 1. CONTEXT PREVIEW
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-manifestations/context-preview/{patient_id}/{doctor_id}")
async def get_manifestation_context_preview(patient_id: str, doctor_id: str):
    """
    Surfaces manifestation-type suggestions derived from Module 1 intake's
    extra_articular_symptoms (hint only, see ASSUMPTION #5), plus the raw
    intake list for the doctor to eyeball. Does not touch the event log.
    """
    intake = await _get_latest_intake(patient_id, doctor_id)
    extra_articular_symptoms = (intake or {}).get("extra_articular_symptoms") or []
    suggested_types = _suggest_manifestation_types(extra_articular_symptoms)

    return {
        "status": "success",
        "data": {
            "manifestation_types": MANIFESTATION_TYPES,
            "suggested_types_from_intake": suggested_types,
            "raw_extra_articular_symptoms": extra_articular_symptoms,
        },
        "has_intake_data": intake is not None,
    }


# ═════════════════════════════════════════════════════════════════════════════
# 2. ADD / DELETE / FETCH EVENTS
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-manifestations/add-event")
async def add_manifestation_event(payload: dict):
    """
    Expected payload:
    {
        "patient_id": "...", "doctor_id": "...",
        "manifestation_type": "Uveitis",        # must be in MANIFESTATION_TYPES
        "date_noted": "2026-08-01",             # YYYY-MM-DD, defaults to today
        "severity": "Moderate",                  # Mild/Moderate/Severe
        "status": "Active",                      # Active/Resolved
        "source": "Specialist referral/report",  # see SOURCE_ALLOWED
        "notes": "optional free text"
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        manifestation_type = str(payload.get("manifestation_type", ""))
        date_noted = payload.get("date_noted") or datetime.utcnow().strftime("%Y-%m-%d")
        severity = str(payload.get("severity", ""))
        status_val = str(payload.get("status", ""))
        source = str(payload.get("source", ""))
        notes = payload.get("notes") or ""

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if manifestation_type not in MANIFESTATION_TYPES_SET:
            raise HTTPException(status_code=400, detail=f"manifestation_type must be one of: {MANIFESTATION_TYPES}")
        if severity not in SEVERITY_ALLOWED:
            raise HTTPException(status_code=400, detail=f"severity must be one of: {sorted(SEVERITY_ALLOWED)}")
        if status_val not in STATUS_ALLOWED:
            raise HTTPException(status_code=400, detail=f"status must be one of: {sorted(STATUS_ALLOWED)}")
        if source not in SOURCE_ALLOWED:
            raise HTTPException(status_code=400, detail=f"source must be one of: {sorted(SOURCE_ALLOWED)}")
        try:
            datetime.strptime(date_noted, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="date_noted must be in YYYY-MM-DD format")

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "manifestation_type": manifestation_type,
            "date_noted": date_noted,
            "severity": severity,
            "status": status_val,
            "source": source,
            "notes": str(notes)[:500],
            "created_at": datetime.utcnow(),
        }
        result = await manifestation_event_collection.insert_one(document)
        document["_id"] = str(result.inserted_id)
        document["created_at"] = document["created_at"].isoformat()

        return {"status": "success", "message": "Manifestation event logged", "data": document}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/rheumatology-manifestations/events/{patient_id}/{doctor_id}")
async def get_manifestation_events(patient_id: str, doctor_id: str):
    """All logged manifestation events for a patient, most recent first."""
    try:
        cursor = manifestation_event_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("date_noted", -1)

        records = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            if isinstance(doc.get("created_at"), datetime):
                doc["created_at"] = doc["created_at"].isoformat()
            records.append(doc)

        return {"status": "success", "count": len(records), "data": records}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/rheumatology-manifestations/event/{event_id}")
async def delete_manifestation_event(event_id: str):
    try:
        try:
            oid = ObjectId(event_id)
        except InvalidId:
            raise HTTPException(status_code=400, detail="Invalid event_id")

        result = await manifestation_event_collection.delete_one({"_id": oid})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Event not found")

        return {"status": "success", "message": "Manifestation event deleted"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 3. ASSESS
# ═════════════════════════════════════════════════════════════════════════════

def _evaluate_manifestation_status(latest_event: dict) -> dict:
    """
    Deterministic rule engine — see ASSUMPTION #6. Returns
    {"category": "green"|"yellow"|"red"|"resolved", "reasons": [str, ...]}.
    """
    reasons = []

    if latest_event["status"] == "Resolved":
        reasons.append(f"Marked resolved as of {latest_event['date_noted']}")
        return {"category": "resolved", "reasons": reasons}

    severity_base = {"Mild": "green", "Moderate": "yellow", "Severe": "red"}
    category = severity_base.get(latest_event["severity"], "yellow")
    reasons.append(f"Active, severity {latest_event['severity']} (noted {latest_event['date_noted']}, source: {latest_event['source']})")

    days = _days_since(latest_event["date_noted"])
    if days is not None and days > CHRONICITY_REVIEW_DAYS:
        escalation = {"green": "yellow", "yellow": "red", "red": "red"}
        if category != escalation[category]:
            reasons.append(f"No reassessment in {days} days (review window: {CHRONICITY_REVIEW_DAYS} days) — escalated")
        category = escalation[category]

    return {"category": category, "reasons": reasons}


MANIFESTATION_NARRATIVE_PROMPT = """
You are a clinical assistant. You will be given a list of extra-articular
manifestation assessment results for a rheumatology patient — for each
manifestation type, its status category (green/yellow/red/resolved) and
the specific reasons behind it (already decided by rule-based logic, not
by you).

Return a JSON object with exactly one key, "narrative": ONE short
paragraph (2-4 sentences) summarizing the overall extra-articular picture
across all manifestations listed, in plain language a physician can scan
quickly. Reference the actual manifestation types and reasons given.

Rules:
- Do NOT change, soften, or second-guess the category already assigned
  to any manifestation — describe it, don't re-evaluate it.
- Do NOT recommend a referral, test, or treatment change — that decision
  belongs to the physician.
- Do NOT invent findings not present in the input.
- Return valid JSON only — no markdown, no commentary, no extra keys.
"""


@router.post("/rheumatology-manifestations/assess")
async def assess_manifestations(payload: dict):
    """
    Expected payload:
    { "doctor_id": "...", "patient_id": "..." }

    Returns:
    {
        "status": "success",
        "finaloutput": { "panel": [ {manifestation_type, category, reasons, latest_event}, ... ], "narrative": str | None }
    }
    """
    patient_id = payload.get("patient_id")
    doctor_id = payload.get("doctor_id")
    if not patient_id or not doctor_id:
        raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")

    cursor = manifestation_event_collection.find(
        {"patient_id": patient_id, "doctor_id": doctor_id}
    ).sort("date_noted", -1)

    latest_by_type = {}
    async for doc in cursor:
        if doc["manifestation_type"] not in latest_by_type:
            latest_by_type[doc["manifestation_type"]] = doc

    if not latest_by_type:
        raise HTTPException(
            status_code=400,
            detail="No manifestation events logged yet — log at least one event to assess.",
        )

    panel = []
    for m_type, event in latest_by_type.items():
        evaluation = _evaluate_manifestation_status(event)
        panel.append({
            "manifestation_type": m_type,
            "category": evaluation["category"],
            "reasons": evaluation["reasons"],
            "latest_event": {
                "date_noted": event["date_noted"],
                "severity": event["severity"],
                "status": event["status"],
                "source": event["source"],
                "notes": event.get("notes", ""),
            },
        })

    narrative = None
    if groq_client is not None:
        try:
            llm_input = [{"manifestation_type": p["manifestation_type"], "category": p["category"], "reasons": p["reasons"]} for p in panel]
            completion = groq_client.chat.completions.create(
                model="openai/gpt-oss-120b",
                messages=[
                    {"role": "system", "content": MANIFESTATION_NARRATIVE_PROMPT},
                    {"role": "user", "content": json.dumps(llm_input, indent=2, default=str)},
                ],
                temperature=0,
                response_format={"type": "json_object"},
            )
            parsed = json.loads(completion.choices[0].message.content)
            if isinstance(parsed, dict) and parsed.get("narrative"):
                narrative = str(parsed["narrative"])[:600]
        except Exception as e:
            logger.warning(f"Manifestations: narrative generation failed for {patient_id}: {e}")

    return {"status": "success", "finaloutput": {"panel": panel, "narrative": narrative}}


# ═════════════════════════════════════════════════════════════════════════════
# 4. SAVE
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-manifestations/save")
async def save_manifestation_assessment(payload: dict):
    """
    Expected payload (doctor-reviewed version of /assess's output):
    {
        "patient_id": "...", "doctor_id": "...",
        "panel": [ {manifestation_type, category, reasons, latest_event}, ... ],
        "narrative": "optional"
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        panel = payload.get("panel") or []
        narrative = payload.get("narrative") or ""

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if not isinstance(panel, list) or not panel:
            raise HTTPException(status_code=400, detail="panel is required and cannot be empty")

        clean_panel = []
        for item in panel:
            if not isinstance(item, dict):
                continue
            m_type = str(item.get("manifestation_type", ""))
            if m_type not in MANIFESTATION_TYPES_SET:
                continue
            category = str(item.get("category", ""))
            if category not in ("green", "yellow", "red", "resolved"):
                continue
            clean_panel.append({
                "manifestation_type": m_type,
                "category": category,
                "reasons": [str(r)[:300] for r in (item.get("reasons") or [])][:15],
                "latest_event": item.get("latest_event") or {},
            })

        if not clean_panel:
            raise HTTPException(status_code=400, detail="No valid panel entries to save")

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "panel": clean_panel,
            "narrative": str(narrative)[:600],
            "created_at": datetime.utcnow(),
            "type": "rheumatology_manifestation_assessment",
        }
        result = await manifestation_assessment_collection.insert_one(document)

        return {"status": "success", "message": "Extra-articular manifestation assessment saved", "id": str(result.inserted_id)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 5. HISTORY
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-manifestations/history/{patient_id}/{doctor_id}")
async def get_manifestation_assessment_history(patient_id: str, doctor_id: str):
    """Fetch all saved extra-articular manifestation assessments for a patient, most recent first."""
    try:
        cursor = manifestation_assessment_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("created_at", -1)

        records = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            if isinstance(doc.get("created_at"), datetime):
                doc["created_at"] = doc["created_at"].isoformat()
            records.append(doc)

        return {"status": "success", "count": len(records), "data": records}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))