"""
emergency_structured_note.py
─────────────────────────────────────────────────────────────────────────────
Full agentic backend — Emergency Structured Note Generation.

KEY FIXES IN THIS VERSION (carried over from previous pass):
  1. LATEST entry is ALWAYS the current condition — earlier entries are
     strictly history/context.
  2. DOCTOR VOICE NOTE vitals take clinical precedence over monitor image
     values when they conflict.
  3. DISCREPANCY block surfaced explicitly.
  4. CONTRAINDICATIONS are a first-class output field.
  5. Additional output fields: blood_glucose, mechanism_of_injury,
     scene_details, transport_details, clinical_history_timeline,
     vital_signs_history, monitor_vs_clinical_discrepancies,
     haemodynamic_status, respiratory_status, allergy_information,
     pain_assessment, fluid_balance.
  6. _merge_extracted_facts ALWAYS writes doctor-note vitals.

FIXES vs PREVIOUS VERSION (v_prior):
  F1. monitor_vs_clinical_discrepancies dedup normalises vital_parameter
      before comparing.
  F2. Step-A schema explicitly includes diagnoses and investigations.
  F3. treatment_provided also populated from interventions.
  F4. Temperature unit-equivalence check (98.6F ≈ 36.6C is not a real
      discrepancy).
  F5. Step-B has explicit per-field instructions to prevent null-filling
      known data.

NEW IN THIS VERSION (v_case_type — case-type-aware + shared triage +
guardrails, ported from EIDIS v3.1 / EDFS v8 / EVIS v4.2 patterns)
─────────────────────────────────────────────────────────────────────────────
ROOT-CAUSE CRASH FIX:
  _normalise_vital_param() crashed with AttributeError: 'NoneType' object
  has no attribute 'strip' whenever Step-B echoed back an unfilled schema
  placeholder object in monitor_vs_clinical_discrepancies / contraindications
  / specialist_alerts (i.e. {"vital_parameter": null, ...}) — the key
  EXISTS with value None, so dict.get(key, default) does not fall back to
  the default; .strip() was then called directly on None. Fixed by:
    1. _normalise_vital_param() now treats any falsy input as "" instead of
       calling .strip() on it unconditionally.
    2. NEW _strip_null_placeholder_entries() removes any list entry from
       monitor_vs_clinical_discrepancies / contraindications /
       specialist_alerts whose fields are ALL null before any further
       processing touches them — the same defensive pattern EDFS already
       applies to its own specialist-alert cleanup (FIX Q).

CASE-TYPE AWARENESS (NEW):
  This file previously had no is_trauma/case_type concept at all, unlike
  EIDIS/EDFS/EVIS, and could not gate any trauma-specific instruction on
  the actual presentation. Added `derive_case_type_from_facts()` — a pure
  Python, zero-LLM-cost classifier that reads Step-A's already-extracted
  mechanism_of_injury / injuries / diagnoses / presenting_complaints (plus
  a light keyword scan of the aggregated raw text) and produces
  is_trauma / case_type / routing_rationale, using the same keyword
  taxonomy as EIDIS's I0 / EVIS's A0. No additional LLM call is made — this
  intentionally trades a little classification nuance for zero added
  latency/cost, per confirmed scope.
  This is threaded into the Step-B prompt (case_type_block) so the model is
  told not to invent trauma-specific findings (mechanism, spinal
  precautions, injury-driven diagnoses) for a non-trauma case, and not to
  invent cardiac/medical content for a trauma case, unless the actual
  source data supports it.

SHARED DETERMINISTIC TRIAGE COLOUR (NEW):
  Added `compute_triage_colour()` — ported BYTE-FOR-BYTE from EIDIS v3.1 /
  EDFS v8's shared deterministic triage function (same signature, same
  logic: reasons purely from physiological derangement — HR, RR, SpO2, BP,
  GCS, consciousness, shock/respiratory-failure/chest-life-threat flags,
  doctor-stated severity, arrest/deceased flag — never from injury
  mechanism). This overrides `triage_assessment.triage_colour` in place
  (same key, same schema). The LLM's own suggestion is preserved only in
  the top-level API response as `triage_colour_llm_suggested`, mirroring
  EDFS's convention, never inside the note object itself.
  NOTE: kept as a local, self-contained copy (not a cross-module import)
  because EIDIS and EDFS likewise each keep their own synchronized inline
  copy today rather than importing from a shared module — once a real
  shared module exists, all should be swapped to import from it.

GUARDRAILS PORTED FROM EVIS v4.2 / EIDIS v3.1 / EDFS v8:
  STABILITY_LABELING_RULE, DIAGNOSTIC_HEDGING_RULE, EVIDENCE_TRACEABILITY_RULE
  are now injected into the Step-B NOTE_GENERATION_PROMPT_TEMPLATE (where
  haemodynamic_status, provisional_diagnosis, and contraindications are
  actually synthesized). A lighter evidence-traceability instruction is
  also added to Step-A's extraction prompt, consistent with EDFS's A1
  (which only gets EVIDENCE_TRACEABILITY_RULE, not the full three).

CONFIRMED DB MAPPING (unchanged):
  ALL collections live in "doctorassistai"
  ApproveImageSuggestion also checked in "doctorassist" (both queried).

Endpoints (UNCHANGED):
  POST /generate-emergency-structured-note
  GET  /get-emergency-structured-note/{patient_id}
  POST /generate-emergency-structured-note-from-image
─────────────────────────────────────────────────────────────────────────────
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from Agentic.clinical_shared.triage import (
    compute_triage_colour, first_int, parse_bp_systolic, fetch_authoritative_triage,
)
import pytz
from fastapi import APIRouter, HTTPException, Request
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient
from groq import Groq, BadRequestError

# ─────────────────────────────────────────────────────────────────────────────
# ENV & CONNECTIONS
# ─────────────────────────────────────────────────────────────────────────────

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
MONGO_URI    = os.getenv("MONGO_URI")

_motor_client = AsyncIOMotorClient(MONGO_URI)
_db_main      = _motor_client["doctorassistai"]
_db_alt       = _motor_client["doctorassist"]

# OUTPUT
emergency_structured_notes_collection = _db_main["emergency_structured_notes"]
patient_triage_status_collection      = _db_main["patient_triage_status"]
patients_collection                   = _db_main["patients"]
# INPUT collections
voice_dictations_collection           = _db_main["voice_dictations"]
clinical_actions_collection           = _db_main["clinical_actions"]
Image_Extracted_Ambulance_collection  = _db_main["Image_Extracted_Ambulance"]
doctor_voice_notes_collection         = _db_main["doctor_voice_notes"]
Doctor_Suggestion_collection          = _db_main["Doctor_Suggestion_Ambulance"]
ApproveImageSuggestion_main_collection = _db_main["ApproveImageSuggestion"]
ApproveImageSuggestion_alt_collection  = _db_alt["ApproveImageSuggestion"]

groq_client = Groq(api_key=GROQ_API_KEY)
KOLKATA     = pytz.timezone("Asia/Kolkata")
router      = APIRouter(prefix="", tags=["Structured Notes"])

MODEL_STEP_A = "llama-3.1-8b-instant"
MODEL_STEP_B = "llama-3.3-70b-versatile"


# ─────────────────────────────────────────────────────────────────────────────
# SOURCE AUTHORITY WEIGHTS
# ─────────────────────────────────────────────────────────────────────────────
SOURCE_AUTHORITY = {
    "doctor_voice_note":         5,
    "clinical_action":           4,
    "voice_dictation":           3,
    "approved_image_suggestion": 2,
    "image_extracted_ambulance": 1,
    "doctor_suggestion":         2,
}


# ─────────────────────────────────────────────────────────────────────────────
# TEMPERATURE UNIT EQUIVALENCE HELPER  (FIX F4)
# ─────────────────────────────────────────────────────────────────────────────

def _temp_to_celsius(val: Any) -> Optional[float]:
    """
    Parse a temperature value (string or number) and return it in Celsius.
    Accepts formats: "98.6 F", "36.6 C", "98.6F", 98.6, etc.
    Returns None if unparseable.
    """
    if val is None:
        return None
    s = str(val).strip().upper()
    try:
        match = re.match(r"([\d.]+)\s*([FC]?)", s)
        if not match:
            return None
        num = float(match.group(1))
        unit = match.group(2)
        if unit == "F" or (unit == "" and num > 45):   # bare number > 45 is almost certainly F
            return round((num - 32) * 5 / 9, 2)
        return round(num, 2)
    except Exception:
        return None


def _temps_clinically_equivalent(val_a: Any, val_b: Any, tolerance_c: float = 0.3) -> bool:
    """
    Return True if two temperature values represent the same clinical reading
    within tolerance (default 0.3 °C), regardless of unit.
    """
    c_a = _temp_to_celsius(val_a)
    c_b = _temp_to_celsius(val_b)
    if c_a is None or c_b is None:
        return False
    return abs(c_a - c_b) <= tolerance_c


# ─────────────────────────────────────────────────────────────────────────────
# DISCREPANCY DEDUP HELPER  (FIX F1 — now None-safe, see crash fix above)
# ─────────────────────────────────────────────────────────────────────────────

_VITAL_PARAM_NORMALISE = {
    "heart rate":             "heart_rate",
    "heart rate (hr)":        "heart_rate",
    "hr":                     "heart_rate",
    "blood pressure":         "blood_pressure",
    "blood pressure (nibp)":  "blood_pressure",
    "nibp":                   "blood_pressure",
    "bp":                     "blood_pressure",
    "respiratory rate":       "respiratory_rate",
    "respiratory rate (rr)":  "respiratory_rate",
    "rr":                     "respiratory_rate",
    "spo2":                   "spo2",
    "oxygen saturation":      "spo2",
    "temperature":            "temperature",
    "temp":                   "temperature",
}


def _normalise_vital_param(label: Optional[str]) -> str:
    """
    CRASH FIX: previously called label.strip().lower() unconditionally,
    which raised AttributeError when label was None (a dict key present
    with value null, e.g. an unfilled schema placeholder entry echoed back
    by the LLM). Any falsy/non-string input now normalises to "".
    """
    if not label or not isinstance(label, str):
        return ""
    return _VITAL_PARAM_NORMALISE.get(label.strip().lower(), label.strip().lower())


def _split_combined_medications(med_list: List[str]) -> List[str]:
    """Defensive split: if the LLM merged two drugs into one string despite prompt rules."""
    result = []
    for med in med_list or []:
        if not med:
            continue
        parts = re.split(r"\s+and\s+|,\s+(?=[A-Za-z])", str(med))
        result.extend([p.strip() for p in parts if p.strip()])
    return result


def _strip_null_placeholder_entries(items: Any) -> List[Dict]:
    """
    NEW — defensive cleanup applied to list-of-object schema fields
    (monitor_vs_clinical_discrepancies, contraindications, specialist_alerts)
    before any further processing touches them.

    Step-B sometimes echoes the unfilled schema template object back
    verbatim (i.e. every field is null) instead of either populating it or
    omitting it entirely. Left in place, such an entry is indistinguishable
    from real data to downstream code and was the direct cause of the
    AttributeError crash (a None value reaching .strip()). This strips any
    dict whose values are ALL null/empty, and silently drops any non-dict
    junk, without touching genuinely populated entries.
    """
    if not isinstance(items, list):
        return []
    cleaned = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if any(v not in (None, "", [], {}) for v in item.values()):
            cleaned.append(item)
    return cleaned


# ─────────────────────────────────────────────────────────────────────────────
# NEW — SHARED DETERMINISTIC TRIAGE COLOUR FUNCTION
# Ported byte-for-byte from EIDIS v3.1 / EDFS v8's compute_triage_colour().
# Kept as a local, self-contained copy (same rationale as EDFS's copy of
# EIDIS's function) so triage reasoning is identical across all three
# documentation pipelines for the same patient, without introducing a
# fragile cross-module import whose exact path isn't yet confirmed.
# CANDIDATE FOR EXTRACTION: once a real shared module exists, this and the
# EIDIS/EDFS copies should all import from it instead.
# ─────────────────────────────────────────────────────────────────────────────



# ─────────────────────────────────────────────────────────────────────────────
# NEW — CASE-TYPE CLASSIFIER (zero-LLM-cost, derived from Step-A facts)
# ------------------------------------------------------------------------
# Per confirmed scope: option (b) — no dedicated classifier LLM call. This
# reuses Step-A's already-extracted mechanism_of_injury / injuries /
# diagnoses / presenting_complaints (and, as a light fallback, the same
# aggregated raw text Step-A itself reads) to decide is_trauma/case_type,
# using the same conservative taxonomy as EIDIS's I0 / EVIS's A0: be
# conservative and default towards is_trauma=True when a mechanism is even
# plausibly implied, since under-flagging trauma is the more dangerous
# failure mode (mirrors EIDIS/EVIS's own stated fallback philosophy).
# ─────────────────────────────────────────────────────────────────────────────

_TRAUMA_KEYWORDS = (
    "road traffic", "rta", "collision", "accident", "fall", "fell",
    "assault", "stabbed", "gunshot", "penetrating", "blunt trauma",
    "crush", "burn", "laceration", "fracture", "abrasion", "contusion",
    "head trauma", "spinal injury", "hit by", "struck by", "trauma",
)

_MEDICAL_ONLY_KEYWORDS = (
    "chest pain", "myocardial", "stemi", "angina", "cardiac arrest",
    "arrhythmia", "heart failure", "shortness of breath", "breathing difficulty",
    "asthma", "copd", "seizure", "stroke", "hemiparesis", "facial droop",
    "fever", "sepsis", "poisoning", "overdose", "allergic reaction",
    "anaphylaxis", "diabetic", "hypoglycemia", "hyperglycemia",
    "pregnan", "labour", "labor", "syncope",
)

_CASE_TYPE_LABELS = {
    "chest pain": "cardiac", "myocardial": "cardiac", "stemi": "cardiac",
    "angina": "cardiac", "cardiac arrest": "cardiac", "arrhythmia": "cardiac",
    "heart failure": "cardiac",
    "shortness of breath": "cardiorespiratory", "breathing difficulty": "cardiorespiratory",
    "asthma": "cardiorespiratory", "copd": "cardiorespiratory",
    "seizure": "neurological", "stroke": "neurological",
    "hemiparesis": "neurological", "facial droop": "neurological",
    "fever": "infectious_sepsis", "sepsis": "infectious_sepsis",
    "poisoning": "toxicology", "overdose": "toxicology",
    "allergic reaction": "toxicology", "anaphylaxis": "toxicology",
    "diabetic": "general_medical", "hypoglycemia": "general_medical",
    "hyperglycemia": "general_medical",
    "pregnan": "obstetric", "labour": "obstetric", "labor": "obstetric",
    "syncope": "general_medical",
}


def derive_case_type_from_facts(
    facts: dict,
    aggregated_text: str = "",
    registered_incident_type: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Deterministic, zero-LLM-cost case-type classification.

    FIX (case-type-from-registration): previously this function relied
    ENTIRELY on Step-A's free-text-extracted mechanism_of_injury / a
    keyword scan of voice-note/doctor-note text. If the EMT/doctor notes
    described vitals/status without restating the incident mechanism
    (e.g. "SpO2 99%, HR 60, RR 20, BP 123/82, vitally stable" — no mention
    of "road traffic"), a genuine trauma case fell through to the
    medical-keyword branch and got misclassified as non-trauma. The
    patient's own registered accidentDetails.accidentType is now checked
    FIRST, before any keyword guessing, since it is ground truth entered
    at registration — not something an LLM or regex has to infer.
    """
    if registered_incident_type:
        rit = str(registered_incident_type).strip().lower()
        if any(kw in rit for kw in _TRAUMA_KEYWORDS):
            return {
                "is_trauma": True,
                "case_type": "trauma",
                "routing_rationale": (
                    f"Patient registration incident_type={registered_incident_type!r} "
                    "confirms a trauma mechanism; used as ground truth ahead of any "
                    "keyword inference from voice/doctor notes."
                ),
            }

    signal_parts: List[str] = []
    mechanism = facts.get("mechanism_of_injury")
    if mechanism:
        signal_parts.append(str(mechanism))
    for key in ("injuries", "diagnoses", "presenting_complaints"):
        vals = facts.get(key) or []
        if isinstance(vals, list):
            signal_parts.extend(str(v) for v in vals if v)
    combined_signal = " ".join(signal_parts).lower()

    # Fall back to the raw aggregated text only if Step-A gave us nothing
    # structured to go on — avoids over-weighting incidental keyword hits
    # in long free text when we already have a clean structured signal.
    search_text = combined_signal if combined_signal.strip() else (aggregated_text or "").lower()

    trauma_hits  = [kw for kw in _TRAUMA_KEYWORDS if kw in search_text]
    medical_hits = [kw for kw in _MEDICAL_ONLY_KEYWORDS if kw in search_text]

    if trauma_hits:
        is_trauma = True
        case_type = "trauma"
        rationale = (
            f"Trauma mechanism/finding keywords detected: {', '.join(trauma_hits[:3])}."
        )
    elif medical_hits:
        is_trauma = False
        case_type = _CASE_TYPE_LABELS.get(medical_hits[0], "general_medical")
        rationale = (
            f"No injury mechanism found; medical presentation keywords detected: "
            f"{', '.join(medical_hits[:3])}."
        )
    else:
        # Conservative fallback, mirroring EIDIS I0 / EVIS A0's own stated
        # philosophy: default to trauma-cautious mode rather than silently
        # dropping trauma-appropriate caution, but keep case_type "unknown"
        # rather than inventing a specific mechanism.
        is_trauma = True
        case_type = "unknown"
        rationale = (
            "No clear trauma or medical-only keywords found in extracted facts or "
            "raw text — defaulted to trauma-cautious classification; case_type left "
            "unknown rather than guessed."
        )

    return {"is_trauma": is_trauma, "case_type": case_type, "routing_rationale": rationale}


# ─────────────────────────────────────────────────────────────────────────────
# GUARDRAIL RULES — ported (in spirit, adapted to structured-note wording)
# from EVIS v4.2 / EIDIS v3.1 / EDFS v8's STABILITY_LABELING_RULE /
# DIAGNOSTIC_HEDGING_RULE / EVIDENCE_TRACEABILITY_RULE.
# ─────────────────────────────────────────────────────────────────────────────

STABILITY_LABELING_RULE = """
CRITICAL — DO NOT MISLABEL PATIENT STATUS AS "STABLE":
Only describe haemodynamic_status.status or respiratory_status.status as
"Stable"/"Adequate" if the vitals and clinical picture are actually within
or near-normal ranges AND no ongoing organ-supportive intervention (NIV/
CPAP/BiPAP, oxygen beyond minimal supplementation, vasoactive drugs, etc.)
is required to keep them that way. If a parameter improved only BECAUSE of
an active ongoing intervention, or other vitals remain deranged
(tachypnea, tachycardia, severe hypertension/hypotension, increased work
of breathing), use language such as "improved after intervention but still
critically ill / requires close monitoring" — never plain "Stable".
"""

DIAGNOSTIC_HEDGING_RULE = """
CRITICAL — NEVER PRESENT A SUSPECTED CONDITION AS A CONFIRMED DIAGNOSIS:
You are producing ED clinical documentation; you do not issue a diagnosis
on the patient's behalf. Any diagnostic label not explicitly documented by
a clinician in the input sources MUST be phrased as "suspected" / "possible"
(e.g. "suspected acute myocardial infarction") in provisional_diagnosis.
Never state a diagnosis as confirmed unless a source explicitly says a
clinician has already diagnosed it. Ground every diagnosis in THIS
patient's documented presentation and its case classification — do not
default to a trauma-pattern diagnosis (or a cardiac-pattern one) just
because that is a common example; use only what the actual sources support.
"""

EVIDENCE_TRACEABILITY_RULE = """
CRITICAL — EVERY STATEMENT MUST BE TRACEABLE TO THE INPUT:
Do not add any diagnosis, injury, mechanism, medication, investigation, or
intervention that is not directly supported by the clinical input sources.
In particular:
  - Do NOT invent trauma-specific content (mechanism of injury, spinal
    precautions, physical-exam injury findings) for a case classified
    is_trauma=false, and do NOT invent cardiac/medical content for a case
    classified is_trauma=true, unless the actual source data genuinely
    supports it.
  - Do NOT treat a prior AI-generated suggestion in SOURCE 3 (ED CLINICAL
    ACTIONS) — approved or not — as confirmed clinical fact for its
    suspected diagnoses, risk flags, or clinical impression. Approval of a
    clinical action means the ACTION was approved, not that every
    diagnostic inference attached to it was reviewed and confirmed by a
    clinician. Only carry a diagnosis or risk flag forward if it is
    independently supported by the voice dictation, doctor voice note, or
    another primary source — not solely because a prior AI suggestion
    stated it.
  - Do NOT infer the patient is elderly, on an anticoagulant, or in
    hemorrhagic/shock unless the source text explicitly documents an age,
    a named medication/class, or bleeding/injury findings respectively. If
    all vitals in the current sources are within normal limits and no
    symptom/mechanism/history supports a life threat, provisional_diagnosis
    and contraindications should reflect that low-acuity picture, not a
    severe one borrowed from a clinical-reference pattern.
  - If a data point needed for full confidence is missing or ambiguous,
    say so explicitly in documentation_confidence.missing_data /
    limiting_factors rather than guessing.
  - Every entry in provisional_diagnosis, contraindications, and
    investigations_ordered must correspond to something actually observed,
    reported, or performed for THIS patient.
"""


# ─────────────────────────────────────────────────────────────────────────────
# EMERGENCY RULE
# ─────────────────────────────────────────────────────────────────────────────

EMERGENCY_RULE = """
RULE 1 — CURRENT vs HISTORICAL STATE:
  You will receive ALL data sources labelled with their collection name and
  an entry number (ENTRY-1 being earliest, highest number being latest).
  The HIGHEST-NUMBERED ENTRY is the CURRENT patient condition.
  All lower-numbered entries are HISTORICAL — they describe what happened
  before, NOT what is happening now.

  ▶ vital_signs, primary_survey, neurological_assessment, haemodynamic_status,
    and respiratory_status MUST reflect ONLY the CURRENT (latest) entry.
  ▶ clinical_history_timeline and vital_signs_history capture the earlier entries.
  ▶ If the patient was unconscious in ENTRY-1 but conscious in the latest entry,
    the structured note MUST say "conscious" — not unconscious.
  ▶ NEVER use an earlier entry's values as the current vital signs.

RULE 2 — CLINICAL AUTHORITY OVER MONITOR:
  When a doctor voice note reports different vital signs than a monitor image,
  the DOCTOR VOICE NOTE values are MORE AUTHORITATIVE for the vital_signs block.
  The monitor values are still captured in monitor_vs_clinical_discrepancies.
  Reason: A clinician's bedside assessment at the time of examination reflects
  the patient's actual clinical state more reliably than a monitor snapshot.

RULE 3 — PARAGRAPH VITAL EXTRACTION:
  All numbers representing vitals, GCS, pain scores, or measurements buried
  inside narrative sentences MUST be extracted and placed in the correct field.
  Example: "BP 98/64 mmHg, pulse 122 bpm, RR 28, SpO2 91% on room air" →
    heart_rate_bpm: 122, blood_pressure_mmhg: "98/64", respiratory_rate_bpm: 28,
    spo2_percent: 91, oxygen_therapy: "room air"

RULE 4 — CONTRAINDICATIONS:
  Derive contraindications from the combination of: current vital signs,
  confirmed injuries or medical findings, mechanism/presentation, and
  interventions already done. Each contraindication must state what is
  contraindicated, why, and what the safe alternative is. If no genuine
  contraindication applies, return an empty list — do NOT return a
  placeholder object with null fields.

RULE 5 — DISCREPANCIES:
  If two sources report different values for the same vital sign, capture BOTH
  in monitor_vs_clinical_discrepancies with the source label for each.
  The vital_signs block uses the clinically authoritative value.
  IMPORTANT: Temperature reported in different units (°F vs °C) that convert
  to the same value is NOT a discrepancy — note it as "unit difference only".
  If there are no genuine discrepancies, return an empty list — do NOT
  return a placeholder object with null fields.

RULE 6 — NO INVENTED DATA:
  If a field has no data from any source, set it to null.
  Never assume, extrapolate, or invent clinical values.

RULE 7 — COMPLETENESS:
  Every non-null value in SOURCE 1 (Step-A extracted facts) MUST appear
  somewhere in the output. Step-B builds on Step-A — it does NOT re-derive
  or ignore Step-A independently.

RULE 8 — PHYSICAL EXAMINATION:
  Populate physical_examination from ALL narrative sources.
  Any mention of abrasions, injuries, tenderness, or findings at a body
  region MUST be placed in the correct sub-field.
  Example: "multiple abrasions over the forehead" → head_and_face: "multiple abrasions"
  Example: "abrasions bilateral upper limbs" → upper_limbs: "multiple abrasions"
  Example: "reduced air entry on the left side" → chest_and_thorax: "labored breathing, reduced air entry left"
  Example: "right knee abrasions" → lower_limbs: "abrasions right knee"
  If this is a non-trauma medical case (see CASE CLASSIFICATION below), it
  is normal and correct for physical_examination to be mostly or entirely
  null — do NOT invent examination findings to fill it.

RULE 9 — PROVISIONAL DIAGNOSIS:
  If diagnoses, injuries, or clinical impressions exist in any source,
  provisional_diagnosis MUST be populated.
  primary_diagnosis = the most serious confirmed or suspected diagnosis.
  differential_diagnoses = list of other possibilities.
  clinical_impression = one-sentence summary of the clinical picture.
  NEVER leave provisional_diagnosis all-null when diagnostic information exists.

RULE 10 — CLINICAL SUMMARY:
  clinical_summary MUST be a complete 2-3 sentence narrative combining:
  patient demographics, mechanism or presenting complaint, current clinical
  status, key vitals, interventions done, and immediate plan.
  NEVER set clinical_summary to null.

RULE 11 — DISPOSITION:
  If the doctor voice note or clinical actions indicate any plan (transport,
  shift to unit, investigations ordered, handover), populate disposition.
  urgency is derivable from triage colour and criticality score.
  disposition.rationale MUST match the actual case classification — do not
  describe a "trauma evaluation" rationale for a non-trauma medical case, or
  vice versa.
  NEVER leave disposition all-null when plan information exists in sources.

RULE 12 — DOCUMENTATION CONFIDENCE:
  documentation_confidence.level MUST be one of: "High", "Moderate", "Low".
  Derive from number of sources and completeness of data.
  NEVER set level to null.

RULE 13 — TREATMENT PROVIDED:
  treatment_provided MUST list every intervention already performed on the patient,
  drawn from all sources. Include oxygen therapy, IV access, fluid administration,
  immobilisation, medications, pain management — anything already done.
  NEVER leave treatment_provided empty when interventions exist in sources.

RULE 14 — INVESTIGATIONS:
  investigations_ordered MUST include every investigation mentioned or ordered
  in any source (FAST scan, CT, trauma imaging, blood tests, ECG, etc.).
  NEVER leave investigations_ordered empty when investigations are mentioned.
"""


# ─────────────────────────────────────────────────────────────────────────────
# STEP-A EXTRACTION PROMPT — extract ALL facts from ALL sources  (FIX F2)
# diagnoses and investigations added explicitly to schema
# ─────────────────────────────────────────────────────────────────────────────

EXTRACTION_PROMPT_TEMPLATE = """
You are a clinical NLP extraction engine.
Read the raw clinical text below (all sources merged, labelled with source
type and entry order — ENTRY-1 is earliest, highest is latest/current).

Extract every discrete clinical fact and return ONLY valid JSON — no markdown,
no explanation — with EXACTLY this schema.

For vital signs: if the same parameter appears in multiple entries, capture
the value from the HIGHEST-NUMBERED ENTRY (most recent) as the primary value,
and list all historical values in the history arrays.

IMPORTANT — EXTRACT ONLY, DO NOT DIAGNOSE OR INVENT: every value you return
must be traceable to the raw text below. Do not add a mechanism_of_injury,
injury, or diagnosis that is not explicitly stated or clearly implied by the
raw text — a purely medical presentation (chest pain, breathing difficulty,
seizure, etc.) with no stated injury mechanism should leave
mechanism_of_injury and injuries as null/empty, not filled with a guess.

{{
  "current_entry_label":    null,
  "heart_rate_bpm":         null,
  "blood_pressure_mmhg":    null,
  "respiratory_rate_bpm":   null,
  "spo2_percent":           null,
  "temperature":            null,
  "blood_glucose_mgdl":     null,
  "gcs_total":              null,
  "gcs_eye":                null,
  "gcs_verbal":             null,
  "gcs_motor":              null,
  "pain_score":             null,
  "avpu":                   null,
  "airway":                 null,
  "breathing":              null,
  "circulation":            null,
  "pupils":                 null,
  "mental_status":          null,
  "consciousness_current":  null,
  "oxygen_therapy":         null,
  "assisted_ventilation":   null,
  "presenting_complaints":  [],
  "injuries":               [],
  "mechanism_of_injury":    null,
  "scene_details":          null,
  "interventions":          [],
  "medications":            [],
  "investigations":         [],
  "diagnoses":              [],
  "allergies":              [],
  "disposition_notes":      null,
  "transport_details":      null,
  "other_findings":         [],
  "doctor_hr":              null,
  "doctor_bp":              null,
  "doctor_rr":              null,
  "doctor_spo2":            null,
  "doctor_temp":            null,
  "monitor_hr":             null,
  "monitor_bp":             null,
  "monitor_rr":             null,
  "monitor_spo2":           null,
  "monitor_temp":           null,
  "vital_history":          []
}}

STRICT JSON RULES:
- heart_rate_bpm, respiratory_rate_bpm, gcs_total, gcs_eye, gcs_verbal,
  gcs_motor, pain_score, blood_glucose_mgdl → integer or null
- blood_pressure_mmhg, doctor_bp, monitor_bp → STRING or null  e.g. "98/64"
- spo2_percent, doctor_spo2, monitor_spo2    → number or null
- temperature, doctor_temp, monitor_temp     → string with unit or null
- vital_history → array of objects: [{{"entry":"ENTRY-N","source":"...","hr":null,"bp":null,"rr":null,"spo2":null}}]
- doctor_hr/bp/rr/spo2/temp = values reported by a doctor/clinician voice note
- monitor_hr/bp/rr/spo2/temp = values read from a device/monitor image
- investigations → array of strings: every investigation mentioned or ordered
  e.g. ["FAST scan", "trauma imaging"] or ["ECG", "12-lead ECG"]
- diagnoses → array of strings: every diagnosis, suspected diagnosis, or
  clinical impression found in any source
  e.g. ["moderate head injury", "suspected internal bleeding"] or
  ["suspected acute inferior STEMI"]
- medications → array of strings: EVERY medicine mentioned MUST be its own array
  item, even if listed in the same sentence or clause. Never combine two drug
  names into a single string entry.

EXTRACTION RULES:
- GCS "13/15" → gcs_total = 13
- BP "98/64 mmHg" → "98/64" (string, quoted)
- SpO2 "91% on room air" → spo2_percent = 91, oxygen_therapy = "room air"
- SpO2 "96% with oxygen" → spo2_percent = 96, oxygen_therapy = "supplemental oxygen"
- Temperature "98.6°F" → "98.6 F";  "36.6°C" → "36.6 C"
- "FAST scan and trauma imaging advised" → investigations: ["FAST scan", "trauma imaging"]
- "moderate head injury" → diagnoses: ["moderate head injury"]
- "suspected internal bleeding" → diagnoses: [..., "suspected internal bleeding"]
- "administered paracetamol 1g IV and tramadol 50mg IV" → medications: ["paracetamol 1g IV", "tramadol 50mg IV"]
- "gave morphine and ondansetron" → medications: ["morphine", "ondansetron"]
- ALWAYS split multiple medications mentioned in the same sentence into SEPARATE array entries — never merge two drug names into one string.
- Do NOT invent values. Only extract what is explicitly present.

RAW CLINICAL TEXT (ordered ENTRY-1=earliest → highest=CURRENT/LATEST):
-------------------------------------------------
{raw_text}
-------------------------------------------------
"""


# ─────────────────────────────────────────────────────────────────────────────
# STEP-B NOTE GENERATION PROMPT  (FIX F5 + guardrails + case-type block, NEW)
# ─────────────────────────────────────────────────────────────────────────────

NOTE_GENERATION_PROMPT_TEMPLATE = """
You are a hospital clinical documentation assistant specialising in Emergency Medicine.

Produce ONE unified structured emergency clinical note by combining ALL sources.
Sources are in chronological order: ENTRY-1 = earliest/historical, highest = CURRENT.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CASE CLASSIFICATION  (pre-computed — use as ground truth, do not re-derive)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{case_type_block}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EMERGENCY DOCUMENTATION RULES  (NON-NEGOTIABLE — READ FIRST)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{emergency_rule}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CLINICAL GUARDRAILS  (NON-NEGOTIABLE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{guardrail_rules}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[SOURCE 1] STEP-A PRE-EXTRACTED FACTS  ← AUTHORITATIVE GROUND TRUTH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMPORTANT: doctor_hr/bp/rr/spo2/temp in SOURCE 1 are the CLINICIAN-ASSESSED
vitals (from doctor_voice_note). These MUST be used in vital_signs block.
monitor_hr/bp/rr/spo2/temp are the DEVICE readings — use these ONLY in
monitor_vs_clinical_discrepancies and vital_signs_history.
{extracted_facts_json}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[SOURCE 2] ENTRY-1 (EARLIEST) — EMT VOICE DICTATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THIS IS HISTORICAL — reflects patient state at FIRST contact only.
Use for mechanism_of_injury, scene_details, and clinical_history_timeline.
Do NOT use these vitals/status for the current vital_signs block.
{voice_notes_json}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[SOURCE 3] ED CLINICAL ACTIONS
IMPORTANT — this source mixes several different kinds of entry; treat each
according to its "type" field:
  • type == "doctor_direct_dictation": the DOCTOR'S OWN spoken instruction,
    sent directly to the EMT app. This is NOT an AI suggestion and was NOT
    rejected by anyone — treat its "text" as authoritative clinical input,
    the same weight as a doctor voice note (SOURCE 4), and incorporate it
    into provisional_diagnosis, treatment_provided, disposition, and
    clinical_summary wherever relevant. See its "authority_note" field.
  • type == "ai_approved": an AI-generated suggestion whose ACTION the
    doctor approved — see its "approval_note" for how much weight to give it.
  • any other type where an "ai_suggestion_summary" field is present: this
    IS a genuinely rejected AI opinion. Its ai_suggested_case_type /
    ai_suggested_is_trauma / situation_suggested_by_ai fields are NOT
    confirmed clinical fact — do not let them override the CASE
    CLASSIFICATION given above, and do not build provisional_diagnosis,
    presenting_complaints, or disposition primarily from a rejected
    suggestion's content unless it is corroborated by an approved source or
    the voice/doctor notes.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{clinical_actions_json}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[SOURCE 4] ENTRY-2 — DOCTOR VOICE NOTE  ← CURRENT CLINICAL ASSESSMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THIS IS THE CURRENT/LATEST CLINICAL ASSESSMENT BY A PHYSICIAN.
Vitals from this source are AUTHORITATIVE for vital_signs block.
Consciousness, GCS, and clinical status from here = CURRENT state.
{doctor_voice_notes_json}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[SOURCE 5] DOCTOR SUGGESTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{doctor_suggestions_json}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[SOURCE 6] ENTRY-3 — AMBULANCE MONITOR IMAGE (DEVICE READINGS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
These are DEVICE/MONITOR readings. If they conflict with SOURCE 4 (doctor
voice note), the doctor note takes clinical precedence for vital_signs.
Capture discrepancies in monitor_vs_clinical_discrepancies.
{image_extracted_json}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[SOURCE 7] APPROVED IMAGE ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{approved_analysis_json}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROCESSING RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1.  vital_signs block MUST use the DOCTOR VOICE NOTE values (SOURCE 4 /
    doctor_hr, doctor_bp etc from SOURCE 1). NOT the monitor values.
2.  consciousness, mental_status, and primary_survey MUST reflect the
    CURRENT/LATEST state — not the initial presentation.
3.  clinical_history_timeline must list each entry chronologically showing
    how the patient's state CHANGED (e.g. unconscious → conscious).
4.  vital_signs_history must show ALL historical readings from ALL entries.
5.  monitor_vs_clinical_discrepancies must list every vital where monitor
    and doctor note disagree, with both values shown. Temperature in different
    units that convert to the same value should be noted as unit difference only,
    NOT flagged as a clinical discrepancy. If there is nothing genuinely
    discrepant, return an empty list.
6.  contraindications must be derived from current vitals + injuries/findings +
    meds. If none apply, return an empty list — never a placeholder object.
7.  disposition must be populated from clinical actions and doctor notes.
    urgency: derive from triage_colour (Red=Immediate, Yellow=Urgent, Green=Routine).
    decision and rationale MUST match the actual case classification above —
    do not write a "trauma evaluation" rationale for a non-trauma case.
    handover_summary: one sentence for receiving team.
8.  fluid_balance must include all infusion pump data from SOURCE 6/7.
9.  Do NOT output raw timestamps, ObjectIds, or internal DB fields.
10. Return ONLY the JSON object — no markdown fences, no explanation.
11. physical_examination MUST be populated from ALL narrative sources.
    Any mention of abrasions, injuries, or examination findings at a body
    region MUST be placed in the correct sub-field. See RULE 8. For a
    non-trauma medical case, it is correct and expected for most/all of
    physical_examination to remain null — do not invent findings.
12. provisional_diagnosis MUST be populated if any diagnosis, suspected
    diagnosis, or clinical impression exists in any source. See RULE 9.
13. clinical_summary MUST be a 2-3 sentence narrative. See RULE 10.
14. treatment_provided MUST list all interventions already performed.
    Include: oxygen therapy, cervical immobilisation (trauma only), IV fluids,
    pain management, medications, and any other intervention from all sources.
15. investigations_ordered MUST include every investigation mentioned in
    any source: FAST scan, trauma imaging, CT, blood tests, ECG, etc.
16. documentation_confidence.level MUST be "High", "Moderate", or "Low" —
    never null. Derive from number of sources and data completeness.
17. Do NOT invent a mechanism_of_injury, spinal_precautions value, or
    injury-driven diagnosis for a case classified is_trauma=false above,
    and do NOT invent cardiac/medical-only content for a case classified
    is_trauma=true, unless the actual source data genuinely supports it.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRICT JSON OUTPUT RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- blood_pressure_mmhg         MUST be a string  e.g. "98/64"
- heart_rate_bpm, respiratory_rate_bpm, gcs_total, gcs_eye,
  gcs_verbal, gcs_motor, pain_score, blood_glucose_mgdl  → integer or null
- spo2_percent                → number or null
- temperature                 → string with unit  e.g. "98.6 F" or "36.6 C"
- Return ONLY valid JSON with exactly the keys shown below.
- For monitor_vs_clinical_discrepancies, contraindications, and
  specialist_alerts: if there is nothing genuine to report, return an
  EMPTY ARRAY ([]) for that field — never a single object with every
  field set to null.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT SCHEMA:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{{
  "patient_details": {{
    "doctor_id":  null,
    "patient_id": null,
    "age":        null,
    "gender":     null,
    "weight_kg":  null
  }},
  "scene_and_transport": {{
    "mechanism_of_injury":    null,
    "scene_description":      null,
    "incident_type":          null,
    "found_position":         null,
    "initial_consciousness":  null,
    "transport_mode":         null,
    "transport_notes":        null,
    "spinal_precautions":     null,
    "scene_time_notes":       null
  }},
  "presenting_complaints": [
    {{
      "complaint": null,
      "onset":     null,
      "duration":  null,
      "severity":  null
    }}
  ],
  "allergy_information": {{
    "known_allergies":   [],
    "allergy_status":    null,
    "reaction_details":  null
  }},
  "triage_assessment": {{
    "triage_category":   null,
    "triage_colour":     null,
    "risk_level":        null,
    "criticality_score": null,
    "triage_rationale":  null
  }},
  "primary_survey": {{
    "airway":      null,
    "breathing":   null,
    "circulation": null,
    "disability":  null,
    "exposure":    null
  }},
  "vital_signs": {{
    "heart_rate_bpm":        null,
    "blood_pressure_mmhg":   null,
    "respiratory_rate_bpm":  null,
    "spo2_percent":          null,
    "temperature":           null,
    "blood_glucose_mgdl":    null,
    "gcs_total":             null,
    "pain_score":            null,
    "source_of_vitals":      null
  }},
  "haemodynamic_status": {{
    "status":                null,
    "heart_rate_assessment": null,
    "blood_pressure_assessment": null,
    "perfusion_assessment":  null,
    "shock_risk":            null,
    "shock_type":            null,
    "fluid_resuscitation_indicated": null
  }},
  "respiratory_status": {{
    "status":                  null,
    "rate_assessment":         null,
    "effort_description":      null,
    "air_entry":               null,
    "oxygen_requirement":      null,
    "oxygen_delivery_device":  null,
    "target_spo2":             null,
    "ventilatory_support":     null
  }},
  "neurological_assessment": {{
    "gcs_eye":               null,
    "gcs_verbal":            null,
    "gcs_motor":             null,
    "gcs_total":             null,
    "pupils":                null,
    "mental_status":         null,
    "avpu":                  null,
    "neurological_deficits": null,
    "head_injury_suspected": null
  }},
  "physical_examination": {{
    "head_and_face":         null,
    "neck_and_cervical_spine": null,
    "chest_and_thorax":      null,
    "abdomen":               null,
    "pelvis":                null,
    "spine_and_back":        null,
    "upper_limbs":           null,
    "lower_limbs":           null,
    "wounds_and_bleeding":   null,
    "skin_findings":         null
  }},
  "pain_assessment": {{
    "pain_score":            null,
    "pain_location":         null,
    "pain_character":        null,
    "pain_management_given": null
  }},
  "emergency_interventions": [
    {{
      "intervention": null,
      "medication":   null,
      "dosage":       null,
      "route":        null,
      "time_given":   null
    }}
  ],
  "fluid_balance": {{
    "iv_access":              null,
    "fluids_administered":    [],
    "total_fluid_in_ml":      null,
    "infusion_pumps":         [],
    "urine_output_ml":        null,
    "fluid_balance_notes":    null
  }},
  "investigations_ordered": [],
  "investigations_results": [],
  "provisional_diagnosis": {{
    "primary_diagnosis":       null,
    "differential_diagnoses":  [],
    "clinical_impression":     null,
    "injury_severity_estimate": null
  }},
  "contraindications": [],
  "monitor_vs_clinical_discrepancies": [],
  "vital_signs_history": [
    {{
      "entry_label":            null,
      "source":                 null,
      "heart_rate_bpm":         null,
      "blood_pressure_mmhg":    null,
      "respiratory_rate_bpm":   null,
      "spo2_percent":           null,
      "temperature":            null,
      "gcs_total":              null,
      "clinical_status":        null
    }}
  ],
  "clinical_history_timeline": [
    {{
      "entry_label":            null,
      "source":                 null,
      "status_at_this_time":    null,
      "key_findings":           [],
      "interventions_at_time":  [],
      "change_from_previous":   null
    }}
  ],
  "treatment_provided": [],
  "disposition": {{
    "decision":          null,
    "destination_unit":  null,
    "urgency":           null,
    "rationale":         null,
    "handover_summary":  null
  }},
  "specialist_alerts": [],
  "clinical_summary": null,
  "documentation_confidence": {{
    "level":             null,
    "sources_used":      [],
    "missing_data":      [],
    "limiting_factors":  []
  }}
}}
"""


# ─────────────────────────────────────────────────────────────────────────────
# IMAGE PCR EXTRACTION PROMPT
# ─────────────────────────────────────────────────────────────────────────────

IMAGE_EXTRACTION_PROMPT = """
You are a clinical data extraction engine.
The image is an Ambulance Patient Care Record (PCR) form.
Extract every filled / ticked field and return ONLY valid JSON with this schema.
Leave unfilled/illegible fields as null.

{
  "patient_name":            null,
  "patient_id":              null,
  "date":                    null,
  "gender":                  null,
  "weight_kg":               null,
  "age":                     null,
  "transferred_from":        null,
  "transferred_to":          null,
  "airway":                  null,
  "breathing":                null,
  "circulation":             null,
  "loc":                     null,
  "injury":                  null,
  "c_spine":                 null,
  "signs_of_abuse":          null,
  "heart_rate_bpm":          null,
  "blood_pressure_mmhg":     null,
  "respiratory_rate_bpm":    null,
  "spo2_percent":            null,
  "spo2_delivery":           null,
  "assisted_ventilation":    null,
  "ventilation_mode":        null,
  "ambu_bagging":            null,
  "oxygen_status":           null,
  "pupil_size":              null,
  "pupil_reaction":          null,
  "gcs_total":               null,
  "gcs_eye":                 null,
  "gcs_verbal":              null,
  "gcs_motor":               null,
  "pain_score":              null,
  "avpu":                    null,
  "blood_glucose_mgdl":      null,
  "presenting_complaints":   null,
  "medical_history":         null,
  "known_allergies":         null,
  "interventions":           [],
  "medications":             [],
  "informer_name":           null,
  "informer_contact":        null,
  "doctor_name":             null,
  "doctor_designation":      null,
  "receiving_unit_informed": null,
  "bed_confirmed":           null,
  "facility_name":           null
}

STRICT JSON RULES:
- blood_pressure_mmhg MUST be a string  e.g. "100/60"  — never a bare fraction.
- heart_rate_bpm, respiratory_rate_bpm, gcs_total, gcs_eye, gcs_verbal,
  gcs_motor, pain_score, blood_glucose_mgdl MUST be integers or null.
- spo2_percent MUST be a number or null.
- Tick-boxes: report the ticked option as the value string.
- GCS "15/15" → gcs_total = 15.
- SpO2 delivery: capture device (e.g. "60L HFNC").
- Return ONLY valid JSON — no markdown, no explanation.
"""


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _to_kolkata_sort_key(doc: dict) -> str:
    for field in ("timestamp", "created_at", "approved_at", "client_created_at"):
        val = doc.get(field)
        if val is None:
            continue
        if isinstance(val, datetime):
            if val.tzinfo is None:
                val = val.replace(tzinfo=timezone.utc)
            return val.astimezone(KOLKATA).isoformat()
        if isinstance(val, str) and val:
            return val
    return ""


def _safe_isoformat(val: Any) -> Optional[str]:
    if isinstance(val, datetime):
        if val.tzinfo is None:
            val = val.replace(tzinfo=timezone.utc)
        return val.astimezone(KOLKATA).isoformat()
    return str(val) if val else None


def _serialize_doc(doc: dict) -> dict:
    out = {}
    for k, v in doc.items():
        if k == "_id":
            continue
        if isinstance(v, datetime):
            out[k] = _safe_isoformat(v)
        elif isinstance(v, dict):
            out[k] = _serialize_doc(v)
        elif isinstance(v, list):
            out[k] = [
                _serialize_doc(i) if isinstance(i, dict)
                else (_safe_isoformat(i) if isinstance(i, datetime) else i)
                for i in v
            ]
        else:
            out[k] = v
    return out


def _repair_json(raw: str) -> str:
    raw = re.sub(r"```(?:json)?", "", raw).strip()
    raw = re.sub(r'("blood_pressure_mmhg"\s*:\s*)(\d+/\d+)', r'\1"\2"', raw)
    raw = re.sub(r'("(?:doctor_bp|monitor_bp)"\s*:\s*)(\d+/\d+)', r'\1"\2"', raw)
    raw = re.sub(r'(:\s*)(\d{1,4}/\d{1,4})(\s*[,\}\]])', r'\1"\2"\3', raw)
    raw = re.sub(r",\s*([}\]])", r"\1", raw)
    return raw


def _raw_llm_call(prompt: str, model: str, max_tokens: int) -> str:
    completion = groq_client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        response_format={"type": "json_object"},
        max_tokens=max_tokens,
    )
    return completion.choices[0].message.content


def _safe_llm_json(prompt: str, model: str, max_tokens: int) -> dict:
    raw = ""
    try:
        raw = _raw_llm_call(prompt, model, max_tokens)
        return json.loads(_repair_json(raw))
    except (BadRequestError, json.JSONDecodeError) as first_err:
        logger.warning("First JSON parse/call failed ({}). Attempting self-repair.", first_err)
        failed_gen = raw
        if isinstance(first_err, BadRequestError):
            try:
                err_body = first_err.response.json()
                failed_gen = err_body.get("error", {}).get("failed_generation", raw) or raw
            except Exception:
                pass
        if not failed_gen.strip():
            raise HTTPException(status_code=500, detail=f"LLM returned empty response: {first_err}")
        repair_prompt = (
            "Fix this broken JSON. Return ONLY the corrected valid JSON object.\n"
            "RULES:\n"
            "- blood_pressure_mmhg, doctor_bp, monitor_bp MUST be quoted strings e.g. \"98/64\"\n"
            "- Do not change any clinical values — only fix JSON syntax.\n\n"
            f"BROKEN JSON:\n{failed_gen}"
        )
        try:
            repair_raw = _raw_llm_call(repair_prompt, MODEL_STEP_A, 4000)
            return json.loads(_repair_json(repair_raw))
        except Exception as second_err:
            logger.error("Self-repair also failed: {}", second_err)
            try:
                return json.loads(_repair_json(failed_gen))
            except Exception:
                raise HTTPException(
                    status_code=500,
                    detail=f"LLM JSON generation failed after repair: {second_err}",
                )


# ─────────────────────────────────────────────────────────────────────────────
# DATA FETCHER
# ─────────────────────────────────────────────────────────────────────────────

async def _fetch_all_sources(patient_id: str) -> List[dict]:
    """
    Fetch from all 6 collections (ApproveImageSuggestion from both DBs).
    Tags each doc with _source, _ts, and _authority.
    Returns combined list sorted chronologically (earliest → latest).
    """
    all_docs: List[dict] = []

    standard_collections = [
        (voice_dictations_collection,           "voice_dictation"),
        (clinical_actions_collection,           "clinical_action"),
        (Image_Extracted_Ambulance_collection,  "image_extracted_ambulance"),
        (doctor_voice_notes_collection,         "doctor_voice_note"),
        (Doctor_Suggestion_collection,          "doctor_suggestion"),
    ]

    for collection, source_label in standard_collections:
        try:
            docs_found = []
            async for doc in collection.find({"patient_id": patient_id}):
                raw_doc = dict(doc)
                d = _serialize_doc(raw_doc)
                d["_source"]    = source_label
                d["_ts"]        = _to_kolkata_sort_key(raw_doc)
                d["_authority"] = SOURCE_AUTHORITY.get(source_label, 1)
                docs_found.append(d)

            all_docs.extend(docs_found)
            if docs_found:
                logger.info(
                    "=== SOURCE: {} | DB: doctorassistai | patient_id: {} | {} record(s) ===",
                    source_label, patient_id, len(docs_found),
                )
                for idx, doc_item in enumerate(docs_found):
                    logger.info(
                        "[{}] Record #{}\n{}",
                        source_label, idx + 1,
                        json.dumps(doc_item, indent=2, default=str),
                    )
            else:
                logger.info(
                    "SOURCE: {} | DB: doctorassistai | patient_id: {} | NO records",
                    source_label, patient_id,
                )
        except Exception as exc:
            logger.warning(
                "Failed reading '{}' for patient_id={}: {}", source_label, patient_id, exc,
            )

    # ApproveImageSuggestion — both DBs
    approve_seen_ids: set = set()
    for coll, db_label in [
        (ApproveImageSuggestion_main_collection, "doctorassistai"),
        (ApproveImageSuggestion_alt_collection,  "doctorassist"),
    ]:
        try:
            docs_found = []
            async for doc in coll.find({"patient_id": patient_id}):
                raw_doc = dict(doc)
                doc_id  = str(raw_doc.get("_id", ""))
                if doc_id in approve_seen_ids:
                    continue
                approve_seen_ids.add(doc_id)
                d = _serialize_doc(raw_doc)
                d["_source"]    = "approved_image_suggestion"
                d["_ts"]        = _to_kolkata_sort_key(raw_doc)
                d["_authority"] = SOURCE_AUTHORITY.get("approved_image_suggestion", 2)
                docs_found.append(d)

            all_docs.extend(docs_found)
            if docs_found:
                logger.info(
                    "=== approved_image_suggestion | DB: {} | {} record(s) ===",
                    db_label, len(docs_found),
                )
                for idx, doc_item in enumerate(docs_found):
                    logger.info(
                        "[approved_image_suggestion|{}] Record #{}\n{}",
                        db_label, idx + 1,
                        json.dumps(doc_item, indent=2, default=str),
                    )
        except Exception as exc:
            logger.warning(
                "Failed reading ApproveImageSuggestion from '{}': {}", db_label, exc,
            )

    all_docs.sort(key=lambda x: x.get("_ts", ""))

    logger.info("=== TOTAL RECORDS for patient_id={}: {} ===", patient_id, len(all_docs))

    source_counts: Dict[str, int] = {}
    for d in all_docs:
        src = d.get("_source", "unknown")
        source_counts[src] = source_counts.get(src, 0) + 1
    logger.info("Per-source breakdown: {}", json.dumps(source_counts, default=str))

    return all_docs

async def _fetch_patient_record(patient_id: str) -> dict:
    """
    NEW — this pipeline previously never queried the patients collection at
    all, so accidentDetails.accidentType / mechanism / location were
    invisible to both the case-type classifier and the note itself. EDFS
    already does this fetch; the structured note generator did not.
    """
    doc = await patients_collection.find_one({"patient_id": patient_id})
    return _serialize_doc(dict(doc)) if doc else {}


def _split_by_source(all_docs: List[dict]) -> Dict[str, List[dict]]:
    buckets: Dict[str, List[dict]] = {
        "voice_dictation":           [],
        "clinical_action":           [],
        "image_extracted_ambulance": [],
        "doctor_voice_note":         [],
        "approved_image_suggestion": [],
        "doctor_suggestion":         [],
    }
    for doc in all_docs:
        src = doc.get("_source", "")
        if src in buckets:
            buckets[src].append(doc)
    return buckets


# ─────────────────────────────────────────────────────────────────────────────
# AGGREGATE RAW TEXT for Step-A
# ─────────────────────────────────────────────────────────────────────────────

def _aggregate_raw_text(all_sources: List[dict]) -> str:
    parts = []
    for entry_num, entry in enumerate(all_sources, start=1):
        src = entry.get("_source", "unknown")
        ts  = entry.get("_ts", "")
        entry_label = f"ENTRY-{entry_num} [{src}]"
        is_latest   = (entry_num == len(all_sources))
        current_tag = " ← CURRENT/LATEST" if is_latest else " (HISTORICAL)"

        def _extract_strings(obj: Any, path: str = "") -> None:
            if isinstance(obj, str) and len(obj.strip()) > 5:
                parts.append(
                    f"[{entry_label}{current_tag} | {ts} | {path}]\n{obj.strip()}"
                )
            elif isinstance(obj, dict):
                for k, v in obj.items():
                    if not k.startswith("_"):
                        _extract_strings(v, f"{path}.{k}" if path else k)
            elif isinstance(obj, list):
                for i, item in enumerate(obj):
                    _extract_strings(item, f"{path}[{i}]")

        for key, val in entry.items():
            if not key.startswith("_"):
                _extract_strings(val, key)

    return "\n\n".join(parts)


# ─────────────────────────────────────────────────────────────────────────────
# BUILD PROMPT PAYLOADS
# ─────────────────────────────────────────────────────────────────────────────

def _build_prompt_payloads(
    buckets: Dict[str, List[dict]],
    all_docs: List[dict],
) -> Dict[str, Any]:
    total = len(all_docs)

    def _entry_label_for(doc: dict) -> str:
        ts = doc.get("_ts", "")
        for i, d in enumerate(all_docs, start=1):
            if d.get("_ts") == ts and d.get("_source") == doc.get("_source"):
                suffix = " ← CURRENT" if i == total else " (historical)"
                return f"ENTRY-{i}{suffix}"
        return "ENTRY-?"

    voice_notes = []
    for d in buckets["voice_dictation"]:
        voice_notes.append({
            "entry":        _entry_label_for(d),
            "timestamp":    d.get("_ts", ""),
            "conversation": d.get("conversation", ""),
            "date":         d.get("date", ""),
            "time":         d.get("time", ""),
        })

    clinical_actions = []
    for d in buckets["clinical_action"]:
        action_type = d.get("action_type", "")
        entry_lbl   = _entry_label_for(d)
        if action_type == "approved":
            suggestions = (d.get("ai_suggestion") or {}).get("suggestions", {}) or {}
            sbar        = suggestions.get("sbar_summary", {}) or {}
            # FIX: previously the FULL ai_suggestion object (complete SBAR,
            # suspected_diagnoses, risk_stratification, hospital_prep,
            # specialist_alerts — often thousands of words) was injected
            # verbatim for an APPROVED action, exactly like the bug already
            # fixed below for REJECTED actions. Doctor approval of an action
            # means the ACTION TAKEN was approved — it does not mean the
            # doctor reviewed and confirmed every suspected diagnosis or
            # risk flag the AI generated alongside it. A real case showed a
            # fabricated "hemorrhagic shock in an elderly anticoagulated
            # patient" (for a 35-year-old with normal vitals) get approved
            # via its associated action, then get pulled in verbatim here
            # and presented in the structured note as if it were confirmed
            # clinical fact. Only a short, clearly-labelled, explicitly-
            # hedged summary is now included, mirroring the not_approved
            # branch.
            clinical_actions.append({
                "entry":           entry_lbl,
                "timestamp":       d.get("_ts", ""),
                "type":            "ai_approved",
                "critical_action": suggestions.get("single_most_critical_action_right_now", ""),
                "recommendation":  sbar.get("recommendation", ""),
                "approval_note": (
                    "AI-generated suggestion — doctor approved the ACTION "
                    "TAKEN above, not necessarily every suspected diagnosis "
                    "or risk flag the AI originally generated alongside it. "
                    "Do NOT treat any suspected_diagnoses, shock_risk, "
                    "elderly_risk_modifier, or anticoagulation fields from "
                    "this prior suggestion as confirmed clinical fact — "
                    "only use them if independently corroborated by the "
                    "actual voice/doctor notes or other sources below."
                ),
            })
        else:
            text = (
                d.get("voice_dictation")
                or d.get("notes")
                or d.get("text")
                or d.get("content")
                or ""
            )
            # FIX (Requirement 1): a doctor's direct "Send to EMT" dictation
            # is saved with the SAME action_type ("not_approved") as a
            # rejected AI suggestion, so downstream code/prompt could not
            # tell them apart and was treating the doctor's own words as
            # an untrustworthy rejected AI opinion. The only reliable
            # signal is: does this entry actually HAVE an ai_suggestion
            # object attached? If not, and there's a voice_dictation, it's
            # the doctor's own direct clinical input, not an AI suggestion
            # of any kind.
            is_direct_doctor_dictation = bool(d.get("voice_dictation")) and not d.get("ai_suggestion")
            entry_obj: Dict[str, Any] = {
                "entry":     entry_lbl,
                "timestamp": d.get("_ts", ""),
                "type":      "doctor_direct_dictation" if is_direct_doctor_dictation else (action_type or "voice_note"),
                "text":      text,
            }
            if is_direct_doctor_dictation:
                entry_obj["authority_note"] = (
                    "This is the doctor's OWN direct voice instruction, dictated "
                    "and sent straight to the EMT app. It is NOT an AI-generated "
                    "suggestion and was NOT rejected by anyone — it is authoritative "
                    "clinical input, equivalent in weight to a doctor voice note "
                    "(SOURCE 4). Its 'text' field MUST be incorporated into "
                    "provisional_diagnosis, treatment_provided, disposition, and "
                    "clinical_summary wherever clinically relevant, the same way "
                    "you would use a doctor voice note."
                )
            # FIX: previously the FULL ai_suggestion object (complete SBAR,
            # hospital_prep, risk_stratification, specialist_alerts — often
            # thousands of words) was injected verbatim for a REJECTED
            # (not_approved) action, giving a doctor-rejected AI suggestion
            # the same or greater weight in Step-B's prompt as genuinely
            # relevant sources. A rejected suggestion's own case_type/
            # is_trauma classification (produced by a separate upstream
            # agent that does not consult patient.accidentDetails either)
            # could dominate the note's clinical framing even though a
            # doctor explicitly did not approve it. Only a short, clearly-
            # labelled summary is now included — enough for audit-trail
            # context ("AI suggested X, doctor did not approve it") without
            # letting its full clinical narrative drive diagnosis/wording.
            ai_sug = d.get("ai_suggestion")
            if ai_sug:
                suggestions = ai_sug.get("suggestions", {}) or {}
                sbar = suggestions.get("sbar_summary", {}) or {}
                entry_obj["ai_suggestion_summary"] = {
                    "note": (
                        "AI-generated suggestion — NOT approved by doctor. "
                        "Do not treat this, or any suspected_diagnoses/"
                        "risk_stratification/shock_risk field within it, as "
                        "confirmed clinical fact, and do not use it to "
                        "override the case classification above; it may "
                        "reflect a different scenario, a data-extraction "
                        "error, or be superseded by later entries."
                    ),
                    "ai_suggested_case_type": ai_sug.get("case_type"),
                    "ai_suggested_is_trauma": ai_sug.get("is_trauma"),
                    "situation_suggested_by_ai": sbar.get("situation", ""),
                }
            clinical_actions.append(entry_obj)

    doctor_voice = [
        {
            "entry":        _entry_label_for(d),
            "timestamp":    d.get("_ts", ""),
            "conversation": d.get("conversation", ""),
        }
        for d in buckets["doctor_voice_note"]
    ]

    doctor_suggestions = [
        {
            "entry":           _entry_label_for(d),
            "timestamp":       d.get("_ts", ""),
            "suggestion_text": d.get("suggestion_text", ""),
        }
        for d in buckets["doctor_suggestion"]
    ]

    image_extracted = [
        {
            "entry":          _entry_label_for(d),
            "timestamp":      d.get("_ts", ""),
            "extracted_text": d.get("extracted_text", ""),
        }
        for d in buckets["image_extracted_ambulance"]
    ]

    approved_analysis = []
    for d in buckets["approved_image_suggestion"]:
        approved_analysis.append({
            "entry":               _entry_label_for(d),
            "timestamp":           d.get("_ts", ""),
            "impressive_findings": d.get("impressive_findings", ""),
            "comorbidities":       d.get("comorbidities", ""),
            "trend_analysis":      d.get("trend_analysis", ""),
            "ai_impression":       d.get("ai_impression", ""),
            "risk_level":          d.get("risk_level", ""),
            "emt_actions":         d.get("emt_actions", ""),
            "physician_alert":     d.get("physician_alert", ""),
            "vitals_timeline":     d.get("vitals_timeline", []),
            "trends":              d.get("trends", []),
            "ai_raw_output":       d.get("ai_raw_output", ""),
        })

    logger.info("PAYLOAD voice_notes ({} items)\n{}",
                len(voice_notes), json.dumps(voice_notes, indent=2, default=str))
    logger.info("PAYLOAD clinical_actions ({} items)\n{}",
                len(clinical_actions), json.dumps(clinical_actions, indent=2, default=str))
    logger.info("PAYLOAD doctor_voice ({} items)\n{}",
                len(doctor_voice), json.dumps(doctor_voice, indent=2, default=str))
    logger.info("PAYLOAD doctor_suggestions ({} items)\n{}",
                len(doctor_suggestions), json.dumps(doctor_suggestions, indent=2, default=str))
    logger.info("PAYLOAD image_extracted ({} items)\n{}",
                len(image_extracted), json.dumps(image_extracted, indent=2, default=str))
    logger.info("PAYLOAD approved_analysis ({} items)\n{}",
                len(approved_analysis), json.dumps(approved_analysis, indent=2, default=str))

    return {
        "voice_notes":        voice_notes,
        "clinical_actions":   clinical_actions,
        "doctor_voice":       doctor_voice,
        "doctor_suggestions": doctor_suggestions,
        "image_extracted":    image_extracted,
        "approved_analysis":  approved_analysis,
    }

def _build_case_type_block(case_type_info: Dict[str, Any]) -> str:
    is_trauma  = case_type_info.get("is_trauma")
    case_type  = case_type_info.get("case_type", "unknown")
    rationale  = case_type_info.get("routing_rationale", "")

    from_registration = "registration incident_type" in rationale.lower()

    block = (
        f"is_trauma = {is_trauma}\n"
        f"case_type = {case_type!r}\n"
        f"routing_rationale = {rationale}\n\n"
        "Do not invent trauma-specific content (mechanism of injury, spinal "
        "precautions, injury-driven physical exam findings or diagnoses) if "
        "is_trauma is false, and do not invent cardiac/medical-only content "
        "if is_trauma is true, unless the actual source data below genuinely "
        "supports it. This classification was derived deterministically, not "
        "guessed — treat it as ground truth for framing, but always ground "
        "specific clinical content in the real sources.\n\n"
        "CRITICAL — WORDING MUST MATCH is_trauma: never write the phrase "
        "'non-trauma' or 'non-trauma medical case' anywhere in this note "
        "(disposition, clinical_summary, or any other field) if is_trauma is "
        "true above. Never write 'trauma case', 'trauma evaluation', 'trauma "
        "team', or 'trauma bay' anywhere if is_trauma is false above. This "
        "applies even if other input data (e.g. an AI-approved clinical "
        "suggestion) describes a different-sounding clinical picture."
    )

    if from_registration:
        block += (
            "\n\nNOTE: this trauma classification came from the patient's "
            "REGISTERED incident type (accidentDetails.accidentType), not "
            "from the voice/doctor notes or clinical_actions sources below. "
            "If the SOURCE 3 (ED CLINICAL ACTIONS) content below describes a "
            "clinical picture that does not obviously fit a trauma incident "
            "(e.g. a purely cardiac/respiratory presentation with no injury "
            "language), treat that as a possible data inconsistency rather "
            "than silently overriding the registered incident type — you may "
            "still report the clinical findings from that source verbatim, "
            "but do not use them to override the case classification or "
            "invent a 'non-trauma' framing."
        )

    return block


def _build_note_prompt(
    payloads: Dict[str, Any],
    extracted_facts: dict,
    case_type_info: Dict[str, Any],
    voice_notes_override: Optional[str] = None,
) -> str:
    voice_json = (
        voice_notes_override
        if voice_notes_override is not None
        else json.dumps(payloads["voice_notes"], indent=2, default=str)
    )
    guardrail_rules = (
        STABILITY_LABELING_RULE + "\n" + DIAGNOSTIC_HEDGING_RULE + "\n" + EVIDENCE_TRACEABILITY_RULE
    )
    return NOTE_GENERATION_PROMPT_TEMPLATE.format(
        case_type_block          = _build_case_type_block(case_type_info),
        emergency_rule           = EMERGENCY_RULE,
        guardrail_rules          = guardrail_rules,
        extracted_facts_json     = json.dumps(extracted_facts,                indent=2, default=str),
        voice_notes_json         = voice_json,
        clinical_actions_json    = json.dumps(payloads["clinical_actions"],   indent=2, default=str),
        doctor_voice_notes_json  = json.dumps(payloads["doctor_voice"],       indent=2, default=str),
        doctor_suggestions_json  = json.dumps(payloads["doctor_suggestions"], indent=2, default=str),
        image_extracted_json     = json.dumps(payloads["image_extracted"],    indent=2, default=str),
        approved_analysis_json   = json.dumps(payloads["approved_analysis"],  indent=2, default=str),
    )


# ─────────────────────────────────────────────────────────────────────────────
# SAFETY-NET MERGE  (FIX F1, F3, F4 + NEW triage override + placeholder cleanup)
# ─────────────────────────────────────────────────────────────────────────────

_ANTICOAG_KEYWORDS_NOTE = (
    "warfarin", "coumadin", "dabigatran", "pradaxa", "rivaroxaban", "xarelto",
    "apixaban", "eliquis", "edoxaban", "heparin", "enoxaparin", "lovenox",
    "clopidogrel", "plavix", "ticagrelor", "prasugrel", "aspirin",
    "antiplatelet", "anticoagulant", "blood thinner",
)
_BLEEDING_KEYWORDS_NOTE = (
    "bleed", "haemorrhage", "hemorrhage", "blood loss", "laceration",
    "wound", "penetrat", "gunshot", "stab", "hematoma", "haematoma",
)


def _sanitize_unsupported_note_fields(note: dict, facts: dict, raw_text: str) -> dict:
    """
    NEW — deterministic backstop mirroring EVIS's
    _sanitize_unsupported_risk_flags(). Applied here as well because this
    generator ingests EVIS's own (possibly already-hallucinated, possibly
    since-approved) prior suggestions as SOURCE 3 context, so a fabricated
    finding can re-enter through that path even independent of anything
    Step-A/Step-B invent themselves. This does not attempt to police every
    possible diagnosis — only the specific, cheaply-verifiable classes
    (documented age, named anticoagulant, bleeding/injury evidence) that a
    real case showed being fabricated.
    """
    age = None
    age_raw = (note.get("patient_details") or {}).get("age") or facts.get("age")
    if age_raw is not None:
        m = re.search(r"\d+", str(age_raw))
        if m:
            age = int(m.group())
    is_elderly = age is not None and age >= 65

    combined_text = (raw_text or "").lower()
    anticoag_hit = any(kw in combined_text for kw in _ANTICOAG_KEYWORDS_NOTE)
    bleeding_hit = any(kw in combined_text for kw in _BLEEDING_KEYWORDS_NOTE)

    hs = note.get("haemodynamic_status") or {}
    if isinstance(hs, dict) and not bleeding_hit:
        shock_type = str(hs.get("shock_type") or "").strip().lower()
        if shock_type.startswith("haemorrh") or shock_type.startswith("hemorrh"):
            hs["shock_type"] = None
            hs["shock_risk"] = None
            logger.warning("Sanitizer: cleared unsupported hemorrhagic shock_type in haemodynamic_status.")
    note["haemodynamic_status"] = hs

    allergy = note.get("allergy_information") or {}
    # (allergy block intentionally left untouched — not part of this
    # failure mode; included only to show where a similar targeted check
    # could be added later if needed.)

    pd = note.get("provisional_diagnosis") or {}
    if isinstance(pd, dict) and not (anticoag_hit or bleeding_hit):
        for key in ("primary_diagnosis",):
            val = str(pd.get(key) or "").lower()
            if any(kw in val for kw in ("hemorrhagic shock", "haemorrhagic shock")):
                logger.warning(
                    "Sanitizer: primary_diagnosis references hemorrhagic shock "
                    "with no bleeding/injury evidence in source text — flagging, not deleting."
                )
                pd["primary_diagnosis"] = f"{pd[key]} [UNVERIFIED — no bleeding/injury evidence found in source text; confirm with clinician]"
    note["provisional_diagnosis"] = pd

    if not is_elderly:
        # Strip an "elderly" characterization if the note text asserts it
        # without a documented age >=65 anywhere in the sources.
        summary = note.get("clinical_summary")
        if isinstance(summary, str) and "elderly" in summary.lower() and (age is None or age < 65):
            note["clinical_summary"] = re.sub(r"\belderly\b", "", summary, flags=re.IGNORECASE).strip()
            logger.warning("Sanitizer: removed unsupported 'elderly' characterization from clinical_summary.")

    return note


def _merge_extracted_facts(
    note: dict,
    facts: dict,
    case_type_info: Optional[Dict[str, Any]] = None,
    authoritative_triage: Optional[Dict] = None,
    accident: Optional[Dict] = None,
) -> dict:
    """
    Post-processing merge that guarantees Step-A facts land correctly.

    FIXES applied here:
    F1 — Discrepancy dedup uses _normalise_vital_param() to match
         "heart rate" == "heart rate (hr)" before inserting. Now None-safe
         (see CRASH FIX at top of file).
    F3 — treatment_provided is now also populated from facts["interventions"],
         not only from facts["medications"].
    F4 — Temperature unit-equivalence check: 98.6 F == 36.6 C → NOT a
         clinical discrepancy, noted as "unit difference only".
    NEW — monitor_vs_clinical_discrepancies / contraindications /
         specialist_alerts are scrubbed of all-null placeholder entries
         FIRST, before any field on them is read, eliminating the crash
         class entirely (not just the one call site that triggered it).
    NEW — triage_assessment.triage_colour is overwritten with the shared
         deterministic compute_triage_colour(), same convention as
         EIDIS/EDFS. The LLM's own suggestion is preserved by the caller
         (see generate_emergency_structured_note) as a separate top-level
         field, never inside `note` itself.
    """
    # ── Defensive cleanup FIRST — this is what prevents the crash class,
    # not just the one call site that happened to trigger it. ───────────
    note["monitor_vs_clinical_discrepancies"] = _strip_null_placeholder_entries(
        note.get("monitor_vs_clinical_discrepancies")
    )
    note["contraindications"] = _strip_null_placeholder_entries(
        note.get("contraindications")
    )
    note["specialist_alerts"] = _strip_null_placeholder_entries(
        note.get("specialist_alerts")
    )

    vs  = note.setdefault("vital_signs", {})
    na  = note.setdefault("neurological_assessment", {})
    ps  = note.setdefault("primary_survey", {})
    hs  = note.setdefault("haemodynamic_status", {})
    rs  = note.setdefault("respiratory_status", {})
    fb  = note.setdefault("fluid_balance", {})
    ta  = note.setdefault("triage_assessment", {})
    st  = note.setdefault("scene_and_transport", {})
    pa  = note.setdefault("pain_assessment", {})

    # ── VITAL SIGNS — prefer doctor values over monitor ───────────────────────
    vital_map = [
        ("doctor_hr",   "monitor_hr",   "heart_rate_bpm"),
        ("doctor_bp",   "monitor_bp",   "blood_pressure_mmhg"),
        ("doctor_rr",   "monitor_rr",   "respiratory_rate_bpm"),
        ("doctor_spo2", "monitor_spo2", "spo2_percent"),
        ("doctor_temp", "monitor_temp", "temperature"),
    ]
    for doc_key, mon_key, out_key in vital_map:
        doc_val = facts.get(doc_key)
        mon_val = facts.get(mon_key)
        if doc_val is not None:
            vs[out_key] = doc_val
        elif mon_val is not None and vs.get(out_key) is None:
            vs[out_key] = mon_val

    for fact_key in ("heart_rate_bpm", "blood_pressure_mmhg", "respiratory_rate_bpm",
                     "spo2_percent", "temperature", "gcs_total", "pain_score",
                     "blood_glucose_mgdl"):
        if vs.get(fact_key) is None and facts.get(fact_key) is not None:
            vs[fact_key] = facts[fact_key]

    bp = vs.get("blood_pressure_mmhg")
    if bp is not None and not isinstance(bp, str):
        vs["blood_pressure_mmhg"] = str(bp)

    if vs.get("source_of_vitals") is None:
        if facts.get("doctor_hr") is not None or facts.get("doctor_bp") is not None:
            vs["source_of_vitals"] = "doctor_voice_note (clinician-assessed)"
        elif facts.get("monitor_hr") is not None:
            vs["source_of_vitals"] = "monitor_image (device reading)"

    # ── NEUROLOGICAL ──────────────────────────────────────────────────────────
    for fact_key in ("gcs_eye", "gcs_verbal", "gcs_motor", "pupils"):
        if na.get(fact_key) is None and facts.get(fact_key) is not None:
            na[fact_key] = facts[fact_key]

    if facts.get("consciousness_current") and na.get("mental_status") is None:
        na["mental_status"] = facts["consciousness_current"]
    elif facts.get("mental_status") and na.get("mental_status") is None:
        na["mental_status"] = facts["mental_status"]
    if na.get("avpu") is None and facts.get("avpu"):
        na["avpu"] = facts["avpu"]

    if na.get("gcs_total") is None and vs.get("gcs_total") is not None:
        na["gcs_total"] = vs["gcs_total"]
    if vs.get("gcs_total") is None:
        e, v, m = na.get("gcs_eye"), na.get("gcs_verbal"), na.get("gcs_motor")
        if all(isinstance(x, int) for x in [e, v, m]):
            computed = e + v + m   # type: ignore[operator]
            vs["gcs_total"] = computed
            na["gcs_total"] = computed

    # ── PRIMARY SURVEY ────────────────────────────────────────────────────────
    for fk, nk in (("airway", "airway"), ("breathing", "breathing"), ("circulation", "circulation")):
        if ps.get(nk) is None and facts.get(fk) is not None:
            ps[nk] = facts[fk]
    if ps.get("disability") is None and vs.get("gcs_total") is not None:
        ps["disability"] = f"GCS {vs['gcs_total']}"
        if na.get("mental_status"):
            ps["disability"] += f" — {na['mental_status']}"

    # ── MONITOR vs CLINICAL DISCREPANCIES  (FIX F1 + F4, None-safe) ──────────
    discrepancies = note.get("monitor_vs_clinical_discrepancies", [])

    existing_disc_params = {
        _normalise_vital_param(d.get("vital_parameter"))
        for d in discrepancies
        if isinstance(d, dict)
    }
    existing_disc_params.discard("")

    disc_definitions = [
        ("heart_rate_bpm",       "doctor_hr",   "monitor_hr",   "Heart Rate (HR)"),
        ("blood_pressure_mmhg",  "doctor_bp",   "monitor_bp",   "Blood Pressure (NIBP)"),
        ("respiratory_rate_bpm", "doctor_rr",   "monitor_rr",   "Respiratory Rate (RR)"),
        ("spo2_percent",         "doctor_spo2", "monitor_spo2", "SpO2"),
        ("temperature",          "doctor_temp", "monitor_temp", "Temperature"),
    ]
    for _, doc_key, mon_key, label in disc_definitions:
        doc_val = facts.get(doc_key)
        mon_val = facts.get(mon_key)
        if doc_val is None or mon_val is None:
            continue
        if _normalise_vital_param(label) in existing_disc_params:
            continue  # already captured by LLM, skip to avoid duplicate

        # FIX F4: temperature unit equivalence check
        if label == "Temperature":
            if _temps_clinically_equivalent(doc_val, mon_val):
                discrepancies.append({
                    "vital_parameter":       label,
                    "clinician_value":       doc_val,
                    "clinician_source":      "doctor_voice_note",
                    "monitor_value":         mon_val,
                    "monitor_source":        "image_extracted_ambulance",
                    "clinical_significance": "Unit difference only — values are clinically equivalent",
                    "recommended_action":    "No action required; values represent the same temperature in different units",
                })
                continue

        if str(doc_val) != str(mon_val):
            discrepancies.append({
                "vital_parameter":       label,
                "clinician_value":       doc_val,
                "clinician_source":      "doctor_voice_note",
                "monitor_value":         mon_val,
                "monitor_source":        "image_extracted_ambulance",
                "clinical_significance": "High — values differ significantly; investigate cause",
                "recommended_action":    "Recheck vital manually; do not assume either value without re-measurement",
            })

    note["monitor_vs_clinical_discrepancies"] = discrepancies

    # ── SCENE AND TRANSPORT ───────────────────────────────────────────────────
    accident = accident or {}
    if st.get("incident_type") is None and accident.get("accidentType"):
        st["incident_type"] = accident["accidentType"]
    if st.get("mechanism_of_injury") is None:
        if facts.get("mechanism_of_injury"):
            st["mechanism_of_injury"] = facts["mechanism_of_injury"]
        elif accident.get("accidentType"):
            # FIX: previously mechanism_of_injury could only ever come from
            # Step-A's free-text extraction; if voice/doctor notes didn't
            # restate the incident type, this stayed null even for a
            # registered Road Traffic case. Registration accidentType is
            # now used as a fallback so Scene & Transport isn't silently
            # empty for genuine trauma cases.
            st["mechanism_of_injury"] = accident["accidentType"]
    if st.get("scene_description") is None:
        if facts.get("scene_details"):
            st["scene_description"] = facts["scene_details"]
        elif accident.get("location"):
            st["scene_description"] = f"Incident location: {accident['location']}"
    if st.get("transport_notes") is None and facts.get("transport_details"):
        st["transport_notes"] = facts["transport_details"]

    # ── PAIN ASSESSMENT ───────────────────────────────────────────────────────
    if pa.get("pain_score") is None and vs.get("pain_score") is not None:
        pa["pain_score"] = vs["pain_score"]

    # ── OXYGEN / VENTILATION → EMERGENCY INTERVENTIONS ───────────────────────
    existing_int = [i for i in note.get("emergency_interventions", []) if isinstance(i, dict)]
    existing_int_lower = {
        str(i.get("intervention", "")).lower()
        for i in existing_int
    }
    for field, label in (
        ("oxygen_therapy",       "Oxygen therapy"),
        ("assisted_ventilation", "Assisted ventilation"),
    ):
        val = facts.get(field)
        if val and str(val).lower() not in ("none", "null", ""):
            if label.lower() not in existing_int_lower:
                existing_int.append({
                    "intervention": f"{label}: {val}",
                    "medication":   None,
                    "dosage":       None,
                    "route":        None,
                    "time_given":   None,
                })
    for intv in facts.get("interventions", []):
        if intv and str(intv).lower() not in existing_int_lower:
            existing_int.append({
                "intervention": intv,
                "medication":   None,
                "dosage":       None,
                "route":        None,
                "time_given":   None,
            })
    note["emergency_interventions"] = existing_int

    # ── MEDICATIONS + INTERVENTIONS → TREATMENT PROVIDED  (FIX F3) ───────────
    existing_tx = note.get("treatment_provided", [])
    existing_tx_lower = {str(t).lower() for t in existing_tx}

    # medications
    for med in _split_combined_medications(facts.get("medications", [])):
        if med and str(med).lower() not in existing_tx_lower:
            existing_tx.append(med)
            existing_tx_lower.add(str(med).lower())

    # interventions — FIX F3: also feed into treatment_provided
    for intv in facts.get("interventions", []):
        if intv and str(intv).lower() not in existing_tx_lower:
            existing_tx.append(intv)
            existing_tx_lower.add(str(intv).lower())

    note["treatment_provided"] = existing_tx

    # ── DIAGNOSES → PROVISIONAL DIAGNOSIS ────────────────────────────────────
    pd = note.setdefault("provisional_diagnosis", {})
    step_a_diags = facts.get("diagnoses", [])
    if step_a_diags:
        if pd.get("primary_diagnosis") is None:
            pd["primary_diagnosis"] = step_a_diags[0]
        existing_diff = pd.get("differential_diagnoses", [])
        for d in step_a_diags[1:]:
            if isinstance(d, str) and d not in str(existing_diff):
                if isinstance(existing_diff, list):
                    existing_diff.append({"diagnosis": d})
        pd["differential_diagnoses"] = existing_diff

    # ── PRESENTING COMPLAINTS ─────────────────────────────────────────────────
    if not note.get("presenting_complaints") and facts.get("presenting_complaints"):
        note["presenting_complaints"] = [
            {"complaint": c, "onset": None, "duration": None, "severity": None}
            for c in facts["presenting_complaints"]
        ]

    # ── INVESTIGATIONS  (FIX F2 ensures Step-A populates this reliably) ───────
    existing_inv = note.get("investigations_ordered", [])
    existing_inv_lower = {str(i).lower() for i in existing_inv}
    for inv in facts.get("investigations", []):
        if inv and str(inv).lower() not in existing_inv_lower:
            existing_inv.append(inv)
    note["investigations_ordered"] = existing_inv

    # ── ALLERGIES ─────────────────────────────────────────────────────────────
    allergy = note.setdefault("allergy_information", {})
    if not allergy.get("known_allergies") and facts.get("allergies"):
        allergy["known_allergies"] = facts["allergies"]

    # ── BLOOD GLUCOSE ─────────────────────────────────────────────────────────
    if vs.get("blood_glucose_mgdl") is None and facts.get("blood_glucose_mgdl") is not None:
        vs["blood_glucose_mgdl"] = facts["blood_glucose_mgdl"]

    # ── DOCUMENTATION CONFIDENCE — ensure level is never null ─────────────────
    dc = note.setdefault("documentation_confidence", {})
    if dc.get("level") is None:
        sources_used_count = len([
            s for s in dc.get("sources_used", []) if s
        ])
        # If LLM left sources_used empty, estimate from facts
        if sources_used_count == 0:
            has_doctor = facts.get("doctor_hr") is not None
            has_monitor = facts.get("monitor_hr") is not None
            has_voice = bool(facts.get("mechanism_of_injury") or facts.get("interventions"))
            sources_used_count = sum([has_doctor, has_monitor, has_voice])
        if sources_used_count >= 3:
            dc["level"] = "High"
        elif sources_used_count == 2:
            dc["level"] = "Moderate"
        else:
            dc["level"] = "Low"

    # ── NEW — DETERMINISTIC TRIAGE COLOUR OVERRIDE ────────────────────────────
    # Ported from EIDIS/EDFS convention: overwrite triage_assessment.triage_colour
    # with the shared deterministic function so triage can no longer diverge
    # between this document and the other two pipelines for the same patient.
    try:
        hr_i     = first_int(vs.get("heart_rate_bpm"))
        rr_i     = first_int(vs.get("respiratory_rate_bpm"))
        spo2_i   = first_int(vs.get("spo2_percent"))
        bp_sys_i = parse_bp_systolic(vs.get("blood_pressure_mmhg"))
        gcs_i    = first_int(vs.get("gcs_total"))

        consciousness_txt = str(na.get("mental_status") or "").lower()
        shock_suspected = bool(
            hs.get("shock_risk") and str(hs.get("shock_risk")).lower() not in ("none", "low", "unlikely")
        )
        respiratory_failure_risk = str(rs.get("status") or "").lower() in (
            "inadequate", "critical", "failing", "distress"
        )
        chest_life_threat_flag = any(
            kw in str(note.get("physical_examination", {}).get("chest_and_thorax") or "").lower()
            or kw in str((note.get("provisional_diagnosis") or {}).get("primary_diagnosis") or "").lower()
            for kw in ("pneumothorax", "hemothorax", "haemothorax", "tamponade")
        )
        doctor_stated_severity = None
        combined_ctx = " ".join(filter(None, [
            str(st.get("scene_description") or ""),
            str((note.get("provisional_diagnosis") or {}).get("clinical_impression") or ""),
        ])).lower()
        if "severe" in combined_ctx or "critical" in combined_ctx:
            doctor_stated_severity = "SEVERE"
        elif "moderate" in combined_ctx:
            doctor_stated_severity = "MODERATE"

        disposition_decision = str((note.get("disposition") or {}).get("decision") or "").lower()
        arrest_or_deceased_indicated = "death" in disposition_decision or "deceased" in disposition_decision

        computed_colour = compute_triage_colour(
            hr=hr_i,
            rr=rr_i,
            spo2_room_air=spo2_i,
            spo2_on_o2=None,
            bp_sys=bp_sys_i,
            gcs=gcs_i,
            consciousness=consciousness_txt,
            shock_suspected=shock_suspected,
            respiratory_failure_risk=respiratory_failure_risk,
            pneumothorax_or_hemothorax_flag=chest_life_threat_flag,
            doctor_stated_severity=doctor_stated_severity,
            arrest_or_deceased_indicated=arrest_or_deceased_indicated,
        )
        if authoritative_triage and authoritative_triage.get("triage_colour"):
            ta["triage_colour"] = authoritative_triage["triage_colour"]
            ta["triage_colour_source"] = "EVIS_authoritative"
            ta["triage_colour_deterministic_cross_check"] = computed_colour
        else:
            ta["triage_colour"] = computed_colour
            ta["triage_colour_source"] = "deterministic_fallback_no_evis_data"
    except Exception as exc:
        logger.warning("Deterministic triage colour computation failed, leaving LLM value: {}", exc)
    note["triage_assessment"] = ta

    # ── NEW — case-type gating: fix a non-trauma case whose disposition
    # text still reads like a trauma workup, AND the mirror case (a case
    # confirmed trauma — e.g. by registration accidentType — whose
    # disposition/summary text still says "non-trauma"). Previously only
    # the first direction was handled, which is why a Road Traffic patient
    # correctly classified is_trauma=True could still show "non-trauma
    # medical case" in disposition.handover_summary / clinical_summary —
    # nothing ever scrubbed that wording once is_trauma flipped to True.
    if case_type_info is not None:
        is_trauma = case_type_info.get("is_trauma")
        disp = note.setdefault("disposition", {})

        def _reconcile_wording(text: Optional[str]) -> Optional[str]:
            if not text:
                return text
            out = text
            if is_trauma is False:
                if any(kw in out.lower() for kw in ("trauma evaluation", "trauma team", "trauma bay")):
                    out = re.sub(r"trauma evaluation", "clinical evaluation", out, flags=re.IGNORECASE)
                    out = re.sub(r"trauma team", "clinical team", out, flags=re.IGNORECASE)
                    out = re.sub(r"trauma bay", "clinical area", out, flags=re.IGNORECASE)
            elif is_trauma is True:
                if "non-trauma" in out.lower() or "non trauma" in out.lower():
                    out = re.sub(r"non[\s-]?trauma medical case", "trauma case", out, flags=re.IGNORECASE)
                    out = re.sub(r"non[\s-]?trauma case", "trauma case", out, flags=re.IGNORECASE)
                    out = re.sub(r"non[\s-]?trauma", "trauma", out, flags=re.IGNORECASE)
            return out

        for field in ("decision", "rationale", "handover_summary"):
            disp[field] = _reconcile_wording(disp.get(field))
        note["disposition"] = disp

        if note.get("clinical_summary"):
            note["clinical_summary"] = _reconcile_wording(note["clinical_summary"])

    note = _sanitize_unsupported_note_fields(note, facts, note.pop("_raw_text_for_sanitizer", ""))

    return note


# ─────────────────────────────────────────────────────────────────────────────
# POST /generate-emergency-structured-note
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/generate-emergency-structured-note")
async def generate_emergency_structured_note(request: Request):
    try:
        payload    = await request.json()
        doctor_id  = payload.get("doctor_id")
        patient_id = payload.get("patient_id")

        if not doctor_id or not patient_id:
            raise HTTPException(status_code=400, detail="doctor_id and patient_id are required")

        logger.info(
            "╔══ START generate-emergency-structured-note ══╗ patient_id={} doctor_id={}",
            patient_id, doctor_id,
        )

        all_docs = await _fetch_all_sources(patient_id)
        if not all_docs:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"No clinical data found in any collection for patient_id: {patient_id}. "
                    "Collections checked: voice_dictations, clinical_actions, "
                    "Image_Extracted_Ambulance, doctor_voice_notes, Doctor_Suggestion_Ambulance, "
                    "ApproveImageSuggestion (both doctorassistai and doctorassist)."
                ),
            )

        # NEW — this pipeline previously never fetched the patient record,
        # so registered incident/accident data was invisible to both the
        # case-type classifier and the note. Fetch it here (mirrors EDFS).
        patient_record = await _fetch_patient_record(patient_id)
        accident = patient_record.get("accidentDetails", {}) or {}

        buckets  = _split_by_source(all_docs)
        payloads = _build_prompt_payloads(buckets, all_docs)

        aggregated_text = _aggregate_raw_text(all_docs)
        extracted_facts: dict = {}

        if aggregated_text.strip():
            logger.info("╠══ STEP-A INPUT: {} docs, {} chars ══╣",
                        len(all_docs), len(aggregated_text))
            try:
                extracted_facts = _safe_llm_json(
                    EXTRACTION_PROMPT_TEMPLATE.format(raw_text=aggregated_text),
                    MODEL_STEP_A,
                    max_tokens=2000,
                )
                logger.info("╠══ STEP-A OUTPUT ══╣\n{}",
                            json.dumps(extracted_facts, indent=2, default=str))
            except Exception as exc:
                logger.warning("Step-A extraction failed ({}); continuing.", exc)
        else:
            logger.warning("Aggregated text empty — Step-A skipped for patient_id={}", patient_id)

        # NEW — deterministic case-type classification, zero extra LLM cost.
        # Registration accidentType is now checked first (Patch 3).
        case_type_info = derive_case_type_from_facts(
            extracted_facts, aggregated_text,
            registered_incident_type=accident.get("accidentType"),
        )
        logger.info(
            "╠══ CASE CLASSIFICATION (zero-LLM, derived from registration + Step-A facts) ══╣ "
            "case_type={} is_trauma={} | {}",
            case_type_info["case_type"], case_type_info["is_trauma"],
            case_type_info["routing_rationale"],
        )

        note_prompt = _build_note_prompt(payloads, extracted_facts, case_type_info)
        logger.info("╠══ STEP-B PROMPT (first 3000 chars) ══╣\n{}", note_prompt[:3000])

        llm_output: dict = _safe_llm_json(note_prompt, MODEL_STEP_B, max_tokens=5000)
        logger.info("╠══ STEP-B OUTPUT ══╣\n{}",
                    json.dumps(llm_output, indent=2, default=str))

        # Capture the LLM's own triage suggestion BEFORE the deterministic
        # override inside _merge_extracted_facts overwrites it in place —
        # mirrors EDFS's triage_colour_llm_suggested convention.
        triage_colour_llm_suggested = (
            (llm_output.get("triage_assessment") or {}).get("triage_colour")
        )

        authoritative_triage = await fetch_authoritative_triage(patient_triage_status_collection, patient_id)
        llm_output["_raw_text_for_sanitizer"] = aggregated_text
        llm_output = _merge_extracted_facts(llm_output, extracted_facts, case_type_info, authoritative_triage, accident)
        logger.info("╠══ FINAL NOTE after merge ══╣\n{}",
                    json.dumps(llm_output, indent=2, default=str))

        llm_output.setdefault("patient_details", {})
        llm_output["patient_details"]["doctor_id"]  = doctor_id
        llm_output["patient_details"]["patient_id"] = patient_id

        sources_used = {
            "voice_dictations":           len(buckets["voice_dictation"]),
            "clinical_actions":           len(buckets["clinical_action"]),
            "image_extracted_ambulance":  len(buckets["image_extracted_ambulance"]),
            "doctor_voice_notes":         len(buckets["doctor_voice_note"]),
            "approved_image_suggestions": len(buckets["approved_image_suggestion"]),
            "doctor_suggestions":         len(buckets["doctor_suggestion"]),
            "total_records":              len(all_docs),
        }
        save_doc = {
            "doctor_id":                    doctor_id,
            "patient_id":                   patient_id,
            "structured_note":              llm_output,
            "extracted_facts":              extracted_facts,
            "case_type":                    case_type_info["case_type"],
            "is_trauma":                    case_type_info["is_trauma"],
            "routing_rationale":            case_type_info["routing_rationale"],
            "triage_colour":                (llm_output.get("triage_assessment") or {}).get("triage_colour"),
            "triage_colour_llm_suggested":  triage_colour_llm_suggested,
            "generated_at":                 datetime.utcnow(),
            "sources_used":                 sources_used,
        }
        insert_result = await emergency_structured_notes_collection.insert_one(save_doc)
        logger.info("╚══ SAVED id={} | sources={} ══╝",
                    str(insert_result.inserted_id), json.dumps(sources_used, default=str))

        return {
            "status":                      "success",
            "feature_name":                "emergency_structured_note",
            "saved_id":                    str(insert_result.inserted_id),
            "finaloutput":                 llm_output,
            "case_type":                   case_type_info["case_type"],
            "is_trauma":                   case_type_info["is_trauma"],
            "routing_rationale":           case_type_info["routing_rationale"],
            "triage_colour_llm_suggested": triage_colour_llm_suggested,
            "metadata": {
                "doctor_id":          doctor_id,
                "patient_id":         patient_id,
                **sources_used,
                "step_a_facts_found": bool(extracted_facts),
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Emergency structured note generation failed")
        raise HTTPException(
            status_code=500,
            detail=f"Emergency structured note generation error: {str(e)}",
        )


# ─────────────────────────────────────────────────────────────────────────────
# GET /get-emergency-structured-note/{patient_id}
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/get-emergency-structured-note/{patient_id}")
async def get_emergency_structured_note(patient_id: str):
    doc = await emergency_structured_notes_collection.find_one(
        {"patient_id": patient_id},
        sort=[("generated_at", -1)],
    )
    if not doc:
        raise HTTPException(status_code=404, detail="No structured note found")
    doc["_id"] = str(doc["_id"])
    if doc.get("generated_at"):
        doc["generated_at"] = _safe_isoformat(doc["generated_at"])
    return {"status": "success", "data": doc}


# ─────────────────────────────────────────────────────────────────────────────
# POST /generate-emergency-structured-note-from-image
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/generate-emergency-structured-note-from-image")
async def generate_structured_note_from_image(request: Request):
    """
    Accepts:
      {
        "doctor_id":    "...",
        "patient_id":   "...",
        "image_base64": "<base64-encoded JPEG or PNG of the PCR form>",
        "image_mime":   "image/jpeg"   // optional, default image/jpeg
      }
    """
    try:
        payload    = await request.json()
        doctor_id  = payload.get("doctor_id")
        patient_id = payload.get("patient_id")
        image_b64  = payload.get("image_base64")
        image_mime = payload.get("image_mime", "image/jpeg")

        if not doctor_id or not patient_id:
            raise HTTPException(status_code=400, detail="doctor_id and patient_id are required")

        logger.info(
            "╔══ START generate-emergency-structured-note-from-image ══╗ "
            "patient_id={} doctor_id={} image={}",
            patient_id, doctor_id, bool(image_b64),
        )

        image_facts: dict = {}
        if image_b64:
            try:
                vision_completion = groq_client.chat.completions.create(
                    model="meta-llama/llama-4-scout-17b-16e-instruct",
                    messages=[{
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:{image_mime};base64,{image_b64}"},
                            },
                            {"type": "text", "text": IMAGE_EXTRACTION_PROMPT},
                        ],
                    }],
                    temperature=0.1,
                    response_format={"type": "json_object"},
                    max_tokens=2000,
                )
                raw_img     = vision_completion.choices[0].message.content
                image_facts = json.loads(_repair_json(raw_img))
                logger.info("╠══ IMAGE PCR EXTRACTION ══╣\n{}",
                            json.dumps(image_facts, indent=2, default=str))
            except Exception as exc:
                logger.warning("Image extraction failed ({}); continuing without image data.", exc)
        else:
            logger.info("No image_base64 — image extraction skipped.")

        bp_img = image_facts.get("blood_pressure_mmhg")
        if bp_img is not None and not isinstance(bp_img, str):
            image_facts["blood_pressure_mmhg"] = str(bp_img)

        all_docs = await _fetch_all_sources(patient_id)
        patient_record = await _fetch_patient_record(patient_id)
        accident = patient_record.get("accidentDetails", {}) or {}
        buckets  = _split_by_source(all_docs)
        payloads = _build_prompt_payloads(buckets, all_docs)

        aggregated_text = _aggregate_raw_text(all_docs)
        extracted_facts: dict = {}
        if aggregated_text.strip():
            try:
                extracted_facts = _safe_llm_json(
                    EXTRACTION_PROMPT_TEMPLATE.format(raw_text=aggregated_text),
                    MODEL_STEP_A,
                    max_tokens=2000,
                )
                logger.info("╠══ STEP-A OUTPUT (image flow) ══╣\n{}",
                            json.dumps(extracted_facts, indent=2, default=str))
            except Exception as exc:
                logger.warning("Step-A extraction failed ({}).", exc)

        vital_fields = (
            "heart_rate_bpm", "blood_pressure_mmhg", "respiratory_rate_bpm",
            "spo2_percent", "temperature", "gcs_total", "gcs_eye",
            "gcs_verbal", "gcs_motor", "pain_score", "avpu",
            "airway", "breathing", "circulation", "pupils", "mental_status",
            "blood_glucose_mgdl",
        )
        for key in vital_fields:
            img_val = image_facts.get(key)
            if extracted_facts.get(key) is None and img_val is not None:
                extracted_facts[key] = img_val

        if extracted_facts.get("oxygen_therapy") is None and image_facts.get("spo2_delivery"):
            extracted_facts["oxygen_therapy"] = image_facts["spo2_delivery"]
        if extracted_facts.get("assisted_ventilation") is None and image_facts.get("assisted_ventilation"):
            extracted_facts["assisted_ventilation"] = image_facts["assisted_ventilation"]

        for list_key in ("medications", "interventions"):
            img_list = image_facts.get(list_key) or []
            ex_list  = extracted_facts.get(list_key) or []
            merged   = list(ex_list)
            for item in img_list:
                if item and item not in merged:
                    merged.append(item)
            extracted_facts[list_key] = merged

        img_pc = image_facts.get("presenting_complaints")
        if img_pc and not extracted_facts.get("presenting_complaints"):
            extracted_facts["presenting_complaints"] = (
                [img_pc] if isinstance(img_pc, str) else img_pc
            )

        if image_facts.get("known_allergies") and not extracted_facts.get("allergies"):
            extracted_facts["allergies"] = (
                [image_facts["known_allergies"]]
                if isinstance(image_facts["known_allergies"], str)
                else image_facts["known_allergies"]
            )

        logger.info("╠══ MERGED FACTS (Step-A + PCR image) ══╣\n{}",
                    json.dumps(extracted_facts, indent=2, default=str))

        # NEW — deterministic case-type classification, zero extra LLM cost.
        case_type_info = derive_case_type_from_facts(
            extracted_facts, aggregated_text,
            registered_incident_type=accident.get("accidentType"),
        )
        logger.info(
            "╠══ CASE CLASSIFICATION (image flow, zero-LLM, registration-aware) ══╣ "
            "case_type={} is_trauma={} | {}",
            case_type_info["case_type"], case_type_info["is_trauma"],
            case_type_info["routing_rationale"],
        )

        image_summary = json.dumps(image_facts, indent=2, default=str)
        augmented_voice_json = (
            "IMAGE-EXTRACTED PCR FORM DATA (primary structured source from ambulance form):\n"
            f"{image_summary}\n\n"
            "VOICE DICTATIONS (from voice_dictations collection):\n"
            f"{json.dumps(payloads['voice_notes'], indent=2, default=str)}"
        )

        note_prompt = _build_note_prompt(
            payloads, extracted_facts, case_type_info,
            voice_notes_override=augmented_voice_json,
        )
        logger.info("╠══ STEP-B PROMPT (image flow, first 3000 chars) ══╣\n{}",
                    note_prompt[:3000])

        llm_output: dict = _safe_llm_json(note_prompt, MODEL_STEP_B, max_tokens=5000)
        logger.info("╠══ STEP-B OUTPUT (image flow) ══╣\n{}",
                    json.dumps(llm_output, indent=2, default=str))

        triage_colour_llm_suggested = (
            (llm_output.get("triage_assessment") or {}).get("triage_colour")
        )

        authoritative_triage = await fetch_authoritative_triage(patient_triage_status_collection, patient_id)
        llm_output["_raw_text_for_sanitizer"] = aggregated_text
        llm_output = _merge_extracted_facts(llm_output, extracted_facts, case_type_info, authoritative_triage, accident)
        logger.info("╠══ FINAL NOTE after merge (image flow) ══╣\n{}",
                    json.dumps(llm_output, indent=2, default=str))

        llm_output.setdefault("patient_details", {})
        llm_output["patient_details"]["doctor_id"]  = doctor_id
        llm_output["patient_details"]["patient_id"] = patient_id
        if image_facts.get("patient_name"):
            llm_output["patient_details"]["patient_name"] = image_facts["patient_name"]
        if image_facts.get("age"):
            llm_output["patient_details"].setdefault("age", image_facts["age"])
        if image_facts.get("gender"):
            llm_output["patient_details"].setdefault("gender", image_facts["gender"])

        sources_used = {
            "voice_dictations":           len(buckets["voice_dictation"]),
            "clinical_actions":           len(buckets["clinical_action"]),
            "image_extracted_ambulance":  len(buckets["image_extracted_ambulance"]),
            "doctor_voice_notes":         len(buckets["doctor_voice_note"]),
            "approved_image_suggestions": len(buckets["approved_image_suggestion"]),
            "doctor_suggestions":         len(buckets["doctor_suggestion"]),
            "total_records":              len(all_docs),
        }
        save_doc = {
            "doctor_id":                   doctor_id,
            "patient_id":                  patient_id,
            "structured_note":             llm_output,
            "extracted_facts":             extracted_facts,
            "image_facts":                 image_facts,
            "case_type":                   case_type_info["case_type"],
            "is_trauma":                   case_type_info["is_trauma"],
            "routing_rationale":           case_type_info["routing_rationale"],
            "triage_colour":               (llm_output.get("triage_assessment") or {}).get("triage_colour"),
            "triage_colour_llm_suggested": triage_colour_llm_suggested,
            "generated_at":                datetime.utcnow(),
            "image_used":                  bool(image_b64),
            "sources_used":                sources_used,
        }
        insert_result = await emergency_structured_notes_collection.insert_one(save_doc)
        logger.info("╚══ SAVED (image flow) id={} | sources={} ══╝",
                    str(insert_result.inserted_id), json.dumps(sources_used, default=str))

        return {
            "status":                      "success",
            "feature_name":                "emergency_structured_note_from_image",
            "saved_id":                    str(insert_result.inserted_id),
            "finaloutput":                 llm_output,
            "case_type":                   case_type_info["case_type"],
            "is_trauma":                   case_type_info["is_trauma"],
            "routing_rationale":           case_type_info["routing_rationale"],
            "triage_colour_llm_suggested": triage_colour_llm_suggested,
            "metadata": {
                "doctor_id":          doctor_id,
                "patient_id":         patient_id,
                "image_used":         bool(image_b64),
                **sources_used,
                "step_a_facts_found": bool(extracted_facts),
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Emergency structured note (image) generation failed")
        raise HTTPException(
            status_code=500,
            detail=f"Emergency structured note generation error: {str(e)}",
        )