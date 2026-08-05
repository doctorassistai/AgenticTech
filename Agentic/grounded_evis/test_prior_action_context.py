"""
Standalone, network-free test for prior_action_context.py. Run with:
    python -m Agentic.grounded_evis.test_prior_action_context

This directly tests the fix for the actual root-cause bug: an approved
action whose only recorded content is AI-generated diagnostic narrative
(the fabricated "hemorrhagic shock" scenario) must NOT have that narrative
enter the prior-action context — it must be omitted entirely.
"""

from __future__ import annotations

from Agentic.grounded_evis.prior_action_context import build_prior_action_context


def test_approved_action_with_only_fabricated_ai_narrative_is_omitted():
    """This is the exact shape of the original bug: an approved action
    whose ai_suggestion contains a fabricated diagnostic finding, and NO
    voice_dictation. The old _summarise_clinical_actions() would have
    fallen back to ai_suggestion's narrative text and carried the
    fabrication forward forever. This must not happen here."""
    clinical_actions = [
        {
            "action_type": "approved",
            "voice_dictation": "",  # clinician did not dictate anything for this action
            "ai_suggestion": {
                "sbar_summary": {
                    "assessment": "Hemorrhagic shock, massive transfusion criteria met",
                },
                "single_most_critical_action_right_now": (
                    "Activate massive transfusion protocol immediately for suspected "
                    "hemorrhagic shock"
                ),
                "recommendation": "Urgent blood product administration",
                # no short literal "action" field here — the fabrication is
                # only reachable via the diagnostic-narrative fields above
            },
            "client_created_at": "2026-08-01T10:00:00+05:30",
        }
    ]

    context = build_prior_action_context(clinical_actions)

    assert "hemorrhagic" not in context.lower(), (
        "Fabricated diagnostic narrative must never appear in prior-action context, "
        f"even for an approved action. Got: {context}"
    )
    assert "massive transfusion" not in context.lower()
    assert "1 prior action(s) omitted" in context
    print("PASS: approved action with only AI diagnostic narrative is omitted, not substituted.")


def test_voice_dictation_is_always_preferred_and_included():
    clinical_actions = [
        {
            "action_type": "approved",
            "voice_dictation": "Started patient on nasal cannula oxygen, 2L/min",
            "ai_suggestion": {
                "sbar_summary": {"assessment": "Suspected COPD exacerbation"},
            },
            "client_created_at": "2026-08-01T10:05:00+05:30",
        }
    ]
    context = build_prior_action_context(clinical_actions)
    assert "nasal cannula oxygen" in context
    assert "COPD" not in context, "AI diagnostic content must not leak in even alongside real voice_dictation"
    print("PASS: voice_dictation text included; AI diagnostic content alongside it is excluded.")


def test_short_literal_action_label_is_included_when_no_voice_dictation():
    clinical_actions = [
        {
            "action_type": "approved",
            "voice_dictation": "",
            "ai_suggestion": {"action": "Administer oxygen"},  # short, literal, not narrative
            "client_created_at": "2026-08-01T10:10:00+05:30",
        }
    ]
    context = build_prior_action_context(clinical_actions)
    assert "Administer oxygen" in context
    print("PASS: short literal action label used when no voice_dictation exists.")


def test_not_approved_action_is_labeled_correctly():
    clinical_actions = [
        {
            "action_type": "not_approved",
            "voice_dictation": "Doctor declined IV fluids at this time",
            "client_created_at": "2026-08-01T10:15:00+05:30",
        }
    ]
    context = build_prior_action_context(clinical_actions)
    assert "NOT APPROVED" in context
    assert "declined IV fluids" in context
    print("PASS: not_approved action correctly labeled and included via voice_dictation.")


if __name__ == "__main__":
    test_approved_action_with_only_fabricated_ai_narrative_is_omitted()
    test_voice_dictation_is_always_preferred_and_included()
    test_short_literal_action_label_is_included_when_no_voice_dictation()
    test_not_approved_action_is_labeled_correctly()
    print("\nAll prior_action_context tests passed.")