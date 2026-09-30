"""
agents/gaps.py — Module 06: Treatment Gap & Schedule Optimization.

Detects treatment interruptions, quantifies their biological cost, and recommends how
to compensate. Gap detection is derived deterministically from the recorded fraction
dates; the biological-cost rows use PUBLISHED radiobiology constants (accelerated
repopulation), disclosed in each row exactly the way Module 03 discloses QUANTEC limits.
Nothing patient-specific is invented — every figure is either measured from the record
or an estimate explicitly labelled with the standard constant it assumes.

Works for ANY patient: each row derives when its inputs are present, degrades to a
neutral "no gap / not required" state when the course is uninterrupted, and reports
"Not available" when the underlying dates/schedule are missing.

Sources:
  * `radiotherapy_records` → `data.sessions` (treatmentSessions[].date — the delivered
    fraction calendar; totalSessionsDelivered), `data.summary` (fractionsCompleted,
    treatmentOutcome, reasonForModificationIfApplicable, endOfTreatmentSummary),
    `data.intent` (treatmentIntent — gap sensitivity).
  * `rt-record-details` → `ebrt.simulationSets` (totalFractions, dosePerFrac, fracSched,
    startDate, endDate — the planned schedule).

Frozen row mapping for Module 06 (standard renderer):
    param   → Parameter
    finding → Current Finding
    ref     → Reference / Expected
    status/statusLabel → Status pill
    action  → Indication / Action

Emits exactly the six frozen keys per row; adds nothing to the dashboard.
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

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


# ── published radiobiology constants (disclosed in each row that uses them) ───
# Accelerated repopulation for squamous-type tumours; verify per tumour histology.
_D_PROLIF_GY_PER_DAY = 0.6   # dose "wasted" per day of prolongation offsetting repopulation
_KICKOFF_DAYS = 28           # Tk: accelerated repopulation onset from treatment start
_TCP_LOSS_PCT_PER_DAY = 0.7  # ~0.5–1.4%/day local-control loss per day of prolongation


# ── helpers ──────────────────────────────────────────────────────────────────
def _clean(value: Any) -> str:
    text = str(value).strip() if value is not None else ""
    return "" if text.lower() in ("", "none", "null") else text


def _num(value: Any) -> Optional[float]:
    try:
        return float(str(value).strip())
    except (ValueError, TypeError):
        return None


def _fmt(value: Optional[float]) -> str:
    if value is None:
        return DASH
    return f"{value:.0f}" if abs(value - round(value)) < 0.05 else f"{value:.1f}"


def _parse_date(value: Any) -> Optional[date]:
    text = _clean(value)
    if not text:
        return None
    try:
        return date.fromisoformat(text.split("T")[0])
    except ValueError:
        return None


def _missed_weekdays(d1: date, d2: date) -> int:
    """Treatment weekdays skipped strictly between two delivered fractions (Mon–Fri)."""
    days = (d2 - d1).days
    if days <= 1:
        return 0
    return sum(1 for i in range(1, days) if (d1 + timedelta(days=i)).weekday() < 5)


def _is_daily(frac_sched: str) -> bool:
    """Daily (or unspecified) EBRT schedule — the case weekday-gap logic applies to."""
    s = frac_sched.lower()
    return s == "" or "dail" in s or "5" in s or "qd" in s


class GapsAgent(BaseAgent):
    moduleId = "m6"
    slug = "gaps"
    num = "06 / 12"
    title = "Treatment Gap & Schedule Optimization"

    async def gather_context(self, patient_id: Optional[str]) -> Dict[str, Any]:
        details_record = await self.ds.get_ebrt_record(patient_id)
        workflow_record = await self.ds.get_workflow_record(patient_id)
        data = workflow_record.get("data") or {}
        return {
            "ebrt": coalesce_history(details_record, "ebrt"),
            "sessions": coalesce_history(data, "sessions"),
            "summary": coalesce_history(data, "summary"),
            "intent": coalesce_history(data, "intent"),
            "treatment": coalesce_history(data, "treatment"),
        }

    # ── gap model shared across rows ─────────────────────────────────────────
    def _gap_model(self, ctx: Dict[str, Any]) -> Dict[str, Any]:
        ebrt = ctx.get("ebrt") or {}
        sessions_stage = ctx.get("sessions") or {}
        treatment = ctx.get("treatment") or {}
        sim_sets = ebrt.get("simulationSets") or []
        sim = sim_sets[0] if sim_sets else {}

        deliv = resolve_delivery(sessions_stage, treatment)
        sessions = deliv.get("treatmentSessions") or []
        frac_sched = _clean(sim.get("fracSched"))
        dates = sorted(d for d in (_parse_date(s.get("date")) for s in sessions) if d)

        total_missed = 0
        max_gap = 0
        if dates and _is_daily(frac_sched):
            for i in range(len(dates) - 1):
                m = _missed_weekdays(dates[i], dates[i + 1])
                total_missed += m
                max_gap = max(max_gap, m)

        # Brachytherapy has no per-fraction calendar; derive the gap from the recorded
        # interruption spans and the overall start→end span instead of fraction dates.
        interruptions = deliv.get("interruptions") or []
        start = _parse_date(deliv.get("startDate"))
        end = _parse_date(deliv.get("endDate"))
        if not dates and interruptions:
            for it in interruptions:
                a, b = _parse_date(it.get("startDate")), _parse_date(it.get("endDate"))
                if a and b and b >= a:
                    m = _missed_weekdays(a - timedelta(days=1), b + timedelta(days=1))
                    total_missed += m
                    max_gap = max(max_gap, m)

        # Planned fractionation / dose-per-fraction, unit-correct across the new Treatment
        # Plan tab (Gy) and the legacy sim set (cGy → Gy), via the shared resolver.
        presc = resolve_prescription(treatment, ebrt)
        planned_fx = _num(presc["n_fx"])
        per_gy = presc["per_gy"]
        if dates:
            ott_days = (dates[-1] - dates[0]).days + 1
        elif start and end and end >= start:
            ott_days = (end - start).days + 1
        else:
            ott_days = None

        sess_delivered = _num(deliv.get("totalSessionsDelivered"))
        delivered_n = (len(dates) if dates
                       else int(sess_delivered) if sess_delivered is not None else None)

        return {
            "modality": deliv.get("modality"),
            "sessions": sessions,
            "dates": dates,
            "start": start,
            "end": end,
            "interruptions": interruptions,
            "frac_sched": frac_sched,
            "daily": _is_daily(frac_sched),
            "total_missed": total_missed,
            "max_gap": max_gap,
            "has_gap": total_missed > 0,
            "has_schedule": bool(dates or ott_days or interruptions),
            "planned_fx": planned_fx,
            "per_gy": per_gy,
            "ott_days": ott_days,
            "delivered_n": delivered_n,
        }

    def build_rows(self, ctx: Dict[str, Any]) -> List[Row]:
        ebrt = ctx.get("ebrt") or {}
        summary = ctx.get("summary") or {}
        intent = ctx.get("intent") or {}
        sim_sets = ebrt.get("simulationSets") or []
        sim = sim_sets[0] if sim_sets else {}

        gm = self._gap_model(ctx)
        dates = gm["dates"]
        gap_days = gm["total_missed"]
        has_gap = gm["has_gap"]
        planned_fx = gm["planned_fx"]
        per_gy = gm["per_gy"]

        treatment_intent = _clean(intent.get("treatmentIntent")).lower()
        # Palliative courses are far less repopulation-sensitive than radical ones.
        gap_sensitive = treatment_intent not in ("palliative", "palliation")

        rows: List[Row] = []

        # 1. Treatment Gap Detected — missed treatment weekdays between fractions (EBRT)
        #    or across recorded interruption spans (brachytherapy).
        span_txt = (f"{dates[0].isoformat()} → {dates[-1].isoformat()}" if dates
                    else f"{gm['start'].isoformat()} → {gm['end'].isoformat()}"
                    if gm["start"] and gm["end"] else "")
        if dates:
            units_txt = f"{len(dates)} fractions"
        elif gm["interruptions"]:
            units_txt = f"{len(gm['interruptions'])} recorded interruption(s)"
        else:
            units_txt = "the recorded course"

        if not gm["has_schedule"]:
            rows.append(Row.not_available(
                "Treatment Gap Detected", ref="No unplanned interruption in the course",
                action="Populates from data.sessions fraction dates or interruptions."))
        elif dates and not gm["daily"]:
            rows.append(Row(
                param="Treatment Gap Detected",
                status=STATUS_NEUTRAL, statusLabel="N/A schedule",
                finding=f"Non-daily schedule ({gm['frac_sched']}); weekday-gap rule not applied",
                ref="No unplanned interruption in the course",
                action="Gap detection assumes a daily schedule; review this course manually.",
                source="derived",
            ))
        elif has_gap:
            st = STATUS_ALERT if gap_days >= 3 else STATUS_WATCH
            rows.append(Row(
                param="Treatment Gap Detected",
                status=st, statusLabel=f"{gap_days}-day gap",
                finding=(f"{gap_days} missed treatment day(s) across {units_txt}"
                         + (f" ({span_txt})" if span_txt else "")),
                ref="No unplanned interruption in the course",
                action=("Significant interruption — quantify biological cost and compensate."
                        if gap_days >= 3 else
                        "Minor interruption detected; assess need for compensation."),
                source="derived",
            ))
        else:
            rows.append(Row(
                param="Treatment Gap Detected",
                status=STATUS_OK, statusLabel="No gap",
                finding=(f"{units_txt} delivered without an unplanned gap" if dates
                         else "No treatment interruptions recorded"),
                ref="No unplanned interruption in the course",
                action="Course delivered on schedule; no gap to compensate.",
                source="derived",
            ))

        # 2. Gap Compensation Calculator — treatment days needed to recover.
        if not gm["has_schedule"]:
            rows.append(Row.not_available(
                "Gap Compensation Calculator", ref="Lost treatment days recovered",
                action="Populates from fraction dates/interruptions and planned fraction count."))
        elif has_gap:
            rows.append(Row(
                param="Gap Compensation Calculator",
                status=STATUS_WATCH, statusLabel=f"+{gap_days} day(s)",
                finding=(f"{gap_days} treatment day(s) to recover"
                         + (f" toward {int(planned_fx)} planned fractions"
                            if planned_fx else "")),
                ref="Lost treatment days recovered (extra/weekend fractions)",
                action="Recover the gap by adding fractions or treating on non-scheduled "
                       "days to preserve overall treatment time.",
                source="derived",
            ))
        else:
            rows.append(Row(
                param="Gap Compensation Calculator",
                status=STATUS_OK, statusLabel="None required",
                finding="No lost treatment days to recover",
                ref="Lost treatment days recovered",
                action="No compensation required; course is on schedule.",
                source="derived",
            ))

        # 3. BED Compensation Estimate — dose offsetting repopulation over the gap.
        ref3 = f"Repopulation offset ≈ {_D_PROLIF_GY_PER_DAY} Gy/day (squamous; verify histology)"
        if not gm["has_schedule"]:
            rows.append(Row.not_available(
                "BED Compensation Estimate", ref=ref3,
                action="Populates once fraction dates/interruptions and dose/fraction are recorded."))
        elif has_gap and gap_sensitive:
            lost_gy = _D_PROLIF_GY_PER_DAY * gap_days
            extra_fx = (lost_gy / per_gy) if per_gy else None
            rows.append(Row(
                param="BED Compensation Estimate",
                status=STATUS_WATCH, statusLabel=f"≈{_fmt(lost_gy)} Gy",
                finding=(f"≈ {_fmt(lost_gy)} Gy effective dose lost to repopulation over "
                         f"{gap_days} day(s)"
                         + (f" (≈ {_fmt(extra_fx)} extra fraction(s) at "
                            f"{_fmt(per_gy)} Gy/fx)" if extra_fx else "")),
                ref=ref3,
                action="Estimated compensating dose to offset repopulation; confirm with the "
                       "tumour-specific α/β and Dprolif before altering the prescription.",
                source="derived",
            ))
        elif has_gap:
            rows.append(Row(
                param="BED Compensation Estimate",
                status=STATUS_OK, statusLabel="Low sensitivity",
                finding=f"{gap_days}-day gap; {treatment_intent or 'this'} intent is "
                        "low repopulation-sensitivity",
                ref=ref3,
                action="Repopulation impact is limited for this intent; compensation optional.",
                source="derived",
            ))
        else:
            rows.append(Row(
                param="BED Compensation Estimate",
                status=STATUS_OK, statusLabel="No loss",
                finding="No gap — no dose lost to repopulation",
                ref=ref3,
                action="No compensating dose required.",
                source="derived",
            ))

        # 4. Weekend / Holiday Optimizer — schedule shape and make-up options.
        frac_sched = gm["frac_sched"]
        start = _clean(sim.get("startDate")) or (gm["start"].isoformat() if gm["start"] else "")
        end = _clean(sim.get("endDate")) or (gm["end"].isoformat() if gm["end"] else "")
        if frac_sched or (start and end):
            rows.append(Row(
                param="Weekend / Holiday Optimizer",
                status=STATUS_WATCH if has_gap else STATUS_OK,
                statusLabel="Make-up option" if has_gap else "Optimized",
                finding=(f"{frac_sched or 'Scheduled'} schedule"
                         + (f", {start} → {end}" if start and end else "")),
                ref="Overall treatment time minimized around non-treatment days",
                action=("Consider a weekend/holiday make-up fraction to absorb the gap "
                        "without extending overall treatment time."
                        if has_gap else
                        "Schedule on track; weekends/holidays already accounted for."),
                source="db" if (start and end) else "derived",
            ))
        else:
            rows.append(Row.not_available(
                "Weekend / Holiday Optimizer", ref="Overall treatment time minimized",
                action="Populates from ebrt.simulationSets schedule (fracSched/start/end)."))

        # 5. Interrupted Treatment Risk — risk category from gap length + intent.
        if not gm["has_schedule"]:
            rows.append(Row.not_available(
                "Interrupted Treatment Risk", ref="Interruption risk within acceptable bounds",
                action="Populates from fraction dates/interruptions and treatment intent."))
        elif not has_gap:
            rows.append(Row(
                param="Interrupted Treatment Risk",
                status=STATUS_OK, statusLabel="Low",
                finding="No interruption — baseline risk",
                ref="Interruption risk within acceptable bounds",
                action="No interruption-related risk to manage.",
                source="derived",
            ))
        else:
            high = gap_sensitive and gap_days >= 3
            rows.append(Row(
                param="Interrupted Treatment Risk",
                status=STATUS_ALERT if high else STATUS_WATCH,
                statusLabel="High" if high else "Moderate",
                finding=(f"{gap_days}-day gap, "
                         f"{treatment_intent or 'unspecified'} intent"),
                ref="Interruption risk within acceptable bounds",
                action=("Gap-sensitive tumour with a material interruption — prioritise "
                        "compensation." if high else
                        "Interruption noted; weigh compensation against toxicity."),
                source="derived",
            ))

        # 6. Tumor Repopulation Analysis — elapsed time vs accelerated-repopulation onset.
        ref6 = f"Accelerated repopulation onset ≈ day {_KICKOFF_DAYS} (Tk)"
        ott = gm["ott_days"]
        if ott is None:
            rows.append(Row.not_available(
                "Tumor Repopulation Analysis", ref=ref6,
                action="Populates from the delivered-fraction date span."))
        else:
            past_kickoff = ott > _KICKOFF_DAYS
            rows.append(Row(
                param="Tumor Repopulation Analysis",
                status=STATUS_WATCH if (past_kickoff and gap_sensitive) else STATUS_OK,
                statusLabel="Repopulating" if (past_kickoff and gap_sensitive) else "Pre-onset",
                finding=(f"{ott}-day elapsed treatment time "
                         f"({'past' if past_kickoff else 'before'} the ~{_KICKOFF_DAYS}-day onset)"),
                ref=ref6,
                action=("Beyond the accelerated-repopulation onset — each added day carries a "
                        "repopulation cost; avoid further prolongation."
                        if (past_kickoff and gap_sensitive) else
                        "Within the pre-repopulation window; prolongation cost currently low."),
                source="derived",
            ))

        # 7. Fraction Rescheduling — remaining fractions vs delivered.
        delivered = gm["delivered_n"]
        if delivered is not None and planned_fx:
            remaining = max(0, int(planned_fx) - delivered)
            rows.append(Row(
                param="Fraction Rescheduling",
                status=STATUS_WATCH if (has_gap and remaining) else STATUS_OK,
                statusLabel=(f"{remaining} remaining" if remaining else "Complete"),
                finding=(f"{delivered} of {int(planned_fx)} fractions delivered, "
                         f"{remaining} remaining"),
                ref="Remaining fractions scheduled to complete on time",
                action=("Reschedule remaining fractions (incl. make-up days) to recover the gap."
                        if (has_gap and remaining) else
                        "Complete the remaining scheduled fractions." if remaining else
                        "All planned fractions delivered."),
                source="derived",
            ))
        else:
            rows.append(Row.not_available(
                "Fraction Rescheduling", ref="Remaining fractions scheduled to complete on time",
                action="Populates from delivered fractions vs planned fraction count."))

        # 8. Predicted Local Control Impact — TCP loss from prolongation.
        ref8 = f"Local control loss ≈ {_TCP_LOSS_PCT_PER_DAY}%/day of prolongation (H&N est.)"
        if not gm["has_schedule"]:
            rows.append(Row.not_available(
                "Predicted Local Control Impact", ref=ref8,
                action="Populates from the gap length and treatment intent."))
        elif has_gap and gap_sensitive:
            loss = _TCP_LOSS_PCT_PER_DAY * gap_days
            rows.append(Row(
                param="Predicted Local Control Impact",
                status=STATUS_ALERT if loss >= 2 else STATUS_WATCH,
                statusLabel=f"≈-{_fmt(loss)}%",
                finding=f"≈ {_fmt(loss)}% estimated local-control loss over {gap_days} gap day(s)",
                ref=ref8,
                action="Estimated impact if the gap is not compensated; a published rate, "
                       "not a patient-specific prediction — confirm before counselling.",
                source="derived",
            ))
        else:
            rows.append(Row(
                param="Predicted Local Control Impact",
                status=STATUS_OK, statusLabel="Negligible",
                finding=("No gap — no predicted control loss" if not has_gap else
                         f"{treatment_intent or 'This'} intent — limited control impact"),
                ref=ref8,
                action="No material local-control impact predicted from scheduling.",
                source="derived",
            ))

        # 9. Protocol Compliance Tracker — actual overall treatment time vs planned.
        planned_days = None
        pd_start, pd_end = _parse_date(sim.get("startDate")), _parse_date(sim.get("endDate"))
        if pd_start and pd_end:
            planned_days = (pd_end - pd_start).days + 1
        if ott is not None:
            if planned_days:
                over = ott - planned_days
                compliant = over <= 2  # small tolerance for start-date offset
                rows.append(Row(
                    param="Protocol Compliance Tracker",
                    status=STATUS_OK if compliant else STATUS_WATCH,
                    statusLabel="Compliant" if compliant else f"+{over} day(s)",
                    finding=f"{ott}-day actual vs {planned_days}-day planned treatment time",
                    ref="Overall treatment time within protocol window",
                    action=("Overall treatment time within the planned window."
                            if compliant else
                            "Overall treatment time exceeds plan; document the deviation."),
                    source="derived",
                ))
            else:
                rows.append(Row(
                    param="Protocol Compliance Tracker",
                    status=STATUS_WATCH if has_gap else STATUS_OK,
                    statusLabel="Gap present" if has_gap else "On track",
                    finding=f"{ott}-day actual treatment time"
                            + (f", {gap_days} missed day(s)" if has_gap else ""),
                    ref="Overall treatment time within protocol window",
                    action=("Interruption extends treatment time; document and compensate."
                            if has_gap else
                            "No interruption; overall treatment time on track."),
                    source="derived",
                ))
        else:
            rows.append(Row.not_available(
                "Protocol Compliance Tracker", ref="Overall treatment time within protocol window",
                action="Populates from delivered-fraction dates (and planned start/end)."))

        # 10. Gap Decision Documentation — is any interruption/modification documented?
        reason = _clean(summary.get("reasonForModificationIfApplicable"))
        outcome = _clean(summary.get("treatmentOutcome")).lower()
        eot = _clean(summary.get("endOfTreatmentSummary"))
        documented = bool(reason) or bool(eot) or outcome == "modified"
        if not has_gap:
            rows.append(Row(
                param="Gap Decision Documentation",
                status=STATUS_OK, statusLabel="Not required",
                finding="No gap requiring a documented decision",
                ref="Any interruption & compensation decision documented",
                action="No gap decision to document.",
                source="derived",
            ))
        elif documented:
            note = reason or eot or "treatment recorded as modified"
            rows.append(Row(
                param="Gap Decision Documentation",
                status=STATUS_OK, statusLabel="Documented",
                finding=f"Interruption/modification documented: {note}",
                ref="Any interruption & compensation decision documented",
                action="Gap decision is documented in the treatment summary.",
                source="db",
            ))
        else:
            rows.append(Row(
                param="Gap Decision Documentation",
                status=STATUS_ALERT, statusLabel="Undocumented",
                finding=f"{gap_days}-day gap with no documented decision",
                ref="Any interruption & compensation decision documented",
                action="Document the interruption and the compensation decision in the record.",
                source="derived",
            ))

        return rows

    def build_prompt(self, ctx: Dict[str, Any], rows: List[Row]) -> Optional[str]:
        """
        Optional 1-2 sentence gap/schedule narrative (prose only), stored under
        meta.narrative. Row statuses above are already final and independent of this.
        Skips cleanly when GROQ_API_KEY is unset.
        """
        gm = self._gap_model(ctx)
        intent = ctx.get("intent") or {}
        payload = {
            "fractionsDelivered": gm["delivered_n"],
            "plannedFractions": gm["planned_fx"],
            "missedTreatmentDays": gm["total_missed"],
            "overallTreatmentTimeDays": gm["ott_days"],
            "fractionSchedule": gm["frac_sched"],
            "treatmentIntent": intent.get("treatmentIntent"),
        }
        return (
            "You are a radiation oncology scheduling assistant. Using ONLY the JSON below, "
            "write a concise 1-2 sentence treatment-gap summary. Do not invent data or "
            "recompute values; if a field is missing, omit it. Return a JSON object with a "
            'single key "gaps" whose value is the sentence.\n\n'
            f"DATA:\n{json.dumps(payload, default=str)}"
        )
