"""
agents/analytics.py — Module 12: Department Analytics & Operations.

Zooms out from the single patient to machine, department and cohort performance. The
platform reads ONE patient's record at a time, so true department/cohort aggregates
(throughput across the fleet, a composite performance score) cannot be measured from a
single record and are honestly labelled "Not available". Every other row derives this
patient's genuine CONTRIBUTION to the department metric — framed explicitly as
"this patient / this course", with neutral status — and discloses that the fleet-wide
figure enables once records are aggregated. Nothing is invented; this mirrors how the
Response module reports per-patient outcome while cohort benchmarking awaits a registry.

Sources (all per-patient, read-only):
  * `radiotherapy_records` → `data.sessions` (treatmentSessions[]: date/machine/
    treatmentTimeMin, totalSessionsDelivered, startDate/endDate), `data.qa`
    (dateOfMouldRoomVisit, gammaPassRate, verification/approval flags), `data.treatment`
    (treatmentMachine), `data.summary` (toxicities[], treatmentOutcome,
    endOfTreatmentSummary), `data.intent`, `data.patient` (previousTreatments[]).
  * `rt-record-details` → `ebrt.simulationSets` (startDate, totalFractions),
    `ebrt.adverseEvents[]`, `ebrt.approvals` (RO/MP/RTT sign-off).

Frozen row mapping for Module 12 (standard renderer):
    param   → Parameter
    finding → Current Finding
    ref     → Reference / Expected
    status/statusLabel → Status pill
    action  → Indication / Action

Emits exactly the six frozen keys per row; adds nothing to the dashboard.
"""

from __future__ import annotations

import json
import re
from datetime import date
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
    return "" if text.lower() in ("", "none", "null", "nil") else text


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
    """41.0 → '41', 94.7 → '94.7'."""
    if value is None:
        return DASH
    return f"{value:.0f}" if abs(value - round(value)) < 0.05 else f"{value:.1f}"


def _grade_num(value: Any) -> Optional[int]:
    """First CTCAE grade digit 0-5 in the value ('Grade 2' / '2' / 'G3' → int)."""
    m = re.search(r"[0-5]", str(value or ""))
    return int(m.group()) if m else None


def _parse_date(value: Any) -> Optional[date]:
    """'2026-07-30' / '2026-07-30T..' → date; None if unparseable."""
    text = _clean(value)
    if not text:
        return None
    try:
        return date.fromisoformat(text.split("T")[0])
    except ValueError:
        return None


def _priors(prev: List[Dict[str, Any]], *terms: str) -> List[Dict[str, Any]]:
    """Prior treatments whose treatmentType contains any of the given substrings."""
    out = []
    for p in prev:
        tt = _clean(p.get("treatmentType")).lower()
        if tt and any(t in tt for t in terms):
            out.append(p)
    return out


# Institutional waiting-time target (planning → first fraction), disclosed in the row.
_WAIT_TARGET_DAYS = 14
_WAIT_EXTENDED_DAYS = 28


class AnalyticsAgent(BaseAgent):
    moduleId = "m12"
    slug = "analytics"
    num = "12 / 12"
    title = "Department Analytics & Operations"

    async def gather_context(self, patient_id: Optional[str]) -> Dict[str, Any]:
        details_record = await self.ds.get_ebrt_record(patient_id)
        workflow_record = await self.ds.get_workflow_record(patient_id)
        data = workflow_record.get("data") or {}
        return {
            "ebrt": coalesce_history(details_record, "ebrt"),
            "sessions": coalesce_history(data, "sessions"),
            "qa": coalesce_history(data, "qa"),
            "treatment": coalesce_history(data, "treatment"),
            "summary": coalesce_history(data, "summary"),
            "intent": coalesce_history(data, "intent"),
            "patient": coalesce_history(data, "patient"),
        }

    def build_rows(self, ctx: Dict[str, Any]) -> List[Row]:
        ebrt = ctx.get("ebrt") or {}
        sessions_stage = ctx.get("sessions") or {}
        qa = ctx.get("qa") or {}
        treatment = ctx.get("treatment") or {}
        summary = ctx.get("summary") or {}
        patient = ctx.get("patient") or {}

        sim_sets = ebrt.get("simulationSets") or []
        sim = sim_sets[0] if sim_sets else {}
        approvals = ebrt.get("approvals") or {}
        adverse = [a for a in (ebrt.get("adverseEvents") or []) if isinstance(a, dict)]
        sessions = [s for s in (sessions_stage.get("treatmentSessions") or [])
                    if isinstance(s, dict)]
        prev = [p for p in (patient.get("previousTreatments") or []) if isinstance(p, dict)]

        sess_dates = sorted(d for d in (_parse_date(s.get("date")) for s in sessions) if d)
        first_fx = sess_dates[0] if sess_dates else None
        start_date = _clean(sessions_stage.get("startDate"))
        end_date = _clean(sessions_stage.get("endDate"))

        n_delivered = _num(sessions_stage.get("totalSessionsDelivered"))
        delivered_n = int(n_delivered) if n_delivered is not None else len(sessions)
        planned_fx = _num(sim.get("totalFractions")) or _num(treatment.get("numFractions"))
        machine = _clean(treatment.get("treatmentMachine")) or (
            _clean(sessions[0].get("machine")) if sessions else "")
        beam_min = sum(v for v in (_num(s.get("treatmentTimeMin")) for s in sessions)
                       if v is not None)
        gamma = _num(qa.get("gammaPassRate"))

        # ── shared per-patient KPIs (reused across rows) ─────────────────────
        # Waiting time: earliest recorded planning anchor → first fraction.
        anchor_specs = [
            ("simulation start", sim.get("startDate")),
            ("mould-room visit", qa.get("dateOfMouldRoomVisit")),
        ]
        anchors = [(name, _parse_date(v)) for name, v in anchor_specs]
        anchors = [(name, d) for name, d in anchors if d and first_fx and d <= first_fx]
        wait_days: Optional[int] = None
        wait_anchor = ""
        if anchors and first_fx:
            wait_anchor, adate = min(anchors, key=lambda x: x[1])
            wait_days = (first_fx - adate).days

        # Completion rate for this patient.
        completion_pct: Optional[float] = None
        if planned_fx and planned_fx > 0:
            completion_pct = delivered_n / planned_fx * 100.0

        # Protocol/QA compliance for this patient (qa flags + approvals sign-off).
        comp_specs = [
            ("plan verification", "planVerificationCompleted"),
            ("MU calculation", "muCalculationVerified"),
            ("dose-distribution review", "doseDistributionReviewed"),
            ("DVH constraints", "dvhConstraintsMet"),
            ("physics approval", "physicsApprovalObtained"),
        ]
        appr_specs = [("RO sign-off", "roSigned"),
                      ("MP sign-off", "mpSigned"),
                      ("RTT sign-off", "rttSigned")]
        comp_present = [(n, k) for n, k in comp_specs if qa.get(k) is not None]
        appr_present = [(n, k) for n, k in appr_specs if approvals.get(k) is not None]
        comp_done = ([n for n, k in comp_present if _truthy(qa.get(k))]
                     + [n for n, k in appr_present if _truthy(approvals.get(k))])
        comp_pending = ([n for n, k in comp_present if not _truthy(qa.get(k))]
                        + [n for n, k in appr_present if not _truthy(approvals.get(k))])
        comp_total = len(comp_present) + len(appr_present)
        comp_compliant = comp_total > 0 and not comp_pending

        # Toxicity burden for this patient (summary + ebrt adverse events).
        tox: List = []
        for t in (summary.get("toxicities") or []):
            if isinstance(t, dict) and _clean(t.get("toxicity")):
                tox.append((_clean(t.get("toxicity")), _grade_num(t.get("grade"))))
        for a in adverse:
            if _clean(a.get("event")):
                tox.append((_clean(a.get("event")), _grade_num(a.get("grade"))))
        tox_grades = [g for _, g in tox if g is not None]
        max_grade = max(tox_grades) if tox_grades else None

        prior_rt = _priors(prev, "radiat", "radiotherap", "brachy", "ebrt")

        rows: List[Row] = []

        # 1. Machine Utilization — this patient's real machine usage (dept needs fleet).
        if machine or sessions:
            bits = []
            if machine:
                bits.append(machine)
            bits.append(f"{delivered_n or len(sessions)} session(s)")
            if beam_min:
                bits.append(f"~{int(round(beam_min))} min beam-on")
            rows.append(Row(
                param="Machine Utilization",
                status=STATUS_NEUTRAL, statusLabel="Per-patient",
                finding=" · ".join(bits) + " (this course)",
                ref="Department machine utilisation tracked across the fleet",
                action="Single-patient usage shown; department utilisation enables when the "
                       "fleet schedule is aggregated across patients.",
                source="derived",
            ))
        else:
            rows.append(Row.not_available(
                "Machine Utilization",
                ref="Department machine utilisation tracked across the fleet",
                action="Populates from data.sessions (machine, beam-on time) + fleet aggregation."))

        # 2. Treatment Throughput — patients/unit time; no single-patient analogue.
        span = f" (this course {start_date} → {end_date})" if start_date and end_date else ""
        rows.append(Row.not_available(
            "Treatment Throughput",
            ref="Patients treated per unit time across the department",
            action="Populates from department-wide scheduling; a single-patient record cannot "
                   "measure throughput" + span + ".",
            source="gap",
        ))

        # 3. Waiting Time (decision → fx 1) — per-patient planning-to-treatment interval.
        if wait_days is not None:
            if wait_days <= _WAIT_TARGET_DAYS:
                st, label = STATUS_OK, "Within target"
            elif wait_days <= _WAIT_EXTENDED_DAYS:
                st, label = STATUS_WATCH, "Extended"
            else:
                st, label = STATUS_ALERT, "Prolonged"
            rows.append(Row(
                param="Waiting Time (decision → fx 1)",
                status=st, statusLabel=label,
                finding=f"{wait_days} day(s) from {wait_anchor} to first fraction",
                ref=f"Target ≤ {_WAIT_TARGET_DAYS} days planning→treatment "
                    "(institutional; referral/decision date not recorded)",
                action=("Waiting time within the institutional target." if st == STATUS_OK else
                        "Waiting time extended; review scheduling capacity." if st == STATUS_WATCH else
                        "Prolonged waiting time — escalate scheduling for this pathway."),
                source="derived",
            ))
        elif first_fx:
            rows.append(Row.not_available(
                "Waiting Time (decision → fx 1)",
                ref=f"Target ≤ {_WAIT_TARGET_DAYS} days planning→treatment (institutional)",
                action="No planning/simulation date on or before the first fraction is recorded; "
                       "cannot measure waiting time.",
                source="gap"))
        else:
            rows.append(Row.not_available(
                "Waiting Time (decision → fx 1)",
                ref=f"Target ≤ {_WAIT_TARGET_DAYS} days planning→treatment (institutional)",
                action="Populates from the planning/simulation date and the first fraction date."))

        # 4. Fraction Completion Rate (dept.) — this patient's completion (dept needs cohort).
        if completion_pct is not None:
            rows.append(Row(
                param="Fraction Completion Rate (dept.)",
                status=STATUS_NEUTRAL, statusLabel="Per-patient",
                finding=f"{delivered_n}/{int(planned_fx)} fractions "
                        f"({_fmt(completion_pct)}%) — this patient",
                ref="Department fraction-completion rate benchmarked across patients",
                action="Single-patient completion shown; the department rate enables with "
                       "cohort aggregation.",
                source="derived",
            ))
        elif delivered_n:
            rows.append(Row(
                param="Fraction Completion Rate (dept.)",
                status=STATUS_NEUTRAL, statusLabel="Per-patient",
                finding=f"{delivered_n} fraction(s) delivered (planned count not recorded)",
                ref="Department fraction-completion rate benchmarked across patients",
                action="Planned fraction count not recorded; department rate enables with "
                       "cohort aggregation.",
                source="derived",
            ))
        else:
            rows.append(Row.not_available(
                "Fraction Completion Rate (dept.)",
                ref="Department fraction-completion rate benchmarked across patients",
                action="Populates from delivered vs planned fractions + cohort aggregation."))

        # 5. Toxicity Incidence (cohort) — this patient's toxicity burden (cohort needs registry).
        if tox:
            grade_txt = (f", max grade {max_grade}" if max_grade is not None
                         else " (grades not all recorded)")
            rows.append(Row(
                param="Toxicity Incidence (cohort)",
                status=STATUS_NEUTRAL, statusLabel="Per-patient",
                finding=f"{len(tox)} toxicity event(s) recorded{grade_txt} — this patient",
                ref="Cohort toxicity incidence tracked against expected rates",
                action="Single-patient toxicity burden shown; cohort incidence needs a "
                       "toxicity registry across patients.",
                source="derived",
            ))
        else:
            rows.append(Row.not_available(
                "Toxicity Incidence (cohort)",
                ref="Cohort toxicity incidence tracked against expected rates",
                action="Populates from recorded toxicities/adverse events + cohort aggregation."))

        # 6. Protocol Compliance (dept.) — this patient's protocol/QA adherence.
        if comp_total > 0:
            rows.append(Row(
                param="Protocol Compliance (dept.)",
                status=STATUS_OK if comp_compliant else STATUS_WATCH,
                statusLabel=("Compliant" if comp_compliant
                             else f"{len(comp_pending)} deviation(s)"),
                finding=f"{len(comp_done)}/{comp_total} protocol/QA items complete — this patient",
                ref="Department protocol-compliance rate across patients",
                action=("This patient meets recorded protocol/QA items; the department rate "
                        "enables with cohort aggregation." if comp_compliant
                        else "Pending: " + ", ".join(comp_pending) + "."),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Protocol Compliance (dept.)",
                ref="Department protocol-compliance rate across patients",
                action="Populates from qa verification/approval flags + cohort aggregation."))

        # 7. Re-irradiation Registry — is this patient a re-irradiation case?
        if prior_rt:
            p = prior_rt[-1]
            when = _clean(p.get("date"))
            rows.append(Row(
                param="Re-irradiation Registry",
                status=STATUS_WATCH, statusLabel="Re-irradiation case",
                finding=("Prior radiotherapy on record"
                         + (f" ({when})" if when else "") + " — re-irradiation registry entry"),
                ref="Re-irradiated patients tracked with cumulative-dose review",
                action="Register as a re-irradiation case and review cumulative OAR dose "
                       "(see the Dose module).",
                source="db",
            ))
        else:
            rows.append(Row(
                param="Re-irradiation Registry",
                status=STATUS_OK, statusLabel="First course",
                finding="No prior radiotherapy on record — not a re-irradiation case",
                ref="Re-irradiated patients tracked with cumulative-dose review",
                action="First RT course; no re-irradiation registry entry required.",
                source="derived",
            ))

        # 8. Outcome Benchmarking — this patient's outcome (cohort benchmark needs registry).
        outcome = _clean(summary.get("treatmentOutcome"))
        eot = _clean(summary.get("endOfTreatmentSummary"))
        if outcome or eot:
            bits = []
            if outcome:
                bits.append(f"outcome {outcome}")
            if eot:
                bits.append(eot)
            rows.append(Row(
                param="Outcome Benchmarking",
                status=STATUS_NEUTRAL, statusLabel="Per-patient",
                finding="; ".join(bits) + " — this patient",
                ref="Outcomes benchmarked against the department cohort",
                action="This patient's outcome recorded; benchmarking enables when an outcomes "
                       "registry is linked.",
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Outcome Benchmarking",
                ref="Outcomes benchmarked against the department cohort",
                action="Populates from data.summary.treatmentOutcome + an outcomes registry."))

        # 9. Quality Indicator Dashboard — roll-up of this patient's recorded QIs.
        indicators = []
        if wait_days is not None:
            indicators.append(f"waiting {wait_days}d")
        if completion_pct is not None:
            indicators.append(f"completion {_fmt(completion_pct)}%")
        if comp_total > 0:
            indicators.append("protocol " + ("compliant" if comp_compliant else "deviation"))
        if gamma is not None:
            indicators.append(f"QA gamma {_fmt(gamma)}%")
        if max_grade is not None:
            indicators.append(f"max toxicity G{max_grade}")
        if indicators:
            rows.append(Row(
                param="Quality Indicator Dashboard",
                status=STATUS_NEUTRAL, statusLabel="Per-patient",
                finding="QIs — " + ", ".join(indicators),
                ref="Department quality-indicator dashboard aggregated across patients",
                action="Single-patient QI snapshot; the department dashboard enables with "
                       "cohort aggregation.",
                source="derived",
            ))
        else:
            rows.append(Row.not_available(
                "Quality Indicator Dashboard",
                ref="Department quality-indicator dashboard aggregated across patients",
                action="Populates from the per-patient QIs (waiting time, completion, "
                       "compliance, QA) + cohort aggregation."))

        # 10. Radiation Department Performance Score — composite; needs dept-wide metrics.
        rows.append(Row.not_available(
            "Radiation Department Performance Score",
            ref="Composite score (utilisation, throughput, completion, compliance, outcomes)",
            action="Populates from department-wide metrics aggregated across patients and "
                   "machines; not derivable from a single record.",
            source="gap",
        ))

        return rows

    def build_prompt(self, ctx: Dict[str, Any], rows: List[Row]) -> Optional[str]:
        """
        Optional 1-2 sentence operations narrative (prose only), stored under meta.narrative.
        Row statuses above are already final and independent of this. Skips cleanly when
        GROQ_API_KEY is unset.
        """
        sessions_stage = ctx.get("sessions") or {}
        summary = ctx.get("summary") or {}
        treatment = ctx.get("treatment") or {}
        payload = {
            "machine": treatment.get("treatmentMachine"),
            "sessionsDelivered": sessions_stage.get("totalSessionsDelivered"),
            "startDate": sessions_stage.get("startDate"),
            "endDate": sessions_stage.get("endDate"),
            "treatmentOutcome": summary.get("treatmentOutcome"),
        }
        return (
            "You are a radiation oncology operations assistant. Using ONLY the JSON below, "
            "write a concise 1-2 sentence summary of this patient's contribution to "
            "department operations (machine, course dates, outcome). Do not invent data, do "
            "not compute department-wide figures from one patient; if a field is missing, omit "
            'it. Return a JSON object with a single key "operations" whose value is the '
            f"sentence.\n\nDATA:\n{json.dumps(payload, default=str)}"
        )
