"""
rheumatology_investigation_planner_api.py
─────────────────────────────────────────────────────────────────────────────
DoctorAssist.AI — Rheumatology AI Workflow, Module 4: Autoimmune
Investigation Planner (v1.0).

Reads Module 3's SAVED differential diagnosis (likely / possible / must-not-
miss, each with its own evidence) and proposes an investigation plan where
every test carries an explicit "why this test?" tied to specific
condition(s) from the differential — not a generic panel dump. Doctor
reviews, edits priority/status, deletes items, and saves.

Mirrors rheumatology_intake_api.py / rheumatology_joint_map_api.py /
rheumatology_differential_diagnosis_api.py's route naming, response
shapes, and error-handling convention 1:1.

ROUTES IN THIS FILE
---------------------
  GET  /rheumatology-investigation/differential-context/{patient_id}/{doctor_id}
  POST /rheumatology-investigation/generate
  POST /rheumatology-investigation/save
  GET  /rheumatology-investigation/history/{patient_id}/{doctor_id}

⚠️ ASSUMPTIONS MADE WHILE ASSEMBLING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. ROUTER MOUNT: same convention as the other rheumatology files —
     `prefix="/context"`, mount with `app.include_router(...)` in main.py.

  2. COLLECTION NAME: "rheumatology_investigation_plan" (analogous to the
     three prior modules). Change PLAN_COLLECTION_NAME below if you want
     a different name.

  3. REQUIRES A SAVED DIFFERENTIAL: /generate reads the most recent SAVED
     rheumatology_differential_diagnosis document (Module 3's own
     collection), not a live/unsaved one still open in the UI. If none
     exists, this returns 400 asking the doctor to complete and save
     Module 3 first. This mirrors how Module 2 reads Module 1's saved
     intake rather than something still being typed. If you'd rather let
     the frontend pass an in-memory (unsaved) differential straight into
     /generate as an alternative input, tell me and I'll add an optional
     `differentialDiagnosis` payload field that short-circuits the DB
     lookup when present.

  4. CLOSED TEST CATALOG: like the joint-ID and condition vocabularies in
     the earlier modules, INVESTIGATION_CATALOG below is a fixed,
     closed list the LLM must choose from — not free text. This keeps
     downstream modules (e.g. a future Lab Trend Intelligence module)
     able to rely on stable test names. The catalog was assembled from
     standard rheumatology autoimmune work-up practice and the specific
     RA/SLE/gout examples in the roadmap note, not pulled from a live
     formulary/LOINC list — please review INVESTIGATION_CATALOG against
     your actual lab menu before relying on it, and tell me if any test
     names need to match specific LOINC/lab-system codes instead of the
     plain-English names used here.

  5. NO ORDER PLACEMENT / NO WRITE TO EXISTING GENERIC INVESTIGATION
     COLLECTIONS: this module does NOT write into
     documentation-investigation-notes (the generic dictation-driven
     investigation module already in DoctorDashboard.jsx) or the
     oncology-specific `oncology-investigations` collection used by
     handleSave() there. It only saves to its own
     rheumatology_investigation_plan collection. If you want a saved
     rheumatology plan to also appear in the generic Investigation Notes
     panel (so it shows up in the same place as everything else ordered
     for the patient), tell me and I'll add a bridging write — kept
     separate for now so this module doesn't silently mutate a
     collection another module owns.

  6. PRIORITY, NOT SCHEDULING: each investigation gets a "Routine" or
     "Urgent" priority (mirrors the priority field already used in
     documentation-investigation-notes' investigation_orders shape), not
     a specific due date — the roadmap describes this as a planning aid,
     not an order-entry/scheduling system.

  7. DUPLICATE-TEST DETECTION + PREVIOUS-RESULT COMPARISON (NEW, Tier 4
     #5): each generated investigation is enriched with a `duplicate_check`
     object. "previously_ordered" comes from THIS module's own saved
     history (rheumatology_investigation_plan) — fully confirmed/reliable,
     since it's our own controlled collection. "previous_result" comes
     from rheumatology_lab_results, matching on the exact test_name
     string. That lookup is CONFIRMED reliable only for the 6 names this
     file shares with rheumatology_dmard_safety_api.py's confirmed usage
     of that same collection (Hemoglobin, WBC, Platelet Count, AST, ALT,
     Creatinine) — for every other catalog name (RF, Anti-CCP, ANA, ESR,
     CRP, HLA-B27, imaging studies, etc.) this is an [UNCONFIRMED] guess
     that rheumatology_lab_trends_api.py (not yet reviewed) writes under
     the identical string. A mismatch just means no previous result
     shows — it degrades gracefully, never breaks generation. This is
     purely additive/informational — nothing is auto-excluded or
     auto-deduplicated from the AI's suggestions, per the PDF's explicit
     "clinical decision support, not autonomous ordering" requirement for
     this module; the doctor sees the flag and decides.
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

PLAN_COLLECTION_NAME = "rheumatology_investigation_plan"  # see ASSUMPTION #2

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    investigation_plan_collection = database[PLAN_COLLECTION_NAME]
    differential_collection = database["rheumatology_differential_diagnosis"]
    lab_results_collection = database["rheumatology_lab_results"]
except Exception as e:
    logger.error(f"Error initializing MongoDB in rheumatology_investigation_planner_api: {e}")

# ─── Groq setup ─────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client: Optional[Groq] = None
try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        logger.warning("GROQ_API_KEY not set — investigation planner LLM endpoints will fail at call time.")
except Exception as e:
    logger.error(f"Error initializing Groq client in rheumatology_investigation_planner_api: {e}")

router = APIRouter(prefix="/context", tags=["Rheumatology Investigation Planner"])

# ─── Same closed condition vocabulary as Module 3 — kept in sync manually ───
# (duplicated rather than imported to avoid a cross-file import dependency;
#  if these ever drift from rheumatology_differential_diagnosis_api.py's
#  DIFFERENTIAL_CONDITIONS_ALLOWED, condition-linking validation below will
#  silently drop any mismatched condition name — worth a shared constants
#  module if this pattern grows further.)
DIFFERENTIAL_CONDITIONS_ALLOWED = {
    "Rheumatoid arthritis",
    "Systemic lupus erythematosus (SLE)",
    "Psoriatic arthritis",
    "Ankylosing spondylitis / axial spondyloarthritis",
    "Reactive arthritis",
    "Gout",
    "CPPD (pseudogout)",
    "Osteoarthritis",
    "Sjögren syndrome",
    "Systemic sclerosis",
    "Vasculitis",
    "Myositis",
    "Mixed connective-tissue disease (MCTD)",
    "Antiphospholipid syndrome (APS)",
    "Juvenile inflammatory arthritis",
}

TIER_KEYS = ["likely", "possible", "must_not_miss"]

# ─── Closed investigation catalog — see ASSUMPTION #4 ────────────────────────
INVESTIGATION_CATALOG = {
    "Serology / Autoantibody": [
        "Rheumatoid Factor (RF)",
        "Anti-CCP (Anti-Citrullinated Peptide Antibody)",
        "ANA (Antinuclear Antibody)",
        "Anti-dsDNA",
        "Anti-Sm",
        "Anti-Ro/SSA",
        "Anti-La/SSB",
        "Anti-Scl-70",
        "Anti-centromere Antibody",
        "Anti-RNP",
        "Anti-Jo-1",
        "Antiphospholipid Antibody Panel (Lupus Anticoagulant, Anticardiolipin, Anti-β2-glycoprotein I)",
        "HLA-B27",
        "ANCA (p-ANCA / c-ANCA)",
        "Complement C3/C4",
    ],
    "Inflammatory Markers": [
        "ESR",
        "CRP",
    ],
    "Hematology / Chemistry": [
        "Complete Blood Count (CBC)",
        "Renal Function Panel (Creatinine/eGFR)",
        "Liver Function Tests (LFTs)",
        "Serum Uric Acid",
        "Creatine Kinase (CK)",
    ],
    "Urine Studies": [
        "Urinalysis",
        "Urine Protein-to-Creatinine Ratio (Spot UPCR)",
    ],
    "Joint / Procedure": [
        "Synovial Fluid Analysis (Crystal Exam, Gram Stain, Culture)",
    ],
    "Imaging": [
        "X-ray (affected joint/region)",
        "Musculoskeletal Ultrasound",
        "MRI (affected joint/region)",
        "Sacroiliac Joint Imaging (X-ray/MRI)",
        "HRCT Chest",
        "Echocardiogram",
    ],
}

INVESTIGATION_NAME_TO_CATEGORY = {
    name: category for category, names in INVESTIGATION_CATALOG.items() for name in names
}
ALL_INVESTIGATION_NAMES = set(INVESTIGATION_NAME_TO_CATEGORY.keys())

PRIORITY_ALLOWED = {"Routine", "Urgent"}


# ═════════════════════════════════════════════════════════════════════════════
# 1. DIFFERENTIAL CONTEXT (lets the frontend show what will feed the planner)
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-investigation/differential-context/{patient_id}/{doctor_id}")
async def get_investigation_differential_context(patient_id: str, doctor_id: str):
    """
    Read-only preview of the most recent SAVED differential diagnosis
    (Module 3) — shown in the frontend before the doctor requests a plan,
    and used internally by /generate as the actual context.
    """
    try:
        doc = await differential_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        if not doc:
            return {"status": "success", "data": None, "has_differential": False}

        differential = doc.get("differential_diagnosis") or {}
        data = {
            "differential_diagnosis": differential,
            "working_diagnosis": doc.get("working_diagnosis", ""),
            "saved_at": doc.get("created_at").isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
        }
        has_content = any(differential.get(t) for t in TIER_KEYS)
        return {"status": "success", "data": data, "has_differential": has_content}
    except Exception as e:
        logger.warning(f"Investigation planner: differential context lookup failed for {patient_id}: {e}")
        return {"status": "success", "data": None, "has_differential": False}


# ═════════════════════════════════════════════════════════════════════════════
# 2. GENERATE INVESTIGATION PLAN
# ═════════════════════════════════════════════════════════════════════════════

INVESTIGATION_CATALOG_TEXT = "\n".join(
    f"  {category}: {', '.join(names)}" for category, names in INVESTIGATION_CATALOG.items()
)


# ─── Duplicate-test / previous-result helpers — see ASSUMPTION #7 ───────────

async def _get_previous_order(patient_id: str, doctor_id: str, test_name: str) -> Optional[dict]:
    """
    Own-collection lookup — fully confirmed/reliable. Finds the most
    recent SAVED plan (across all history, most-recent-first) that
    contained this exact test_name, and returns its status + when it
    was saved.
    """
    try:
        cursor = investigation_plan_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("created_at", -1)
        async for doc in cursor:
            items = (doc.get("investigation_plan") or {}).get("investigations") or []
            for item in items:
                if item.get("test_name") == test_name:
                    created = doc.get("created_at")
                    return {
                        "status": item.get("status", "Planned"),
                        "ordered_date": created.isoformat() if isinstance(created, datetime) else created,
                    }
        return None
    except Exception as e:
        logger.warning(f"Investigation planner: previous-order lookup failed for {patient_id}/{test_name}: {e}")
        return None


async def _get_previous_lab_result(patient_id: str, doctor_id: str, test_name: str) -> Optional[dict]:
    """
    Cross-module lookup against rheumatology_lab_results — CONFIRMED
    reliable only for the 6 test names shared with
    rheumatology_dmard_safety_api.py; [UNCONFIRMED] guess for every other
    catalog name until rheumatology_lab_trends_api.py is reviewed. See
    ASSUMPTION #7 — degrades gracefully on mismatch.
    """
    try:
        doc = await lab_results_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id, "test_name": test_name},
            sort=[("date", -1)],
        )
        if doc:
            return {"value": doc.get("value"), "date": doc.get("date")}
    except Exception as e:
        logger.warning(f"Investigation planner: previous-result lookup failed for {patient_id}/{test_name}: {e}")
    return None

INVESTIGATION_PROMPT = f"""
You are a clinical assistant supporting a rheumatologist. You will be given
a saved differential diagnosis (conditions sorted into likely / possible /
must-not-miss tiers, each with supporting evidence) and optionally extra
clinical context. Your job is to propose an investigation plan.

The defining requirement: every investigation you propose must have an
explicit, specific reason tied to one or more named conditions from the
differential. Do NOT propose a generic "standard autoimmune panel" — only
propose a test if it would meaningfully help confirm, refute, or risk-
stratify a SPECIFIC condition that is actually in the differential given.

Choose test names ONLY from this exact closed catalog (use the exact
string, category shown for reference):
{INVESTIGATION_CATALOG_TEXT}

Return a JSON object with exactly one key, "investigations", a list of
objects. Each object must have exactly these keys:
  - "test_name": one of the exact strings from the catalog above.
  - "linked_conditions": a list of 1+ condition strings, each one of the
    conditions actually present in the differential you were given (use
    the exact condition string as given).
  - "rationale": one short sentence explaining specifically why THIS test
    helps for the linked condition(s) — e.g. "Anti-CCP is more specific
    than RF for rheumatoid arthritis and would support the likely-tier
    finding of symmetrical small-joint polyarthritis", not just "to check
    for RA".
  - "priority": "Urgent" if the test is needed to rule out or confirm a
    must-not-miss condition, or if the clinical picture suggests urgency;
    otherwise "Routine".

Rules:
- Do not repeat the same test_name twice in the list — if it supports
  multiple conditions, list all of them in linked_conditions once.
- Prioritize tests that would most efficiently narrow the differential —
  do not propose every catalog test that could theoretically relate to a
  condition; propose the ones that matter most given the specific
  evidence provided.
- Every must-not-miss condition in the input should have at least one
  linked investigation in your output, unless there is genuinely no
  catalog test relevant to it — do not silently drop a must-not-miss
  condition.
- Return valid JSON only — no markdown formatting, no commentary, no
  extra top-level keys.
"""


@router.post("/rheumatology-investigation/generate")
async def generate_investigation_plan(payload: dict):
    """
    Expected payload:
    {
        "doctor_id": "...",
        "patient_id": "...",
        "additional_context": "optional free text — e.g. contraindications,
                                 patient preference, recent relevant labs
                                 already known but not yet in the system"
    }

    Returns:
    {
        "status": "success",
        "finaloutput": { "investigations": [...] },
        "differential_used": {...}
    }
    """
    if groq_client is None:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured on server")

    patient_id = payload.get("patient_id")
    doctor_id = payload.get("doctor_id")
    additional_context = (payload.get("additional_context") or "").strip()

    if not patient_id or not doctor_id:
        raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")

    diff_doc = await differential_collection.find_one(
        {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
    )
    differential = (diff_doc or {}).get("differential_diagnosis") or {}

    if not any(differential.get(t) for t in TIER_KEYS):
        raise HTTPException(
            status_code=400,
            detail=(
                "No saved differential diagnosis found for this patient. Please complete "
                "and save Module 3 (Differential Diagnosis) first."
            ),
        )

    llm_input = {"differential_diagnosis": differential, "additional_context": additional_context}

    try:
        completion = groq_client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[
                {"role": "system", "content": INVESTIGATION_PROMPT},
                {"role": "user", "content": json.dumps(llm_input, indent=2, default=str)},
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )
        raw_content = completion.choices[0].message.content
        try:
            parsed = json.loads(raw_content)
        except (json.JSONDecodeError, TypeError):
            logger.error(f"Investigation plan generation returned non-JSON: {raw_content}")
            parsed = {}
        if not isinstance(parsed, dict):
            parsed = {}

        raw_items = parsed.get("investigations")
        clean_items = []
        seen_names = set()
        if isinstance(raw_items, list):
            for item in raw_items:
                if not isinstance(item, dict):
                    continue
                test_name = str(item.get("test_name", ""))
                if test_name not in ALL_INVESTIGATION_NAMES or test_name in seen_names:
                    continue
                linked_raw = item.get("linked_conditions")
                linked = []
                if isinstance(linked_raw, list):
                    linked = [c for c in linked_raw if str(c) in DIFFERENTIAL_CONDITIONS_ALLOWED]
                if not linked:
                    continue  # never persist a test with no grounded reason
                rationale = str(item.get("rationale", ""))[:400]
                if not rationale:
                    continue
                priority = str(item.get("priority", "Routine"))
                if priority not in PRIORITY_ALLOWED:
                    priority = "Routine"
                seen_names.add(test_name)
                clean_items.append({
                    "test_name": test_name,
                    "category": INVESTIGATION_NAME_TO_CATEGORY.get(test_name, ""),
                    "linked_conditions": linked,
                    "rationale": rationale,
                    "priority": priority,
                })

        for item in clean_items:
            prev_order = await _get_previous_order(patient_id, doctor_id, item["test_name"])
            prev_result = await _get_previous_lab_result(patient_id, doctor_id, item["test_name"])
            item["duplicate_check"] = {
                "previously_ordered": prev_order is not None,
                "previous_status": prev_order["status"] if prev_order else None,
                "previous_ordered_date": prev_order["ordered_date"] if prev_order else None,
                "previous_result_value": prev_result["value"] if prev_result else None,
                "previous_result_date": prev_result["date"] if prev_result else None,
            }

        return {
            "status": "success",
            "finaloutput": {"investigations": clean_items},
            "differential_used": differential,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Investigation plan generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 3. SAVE
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-investigation/save")
async def save_investigation_plan(payload: dict):
    """
    Expected payload (from RheumatologyInvestigationPlanner.jsx's onSave —
    doctor-reviewed/edited version):
    {
        "patient_id": "...",
        "doctor_id": "...",
        "investigationPlan": {
            "investigations": [
                {"test_name","category","linked_conditions","rationale","priority"}, ...
            ]
        },
        "additionalContext": "optional — audit trail of what was typed"
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        plan = payload.get("investigationPlan") or {}
        additional_context = payload.get("additionalContext") or ""

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")

        items = plan.get("investigations") or []
        if not isinstance(items, list) or not items:
            raise HTTPException(status_code=400, detail="investigationPlan.investigations is required and cannot be empty")

        clean_items = []
        for item in items:
            if not isinstance(item, dict):
                continue
            test_name = str(item.get("test_name", ""))
            if test_name not in ALL_INVESTIGATION_NAMES:
                continue
            linked = [c for c in (item.get("linked_conditions") or []) if str(c) in DIFFERENTIAL_CONDITIONS_ALLOWED]
            priority = str(item.get("priority", "Routine"))
            if priority not in PRIORITY_ALLOWED:
                priority = "Routine"
            clean_items.append({
                "test_name": test_name,
                "category": INVESTIGATION_NAME_TO_CATEGORY.get(test_name, ""),
                "linked_conditions": linked,
                "rationale": str(item.get("rationale", ""))[:400],
                "priority": priority,
                "status": str(item.get("status", "Planned"))[:30],
                "duplicate_check": item.get("duplicate_check") if isinstance(item.get("duplicate_check"), dict) else None,
            })

        if not clean_items:
            raise HTTPException(status_code=400, detail="No valid investigations to save")

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "investigation_plan": {"investigations": clean_items},
            "additional_context": str(additional_context)[:2000],
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
            "type": "rheumatology_investigation_plan",
        }
        result = await investigation_plan_collection.insert_one(document)

        return {
            "status": "success",
            "message": "Investigation plan saved",
            "id": str(result.inserted_id),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 4. HISTORY
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-investigation/history/{patient_id}/{doctor_id}")
async def get_investigation_plan_history(patient_id: str, doctor_id: str):
    """
    Fetch all Investigation Plan records for a patient, most recent first.
    """
    try:
        cursor = investigation_plan_collection.find(
            {"patient_id": patient_id, "doctor_id": doctor_id}
        ).sort("created_at", -1)

        records = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            if isinstance(doc.get("created_at"), datetime):
                doc["created_at"] = doc["created_at"].isoformat()
            if isinstance(doc.get("updated_at"), datetime):
                doc["updated_at"] = doc["updated_at"].isoformat()
            records.append(doc)

        return {"status": "success", "count": len(records), "data": records}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))