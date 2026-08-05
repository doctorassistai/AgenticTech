"""
Standalone, network-free test for Stage 4. Run with:
    python -m Agentic.grounded_evis.test_stage4_compose

Mocks Stage 3's output (a deliberately adversarial one) to prove Stage 4
actually enforces citation/trigger validity rather than trusting Stage 3's
self-report — this is the test the rewrite plan promised for migration
step 3.
"""

from __future__ import annotations

from Agentic.grounded_evis.stage4_compose import compose_final_output, ground_check_claims

GROUNDED_FACTS = [
    {"fact_id": "F001", "category": "demographic", "value": {"approximate_age": "35"},
     "source_entry_id": "ENTRY-1", "evidence_text": "35-year-old male",
     "confidence": "High", "grounding_verdict": "grounded", "match_ratio": 1.0},
    {"fact_id": "F002", "category": "vital", "value": "HR 60",
     "source_entry_id": "ENTRY-1", "evidence_text": "HR 60",
     "confidence": "High", "grounding_verdict": "grounded", "match_ratio": 1.0},
]

TRIGGERS_NONE_FIRED = {
    "is_trauma": False, "elderly": False, "anticoag_hit": False,
    "bleeding_evidence": False, "htn_crisis": False,
    "chest_trauma_mechanism": False, "compartment_risk_mechanism": False,
    "agitation": False, "head_injury_mechanism": False, "trigger_basis": {},
}


def test_fabricated_citation_is_dropped():
    """A claim citing a fact_id that was never extracted must be dropped,
    even though the claim itself looks well-formed."""
    raw_claims = [
        {"claim_id": "C001", "category": "risk_level", "value": "Low",
         "evidence_fact_ids": ["F001", "F002"], "trigger_tag": None, "hedge_level": "observed"},
        {"claim_id": "C002", "category": "suspected_diagnosis",
         "value": "hemorrhagic shock, massive transfusion criteria met",
         "evidence_fact_ids": ["F999"],  # F999 does not exist — fabricated citation
         "trigger_tag": None, "hedge_level": "suspected"},
    ]
    kept, dropped = ground_check_claims(raw_claims, GROUNDED_FACTS, TRIGGERS_NONE_FIRED)

    assert len(kept) == 1 and kept[0]["claim_id"] == "C001"
    assert len(dropped) == 1 and dropped[0]["claim_id"] == "C002"
    assert dropped[0]["compose_verdict"] == "dropped_unresolved_evidence"
    print("PASS: fabricated citation (F999) dropped; well-cited claim kept.")


def test_inactive_trigger_tag_is_dropped_even_with_valid_citation():
    """A claim can cite REAL facts and still get dropped if it tags a
    trigger that never fired — this is the exact original fabrication
    shape (elderly/anticoag content for a case where those never fired),
    just laundered through a technically-valid citation."""
    raw_claims = [
        {"claim_id": "C003", "category": "trigger_pattern_note",
         "value": "apply elderly occult-shock reasoning",
         "evidence_fact_ids": ["F001"],  # F001 is real (age fact)...
         "trigger_tag": "elderly",       # ...but elderly trigger did NOT fire (35yo)
         "hedge_level": "suspected"},
    ]
    kept, dropped = ground_check_claims(raw_claims, GROUNDED_FACTS, TRIGGERS_NONE_FIRED)

    assert len(kept) == 0
    assert len(dropped) == 1
    assert dropped[0]["compose_verdict"] == "dropped_trigger_mismatch"
    print("PASS: claim citing a REAL fact but tagging an inactive trigger is still dropped.")


def test_data_gap_claim_needs_no_citation():
    """data_gap claims describe an absence and are exempt from needing
    positive evidence_fact_ids."""
    raw_claims = [
        {"claim_id": "C004", "category": "data_gap",
         "value": "No respiratory rate documented in any source",
         "evidence_fact_ids": [], "trigger_tag": None, "hedge_level": "data_gap"},
    ]
    kept, dropped = ground_check_claims(raw_claims, GROUNDED_FACTS, TRIGGERS_NONE_FIRED)
    assert len(kept) == 1 and len(dropped) == 0
    print("PASS: data_gap claim kept with no evidence_fact_ids required.")


def test_compose_final_output_audit_counts():
    raw_claims = [
        {"claim_id": "C001", "category": "risk_level", "value": "Low",
         "evidence_fact_ids": ["F001", "F002"], "trigger_tag": None, "hedge_level": "observed"},
        {"claim_id": "C002", "category": "suspected_diagnosis", "value": "fabricated",
         "evidence_fact_ids": ["F999"], "trigger_tag": None, "hedge_level": "suspected"},
    ]
    kept, dropped = ground_check_claims(raw_claims, GROUNDED_FACTS, TRIGGERS_NONE_FIRED)
    output = compose_final_output(
        grounded_facts=GROUNDED_FACTS,
        grounded_claims=kept,
        dropped_facts=[],
        dropped_claims=dropped,
        triggers=TRIGGERS_NONE_FIRED,
        case_type="general_medical",
        care_setting="prehospital_ems",
        patient_id="TEST-001",
    )
    assert output["audit"]["stage3_claims_dropped_ungrounded"] == 1
    assert output["overall_risk_level"] == "Low"
    assert output["suspected_diagnoses"] == []  # the fabricated one is gone
    print("PASS: compose_final_output correctly surfaces stage3_claims_dropped_ungrounded=1 "
          "and excludes the dropped fabricated diagnosis from suspected_diagnoses.")


if __name__ == "__main__":
    test_fabricated_citation_is_dropped()
    test_inactive_trigger_tag_is_dropped_even_with_valid_citation()
    test_data_gap_claim_needs_no_citation()
    test_compose_final_output_audit_counts()
    print("\nAll Stage 4 tests passed.")