"""
grounded_evis/prior_action_context.py
==============================================================
THE FEEDBACK-LOOP FIX. This is the actual root cause of the original bug,
not just a code-quality issue: today's ambulance.py
_summarise_clinical_actions() falls back to AI-authored diagnostic text
(sbar.recommendation, single_most_critical_action_right_now) when
voice_dictation is empty, even for an APPROVED action. That's how a
fabricated "hemorrhagic shock" finding, once approved via an unrelated
action, re-entered every subsequent prompt as "APPROVED & DONE" and got
treated as confirmed fact indefinitely.

Approval of an action means the ACTION was approved, not that its
attached AI-generated diagnostic narrative was reviewed and confirmed.
This module never makes that substitution, for ANY action regardless of
approval status.
"""

from __future__ import annotations

from typing import Dict, List


def _literal_action_label(clinical_action: Dict) -> str | None:
    """
    Returns ONLY the clinician's own voice_dictation text, or (if that's
    empty) a short LITERAL action label — never diagnostic narrative.

    "Literal action label" means: the action's own short name/type if the
    system recorded one as a plain field (e.g. ai_suggestion.get("action")
    when that field is a short imperative like "Administer oxygen" rather
    than a paragraph of clinical reasoning). It explicitly does NOT mean:
    sbar_summary, single_most_critical_action_right_now, recommendation,
    or any other field that is the model's own synthesized diagnostic
    prose. If no literal label is available either, this returns None and
    the action is OMITTED from context entirely — silence is safer than a
    fabricated-content fallback here.
    """
    voice_dictation = (clinical_action.get("voice_dictation") or "").strip()
    if voice_dictation:
        return voice_dictation

    ai_suggestion = clinical_action.get("ai_suggestion") or {}
    if isinstance(ai_suggestion, dict):
        literal_action = ai_suggestion.get("action")
        # Guard against a caller having stuffed a long diagnostic paragraph
        # into the "action" field — a short imperative is a literal label,
        # a multi-sentence paragraph is narrative wearing a short field
        # name. This is a heuristic, not a certainty, so it's conservative
        # (errs toward omitting rather than including).
        if isinstance(literal_action, str) and literal_action.strip():
            if len(literal_action.strip()) <= 120 and literal_action.count(".") <= 1:
                return literal_action.strip()

    action_type_str = clinical_action.get("action_type_label")
    if isinstance(action_type_str, str) and action_type_str.strip():
        return action_type_str.strip()

    return None


def build_prior_action_context(clinical_actions: List[Dict]) -> str:
    """
    Builds the prior-action context block fed into Stage 1's extraction
    prompt and Stage 3's interpretation prompt. Every entry is either the
    clinician's own words (voice_dictation) or a short literal action
    label — NEVER ai_suggestion diagnostic content (sbar, suspected
    diagnoses, risk stratification, single_most_critical_action), even
    for an approved action.
    """
    lines: List[str] = []
    omitted_count = 0

    for ca in clinical_actions:
        label = _literal_action_label(ca)
        if label is None:
            omitted_count += 1
            continue

        action_type = ca.get("action_type", "")
        if action_type == "approved":
            status_marker = "APPROVED"
        elif action_type == "not_approved":
            status_marker = "NOT APPROVED"
        else:
            status_marker = action_type or "UNKNOWN_STATUS"

        raw_ts = ca.get("client_created_at") or ca.get("server_received_at", "")
        lines.append(f"[{raw_ts}] {status_marker}: {label}")

    if not lines:
        base = "No prior clinical actions with clinician-authored or literal-action text available."
    else:
        base = (
            "PRIOR CLINICAL ACTIONS (clinician's own words or a literal action label only — "
            "this NEVER includes AI-generated diagnostic narrative, suspected diagnoses, or risk "
            "stratification content, even for an approved action; an approved action means the "
            "ACTION was approved, not that any attached AI narrative was reviewed and confirmed):\n"
            + "\n".join(lines)
        )

    if omitted_count:
        base += (
            f"\n({omitted_count} prior action(s) omitted — no clinician-authored or literal-"
            "action text was available for them; their AI-generated content is deliberately "
            "not substituted in.)"
        )

    return base