"""
rheumatology_followup_api.py
─────────────────────────────────────────────────────────────────────────────
DoctorAssist.AI — Rheumatology AI Workflow, Module 16: Follow-up Agent
("What's changed since the last visit?" pre-visit briefing) (v1.0).

The roadmap frames this as a ~60-second pre-visit summary a doctor can scan
right before walking into the room. Like Module 15 (Treat-to-Target
Dashboard), this module does NOT own a new manual entry log — it is a
READ-ONLY AGGREGATOR/DIFFER over data that already lives in four other
modules, each of which naturally has a "previous vs current" shape:

    Joint findings      → Module 2  (rheumatology_joint_map)
    Lab results         → Module 5  (rheumatology_lab_trend_analysis)
    Disease activity    → Module 6  (rheumatology_disease_activity)
    Imaging             → Module 11 (rheumatology_imaging_comparisons)

Each domain's "previous vs current" diff is computed by deterministic rules
in code, NOT by the LLM — same "rule engine decides, LLM only narrates"
split as every prior rheumatology module. The LLM's narrative is purely a
plain-English recap of diffs that are already decided; it never recommends
a specific drug, dose, or test — that decision belongs to the physician.

The only thing this module owns and persists is an optional SAVED SNAPSHOT
of a briefing the doctor has reviewed (e.g. to keep with visit notes) —
same save+history pattern as every prior module.

ROUTES IN THIS FILE
---------------------
  GET  /rheumatology-followup/briefing/{patient_id}/{doctor_id}
  POST /rheumatology-followup/save
  GET  /rheumatology-followup/history/{patient_id}/{doctor_id}

⚠️ ASSUMPTIONS MADE WHILE ASSEMBLING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. ROUTER MOUNT: same convention as the fifteen prior rheumatology files
     — `prefix="/context"`, mount with `app.include_router(...)` in
     main.py.

  2. COLLECTION NAME: "rheumatology_followup_briefings" for saved,
     doctor-reviewed briefings. Change BRIEFING_COLLECTION_NAME below if
     you want a different name. All four upstream collection names below
     are copied verbatim from their owning module's own file (not
     re-guessed) — rheumatology_joint_map, rheumatology_lab_trend_analysis,
     rheumatology_disease_activity, rheumatology_imaging_comparisons.

  3. "SINCE LAST VISIT" IS DEFINED PER-DOMAIN, INDEPENDENTLY — there is no
     single shared "visit date" field anywhere in this codebase, and
     different modules get updated on different cadences (e.g. imaging
     doesn't happen every visit). So for joint findings, disease activity,
     and imaging, "current" = that module's most recent saved record and
     "previous" = the one immediately before it, each looked up
     independently. If a domain has fewer than two saved records, that
     domain's diff is reported as `null` ("not enough history yet") rather
     than guessed — same convention as Module 15's ASSUMPTION #3.

  4. LABS ARE NOT RE-DIFFED HERE — THEY REUSE MODULE 5's OWN LATEST SAVED
     ANALYSIS: Module 5 (rheumatology_lab_trends_api.py) already computes
     a rising/falling/stable/fluctuating direction per test, with its own
     narrative, each time the doctor reviews and saves a trend analysis.
     Re-implementing that diff logic here would risk drifting out of sync
     with Module 5's own thresholds. So this module simply pulls Module
     5's single most recent saved `rheumatology_lab_trend_analysis`
     document and surfaces the tests whose direction is NOT "stable" as
     "labs that changed." If Module 5 has no saved analysis yet, this
     domain reports `null` rather than reaching into raw
     rheumatology_lab_results and re-deriving a direction of its own.

  5. JOINT DIFF LOGIC (see `_diff_joint_maps()`) compares the `joints` dict
     ({joint_id: "tender"|"swollen"|"tender_swollen"|"none"}) between the
     two most recent Module 2 saves, using this fixed severity ordering:
     none < tender == swollen < tender_swollen (tender and swollen alone
     are treated as equally severe, one below "both"; there's no clinical
     basis in this codebase for ranking tender-only vs swollen-only
     against each other). A joint is:
       - "newly_affected"   — was "none"/absent, now anything else
       - "escalated"        — moved to a strictly more severe status
         (e.g. tender → tender_swollen)
       - "resolved"         — was anything else, now "none"/absent
       - "improved"         — moved to a strictly less severe status but
         not fully resolved (e.g. tender_swollen → tender)
     Joints unchanged between visits are not surfaced (this is a "what
     changed" briefing, not a full re-listing of the joint map — Module 2
     itself remains the source for the complete current state).

  6. DISEASE ACTIVITY DIFF REUSES MODULE 15's TREND CONVENTION: same
     metric-preference order (DAS28-CRP → DAS28-ESR → CDAI → SDAI,
     whichever is present on both saves) and the same
     TREND_NOISE_THRESHOLD (0.1 absolute score points) for
     worsening/improving/stable, so the two dashboards never disagree
     about the same underlying data. See Module 15's ASSUMPTIONS #4-5 for
     the same caveats (not a validated MCID threshold).

  7. IMAGING CHANGES REUSE MODULE 11's OWN SAVED COMPARISON, NOT A FRESH
     COMPARE: pulls Module 11's single most recent saved
     `rheumatology_imaging_comparisons` document and surfaces any region
     whose direction is NOT "stable" — same "don't re-derive another
     module's own diff logic" reasoning as ASSUMPTION #4. If Module 11 has
     no saved comparison yet, this domain reports `null`.

  8. THIS MODULE DOES NOT PULL FROM MODULES 3/7/8/10/14 (differential
     diagnosis, treatment decisions, DMARD safety, flare prediction,
     steroid stewardship) — that rollup already exists in Module 15's
     Treat-to-Target Dashboard. Module 16 is scoped specifically to the
     four data domains that have a natural "previous visit vs this visit"
     shape, per the roadmap's own framing of this module. A doctor
     reviewing a pre-visit briefing is expected to have Module 15 open
     alongside this one for the treatment/safety picture, not this module
     duplicating it.

  9. NARRATIVE IS OPTIONAL AND NEVER RECOMMENDS A SPECIFIC ACTION: same
     pattern as every prior rheumatology module's narrative step —
     describes the already-decided diffs in plain language, never
     suggests a specific treatment change (that stays with the
     physician).

 10. SAVED SNAPSHOT IS FOR AUDIT/VISIT-NOTE PURPOSES ONLY, NOT
     VERSIONED/UPSERTED: each `/save` call inserts a new briefing record
     (like Module 15's snapshot, not like its upserted target setting) —
     there is no "current" briefing to overwrite, only a history of
     briefings the doctor chose to keep.
─────────────────────────────────────────────────────────────────────────
"""

import os
import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from motor.motor_asyncio import AsyncIOMotorClient
from groq import Groq

logger = logging.getLogger(__name__)

# ─── Mongo setup ────────────────────────────────────────────────────────────
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

BRIEFING_COLLECTION_NAME = "rheumatology_followup_briefings"  # see ASSUMPTION #2

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    briefing_collection = database[BRIEFING_COLLECTION_NAME]

    # Upstream modules — names copied verbatim from their owning files, see ASSUMPTION #2.
    joint_map_collection = database["rheumatology_joint_map"]
    lab_trend_analysis_collection = database["rheumatology_lab_trend_analysis"]
    disease_activity_collection = database["rheumatology_disease_activity"]
    imaging_comparison_collection = database["rheumatology_imaging_comparisons"]
except Exception as e:
    logger.error(f"Error initializing MongoDB in rheumatology_followup_api: {e}")

# ─── Groq setup ─────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client: Optional[Groq] = None
try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        logger.warning("GROQ_API_KEY not set — follow-up briefing narrative will be skipped (diffs still compute).")
except Exception as e:
    logger.error(f"Error initializing Groq client in rheumatology_followup_api: {e}")

router = APIRouter(prefix="/context", tags=["Rheumatology Follow-up Agent"])

SCORE_PREFERENCE_ORDER = ["das28_crp", "das28_esr", "cdai", "sdai"]  # see ASSUMPTION #6
TREND_NOISE_THRESHOLD = 0.1  # see ASSUMPTION #6

JOINT_SEVERITY_RANK = {"none": 0, "tender": 1, "swollen": 1, "tender_swollen": 2}  # see ASSUMPTION #5


# ═════════════════════════════════════════════════════════════════════════════
# UPSTREAM LOOKUPS — every field access is defensive (.get with fallback); a
# domain with fewer than two records (or none at all where only one is
# needed) degrades to `null` rather than guessing. See ASSUMPTIONS #3-4, #7.
# ═════════════════════════════════════════════════════════════════════════════

async def _get_recent(collection, patient_id: str, doctor_id: str, limit: int) -> list:
    try:
        cursor = collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("created_at", -1).limit(limit)
        return [doc async for doc in cursor]
    except Exception as e:
        logger.warning(f"Follow-up: lookup failed on {collection.name} for {patient_id}: {e}")
        return []


def _iso(value):
    return value.isoformat() if isinstance(value, datetime) else value


# ═════════════════════════════════════════════════════════════════════════════
# DOMAIN 1 — JOINT FINDINGS (Module 2) — see ASSUMPTION #5
# ═════════════════════════════════════════════════════════════════════════════

def _diff_joint_maps(records: list) -> Optional[dict]:
    if len(records) < 2:
        return None

    current_doc, previous_doc = records[0], records[1]
    current_joints = (current_doc.get("joint_map") or {}).get("joints") or {}
    previous_joints = (previous_doc.get("joint_map") or {}).get("joints") or {}

    newly_affected, escalated, resolved, improved = [], [], [], []

    all_joint_ids = set(current_joints) | set(previous_joints)
    for joint_id in sorted(all_joint_ids):
        cur_status = current_joints.get(joint_id, "none")
        prev_status = previous_joints.get(joint_id, "none")
        if cur_status == prev_status:
            continue

        cur_rank = JOINT_SEVERITY_RANK.get(cur_status, 0)
        prev_rank = JOINT_SEVERITY_RANK.get(prev_status, 0)

        if prev_rank == 0 and cur_rank > 0:
            newly_affected.append({"joint": joint_id, "status": cur_status})
        elif cur_rank == 0 and prev_rank > 0:
            resolved.append({"joint": joint_id, "previous_status": prev_status})
        elif cur_rank > prev_rank:
            escalated.append({"joint": joint_id, "previous_status": prev_status, "status": cur_status})
        elif cur_rank < prev_rank:
            improved.append({"joint": joint_id, "previous_status": prev_status, "status": cur_status})

    return {
        "previous_date": _iso(previous_doc.get("created_at")),
        "current_date": _iso(current_doc.get("created_at")),
        "newly_affected": newly_affected,
        "escalated": escalated,
        "resolved": resolved,
        "improved": improved,
    }


# ═════════════════════════════════════════════════════════════════════════════
# DOMAIN 2 — LABS (Module 5) — see ASSUMPTION #4
# ═════════════════════════════════════════════════════════════════════════════

async def _get_lab_changes(patient_id: str, doctor_id: str) -> Optional[dict]:
    try:
        doc = await lab_trend_analysis_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
    except Exception as e:
        logger.warning(f"Follow-up: lab trend analysis lookup failed for {patient_id}: {e}")
        return None

    if not doc:
        return None

    trends = doc.get("trends") or []
    changed = [t for t in trends if t.get("direction") and t.get("direction") != "stable"]

    return {
        "analysis_date": _iso(doc.get("created_at")),
        "changed": changed,
    }


# ═════════════════════════════════════════════════════════════════════════════
# DOMAIN 3 — DISEASE ACTIVITY (Module 6) — see ASSUMPTION #6
# ═════════════════════════════════════════════════════════════════════════════

def _diff_disease_activity(records: list) -> Optional[dict]:
    if len(records) < 2:
        return None

    current_doc, previous_doc = records[0], records[1]
    current_scores = current_doc.get("scores") or {}
    previous_scores = previous_doc.get("scores") or {}

    metric_used = None
    for metric in SCORE_PREFERENCE_ORDER:
        if current_scores.get(metric) and previous_scores.get(metric):
            metric_used = metric
            break

    trend = None
    delta = None
    if metric_used:
        curr_val = current_scores[metric_used].get("value")
        prev_val = previous_scores[metric_used].get("value")
        if isinstance(curr_val, (int, float)) and isinstance(prev_val, (int, float)):
            delta = round(curr_val - prev_val, 2)
            if delta > TREND_NOISE_THRESHOLD:
                trend = "worsening"
            elif delta < -TREND_NOISE_THRESHOLD:
                trend = "improving"
            else:
                trend = "stable"

    return {
        "previous_date": _iso(previous_doc.get("created_at")),
        "current_date": _iso(current_doc.get("created_at")),
        "previous_scores": previous_scores,
        "current_scores": current_scores,
        "metric_used": metric_used,
        "delta": delta,
        "trend": trend,
    }


# ═════════════════════════════════════════════════════════════════════════════
# DOMAIN 4 — IMAGING (Module 11) — see ASSUMPTION #7
# ═════════════════════════════════════════════════════════════════════════════

async def _get_imaging_changes(patient_id: str, doctor_id: str) -> Optional[dict]:
    try:
        doc = await imaging_comparison_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
    except Exception as e:
        logger.warning(f"Follow-up: imaging comparison lookup failed for {patient_id}: {e}")
        return None

    if not doc:
        return None

    comparisons = doc.get("comparisons") or []
    changed = [c for c in comparisons if c.get("direction") and c.get("direction") != "stable"]

    return {
        "comparison_date": _iso(doc.get("created_at")),
        "changed": changed,
    }


FOLLOWUP_NARRATIVE_PROMPT = """
You are a clinical assistant preparing a rheumatologist for an upcoming
visit. You will be given "what changed since the last visit" across up to
four domains — joint findings, lab results, disease activity scores, and
imaging — each already diffed by rule-based code, not by you. Any domain
with a null value means there isn't enough history yet to compare, not
that nothing changed.

Return a JSON object with exactly one key, "narrative": ONE short
paragraph (3-5 sentences) a physician can read in under a minute right
before walking into the room, covering only the domains that have actual
data. Reference the specific joints, tests, scores, or imaging regions
given.

Rules:
- Do NOT change, soften, or second-guess any diff, trend, or direction
  already provided — describe it, don't re-evaluate it.
- Do NOT recommend a specific drug, dose, or test — that decision belongs
  to the physician.
- Do NOT invent findings not present in the input, and do NOT comment on
  a domain that is null beyond noting briefly that it isn't available.
- Return valid JSON only — no markdown, no commentary, no extra keys.
"""


# ═════════════════════════════════════════════════════════════════════════════
# 1. BRIEFING (read-only; rule engine + optional narrative, like Module 15's
#    /dashboard)
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-followup/briefing/{patient_id}/{doctor_id}")
async def get_followup_briefing(patient_id: str, doctor_id: str):
    """
    One-screen "what's changed since the last visit" briefing. Read-only:
    never writes anything (saving a reviewed copy is a separate call to
    /save). See module docstring for the source of each domain.
    """
    joint_records = await _get_recent(joint_map_collection, patient_id, doctor_id, limit=2)
    joint_changes = _diff_joint_maps(joint_records)

    lab_changes = await _get_lab_changes(patient_id, doctor_id)

    activity_records = await _get_recent(disease_activity_collection, patient_id, doctor_id, limit=2)
    disease_activity_changes = _diff_disease_activity(activity_records)

    imaging_changes = await _get_imaging_changes(patient_id, doctor_id)

    finaloutput = {
        "joint_findings": joint_changes,
        "labs": lab_changes,
        "disease_activity": disease_activity_changes,
        "imaging": imaging_changes,
        "narrative": None,
    }

    has_any_data = any([joint_changes, lab_changes, disease_activity_changes, imaging_changes])

    if has_any_data and groq_client is not None:
        try:
            completion = groq_client.chat.completions.create(
                model="openai/gpt-oss-120b",
                messages=[
                    {"role": "system", "content": FOLLOWUP_NARRATIVE_PROMPT},
                    {"role": "user", "content": json.dumps({k: v for k, v in finaloutput.items() if k != "narrative"}, indent=2, default=str)},
                ],
                temperature=0,
                response_format={"type": "json_object"},
            )
            parsed = json.loads(completion.choices[0].message.content)
            if isinstance(parsed, dict) and parsed.get("narrative"):
                finaloutput["narrative"] = str(parsed["narrative"])[:800]
        except Exception as e:
            logger.warning(f"Follow-up: narrative generation failed for {patient_id}: {e}")

    return {"status": "success", "finaloutput": finaloutput, "has_any_data": has_any_data}


# ═════════════════════════════════════════════════════════════════════════════
# 2. SAVE
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-followup/save")
async def save_followup_briefing(payload: dict):
    """
    Expected payload (doctor-reviewed version of /briefing's finaloutput):
    {
        "patient_id": "...", "doctor_id": "...",
        "briefing": { ...finaloutput as returned by /briefing... }
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        briefing = payload.get("briefing")

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if not isinstance(briefing, dict) or not briefing:
            raise HTTPException(status_code=400, detail="briefing is required and cannot be empty")

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "briefing": briefing,
            "created_at": datetime.utcnow(),
            "type": "rheumatology_followup_briefing",
        }
        result = await briefing_collection.insert_one(document)

        return {"status": "success", "message": "Follow-up briefing saved", "id": str(result.inserted_id)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 3. HISTORY
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-followup/history/{patient_id}/{doctor_id}")
async def get_followup_history(patient_id: str, doctor_id: str):
    """Fetch all saved follow-up briefings for a patient, most recent first."""
    try:
        cursor = briefing_collection.find(
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