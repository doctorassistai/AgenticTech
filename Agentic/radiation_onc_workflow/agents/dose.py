"""
agents/dose.py — Module 03: Dose Calculation & Cumulative Dose Intelligence.

The platform's biological-dose engine: converts the recorded prescription and OAR
doses into EQD2 / BED and checks them against QUANTEC / institutional constraints.
Every value is a deterministic calculation from the two data sources — nothing is
invented; the published constraints are reference standards shown in the "Reference /
Expected" column (which the frozen dashboard labels "Constraint (QUANTEC / Institutional)").

Sources:
  * `radiotherapy_records` → `data.treatment` (prescription entered via the "Treatment
    Plan" tab: totalDose / dosePerFraction / numFractions, in Gy — read first),
    `data.intent.organsAtRisk` (per-organ max/mean dose),
    `data.patient.previousTreatments` (prior RT for re-irradiation).
  * `rt-record-details`    → `ebrt.simulationSets` (legacy prescription in cGy → Gy,
    used as fallback), `ebrt.completion` (weights), `brachy.dosePrescription` (brachy, Gy).

The prescription is resolved by the shared `resolve_prescription()` helper (Treatment Plan
tab Gy → legacy sim set cGy → brachy Gy), so BED₁₀ / EQD2 / composite doses populate
whether the dose was entered in the new UI or the legacy record.

Frozen row mapping for Module 03 (special columns, standard renderer):
    param   → Organ / Metric
    finding → Cumulative EQD2
    ref     → Constraint (QUANTEC / Institutional)
    status/statusLabel → Status pill
    action  → Indication / Action

Only the DOSE is calculated; α/β and the QUANTEC limits are disclosed in each row.
Emits exactly the six frozen keys per row; adds nothing to the dashboard.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple

from ..data_sources import coalesce_history, resolve_delivery, resolve_prescription
from ..state import (
    Row,
    STATUS_OK,
    STATUS_WATCH,
    STATUS_ALERT,
    STATUS_NEUTRAL,
    DASH,
)
from .base import BaseAgent


# ── biological-dose helpers ──────────────────────────────────────────────────
def _num(value: Any) -> Optional[float]:
    """Parse a numeric string/number; None if not numeric."""
    try:
        return float(str(value).strip())
    except (ValueError, TypeError):
        return None


def _fmt(value: Optional[float]) -> str:
    """3-sig figure-ish clean number: 39.0 → '39', 32.53 → '32.5'."""
    if value is None:
        return DASH
    return f"{value:.0f}" if abs(value - round(value)) < 0.05 else f"{value:.1f}"


def _eqd2(total_gy: Optional[float], n_fx: Optional[float], ab: float) -> Optional[float]:
    """EQD2 = D·(d + α/β)/(2 + α/β), with d = D/n. None if inputs insufficient."""
    if not total_gy or not n_fx or n_fx <= 0:
        return None
    d = total_gy / n_fx
    return total_gy * (d + ab) / (2.0 + ab)


def _bed(total_gy: Optional[float], dose_per_fx_gy: Optional[float], ab: float) -> Optional[float]:
    """BED = D·(1 + d/(α/β)). None if inputs insufficient."""
    if total_gy is None or dose_per_fx_gy is None:
        return None
    return total_gy * (1.0 + dose_per_fx_gy / ab)


def _status_vs_limit(value: float, limit: float) -> Tuple[str, str]:
    """OAR EQD2 vs constraint → (status, label). Watch band within 10% of limit."""
    ratio = value / limit if limit else 0.0
    if ratio > 1.0:
        return STATUS_ALERT, "Over constraint"
    if ratio > 0.9:
        return STATUS_WATCH, "Near constraint"
    return STATUS_OK, "Within constraint"


# QUANTEC / institutional constraints used by the escalation + hard-threshold engines
# (published reference standards; matched to a recorded organ by substring).
_OAR_CONSTRAINTS: Dict[str, Tuple[str, float]] = {
    "spinal cord": ("max", 50.0),
    "cord": ("max", 50.0),
    "brainstem": ("max", 54.0),
    "parotid": ("mean", 26.0),
    "larynx": ("mean", 44.0),
    "mandible": ("max", 70.0),
    "oral cavity": ("mean", 40.0),
    "heart": ("mean", 26.0),
    "lung": ("mean", 20.0),
    "liver": ("mean", 30.0),
    "kidney": ("mean", 18.0),
    "bowel": ("max", 45.0),
    "bladder": ("max", 65.0),
    "rectum": ("max", 60.0),
}

# The seven frozen organ rows: (param, match-terms, metric, constraint-text, limit).
_ORGAN_ROWS: List[Tuple[str, List[str], str, str, float]] = [
    ("Spinal Cord (Dmax)", ["spinal cord", "cord"], "max", "Dmax < 50 Gy (QUANTEC)", 50.0),
    ("Brainstem (Dmax)", ["brainstem", "brain stem"], "max", "Dmax < 54 Gy (QUANTEC)", 54.0),
    ("Ipsilateral Parotid (Mean)", ["parotid"], "mean", "Mean < 26 Gy (QUANTEC)", 26.0),
    ("Contralateral Parotid (Mean)", ["parotid"], "mean", "Mean < 20 Gy (QUANTEC)", 20.0),
    ("Larynx (Mean)", ["larynx"], "mean", "Mean < 44 Gy (QUANTEC)", 44.0),
    ("Mandible (Dmax)", ["mandible"], "max", "Dmax < 70 Gy", 70.0),
    ("Oral Cavity (Mean)", ["oral cavity", "oral"], "mean", "Mean < 40 Gy", 40.0),
]


class DoseAgent(BaseAgent):
    moduleId = "m3"
    slug = "dose"
    num = "03 / 12"
    title = "Dose Calculation & Cumulative Dose Intelligence"

    async def gather_context(self, patient_id: Optional[str]) -> Dict[str, Any]:
        details_record = await self.ds.get_ebrt_record(patient_id)
        workflow_record = await self.ds.get_workflow_record(patient_id)
        data = workflow_record.get("data") or {}
        return {
            "ebrt": coalesce_history(details_record, "ebrt"),
            "brachy": coalesce_history(details_record, "brachy"),
            "common": coalesce_history(details_record, "common"),
            "intent": coalesce_history(data, "intent"),
            "patient": coalesce_history(data, "patient"),
            "treatment": coalesce_history(data, "treatment"),
            "sessions": coalesce_history(data, "sessions"),
        }

    # ── prescription (Treatment Plan tab Gy → legacy sim set cGy → brachy Gy) ──
    def _prescription(self, ctx: Dict[str, Any]) -> Dict[str, Optional[float]]:
        # The shared resolver returns Gy-normalised dose regardless of where it was
        # entered: the workflow "Treatment Plan" tab (data.treatment, Gy) is read first,
        # then the legacy EBRT simulation set (ebrt.simulationSets, cGy → Gy), then the
        # brachytherapy dose prescription (brachy.dosePrescription, already Gy).
        presc = resolve_prescription(
            ctx.get("treatment"), ctx.get("ebrt"),
            ctx.get("brachy"), (ctx.get("common") or {}).get("treatment"),
        )
        total_gy = presc["total_gy"]
        per_gy = presc["per_gy"]
        n_fx = _num(presc["n_fx"])

        # Brachytherapy course with no prescription section on record: fall back to the
        # DELIVERED brachy summary (already in Gy) so the biological-dose rows still
        # compute instead of blanking to "Not available".
        if total_gy is None:
            deliv = resolve_delivery(ctx.get("sessions"), ctx.get("treatment"))
            if deliv["modality"] == "brachy":
                total_gy = _num(deliv.get("totalDoseDeliveredGy"))
                n_fx = n_fx or _num(deliv.get("totalSessionsDelivered"))
                if per_gy is None and total_gy is not None and n_fx:
                    per_gy = total_gy / n_fx
        return {"total_gy": total_gy, "per_gy": per_gy, "n_fx": n_fx}

    def _oar_assessments(
        self, ctx: Dict[str, Any], n_fx: Optional[float]
    ) -> List[Dict[str, Any]]:
        """EQD2 (α/β=3) + constraint check for each recorded OAR that has a known limit."""
        intent = ctx.get("intent") or {}
        oars = [o for o in (intent.get("organsAtRisk") or []) if isinstance(o, dict)]
        out: List[Dict[str, Any]] = []
        for o in oars:
            name = str(o.get("organName") or "").strip()
            if not name:
                continue
            key = next((k for k in _OAR_CONSTRAINTS if k in name.lower()), None)
            if key is None:
                continue
            metric, limit = _OAR_CONSTRAINTS[key]
            dose = _num(o.get("maxDoseGy") if metric == "max" else o.get("meanDoseGy"))
            if dose is None:
                dose = _num(o.get("meanDoseGy") or o.get("maxDoseGy"))
            if dose is None:
                continue
            eqd2 = _eqd2(dose, n_fx, 3.0)
            compare = eqd2 if eqd2 is not None else dose
            status, _ = _status_vs_limit(compare, limit)
            out.append({
                "name": name, "metric": metric, "dose": dose, "eqd2": eqd2,
                "limit": limit, "compare": compare, "status": status,
                "over": compare > limit,
            })
        return out

    def build_rows(self, ctx: Dict[str, Any]) -> List[Row]:
        presc = self._prescription(ctx)
        total_gy, per_gy, n_fx = presc["total_gy"], presc["per_gy"], presc["n_fx"]
        intent = ctx.get("intent") or {}
        recorded_oars = [o for o in (intent.get("organsAtRisk") or []) if isinstance(o, dict)]
        oar_assess = self._oar_assessments(ctx, n_fx)

        rows: List[Row] = []

        # 1-7. Frozen organ rows — EQD2 if the record contains that organ, else Not available.
        used_parotid = False
        for param, terms, metric, constraint, limit in _ORGAN_ROWS:
            match = None
            for o in recorded_oars:
                name = str(o.get("organName") or "").lower()
                if not name:
                    continue
                if not any(t in name for t in terms):
                    continue
                # Parotid laterality: send a plain "parotid" to the ipsilateral row only.
                if terms == ["parotid"]:
                    is_contra = "contra" in name
                    if param.startswith("Contralateral") and not is_contra:
                        continue
                    if param.startswith("Ipsilateral") and is_contra:
                        continue
                match = o
                break

            if match is None:
                rows.append(Row.not_available(
                    param, ref=constraint,
                    action="Populates when this organ is contoured with a recorded dose.",
                    source="gap"))
                continue

            dose = _num(match.get("maxDoseGy") if metric == "max" else match.get("meanDoseGy"))
            if dose is None:
                rows.append(Row.not_available(
                    param, ref=constraint,
                    action=f"{metric.title()} dose not recorded for this organ.",
                    source="gap"))
                continue
            eqd2 = _eqd2(dose, n_fx, 3.0)
            compare = eqd2 if eqd2 is not None else dose
            status, label = _status_vs_limit(compare, limit)
            eqd2_txt = (f"{_fmt(eqd2)} Gy EQD2" if eqd2 is not None
                        else f"{_fmt(dose)} Gy {metric}")
            rows.append(Row(
                param=param, status=status, statusLabel=label,
                finding=f"{eqd2_txt} (from {_fmt(dose)} Gy {metric})",
                ref=constraint,
                action=(f"α/β 3, {int(n_fx)}-fx basis. "
                        f"{'Exceeds' if compare > limit else 'Within'} constraint "
                        f"({_fmt(compare)} vs {_fmt(limit)} Gy)."
                        if n_fx else
                        f"Physical {metric} dose {_fmt(dose)} Gy; EQD2 needs fractionation."),
                source="db",
            ))

        # 8. Fractionation Conversion (BED₁₀) — prescription in biological units.
        bed10 = _bed(total_gy, per_gy, 10.0)
        eqd2_10 = _eqd2(total_gy, n_fx, 10.0)
        if bed10 is not None or eqd2_10 is not None:
            rows.append(Row(
                param="Fractionation Conversion (BED₁₀)",
                status=STATUS_OK, statusLabel="Converted",
                finding=(f"BED₁₀ {_fmt(bed10)} Gy"
                         + (f" · EQD2₁₀ {_fmt(eqd2_10)} Gy" if eqd2_10 is not None else "")),
                ref="Tumor α/β = 10",
                action=(f"From {_fmt(total_gy)} Gy / {int(n_fx)} fx"
                        f" ({_fmt(per_gy)} Gy/fx)." if n_fx else
                        f"From {_fmt(total_gy)} Gy prescription."),
                source="derived",
            ))
        else:
            rows.append(Row.not_available(
                "Fractionation Conversion (BED₁₀)", ref="Tumor α/β = 10",
                action="Populates from ebrt.simulationSets dose/fractionation."))

        # 9. Re-irradiation Assessment — prior RT courses from patient history.
        patient = ctx.get("patient") or {}
        prev = [t for t in (patient.get("previousTreatments") or []) if isinstance(t, dict)]
        prior_rt = [t for t in prev if any(
            k in str(t.get("treatmentType", "")).lower()
            for k in ("radiat", "radio", "brachy", "ebrt", "radiotherapy"))]
        if prior_rt:
            rows.append(Row(
                param="Re-irradiation Assessment",
                status=STATUS_ALERT, statusLabel="Re-irradiation",
                finding=f"{len(prior_rt)} prior RT course(s) on record",
                ref="No overlapping prior RT dose",
                action="Prior radiotherapy present — assess field overlap and cumulative "
                       "OAR EQD2 before prescribing.",
                source="db",
            ))
        else:
            rows.append(Row(
                param="Re-irradiation Assessment",
                status=STATUS_OK, statusLabel="First course",
                finding="No prior radiotherapy on record",
                ref="No overlapping prior RT dose",
                action="Not a re-irradiation case; single-course dose applies.",
                source="db",
            ))

        # 10. Dose Escalation Safety — OAR headroom vs constraints.
        if oar_assess:
            tightest = max(oar_assess, key=lambda a: a["compare"] / a["limit"])
            over_any = any(a["over"] for a in oar_assess)
            ratio = tightest["compare"] / tightest["limit"]
            st = (STATUS_ALERT if over_any else
                  STATUS_WATCH if ratio > 0.9 else STATUS_OK)
            rows.append(Row(
                param="Dose Escalation Safety",
                status=st,
                statusLabel="No headroom" if over_any else
                            ("Limited" if ratio > 0.9 else "Headroom"),
                finding=(f"Tightest: {tightest['name']} "
                         f"{_fmt(tightest['compare'])} / {_fmt(tightest['limit'])} Gy "
                         f"({ratio * 100:.0f}% of limit)"),
                ref="All OARs below constraint to escalate",
                action=("Escalation not advised — an OAR is at/over tolerance."
                        if over_any else
                        "Escalation possible within OAR tolerance; re-check after re-plan."),
                source="derived",
            ))
        else:
            rows.append(Row.not_available(
                "Dose Escalation Safety", ref="Requires OAR dose vs constraints",
                action="Populates from intent.organsAtRisk with known constraints."))

        # 11. Multi-course Aggregation — number of RT courses to aggregate.
        course_count = 1 + len(prior_rt)
        rows.append(Row(
            param="Multi-course Aggregation",
            status=STATUS_WATCH if course_count > 1 else STATUS_OK,
            statusLabel=f"{course_count} course{'s' if course_count != 1 else ''}",
            finding=(f"{course_count} radiotherapy courses to aggregate"
                     if course_count > 1 else "Single radiotherapy course on record"),
            ref="Cumulative dose aggregated across all courses",
            action=("Aggregate cumulative OAR EQD2 across courses before prescribing."
                    if course_count > 1 else
                    "No aggregation required for a single course."),
            source="derived",
        ))

        # 12. Prior External Records Import — external dose-history integration.
        rows.append(Row.not_available(
            "Prior External Records Import",
            ref="Requires external dose-record link",
            action="Enables when prior external RT records can be imported.",
            source="request",
        ))

        # 13. Composite Dose Assessment — composite plan across courses.
        if total_gy is not None and course_count == 1:
            rows.append(Row(
                param="Composite Dose Assessment",
                status=STATUS_OK, statusLabel="Single-course",
                finding=(f"Composite = current course: {_fmt(total_gy)} Gy"
                         + (f" · BED₁₀ {_fmt(bed10)} Gy" if bed10 is not None else "")),
                ref="Composite dose within cumulative limits",
                action="Composite equals the current course; no prior dose to sum.",
                source="derived",
            ))
        elif total_gy is not None:
            rows.append(Row(
                param="Composite Dose Assessment",
                status=STATUS_WATCH, statusLabel="Multi-course",
                finding=f"{course_count} courses — composite requires prior-course dose maps",
                ref="Composite dose within cumulative limits",
                action="Sum current + prior course EQD2 per OAR once prior doses are linked.",
                source="derived",
            ))
        else:
            rows.append(Row.not_available(
                "Composite Dose Assessment", ref="Composite dose within cumulative limits",
                action="Populates from the recorded prescription."))

        # 14. Biological Dose Comparison — physical vs biological for the prescription.
        if total_gy is not None and (bed10 is not None or eqd2_10 is not None):
            rows.append(Row(
                param="Biological Dose Comparison",
                status=STATUS_OK, statusLabel="Compared",
                finding=(f"Physical {_fmt(total_gy)} Gy · "
                         f"EQD2₁₀ {_fmt(eqd2_10)} Gy · BED₁₀ {_fmt(bed10)} Gy"),
                ref="Physical vs biological (α/β = 10)",
                action="Biological dose exceeds physical for >2 Gy/fx; compare against "
                       "protocol biological targets.",
                source="derived",
            ))
        else:
            rows.append(Row.not_available(
                "Biological Dose Comparison", ref="Physical vs biological (α/β = 10)",
                action="Populates from the recorded prescription."))

        # 15. Hard Safety Threshold Engine — absolute-limit check across recorded OARs.
        if oar_assess:
            breaches = [a for a in oar_assess if a["over"]]
            if breaches:
                worst = max(breaches, key=lambda a: a["compare"] / a["limit"])
                rows.append(Row(
                    param="Hard Safety Threshold Engine",
                    status=STATUS_ALERT, statusLabel="Threshold breach",
                    finding=(f"{len(breaches)} OAR over hard limit — "
                             f"{worst['name']} {_fmt(worst['compare'])} Gy "
                             f"(limit {_fmt(worst['limit'])} Gy)"),
                    ref="No OAR over absolute tolerance",
                    action="Hard limit exceeded — mandatory plan review before delivery.",
                    source="derived",
                ))
            else:
                rows.append(Row(
                    param="Hard Safety Threshold Engine",
                    status=STATUS_OK, statusLabel="Clear",
                    finding=f"{len(oar_assess)} OAR(s) within absolute tolerance",
                    ref="No OAR over absolute tolerance",
                    action="All checked OARs are below hard limits.",
                    source="derived",
                ))
        else:
            rows.append(Row.not_available(
                "Hard Safety Threshold Engine", ref="No OAR over absolute tolerance",
                action="Populates from intent.organsAtRisk with known constraints."))

        return rows

    def build_prompt(self, ctx: Dict[str, Any], rows: List[Row]) -> Optional[str]:
        """
        Optional 1-2 sentence cumulative-dose narrative (prose only), stored under
        meta.narrative. All EQD2/BED values and statuses above are already final and
        independent of this. Skips cleanly when GROQ_API_KEY is unset.
        """
        presc = self._prescription(ctx)
        intent = ctx.get("intent") or {}
        payload = {
            "prescriptionGy": presc["total_gy"],
            "fractions": presc["n_fx"],
            "dosePerFractionGy": presc["per_gy"],
            "organsAtRisk": intent.get("organsAtRisk"),
        }
        return (
            "You are a radiation oncology dosimetry assistant. Using ONLY the JSON below, "
            "write a concise 1-2 sentence cumulative-dose summary. Do not invent data or "
            "recompute values; if a field is missing, omit it. Return a JSON object with a "
            'single key "dose" whose value is the sentence.\n\n'
            f"DATA:\n{json.dumps(payload, default=str)}"
        )
