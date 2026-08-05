"""
grounded_evis/stage4_compose.py
==============================================================
STAGE 4 · COMPOSE — zero LLM cost. THE ENFORCEMENT LAYER.

ground_check_claims() is the part that actually matters for the original
bug: it does not trust Stage 3's own claim that a citation is valid — it
independently resolves every evidence_fact_id against the real grounded
fact_id set, and independently checks every trigger_tag against the real
fired-trigger set. Stage 3's prompt asks it not to fabricate citations;
this function is what happens if it does anyway.

compose_final_output() assembles the grounded-native result. NOTE ON
SCHEMA: this produces a clean, self-describing structure (facts / claims /
audit), NOT yet the legacy byte-compatible ambulance.py response shape
(suggestions/immediate_actions/precautions/hospital_prep/vitals_comparison/
risk_stratification). That legacy-shape adaptation is a separate, later
concern that belongs in pipeline.py once Q4 (whether evidence_fact_ids can
be added to those objects now vs. later) is confirmed — mapping this
output onto the old shape is mechanical once that's settled, and I did not
want to guess at 40+ legacy field names before you'd confirmed that.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple

from Agentic.clinical_shared.triage import compute_triage_colour

from .schema import Claim, GroundedClaim, GroundedFact, TriggerFlags

# Content ↔ trigger consistency map. Some clinical concepts are specific
# enough that only ONE trigger category can legitimately support them,
# regardless of which trigger_tag Stage 3 happened to cite. This exists
# because Stage 3 can "launder" an unsupported claim by citing a real,
# fired-but-unrelated trigger (e.g. citing is_trauma — true but generic —
# to justify "possible hemorrhagic shock" after bleeding_evidence
# correctly stopped firing). Rule 2 alone cannot catch this: the cited
# trigger IS real and IS fired. This rule checks CONTENT against the
# actually-fired trigger set, not against whatever tag was declared.
CONTENT_REQUIRES_TRIGGER: List[Tuple[Tuple[str, ...], str]] = [
    (("hemorrhag", "internal bleeding", "blood loss", "massive transfusion", "exsanguinat"), "bleeding_evidence"),
    (("anticoagul", "blood thinner", "on warfarin", "on heparin", "on plavix"), "anticoag_hit"),
    (("traumatic brain injury", "tbi", "intracranial", "cerebral edema", "herniation", "increased icp"), "head_injury_mechanism"),
    (("pneumothorax", "hemothorax", "h?mothorax", "cardiac tamponade", "flail chest"), "chest_trauma_mechanism"),
    (("compartment syndrome",), "compartment_risk_mechanism"),
    (("hypertensive emergency", "hypertensive crisis", "malignant hypertension"), "htn_crisis"),
]


def _content_trigger_violation(
    claim_value_text: str, fired_triggers: TriggerFlags
) -> Optional[str]:
    """Returns the required-but-not-fired trigger name if the claim's own
    wording invokes a concept that has a specific required trigger and
    that trigger did not fire — else None. Deliberately substring-based
    and conservative: false positives (flagging a claim that happens to
    share a word) are safer than false negatives here, and a human/
    downstream reviewer sees the drop_reason either way."""
    haystack = claim_value_text.lower()
    for keywords, required_trigger in CONTENT_REQUIRES_TRIGGER:
        if any(kw in haystack for kw in keywords):
            if not fired_triggers.get(required_trigger):
                return required_trigger
    return None

def _extract_number(text: str) -> Optional[int]:
    """
    Digit extraction with a lookbehind guard against digits embedded in a
    parameter's own NAME rather than its value — e.g. "SpO2" contains the
    digit "2" as part of the label itself. A naive `\\d+` search over
    "spo2 99%" matches the "2" in "spo2" before ever reaching "99", which
    silently produces a garbage severely-low reading and a false Red.
    Excluding any digit immediately preceded by a letter fixes this for
    every label of this shape (SpO2, O2, etc.) without needing a
    per-parameter special case.
    """
    match = re.search(r"(?<![a-zA-Z])\d+", text)
    if not match:
        return None
    try:
        return int(match.group())
    except Exception:
        return None


def _grounded_vital(grounded_facts: List[GroundedFact], patterns: List[str]) -> Optional[int]:
    """
    Best-effort numeric lookup for one vital parameter from grounded
    'vital' facts. Prefers Stage 1's own structured value dict (e.g.
    {"HR": "60"}) when present — that's the cleanest signal and avoids
    parsing digits out of a label at all. Falls back to evidence_text
    only (never the value's own string repr, which is what caused the
    SpO2 bug above) using the lookbehind-safe extractor.
    """
    for fact in grounded_facts:
        if fact.get("category") != "vital":
            continue
        value = fact.get("value")
        evidence_text = fact.get("evidence_text", "") or ""

        if isinstance(value, dict):
            for key, val in value.items():
                key_lower = str(key).lower()
                if any(p.strip() in key_lower for p in patterns):
                    number = _extract_number(str(val))
                    if number is not None:
                        return number

        haystack = evidence_text.lower()
        if any(p in haystack for p in patterns):
            number = _extract_number(haystack)
            if number is not None:
                return number
    return None


def _grounded_gcs(grounded_facts: List[GroundedFact]) -> Optional[int]:
    for fact in grounded_facts:
        haystack = f"{fact.get('value')} {fact.get('evidence_text', '')}".lower()
        if "gcs" not in haystack and "glasgow" not in haystack:
            continue
        match = re.search(r"\b([3-9]|1[0-5])\b", haystack)
        if match:
            try:
                return int(match.group(1))
            except Exception:
                continue
    return None


def _kept_claims_mention(grounded_claims: List[GroundedClaim], keywords: List[str]) -> bool:
    for claim in grounded_claims:
        value_text = str(claim.get("value", "")).lower()
        if any(kw in value_text for kw in keywords):
            return True
    return False


def compute_deterministic_triage_floor(
    grounded_facts: List[GroundedFact],
    grounded_claims: List[GroundedClaim],
    triggers: TriggerFlags,
) -> Dict[str, object]:
    """
    Wires clinical_shared.triage.compute_triage_colour() in as the
    deterministic floor its own docstring describes as "not currently
    wired in." Deliberately conservative: every boolean input defaults to
    None/False unless a KEPT (already citation-verified) claim or grounded
    fact explicitly supports it — this floor must never be more confident
    than the grounded evidence underneath it.

    This is a FLOOR, not the final triage colour: it reasons only from
    physiological derangement (per compute_triage_colour's own docstring)
    and cannot catch a diagnosis-driven Red the way a full clinical read
    could. Stage 4 surfaces it as one input for a human/downstream system
    to weigh, not as the sole triage authority — same caveat
    clinical_shared/triage.py already documents for EIDIS/EDFS.
    """
    hr = _grounded_vital(grounded_facts, ["hr", "heart rate", "pulse"])
    rr = _grounded_vital(grounded_facts, ["rr ", "respiratory rate"])
    spo2 = _grounded_vital(grounded_facts, ["spo2", "oxygen saturation"])
    bp_sys = _grounded_vital(grounded_facts, ["bp ", "blood pressure", "systolic"])
    gcs = _grounded_gcs(grounded_facts)

    shock_suspected = _kept_claims_mention(grounded_claims, ["shock"]) or None
    respiratory_failure_risk = _kept_claims_mention(
        grounded_claims, ["respiratory failure", "respiratory arrest"]
    ) or None
    pneumothorax_or_hemothorax_flag = (
        bool(triggers.get("chest_trauma_mechanism"))
        and _kept_claims_mention(grounded_claims, ["pneumothorax", "hemothorax", "tamponade"])
    ) or None
    arrest_or_deceased_indicated = _kept_claims_mention(
        grounded_claims, ["deceased", "no spontaneous circulation", "cardiac arrest confirmed"]
    ) or None

    colour = compute_triage_colour(
        hr=hr,
        rr=rr,
        spo2_room_air=spo2,
        bp_sys=bp_sys,
        gcs=gcs,
        shock_suspected=shock_suspected,
        respiratory_failure_risk=respiratory_failure_risk,
        pneumothorax_or_hemothorax_flag=pneumothorax_or_hemothorax_flag,
        arrest_or_deceased_indicated=arrest_or_deceased_indicated,
    )

    return {
        "triage_colour": colour,
        "triage_colour_source": "deterministic_floor_grounded_vitals",
        "triage_floor_inputs": {
            "hr": hr, "rr": rr, "spo2_room_air": spo2, "bp_sys": bp_sys, "gcs": gcs,
            "shock_suspected": shock_suspected,
            "respiratory_failure_risk": respiratory_failure_risk,
            "pneumothorax_or_hemothorax_flag": pneumothorax_or_hemothorax_flag,
            "arrest_or_deceased_indicated": arrest_or_deceased_indicated,
        },
    }


def ground_check_claims(
    raw_claims: List[Claim],
    grounded_facts: List[GroundedFact],
    triggers: TriggerFlags,
) -> Tuple[List[GroundedClaim], List[GroundedClaim]]:
    """Returns (kept, dropped)."""
    valid_fact_ids = {f["fact_id"] for f in grounded_facts}
    kept: List[GroundedClaim] = []
    dropped: List[GroundedClaim] = []

    for claim in raw_claims:
        category = claim.get("category", "")
        evidence_ids = claim.get("evidence_fact_ids") or []
        trigger_tag = claim.get("trigger_tag")

        gclaim: GroundedClaim = dict(claim)  # type: ignore[assignment]

        # Rule 1: evidence_fact_ids must be non-empty and fully resolve,
        # UNLESS this is a data_gap claim (an absence doesn't need positive
        # evidence to cite).
        if category != "data_gap":
            if not evidence_ids:
                gclaim["compose_verdict"] = "dropped_unresolved_evidence"
                gclaim["drop_reason"] = "no evidence_fact_ids provided"
                dropped.append(gclaim)
                continue
            unresolved = [fid for fid in evidence_ids if fid not in valid_fact_ids]
            if unresolved:
                gclaim["compose_verdict"] = "dropped_unresolved_evidence"
                gclaim["drop_reason"] = f"fact_ids do not exist: {unresolved}"
                dropped.append(gclaim)
                continue

        # Rule 2: trigger_tag, if present, must correspond to a trigger
        # that actually fired. A claim that invents relevance to an
        # inactive pattern is exactly the original fabrication class
        # (e.g. tagging "anticoag_hit" when it never fired) and must be
        # dropped even if its fact citations happen to resolve.
        if trigger_tag:
            if not triggers.get(trigger_tag):
                gclaim["compose_verdict"] = "dropped_trigger_mismatch"
                gclaim["drop_reason"] = (
                    f"claim tagged trigger_tag={trigger_tag!r} but that trigger did not fire"
                )
                dropped.append(gclaim)
                continue

        # Rule 3: content/trigger consistency. Even when trigger_tag is a
        # real, fired trigger, the claim's own wording may invoke a more
        # specific clinical concept whose OWN trigger did not fire. This
        # is the fabrication class surviving Rule 2 by citing a true-but-
        # generic trigger instead of the specific-but-inactive one.
        violation = _content_trigger_violation(str(claim.get("value", "")), triggers)
        if violation:
            gclaim["compose_verdict"] = "dropped_content_trigger_mismatch"
            gclaim["drop_reason"] = (
                f"claim content implies {violation!r} but that trigger did not fire "
                f"(declared trigger_tag={trigger_tag!r})"
            )
            dropped.append(gclaim)
            continue

        gclaim["compose_verdict"] = "kept"
        kept.append(gclaim)

    return kept, dropped


def compose_final_output(
    grounded_facts: List[GroundedFact],
    grounded_claims: List[GroundedClaim],
    dropped_facts: List[GroundedFact],
    dropped_claims: List[GroundedClaim],
    triggers: TriggerFlags,
    case_type: str,
    care_setting: str,
    patient_id: str,
) -> Dict:
    """
    Grounded-native output shape. Every claim in `claims` is guaranteed to
    either be a data_gap, or to resolve to real fact_ids and (if tagged) a
    real fired trigger — nothing here was assembled from a claim Stage 4
    couldn't verify.
    """
    risk_level_claims = [c for c in grounded_claims if c["category"] == "risk_level"]
    overall_risk = risk_level_claims[0]["value"] if risk_level_claims else "Unknown"

    triage_floor = compute_deterministic_triage_floor(grounded_facts, grounded_claims, triggers)

    return {
        "patient_id": patient_id,
        "case_type": case_type,
        "care_setting": care_setting,
        "triggers_fired": [k for k, v in triggers.items() if k != "trigger_basis" and v is True],
        "trigger_basis": triggers.get("trigger_basis", {}),
        "facts": grounded_facts,
        "claims": grounded_claims,
        "overall_risk_level": overall_risk,
        "triage_colour": triage_floor["triage_colour"],
        "triage_colour_source": triage_floor["triage_colour_source"],
        "triage_floor_inputs": triage_floor["triage_floor_inputs"],
        "suspected_diagnoses": [
            c for c in grounded_claims if c["category"] == "suspected_diagnosis"
        ],
        "precautions": [c for c in grounded_claims if c["category"] == "precaution"],
        "immediate_actions": [c for c in grounded_claims if c["category"] == "immediate_action"],
        "hospital_prep_items": [
            c for c in grounded_claims if c["category"] == "hospital_prep_item"
        ],
        "monitoring_alerts": [c for c in grounded_claims if c["category"] == "monitoring_alert"],
        "escalation_triggers": [
            c for c in grounded_claims if c["category"] == "escalation_trigger"
        ],
        "data_gaps": [c for c in grounded_claims if c["category"] == "data_gap"],
        "audit": {
            "facts_extracted": len(grounded_facts) + len(dropped_facts),
            "facts_grounded": len(grounded_facts),
            "facts_dropped_ungrounded": len(dropped_facts),
            "claims_generated": len(grounded_claims) + len(dropped_claims),
            "claims_kept": len(grounded_claims),
            "stage3_claims_dropped_ungrounded": len(dropped_claims),
            "dropped_fact_details": dropped_facts,
            "dropped_claim_details": dropped_claims,
        },
        "_schema_note": (
            "This is the grounded-native output shape, not yet mapped to the "
            "legacy ambulance.py response contract (suggestions/immediate_actions/"
            "precautions/hospital_prep/vitals_comparison/risk_stratification). "
            "See stage4_compose.py module docstring."
        ),
    }