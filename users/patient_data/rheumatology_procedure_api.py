"""
rheumatology_procedure_api.py
─────────────────────────────────────────────────────────────────────────────
DoctorAssist.AI — Rheumatology AI Workflow, Module 12: Intra-Articular
Procedure Intelligence (v1.0).

Covers steroid injection, hyaluronic acid injection, arthrocentesis, and
other intra-articular procedures. Per the roadmap, AI assistance here is
scoped to: joint identification, effusion/synovitis reference guidance,
needle trajectory/landmark reference text, and procedure documentation —
NOT live ultrasound pixel analysis. No other module in this codebase does
real image analysis (confirmed: RheumatologyImaging.jsx/rheumatology_
imaging_api.py is a manual structured-finding log, not pixel analysis),
so this module does not fake one either.

THIS IS EXPLICITLY AN ASSISTIVE GUIDANCE SYSTEM, NOT AUTONOMOUS PROCEDURE
CONTROL — every guidance/briefing response carries that framing verbatim,
same "physician decision required" pattern as Module 7 (Treatment
Decision).

Three parts:
  1. A static, structured guidance/checklist panel per procedure type and
     joint family — landmark/needle-approach REFERENCE TEXT, not live
     image analysis. Doctor-referenced only.
  2. An optional LLM "pre-procedure briefing" that combines the static
     guidance with the most recent saved imaging finding (if any) for
     that joint — purely descriptive, never decides anything, never
     recommends a specific needle trajectory beyond what's already in
     the static guidance, never recommends a medication/dose.
  3. A doctor-entered procedure log (procedure type, joint/region, date,
     indication, medication/volume, complications, outcome) — same
     manual-entry philosophy as Modules 5/9/10/12/14. Nothing here is
     AI-detected; it's all doctor-confirmed.

ROUTES IN THIS FILE
---------------------
  GET    /rheumatology-procedure/context-preview/{patient_id}/{doctor_id}
  GET    /rheumatology-procedure/guidance-panel/{procedure_type}/{joint_region}
  POST   /rheumatology-procedure/generate-briefing
  GET    /rheumatology-procedure/live-guidance-status
  POST   /rheumatology-procedure/add-procedure
  DELETE /rheumatology-procedure/procedure/{procedure_id}
  GET    /rheumatology-procedure/history/{patient_id}/{doctor_id}

⚠️ ASSUMPTIONS MADE WHILE ASSEMBLING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. ROUTER MOUNT: same convention as every other rheumatology file —
     `prefix="/context"`, mount with `app.include_router(...)` in main.py.

  2. COLLECTION NAME: "rheumatology_procedure_log" for the doctor-entered
     procedure log. Change PROCEDURE_LOG_COLLECTION_NAME below if you
     want a different name. Guidance/checklist content is static Python
     data, not stored in Mongo — there's nothing to migrate.

  3. NO SEPARATE /save ROUTE, DELIBERATELY: unlike modules with an
     LLM-drafted output the doctor reviews before persisting, there is no
     AI-generated draft here to review-then-save — /add-procedure IS the
     persistence action, same reasoning as Module 9's Treatment Ledger
     (ASSUMPTION #3 there: facts the doctor already knows, entered
     directly, no LLM step needed for the write itself). The generate-
     briefing endpoint below is a read-only reference/decision-support
     call and its output is never itself persisted — if the doctor wants
     to keep something from it, they copy it into the procedure log's
     free-text `notes` field when they call /add-procedure.

  4. JOINT_REGION VOCABULARY IS INDIVIDUAL-JOINT, BUT GUIDANCE CONTENT IS
     GROUPED BY JOINT FAMILY: JOINT_REGION_ALLOWED lists individual sided
     joints (e.g. "knee_L", "mcp3_R") so the procedure log can record
     exactly which joint was injected, matching Module 2/6's naming
     pattern for consistency. But landmark/needle-approach reference text
     doesn't meaningfully differ between e.g. "mcp1_L" and "mcp4_R", so
     JOINT_LANDMARK_GUIDANCE is keyed by joint FAMILY (shoulder, elbow,
     wrist, mcp, pip, hip, knee, ankle, subtalar, sacroiliac) via
     `_joint_family()`. This is NOT the same joint vocabulary as Module 2
     or Module 11 — don't assume a string here matches JOINT_IDS or
     REGION_ALLOWED in those files.

  5. GUIDANCE TEXT IS GENERIC TEXTBOOK-LEVEL REFERENCE MATERIAL —
     [UNCONFIRMED — clinical review required], same status as every
     other module's first-draft clinical content (e.g. Module 14's taper
     rules). PROCEDURE_TYPE_GUIDANCE and JOINT_LANDMARK_GUIDANCE are
     commonly-cited ultrasound-guided-injection teaching points, not
     sourced from a specific institutional protocol. Every guidance
     response is labeled "Reference material — not real-time image
     analysis" and should be reviewed before relying on it clinically.

  6. GENERATE-BRIEFING READS MODULE 11's IMAGING COLLECTION READ-ONLY:
     pulls the single most recent `rheumatology_imaging_studies` entry
     for the same joint_region (falls back gracefully to None if none
     exists or the region strings don't line up — see ASSUMPTION #4,
     this file's joint_region strings and Module 11's REGION_ALLOWED
     strings are NOT guaranteed identical for every entry, e.g. Module 11
     has no per-MCP/PIP granularity — a "hand_L" imaging study won't
     match an "mcp3_L" procedure log entry. This is a best-effort
     cross-reference, not a hard join; the LLM is told explicitly when no
     matching imaging was found rather than silently omitting the
     mismatch).

  7. LLM NARRATIVE IS OPTIONAL, NEVER DECIDES ANYTHING, NEVER GIVES A
     DOSE/DRUG RECOMMENDATION: same "rule engine/static content decides,
     LLM only narrates" boundary as every prior module, except here
     there's no rule engine because there's nothing computed — the LLM's
     only job is to plainly restate the static guidance + any imaging
     finding as a short pre-procedure summary, explicitly framed as
     assistive reference material requiring physician confirmation of
     every step. It is never given free rein to invent a needle
     trajectory, dose, or medication choice.

  8. NO LIVE ULTRASOUND ANALYSIS, NOT EVEN STUBBED AS FUNCTIONAL:
     GET /live-guidance-status exists only so the frontend has a stable
     endpoint to check "is live image analysis available" and render
     accordingly — it always returns `available: false` with an
     explanatory message. It does not accept an image, does not queue
     anything, and does not pretend to process pixel data. This is the
     "future hook" the handoff prompt allowed for, kept intentionally
     inert rather than fake-functional.

  9. INDICATION / OUTCOME / COMPLICATION ARE CLOSED VOCABULARIES,
     enforced server-side, with a free-text detail field for
     complications (`complications_detail`) since "Other" needs
     elaboration — same closed-list-plus-detail-field pattern as Module
     14's `reason_stopped` / `reason_stopped_detail`.

 10. READ-ONLY REACHES INTO OTHER MODULES' COLLECTIONS (imaging) ARE
     WRAPPED IN TRY/EXCEPT AND DEGRADE TO None/EMPTY, per house
     convention — a broken lookup never blocks the procedure log itself.
─────────────────────────────────────────────────────────────────────────
"""

import os
import json
import logging
from datetime import datetime
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

PROCEDURE_LOG_COLLECTION_NAME = "rheumatology_procedure_log"  # see ASSUMPTION #2

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    procedure_log_collection = database[PROCEDURE_LOG_COLLECTION_NAME]
    # Read-only reach into Module 11's collection — see ASSUMPTION #6
    imaging_studies_collection = database["rheumatology_imaging_studies"]
except Exception as e:
    logger.error(f"Error initializing MongoDB in rheumatology_procedure_api: {e}")

# ─── Groq setup ─────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client: Optional[Groq] = None
try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        logger.warning("GROQ_API_KEY not set — procedure briefing narrative will be skipped (static guidance still returns).")
except Exception as e:
    logger.error(f"Error initializing Groq client in rheumatology_procedure_api: {e}")

router = APIRouter(prefix="/context", tags=["Rheumatology Intra-Articular Procedure Intelligence"])

# ─── Closed vocabularies ──────────────────────────────────────────────────────
PROCEDURE_TYPE_ALLOWED = {
    "Steroid injection",
    "Hyaluronic acid injection",
    "Arthrocentesis",
    "Other intra-articular procedure",
}

_SIDES = ["L", "R"]
JOINT_REGION_ALLOWED = (
    [f"shoulder_{s}" for s in _SIDES]
    + [f"elbow_{s}" for s in _SIDES]
    + [f"wrist_{s}" for s in _SIDES]
    + [f"mcp{n}_{s}" for s in _SIDES for n in range(1, 6)]
    + [f"pip{n}_{s}" for s in _SIDES for n in range(1, 6)]
    + [f"hip_{s}" for s in _SIDES]
    + [f"knee_{s}" for s in _SIDES]
    + [f"ankle_{s}" for s in _SIDES]
    + [f"subtalar_{s}" for s in _SIDES]
    + ["sacroiliac_L", "sacroiliac_R"]
)
JOINT_REGION_ALLOWED_SET = set(JOINT_REGION_ALLOWED)

INDICATION_ALLOWED = {
    "Synovitis", "Effusion", "Disease flare", "Pain relief / analgesia",
    "Diagnostic aspiration", "Post-procedure follow-up", "Other",
}
OUTCOME_ALLOWED = {"Improved", "Partial improvement", "No change", "Worsened", "Not yet assessed"}
COMPLICATION_ALLOWED = {
    "None", "Post-injection flare", "Infection", "Bleeding / hematoma",
    "Skin atrophy or depigmentation", "Vasovagal reaction", "Other",
}

# ─── Static guidance content — see ASSUMPTION #5 ─────────────────────────────
PROCEDURE_TYPE_GUIDANCE = {
    "Steroid injection": {
        "overview": "Intra-articular corticosteroid injection for synovitis/inflammatory flare not adequately controlled by systemic therapy alone.",
        "contraindications": "Active local or systemic infection, uncontrolled coagulopathy, joint prosthesis (relative), poorly controlled diabetes (relative — discuss glycemic risk).",
        "aftercare": "Advise relative rest 24-48h, monitor for post-injection flare vs. septic arthritis (worsening pain, fever, warmth beyond 48h warrants urgent review).",
    },
    "Hyaluronic acid injection": {
        "overview": "Viscosupplementation, most evidence in osteoarthritis; symptomatic pain relief rather than disease-modifying.",
        "contraindications": "Active local infection, known hypersensitivity to the specific HA product/avian-derived products if applicable.",
        "aftercare": "Advise avoiding strenuous joint loading for 24-48h; effect may take 1-2 weeks to become apparent.",
    },
    "Arthrocentesis": {
        "overview": "Diagnostic and/or therapeutic aspiration — send fluid for cell count/differential, crystal analysis, and culture as clinically indicated.",
        "contraindications": "Overlying cellulitis/skin infection at the planned entry site, uncontrolled coagulopathy (relative).",
        "aftercare": "Monitor aspirate volume/character; send for lab analysis per indication; watch for re-accumulation or signs of septic arthritis.",
    },
    "Other intra-articular procedure": {
        "overview": "Use the free-text notes field on the procedure log to document the specific procedure performed.",
        "contraindications": "Apply standard intra-articular procedure precautions — active infection, uncontrolled coagulopathy.",
        "aftercare": "Document aftercare instructions given in the procedure log notes.",
    },
}

JOINT_LANDMARK_GUIDANCE = {
    "shoulder": {"landmarks": "Glenohumeral joint — posterior or anterior approach, humeral head/glenoid as sonographic landmarks.", "avoid": "Axillary nerve/posterior circumflex humeral vessels (posterior approach); biceps tendon (anterior approach)."},
    "elbow": {"landmarks": "Posterior approach between olecranon and lateral epicondyle, or direct posterior with elbow flexed ~90°.", "avoid": "Ulnar nerve (medial approach — avoid), radial nerve (lateral)."},
    "wrist": {"landmarks": "Dorsal approach, radiocarpal joint between extensor tendons.", "avoid": "Extensor tendons, superficial radial nerve branches, radial artery."},
    "mcp": {"landmarks": "Dorsal approach with the joint in slight flexion, extensor tendon as the sonographic reference.", "avoid": "Extensor tendon, digital neurovascular bundles."},
    "pip": {"landmarks": "Dorsolateral approach, small target — ultrasound guidance strongly preferred over landmark-only.", "avoid": "Extensor tendon central slip, collateral ligaments, digital neurovascular bundles."},
    "hip": {"landmarks": "Anterior approach under ultrasound, femoral head-neck junction as target; ultrasound guidance strongly preferred (deep joint, adjacent neurovascular structures).", "avoid": "Femoral neurovascular bundle (stay lateral to it)."},
    "knee": {"landmarks": "Lateral or medial mid-patellar approach, or superolateral approach with knee extended.", "avoid": "Patellar tendon, infrapatellar fat pad, neurovascular structures at the popliteal fossa (if posterior approach considered)."},
    "ankle": {"landmarks": "Anteromedial or anterolateral approach to the tibiotalar joint.", "avoid": "Anterior tibial/dorsalis pedis neurovascular bundle, extensor tendons."},
    "subtalar": {"landmarks": "Posterolateral or sinus tarsi approach under ultrasound guidance.", "avoid": "Sural nerve, peroneal tendons."},
    "sacroiliac": {"landmarks": "Posterior approach under ultrasound or fluoroscopic guidance to the inferior/posterior joint recess.", "avoid": "Superior gluteal and posterior sacral neurovascular structures — this is a deep, technically demanding target; image guidance strongly preferred."},
}


def _joint_family(joint_region: str) -> Optional[str]:
    for family in JOINT_LANDMARK_GUIDANCE:
        if joint_region.startswith(family):
            return family
    return None


ASSISTIVE_DISCLAIMER = (
    "This is assistive reference guidance only — not autonomous procedure "
    "control and not real-time image analysis. The physician performing "
    "the procedure is responsible for joint identification, target "
    "confirmation, needle placement, and all clinical decisions."
)


# ═════════════════════════════════════════════════════════════════════════════
# 1. CONTEXT PREVIEW
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-procedure/context-preview/{patient_id}/{doctor_id}")
async def get_procedure_context_preview(patient_id: str, doctor_id: str):
    """Read-only: closed vocabularies for the frontend dropdowns + a summary of prior logged procedures."""
    summary = {}
    try:
        cursor = procedure_log_collection.find({"patient_id": patient_id, "doctor_id": doctor_id})
        async for doc in cursor:
            region = doc.get("joint_region", "unknown")
            entry = summary.setdefault(region, {"count": 0, "most_recent_date": None})
            entry["count"] += 1
            d = doc.get("date")
            if d and (entry["most_recent_date"] is None or d > entry["most_recent_date"]):
                entry["most_recent_date"] = d
    except Exception as e:
        logger.warning(f"Procedure: prior procedure summary lookup failed for {patient_id}: {e}")

    return {
        "status": "success",
        "data": {
            "procedure_types": sorted(PROCEDURE_TYPE_ALLOWED),
            "joint_regions": JOINT_REGION_ALLOWED,
            "indications": sorted(INDICATION_ALLOWED),
            "outcomes": sorted(OUTCOME_ALLOWED),
            "complications": sorted(COMPLICATION_ALLOWED),
            "prior_procedures_by_region": summary,
        },
    }


# ═════════════════════════════════════════════════════════════════════════════
# 2. STATIC GUIDANCE PANEL
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-procedure/guidance-panel/{procedure_type}/{joint_region}")
async def get_guidance_panel(procedure_type: str, joint_region: str):
    """
    Static, structured reference content — NOT live image analysis. See
    ASSUMPTIONS #4/#5. Validated against closed vocabularies.
    """
    if procedure_type not in PROCEDURE_TYPE_ALLOWED:
        raise HTTPException(status_code=400, detail=f"procedure_type must be one of: {sorted(PROCEDURE_TYPE_ALLOWED)}")
    if joint_region not in JOINT_REGION_ALLOWED_SET:
        raise HTTPException(status_code=400, detail=f"joint_region must be one of: {JOINT_REGION_ALLOWED}")

    family = _joint_family(joint_region)
    joint_guidance = JOINT_LANDMARK_GUIDANCE.get(family) if family else None

    return {
        "status": "success",
        "data": {
            "procedure_type_guidance": PROCEDURE_TYPE_GUIDANCE.get(procedure_type),
            "joint_landmark_guidance": joint_guidance,
            "disclaimer": ASSISTIVE_DISCLAIMER,
        },
    }


# ═════════════════════════════════════════════════════════════════════════════
# 3. LIVE GUIDANCE STATUS STUB — see ASSUMPTION #8
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-procedure/live-guidance-status")
async def get_live_guidance_status():
    """
    Always returns available: false. Exists so the frontend has a stable
    endpoint to check for live-ultrasound-analysis support without a
    separate deploy — this module does not, and does not pretend to,
    analyze image/pixel data.
    """
    return {
        "status": "success",
        "available": False,
        "message": "Live ultrasound image analysis is not implemented in this version. Use the static guidance panel and pre-procedure briefing for reference support.",
    }


# ═════════════════════════════════════════════════════════════════════════════
# 4. GENERATE BRIEFING
# ═════════════════════════════════════════════════════════════════════════════

async def _get_latest_imaging_for_region(patient_id: str, doctor_id: str, joint_region: str) -> Optional[dict]:
    """Best-effort cross-reference — see ASSUMPTION #6. Degrades to None."""
    try:
        doc = await imaging_studies_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id, "region": joint_region},
            sort=[("date", -1)],
        )
        if doc:
            return {
                "modality": doc.get("modality"),
                "date": doc.get("date"),
                "finding": doc.get("finding"),
                "radiologist_impression": doc.get("radiologist_impression"),
            }
    except Exception as e:
        logger.warning(f"Procedure: imaging cross-reference failed for {patient_id}/{joint_region}: {e}")
    return None


BRIEFING_PROMPT = f"""
You are a clinical assistant preparing a rheumatologist for an
ultrasound-guided intra-articular procedure. You will be given static
reference guidance (procedure-type overview/contraindications/aftercare,
and joint-specific landmark/avoid notes) and, optionally, the most
recent saved imaging finding for the same joint. NONE of this is live
image analysis — you are only asked to summarize what's already given.

Return a JSON object with exactly one key, "narrative": ONE short
paragraph (3-5 sentences) a physician can read in under a minute right
before the procedure, restating the key landmark/avoid points and, if an
imaging finding was provided, noting what it showed for context.

Rules:
- This is assistive reference material only, NOT autonomous procedure
  control — do not phrase anything as an instruction to be followed
  blindly; the physician makes every decision.
- Do NOT invent landmarks, findings, or precautions not present in the
  input.
- Do NOT recommend a specific medication, dose, or volume — that
  decision belongs to the physician.
- Do NOT claim to have analyzed an image — you are only summarizing
  text that was already given to you.
- Return valid JSON only — no markdown, no commentary, no extra keys.
"""


@router.post("/rheumatology-procedure/generate-briefing")
async def generate_procedure_briefing(payload: dict):
    """
    Expected payload:
    { "doctor_id": "...", "patient_id": "...",
      "procedure_type": "Steroid injection", "joint_region": "knee_L" }

    Returns:
    { "status": "success",
      "finaloutput": { "guidance": {...}, "recent_imaging": {...}|None,
                        "narrative": str|None, "disclaimer": str } }
    """
    patient_id = payload.get("patient_id")
    doctor_id = payload.get("doctor_id")
    procedure_type = str(payload.get("procedure_type", ""))
    joint_region = str(payload.get("joint_region", ""))

    if not patient_id or not doctor_id:
        raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
    if procedure_type not in PROCEDURE_TYPE_ALLOWED:
        raise HTTPException(status_code=400, detail=f"procedure_type must be one of: {sorted(PROCEDURE_TYPE_ALLOWED)}")
    if joint_region not in JOINT_REGION_ALLOWED_SET:
        raise HTTPException(status_code=400, detail=f"joint_region must be one of: {JOINT_REGION_ALLOWED}")

    family = _joint_family(joint_region)
    guidance = {
        "procedure_type_guidance": PROCEDURE_TYPE_GUIDANCE.get(procedure_type),
        "joint_landmark_guidance": JOINT_LANDMARK_GUIDANCE.get(family) if family else None,
    }
    recent_imaging = await _get_latest_imaging_for_region(patient_id, doctor_id, joint_region)

    narrative = None
    if groq_client is not None:
        try:
            llm_input = {"guidance": guidance, "recent_imaging": recent_imaging}
            completion = groq_client.chat.completions.create(
                model="openai/gpt-oss-120b",
                messages=[
                    {"role": "system", "content": BRIEFING_PROMPT},
                    {"role": "user", "content": json.dumps(llm_input, indent=2, default=str)},
                ],
                temperature=0,
                response_format={"type": "json_object"},
            )
            parsed = json.loads(completion.choices[0].message.content)
            if isinstance(parsed, dict) and parsed.get("narrative"):
                narrative = str(parsed["narrative"])[:800]
        except Exception as e:
            logger.warning(f"Procedure: briefing narrative failed for {patient_id}/{joint_region}: {e}")

    return {
        "status": "success",
        "finaloutput": {
            "guidance": guidance,
            "recent_imaging": recent_imaging,
            "narrative": narrative,
            "disclaimer": ASSISTIVE_DISCLAIMER,
        },
    }


# ═════════════════════════════════════════════════════════════════════════════
# 5. PROCEDURE LOG — ADD / DELETE / HISTORY
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-procedure/add-procedure")
async def add_procedure(payload: dict):
    """
    Expected payload:
    {
        "patient_id": "...", "doctor_id": "...",
        "procedure_type": "Steroid injection",
        "joint_region": "knee_L",
        "date": "2026-08-01",
        "indication": "Synovitis",
        "medication_name": "Triamcinolone 40mg",   # free text, optional
        "volume_ml": 1.0,                            # optional
        "complications": "None",
        "complications_detail": "",                  # required only if complications != "None"/"Other" empty
        "outcome": "Not yet assessed",
        "notes": "optional free text"
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        procedure_type = str(payload.get("procedure_type", ""))
        joint_region = str(payload.get("joint_region", ""))
        date_str = payload.get("date") or datetime.utcnow().strftime("%Y-%m-%d")
        indication = str(payload.get("indication", ""))
        medication_name = str(payload.get("medication_name", ""))
        volume_ml = payload.get("volume_ml")
        complications = str(payload.get("complications", "None"))
        complications_detail = str(payload.get("complications_detail", ""))
        outcome = str(payload.get("outcome", "Not yet assessed"))
        notes = str(payload.get("notes", ""))

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if procedure_type not in PROCEDURE_TYPE_ALLOWED:
            raise HTTPException(status_code=400, detail=f"procedure_type must be one of: {sorted(PROCEDURE_TYPE_ALLOWED)}")
        if joint_region not in JOINT_REGION_ALLOWED_SET:
            raise HTTPException(status_code=400, detail=f"joint_region must be one of: {JOINT_REGION_ALLOWED}")
        if indication not in INDICATION_ALLOWED:
            raise HTTPException(status_code=400, detail=f"indication must be one of: {sorted(INDICATION_ALLOWED)}")
        if complications not in COMPLICATION_ALLOWED:
            raise HTTPException(status_code=400, detail=f"complications must be one of: {sorted(COMPLICATION_ALLOWED)}")
        if outcome not in OUTCOME_ALLOWED:
            raise HTTPException(status_code=400, detail=f"outcome must be one of: {sorted(OUTCOME_ALLOWED)}")
        try:
            datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="date must be in YYYY-MM-DD format")

        if volume_ml is not None:
            try:
                volume_ml = float(volume_ml)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="volume_ml must be numeric")

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "procedure_type": procedure_type,
            "joint_region": joint_region,
            "date": date_str,
            "indication": indication,
            "medication_name": medication_name[:200],
            "volume_ml": volume_ml,
            "complications": complications,
            "complications_detail": complications_detail[:500],
            "outcome": outcome,
            "notes": notes[:1000],
            "created_at": datetime.utcnow(),
            "type": "rheumatology_procedure_log",
        }
        result = await procedure_log_collection.insert_one(document)

        return {"status": "success", "message": "Procedure logged", "id": str(result.inserted_id)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/rheumatology-procedure/procedure/{procedure_id}")
async def delete_procedure(procedure_id: str):
    try:
        try:
            oid = ObjectId(procedure_id)
        except InvalidId:
            raise HTTPException(status_code=400, detail="Invalid procedure_id")

        result = await procedure_log_collection.delete_one({"_id": oid})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Procedure not found")

        return {"status": "success", "message": "Procedure deleted"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/rheumatology-procedure/history/{patient_id}/{doctor_id}")
async def get_procedure_history(patient_id: str, doctor_id: str):
    """All logged procedures for a patient, most recent date first. Used by both the main component's quick list and the paired History component."""
    try:
        cursor = procedure_log_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("date", -1)

        records = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            if isinstance(doc.get("created_at"), datetime):
                doc["created_at"] = doc["created_at"].isoformat()
            records.append(doc)

        return {"status": "success", "count": len(records), "data": records}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))