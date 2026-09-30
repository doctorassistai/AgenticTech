"""
rheumatology_differential_diagnosis_api.py
─────────────────────────────────────────────────────────────────────────────
DoctorAssist.AI — Rheumatology AI Workflow, Module 3: Differential Diagnosis
Engine (v1.0).

Reads Module 1 (rheumatology_intake_api.py) and Module 2
(rheumatology_joint_map_api.py) output as its ONLY structured context —
plus an optional free-text "additional findings" dictation for anything
not yet captured by those two forms (e.g. a rash, dry eyes, a family
member's diagnosis mentioned only today) — and produces a three-tier
differential:

    Likely → Possible → Must not miss

with an evidence list per condition, grounded strictly in what was
actually provided. This is explicitly NOT an autonomous diagnosis: the
doctor reviews, edits, deletes, and optionally promotes one condition to
a "working diagnosis" before saving.

Mirrors rheumatology_intake_api.py's / rheumatology_joint_map_api.py's
route naming, response shapes, and error-handling convention 1:1.

ROUTES IN THIS FILE
---------------------
  GET  /rheumatology-differential/context-preview/{patient_id}/{doctor_id}
  POST /rheumatology-differential/generate
  POST /rheumatology-differential/save
  GET  /rheumatology-differential/history/{patient_id}/{doctor_id}

NOT included here (future modules, out of scope for this file):
  - Autoimmune Investigation Planner (Module 4) — that module will read
    THIS module's saved differential the same way this module reads
    Module 1 + Module 2, to justify "why this test" against whichever
    conditions are in the likely/possible/must-not-miss lists.

⚠️ ASSUMPTIONS MADE WHILE ASSEMBLING THIS FILE — confirm before deploy:
─────────────────────────────────────────────────────────────────────────
  1. ROUTER MOUNT: same convention as the other rheumatology files —
     `prefix="/context"`, mount with `app.include_router(...)` in main.py.

  2. COLLECTION NAME: "rheumatology_differential_diagnosis" (analogous to
     "rheumatology_intake" / "rheumatology_joint_map"). Change
     DIFFERENTIAL_COLLECTION_NAME below if you want a different name.

  3. CONTEXT SOURCES: this module intentionally does NOT read labs or
     imaging — Module 4 (Investigation Planner) hasn't run yet at this
     point in the workflow for a first visit, so there's nothing
     structured to read. If a patient already has
     documentation-investigation-notes on file (e.g. a follow-up visit,
     not a fresh intake), that's still not pulled in here — keeping this
     module's context surface identical to what Module 1 + Module 2
     actually captured avoids silently mixing in stale/unrelated lab
     data from an unrelated visit. Worth revisiting once Module 4 exists
     and there's a reliable way to scope "labs relevant to this workup."

  4. CONDITION LIST: fixed to the 15 conditions named in the roadmap
     note (RA, SLE, PsA, axial SpA, reactive arthritis, gout, CPPD, OA,
     Sjögren, systemic sclerosis, vasculitis, myositis, MCTD, APS,
     juvenile inflammatory arthritis). The LLM is constrained to pick
     only from this list — no free-form condition names — so downstream
     modules (Investigation Planner, Disease Activity Engine) can rely on
     a closed vocabulary. If you want to allow the LLM to name a
     condition outside this list (e.g. "IBD-associated arthritis"), tell
     me and I'll loosen DIFFERENTIAL_CONDITIONS_ALLOWED to a soft
     suggestion instead of a hard filter.

  5. "WORKING DIAGNOSIS": the save payload accepts an optional
     `workingDiagnosis` string (the condition text the doctor promoted).
     This route does NOT itself write to the generic diagnosis_data
     collection that DoctorDashboard.jsx's saveDiagnosis()/diagnosisText
     use — that write happens in the existing dashboard flow when the
     frontend's onApprove callback fires (same pattern DiagnosisAnalysis
     component already uses). Keeping this route's save purely additive
     (store the differential + which one was promoted) rather than
     reaching into the unrelated diagnosis_data collection directly.

  6. NO CONFIDENCE PERCENTAGES: the prompt asks for a short
     "confidence_note" (free text, e.g. "strong pattern match" /
     "single supporting feature, needs serology") rather than a numeric
     confidence score — a fabricated-looking percentage on an unreviewed
     LLM differential risks being read as more authoritative than
     intended. If you'd rather have a coarse categorical confidence
     (High/Medium/Low) instead of free text, say so and I'll add it as
     an enum field.

  7. TRIAGE INPUTS (added later, Requirement #3 — Symptom-Based Disease
     Identification, Categorization & Triage): the triage category is
     derived from the SAME context this module already used — intake +
     joint map + additional findings. The requirements note also lists
     Age and Sex as triage inputs, and this module does NOT currently
     pull those in, because they live in the patient-profile
     collection/schema which was not available at the time this change
     was made. If you tell me that collection name and its age/sex field
     names, I'll add them to `_gather_differential_context` so the LLM
     has them for triage specifically (they should NOT be used to
     influence the differential tiers themselves — only triage urgency —
     to avoid quietly changing Module 3's existing, already-reviewed
     differential behavior). Constitutional symptoms (fever/fatigue/
     weight loss) are similarly not a first-class intake field today —
     if present they'd have to come through free-text
     `additional_findings` or `history_of_present_illness` until Module 1
     (Intake) is extended with an explicit field.
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

DIFFERENTIAL_COLLECTION_NAME = "rheumatology_differential_diagnosis"  # see ASSUMPTION #2

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]

    differential_collection = database[DIFFERENTIAL_COLLECTION_NAME]
    rheumatology_intake_collection = database["rheumatology_intake"]
    joint_map_collection = database["rheumatology_joint_map"]
except Exception as e:
    logger.error(f"Error initializing MongoDB in rheumatology_differential_diagnosis_api: {e}")

# ─── Groq setup ─────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client: Optional[Groq] = None
try:
    if GROQ_API_KEY:
        groq_client = Groq(api_key=GROQ_API_KEY)
    else:
        logger.warning("GROQ_API_KEY not set — differential diagnosis LLM endpoints will fail at call time.")
except Exception as e:
    logger.error(f"Error initializing Groq client in rheumatology_differential_diagnosis_api: {e}")

router = APIRouter(prefix="/context", tags=["Rheumatology Differential Diagnosis"])

# ─── Closed condition vocabulary — see ASSUMPTION #4 ─────────────────────────
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

TIER_ALLOWED = {"likely", "possible", "must_not_miss"}

# Clarifying-question types the frontend knows how to render — a strict
# yes/no toggle, or a short free-text box. See generate_differential_diagnosis
# for how these are attached per-condition when evidence is thin/ambiguous.
CLARIFYING_QUESTION_TYPES_ALLOWED = {"yes_no", "descriptive"}
# ─── Triage vocabulary — closed list, added for Requirement #3 (Symptom-Based
# Disease Identification, Categorization & Triage). See ASSUMPTION #7 above. ──
TRIAGE_CATEGORIES_ALLOWED = {
    "Urgent",
    "High Priority",
    "Routine Rheumatology",
    "Low Risk / Non-rheumatological pattern",
}

# ═════════════════════════════════════════════════════════════════════════════
# 1. CONTEXT PREVIEW (lets the frontend show what will feed the engine)
# ═════════════════════════════════════════════════════════════════════════════

def _summarize_intake(intake: dict) -> dict:
    if not intake:
        return {}
    keys = [
        "chief_complaint", "history_of_present_illness", "onset", "progression",
        "joint_distribution", "joint_size", "joint_symmetry", "axial_involvement",
        "morning_stiffness_minutes", "affected_joints", "extra_articular_symptoms",
        "previous_autoimmune_disease", "family_history", "comorbidities",
        "pregnancy_reproductive_considerations",
    ]
    return {k: intake.get(k) for k in keys if intake.get(k) not in (None, "", [])}


def _summarize_joint_map(joint_map: dict) -> dict:
    if not joint_map:
        return {}
    keys = ["joints", "enthesitis_sites", "dactylitis_digits", "axial_involvement",
            "rom_limitation", "pain_severity", "functional_impact"]
    return {k: joint_map.get(k) for k in keys if joint_map.get(k) not in (None, "", [], {})}


async def _gather_differential_context(patient_id: str, doctor_id: str) -> dict:
    """Pulls the latest intake + latest joint map for this patient/doctor pair."""
    context = {"intake": {}, "joint_map": {}}

    try:
        intake_doc = await rheumatology_intake_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        if intake_doc:
            context["intake"] = _summarize_intake(intake_doc.get("rheumatology_intake") or {})
    except Exception as e:
        logger.warning(f"Differential context: intake lookup failed for {patient_id}: {e}")

    try:
        jm_doc = await joint_map_collection.find_one(
            {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("created_at", -1)]
        )
        if jm_doc:
            context["joint_map"] = _summarize_joint_map(jm_doc.get("joint_map") or {})
    except Exception as e:
        logger.warning(f"Differential context: joint map lookup failed for {patient_id}: {e}")

    return context


@router.get("/rheumatology-differential/context-preview/{patient_id}/{doctor_id}")
async def get_differential_context_preview(patient_id: str, doctor_id: str):
    """
    Read-only preview of exactly what Module 1 + Module 2 data will be sent
    to the LLM if /generate is called right now — shown in the frontend so
    the doctor can see the basis for the differential before requesting it.
    """
    context = await _gather_differential_context(patient_id, doctor_id)
    has_data = bool(context["intake"] or context["joint_map"])
    return {"status": "success", "data": context, "has_data": has_data}


# ═════════════════════════════════════════════════════════════════════════════
# 2. GENERATE DIFFERENTIAL
# ═════════════════════════════════════════════════════════════════════════════
DIFFERENTIAL_PROMPT = f"""
You are a clinical assistant supporting a rheumatologist. You will be
given structured intake data, structured joint-examination data, and
optionally free-text "additional findings" dictated for this visit. Use
ONLY this information — never invent joints, symptoms, labs, or history
not present in the input.

Your task has two parts: (1) sort a differential diagnosis into three
tiers, and (2) assign an overall triage category for this visit.

Choose conditions ONLY from this exact list (use the exact string):
{json.dumps(sorted(DIFFERENTIAL_CONDITIONS_ALLOWED))}

Choose the triage category ONLY from this exact list (use the exact
string):
{json.dumps(sorted(TRIAGE_CATEGORIES_ALLOWED))}

Return a JSON object with exactly these four top-level keys:

- "likely": a list of condition objects (see shape below) the clinical
  pattern most strongly supports.
- "possible": a list of condition objects worth keeping on the list but
  with weaker or more limited supporting evidence.
- "must_not_miss": a list of condition objects that are not necessarily
  the most probable, but which carry serious consequences if missed and
  should not be dismissed without explicit work-up (e.g. vasculitis
  presenting atypically, early inflammatory arthritis that could be RA).
- "triage": a single object (not a list) with exactly two keys:
    - "category": one of the exact triage strings above, reflecting how
      urgently this case should be reviewed/seen, based on the pattern
      of symptoms actually present (e.g. acute monoarthritis with fever
      raising concern for septic arthritis, or a must_not_miss condition
      with red-flag features, should generally push toward "Urgent" or
      "High Priority"; a chronic, stable, low-severity presentation with
      no must_not_miss support should generally be "Routine
      Rheumatology"; a presentation with no rheumatological pattern at
      all should be "Low Risk / Non-rheumatological pattern").
    - "rationale": ONE short free-text sentence explaining the triage
      category, grounded in the actual input (e.g. "Chronic symmetrical
      polyarthritis with no red-flag features — appropriate for routine
      scheduling" or "Acute severe monoarthritis with fever raises
      concern for septic arthritis — needs urgent same-day review").
  If the input is too sparse to responsibly judge urgency, still return
  the "triage" object, set "category" to "Routine Rheumatology", and say
  so plainly in "rationale" (e.g. "Insufficient information to assess
  urgency — defaulting to routine; clinician should confirm").

Each condition object (inside "likely" / "possible" / "must_not_miss")
must have exactly these keys:
  - "condition": one of the exact strings from the allowed condition
    list above.
  - "evidence": a list of 1-5 short strings, each a specific fact drawn
    directly from the input (e.g. "Symmetrical small-joint polyarthritis",
    "Morning stiffness 90 minutes", "Family history of psoriasis").
    Do NOT include vague filler like "clinical suspicion" — every item
    must trace back to something actually in the input.
  - "confidence_note": ONE short free-text phrase (not a number)
    describing how strong the support is, e.g. "strong pattern match",
    "single supporting feature — needs serology to clarify",
    "atypical presentation, low probability but serious if present".
  - "clarifying_questions": a list of 0-4 question objects, ONLY included
    when this condition's evidence is limited, ambiguous, or when a single
    additional fact would materially change your confidence in it. Do NOT
    generate questions for conditions that already have strong, clear
    support. Each question object has exactly these keys:
      - "id": a short stable identifier, e.g. "q1", "q2" (unique within
        this condition's own question list — it does not need to be
        unique across the whole response).
      - "question": ONE short, specific, patient-answerable clinical
        question — phrased as something the doctor could literally ask
        the patient (e.g. "Is there morning stiffness lasting more than
        60 minutes?", "Have you noticed a rash on sun-exposed skin?").
        Never phrase it as something only a lab result could answer.
      - "type": either "yes_no" (a strict yes/no question) or
        "descriptive" (a question needing a short free-text answer, e.g.
        "Describe the pattern and timing of the joint pain"). Use
        "yes_no" whenever the question can genuinely be answered with
        yes or no — prefer it over "descriptive" unless a free-text
        answer is truly required.
    If a condition's evidence is already strong and unambiguous, return
    an empty list ("clarifying_questions": []) rather than inventing
    questions for the sake of it.

Rules:
- Only include a condition if there is at least one real piece of
  supporting evidence in the input. Do not pad the list with conditions
  that have zero support just to fill a tier.
- It is fine — and expected — for a tier to be an empty list if nothing
  qualifies.
- Never present a condition as a confirmed diagnosis. This is a
  differential for physician review, not a diagnosis.
- The triage category is a scheduling/urgency aid for the clinician, not
  a clinical decision made on the AI's behalf — never omit the "triage"
  object, and never invent urgency-related facts (fever, acuity, etc.)
  that were not actually present in the input.
- When a condition's supporting evidence is thin, ambiguous, or could be
  confirmed/excluded by one or two follow-up questions, populate that
  condition's "clarifying_questions" so the doctor can ask the patient
  directly rather than the differential silently presenting an
  under-supported condition as more certain than it is. Never answer
  these questions yourself or assume an answer — leave them for the
  doctor and patient.
- Return valid JSON only — no markdown formatting, no commentary, no
  extra top-level keys.
"""


@router.post("/rheumatology-differential/generate")
async def generate_differential_diagnosis(payload: dict):
    """
    Expected payload:
    {
        "doctor_id": "...",
        "patient_id": "...",
        "additional_findings": "optional free text dictation"
    }

    Returns:
    {
        "status": "success",
        "finaloutput": {
            "likely": [...], "possible": [...], "must_not_miss": [...]
        },
        "context_used": { "intake": {...}, "joint_map": {...}, "additional_findings": "..." }
    }
    """
    if groq_client is None:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured on server")

    patient_id = payload.get("patient_id")
    doctor_id = payload.get("doctor_id")
    additional_findings = (payload.get("additional_findings") or "").strip()

    if not patient_id or not doctor_id:
        raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")

    context = await _gather_differential_context(patient_id, doctor_id)

    if not context["intake"] and not context["joint_map"] and not additional_findings:
        raise HTTPException(
            status_code=400,
            detail=(
                "No intake or joint map data found for this patient, and no additional "
                "findings were provided. Please complete Module 1 (Intake) and/or "
                "Module 2 (Joint Mapping) first, or add additional findings text."
            ),
        )

    llm_input = {
        "intake": context["intake"],
        "joint_map": context["joint_map"],
        "additional_findings": additional_findings,
    }

    try:
        completion = groq_client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[
                {"role": "system", "content": DIFFERENTIAL_PROMPT},
                {"role": "user", "content": json.dumps(llm_input, indent=2, default=str)},
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )
        raw_content = completion.choices[0].message.content
        try:
            parsed = json.loads(raw_content)
        except (json.JSONDecodeError, TypeError):
            logger.error(f"Differential diagnosis generation returned non-JSON: {raw_content}")
            parsed = {}
        if not isinstance(parsed, dict):
            parsed = {}

        clean = {"likely": [], "possible": [], "must_not_miss": [], "triage": None}

        for tier in TIER_ALLOWED:
            items = parsed.get(tier)
            if not isinstance(items, list):
                continue
            cleaned_items = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                condition = str(item.get("condition", ""))
                if condition not in DIFFERENTIAL_CONDITIONS_ALLOWED:
                    continue
                evidence_raw = item.get("evidence")
                evidence = []
                if isinstance(evidence_raw, list):
                    evidence = [str(e)[:300] for e in evidence_raw if str(e).strip()][:5]
                if not evidence:
                    continue  # see rule: never include a condition with zero support
                confidence_note = str(item.get("confidence_note", ""))[:200]

                clarifying_questions = []
                cq_raw = item.get("clarifying_questions")
                if isinstance(cq_raw, list):
                    for qi, q in enumerate(cq_raw[:4]):
                        if not isinstance(q, dict):
                            continue
                        q_text = str(q.get("question", "")).strip()[:300]
                        q_type = str(q.get("type", "")).strip()
                        if not q_text or q_type not in CLARIFYING_QUESTION_TYPES_ALLOWED:
                            continue
                        q_id = str(q.get("id") or f"q{qi + 1}")[:20]
                        clarifying_questions.append({
                            "id": q_id,
                            "question": q_text,
                            "type": q_type,
                        })

                cleaned_items.append({
                    "condition": condition,
                    "evidence": evidence,
                    "confidence_note": confidence_note,
                    "clarifying_questions": clarifying_questions,
                })
            clean[tier] = cleaned_items

        # Triage — see requirement #3 (Symptom-Based Disease Identification,
        # Categorization & Triage). Validated against the closed vocabulary;
        # if the LLM returns something invalid/missing, we do NOT silently
        # guess an urgency level — we surface it as unset so the frontend can
        # flag it for manual review rather than showing a fabricated triage.
        triage_raw = parsed.get("triage")
        if isinstance(triage_raw, dict):
            triage_category = str(triage_raw.get("category", ""))
            triage_rationale = str(triage_raw.get("rationale", ""))[:400]
            if triage_category in TRIAGE_CATEGORIES_ALLOWED:
                clean["triage"] = {
                    "category": triage_category,
                    "rationale": triage_rationale,
                }
            else:
                logger.warning(
                    f"Differential diagnosis: LLM returned invalid triage category "
                    f"'{triage_category}' for patient {patient_id} — leaving triage unset."
                )

        return {
            "status": "success",
            "finaloutput": clean,
            "context_used": llm_input,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Differential diagnosis generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 3. SAVE
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/rheumatology-differential/save")
async def save_differential_diagnosis(payload: dict):
    """
    Expected payload (from RheumatologyDifferentialDiagnosis.jsx's onSave —
    doctor-reviewed/edited version, NOT necessarily the raw LLM output):
    {
        "patient_id": "...",
        "doctor_id": "...",
        "differentialDiagnosis": {
            "likely": [{"condition","evidence","confidence_note"}, ...],
            "possible": [...],
            "must_not_miss": [...]
        },
        "workingDiagnosis": "optional — condition string doctor promoted",
        "additionalFindings": "optional — the dictation text used, for audit",
        "triage": {"category": "...", "rationale": "..."} or null — optional,
            doctor-reviewed triage from /generate; not required so older
            frontend builds / manual saves without a triage still work
    }
    """
    try:
        patient_id = payload.get("patient_id")
        doctor_id = payload.get("doctor_id")
        differential = payload.get("differentialDiagnosis") or {}
        working_diagnosis = payload.get("workingDiagnosis") or ""
        additional_findings = payload.get("additionalFindings") or ""
        triage_payload = payload.get("triage")

        if not patient_id or not doctor_id:
            raise HTTPException(status_code=400, detail="Missing patient_id or doctor_id")
        if not differential or not any(differential.get(t) for t in TIER_ALLOWED):
            raise HTTPException(status_code=400, detail="differentialDiagnosis is required and cannot be empty")

        # Defensive filter — never persist a tier key or condition outside
        # the canonical vocabulary, even if the frontend sent something stale.
        clean_differential = {}
        for tier in TIER_ALLOWED:
            items = differential.get(tier) or []
            if not isinstance(items, list):
                continue
            clean_items = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                condition = str(item.get("condition", ""))
                if condition not in DIFFERENTIAL_CONDITIONS_ALLOWED:
                    continue
                evidence = item.get("evidence") or []

                # Clarifying questions the LLM proposed for this condition
                # (see generate_differential_diagnosis) — persisted as-is so
                # the history view can show what was asked, filtered to the
                # same closed type vocabulary.
                clarifying_questions = []
                for q in (item.get("clarifying_questions") or []):
                    if not isinstance(q, dict):
                        continue
                    q_type = str(q.get("type", ""))
                    if q_type not in CLARIFYING_QUESTION_TYPES_ALLOWED:
                        continue
                    clarifying_questions.append({
                        "id": str(q.get("id", ""))[:20],
                        "question": str(q.get("question", ""))[:300],
                        "type": q_type,
                    })

                # Doctor's answers to those questions, keyed by question id —
                # yes_no answers are "yes"/"no", descriptive answers are free
                # text. Optional: an unrefined save simply has no answers yet.
                clarifying_answers = {}
                answers_raw = item.get("clarifying_answers")
                if isinstance(answers_raw, dict):
                    for q_id, ans in answers_raw.items():
                        clarifying_answers[str(q_id)[:20]] = str(ans)[:500]

                clean_items.append({
                    "condition": condition,
                    "evidence": [str(e)[:300] for e in evidence if str(e).strip()][:10],
                    "confidence_note": str(item.get("confidence_note", ""))[:200],
                    "clarifying_questions": clarifying_questions,
                    "clarifying_answers": clarifying_answers,
                })
            clean_differential[tier] = clean_items

        clean_triage = None
        if isinstance(triage_payload, dict):
            triage_category = str(triage_payload.get("category", ""))
            if triage_category in TRIAGE_CATEGORIES_ALLOWED:
                clean_triage = {
                    "category": triage_category,
                    "rationale": str(triage_payload.get("rationale", ""))[:400],
                }
            # else: silently drop an invalid/stale category rather than persist it —
            # same defensive-filter convention already used above for conditions/tiers.

        document = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "differential_diagnosis": clean_differential,
            "working_diagnosis": str(working_diagnosis)[:300],
            "additional_findings": str(additional_findings)[:2000],
            "triage": clean_triage,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
            "type": "rheumatology_differential_diagnosis",
        }
        result = await differential_collection.insert_one(document)

        return {
            "status": "success",
            "message": "Differential diagnosis saved",
            "id": str(result.inserted_id),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═════════════════════════════════════════════════════════════════════════════
# 4. HISTORY
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/rheumatology-differential/history/{patient_id}/{doctor_id}")
async def get_differential_diagnosis_history(patient_id: str, doctor_id: str):
    """
    Fetch all Differential Diagnosis records for a patient, most recent
    first. Used by RheumatologyDifferentialDiagnosis.jsx (to show the last
    saved differential as a starting point) and a future read-only summary
    for other doctors on the case.
    """
    try:
        cursor = differential_collection.find(
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