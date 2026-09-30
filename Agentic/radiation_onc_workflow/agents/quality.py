"""
agents/quality.py — Module 04: Plan Quality & Safety Validation.

Independent verification that the approved plan matches the prescription, meets
constraint targets, is signed off, and is physically deliverable. This module is
TPS-dependent: coverage indices, HI/CI and a composite quality score live in the
treatment-planning system, not in the two workflow databases, so those rows are
honestly labelled "Not available". Everything that IS recorded — physics QA flags,
gamma analysis, approvals and machine — is derived deterministically.

Sources:
  * `radiotherapy_records` → `data.qa` (planVerificationCompleted, muCalculationVerified,
    doseDistributionReviewed, dvhConstraintsMet, physicsApprovalObtained, gammaPassRate,
    pointDoseMeasurement), `data.treatment` (treatmentMachine, beamParameters energy),
    `data.intent` (targetVolumes, organsAtRisk).
  * `rt-record-details` → `ebrt.simulationSets` (prescription, machine, peerReview),
    `ebrt.procedure` (technique), `ebrt.approvals` (RO/MP/RTT sign-off).

Frozen row mapping for Module 04 (standard renderer):
    param   → Parameter
    finding → Current Finding
    ref     → Reference / Expected
    status/statusLabel → Status pill
    action  → Indication / Action

Emits exactly the six frozen keys per row; adds nothing to the dashboard.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from ..data_sources import coalesce_history, resolve_prescription
from ..state import (
    Row,
    STATUS_OK,
    STATUS_WATCH,
    STATUS_ALERT,
    STATUS_NEUTRAL,
    DASH,
)
from .base import BaseAgent


# ── helpers ──────────────────────────────────────────────────────────────────
def _clean(value: Any) -> str:
    """Trimmed string; empty for None/blank/'none'/'null' so callers can test truthiness."""
    text = str(value).strip() if value is not None else ""
    return "" if text.lower() in ("", "none", "null") else text


def _truthy(value: Any) -> bool:
    """Accept real booleans or their string spellings ('true'/'yes'/'y'/'1')."""
    if isinstance(value, bool):
        return value
    return _clean(value).lower() in ("true", "yes", "y", "1")


def _num(value: Any) -> Optional[float]:
    """Parse a numeric string/number; None if not numeric."""
    try:
        return float(str(value).strip())
    except (ValueError, TypeError):
        return None


def _fmt(value: Optional[float]) -> str:
    """39.0 → '39', 94.7 → '94.7'."""
    if value is None:
        return DASH
    return f"{value:.0f}" if abs(value - round(value)) < 0.05 else f"{value:.1f}"


def _fmt_gy(cgy: Any) -> str:
    """'3000' cGy → '30 Gy'. Empty string if not numeric."""
    val = _num(cgy)
    if val is None:
        return ""
    gy = val / 100.0
    return f"{gy:.0f} Gy" if gy == int(gy) else f"{gy:.2f} Gy"


# Standard patient-specific QA acceptance (gamma 3%/3mm, ≥95% passing).
_GAMMA_CRITERION = 95.0


class QualityAgent(BaseAgent):
    moduleId = "m4"
    slug = "quality"
    num = "04 / 12"
    title = "Plan Quality & Safety Validation"

    async def gather_context(self, patient_id: Optional[str]) -> Dict[str, Any]:
        details_record = await self.ds.get_ebrt_record(patient_id)
        workflow_record = await self.ds.get_workflow_record(patient_id)
        data = workflow_record.get("data") or {}
        return {
            "ebrt": coalesce_history(details_record, "ebrt"),
            "qa": coalesce_history(data, "qa"),
            "treatment": coalesce_history(data, "treatment"),
            "intent": coalesce_history(data, "intent"),
        }

    def build_rows(self, ctx: Dict[str, Any]) -> List[Row]:
        ebrt = ctx.get("ebrt") or {}
        qa = ctx.get("qa") or {}
        treatment = ctx.get("treatment") or {}
        intent = ctx.get("intent") or {}

        sim_sets = ebrt.get("simulationSets") or []
        sim = sim_sets[0] if sim_sets else {}
        procedure = ebrt.get("procedure") or {}
        approvals = ebrt.get("approvals") or {}
        targets = [t for t in (intent.get("targetVolumes") or []) if isinstance(t, dict)]
        oars = [o for o in (intent.get("organsAtRisk") or []) if isinstance(o, dict)]
        beams = [b for b in (treatment.get("beamParameters") or []) if isinstance(b, dict)]

        # Prescription resolved unit-correct (Treatment Plan tab Gy → legacy sim set cGy).
        rx = resolve_prescription(treatment, ebrt)
        presc_gy = rx["total_gy"]  # always Gy
        presc_present = presc_gy is not None or bool(rx["free_text"]) or bool(rx["n_fx"])
        presc_txt = (f"{presc_gy:g} Gy" if presc_gy is not None
                     else (rx["free_text"] or (f"{rx['n_fx']} fx" if rx["n_fx"] else "")))
        technique = _clean(procedure.get("technique"))
        machine = _clean(treatment.get("treatmentMachine")) or _clean(sim.get("machine"))
        gamma = _num(qa.get("gammaPassRate"))

        rows: List[Row] = []

        # 1. Plan Completeness — are the core plan components on record?
        components = [
            ("Prescription", presc_present),
            ("Target volumes", bool(targets)),
            ("Technique", bool(technique)),
            ("Beam parameters", bool(beams)),
            ("Machine", bool(machine)),
        ]
        done = [name for name, ok in components if ok]
        missing = [name for name, ok in components if not ok]
        if done:
            rows.append(Row(
                param="Plan Completeness",
                status=STATUS_OK if not missing else STATUS_WATCH,
                statusLabel=f"{len(done)}/{len(components)}",
                finding=f"{len(done)} of {len(components)} plan components on record",
                ref="All plan components present",
                action=("All plan components recorded." if not missing
                        else "Pending: " + ", ".join(missing) + "."),
                source="derived",
            ))
        else:
            rows.append(Row.not_available(
                "Plan Completeness", ref="Requires plan components",
                action="Populates from prescription, targets, technique, beams and machine."))

        # 2. Prescription vs. Plan — plan verified against the prescribed dose.
        plan_verified = _truthy(qa.get("planVerificationCompleted"))
        mu_verified = _truthy(qa.get("muCalculationVerified"))
        if presc_present:
            gy_txt = presc_txt or "the prescribed dose"
            if plan_verified:
                rows.append(Row(
                    param="Prescription vs. Plan",
                    status=STATUS_OK, statusLabel="Verified",
                    finding=(f"Plan verified against {gy_txt} prescription"
                             + (" · MU calc verified" if mu_verified else "")),
                    ref="Plan matches prescribed dose & fractionation",
                    action="Plan verification recorded; confirm dose/fractionation match the intent.",
                    source="db",
                ))
            else:
                rows.append(Row(
                    param="Prescription vs. Plan",
                    status=STATUS_WATCH, statusLabel="Unverified",
                    finding=f"{gy_txt} prescribed; plan verification not confirmed",
                    ref="Plan matches prescribed dose & fractionation",
                    action="Confirm the plan reproduces the prescription before approval.",
                    source="db",
                ))
        else:
            rows.append(Row.not_available(
                "Prescription vs. Plan", ref="Requires prescription + plan verification",
                action="Populates from ebrt.simulationSets + qa.planVerificationCompleted."))

        # 3. Target Coverage (PTV70 V95%) — DVH coverage % is TPS-only.
        rows.append(Row.not_available(
            "Target Coverage (PTV70 V95%)",
            ref="PTV V95% ≥ 95% (ICRU 83)",
            action="Populates from a TPS DVH export; per-volume coverage % is not in the "
                   "workflow record.",
            source="gap",
        ))

        # 4. OAR Constraint Compliance — qa.dvhConstraintsMet against recorded OARs.
        if qa.get("dvhConstraintsMet") is not None:
            met = _truthy(qa.get("dvhConstraintsMet"))
            oar_txt = f" for {len(oars)} recorded OAR(s)" if oars else ""
            if met:
                rows.append(Row(
                    param="OAR Constraint Compliance",
                    status=STATUS_OK, statusLabel="Constraints met",
                    finding=f"DVH constraints met{oar_txt}",
                    ref="All OAR DVH constraints satisfied",
                    action="Recorded DVH constraints satisfied; verify completeness for the site.",
                    source="db",
                ))
            else:
                rows.append(Row(
                    param="OAR Constraint Compliance",
                    status=STATUS_ALERT, statusLabel="Constraint exceeded",
                    finding=f"DVH constraints not met{oar_txt}",
                    ref="All OAR DVH constraints satisfied",
                    action="One or more OAR constraints exceeded — review/optimise the plan.",
                    source="db",
                ))
        else:
            rows.append(Row.not_available(
                "OAR Constraint Compliance", ref="All OAR DVH constraints satisfied",
                action="Populates from qa.dvhConstraintsMet."))

        # 5. Plan Quality Score — composite TPS index, not recorded.
        rows.append(Row.not_available(
            "Plan Quality Score",
            ref="Composite plan-quality index",
            action="Populates from a TPS-computed quality score; not stored in the workflow record.",
            source="gap",
        ))

        # 6. Homogeneity / Conformity Index — TPS DVH-derived, not recorded.
        rows.append(Row.not_available(
            "Homogeneity / Conformity Index",
            ref="HI → 0, CI → 1 (ICRU 83 / RTOG)",
            action="Populates from a TPS DVH export (HI/CI); not stored in the workflow record.",
            source="gap",
        ))

        # 7. Collision Risk — requires machine/patient geometry model.
        rows.append(Row.not_available(
            "Collision Risk",
            ref="No gantry/couch/patient collision",
            action="Populates from a machine-geometry collision model; no geometry source linked.",
            source="request",
        ))

        # 8. Machine Compatibility — assigned machine + beam energy on record.
        if machine:
            energy = _clean(beams[0].get("energyMv")) if beams else ""
            rows.append(Row(
                param="Machine Compatibility",
                status=STATUS_OK, statusLabel="On record",
                finding=machine + (f" · {energy}" if energy else ""),
                ref="Plan deliverable on the assigned machine",
                action=(f"Plan assigned to {machine}"
                        + (f"; confirm {energy} is commissioned on this unit."
                           if energy else "; confirm beam energies are commissioned.")),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Machine Compatibility", ref="Requires assigned machine",
                action="Populates from treatment.treatmentMachine / ebrt.simulationSets.machine."))

        # 9. Treatment Approval Checklist — RO/MP/RTT sign-off + physics QA approval.
        checks = [
            ("RO sign-off", _truthy(approvals.get("roSigned"))),
            ("Medical Physics sign-off", _truthy(approvals.get("mpSigned"))),
            ("RTT sign-off", _truthy(approvals.get("rttSigned"))),
            ("Physics QA approval", _truthy(qa.get("physicsApprovalObtained"))),
        ]
        have_any = bool(approvals) or qa.get("physicsApprovalObtained") is not None
        signed = [name for name, ok in checks if ok]
        pending = [name for name, ok in checks if not ok]
        if have_any:
            rows.append(Row(
                param="Treatment Approval Checklist",
                status=STATUS_OK if not pending else STATUS_WATCH,
                statusLabel=f"{len(signed)}/{len(checks)}",
                finding=f"{len(signed)} of {len(checks)} approvals complete",
                ref="RO, Medical Physics, RTT and physics QA all signed",
                action=("All approvals complete." if not pending
                        else "Pending: " + ", ".join(pending) + "."),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Treatment Approval Checklist", ref="RO, Medical Physics, RTT and physics QA signed",
                action="Populates from ebrt.approvals + qa.physicsApprovalObtained."))

        # 10. Independent Clinical Review — peer review on the plan.
        peer = _clean(sim.get("peerReview"))
        comments = _clean(sim.get("peerComments"))
        if peer:
            reviewed = peer.lower() in ("yes", "y", "true")
            rows.append(Row(
                param="Independent Clinical Review",
                status=STATUS_OK if reviewed else STATUS_WATCH,
                statusLabel="Peer reviewed" if reviewed else "Pending",
                finding=f"Peer review: {peer}" + (f" — {comments}" if comments else ""),
                ref="Independent peer / chart review completed",
                action=("Peer review recorded." if reviewed
                        else "Independent peer review not yet completed."),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Independent Clinical Review", ref="Independent peer / chart review completed",
                action="Populates from ebrt.simulationSets.peerReview."))

        # 11. AI Plan Consistency Check — gamma agreement between plan and measurement.
        if gamma is not None:
            point = _clean(qa.get("pointDoseMeasurement"))
            passed = gamma >= _GAMMA_CRITERION
            rows.append(Row(
                param="AI Plan Consistency Check",
                status=STATUS_OK if passed else STATUS_ALERT,
                statusLabel="Consistent" if passed else "Inconsistent",
                finding=(f"Gamma pass rate {_fmt(gamma)}%"
                         + (f" · point dose {point}%" if point else "")),
                ref="Gamma ≥ 95% at 3%/3mm",
                action=("Measured dose agrees with the plan within tolerance."
                        if passed else
                        f"Gamma {_fmt(gamma)}% is below the 95% criterion — "
                        "investigate the plan/delivery discrepancy before treatment."),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "AI Plan Consistency Check", ref="Gamma ≥ 95% at 3%/3mm",
                action="Populates from patient-specific QA (qa.gammaPassRate)."))

        # 12. Planning Deviation Detection — any recorded verification/QA check failing.
        flag_map = [
            ("plan verification", "planVerificationCompleted"),
            ("MU calculation", "muCalculationVerified"),
            ("dose distribution review", "doseDistributionReviewed"),
            ("DVH constraints", "dvhConstraintsMet"),
            ("physics approval", "physicsApprovalObtained"),
        ]
        recorded = [(name, key) for name, key in flag_map if qa.get(key) is not None]
        deviations = [f"{name} not completed"
                      for name, key in recorded if not _truthy(qa.get(key))]
        if gamma is not None and gamma < _GAMMA_CRITERION:
            deviations.append(f"gamma {_fmt(gamma)}% < 95%")
        if recorded or gamma is not None:
            if deviations:
                rows.append(Row(
                    param="Planning Deviation Detection",
                    status=STATUS_ALERT,
                    statusLabel=f"{len(deviations)} deviation{'s' if len(deviations) != 1 else ''}",
                    finding="; ".join(deviations),
                    ref="No deviation from plan / QA standards",
                    action="Resolve the flagged deviation(s) before treatment approval.",
                    source="derived",
                ))
            else:
                rows.append(Row(
                    param="Planning Deviation Detection",
                    status=STATUS_OK, statusLabel="No deviations",
                    finding=f"{len(recorded)} verification check(s) passed; no deviation detected",
                    ref="No deviation from plan / QA standards",
                    action="No planning deviations detected in the recorded checks.",
                    source="derived",
                ))
        else:
            rows.append(Row.not_available(
                "Planning Deviation Detection", ref="No deviation from plan / QA standards",
                action="Populates from qa verification flags + gamma analysis."))

        return rows

    def build_prompt(self, ctx: Dict[str, Any], rows: List[Row]) -> Optional[str]:
        """
        Optional 1-2 sentence plan-QA narrative (prose only), stored under meta.narrative.
        Row statuses above are already final and independent of this. Skips cleanly when
        GROQ_API_KEY is unset.
        """
        ebrt = ctx.get("ebrt") or {}
        qa = ctx.get("qa") or {}
        treatment = ctx.get("treatment") or {}
        payload = {
            "qaFlags": {
                k: qa.get(k) for k in (
                    "planVerificationCompleted", "muCalculationVerified",
                    "doseDistributionReviewed", "dvhConstraintsMet",
                    "physicsApprovalObtained")
            },
            "gammaPassRate": qa.get("gammaPassRate"),
            "approvals": ebrt.get("approvals"),
            "machine": treatment.get("treatmentMachine"),
        }
        return (
            "You are a radiation oncology plan-QA assistant. Using ONLY the JSON below, "
            "write a concise 1-2 sentence plan quality & safety summary. Do not invent data "
            "or recompute values; if a field is missing, omit it. Return a JSON object with a "
            'single key "quality" whose value is the sentence.\n\n'
            f"DATA:\n{json.dumps(payload, default=str)}"
        )
