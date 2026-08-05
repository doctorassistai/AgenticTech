"""
grounded_evis/stage2_ground_check.py
==============================================================
STAGE 2 · GROUND-CHECK — zero LLM cost.

(a) Verifies every Stage-1 fact's evidence_text actually appears
    (fuzzy-matched) in the entry it claims to come from. Anything that
    doesn't match is dropped rather than trusted.
(b) Computes deterministic TRIGGER FLAGS from regex/keyword checks against
    the raw text and the GROUNDED facts — never from LLM judgement, and
    never from ungrounded facts (a fact that failed grounding cannot
    itself cause a trigger to fire).

This is the module that makes the original repro case (35-year-old,
normal vitals, no bleeding/anticoag/elderly mention) structurally safe:
elderly=False, anticoag_hit=False, bleeding_evidence=False are computed
here, before Stage 3 ever runs, so those reference blocks are never even
in Stage 3's prompt for that case.
"""

from __future__ import annotations

from difflib import SequenceMatcher
from typing import Dict, List, Optional, Tuple

from Agentic.clinical_shared.age_extraction import extract_age_from_facts, is_elderly
from Agentic.clinical_shared.keyword_triggers import (
    ANTICOAGULANT_KEYWORDS,
    BLEEDING_KEYWORDS,                # swap this in
    CHEST_CARDIAC_TRAUMA_MECHANISM_KEYWORDS,
    COMPARTMENT_RISK_MECHANISM_KEYWORDS,
    HEAD_INJURY_MECHANISM_KEYWORDS,
    TRAUMA_MECHANISM_KEYWORDS,
    AGITATION_KEYWORDS,
    any_hit,
    any_hit_excluding_negation,
)

from .schema import Fact, GroundedFact, TriggerFlags

DEFAULT_FUZZY_THRESHOLD = 0.6

# BP thresholds for the htn_crisis trigger — matches the crisis definition
# already documented in ambulance.py's CLINICAL_REFERENCE_HYPERTENSIVE_EMERGENCY.
HTN_CRISIS_SYSTOLIC = 180
HTN_CRISIS_DIASTOLIC = 120


def _best_match_ratio(evidence_text: str, source_text: str) -> float:
    """
    Fuzzy containment check: rather than comparing the whole source entry
    to the whole evidence_text (which penalizes a short quote inside a
    long entry), slide the evidence_text against windows of the source
    text and take the best ratio. Mirrors the SequenceMatcher pattern
    already used by ambulance.py's duplicate-safety-net
    (_is_likely_duplicate) — same tool, same conservative-by-design intent.
    """
    if not evidence_text or not source_text:
        return 0.0
    evidence_norm = evidence_text.strip().lower()
    source_norm = source_text.strip().lower()
    if evidence_norm in source_norm:
        return 1.0
    return SequenceMatcher(None, evidence_norm, source_norm).ratio()


def ground_check_facts(
    raw_facts: List[Fact],
    entry_id_map: Dict[str, Dict],
    registered_incident_type: Optional[str] = None,
    fuzzy_threshold: float = DEFAULT_FUZZY_THRESHOLD,
) -> Tuple[List[GroundedFact], List[GroundedFact]]:
    """Returns (kept, dropped)."""
    kept: List[GroundedFact] = []
    dropped: List[GroundedFact] = []

    for fact in raw_facts:
        source_entry_id = fact.get("source_entry_id", "")
        evidence_text = fact.get("evidence_text", "")

        if source_entry_id == "REGISTRATION":
            source_text = registered_incident_type or ""
        else:
            entry = entry_id_map.get(source_entry_id)
            source_text = ""
            if entry:
                source_text = (entry.get("conversation") or entry.get("extracted_text") or "")

        ratio = _best_match_ratio(evidence_text, source_text)
        grounded_fact: GroundedFact = dict(fact)  # type: ignore[assignment]
        grounded_fact["match_ratio"] = round(ratio, 3)

        if not source_text:
            grounded_fact["grounding_verdict"] = "dropped_no_match"
            dropped.append(grounded_fact)
        elif ratio >= fuzzy_threshold:
            grounded_fact["grounding_verdict"] = "grounded"
            kept.append(grounded_fact)
        else:
            grounded_fact["grounding_verdict"] = "dropped_low_similarity"
            dropped.append(grounded_fact)

    return kept, dropped


def _raw_text_blob(entry_id_map: Dict[str, Dict]) -> str:
    """Concatenated raw text across all entries, for keyword-hit checks that
    should look at the whole conversation rather than one fact at a time
    (e.g. anticoag_hit — the mention might not have been extracted as a
    Stage-1 fact at all if Stage 1 under-extracted, and the regex is meant
    to be the hard guarantee independent of Stage 1's recall)."""
    return "\n".join(
        (e.get("conversation") or e.get("extracted_text") or "")
        for e in entry_id_map.values()
    )


def _grounded_vital_value(grounded_facts: List[GroundedFact], vital_name: str) -> Optional[int]:
    """Looks for a grounded 'vital' fact whose value dict/str names this
    parameter. Stage 1's exact value shape for vitals should be confirmed
    once Stage 1's prompt is finalized against real output — this is a
    best-effort lookup, not the single source of truth for vitals display
    (that's Stage 4's job)."""
    import re

    for fact in grounded_facts:
        if fact.get("category") != "vital":
            continue
        value = fact.get("value")
        text = str(value)
        if vital_name.lower() not in text.lower() and vital_name.lower() not in str(
            fact.get("evidence_text", "")
        ).lower():
            continue
        match = re.search(r"\d+", text) or re.search(r"\d+", fact.get("evidence_text", ""))
        if match:
            try:
                return int(match.group())
            except Exception:
                continue
    return None


def compute_trigger_flags(
    grounded_facts: List[GroundedFact],
    entry_id_map: Dict[str, Dict],
    registered_incident_type: Optional[str] = None,
) -> TriggerFlags:
    raw_text = _raw_text_blob(entry_id_map)
    trigger_basis: Dict[str, List[str]] = {}

    def _mark(name: str, evidence: List[str]) -> bool:
        if evidence:
            trigger_basis[name] = evidence
            return True
        return False

    # is_trauma: keyword hit in raw text, OR registration ground truth override
    trauma_keyword_hits = [f.get("evidence_text", "") for f in grounded_facts
                            if any_hit_excluding_negation(f.get("evidence_text", ""), TRAUMA_MECHANISM_KEYWORDS)]
    registration_trauma = bool(
        registered_incident_type
        and TRAUMA_MECHANISM_KEYWORDS.search(registered_incident_type)
    )
    if registration_trauma:
        trauma_keyword_hits.append(f"registration incident_type={registered_incident_type!r}")
    is_trauma = _mark("is_trauma", trauma_keyword_hits) or bool(
        any_hit_excluding_negation(raw_text, TRAUMA_MECHANISM_KEYWORDS)
    )
    if is_trauma and "is_trauma" not in trigger_basis:
        trigger_basis["is_trauma"] = ["raw_text_keyword_hit"]

    # elderly: from grounded demographic fact only — never inferred
    age = extract_age_from_facts(grounded_facts)
    elderly = is_elderly(age)
    if elderly:
        trigger_basis["elderly"] = [f"grounded age={age}"]

    # anticoag_hit: regex against raw text (hard guarantee, independent of
    # Stage 1 recall) AND/OR a grounded medication_mention fact
    anticoag_evidence = [f.get("evidence_text", "") for f in grounded_facts
                         if any_hit_excluding_negation(f.get("evidence_text", ""), ANTICOAGULANT_KEYWORDS)]
    anticoag_hit = _mark("anticoag_hit", anticoag_evidence) or bool(
        any_hit_excluding_negation(raw_text, ANTICOAGULANT_KEYWORDS)
    )
    if anticoag_hit and "anticoag_hit" not in trigger_basis:
        trigger_basis["anticoag_hit"] = ["raw_text_keyword_hit"]

    # bleeding_evidence: regex against raw text and grounded facts
    bleeding_evidence_hits = [f.get("evidence_text", "") for f in grounded_facts
                              if any_hit_excluding_negation(f.get("evidence_text", ""), BLEEDING_KEYWORDS)]
    bleeding_evidence = _mark("bleeding_evidence", bleeding_evidence_hits) or bool(
        any_hit_excluding_negation(raw_text, BLEEDING_KEYWORDS)
    )
    if bleeding_evidence and "bleeding_evidence" not in trigger_basis:
        trigger_basis["bleeding_evidence"] = ["raw_text_keyword_hit"]

    # htn_crisis: from GROUNDED vitals only, never raw text alone — a
    # number that never made it through Stage 1/Stage 2 grounding should
    # not drive a clinical trigger.
    sys_bp = _grounded_vital_value(grounded_facts, "systolic") or _grounded_vital_value(
        grounded_facts, "bp"
    )
    dia_bp = _grounded_vital_value(grounded_facts, "diastolic")
    htn_crisis = bool(
        (sys_bp is not None and sys_bp > HTN_CRISIS_SYSTOLIC)
        or (dia_bp is not None and dia_bp > HTN_CRISIS_DIASTOLIC)
    )
    if htn_crisis:
        trigger_basis["htn_crisis"] = [f"grounded systolic={sys_bp} diastolic={dia_bp}"]

    # chest_trauma_mechanism
    chest_hits = [f.get("evidence_text", "") for f in grounded_facts
                  if any_hit_excluding_negation(f.get("evidence_text", ""), CHEST_CARDIAC_TRAUMA_MECHANISM_KEYWORDS)]
    chest_trauma_mechanism = _mark("chest_trauma_mechanism", chest_hits) or bool(
        any_hit_excluding_negation(raw_text, CHEST_CARDIAC_TRAUMA_MECHANISM_KEYWORDS)
    )
    if chest_trauma_mechanism and "chest_trauma_mechanism" not in trigger_basis:
        trigger_basis["chest_trauma_mechanism"] = ["raw_text_keyword_hit"]

    # compartment_risk_mechanism
    compartment_hits = [f.get("evidence_text", "") for f in grounded_facts
                        if any_hit_excluding_negation(f.get("evidence_text", ""), COMPARTMENT_RISK_MECHANISM_KEYWORDS)]
    compartment_risk_mechanism = _mark("compartment_risk_mechanism", compartment_hits) or bool(
        any_hit_excluding_negation(raw_text, COMPARTMENT_RISK_MECHANISM_KEYWORDS)
    )
    if compartment_risk_mechanism and "compartment_risk_mechanism" not in trigger_basis:
        trigger_basis["compartment_risk_mechanism"] = ["raw_text_keyword_hit"]

    # agitation
    agitation_hits = [f.get("evidence_text", "") for f in grounded_facts
                      if any_hit_excluding_negation(f.get("evidence_text", ""), AGITATION_KEYWORDS)]
    agitation = _mark("agitation", agitation_hits) or bool(any_hit_excluding_negation(raw_text, AGITATION_KEYWORDS))
    if agitation and "agitation" not in trigger_basis:
        trigger_basis["agitation"] = ["raw_text_keyword_hit"]

    # head_injury_mechanism — see ASSUMPTION note in keyword_triggers.py
    head_hits = [f.get("evidence_text", "") for f in grounded_facts
                if any_hit_excluding_negation(f.get("evidence_text", ""), HEAD_INJURY_MECHANISM_KEYWORDS)]
    head_injury_mechanism = _mark("head_injury_mechanism", head_hits) or bool(
        any_hit_excluding_negation(raw_text, HEAD_INJURY_MECHANISM_KEYWORDS)
    )
    if head_injury_mechanism and "head_injury_mechanism" not in trigger_basis:
        trigger_basis["head_injury_mechanism"] = ["raw_text_keyword_hit"]

    return TriggerFlags(
        is_trauma=is_trauma,
        elderly=elderly,
        anticoag_hit=anticoag_hit,
        bleeding_evidence=bleeding_evidence,
        htn_crisis=htn_crisis,
        chest_trauma_mechanism=chest_trauma_mechanism,
        compartment_risk_mechanism=compartment_risk_mechanism,
        agitation=agitation,
        head_injury_mechanism=head_injury_mechanism,
        trigger_basis=trigger_basis,
    )