"""
agents/toxicity.py — Module 07: Toxicity Prediction & Management.

Two complementary signals per organ/toxicity:
  * OBSERVED — a graded adverse event recorded for the patient (CTCAE).
  * PREDICTED — risk inferred from the recorded OAR dose vs a published dose-response
    threshold (QUANTEC), when no event is yet observed.

Observed grade always wins; if neither is present the row is honestly "Not available".
The dose-response thresholds and CTCAE trajectories are published reference standards,
shown verbatim in the frozen "Reference / Expected Trajectory" column — nothing
patient-specific is invented; only the grade/finding/status is derived from the record.

Sources:
  * `radiotherapy_records` → `data.summary` (toxicities[]: toxicity/grade;
    endOfTreatmentSummary), `data.intent.organsAtRisk` (per-organ max/mean dose),
    `data.baseline` ('phy-weight'), `data.treatment` (fraction fallback).
  * `rt-record-details` → `ebrt.simulationSets` (prescription for EQD2),
    `ebrt.adverseEvents` (event/gradingSystem/grade), `ebrt.completion`
    (weightStart/weightCompletion), `ebrt.followUp` (postCompletionPlan);
    `discharge` (toxicitySummaryRows[], toxicitySummaryParagraph).

Frozen row mapping for Module 07 (standard renderer):
    param   → Toxicity
    finding → Current Grade / Finding
    ref     → Reference / Expected Trajectory
    status/statusLabel → Status pill
    action  → Indication / Action

Emits exactly the six frozen keys per row; adds nothing to the dashboard.
"""

from __future__ import annotations

import json
import re
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


def _grade_num(value: Any) -> Optional[int]:
    """'Grade 2' / '2' / 'G3' → int 0–5; None if no grade token present."""
    m = re.search(r"[0-5]", str(value or ""))
    return int(m.group()) if m else None


def _eqd2(total_gy: Optional[float], n_fx: Optional[float], ab: float) -> Optional[float]:
    """EQD2 = D·(d + α/β)/(2 + α/β), d = D/n. None if inputs insufficient."""
    if not total_gy or not n_fx or n_fx <= 0:
        return None
    d = total_gy / n_fx
    return total_gy * (d + ab) / (2.0 + ab)


def _grade_status(grade: Optional[int]) -> Tuple[str, str]:
    """CTCAE grade → (status, label). G0 none · G1 mild · G2 moderate · G3+ severe."""
    if grade is None:
        return STATUS_NEUTRAL, "Ungraded"
    if grade >= 3:
        return STATUS_ALERT, f"Grade {grade}"
    if grade == 2:
        return STATUS_WATCH, "Grade 2"
    return STATUS_OK, f"Grade {grade}"


# Per-toxicity spec: param, observed-match terms, OAR-match terms, metric, dose
# threshold (Gy, EQD2 α/β=3; None → observe-only), published expected trajectory.
_TOX_SPECS: List[Tuple[str, List[str], List[str], str, Optional[float], str]] = [
    ("Radiation Dermatitis",
     ["dermatit", "skin", "hair loss", "alopecia", "erythema", "desquam"],
     ["skin"], "max", None,
     "Acute; peaks wk 3–4, CTCAE ≤ G2 expected, resolves 2–4 wk post-RT"),
    ("Oral Mucositis",
     ["mucosit", "mucosa", "stomatit"],
     ["oral cavity", "oral", "mucosa"], "mean", 40.0,
     "Mean oral cavity < 40 Gy; acute, peaks wk 3–5 (QUANTEC)"),
    ("Xerostomia Risk Prediction",
     ["xerostom", "dry mouth", "salivary"],
     ["parotid"], "mean", 26.0,
     "Mean parotid < 26 Gy (QUANTEC) to limit G2+ xerostomia"),
    ("Radiation Pneumonitis",
     ["pneumonit", "lung"],
     ["lung"], "mean", 20.0,
     "Mean lung < 20 Gy, V20 < 30% (QUANTEC)"),
    ("Radiation Esophagitis",
     ["esophagit", "oesophagit", "esophag", "oesophag", "dysphag"],
     ["esophag", "oesophag"], "mean", 34.0,
     "Mean esophagus < 34 Gy (QUANTEC); acute wk 3+"),
    ("Enteritis / Proctitis",
     ["enterit", "proctit", "bowel", "rectal", "rectum", "diarrh"],
     ["bowel", "rectum", "small bowel"], "max", 45.0,
     "Small-bowel V45 minimized; rectum Dmax < 60 Gy (QUANTEC)"),
    ("Brain Edema Monitoring",
     ["edema", "oedema", "cerebral", "brain necros", "raised icp"],
     ["brain"], "max", 60.0,
     "Symptomatic edema/necrosis risk rises > 60 Gy (QUANTEC)"),
    ("Cardiac Toxicity Monitoring",
     ["cardiac", "heart", "pericard"],
     ["heart"], "mean", 26.0,
     "Mean heart < 26 Gy (QUANTEC) for < 15% long-term risk"),
    ("Radiation Nephropathy",
     ["nephropath", "renal", "kidney"],
     ["kidney", "renal"], "mean", 18.0,
     "Bilateral kidney mean < 18 Gy (QUANTEC)"),
    ("Radiation Myelopathy Risk",
     ["myelopath", "cord compress", "spinal"],
     ["spinal cord", "cord"], "max", 50.0,
     "Cord Dmax < 50 Gy (QUANTEC), < 0.2% myelopathy risk"),
]
class ToxicityAgent(BaseAgent):
    moduleId = "m7"
    slug = "toxicity"
    num = "07 / 12"
    title = "Toxicity Prediction & Management"

    async def gather_context(self, patient_id: Optional[str]) -> Dict[str, Any]:
        details_record = await self.ds.get_ebrt_record(patient_id)
        workflow_record = await self.ds.get_workflow_record(patient_id)
        data = workflow_record.get("data") or {}
        return {
            "ebrt": coalesce_history(details_record, "ebrt"),
            "discharge": coalesce_history(details_record, "discharge"),
            "summary": coalesce_history(data, "summary"),
            "intent": coalesce_history(data, "intent"),
            "baseline": coalesce_history(data, "baseline"),
            "treatment": coalesce_history(data, "treatment"),
        }

    # ── observed toxicities, merged across all three record shapes ───────────
    def _observed(self, ctx: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Observed toxicities, PRIMARY source first: the workflow "Summary" tab's
        Add-Toxicity provision (`data.summary.toxicities[]`: {toxicity, grade}).
        Legacy `ebrt.adverseEvents` and `discharge.toxicitySummaryRows` are merged
        in only as fallbacks for older records. Entries are de-duplicated by
        toxicity name (Summary wins on name/system) while keeping the worst grade
        seen, so the roll-up rows never double-count nor hide a severe event.
        """
        summary = ctx.get("summary") or {}
        ebrt = ctx.get("ebrt") or {}
        discharge = ctx.get("discharge") or {}
        raw: List[Dict[str, Any]] = []

        for t in (summary.get("toxicities") or []):
            if isinstance(t, dict) and _clean(t.get("toxicity")):
                raw.append({"name": _clean(t.get("toxicity")),
                            "grade": _grade_num(t.get("grade")),
                            "system": _clean(t.get("gradingSystem")) or "CTCAE",
                            "source": "db"})
        for a in (ebrt.get("adverseEvents") or []):
            if isinstance(a, dict) and _clean(a.get("event")):
                raw.append({"name": _clean(a.get("event")),
                            "grade": _grade_num(a.get("grade")),
                            "system": _clean(a.get("gradingSystem")) or "CTCAE",
                            "source": "db"})
        for r in (discharge.get("toxicitySummaryRows") or []):
            if isinstance(r, dict) and _clean(r.get("adverseEvent")):
                raw.append({"name": _clean(r.get("adverseEvent")),
                            "grade": _grade_num(r.get("grade")),
                            "system": _clean(r.get("gradingSystem")) or "CTCAE",
                            "source": "db"})

        merged: Dict[str, Dict[str, Any]] = {}
        for o in raw:
            key = o["name"].strip().lower()
            kept = merged.get(key)
            if kept is None:
                merged[key] = dict(o)  # first (Summary-priority) entry keeps name/system
            elif (o["grade"] or -1) > (kept["grade"] if kept["grade"] is not None else -1):
                kept["grade"] = o["grade"]  # never hide a worse grade from a later source
        return list(merged.values())

    def _match_observed(
        self, observed: List[Dict[str, Any]], terms: List[str]
    ) -> Optional[Dict[str, Any]]:
        """Highest-grade observed event whose name contains any of the terms."""
        hits = [o for o in observed
                if any(term in o["name"].lower() for term in terms)]
        if not hits:
            return None
        return max(hits, key=lambda o: (o["grade"] is not None, o["grade"] or 0))

    def _oar_dose(
        self, ctx: Dict[str, Any], terms: List[str], metric: str
    ) -> Optional[Tuple[str, float]]:
        """(organName, dose Gy) for the first recorded OAR matching terms; None if absent."""
        intent = ctx.get("intent") or {}
        for o in (intent.get("organsAtRisk") or []):
            if not isinstance(o, dict):
                continue
            name = _clean(o.get("organName"))
            if not name or not any(term in name.lower() for term in terms):
                continue
            dose = _num(o.get("maxDoseGy") if metric == "max" else o.get("meanDoseGy"))
            if dose is None:
                dose = _num(o.get("meanDoseGy") or o.get("maxDoseGy"))
            if dose is not None:
                return name, dose
        return None

    def _n_fx(self, ctx: Dict[str, Any]) -> Optional[float]:
        ebrt = ctx.get("ebrt") or {}
        treatment = ctx.get("treatment") or {}
        sim_sets = ebrt.get("simulationSets") or []
        sim = sim_sets[0] if sim_sets else {}
        return _num(sim.get("totalFractions")) or _num(treatment.get("numFractions"))

    def build_rows(self, ctx: Dict[str, Any]) -> List[Row]:
        observed = self._observed(ctx)
        n_fx = self._n_fx(ctx)
        rows: List[Row] = []

        # 1–10. Per-toxicity rows: observed grade first, else dose-predicted risk.
        for param, obs_terms, oar_terms, metric, limit, traj in _TOX_SPECS:
            hit = self._match_observed(observed, obs_terms)
            if hit is not None:
                st, label = _grade_status(hit["grade"])
                gtxt = (f"Grade {hit['grade']}" if hit["grade"] is not None
                        else "recorded (ungraded)")
                rows.append(Row(
                    param=param, status=st, statusLabel=label,
                    finding=f"Observed: {hit['name']} — {gtxt}",
                    ref=traj,
                    action=("Grade ≥ 3 — escalate supportive care and consider a treatment "
                            "break/review." if (hit["grade"] or 0) >= 3 else
                            "Grade 2 — active supportive care and monitor for progression."
                            if hit["grade"] == 2 else
                            "Low-grade toxicity; continue routine supportive care."),
                    source="db",
                ))
                continue

            dose_hit = self._oar_dose(ctx, oar_terms, metric) if limit is not None else None
            if dose_hit is not None:
                organ, dose = dose_hit
                eqd2 = _eqd2(dose, n_fx, 3.0)
                compare = eqd2 if eqd2 is not None else dose
                ratio = compare / limit if limit else 0.0
                if ratio > 1.0:
                    st, label = STATUS_ALERT, "High predicted risk"
                elif ratio > 0.9:
                    st, label = STATUS_WATCH, "Elevated predicted risk"
                else:
                    st, label = STATUS_OK, "Low predicted risk"
                dose_txt = (f"{_fmt(eqd2)} Gy EQD2" if eqd2 is not None
                            else f"{_fmt(dose)} Gy {metric}")
                rows.append(Row(
                    param=param, status=st, statusLabel=label,
                    finding=(f"No event observed; predicted from {organ} "
                             f"{dose_txt} ({ratio * 100:.0f}% of threshold)"),
                    ref=traj,
                    action=(f"α/β 3{', ' + str(int(n_fx)) + '-fx basis' if n_fx else ''}. "
                            + ("Dose exceeds the tolerance threshold — pre-empt with "
                               "prophylactic supportive care and monitor closely."
                               if ratio > 1.0 else
                               "Dose approaching threshold; brief for early symptoms."
                               if ratio > 0.9 else
                               "Dose within tolerance; standard monitoring.")),
                    source="derived",
                ))
                continue

            rows.append(Row.not_available(
                param, ref=traj,
                action="Populates from a recorded adverse event or the relevant OAR dose.",
                source="gap"))

        # 11. Weight / Nutrition Trend — on-treatment weight change vs baseline.
        ebrt = ctx.get("ebrt") or {}
        baseline = ctx.get("baseline") or {}
        completion = ebrt.get("completion") or {}
        w_base = _num(baseline.get("phy-weight"))
        w_start = _num(completion.get("weightStart")) or w_base
        w_end = _num(completion.get("weightCompletion"))
        if w_start is not None and w_end is not None:
            pct = (w_start - w_end) / w_start * 100.0 if w_start else 0.0
            significant = pct >= 5.0
            rows.append(Row(
                param="Weight / Nutrition Trend",
                status=STATUS_WATCH if significant else STATUS_OK,
                statusLabel="≥5% loss" if significant else "Stable",
                finding=f"{_fmt(w_start)} → {_fmt(w_end)} kg ({pct:+.1f}%)",
                ref="< 5% weight loss over the course (nutrition maintained)",
                action=("Significant weight loss — dietitian referral / nutritional support "
                        "and re-plan check." if significant else
                        "Weight stable within tolerance; continue nutrition monitoring."),
                source="db",
            ))
        elif w_base is not None:
            rows.append(Row(
                param="Weight / Nutrition Trend",
                status=STATUS_OK, statusLabel="Baseline only",
                finding=f"Baseline weight {_fmt(w_base)} kg; no on-treatment weight recorded",
                ref="< 5% weight loss over the course (nutrition maintained)",
                action="Baseline recorded; on-treatment weights populate the trend as delivered.",
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Weight / Nutrition Trend",
                ref="< 5% weight loss over the course (nutrition maintained)",
                action="Populates from baseline phy-weight + on-treatment weights.",
                source="gap"))

        # 12. Supportive Care Recommendation — driven by the worst active toxicity.
        graded = [o for o in observed if o["grade"] is not None]
        max_grade = max((o["grade"] for o in graded), default=None)
        follow_up = ebrt.get("followUp") or {}
        plan = _clean(follow_up.get("postCompletionPlan"))
        if max_grade is not None:
            worst = max(graded, key=lambda o: o["grade"])
            if max_grade >= 3:
                st, label = STATUS_ALERT, "Escalate"
                act = (f"Grade {max_grade} {worst['name']} — escalate supportive care "
                       "(analgesia/hydration/nutrition) and review for treatment modification.")
            elif max_grade == 2:
                st, label = STATUS_WATCH, "Active"
                act = (f"Grade 2 {worst['name']} — active supportive care per CTCAE; "
                       "reassess at each on-treatment visit.")
            else:
                st, label = STATUS_OK, "Routine"
                act = "Low-grade toxicity; routine supportive care and symptom review."
            rows.append(Row(
                param="Supportive Care Recommendation",
                status=st, statusLabel=label,
                finding=(f"Worst active: {worst['name']} Grade {max_grade}"
                         + (f"; plan: {plan}" if plan else "")),
                ref="Supportive care matched to CTCAE grade and site",
                action=act, source="derived",
            ))
        elif plan:
            rows.append(Row(
                param="Supportive Care Recommendation",
                status=STATUS_OK, statusLabel="Routine",
                finding=f"No graded toxicity; supportive plan on record: {plan}",
                ref="Supportive care matched to CTCAE grade and site",
                action="No active high-grade toxicity; continue the recorded supportive plan.",
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Supportive Care Recommendation",
                ref="Supportive care matched to CTCAE grade and site",
                action="Populates from recorded toxicities / follow-up supportive plan.",
                source="gap"))

        # 13. CTCAE Grading Currency — are recorded toxicities graded on current CTCAE?
        systems = [o["system"] for o in observed if o["system"]]
        if observed:
            has_grade = any(o["grade"] is not None for o in observed)
            current = any(re.search(r"5", s) for s in systems if "ctcae" in s.lower())
            ungraded = [o["name"] for o in observed if o["grade"] is None]
            if current and not ungraded:
                st, label, finding = (STATUS_OK, "CTCAE v5.0",
                                      f"{len(observed)} toxicity(ies) graded on CTCAE v5.0")
                act = "Grading current (CTCAE v5.0); no action."
            elif has_grade:
                st, label = STATUS_WATCH, "Verify version"
                finding = (f"{len(observed)} toxicity(ies) graded"
                           + (f"; system: {', '.join(sorted(set(systems)))}" if systems else "")
                           + (f"; ungraded: {', '.join(ungraded)}" if ungraded else ""))
                act = "Confirm all toxicities are graded on the current CTCAE v5.0."
            else:
                st, label = STATUS_WATCH, "Ungraded"
                finding = f"{len(observed)} toxicity(ies) recorded without a CTCAE grade"
                act = "Assign CTCAE v5.0 grades to the recorded toxicities."
            rows.append(Row(
                param="CTCAE Grading Currency",
                status=st, statusLabel=label, finding=finding,
                ref="All toxicities graded on CTCAE v5.0", action=act, source="db",
            ))
        else:
            rows.append(Row(
                param="CTCAE Grading Currency",
                status=STATUS_OK, statusLabel="None to grade",
                finding="No adverse events recorded to grade",
                ref="All toxicities graded on CTCAE v5.0",
                action="No toxicities on record; grading applies once events are logged.",
                source="derived",
            ))

        # 14. Late Toxicity Prediction — late-reacting OAR EQD2 (α/β=3) vs tolerance.
        late = []
        for param, _obs, oar_terms, metric, limit, traj in _TOX_SPECS:
            if limit is None:
                continue
            dose_hit = self._oar_dose(ctx, oar_terms, metric)
            if dose_hit is None:
                continue
            organ, dose = dose_hit
            eqd2 = _eqd2(dose, n_fx, 3.0)
            compare = eqd2 if eqd2 is not None else dose
            late.append((organ, compare, limit, compare / limit if limit else 0.0))
        if late:
            worst = max(late, key=lambda t: t[3])
            over = [t for t in late if t[3] > 1.0]
            near = [t for t in late if 0.9 < t[3] <= 1.0]
            st = (STATUS_ALERT if over else STATUS_WATCH if near else STATUS_OK)
            rows.append(Row(
                param="Late Toxicity Prediction",
                status=st,
                statusLabel=("Predicted risk" if over else
                             "Approaching" if near else "Low risk"),
                finding=(f"{len(late)} late-reacting OAR(s) assessed; tightest "
                         f"{worst[0]} {_fmt(worst[1])} / {_fmt(worst[2])} Gy "
                         f"({worst[3] * 100:.0f}% of tolerance)"),
                ref="Late-reacting OAR EQD2 (α/β=3) below tolerance",
                action=("An OAR exceeds late tolerance — counsel on late-effect risk and "
                        "document." if over else
                        "An OAR is near late tolerance; monitor for late effects."
                        if near else
                        "Late-reacting OARs within tolerance on the recorded doses."),
                source="derived",
            ))
        else:
            rows.append(Row.not_available(
                "Late Toxicity Prediction",
                ref="Late-reacting OAR EQD2 (α/β=3) below tolerance",
                action="Populates from intent.organsAtRisk doses with known tolerances.",
                source="gap"))

        # 15. Toxicity Trend Dashboard — roll-up of the observed toxicity burden.
        if observed:
            names = "; ".join(
                f"{o['name']}" + (f" G{o['grade']}" if o["grade"] is not None else "")
                for o in observed)
            if max_grade is not None and max_grade >= 3:
                st, label = STATUS_ALERT, f"Peak G{max_grade}"
            elif max_grade == 2:
                st, label = STATUS_WATCH, "Peak G2"
            else:
                st, label = STATUS_OK, "Low grade"
            rows.append(Row(
                param="Toxicity Trend Dashboard",
                status=st, statusLabel=label,
                finding=f"{len(observed)} toxicity(ies): {names}",
                ref="Toxicity burden stable or improving over the course",
                action=("Multiple/high-grade toxicities — track trajectory visit-to-visit."
                        if (len(observed) > 1 or (max_grade or 0) >= 2) else
                        "Single low-grade toxicity; continue routine surveillance."),
                source="derived",
            ))
        else:
            rows.append(Row(
                param="Toxicity Trend Dashboard",
                status=STATUS_OK, statusLabel="No active toxicity",
                finding="No toxicities recorded to date",
                ref="Toxicity burden stable or improving over the course",
                action="No toxicity trend to report; updates as events are recorded.",
                source="derived",
            ))

        return rows

    def build_prompt(self, ctx: Dict[str, Any], rows: List[Row]) -> Optional[str]:
        """
        Optional 1-2 sentence toxicity narrative (prose only), stored under meta.narrative.
        Row statuses above are already final and independent of this. Skips cleanly when
        GROQ_API_KEY is unset.
        """
        summary = ctx.get("summary") or {}
        ebrt = ctx.get("ebrt") or {}
        intent = ctx.get("intent") or {}
        payload = {
            "observedToxicities": summary.get("toxicities"),
            "adverseEvents": ebrt.get("adverseEvents"),
            "organsAtRisk": intent.get("organsAtRisk"),
            "supportivePlan": (ebrt.get("followUp") or {}).get("postCompletionPlan"),
        }
        return (
            "You are a radiation oncology toxicity assistant. Using ONLY the JSON below, "
            "write a concise 1-2 sentence toxicity summary. Do not invent data or grades; "
            "if a field is missing, omit it. Return a JSON object with a single key "
            '"toxicity" whose value is the sentence.\n\n'
            f"DATA:\n{json.dumps(payload, default=str)}"
        )

