"""
clinical_shared/age_extraction.py
==============================================================
SINGLE SOURCE OF TRUTH for turning an extracted "approximate_age" value
into an integer, and for the elderly threshold check.

Today ambulance.py's _extract_patient_age() reads state["medical_entities"]
directly — a shape that won't exist in the grounded pipeline (Stage 1
returns a flat List[Fact], not a nested medical_entities dict). This
version works off either shape so both the old and new pipeline can share
it during the shadow-mode period.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

ELDERLY_THRESHOLD_YEARS = 65


def parse_age_value(age_raw: Any) -> Optional[int]:
    """Best-effort integer parse from a loosely-typed age value/string."""
    if age_raw is None:
        return None
    match = re.search(r"\d+", str(age_raw))
    return int(match.group()) if match else None


def extract_age_from_medical_entities(medical_entities: Dict) -> Optional[int]:
    """Today's ambulance.py shape: state["medical_entities"]["patient_demographics"]["approximate_age"]."""
    demo = (medical_entities or {}).get("patient_demographics") or {}
    return parse_age_value(demo.get("approximate_age"))


def extract_age_from_facts(facts: List[Dict]) -> Optional[int]:
    """
    grounded_evis shape: facts is a flat list of Fact/GroundedFact dicts.
    Looks for the (at most one, first-grounded) fact with
    category == "demographic" and a sub-field indicating age. Stage 1's
    extraction prompt is expected to emit e.g.
    {"category": "demographic", "value": {"approximate_age": "72"}, ...}
    — if Stage 1's exact shape differs once written, update this function,
    not the callers.
    """
    for fact in facts:
        if fact.get("category") != "demographic":
            continue
        value = fact.get("value")
        if isinstance(value, dict) and "approximate_age" in value:
            age = parse_age_value(value["approximate_age"])
            if age is not None:
                return age
        elif isinstance(value, (int, str)):
            age = parse_age_value(value)
            if age is not None:
                return age
    return None


def is_elderly(age: Optional[int]) -> bool:
    return age is not None and age >= ELDERLY_THRESHOLD_YEARS