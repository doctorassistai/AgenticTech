"""
agents/physics.py — Module 10: Radiation Physics & Quality Assurance.

The physics layer that underwrites every clinical module above it: patient-specific
QA (gamma/point-dose), dose-delivery verification, image-registration accuracy and the
physics sign-off trail. Everything recorded in the workflow QA/imaging stages is derived
deterministically. The delineated structure set (Treatment Intent target volumes + OARs)
drives the contour-consistency / review rows, but contour GEOMETRY (shapes, DSC vs a
reference), auto-segmentation reports, machine-level QA logs (TG-142) and EPID portal
dosimetry are NOT stored in either workflow database, so those rows stay honestly labelled
"Not available". Nothing is invented; published QA acceptance criteria are disclosed in
each row's reference column.

Sources:
  * `radiotherapy_records` → `data.qa` (gammaPassRate, pointDoseMeasurement, measurement
    Device/Type, qaPerformedBy, dateOfMouldRoomVisit, qaResults, planVerificationCompleted,
    muCalculationVerified, doseDistributionReviewed, dvhConstraintsMet, physicsApproval
    Obtained), `data.imaging` (imagingShifts[]: X/Y/Z/rotation/isocenterShifts/
    residualErrorAfterShift; verificationMethod, actionLevelMm, toleranceLevelMm),
    `data.treatment` (treatmentMachine), `data.setup` (setupVerificationMethod),
    `data.staff` (staffMembers[] — physicist provenance), `data.intent`
    (targetVolumes[]: volumeName/type/volumeCc/prescribedDose + organsAtRisk[]:
    organName/maxDoseGy/meanDoseGy — the delineated structure set for the
    contour-consistency / review rows).
  * `rt-record-details` → `ebrt.approvals` (RO/MP/RTT sign-off).

Frozen row mapping for Module 10 (standard renderer):
    param   → Parameter
    finding → Current Finding
    ref     → Reference / Expected
    status/statusLabel → Status pill
    action  → Indication / Action

Emits exactly the six frozen keys per row; adds nothing to the dashboard.
"""

from __future__ import annotations

import json
import math
import re
from typing import Any, Dict, List, Optional

from ..data_sources import coalesce_history
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


def _first_num(value: Any) -> Optional[float]:
    """First number embedded in free text ('less than 0.5 millimeters' → 0.5)."""
    m = re.search(r"[-+]?\d*\.?\d+", str(value or ""))
    return float(m.group()) if m else None


def _fmt(value: Optional[float]) -> str:
    """39.0 → '39', 94.7 → '94.7'."""
    if value is None:
        return DASH
    return f"{value:.0f}" if abs(value - round(value)) < 0.05 else f"{value:.1f}"


def _vector3(shift: Dict[str, Any]) -> Optional[float]:
    """3D registration-shift magnitude √(x²+y²+z²) in mm from one imaging shift."""
    x = _num(shift.get("shiftXMm"))
    y = _num(shift.get("shiftYMm"))
    z = _num(shift.get("shiftZMm"))
    if x is None or y is None or z is None:
        return None
    return math.sqrt(x * x + y * y + z * z)


def _structure_set(intent: Dict[str, Any]) -> Dict[str, Any]:
    """
    Summarise the delineated structure set from the Treatment Intent stage
    (data.intent.targetVolumes[] + organsAtRisk[]).

    This is the *definitional* contour data the workflow stores — which target
    volumes and OARs were delineated, their RT type, volume (cc) and dose objectives.
    It is NOT geometry (no shapes / DSC vs a reference), so callers must scope their
    language to structure-set completeness, never contour shape accuracy.

    Mirrors the JSX "populated" filter: a target counts if any of volumeName/type/
    volumeCc/prescribedDose is set; an OAR if any of organName/maxDoseGy/meanDoseGy is.
    Never raises.
    """
    targets = [t for t in (intent.get("targetVolumes") or []) if isinstance(t, dict)]
    oars = [o for o in (intent.get("organsAtRisk") or []) if isinstance(o, dict)]
    targets = [t for t in targets if _clean(t.get("volumeName")) or _clean(t.get("type"))
               or _clean(t.get("volumeCc")) or _clean(t.get("prescribedDose"))]
    oars = [o for o in oars if _clean(o.get("organName")) or _clean(o.get("maxDoseGy"))
            or _clean(o.get("meanDoseGy"))]

    order = ["gtv", "ctv", "ptv", "itv"]
    labels = {"gtv": "GTV", "ctv": "CTV", "ptv": "PTV", "itv": "ITV"}
    types = [_clean(t.get("type")).lower() for t in targets]
    counts = {k: types.count(k) for k in order}
    untyped = sum(1 for ty in types if ty not in order)
    type_bits = [f"{counts[k]} {labels[k]}" for k in order if counts[k]]
    if untyped:
        type_bits.append(f"{untyped} untyped")

    targets_no_dose = [t for t in targets if not _clean(t.get("prescribedDose"))]
    oars_no_constraint = [o for o in oars
                          if not (_clean(o.get("maxDoseGy")) or _clean(o.get("meanDoseGy")))]

    return {
        "targets": targets,
        "oars": oars,
        "type_summary": ", ".join(type_bits),
        "has_ptv": counts["ptv"] > 0,
        "targets_no_dose": targets_no_dose,
        "oars_no_constraint": oars_no_constraint,
    }


# Standard patient-specific IMRT/VMAT QA acceptance (TG-218: gamma 3%/3mm, ≥95% passing).
_GAMMA_CRITERION = 95.0


class PhysicsAgent(BaseAgent):
    moduleId = "m10"
    slug = "physics"
    num = "10 / 12"
    title = "Radiation Physics & Quality Assurance"

    async def gather_context(self, patient_id: Optional[str]) -> Dict[str, Any]:
        details_record = await self.ds.get_ebrt_record(patient_id)
        workflow_record = await self.ds.get_workflow_record(patient_id)
        data = workflow_record.get("data") or {}
        return {
            "ebrt": coalesce_history(details_record, "ebrt"),
            "qa": coalesce_history(data, "qa"),
            "imaging": coalesce_history(data, "imaging"),
            "treatment": coalesce_history(data, "treatment"),
            "setup": coalesce_history(data, "setup"),
            "staff": coalesce_history(data, "staff"),
            "intent": coalesce_history(data, "intent"),
        }

    def build_rows(self, ctx: Dict[str, Any]) -> List[Row]:
        ebrt = ctx.get("ebrt") or {}
        qa = ctx.get("qa") or {}
        imaging = ctx.get("imaging") or {}
        treatment = ctx.get("treatment") or {}
        setup = ctx.get("setup") or {}
        staff = ctx.get("staff") or {}
        intent = ctx.get("intent") or {}

        approvals = ebrt.get("approvals") or {}
        shifts = [s for s in (imaging.get("imagingShifts") or []) if isinstance(s, dict)]
        staff_members = [m for m in (staff.get("staffMembers") or []) if isinstance(m, dict)]

        machine = _clean(treatment.get("treatmentMachine"))
        gamma = _num(qa.get("gammaPassRate"))
        action_mm = _num(imaging.get("actionLevelMm"))
        tol_mm = _num(imaging.get("toleranceLevelMm"))
        verif = _clean(imaging.get("verificationMethod"))

        rows: List[Row] = []

        # 1. Machine QA Correlation — needs the machine's independent QA log (TG-142).
        rows.append(Row.not_available(
            "Machine QA Correlation",
            ref="Assigned machine has current TG-142 QA (output/mechanical constancy)",
            action=("Populates from the linac QA log; machine-level QA constancy is not "
                    "stored in the workflow record"
                    + (f" (plan assigned to {machine})." if machine else ".")),
            source="gap",
        ))

        # 2. Patient-Specific QA — measured gamma (3%/3mm) vs the ≥95% criterion.
        if gamma is not None:
            point = _clean(qa.get("pointDoseMeasurement"))
            device = _clean(qa.get("measurementDevice"))
            passed = gamma >= _GAMMA_CRITERION
            rows.append(Row(
                param="Patient-Specific QA",
                status=STATUS_OK if passed else STATUS_ALERT,
                statusLabel="Pass" if passed else "Fail",
                finding=(f"Gamma pass rate {_fmt(gamma)}%"
                         + (f" · point dose {point}" if point else "")
                         + (f" · {device}" if device else "")),
                ref="Gamma ≥ 95% at 3%/3mm (AAPM TG-218)",
                action=("Measured fluence agrees with the plan within tolerance."
                        if passed else
                        f"Gamma {_fmt(gamma)}% is below the 95% criterion — repeat "
                        "measurement / investigate the delivery discrepancy before treatment."),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Patient-Specific QA", ref="Gamma ≥ 95% at 3%/3mm (AAPM TG-218)",
                action="Populates from data.qa.gammaPassRate (patient-specific QA measurement)."))

        # 3. Dose Delivery Verification — MU check + point dose + dose-distribution review.
        verif_checks = [
            ("Independent MU calculation", qa.get("muCalculationVerified")),
            ("Dose distribution review", qa.get("doseDistributionReviewed")),
        ]
        recorded = [(name, val) for name, val in verif_checks if val is not None]
        point_dose = _clean(qa.get("pointDoseMeasurement"))
        if recorded or point_dose:
            passed = [name for name, val in recorded if _truthy(val)]
            pending = [name for name, val in recorded if not _truthy(val)]
            ok = not pending
            bits = []
            if point_dose:
                bits.append(f"point-dose measurement {point_dose}")
            if passed:
                bits.append(", ".join(passed).lower() + " verified")
            rows.append(Row(
                param="Dose Delivery Verification",
                status=STATUS_OK if ok else STATUS_WATCH,
                statusLabel="Verified" if ok else "Pending",
                finding=("; ".join(bits) if bits
                         else "Delivery verification recorded"),
                ref="Independent MU check + measured dose agree with the plan",
                action=("Delivered-dose verification recorded." if ok
                        else "Pending: " + ", ".join(pending) + "."),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Dose Delivery Verification",
                ref="Independent MU check + measured dose agree with the plan",
                action="Populates from qa.muCalculationVerified / pointDoseMeasurement."))

        # 4. Portal Dosimetry Analysis — needs EPID portal-dose measurement.
        setup_method = _clean(setup.get("setupVerificationMethod"))
        portal_note = (" (portal imaging is used for setup verification, not dose)"
                       if "portal" in setup_method.lower() else "")
        rows.append(Row.not_available(
            "Portal Dosimetry Analysis",
            ref="EPID portal dose agrees with the predicted portal image",
            action="Populates from EPID portal-dosimetry results; not stored in the "
                   "workflow record" + portal_note + ".",
            source="gap",
        ))

        # 5. Machine Performance Analytics — needs machine performance/output-trend logs.
        rows.append(Row.not_available(
            "Machine Performance Analytics",
            ref="Linac output / mechanical performance trended within tolerance",
            action="Populates from linac performance logs (output constancy, uptime); "
                   "not stored in the workflow record.",
            source="gap",
        ))

        # 6. Image Registration Validation — post-shift residual error vs tolerance.
        residual_texts = [_clean(s.get("residualErrorAfterShift")) for s in shifts]
        residual_texts = [t for t in residual_texts if t]
        if verif or residual_texts:
            residual = residual_texts[-1] if residual_texts else ""
            residual_val = _first_num(residual) if residual else None
            if residual_val is not None and tol_mm is not None:
                if residual_val <= tol_mm:
                    st, label = STATUS_OK, "Within tolerance"
                elif action_mm is not None and residual_val > action_mm:
                    st, label = STATUS_ALERT, "Over action level"
                else:
                    st, label = STATUS_WATCH, "Over tolerance"
            elif residual:
                st, label = STATUS_OK, "Validated"
            else:
                st, label = STATUS_NEUTRAL, "Recorded"
            ref_txt = (f"Post-registration residual ≤ {_fmt(tol_mm)} mm tolerance"
                       if tol_mm is not None else
                       "Post-registration residual within protocol tolerance")
            rows.append(Row(
                param="Image Registration Validation",
                status=st, statusLabel=label,
                finding=(f"{verif or 'Image registration'}"
                         + (f"; residual {residual}" if residual else "")),
                ref=ref_txt,
                action=("Registration residual within tolerance after correction."
                        if st == STATUS_OK else
                        "Residual registration error over action level — re-register / re-image."
                        if st == STATUS_ALERT else
                        "Residual registration error above tolerance; re-verify the match."
                        if st == STATUS_WATCH else
                        f"{verif} registration recorded; confirm residual accuracy."),
                source="derived" if residual_val is not None else "db",
            ))
        else:
            rows.append(Row.not_available(
                "Image Registration Validation",
                ref="Post-registration residual within protocol tolerance",
                action="Populates from data.imaging.verificationMethod / residualErrorAfterShift."))

        # 7. Contour Consistency Checker — completeness/consistency of the delineated
        #    structure set (Treatment Intent target volumes + OARs, data.intent). This is
        #    definitional contour data only; contour GEOMETRY is not stored, so the scope
        #    stays on the structure list (types present, doses/constraints assigned).
        ss = _structure_set(intent)
        targets, oars = ss["targets"], ss["oars"]
        if targets or oars:
            issues: List[str] = []
            if not targets:
                issues.append("no target volume delineated")
            elif not ss["has_ptv"]:
                issues.append("no PTV among the target volumes")
            if ss["targets_no_dose"]:
                n = len(ss["targets_no_dose"])
                issues.append(f"{n} target{'s' if n != 1 else ''} without a prescribed dose")
            if ss["oars_no_constraint"]:
                n = len(ss["oars_no_constraint"])
                issues.append(f"{n} OAR{'s' if n != 1 else ''} without a dose constraint")
            t_n, o_n = len(targets), len(oars)
            finding = (f"{t_n} target volume{'s' if t_n != 1 else ''}"
                       + (f" ({ss['type_summary']})" if ss["type_summary"] else "")
                       + f", {o_n} OAR{'s' if o_n != 1 else ''} delineated")
            rows.append(Row(
                param="Contour Consistency Checker",
                status=STATUS_OK if not issues else STATUS_WATCH,
                statusLabel="Consistent" if not issues else "Review",
                finding=finding,
                ref="Target volumes (GTV/CTV/PTV) + OARs delineated with dose objectives",
                action=("Structure set complete and consistent: targets typed with "
                        "prescribed doses and OARs carry dose constraints (verifies the "
                        "delineated structure list, not contour geometry)."
                        if not issues else
                        "Review the structure set — " + "; ".join(issues)
                        + " (structure-list check only; contour geometry is not stored)."),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Contour Consistency Checker",
                ref="Contours consistent with protocol / atlas guidance",
                action="Populates from the Treatment Intent target volumes & OARs "
                       "(data.intent); none are delineated yet.",
                source="gap",
            ))

        # 8. Auto-Segmentation Quality — needs auto-contour vs reference geometry.
        rows.append(Row.not_available(
            "Auto-Segmentation Quality",
            ref="Auto-contours meet acceptance (e.g. DSC vs reference)",
            action="Populates from an auto-segmentation quality report; no contour "
                   "geometry is stored in the workflow record.",
            source="gap",
        ))

        # 9. Registration Error Detection — pre-correction shift magnitude vs action level.
        vectors = [v for v in (_vector3(s) for s in shifts) if v is not None]
        iso_vals = [_num(s.get("isocenterShifts")) for s in shifts]
        iso_vals = [v for v in iso_vals if v is not None]
        mags = vectors or iso_vals
        if mags:
            vmax = max(mags)
            over_action = (action_mm is not None
                           and sum(1 for m in mags if m > action_mm))
            over_tol = (tol_mm is not None
                        and sum(1 for m in mags if m > tol_mm))
            if over_action:
                st, label = STATUS_ALERT, f"{over_action} over action"
            elif over_tol:
                st, label = STATUS_WATCH, f"{over_tol} over tolerance"
            else:
                st, label = STATUS_OK, "None detected"
            ref_txt = (f"Registration shift ≤ {_fmt(action_mm)} mm action level"
                       if action_mm is not None else
                       "Registration shifts within protocol action level")
            rows.append(Row(
                param="Registration Error Detection",
                status=st, statusLabel=label,
                finding=(f"{len(mags)} shift(s), max {_fmt(vmax)} mm"
                         + (f"; {over_action} over the action level" if over_action else "")),
                ref=ref_txt,
                action=("Large registration shift(s) over the action level — verify setup "
                        "and consider re-simulation." if over_action else
                        "Registration shift(s) above tolerance; monitor for a systematic trend."
                        if over_tol else
                        "No registration errors over the action level across recorded sessions."),
                source="derived",
            ))
        else:
            rows.append(Row.not_available(
                "Registration Error Detection",
                ref="Registration shifts within protocol action level",
                action="Populates from data.imaging.imagingShifts (X/Y/Z / isocentre shift)."))

        # 10. AI Contour Review Assistant — reviews the delineated structure set
        #     (data.intent) and names the structures whose specification needs physician
        #     attention. Specification review only; contour geometry is not stored, so no
        #     shape/outlier-geometry claim is made.
        if targets or oars:
            flags: List[str] = []
            if targets and not ss["has_ptv"]:
                flags.append("no PTV among the target volumes")
            for t in ss["targets_no_dose"]:
                nm = (_clean(t.get("volumeName")) or _clean(t.get("type")).upper()
                      or "target volume")
                flags.append(f"{nm}: no prescribed dose")
            for o in ss["oars_no_constraint"]:
                nm = _clean(o.get("organName")) or "OAR"
                flags.append(f"{nm}: no dose constraint")
            reviewed = len(targets) + len(oars)
            if flags:
                shown = flags[:3]
                more = len(flags) - len(shown)
                rows.append(Row(
                    param="AI Contour Review Assistant",
                    status=STATUS_WATCH,
                    statusLabel=f"{len(flags)} flagged",
                    finding="; ".join(shown) + (f"; +{more} more" if more > 0 else ""),
                    ref="AI reviews the delineated structure set for missing dose objectives",
                    action=(f"Physician review suggested for {len(flags)} structure"
                            f"{'s' if len(flags) != 1 else ''} with an incomplete "
                            "specification (structure-set review only; no geometry check)."),
                    source="derived",
                ))
            else:
                rows.append(Row(
                    param="AI Contour Review Assistant",
                    status=STATUS_OK,
                    statusLabel="No flags",
                    finding=(f"{reviewed} structure{'s' if reviewed != 1 else ''} reviewed; "
                             "targets carry prescribed doses and OARs carry dose constraints"),
                    ref="AI reviews the delineated structure set for missing dose objectives",
                    action="No incomplete specifications in the delineated structure set "
                           "(structure-set review only; contour geometry is not stored).",
                    source="derived",
                ))
        else:
            rows.append(Row.not_available(
                "AI Contour Review Assistant",
                ref="AI flags outlier contours for physician review",
                action="Populates from the Treatment Intent target volumes & OARs "
                       "(data.intent); none are delineated yet.",
                source="gap",
            ))

        # 11. Physics Checklist Automation — roll-up of the recorded physics QA flags.
        checklist = [
            ("Plan verification", "planVerificationCompleted"),
            ("MU calculation", "muCalculationVerified"),
            ("Dose distribution review", "doseDistributionReviewed"),
            ("DVH constraints", "dvhConstraintsMet"),
            ("Physics approval", "physicsApprovalObtained"),
        ]
        present = [(name, key) for name, key in checklist if qa.get(key) is not None]
        if present:
            done = [name for name, key in present if _truthy(qa.get(key))]
            pending = [name for name, key in present if not _truthy(qa.get(key))]
            rows.append(Row(
                param="Physics Checklist Automation",
                status=STATUS_OK if not pending else STATUS_WATCH,
                statusLabel=f"{len(done)}/{len(present)}",
                finding=f"{len(done)} of {len(present)} physics QA checks complete",
                ref="All physics QA checklist items complete before treatment",
                action=("Physics QA checklist complete." if not pending
                        else "Pending: " + ", ".join(pending) + "."),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Physics Checklist Automation",
                ref="All physics QA checklist items complete before treatment",
                action="Populates from the data.qa verification/approval flags."))

        # 12. Treatment Safety Audit Trail — QA provenance: who / when / approvals.
        qa_by = _clean(qa.get("qaPerformedBy"))
        qa_date = _clean(qa.get("dateOfMouldRoomVisit"))
        physics_approved = _truthy(qa.get("physicsApprovalObtained"))
        physicist = next((m for m in staff_members
                          if "physic" in _clean(m.get("role")).lower()), None)
        sign_offs = [name for name, key in (
            ("RO", "roSigned"), ("MP", "mpSigned"), ("RTT", "rttSigned"))
            if _truthy(approvals.get(key))]
        trail = []
        if qa_by:
            trail.append(f"QA by {qa_by}" + (f" on {qa_date}" if qa_date else ""))
        if physicist:
            lic = _clean(physicist.get("licenseNumber"))
            trail.append(f"physicist {_clean(physicist.get('name')) or 'on record'}"
                         + (f" (lic {lic})" if lic else ""))
        if physics_approved:
            trail.append("physics approval obtained")
        if sign_offs:
            trail.append(f"sign-off: {', '.join(sign_offs)}")
        if trail:
            complete = bool((qa_by or physicist) and physics_approved)
            rows.append(Row(
                param="Treatment Safety Audit Trail",
                status=STATUS_OK if complete else STATUS_WATCH,
                statusLabel="Traceable" if complete else "Partial",
                finding="; ".join(trail),
                ref="Physics QA is attributable (performer, date, approval) and signed",
                action=("Physics QA is attributable and approved — audit trail complete."
                        if complete else
                        "Audit trail partial; confirm the QA performer and physics approval."),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Treatment Safety Audit Trail",
                ref="Physics QA is attributable (performer, date, approval) and signed",
                action="Populates from qa.qaPerformedBy / physicsApprovalObtained + staff / approvals."))

        return rows

    def build_prompt(self, ctx: Dict[str, Any], rows: List[Row]) -> Optional[str]:
        """
        Optional 1-2 sentence physics/QA narrative (prose only), stored under meta.narrative.
        Row statuses above are already final and independent of this. Skips cleanly when
        GROQ_API_KEY is unset.
        """
        qa = ctx.get("qa") or {}
        imaging = ctx.get("imaging") or {}
        treatment = ctx.get("treatment") or {}
        payload = {
            "gammaPassRate": qa.get("gammaPassRate"),
            "pointDoseMeasurement": qa.get("pointDoseMeasurement"),
            "qaFlags": {
                k: qa.get(k) for k in (
                    "planVerificationCompleted", "muCalculationVerified",
                    "doseDistributionReviewed", "dvhConstraintsMet",
                    "physicsApprovalObtained")
            },
            "imaging": {
                "verificationMethod": imaging.get("verificationMethod"),
                "actionLevelMm": imaging.get("actionLevelMm"),
                "toleranceLevelMm": imaging.get("toleranceLevelMm"),
            },
            "machine": treatment.get("treatmentMachine"),
        }
        return (
            "You are a radiation oncology physics-QA assistant. Using ONLY the JSON below, "
            "write a concise 1-2 sentence physics & quality-assurance summary. Do not invent "
            "data or recompute values; if a field is missing, omit it. Return a JSON object "
            'with a single key "physics" whose value is the sentence.\n\n'
            f"DATA:\n{json.dumps(payload, default=str)}"
        )
