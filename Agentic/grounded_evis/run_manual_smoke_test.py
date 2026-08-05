"""
grounded_evis/run_manual_smoke_test.py
==============================================================
Run this manually, with a real GROQ_API_KEY set, to see what the pipeline
actually produces against a real model — every other test in this
package uses a mocked LLM. This is the first time you should look at real
output before wiring shadow_compare into ambulance.py.


export GROQ_API_KEY=your_real_key_here
python -m Agentic.grounded_evis.run_manual_smoke_test

Edit CASE_TEXT below to try your own sample conversation instead of the
default repro case.
"""

from __future__ import annotations

import asyncio
import json

from Agentic.grounded_evis.pipeline import run_grounded_pipeline

# Edit this to test a different case. _source can be "voice_dictation",
# "doctor_voice_note", or "image_extracted" — same as ambulance.py expects.
CASE_TEXT = (
    "35-year-old male, found ambulatory at scene, denies any fall or "
    "collision. Vitals: SpO2 99%, HR 60, RR 20, BP 123/82, vitally "
    "stable. No visible bleeding, no wounds, no complaint of pain. "
    "Patient conversant and oriented."
)

ENTRIES = [{"_source": "voice_dictation", "conversation": CASE_TEXT}]


async def main():
    print("=" * 70)
    print("Running grounded pipeline against a REAL Groq model...")
    print("=" * 70)

    result = await run_grounded_pipeline(
        patient_id="MANUAL-SMOKE-TEST-001",
        entries=ENTRIES,
        clinical_actions=[],
        image_entries=[],
        patient_record={},
        source_counts={"emt": 1, "doctor": 0, "image": 0},
    )

    print("\n--- FACTS (Stage 1, post-grounding) ---")
    for f in result["facts"]:
        print(f"  [{f['fact_id']}] {f['category']}: {f['value']} "
              f"(evidence: \"{f['evidence_text']}\", ratio={f.get('match_ratio')})")

    print(f"\n--- DROPPED FACTS ({result['audit']['facts_dropped_ungrounded']}) ---")
    for f in result["audit"]["dropped_fact_details"]:
        print(f"  DROPPED [{f.get('fact_id')}] {f.get('category')}: "
              f"evidence=\"{f.get('evidence_text')}\" verdict={f.get('grounding_verdict')}")

    print(f"\n--- TRIGGERS FIRED: {result['triggers_fired']} ---")
    print(f"trigger_basis: {json.dumps(result['trigger_basis'], indent=2, default=str)}")

    print(f"\n--- CASE CLASSIFICATION ---")
    print(f"case_type={result['case_type']} care_setting={result['care_setting']}")
    print(f"rationale: {result['routing_rationale']}")

    print(f"\n--- CLAIMS KEPT ---")
    for c in result["claims"]:
        print(f"  [{c['claim_id']}] {c['category']} ({c['hedge_level']}): {c['value']} "
              f"cites={c['evidence_fact_ids']} trigger_tag={c.get('trigger_tag')}")

    print(f"\n--- CLAIMS DROPPED ({result['audit']['stage3_claims_dropped_ungrounded']}) ---")
    for c in result["audit"]["dropped_claim_details"]:
        print(f"  DROPPED [{c.get('claim_id')}] {c.get('category')}: {c.get('value')} "
              f"reason={c.get('drop_reason')}")

    print(f"\n--- FINAL SUMMARY ---")
    print(f"overall_risk_level: {result['overall_risk_level']}")
    print(f"triage_colour: {result['triage_colour']} (source: {result['triage_colour_source']})")
    print(f"suspected_diagnoses: {result['suspected_diagnoses']}")
    print(f"processing_time_ms: {result['processing_time_ms']}")
    print(f"agent_timings: {result['agent_timings']}")

    print("\n" + "=" * 70)
    print("Check the above BY EYE: for this default case (normal vitals, denies")
    print("trauma), you want to see triggers_fired=[], triage_colour=Green or")
    print("Yellow, and suspected_diagnoses=[]. If Stage 1 pulled in something not")
    print("actually in CASE_TEXT, it should show up under DROPPED FACTS above —")
    print("that's the grounding check catching it, not a bug.")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())