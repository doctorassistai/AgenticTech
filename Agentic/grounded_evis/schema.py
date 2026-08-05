"""
grounded_evis/schema.py
==============================================================
Core data structures passed between stages. Kept intentionally small and
flat — no stage should need to reach into a deeply nested structure to
find out whether something is grounded.

FACT_CATEGORIES and CLAIM_CATEGORIES are open lists (Stage 1/3 prompts
constrain the model to these), not closed enums, since new clinical
categories are cheaper to add here than to a rigid schema.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, TypedDict

# ── Fact categories Stage 1 may emit (extraction prompt is constrained to these) ──
FACT_CATEGORIES = (
    "demographic",          # age, gender, number of patients
    "vital",                # HR, RR, SpO2, BP, temp — one Fact per parameter per source
    "consciousness",        # GCS, AVPU, responsiveness
    "mechanism",             # how the injury/event happened, verbatim
    "symptom",               # pain, nausea, dyspnea, etc., as literally stated
    "exam_finding",          # e.g. "unilateral absent breath sounds"
    "intervention",          # treatment/investigation already performed
    "medication_mention",    # any drug named, regardless of context
    "medical_history",       # chronic conditions, allergies, as literally stated
    "timeline_event",        # accident time, dispatch time, ETA, etc.
    "prior_clinical_action", # from the clinical_actions collection (voice_dictation-only, see prior_action_context.py)
    "registration_ground_truth",  # patient.accidentDetails.accidentType
)

# ── Claim categories Stage 3 may emit ──────────────────────────────────
CLAIM_CATEGORIES = (
    "risk_level",
    "suspected_diagnosis",
    "trigger_pattern_note",   # e.g. "chest/cardiac trauma red flag pattern present"
    "precaution",
    "immediate_action",
    "hospital_prep_item",
    "monitoring_alert",
    "data_gap",                # explicit "we don't know X" — always allowed, never needs grounding to a positive fact
    "escalation_trigger",
)

HEDGE_LEVELS = ("observed", "suspected", "recommendation", "data_gap")


class Fact(TypedDict, total=False):
    fact_id: str
    category: str
    value: Any
    source_entry_id: str
    evidence_text: str
    confidence: str          # Stage 1's own confidence — NOT a grounding verdict


class GroundedFact(Fact, total=False):
    grounding_verdict: str   # "grounded" | "dropped_no_match" | "dropped_low_similarity"
    match_ratio: float


class TriggerFlags(TypedDict, total=False):
    is_trauma: bool
    elderly: bool
    anticoag_hit: bool
    bleeding_evidence: bool
    htn_crisis: bool
    chest_trauma_mechanism: bool
    compartment_risk_mechanism: bool
    agitation: bool
    head_injury_mechanism: bool   # see ASSUMPTION note in keyword_triggers.py
    # trigger_name -> list of fact_ids / regex evidence strings that caused it to fire,
    # so the audit log line can show WHY a trigger fired, not just that it did.
    trigger_basis: Dict[str, List[str]]


class Claim(TypedDict, total=False):
    claim_id: str
    category: str
    value: Any
    evidence_fact_ids: List[str]
    trigger_tag: Optional[str]
    hedge_level: str


class GroundedClaim(Claim, total=False):
    compose_verdict: str     # "kept" | "dropped_unresolved_evidence" | "dropped_trigger_mismatch"
    drop_reason: Optional[str]


def next_fact_id(existing: List[Fact]) -> str:
    return f"F{len(existing) + 1:03d}"


def next_claim_id(existing: List[Claim]) -> str:
    return f"C{len(existing) + 1:03d}"