"""
agents/response.py — Module 08: Response Assessment & Follow-up.

Post-treatment response, recurrence surveillance and the survivorship schedule, kept
on one timeline. Response category and the follow-up plan are recorded in the RT
record; serial-imaging measurements, PET SUV, biomarker trends and failure-pattern
geometry are NOT in the two workflow databases, so those rows are honestly labelled
"Not available". Nothing clinical is invented — only what the record states is derived.

Response criteria/category are recorded on the EBRT course only (`ebrt.completion`);
the follow-up plan is recorded per modality — `ebrt.followUp` for EBRT and
`brachy.followUp` for brachytherapy (identical shape) — so the follow-up rows read
BOTH sections (the operative record is the one with the later date) and populate for
brachytherapy-only patients too.

Sources:
  * `rt-record-details` → `ebrt.completion` (responseCriteria, clinResponse, rtCompletion),
    `ebrt.followUp` / `brachy.followUp` (date, imagingAdvised/Other, postCompletionPlan,
    adviceOnCompletion), `ebrt.followUpHistory[]` / `brachy.followUpHistory[]`,
    `ebrt.interruption` / `brachy.interruption` (completionDate); `discharge`
    (summaryParagraph).
  * `radiotherapy_records` → `data.summary` (treatmentOutcome, endOfTreatmentSummary),
    `data.intent` (organsAtRisk — late-effect surveillance targets).

Frozen row mapping for Module 08 (standard renderer):
    param   → Parameter
    finding → Current Finding
    ref     → Reference / Expected
    status/statusLabel → Status pill
    action  → Indication / Action

Emits exactly the six frozen keys per row; adds nothing to the dashboard.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple

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


_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _short_date(iso: Any) -> str:
    """'2026-09-20' / '2026-09-20T..' → '20 Sep 2026'. Best-effort, never raises."""
    text = str(iso or "").strip()
    if not text:
        return DASH
    try:
        y, m, d = text.split("T")[0].split("-")
        return f"{int(d):02d} {_MONTHS[int(m) - 1]} {y}"
    except (ValueError, IndexError):
        return text.split("T")[0] or DASH


def _clean(value: Any) -> str:
    text = str(value).strip() if value is not None else ""
    return "" if text.lower() in ("", "none", "null") else text


# RECIST 1.1 / PERCIST response categories → (status, label, is-progression).
# clinResponse is a free code (CR/PR/SD/PD, or spelled out); we map by prefix/keyword.
_RESPONSE_MAP: List[Tuple[Tuple[str, ...], str, str, bool]] = [
    (("cr", "complete"), STATUS_OK, "Complete response", False),
    (("pr", "partial"), STATUS_OK, "Partial response", False),
    (("sd", "stable"), STATUS_WATCH, "Stable disease", False),
    (("pd", "progress"), STATUS_ALERT, "Progressive disease", True),
    (("nc", "no change"), STATUS_WATCH, "No change", False),
    (("mr", "mixed"), STATUS_WATCH, "Mixed response", False),
]


def _map_response(code: str) -> Optional[Tuple[str, str, bool]]:
    """Map a clinResponse code to (status, label, is_progression); None if unrecognised."""
    c = code.strip().lower()
    if not c:
        return None
    for keys, status, label, progression in _RESPONSE_MAP:
        if any(c == k or c.startswith(k) or k in c for k in keys):
            return status, label, progression
    return None


# The follow-up plan is entered per modality and both sections share one shape:
# EBRT writes it to `ebrt.followUp`, brachytherapy to `brachy.followUp`. A patient may
# have either (or, for a combined course, both). `_resolve_followup` returns ONE coherent
# current follow-up (the section with the later date when both recorded one) plus the
# combined visit history, so the follow-up rows populate regardless of modality.
_FU_KEYS = ("date", "time", "imagingAdvised", "imagingAdvisedOther",
            "postCompletionPlan", "adviceOnCompletion")


def _fu_has(fu: Dict[str, Any]) -> bool:
    return any(_clean(fu.get(k)) for k in _FU_KEYS)


def _resolve_followup(
    ebrt: Dict[str, Any], brachy: Dict[str, Any]
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """(current_followup, combined_history) merged across the EBRT and brachy sections."""
    fe = ebrt.get("followUp") or {}
    fb = brachy.get("followUp") or {}
    history = [h for h in (ebrt.get("followUpHistory") or []) if isinstance(h, dict)]
    history += [h for h in (brachy.get("followUpHistory") or []) if isinstance(h, dict)]
    e_has, b_has = _fu_has(fe), _fu_has(fb)
    if e_has and b_has:
        # both modalities recorded a follow-up → the later date is the operative one
        current = fb if _clean(fb.get("date")) > _clean(fe.get("date")) else fe
    elif b_has:
        current = fb
    else:
        current = fe  # EBRT, or empty when neither modality recorded one
    return current, history


class ResponseAgent(BaseAgent):
    moduleId = "m8"
    slug = "response"
    num = "08 / 12"
    title = "Response Assessment & Follow-up"

    async def gather_context(self, patient_id: Optional[str]) -> Dict[str, Any]:
        details_record = await self.ds.get_ebrt_record(patient_id)
        workflow_record = await self.ds.get_workflow_record(patient_id)
        data = workflow_record.get("data") or {}
        return {
            "ebrt": coalesce_history(details_record, "ebrt"),
            "brachy": coalesce_history(details_record, "brachy"),
            "discharge": coalesce_history(details_record, "discharge"),
            "summary": coalesce_history(data, "summary"),
            "intent": coalesce_history(data, "intent"),
        }

    def build_rows(self, ctx: Dict[str, Any]) -> List[Row]:
        ebrt = ctx.get("ebrt") or {}
        brachy = ctx.get("brachy") or {}
        discharge = ctx.get("discharge") or {}
        summary = ctx.get("summary") or {}
        intent = ctx.get("intent") or {}

        completion = ebrt.get("completion") or {}
        # Follow-up is recorded per modality (ebrt.followUp / brachy.followUp) — merge both
        # so the schedule/survivorship rows populate for brachytherapy patients too.
        follow_up, fu_history = _resolve_followup(ebrt, brachy)
        interruption = ebrt.get("interruption") or {}
        oars = [o for o in (intent.get("organsAtRisk") or []) if isinstance(o, dict)]

        criteria = _clean(completion.get("responseCriteria"))
        clin_response = _clean(completion.get("clinResponse"))
        mapped = _map_response(clin_response) if clin_response else None

        rows: List[Row] = []

        # 1. RECIST Response Assessment — completion.clinResponse under RECIST criteria.
        if mapped is not None:
            status, label, progression = mapped
            rows.append(Row(
                param="RECIST Response Assessment",
                status=status, statusLabel=label,
                finding=(f"{clin_response} ({label})"
                         + (f" by {criteria}" if criteria else "")),
                ref="RECIST 1.1: CR / PR / SD / PD",
                action=("Progressive disease — escalate to salvage/systemic review and MDT."
                        if progression else
                        "Complete response documented; continue surveillance."
                        if label == "Complete response" else
                        f"{label} documented; continue response-adapted surveillance."),
                source="db",
            ))
        elif clin_response:
            rows.append(Row(
                param="RECIST Response Assessment",
                status=STATUS_NEUTRAL, statusLabel="Recorded",
                finding=f"Response '{clin_response}'"
                        + (f" by {criteria}" if criteria else ""),
                ref="RECIST 1.1: CR / PR / SD / PD",
                action="Response recorded in a non-standard code; map to a RECIST category.",
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "RECIST Response Assessment", ref="RECIST 1.1: CR / PR / SD / PD",
                action="Populates from ebrt.completion.clinResponse."))

        # 2. PERCIST / PET Response — needs PET SUV; only if PERCIST criteria used.
        if criteria and "percist" in criteria.lower() and clin_response:
            rows.append(Row(
                param="PERCIST / PET Response",
                status=(mapped[0] if mapped else STATUS_NEUTRAL),
                statusLabel=(mapped[1] if mapped else "Recorded"),
                finding=f"{clin_response} by PERCIST",
                ref="PERCIST: SUV-based metabolic response",
                action="Metabolic response recorded; correlate with anatomical response.",
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "PERCIST / PET Response",
                ref="PERCIST: SUV-based metabolic response",
                action="Populates from PET SUV data; the record uses "
                       + (f"{criteria} (anatomical)." if criteria else "no PET criteria."),
                source="gap",
            ))

        # 3. Imaging Comparison Engine — needs serial imaging measurements.
        rows.append(Row.not_available(
            "Imaging Comparison Engine",
            ref="Baseline vs follow-up target measurements compared",
            action="Populates from serial imaging measurements; not stored in the workflow "
                   "record (advised imaging: "
                   + (_clean(follow_up.get("imagingAdvised")) or "not specified") + ").",
            source="gap",
        ))

        # 4. Tumor Volume Regression — needs post-RT target volumes to trend.
        rows.append(Row.not_available(
            "Tumor Volume Regression",
            ref="Target volume regression vs baseline",
            action="Populates from serial target-volume measurements; only baseline volumes "
                   "are recorded.",
            source="gap",
        ))

        # 5. Biomarker Trend — no biomarker/tumor-marker result fields available.
        rows.append(Row.not_available(
            "Biomarker Trend",
            ref="Tumor-marker trend within/normalising to reference",
            action="Populates when serial tumor-marker results are linked.",
            source="gap",
        ))

        # 6. Local Recurrence Detection — progression signal from the latest response.
        if mapped is not None:
            _st, label, progression = mapped
            if progression:
                rows.append(Row(
                    param="Local Recurrence Detection",
                    status=STATUS_ALERT, statusLabel="Progression",
                    finding=f"Progressive disease on last assessment ({clin_response})",
                    ref="No local progression on surveillance imaging",
                    action="Progression signal — obtain diagnostic imaging and refer to MDT.",
                    source="db",
                ))
            else:
                rows.append(Row(
                    param="Local Recurrence Detection",
                    status=STATUS_OK, statusLabel="No signal",
                    finding=f"No progression at last assessment ({label})",
                    ref="No local progression on surveillance imaging",
                    action="No recurrence signal at last response; continue scheduled "
                           "surveillance imaging.",
                    source="db",
                ))
        else:
            rows.append(Row.not_available(
                "Local Recurrence Detection",
                ref="No local progression on surveillance imaging",
                action="Populates from surveillance response assessments.",
                source="gap"))

        # 7. Radiation Failure Pattern — in-field/marginal/out-of-field needs geometry.
        rows.append(Row.not_available(
            "Radiation Failure Pattern",
            ref="Failure classified in-field / marginal / out-of-field",
            action="Populates from recurrence location vs dose distribution; no failure "
                   "geometry recorded.",
            source="gap",
        ))

        # 8. Follow-up Schedule — ebrt.followUp date + advised imaging (+ history).
        fu_date = _clean(follow_up.get("date"))
        imaging = _clean(follow_up.get("imagingAdvised"))
        imaging_other = _clean(follow_up.get("imagingAdvisedOther"))
        if fu_date or imaging or fu_history:
            img_txt = (f"{imaging}"
                       + (f" ({imaging_other})" if imaging_other else "")) if imaging else ""
            bits = []
            if fu_date:
                bits.append(f"next {_short_date(fu_date)}")
            if img_txt:
                bits.append(f"imaging {img_txt}")
            if fu_history:
                bits.append(f"{len(fu_history)} prior visit(s)")
            rows.append(Row(
                param="Follow-up Schedule",
                status=STATUS_OK, statusLabel="Scheduled",
                finding="; ".join(bits) if bits else "Follow-up on record",
                ref="Risk-adapted follow-up schedule maintained",
                action=(f"Next follow-up {_short_date(fu_date)}"
                        + (f" with {img_txt} imaging." if img_txt else ".")
                        if fu_date else
                        "Follow-up plan on record; confirm the next appointment date."),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Follow-up Schedule", ref="Risk-adapted follow-up schedule maintained",
                action="Populates from ebrt.followUp.date / imagingAdvised."))

        # 9. Survivorship Monitoring — post-completion plan + patient advice.
        plan = _clean(follow_up.get("postCompletionPlan"))
        advice = _clean(follow_up.get("adviceOnCompletion"))
        if plan or advice:
            rows.append(Row(
                param="Survivorship Monitoring",
                status=STATUS_OK, statusLabel="Plan on record",
                finding=(plan or advice)[:180] + ("…" if len(plan or advice) > 180 else ""),
                ref="Survivorship care plan documented",
                action=("Survivorship plan documented"
                        + ("; patient advice on record." if advice else ".")),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Survivorship Monitoring", ref="Survivorship care plan documented",
                action="Populates from ebrt.followUp.postCompletionPlan."))

        # 10. Late Effect Surveillance — surveillance of late-reacting OARs.
        tox_watch = plan and any(t in plan.lower()
                                 for t in ("toxicit", "late effect", "supportive"))
        if tox_watch or oars:
            organ_txt = (f"{len(oars)} OAR(s) at risk" if oars
                         else "late-effect surveillance planned")
            rows.append(Row(
                param="Late Effect Surveillance",
                status=STATUS_OK, statusLabel="Planned",
                finding=(f"{organ_txt}"
                         + ("; toxicity surveillance in the follow-up plan" if tox_watch else "")),
                ref="Late-reacting organs surveilled per follow-up plan",
                action="Surveil the irradiated late-reacting organs at scheduled follow-up.",
                source="db" if tox_watch else "derived",
            ))
        else:
            rows.append(Row.not_available(
                "Late Effect Surveillance",
                ref="Late-reacting organs surveilled per follow-up plan",
                action="Populates from the follow-up plan + intent.organsAtRisk.",
                source="gap"))

        # 11. Disease Progression Dashboard — roll-up of the response signal to date.
        outcome = _clean(summary.get("treatmentOutcome"))
        if mapped is not None:
            _st, label, progression = mapped
            rows.append(Row(
                param="Disease Progression Dashboard",
                status=STATUS_ALERT if progression else STATUS_OK,
                statusLabel="Progressing" if progression else "Controlled",
                finding=(f"Latest response {clin_response} ({label})"
                         + (f"; outcome: {outcome}" if outcome else "")),
                ref="Disease controlled (no progression)",
                action=("Disease progression recorded — activate the progression pathway."
                        if progression else
                        "No progression on the latest assessment; continue surveillance."),
                source="derived",
            ))
        elif outcome:
            rows.append(Row(
                param="Disease Progression Dashboard",
                status=STATUS_NEUTRAL, statusLabel="Outcome recorded",
                finding=f"Treatment outcome: {outcome}; no response category recorded",
                ref="Disease controlled (no progression)",
                action="Record a response category to track progression status.",
                source="derived",
            ))
        else:
            rows.append(Row.not_available(
                "Disease Progression Dashboard", ref="Disease controlled (no progression)",
                action="Populates from the recorded response + treatment outcome.",
                source="gap"))

        # 12. Outcome Analytics — this patient's recorded outcome (cohort needs a registry).
        rt_completion = _clean(completion.get("rtCompletion"))
        completion_date = _clean(interruption.get("completionDate")) or _clean(
            (brachy.get("interruption") or {}).get("completionDate"))
        if outcome or clin_response or rt_completion:
            bits = []
            if rt_completion:
                bits.append(f"RT {rt_completion.lower()}")
            if completion_date:
                bits.append(f"completed {_short_date(completion_date)}")
            if clin_response:
                bits.append(f"response {clin_response}")
            if outcome:
                bits.append(f"outcome {outcome}")
            rows.append(Row(
                param="Outcome Analytics",
                status=STATUS_OK, statusLabel="Recorded",
                finding="; ".join(bits),
                ref="Per-patient outcome recorded (cohort analytics needs a registry link)",
                action="Individual outcome captured; cohort benchmarking enables when an "
                       "outcomes registry is linked.",
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Outcome Analytics",
                ref="Per-patient outcome recorded (cohort analytics needs a registry link)",
                action="Populates from ebrt.completion + data.summary.treatmentOutcome.",
                source="gap"))

        return rows

    def build_prompt(self, ctx: Dict[str, Any], rows: List[Row]) -> Optional[str]:
        """
        Optional 1-2 sentence response/follow-up narrative (prose only), stored under
        meta.narrative. Row statuses above are already final and independent of this.
        Skips cleanly when GROQ_API_KEY is unset.
        """
        ebrt = ctx.get("ebrt") or {}
        brachy = ctx.get("brachy") or {}
        summary = ctx.get("summary") or {}
        completion = ebrt.get("completion") or {}
        follow_up, _ = _resolve_followup(ebrt, brachy)
        payload = {
            "responseCriteria": completion.get("responseCriteria"),
            "clinResponse": completion.get("clinResponse"),
            "treatmentOutcome": summary.get("treatmentOutcome"),
            "followUp": {
                "date": follow_up.get("date"),
                "imagingAdvised": follow_up.get("imagingAdvised"),
                "postCompletionPlan": follow_up.get("postCompletionPlan"),
            },
        }
        return (
            "You are a radiation oncology follow-up assistant. Using ONLY the JSON below, "
            "write a concise 1-2 sentence response & follow-up summary. Do not invent data "
            "or outcomes; if a field is missing, omit it. Return a JSON object with a single "
            'key "response" whose value is the sentence.\n\n'
            f"DATA:\n{json.dumps(payload, default=str)}"
        )
