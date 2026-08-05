"""
EVIS — Emergency Voice Intelligence System  (v4.2 — Adaptive Routing + Clinical Hardening
                                              + Trauma/Elderly/Toxicology Reference Expansion)
=============================================================================================
Autonomous Emergency Medical Response AI with case-adaptive agent routing.

Processes ambulance voice dictations, doctor voice notes, and image-extracted
clinical data from MongoDB, then generates real-time, timestamp-anchored
emergency suggestions for doctors.

WHAT'S NEW IN v4.0
-------------------
- A0 · Case Router (new) runs first and classifies the case (trauma vs
  medical, image-vitals availability, complexity). Downstream agents are
  then chosen based on that classification instead of always running all 9.
- A3 (ATLS trauma injury classification) is SKIPPED for non-trauma
  presentations (e.g. breathing difficulty, chest pain, seizure with no
  injury mechanism). A safe stub is inserted instead of an LLM call, so
  trauma-only content (spinal injury, head injury, internal bleeding) no
  longer leaks into purely medical cases.
- A9 (vitals comparison) is SKIPPED when there is no meaningful
  image-monitor data to cross-check against voice-reported vitals.
- SIMPLE_CASE path: for a single short entry with nothing to reconcile and
  no prior clinical actions, the graph is bypassed entirely and ONE
  consolidated LLM call produces the suggestion instead of 8 separate calls.
- A5 and A8 prompts now include an explicit anti-duplication rule so the
  timestamp_based_response_plan / timestamp_anchored_actions blocks stop
  repeating identical vitals text and identical alert lists in every block.

WHAT'S NEW IN v4.1  (clinical-hardening patch)
------------------------------------------------
Triggered by a real case that exposed two structural gaps: a purely-medical
elderly patient in respiratory distress, on BiPAP with IV Lasix already
given, severe hypertension (200/100), RR 38, HR 120 — whose generated
report (a) completely omitted the BiPAP/Lasix already administered, and
(b) called the patient "Stable" once SpO2 improved, despite ongoing severe
tachypnea/tachycardia/hypertension and continued NIV dependence.

Root causes fixed:
  1. Treatments stated in the CURRENT dictation/note text (not just the
     cross-visit `clinical_actions` Mongo collection) were never pinned into
     the prompt the way prescribed medications already were — so the model
     was free to paraphrase them away. Fixed with `_extract_treatments_performed()`
     plus a new mandatory `treatments_already_performed` output field.
  2. A5/A6/A8 hardcoded "this is for a BASIC EMT — strip anything advanced,"
     which actively told the model to hide hospital-level care (BiPAP, IV
     push meds, cardiac monitor) already documented by a doctor. Fixed with
     a new `care_setting` classification in A0 ("prehospital_ems" vs
     "ed_or_inpatient") that gates the BLS-only role restriction.

Additional hardening (grounded in Tintinalli's Emergency Medicine — the
"sympathetic crashing acute pulmonary edema" pattern and NIV/intubation
escalation criteria):
  - Patients are never labelled "Stable" while an active organ-supportive
    intervention (NIV, oxygen beyond minimal support, vasoactive drugs) is
    required to hold a vital in range, or while other vitals remain deranged.
  - Suspected diagnoses (e.g. suspected acute cardiogenic pulmonary edema)
    are always hedged and never presented as confirmed unless a clinician
    has explicitly documented that diagnosis in the input.
  - Severe hypertension (>=180/120) with end-organ evidence is explicitly
    flagged as a hypertensive emergency requiring frequent BP reassessment
    and physician notification.
  - A dedicated escalation_plan field captures NIV-failure/intubation
    triggers (worsening hypoxia despite NIV, rising RR/work of breathing,
    respiratory fatigue, falling GCS, hemodynamic instability).
  - A single consolidated continuous_monitoring_plan is referenced elsewhere
    instead of being repeated verbatim across sections.
  - Timeline, deterioration-watch, and ED-handover instructions now require
    patient-specific content instead of generic placeholders.
  - Every recommendation must be traceable to a documented finding; genuine
    data gaps are flagged for the clinician instead of guessed.

WHAT'S NEW IN v4.2  (trauma / elderly / anticoagulation / behavioral
reference expansion — grounded in Tintinalli's Emergency Medicine, Section
21 "Trauma" and related chapters: Head Trauma, Spine Trauma, Pulmonary
Trauma, Cardiac Trauma, Compartment Syndrome, Trauma in the Elderly,
Thrombotics and Antithrombotics, and Acute Agitation)
------------------------------------------------------------------------
Real trauma/elderly/behavioral cases expose failure modes the v4.1 patch
did not cover: missed tension pneumothorax/tamponade red flags, shock
mislabeled purely by "normal-looking" vitals in an elderly or
anticoagulated patient, compartment syndrome dismissed because a distal
pulse was still palpable, an anticoagulated head-injury patient not
flagged for urgent reversal, and agitated patients escalated straight to
restraint-only language instead of de-escalation-first reasoning. v4.2
adds seven new paraphrased CLINICAL_REFERENCE blocks and wires them into
the agents where they change real output:
  - CLINICAL_REFERENCE_HEAD_TRAUMA — GCS/Cushing reflex/herniation
    patterns, CPP/MAP targets, why a single hypotensive or hypoxic episode
    doubles mortality risk, and why anticoagulated patients need a lower
    threshold for CT and urgent reversal even if "minor" mechanism.
  - CLINICAL_REFERENCE_SHOCK_DIFFERENTIATION — hemorrhagic vs neurogenic
    vs spinal-shock vs cardiogenic/obstructive differentiation; presume
    hemorrhage as the cause of hypotension in a spinal-injury patient
    until proven otherwise, since most hypotension in penetrating spinal
    injury is from blood loss, not neurogenic shock.
  - CLINICAL_REFERENCE_CHEST_CARDIAC_TRAUMA — tension pneumothorax and
    cardiac tamponade are clinical, not imaging, diagnoses; Beck's triad
    is present in <10% of tamponade and must never be used to rule it
    out; unexplained tachycardia may be the only sign of cardiac injury;
    flail chest/pulmonary contusion caution against fluid overload.
  - CLINICAL_REFERENCE_COMPARTMENT_SYNDROME — pain out of proportion and
    pain with passive stretch is the earliest and most sensitive sign;
    distal pulses are frequently still present and their presence must
    NEVER be used to exclude compartment syndrome; muscle/nerve ischemia
    time windows.
  - CLINICAL_REFERENCE_ELDERLY_TRAUMA — "normal" vital signs are
    unreliable in the elderly (beta-blockers mask tachycardia, baseline
    hypertension raises the real hypotension threshold); occult
    hypoperfusion despite normal-looking vitals; base-deficit/lactate as
    more reliable severity markers; systematically higher undertriage
    risk in this population.
  - CLINICAL_REFERENCE_ANTICOAGULATION_REVERSAL — informational-only
    (never a dosing instruction from this system) framing for flagging
    when a patient's documented anticoagulant should prompt urgent
    physician notification and reversal-agent readiness, especially with
    head injury or major bleeding.
  - CLINICAL_REFERENCE_ACUTE_AGITATION — safety-first, verbal
    de-escalation before medication, treat the underlying medical cause
    first, restraints only to prevent harm and never as a first-line
    response, for behavioral/agitated presentations.

These are spliced into A2 (vitals interpretation), A3 (trauma injury
classification), A4 (risk stratification), A5/A6 (immediate actions and
precautions), A7 (hospital prep / escalation-readiness), and A8/SIMPLE_SYNTH
(final synthesis) wherever they change real output — not appended
decoratively. A few new lightweight, low-risk output fields were added
(chest/cardiac trauma red-flag screen, compartment syndrome screen,
anticoagulation/reversal flag) rather than restructuring the existing
schema, to keep this a targeted clinical-reasoning upgrade.

Architecture:
  Routing                → A0
  Full pipeline:
    Sequential Foundation → A1 → A2 → A3(conditional) → A4
    Parallel Analysis     → A5 + A6 + A7 + A9(conditional) (concurrent)
    Synthesis & Output    → A8
  Simple-case pipeline:
    A0 → SIMPLE_SYNTH (single consolidated call) → END

Key Agents:
  A0 · Case Router                      — trauma vs medical, image-vitals availability, complexity, care setting
  A1 · Medical Entity Extraction        — NLP parse of all clinical inputs, including treatments already given
  A2 · Vital Signs & Consciousness      — Assess vitals, GCS, airway, hypertensive emergency, shock differential,
                                           chest/cardiac trauma red flags, compartment syndrome screen
  A3 · Injury Classification            — Body region, severity, mechanism [SKIPPED if non-trauma]
  A4 · Risk Stratification              — Criticality, triage colour, time window
  A5 · Immediate Actions Generator      — What to do in the NEXT 60 seconds [parallel]
  A6 · Precautions Generator            — Do-NOT list, contraindications [parallel]
  A7 · Hospital Prep Instructions       — What ED must prepare NOW [parallel]
  A9 · Vitals Comparison & Impression   — Compare image vitals vs voice/notes [parallel, SKIPPED if no image data]
  A8 · Timeline Synthesis               — Timestamp-anchored progressive action plan
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from difflib import SequenceMatcher
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, TypedDict
from Agentic.grounded_evis.shadow_compare import run_shadow_comparison

import httpx
from fastapi import APIRouter, HTTPException
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END
from Agentic.clinical_shared.triage import compute_triage_colour, first_int, parse_bp_systolic
from Agentic.clinical_shared.triage import upsert_authoritative_triage

# ============================================================
# TIMEZONE — India Standard Time (UTC+5:30)
# ============================================================

IST = timezone(timedelta(hours=5, minutes=30))


def now_ist() -> datetime:
    """Return the current datetime in IST."""
    return datetime.now(IST)


def iso_ist(dt: Any) -> str:
    """
    Convert any datetime / string / None to an IST ISO-8601 string.
    If dt is already a timezone-aware datetime, convert to IST.
    If dt is naive (no tzinfo), assume UTC and convert to IST.
    If dt is a string, return as-is (already formatted upstream).
    """
    if dt is None:
        return ""
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(IST).isoformat()
    return str(dt)


# ============================================================
# ENVIRONMENT CONFIGURATION
# ============================================================

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
MONGO_URI    = os.getenv("MONGO_URI")
MONGO_DB     = "doctorassistai"

VOICE_API_BASE = os.getenv(
    "VOICE_API_BASE",
    "https://doctorassist.ai/api/hms/users/data/context"
)

mongo_client = AsyncIOMotorClient(MONGO_URI)
mongo_db     = mongo_client[MONGO_DB]

# ── Collections ──────────────────────────────────────────────
processed_results_collection                = mongo_db["voice_processed_results"]
voice_dictations_collection                 = mongo_db["voice_dictations"]
doctor_voice_notes_collection_forprocessing = mongo_db["doctor_voice_notes"]
Image_Extracted_Ambulance_collection        = mongo_db["Image_Extracted_Ambulance"]
clinical_actions_collection                 = mongo_db["clinical_actions"]
patient_triage_status_collection            = mongo_db["patient_triage_status"]
patients_collection                         = mongo_db["patients"]
shadow_comparisons_collection = mongo_db["shadow_comparisons"]  # add near your other collections

# Primary reasoning LLM — used for A0 router (fast) and A1-A7/A9
llm = ChatGroq(
    model="llama-3.1-8b-instant",
    temperature=0.1,
    max_tokens=4000,
    groq_api_key=GROQ_API_KEY,
)

# Higher-quality LLM for synthesis (A8) and the simple-case single call
llm_synthesis = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0.1,
    max_tokens=4000,
    groq_api_key=GROQ_API_KEY,
)

router = APIRouter(prefix="", tags=["Emergency Voice Intelligence"])


# ============================================================
# REQUEST / RESPONSE MODELS
# ============================================================

class EmergencyVoiceRequest(BaseModel):
    patient_id: str
    include_intermediates: bool = False


class EmergencyVoiceResponse(BaseModel):
    patient_id:         str
    generated_at:       str
    dictation_count:    int
    processing_time_ms: int
    suggestions:        List[Dict]
    intermediate:       Optional[Dict] = None


# ============================================================
# EVIS AGENT STATE
# ============================================================

class EVISState(TypedDict):

    # Input
    patient_id:   str
    conversation: str          # Combined chronological conversation block
    timestamp:    str          # ISO8601 — latest entry timestamp (IST)
    date:         str
    time:         str
    entry_count:  Optional[int]
    prescribed_medications: Optional[List[str]]

    # NEW (v4.1) — treatments/interventions documented in THIS encounter,
    # extracted directly from raw entry text (not just the cross-visit
    # clinical_actions collection). Guarantees BiPAP/Lasix-style facts
    # cannot be silently paraphrased away by any downstream agent.
    treatments_performed: Optional[List[str]]

    # NEW — LLM-extracted second layer, separate from the regex-based
    # treatments_performed above. Regex is the hard guarantee (catches
    # known terms with zero LLM risk); this catches phrasings/investigations
    # the regex list hasn't been taught yet (e.g. "rhythm strip already
    # run", "sugar checked at scene"). Populated by A1, never solely relied
    # upon — always used ALONGSIDE the regex list, never instead of it.
    investigations_or_actions_performed_llm: Optional[List[str]]

    # NEW — registered incident type from patient.accidentDetails.accidentType,
    # fetched once before the pipeline runs. Ground truth, not LLM-inferred.
    registered_incident_type: Optional[str]

    # Routing decision (A0)
    case_type:           Optional[str]    # "trauma" | "cardiorespiratory" | "neurological" | "toxicology" | "obstetric" | "general_medical" | "unknown"
    is_trauma:            Optional[bool]
    has_image_vitals:     Optional[bool]
    complexity:           Optional[str]   # "simple" | "moderate" | "complex"
    # NEW (v4.1) — "prehospital_ems" | "ed_or_inpatient" | "unknown". Gates
    # whether downstream agents must restrict themselves to BLS-only
    # actions, or may acknowledge/build on advanced hospital-level care
    # already documented (NIV, IV medications, cardiac monitoring).
    care_setting:          Optional[str]
    run_a3:                Optional[bool]
    run_a9:                Optional[bool]
    run_full_pipeline:     Optional[bool]  # False → SIMPLE_CASE single-call path
    routing_rationale:     Optional[str]

    # Sequential (A1 → A4)
    medical_entities:    Optional[Dict]
    vitals_assessment:   Optional[Dict]
    injury_profile:      Optional[Dict]
    risk_stratification: Optional[Dict]

    # Parallel (A5 + A6 + A7 + A9)
    immediate_actions:    Optional[Dict]
    precautions:          Optional[Dict]
    hospital_prep:        Optional[Dict]
    vitals_comparison:    Optional[Dict]

    # Synthesis (A8 or SIMPLE_SYNTH)
    timeline_suggestions: Optional[Dict]

    # Telemetry
    errors:        List[str]
    agent_timings: Dict[str, float]

    # Clinical context injected before pipeline
    clinical_actions:     Optional[List[Dict]]
    completed_actions:    Optional[List[str]]
    not_approved_actions: Optional[List[str]]

    # Raw image-extracted entries (for A9 comparison)
    image_entries: Optional[List[Dict]]


# ============================================================
# HELPERS
# ============================================================
# NEW — this pipeline previously never queried the patients collection,
# so accidentDetails.accidentType was invisible to A0's trauma/medical
# classification. Mirrors the equivalent fix in emergency_structured_note.py.
_REGISTRATION_TRAUMA_KEYWORDS = (
    "road traffic", "rta", "collision", "accident", "fall", "fell",
    "assault", "stabbed", "gunshot", "penetrating", "blunt trauma",
    "crush", "burn", "trauma",
)


async def _fetch_patient_record(patient_id: str) -> dict:
    doc = await patients_collection.find_one({"patient_id": patient_id})
    if not doc:
        return {}
    doc.pop("_id", None)
    return doc


def _registered_incident_type(patient_record: dict) -> Optional[str]:
    accident = (patient_record or {}).get("accidentDetails", {}) or {}
    return accident.get("accidentType")

  
def parse_llm_json(text: str) -> Dict:
    if not text:
        return {}
    text = text.strip()
    text = re.sub(r"```json", "", text)
    text = re.sub(r"```", "", text)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        text = match.group(0)
    try:
        return json.loads(text)
    except Exception:
        return {"raw_output": text}


def _summarise_clinical_actions(clinical_actions: List[Dict]) -> tuple[List[str], List[str]]:
    """
    Separate clinical_actions into two human-readable lists:
      completed_actions    — actions the doctor APPROVED (i.e. were carried out)
      not_approved_actions — actions the doctor rejected
    Returns (completed, not_approved).

    NEW: also surfaces investigations/imaging/equipment items that were part
    of an approved AI suggestion but buried in a nested field (e.g. ECG
    inside hospital_prep.imaging_to_book) rather than the top-line action.
    Previously, approving a suggestion where ECG was recommended only in
    imaging_to_book silently dropped that fact — nothing recorded "ECG"
    anywhere searchable, so the next run had no way to know it was already
    ordered and re-suggested it.
    """
    completed    = []
    not_approved = []

    for ca in clinical_actions:
        action_type = ca.get("action_type", "")
        ai_sugg = ca.get("ai_suggestion") or {}

        # FIX (completing prior comment-only patch): prefer what a human
        # actually said (voice_dictation) over AI-authored diagnostic text.
        # single_most_critical_action_right_now / recommendation are
        # AI-generated and can carry a fabricated finding forward into
        # every future prompt via completed_actions. Only fall back to AI
        # text as a last resort, and label it explicitly so downstream
        # prompts don't mistake it for confirmed clinical fact.
        primary_label = (
            ca.get("voice_dictation")
            or ai_sugg.get("action")
            or (
                "[AI-authored, not clinician-verified] "
                + str(
                    ai_sugg.get("single_most_critical_action_right_now")
                    or ai_sugg.get("recommendation")
                    or str(ai_sugg)[:200]
                )
            )
        )

        # Pull investigation/imaging/equipment items out of nested sections
        # of an approved suggestion so they aren't lost on the next run.
        extra_bits: List[str] = []
        hospital_prep = ai_sugg.get("hospital_prep") or {}
        imaging_items = [
            i.get("imaging") for i in (hospital_prep.get("imaging_to_book") or [])
            if i.get("imaging") and i.get("imaging") not in ("Not_Applicable", None)
        ]
        if imaging_items:
            extra_bits.append("Imaging/investigations ordered: " + ", ".join(imaging_items))

        equipment_items = [
            e.get("equipment") for e in (hospital_prep.get("equipment_to_prepare") or [])
            if e.get("equipment")
        ]
        if equipment_items:
            extra_bits.append("Equipment prepared: " + ", ".join(equipment_items))

        immediate_actions = ai_sugg.get("immediate_actions") or {}
        for window in (immediate_actions.get("timestamp_anchored_actions") or []):
            for a in (window.get("actions") or []):
                if a.get("action"):
                    extra_bits.append(a["action"])

        label = " | ".join([primary_label] + extra_bits) if extra_bits else primary_label
        raw_ts = ca.get("client_created_at", ca.get("server_received_at", ""))
        entry = f"[{raw_ts}] {label}"

        if action_type == "approved":
            completed.append(entry)
        elif action_type == "not_approved":
            not_approved.append(entry)

    return completed, not_approved


def _extract_prescribed_medications(clinical_actions: List[Dict]) -> List[str]:
    """
    Pull medication mentions verbatim from clinical_actions voice_dictation text.
    Returns raw text snippets — not parsed drug names — to guarantee nothing
    the doctor said is lost or paraphrased.
    """
    medication_keywords = re.compile(
        r"\b(prescribe|administer|give|start|inject|dose|mg|ml|tablet|tab|"
        r"paracetamol|ibuprofen|paraffin|citracin|adrenaline|epinephrine|"
        r"morphine|fentanyl|atropine|saline|dextrose|antibiotic)\b",
        re.IGNORECASE,
    )
    mentions = []
    for ca in clinical_actions:
        text = (ca.get("voice_dictation") or "").strip()
        if text and medication_keywords.search(text):
            ts = ca.get("client_created_at", "")
            status = "approved" if ca.get("action_type") == "approved" else "not_approved"
            mentions.append(f"[{ts} | {status}] {text}")
    return mentions


# ── NEW (v4.1) ────────────────────────────────────────────────
# Treatments/interventions stated in THIS encounter's raw text — separate
# from the cross-visit clinical_actions collection above. This is what
# catches "BiPAP initiated" / "Injection Lasix 40 mg IV STAT administered"
# / "cardiac monitor connected" inside a voice dictation or doctor note, so
# it can be pinned into the prompt exactly like prescribed medications are,
# and never silently paraphrased away downstream.
TREATMENT_KEYWORDS = re.compile(
    r"\b(bipap|cpap|niv|non[- ]?invasive ventilation|nebuli[sz]|oxygen|o2\b|"
    r"nasal cannula|face mask|non[- ]?rebreather|high[- ]?flow nasal|intubat|ventilat(?:or|ed|ion)?|"
    r"lasix|furosemide|bumetanide|nitroglycerin|nitrate|gtn\b|morphine|aspirin|"
    r"clopidogrel|heparin|adrenaline|epinephrine|atropine|amiodarone|tranexamic|txa\b|"
    r"defibrillat|cardiovert|iv fluid|normal saline|ringer|cannula|catheter|"
    r"cardiac monitor|monitor connected|ecg\b|ekg\b|electrocardiogram|12[- ]?lead|"
    r"foley|ng tube|"
    r"chest tube|thoracostomy|compressions|cpr\b|dialysis|insulin|"
    r"diuretic|vasodilator|inotrope|pressor|calcium chloride|calcium gluconate|"
    r"needle decompression|pericardiocentesis|vitamin k|prothrombin complex|pcc\b|"
    r"idarucizumab|andexanet|protamine|fasciotomy|hematoma block|reduction splint(?:ed)?|"
    r"x[- ]?ray|xr\b|ct scan|ultrasound|fast scan|fast exam|echo(?:cardiogram)?|"
    r"abg\b|blood gas|blood test|blood work|labs drawn|lab sample|glucose check|"
    r"blood sugar checked|troponin|d[- ]?dimer)\b",
    re.IGNORECASE,
)

# ── NEW (v4.2) — keywords used only to flag likely anticoagulant/antiplatelet
# use from raw text so A2/A4/A6/A7/A8 can be prompted to consider reversal
# urgency; this is a text signal for the LLM to reason over, not a parsed
# medical fact by itself. ──
ANTICOAGULANT_KEYWORDS = re.compile(
    r"\b(warfarin|coumadin|dabigatran|pradaxa|rivaroxaban|xarelto|apixaban|eliquis|"
    r"edoxaban|savaysa|betrixaban|heparin|enoxaparin|lovenox|dalteparin|fondaparinux|"
    r"clopidogrel|plavix|ticagrelor|prasugrel|aspirin|antiplatelet|anticoagulant|"
    r"blood thinner)\b",
    re.IGNORECASE,
)


def _extract_treatments_performed(entries: List[Dict]) -> List[str]:
    """
    Scan every entry's raw text (voice dictation / doctor note / image-
    extracted) for treatment/intervention keywords, so that anything
    documented as already-done in THIS encounter is guaranteed to reach the
    final report, even when it is an advanced / non-BLS intervention that a
    role-scope restriction would otherwise cause an agent to strip out.
    """
    found: List[str] = []
    for entry in entries:
        text = (entry.get("conversation") or entry.get("extracted_text") or "").strip()
        if not text:
            continue
        for sentence in re.split(r"(?<=[.;\n])\s+", text):
            sentence = sentence.strip()
            if sentence and TREATMENT_KEYWORDS.search(sentence):
                ts = iso_ist(entry.get("timestamp"))
                found.append(f"[{ts}] {sentence}")
    return found


def _extract_anticoagulant_mentions(entries: List[Dict]) -> List[str]:
    """
    NEW (v4.2) — scan raw entry text for anticoagulant/antiplatelet mentions
    (patient's known medication history, not necessarily a treatment given
    this encounter). Used to prompt A2/A4/A6/A7/A8 to apply a lower
    threshold for imaging/reversal urgency in head injury or major bleeding,
    per CLINICAL_REFERENCE_ANTICOAGULATION_REVERSAL — never used to
    instruct a dose or reversal agent choice directly.
    """
    found: List[str] = []
    for entry in entries:
        text = (entry.get("conversation") or entry.get("extracted_text") or "").strip()
        if not text:
            continue
        for sentence in re.split(r"(?<=[.;\n])\s+", text):
            sentence = sentence.strip()
            if sentence and ANTICOAGULANT_KEYWORDS.search(sentence):
                ts = iso_ist(entry.get("timestamp"))
                found.append(f"[{ts}] {sentence}")
    return found


# ============================================================
# DUPLICATE-SUGGESTION SAFETY NET  (NEW — v4.3 reliability patch)
# ============================================================
# WHY THIS EXISTS: TREATMENTS_ALREADY_PERFORMED_RULE (and the equivalent
# instructions baked into A1/A2/A5/A6/A8/SIMPLE_SYNTH prompts) tell every
# agent not to re-suggest a treatment/investigation/action already
# documented as done. That is a *prompt-level* instruction only — nothing
# previously checked the model's actual output against the known
# already-done list in code. A5 and the A1-A7/A9 layer run on
# llama-3.1-8b-instant (faster/smaller), which is more likely to drift
# from an instruction under load than the larger synthesis model. This
# safety net is a deterministic, code-level second check that runs AFTER
# generation and catches that drift.
#
# DESIGN CHOICE: a flagged action is never silently deleted. Silently
# dropping a doctor-facing recommendation risks removing something that
# is only a partial/coincidental text match, which is a worse failure
# mode than an occasional harmless duplicate. Instead, a flagged action
# is rewritten into a "reassess/continue" framing and annotated with
# which already-done item it matched, so the doctor sees exactly why it
# was reframed and can override if the match was wrong. Every flag is
# also logged for audit and threshold tuning.
#
# MATCH HEURISTIC: deliberately conservative (biased toward missing a
# duplicate rather than falsely flagging a genuinely new action). Uses
# stdlib-only token-overlap + difflib.SequenceMatcher — no new
# dependency. Short/generic phrases (fewer than 2 meaningful,
# non-stopword tokens) are never compared, since they cannot be judged
# reliably.

_DEDUPE_STOPWORDS = {
    "the", "a", "an", "and", "or", "to", "for", "of", "in", "on", "at",
    "with", "as", "this", "that", "patient", "monitor", "monitoring",
    "assess", "assessment", "check", "continue", "give", "administer",
    "apply", "is", "was", "are", "were", "be", "been", "if", "already",
    "done", "performed", "action",
}


def _normalize_action_text(text: str) -> str:
    """Lowercase, strip punctuation/brackets/leading markers for comparison."""
    if not text:
        return ""
    text = re.sub(r'^\[.*?\]\s*', '', text)             # strip [timestamp] prefixes
    text = re.sub(r'^[✔✘⚕💊🩸•\-\u2022]\s*', '', text)   # strip leading markers
    text = text.lower()
    text = re.sub(r'[^\w\s]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def _meaningful_tokens(normalized_text: str) -> set:
    return {
        t for t in normalized_text.split()
        if t not in _DEDUPE_STOPWORDS and len(t) > 2
    }


def _build_already_done_corpus(state: "EVISState") -> List[str]:
    """
    Merge every source of "this was already done" into one normalized
    corpus for duplicate-checking:
      - treatments_performed                      (regex, this encounter — hard guarantee)
      - investigations_or_actions_performed_llm   (A1 LLM extraction, this encounter)
      - completed_actions                         (cross-visit, doctor-APPROVED history)
    not_approved_actions is deliberately EXCLUDED — a rejected action
    should still be eligible to be re-suggested/reconsidered; it is not
    "already done".
    """
    raw_items: List[str] = []
    raw_items.extend(state.get("treatments_performed") or [])
    raw_items.extend(state.get("investigations_or_actions_performed_llm") or [])
    raw_items.extend(state.get("completed_actions") or [])

    normalized = [_normalize_action_text(item) for item in raw_items]
    return [n for n in normalized if n]


def _is_likely_duplicate(action_text: str, already_done_corpus: List[str]) -> Optional[str]:
    """
    Returns the matching already-done string if action_text looks like a
    duplicate of something already performed, else None. Conservative by
    design — see module comment above.
    """
    norm_action = _normalize_action_text(action_text)
    action_tokens = _meaningful_tokens(norm_action)
    if len(action_tokens) < 2:
        return None  # too short/generic to safely judge

    for done in already_done_corpus:
        done_tokens = _meaningful_tokens(done)
        if len(done_tokens) < 2:
            continue
        overlap = action_tokens & done_tokens
        smaller = min(len(action_tokens), len(done_tokens))
        if smaller == 0:
            continue
        overlap_ratio = len(overlap) / smaller
        if overlap_ratio < 0.62:
            continue
        # Confirm with whole-string similarity to filter out coincidental
        # keyword overlap (e.g. two unrelated actions that both mention
        # "oxygen" and "patient").
        seq_ratio = SequenceMatcher(None, norm_action, done).ratio()
        if seq_ratio >= 0.45 or overlap_ratio >= 0.8:
            return done
    return None


def _apply_immediate_actions_duplicate_safety_net(state: "EVISState") -> None:
    """
    Runs after A5 (harmless no-op on the SIMPLE_SYNTH stub, since
    timestamp_anchored_actions is empty there). Rewrites any flagged
    action in-place; never deletes.
    """
    immediate = state.get("immediate_actions") or {}
    windows = immediate.get("timestamp_anchored_actions") or []
    if not windows:
        return
    corpus = _build_already_done_corpus(state)
    if not corpus:
        return

    flagged = 0
    for window in windows:
        for action in (window.get("actions") or []):
            if action.get("auto_flagged_possible_duplicate"):
                continue  # idempotency guard
            original = action.get("action") or ""
            match = _is_likely_duplicate(original, corpus)
            if not match:
                continue
            flagged += 1
            action["auto_flagged_possible_duplicate"] = True
            action["auto_flagged_matched_against"] = match
            action["action"] = f"Reassess/continue — already documented as done: {original}"
            note = (
                "[Auto-check: this matched an item already documented as "
                "performed this encounter. Verify whether repeating it is "
                "clinically indicated by a NEW change in condition, or "
                "whether reassessment/continuation is the correct action.]"
            )
            action["why_for_this_patient"] = (
                f"{action.get('why_for_this_patient', '')} {note}".strip()
            )

    if flagged:
        logger.warning(
            f"Duplicate safety net (A5 immediate_actions): flagged {flagged} "
            f"action(s) as likely repeats of already-performed treatments/actions "
            f"for patient {state.get('patient_id')}."
        )


def _extract_patient_age(state: "EVISState") -> Optional[int]:
    """Best-effort integer age from A1's extracted demographics."""
    entities = state.get("medical_entities") or {}
    demo = entities.get("patient_demographics") or {}
    age_raw = demo.get("approximate_age")
    if age_raw is None:
        return None
    match = re.search(r"\d+", str(age_raw))
    return int(match.group()) if match else None


def _has_bleeding_or_injury_evidence(state: "EVISState") -> bool:
    text = (state.get("conversation") or "").lower()
    keywords = (
        "bleed", "haemorrhage", "hemorrhage", "blood loss", "laceration",
        "wound", "penetrat", "gunshot", "stab", "fracture", "hematoma",
        "haematoma", "internal bleeding", "trauma", "accident", "fall",
        "assault", "crush", "burn",
    )
    return any(kw in text for kw in keywords)

def _has_chest_cardiac_trauma_evidence(state: "EVISState") -> bool:
    text = (state.get("conversation") or "").lower()
    keywords = (
        "chest trauma", "chest injury", "penetrating chest", "stab wound",
        "gunshot", "blunt chest", "rib fracture", "flail chest",
        "precordial", "sternal", "chest wall", "thoracoabdominal",
        "steering wheel", "seatbelt sign", "crush injury to chest",
    )
    return any(kw in text for kw in keywords)


def _has_compartment_syndrome_evidence(state: "EVISState") -> bool:
    text = (state.get("conversation") or "").lower()
    keywords = (
        "crush injury", "crushed", "tibia fracture", "fibula fracture",
        "forearm fracture", "long bone fracture", "prolonged compression",
        "found down", "trapped limb", "tight cast", "tight dressing",
        "extremity fracture", "compartment",
    )
    return any(kw in text for kw in keywords)


def _extract_systolic_bp(state: "EVISState") -> Optional[int]:
    """Best-effort systolic BP from A1's circulation extraction, falling back
    to a regex scan of the raw conversation text if A1 hasn't run yet or
    left it null."""
    entities = state.get("medical_entities") or {}
    circ = entities.get("circulation") or {}
    val = circ.get("blood_pressure_systolic")
    if val is not None:
        match = re.search(r"\d+", str(val))
        if match:
            return int(match.group())
    # fallback: scan raw text for "NNN/NNN" pattern
    text = state.get("conversation") or ""
    m = re.search(r"\b(\d{2,3})\s*/\s*\d{2,3}\b", text)
    if m:
        return int(m.group(1))
    return None

def _sanitize_unsupported_risk_flags(state: "EVISState") -> None:
    """
    NEW — deterministic, non-LLM safety net. Strips specific classes of
    fabricated risk flags (elderly-occult-shock, anticoagulation-reversal,
    hemorrhagic-shock/massive-transfusion) when NOTHING in the extracted
    facts or raw source text actually supports them.

    WHY THIS EXISTS: a real case showed llama-3.1-8b-instant inventing
    "elderly patient", "on anticoagulant", and "hemorrhagic shock /
    massive-transfusion criteria met" for a 35-year-old with entirely
    normal vitals ("SpO2 99%, HR 60, RR 20, BP 123/82, vitally stable")
    and no bleeding/injury/anticoagulant mention anywhere in the source
    text — a direct EVIDENCE_TRACEABILITY_RULE violation the prompt text
    alone did not reliably prevent. A prompt instruction can reduce how
    often this happens; it cannot guarantee it never happens, because the
    model is still reasoning probabilistically. This function is the hard,
    code-level backstop: it re-derives the same signals a human reviewer
    would check (documented age, anticoagulant keyword hit, bleeding/injury
    keyword hit) and forcibly corrects the specific fields most prone to
    this failure mode, rather than trusting the LLM's own self-report.

    Deliberately narrow in scope (mirrors the conservative design of the
    duplicate-safety-net above): only touches elderly/anticoagulation/
    hemorrhagic-shock fields, since those are the ones observed being
    fabricated and are cheap to verify deterministically. It does NOT
    attempt to adjudicate every possible suspected diagnosis — that remains
    the job of NO_UNSUPPORTED_RISK_INFERENCE_RULE at the prompt level,
    since judging an arbitrary diagnosis's plausibility isn't something a
    keyword check can safely do without risking false positives that
    delete a genuinely correct suspicion.
    """
    age = _extract_patient_age(state)
    is_elderly = age is not None and age >= 65
    anticoag_hit = bool(ANTICOAGULANT_KEYWORDS.search(state.get("conversation") or ""))
    bleeding_evidence = _has_bleeding_or_injury_evidence(state)

    corrections: List[str] = []

    va = state.get("vitals_assessment") or {}
    rs = state.get("risk_stratification") or {}

    elderly_screen = va.get("elderly_occult_shock_screen")
    if isinstance(elderly_screen, dict) and not is_elderly:
        if str(elderly_screen.get("applicable")).strip().lower() not in ("false", "none", ""):
            elderly_screen["applicable"] = False
            elderly_screen["clinical_note"] = (
                "Auto-corrected: no documented age >=65 in source data — "
                "elderly-specific occult shock reasoning does not apply."
            )
            corrections.append("A2.elderly_occult_shock_screen.applicable")

    anticoag_status = va.get("anticoagulation_status")
    if isinstance(anticoag_status, dict) and not anticoag_hit:
        if anticoag_status.get("on_anticoagulant_or_antiplatelet") not in (False, None, "false"):
            anticoag_status["on_anticoagulant_or_antiplatelet"] = False
            anticoag_status["agent_if_named"] = None
            anticoag_status["flag_for_physician"] = "Not_applicable"
            corrections.append("A2.anticoagulation_status")

    elderly_mod = rs.get("elderly_risk_modifier")
    if isinstance(elderly_mod, dict) and not is_elderly:
        if str(elderly_mod.get("applicable")).strip().lower() not in ("false", "none", ""):
            elderly_mod["applicable"] = False
            elderly_mod["occult_shock_possible_despite_normal_vitals"] = None
            elderly_mod["undertriage_caution_applied"] = None
            elderly_mod["note"] = "Auto-corrected: no documented age >=65 in source data."
            corrections.append("A4.elderly_risk_modifier.applicable")

    anticoag_mod = rs.get("anticoagulation_risk_modifier")
    if isinstance(anticoag_mod, dict) and not anticoag_hit:
        if str(anticoag_mod.get("applicable")).strip().lower() not in ("false", "none", ""):
            anticoag_mod["applicable"] = False
            anticoag_mod["bleeding_or_head_injury_present"] = None
            anticoag_mod["flag_for_physician"] = "Not_applicable"
            corrections.append("A4.anticoagulation_risk_modifier.applicable")

    shock = rs.get("shock_risk")
    if isinstance(shock, dict) and not bleeding_evidence:
        shock_type = str(shock.get("type", "")).strip().lower()
        if shock.get("present") and (shock_type.startswith("haemorrh") or shock_type.startswith("hemorrh")):
            shock["present"] = False
            shock["type"] = "Unknown"
            shock["stage"] = "Unknown"
            shock["massive_transfusion_predictor_criteria_met"] = False
            shock["action"] = (
                "Auto-corrected: no bleeding/injury evidence found in source "
                "text to support hemorrhagic shock."
            )
            corrections.append("A4.shock_risk")

    flags = rs.get("special_risk_flags")
    if isinstance(flags, list) and not (anticoag_hit or bleeding_evidence):
        filtered = [
            f for f in flags
            if not any(
                kw in str((f or {}).get("flag", "")).lower()
                for kw in ("anticoagul", "reversal", "hemorrhag", "haemorrhag", "bleeding", "transfusion")
            )
        ]
        if len(filtered) != len(flags):
            rs["special_risk_flags"] = filtered
            corrections.append("A4.special_risk_flags")

    # ── NEW — chest/cardiac trauma (tension pneumothorax / tamponade /
    # massive hemothorax) requires actual chest/thoracoabdominal trauma
    # evidence in the source text. Without it, these are fabricated. ──
    chest_trauma_evidence = _has_chest_cardiac_trauma_evidence(state)
    for screen_key in ("chest_cardiac_trauma_screen",):
        screen = va.get(screen_key)
        if isinstance(screen, dict) and not chest_trauma_evidence:
            changed = False
            for f in ("tension_pneumothorax_suspected", "cardiac_tamponade_suspected", "massive_hemothorax_suspected"):
                if screen.get(f) not in (False, None, "false", "Not_applicable"):
                    screen[f] = False
                    changed = True
            if str(screen.get("applicable")).strip().lower() not in ("false", "none", ""):
                screen["applicable"] = False
                changed = True
            if screen.get("escalation_needed") not in (None, "Not_applicable"):
                screen["escalation_needed"] = "Not_applicable"
                changed = True
            if changed:
                screen["tension_pneumothorax_basis"] = (
                    "Auto-corrected: no chest/thoracoabdominal trauma or cardiac-injury-"
                    "consistent mechanism documented in source data."
                )
                corrections.append(f"A2.{screen_key}")

    ia = rs  # (risk_stratification already aliased as rs)
    chest_assess = state.get("injury_profile", {}).get("chest_cardiac_trauma_assessment") if isinstance(state.get("injury_profile"), dict) else None
    if isinstance(chest_assess, dict) and not chest_trauma_evidence:
        changed = False
        for f in ("tension_pneumothorax_suspected", "cardiac_tamponade_suspected", "massive_hemothorax_suspected",
                   "flail_chest_or_pulmonary_contusion_suspected"):
            if chest_assess.get(f) not in (False, None):
                chest_assess[f] = False
                changed = True
        if str(chest_assess.get("applicable")).strip().lower() not in ("false", "none", ""):
            chest_assess["applicable"] = False
            changed = True
        if changed:
            corrections.append("A3.chest_cardiac_trauma_assessment")

    # ── NEW — compartment syndrome requires extremity injury / crush /
    # prolonged-compression evidence. ──
    limb_injury_evidence = _has_compartment_syndrome_evidence(state)
    comp_screen = va.get("compartment_syndrome_screen")
    if isinstance(comp_screen, dict) and not limb_injury_evidence:
        changed = False
        if comp_screen.get("risk_present") not in (False, None):
            comp_screen["risk_present"] = False
            changed = True
        if str(comp_screen.get("applicable")).strip().lower() not in ("false", "none", ""):
            comp_screen["applicable"] = False
            changed = True
        if comp_screen.get("escalation_needed") not in (None, "Not_applicable"):
            comp_screen["escalation_needed"] = "Not_applicable"
            changed = True
        if changed:
            corrections.append("A2.compartment_syndrome_screen")

    comp_assess = state.get("injury_profile", {}).get("compartment_syndrome_assessment") if isinstance(state.get("injury_profile"), dict) else None
    if isinstance(comp_assess, dict) and not limb_injury_evidence:
        changed = False
        if comp_assess.get("risk_level") not in (None, "None"):
            comp_assess["risk_level"] = "None"
            changed = True
        if str(comp_assess.get("applicable")).strip().lower() not in ("false", "none", ""):
            comp_assess["applicable"] = False
            changed = True
        if changed:
            corrections.append("A3.compartment_syndrome_assessment")

    # ── NEW — hypertensive emergency must be consistent with the actual
    # documented BP. A crisis/emergency label with a HYPOTENSIVE systolic
    # (<90) is an internal contradiction and must be cleared, not just
    # "unsupported." ──
    systolic = _extract_systolic_bp(state)
    htn_assess = va.get("hypertension_assessment")
    if isinstance(htn_assess, dict) and systolic is not None and systolic < 90:
        if htn_assess.get("hypertensive_emergency_suspected") not in (False, None):
            htn_assess["hypertensive_emergency_suspected"] = False
            htn_assess["hypertensive_urgency_suspected"] = False
            htn_assess["severity"] = "Not_applicable_hypotensive"
            htn_assess["clinical_note"] = (
                f"Auto-corrected: documented systolic BP is {systolic} mmHg (hypotensive), "
                f"which directly contradicts a hypertensive emergency/crisis label. If BP "
                f"trended down after treatment, describe the trend explicitly rather than "
                f"labeling the current state hypertensive."
            )
            corrections.append("A2.hypertension_assessment (BP contradiction)")

    state["vitals_assessment"] = va
    state["risk_stratification"] = rs

    if corrections:
        logger.warning(
            f"Unsupported-risk-flag sanitizer: auto-corrected {corrections} "
            f"for patient {state.get('patient_id')} (age={age}, "
            f"anticoag_keyword_hit={anticoag_hit}, bleeding_evidence={bleeding_evidence})."
        )


def _sanitize_final_output_risk_flags(state: "EVISState") -> None:
    """
    NEW — same deterministic backstop as _sanitize_unsupported_risk_flags,
    applied to the FINAL synthesized output (A8's or SIMPLE_SYNTH's
    timeline_suggestions), since that output has its own independently
    generated elderly_trauma_modifier / anticoagulation_reversal_assessment
    fields that are not guaranteed to match whatever A2/A4 already
    corrected — the synthesis model can still reintroduce a fabricated flag
    even if upstream agents were sanitized.
    """
    age = _extract_patient_age(state)
    is_elderly = age is not None and age >= 65
    anticoag_hit = bool(ANTICOAGULANT_KEYWORDS.search(state.get("conversation") or ""))

    suggestions = state.get("timeline_suggestions") or {}
    corrections: List[str] = []

    elderly_mod = suggestions.get("elderly_trauma_modifier")
    if isinstance(elderly_mod, dict) and not is_elderly:
        if str(elderly_mod.get("applicable")).strip().lower() not in ("false", "none", ""):
            elderly_mod["applicable"] = False
            elderly_mod["occult_shock_caution_applied"] = None
            elderly_mod["undertriage_caution_applied"] = None
            corrections.append("elderly_trauma_modifier.applicable")

    anticoag_final = suggestions.get("anticoagulation_reversal_assessment")
    if isinstance(anticoag_final, dict) and not anticoag_hit:
        if anticoag_final.get("on_anticoagulant_or_antiplatelet") not in (False, None, "false"):
            anticoag_final["on_anticoagulant_or_antiplatelet"] = False
            anticoag_final["agent_if_named"] = None
            anticoag_final["bleeding_or_head_injury_present"] = None
            anticoag_final["flag_for_physician"] = "Not_applicable"
            corrections.append("anticoagulation_reversal_assessment")

    state["timeline_suggestions"] = suggestions
    if corrections:
        logger.warning(
            f"Unsupported-risk-flag sanitizer (final output): auto-corrected "
            f"{corrections} for patient {state.get('patient_id')}."
        )


def _apply_timeline_duplicate_safety_net(state: "EVISState") -> None:
    """
    Runs after A8 or SIMPLE_SYNTH. Covers the two flat-string surfaces
    where a repeated suggestion could appear: timestamp_based_response_plan
    priority_actions, and (SIMPLE_SYNTH only) immediate_actions_bls_scope.
    Rewrites and annotates via an inline marker (never deletes) since
    these are plain strings, not structured objects.
    """
    suggestions = state.get("timeline_suggestions") or {}
    corpus = _build_already_done_corpus(state)
    if not corpus:
        return

    flagged = 0
    MARKER = "[Auto-check: already documented as done — verify before repeating] "

    def _dedupe_string_list(items: List[str]) -> List[str]:
        nonlocal flagged
        out = []
        for item in items:
            if not isinstance(item, str) or item.startswith(MARKER):
                out.append(item)
                continue
            match = _is_likely_duplicate(item, corpus)
            if match:
                flagged += 1
                out.append(f"{MARKER}Reassess/continue: {item}")
            else:
                out.append(item)
        return out

    plan = suggestions.get("timestamp_based_response_plan") or []
    for entry in plan:
        actions = entry.get("priority_actions")
        if isinstance(actions, list):
            entry["priority_actions"] = _dedupe_string_list(actions)

    bls_scope = suggestions.get("immediate_actions_bls_scope")
    if isinstance(bls_scope, list):
        suggestions["immediate_actions_bls_scope"] = _dedupe_string_list(bls_scope)

    if flagged:
        logger.warning(
            f"Duplicate safety net (timeline_suggestions): flagged {flagged} "
            f"item(s) as likely repeats of already-performed treatments/actions "
            f"for patient {state.get('patient_id')}."
        )


def build_combined_state(
    patient_id: str,
    entries: List[Dict],
    clinical_actions: List[Dict] = [],
    image_entries: List[Dict] = [],
    patient_record: Optional[Dict] = None,
) -> EVISState:
    registered_incident_type = _registered_incident_type(patient_record or {})
    completed_actions, not_approved_actions = _summarise_clinical_actions(clinical_actions)
    prescribed_medications = _extract_prescribed_medications(clinical_actions)
    treatments_performed    = _extract_treatments_performed(entries)
    anticoagulant_mentions   = _extract_anticoagulant_mentions(entries)

    combined_parts = [
        "=== PATIENT CLINICAL INPUT TIMELINE (Chronological — All Sources | All timestamps in IST Asia/Kolkata) ===\n"
    ]

    # NEW — surface the registered incident type explicitly, since it is
    # ground truth from patient registration and previously invisible to
    # this pipeline entirely (only voice/doctor/image text was ever seen).
    if registered_incident_type:
        combined_parts.append(
            f"\n=== PATIENT REGISTRATION — INCIDENT TYPE (GROUND TRUTH) ===\n"
            f"This patient's incident was registered as: \"{registered_incident_type}\"\n"
            "This is authoritative and does not depend on whether any voice/doctor "
            "note happens to restate it. If this indicates a trauma mechanism "
            "(e.g. road traffic accident, fall, assault, penetrating/blunt injury), "
            "treat the case as trauma even if the available voice/doctor dictations "
            "only describe vitals or a medical-sounding picture — the mechanism may "
            "simply not have been redictated yet.\n"
        )

    for idx, entry in enumerate(entries, start=1):
        source = entry.get("_source", "unknown")
        ts_raw = entry.get("timestamp")
        ts_ist = iso_ist(ts_raw)
        date   = entry.get("date", "")
        time_  = entry.get("time", "")
        text   = entry.get("conversation", entry.get("extracted_text", "")).strip()

        if source == "voice_dictation":
            label = "EMT VOICE DICTATION"
        elif source == "doctor_voice_note":
            label = "DOCTOR VOICE NOTE"
        elif source == "image_extracted":
            label = "IMAGE-EXTRACTED CLINICAL DATA"
        else:
            label = "CLINICAL NOTE"

        combined_parts.append(
            f"[{label} {idx} | Date: {date} Time: {time_} | Timestamp (IST): {ts_ist}]\n{text}\n"
        )

    if completed_actions or not_approved_actions:
        combined_parts.append("\n=== PRIOR CLINICAL ACTIONS FOR THIS PATIENT ===")
        if completed_actions:
            combined_parts.append("APPROVED (done / carried out):")
            for a in completed_actions:
                combined_parts.append(f"  ✔ {a}")
        if not_approved_actions:
            combined_parts.append("NOT APPROVED (rejected by doctor):")
            for a in not_approved_actions:
                combined_parts.append(f"  ✘ {a}")
        combined_parts.append(
            "\nIMPORTANT: When generating suggestions, acknowledge approved actions as already "
            "done. Do NOT re-suggest not-approved actions. Explain reasoning in context of this history."
        )

    if prescribed_medications:
        combined_parts.append("\n=== DOCTOR-PRESCRIBED MEDICATIONS (VERBATIM — MUST APPEAR IN REPORT) ===")
        for m in prescribed_medications:
            combined_parts.append(f"  💊 {m}")
        combined_parts.append(
            "\nCRITICAL: These medication mentions are legally significant clinical orders. "
            "They MUST appear, copied exactly, in the final synthesis output under "
            "'doctor_prescribed_medications'. Do not paraphrase, correct, omit, or invent medications."
        )

    # ── NEW (v4.1) — pin treatments/interventions already performed THIS
    # encounter, regardless of whether they are basic or advanced-level,
    # the same way prescribed medications are pinned above. ─────────────
    if treatments_performed:
        combined_parts.append(
            "\n=== INTERVENTIONS/TREATMENTS ALREADY PERFORMED THIS ENCOUNTER "
            "(MUST APPEAR IN 'treatments_already_performed' IN THE FINAL OUTPUT) ==="
        )
        for t in treatments_performed:
            combined_parts.append(f"  ⚕ {t}")
        combined_parts.append(
            "\nCRITICAL: These are FACTS to report, not suggestions to filter by role scope. "
            "Regardless of whether a treatment is 'basic EMT scope' or advanced hospital-level "
            "care (e.g. BiPAP/NIV, IV push medications, cardiac monitoring), it MUST be listed "
            "explicitly with the parameter it targets and the effect observed if stated, and every "
            "subsequent recommendation must build on it (continue/monitor/reassess) rather than "
            "re-suggesting it or silently dropping it from the report."
        )

    # ── NEW (v4.2) — pin any anticoagulant/antiplatelet mentions found in
    # raw text, so agents can apply a lower CT/reversal threshold rather
    # than treating the patient as if bleeding risk were unmodified. ─────
    if anticoagulant_mentions:
        combined_parts.append(
            "\n=== ANTICOAGULANT/ANTIPLATELET MENTIONS DETECTED IN RAW TEXT "
            "(verify context — may be current medication, home history, or given this "
            "encounter; do not assume which) ==="
        )
        for m in anticoagulant_mentions:
            combined_parts.append(f"  🩸 {m}")
        combined_parts.append(
            "\nIMPORTANT: If a patient on an anticoagulant/antiplatelet has any head injury or "
            "major bleeding, this changes risk and urgency (lower threshold for imaging, "
            "physician notification for reversal) even if the mechanism seems minor — see "
            "anticoagulation reasoning applied by downstream agents. This system does not "
            "prescribe a reversal agent or dose."
        )

    # ── Pin the most recent entry as ground truth ─────────────
    latest_entry  = entries[-1]
    latest_source = latest_entry.get("_source", "unknown")
    latest_text   = latest_entry.get("conversation", latest_entry.get("extracted_text", "")).strip()
    latest_ts_raw = latest_entry.get("timestamp")
    latest_ts_ist = iso_ist(latest_ts_raw)

    if latest_source == "doctor_voice_note":
        authority_note = (
            "WARNING: The DOCTOR VOICE NOTE is the most recent clinical assessment and carries "
            "the HIGHEST authority. It OVERRIDES any earlier EMT observations. "
            "The patient current status MUST be taken from the doctor note, not from earlier EMT dictation."
        )
    elif latest_source == "image_extracted":
        authority_note = (
            "WARNING: The most recent IMAGE-EXTRACTED DATA is the latest clinical input. "
            "Interpret the patient current status from this entry, not from earlier entries."
        )
    else:
        authority_note = (
            "WARNING: The most recent EMT entry is the CURRENT status. "
            "Earlier entries describe past situation only."
        )

    combined_parts.append(
        "\n" + "=" * 60 +
        f"\nCURRENT PATIENT STATUS (Most Recent Entry — IST: {latest_ts_ist})" +
        f"\nSource: {latest_source.upper()}" +
        f"\n{authority_note}" +
        f"\nCURRENT STATUS TEXT: \"{latest_text}\"" +
        "\n" + "=" * 60 +
        "\n\nAll agents MUST reflect this as the patient current state."
        "\nDo NOT use earlier entries to describe the current condition."
    )

    combined_parts.append(
        "\n=== END OF TIMELINE ==="
        "\nEntry 1 is the earliest event. The CURRENT STATUS block above is ground truth."
        "\nWhen reporting consciousness, stability, or trend use CURRENT STATUS, not Entry 1."
    )

    combined_conversation = "\n".join(combined_parts)

    logger.info("=" * 100)
    logger.info("📝 FULL INPUT CONTENT being sent to Agents (IST timestamps):")
    logger.info("=" * 100)
    logger.info(combined_conversation)
    logger.info("=" * 100)

    return EVISState(
        patient_id           = patient_id,
        conversation         = combined_conversation,
        timestamp            = latest_ts_ist,
        date                 = latest_entry.get("date", ""),
        time                 = latest_entry.get("time", ""),
        entry_count          = len(entries),
        registered_incident_type = registered_incident_type,
        case_type            = None,
        is_trauma             = None,
        has_image_vitals      = None,
        complexity            = None,
        care_setting          = None,
        run_a3                = None,
        run_a9                = None,
        run_full_pipeline     = None,
        routing_rationale     = None,
        medical_entities     = None,
        vitals_assessment    = None,
        injury_profile       = None,
        risk_stratification  = None,
        immediate_actions    = None,
        precautions          = None,
        hospital_prep        = None,
        vitals_comparison    = None,
        timeline_suggestions = None,
        errors               = [],
        agent_timings        = {},
        clinical_actions     = clinical_actions,
        completed_actions    = completed_actions,
        not_approved_actions = not_approved_actions,
        image_entries        = image_entries,
        prescribed_medications = prescribed_medications,
        treatments_performed  = treatments_performed,
        investigations_or_actions_performed_llm = None,  # filled in by A1
    )


def build_initial_state(patient_id: str, dictation: Dict) -> EVISState:
    """Build state from a single dictation (used by /latest endpoint only)."""
    ts_ist = iso_ist(dictation.get("timestamp"))
    treatments_performed = _extract_treatments_performed([dictation])
    return EVISState(
        patient_id           = patient_id,
        conversation         = dictation.get("conversation", ""),
        timestamp            = ts_ist,
        date                 = dictation.get("date", ""),
        time                 = dictation.get("time", ""),
        entry_count          = 1,
        case_type            = None,
        is_trauma             = None,
        has_image_vitals      = None,
        complexity            = None,
        care_setting          = None,
        run_a3                = None,
        run_a9                = None,
        run_full_pipeline     = None,
        routing_rationale     = None,
        medical_entities     = None,
        vitals_assessment    = None,
        injury_profile       = None,
        risk_stratification  = None,
        immediate_actions    = None,
        precautions          = None,
        hospital_prep        = None,
        vitals_comparison    = None,
        timeline_suggestions = None,
        errors               = [],
        agent_timings        = {},
        clinical_actions     = [],
        completed_actions    = [],
        not_approved_actions = [],
        image_entries        = [],
        prescribed_medications = [],
        treatments_performed  = treatments_performed,
        investigations_or_actions_performed_llm = None,
    )


# ============================================================
# CLINICAL CONTEXT BLOCK  (shared by all agents)
# ============================================================

def _clinical_context_block(state: EVISState) -> str:
    completed    = state.get("completed_actions") or []
    not_approved = state.get("not_approved_actions") or []

    if not completed and not not_approved:
        return "No prior clinical actions recorded for this patient."

    lines = ["── Prior Clinical Actions ──"]
    if completed:
        lines.append("APPROVED & DONE (do not re-suggest; build on these):")
        for a in completed:
            lines.append(f"  ✔ {a}")
    if not_approved:
        lines.append("NOT APPROVED by doctor (do NOT re-suggest these):")
        for a in not_approved:
            lines.append(f"  ✘ {a}")
    lines.append(
        "When generating new suggestions, reference approved actions as already "
        "done and explain HOW the current recommendation builds on or differs from them. "
        "Never suggest anything in the NOT APPROVED list."
    )
    return "\n".join(lines)


def _treatments_performed_block(state: EVISState) -> str:
    """Shared block reminding every agent what has already been done THIS
    encounter (BiPAP, IV meds, monitors, ECG, imaging, etc.), independent of
    the cross-visit clinical_actions history above.

    Combines TWO layers, deduplicated:
      1. treatments_performed — regex-extracted, the hard guarantee. Cannot
         be paraphrased away because it's a fixed keyword match, not an LLM
         judgment call.
      2. investigations_or_actions_performed_llm — A1's LLM-extracted list,
         catches phrasings/investigations the regex hasn't been taught yet.
    Layer 1 is never dropped in favour of layer 2 — this is a union, not a
    replacement, specifically because relying on LLM extraction alone
    previously caused documented treatments (BiPAP/Lasix) to be silently
    paraphrased out of a real report.
    """
    treatments = state.get("treatments_performed") or []
    llm_extra  = state.get("investigations_or_actions_performed_llm") or []

    # De-dupe: skip an LLM item if a regex item already substantially
    # covers the same text (simple substring check is enough here since
    # both lists are short free-text lines, not structured records).
    combined = list(treatments)
    for item in llm_extra:
        item_lower = item.lower()
        if not any(item_lower in t.lower() or t.lower() in item_lower for t in treatments):
            combined.append(f"{item} (source: AI extraction — verify if unclear)")

    if not combined:
        return "No specific treatments/interventions/investigations were extracted from this encounter's raw text."

    lines = ["── Treatments/Interventions/Investigations Already Performed THIS Encounter ──"]
    for t in combined:
        lines.append(f"  ⚕ {t}")
    lines.append(
        "These are FACTS to report and build on — not suggestions to filter by role scope, "
        "and NOT things to re-order or re-suggest (e.g. if ECG was already taken, do not "
        "recommend 'take ECG' again — reference the result/impression instead, or note that "
        "repeat ECG is warranted only if clinically indicated by a NEW change in condition). "
        "Never omit them, never re-suggest them as if not yet done."
    )
    return "\n".join(lines)


# ============================================================
# ANTI-DUPLICATION RULE — shared text spliced into A5 and A8
# ============================================================

ANTI_DUPLICATION_RULE_A5 = """
CRITICAL — NO DUPLICATE CONTENT ACROSS TIME WINDOWS:
Each time_window block must describe what is NEW or DIFFERENT at that point.
Do NOT repeat the same vitals string, the same "why_for_this_patient" text, or
the same success_indicator verbatim across multiple time windows. If nothing
has changed since the previous window, the action for that window should say
so explicitly (e.g. "Continue previous management — no new action required")
rather than restating the full clinical picture again.
"""

ANTI_DUPLICATION_RULE_A8 = """
CRITICAL — NO DUPLICATE CONTENT ACROSS THE TIMELINE:
For "vitals_context" and "prior_action_context" in each timestamp_based_response_plan
entry: only include NEW information not already stated in an earlier block. If the
vitals or prior-action context has not changed since the previous entry, write
exactly "No change from previous" instead of repeating the full sentence.
Likewise, "monitoring" and "alert_if" arrays must NOT be copy-pasted identically
into every block — state them fully ONCE (at the earliest relevant block) and in
later blocks either omit them or write ["Continue monitoring as above"].
This output is read by a doctor in real time; repeated boilerplate wastes their
attention during an emergency. Be terse and non-redundant.
"""

# ── NEW (v4.1) — reinforces anti-duplication at the whole-report level,
# specifically anchored on the consolidated continuous_monitoring_plan. ──
ANTI_REPETITION_RULE = """
CRITICAL — NO BOILERPLATE REPEATED ACROSS SECTIONS:
Build ONE consolidated "continuous_monitoring_plan" list and reference it
elsewhere as "per continuous monitoring plan" instead of re-listing the same
items (pulse oximetry, BP, RR, ECG, IV access, mental status) again in
timestamp_based_response_plan, precautions, or hospital prep. Similarly,
"Continue BiPAP" / "Continue monitoring" must not appear verbatim in more
than one place unless each occurrence adds new rationale or a new
threshold. If nothing changed since the previous mention, write "No change
from previous" or "As above" instead of repeating the sentence.
"""


# ============================================================
# CLINICAL REFERENCE NOTES — grounded in Tintinalli's Emergency
# Medicine (current edition). Spliced into agent prompts so the
# LLM reasons from current, evidence-based emergency practice
# instead of outdated or invented heuristics.
# ============================================================

CLINICAL_REFERENCE_A2 = """
CLINICAL REFERENCE (apply this reasoning, do not quote it back verbatim):
- Do NOT stage hemorrhage severity using the classic Class I-IV scheme
  (based on % blood volume lost predicted from HR/SBP/GCS). Current teaching
  holds this staging is unreliable and should not drive resuscitation
  decisions. Prefer trends over time, peripheral perfusion signs (skin
  colour/temperature, capillary refill, pulse quality), mentation, and the
  shock_index (heart rate ÷ systolic BP) as a continuous severity signal —
  roughly <1.0 is reassuring, ≥1.0 suggests clinically significant
  compensated or overt shock and should raise concern.
- Vital signs alone are insensitive: a young, fit patient can lose a large
  volume of blood while still appearing near-normal (robust compensation),
  while elderly patients or those on beta-blockers may never mount a
  tachycardic response even with severe hemorrhage. Absence of tachycardia
  or hypotension does NOT rule out significant blood loss — weigh mechanism
  and mentation heavily, not just numbers. Blood pressure itself does not
  reliably reflect cardiac output or regional perfusion; a "normal" BP does
  not exclude a significant oxygen debt already accumulating at the tissue
  level.
- Mean arterial pressure (MAP) below ~65 mmHg is a useful general threshold
  for inadequate organ perfusion in non-trauma/medical shock states.
- Do not rely on "palpable pulse at X location implies SBP of Y" rules of
  thumb (e.g. radial=80/femoral=70/carotid=60 mmHg) — these are known to
  overestimate true systolic pressure and are not part of current practice;
  treat a palpable pulse only as a rough, non-quantitative reassurance sign.
- For oxygenation: avoid framing every hypoxic patient as needing maximal
  FiO2. Over-oxygenation (hyperoxia) is itself associated with worse
  outcomes; the goal is adequate oxygenation (commonly SpO2 in the
  ~94-98% range for most acute non-COPD presentations), not saturating at
  100% by default. Exception: in acute heart failure / pulmonary edema,
  hypoxemia is a greater risk than hypercarbia — do not withhold or
  under-titrate oxygen out of concern for CO2 retention; keep SpO2 at or
  above ~95% in that specific picture (see CLINICAL_REFERENCE_HTN_PULM_EDEMA).
- When assessing severe hypertension, remember blood pressure can differ
  meaningfully between arms (a difference >10-20 mmHg is clinically
  significant, and can itself suggest aortic dissection, coarctation, or
  peripheral vascular disease); if two readings are available, treat/track
  the HIGHER of the two arms and prefer an upper-arm cuff reading over a
  wrist/wrist-oscillometric device. Do not dismiss a hypertensive-emergency
  picture solely because the patient has no known prior history of
  hypertension — a meaningful proportion of true hypertensive emergencies
  have no documented hypertension history.
"""

CLINICAL_REFERENCE_A3_A5_A6 = """
CLINICAL REFERENCE — SPINAL PRECAUTIONS (apply this reasoning, do not quote
it back verbatim):
- Full spinal immobilization/cervical collar is not automatically mandatory
  for every trauma mechanism. Field practice supports withholding cervical
  immobilization only when ALL of the following are true: no midline neck
  pain, tenderness, or stiffness (define "neck pain" liberally — including
  vague complaints like the neck "feels funny," not only frank pain);
  patient age roughly 11-65; no altered sensorium (no intoxication, no head
  injury, no confusion); and no distracting painful injury (e.g. long-bone
  fracture, chest/abdominal injury) that could mask neck pain. If ANY of
  these is absent, uncertain, or the mechanism is high-energy, immobilize.
  Note that a post hoc analysis of NEXUS in patients 65 and older found the
  criteria remained highly sensitive but far less specific in that age
  group — expect more elders to "fail" the rule and require imaging/
  immobilization even with a relatively low-energy mechanism.
- A rigid cervical collar alone is NOT sufficient immobilization — it is
  more accurately described as a cervical extrication aid. Full
  immobilization requires the collar PLUS head blocks/padding (or rolled
  blankets/sandbags taped in place) on both sides of the head, with the
  torso and thighs secured to a long or short board (e.g. a Kendrick-style
  extrication device) using straps; note explicitly if any of these
  components is missing rather than treating "collar applied" as complete.
  Manual in-line stabilization of the neck should not be released until the
  patient is fully secured to the board.
- When airway opening is needed and cervical spine injury is possible or
  unknown, the jaw-thrust maneuver (or a modified jaw thrust performed
  simultaneously with manual cervical stabilization) is preferred over
  head-tilt-chin-lift because it opens the airway while keeping the neck in
  a neutral position; reserve head-tilt-chin-lift for patients where
  trauma/c-spine injury is not a concern.
- Do not recommend vigorous/large-volume prehospital IV fluid boluses to
  "normalize" blood pressure in suspected hemorrhagic trauma shock — this
  is outside BLS/basic-EMT scope in any case, and aggressive fluid
  resuscitation before bleeding is controlled can worsen outcomes
  (permissive-hypotension principle) by increasing morbidity/mortality
  through enhanced exsanguination from vascular or organ injury requiring
  operative control. The correct BLS-scope action is bleeding control,
  positioning, oxygen as needed, and rapid transport, while escalating
  fluid/blood decisions to paramedic/hospital level. When fluids ARE
  indicated at hospital level, current evidence favors balanced/buffered
  crystalloids (e.g. lactated Ringer's, Plasma-Lyte) over large-volume
  0.9% normal saline, which is associated with hyperchloremic acidosis at
  high volumes.
"""

CLINICAL_REFERENCE_A7 = """
CLINICAL REFERENCE — ED PREPARATION (apply this reasoning, do not quote it
back verbatim):
- For trauma patients in hemorrhagic shock who need transfusion, current
  massive-transfusion practice targets a balanced ratio (roughly 1:1:1 of
  packed red cells : platelets : fresh frozen plasma) rather than
  crystalloid-heavy or red-cell-only resuscitation — reflect this in
  blood_and_fluids guidance when a massive transfusion protocol is flagged.
  Massive transfusion is generally defined as needing >10 units of packed
  red cells within 24 hours. A simple 4-factor bedside score — penetrating
  mechanism of injury, a positive FAST exam, systolic BP <90 mmHg, and
  heart rate >120/min — predicts the need for massive transfusion reasonably
  well when 2 or more factors are present, and can be mentioned as a
  trigger for early blood-bank notification/MTP activation readiness.
  During massive transfusion, citrate in stored blood products can cause
  significant hypocalcemia, so note that calcium monitoring/repletion is a
  standard part of these protocols. Tranexamic acid is a commonly used
  early adjunct in major bleeding trauma associated with reduced mortality
  in some studies — this is information for the treating team to consider,
  not a dosing instruction from this system.
- For active hemorrhage before surgical/procedural control, many protocols
  target a permissive systolic BP of about 80-90 mmHg rather than full
  normalization, EXCEPT when there is concomitant significant traumatic
  brain injury — in that setting a higher systolic BP (commonly >100-110
  mmHg) and adequate MAP are prioritized to protect cerebral perfusion.
  Reflect this trade-off in equipment/blood_and_fluids notes when relevant
  rather than a single universal BP target.
- Avoid recommending a default/maximal oxygen or ventilator FiO2 target for
  every patient on arrival; note that hyperoxia should be avoided once the
  patient is adequately oxygenated — EXCEPT in acute heart failure/
  pulmonary edema, where the goal is SpO2 ≥95% and oxygen should not be
  under-titrated out of concern for CO2 retention.
"""

# ── NEW (v4.1) — grounded in Tintinalli's treatment of "sympathetic
# crashing acute pulmonary edema" (extreme flash pulmonary edema preceded by
# longstanding hypertension) and the NIV/intubation escalation criteria
# (NIV failure/intolerance, respiratory or cardiac arrest, respiratory
# failure, decreasing consciousness or increasing agitation, persistent
# hypoxemia despite optimal therapy, hemodynamic instability; patients on
# NIV require continuous cardiorespiratory monitoring and frequent
# reassessment). Paraphrased reasoning only — do not quote back verbatim.
# EXPANDED (v4.2) with Tintinalli Chapters 53 (Acute Heart Failure) and 57
# (Systemic Hypertension) definitions, thresholds, and treatment-sequencing
# reasoning. ──
CLINICAL_REFERENCE_HTN_PULM_EDEMA = """
CLINICAL REFERENCE — SEVERE HYPERTENSION & ACUTE PULMONARY EDEMA (apply this
reasoning, do not quote it back verbatim):
- Definitions (do not blur these two together): a HYPERTENSIVE CRISIS is a
  systolic BP >180 mmHg and/or diastolic BP >120 mmHg. A HYPERTENSIVE
  EMERGENCY is a hypertensive crisis WITH evidence of acute end-organ
  damage (brain, heart, aorta, kidneys, or eyes) — e.g. pulmonary edema,
  chest/back pain with unequal arm BPs (possible dissection), altered
  mentation, new neurological deficit, acute renal failure, or papilledema/
  retinal hemorrhage. A hypertensive "urgency" (severe BP elevation WITHOUT
  acute end-organ damage) does not have proven benefit from rapid BP
  lowering, and precipitous drops can themselves be harmful — the usual
  approach is gradual reduction over days, not emergent parenteral therapy.
- Acute (hypertensive) heart failure and pulmonary edema follow a LOWER and
  more patient-specific threshold than the generic 180/120 crisis
  definition — some patients develop pulmonary edema with a systolic BP as
  low as ~140-150 mmHg. Treat significant hypertension WITH signs of
  pulmonary edema/respiratory distress as a hypertensive emergency needing
  frequent BP reassessment and physician notification, even if the absolute
  number is below 180/120, when the clinical picture (severe dyspnea,
  crackles, diaphoresis, hypoxia) supports it.
- Sudden severe respiratory distress with bilateral crackles, an S3 gallop,
  diaphoresis, and severe hypoxia in a patient with longstanding or poorly
  controlled hypertension is a recognised pattern of acute (including
  "flash"/sympathetic-crashing) cardiogenic pulmonary edema. Describe this
  ONLY as a suspected/possible clinical impression tied to the specific
  findings that support it — never as a confirmed diagnosis unless a
  clinician has already explicitly documented that diagnosis in the input.
- Improvement in ONE parameter (e.g. SpO2 normalising after non-invasive
  ventilation) does NOT mean the patient is stable. Persistent tachypnea,
  tachycardia, increased work of breathing, or severely elevated BP after
  an intervention mean the patient remains critically ill and still needs
  close, continuous reassessment.
- TREATMENT-SEQUENCING AWARENESS (for reporting/flagging only — this system
  does not prescribe doses): for hypertensive acute pulmonary edema, the
  evidence-based first-line approach is prompt afterload reduction with
  vasodilators (e.g. nitrates), which can reduce the need for intubation.
  Loop diuretics (e.g. furosemide/Lasix) given ALONE, without a vasodilator,
  in this setting are associated with worse outcomes (increased mortality
  risk and worsened renal function) in the reference literature. If the
  documented treatments include a diuretic but no vasodilator/nitrate for a
  patient with this presentation, flag this explicitly as a gap for the
  treating physician to review — do NOT silently assume the treatment
  approach was optimal, and do NOT instruct a dose or route yourself.
- Oxygen target in this specific picture: keep SpO2 at or above ~95%; do
  not withhold or under-titrate oxygen out of concern for CO2 retention,
  since hypoxemia is the greater immediate risk. Non-invasive ventilation
  (CPAP/BiPAP) is appropriate first-line respiratory support, but requires
  hemodynamic stability, an adequate mask seal, and patient cooperation to
  succeed, plus continuous cardiorespiratory monitoring and frequent
  reassessment for tolerance/effect — a one-time check is not sufficient.
- Plan for escalation to advanced airway management if there is: NIV
  intolerance or failure, worsening hypoxia despite NIV, rising respiratory
  rate or increasing work of breathing, respiratory muscle fatigue,
  decreasing level of consciousness, new hemodynamic instability, or
  persistent hypoxemia despite optimal NIV settings.
- Vasodilator therapy is inappropriate (and can be harmful) if the patient
  has hypoperfusion/hypotension, or has a preload-dependent state such as
  right ventricular infarction, aortic stenosis, hypertrophic obstructive
  cardiomyopathy, or significant volume depletion — flag these as
  contraindications to vasodilator therapy if suggested by the data, rather
  than recommending vasodilators unconditionally.
"""

# ── NEW (v4.2) — grounded in Tintinalli Chapter 57 (Systemic Hypertension).
# Used by A2/A4/A8/SIMPLE_SYNTH alongside CLINICAL_REFERENCE_HTN_PULM_EDEMA
# whenever severe/uncontrolled blood pressure is part of the picture,
# independent of whether pulmonary edema is present. ──
CLINICAL_REFERENCE_HYPERTENSIVE_EMERGENCY = """
CLINICAL REFERENCE — HYPERTENSIVE EMERGENCY END-ORGAN CATEGORIES (apply this
reasoning, do not quote it back verbatim):
- When severe hypertension (crisis-range: systolic >180 and/or diastolic
  >120 mmHg) is present, actively look across the input for evidence of
  ANY of these recognised end-organ patterns rather than only checking one:
  acute aortic dissection (tearing/ripping chest or back pain, unequal
  blood pressure between arms), acute pulmonary edema (shortness of
  breath), acute coronary syndrome/myocardial infarction (chest pain,
  nausea, diaphoresis), acute renal failure (abdominal bruit, rising
  creatinine), severe preeclampsia/eclampsia (headache, visual changes,
  seizures — in a pregnant or peripartum patient), hypertensive retinopathy
  or encephalopathy (visual disturbance, altered mentation, headache,
  vomiting, seizures), intracranial/subarachnoid hemorrhage or acute
  ischemic stroke (new focal neurological deficit), and sympathetic crisis
  from stimulant use or possible pheochromocytoma (anxiety, palpitations,
  tachycardia, diaphoresis). Presence of ANY of these with crisis-range BP
  = hypertensive emergency, not merely "elevated vitals."
- A meaningful minority of true hypertensive emergencies occur in patients
  with NO prior documented history of hypertension — do not downweight the
  possibility of a hypertensive emergency solely because no chronic
  hypertension history is recorded.
- If BP readings differ between the two arms, an interarm difference of
  more than roughly 10-20 mmHg is clinically meaningful (can itself suggest
  aortic dissection, coarctation, or peripheral vascular disease); track and
  report the HIGHER arm reading going forward and prefer upper-arm cuff
  measurement over a wrist device.
- A modest, transient drop in BP (up to roughly 10-12 mmHg systolic/
  diastolic) can occur spontaneously without any treatment — do not treat a
  small unmedicated improvement as proof the crisis has resolved.
- Distinguish hypertensive EMERGENCY (needs prompt, carefully titrated
  parenteral therapy and frequent reassessment) from hypertensive URGENCY
  (severe BP elevation without acute end-organ damage — current evidence
  favors gradual BP reduction over days via resumed/intensified oral
  therapy, NOT rapid parenteral correction, since precipitous drops can
  themselves cause harm such as cerebral or coronary hypoperfusion).
"""

# ── NEW (v4.2) — grounded in Tintinalli Chapter 257 (Head Trauma). Used by
# A2 (vitals/neuro interpretation), A3 (trauma injury classification), A4
# (risk stratification), A7 (escalation-readiness), and A8/SIMPLE_SYNTH
# whenever a head injury or altered mentation with trauma is part of the
# picture. Paraphrased reasoning only — do not quote back verbatim. ──
CLINICAL_REFERENCE_HEAD_TRAUMA = """
CLINICAL REFERENCE — TRAUMATIC BRAIN INJURY (apply this reasoning, do not
quote it back verbatim):
- Classify severity by GCS: severe = 3-8, moderate = 9-13, mild = 14-15.
  "Mild" TBI is a misnomer — a meaningful fraction of these patients have
  significant, sometimes debilitating short- or long-term sequelae, so do
  not let a GCS of 14-15 translate into a reflexively reassuring narrative.
  When paralytics are used for intubation, document the GCS obtained
  BEFORE paralysis as the "best" score — a post-paralytic GCS is not
  interpretable as a neurological assessment.
- A single episode of hypotension (systolic <90 mmHg) or hypoxemia is
  independently associated with a large (roughly 150%) increase in
  mortality after significant TBI — treat even one such episode as
  clinically significant, not a transient blip to be noted and moved past.
  Cerebral perfusion depends on mean arterial pressure (MAP) relative to
  intracranial pressure (ICP); after injury, autoregulation is frequently
  impaired, so even modest drops in blood pressure can meaningfully reduce
  brain perfusion. In the absence of an ICP monitor, a MAP at or above
  roughly 80 mmHg is a reasonable general target to protect cerebral
  perfusion pressure in significant TBI — this is a target to flag for
  reassessment, not a threshold this system enforces.
- Watch for the Cushing reflex (hypertension with bradycardia and
  irregular respirations) as a late sign of critically elevated ICP and
  impending herniation — this is a physiological compensation, not a
  reassuring "improving" BP, and should prompt urgent escalation rather
  than a "stable" or "improving" characterization.
- Pupillary findings can localize the problem: a new unilateral fixed and
  dilated pupil in a deteriorating patient suggests uncal herniation from
  an expanding mass lesion on that side and is a surgical emergency;
  bilateral fixed and dilated pupils suggest globally elevated ICP, severe
  hypoxia, or a drug effect (e.g. atropine) rather than a focal lesion;
  bilateral pinpoint pupils suggest either opioid effect or a brainstem
  (pontine) lesion. Any of these changes from a prior exam is a red flag
  for urgent reassessment and escalation, not routine documentation.
- A drop in GCS of 2 or more points on serial exam should prompt urgent
  re-evaluation regardless of the starting score — GCS is most useful as a
  trend over time (worsening vs. improving), not a single snapshot.
  Decorticate posturing (arm flexion, leg extension) indicates a lesion at
  or above the midbrain; decerebrate posturing (arm extension with wrist/
  finger flexion) indicates a more caudal (lower brainstem) injury and is
  generally a more ominous finding.
- Anticoagulated or antiplatelet-treated patients need a LOWER threshold
  for head imaging and urgent physician notification even after a
  seemingly minor mechanism or a normal initial exam, because
  anticoagulation increases both the likelihood and the expansion rate of
  intracranial hemorrhage — see CLINICAL_REFERENCE_ANTICOAGULATION_REVERSAL.
  Do not let a reassuring GCS alone override this: flag anticoagulant use
  explicitly whenever a head injury is present.
- Avoid recommending prophylactic hyperventilation for a head-injured
  patient — sustained hypocapnia causes cerebral vasoconstriction and can
  worsen ischemia; a reasonable ventilation target (when capnometry is
  available) is a PCO2 in the normal range, not aggressive hyperventilation
  "to bring the pressure down." This is a treatment nuance for the treating
  team to apply, not an instruction this BLS-facing system gives directly.
"""

# ── NEW (v4.2) — grounded in Tintinalli Chapter 258 (Spine Trauma) and the
# general trauma-shock literature. Extends CLINICAL_REFERENCE_A2's existing
# hemorrhage/shock_index guidance with an explicit shock-type differential.
# Used by A2, A4, A6, A8/SIMPLE_SYNTH. ──
CLINICAL_REFERENCE_SHOCK_DIFFERENTIATION = """
CLINICAL REFERENCE — SHOCK TYPE DIFFERENTIATION IN TRAUMA (apply this
reasoning, do not quote it back verbatim):
- In a trauma patient with hypotension, PRESUME hemorrhage as the cause
  until it has been actively excluded — this is true even when a spinal
  cord injury is also present. Neurogenic shock is a distributive shock
  from loss of sympathetic tone below a high (roughly T1-T4 or above)
  spinal cord injury, and it is genuinely uncommon (well under a quarter
  of spinal-cord-injured patients). Do not default to a neurogenic-shock
  explanation for hypotension just because a spinal injury is present —
  reflexively doing so risks missing ongoing hemorrhage.
- Distinguishing features (apply as a pattern, not a rigid rule): neurogenic
  shock classically presents as warm, dry, vasodilated skin with relative
  bradycardia (loss of unopposed sympathetic tone leaves vagal tone
  dominant) and generally well-tolerated hypotension, because peripheral
  oxygen delivery is often preserved. Hemorrhagic shock classically
  presents as cool, pale, clammy skin with tachycardia (though tachycardia
  can be blunted or absent — see CLINICAL_REFERENCE_A2 on elderly/
  beta-blocker patients) and progressively worsening perfusion. Bradycardia
  can ALSO occur with intra-abdominal/intraperitoneal bleeding or with
  prior calcium-channel-blocker or beta-blocker use, so bradycardia alone
  does not confirm a neurogenic mechanism.
- Spinal shock is a DIFFERENT phenomenon from neurogenic shock and the two
  terms are not interchangeable: spinal shock is the temporary loss of
  reflex activity (flaccidity, areflexia, loss of voluntary movement) below
  the level of injury, and it can make an incomplete cord injury look
  falsely complete on exam. A cord injury cannot be reliably characterized
  as "complete" until spinal shock resolves (this can take days, and
  occasionally longer) — avoid stating a final motor/sensory prognosis
  while spinal shock could still be present; note it as provisional
  instead.
- Initial management of presumed neurogenic shock (once hemorrhage is
  reasonably excluded or being actively managed in parallel) is judicious
  IV crystalloid — but flag the risk of volume overload/pulmonary edema
  with overly aggressive fluid administration in this setting, and note
  that vasopressor support may be needed if fluids alone are not
  restoring perfusion; this is a hospital-level treatment decision to flag
  for the physician, not an instruction for a BLS-level responder to act on.
- Practically: for any hypotensive trauma patient, actively look for and
  document a source of blood loss (external hemorrhage, chest, abdomen,
  pelvis, long bones, retroperitoneum) BEFORE attributing hypotension to a
  spinal mechanism, and keep re-examining even if a spinal injury is
  confirmed, since the two causes are not mutually exclusive.
"""

# ── NEW (v4.2) — grounded in Tintinalli Chapter 261 (Pulmonary Trauma) and
# Chapter 262 (Cardiac Trauma). Used by A2 (interpretation/red-flag
# screening), A3 (trauma injury classification), A5/A6 (immediate actions/
# precautions — recognition + escalation, not procedure instructions), A7
# (hospital prep — thoracostomy/pericardiocentesis readiness), and
# A8/SIMPLE_SYNTH. ──
CLINICAL_REFERENCE_CHEST_CARDIAC_TRAUMA = """
CLINICAL REFERENCE — CHEST & CARDIAC TRAUMA RED FLAGS (apply this
reasoning, do not quote it back verbatim):
- Tension pneumothorax is a CLINICAL diagnosis — do not wait for imaging
  confirmation before flagging it as immediately life-threatening. Classic
  findings include respiratory distress, unilateral absent or markedly
  decreased breath sounds, tracheal deviation AWAY from the affected side,
  distended neck veins, and hemodynamic compromise — but in a hypovolemic
  patient the neck veins may not appear distended, so their absence does
  NOT rule this out. Any deteriorating patient with these findings after
  chest trauma needs IMMEDIATE escalation/physician notification; a
  basic-EMT-scope responder's correct action is rapid recognition,
  immediate transport, and urgent notification of the receiving team — not
  performing needle or tube thoracostomy, which is outside BLS scope.
- A large hemothorax and a tension pneumothorax can present similarly
  (respiratory distress, decreased breath sounds, hypotension) but the
  underlying physiology and urgency differ; do not assume one when the
  other is equally consistent with the exam — flag both as differential
  possibilities requiring urgent hospital-level evaluation (chest imaging
  or point-of-care ultrasound) rather than committing to a single label.
  A hemothorax is generally considered "massive" at roughly ≥1500 mL of
  blood, and each side of the chest can hold up to ~40% of a patient's
  circulating blood volume — treat significant unilateral chest trauma
  with hemodynamic compromise as a potential major-hemorrhage source.
- For flail chest / significant pulmonary contusion: avoid recommending
  aggressive/unrestricted IV fluid administration, since fluid overload
  can worsen the underlying lung injury and precipitate respiratory
  failure; note this trade-off for the treating team rather than defaulting
  to "give fluids" as a blanket recommendation.
- Cardiac tamponade is ALSO a clinical (and point-of-care-ultrasound)
  diagnosis, not something to rule out just because Beck's triad (muffled
  heart sounds, hypotension, distended neck veins) is absent — the full
  triad is present in fewer than 1 in 10 confirmed cases and must NEVER be
  used to exclude tamponade. Unexplained persistent tachycardia may be the
  ONLY early clinical sign of significant cardiac injury or tamponade in a
  chest-trauma patient, especially since compensatory mechanisms (raised
  heart rate and systemic vascular resistance) can keep blood pressure in
  a deceptively normal range until a sudden decompensation. A narrowing
  pulse pressure combined with elevated jugular venous pressure is a more
  reproducible (though still not universally sensitive) sign than the
  classic triad — treat this combination as tamponade until proven
  otherwise in a trauma patient with penetrating or blunt precordial/
  thoracoabdominal injury.
- Any penetrating injury to the "cardiac box" (roughly between the nipples
  and from clavicles to costal margins) or a transmediastinal trajectory
  should raise concern for cardiac injury regardless of how well the
  patient currently looks, given how effectively compensatory mechanisms
  can mask early tamponade or hemorrhage.
- Because trauma vital signs can look falsely reassuring due to
  compensation, repeat exams and trends matter more than a single
  snapshot for chest/cardiac trauma — flag any new tachycardia, new
  hypotension, or new respiratory distress as a possible sign of
  deterioration even if the absolute numbers are not yet dramatic.
"""

# ── NEW (v4.2) — grounded in Tintinalli Chapter 278 (Compartment Syndrome).
# Used by A2 (screening), A3 (trauma injury classification), A6
# (precautions/monitoring alerts), A7 (surgical/orthopedic readiness), and
# A8/SIMPLE_SYNTH whenever an extremity injury, crush mechanism, or
# prolonged limb compression is part of the picture. ──
CLINICAL_REFERENCE_COMPARTMENT_SYNDROME = """
CLINICAL REFERENCE — ACUTE COMPARTMENT SYNDROME (apply this reasoning, do
not quote it back verbatim):
- The earliest and most sensitive clinical finding is PAIN OUT OF
  PROPORTION to the apparent injury, and pain that worsens with passive
  stretch of the muscles in the affected compartment — this may be the
  ONLY finding present before irreversible ischemic damage begins, and it
  is often refractory to standard analgesia. Treat this pattern as a
  time-critical red flag rather than something to reassess later.
- CRITICALLY: because intracompartmental pressure rarely exceeds arterial
  pressure until very late, the distal pulse is frequently still PRESENT
  and normal even with an evolving compartment syndrome. A palpable distal
  pulse must NEVER be used to exclude or downgrade concern for compartment
  syndrome — pulselessness is a very late and ominous finding, not a
  required diagnostic feature. Similarly, normal capillary refill does not
  exclude it.
- Numbness, tingling, or altered sensation in the distribution of a nerve
  running through the affected compartment indicates nerve involvement and
  should be treated as an escalating red flag, not a minor finding.
- Time matters: muscle tissue can tolerate ischemia for a few hours but
  damage becomes essentially irreversible beyond roughly 12 hours; nerve
  tissue is even more sensitive and can develop lasting injury after
  roughly 8 hours or less of ischemia. This is a genuine race against time,
  not a "monitor and reassess at length" situation once suspicion is high.
- Risk factors to weigh: fractures (especially tibia/fibula and forearm),
  crush injuries, prolonged limb compression (e.g. prolonged extrication or
  a "found down" patient), tight circumferential dressings or casts, and
  bleeding disorders (including anticoagulated patients) can all precipitate
  compartment syndrome even without a fracture. Younger patients are at
  relatively higher risk than older adults.
- BLS-scope action when suspected: remove constrictive dressings/jewelry
  from the affected limb if easily done, keep the limb at heart level
  (elevation above heart level can further reduce perfusion pressure and
  is not advised once compartment syndrome is suspected), avoid ice packs
  directly compressing the area, and escalate/transport urgently with
  explicit verbal handover of the concern — definitive diagnosis
  (compartment pressure measurement) and treatment (fasciotomy) are
  hospital/surgical-level actions, not something this system instructs a
  field responder to perform.
"""

# ── NEW (v4.2) — grounded in Tintinalli Chapter 255 (Trauma in the
# Elderly). Used by A2, A4, A6, A7, A8/SIMPLE_SYNTH whenever the patient is
# elderly (approximate age suggests this, or explicitly stated) and trauma
# or a shock/hemodynamic assessment is relevant. ──
CLINICAL_REFERENCE_ELDERLY_TRAUMA = """
CLINICAL REFERENCE — TRAUMA/SHOCK ASSESSMENT IN THE ELDERLY (apply this
reasoning, do not quote it back verbatim):
- Do NOT be reassured by "normal" vital signs in an elderly trauma
  patient. A meaningful proportion of geriatric blunt-trauma patients who
  looked hemodynamically "stable" by standard vitals were found on
  invasive/lab work-up to already have significantly reduced cardiac
  output and inadequate oxygen delivery — i.e., they were in occult shock
  despite reassuring numbers. Beta-blocker use (common in this population)
  and an age-related blunting of the physiologic tachycardic response can
  both mask the expected compensatory tachycardia of hemorrhage or shock.
- Because baseline hypertension is very common in the elderly (roughly
  9 in 10 in some series), a blood pressure that looks "normal" by
  standard thresholds may actually represent a significant drop from that
  individual's true baseline — use a HIGHER threshold of suspicion for
  occult hypotension than would apply to a younger patient with the same
  numeric BP.
- If available, base deficit and lactate are more reliable markers of
  occult hypoperfusion than heart rate or blood pressure in this
  population, and they correlate with outcome: even a mild base deficit is
  associated with a meaningfully elevated mortality risk, and this risk
  rises substantially further as the base deficit worsens. Where these
  values are available in the input, weight them heavily in the overall
  risk assessment even if standard vitals look reassuring.
- Elderly patients have a well-documented pattern of prehospital and ED
  UNDERTRIAGE relative to younger patients with similar injuries, in part
  because standard physiologic and mechanism-based triage criteria were
  derived from younger cohorts and perform less reliably in this group.
  Apply a lower threshold for treating an elderly trauma patient as
  higher-acuity than the raw numbers alone would suggest, especially with
  falls (the dominant mechanism in this age group) — a same-level fall in
  an elderly patient can still cause a clinically significant injury and
  should not be automatically triaged as low-acuity.
- If the patient is on an anticoagulant or antiplatelet agent (common in
  this population) and has any head injury, even from a seemingly minor
  fall, apply a lower threshold for urgent imaging and physician
  notification for possible reversal — see
  CLINICAL_REFERENCE_ANTICOAGULATION_REVERSAL and
  CLINICAL_REFERENCE_HEAD_TRAUMA. Do not let an initially normal
  neurological exam fully reassure in this context, since anticoagulated
  elderly patients can have delayed-onset or slowly expanding intracranial
  hemorrhage.
- Cervical spine injury patterns can differ in the elderly (e.g. upper
  cervical/odontoid fractures are disproportionately common, and
  hyperextension mechanisms can cause a central cord syndrome with
  disproportionate upper-extremity weakness) — do not assume a "low
  mechanism" fall excludes a clinically significant cervical spine injury
  in this population.
"""

# ── NEW (v4.2) — grounded in Tintinalli Chapter 239 (Thrombotics and
# Antithrombotics). Informational/flagging framing ONLY — this system never
# instructs a dose, route, or specific reversal agent; it exists so A2/A4/
# A6/A7/A8 can flag the NEED for urgent physician-level reversal decisions
# rather than silently treating an anticoagulated bleeding/head-injury
# patient the same as a non-anticoagulated one. ──
CLINICAL_REFERENCE_ANTICOAGULATION_REVERSAL = """
CLINICAL REFERENCE — ANTICOAGULATION AND MAJOR BLEEDING/HEAD INJURY
(informational framing only — apply this reasoning to decide WHEN to flag
urgency for physician-level review; never generate a dose, route, or
specific product recommendation yourself):
- Any patient on a documented anticoagulant (e.g. warfarin, a direct oral
  anticoagulant/DOAC such as dabigatran, rivaroxaban, apixaban, edoxaban,
  or a parenteral agent such as heparin/LMWH) who has a head injury,
  active major bleeding, or a mechanism concerning for internal bleeding
  needs URGENT physician notification specifically because reversal — if
  indicated — is time-critical and represents a real, distinct clinical
  decision point, not just "more monitoring." Flag this explicitly rather
  than folding it into a generic "monitor for bleeding" statement.
- For a warfarin patient with life-threatening bleeding or intracranial
  hemorrhage, rapid coagulation-factor repletion (e.g. four-factor
  prothrombin complex concentrate) plus vitamin K is the class of approach
  used at hospital level, in contrast to a stable/minor-bleeding patient
  where cautious observation and slower correction may be preferred —
  the point for THIS system is that the underlying degree of bleeding risk
  is meaningfully different depending on how urgent the situation is, so
  the urgency of physician notification should scale accordingly.
- For DOAC patients, note that routine coagulation tests are often not
  reliable for judging the degree of anticoagulation, and that specific
  reversal agents exist (e.g. a targeted reversal agent for dabigatran, and
  a targeted reversal agent for factor Xa inhibitors such as rivaroxaban/
  apixaban) but may not be immediately available at every facility — this
  is a reason to notify the receiving/treating physician EARLY (ideally
  during transport or immediately on identification) rather than waiting
  until arrival, so the team has time to prepare.
- Discontinuing the anticoagulant and maintaining adequate urine output
  (for renally-cleared agents) are reasonable general-purpose facts to
  note, but do not translate into a specific hold/resume instruction from
  this system — flag "anticoagulated, reversal decision needed" and let
  the treating physician decide the specifics.
- If an anticoagulant mention is ambiguous in the input (e.g. unclear
  whether it reflects a home medication, a recently discontinued
  medication, or a medication given this encounter), say so explicitly as
  a data gap rather than guessing — the distinction changes clinical
  urgency and should be confirmed with the patient, family, or prior
  records.
"""
# ── NEW — grounded in the Surviving Sepsis Campaign hour-1 bundle and
# Tintinalli's Emergency Medicine, Sepsis and Septic Shock chapter. Used by
# A2 (shock/vitals interpretation), A4 (risk stratification — sepsis
# screen), A5/A7 (bundle-element readiness), and A8/SIMPLE_SYNTH. This is
# the counterpart to CLINICAL_REFERENCE_SHOCK_DIFFERENTIATION for the
# non-trauma distributive-shock picture, and it is intentionally the
# FIRST thing checked when hypotension/shock appears WITHOUT bleeding or
# injury evidence. ──
CLINICAL_REFERENCE_SEPSIS = """
CLINICAL REFERENCE — SEPSIS AND SEPTIC SHOCK (apply this reasoning, do not
quote it back verbatim; this system does not select a specific antibiotic,
dose, or vasopressor itself):
- Actively consider a septic/infectious source for hypotension or shock
  whenever there is NO bleeding, injury, or trauma mechanism to explain it,
  and there IS a plausible infection source: fever or hypothermia, cough,
  purulent/productive sputum, focal crackles or decreased breath sounds
  consistent with pneumonia, dysuria/flank pain/foul urine, abdominal pain
  with peritonism, cellulitis/wound infection/erythema, recent surgery or
  indwelling catheter/line, or a known immunocompromised state. Do NOT
  default to a hemorrhagic or cardiac-trauma differential for a patient
  whose presentation actually matches an infectious source with no
  documented mechanism of injury.
- Septic shock classically presents with warm, flushed skin early
  (vasodilated, distributive) that can progress to cool/mottled skin as
  shock worsens, tachycardia, tachypnea, and hypotension refractory to
  modest fluid boluses — do not assume shock must be "cool and clammy"
  to be septic; the early distributive phase often looks warm.
- Quick bedside screen (qSOFA-style, informational only — not diagnostic on
  its own): respiratory rate >=22/min, altered mentation, systolic BP
  <=100 mmHg. Two or more of these in a patient with suspected infection
  should raise concern for sepsis/septic shock and prompt urgent escalation
  and reassessment, not a stable/routine framing.
- HOUR-1 SEPSIS BUNDLE (informational — for flagging what the treating team
  should prioritize, never as a dosing/product instruction from this
  system): measure lactate (repeat if initial lactate >2 mmol/L); obtain
  blood cultures BEFORE giving antibiotics, but do not delay antibiotics
  waiting for cultures if cultures cannot be drawn quickly; administer
  broad-spectrum IV antibiotics as early as possible, ideally within 1 hour
  of recognition; begin rapid administration of 30 mL/kg IV crystalloid for
  hypotension or lactate >=4 mmol/L; apply vasopressors (norepinephrine is
  the typical first-line agent in hospital protocols) if the patient is
  hypotensive during or after fluid resuscitation, to maintain a target MAP
  of roughly 65 mmHg. This system does not choose the antibiotic, fluid
  volume, or vasopressor dose — it flags the NEED for these bundle elements
  to be actioned urgently.
- Do not delay first-line antibiotics to complete imaging (e.g. CT chest)
  in a patient who looks septic — stabilization (fluids, oxygen, source
  control readiness) and antibiotic administration take priority over
  advanced imaging, which should follow initial stabilization, not precede
  it, unless imaging is itself needed to identify an urgent source-control
  target (e.g. suspected abscess).
- Because septic shock is a diagnosis of exclusion relative to hemorrhagic/
  cardiogenic/obstructive causes only when supporting evidence exists for
  it, weigh the ACTUAL findings: a patient with a fever/cough/crackles and
  hypotension with no bleeding or trauma history should be worked up and
  treated as septic shock until proven otherwise — not labeled hemorrhagic
  shock, tamponade, or tension pneumothorax without supporting chest-trauma
  findings.
- Relevant labs/investigations to flag as needed (not to interpret
  yourself): lactate and repeat lactate, blood cultures x2 before
  antibiotics, CBC with differential, CRP and/or procalcitonin if
  available, renal function and electrolytes, coagulation profile (DIC
  screen if clinically indicated), arterial blood gas, sputum culture and
  chest imaging if a respiratory source is suspected, urinalysis/urine
  culture if a urinary source is suspected, and continuous urine output
  monitoring as a marker of end-organ perfusion.
"""
# ── NEW (v4.2) — grounded in Tintinalli Chapter 287 (Acute Agitation).
# Used by A5/A6/A8/SIMPLE_SYNTH when the case involves acute agitation,
# combativeness, or a behavioral/psychiatric emergency component,
# regardless of whether the overall case is trauma or medical. ──
CLINICAL_REFERENCE_ACUTE_AGITATION = """
CLINICAL REFERENCE — ACUTE AGITATION (apply this reasoning, do not quote it
back verbatim; this system does not prescribe specific medications or
doses):
- Safety comes first, for both the patient and the responding team. If the
  patient is aggressive or violent, the correct BLS-scope action is to
  maintain a safe distance, avoid escalating the confrontation, and involve
  security/law enforcement resources rather than a solo physical
  intervention; do not recommend restraint or medication as a first-line
  field action.
- Attempt verbal de-escalation FIRST, in essentially all agitated patients
  who are not in immediate danger of harming themselves or others — verbal
  de-escalation is the recommended first step in the standard approach to
  agitation, not an optional nicety before "real" treatment.
- Actively look for and flag an underlying medical cause of the agitation
  (hypoxia, hypoglycemia, head injury, intoxication/withdrawal, sepsis,
  postictal state, etc.) rather than assuming a purely psychiatric or
  behavioral cause — treating a reversible medical driver is a core part
  of managing agitation safely, and mislabeling a medical cause as "purely
  behavioral" can delay a life-threatening diagnosis.
- Physical restraints should be used sparingly, only to prevent harm to
  the patient or staff, for the shortest time necessary, and are not a
  substitute for de-escalation or treating the underlying cause — flag
  restraint use as a safety measure requiring close monitoring (airway,
  breathing, circulation, and position) rather than a routine or
  "resolved" state.
- If agitation escalates despite de-escalation, note this as needing
  physician-level medication decision-making (this system does not select
  or dose the medication) and continued close monitoring — including for
  excited delirium, a syndrome in which patients are at meaningfully
  elevated risk of sudden deterioration or death and need urgent
  medical evaluation, not just behavioral management.
"""


def _role_scope_instruction(state: "EVISState", agent_label: str) -> str:
    """
    NEW (v4.1) — replaces the previously hardcoded "STRICTLY for an
    AMBULANCE DRIVER / BASIC EMT" instruction. That instruction actively
    told the model to strip out hospital-level care (BiPAP, IV push
    medications, cardiac monitoring) that a doctor had already documented,
    which is how a real case lost its BiPAP/Lasix from the report. Now
    gated on care_setting, which A0 classifies from the actual data.
    """
    if state.get("care_setting") == "ed_or_inpatient":
        return (
            f"CARE SETTING: This patient is already receiving ED/inpatient-level care "
            f"(per A0 router). You are advising the team ALREADY caring for this patient — "
            f"not a basic EMT. Advanced interventions already documented (NIV/BiPAP, IV "
            f"medications, cardiac monitoring, etc.) are FACTS to acknowledge and build on, "
            f"never to strip out or hide. For {agent_label}, recommend reassessment, "
            f"titration, and escalation-readiness for what is already running, plus any "
            f"further hospital-level action clearly supported by the data. Do not re-suggest "
            f"a treatment already given, and do not restrict yourself to BLS-only actions."
        )
    return (
        f"ROLE RULES for {agent_label}: instructions are STRICTLY for an AMBULANCE DRIVER or "
        f"BASIC EMT (NON-ADVANCED). DO NOT suggest intubation, cricothyrotomy, IV access, "
        f"injections, needle/tube thoracostomy, pericardiocentesis, or surgery as NEW actions. "
        f"DO NOT suggest imaging (CT, X-ray) or hospital procedures as NEW actions. ONLY ALLOW "
        f"as new suggestions: basic airway (head-tilt-chin-lift OR jaw thrust), oxygen "
        f"administration, bleeding control, spinal immobilization (only if trauma), removing "
        f"constrictive dressings/jewelry if compartment syndrome is suspected, safety-first "
        f"de-escalation for agitated patients, monitoring, safe and fast transport. If advanced "
        f"care is needed (including a suspected tension pneumothorax, cardiac tamponade, "
        f"compartment syndrome, or an anticoagulated patient with major bleeding/head injury), "
        f"say 'Inform paramedic/doctor immediately' rather than instructing the advanced "
        f"procedure itself. NOTE: this role scope restriction applies ONLY to NEW recommended "
        f"actions — it never applies to reporting treatments already documented as performed, "
        f"which must always be listed regardless of scope (see TREATMENTS_ALREADY_PERFORMED_RULE)."
    )


# ── NEW (v4.1) — shared guardrail constants spliced into A2/A4/A5/A8/SIMPLE_SYNTH ──

NO_UNSUPPORTED_RISK_INFERENCE_RULE = """
CRITICAL — NEVER INFER A RISK FACTOR, DIAGNOSIS, OR PATIENT ATTRIBUTE THAT
ISN'T ACTUALLY IN THE DATA:
Do not assume the patient is elderly unless an approximate age is
explicitly stated in the source text or extracted entities. Do not assume
anticoagulant/antiplatelet use unless a specific medication or class is
named in the source text. Do not assume hemorrhage, internal bleeding, or
hemorrhagic shock unless the source text mentions bleeding, an injury
mechanism, or a wound. If all extracted vitals are within normal limits
(e.g. HR 60-100, RR 12-20, SpO2 ≥95%, BP roughly 90-140/60-90) and nothing
in the source text describes a symptom, mechanism, or history supporting a
life threat, then overall_risk_level must be Low/Moderate (not High or
Immediately_Life_Threatening), suspected_diagnoses must be empty, and
special_risk_flags must be empty. A clinical reference block being relevant
in general does NOT mean its associated risk pattern applies to THIS
patient — only apply a pattern from a reference block if the specific
findings that pattern requires are actually present in the source data.
When in doubt, state a data gap in critical_gaps_in_data rather than
inventing a finding to fill it.
"""

STABILITY_LABELING_RULE = """
CRITICAL — DO NOT MISLABEL PATIENT STATUS AS "STABLE":
Only describe a patient as "Stable" if the vitals and clinical picture are
actually within/near-normal ranges AND no ongoing organ-supportive
intervention (NIV/CPAP/BiPAP, oxygen beyond minimal supplementation,
vasoactive drugs, etc.) is required to keep them that way.
If a parameter improved only BECAUSE of an active ongoing intervention
(e.g. SpO2 normalised because of BiPAP), or other vitals remain deranged
(tachypnea, tachycardia, severe hypertension/hypotension, increased work of
breathing), use language such as "improved after intervention but still
critically ill / requires close monitoring" — never plain "Stable". Always
state which parameters improved, which remain abnormal, and why ongoing
monitoring is still required.
"""

DIAGNOSTIC_HEDGING_RULE = """
CRITICAL — NEVER PRESENT A SUSPECTED CONDITION AS A CONFIRMED DIAGNOSIS:
You support pre-hospital/ED decision-making; you do not issue a diagnosis.
Any diagnostic label not explicitly documented by a clinician in the input
timeline MUST be phrased as "suspected" / "possible" (e.g. "suspected acute
cardiogenic pulmonary edema", "possible acute decompensated heart failure")
and must be explicitly linked to the supporting findings it is based on.
Never state a diagnosis as confirmed unless the input timeline explicitly
says a clinician has already diagnosed it.
"""

EVIDENCE_TRACEABILITY_RULE = """
CRITICAL — EVERY STATEMENT MUST BE TRACEABLE TO THE INPUT:
Do not add any diagnosis, medication, investigation, or intervention that is
not directly supported by the clinical input timeline. Keep three
categories distinct even where the JSON schema doesn't name them
explicitly:
  1. OBSERVED FINDINGS — stated directly in the input (vitals, exam
     findings, treatments already given).
  2. CLINICAL IMPRESSION — your interpretation/suspected diagnosis, always
     hedged per the diagnostic-hedging rule.
  3. RECOMMENDED ACTIONS — next steps, grounded in #1 and #2 only.
If a data point needed for full confidence is missing or ambiguous, say so
explicitly (critical_gaps_in_data / limiting_factors) so the treating
clinician can be asked to confirm it, rather than guessing or inventing it.
"""

TREATMENTS_ALREADY_PERFORMED_RULE = """
CRITICAL — NEVER OMIT OR RE-SUGGEST TREATMENTS/INVESTIGATIONS ALREADY DOCUMENTED:
This includes investigations (ECG, X-ray, ultrasound/FAST, blood tests) as well
as treatments — an already-performed ECG must never be re-suggested as a new
action; reference its result/impression instead, and only suggest a REPEAT if
a new clinical change genuinely warrants it.
The input and/or the "INTERVENTIONS/TREATMENTS ALREADY PERFORMED THIS
ENCOUNTER" block may state that oxygen, NIV (CPAP/BiPAP), IV medications
(e.g. diuretics, nitrates), cardiac monitoring, or other treatments have
ALREADY been started or given — regardless of whether they are "basic EMT
scope" or advanced hospital-level care. These are FACTS TO REPORT, not
suggestions to filter out. You MUST:
  1. List every already-performed treatment/intervention explicitly, with
     the parameter it targets and the effect observed if stated (e.g.
     "SpO2 improved from 67% to 97% after BiPAP").
  2. Build every subsequent recommendation around continuing, monitoring,
     or reassessing these interventions — never re-suggest something
     already done, and never silently drop it from the report.
  3. Never contradict or hide a documented advanced intervention because it
     falls outside a role-scope restriction. Reporting what has already
     been done is always in scope, for any role.
  4. If a diuretic (e.g. furosemide/Lasix) was given WITHOUT a documented
     vasodilator/nitrate in a patient presenting with hypertensive acute
     pulmonary edema, explicitly flag this combination as a treatment-
     sequencing gap for the treating physician to review (see
     CLINICAL_REFERENCE_HTN_PULM_EDEMA) — do not silently omit the
     observation, and do not instruct a dose or route yourself.
"""

# ── NEW (v4.2) — shared guardrail reminding every agent to flag
# anticoagulation whenever it is relevant, instead of treating it as an
# incidental detail. Spliced alongside CLINICAL_REFERENCE_ANTICOAGULATION_
# REVERSAL wherever that reference block is used. ──
ANTICOAGULATION_FLAGGING_RULE = """
CRITICAL — ALWAYS SURFACE ANTICOAGULANT/ANTIPLATELET USE WHEN PRESENT:
If the input (including any "ANTICOAGULANT/ANTIPLATELET MENTIONS DETECTED"
block) indicates the patient is on an anticoagulant or antiplatelet agent,
and there is a head injury, major bleeding, or a mechanism/presentation
concerning for internal bleeding, explicitly surface this combination as a
distinct risk factor requiring urgent physician notification — do not let
it get absorbed into a generic "monitor for bleeding" line. Never invent
a specific agent, dose, or reversal product yourself; flag the NEED for a
physician-level reversal decision instead (see
CLINICAL_REFERENCE_ANTICOAGULATION_REVERSAL). If it is unclear whether the
anticoagulant mention reflects current use, past use, or a treatment given
this encounter, say so explicitly as a data gap.
"""


class BaseAgent:

    def __init__(self, llm):
        self.llm = llm

    async def _invoke(self, system: str, user: str) -> Dict:
        response = await self.llm.ainvoke([
            SystemMessage(content=system),
            HumanMessage(content=user),
        ])
        return parse_llm_json(response.content)

    def _elapsed(self, start: float) -> float:
        return round((datetime.now().timestamp() - start) * 1000, 1)


# ============================================================
# A0 · CASE ROUTER AGENT  (NEW — runs first, before A1)
# ============================================================

class CaseRouterAgent(BaseAgent):
    agent_id = "A0"

    async def run(self, state: EVISState) -> EVISState:
        logger.info(f"{self.agent_id} · CaseRouterAgent — START")
        t0 = datetime.now().timestamp()

        image_entries     = state.get("image_entries") or []
        clinical_actions  = state.get("clinical_actions") or []
        treatments        = state.get("treatments_performed") or []

        system = (
            "You are a triage classification assistant for an emergency medical AI pipeline. "
            "Your ONLY job is to read the clinical timeline and decide which downstream "
            "analysis modules are relevant, and what level of care is already in progress. "
            "You do NOT diagnose or treat. "
            "Be conservative: if trauma is even plausibly implied (fall, RTA, assault, blunt/penetrating "
            "mechanism, visible wound, fracture, bleeding from injury), mark is_trauma=true. "
            "If the presentation is purely medical (breathing difficulty, chest pain, seizure, "
            "fever, altered mental status with NO injury mechanism, cardiac symptoms, poisoning, "
            "allergic reaction, obstetric emergency) mark is_trauma=false. "
            "Also classify care_setting: 'prehospital_ems' if the data describes an ambulance/"
            "field encounter with only BLS-level actions available, or 'ed_or_inpatient' if the "
            "data describes hospital/ED-level care already in progress (e.g. a doctor voice note, "
            "cardiac monitor connected, NIV/BiPAP running, IV medications given, lab/monitor "
            "values present). This determines whether downstream agents may reference/continue "
            "advanced interventions instead of restricting everything to BLS scope. "
            "Always respond with valid JSON only."
        )

        prompt = f"""
Classify this emergency case from the clinical timeline below.

CLINICAL TIMELINE:
\"\"\"{state["conversation"]}\"\"\"

IMAGE-MONITOR ENTRIES AVAILABLE: {len(image_entries)}
PRIOR CLINICAL ACTIONS RECORDED: {len(clinical_actions)}
TREATMENTS/INTERVENTIONS DETECTED THIS ENCOUNTER: {len(treatments)}
TOTAL TEXT ENTRIES IN TIMELINE: {state.get("entry_count", "unknown")}

Decide:
1. is_trauma — true if any mechanism of injury (fall, RTA, assault, blunt/penetrating
   trauma, burn, visible wound/fracture/bleeding from an injury) is stated or implied.
   false for purely medical presentations (breathing difficulty, chest pain, seizure,
   syncope, poisoning, allergic reaction, fever, stroke-like symptoms, obstetric emergency)
   with no injury mechanism.
2. case_type — short label: "trauma" | "cardiorespiratory" | "neurological" |
   "toxicology" | "obstetric" | "general_medical" | "unknown"
3. has_meaningful_image_vitals — true only if image entries actually contain
   numeric vitals worth cross-checking against voice-reported vitals.
4. complexity — "simple" (single short entry, nothing to reconcile, no prior
   clinical actions, stable-sounding) | "moderate" | "complex" (multiple entries,
   deteriorating, conflicting data, or prior actions to reconcile).
5. care_setting — "prehospital_ems" | "ed_or_inpatient" | "unknown", based on
   whether the documented actions and monitoring equipment described imply
   field/BLS-level care or hospital/ED-level care already under way (e.g. a
   doctor voice note describing BiPAP, IV medications, or cardiac monitoring
   strongly implies "ed_or_inpatient").

Return ONLY valid JSON:
{{
  "is_trauma": true,
  "case_type": "...",
  "has_meaningful_image_vitals": true,
  "complexity": "simple|moderate|complex",
  "care_setting": "prehospital_ems|ed_or_inpatient|unknown",
  "rationale": "one sentence explaining the decision"
}}
"""
        parsed = await self._invoke(system, prompt)

        is_trauma      = bool(parsed.get("is_trauma", True))  # default to full pipeline if parse fails — safest fallback
        case_type      = parsed.get("case_type", "unknown")
        has_img_vitals = bool(parsed.get("has_meaningful_image_vitals", len(image_entries) > 0))
        complexity     = parsed.get("complexity", "moderate")
        care_setting   = parsed.get("care_setting", "unknown")
        rationale      = parsed.get("rationale", "")

        # NEW — deterministic override from patient.accidentDetails.accidentType.
        # FIX: previously A0 classified purely from whatever voice/doctor/image
        # text happened to already exist at generation time. If an early
        # doctor voice note dictated vitals ("SpO2 99%, HR 60...") before a
        # later EMT entry confirmed "Road traffic accident, manage bleeding",
        # A0 could run BEFORE that confirming entry existed (or simply never
        # see it if it wasn't included in this pass) and wrongly classify a
        # genuine trauma case as is_trauma=false/cardiorespiratory. The
        # registered incident type is ground truth and does not depend on
        # dictation timing or wording — it now overrides the LLM's own
        # classification when it indicates a trauma mechanism.
        registered_incident_type = state.get("registered_incident_type")
        if registered_incident_type:
            rit_lower = str(registered_incident_type).strip().lower()
            if any(kw in rit_lower for kw in _REGISTRATION_TRAUMA_KEYWORDS):
                if not is_trauma:
                    logger.warning(
                        f"{self.agent_id} · OVERRIDE: LLM classified is_trauma=False "
                        f"(case_type={case_type}) but registration incident_type="
                        f"{registered_incident_type!r} indicates trauma. Forcing "
                        f"is_trauma=True, case_type='trauma'."
                    )
                is_trauma = True
                case_type = "trauma"
                rationale = (
                    f"Registration incident_type={registered_incident_type!r} confirms "
                    f"a trauma mechanism; used as ground truth ahead of the LLM's own "
                    f"classification from voice/doctor dictation text. "
                    f"(LLM's own read: {rationale})"
                )

        state["is_trauma"]         = is_trauma
        state["case_type"]         = case_type
        state["has_image_vitals"]  = has_img_vitals
        state["complexity"]        = complexity
        state["care_setting"]      = care_setting
        state["run_a3"]            = is_trauma
        state["run_a9"]            = has_img_vitals and len(image_entries) > 0
        # Only take the SIMPLE_CASE shortcut for genuinely trivial cases:
        # single-ish entry, nothing to reconcile, no prior clinical actions.
        state["run_full_pipeline"] = not (
            complexity == "simple"
            and not clinical_actions
            and (state.get("entry_count") or 1) <= 2
        )
        state["routing_rationale"] = rationale

        elapsed = self._elapsed(t0)
        state["agent_timings"][self.agent_id] = elapsed
        logger.info(
            f"{self.agent_id} · ROUTING DECISION → is_trauma={is_trauma} case_type={case_type} "
            f"care_setting={care_setting} run_a3={state['run_a3']} run_a9={state['run_a9']} "
            f"full_pipeline={state['run_full_pipeline']} ({elapsed}ms) | {rationale}"
        )
        return state


# ============================================================
# A1 · MEDICAL ENTITY EXTRACTION AGENT
# ============================================================

class MedicalEntityAgent(BaseAgent):
    agent_id = "A1"

    async def run(self, state: EVISState) -> EVISState:
        logger.info(f"{self.agent_id} · MedicalEntityAgent — START")
        t0 = datetime.now().timestamp()

        system = (
            "You are an emergency medical NLP specialist. You extract ALL medical entities "
            "from a combined clinical input timeline that may include EMT voice dictations, "
            "doctor voice notes, and image-extracted clinical data. "
            "CRITICAL AUTHORITY RULE: The CURRENT PATIENT STATUS block at the end of the timeline "
            "is the most recent and most authoritative assessment. "
            "If the latest entry is a DOCTOR VOICE NOTE, it overrides all earlier EMT observations. "
            "For consciousness_level, overall condition, and stability — you MUST use the CURRENT STATUS block. "
            "Do NOT report the patient as unconscious if the doctor note says they are conscious. "
            "Extract entities from ALL entries for historical context, but current state = CURRENT STATUS block. "
            "Do NOT invent data. All timestamps in output must be IST (Asia/Kolkata). "
            "CRITICAL: Do NOT restrict pre_hospital_interventions to basic/EMT-level actions — capture "
            "EVERY treatment or intervention stated in the input, including advanced/hospital-level ones "
            "(e.g. NIV/BiPAP, IV push medications, cardiac monitoring), each with applied: true and the "
            "observed effect if stated. Omitting a documented treatment is a critical extraction failure. "
            "Also extract any mention of anticoagulant/antiplatelet medications (current, home, or given "
            "this encounter) into known_medical_history.current_medications, and note in evidence_text "
            "whether the timeline suggests it is a home medication or something administered this visit. "
            "Always respond with valid JSON."
        )

        clinical_ctx    = _clinical_context_block(state)
        treatments_ctx  = _treatments_performed_block(state)

        logger.info(f"{self.agent_id} · 📥 FULL INPUT CONVERSATION BEING PASSED TO A1:")
        logger.info("=" * 80)
        logger.info(state.get("conversation", ""))
        logger.info("=" * 80)

        prompt = f"""
Extract all medical entities from this patient's clinical input timeline.
The timeline may contain EMT voice dictations, doctor voice notes, and image-extracted data.
Extract ONLY what is stated or strongly implied. Mark absent data as null.
All timestamps must be expressed in IST (Asia/Kolkata, UTC+5:30).

CLINICAL INPUT TIMELINE:
\"\"\"{state["conversation"]}\"\"\"

LATEST TIMESTAMP (IST): {state["timestamp"]}

PRIOR CLINICAL ACTIONS (for this patient):
{clinical_ctx}

TREATMENTS/INTERVENTIONS ALREADY PERFORMED THIS ENCOUNTER:
{treatments_ctx}
{TREATMENTS_ALREADY_PERFORMED_RULE}

══════════════════════════════════════════════════════════
TASK — Full Medical Entity Extraction (Across All Sources)
══════════════════════════════════════════════════════════

For each entity, note the exact phrase and which entry it came from (evidence_text).
When approved actions are listed above, note them under pre_hospital_interventions
as already completed (applied: true).

Return ONLY valid JSON:
{{
  "patient_demographics": {{
    "approximate_age": null,
    "gender": null,
    "identity_known": false,
    "number_of_patients": 1,
    "evidence_text": "..."
  }},
  "mechanism_of_injury": {{
    "type": "road_traffic_accident|fall|assault|burn|other|unknown|none_medical_presentation",
    "description": "...",
    "impact_severity": "low|moderate|high|unknown|not_applicable",
    "evidence_text": "..."
  }},
  "consciousness_level": {{
    "status": "conscious|unconscious|confused|semi_conscious|unknown",
    "responsiveness": "responding_to_voice|responding_to_pain|not_responding|unknown",
    "evidence_text": "..."
  }},
  "airway_status": {{
    "patent": null,
    "maintained": null,
    "intervention_applied": null,
    "evidence_text": "..."
  }},
  "breathing_status": {{
    "present": null,
    "quality": "normal|shallow|labored|absent|unknown",
    "rate_bpm": null,
    "evidence_text": "..."
  }},
  "circulation": {{
    "pulse_present": null,
    "pulse_rate_bpm": null,
    "pulse_quality": "strong|weak|thready|absent|unknown",
    "blood_pressure_systolic": null,
    "blood_pressure_diastolic": null,
    "spo2_percent": null,
    "evidence_text": "..."
  }},
  "visible_injuries": [
    {{
      "region": "head|neck|chest|abdomen|spine|pelvis|upper_limb|lower_limb|face|multiple",
      "type": "laceration|fracture|blunt_trauma|penetrating|burn|abrasion|other",
      "severity": "minor|moderate|severe|critical",
      "bleeding": "none|controlled|active_minor|active_major|suspected_internal",
      "description": "...",
      "evidence_text": "..."
    }}
  ],
  "neurological": {{
    "seizures": null,
    "vomiting": null,
    "pupil_response": null,
    "gcs_estimated": null,
    "evidence_text": "..."
  }},
  "pre_hospital_interventions": [
    {{
      "intervention": "...",
      "type": "airway|breathing|circulation|immobilization|medication|IV_access|ventilatory_support|monitoring|other",
      "applied": true,
      "time_applied_ist": null,
      "source": "approved_clinical_action|voice_dictation|doctor_note|image_extracted",
      "response_observed": "e.g. SpO2 improved from 67% to 97%",
      "evidence_text": "..."
    }}
  ],
  "known_medical_history": {{
    "diabetes": null,
    "cardiac": null,
    "hypertension": null,
    "allergies": null,
    "current_medications": [],
    "anticoagulant_or_antiplatelet_use": {{
      "present": null,
      "agent_if_named": null,
      "timing_context": "home_medication|given_this_encounter|unclear",
      "evidence_text": "..."
    }},
    "other": [],
    "evidence_text": "..."
  }},
  "timeline_from_voice": {{
    "accident_time_ist": null,
    "dispatch_time_ist": null,
    "arrival_at_scene_time_ist": null,
    "time_since_unconscious_minutes": null,
    "transport_started_time_ist": null,
    "eta_to_hospital_minutes": null,
    "evidence_text": "..."
  }},
  "pain_assessment": {{
    "pain_reported": null,
    "pain_location": null,
    "pain_level_estimated": null,
    "pain_out_of_proportion_to_injury": "true if pain seems disproportionate to visible injury — a possible early compartment syndrome sign, see clinical reference",
    "evidence_text": "..."
  }},
  "data_sources_used": {{
    "emt_voice_dictations": 0,
    "doctor_voice_notes": 0,
    "image_extracted_records": 0
  }},
  "already_completed_actions_noted": ["..."],
  "not_approved_actions_noted": ["..."],
  "investigations_or_actions_performed_this_encounter": [
    "List EVERY investigation, test, imaging, or discrete action explicitly "
    "stated as already done THIS encounter — e.g. 'ECG taken, sinus rhythm', "
    "'blood sugar checked', 'FAST scan done, negative'. This is a safety-net "
    "field distinct from pre_hospital_interventions: include ANYTHING "
    "explicitly stated as done, even if you are unsure whether it counts as "
    "a formal intervention. Never omit something because it seems minor — "
    "omitting a documented action is a critical extraction failure."
  ],
  "extraction_confidence": "High|Moderate|Low",
  "data_completeness_percent": 0,
  "critical_gaps_in_data": ["..."]
}}
"""
        state["medical_entities"] = await self._invoke(system, prompt)
        # NEW — surface A1's LLM-extracted safety-net field into top-level
        # state so every downstream prompt block can see it alongside the
        # regex-based treatments_performed list.
        state["investigations_or_actions_performed_llm"] = (
            state["medical_entities"].get("investigations_or_actions_performed_this_encounter") or []
        )
        logger.info(f"{self.agent_id} · 📤 OUTPUT (Medical Entities):")
        logger.info(json.dumps(state["medical_entities"], indent=2, default=str))
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · MedicalEntityAgent — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A2 · VITAL SIGNS & CONSCIOUSNESS ASSESSMENT AGENT
# ============================================================

class VitalsAgent(BaseAgent):
    agent_id = "A2"

    async def run(self, state: EVISState) -> EVISState:
        logger.info(f"{self.agent_id} · VitalsAgent — START")
        t0 = datetime.now().timestamp()

        system = (
            "You are a senior emergency physician interpreting pre-hospital/ED vital signs. "
            "You classify physiological derangement severity and identify life threats. "
            "Interpret vitals in context — this may be a trauma or a purely medical "
            "(cardiac/respiratory/neuro/toxicology) presentation; do not assume trauma "
            "unless the data supports it. "
            "Take into account prior approved clinical actions AND treatments already "
            "performed this encounter when assessing current status — a normalised parameter "
            "that depends on an ongoing intervention (e.g. SpO2 held up by BiPAP) is NOT the "
            "same as a normal parameter. "
            "Screen explicitly for the chest/cardiac trauma red flags, compartment syndrome "
            "signs, and head-injury deterioration patterns described in the clinical reference "
            "below whenever the presentation could plausibly involve them — do not wait for a "
            "trauma classification to already exist before screening for these. "
            "If the patient's approximate age or history suggests they are elderly, or if any "
            "anticoagulant/antiplatelet mention is present, apply the corresponding clinical "
            "reference reasoning rather than treating vitals at face value. "
            "All timestamps in output must be IST (Asia/Kolkata). "
            "Always respond with valid JSON."
        )

        clinical_ctx   = _clinical_context_block(state)
        treatments_ctx = _treatments_performed_block(state)

        logger.info(f"{self.agent_id} · 📥 INPUT PASSING TO A2:")
        logger.info("A1 Medical Entities:")
        logger.info(json.dumps(state.get("medical_entities", {}), indent=2, default=str))
        logger.info("Full Conversation:")
        logger.info(state.get("conversation", ""))

        prompt = f"""
Interpret the extracted medical entities and vital signs in emergency clinical context.

EXTRACTED ENTITIES (A1 output):
{json.dumps(state["medical_entities"], indent=2, default=str)}

FULL CLINICAL TIMELINE (all timestamps in IST):
\"\"\"{state["conversation"]}\"\"\"

PRIOR CLINICAL ACTIONS:
{clinical_ctx}

TREATMENTS/INTERVENTIONS ALREADY PERFORMED THIS ENCOUNTER:
{treatments_ctx}

CASE TYPE (pre-classified by router): {state.get("case_type", "unknown")}
CARE SETTING (pre-classified by router): {state.get("care_setting", "unknown")}

══════════════════════════════════════════════════════════
TASK — Vital Signs & Physiological Assessment
══════════════════════════════════════════════════════════

Interpret ALL available physiological data from all clinical sources.
If a vital is absent, classify as UNKNOWN and flag it.
Note whether any approved prior action OR treatment already performed this
encounter has already changed a parameter — and whether that parameter is
only in range BECAUSE an intervention is actively running.
Base interpretation on standard emergency medicine — trauma vitals reasoning
if the case is trauma, medical/cardiorespiratory reasoning otherwise.
{CLINICAL_REFERENCE_A2}
{CLINICAL_REFERENCE_HTN_PULM_EDEMA}
{CLINICAL_REFERENCE_HYPERTENSIVE_EMERGENCY}
{CLINICAL_REFERENCE_HEAD_TRAUMA}
{CLINICAL_REFERENCE_SHOCK_DIFFERENTIATION}
{CLINICAL_REFERENCE_SEPSIS}
{CLINICAL_REFERENCE_CHEST_CARDIAC_TRAUMA}
{CLINICAL_REFERENCE_COMPARTMENT_SYNDROME}
{CLINICAL_REFERENCE_ELDERLY_TRAUMA}
{CLINICAL_REFERENCE_ANTICOAGULATION_REVERSAL}
{ANTICOAGULATION_FLAGGING_RULE}
{STABILITY_LABELING_RULE}
{NO_UNSUPPORTED_RISK_INFERENCE_RULE}

Return ONLY valid JSON:
{{
  "airway": {{
    "threat_level": "None|Partial|Complete|Unknown",
    "intervention_urgency": "Immediate|Urgent|Monitor|None",
    "already_managed_by_prior_action": null,
    "clinical_note": "...",
    "recommended_airway_action": "..."
  }},
  "breathing": {{
    "adequacy": "Adequate|Inadequate|Absent|Unknown",
    "respiratory_rate_classification": "Normal (12-20)|Tachypnoeic (>20)|Bradypnoeic (<12)|Absent|Unknown",
    "immediate_concern": true,
    "already_managed_by_prior_action": null,
    "currently_supported_by_ongoing_intervention": null,
    "clinical_note": "...",
    "recommended_action": "..."
  }},
  "circulation": {{
    "pulse_classification": "Strong|Weak|Thready|Absent|Unknown",
    "haemodynamic_status": "Stable|Unstable|Critical|Unknown",
    "shock_index": null,
    "shock_index_interpretation": "Normal (<1.0)|Elevated (>=1.0) - possible significant shock|Unknown",
    "estimated_shock_class_legacy": "None|Class_I|Class_II|Class_III|Class_IV|Unknown — LEGACY LABEL ONLY, do not use this alone to guide resuscitation; base clinical_note on perfusion signs, mentation, and trend instead",
    "occult_shock_possible": null,
    "shock_type_differential": "Hemorrhagic|Neurogenic|Spinal_shock_confounded|Cardiogenic|Obstructive|Septic|Distributive_other|Undetermined — presume hemorrhagic in TRAUMA until excluded; presume septic in a NON-trauma patient with a plausible infection source and no bleeding/injury evidence, per sepsis and shock differentiation references",
    "blood_loss_estimate_ml": null,
    "already_managed_by_prior_action": null,
    "clinical_note": "...",
    "recommended_action": "..."
  }},
  "neurological": {{
    "estimated_gcs": null,
    "gcs_breakdown": {{
      "eye_opening": null,
      "verbal_response": null,
      "motor_response": null
    }},
    "consciousness_classification": "Alert|Voice_Response|Pain_Response|Unresponsive|Unknown",
    "avpu_scale": "A|V|P|U|Unknown",
    "head_injury_risk": "None|Low|Moderate|High|Unknown",
    "herniation_signs": false,
    "cushing_reflex_pattern": "true if hypertension+bradycardia+irregular respirations are all present — treat as a late sign of critical ICP elevation, not a reassuring BP",
    "gcs_trend_note": "note any documented change of 2+ points on serial exam as urgent, if serial data is available",
    "already_managed_by_prior_action": null,
    "clinical_note": "...",
    "recommended_action": "..."
  }},
  "spo2_interpretation": {{
    "value": null,
    "classification": "Normal (≥95%)|Mild_Hypoxia (90-94%)|Moderate_Hypoxia (85-89%)|Severe_Hypoxia (<85%)|Unknown",
    "supplemental_o2_required": null,
    "o2_delivery_method": "Non-rebreather mask|Simple face mask|Nasal cannula|High-velocity/high-flow nasal insufflation|NIV (CPAP/BiPAP)|BVM|Intubation|Unknown",
    "target_spo2_range": "Do not default to 100%; state an appropriate target (commonly ~94-98% for most acute presentations, or ≥95% specifically for acute heart failure/pulmonary edema) and avoid hyperoxia once adequate",
    "already_managed_by_prior_action": null,
    "currently_dependent_on_ongoing_support": "true if the current value is only achieved because NIV/O2 is actively running — do not mark this parameter as simply 'normal' if so"
  }},
  
  "hypertension_assessment": {{
    "systolic": null,
    "diastolic": null,
    "interarm_difference_mmhg": null,
    "severity": "Normal|Elevated|Stage_2|Severe_Crisis (>180/120)|Unknown",
    "hypertensive_emergency_suspected": null,
    "hypertensive_urgency_suspected": null,
    "end_organ_evidence": ["..."],
    "clinical_note": "...",
    "recommended_action": "Frequent BP reassessment and notify treating physician for BP management if emergency criteria are met; if urgency only (no end-organ evidence), favor gradual correction over emergent parenteral therapy"
  }},
  "chest_cardiac_trauma_screen": {{
    "applicable": "false if no chest/thoracoabdominal trauma or cardiac-injury-consistent presentation is present",
    "tension_pneumothorax_suspected": null,
    "tension_pneumothorax_basis": "...",
    "cardiac_tamponade_suspected": null,
    "cardiac_tamponade_basis": "Note that Beck's triad is present in <10% of true cases and must never be used to exclude tamponade; unexplained tachycardia may be the only sign",
    "massive_hemothorax_suspected": null,
    "escalation_needed": "Immediate|Urgent|Monitor|Not_applicable"
  }},
  "compartment_syndrome_screen": {{
    "applicable": "false if no extremity injury, crush mechanism, or prolonged limb compression is present",
    "risk_present": null,
    "pain_out_of_proportion": null,
    "pain_with_passive_stretch": null,
    "distal_pulse_status": "Present|Absent|Unknown — REMINDER: a present pulse does NOT exclude compartment syndrome",
    "sensory_or_motor_change": null,
    "escalation_needed": "Immediate|Urgent|Monitor|Not_applicable"
  }},
  "elderly_occult_shock_screen": {{
    "applicable": "false unless patient is elderly (approximate age suggests this) or explicitly noted as such",
    "beta_blocker_or_rate_limiting_med_noted": null,
    "baseline_hypertension_noted": null,
    "lactate_or_base_deficit_available": null,
    "occult_hypoperfusion_possible_despite_normal_vitals": null,
    "clinical_note": "Do not let 'normal' vitals alone reassure in an elderly trauma patient — see elderly trauma reference"
  }},
  "anticoagulation_status": {{
    "on_anticoagulant_or_antiplatelet": null,
    "agent_if_named": null,
    "timing_context": "home_medication|given_this_encounter|unclear",
    "relevant_to_current_presentation": "true if there is a head injury, major bleeding, or bleeding-concerning mechanism present",
    "flag_for_physician": "Urgent reversal-decision notification needed|Note only, no acute bleeding concern|Not_applicable"
  }},
  "overall_physiological_status": {{
    "classification": "Stable|Improved_but_still_critical|Potentially_Unstable|Unstable|Critical|Peri_Arrest — do NOT use 'Stable' if an active organ-supportive intervention (NIV/O2/pressors) is required to maintain current status, or if any vital remains significantly deranged despite treatment; see STABILITY_LABELING_RULE",
    "immediate_life_threats": ["..."],
    "physiological_reserve": "Adequate|Reduced|Critically_Low|Unknown",
    "effect_of_completed_actions_on_status": "..."
  }},
  "vitals_missing_from_all_sources": ["..."],
  "vitals_urgently_needed": ["..."]
}}
"""
        state["vitals_assessment"] = await self._invoke(system, prompt)
        logger.info(f"{self.agent_id} · 📤 OUTPUT (Vitals Assessment):")
        logger.info(json.dumps(state["vitals_assessment"], indent=2, default=str))
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · VitalsAgent — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A3 · INJURY CLASSIFICATION AGENT  (TRAUMA ONLY)
# ============================================================

class InjuryAgent(BaseAgent):
    agent_id = "A3"

    async def run(self, state: EVISState) -> EVISState:
        logger.info(f"{self.agent_id} · InjuryAgent — START")
        t0 = datetime.now().timestamp()

        system = (
            "You are a trauma surgeon applying ATLS principles to pre-hospital injury assessment. "
            "You classify injuries by severity and priority, and identify hidden injury risks "
            "from the mechanism of injury. "
            "When prior approved actions have already addressed an injury aspect, note it as managed. "
            "Actively screen for chest/cardiac trauma red flags (tension pneumothorax, cardiac "
            "tamponade, massive hemothorax), compartment syndrome, head trauma deterioration "
            "patterns, and anticoagulation-related bleeding risk whenever the mechanism or "
            "findings make them plausible — do not wait for them to be obvious before screening. "
            "If the patient is elderly, apply the elderly-trauma reasoning (occult shock, "
            "undertriage risk, cervical spine injury patterns) rather than adult-general defaults. "
            "All timestamps in output must be IST (Asia/Kolkata). "
            "Always respond with valid JSON."
        )

        clinical_ctx = _clinical_context_block(state)

        logger.info(f"{self.agent_id} · 📥 INPUT PASSING TO A3:")
        logger.info("A1 Medical Entities:")
        logger.info(json.dumps(state.get("medical_entities", {}), indent=2, default=str))
        logger.info("A2 Vitals Assessment:")
        logger.info(json.dumps(state.get("vitals_assessment", {}), indent=2, default=str))
        logger.info("Full Conversation:")
        logger.info(state.get("conversation", ""))

        prompt = f"""
Classify all injuries from this patient's clinical data using ATLS trauma principles.

MEDICAL ENTITIES (A1 output):
{json.dumps(state["medical_entities"], indent=2, default=str)}

VITALS ASSESSMENT (A2 output):
{json.dumps(state["vitals_assessment"], indent=2, default=str)}

FULL CLINICAL TIMELINE (all timestamps in IST):
\"\"\"{state["conversation"]}\"\"\"

PRIOR CLINICAL ACTIONS:
{clinical_ctx}

══════════════════════════════════════════════════════════
TASK — Trauma Injury Classification & Prioritisation
══════════════════════════════════════════════════════════

Classify confirmed injuries, suspected injuries (from mechanism),
and identify what to rule out. For injuries already addressed by
an approved prior action, mark them as managed and note what remains.
{CLINICAL_REFERENCE_A3_A5_A6}
{CLINICAL_REFERENCE_HEAD_TRAUMA}
{CLINICAL_REFERENCE_SHOCK_DIFFERENTIATION}
{CLINICAL_REFERENCE_SEPSIS}
{CLINICAL_REFERENCE_CHEST_CARDIAC_TRAUMA}
{CLINICAL_REFERENCE_COMPARTMENT_SYNDROME}
{CLINICAL_REFERENCE_ELDERLY_TRAUMA}
{CLINICAL_REFERENCE_ANTICOAGULATION_REVERSAL}
{ANTICOAGULATION_FLAGGING_RULE}

Return ONLY valid JSON:
{{
  "confirmed_injuries": [
    {{
      "injury": "...",
      "body_region": "...",
      "severity": "Minor|Moderate|Severe|Critical|Life_Threatening",
      "atls_priority": "A|B|C|D|E",
      "immediate_intervention_needed": true,
      "already_managed": false,
      "managed_by": null,
      "intervention": "...",
      "evidence_from_source": "..."
    }}
  ],
  "suspected_injuries": [
    {{
      "injury": "...",
      "based_on": "mechanism|vitals|symptoms|physical_exam_finding|image_data",
      "likelihood": "High|Moderate|Low",
      "why_suspected": "...",
      "rule_out_action": "..."
    }}
  ],
  "spinal_injury_assessment": {{
    "risk_level": "None|Low|Moderate|High|Unknown",
    "mechanism_supports": true,
    "immobilization_applied": null,
    "immobilization_components_present": {{
      "cervical_collar": null,
      "head_blocks_or_padding": null,
      "torso_and_thigh_straps_to_board": null
    }},
    "cervical_collar_indicated": true,
    "field_clearance_criteria_met": "Set false unless the data explicitly supports ALL of: no midline neck pain/tenderness/stiffness (defined liberally), age ~11-65, no altered sensorium, no distracting injury — if unmet or uncertain, immobilization is indicated",
    "log_roll_precaution": true,
    "already_immobilized_per_approved_action": false,
    "spinal_shock_vs_neurogenic_shock_note": "If hypotension is present with a spinal injury, presume hemorrhage as the cause until excluded — do not default to neurogenic shock; note separately if flaccidity/areflexia (spinal shock) could be masking the true completeness of a cord injury",
    "clinical_note": "..."
  }},
  "internal_bleeding_risk": {{
    "risk_level": "None|Low|Moderate|High|Unknown",
    "suspected_source": "...",
    "clinical_indicators": ["..."],
    "action": "..."
  }},
  "head_injury_classification": {{
    "present": null,
    "severity": "Mild|Moderate|Severe|Unknown",
    "type": "closed|open|penetrating|unknown",
    "gcs_category": "Severe (3-8)|Moderate (9-13)|Mild (14-15)|Unknown",
    "herniation_risk": "None|Low|Moderate|High|Unknown",
    "cushing_reflex_present": null,
    "anticoagulated_lower_threshold_applies": "true if patient is on an anticoagulant/antiplatelet — apply a lower threshold for urgent imaging/reversal notification even with a minor mechanism",
    "immediate_action": "..."
  }},
  "chest_cardiac_trauma_assessment": {{
    "applicable": "false if no relevant mechanism/findings",
    "tension_pneumothorax_suspected": null,
    "cardiac_tamponade_suspected": null,
    "massive_hemothorax_suspected": null,
    "flail_chest_or_pulmonary_contusion_suspected": null,
    "fluid_caution_note": "Avoid recommending aggressive/unrestricted IV fluids if flail chest or significant pulmonary contusion is suspected",
    "escalation_needed": "Immediate|Urgent|Monitor|Not_applicable"
  }},
  "compartment_syndrome_assessment": {{
    "applicable": "false if no extremity injury/crush mechanism/prolonged compression",
    "risk_level": "None|Low|Moderate|High|Unknown",
    "pain_out_of_proportion_present": null,
    "distal_pulse_present": "Present|Absent|Unknown — a present pulse does NOT exclude compartment syndrome",
    "escalation_needed": "Immediate|Urgent|Monitor|Not_applicable"
  }},
  "anticoagulation_reversal_needed": {{
    "on_anticoagulant_or_antiplatelet": null,
    "bleeding_or_head_injury_present": null,
    "flag_for_physician": "Urgent reversal-decision notification needed|Note only|Not_applicable"
  }},
  "estimated_iss_range": "1-8 (Minor)|9-15 (Moderate)|16-24 (Severe)|25-75 (Critical)",
  "triage_category": {{
    "sieve_category": "T1_Immediate|T2_Urgent|T3_Delayed|T4_Expectant",
    "colour": "Red (life-threatening shock/hypoxia present or imminent, but likely salvageable with immediate care) | Yellow (systemic implications but not yet life-threatening; can likely tolerate a 45-60 min wait) | Green (localized injury, no systemic implications, unlikely to deteriorate for hours) | Black (deceased, or no spontaneous ventilation/circulation)",
    "rationale": "...",
    "elderly_undertriage_caution": "If patient is elderly, note that standard triage criteria are less reliable in this population and apply a lower threshold for higher acuity"
  }},
  "transport_mode_recommendation": {{
    "mode": "Code_Blue_Lights|Urgent_No_Lights|Routine",
    "position": "Supine_Full_Spinal|Recovery_Position|Sitting|Trendelenburg",
    "rationale": "..."
  }},
  "injuries_managed_by_prior_actions": ["..."],
  "remaining_unmanaged_priorities": ["..."]
}}
"""
        state["injury_profile"] = await self._invoke(system, prompt)
        logger.info(f"{self.agent_id} · 📤 OUTPUT (Injury Profile):")
        logger.info(json.dumps(state["injury_profile"], indent=2, default=str))
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · InjuryAgent — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


def _stub_injury_profile() -> Dict:
    """Inserted instead of running A3 when the router determines this is a
    non-trauma (purely medical) case. No LLM call — safe, valid, empty-but-complete
    structure so A4/A5/A6/A7/A8 don't break on missing keys, and so trauma-only
    content (spinal precautions, head injury, internal bleeding) never leaks
    into medical cases."""
    return {
        "confirmed_injuries": [],
        "suspected_injuries": [],
        "spinal_injury_assessment": {
            "risk_level": "None",
            "mechanism_supports": False,
            "cervical_collar_indicated": False,
            "log_roll_precaution": False,
            "clinical_note": "No trauma mechanism identified — spinal precautions not indicated.",
        },
        "internal_bleeding_risk": {
            "risk_level": "None",
            "clinical_indicators": [],
            "action": "Not applicable — no trauma mechanism.",
        },
        "head_injury_classification": {
            "present": False,
            "severity": "Unknown",
            "herniation_risk": "None",
            "immediate_action": "Not applicable — no trauma mechanism.",
        },
        "chest_cardiac_trauma_assessment": {
            "applicable": False,
            "escalation_needed": "Not_applicable",
        },
        "compartment_syndrome_assessment": {
            "applicable": False,
            "escalation_needed": "Not_applicable",
        },
        "anticoagulation_reversal_needed": {
            "on_anticoagulant_or_antiplatelet": None,
            "bleeding_or_head_injury_present": False,
            "flag_for_physician": "Not_applicable",
        },
        "estimated_iss_range": "Not applicable — non-trauma case",
        "triage_category": {
            "sieve_category": "T2_Urgent",
            "colour": "Yellow",
            "rationale": "Non-trauma medical presentation — triage colour is driven by risk stratification (A4), not injury severity.",
        },
        "transport_mode_recommendation": {
            "mode": "Urgent_No_Lights",
            "position": "Position_of_Comfort",
            "rationale": "No trauma mechanism — position per medical presentation, not spinal precaution.",
        },
        "injuries_managed_by_prior_actions": [],
        "remaining_unmanaged_priorities": [],
        "_skipped": True,
        "_skip_reason": "A3 skipped by router (A0) — no trauma mechanism identified.",
    }


async def a3_conditional(state: EVISState) -> EVISState:
    """Graph node wrapping A3: runs the real InjuryAgent for trauma cases,
    otherwise inserts the stub with zero LLM cost."""
    if state.get("run_a3", True):
        state = await InjuryAgent(llm).run(state)
    else:
        state["injury_profile"] = _stub_injury_profile()
        state["agent_timings"]["A3"] = 0.0
        logger.info("A3 SKIPPED (router: non-trauma case) — stub inserted, no LLM call")
    return state


# ============================================================
# A4 · RISK STRATIFICATION AGENT
# ============================================================

class RiskAgent(BaseAgent):
    agent_id = "A4"

    async def run(self, state: EVISState) -> EVISState:
        logger.info(f"{self.agent_id} · RiskAgent — START")
        t0 = datetime.now().timestamp()

        system = (
            "You are a senior emergency medicine physician performing real-time risk "
            "stratification on a pre-hospital/ED patient (trauma or medical). You determine "
            "criticality, time pressure, and deterioration risk. "
            "Account for prior approved clinical actions AND treatments already performed this "
            "encounter, and their effect on current risk. Do NOT downgrade overall risk just "
            "because one parameter (e.g. SpO2) has improved with ongoing support — an "
            "intervention-dependent improvement does not reduce criticality on its own. "
            "If the patient is elderly, or on an anticoagulant/antiplatelet agent, or has any "
            "chest/cardiac trauma or compartment syndrome red flags identified upstream, weight "
            "these explicitly in the criticality score and special risk flags rather than relying "
            "only on raw vital-sign numbers. "
            "All timestamps in output must be IST (Asia/Kolkata). "
            "Always respond with valid JSON."
        )

        clinical_ctx   = _clinical_context_block(state)
        treatments_ctx = _treatments_performed_block(state)

        logger.info(f"{self.agent_id} · 📥 INPUT PASSING TO A4:")
        logger.info("A1 Medical Entities:")
        logger.info(json.dumps(state.get("medical_entities", {}), indent=2, default=str))
        logger.info("A2 Vitals Assessment:")
        logger.info(json.dumps(state.get("vitals_assessment", {}), indent=2, default=str))
        logger.info("A3 Injury Profile:")
        logger.info(json.dumps(state.get("injury_profile", {}), indent=2, default=str))
        logger.info("Full Conversation:")
        logger.info(state.get("conversation", ""))

        prompt = f"""
Perform comprehensive risk stratification for this emergency patient.
Consider ALL available clinical data from prior agents AND the clinical action history.

CASE TYPE (pre-classified): {state.get("case_type", "unknown")} | is_trauma={state.get("is_trauma")}
CARE SETTING (pre-classified): {state.get("care_setting", "unknown")}

MEDICAL ENTITIES (A1 output):
{json.dumps(state["medical_entities"], indent=2, default=str)}

VITALS ASSESSMENT (A2 output):
{json.dumps(state["vitals_assessment"], indent=2, default=str)}

INJURY PROFILE (A3 output — stub if non-trauma; ignore trauma-only fields if _skipped=true):
{json.dumps(state["injury_profile"], indent=2, default=str)}

DICTATION TIMESTAMP (IST): {state["timestamp"]}

PRIOR CLINICAL ACTIONS:
{clinical_ctx}

TREATMENTS/INTERVENTIONS ALREADY PERFORMED THIS ENCOUNTER:
{treatments_ctx}

══════════════════════════════════════════════════════════
TASK — Emergency Risk Stratification
══════════════════════════════════════════════════════════

If injury_profile._skipped is true, this is a non-trauma case — do NOT invent
spinal, head, or internal bleeding risks. Base life threats and risk purely on
the medical presentation (respiratory, cardiac, neuro, toxicology, etc.) shown
in A1/A2.

Factor in what has already been done. If an approved action or a treatment
already performed this encounter addressed a life threat, note that the
threat is partially or fully mitigated — but do NOT mark it as resolved if
it is only being held in check by an ongoing intervention (e.g. NIV).

When weighing shock/hemorrhage risk, favor trend, perfusion signs, mentation,
and shock_index (HR/SBP, concerning at >=1.0) over the legacy Class I-IV
hemorrhage staging in A2 — that staging is not reliable enough to drive risk
level on its own. Remember that normal-looking vitals do not exclude
significant blood loss in young/fit patients or those with a blunted
tachycardic response (elderly, beta-blocker use). If the mechanism and
findings suggest a major bleeding trauma patient (e.g. penetrating mechanism,
positive FAST, SBP <90, HR >120 — 2 or more of these predicts need for
massive transfusion), flag early blood-bank/MTP-readiness as a special risk
flag rather than waiting for hemodynamic collapse.

If severe hypertension (crisis-range: >180/120) is present with end-organ
evidence (e.g. acute pulmonary edema, chest/back pain with unequal arm BPs,
new neuro deficit, altered mentation), flag it as a hypertensive emergency
requiring frequent BP monitoring and physician notification. Remember that
acute (hypertensive) heart failure/pulmonary edema can be precipitated at
lower, more patient-specific thresholds (sometimes SBP ~140-150) — do not
require the full 180/120 crisis threshold before treating a pulmonary-edema
presentation as hypertension-driven and urgent.

If A2/A3 flagged a suspected tension pneumothorax, cardiac tamponade, or
compartment syndrome, elevate criticality accordingly and add a special risk
flag even if not every classic textbook sign is present (see chest/cardiac
trauma and compartment syndrome references — a present distal pulse does NOT
exclude compartment syndrome, and Beck's triad absence does NOT exclude
tamponade). If the patient is elderly, apply the elderly-trauma occult-shock
reasoning rather than trusting "normal" vitals at face value. If the patient
is anticoagulated/antiplatelet AND has a head injury or major bleeding, add
an explicit special risk flag for urgent physician reversal-decision
notification.
{CLINICAL_REFERENCE_ELDERLY_TRAUMA}
{CLINICAL_REFERENCE_ANTICOAGULATION_REVERSAL}
{ANTICOAGULATION_FLAGGING_RULE}
{STABILITY_LABELING_RULE}
{EVIDENCE_TRACEABILITY_RULE}
{NO_UNSUPPORTED_RISK_INFERENCE_RULE}

Return ONLY valid JSON:
{{
  "criticality_score": {{
    "score": 0,
    "scale": "1-10 (10=imminent_death)",
    "rationale": "...",
    "modified_by_prior_actions": "..."
  }},
  "life_threats_ranked": [
    {{
      "rank": 1,
      "threat": "...",
      "time_to_harm_minutes": 0,
      "reversible": true,
      "already_addressed": false,
      "addressed_by": null,
      "still_dependent_on_ongoing_intervention": null,
      "immediate_action": "..."
    }}
  ],
  "deterioration_trajectory": {{
    "direction": "Stabilising|Static|Deteriorating|Rapidly_Deteriorating|Unknown",
    "predicted_next_5_minutes": "...",
    "predicted_next_15_minutes": "...",
    "warning_signs_to_watch": ["..."]
  }},
  "time_critical_window": {{
    "golden_hour_remaining_minutes": null,
    "platinum_10_minutes_elapsed": null,
    "time_critical_intervention": "...",
    "must_arrive_at_hospital_within_minutes": null
  }},
  "shock_risk": {{
    "present": null,
    "type": "Haemorrhagic|Neurogenic|Obstructive|Distributive|Cardiogenic|Unknown",
    "stage": "Compensated|Decompensated|Irreversible|Unknown",
    "massive_transfusion_predictor_criteria_met": null,
    "action": "..."
  }},
  "hypertensive_emergency_flag": {{
    "present": null,
    "basis": "...",
    "action_required": "Frequent BP monitoring; notify treating physician for BP management"
  }},
  
  "elderly_risk_modifier": {{
    "applicable": "false unless patient is elderly",
    "occult_shock_possible_despite_normal_vitals": null,
    "undertriage_caution_applied": null,
    "note": "..."
  }},
  "anticoagulation_risk_modifier": {{
    "applicable": "false unless anticoagulant/antiplatelet use is noted",
    "bleeding_or_head_injury_present": null,
    "flag_for_physician": "Urgent reversal-decision notification needed|Note only|Not_applicable"
  }},
  "special_risk_flags": [
    {{
      "flag": "...",
      "clinical_basis": "...",
      "action_required": "..."
    }}
  ],
  "not_approved_action_implications": [
    {{
      "rejected_action": "...",
      "clinical_implication": "...",
      "risk_increase": "Low|Moderate|High|Critical"
    }}
  ],
  "overall_risk_level": "Low|Moderate|High|Critical|Immediately_Life_Threatening — do not downgrade solely because one parameter improved with ongoing support"
}}
"""
        state["risk_stratification"] = await self._invoke(system, prompt)
        logger.info(f"{self.agent_id} · 📤 OUTPUT (Risk Stratification):")
        logger.info(json.dumps(state["risk_stratification"], indent=2, default=str))
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · RiskAgent — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A5 · IMMEDIATE ACTIONS AGENT  (parallel)
# ============================================================

class ImmediateActionsAgent(BaseAgent):
    agent_id = "A5"

    async def run(self, state: EVISState) -> EVISState:
        logger.info(f"{self.agent_id} · ImmediateActionsAgent — START")
        t0 = datetime.now().timestamp()

        role_scope = _role_scope_instruction(state, "A5 · Immediate Actions")

        system = (
            "You are an emergency medical assistant giving immediate-action instructions. "
            f"{role_scope} "
            "AIRWAY RULE: use jaw thrust (not head-tilt-chin-lift) whenever cervical spine injury is "
            "possible or unknown, since it opens the airway while keeping the neck neutral; use "
            "head-tilt-chin-lift only when trauma/c-spine injury is not a concern. "
            "OXYGEN RULE: titrate to an adequate target (commonly ~94-98% SpO2 for most acute "
            "presentations, or ≥95% specifically for acute heart failure/pulmonary edema) rather "
            "than defaulting every patient to maximal flow/100% saturation — over-oxygenation "
            "(hyperoxia) is not benign, though in acute pulmonary edema hypoxemia is the greater "
            "immediate risk, so do not under-titrate oxygen there out of concern for CO2 retention. "
            "FLUID RULE: in a prehospital_ems setting, basic EMTs do not start IV fluids; if "
            "hemorrhagic shock is suspected, do not suggest aggressive fluid resuscitation to "
            "normalize blood pressure — that decision belongs to paramedic/hospital level and "
            "premature aggressive fluids before bleeding is controlled can worsen outcomes. Focus "
            "on bleeding control, positioning, and rapid transport instead. "
            "CHEST/CARDIAC TRAUMA RULE: if a tension pneumothorax or cardiac tamponade is "
            "suspected, the correct BLS-scope action is rapid recognition, immediate transport, "
            "and urgent notification of the receiving team — never instruct needle/tube "
            "thoracostomy or pericardiocentesis yourself. "
            "COMPARTMENT SYNDROME RULE: if suspected, recommend removing constrictive dressings/ "
            "jewelry, keeping the limb at heart level (not elevated above it), and urgent "
            "escalation — never claim a palpable distal pulse rules this out. "
            "AGITATION RULE: for an agitated/combative patient, prioritize verbal de-escalation "
            "and safety (maintain distance, involve security/law enforcement) before any physical "
            "intervention; flag the need for physician-level medication decisions rather than "
            "naming a specific drug or dose. "
            "Do NOT re-suggest actions already approved and completed, or treatments already "
            "performed this encounter — acknowledge and build on them instead. "
            "All timestamps in output must be IST (Asia/Kolkata). "
            "Always respond with valid JSON."
        )

        clinical_ctx   = _clinical_context_block(state)
        treatments_ctx = _treatments_performed_block(state)

        logger.info(f"{self.agent_id} · 📥 INPUT PASSING TO A5:")
        logger.info("Risk Stratification:")
        logger.info(json.dumps(state.get("risk_stratification", {}), indent=2, default=str))
        logger.info("Vitals Assessment:")
        logger.info(json.dumps(state.get("vitals_assessment", {}), indent=2, default=str))
        logger.info("Injury Profile:")
        logger.info(json.dumps(state.get("injury_profile", {}), indent=2, default=str))
        logger.info("Full Conversation:")
        logger.info(state.get("conversation", ""))

        prompt = f"""
Generate IMMEDIATE ACTION instructions for this emergency patient.

CARE SETTING: {state.get("care_setting", "unknown")}
{role_scope}

CASE TYPE: {state.get("case_type", "unknown")} | is_trauma={state.get("is_trauma")}
(If is_trauma is false, do NOT include spinal immobilization or any trauma-only actions.)

CRITICAL: Do NOT re-suggest anything already approved and done, or any treatment already
performed this encounter. Build on what has been completed. Explain next steps IN CONTEXT
of prior actions and current treatments.
{TREATMENTS_ALREADY_PERFORMED_RULE}

RISK LEVEL: {state["risk_stratification"].get("overall_risk_level", "Unknown")}
CRITICALITY: {state["risk_stratification"].get("criticality_score", {}).get("score", "Unknown")}/10
LIFE THREATS: {json.dumps(state["risk_stratification"].get("life_threats_ranked", []), indent=2)}
HYPERTENSIVE EMERGENCY FLAG: {json.dumps(state["risk_stratification"].get("hypertensive_emergency_flag", {}), indent=2)}
SPECIAL RISK FLAGS: {json.dumps(state["risk_stratification"].get("special_risk_flags", []), indent=2)}

VITALS ASSESSMENT (A2 output):
{json.dumps(state["vitals_assessment"], indent=2, default=str)}

INJURY PROFILE (A3 output — may be a non-trauma stub):
{json.dumps(state["injury_profile"], indent=2, default=str)}

PRIOR CLINICAL ACTIONS:
{clinical_ctx}

TREATMENTS/INTERVENTIONS ALREADY PERFORMED THIS ENCOUNTER:
{treatments_ctx}

DICTATION TIMESTAMP (IST): {state["timestamp"]}

══════════════════════════════════════════════════════════
TASK — Timestamped Immediate Actions (Building on Prior Actions & Treatments)
══════════════════════════════════════════════════════════

For each action, state:
  - why_for_this_patient: specific to this patient's presentation
  - builds_on_prior_action: what already-done action or treatment this continues or builds on (if any)
  - already_done_context: briefly acknowledge what approved action/treatment preceded this (if any)
{CLINICAL_REFERENCE_A3_A5_A6}
{CLINICAL_REFERENCE_HTN_PULM_EDEMA}
{CLINICAL_REFERENCE_CHEST_CARDIAC_TRAUMA}
{CLINICAL_REFERENCE_COMPARTMENT_SYNDROME}
{CLINICAL_REFERENCE_ACUTE_AGITATION}
{ANTI_DUPLICATION_RULE_A5}

Return ONLY valid JSON:
{{
  "treatments_already_performed_acknowledged": ["..."],
  "timestamp_anchored_actions": [
    {{
      "time_window": "T+0s to T+30s",
      "label": "CRITICAL — DO NOW",
      "actions": [
        {{
          "action": "...",
          "why_for_this_patient": "...",
          "builds_on_prior_action": null,
          "already_done_context": null,
          "method": "...",
          "success_indicator": "..."
        }}
      ]
    }},
    {{
      "time_window": "T+30s to T+60s",
      "label": "URGENT — NEXT 30 SECONDS",
      "actions": [
        {{
          "action": "...",
          "why_for_this_patient": "...",
          "builds_on_prior_action": null,
          "already_done_context": null,
          "method": "...",
          "success_indicator": "..."
        }}
      ]
    }},
    {{
      "time_window": "T+60s to T+120s",
      "label": "IMPORTANT — WITHIN 2 MINUTES",
      "actions": [
        {{
          "action": "...",
          "why_for_this_patient": "...",
          "builds_on_prior_action": null,
          "already_done_context": null,
          "method": "...",
          "success_indicator": "..."
        }}
      ]
    }},
    {{
      "time_window": "T+120s to ETA",
      "label": "EN-ROUTE/ONGOING — MAINTAIN AND MONITOR",
      "actions": [
        {{
          "action": "...",
          "why_for_this_patient": "...",
          "builds_on_prior_action": null,
          "already_done_context": null,
          "monitoring_interval_seconds": 60,
          "escalation_trigger": "..."
        }}
      ]
    }}
  ],
  "cpr_indicated": {{
    "indicated": false,
    "rationale": "...",
    "compression_rate": null,
    "defibrillation_ready": false
  }},
  "fluid_resuscitation": {{
    "indicated": null,
    "type": "Balanced Crystalloid (e.g. Ringers Lactate/Plasma-Lyte)|Normal Saline|Blood Products|Colloid|None",
    "rate": "...",
    "iv_access_urgency": "Immediate|Urgent|Routine|Not_Indicated",
    "note": "If care_setting is prehospital_ems, this is out of BLS scope — informs the incoming paramedic/hospital team only. If hemorrhagic shock suspected, note that aggressive normalization of BP before bleeding control can be harmful (permissive hypotension), except with concomitant severe traumatic brain injury where a higher BP target is preferred. Avoid unrestricted fluids if flail chest/pulmonary contusion is suspected. Prefer balanced crystalloids over large-volume normal saline when hospital-level fluids are given."
  }},
  "oxygen_protocol": {{
    "indicated": null,
    "flow_rate_lpm": null,
    "delivery_device": "...",
    "target_spo2": "State a specific target — commonly ~94-98% for most acute non-COPD presentations, or ≥95% specifically for acute heart failure/pulmonary edema; do not default to 100%"
  }},
  "chest_cardiac_trauma_action": {{
    "applicable": "false unless a tension pneumothorax, tamponade, or massive hemothorax concern was flagged upstream",
    "recognition_summary": "...",
    "bls_scope_action": "Immediate transport and urgent notification of receiving team — do not instruct needle/tube thoracostomy or pericardiocentesis in a prehospital_ems setting",
    "hospital_level_note": "Only populate advanced-procedure detail if care_setting is ed_or_inpatient"
  }},
  "compartment_syndrome_action": {{
    "applicable": "false unless flagged upstream",
    "bls_scope_action": "Remove constrictive dressings/jewelry if easily done, keep limb at heart level, urgent transport with explicit handover of concern",
    "pulse_caveat": "A present distal pulse does NOT rule this out — do not deprioritize based on a normal pulse"
  }},
  "agitation_action": {{
    "applicable": "false unless the patient is agitated/combative",
    "de_escalation_first": "Verbal de-escalation and safe distance before any physical intervention",
    "underlying_cause_check": "Actively consider hypoxia, hypoglycemia, head injury, intoxication/withdrawal as reversible causes",
    "restraint_note": "Restraints only to prevent harm, minimally, with close airway/breathing/circulation monitoring — never a first-line action"
  }},
  "prior_actions_acknowledged": ["..."],
  "most_critical_single_action": "..."
}}
"""
        state["immediate_actions"] = await self._invoke(system, prompt)
        logger.info(f"{self.agent_id} · 📤 OUTPUT (Immediate Actions):")
        logger.info(json.dumps(state["immediate_actions"], indent=2, default=str))
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · ImmediateActionsAgent — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A6 · PRECAUTIONS AGENT  (parallel)
# ============================================================

class PrecautionsAgent(BaseAgent):
    agent_id = "A6"

    async def run(self, state: EVISState) -> EVISState:
        logger.info(f"{self.agent_id} · PrecautionsAgent — START")
        t0 = datetime.now().timestamp()

        role_scope = _role_scope_instruction(state, "A6 · Precautions")

        system = (
            "You are a trauma/medical safety expert giving precautions. "
            f"{role_scope} "
            "Only include precautions relevant to THIS case type — do not include spinal/movement "
            "precautions for a non-trauma medical case. "
            "Factor in what has already been approved, done, and already performed this encounter — "
            "do not warn against completed actions. "
            "All timestamps in output must be IST (Asia/Kolkata). "
            "Always respond with valid JSON."
        )

        clinical_ctx   = _clinical_context_block(state)
        treatments_ctx = _treatments_performed_block(state)

        logger.info(f"{self.agent_id} · 📥 INPUT PASSING TO A6:")
        logger.info("Injury Profile:")
        logger.info(json.dumps(state.get("injury_profile", {}), indent=2, default=str))
        logger.info("Vitals Assessment:")
        logger.info(json.dumps(state.get("vitals_assessment", {}), indent=2, default=str))
        logger.info("Risk Stratification:")
        logger.info(json.dumps(state.get("risk_stratification", {}), indent=2, default=str))
        logger.info("Medical History:")
        logger.info(json.dumps(state.get("medical_entities", {}).get("known_medical_history", {}), indent=2, default=str))
        logger.info("Full Conversation:")
        logger.info(state.get("conversation", ""))

        prompt = f"""
Generate specific precautions and contraindications for this emergency patient.
These are DANGER ALERTS — what must NOT be done and why.
Factor in already-completed approved actions and treatments already performed this
encounter — do not issue warnings about things already properly done.
Warn specifically if any NOT-APPROVED action was clinically risky.

CASE TYPE: {state.get("case_type", "unknown")} | is_trauma={state.get("is_trauma")}
CARE SETTING: {state.get("care_setting", "unknown")}
(If is_trauma is false, do NOT include spinal, log-roll, or movement/trauma precautions
unless the data genuinely supports a fall/collapse injury risk.)

INJURY PROFILE (A3 output — may be a non-trauma stub):
{json.dumps(state["injury_profile"], indent=2, default=str)}

VITALS ASSESSMENT (A2 output):
{json.dumps(state["vitals_assessment"], indent=2, default=str)}

RISK STRATIFICATION (A4 output):
{json.dumps(state["risk_stratification"], indent=2, default=str)}

MEDICAL ENTITIES — known history (A1 output):
{json.dumps(state["medical_entities"].get("known_medical_history", {}), indent=2, default=str)}

PRIOR CLINICAL ACTIONS:
{clinical_ctx}

TREATMENTS/INTERVENTIONS ALREADY PERFORMED THIS ENCOUNTER:
{treatments_ctx}

FULL CLINICAL TIMELINE (all timestamps in IST):
\"\"\"{state["conversation"]}\"\"\"

══════════════════════════════════════════════════════════
TASK — Precautions & Contraindications
══════════════════════════════════════════════════════════
{CLINICAL_REFERENCE_A3_A5_A6}
{CLINICAL_REFERENCE_HTN_PULM_EDEMA}
{CLINICAL_REFERENCE_HYPERTENSIVE_EMERGENCY}
{CLINICAL_REFERENCE_CHEST_CARDIAC_TRAUMA}
{CLINICAL_REFERENCE_COMPARTMENT_SYNDROME}
{CLINICAL_REFERENCE_ELDERLY_TRAUMA}
{CLINICAL_REFERENCE_ANTICOAGULATION_REVERSAL}
{ANTICOAGULATION_FLAGGING_RULE}
{CLINICAL_REFERENCE_ACUTE_AGITATION}
Where relevant to this case, also consider (only include if actually applicable —
do not force irrelevant items into the output):
  - A rigid cervical collar alone is not full immobilization; if trauma with
    spinal risk applies, note that the patient also needs head blocks/padding
    plus torso/thigh straps securing them to a board.
  - Do not rely on "palpable pulse implies this systolic BP" rules of thumb —
    they overestimate true pressure; treat a palpable pulse as reassurance only.
  - Avoid pushing oxygen to maximal flow once the patient is adequately
    oxygenated; over-oxygenation is a real risk, not just under-oxygenation
    (except in acute pulmonary edema, where the target is SpO2 ≥95% and
    oxygen should not be under-titrated).
  - If severe hypertension (crisis-range: >180/120, or lower with pulmonary
    edema/end-organ signs) is present, include a monitoring_alert for BP with
    a short recheck interval (e.g. every 5 minutes) and an action_if_triggered
    of "notify treating physician for BP management".
  - If a diuretic was given without a documented vasodilator/nitrate in a
    patient with hypertensive acute pulmonary edema, flag this as a
    treatment-sequencing precaution for physician review (do not instruct a
    dose or route).
  - If the patient is on NIV (CPAP/BiPAP), include a monitoring_alert for NIV
    intolerance/failure (rising RR, falling SpO2 despite NIV, worsening work
    of breathing, falling GCS) with action_if_triggered pointing toward
    escalation/advanced airway discussion with the treating physician. NIV
    also requires an adequate mask seal and patient cooperation to succeed —
    note if either appears compromised.
  - If BP readings are available from both arms with a difference of more
    than ~10-20 mmHg, flag this as clinically meaningful and note it can
    itself suggest aortic dissection or vascular disease.
  - If a tension pneumothorax or cardiac tamponade was flagged, include a
    monitoring_alert for further deterioration and explicitly note that
    absence of the "classic" signs (distended neck veins, Beck's triad) does
    NOT rule either out.
  - If compartment syndrome risk was flagged, include a monitoring_alert for
    worsening pain/pain with passive stretch and explicitly note that a
    present distal pulse does not exclude it.
  - If the patient is elderly, add a precaution against being falsely
    reassured by "normal" vitals, and note the higher undertriage risk in
    this population.
  - If the patient is on an anticoagulant/antiplatelet and has a head injury
    or major bleeding, add a critical_do_not_list item against delaying
    physician notification for a reversal decision.
  - If the patient is agitated/combative, add a precaution prioritizing
    verbal de-escalation and staff/patient safety over restraint or
    medication as a first response, and note restraints (if used) require
    close airway/breathing/circulation monitoring.

Return ONLY valid JSON:
{{
  "critical_do_not_list": [
    {{
      "do_not": "...",
      "applies_because": "...",
      "consequence_if_violated": "...",
      "severity": "Potentially_Fatal|High_Risk|Moderate_Risk",
      "relates_to_rejected_action": false
    }}
  ],
  "positioning_precautions": {{
    "avoid": ["..."],
    "correct_position": "...",
    "spinal_precaution_mandatory": null,
    "already_positioned_correctly": false,
    "reason": "..."
  }},
  "medication_precautions": [
    {{
      "drug_or_class": "...",
      "precaution": "avoid|use_with_caution|dose_reduce",
      "reason": "...",
      "alternative": "..."
    }}
  ],
  "movement_precautions": [
    {{
      "precaution": "...",
      "applies_to": "...",
      "reason": "..."
    }}
  ],
  "airway_precautions": [
    {{
      "precaution": "...",
      "reason": "...",
      "preferred_alternative": "..."
    }}
  ],
  "monitoring_alerts": [
    {{
      "alert": "...",
      "threshold": "...",
      "action_if_triggered": "...",
      "check_every_seconds": 0
    }}
  ],
  "anticoagulation_precaution": {{
    "applicable": "false unless anticoagulant/antiplatelet use is noted",
    "precaution": "...",
    "why_urgent": "..."
  }},
  "not_approved_action_risks": [
    {{
      "rejected_action": "...",
      "why_risky_to_skip": "...",
      "compensatory_measure": "..."
    }}
  ],
  "scene_and_transport_precautions": ["..."],
  "highest_priority_precaution": "..."
}}
"""
        state["precautions"] = await self._invoke(system, prompt)
        logger.info(f"{self.agent_id} · 📤 OUTPUT (Precautions):")
        logger.info(json.dumps(state["precautions"], indent=2, default=str))
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · PrecautionsAgent — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A7 · HOSPITAL PREP INSTRUCTIONS AGENT  (parallel)
# ============================================================

class HospitalPrepAgent(BaseAgent):
    agent_id = "A7"

    async def run(self, state: EVISState) -> EVISState:
        logger.info(f"{self.agent_id} · HospitalPrepAgent — START")
        t0 = datetime.now().timestamp()

        care_setting = state.get("care_setting", "unknown")
        if care_setting == "ed_or_inpatient":
            framing_instruction = (
                "This patient is ALREADY receiving hospital/ED-level care (per A0 router). "
                "Frame this output as ESCALATION-READINESS for the team already treating them — "
                "e.g. ICU bed availability, anaesthetics/critical-care notification in case NIV "
                "fails, repeat labs/ABG needs, physician notification for BP management — rather "
                "than 'pre-arrival' preparation for an ambulance that hasn't arrived yet."
            )
        else:
            framing_instruction = (
                "This is a pre-hospital case; frame this output as preparation for the receiving "
                "Emergency Department AHEAD of the ambulance arriving."
            )

        system = (
            "You are a trauma/medical team leader directing preparation for a critically ill "
            "patient. You give SPECIFIC setup instructions so the team is ready. "
            f"{framing_instruction} "
            "Tailor activation level and equipment to the ACTUAL case type — do not activate "
            "a full trauma team for a purely medical presentation unless severity warrants it. "
            "Take into account approved pre-hospital actions AND treatments already performed "
            "this encounter so the receiving/ongoing team knows what has already been done. "
            "If a tension pneumothorax, cardiac tamponade, compartment syndrome, or "
            "anticoagulation-related bleeding risk was flagged upstream, make sure the relevant "
            "equipment/personnel/blood-bank readiness reflects that. "
            "All timestamps in output must be IST (Asia/Kolkata). "
            "Always respond with valid JSON."
        )

        clinical_ctx   = _clinical_context_block(state)
        treatments_ctx = _treatments_performed_block(state)

        logger.info(f"{self.agent_id} · 📥 INPUT PASSING TO A7:")
        logger.info("Risk Stratification:")
        logger.info(json.dumps(state.get("risk_stratification", {}), indent=2, default=str))
        logger.info("Injury Profile:")
        logger.info(json.dumps(state.get("injury_profile", {}), indent=2, default=str))
        logger.info("Vitals Assessment:")
        logger.info(json.dumps(state.get("vitals_assessment", {}), indent=2, default=str))
        logger.info("Full Conversation:")
        logger.info(state.get("conversation", ""))

        prompt = f"""
Generate hospital/ongoing-care preparation instructions for this patient.
{framing_instruction}
Include a summary of what has already been done (approved actions AND treatments
already performed this encounter) so the team knows the patient's current
management status.

CASE TYPE: {state.get("case_type", "unknown")} | is_trauma={state.get("is_trauma")}
CARE SETTING: {care_setting}

RISK LEVEL: {state["risk_stratification"].get("overall_risk_level", "Unknown")}
TRIAGE: {json.dumps(state["injury_profile"].get("triage_category", {}), indent=2)}
LIFE THREATS: {json.dumps(state["risk_stratification"].get("life_threats_ranked", []), indent=2)}
HYPERTENSIVE EMERGENCY FLAG: {json.dumps(state["risk_stratification"].get("hypertensive_emergency_flag", {}), indent=2)}
SPECIAL RISK FLAGS: {json.dumps(state["risk_stratification"].get("special_risk_flags", []), indent=2)}
ETA WINDOW: {state["risk_stratification"].get("time_critical_window", {}).get("must_arrive_at_hospital_within_minutes", "Unknown")} minutes

VITALS (A2 output):
{json.dumps(state["vitals_assessment"], indent=2, default=str)}

INJURY PROFILE (A3 output — may be a non-trauma stub):
{json.dumps(state["injury_profile"], indent=2, default=str)}

PRIOR CLINICAL ACTIONS:
{clinical_ctx}

TREATMENTS/INTERVENTIONS ALREADY PERFORMED THIS ENCOUNTER:
{treatments_ctx}

FULL CLINICAL TIMELINE (all timestamps in IST):
\"\"\"{state["conversation"]}\"\"\"

══════════════════════════════════════════════════════════
TASK — Preparation / Escalation-Readiness Instructions
══════════════════════════════════════════════════════════

If this is a non-trauma medical case, imaging_to_book and personnel_to_alert
should reflect the actual presentation (e.g. cardiology, pulmonology, ICU)
rather than trauma-bay/CT-whole-body defaults.
{CLINICAL_REFERENCE_A7}
{CLINICAL_REFERENCE_HTN_PULM_EDEMA}
{CLINICAL_REFERENCE_HYPERTENSIVE_EMERGENCY}
{CLINICAL_REFERENCE_CHEST_CARDIAC_TRAUMA}
{CLINICAL_REFERENCE_COMPARTMENT_SYNDROME}
{CLINICAL_REFERENCE_ANTICOAGULATION_REVERSAL}
{ANTICOAGULATION_FLAGGING_RULE}

Return ONLY valid JSON:
{{
  "trauma_bay_activation": {{
    "level": "Full_Trauma_Team|Partial_Team|Standard_Resus|Monitoring_Only|Not_Applicable_Medical_Case",
    "rationale": "...",
    "activate_immediately": true
  }},
  "prehospital_actions_already_done": [
    {{
      "action": "...",
      "clinical_significance_for_ed": "..."
    }}
  ],
  "personnel_to_alert": [
    {{
      "role": "...",
      "reason": "...",
      "urgency": "Immediate|Urgent|On_Standby"
    }}
  ],
  "equipment_to_prepare": [
    {{
      "equipment": "...",
      "reason": "...",
      "ready_by": "Patient_Arrival|5_minutes_before|10_minutes_before|Now"
    }}
  ],
  "blood_and_fluids": {{
    "blood_bank_alert": null,
    "blood_type": "Type_and_Screen|Crossmatch_2_units|Crossmatch_4_units|MTP_Activation|None",
    "iv_fluids_ready": ["..."],
    "massive_transfusion_protocol": false,
    "massive_transfusion_predictor_note": "Consider MTP-readiness if 2 or more of: penetrating mechanism, positive FAST, SBP <90, HR >120 are present",
    "transfusion_ratio_note": "If MTP is activated, note the target is a balanced ~1:1:1 ratio of PRBC:platelets:FFP rather than crystalloid-heavy or red-cell-only resuscitation; monitor for citrate-related hypocalcemia during massive transfusion",
    "adjuncts_to_consider": "Tranexamic acid is a commonly used early adjunct in major bleeding trauma per current evidence — informational for the treating team, not a dosing instruction",
    "bp_target_note": "If active uncontrolled hemorrhage pre-procedure, note permissive hypotension (systolic ~80-90 mmHg) as the usual target UNLESS concomitant severe traumatic brain injury, in which case a higher systolic BP/MAP target is preferred",
    "anticoagulation_reversal_readiness": "If patient is anticoagulated with a head injury or major bleeding, note that reversal-agent readiness and urgent physician notification are needed — this system does not select the specific agent or dose"
  }},
  "imaging_to_book": [
    {{
      "imaging": "CT_Head|CT_Chest|CT_Abdomen_Pelvis|CT_Whole_Body|XR_Chest|XR_Pelvis|FAST_Ultrasound|ECG|Echo|ABG|Not_Applicable",
      "priority": "Immediate|Within_5_min|Within_15_min",
      "reason": "..."
    }}
  ],
  "specialist_teams_to_notify": [
    {{
      "specialty": "...",
      "reason": "...",
      "urgency": "Immediate|Urgent|Routine"
    }}
  ],
  "icu_ot_prep": {{
    "icu_bed_hold": null,
    "operating_theatre_standby": null,
    "anaesthetics_alert": null,
    "reason": "Consider anaesthetics/critical-care alert if NIV may fail and advanced airway management could be needed, or if a suspected tamponade/tension pneumothorax may need urgent procedural intervention"
  }},
  "chest_cardiac_trauma_readiness": {{
    "applicable": "false unless flagged upstream",
    "equipment_note": "Chest tube/thoracostomy tray and/or pericardiocentesis setup readiness if tamponade or tension pneumothorax was flagged",
    "urgency": "Immediate|Urgent|Not_applicable"
  }},
  "compartment_syndrome_readiness": {{
    "applicable": "false unless flagged upstream",
    "note": "Orthopedic/surgical notification for possible compartment pressure measurement and fasciotomy readiness",
    "urgency": "Immediate|Urgent|Not_applicable"
  }},
  "handover_summary_for_ed": "...",
  "pre_arrival_checklist": ["..."]
}}
"""
        state["hospital_prep"] = await self._invoke(system, prompt)
        logger.info(f"{self.agent_id} · 📤 OUTPUT (Hospital Prep):")
        logger.info(json.dumps(state["hospital_prep"], indent=2, default=str))
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · HospitalPrepAgent — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# A9 · VITALS COMPARISON & IMPRESSION AGENT  (parallel, conditional)
# ============================================================

class VitalsComparisonAgent(BaseAgent):
    agent_id = "A9"

    async def run(self, state: EVISState) -> EVISState:
        logger.info(f"{self.agent_id} · VitalsComparisonAgent — START")
        t0 = datetime.now().timestamp()

        system = (
            "You are a senior emergency physician and clinical data analyst. "
            "Your role is to COMPARE vital signs extracted from device monitor images "
            "against vitals reported verbally in EMT voice dictations and doctor voice notes. "
            "You identify discrepancies, confirm or challenge verbal assessments with objective data, "
            "generate a clinical impression per vital parameter, and flag contraindications "
            "based on the comparison. "
            "You MUST base the current patient status on the most recent data source, "
            "which is typically the image-extracted monitor data if it is the latest timestamp. "
            "All timestamps in output must be IST (Asia/Kolkata). "
            "Always respond with valid JSON."
        )

        image_entries = state.get("image_entries") or []
        image_vitals_block = ""
        if image_entries:
            parts = []
            for idx, entry in enumerate(image_entries, start=1):
                ts_ist = iso_ist(entry.get("timestamp"))
                text   = entry.get("conversation", entry.get("extracted_text", "")).strip()
                parts.append(f"[Image Monitor Reading {idx} | IST: {ts_ist}]\n{text}")
            image_vitals_block = "\n\n".join(parts)
        else:
            image_vitals_block = "No image-extracted vitals available."

        logger.info(f"{self.agent_id} · 📥 INPUT PASSING TO A9:")
        logger.info("Image-Extracted Vitals Entries:")
        logger.info(image_vitals_block)
        logger.info("A1 Medical Entities (voice-reported vitals):")
        logger.info(json.dumps(state.get("medical_entities", {}), indent=2, default=str))
        logger.info("A2 Vitals Assessment:")
        logger.info(json.dumps(state.get("vitals_assessment", {}), indent=2, default=str))
        logger.info("A3 Injury Profile:")
        logger.info(json.dumps(state.get("injury_profile", {}), indent=2, default=str))
        logger.info("A4 Risk Stratification:")
        logger.info(json.dumps(state.get("risk_stratification", {}), indent=2, default=str))
        logger.info("Full Conversation:")
        logger.info(state.get("conversation", ""))

        prompt = f"""
You are comparing vital signs from TWO sources:
  SOURCE A: Image-extracted device monitor readings (objective, real-time)
  SOURCE B: EMT voice dictation and doctor voice notes (subjective, verbally reported)

Your job:
  1. Compare each vital parameter side-by-side
  2. Identify agreements and discrepancies
  3. Provide a clinical impression for each vital
  4. Flag any contraindications based on the combined picture
  5. Give an overall clinical impression of the patient based on ALL data

IMAGE-EXTRACTED MONITOR READINGS (Source A):
{image_vitals_block}

VOICE-REPORTED VITALS via A1 Medical Entities (Source B):
{json.dumps(state["medical_entities"], indent=2, default=str)}

VITALS ASSESSMENT FROM A2:
{json.dumps(state["vitals_assessment"], indent=2, default=str)}

INJURY PROFILE FROM A3:
{json.dumps(state["injury_profile"], indent=2, default=str)}

RISK STRATIFICATION FROM A4:
{json.dumps(state["risk_stratification"], indent=2, default=str)}

FULL CLINICAL TIMELINE (all timestamps in IST):
\"\"\"{state["conversation"]}\"\"\"

══════════════════════════════════════════════════════════
TASK — Vitals Comparison, Clinical Impression & Contraindications
══════════════════════════════════════════════════════════

Rules:
- If image data is more recent, it takes precedence for current status.
- If voice data says one thing and image monitor says another, flag as DISCREPANCY.
- For each vital, give: source_a_value, source_b_value, agreement/discrepancy, impression, action.
- Do NOT re-suggest not-approved actions.
- All timestamps in IST.
{STABILITY_LABELING_RULE}

Return ONLY valid JSON:
{{
  "comparison_timestamp_ist": "{state["timestamp"]}",
  "data_sources_compared": {{
    "image_monitor_readings_count": {len(image_entries)},
    "emt_voice_dictations_used": true,
    "doctor_voice_notes_used": true
  }},
  "vital_signs_comparison": [
    {{
      "vital_parameter": "Heart Rate (HR)",
      "image_monitor_value": null,
      "image_monitor_timestamp_ist": null,
      "voice_reported_value": null,
      "voice_reported_source": "emt_dictation|doctor_note|not_reported",
      "agreement": "Confirmed|Discrepancy|Not_Comparable|Only_Image|Only_Voice",
      "discrepancy_details": null,
      "normal_range": "60-100 bpm",
      "classification": "Normal|Bradycardia|Tachycardia|Critical|Unknown",
      "clinical_impression": "...",
      "contraindication_if_any": null,
      "recommended_action": "..."
    }},
    {{
      "vital_parameter": "SpO2 (Oxygen Saturation)",
      "image_monitor_value": null,
      "image_monitor_timestamp_ist": null,
      "voice_reported_value": null,
      "voice_reported_source": "emt_dictation|doctor_note|not_reported",
      "agreement": "Confirmed|Discrepancy|Not_Comparable|Only_Image|Only_Voice",
      "discrepancy_details": null,
      "normal_range": "≥95%",
      "classification": "Normal (≥95%)|Mild_Hypoxia (90-94%)|Moderate_Hypoxia (85-89%)|Severe_Hypoxia (<85%)|Unknown",
      "clinical_impression": "...",
      "contraindication_if_any": null,
      "recommended_action": "..."
    }},
    {{
      "vital_parameter": "Respiratory Rate (RR)",
      "image_monitor_value": null,
      "image_monitor_timestamp_ist": null,
      "voice_reported_value": null,
      "voice_reported_source": "emt_dictation|doctor_note|not_reported",
      "agreement": "Confirmed|Discrepancy|Not_Comparable|Only_Image|Only_Voice",
      "discrepancy_details": null,
      "normal_range": "12-20 bpm",
      "classification": "Normal (12-20)|Tachypnoeic (>20)|Bradypnoeic (<12)|Absent|Unknown",
      "clinical_impression": "...",
      "contraindication_if_any": null,
      "recommended_action": "..."
    }},
    {{
      "vital_parameter": "Blood Pressure (NIBP)",
      "image_monitor_value": null,
      "image_monitor_timestamp_ist": null,
      "voice_reported_value": null,
      "voice_reported_source": "emt_dictation|doctor_note|not_reported",
      "agreement": "Confirmed|Discrepancy|Not_Comparable|Only_Image|Only_Voice",
      "discrepancy_details": null,
      "normal_range": "Systolic 90-140 mmHg, Diastolic 60-90 mmHg",
      "classification": "Normal|Hypotensive|Hypertensive|Severely_Hypertensive (>180/120)|Critically_Low|Unknown",
      "clinical_impression": "...",
      "contraindication_if_any": null,
      "recommended_action": "..."
    }},
    {{
      "vital_parameter": "Temperature",
      "image_monitor_value": null,
      "image_monitor_timestamp_ist": null,
      "voice_reported_value": null,
      "voice_reported_source": "emt_dictation|doctor_note|not_reported",
      "agreement": "Confirmed|Discrepancy|Not_Comparable|Only_Image|Only_Voice",
      "discrepancy_details": null,
      "normal_range": "36.1-37.2 °C",
      "classification": "Normal|Hypothermia|Fever|Hyperpyrexia|Unknown",
      "clinical_impression": "...",
      "contraindication_if_any": null,
      "recommended_action": "..."
    }}
  ],
  "infusion_pump_data": {{
    "pumps_running": null,
    "pump_details": [
      {{
        "pump_id": "Pump 1",
        "status": "Running|Stopped|Alarming|Unknown",
        "flow_rate_ml_per_hr": null,
        "infused_ml": null,
        "clinical_note": "..."
      }}
    ],
    "total_fluid_infused_ml": null,
    "clinical_impression_of_infusions": "...",
    "action_required": "..."
  }},
  "ecg_data": {{
    "ecg_available": null,
    "ecg_leads_present": [],
    "rhythm_impression": "...",
    "action": "..."
  }},
  "discrepancies_summary": [
    {{
      "vital": "...",
      "image_says": "...",
      "voice_says": "...",
      "clinical_significance": "High|Moderate|Low",
      "recommended_resolution": "..."
    }}
  ],
  "overall_clinical_impression": {{
    "current_status_based_on_combined_data": "...",
    "consciousness_assessment": "Conscious|Unconscious|Confused|Semi_Conscious|Unknown",
    "haemodynamic_stability": "Stable|Unstable|Critical|Unknown",
    "respiratory_adequacy": "Adequate|Inadequate|Critical|Unknown",
    "trend_vs_initial_presentation": "Improved|Deteriorated|Stable|Fluctuating|Unknown",
    "trend_explanation": "...",
    "confidence_in_assessment": "High|Moderate|Low"
  }},
  "contraindications_from_vitals": [
    {{
      "contraindication": "...",
      "based_on_vital": "...",
      "vital_value": "...",
      "clinical_reason": "...",
      "severity": "Absolute|Relative|Caution",
      "alternative_approach": "..."
    }}
  ],
  "critical_alerts_from_comparison": [
    {{
      "alert": "...",
      "source": "image_monitor|voice_dictation|discrepancy",
      "urgency": "Immediate|Urgent|Monitor",
      "action": "..."
    }}
  ],
  "predict_hf_flag": {{
    "present": null,
    "value": null,
    "clinical_relevance": "..."
  }},
  "data_quality_assessment": {{
    "image_data_quality": "Complete|Partial|Minimal|Absent",
    "voice_data_quality": "Complete|Partial|Minimal|Absent",
    "overall_confidence": "High|Moderate|Low",
    "missing_vitals": ["..."]
  }}
}}
"""
        state["vitals_comparison"] = await self._invoke(system, prompt)
        logger.info(f"{self.agent_id} · 📤 OUTPUT (Vitals Comparison & Impression):")
        logger.info(json.dumps(state["vitals_comparison"], indent=2, default=str))
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · VitalsComparisonAgent — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


def _stub_vitals_comparison(state: EVISState) -> Dict:
    """Inserted instead of running A9 when the router determines there's no
    meaningful image-monitor data to compare against voice-reported vitals."""
    return {
        "comparison_timestamp_ist": state.get("timestamp", ""),
        "data_sources_compared": {
            "image_monitor_readings_count": 0,
            "emt_voice_dictations_used": True,
            "doctor_voice_notes_used": True,
        },
        "vital_signs_comparison": [],
        "infusion_pump_data": {"pumps_running": None, "pump_details": []},
        "ecg_data": {"ecg_available": None},
        "discrepancies_summary": [],
        "overall_clinical_impression": {
            "current_status_based_on_combined_data": (
                "Assessment based on voice-reported data only — no image-monitor "
                "readings were available for this patient to cross-check."
            ),
            "confidence_in_assessment": "Moderate",
        },
        "contraindications_from_vitals": [],
        "critical_alerts_from_comparison": [],
        "data_quality_assessment": {
            "image_data_quality": "Absent",
            "voice_data_quality": "Complete",
            "overall_confidence": "Moderate",
            "missing_vitals": [],
        },
        "_skipped": True,
        "_skip_reason": "A9 skipped by router (A0) — no meaningful image-monitor vitals available.",
    }


# ============================================================
# PARALLEL RUNNER — A5 + A6 + A7 + A9(conditional) concurrent
# ============================================================

async def run_parallel_agents(state: EVISState) -> EVISState:
    logger.info("Parallel layer (A5-A7 + A9?) — START")
    t0 = datetime.now().timestamp()

    a5 = ImmediateActionsAgent(llm)
    a6 = PrecautionsAgent(llm)
    a7 = HospitalPrepAgent(llm)

    run_a9 = state.get("run_a9", True)

    tasks = [a5.run(dict(state)), a6.run(dict(state)), a7.run(dict(state))]
    agent_names = ["A5", "A6", "A7"]

    if run_a9:
        a9 = VitalsComparisonAgent(llm)
        tasks.append(a9.run(dict(state)))
        agent_names.append("A9")

    results = await asyncio.gather(*tasks, return_exceptions=True)

    failed: List[Exception] = []

    for i, result in enumerate(results):
        name = agent_names[i]
        if isinstance(result, Exception):
            logger.error(f"{name} failed: {result}")
            state["errors"].append(f"{name}: {str(result)}")
            failed.append(result)
        else:
            state["agent_timings"].update(result.get("agent_timings", {}))
            if name == "A5":
                state["immediate_actions"] = result.get("immediate_actions")
            elif name == "A6":
                state["precautions"] = result.get("precautions")
            elif name == "A7":
                state["hospital_prep"] = result.get("hospital_prep")
            elif name == "A9":
                state["vitals_comparison"] = result.get("vitals_comparison")

    if not run_a9:
        state["vitals_comparison"] = _stub_vitals_comparison(state)
        state["agent_timings"]["A9"] = 0.0
        logger.info("A9 SKIPPED (router: no meaningful image vitals) — stub inserted, no LLM call")

    if failed:
        raise failed[0]

    _apply_immediate_actions_duplicate_safety_net(state)

    elapsed = round((datetime.now().timestamp() - t0) * 1000, 1)
    logger.info(f"Parallel layer — DONE ({elapsed}ms, A9 {'ran' if run_a9 else 'skipped'})")
    return state


# ============================================================
# A8 · TIMELINE SYNTHESIS AGENT
# ============================================================

class TimelineSynthesisAgent(BaseAgent):
    agent_id = "A8"

    async def run(self, state: EVISState) -> EVISState:
        logger.info(f"{self.agent_id} · TimelineSynthesisAgent — START")
        t0 = datetime.now().timestamp()

        role_scope = _role_scope_instruction(state, "A8 · Timeline Synthesis")

        system = (
            "You are the most senior emergency physician and team director. "
            "You synthesize all available clinical intelligence into a single, "
            "coordinated response plan anchored to real elapsed time. "
            "CRITICAL AUTHORITY RULE: The CURRENT PATIENT STATUS block in the timeline "
            "is the definitive ground truth. If a doctor note says the patient is conscious "
            "and stable, then consciousness = Conscious and trend = Improving or Stable. "
            "NEVER contradict the most recent clinical entry. "
            "The patient_snapshot.consciousness field MUST match the CURRENT STATUS block. "
            "The progression.overall_trend MUST reflect the change from Entry 1 to CURRENT STATUS. "
            "If the patient was unconscious in Entry 1 but conscious in CURRENT STATUS, "
            "overall_trend = Improving, NOT Deteriorating. "
            "CASE TYPE AWARENESS: if injury_profile._skipped is true, this is a non-trauma "
            "medical case — do NOT mention spinal injury, head injury, or internal bleeding "
            "anywhere in the output unless the actual clinical data independently supports it. "
            "You are fully aware of what has been approved and completed, what was rejected, "
            "and what treatments have already been performed this encounter. "
            "CLINICAL GROUNDING: do not describe shock severity using the legacy Class I-IV "
            "hemorrhage staging as if it were reliable — prefer trend, perfusion, mentation, and "
            "shock index framing from A2/A4. Do not suggest maximal/100% oxygen by default — "
            "note an appropriate SpO2 target instead (commonly ~94-98%, or ≥95% specifically for "
            "acute heart failure/pulmonary edema — never withhold oxygen there out of concern for "
            "CO2 retention). If spinal precautions are mentioned, note that a cervical collar alone "
            "is not complete immobilization — head blocks and torso/thigh straps to a board are "
            "also required. If fluid resuscitation for hemorrhagic shock is mentioned in "
            "hospital-facing sections, reflect permissive hypotension (target systolic ~80-90 mmHg "
            "pre-control) unless severe traumatic brain injury is present, and prefer balanced "
            "crystalloids over large-volume normal saline. If a diuretic was given without a "
            "vasodilator/nitrate in hypertensive acute pulmonary edema, flag this as a "
            "treatment-sequencing gap for physician review rather than silently omitting it. "
            "Apply the head-trauma, shock-differentiation, chest/cardiac-trauma, compartment-"
            "syndrome, elderly-trauma, anticoagulation-reversal, and acute-agitation reasoning "
            "supplied below whenever the case makes them relevant, and surface them as concrete "
            "flags rather than generic reassurance. "
            f"{role_scope} "
            "All timestamps in output must be IST (Asia/Kolkata). "
            "Your output saves lives. Always respond with valid JSON."
        )

        clinical_ctx    = _clinical_context_block(state)
        treatments_ctx  = _treatments_performed_block(state)
        completed       = state.get("completed_actions") or []
        not_approved    = state.get("not_approved_actions") or []
        prescribed_meds = state.get("prescribed_medications") or []
        treatments_list = state.get("treatments_performed") or []
        prescribed_meds_block = (
            "\n".join(f"  💊 {m}" for m in prescribed_meds)
            if prescribed_meds else "None recorded."
        )

        logger.info(f"{self.agent_id} · 📥 ALL AGENT OUTPUTS BEING PASSED TO A8:")
        logger.info("=" * 80)
        logger.info("A1 - Medical Entities:")
        logger.info(json.dumps(state.get("medical_entities", {}), indent=2, default=str))
        logger.info("=" * 80)
        logger.info("A2 - Vitals Assessment:")
        logger.info(json.dumps(state.get("vitals_assessment", {}), indent=2, default=str))
        logger.info("=" * 80)
        logger.info("A3 - Injury Profile:")
        logger.info(json.dumps(state.get("injury_profile", {}), indent=2, default=str))
        logger.info("=" * 80)
        logger.info("A4 - Risk Stratification:")
        logger.info(json.dumps(state.get("risk_stratification", {}), indent=2, default=str))
        logger.info("=" * 80)
        logger.info("A5 - Immediate Actions:")
        logger.info(json.dumps(state.get("immediate_actions", {}), indent=2, default=str))
        logger.info("=" * 80)
        logger.info("A6 - Precautions:")
        logger.info(json.dumps(state.get("precautions", {}), indent=2, default=str))
        logger.info("=" * 80)
        logger.info("A7 - Hospital Prep:")
        logger.info(json.dumps(state.get("hospital_prep", {}), indent=2, default=str))
        logger.info("=" * 80)
        logger.info("A9 - Vitals Comparison & Impression:")
        logger.info(json.dumps(state.get("vitals_comparison", {}), indent=2, default=str))
        logger.info("=" * 80)
        logger.info("Full Conversation:")
        logger.info(state.get("conversation", ""))
        logger.info("=" * 80)

        prompt = f"""
FINAL SYNTHESIS — Integrate ALL agent outputs into a unified emergency response plan.

This is a REAL emergency. The clinical input timeline spans multiple entries from
EMT voice dictations, doctor voice notes, and image-extracted data.
CASE TYPE (pre-classified by router): {state.get("case_type", "unknown")} | is_trauma={state.get("is_trauma")}
CARE SETTING (pre-classified by router): {state.get("care_setting", "unknown")}
Latest timestamp (IST): {state["timestamp"]}
Every second matters. Actions must be anchored to elapsed time in seconds.
All timestamps in output must be IST (Asia/Kolkata).

ALL AGENT OUTPUTS:
[A1 — Medical Entities]
{json.dumps(state["medical_entities"], indent=2, default=str)}

[A2 — Vitals Assessment]
{json.dumps(state["vitals_assessment"], indent=2, default=str)}

[A3 — Injury Profile — NOTE: may be a non-trauma stub with "_skipped": true]
{json.dumps(state["injury_profile"], indent=2, default=str)}

[A4 — Risk Stratification]
{json.dumps(state["risk_stratification"], indent=2, default=str)}

[A5 — Immediate Actions]
{json.dumps(state["immediate_actions"], indent=2, default=str)}

[A6 — Precautions]
{json.dumps(state["precautions"], indent=2, default=str)}

[A7 — Hospital Prep]
{json.dumps(state["hospital_prep"], indent=2, default=str)}

[A9 — Vitals Comparison & Impression — NOTE: may be a stub with "_skipped": true if no image data]
{json.dumps(state["vitals_comparison"], indent=2, default=str)}

FULL CLINICAL TIMELINE (all timestamps in IST):
\"\"\"{state["conversation"]}\"\"\"

PRIOR CLINICAL ACTIONS:
{clinical_ctx}

TREATMENTS/INTERVENTIONS ALREADY PERFORMED THIS ENCOUNTER:
{treatments_ctx}

COMPLETED (APPROVED) ACTIONS:
{json.dumps(completed, indent=2)}

NOT APPROVED ACTIONS:
{json.dumps(not_approved, indent=2)}

DOCTOR-PRESCRIBED MEDICATIONS (VERBATIM — MUST APPEAR IN OUTPUT UNCHANGED):
{prescribed_meds_block}

══════════════════════════════════════════════════════════
TASK — Unified Timestamp-Anchored Emergency Response Plan
══════════════════════════════════════════════════════════

{role_scope}

NON-TRAUMA CASE RULE: if A3's injury_profile has "_skipped": true, this patient
has NO trauma mechanism. Do not mention spinal precautions, head injury, or
internal bleeding anywhere in sbar_summary, top_3_precautions_summary,
deterioration_watch, or timestamp_based_response_plan. Base everything on the
actual medical presentation instead (respiratory/cardiac/neuro/etc. per A2/A4).

TREATMENTS-ALREADY-PERFORMED RULE (CRITICAL):
{TREATMENTS_ALREADY_PERFORMED_RULE}
Populate "treatments_already_performed" from the block above — if that block
lists anything, this array MUST be non-empty and MUST name each treatment,
what it targets, and the effect observed if stated (e.g. "SpO2 improved from
67% to 97% after BiPAP").

STABILITY LABELING RULE (CRITICAL):
{STABILITY_LABELING_RULE}

DIAGNOSTIC HEDGING RULE (CRITICAL):
{DIAGNOSTIC_HEDGING_RULE}

EVIDENCE TRACEABILITY RULE (CRITICAL):
{EVIDENCE_TRACEABILITY_RULE}

NO UNSUPPORTED RISK INFERENCE RULE (CRITICAL):
{NO_UNSUPPORTED_RISK_INFERENCE_RULE}
{CLINICAL_REFERENCE_HTN_PULM_EDEMA}
{CLINICAL_REFERENCE_HYPERTENSIVE_EMERGENCY}
{CLINICAL_REFERENCE_HEAD_TRAUMA}
{CLINICAL_REFERENCE_SHOCK_DIFFERENTIATION}
{CLINICAL_REFERENCE_SEPSIS}
{CLINICAL_REFERENCE_CHEST_CARDIAC_TRAUMA}
{CLINICAL_REFERENCE_COMPARTMENT_SYNDROME}
{CLINICAL_REFERENCE_ELDERLY_TRAUMA}
{CLINICAL_REFERENCE_ANTICOAGULATION_REVERSAL}
{ANTICOAGULATION_FLAGGING_RULE}
{CLINICAL_REFERENCE_ACUTE_AGITATION}

CLINICAL ACTION HISTORY RULES:
1. For each APPROVED action or treatment already performed: acknowledge it was
   done, explain what changed because of it, and describe why the next
   recommendation logically follows from it. Never claim a parameter is
   "resolved" if it is only in range because of an ongoing intervention.
2. For each NOT APPROVED action: describe the clinical implication of it NOT
   being done, and adjust recommendations to compensate where possible.
3. Never re-suggest a NOT APPROVED action or a treatment already performed.
4. Never re-suggest an already APPROVED+DONE action as if it hasn't been done.

VITALS COMPARISON RULES (from A9):
- If A9 was skipped (_skipped: true), state in vitals_comparison_summary that no
  image-monitor data was available — do not invent a comparison.
- Otherwise use the A9 vitals_comparison output to cross-validate current status.
- If A9 reports a discrepancy between image monitor and voice data, acknowledge it.
- The overall_clinical_impression from A9 must be reflected in patient_snapshot.
- If A9 trend_vs_initial_presentation = Improved, then progression.overall_trend = Improving,
  but this does NOT automatically mean status_label = "Stable" — see STABILITY_LABELING_RULE.
- If A9 reports contraindications, include them in top_3_precautions_summary.

For the "progression" field:
  - Analyse EACH clinical entry chronologically
  - For each milestone, describe the actual status text from that entry — do not invent it
  - change_from_previous: compare ONLY the actual text of each entry to the previous one
  - If Entry 1 says "unconscious" and Entry 2 (doctor note) says "conscious and stable":
      Entry 2 change_from_previous = "Improved" and overall_trend = "Improving"
  - overall_trend MUST reflect the direction from Entry 1 → CURRENT STATUS
  - NEVER mark overall_trend as Deteriorating if the final entry describes improvement or stability
{ANTI_DUPLICATION_RULE_A8}
{ANTI_REPETITION_RULE}

TIMELINE / DETERIORATION-WATCH / HANDOVER SPECIFICITY (CRITICAL):
- timestamp_based_response_plan: each entry must name the SPECIFIC parameters
  being reassessed for THIS patient, not a generic "continue monitoring". For
  example — Immediate: "Continue BiPAP; reassess work of breathing, RR, and
  SpO2 on current settings; recheck BP given severe hypertension." Every 5
  minutes: "Reassess work of breathing, RR, HR, BP, and mental status; watch
  for NIV intolerance." Ongoing/transport: "Continuous monitoring per
  continuous_monitoring_plan; early notification of receiving team/physician
  of any deterioration."
- deterioration_watch: early_warning_signs and immediate_escalation_triggers
  must be specific to this patient's actual presentation (e.g. for a patient
  on NIV with severe hypertension: increasing respiratory rate, increasing
  work of breathing, falling SpO2 despite NIV, respiratory fatigue,
  decreasing GCS, new arrhythmias, persistent severe hypertension or any
  hypotension after treatment) — not a generic checklist reused regardless
  of case type. For a chest/cardiac trauma, compartment syndrome, head
  injury, or anticoagulation flag from upstream agents, include the specific
  red-flag pattern (e.g. "new tracheal deviation or absent breath sounds",
  "pain with passive stretch worsening despite a present distal pulse",
  "GCS drop of 2+ points", "any new bleeding in an anticoagulated patient")
  rather than a generic "watch for deterioration" line.
- ed_handover_brief must include, in order: presenting complaint; initial
  vital signs; severity of initial presentation (e.g. severe hypoxia on room
  air); treatments already performed and response; working clinical
  impression (hedged, per DIAGNOSTIC_HEDGING_RULE); current status (per
  STABILITY_LABELING_RULE); ongoing concerns / escalation triggers.
- confidence_of_suggestions.limiting_factors: list any clinically significant
  missing/ambiguous data point (e.g. no ABG, no CXR, unclear chronic BP
  baseline, unclear anticoagulant timing) as something the treating clinician
  should be asked to confirm, rather than assumed.

Return ONLY valid JSON:
{{
  "sbar_summary": {{
    "situation": "...",
    "background": "...",
    "assessment": "...",
    "recommendation": "..."
  }},
  "treatments_already_performed": [
    {{
      "treatment": "...",
      "targets": "...",
      "effect_observed": "...",
      "ongoing_monitoring_rationale": "..."
    }}
  ],
  "patient_snapshot": {{
    "age_gender": "...",
    "presenting_complaint": "...",
    "mechanism": "...",
    "consciousness": "MUST reflect CURRENT STATUS block — e.g. Conscious if doctor note says so",
    "status_label": "Improved_after_intervention_but_critical|Stable|Unstable|Critical — never 'Stable' if an active intervention is required or vitals remain deranged; see STABILITY_LABELING_RULE",
    "still_deranged_parameters": ["..."],
    "parameters_improved_by_intervention": ["..."],
    "triage_colour": "Red|Yellow|Green|Black",
    "criticality_score": 0,
    "overall_risk": "...",
    "vitals_confirmed_by_monitor": true,
    "monitor_vitals_summary": "..."
  }},
  "RULE_patient_snapshot": "consciousness, status_label, and overall_risk MUST come from CURRENT STATUS block, not Entry 1, and status_label must never be 'Stable' when an active intervention is required or vitals remain deranged",
  "clinical_impression": {{
    "suspected_diagnoses": ["..."],
    "confirmed_diagnoses": [],
    "supporting_findings": ["..."],
    "note": "Suspected only — not confirmed unless explicitly documented by a clinician in the input."
  }},
  "hypertensive_emergency_assessment": {{
    "present": null,
    "bp": "...",
    "interarm_difference_mmhg": null,
    "end_organ_evidence": ["..."],
    "emergency_vs_urgency": "Emergency (end-organ evidence present) | Urgency (severe BP, no end-organ evidence) | Not_applicable",
    "recommendation": "Frequent BP reassessment; notify treating physician for BP management if emergency criteria are met; favor gradual correction over emergent parenteral therapy if urgency only"
  }},
  "chest_cardiac_trauma_flags": {{
    "applicable": "false unless flagged upstream by A2/A3",
    "tension_pneumothorax_suspected": null,
    "cardiac_tamponade_suspected": null,
    "massive_hemothorax_suspected": null,
    "note": "Absence of classic signs (distended neck veins, Beck's triad) never excludes these — see clinical reference"
  }},
  "compartment_syndrome_flag": {{
    "applicable": "false unless flagged upstream",
    "risk_level": "None|Low|Moderate|High|Unknown",
    "note": "A present distal pulse does NOT exclude compartment syndrome"
  }},
  "elderly_trauma_modifier": {{
    "applicable": "false unless patient is elderly",
    "occult_shock_caution_applied": null,
    "undertriage_caution_applied": null
  }},
  "anticoagulation_reversal_assessment": {{
    "on_anticoagulant_or_antiplatelet": null,
    "agent_if_named": null,
    "timing_context": "home_medication|given_this_encounter|unclear",
    "bleeding_or_head_injury_present": null,
    "flag_for_physician": "Urgent reversal-decision notification needed|Note only|Not_applicable",
    "note": "This system does not select a specific reversal agent or dose — it flags the need for urgent physician review"
  }},
  "clinical_action_history_summary": {{
    "completed_count": {len(completed)},
    "not_approved_count": {len(not_approved)},
    "completed_actions": {json.dumps(completed)},
    "not_approved_actions": {json.dumps(not_approved)},
    "clinical_effect_of_completed": "...",
    "clinical_risk_of_not_approved": "..."
  }},
  "vitals_comparison_summary": {{
    "image_monitor_confirms_stability": null,
    "key_discrepancies": ["..."],
    "overall_impression_from_comparison": "...",
    "contraindications_flagged_by_vitals": ["..."]
  }},
"doctor_prescribed_medications": {json.dumps(prescribed_meds)},
  "single_most_critical_action_right_now": "...",
  "continuous_monitoring_plan": [
    "..."
  ],
  "escalation_plan": {{
    "current_support": "...",
    "failure_triggers": ["..."],
    "next_level_of_care": "...",
    "note": "Escalation criteria only — not a current recommendation to escalate unless triggers are met"
  }},
  "timestamp_based_response_plan": [
    {{
      "elapsed_seconds_from_dictation": "0",
      "clock_label": "T+0s — RIGHT NOW",
      "phase": "Immediate Management",
      "prior_action_context": "...",
      "vitals_context": "...",
      "priority_actions": ["..."],
      "monitoring": ["..."],
      "alert_if": ["..."]
    }},
    {{
      "elapsed_seconds_from_dictation": "300",
      "clock_label": "T+5min — Reassess",
      "phase": "Reassessment Checkpoint",
      "prior_action_context": "No change from previous (or new info)",
      "vitals_context": "No change from previous (or new info)",
      "priority_actions": ["..."],
      "monitoring": ["Per continuous_monitoring_plan"],
      "alert_if": ["As above"]
    }},
    {{
      "elapsed_seconds_from_dictation": "600",
      "clock_label": "T+10min",
      "phase": "Ongoing Monitoring",
      "prior_action_context": "No change from previous (or new info)",
      "vitals_context": "No change from previous (or new info)",
      "priority_actions": ["..."],
      "monitoring": ["Per continuous_monitoring_plan"],
      "alert_if": ["As above"]
    }},
    {{
      "elapsed_seconds_from_dictation": "1800",
      "clock_label": "T+30min — Handover/Transport Checkpoint",
      "phase": "Handover Preparation",
      "prior_action_context": "No change from previous (or new info)",
      "vitals_context": "No change from previous (or new info)",
      "priority_actions": ["..."],
      "monitoring": ["Per continuous_monitoring_plan"],
      "alert_if": ["As above"]
    }}
  ],
  "top_3_precautions_summary": ["..."],
  "ed_handover_brief": "...",
  "deterioration_watch": {{
    "early_warning_signs": ["..."],
    "immediate_escalation_triggers": ["..."],
    "deterioration_likely_if": ["..."]
  }},
  "specialist_alerts": [
    {{
      "specialty": "...",
      "reason": "...",
      "timing": "Alert_Now|Alert_on_Arrival|Alert_if_Deteriorates"
    }}
  ],
  "confidence_of_suggestions": {{
    "level": "High|Moderate|Low",
    "limiting_factors": ["..."],
    "data_quality_from_all_sources": "Complete|Partial|Minimal",
    "sources_used": {{
      "emt_voice_dictations": 0,
      "doctor_voice_notes": 0,
      "image_extracted_records": 0
    }}
  }},
  "progression": {{
    "dictation_count": 0,
    "overall_trend": "Stable|Deteriorating|Improving|Rapidly_Deteriorating|Fluctuating|Unknown",
    "trend_summary": "...",
    "milestones": [
      {{
        "entry_number": 1,
        "source": "emt_voice_dictation|doctor_voice_note|image_extracted",
        "timestamp_ist": "...",
        "status_at_this_time": "...",
        "key_clinical_findings": ["..."],
        "change_from_previous": "N/A — first entry|Worsened|Improved|Stable|New finding appeared|Finding resolved",
        "clinical_actions_at_this_time": "..."
      }}
    ],
    "critical_changes_detected": ["..."],
    "current_status": "...",
    "clinical_trajectory_note": "..."
  }},
  "case_type": "{state.get("case_type", "unknown")}",
  "is_trauma": {json.dumps(state.get("is_trauma"))},
  "care_setting": "{state.get("care_setting", "unknown")}",
  "generated_at_ist": "{now_ist().isoformat()}",
  "dictation_timestamp_ist": "{state["timestamp"]}"
}}
"""
        state["timeline_suggestions"] = await self._invoke(system, prompt)
        state["timeline_suggestions"]["doctor_prescribed_medications"] = prescribed_meds
        if not state["timeline_suggestions"].get("treatments_already_performed") and treatments_list:
            # Safety net: if the model still returned an empty list despite the
            # rule above, populate it directly from the extracted facts rather
            # than silently shipping an empty section.
            state["timeline_suggestions"]["treatments_already_performed"] = [
                {"treatment": t, "targets": "unspecified", "effect_observed": "unspecified",
                 "ongoing_monitoring_rationale": "Documented in encounter text; verify details with treating clinician."}
                for t in treatments_list
            ]

        _apply_timeline_duplicate_safety_net(state)
        _sanitize_final_output_risk_flags(state)

        logger.info(f"{self.agent_id} · 📤 OUTPUT (Timeline Synthesis):")
        logger.info(json.dumps(state["timeline_suggestions"], indent=2, default=str))
        state["agent_timings"][self.agent_id] = self._elapsed(t0)
        logger.info(f"{self.agent_id} · TimelineSynthesisAgent — DONE ({state['agent_timings'][self.agent_id]}ms)")
        return state


# ============================================================
# SIMPLE_SYNTH · Single-call path for trivial cases
# (bypasses A1-A9 entirely — router decided this is simple
#  enough that one consolidated call is sufficient)
# ============================================================

async def simple_case_synthesis(state: EVISState) -> EVISState:
    logger.info("SIMPLE_SYNTH · single consolidated call — START (bypassing A1-A9)")
    t0 = datetime.now().timestamp()

    role_scope     = _role_scope_instruction(state, "SIMPLE_SYNTH")
    treatments_ctx = _treatments_performed_block(state)
    treatments_list = state.get("treatments_performed") or []

    system = (
        "You are a senior emergency physician giving a fast, complete assessment "
        "for a straightforward, single-entry emergency case. Reason directly from "
        "the timeline without needing separate extraction passes — but be exactly "
        "as clinically careful and complete as a full multi-agent workup would be. "
        "If injury/trauma is not indicated by the data, do not invent trauma content "
        "(no spinal/head/internal-bleeding precautions for a purely medical case). "
        f"{role_scope} "
        "CLINICAL GROUNDING: do not stage hemorrhage severity with the legacy Class I-IV "
        "scheme; reason from perfusion signs, mentation, and trend instead. Prefer jaw "
        "thrust over head-tilt-chin-lift when c-spine injury is possible. Do not default "
        "to maximal oxygen — state an appropriate SpO2 target (commonly ~94-98%, or ≥95% "
        "specifically for acute heart failure/pulmonary edema). Basic "
        "EMTs do not give IV fluids in a prehospital_ems setting, so do not suggest fluid "
        "boluses in that setting; when hospital-level fluids are given, prefer balanced "
        "crystalloids over large-volume normal saline. "
        "NEVER omit a treatment already documented as performed (e.g. BiPAP/NIV, IV "
        "medications, cardiac monitor connected) regardless of role scope — reporting what "
        "has already been done is always in scope, for any care setting. "
        "NEVER label the patient 'Stable' if an active organ-supportive intervention is "
        "required to hold a vital in range, or if other vitals remain significantly deranged. "
        "NEVER present a suspected diagnosis (e.g. suspected acute cardiogenic pulmonary "
        "edema) as confirmed unless a clinician has explicitly documented it. "
        "If a diuretic was given without a documented vasodilator/nitrate for hypertensive "
        "acute pulmonary edema, flag this as a treatment-sequencing gap for physician review. "
        "Actively screen for tension pneumothorax/cardiac tamponade, compartment syndrome, "
        "head-trauma deterioration, elderly occult shock, and anticoagulation-related bleeding "
        "risk whenever the presentation makes them plausible, per the clinical references below, "
        "and never use the absence of a single classic sign (e.g. Beck's triad, a lost pulse) to "
        "rule any of them out. For an agitated patient, prioritize verbal de-escalation and "
        "safety over restraint or medication as first-line steps. "
        "Always respond with valid JSON."
    )

    clinical_ctx = _clinical_context_block(state)

    prompt = f"""
SIMPLE CASE — single consolidated assessment (router determined this case does
not need the full 9-agent workup: single/short entry, nothing to reconcile,
no prior clinical actions).

CLINICAL TIMELINE:
\"\"\"{state["conversation"]}\"\"\"

CASE TYPE (pre-classified): {state.get("case_type")}
IS TRAUMA: {state.get("is_trauma")}
CARE SETTING (pre-classified): {state.get("care_setting", "unknown")}

PRIOR CLINICAL ACTIONS:
{clinical_ctx}

TREATMENTS/INTERVENTIONS ALREADY PERFORMED THIS ENCOUNTER:
{treatments_ctx}
{TREATMENTS_ALREADY_PERFORMED_RULE}
{STABILITY_LABELING_RULE}
{DIAGNOSTIC_HEDGING_RULE}
{EVIDENCE_TRACEABILITY_RULE}
{NO_UNSUPPORTED_RISK_INFERENCE_RULE}
{CLINICAL_REFERENCE_HTN_PULM_EDEMA}
{CLINICAL_REFERENCE_HYPERTENSIVE_EMERGENCY}
{CLINICAL_REFERENCE_HEAD_TRAUMA}
{CLINICAL_REFERENCE_SHOCK_DIFFERENTIATION}
{CLINICAL_REFERENCE_SEPSIS}
{CLINICAL_REFERENCE_CHEST_CARDIAC_TRAUMA}
{CLINICAL_REFERENCE_COMPARTMENT_SYNDROME}
{CLINICAL_REFERENCE_ELDERLY_TRAUMA}
{CLINICAL_REFERENCE_ANTICOAGULATION_REVERSAL}
{ANTICOAGULATION_FLAGGING_RULE}
{CLINICAL_REFERENCE_ACUTE_AGITATION}

Produce a complete but appropriately lighter version of the standard output
(3-4 timeline entries instead of 6, since this is a simple case). Each
timeline entry, deterioration-watch item, and the ED handover brief must be
SPECIFIC to this patient's actual findings — never generic placeholders like
bare "continue monitoring".

{ANTI_DUPLICATION_RULE_A8}
{ANTI_REPETITION_RULE}

Return ONLY valid JSON with this exact shape:
{{
  "sbar_summary": {{"situation": "...", "background": "...", "assessment": "...", "recommendation": "..."}},
  "treatments_already_performed": [
    {{"treatment": "...", "targets": "...", "effect_observed": "...", "ongoing_monitoring_rationale": "..."}}
  ],
  "patient_snapshot": {{
    "age_gender": "...", "presenting_complaint": "...", "mechanism": "...", "consciousness": "...",
    "status_label": "Improved_after_intervention_but_critical|Stable|Unstable|Critical — never 'Stable' if an active intervention is required or vitals remain deranged",
    "still_deranged_parameters": ["..."],
    "parameters_improved_by_intervention": ["..."],
    "triage_colour": "Red|Yellow|Green|Black", "criticality_score": 0,
    "overall_risk": "...", "vitals_confirmed_by_monitor": false, "monitor_vitals_summary": "..."
  }},
  "clinical_impression": {{
    "suspected_diagnoses": ["..."],
    "confirmed_diagnoses": [],
    "supporting_findings": ["..."],
    "note": "Suspected only — not confirmed unless explicitly documented by a clinician in the input."
  }},
  "hypertensive_emergency_assessment": {{
    "present": null, "bp": "...", "interarm_difference_mmhg": null, "end_organ_evidence": ["..."],
    "emergency_vs_urgency": "Emergency (end-organ evidence present) | Urgency (severe BP, no end-organ evidence) | Not_applicable",
    "recommendation": "Frequent BP reassessment; notify treating physician for BP management if emergency criteria are met; favor gradual correction if urgency only"
  }},
  "chest_cardiac_trauma_flags": {{
    "applicable": "false unless plausible from the presentation",
    "tension_pneumothorax_suspected": null,
    "cardiac_tamponade_suspected": null,
    "massive_hemothorax_suspected": null,
    "note": "Absence of classic signs never excludes these"
  }},
  "compartment_syndrome_flag": {{
    "applicable": "false unless plausible from the presentation",
    "risk_level": "None|Low|Moderate|High|Unknown",
    "note": "A present distal pulse does NOT exclude compartment syndrome"
  }},
  "elderly_trauma_modifier": {{
    "applicable": "false unless patient is elderly",
    "occult_shock_caution_applied": null,
    "undertriage_caution_applied": null
  }},
  "anticoagulation_reversal_assessment": {{
    "on_anticoagulant_or_antiplatelet": null,
    "agent_if_named": null,
    "timing_context": "home_medication|given_this_encounter|unclear",
    "bleeding_or_head_injury_present": null,
    "flag_for_physician": "Urgent reversal-decision notification needed|Note only|Not_applicable"
  }},
  "single_most_critical_action_right_now": "...",
  "immediate_actions_bls_scope": ["..."],
  "continuous_monitoring_plan": ["..."],
  "escalation_plan": {{
    "current_support": "...",
    "failure_triggers": ["..."],
    "next_level_of_care": "...",
    "note": "Escalation criteria only — not a current recommendation unless triggers are met"
  }},
  "timestamp_based_response_plan": [
    {{"elapsed_seconds_from_dictation": "0", "clock_label": "T+0s — RIGHT NOW", "phase": "Immediate Management",
      "vitals_context": "...", "priority_actions": ["..."], "monitoring": ["..."], "alert_if": ["..."]}},
    {{"elapsed_seconds_from_dictation": "300", "clock_label": "T+5min — Reassess", "phase": "Reassessment",
      "vitals_context": "No change from previous", "priority_actions": ["..."],
      "monitoring": ["Per continuous_monitoring_plan"], "alert_if": ["As above"]}},
    {{"elapsed_seconds_from_dictation": "1800", "clock_label": "T+30min", "phase": "Ongoing/Handover",
      "vitals_context": "No change from previous", "priority_actions": ["..."],
      "monitoring": ["Per continuous_monitoring_plan"], "alert_if": ["As above"]}}
  ],
  "top_3_precautions_summary": ["..."],
  "ed_handover_brief": "... (must include: presenting complaint; initial vitals; severity of initial presentation; treatments already performed and response; working clinical impression (hedged); current status; ongoing concerns/escalation triggers)",
  "deterioration_watch": {{"early_warning_signs": ["..."], "immediate_escalation_triggers": ["..."], "deterioration_likely_if": ["..."]}},
  "specialist_alerts": [],
  "confidence_of_suggestions": {{"level": "Moderate", "limiting_factors": ["Single entry — full multi-agent workup not triggered"], "data_quality_from_all_sources": "Partial"}},
  "progression": {{"dictation_count": 1, "overall_trend": "Stable", "trend_summary": "...", "milestones": [], "critical_changes_detected": [], "current_status": "...", "clinical_trajectory_note": "..."}},
  "case_type": "{state.get("case_type", "unknown")}",
  "is_trauma": {json.dumps(state.get("is_trauma"))},
  "care_setting": "{state.get("care_setting", "unknown")}",
  "generated_at_ist": "{now_ist().isoformat()}",
  "dictation_timestamp_ist": "{state["timestamp"]}"
}}
"""
    response = await llm_synthesis.ainvoke([
        SystemMessage(content=system), HumanMessage(content=prompt)
    ])
    result = parse_llm_json(response.content)
    result["doctor_prescribed_medications"] = state.get("prescribed_medications") or []

    if not result.get("treatments_already_performed") and treatments_list:
        # Safety net — same rationale as in A8: never ship an empty section
        # when we know for a fact something was documented.
        result["treatments_already_performed"] = [
            {"treatment": t, "targets": "unspecified", "effect_observed": "unspecified",
             "ongoing_monitoring_rationale": "Documented in encounter text; verify details with treating clinician."}
            for t in treatments_list
        ]

    state["timeline_suggestions"] = result

    _apply_timeline_duplicate_safety_net(state)
    _sanitize_final_output_risk_flags(state)

    # Fill lightweight stubs for downstream fields the API response expects,
    # so /voice-suggestions output shape is identical whether it took the
    # full pipeline or the simple path.
    state["immediate_actions"] = {
        "timestamp_anchored_actions": [],
        "treatments_already_performed_acknowledged": treatments_list,
        "most_critical_single_action": result.get("single_most_critical_action_right_now", ""),
        "_skipped": True, "_skip_reason": "SIMPLE_SYNTH path — folded into timeline_suggestions",
    }
    state["precautions"] = {
        "critical_do_not_list": [],
        "highest_priority_precaution": (result.get("top_3_precautions_summary") or [""])[0],
        "_skipped": True, "_skip_reason": "SIMPLE_SYNTH path — folded into timeline_suggestions",
    }
    state["hospital_prep"] = {
        "handover_summary_for_ed": result.get("ed_handover_brief", ""),
        "_skipped": True, "_skip_reason": "SIMPLE_SYNTH path — folded into timeline_suggestions",
    }
    state["vitals_comparison"] = _stub_vitals_comparison(state)
    state["injury_profile"] = _stub_injury_profile() if not state.get("is_trauma") else {}
    state["risk_stratification"] = {
        "criticality_score": {"score": result.get("patient_snapshot", {}).get("criticality_score", 0)},
        "overall_risk_level": result.get("patient_snapshot", {}).get("overall_risk", "Unknown"),
        "hypertensive_emergency_flag": result.get("hypertensive_emergency_assessment", {}),
        "_skipped": True, "_skip_reason": "SIMPLE_SYNTH path — folded into timeline_suggestions",
    }

    elapsed = round((datetime.now().timestamp() - t0) * 1000, 1)
    state["agent_timings"]["SIMPLE_SYNTH"] = elapsed
    logger.info(f"SIMPLE_SYNTH — DONE ({elapsed}ms, 1 LLM call instead of up to 8)")
    return state


# ============================================================
# WORKFLOW GRAPH  (adaptive — A0 routes to full pipeline or
# the simple single-call path)
# ============================================================

def _route_from_a0(state: EVISState) -> str:
    if not state.get("run_full_pipeline", True):
        return "SIMPLE_SYNTH"
    return "A1"


async def a2_with_sanitizer(state: EVISState) -> EVISState:
    """Wraps VitalsAgent with the deterministic unsupported-risk-flag check."""
    state = await VitalsAgent(llm).run(state)
    _sanitize_unsupported_risk_flags(state)
    return state


async def a4_with_sanitizer(state: EVISState) -> EVISState:
    """Wraps RiskAgent with the deterministic unsupported-risk-flag check."""
    state = await RiskAgent(llm).run(state)
    _sanitize_unsupported_risk_flags(state)
    return state


def create_evis_workflow() -> Any:
    workflow = StateGraph(EVISState)

    workflow.add_node("A0",              CaseRouterAgent(llm).run)
    workflow.add_node("A1",              MedicalEntityAgent(llm).run)
    workflow.add_node("A2",              a2_with_sanitizer)
    workflow.add_node("A3",              a3_conditional)
    workflow.add_node("A4",              a4_with_sanitizer)
    workflow.add_node("A5_A9_PARALLEL",  run_parallel_agents)
    workflow.add_node("A8",              TimelineSynthesisAgent(llm_synthesis).run)
    workflow.add_node("SIMPLE_SYNTH",    simple_case_synthesis)

    workflow.set_entry_point("A0")
    workflow.add_conditional_edges(
        "A0", _route_from_a0, {"A1": "A1", "SIMPLE_SYNTH": "SIMPLE_SYNTH"}
    )
    workflow.add_edge("A1", "A2")
    workflow.add_edge("A2", "A3")
    workflow.add_edge("A3", "A4")
    workflow.add_edge("A4", "A5_A9_PARALLEL")
    workflow.add_edge("A5_A9_PARALLEL", "A8")
    workflow.add_edge("A8", END)
    workflow.add_edge("SIMPLE_SYNTH", END)

    return workflow.compile()


evis_workflow = create_evis_workflow()


# ============================================================
# DATA FETCHING — All MongoDB Sources
# ============================================================

async def _fetch_all_clinical_entries(patient_id: str) -> tuple[List[Dict], int, int, int, List[Dict]]:
    """
    Fetch and merge clinical data from all three MongoDB collections.
    Returns (merged_sorted_entries, emt_count, doctor_note_count, image_count, raw_image_entries).
    """
    entries: List[Dict]        = []
    raw_image_entries: List[Dict] = []

    # ── 1. EMT Voice Dictations ──────────────────────────────
    try:
        cursor   = voice_dictations_collection.find(
            {"patient_id": patient_id}, {"_id": 0}
        ).sort("timestamp", 1)
        emt_docs = await cursor.to_list(length=None)
    except Exception as e:
        logger.error(f"Failed to fetch voice_dictations: {e}")
        emt_docs = []

    emt_count = 0
    for doc in emt_docs:
        conv = (doc.get("conversation") or "").strip()
        ts   = doc.get("timestamp")
        if conv and ts:
            entries.append({**doc, "_source": "voice_dictation", "timestamp": ts})
            emt_count += 1
        else:
            logger.warning(f"Skipping voice_dictation — missing conversation or timestamp: {list(doc.keys())}")

    logger.info(f"voice_dictations: {emt_count} valid entries for patient {patient_id}")

    # ── 2. Doctor Voice Notes ────────────────────────────────
    try:
        cursor      = doctor_voice_notes_collection_forprocessing.find(
            {"patient_id": patient_id}, {"_id": 0}
        ).sort("timestamp", 1)
        doctor_docs = await cursor.to_list(length=None)
    except Exception as e:
        logger.error(f"Failed to fetch doctor_voice_notes: {e}")
        doctor_docs = []

    doctor_note_count = 0
    for doc in doctor_docs:
        conv = (doc.get("conversation") or "").strip()
        ts   = doc.get("timestamp")
        if conv and ts:
            entries.append({**doc, "_source": "doctor_voice_note", "timestamp": ts})
            doctor_note_count += 1
        else:
            logger.warning(f"Skipping doctor_voice_note — missing data: {list(doc.keys())}")

    logger.info(f"doctor_voice_notes: {doctor_note_count} valid entries for patient {patient_id}")

    # ── 3. Image-Extracted Clinical Data ────────────────────
    try:
        cursor     = Image_Extracted_Ambulance_collection.find(
            {"patient_id": patient_id}, {"_id": 0}
        ).sort("timestamp", 1)
        image_docs = await cursor.to_list(length=None)
    except Exception as e:
        logger.error(f"Failed to fetch Image_Extracted_Ambulance: {e}")
        image_docs = []

    image_count = 0
    for doc in image_docs:
        text = (doc.get("extracted_text") or "").strip()
        ts   = doc.get("timestamp")
        if text and ts:
            normalized = {**doc, "_source": "image_extracted", "conversation": text, "timestamp": ts}
            entries.append(normalized)
            raw_image_entries.append(normalized)
            image_count += 1
        else:
            logger.warning(f"Skipping image_extracted — missing text or timestamp: {list(doc.keys())}")

    logger.info(f"Image_Extracted_Ambulance: {image_count} valid entries for patient {patient_id}")

    if emt_count == 0 and doctor_note_count == 0:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No valid clinical data found for patient {patient_id}. "
                "Both voice_dictations and doctor_voice_notes are empty or missing. "
                f"Image-extracted records found: {image_count}."
            ),
        )

    def _ts_sort_key(entry: Dict) -> str:
        ts = entry.get("timestamp")
        if ts is None:
            return ""
        if hasattr(ts, "isoformat"):
            return ts.isoformat()
        return str(ts)

    entries_sorted = sorted(entries, key=_ts_sort_key)

    logger.info(
        f"Total clinical entries for {patient_id}: {len(entries_sorted)} "
        f"(EMT={emt_count}, Doctor={doctor_note_count}, Image={image_count})"
    )

    return entries_sorted, emt_count, doctor_note_count, image_count, raw_image_entries


# ============================================================
# PROCESS SINGLE DICTATION  (used by /latest endpoint only)
# ============================================================

async def process_single_dictation(
    patient_id: str,
    dictation: Dict,
    include_intermediates: bool = False,
) -> Dict:
    start_ms = datetime.now().timestamp() * 1000

    conversation = dictation.get("conversation", "").strip()
    if not conversation:
        return {
            "patient_id":  patient_id,
            "timestamp_ist": iso_ist(dictation.get("timestamp", "")),
            "date":        dictation.get("date", ""),
            "time":        dictation.get("time", ""),
            "error":       "Empty conversation — no voice data to process",
            "suggestions": None,
        }

    initial_state = build_initial_state(patient_id, dictation)

    try:
        result = await evis_workflow.ainvoke(initial_state)
    except Exception as e:
        logger.exception(f"EVIS pipeline failed for dictation at {dictation.get('timestamp')}: {e}")
        raise

    elapsed              = round(datetime.now().timestamp() * 1000 - start_ms)
    timeline_suggestions = result.get("timeline_suggestions") or {}
    progression          = timeline_suggestions.get("progression")
    if progression:
        timeline_suggestions["progression"] = progression

    output = {
        "patient_id":          patient_id,
        "timestamp_ist":       iso_ist(dictation.get("timestamp", "")),
        "date":                dictation.get("date", ""),
        "time":                dictation.get("time", ""),
        "processing_time_ms":  elapsed,
        "agent_timings":       result.get("agent_timings", {}),
        "errors":              result.get("errors", []),
        "case_type":           result.get("case_type"),
        "is_trauma":           result.get("is_trauma"),
        "care_setting":        result.get("care_setting"),
        "routing_rationale":   result.get("routing_rationale"),
        "suggestions":         timeline_suggestions,
        "immediate_actions":   result.get("immediate_actions"),
        "precautions":         result.get("precautions"),
        "hospital_prep":       result.get("hospital_prep"),
        "vitals_comparison":   result.get("vitals_comparison"),
        "risk_stratification": result.get("risk_stratification"),
    }

    if include_intermediates:
        output["intermediate"] = {
            "medical_entities":  result.get("medical_entities"),
            "vitals_assessment": result.get("vitals_assessment"),
            "injury_profile":    result.get("injury_profile"),
        }

    return output


# ============================================================
# PROCESS COMBINED — All sources, single pipeline pass
# ============================================================

async def process_combined_entries(
    patient_id: str,
    entries: List[Dict],
    include_intermediates: bool = False,
    clinical_actions: List[Dict] = [],
    source_counts: Dict = {},
    image_entries: List[Dict] = [],
    patient_record: Optional[Dict] = None,
) -> Dict:
    """
    Run the EVIS pipeline ONCE across ALL clinical input entries. The A0
    router (entry point of the graph) decides which agents actually run
    for this specific case.
    """
    start_ms = datetime.now().timestamp() * 1000

    if patient_record is None:
        patient_record = await _fetch_patient_record(patient_id)

    initial_state = build_combined_state(
        patient_id,
        entries,
        clinical_actions=clinical_actions,
        image_entries=image_entries,
        patient_record=patient_record,
    )

    logger.info(
        f"EVIS combined pipeline — {len(entries)} total entries "
        f"(EMT={source_counts.get('emt',0)}, Doctor={source_counts.get('doctor',0)}, "
        f"Image={source_counts.get('image',0)}) "
        f"| latest timestamp (IST): {initial_state['timestamp']}"
    )

    try:
        result = await evis_workflow.ainvoke(initial_state)
    except Exception as e:
        logger.exception(f"EVIS combined pipeline failed for patient {patient_id}: {e}")
        raise

    elapsed              = round(datetime.now().timestamp() * 1000 - start_ms)
    timeline_suggestions = result.get("timeline_suggestions") or {}
    progression          = timeline_suggestions.get("progression")

    if progression is not None:
        progression["dictation_count"]    = len(entries)
        progression["source_breakdown"]   = source_counts
        timeline_suggestions["progression"] = progression

    # Publish this run's triage judgement as the cross-pipeline authoritative
    # value. EVIS is the only one of the four pipelines whose triage comes
    # from a full clinical read rather than raw vitals alone.
    snapshot = (timeline_suggestions or {}).get("patient_snapshot") or {}
    triage_colour_to_publish = snapshot.get("triage_colour")
    if triage_colour_to_publish:
        try:
            await upsert_authoritative_triage(
                collection=patient_triage_status_collection,
                patient_id=patient_id,
                triage_colour=triage_colour_to_publish,
                source_system="EVIS",
                criticality_score=snapshot.get("criticality_score"),
                risk_level=snapshot.get("overall_risk"),
                rationale=(timeline_suggestions.get("sbar_summary") or {}).get("assessment"),
                computed_at_ist=initial_state["timestamp"],
            )
        except Exception as e:
            logger.error(f"Failed to publish authoritative triage for {patient_id}: {e}")
    else:
        logger.warning(
            f"EVIS produced no patient_snapshot.triage_colour for {patient_id} "
            "— authoritative triage store not updated this run."
        )

    completed, not_approved = _summarise_clinical_actions(clinical_actions)
    prescribed_meds = _extract_prescribed_medications(clinical_actions)
    treatments_performed = _extract_treatments_performed(entries)
    anticoagulant_mentions = _extract_anticoagulant_mentions(entries)

    output = {
        "patient_id":           patient_id,
        "doctor_prescribed_medications": prescribed_meds,
        "treatments_performed_this_encounter": treatments_performed,
        "anticoagulant_mentions_detected": anticoagulant_mentions,
        "timestamp_ist":        initial_state["timestamp"],
        "date":                 initial_state["date"],
        "time":                 initial_state["time"],
        "processing_time_ms":   elapsed,
        "agent_timings":        result.get("agent_timings", {}),
        "errors":               result.get("errors", []),
        "case_type":            result.get("case_type"),
        "is_trauma":            result.get("is_trauma"),
        "care_setting":         result.get("care_setting"),
        "routing_rationale":    result.get("routing_rationale"),
        "run_full_pipeline":    result.get("run_full_pipeline"),
        "suggestions":          timeline_suggestions,
        "immediate_actions":    result.get("immediate_actions"),
        "precautions":          result.get("precautions"),
        "hospital_prep":        result.get("hospital_prep"),
        "vitals_comparison":    result.get("vitals_comparison"),
        "risk_stratification":  result.get("risk_stratification"),
        "progression":          progression,
        "clinical_action_history": {
            "total":          len(clinical_actions),
            "approved":       len(completed),
            "not_approved":   len(not_approved),
            "completed_list": completed,
            "rejected_list":  not_approved,
        },
        "data_sources": {
            "emt_voice_dictations":    source_counts.get("emt", 0),
            "doctor_voice_notes":      source_counts.get("doctor", 0),
            "image_extracted_records": source_counts.get("image", 0),
            "total_entries":           len(entries),
        },
    }

    if include_intermediates:
        output["intermediate"] = {
            "medical_entities":  result.get("medical_entities"),
            "vitals_assessment": result.get("vitals_assessment"),
            "injury_profile":    result.get("injury_profile"),
        }

    return output


# ============================================================
# API ENDPOINTS
# ============================================================

@router.post("/emergency/voice-suggestions/{patient_id}")
async def get_emergency_suggestions(
    patient_id: str,
    include_intermediates: bool = False,
):
    """
    Adaptive EVIS pipeline for emergency clinical data.

    Data sources (all from MongoDB):
      1. voice_dictations              — EMT ambulance voice notes
      2. doctor_voice_notes            — Doctor voice notes
      3. Image_Extracted_Ambulance     — Clinically extracted image data

    Validation: At least one of voice_dictations OR doctor_voice_notes must have data.

    Adaptive pipeline (v4.2):
      A0 · Case Router — classifies trauma vs medical, image-vitals availability,
                          complexity, AND care_setting (prehospital_ems vs ed_or_inpatient)
      SIMPLE cases      → single consolidated call (SIMPLE_SYNTH), bypassing A1-A9
      Everything else   → A1 → A2 → A3(conditional) → A4 → [A5+A6+A7+A9(conditional)] → A8

    Treatments/interventions already documented in the encounter (e.g. BiPAP,
    IV medications, cardiac monitoring) are extracted directly from raw entry
    text and guaranteed to appear in the output regardless of care setting.
    Anticoagulant/antiplatelet mentions are similarly extracted and surfaced
    to prompt urgent physician-level reversal-decision flagging whenever a
    head injury or major bleeding is present (see CLINICAL_REFERENCE_
    ANTICOAGULATION_REVERSAL) — this system never selects a specific
    reversal agent or dose itself.

    All timestamps in responses are in IST (Asia/Kolkata).
    """
    start_ms = datetime.now().timestamp() * 1000
    logger.info(f"EVIS request | patient={patient_id} | received at IST: {now_ist().isoformat()}")

    entries, emt_count, doctor_count, image_count, raw_image_entries = \
        await _fetch_all_clinical_entries(patient_id)

    source_counts = {
        "emt":    emt_count,
        "doctor": doctor_count,
        "image":  image_count,
    }

    try:
        cursor               = clinical_actions_collection.find(
            {"patient_id": patient_id}, {"_id": 0}
        ).sort("server_received_at", -1)
        past_clinical_actions = await cursor.to_list(length=None)
        logger.info(f"Fetched {len(past_clinical_actions)} clinical action(s) for patient {patient_id}")
    except Exception as e:
        logger.warning(f"Could not fetch clinical actions: {e}")
        past_clinical_actions = []

    logger.info("Running adaptive EVIS pipeline (A0 router decides agent set)")
    patient_record = await _fetch_patient_record(patient_id)


    result = await process_combined_entries(
        patient_id=patient_id,
        entries=entries,
        include_intermediates=include_intermediates,
        clinical_actions=past_clinical_actions,
        source_counts=source_counts,
        image_entries=raw_image_entries,
    )
    asyncio.create_task(run_shadow_comparison(
        patient_id=patient_id,
        entries=entries,
        clinical_actions=past_clinical_actions,
        image_entries=raw_image_entries,
        patient_record=patient_record,
        source_counts=source_counts,
        legacy_result=result,
        comparison_collection=shadow_comparisons_collection,
    ))
    processed_results = [result]

    try:
        save_doc = {
            "patient_id":    patient_id,
            "generated_at_ist": now_ist().isoformat(),
            "entry_count":   len(entries),
            "source_counts": source_counts,
            "case_type":     result.get("case_type"),
            "is_trauma":     result.get("is_trauma"),
            "care_setting":  result.get("care_setting"),
            "results":       processed_results,
        }
        await processed_results_collection.insert_one(save_doc)
        logger.info(f"Saved processed results to voice_processed_results for patient {patient_id}")
    except Exception as e:
        logger.error(f"MongoDB save failed: {e}")

    elapsed = round(datetime.now().timestamp() * 1000 - start_ms)

    return {
        "status":             "success",
        "patient_id":         patient_id,
        "generated_at_ist":   now_ist().isoformat(),
        "entry_count":        len(entries),
        "source_counts":      source_counts,
        "case_type":          result.get("case_type"),
        "is_trauma":          result.get("is_trauma"),
        "care_setting":       result.get("care_setting"),
        "routing_rationale":  result.get("routing_rationale"),
        "processing_time_ms": elapsed,
        "results":            processed_results,
    }


@router.get("/emergency/voice-suggestions/latest/{patient_id}")
async def get_latest_suggestion(patient_id: str):
    """
    Returns the most current suggestion for a patient using the full combined
    MongoDB pipeline — identical to the POST endpoint (adaptive routing applies here too).
    All timestamps in IST (Asia/Kolkata).
    """
    start_ms = datetime.now().timestamp() * 1000
    logger.info(f"EVIS /latest request | patient={patient_id} | IST: {now_ist().isoformat()}")

    entries, emt_count, doctor_count, image_count, raw_image_entries = \
        await _fetch_all_clinical_entries(patient_id)

    source_counts = {
        "emt":    emt_count,
        "doctor": doctor_count,
        "image":  image_count,
    }

    try:
        cursor               = clinical_actions_collection.find(
            {"patient_id": patient_id}, {"_id": 0}
        ).sort("server_received_at", -1)
        past_clinical_actions = await cursor.to_list(length=None)
        logger.info(f"Fetched {len(past_clinical_actions)} clinical action(s) for patient {patient_id}")
    except Exception as e:
        logger.warning(f"Could not fetch clinical actions: {e}")
        past_clinical_actions = []

    logger.info("EVIS /latest — running adaptive pipeline (all sources)")

    result = await process_combined_entries(
        patient_id=patient_id,
        entries=entries,
        include_intermediates=False,
        clinical_actions=past_clinical_actions,
        source_counts=source_counts,
        image_entries=raw_image_entries,
    )

    elapsed = round(datetime.now().timestamp() * 1000 - start_ms)

    return {
        "status":             "success",
        "patient_id":         patient_id,
        "generated_at_ist":   now_ist().isoformat(),
        "entry_count":        len(entries),
        "source_counts":      source_counts,
        "case_type":          result.get("case_type"),
        "is_trauma":          result.get("is_trauma"),
        "care_setting":       result.get("care_setting"),
        "routing_rationale":  result.get("routing_rationale"),
        "processing_time_ms": elapsed,
        "result":             result,
    }


@router.get("/emergency/health")
async def evis_health():
    return {
        "status":             "ok",
        "system":             "EVIS — Emergency Voice Intelligence System",
        "version":            "4.2.0",
        "max_agents":         9,
        "workflow_compiled":  evis_workflow is not None,
        "timezone":           "IST (Asia/Kolkata, UTC+5:30)",
        "agent_pipeline": [
            "A0 · Case Router — classifies trauma vs medical, image-vitals availability, complexity, care_setting [ALWAYS RUNS, fast]",
            "A1 · Medical Entity Extraction (multi-source, including treatments already given and anticoagulant mentions)",
            "A2 · Vital Signs & Consciousness Assessment (incl. hypertensive emergency, shock differential, chest/cardiac trauma red flags, compartment syndrome screen, elderly occult shock, anticoagulation flag)",
            "A3 · Injury Classification (ATLS + head trauma/chest-cardiac/compartment syndrome/elderly/anticoagulation reasoning) [SKIPPED for non-trauma cases]",
            "A4 · Risk Stratification",
            "A5 · Immediate Actions Generator [parallel, role scope gated by care_setting]",
            "A6 · Precautions & Contraindications [parallel]",
            "A7 · Hospital Prep / Escalation-Readiness Instructions [parallel]",
            "A9 · Vitals Comparison & Impression (image vs voice) [parallel, SKIPPED when no image data]",
            "A8 · Timeline Synthesis (Graph-of-Thought) + Progression",
            "SIMPLE_SYNTH · single consolidated call [replaces A1-A9 for trivial cases]",
        ],
        "clinical_hardening_v4_1": [
            "treatments_performed extraction — never lose BiPAP/Lasix-style facts to paraphrasing",
            "care_setting-gated role scope — advanced hospital care is never hidden as 'out of BLS scope'",
            "STABILITY_LABELING_RULE — no 'Stable' label while an active intervention is required",
            "DIAGNOSTIC_HEDGING_RULE — suspected diagnoses never presented as confirmed",
            "Hypertensive emergency detection (>=180/120 with end-organ evidence)",
            "escalation_plan — NIV-failure/intubation trigger criteria",
            "continuous_monitoring_plan — consolidated once, referenced elsewhere",
            "Patient-specific timeline/deterioration-watch/handover instructions",
        ],
        "clinical_hardening_v4_2": [
            "CLINICAL_REFERENCE_HEAD_TRAUMA — GCS/Cushing reflex/herniation patterns, CPP/MAP targets, anticoagulated head-injury threshold",
            "CLINICAL_REFERENCE_SHOCK_DIFFERENTIATION — presume hemorrhage in trauma hypotension until excluded; neurogenic vs spinal shock distinction",
            "CLINICAL_REFERENCE_CHEST_CARDIAC_TRAUMA — tension pneumothorax/tamponade as clinical diagnoses; Beck's triad <10% sensitivity caveat",
            "CLINICAL_REFERENCE_COMPARTMENT_SYNDROME — pain out of proportion is earliest sign; a present pulse never excludes it",
            "CLINICAL_REFERENCE_ELDERLY_TRAUMA — occult hypoperfusion despite 'normal' vitals; undertriage risk",
            "CLINICAL_REFERENCE_ANTICOAGULATION_REVERSAL — flags urgency for physician-level reversal decisions (never doses itself)",
            "CLINICAL_REFERENCE_ACUTE_AGITATION — safety/de-escalation-first reasoning for behavioral presentations",
            "anticoagulant_mentions_detected extraction — pinned into the prompt like treatments_performed",
        ],
        "data_sources": [
            "voice_dictations (MongoDB)",
            "doctor_voice_notes (MongoDB)",
            "Image_Extracted_Ambulance (MongoDB)",
            "clinical_actions (MongoDB — context injection)",
        ],
        "validation": "At least one of voice_dictations OR doctor_voice_notes must have data",
        "current_time_ist": now_ist().isoformat(),
    }


# ============================================================
# CLINICAL ACTIONS
# ============================================================

class ClinicalActionSaveRequest(BaseModel):
    patient_id:      str
    ai_suggestion:   Optional[dict] = None
    voice_dictation: Optional[str]  = None
    action_type:     str
    created_at:      str


@router.post("/clinical-action/save")
async def save_clinical_action(data: ClinicalActionSaveRequest):
    if data.ai_suggestion is None and data.voice_dictation is None:
        raise HTTPException(
            status_code=400,
            detail="Either ai_suggestion or voice_dictation must be provided",
        )

    document = {
        "patient_id":          data.patient_id,
        "ai_suggestion":       data.ai_suggestion,
        "voice_dictation":     data.voice_dictation,
        "action_type":         data.action_type,
        "client_created_at":   data.created_at,
        "server_received_at":  now_ist(),
        "server_received_ist": now_ist().isoformat(),
    }

    try:
        result = await clinical_actions_collection.insert_one(document)
        logger.info(
            f"Inserted clinical action id={result.inserted_id} "
            f"for patient={data.patient_id} at IST={now_ist().isoformat()}"
        )

        # Notify the assigned driver regardless of action_type — both
        # AI-approved suggestions AND doctor voice suggestions must reach
        # the ambulance app live, without the driver needing to refresh.
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                await client.post(
                    "https://doctorassist.ai/api/hms/users/ambulance/notify-driver-update",
                    json={"patient_id": data.patient_id, "update_type": "CLINICAL_ACTION_UPDATE"},
                )
        except Exception as notify_err:
            logger.warning(f"Driver notify failed (non-critical): {notify_err}")

        return {
            "status":  "success",
            "message": "Clinical action saved",
            "id":      str(result.inserted_id),
        }
    except Exception as e:
        logger.error(f"Failed to save clinical action: {str(e)}")
        raise HTTPException(status_code=500, detail="Database error")


@router.get("/clinical-action/{patient_id}")
async def get_patient_clinical_actions(patient_id: str):
    try:
        cursor  = clinical_actions_collection.find(
            {"patient_id": patient_id}, {"_id": 0}
        ).sort("server_received_at", -1)
        actions = await cursor.to_list(length=None)
        return {
            "status":     "success",
            "patient_id": patient_id,
            "total":      len(actions),
            "actions":    actions,
        }
    except Exception as e:
        logger.error(f"Failed to fetch clinical actions: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/clinical-action/delete-all")
async def delete_all_clinical_actions():
    try:
        logger.warning("Deleting ALL clinical actions from DB")
        result = await clinical_actions_collection.delete_many({})
        logger.info(f"Deleted {result.deleted_count} clinical actions")
        return {
            "status":        "success",
            "message":       "All clinical actions deleted",
            "deleted_count": result.deleted_count,
        }
    except Exception as e:
        logger.error(f"Failed to delete clinical actions: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/clinical-action/{patient_id}")
async def delete_patient_clinical_actions(patient_id: str):
    try:
        logger.warning(f"Deleting clinical actions for patient {patient_id}")
        result = await clinical_actions_collection.delete_many({"patient_id": patient_id})
        logger.info(f"Deleted {result.deleted_count} clinical actions for patient {patient_id}")
        return {
            "status":        "success",
            "message":       f"Clinical actions deleted for patient {patient_id}",
            "patient_id":    patient_id,
            "deleted_count": result.deleted_count,
        }
    except Exception as e:
        logger.error(f"Failed to delete clinical actions: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# DOCTOR VOICE NOTES
# ============================================================

class DoctorVoiceNoteRequest(BaseModel):
    patient_id:   str
    conversation: str


@router.post("/doctor-voice-note-forprocessing/save")
async def save_doctor_voice_note(note_data: DoctorVoiceNoteRequest):
    try:
        patient_id   = note_data.patient_id
        conversation = note_data.conversation

        logger.info(f"Saving doctor voice note for patient_id={patient_id} at IST={now_ist().isoformat()}")

        now = now_ist()

        doctor_note_document = {
            "patient_id":  patient_id,
            "conversation":conversation,
            "timestamp":   now,
            "date":        now.strftime("%Y-%m-%d"),
            "time":        now.strftime("%H:%M:%S"),
            "created_at":  now,
            "timezone":    "IST (Asia/Kolkata)",
        }

        result = await doctor_voice_notes_collection_forprocessing.insert_one(doctor_note_document)

        return {
            "status":       "success",
            "message":      "Doctor voice note saved successfully",
            "patient_id":   patient_id,
            "note_id":      str(result.inserted_id),
            "timestamp_ist":now.isoformat(),
        }

    except Exception as e:
        logger.error(f"Failed to save doctor voice note: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save doctor voice note: {str(e)}",
        )


@router.get("/doctor-voice-note-forprocessing/{patient_id}")
async def get_doctor_voice_notes(patient_id: str):
    try:
        cursor = doctor_voice_notes_collection_forprocessing.find(
            {"patient_id": patient_id},
        ).sort("timestamp", -1)
        notes = await cursor.to_list(length=None)

        for note in notes:
            note["_id"] = str(note["_id"])
            if "timestamp" in note and hasattr(note["timestamp"], "isoformat"):
                note["timestamp_ist"] = iso_ist(note["timestamp"])
                note["timestamp"]     = note["timestamp_ist"]
            if "created_at" in note and hasattr(note["created_at"], "isoformat"):
                note["created_at_ist"] = iso_ist(note["created_at"])
                note["created_at"]     = note["created_at_ist"]

        return {
            "status":            "success",
            "patient_id":        patient_id,
            "total_notes":       len(notes),
            "timezone":          "IST (Asia/Kolkata)",
            "doctor_voice_notes":notes,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
