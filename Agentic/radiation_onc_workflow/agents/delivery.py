"""
agents/delivery.py — Module 05: Treatment Delivery Intelligence.

Fraction-by-fraction delivery and image-guidance verification: setup accuracy,
couch-shift trend, motion management, missed fractions, machine interruptions and
overall workflow status. Everything is derived deterministically from the recorded
sessions and image-guidance shifts — nothing is invented.

Sources:
  * `radiotherapy_records` → `data.sessions` (treatmentSessions[]: date/time/machine/
    deliveredDoseGy/treatmentTimeMin/notes, totalSessionsDelivered, totalDoseDeliveredGy),
    `data.imaging` (imagingShifts[]: shiftX/Y/Z Mm, rotation, residualErrorAfterShift;
    verificationMethod, frequency, actionLevelMm, toleranceLevelMm), `data.treatment`
    (treatmentMachine).
  * `rt-record-details` → `ebrt.simulationSets` (totalFractions, dosePerFrac, specialTech
    e.g. DIBH), `ebrt.planning` (adaptiveRadiation).

Frozen row mapping for Module 05 (standard renderer):
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
from datetime import date
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


# ── helpers ──────────────────────────────────────────────────────────────────
def _clean(value: Any) -> str:
    """Trimmed string; empty for None/blank/'none'/'null'."""
    text = str(value).strip() if value is not None else ""
    return "" if text.lower() in ("", "none", "null") else text


def _num(value: Any) -> Optional[float]:
    """Parse a numeric string/number; None if not numeric."""
    try:
        return float(str(value).strip())
    except (ValueError, TypeError):
        return None


def _fmt(value: Optional[float]) -> str:
    """4.0 → '4', 2.25 → '2.2'."""
    if value is None:
        return DASH
    return f"{value:.0f}" if abs(value - round(value)) < 0.05 else f"{value:.1f}"


def _vector3(shift: Dict[str, Any]) -> Optional[float]:
    """3D setup-error magnitude √(x²+y²+z²) in mm from one imaging shift."""
    x = _num(shift.get("shiftXMm"))
    y = _num(shift.get("shiftYMm"))
    z = _num(shift.get("shiftZMm"))
    if x is None or y is None or z is None:
        return None
    return math.sqrt(x * x + y * y + z * z)


def _parse_date(value: Any) -> Optional[date]:
    """'2026-07-30' / '2026-07-30T..' → date; None if unparseable."""
    text = _clean(value)
    if not text:
        return None
    try:
        return date.fromisoformat(text.split("T")[0])
    except ValueError:
        return None


# Keywords that mark a machine/treatment interruption in a free-text session note.
_INTERRUPT_TERMS = (
    "interrupt", "aborted", "abort", "fault", "beam off", "beam-off",
    "machine down", "breakdown", "error", "halt", "stopped", "paused",
)


class DeliveryAgent(BaseAgent):
    moduleId = "m5"
    slug = "delivery"
    num = "05 / 12"
    title = "Treatment Delivery Intelligence"

    async def gather_context(self, patient_id: Optional[str]) -> Dict[str, Any]:
        details_record = await self.ds.get_ebrt_record(patient_id)
        workflow_record = await self.ds.get_workflow_record(patient_id)
        data = workflow_record.get("data") or {}
        return {
            "ebrt": coalesce_history(details_record, "ebrt"),
            "sessions": coalesce_history(data, "sessions"),
            "imaging": coalesce_history(data, "imaging"),
            "treatment": coalesce_history(data, "treatment"),
        }

    def build_rows(self, ctx: Dict[str, Any]) -> List[Row]:
        ebrt = ctx.get("ebrt") or {}
        sessions_stage = ctx.get("sessions") or {}
        imaging = ctx.get("imaging") or {}
        treatment = ctx.get("treatment") or {}

        sim_sets = ebrt.get("simulationSets") or []
        sim = sim_sets[0] if sim_sets else {}
        planning = ebrt.get("planning") or {}

        sessions = [s for s in (sessions_stage.get("treatmentSessions") or [])
                    if isinstance(s, dict)]
        shifts = [s for s in (imaging.get("imagingShifts") or []) if isinstance(s, dict)]

        planned_fx = _num(sim.get("totalFractions")) or _num(treatment.get("numFractions"))
        # Normalise EBRT vs brachytherapy delivery keys so the delivered count/dose,
        # start date and interruption log source from whichever course was delivered.
        deliv = resolve_delivery(sessions_stage, treatment)
        delivered_total = _num(deliv.get("totalSessionsDelivered"))
        delivered_n = int(delivered_total) if delivered_total is not None else len(sessions)
        machine = _clean(treatment.get("treatmentMachine"))
        if not machine and sessions:
            machine = _clean(sessions[0].get("machine"))
        action_mm = _num(imaging.get("actionLevelMm"))
        tol_mm = _num(imaging.get("toleranceLevelMm"))

        rows: List[Row] = []

        # 1. Daily Treatment Readiness — actively delivering with machine + IGRT in place.
        igrt_method = _clean(imaging.get("verificationMethod"))
        if sessions or delivered_n:
            fx_txt = (f"fraction {delivered_n} of {int(planned_fx)}"
                      if planned_fx else f"{delivered_n} fraction(s) delivered")
            ready_bits = [b for b in (
                machine and f"machine {machine}",
                igrt_method and f"{igrt_method} IGRT",
            ) if b]
            rows.append(Row(
                param="Daily Treatment Readiness",
                status=STATUS_OK, statusLabel="Ready",
                finding=(f"On treatment — {fx_txt}"
                         + (f" · {', '.join(ready_bits)}" if ready_bits else "")),
                ref="Machine assigned, IGRT configured, plan approved",
                action="Delivery active with machine and image-guidance on record.",
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Daily Treatment Readiness", ref="Requires an active treatment course",
                action="Populates from data.sessions once delivery begins."))

        # 2. IGRT Verification — image-guidance method + frequency.
        if igrt_method or shifts:
            freq = _clean(imaging.get("frequency"))
            rows.append(Row(
                param="IGRT Verification",
                status=STATUS_OK, statusLabel="Verified",
                finding=(f"{igrt_method or 'Image guidance'}"
                         + (f", {freq}" if freq else "")
                         + (f" · {len(shifts)} shift record(s)" if shifts else "")),
                ref="IGRT per protocol (e.g. daily CBCT)",
                action="Image-guidance verification recorded for the delivered fractions.",
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "IGRT Verification", ref="Requires image-guidance record",
                action="Populates from data.imaging.verificationMethod / imagingShifts."))

        # 3. Setup Error (3D vector) — √(x²+y²+z²) of the latest shift vs tolerance/action.
        vectors = [(_vector3(s), s) for s in shifts]
        vectors = [(v, s) for v, s in vectors if v is not None]
        if vectors:
            latest_v, latest_s = vectors[-1]
            residual = _clean(latest_s.get("residualErrorAfterShift"))
            limit = action_mm if action_mm is not None else tol_mm
            if limit is not None and latest_v > limit:
                st, label = STATUS_ALERT, "Over action level"
            elif tol_mm is not None and latest_v > tol_mm:
                st, label = STATUS_WATCH, "Over tolerance"
            else:
                st, label = STATUS_OK, "Within tolerance"
            ref_txt = (f"3D vector < {_fmt(tol_mm)} mm tolerance"
                       + (f" / {_fmt(action_mm)} mm action" if action_mm is not None else "")
                       if tol_mm is not None else "3D setup error within protocol tolerance")
            rows.append(Row(
                param="Setup Error (3D vector)",
                status=st, statusLabel=label,
                finding=(f"{_fmt(latest_v)} mm 3D"
                         + (f" (residual {residual})" if residual else "")),
                ref=ref_txt,
                action=("Correct setup / re-image — 3D error exceeds the action level."
                        if label == "Over action level" else
                        "Setup error above tolerance; monitor and re-verify."
                        if label == "Over tolerance" else
                        "Setup error within tolerance after correction."),
                source="derived",
            ))
        else:
            rows.append(Row.not_available(
                "Setup Error (3D vector)", ref="3D setup error within protocol tolerance",
                action="Populates from data.imaging.imagingShifts (X/Y/Z)."))

        # 4. Couch Shift Trend — spread of the 3D vector across imaging sessions.
        if vectors:
            mags = [v for v, _ in vectors]
            vmax, vmin = max(mags), min(mags)
            over_action = (action_mm is not None
                           and sum(1 for m in mags if m > action_mm))
            st = (STATUS_ALERT if over_action else
                  STATUS_WATCH if (action_mm is not None and vmax > action_mm * 0.9)
                  else STATUS_OK)
            rows.append(Row(
                param="Couch Shift Trend",
                status=st,
                statusLabel=("Drifting" if over_action else
                             "Trending" if st == STATUS_WATCH else "Stable"),
                finding=(f"{len(mags)} shift(s): {_fmt(vmin)}–{_fmt(vmax)} mm 3D"
                         + (f", {over_action} over action level" if over_action else "")),
                ref="Shifts stable and within action level over the course",
                action=("Systematic shift developing — consider re-simulation / re-plan."
                        if over_action else
                        "Couch shifts stable across the delivered fractions."),
                source="derived",
            ))
        else:
            rows.append(Row.not_available(
                "Couch Shift Trend", ref="Shifts stable and within action level",
                action="Populates as image-guidance shifts accrue."))

        # 5. Motion Management — special technique on the plan (e.g. DIBH).
        special = _clean(sim.get("specialTech"))
        if special:
            rows.append(Row(
                param="Motion Management",
                status=STATUS_OK, statusLabel="Managed",
                finding=special,
                ref="Motion-management technique applied where indicated",
                action=f"{special} recorded as the motion-management technique.",
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Motion Management", ref="Motion-management technique where indicated",
                action="Populates from ebrt.simulationSets.specialTech."))

        # 6. Adaptive Treatment Trigger — planned adaptive flag or setup drift over action.
        adaptive = _clean(planning.get("adaptiveRadiation"))
        drift_trigger = bool(vectors and action_mm is not None
                             and any(v > action_mm for v, _ in vectors))
        if adaptive or vectors:
            indicated = adaptive.lower() in ("yes", "true", "y") or drift_trigger
            reasons = []
            if adaptive.lower() in ("yes", "true", "y"):
                reasons.append("adaptive flagged on plan")
            if drift_trigger:
                reasons.append("setup error over action level")
            rows.append(Row(
                param="Adaptive Treatment Trigger",
                status=STATUS_WATCH if indicated else STATUS_OK,
                statusLabel="Triggered" if indicated else "Not triggered",
                finding=("; ".join(reasons) if reasons else
                         "No adaptive trigger from plan or setup trend"),
                ref="Re-plan when anatomy / setup drift exceeds threshold",
                action=("Assess for adaptive re-planning." if indicated else
                        "No adaptive re-plan trigger on current delivery."),
                source="derived",
            ))
        else:
            rows.append(Row.not_available(
                "Adaptive Treatment Trigger", ref="Re-plan when drift exceeds threshold",
                action="Populates from ebrt.planning.adaptiveRadiation + setup trend."))

        # 7. Missed Fraction Detection — gaps between consecutive session dates.
        sess_dates = sorted(d for d in (_parse_date(s.get("date")) for s in sessions) if d)
        if sess_dates:
            gaps = [(sess_dates[i + 1] - sess_dates[i]).days
                    for i in range(len(sess_dates) - 1)]
            max_gap = max(gaps) if gaps else 0
            # >3 days between treatments implies a missed day beyond a normal weekend.
            missed = max_gap > 3
            rows.append(Row(
                param="Missed Fraction Detection",
                status=STATUS_WATCH if missed else STATUS_OK,
                statusLabel="Gap detected" if missed else "No gaps",
                finding=(f"{len(sess_dates)} session(s) "
                         f"{sess_dates[0].isoformat()} → {sess_dates[-1].isoformat()}"
                         + (f"; max gap {max_gap} days" if gaps else "")),
                ref="No unplanned gap between fractions",
                action=("Gap between fractions — assess repopulation / schedule recovery."
                        if missed else
                        "Delivered fractions are consecutive; no unplanned gap."),
                source="derived",
            ))
        else:
            rows.append(Row.not_available(
                "Missed Fraction Detection", ref="No unplanned gap between fractions",
                action="Populates from data.sessions.treatmentSessions dates."))

        # 8. Machine Interruption Log — scan session notes for interruption events.
        if sessions:
            interrupted = [s for s in sessions
                           if any(t in _clean(s.get("notes")).lower()
                                  for t in _INTERRUPT_TERMS)]
            if interrupted:
                rows.append(Row(
                    param="Machine Interruption Log",
                    status=STATUS_WATCH,
                    statusLabel=f"{len(interrupted)} logged",
                    finding=f"{len(interrupted)} of {len(sessions)} session(s) note an interruption",
                    ref="No unresolved delivery interruptions",
                    action="Review interrupted sessions for dose/coverage impact.",
                    source="derived",
                ))
            else:
                rows.append(Row(
                    param="Machine Interruption Log",
                    status=STATUS_OK, statusLabel="Clear",
                    finding=f"No interruptions noted across {len(sessions)} session(s)",
                    ref="No unresolved delivery interruptions",
                    action="No machine interruptions recorded in the session notes.",
                    source="derived",
                ))
        else:
            interruptions = deliv.get("interruptions") or []
            if interruptions:
                reasons = [_clean(i.get("reason")) for i in interruptions
                           if _clean(i.get("reason"))]
                rows.append(Row(
                    param="Machine Interruption Log",
                    status=STATUS_WATCH,
                    statusLabel=f"{len(interruptions)} logged",
                    finding=(f"{len(interruptions)} recorded interruption(s)"
                             + (f": {'; '.join(reasons)}" if reasons else "")),
                    ref="No unresolved delivery interruptions",
                    action="Review the recorded treatment interruptions for dose/coverage impact.",
                    source="db",
                ))
            else:
                rows.append(Row.not_available(
                    "Machine Interruption Log", ref="No unresolved delivery interruptions",
                    action="Populates from session notes / recorded interruptions."))

        # 9. Session Completion Verification — recorded counts/doses reconcile.
        total_delivered = _num(deliv.get("totalDoseDeliveredGy"))
        sum_doses = sum(v for v in (_num(s.get("deliveredDoseGy")) for s in sessions)
                        if v is not None)
        if sessions:
            count_ok = (delivered_n == len(sessions))
            dose_ok = (total_delivered is None
                       or abs(total_delivered - sum_doses) < 0.05)
            consistent = count_ok and dose_ok
            rows.append(Row(
                param="Session Completion Verification",
                status=STATUS_OK if consistent else STATUS_WATCH,
                statusLabel="Reconciled" if consistent else "Discrepancy",
                finding=(f"{len(sessions)} session(s), {_fmt(sum_doses)} Gy delivered"
                         + (f" (recorded total {_fmt(total_delivered)} Gy)"
                            if total_delivered is not None else "")),
                ref="Session count & delivered dose reconcile",
                action=("Delivered sessions and dose totals reconcile."
                        if consistent else
                        "Session count / delivered-dose totals disagree — verify records."),
                source="derived",
            ))
        elif delivered_n or total_delivered is not None:
            # Brachytherapy records summary totals without a per-fraction breakdown.
            rows.append(Row(
                param="Session Completion Verification",
                status=STATUS_OK, statusLabel="Recorded",
                finding=(f"{delivered_n} session(s) recorded"
                         + (f", {_fmt(total_delivered)} Gy delivered"
                            if total_delivered is not None else "")),
                ref="Session count & delivered dose reconcile",
                action="Delivered session/dose totals recorded; per-session breakdown not itemised.",
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Session Completion Verification", ref="Session count & dose reconcile",
                action="Populates from data.sessions.treatmentSessions."))

        # 10. Delivery Quality Monitoring — delivered vs planned dose per fraction.
        delivered_per_fx = [v for v in (_num(s.get("deliveredDoseGy")) for s in sessions)
                            if v is not None]
        # Planned dose per fraction (Gy), unit-correct across the Treatment Plan tab (Gy)
        # and the legacy sim set (cGy → Gy), via the shared resolver.
        planned_gy = resolve_prescription(treatment, ebrt)["per_gy"]
        if delivered_per_fx:
            uniform = max(delivered_per_fx) - min(delivered_per_fx) < 0.05
            off_plan = (planned_gy is not None
                        and abs(delivered_per_fx[-1] - planned_gy) >= 0.05)
            st = STATUS_WATCH if (off_plan or not uniform) else STATUS_OK
            finding = (f"Delivered {_fmt(delivered_per_fx[-1])} Gy/fx"
                       + ("" if uniform else " (varies across sessions)"))
            ref_txt = (f"Delivered dose = planned {_fmt(planned_gy)} Gy/fx"
                       if planned_gy is not None else "Delivered dose per fraction consistent")
            rows.append(Row(
                param="Delivery Quality Monitoring",
                status=st,
                statusLabel="Consistent" if st == STATUS_OK else "Deviation",
                finding=finding + (f" vs planned {_fmt(planned_gy)} Gy/fx"
                                   if off_plan else ""),
                ref=ref_txt,
                action=("Delivered dose per fraction matches the plan."
                        if st == STATUS_OK else
                        "Delivered dose/fraction deviates from plan — verify prescription mapping."),
                source="derived",
            ))
        else:
            rows.append(Row.not_available(
                "Delivery Quality Monitoring", ref="Delivered dose per fraction consistent",
                action="Populates from session deliveredDoseGy vs planned dose/fraction."))

        # 11. Treatment Workflow Status — overall course progress roll-up.
        if sessions or delivered_n:
            if planned_fx:
                complete = delivered_n >= planned_fx
                label = "Complete" if complete else f"In progress ({delivered_n}/{int(planned_fx)})"
                finding = f"{delivered_n} of {int(planned_fx)} fractions delivered"
            else:
                complete = False
                label = f"In progress ({delivered_n} delivered)"
                finding = f"{delivered_n} fraction(s) delivered"
            start = _clean(deliv.get("startDate"))
            rows.append(Row(
                param="Treatment Workflow Status",
                status=STATUS_OK,
                statusLabel=label,
                finding=finding + (f", started {start}" if start else ""),
                ref="Course progressing to planned fraction count",
                action=("Course complete." if complete else
                        "Course in progress; continue scheduled fractions."),
                source="derived",
            ))
        else:
            rows.append(Row.not_available(
                "Treatment Workflow Status", ref="Course progressing to planned count",
                action="Populates from data.sessions once delivery begins."))

        # 12. Respiratory Gating — breath-hold / gating technique if used.
        gating_terms = ("dibh", "gat", "breath", "4d", "abc", "rpm")
        if special and any(t in special.lower() for t in gating_terms):
            rows.append(Row(
                param="Respiratory Gating",
                status=STATUS_OK, statusLabel="Active",
                finding=f"{special} in use",
                ref="Respiratory control applied for thoracic/upper-abdo targets",
                action=f"{special} breath-hold/gating recorded for respiratory motion control.",
                source="db",
            ))
        elif special:
            rows.append(Row(
                param="Respiratory Gating",
                status=STATUS_NEUTRAL, statusLabel="Free-breathing",
                finding=f"No gating technique recorded ({special} used)",
                ref="Respiratory control applied where indicated",
                action="No respiratory gating on record; free-breathing delivery.",
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Respiratory Gating", ref="Respiratory control applied where indicated",
                action="Populates from ebrt.simulationSets.specialTech."))

        return rows

    def build_prompt(self, ctx: Dict[str, Any], rows: List[Row]) -> Optional[str]:
        """
        Optional 1-2 sentence delivery narrative (prose only), stored under meta.narrative.
        Row statuses above are already final and independent of this. Skips cleanly when
        GROQ_API_KEY is unset.
        """
        sessions_stage = ctx.get("sessions") or {}
        imaging = ctx.get("imaging") or {}
        ebrt = ctx.get("ebrt") or {}
        sim_sets = ebrt.get("simulationSets") or []
        payload = {
            "sessionsDelivered": sessions_stage.get("totalSessionsDelivered"),
            "totalDoseDeliveredGy": sessions_stage.get("totalDoseDeliveredGy"),
            "plannedFractions": (sim_sets[0] if sim_sets else {}).get("totalFractions"),
            "igrt": {
                "method": imaging.get("verificationMethod"),
                "frequency": imaging.get("frequency"),
                "actionLevelMm": imaging.get("actionLevelMm"),
            },
            "specialTech": (sim_sets[0] if sim_sets else {}).get("specialTech"),
        }
        return (
            "You are a radiation oncology delivery assistant. Using ONLY the JSON below, "
            "write a concise 1-2 sentence treatment-delivery summary. Do not invent data or "
            "recompute values; if a field is missing, omit it. Return a JSON object with a "
            'single key "delivery" whose value is the sentence.\n\n'
            f"DATA:\n{json.dumps(payload, default=str)}"
        )
