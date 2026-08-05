"""
Standalone, network-free end-to-end test for pipeline.py. Run with:
    python -m Agentic.grounded_evis.test_pipeline_e2e

Uses a single mocked LLM that answers Stage 1 extraction, case
classification, and Stage 3 interpretation calls (in that order) with a
DELIBERATELY ADVERSARIAL script: Stage 1 tries to slip in a fabricated
anticoagulant fact with a fake evidence quote, and Stage 3 tries to
produce a hemorrhagic-shock claim anyway. Proves the FULL orchestrated
pipeline — not just the individual stage unit tests — still produces a
safe result for the original repro case.
"""

from __future__ import annotations

import asyncio
import json

from Agentic.grounded_evis.pipeline import run_grounded_pipeline

REPRO_CASE_ENTRY = {
    "_source": "voice_dictation",
    "conversation": (
        "35-year-old male, found ambulatory at scene, denies any fall or "
        "collision. Vitals: SpO2 99%, HR 60, RR 20, BP 123/82, vitally "
        "stable. No visible bleeding, no wounds, no complaint of pain. "
        "Patient conversant and oriented."
    ),
}


class _MockResponse:
    def __init__(self, content: str):
        self.content = content


class _AdversarialMockLLM:
    """
    Answers three call types, in call order:
      1. Stage 1 extraction  -> returns mostly-honest facts PLUS one
         fabricated anticoagulant fact citing a quote that doesn't exist
         in the source text.
      2. case classification -> returns a plausible (non-trauma) classification.
      3. Stage 3 interpretation -> tries to produce a hemorrhagic-shock /
         massive-transfusion claim citing the fabricated fact, PLUS a
         claim tagged trigger_tag="anticoag_hit" even though that trigger
         will not have fired (since Stage 2 drops the fabricated fact
         before computing triggers).
    """

    def __init__(self):
        self.call_count = 0

    async def ainvoke(self, messages):
        self.call_count += 1
        system_content = messages[0].content if messages else ""

        if "literal clinical-text extraction" in system_content:
            facts = [
                {"category": "demographic", "value": {"approximate_age": "35"},
                 "source_entry_id": "ENTRY-1", "evidence_text": "35-year-old male",
                 "confidence": "High"},
                {"category": "vital", "value": "HR 60",
                 "source_entry_id": "ENTRY-1", "evidence_text": "HR 60", "confidence": "High"},
                {"category": "vital", "value": "BP 123/82",
                 "source_entry_id": "ENTRY-1", "evidence_text": "BP 123/82", "confidence": "High"},
                # FABRICATION: this evidence_text does not appear in the source entry.
                {"category": "medical_history", "value": "on anticoagulant",
                 "source_entry_id": "ENTRY-1",
                 "evidence_text": "patient reports taking warfarin daily",
                 "confidence": "High"},
            ]
            return _MockResponse(json.dumps(facts))

        if "triage classification assistant" in system_content:
            return _MockResponse(json.dumps({
                "case_type": "general_medical",
                "care_setting": "prehospital_ems",
                "rationale": "No trauma mechanism, normal vitals.",
            }))

        if "senior emergency physician performing clinical interpretation" in system_content:
            claims = [
                {"category": "risk_level", "value": "Low",
                 "evidence_fact_ids": ["F002", "F003"], "trigger_tag": None,
                 "hedge_level": "observed"},
                # ADVERSARIAL: cites the fact that SHOULD have been dropped by
                # Stage 2 grounding (fabricated evidence_text), and tags a
                # trigger that should never have fired.
                {"category": "suspected_diagnosis",
                 "value": "hemorrhagic shock, massive transfusion criteria met",
                 "evidence_fact_ids": ["F004"],
                 "trigger_tag": "anticoag_hit", "hedge_level": "suspected"},
            ]
            return _MockResponse(json.dumps(claims))

        return _MockResponse("[]")


def test_full_pipeline_blocks_fabrication_end_to_end():
    llm = _AdversarialMockLLM()

    result = asyncio.run(run_grounded_pipeline(
        patient_id="TEST-REPRO-001",
        entries=[REPRO_CASE_ENTRY],
        clinical_actions=[],
        image_entries=[],
        patient_record={},
        source_counts={"emt": 1, "doctor": 0, "image": 0},
        llm=llm,
    ))

    # The fabricated anticoagulant fact must have been dropped at Stage 2
    assert result["audit"]["facts_dropped_ungrounded"] == 1, (
        f"Expected exactly 1 fact dropped (the fabricated anticoag fact), got "
        f"{result['audit']['facts_dropped_ungrounded']}"
    )

    # anticoag_hit trigger must never have fired, since the only source of
    # that signal was the fabricated fact
    assert "anticoag_hit" not in result["triggers_fired"], (
        f"anticoag_hit must not fire — the only evidence for it was fabricated. "
        f"Fired triggers: {result['triggers_fired']}"
    )

    # The adversarial hemorrhagic-shock claim must have been dropped at Stage 4,
    # because it cited a fact that failed grounding
    assert result["audit"]["stage3_claims_dropped_ungrounded"] == 1, (
        f"Expected the hemorrhagic-shock claim to be dropped, got "
        f"{result['audit']['stage3_claims_dropped_ungrounded']}"
    )
    assert result["suspected_diagnoses"] == [], (
        f"No suspected diagnosis should reach final output. Got: {result['suspected_diagnoses']}"
    )
    assert result["overall_risk_level"] == "Low", (
        f"Risk level should be Low (the only surviving risk_level claim), got "
        f"{result['overall_risk_level']}"
    )

    print("PASS: full pipeline blocks fabrication end-to-end for the repro case — "
          "fabricated fact dropped at Stage 2, laundered claim dropped at Stage 4, "
          "final output shows Low risk with zero suspected diagnoses.")


if __name__ == "__main__":
    test_full_pipeline_blocks_fabrication_end_to_end()
    print("\nAll pipeline end-to-end tests passed.")