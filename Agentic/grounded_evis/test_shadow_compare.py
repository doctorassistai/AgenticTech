"""
Standalone, network-free test for shadow_compare.py. Run with:
    python -m Agentic.grounded_evis.test_shadow_compare
"""

from __future__ import annotations

import asyncio
import json

from Agentic.grounded_evis.shadow_compare import run_shadow_comparison
from Agentic.grounded_evis.test_pipeline_e2e import REPRO_CASE_ENTRY

LEGACY_RESULT_TRAUMA_DISAGREEMENT = {
    "case_type": "trauma",  # legacy (today's buggy A0) says trauma
    "is_trauma": True,
    "care_setting": "prehospital_ems",
    "suggestions": {
        "patient_snapshot": {"triage_colour": "Red", "overall_risk": "Critical"},
        "clinical_impression": {
            "suspected_diagnoses": ["hemorrhagic shock, massive transfusion criteria met"]
        },
    },
    "risk_stratification": {"overall_risk_level": "Critical"},
}


class _MockResponse:
    def __init__(self, content: str):
        self.content = content


class _CleanMockLLM:
    """Answers honestly for the repro case — no fabrication, so the new
    pipeline should disagree with the (buggy) legacy result above."""

    async def ainvoke(self, messages):
        system_content = messages[0].content if messages else ""
        if "literal clinical-text extraction" in system_content:
            facts = [
                {"category": "demographic", "value": {"approximate_age": "35"},
                 "source_entry_id": "ENTRY-1", "evidence_text": "35-year-old male",
                 "confidence": "High"},
                {"category": "vital", "value": "HR 60",
                 "source_entry_id": "ENTRY-1", "evidence_text": "HR 60", "confidence": "High"},
            ]
            return _MockResponse(json.dumps(facts))
        if "triage classification assistant" in system_content:
            return _MockResponse(json.dumps({
                "case_type": "general_medical", "care_setting": "prehospital_ems",
                "rationale": "normal vitals, no trauma mechanism",
            }))
        if "senior emergency physician performing clinical interpretation" in system_content:
            claims = [{"category": "risk_level", "value": "Low",
                       "evidence_fact_ids": ["F002"], "trigger_tag": None,
                       "hedge_level": "observed"}]
            return _MockResponse(json.dumps(claims))
        return _MockResponse("[]")


class _FailingMockLLM:
    async def ainvoke(self, messages):
        raise RuntimeError("simulated LLM outage")


class _FakeCollection:
    """Minimal async-Mongo-collection stand-in."""

    def __init__(self):
        self.inserted = []

    async def insert_one(self, doc):
        self.inserted.append(doc)


def test_disagreement_is_detected_and_persisted():
    collection = _FakeCollection()
    record = asyncio.run(run_shadow_comparison(
        patient_id="TEST-REPRO-001",
        entries=[REPRO_CASE_ENTRY],
        clinical_actions=[],
        image_entries=[],
        patient_record={},
        source_counts={},
        legacy_result=LEGACY_RESULT_TRAUMA_DISAGREEMENT,
        comparison_collection=collection,
        llm=_CleanMockLLM(),
    ))

    assert record["disagreement_count"] > 0, "Legacy says trauma/Red/Critical, new says otherwise — must disagree"
    assert any("case_type" in d for d in record["disagreements"])
    assert any("triage_colour" in d for d in record["disagreements"])
    assert len(collection.inserted) == 1, "Comparison record must be persisted"
    assert collection.inserted[0]["patient_id"] == "TEST-REPRO-001"
    print("PASS: disagreement between legacy (buggy) and new (grounded) result detected and persisted.")
    print(f"      disagreements: {record['disagreements']}")


def test_new_pipeline_failure_is_caught_and_logged_not_raised():
    collection = _FakeCollection()
    # Must not raise, even though the injected LLM always errors.
    record = asyncio.run(run_shadow_comparison(
        patient_id="TEST-ERR-001",
        entries=[REPRO_CASE_ENTRY],
        clinical_actions=[],
        image_entries=[],
        patient_record={},
        source_counts={},
        legacy_result=LEGACY_RESULT_TRAUMA_DISAGREEMENT,
        comparison_collection=collection,
        llm=_FailingMockLLM(),
    ))
    assert record["error"] is not None
    assert len(collection.inserted) == 1
    print("PASS: new-pipeline failure caught, logged, and persisted — never raised to the caller.")


def test_no_collection_does_not_raise():
    # comparison_collection=None must be handled gracefully (log-only path).
    record = asyncio.run(run_shadow_comparison(
        patient_id="TEST-NOCOLL-001",
        entries=[REPRO_CASE_ENTRY],
        clinical_actions=[],
        image_entries=[],
        patient_record={},
        source_counts={},
        legacy_result=LEGACY_RESULT_TRAUMA_DISAGREEMENT,
        comparison_collection=None,
        llm=_CleanMockLLM(),
    ))
    assert record is not None
    print("PASS: missing comparison_collection handled gracefully (log-only path).")


if __name__ == "__main__":
    test_disagreement_is_detected_and_persisted()
    test_new_pipeline_failure_is_caught_and_logged_not_raised()
    test_no_collection_does_not_raise()
    print("\nAll shadow_compare tests passed.")