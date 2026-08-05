"""
Standalone, network-free test for Stage 2. Run with:
    python -m Agentic.grounded_evis.test_stage2_repro_case

Mocks Stage 1's output (since Stage 1 requires a real LLM call this
sandbox can't make) to prove Stage 2's grounding + trigger logic handles
two cases correctly:

1. THE ORIGINAL REPRO CASE — 35-year-old, vitally stable, no bleeding/
   anticoag/elderly mention. Asserts all three problem triggers stay
   False, so Stage 3 would never even see those reference blocks.

2. AN ADVERSARIAL FACT — a fabricated fact whose evidence_text does NOT
   actually appear in its claimed source entry. Asserts Stage 2 drops it
   rather than letting it inform any trigger.
"""

from __future__ import annotations

from Agentic.grounded_evis.stage2_ground_check import (
    compute_trigger_flags,
    ground_check_facts,
)

REPRO_CASE_ENTRY = {
    "_source": "voice_dictation",
    "conversation": (
        "35-year-old male, found ambulatory at scene, denies any fall or "
        "collision. Vitals: SpO2 99%, HR 60, RR 20, BP 123/82, vitally "
        "stable. No visible bleeding, no wounds, no complaint of pain. "
        "Patient conversant and oriented."
    ),
}


def test_repro_case_keeps_triggers_unfired():
    entry_id_map = {"ENTRY-1": REPRO_CASE_ENTRY}

    # Mimic what a well-behaved Stage 1 SHOULD return for this text —
    # literal facts only, no diagnosis/inference.
    raw_facts = [
        {"fact_id": "F001", "category": "demographic", "value": {"approximate_age": "35"},
         "source_entry_id": "ENTRY-1", "evidence_text": "35-year-old male", "confidence": "High"},
        {"fact_id": "F002", "category": "vital", "value": "SpO2 99%",
         "source_entry_id": "ENTRY-1", "evidence_text": "SpO2 99%", "confidence": "High"},
        {"fact_id": "F003", "category": "vital", "value": "HR 60",
         "source_entry_id": "ENTRY-1", "evidence_text": "HR 60", "confidence": "High"},
        {"fact_id": "F004", "category": "vital", "value": "BP 123/82",
         "source_entry_id": "ENTRY-1", "evidence_text": "BP 123/82", "confidence": "High"},
    ]

    kept, dropped = ground_check_facts(raw_facts, entry_id_map)
    assert len(dropped) == 0, f"Expected no drops for well-grounded facts, got {dropped}"
    assert len(kept) == 4

    triggers = compute_trigger_flags(kept, entry_id_map, registered_incident_type=None)

    assert triggers["elderly"] is False, "35yo must never trigger elderly reasoning"
    assert triggers["anticoag_hit"] is False, "No anticoag mention must never fire this trigger"
    assert triggers["bleeding_evidence"] is False, "No bleeding/injury text must never fire this trigger"
    assert triggers["is_trauma"] is False, "Denies fall/collision, no trauma keyword — must not fire"
    assert triggers["htn_crisis"] is False

    print("PASS: repro case — elderly/anticoag_hit/bleeding_evidence/is_trauma all False as required.")
    print(f"      trigger_basis (should be empty or absent for the above): "
          f"{ {k: v for k, v in triggers['trigger_basis'].items() if k in ('elderly','anticoag_hit','bleeding_evidence','is_trauma')} }")


def test_adversarial_fabricated_fact_is_dropped():
    entry_id_map = {"ENTRY-1": REPRO_CASE_ENTRY}

    # A hypothetical Stage 1 fabrication: claims "on anticoagulant" was
    # said, citing an evidence_text that does NOT appear anywhere in the
    # source entry above.
    raw_facts = [
        {"fact_id": "F001", "category": "medical_history", "value": "on anticoagulant",
         "source_entry_id": "ENTRY-1",
         "evidence_text": "patient states she takes warfarin daily",
         "confidence": "High"},
    ]

    kept, dropped = ground_check_facts(raw_facts, entry_id_map)
    assert len(kept) == 0, "Fabricated fact must be dropped, not kept"
    assert len(dropped) == 1
    assert dropped[0]["grounding_verdict"] == "dropped_low_similarity"

    triggers = compute_trigger_flags(kept, entry_id_map, registered_incident_type=None)
    assert triggers["anticoag_hit"] is False, (
        "Even though the FABRICATED fact mentioned warfarin, the raw text "
        "itself contains no anticoagulant keyword, so the trigger must "
        "still be False once the ungrounded fact is excluded."
    )

    print("PASS: fabricated fact with no textual anchor is dropped, and does not leak into triggers.")


def test_genuine_trauma_case_still_fires():
    """Guards against the negation fix over-correcting into false
    negatives — a real fall WITH bleeding must still fire is_trauma and
    bleeding_evidence."""
    entry = {
        "_source": "voice_dictation",
        "conversation": (
            "68-year-old female, fell down a flight of stairs at home. "
            "Active bleeding from a scalp laceration, patient on warfarin "
            "for atrial fibrillation. BP 150/95, HR 92."
        ),
    }
    entry_id_map = {"ENTRY-1": entry}
    raw_facts = [
        {"fact_id": "F001", "category": "demographic", "value": {"approximate_age": "68"},
         "source_entry_id": "ENTRY-1", "evidence_text": "68-year-old female", "confidence": "High"},
        {"fact_id": "F002", "category": "mechanism", "value": "fell down stairs",
         "source_entry_id": "ENTRY-1", "evidence_text": "fell down a flight of stairs at home",
         "confidence": "High"},
        {"fact_id": "F003", "category": "exam_finding", "value": "active bleeding, scalp laceration",
         "source_entry_id": "ENTRY-1", "evidence_text": "Active bleeding from a scalp laceration",
         "confidence": "High"},
        {"fact_id": "F004", "category": "medication_mention", "value": "warfarin",
         "source_entry_id": "ENTRY-1", "evidence_text": "patient on warfarin for atrial fibrillation",
         "confidence": "High"},
    ]
    kept, dropped = ground_check_facts(raw_facts, entry_id_map)
    assert len(dropped) == 0, f"All facts here are well-grounded, expected no drops, got {dropped}"

    triggers = compute_trigger_flags(kept, entry_id_map, registered_incident_type=None)
    assert triggers["is_trauma"] is True, "Genuine fall must still fire is_trauma"
    assert triggers["bleeding_evidence"] is True, "Genuine active bleeding must still fire"
    assert triggers["anticoag_hit"] is True, "Genuine warfarin mention must still fire"
    assert triggers["elderly"] is True, "68yo must fire elderly"

    print("PASS: genuine trauma/bleeding/anticoag/elderly case still fires all four triggers correctly.")


if __name__ == "__main__":
    test_repro_case_keeps_triggers_unfired()
    test_adversarial_fabricated_fact_is_dropped()
    test_genuine_trauma_case_still_fires()
    print("\nAll Stage 2 tests passed.")