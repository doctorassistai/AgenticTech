"""
agents/readiness.py — Module 01: Patient Assessment & Radiation Readiness.

Confirms the patient is safe and complete to start or continue radiotherapy. It
derives each readiness row from the two — and only two — data sources:

  * `radiotherapy_records`  → workflow-stage data (baseline, intent, patient,
    simulation …), nested under `data.<stage>` with `data.history.<stage>[]` snapshots.
  * `rt-record-details`     → the RT record-details document that holds the EBRT /
    brachytherapy / discharge sections (plan approvals, systemic therapy, staging).

Rows with no source in either document (implant/device screen, etc.) are honestly
labelled "Not available"; nothing clinical is ever invented.

Frozen row mapping for Module 01 (standard renderer in RadiationOncologyIntelligence.jsx):
    param   → Parameter
    finding → Current Finding
    ref     → Reference / Expected
    status/statusLabel → Status pill
    action  → Indication / Action

This agent emits exactly those six keys per row; it adds nothing to the dashboard.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from ..data_sources import coalesce_history, resolve_pathology
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


def _short_date(iso: str) -> str:
    """'2026-07-30' / '2026-07-30T..' → '30 Jul 2026'. Best-effort, never raises."""
    if not iso:
        return DASH
    try:
        date_part = str(iso).split("T")[0]
        y, m, d = date_part.split("-")
        return f"{int(d):02d} {_MONTHS[int(m) - 1]} {y}"
    except (ValueError, IndexError):
        return str(iso).split("T")[0] or DASH


def _title(s: Any) -> str:
    """Capitalize first letter only: 'palliative' → 'Palliative'. Preserves rest."""
    text = str(s or "").strip()
    return text[:1].upper() + text[1:] if text else ""


def _to_num(value: Any) -> Optional[int]:
    """Parse a numeric string like '3' or '3.0' → 3; non-numeric → None."""
    try:
        return int(float(str(value).strip()))
    except (ValueError, TypeError):
        return None


class ReadinessAgent(BaseAgent):
    moduleId = "m1"
    slug = "readiness"
    num = "01 / 12"
    title = "Patient Assessment & Radiation Readiness"

    async def gather_context(self, patient_id: Optional[str]) -> Dict[str, Any]:
        workflow_record = await self.ds.get_workflow_record(patient_id)
        ebrt_record = await self.ds.get_ebrt_record(patient_id)
        # The workflow record nests everything under `data`, so coalesce against
        # that sub-document (it carries `history` + the flattened stage copies).
        data = workflow_record.get("data") or {}
        return {
            "record": workflow_record,
            "baseline": coalesce_history(data, "baseline"),
            "intent": coalesce_history(data, "intent"),
            "patient": coalesce_history(data, "patient"),
            "simulation": coalesce_history(data, "simulation"),
            "ebrt": coalesce_history(ebrt_record, "ebrt"),
            "discharge": coalesce_history(ebrt_record, "discharge"),
            "pathology": resolve_pathology(await self.ds.get_pathology_record(patient_id)),
        }

    def build_rows(self, ctx: Dict[str, Any]) -> List[Row]:
        baseline = ctx.get("baseline") or {}
        intent = ctx.get("intent") or {}
        patient = ctx.get("patient") or {}
        simulation = ctx.get("simulation") or {}
        ebrt = ctx.get("ebrt") or {}
        discharge = ctx.get("discharge") or {}

        procedure = ebrt.get("procedure") or {}
        approvals = ebrt.get("approvals") or {}
        sim_sets = ebrt.get("simulationSets") or []

        ps = str(baseline.get("phy_performance") or "").strip()
        intent_val = str(intent.get("treatmentIntent") or "").strip()
        setting = str(intent.get("treatmentSetting") or "").strip()
        lab_order = baseline.get("labOrder") or {}
        rad_order = baseline.get("radOrder") or {}
        prev = [t for t in (patient.get("previousTreatments") or []) if isinstance(t, dict)]

        rows: List[Row] = []

        # 1. Radiation Eligibility — anchored to the RO's plan sign-off.
        ro_signed = bool(approvals.get("roSigned"))
        if ro_signed:
            rows.append(Row(
                param="Radiation Eligibility",
                status=STATUS_OK, statusLabel="Eligible",
                finding="Eligible — RO-approved plan on record",
                ref="Radiation-oncologist sign-off",
                action=(f"Approved by {approvals.get('roName', 'radiation oncologist')}"
                        + (f"; {_title(intent_val)} intent." if intent_val else ".")),
                source="db",
            ))
        elif intent_val or ps or baseline:
            rows.append(Row(
                param="Radiation Eligibility",
                status=STATUS_WATCH, statusLabel="Under assessment",
                finding="Baseline assessment on record; approval pending",
                ref="Radiation-oncologist sign-off",
                action="Complete radiation-oncologist sign-off to confirm eligibility.",
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Radiation Eligibility", ref="Requires assessment record",
                action="Populates from baseline assessment + RO approval."))

        # 2. ECOG / KPS — baseline.phy_performance (ECOG 0–4 vs KPS 0–100).
        ps_num = _to_num(ps)
        if ps:
            if ps_num is not None and ps_num <= 5:  # ECOG scale
                finding = f"ECOG {ps_num}"
                ref = "ECOG 0–2 (radical) · ≤3 (palliative)"
                st = STATUS_OK if ps_num <= 1 else (STATUS_WATCH if ps_num <= 3 else STATUS_ALERT)
            elif ps_num is not None:  # KPS scale
                finding = f"KPS {ps_num}"
                ref = "KPS ≥70 preferred"
                st = STATUS_OK if ps_num >= 80 else (STATUS_WATCH if ps_num >= 60 else STATUS_ALERT)
            else:
                finding = ps
                ref = "ECOG / KPS documented"
                st = STATUS_NEUTRAL
            label = {STATUS_OK: "Adequate", STATUS_WATCH: "Borderline",
                     STATUS_ALERT: "Poor", STATUS_NEUTRAL: "Recorded"}[st]
            rows.append(Row(
                param="ECOG / KPS",
                status=st, statusLabel=label, finding=finding, ref=ref,
                action=("Performance status on record"
                        + (f"; consistent with {_title(intent_val)} intent." if intent_val else ".")),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "ECOG / KPS", ref="Requires performance status",
                action="Populates from baseline performance status."))

        # 3. Prior Radiation History — patient.previousTreatments filtered for RT.
        prior_rt = [t for t in prev if any(
            k in str(t.get("treatmentType", "")).lower()
            for k in ("radiat", "radio", "brachy", "ebrt", "radiotherapy"))]
        if prior_rt:
            items = "; ".join(
                f"{t.get('treatmentType', 'RT')} ({_short_date(t.get('date', ''))})"
                for t in prior_rt)
            rows.append(Row(
                param="Prior Radiation History",
                status=STATUS_WATCH, statusLabel="Prior RT",
                finding=items, ref="Screen for re-irradiation / cumulative dose",
                action="Prior radiotherapy on record — review field overlap and "
                       "cumulative OAR dose before planning.",
                source="db",
            ))
        elif prev:
            other = "; ".join(
                f"{t.get('treatmentType', 'therapy')} ({_short_date(t.get('date', ''))})"
                for t in prev)
            rows.append(Row(
                param="Prior Radiation History",
                status=STATUS_OK, statusLabel="None",
                finding="No prior radiotherapy recorded",
                ref="No prior RT to overlap",
                action=(f"Prior treatments: {other}. No radiotherapy overlap."
                        if other else "No prior radiotherapy recorded."),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Prior Radiation History", ref="Requires treatment history",
                action="Populates from patient.previousTreatments."))

        # 4. Surgery–Chemo–RT Timeline — prior treatments + concurrent systemic therapy.
        systemic = str(procedure.get("systemicTherapy") or "").strip()
        combo = str(procedure.get("combinationSpecify") or "").strip()
        concurrent = bool(systemic) and systemic.lower() not in ("none", "no", "nil")
        parts: List[str] = []
        for t in prev:
            label = f"{t.get('treatmentType', 'therapy')} {_short_date(t.get('date', ''))}".strip()
            outcome = str(t.get("outcome") or "").strip()
            parts.append(label + (f" ({outcome})" if outcome else ""))
        if concurrent:
            parts.append(combo or f"{systemic} concurrent with RT")
        if parts:
            rows.append(Row(
                param="Surgery-Chemo-RT Timeline",
                status=STATUS_WATCH if concurrent else STATUS_OK,
                statusLabel="Concurrent" if concurrent else "Sequenced",
                finding="; ".join(parts),
                ref="Surgery / chemo / RT sequence & intervals documented",
                action=("Concurrent systemic therapy with RT — confirm timing and "
                        "overlapping-toxicity monitoring."
                        if concurrent else
                        "Multimodality sequence recorded; confirm intervals before RT."),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Surgery-Chemo-RT Timeline", ref="Requires multimodality timeline",
                action="Populates from prior treatments + systemic therapy."))

        # 5. Implant / Device Safety — no device/pacemaker screen in available data.
        rows.append(Row.not_available(
            "Implant / Device Safety",
            ref="Requires implant / device screen",
            action="Populates when a pacemaker/ICD/prosthesis safety screen is recorded.",
            source="gap",
        ))

        # 6. Baseline Organ Function — baseline lab panel (results are external).
        lab_fields = lab_order.get("fields") or []
        lab_status = str(lab_order.get("status") or "").strip().lower()
        if lab_fields or (lab_status and lab_status != "none"):
            resulted = [f for f in lab_fields
                        if isinstance(f, dict) and str(f.get("surgeryValue") or "").strip()]
            n = len(lab_fields)
            rows.append(Row(
                param="Baseline Organ Function",
                status=STATUS_OK if resulted else STATUS_WATCH,
                statusLabel="Resulted" if resulted else "Ordered",
                finding=(f"{n} baseline labs {lab_status or 'ordered'}" if n
                         else f"Labs {lab_status or 'ordered'}"),
                ref="CBC, renal & hepatic function within range",
                action=("Results on record." if resulted else
                        "Panel ordered; results populate when the lab interface is linked."),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Baseline Organ Function", ref="Requires baseline labs",
                action="Populates from baseline lab order."))

        # 7. Imaging Completeness — baseline imaging orders (reports are external).
        rad_fields = rad_order.get("fields") or []
        rad_status = str(rad_order.get("status") or "").strip().lower()
        if rad_fields or (rad_status and rad_status != "none"):
            names = [str(f.get("label") or f.get("key") or "").split(" (")[0].strip()
                     for f in rad_fields if isinstance(f, dict)]
            names = [n for n in names if n]
            rows.append(Row(
                param="Imaging Completeness",
                status=STATUS_WATCH, statusLabel="Ordered",
                finding=(f"Imaging {rad_status or 'ordered'}: {', '.join(names)}"
                         if names else f"Imaging {rad_status or 'ordered'}"),
                ref="Diagnostic + planning imaging complete",
                action="Staging/planning imaging ordered; reports populate when "
                       "radiology is linked.",
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Imaging Completeness", ref="Requires imaging orders/reports",
                action="Populates from baseline imaging order."))

        # 8. Pathology / Molecular Correlation — the onco_pathology report (histology,
        #    grade, AJCC stage, adverse risk features) is the authoritative source; the
        #    RT discharge-summary histology snapshot is the fallback when no report is linked.
        path = ctx.get("pathology") or {}
        primary = discharge.get("primary") or {}
        if path.get("has_data"):
            bits: List[str] = []
            if path.get("histology"):
                bits.append(f"Histology: {path['histology']}")
            if path.get("grade"):
                bits.append(f"Grade: {path['grade']}")
            if path.get("stage_display"):
                bits.append(f"Stage: {path['stage_display']}")
            if path.get("risk_features"):
                bits.append("; ".join(path["risk_features"]))
            if not bits and path.get("final_diagnosis"):
                bits.append(path["final_diagnosis"])
            acc = path.get("accession_id")
            rows.append(Row(
                param="Pathology / Molecular Correlation",
                status=STATUS_OK, statusLabel="On record",
                finding="; ".join(bits),
                ref="Histology / staging correlated to target",
                action=("Pathology report on record"
                        + (f" ({acc})" if acc else "")
                        + "; confirm target volume correlates with histology"
                        + (" and adverse features." if path.get("risk_features") else ".")),
                source="db",
            ))
        else:
            histo = str(primary.get("Histopathology") or "").strip()
            tnm = str(primary.get("TNM Staging") or "").strip()
            if histo or tnm:
                bits = []
                if histo:
                    bits.append(f"Histology: {histo}")
                if tnm:
                    bits.append(f"TNM: {tnm}")
                rows.append(Row(
                    param="Pathology / Molecular Correlation",
                    status=STATUS_OK, statusLabel="On record",
                    finding="; ".join(bits),
                    ref="Histology / staging correlated to target",
                    action="Pathology on record; confirm target volume correlates with histology.",
                    source="db",
                ))
            else:
                rows.append(Row.not_available(
                    "Pathology / Molecular Correlation",
                    ref="Requires pathology / molecular report",
                    action="Populates from the onco_pathology report or discharge histology."))

        # 9. Radiation Intent Classification — intent.treatmentIntent / treatmentSetting.
        if intent_val:
            finding = _title(intent_val) + (f" — {_title(setting)} setting" if setting else "")
            rows.append(Row(
                param="Radiation Intent Classification",
                status=STATUS_OK, statusLabel=_title(intent_val),
                finding=finding,
                ref="Curative / palliative intent documented",
                action=(f"{_title(intent_val)} intent recorded"
                        + (f", {_title(setting)} setting." if setting else ".")),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Radiation Intent Classification", ref="Requires documented intent",
                action="Populates from intent.treatmentIntent."))

        # 10. Pre-RT Checklist — roll-up of the readiness items above.
        checks = [
            ("Baseline assessment", bool(ps or baseline.get("phy-bp") or lab_order)),
            ("Intent classified", bool(intent_val)),
            ("Simulation planned", bool(sim_sets or simulation.get("simulationDate"))),
            ("Labs ordered", bool(lab_order.get("fields"))),
            ("Imaging ordered", bool(rad_order.get("fields"))),
            ("Plan approvals signed",
             bool(approvals) and all(bool(approvals.get(k))
                                     for k in ("roSigned", "mpSigned", "rttSigned"))),
        ]
        done = [name for name, ok in checks if ok]
        missing = [name for name, ok in checks if not ok]
        total = len(checks)
        if done:
            rows.append(Row(
                param="Pre-RT Checklist",
                status=STATUS_OK if not missing else STATUS_WATCH,
                statusLabel=f"{len(done)}/{total}",
                finding=f"{len(done)} of {total} pre-RT items complete",
                ref="All pre-RT checklist items complete",
                action=("All pre-RT items complete." if not missing
                        else "Pending: " + ", ".join(missing) + "."),
                source="derived",
            ))
        else:
            rows.append(Row.not_available(
                "Pre-RT Checklist", ref="Requires pre-RT items",
                action="Populates as baseline, intent, simulation and approvals are recorded."))

        return rows

    def build_prompt(self, ctx: Dict[str, Any], rows: List[Row]) -> Optional[str]:
        """
        Optional: synthesize a 1-2 sentence readiness narrative (prose only), stored
        under meta.narrative. Row status/completeness above are already final and do
        not depend on this. Skips cleanly when GROQ_API_KEY is unset.
        """
        baseline = ctx.get("baseline") or {}
        intent = ctx.get("intent") or {}
        patient = ctx.get("patient") or {}
        payload = {
            "performanceStatus": baseline.get("phy_performance"),
            "intent": intent.get("treatmentIntent"),
            "setting": intent.get("treatmentSetting"),
            "priorTreatments": patient.get("previousTreatments"),
            "labsOrdered": bool((baseline.get("labOrder") or {}).get("fields")),
            "imagingOrdered": bool((baseline.get("radOrder") or {}).get("fields")),
        }
        return (
            "You are a radiation oncology readiness assistant. Using ONLY the JSON "
            "below, write a concise 1-2 sentence pre-treatment readiness summary. Do "
            "not invent data; if a field is missing, omit it. Return a JSON object "
            'with a single key "readiness" whose value is the sentence.\n\n'
            f"DATA:\n{json.dumps(payload, default=str)}"
        )
