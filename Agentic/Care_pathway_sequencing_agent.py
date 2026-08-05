"""
care_pathway_sequencing_agent.py
=================================
Care Pathway Sequencing Engine for DoctorAssist — v1.2.0

WHAT CHANGED IN v1.2.0
-----------------------
Added a second, independent entry point into the SAME output schema:

  POST /generate-care-pathway-from-dictation

This does NOT touch the existing MDT-aggregation flow
(`/generate-care-pathway`) at all — that pipeline is untouched below.

Instead, it lets a single doctor dictate the care plan they want
("first do X, then Y, then Z...") for one patient, and runs that raw
dictation text through the SAME downstream agents (clinical context
synthesis -> sequence planning -> status reconciliation -> safety
validation -> assembly) that the MDT flow uses, so the output is a
`CarePathwayPlan` with the exact same shape either way.

How it works:
  • DictationDataAggregationAgent (NEW) — pure DB agent. Fetches patient
    demographics exactly like PathwayDataAggregationAgent does, looks up
    the requesting doctor's specialty, and wraps the raw `dictation`
    string as the one-and-only `DoctorMDTOpinion` for this run. No
    tumor_board_cases aggregation happens in this path.
  • ClinicalContextSynthesisAgent, MDTSequencePlanningAgent,
    StatusReconciliationAgent, PathwaySafetyValidationAgent,
    CarePathwayAssembler — all REUSED UNCHANGED from the existing flow,
    because they already operate generically over a list of
    `DoctorMDTOpinion` objects (of which there's just one, here).

OUTPUT FORMAT IS UNCHANGED — `CarePathwayPlan` and every nested schema
are identical for both endpoints.

WHAT CHANGED IN v1.1.0
-----------------------
v1.0.0 pulled the patient's `patient_summary` document (clinical_summary +
timeline) as an additional grounding source alongside the MDT opinions.

v1.1.0 REMOVES that dependency entirely. This pipeline now builds the
entire care pathway — clinical context, sequencing, status, safety —
purely from the LATEST recommendation submitted by EVERY doctor on the
tumor board for this patient (`tumor_board_cases`). No `patient_summary`
lookup, no timeline parsing. This makes the pipeline self-contained and
decoupled from whatever shape `patient_summary` happens to be in.

Practical effect on each agent:
  • PathwayDataAggregationAgent   — no longer fetches patient_summary.
                                     Only patient demographics + latest-
                                     per-doctor MDT opinions.
  • ClinicalContextSynthesisAgent — extracts diagnosis/stage/intent AND
                                     completed-treatments purely from the
                                     MDT opinion texts (doctors routinely
                                     dictate prior history + already-done
                                     treatments as part of their opinion).
  • MDTSequencePlanningAgent      — unchanged in spirit: still builds one
                                     ordered, staged pathway from every
                                     doctor's opinion + the context above.
  • StatusReconciliationAgent     — reconciles against the MDT opinion
                                     texts + completed-treatments list
                                     instead of a separate timeline.
  • PathwaySafetyValidationAgent  — unchanged: audits sequencing/order,
                                     not individual drugs.
  • CarePathwayAssembler          — unchanged output shape.

Author: AI Architect
Version: 1.2.0
"""

import json
import traceback
from typing import Dict, Any, List, Optional, TypedDict
from datetime import datetime
from enum import Enum

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from motor.motor_asyncio import AsyncIOMotorClient

from langgraph.graph import StateGraph, END
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_groq import ChatGroq
from loguru import logger

import os
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(
    prefix="",
    tags=["care_pathway"],
    responses={404: {"description": "Not found"}},
)

# ─────────────────────────────────────────────────────────────────────
# STARTUP / IMPORT-TIME DEBUG LOGGING
# ─────────────────────────────────────────────────────────────────────
logger.info("🧩 [care_pathway_sequencing_agent] MODULE LOADED — building router")
logger.info(f"   MONGO_URI set          : {'yes' if os.getenv('MONGO_URI') else 'NO — MONGO_URI env var is missing!'}")
logger.info(f"   GROQ_API_KEY set        : {'yes' if os.getenv('GROQ_API_KEY') else 'NO — GROQ_API_KEY env var is missing!'}")

# =====================================================================
# DB SETUP — MongoDB only. patient_summary is INTENTIONALLY not opened
# here anymore — this pipeline no longer reads it.
# =====================================================================

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB  = "doctorassistai"
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

mongodb_client = AsyncIOMotorClient(MONGO_URI)
database       = mongodb_client[MONGO_DB]

patient_user_collection = database["patient_users"]
doctor_user_collection  = database["doctor_users"]
tumor_board_collection  = database["tumor_board_cases"]


# =====================================================================
# ENUMS
# =====================================================================

class StepStatus(str, Enum):
    PENDING     = "pending"      # not started, waiting on nothing blocking it OR waiting on a dependency
    IN_PROGRESS = "in_progress"  # actively underway per the MDT record
    COMPLETED   = "completed"    # MDT opinions confirm this was done
    ON_HOLD     = "on_hold"      # blocked — e.g. awaiting clearance, labs, or a decision
    SKIPPED     = "skipped"      # MDT/clinical course made this step moot


class SequenceModality(str, Enum):
    SURGICAL           = "surgical"
    CHEMOTHERAPY       = "chemotherapy"
    RADIATION          = "radiation"
    IMMUNOTHERAPY      = "immunotherapy"
    TARGETED_THERAPY   = "targeted_therapy"
    ENDOCRINE_THERAPY  = "endocrine_therapy"
    PROCEDURAL         = "procedural"
    INVESTIGATION      = "investigation"
    SUPPORTIVE_CARE    = "supportive_care"
    SURVEILLANCE       = "surveillance"
    OTHER              = "other"


# =====================================================================
# PYDANTIC SCHEMAS  (UNCHANGED — output format stays identical)
# =====================================================================

class DoctorMDTOpinion(BaseModel):
    """One doctor's latest MDT entry, fetched from tumor_board_cases."""
    doctor_id:             str
    specialty:             str = "unknown"
    doctor_recommendation: str = ""
    created_at:            Optional[str] = None


class CompletedTreatment(BaseModel):
    """A treatment step the patient has already had, extracted from the
    MDT opinion texts — used to reconcile step status."""
    treatment_name: str
    modality:       str = ""
    date:           Optional[str] = None
    outcome:        Optional[str] = None


class PathwayClinicalContext(BaseModel):
    primary_diagnosis:   str = ""
    cancer_stage:        str = ""
    treatment_intent:    str = ""   # curative / palliative / disease_modifying / symptom_control
    performance_status:  str = ""
    comorbidities:       List[str] = Field(default_factory=list)
    cardiac_findings:    List[str] = Field(default_factory=list)
    completed_treatments: List[CompletedTreatment] = Field(default_factory=list)
    clinical_summary_text: str = ""


class StepOccurrence(BaseModel):
    """
    A single repeatable unit inside a step — e.g. "Cycle 1 of 4" for
    chemotherapy, "Fraction 3 of 25" for radiation, "Session 2 of 6" for
    a procedural course. Every step ALWAYS has at least one occurrence
    (occurrence_number=1) even if it's a one-off event like a single
    surgery — this keeps the UI logic identical for every step: iterate
    `occurrences` and let the user tick each one off individually.
    """
    occurrence_number: int
    label:              str = ""   # e.g. "Cycle 1 of 4", "Fraction 12 of 25", "Surgery"
    scheduled_timing:   str = ""   # e.g. "Day 1", "Day 22 (3 weeks after Cycle 1)"
    scheduled_date:     Optional[str] = None  # concrete date if it can be computed/known
    status:             StepStatus = StepStatus.PENDING
    status_reason:      str = ""
    completed_date:     Optional[str] = None  # populated once status becomes 'completed'


class CarePathwayStep(BaseModel):
    step_number:      int
    phase_name:        str = ""     # e.g. "Neoadjuvant Chemotherapy"
    modality:          SequenceModality = SequenceModality.OTHER
    treatment_name:     str = ""    # e.g. "FOLFOX" / "Radical cystectomy"
    detailed_plan:      str = ""    # narrative detail: dose/cycles/technique etc.
    sequence_timing:    str = ""    # e.g. "Start immediately" / "1 week after Step 2 completes"
    depends_on_step:    Optional[int] = None
    estimated_duration: str = ""
    responsible_specialty: str = ""
    monitoring_before_starting: List[str] = Field(default_factory=list)
    rationale:          str = ""    # why this step, in this position — cites the MDT opinion(s)
    guideline_support:  str = ""
    contributing_doctors: List[str] = Field(default_factory=list)  # specialties that recommended this step
    is_urgent:          bool = False

    # ── Repeatable-unit breakdown (cycles / fractions / sessions) ──────────
    total_occurrences: int = 1
    occurrence_unit:   str = "session"  # e.g. "cycle", "fraction", "session", "procedure"
    occurrences:        List[StepOccurrence] = Field(default_factory=list)

    # ── Overall step status — ALWAYS DERIVED from `occurrences`, never set
    # directly. pending = none started, in_progress = some but not all done,
    # completed = all occurrences completed, on_hold = blocked before it can
    # even start, skipped = deliberately not done. ──────────────────────────
    status:        StepStatus = StepStatus.PENDING
    status_reason: str = ""   # e.g. "2 of 4 cycles completed — 2 remaining"


class CarePathwayPlan(BaseModel):
    patient_id:            str
    patient_age:           Optional[int] = None
    patient_sex:           Optional[str] = None

    primary_diagnosis:     str = ""
    cancer_stage:          str = ""
    overall_treatment_intent: str = ""

    total_steps:           int = 0
    steps:                 List[CarePathwayStep] = Field(default_factory=list)

    mdt_basis_summary:     str = ""              # which doctors/dates this pathway is built from
    contributing_specialties: List[str] = Field(default_factory=list)
    sequence_rationale:    str = ""              # overall narrative — why this order was chosen

    safety_flags:          List[str] = Field(default_factory=list)
    warnings:              List[str] = Field(default_factory=list)

    confidence_score:      float = 0.0
    generated_at:          str = ""


# =====================================================================
# INPUT / STATE
# =====================================================================

class CarePathwayInput(BaseModel):
    patient_id:  str
    hospital_id: Optional[str] = None
    # If a specific doctor is generating/viewing this, we still pull ALL
    # doctors' latest opinions — this is only used for logging/audit.
    requested_by_doctor_id: Optional[str] = None


class CarePathwayState(TypedDict):
    pathway_input:        CarePathwayInput
    patient_age:           Optional[int]
    patient_sex:           Optional[str]
    doctor_opinions:       List[DoctorMDTOpinion]
    clinical_context:      Optional[PathwayClinicalContext]
    pathway_steps:         List[CarePathwayStep]
    safety_flags:          List[str]
    care_pathway_plan:     Optional[CarePathwayPlan]
    warnings:              List[str]
    error:                 Optional[str]


# =====================================================================
# SHARED HELPERS
# =====================================================================

def _parse_json(content: str) -> dict:
    try:
        content = content.strip()
        if "```json" in content:
            content = content.split("```json", 1)[1].split("```", 1)[0]
        elif "```" in content:
            content = content.split("```", 1)[1].split("```", 1)[0]
        s, e = content.find("{"), content.rfind("}")
        if s != -1 and e != -1:
            return json.loads(content[s: e + 1])
        return {}
    except Exception:
        return {}


def _parse_json_array(content: str) -> List[dict]:
    try:
        content = content.strip()
        if "```json" in content:
            content = content.split("```json", 1)[1].split("```", 1)[0]
        elif "```" in content:
            content = content.split("```", 1)[1].split("```", 1)[0]
        s, e = content.find("["), content.rfind("]")
        if s != -1 and e != -1:
            return json.loads(content[s: e + 1])
        return []
    except Exception:
        return []


def calculate_age(dob_str: Optional[str]) -> Optional[int]:
    if not dob_str:
        return None
    try:
        if "T" in str(dob_str):
            dob = datetime.fromisoformat(str(dob_str).replace("Z", "+00:00"))
        elif "-" in str(dob_str):
            dob = datetime.strptime(str(dob_str), "%Y-%m-%d")
        else:
            return None
        today = datetime.now()
        age = today.year - dob.year
        if today.month < dob.month or (today.month == dob.month and today.day < dob.day):
            age -= 1
        return age
    except Exception as e:
        logger.error(f"Age calc error: {e}")
        return None


def format_opinions_block(doctor_opinions: List[DoctorMDTOpinion]) -> str:
    """Shared formatter used by every LLM agent below so every prompt
    sees the MDT opinions in exactly the same shape."""
    return "\n".join(
        f"─────────────────────────────────────\n"
        f"{op.specialty.upper()} (submitted {op.created_at or 'N/A'}):\n"
        f"{op.doctor_recommendation}\n"
        for op in doctor_opinions
    ) or "No MDT opinions on record."


# =====================================================================
# AGENT 0 — DATA AGGREGATION
# =====================================================================

class PathwayDataAggregationAgent:
    """
    Pure DB agent — no LLM. Pulls:
      • patient_users            -> age / sex
      • tumor_board_cases        -> LATEST recommendation per doctor
                                     (identical aggregation to the
                                     /latest_doctor_recommendations
                                     endpoint in tumor_board_agent.py)

    NOTE: patient_summary is intentionally NOT fetched anymore. The
    pathway is now built entirely from the MDT opinions themselves.
    """

    async def aggregate(self, state: CarePathwayState) -> CarePathwayState:
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        logger.info("🗂️  [Agent 0 — PathwayDataAggregation]: Starting")

        pathway_input = state["pathway_input"]
        patient_id  = pathway_input.patient_id
        hospital_id = pathway_input.hospital_id

        # ── Patient demographics ──────────────────────────────────────
        patient_data = await patient_user_collection.find_one({"patient_id": patient_id})
        if not patient_data:
            patient_data = await patient_user_collection.find_one({"sys_user_id": patient_id})

        patient_age = calculate_age(patient_data.get("date_of_birth")) if patient_data else None
        patient_sex = patient_data.get("gender") if patient_data else None

        state["patient_age"] = patient_age
        state["patient_sex"] = patient_sex

        logger.info(f"   [Agent 0] patient_users | age={patient_age} | sex={patient_sex}")

        # ── Latest-per-doctor MDT opinions from tumor_board_cases ─────
        match_stage: Dict[str, Any] = {"patient_id": patient_id}
        if hospital_id:
            match_stage["hospital_id"] = hospital_id

        doctor_opinions: List[DoctorMDTOpinion] = []
        try:
            pipeline = [
                {"$match": match_stage},
                {"$sort": {"created_at": -1}},
                {
                    "$group": {
                        "_id":                   "$doctor_id",
                        "latest_recommendation": {"$first": "$$ROOT"},
                    }
                },
                {
                    "$project": {
                        "_id":                   0,
                        "doctor_id":             "$latest_recommendation.doctor_id",
                        "speciality":            "$latest_recommendation.speciality",
                        "doctor_recommendation": "$latest_recommendation.doctor_recommendation",
                        "created_at":            "$latest_recommendation.created_at",
                    }
                },
            ]
            logger.info(
                f"   [Agent 0] DB query | collection=tumor_board_cases "
                f"| match={json.dumps(match_stage, default=str)}"
            )
            tb_docs = await tumor_board_collection.aggregate(pipeline).to_list(length=None)
            logger.info(f"   [Agent 0] tumor_board_cases | unique doctors={len(tb_docs)}")

            for doc in tb_docs:
                raw_created_at = doc.get("created_at", "")
                created_at_str = (
                    raw_created_at.isoformat()
                    if isinstance(raw_created_at, datetime)
                    else str(raw_created_at)
                )
                doctor_opinions.append(
                    DoctorMDTOpinion(
                        doctor_id             = str(doc.get("doctor_id", "")),
                        specialty              = doc.get("speciality", "unknown"),
                        doctor_recommendation  = doc.get("doctor_recommendation", ""),
                        created_at             = created_at_str,
                    )
                )
                logger.info(
                    f"   [Agent 0]   doctor={doc.get('doctor_id')} "
                    f"| specialty={doc.get('speciality')} | created_at={created_at_str}"
                )

        except Exception as e:
            logger.error(f"❌ [Agent 0] tumor_board_cases aggregation FAILED: {e}\n{traceback.format_exc()}")

        if not doctor_opinions:
            logger.warning(
                f"   [Agent 0] No MDT opinions found in tumor_board_cases for patient_id='{patient_id}' "
                f"— cannot build a pathway without at least one tumor board recommendation"
            )
            state["warnings"].append(
                "No tumor board recommendations found for this patient — care pathway cannot be MDT-grounded"
            )

        state["doctor_opinions"] = doctor_opinions

        logger.info(f"✅ [Agent 0] Aggregation complete | doctors={len(doctor_opinions)}")
        return state


# =====================================================================
# AGENT 1 — CLINICAL CONTEXT SYNTHESIS
# =====================================================================

class ClinicalContextSynthesisAgent:
    """
    Extracts clinical context (diagnosis / stage / intent / comorbidities /
    completed treatments) purely from the MDT opinion texts. Doctors
    routinely dictate the relevant prior history as part of their opinion
    (e.g. "s/p 4 cycles neoadjuvant FOLFOX, now for surgical planning"),
    so this is sufficient grounding without a separate timeline document.
    """

    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def synthesize(self, state: CarePathwayState) -> CarePathwayState:
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        logger.info("🔍 [Agent 1 — ClinicalContextSynthesis]: Starting")

        doctor_opinions = state.get("doctor_opinions", [])
        opinions_block = format_opinions_block(doctor_opinions)

        prompt = f"""You are a senior oncologist preparing the clinical foundation for a treatment sequencing plan.

ALL MDT / TUMOR BOARD OPINIONS ON RECORD FOR THIS PATIENT:
{opinions_block}

Patient Age: {state.get('patient_age') or 'Unknown'}
Patient Sex: {state.get('patient_sex') or 'Unknown'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR TASK:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Extract the primary diagnosis, formally documented (or best inferred) stage,
   and the overall treatment intent (curative / disease_modifying / palliative /
   symptom_control) — cross-reference across all doctors' opinions.

2. Extract performance status, comorbidities, and cardiac findings if documented
   anywhere in the MDT opinions.

3. CRITICAL — build a list of TREATMENTS ALREADY COMPLETED for this patient's
   current disease episode. Look for any mention in the opinions of things
   already done ("s/p", "post-op", "completed", "received", "prior",
   "underwent"). For each one give: treatment_name, modality (surgical/
   chemotherapy/radiation/immunotherapy/targeted_therapy/endocrine_therapy/
   procedural/investigation/other), and date if mentioned. This list is used
   later to mark pathway steps as already completed — being thorough here
   directly determines pathway accuracy. If truly nothing has been done yet,
   return an empty list.

4. Write a 3-4 sentence clinical_summary_text (no patient name).

Return ONLY this JSON — no preamble, no markdown fences:
{{
  "primary_diagnosis": "...",
  "cancer_stage": "... or 'Not formally staged'",
  "treatment_intent": "curative|disease_modifying|palliative|symptom_control",
  "performance_status": "ECOG x or 'Not assessed'",
  "comorbidities": ["..."],
  "cardiac_findings": ["..."],
  "completed_treatments": [
    {{"treatment_name": "...", "modality": "...", "date": "YYYY-MM-DD or null", "outcome": "... or null"}}
  ],
  "clinical_summary_text": "3-4 sentence narrative, no patient name"
}}

Return ONLY JSON."""

        try:
            response = self.llm.invoke([
                SystemMessage(content="Extract clinical context and completed-treatment history from MDT opinions for pathway planning. Return only JSON."),
                HumanMessage(content=prompt),
            ])
            result = _parse_json(response.content)

            completed = [
                CompletedTreatment(
                    treatment_name = c.get("treatment_name", ""),
                    modality       = c.get("modality", ""),
                    date           = c.get("date"),
                    outcome        = c.get("outcome"),
                )
                for c in (result.get("completed_treatments") or [])
                if c.get("treatment_name")
            ]

            context = PathwayClinicalContext(
                primary_diagnosis   = result.get("primary_diagnosis", "Pending workup"),
                cancer_stage        = result.get("cancer_stage", "Not formally staged"),
                treatment_intent    = result.get("treatment_intent", "curative"),
                performance_status  = result.get("performance_status", "Not assessed"),
                comorbidities       = result.get("comorbidities", []),
                cardiac_findings    = result.get("cardiac_findings", []),
                completed_treatments = completed,
                clinical_summary_text = result.get("clinical_summary_text", ""),
            )
            state["clinical_context"] = context

            logger.info(f"✅ [Agent 1] Diagnosis        : {context.primary_diagnosis}")
            logger.info(f"   [Agent 1] Stage            : {context.cancer_stage}")
            logger.info(f"   [Agent 1] Intent           : {context.treatment_intent}")
            logger.info(f"   [Agent 1] Completed treatments ({len(completed)}):")
            for c in completed:
                logger.info(f"      - {c.treatment_name} ({c.modality}) | {c.date or 'date unknown'}")

        except Exception as e:
            logger.error(f"❌ [Agent 1] Context synthesis failed: {e}\n{traceback.format_exc()}")
            state["clinical_context"] = PathwayClinicalContext(
                clinical_summary_text="Clinical context extraction failed — manual review required."
            )
            state["warnings"].append("Clinical context synthesis incomplete — review manually")

        return state


# =====================================================================
# AGENT 2 — MDT SEQUENCE PLANNING  (the core agent)
# =====================================================================

class MDTSequencePlanningAgent:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def plan_sequence(self, state: CarePathwayState) -> CarePathwayState:
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        logger.info("🧭 [Agent 2 — MDTSequencePlanning]: Starting")

        context = state.get("clinical_context") or PathwayClinicalContext()
        doctor_opinions = state.get("doctor_opinions", [])
        opinions_block = format_opinions_block(doctor_opinions)

        completed_block = "\n".join(
            f"  - {c.treatment_name} ({c.modality}) — {c.date or 'date unknown'}"
            for c in context.completed_treatments
        ) or "  None documented — treatment-naive for this episode."

        prompt = f"""You are the Tumor Board chairperson converting ALL specialist MDT opinions below into
ONE single, ordered, staged treatment sequence (a care pathway) for this patient.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CLINICAL PICTURE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{context.clinical_summary_text}
Diagnosis        : {context.primary_diagnosis}
Stage            : {context.cancer_stage}
Treatment intent : {context.treatment_intent}
Performance status: {context.performance_status}
Comorbidities    : {', '.join(context.comorbidities) or 'None documented'}
Cardiac findings : {', '.join(context.cardiac_findings) or 'None documented'}

TREATMENTS ALREADY COMPLETED FOR THIS EPISODE (do not re-sequence these as future steps —
if the MDT opinions still reference them, treat them as history, not as pathway steps):
{completed_block}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALL MDT / TUMOR BOARD OPINIONS SUBMITTED FOR THIS PATIENT ({len(doctor_opinions)} specialist(s)):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{opinions_block}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR TASK:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Synthesize every specialist's recommendation into ONE ordered pathway. This is not a menu
of options — it is a single sequence the patient will actually walk through, step by step.

RULES:
1. Only include steps that are still OUTSTANDING (not already completed per the list above).
2. Order steps the way real clinical sequencing works for this diagnosis/stage/intent —
   e.g. neoadjuvant therapy before surgery if downstaging is the goal, adjuvant therapy
   after surgery once healed, radiation timed around chemo per standard concurrent/
   sequential protocols, long-term therapies (endocrine, maintenance) placed last and
   marked as extended duration.
3. For EVERY step, give explicit relative timing: either "Start immediately" (only the
   very first outstanding step should normally say this) or "Start X (days/weeks) after
   Step N completes" — always reference the step number it depends on.
4. If two specialties disagree on sequencing for the same step, resolve it and explain
   your reasoning in that step's rationale — do not just pick one silently.
5. contributing_doctors for each step should list which specialty/specialties recommended it.
6. Flag is_urgent = true only for steps that must not be delayed (e.g. urgent surgical
   or oncologic emergency indications explicitly raised in the opinions).
7. Do NOT invent treatments not supported by at least one MDT opinion or standard practice
   for this exact diagnosis/stage/intent.
8. Do not set "status" here — leave every step as "pending"; a downstream agent will
   reconcile actual status against the MDT record.

Return ONLY this JSON array — no preamble, no markdown fences:
[
  {{
    "step_number": 1,
    "phase_name": "e.g. Neoadjuvant Chemotherapy",
    "modality": "surgical|chemotherapy|radiation|immunotherapy|targeted_therapy|endocrine_therapy|procedural|investigation|supportive_care|surveillance|other",
    "treatment_name": "specific regimen/procedure name",
    "detailed_plan": "dose/cycles/technique/margins etc as applicable",
    "sequence_timing": "Start immediately | Start N weeks after Step X completes",
    "depends_on_step": null or <int>,
    "estimated_duration": "e.g. '8 weeks (4 cycles)'",
    "responsible_specialty": "e.g. Medical Oncology",
    "monitoring_before_starting": ["e.g. Cardiac clearance (ECHO)"],
    "rationale": "why this step, in this position, citing which specialty recommended it",
    "guideline_support": "guideline referenced in the MDT opinions, if any",
    "contributing_doctors": ["Medical Oncology", "Surgical Oncology"],
    "is_urgent": true|false
  }}
]

Return ONLY the JSON array."""

        try:
            response = self.llm.invoke([
                SystemMessage(content="You are the MDT chairperson converting specialist opinions into one ordered care pathway. Return only a JSON array."),
                HumanMessage(content=prompt),
            ])
            steps_json = _parse_json_array(response.content)

            steps: List[CarePathwayStep] = []
            for idx, s in enumerate(steps_json, start=1):
                try:
                    modality_raw = str(s.get("modality", "other")).lower()
                    try:
                        modality_enum = SequenceModality(modality_raw)
                    except ValueError:
                        modality_enum = SequenceModality.OTHER

                    steps.append(CarePathwayStep(
                        step_number       = int(s.get("step_number", idx)),
                        phase_name        = s.get("phase_name", ""),
                        modality          = modality_enum,
                        treatment_name    = s.get("treatment_name", ""),
                        detailed_plan     = s.get("detailed_plan", ""),
                        sequence_timing   = s.get("sequence_timing", ""),
                        depends_on_step   = s.get("depends_on_step"),
                        estimated_duration = s.get("estimated_duration", ""),
                        responsible_specialty = s.get("responsible_specialty", ""),
                        monitoring_before_starting = s.get("monitoring_before_starting", []),
                        rationale         = s.get("rationale", ""),
                        guideline_support = s.get("guideline_support", ""),
                        contributing_doctors = s.get("contributing_doctors", []),
                        is_urgent         = bool(s.get("is_urgent", False)),
                        status            = StepStatus.PENDING,
                    ))
                except Exception as step_err:
                    logger.warning(f"⚠️ [Agent 2] Could not parse step {idx}: {step_err}")

            # Re-number sequentially in case the LLM produced gaps/duplicates
            steps.sort(key=lambda st: st.step_number)
            for i, st in enumerate(steps, start=1):
                st.step_number = i

            state["pathway_steps"] = steps

            logger.info(f"✅ [Agent 2] Sequence planned | total_steps={len(steps)}")
            for st in steps:
                logger.info(
                    f"   [Agent 2] Step {st.step_number}: {st.phase_name} "
                    f"({st.modality.value}) | timing='{st.sequence_timing}' "
                    f"| depends_on={st.depends_on_step}"
                )

            if not steps:
                state["warnings"].append(
                    "MDT sequence planning produced no outstanding steps — "
                    "either the patient's treatment is complete or MDT opinions were insufficient"
                )

        except Exception as e:
            logger.error(f"❌ [Agent 2] Sequence planning failed: {e}\n{traceback.format_exc()}")
            state["pathway_steps"] = []
            state["warnings"].append("MDT sequence planning failed — manual review required")

        return state


# =====================================================================
# AGENT 3 — STATUS RECONCILIATION  (this delivers the "pending" status)
# =====================================================================

class StatusReconciliationAgent:
    """
    Reconciles each planned step against the MDT opinion texts + the
    completed-treatments list from Agent 1. No separate timeline document
    is consulted anymore — the MDT opinions ARE the clinical record here.
    """

    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def reconcile(self, state: CarePathwayState) -> CarePathwayState:
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        logger.info("📌 [Agent 3 — StatusReconciliation]: Starting")

        steps = state.get("pathway_steps", [])
        context = state.get("clinical_context") or PathwayClinicalContext()
        doctor_opinions = state.get("doctor_opinions", [])

        if not steps:
            logger.info("   [Agent 3] No steps to reconcile — skipping")
            return state

        steps_block = "\n".join(
            f"  Step {st.step_number}: {st.phase_name} — {st.treatment_name} "
            f"(depends_on={st.depends_on_step})"
            for st in steps
        )
        completed_block = "\n".join(
            f"  - {c.treatment_name} ({c.modality}) — {c.date or 'date unknown'} "
            f"— outcome: {c.outcome or 'not documented'}"
            for c in context.completed_treatments
        ) or "  None documented."

        opinions_block = format_opinions_block(doctor_opinions)

        prompt = f"""You are reconciling a planned treatment pathway against what has ACTUALLY happened
for this patient, to assign an accurate status to every step.

PLANNED PATHWAY STEPS:
{steps_block}

TREATMENTS ALREADY COMPLETED FOR THIS EPISODE (from the MDT record):
{completed_block}

RAW MDT / TUMOR BOARD OPINIONS (the clinical record — may mention progress not
fully captured above, e.g. "cycle 2 of 6 currently underway", "awaiting cardiology
clearance before surgery"):
{opinions_block}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STATUS RULES — apply to EVERY step:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- "completed"   : the completed-treatments list or MDT opinions clearly show this exact
                   step (or a close equivalent) was already done.
- "in_progress" : the MDT opinions show this step has started but is not yet finished
                   (e.g. "cycle 2 of 6 in progress", partial course documented).
- "on_hold"     : this step cannot proceed yet because it depends on an earlier step
                   that is not yet completed, OR the record shows an explicit blocker
                   (e.g. "awaiting cardiology clearance").
- "pending"     : not started, no blocker identified, and either it's the next step in
                   line or it doesn't have an unmet dependency.
- "skipped"     : only if the record explicitly shows this step was deliberately not done
                   (e.g. patient declined, contraindication arose) — do not guess this.

For each step return: step_number, status, status_reason (1 sentence, specific — cite
what in the MDT record led to this status, e.g. "Medical Oncology's opinion confirms 4
of 4 planned cycles completed" or "No mention yet in any MDT opinion — this step depends
on Step 1, which is still pending").

Return ONLY this JSON array:
[
  {{"step_number": 1, "status": "pending|in_progress|completed|on_hold|skipped", "status_reason": "..."}}
]

Return ONLY the JSON array."""

        try:
            response = self.llm.invoke([
                SystemMessage(content="Reconcile pathway step status against the MDT clinical record. Return only a JSON array."),
                HumanMessage(content=prompt),
            ])
            results = _parse_json_array(response.content)
            status_map = {}
            for r in results:
                try:
                    step_num = int(r.get("step_number"))
                    status_map[step_num] = (r.get("status", "pending"), r.get("status_reason", ""))
                except Exception:
                    continue

            for st in steps:
                if st.step_number in status_map:
                    raw_status, reason = status_map[st.step_number]
                    try:
                        st.status = StepStatus(raw_status)
                    except ValueError:
                        st.status = StepStatus.PENDING
                    st.status_reason = reason
                else:
                    # Fallback rule-based reconciliation if LLM missed a step
                    if st.depends_on_step:
                        dep = next((s for s in steps if s.step_number == st.depends_on_step), None)
                        if dep and dep.status != StepStatus.COMPLETED:
                            st.status = StepStatus.ON_HOLD
                            st.status_reason = (
                                f"Awaiting completion of Step {st.depends_on_step} "
                                f"({dep.phase_name}) before this can start."
                            )
                            continue
                    st.status = StepStatus.PENDING
                    st.status_reason = "No matching status returned — defaulted to pending pending manual review."

            state["pathway_steps"] = steps

            logger.info("✅ [Agent 3] Status reconciliation complete")
            for st in steps:
                logger.info(f"   [Agent 3] Step {st.step_number} ({st.phase_name}): {st.status.value} — {st.status_reason}")

        except Exception as e:
            logger.error(f"❌ [Agent 3] Status reconciliation failed: {e}\n{traceback.format_exc()}")
            for st in steps:
                if st.status_reason == "":
                    st.status = StepStatus.PENDING
                    st.status_reason = "Automated reconciliation failed — defaulted to pending, please review."
            state["warnings"].append("Status reconciliation incomplete — statuses defaulted to pending")

        return state


# =====================================================================
# AGENT 4 — SAFETY / ORDERING VALIDATION
# =====================================================================

class PathwaySafetyValidationAgent:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def validate(self, state: CarePathwayState) -> CarePathwayState:
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        logger.info("🧠 [Agent 4 — PathwaySafetyValidation]: Starting")

        steps = state.get("pathway_steps", [])
        context = state.get("clinical_context") or PathwayClinicalContext()

        if not steps:
            state["safety_flags"] = []
            return state

        steps_block = "\n".join(
            f"  Step {st.step_number} [{st.status.value}]: {st.phase_name} — {st.treatment_name} "
            f"| timing: {st.sequence_timing} | depends_on: {st.depends_on_step} "
            f"| monitoring_before_starting: {', '.join(st.monitoring_before_starting) or 'none listed'}"
            for st in steps
        )

        prompt = f"""You are a senior oncologist performing a SEQUENCING safety audit — not a drug audit,
a pathway-ORDER audit — on the following planned care pathway.

DIAGNOSIS: {context.primary_diagnosis} | STAGE: {context.cancer_stage} | INTENT: {context.treatment_intent}
Cardiac findings: {', '.join(context.cardiac_findings) or 'None documented'}
Comorbidities: {', '.join(context.comorbidities) or 'None documented'}

PLANNED PATHWAY:
{steps_block}

CHECK FOR:
1. Any step scheduled before a prerequisite investigation/clearance it clinically requires
   (e.g. surgery before staging confirmed, cardiotoxic chemo before baseline cardiac workup).
2. Any two steps scheduled concurrently that should not overlap for safety reasons.
3. Any step whose "depends_on_step" is missing when clinically it should depend on an earlier step.
4. Any timing gap that's clinically too short (e.g. surgery immediately after chemo without a
   recovery/washout window) or dangerously too long (e.g. adjuvant therapy delayed well beyond
   the evidence-based window).
5. Whether cardiac findings/comorbidities are adequately protected against by monitoring steps.

Only flag genuinely material issues — do not invent problems if the sequence is sound.

Return ONLY this JSON:
{{
  "safety_flags": ["specific issue — reference the step numbers involved"],
  "is_sequence_sound": true|false,
  "auditor_note": "1-2 sentence overall note"
}}

Return ONLY JSON."""

        try:
            response = self.llm.invoke([
                SystemMessage(content="Audit the treatment pathway ordering for safety. Return only JSON."),
                HumanMessage(content=prompt),
            ])
            result = _parse_json(response.content)
            safety_flags = [str(f) for f in (result.get("safety_flags") or []) if f]
            state["safety_flags"] = safety_flags

            logger.info(
                f"✅ [Agent 4] Safety audit complete "
                f"| sound={result.get('is_sequence_sound', True)} | flags={len(safety_flags)}"
            )
            for f in safety_flags:
                logger.warning(f"   [Agent 4] ⚠️ {f}")

        except Exception as e:
            logger.error(f"❌ [Agent 4] Safety validation failed: {e}\n{traceback.format_exc()}")
            state["safety_flags"] = []
            state["warnings"].append("Pathway safety audit could not be completed — manual review recommended")

        return state


# =====================================================================
# AGENT 5 — ASSEMBLER
# =====================================================================

class CarePathwayAssembler:
    async def assemble(self, state: CarePathwayState) -> CarePathwayState:
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        logger.info("📋 [Agent 5 — CarePathwayAssembler]: Starting")

        pathway_input = state["pathway_input"]
        context = state.get("clinical_context") or PathwayClinicalContext()
        steps = state.get("pathway_steps", [])
        doctor_opinions = state.get("doctor_opinions", [])
        safety_flags = state.get("safety_flags", [])
        warnings = state.get("warnings", [])

        contributing_specialties = sorted({op.specialty for op in doctor_opinions if op.specialty})

        latest_dates = [op.created_at for op in doctor_opinions if op.created_at]
        mdt_basis_summary = (
            f"Built from {len(doctor_opinions)} specialist MDT opinion(s) "
            f"({', '.join(contributing_specialties) or 'unspecified specialties'}). "
            f"Most recent submission: {max(latest_dates) if latest_dates else 'unknown'}."
        )

        # Confidence: penalize missing data / unresolved warnings / safety flags
        base_confidence = 0.85
        if not doctor_opinions:
            base_confidence -= 0.35
        base_confidence -= min(0.05 * len(safety_flags), 0.25)
        base_confidence -= min(0.03 * len(warnings), 0.15)
        confidence_score = round(max(0.20, min(0.95, base_confidence)), 3)

        sequence_rationale = (
            f"Pathway synthesized across {len(contributing_specialties)} specialt"
            f"{'y' if len(contributing_specialties) == 1 else 'ies'} for "
            f"{context.primary_diagnosis or 'the documented condition'} "
            f"({context.cancer_stage or 'stage not formally documented'}), "
            f"with {context.treatment_intent or 'unspecified'} intent. "
            f"{len(steps)} outstanding step(s) sequenced; "
            f"{len(context.completed_treatments)} prior treatment(s) excluded as already completed."
        )

        plan = CarePathwayPlan(
            patient_id             = pathway_input.patient_id,
            patient_age            = state.get("patient_age"),
            patient_sex            = state.get("patient_sex"),
            primary_diagnosis      = context.primary_diagnosis,
            cancer_stage           = context.cancer_stage,
            overall_treatment_intent = context.treatment_intent,
            total_steps            = len(steps),
            steps                  = steps,
            mdt_basis_summary       = mdt_basis_summary,
            contributing_specialties = contributing_specialties,
            sequence_rationale      = sequence_rationale,
            safety_flags            = safety_flags,
            warnings                = warnings,
            confidence_score        = confidence_score,
            generated_at            = datetime.utcnow().isoformat(),
        )

        state["care_pathway_plan"] = plan

        logger.info(
            f"✅ [Agent 5] Care pathway assembled "
            f"| steps={len(steps)} | confidence={confidence_score:.2f} "
            f"| safety_flags={len(safety_flags)}"
        )
        return state


# =====================================================================
# LANGGRAPH WORKFLOW  (MDT-aggregation flow — unchanged)
# =====================================================================

def create_care_pathway_workflow(llm: ChatGroq) -> StateGraph:
    data_agent      = PathwayDataAggregationAgent()
    context_agent   = ClinicalContextSynthesisAgent(llm)
    sequence_agent  = MDTSequencePlanningAgent(llm)
    status_agent    = StatusReconciliationAgent(llm)
    safety_agent    = PathwaySafetyValidationAgent(llm)
    assembler       = CarePathwayAssembler()

    workflow = StateGraph(CarePathwayState)

    workflow.add_node("aggregate_data",       data_agent.aggregate)
    workflow.add_node("synthesize_context",   context_agent.synthesize)
    workflow.add_node("plan_sequence",        sequence_agent.plan_sequence)
    workflow.add_node("reconcile_status",     status_agent.reconcile)
    workflow.add_node("validate_safety",      safety_agent.validate)
    workflow.add_node("assemble",             assembler.assemble)

    workflow.set_entry_point("aggregate_data")

    workflow.add_edge("aggregate_data",     "synthesize_context")
    workflow.add_edge("synthesize_context", "plan_sequence")
    workflow.add_edge("plan_sequence",      "reconcile_status")
    workflow.add_edge("reconcile_status",   "validate_safety")
    workflow.add_edge("validate_safety",    "assemble")
    workflow.add_edge("assemble",           END)

    return workflow.compile()


# =====================================================================
# MAIN GENERATION FUNCTION  (MDT-aggregation flow — unchanged)
# =====================================================================

async def generate_care_pathway(
    pathway_input: CarePathwayInput,
    llm: ChatGroq,
) -> CarePathwayPlan:

    logger.info(f"🚀 Care Pathway Generation | Patient={pathway_input.patient_id}")

    workflow = create_care_pathway_workflow(llm)

    initial_state: CarePathwayState = {
        "pathway_input":     pathway_input,
        "patient_age":       None,
        "patient_sex":       None,
        "doctor_opinions":   [],
        "clinical_context":  None,
        "pathway_steps":     [],
        "safety_flags":      [],
        "care_pathway_plan": None,
        "warnings":          [],
        "error":             None,
    }

    final_state = await workflow.ainvoke(initial_state)
    plan = final_state.get("care_pathway_plan")

    if plan:
        return plan

    return CarePathwayPlan(
        patient_id = pathway_input.patient_id,
        warnings   = ["Workflow failed to produce a care pathway"],
        generated_at = datetime.utcnow().isoformat(),
    )


# =====================================================================
# FASTAPI ENDPOINT  (MDT-aggregation flow — unchanged)
# =====================================================================

@router.get("/care-pathway-health")
async def care_pathway_health_check():
    """
    Hit this FIRST from Postman: GET /care-pathway-health
    """
    logger.info("💓 [GET /care-pathway-health] Health check hit — router IS reachable")
    mongo_ok = False
    try:
        await mongodb_client.admin.command("ping")
        mongo_ok = True
    except Exception as e:
        logger.error(f"   [health] Mongo ping FAILED: {e}")

    return JSONResponse(content={
        "status": "ok",
        "router_reachable": True,
        "mongo_connected": mongo_ok,
        "mongo_uri_configured": bool(os.getenv("MONGO_URI")),
        "groq_api_key_configured": bool(os.getenv("GROQ_API_KEY")),
    })


@router.post("/generate-care-pathway")
async def generate_care_pathway_endpoint(request: dict = Body(...)):
    """
    Generate a sequenced, status-tracked care pathway from the latest
    tumor board (MDT) recommendations of ALL doctors for this patient.

    Request body:
      {
        "patient_id": "<required>",
        "hospital_id": "<optional>",
        "requested_by_doctor_id": "<optional, for audit logging only>"
      }
    """
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    logger.info("📋 [POST] generate-care-pathway")
    logger.info(f"   raw request: {json.dumps(request, indent=2)}")

    try:
        patient_id = request.get("patient_id")
        if not patient_id:
            raise HTTPException(status_code=400, detail="patient_id is required")

        pathway_input = CarePathwayInput(
            patient_id             = patient_id,
            hospital_id            = request.get("hospital_id"),
            requested_by_doctor_id = request.get("requested_by_doctor_id"),
        )

        llm = ChatGroq(
            model        = "llama-3.3-70b-versatile",
            groq_api_key = GROQ_API_KEY,
            temperature  = 0.1,
        )

        plan = await generate_care_pathway(pathway_input=pathway_input, llm=llm)

        logger.info(
            f"✅ Care pathway complete | patient={patient_id} "
            f"| steps={plan.total_steps} | confidence={plan.confidence_score:.2f}"
        )
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

        return {
            "success":           True,
            "patient_id":        patient_id,
            "care_pathway_plan": plan,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Care pathway generation error: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/care-pathway/{patient_id}")
async def get_latest_care_pathway_inputs(patient_id: str, hospital_id: Optional[str] = None):
    """
    Debug/inspection endpoint — returns the raw ingredients (latest-per-doctor
    MDT opinions) that would feed a care pathway, without running the LLM
    pipeline. Useful for verifying data availability before generating a
    full pathway.
    """
    match_stage: Dict[str, Any] = {"patient_id": patient_id}
    if hospital_id:
        match_stage["hospital_id"] = hospital_id

    pipeline = [
        {"$match": match_stage},
        {"$sort": {"created_at": -1}},
        {"$group": {"_id": "$doctor_id", "latest_recommendation": {"$first": "$$ROOT"}}},
        {
            "$project": {
                "_id": 0,
                "doctor_id":             "$latest_recommendation.doctor_id",
                "speciality":            "$latest_recommendation.speciality",
                "doctor_recommendation": "$latest_recommendation.doctor_recommendation",
                "created_at":            "$latest_recommendation.created_at",
            }
        },
    ]
    doctor_opinions = await tumor_board_collection.aggregate(pipeline).to_list(length=None)
    for d in doctor_opinions:
        if isinstance(d.get("created_at"), datetime):
            d["created_at"] = d["created_at"].isoformat()

    return JSONResponse(content={
        "patient_id":      patient_id,
        "doctor_opinions": doctor_opinions,
        "doctor_count":    len(doctor_opinions),
    })


# =====================================================================
# ★ NEW ★  DICTATION-BASED CARE PATHWAY (single doctor, free-text)
# =====================================================================
#
# This is a SEPARATE entry point from the MDT-aggregation flow above.
# Instead of pulling every doctor's latest tumor_board_cases entry, the
# calling doctor simply dictates the plan they want in free text (e.g.
# "Start with 4 cycles of neoadjuvant FOLFOX, then restage, then proceed
# to surgery if downstaged, followed by adjuvant chemo..."). That raw
# text is run through the SAME downstream agents (context synthesis ->
# sequencing -> status reconciliation -> safety validation -> assembly)
# so the output `CarePathwayPlan` is structurally identical to the MDT
# flow's output — same schema, same fields, same nesting.
# =====================================================================

class DictationPathwayInput(BaseModel):
    patient_id:  str
    doctor_id:   str
    dictation:   str
    hospital_id: Optional[str] = None


class DictationDataAggregationAgent:
    """
    Pure DB agent — no LLM. Fetches patient demographics exactly like
    PathwayDataAggregationAgent, looks up the dictating doctor's
    specialty (best-effort), and wraps the raw `dictation` string as the
    single `DoctorMDTOpinion` that will drive the rest of the pipeline.

    NOTE: tumor_board_cases is intentionally NOT queried in this path —
    the dictation itself is treated as the doctor's opinion/record for
    this run.
    """

    async def aggregate(
        self,
        state: CarePathwayState,
        dictation_input: "DictationPathwayInput",
    ) -> CarePathwayState:
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        logger.info("🗂️  [Dictation Agent 0 — DictationDataAggregation]: Starting")

        patient_id = dictation_input.patient_id
        doctor_id  = dictation_input.doctor_id

        # ── Patient demographics (same lookup as the MDT flow) ─────────
        patient_data = await patient_user_collection.find_one({"patient_id": patient_id})
        if not patient_data:
            patient_data = await patient_user_collection.find_one({"sys_user_id": patient_id})

        patient_age = calculate_age(patient_data.get("date_of_birth")) if patient_data else None
        patient_sex = patient_data.get("gender") if patient_data else None

        state["patient_age"] = patient_age
        state["patient_sex"] = patient_sex

        logger.info(f"   [Dictation Agent 0] patient_users | age={patient_age} | sex={patient_sex}")

        # ── Dictating doctor's specialty (best-effort — field name may
        # vary across how doctor_users documents were created) ─────────
        specialty = "unknown"
        try:
            doctor_data = await doctor_user_collection.find_one({"doctor_id": doctor_id})
            if not doctor_data:
                doctor_data = await doctor_user_collection.find_one({"sys_user_id": doctor_id})
            if doctor_data:
                specialty = (
                    doctor_data.get("speciality")
                    or doctor_data.get("specialty")
                    or doctor_data.get("specialization")
                    or "unknown"
                )
        except Exception as e:
            logger.warning(f"   [Dictation Agent 0] doctor specialty lookup failed: {e}")

        logger.info(f"   [Dictation Agent 0] doctor={doctor_id} | specialty={specialty}")

        # ── Wrap the raw dictation as the single MDT opinion driving
        # the rest of the pipeline ───────────────────────────────────
        doctor_opinions = [
            DoctorMDTOpinion(
                doctor_id             = doctor_id,
                specialty              = specialty,
                doctor_recommendation  = dictation_input.dictation,
                created_at             = datetime.utcnow().isoformat(),
            )
        ]
        state["doctor_opinions"] = doctor_opinions

        logger.info("✅ [Dictation Agent 0] Aggregation complete | doctors=1 (dictation-only)")
        return state


async def generate_care_pathway_from_dictation(
    dictation_input: DictationPathwayInput,
    llm: ChatGroq,
) -> CarePathwayPlan:
    """
    Runs the dictation through the SAME downstream agents used by the
    MDT-aggregation flow (context synthesis -> sequencing -> status
    reconciliation -> safety validation -> assembly), so the resulting
    `CarePathwayPlan` has the exact same shape either way.
    """
    logger.info(
        f"🚀 Dictation Care Pathway Generation | "
        f"Patient={dictation_input.patient_id} | Doctor={dictation_input.doctor_id}"
    )

    data_agent     = DictationDataAggregationAgent()
    context_agent  = ClinicalContextSynthesisAgent(llm)
    sequence_agent = MDTSequencePlanningAgent(llm)
    status_agent   = StatusReconciliationAgent(llm)
    safety_agent   = PathwaySafetyValidationAgent(llm)
    assembler      = CarePathwayAssembler()

    state: CarePathwayState = {
        "pathway_input": CarePathwayInput(
            patient_id              = dictation_input.patient_id,
            hospital_id             = dictation_input.hospital_id,
            requested_by_doctor_id  = dictation_input.doctor_id,
        ),
        "patient_age":       None,
        "patient_sex":       None,
        "doctor_opinions":   [],
        "clinical_context":  None,
        "pathway_steps":     [],
        "safety_flags":      [],
        "care_pathway_plan": None,
        "warnings":          [],
        "error":             None,
    }

    state = await data_agent.aggregate(state, dictation_input)
    state = await context_agent.synthesize(state)
    state = await sequence_agent.plan_sequence(state)
    state = await status_agent.reconcile(state)
    state = await safety_agent.validate(state)
    state = await assembler.assemble(state)

    plan = state.get("care_pathway_plan")
    if plan:
        return plan

    return CarePathwayPlan(
        patient_id   = dictation_input.patient_id,
        warnings     = ["Dictation workflow failed to produce a care pathway"],
        generated_at = datetime.utcnow().isoformat(),
    )


@router.post("/generate-care-pathway-from-dictation")
async def generate_care_pathway_from_dictation_endpoint(request: dict = Body(...)):
    """
    Generate a sequenced, status-tracked care pathway from a SINGLE
    doctor's free-text DICTATION of the care plan they want, instead of
    aggregating every doctor's latest tumor_board_cases entry.

    Request body:
      {
        "patient_id": "<required>",
        "doctor_id": "<required>",
        "dictation": "<required — free text of the doctor's intended care plan>",
        "hospital_id": "<optional>"
      }

    Output format is IDENTICAL to /generate-care-pathway — same
    `CarePathwayPlan` schema (steps, status, safety_flags, etc).
    """
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    logger.info("📋 [POST] generate-care-pathway-from-dictation")
    logger.info(f"   raw request keys: {list(request.keys())}")

    try:
        patient_id = request.get("patient_id")
        doctor_id  = request.get("doctor_id")
        dictation  = request.get("dictation")

        if not patient_id:
            raise HTTPException(status_code=400, detail="patient_id is required")
        if not doctor_id:
            raise HTTPException(status_code=400, detail="doctor_id is required")
        if not dictation or not str(dictation).strip():
            raise HTTPException(status_code=400, detail="dictation is required")

        dictation_input = DictationPathwayInput(
            patient_id  = patient_id,
            doctor_id   = doctor_id,
            dictation   = dictation,
            hospital_id = request.get("hospital_id"),
        )

        llm = ChatGroq(
            model        = "llama-3.3-70b-versatile",
            groq_api_key = GROQ_API_KEY,
            temperature  = 0.1,
        )

        plan = await generate_care_pathway_from_dictation(dictation_input=dictation_input, llm=llm)

        logger.info(
            f"✅ Dictation care pathway complete | patient={patient_id} | doctor={doctor_id} "
            f"| steps={plan.total_steps} | confidence={plan.confidence_score:.2f}"
        )
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

        return {
            "success":           True,
            "patient_id":        patient_id,
            "doctor_id":         doctor_id,
            "care_pathway_plan": plan,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Dictation care pathway generation error: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────────────
# ROUTE REGISTRATION DEBUG DUMP
# ─────────────────────────────────────────────────────────────────────
logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
logger.info("🧩 [care_pathway_sequencing_agent] Routes registered on this router:")
for _route in router.routes:
    _methods = ",".join(sorted(getattr(_route, "methods", []) or []))
    logger.info(f"   {_methods:10s} {_route.path}")
logger.info("🧩 [care_pathway_sequencing_agent] Full path will be: <your app prefix, if any> + path above")
logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")