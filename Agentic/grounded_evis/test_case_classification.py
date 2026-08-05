"""
Standalone, network-free test for case_classification.py. Run with:
    python -m Agentic.grounded_evis.test_case_classification

Uses a mock LLM (no real API call) to prove the deterministic overrides
(registration ground truth, Stage 2's is_trauma trigger) win even when the
LLM's own classification disagrees — matching today's A0 override
behavior, now applied on top of an LLM call instead of replacing it.
"""

from __future__ import annotations

import asyncio
import json

from Agentic.grounded_evis.case_classification import classify_case

GROUNDED_FACTS = [
    {"fact_id": "F001", "category": "vital", "value": "HR 90",
     "source_entry_id": "ENTRY-1", "evidence_text": "HR 90", "confidence": "High"},
]

TRIGGERS_NONE_FIRED = {
    "is_trauma": False, "elderly": False, "anticoag_hit": False,
    "bleeding_evidence": False, "htn_crisis": False,
    "chest_trauma_mechanism": False, "compartment_risk_mechanism": False,
    "agitation": False, "head_injury_mechanism": False, "trigger_basis": {},
}

TRIGGERS_IS_TRAUMA_FIRED = dict(TRIGGERS_NONE_FIRED, is_trauma=True)


class _MockResponse:
    def __init__(self, content: str):
        self.content = content


class _MockLLM:
    """Returns a fixed classification regardless of input — used to prove
    the override logic fires even when the model confidently disagrees."""

    def __init__(self, fixed_case_type: str, fixed_care_setting: str = "prehospital_ems"):
        self.fixed_case_type = fixed_case_type
        self.fixed_care_setting = fixed_care_setting

    async def ainvoke(self, messages):
        return _MockResponse(json.dumps({
            "case_type": self.fixed_case_type,
            "care_setting": self.fixed_care_setting,
            "rationale": "mock LLM confidently says this is not trauma",
        }))


def test_registration_ground_truth_overrides_llm_disagreement():
    llm = _MockLLM(fixed_case_type="general_medical")
    result = asyncio.run(classify_case(
        grounded_facts=GROUNDED_FACTS,
        triggers=TRIGGERS_NONE_FIRED,
        registered_incident_type="Road traffic accident",
        llm=llm,
    ))
    assert result["case_type"] == "trauma", (
        "Registration ground truth (road traffic accident) must override the LLM's "
        f"'general_medical' classification. Got: {result}"
    )
    print("PASS: registration ground truth overrides LLM disagreement.")


def test_stage2_is_trauma_trigger_overrides_llm_disagreement():
    llm = _MockLLM(fixed_case_type="cardiorespiratory")
    result = asyncio.run(classify_case(
        grounded_facts=GROUNDED_FACTS,
        triggers=TRIGGERS_IS_TRAUMA_FIRED,
        registered_incident_type=None,
        llm=llm,
    ))
    assert result["case_type"] == "trauma", (
        "Stage 2's is_trauma trigger firing must override the LLM's "
        f"'cardiorespiratory' classification. Got: {result}"
    )
    print("PASS: Stage 2 is_trauma trigger overrides LLM disagreement.")


def test_llm_classification_used_when_no_override_applies():
    llm = _MockLLM(fixed_case_type="toxicology")
    result = asyncio.run(classify_case(
        grounded_facts=GROUNDED_FACTS,
        triggers=TRIGGERS_NONE_FIRED,
        registered_incident_type=None,
        llm=llm,
    ))
    assert result["case_type"] == "toxicology", (
        f"With no override condition met, the LLM's own classification should be used. Got: {result}"
    )
    print("PASS: LLM classification used as-is when no deterministic override applies.")


if __name__ == "__main__":
    test_registration_ground_truth_overrides_llm_disagreement()
    test_stage2_is_trauma_trigger_overrides_llm_disagreement()
    test_llm_classification_used_when_no_override_applies()
    print("\nAll case_classification tests passed.")