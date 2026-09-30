"""
agents/planning.py — Module 02: Treatment Planning Intelligence.

Guideline-aligned view of the plan: fractionation, prescription, targets, margins,
technique, beam arrangement, and simulation. Derived from the data sources:

  * `rt-record-details`    → `ebrt` section: simulationSets (fractionation, dose,
    immobilisation, imaging), procedure (technique/energy), planning (adaptive),
    approvals (sign-off); `brachy.dosePrescription` (brachytherapy fractionation /
    dose); `common.treatment` (Protocol Master → Role of Radiotherapy + the
    *FromProtocol flags it stamps on each element it fills).
  * `radiotherapy_records` → `data.<stage>`: intent (target volumes, OARs), treatment
    (beam parameters, machine, treatmentType), setup (positioning), simulation (CT sim).
  * `onco_pathology`       → nodal status via resolve_pathology() — the clinical
    indication behind the Elective Nodal Irradiation row.

Fractionation, dose prescription and protocol selection are modality-aware
(_resolve_plan_rx → resolve_prescription): the workflow "Treatment Plan" tab
(`data.treatment`, dose in Gy) is read first, then the legacy EBRT simulation set
(`ebrt.simulationSets[0]`, dose in cGy → Gy), then brachytherapy (`brachy.dosePrescription`,
already Gy). Rows with no source in any document (CTV→PTV margins, bolus, on-treatment
weight) are labelled "Not available"; nothing is invented.

Frozen row mapping for Module 02 (standard renderer):
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
from typing import Any, Dict, List, Optional

from ..data_sources import coalesce_history, resolve_pathology, resolve_prescription
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
    """'2026-08-05' / '2026-08-05T..' → '05 Aug 2026'. Best-effort, never raises."""
    if not iso:
        return DASH
    try:
        date_part = str(iso).split("T")[0]
        y, m, d = date_part.split("-")
        return f"{int(d):02d} {_MONTHS[int(m) - 1]} {y}"
    except (ValueError, IndexError):
        return str(iso).split("T")[0] or DASH


def _clean(value: Any) -> str:
    """Trimmed string; empty for None/blank so callers can test truthiness."""
    text = str(value).strip() if value is not None else ""
    return "" if text.lower() in ("", "none", "null") else text


def _cgy_to_gy(value: Any) -> Optional[float]:
    """Exact cGy→Gy (÷100). Returns None if not numeric."""
    try:
        return float(str(value).strip()) / 100.0
    except (ValueError, TypeError):
        return None


def _fmt_gy(cgy: Any) -> str:
    """'3000' cGy → '30 Gy'. Whole numbers show without a trailing '.0'."""
    gy = _cgy_to_gy(cgy)
    if gy is None:
        return ""
    return (f"{gy:.0f} Gy" if gy == int(gy) else f"{gy:.2f} Gy")


_NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")


def _first_num(value: Any) -> Optional[float]:
    """Pull the leading number out of '300', '300.0 cGy', '7 Gy' → float; None if absent."""
    if value is None:
        return None
    m = _NUM_RE.search(str(value))
    return float(m.group()) if m else None


def _fmt_gy_val(gy: Optional[float]) -> str:
    """A Gy value → '30 Gy' / '7.5 Gy'. Empty for None. Gy passthrough — no ÷100."""
    if gy is None:
        return ""
    return f"{gy:.0f} Gy" if gy == int(gy) else f"{gy:g} Gy"


def _resolve_plan_rx(
    common_treatment: Dict[str, Any],
    ebrt: Dict[str, Any],
    brachy: Dict[str, Any],
    wf_treatment: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Collapse the prescribed fractionation / dose into ONE modality-aware shape.

    Delegates the source/unit resolution to the shared `resolve_prescription()` helper: the
    workflow "Treatment Plan" tab (`data.treatment`, dose in Gy) wins per field, then the
    legacy EBRT simulation set (`ebrt.simulationSets[0]`, cGy → Gy), then brachytherapy
    (`brachy.dosePrescription`, already Gy). Modality is taken from `common.treatment.rtType`,
    falling back to the workflow `treatmentType`, then to whichever section carries data (a
    combined course reports as EBRT). Adds the ready-to-render display strings and the
    has_dose / has_fx gates the rows below switch on; nothing is invented.
    """
    rx = dict(resolve_prescription(wf_treatment, ebrt, brachy, common_treatment))
    rx["total_display"] = _fmt_gy_val(rx["total_gy"])
    rx["per_display"] = _fmt_gy_val(rx["per_gy"])
    rx["has_dose"] = rx["total_gy"] is not None or bool(rx.get("free_text"))
    rx["has_fx"] = bool(rx["n_fx"]) or bool(rx["schedule"]) or rx["per_gy"] is not None
    return rx


class PlanningAgent(BaseAgent):
    moduleId = "m2"
    slug = "planning"
    num = "02 / 12"
    title = "Treatment Planning Intelligence"

    async def gather_context(self, patient_id: Optional[str]) -> Dict[str, Any]:
        details_record = await self.ds.get_ebrt_record(patient_id)
        workflow_record = await self.ds.get_workflow_record(patient_id)
        latest_protocol = await self.ds.get_latest_protocol_reference(patient_id)
        data = workflow_record.get("data") or {}
        return {
            "ebrt": coalesce_history(details_record, "ebrt"),
            "brachy": coalesce_history(details_record, "brachy"),
            "common": coalesce_history(details_record, "common"),
            "intent": coalesce_history(data, "intent"),
            "treatment": coalesce_history(data, "treatment"),
            "setup": coalesce_history(data, "setup"),
            "simulation": coalesce_history(data, "simulation"),
            "pathology": resolve_pathology(await self.ds.get_pathology_record(patient_id)),
            "protocol_reference": latest_protocol,
        }

    def build_rows(self, ctx: Dict[str, Any]) -> List[Row]:
        ebrt = ctx.get("ebrt") or {}
        intent = ctx.get("intent") or {}
        treatment = ctx.get("treatment") or {}
        setup = ctx.get("setup") or {}
        simulation = ctx.get("simulation") or {}
        path = ctx.get("pathology") or {}
        brachy = ctx.get("brachy") or {}
        common = ctx.get("common") or {}

        sim_sets = ebrt.get("simulationSets") or []
        sim = sim_sets[0] if sim_sets else {}
        procedure = ebrt.get("procedure") or {}
        planning = ebrt.get("planning") or {}
        approvals = ebrt.get("approvals") or {}
        targets = [t for t in (intent.get("targetVolumes") or []) if isinstance(t, dict)]
        oars = [o for o in (intent.get("organsAtRisk") or []) if isinstance(o, dict)]
        beams = [b for b in (treatment.get("beamParameters") or []) if isinstance(b, dict)]

        # Modality-aware prescription (EBRT cGy→Gy vs brachytherapy Gy) used by the
        # fractionation, dose-prescription and prescription-checklist rows below.
        rx = _resolve_plan_rx(common.get("treatment") or {}, ebrt, brachy, treatment)

        rows: List[Row] = []

        # 1. Fractionation Regimen — the prescribed fractionation schedule. EBRT reads
        #    it from the simulation set (treatment section); brachytherapy from the dose-
        #    prescription section. Modality resolved by _resolve_plan_rx.
        mod_label = "Brachytherapy" if rx["modality"] == "brachy" else "EBRT"
        if rx["has_fx"] or rx["total_display"]:
            bits: List[str] = []
            if rx["total_display"] and rx["n_fx"]:
                bits.append(f"{rx['total_display']} / {rx['n_fx']} fx")
            elif rx["n_fx"]:
                bits.append(f"{rx['n_fx']} fx")
            elif rx["total_display"]:
                bits.append(rx["total_display"])
            if rx["per_display"]:
                bits.append(f"{rx['per_display']}/fx")
            if rx["schedule"]:
                bits.append(rx["schedule"])
            rows.append(Row(
                param="Fractionation Regimen",
                status=STATUS_OK, statusLabel="Prescribed",
                finding=" · ".join(bits),
                ref="Fractionation matches intent & site protocol",
                action=(f"{mod_label} fractionation on record"
                        + (f" ({rx['schedule']} schedule)" if rx["schedule"] else "")
                        + ". Verify against site protocol."),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Fractionation Regimen", ref="Requires dose/fractionation",
                action="Populates from the EBRT simulation set or brachytherapy "
                       "dose prescription."))

        # 2. Protocol Selection — the protocol reference from radiotherapy_records (ebrt.protocolReference)
        #    or the "Select Protocol Master" action in the common data elements.
        protocol_ref = ctx.get("protocol_reference") or (ebrt.get("protocolReference") if isinstance(ebrt.get("protocolReference"), dict) else {})
        proto_id = _clean(protocol_ref.get("protocolId"))
        proto_name = _clean(protocol_ref.get("protocolName"))

        ct = common.get("treatment") or {}
        rt_role = _clean(ct.get("rtRole"))
        proto_elems: List[str] = []
        if procedure.get("techniqueFromProtocol"):
            proto_elems.append("technique")
        if procedure.get("machineFromProtocol"):
            proto_elems.append("machine")
        for s in sim_sets:
            if isinstance(s, dict) and s.get("imagingFromProtocol"):
                proto_elems.append("imaging")
            if isinstance(s, dict) and s.get("positionFromProtocol"):
                proto_elems.append("positioning")
        if (brachy.get("dosePrescription") or {}).get("techniqueFromProtocol"):
            proto_elems.append("brachytherapy technique")
        proto_elems = list(dict.fromkeys(proto_elems))  # dedupe, preserve order

        if proto_name or proto_id or rt_role or proto_elems:
            pbits: List[str] = []
            if proto_name or proto_id:
                name_str = proto_name or proto_id
                id_suffix = f" ({proto_id})" if (proto_id and proto_id != proto_name) else ""
                pbits.append(f"{name_str}{id_suffix}")
            if rt_role:
                pbits.append(f"Role of RT: {rt_role}")
            if proto_elems:
                pbits.append("protocol-applied: " + ", ".join(proto_elems))
            rows.append(Row(
                param="Protocol Selection",
                status=STATUS_OK, statusLabel="Applied",
                finding="; ".join(pbits),
                ref="Protocol applied from Protocol Master",
                action="Protocol selection on record — confirm the applied "
                       "protocol matches the site and intent.",
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Protocol Selection",
                ref="Requires a Protocol Master selection",
                action="Populates when a protocol is applied via Protocol Master "
                       "or Select Protocol Master (Role of Radiotherapy).",
                source="request",
            ))

        # 3. Dose Prescription — formulated from total dose, dose per fraction, number of
        #    fractions and the fractionation schedule (modality-aware: EBRT cGy→Gy, brachy Gy).
        if rx["has_dose"] or (rx["n_fx"] and rx["per_display"]):
            parts: List[str] = []
            if rx["total_display"]:
                parts.append(f"Total {rx['total_display']}")
            if rx["n_fx"]:
                parts.append(f"{rx['n_fx']} fractions")
            if rx["per_display"]:
                parts.append(f"{rx['per_display']}/fraction")
            if rx["schedule"]:
                parts.append(rx["schedule"])
            finding = ", ".join(parts) if parts else rx.get("free_text", "")
            if rx["modality"] == "brachy":
                tech = rx.get("technique")
                tgt = rx.get("target")
                action = ("Brachytherapy prescription"
                          + (f" — {tech}" if tech else "")
                          + (f" to {tgt}" if tgt else "")
                          + ". Confirm against the site protocol.")
            else:
                boost = rx.get("sib_boost")
                if boost and boost.lower() != "no":
                    finding += f", SIB boost {boost}"
                action = "Peer review: " + (rx.get("peer_review") or "not recorded") + "."
            rows.append(Row(
                param="Dose Prescription",
                status=STATUS_OK, statusLabel="Prescribed",
                finding=finding,
                ref="Prescription documented & peer-reviewed",
                action=action,
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Dose Prescription", ref="Requires prescription",
                action="Populates from the EBRT simulation set or brachytherapy "
                       "dose prescription."))

        # 4. Target Volumes (GTV/CTV/PTV) — intent.targetVolumes.
        if targets:
            defined = {str(t.get("type", "")).lower() for t in targets if t.get("type")}
            names = "; ".join(
                f"{_clean(t.get('type')).upper() or 'Target'} "
                f"{_clean(t.get('volumeName')) or ''}".strip()
                + (f" ({_clean(t.get('volumeCc'))} cc)" if _clean(t.get("volumeCc")) else "")
                for t in targets)
            has_full = {"gtv", "ctv", "ptv"}.issubset(defined)
            rows.append(Row(
                param="Target Volumes (GTV/CTV/PTV)",
                status=STATUS_OK if has_full else STATUS_WATCH,
                statusLabel="Defined" if has_full else "Partial",
                finding=names,
                ref="GTV, CTV and PTV all delineated",
                action=("GTV/CTV/PTV delineated." if has_full else
                        "Only " + ", ".join(sorted(d.upper() for d in defined))
                        + " defined; delineate remaining volumes."),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Target Volumes (GTV/CTV/PTV)", ref="Requires delineated volumes",
                action="Populates from intent.targetVolumes."))

        # 5. Margin Recommendation — no CTV→PTV margin field in available data.
        rows.append(Row.not_available(
            "Margin Recommendation",
            ref="Requires CTV→PTV margin definition",
            action="Populates when CTV-to-PTV margins are recorded.",
            source="gap",
        ))

        # 6. Elective Nodal Irradiation — the plan record has no nodal-volume field, but
        #    the pathology report's nodal status is the clinical INDICATION for treating
        #    the nodal regions. Surface that when present; the delineated elective nodal
        #    volume itself still isn't in the plan data, so the row stays advisory.
        nodes_summary = path.get("nodes_summary")
        if path.get("nodes_involved"):
            acc = path.get("accession_id")
            rows.append(Row(
                param="Elective Nodal Irradiation",
                status=STATUS_WATCH, statusLabel="Indication present",
                finding=(f"Pathologic nodal involvement — {nodes_summary}"
                         if nodes_summary else "Pathologic nodal involvement on record"),
                ref="Nodal status drives the elective nodal-volume decision",
                action=("Node-positive pathology supports nodal irradiation — confirm "
                        "elective nodal volumes are delineated (not recorded in plan data)"
                        + (f" [{acc}]." if acc else ".")),
                source="db",
            ))
        elif path.get("nodes_examined") and nodes_summary:
            rows.append(Row(
                param="Elective Nodal Irradiation",
                status=STATUS_OK, statusLabel="Node-negative",
                finding=f"Node-negative on pathology — {nodes_summary}",
                ref="Nodal status drives the elective nodal-volume decision",
                action="Pathology node-negative; confirm whether elective nodal coverage "
                       "is still indicated for this site/stage.",
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Elective Nodal Irradiation",
                ref="Requires nodal-volume decision",
                action="Populates from onco_pathology nodal status or recorded elective nodal volumes.",
                source="gap",
            ))

        # 7. Adaptive RT Eligibility — ebrt.planning.adaptiveRadiation.
        adaptive = _clean(planning.get("adaptiveRadiation"))
        if adaptive:
            indicated = adaptive.lower() in ("yes", "true", "y")
            reason = _clean(planning.get("adaptiveReason"))
            rows.append(Row(
                param="Adaptive RT Eligibility",
                status=STATUS_WATCH if indicated else STATUS_OK,
                statusLabel="Indicated" if indicated else "Not indicated",
                finding=f"Adaptive RT: {adaptive}" + (f" — {reason}" if reason else ""),
                ref="Adaptive re-plan need assessed",
                action=("Adaptive re-planning flagged; schedule re-scan/re-plan."
                        if indicated else
                        "Adaptive re-planning not indicated on current assessment."),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Adaptive RT Eligibility", ref="Requires adaptive assessment",
                action="Populates from ebrt.planning.adaptiveRadiation."))

        # 8. Organs-at-Risk Identification — intent.organsAtRisk.
        if oars:
            listing = "; ".join(
                f"{_clean(o.get('organName')) or 'OAR'}"
                + (f" (max {_clean(o.get('maxDoseGy'))} Gy" if _clean(o.get("maxDoseGy")) else "")
                + (f", mean {_clean(o.get('meanDoseGy'))} Gy)" if _clean(o.get("meanDoseGy"))
                   else (")" if _clean(o.get("maxDoseGy")) else ""))
                for o in oars)
            rows.append(Row(
                param="Organs-at-Risk Identification",
                status=STATUS_OK, statusLabel=f"{len(oars)} defined",
                finding=listing,
                ref="All site-relevant OARs contoured with constraints",
                action="OARs contoured with dose constraints; verify completeness for site.",
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Organs-at-Risk Identification", ref="Requires OAR contours",
                action="Populates from intent.organsAtRisk."))

        # 9. Technique Recommendation — ebrt.procedure.technique + energy.
        technique = _clean(procedure.get("technique"))
        energy = procedure.get("energy") or {}
        modality = "photon" if energy.get("photon") else (
            "electron" if energy.get("electron") else (
                "proton" if energy.get("proton") else ""))
        if technique:
            rows.append(Row(
                param="Technique Recommendation",
                status=STATUS_OK, statusLabel="Selected",
                finding=technique + (f" · {modality}" if modality else ""),
                ref="Technique appropriate for target & OARs",
                action=f"{technique} technique on record"
                       + (f" ({modality} energy)." if modality else "."),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Technique Recommendation", ref="Requires technique selection",
                action="Populates from ebrt.procedure.technique."))

        # 10. Beam Arrangement — treatment.beamParameters.
        if beams:
            first = beams[0]
            energy_mv = _clean(first.get("energyMv"))
            gantry = _clean(first.get("gantryAngle"))
            fld = _clean(first.get("fieldName"))
            n = len(beams)
            detail = f"{n} field{'s' if n != 1 else ''}"
            if fld:
                detail += f" ({fld}"
                detail += f", {energy_mv}" if energy_mv else ""
                detail += f", gantry {gantry}°" if gantry else ""
                detail += ")"
            rows.append(Row(
                param="Beam Arrangement",
                status=STATUS_OK, statusLabel="Configured",
                finding=detail,
                ref="Beam geometry supports coverage & OAR sparing",
                action="Beam parameters on record; confirm against approved plan.",
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Beam Arrangement", ref="Requires beam parameters",
                action="Populates from treatment.beamParameters."))

        # 11. Bolus Recommendation — no bolus field in available data.
        rows.append(Row.not_available(
            "Bolus Recommendation",
            ref="Requires bolus decision",
            action="Populates when bolus use/thickness is recorded.",
            source="gap",
        ))

        # 12. Immobilization — ebrt.simulationSets.immobilisation + setup.
        immob = _clean(sim.get("immobilisation"))
        devices = [d for d in (setup.get("immobilizationDevices") or []) if _clean(d)]
        position = _clean(sim.get("patientPos")) or _clean(setup.get("positioning"))
        if immob or devices:
            finding = immob or ", ".join(str(d) for d in devices)
            if position:
                finding += f" · {position}"
            rows.append(Row(
                param="Immobilization",
                status=STATUS_OK, statusLabel="On record",
                finding=finding,
                ref="Reproducible immobilisation for site",
                action="Immobilisation device recorded for daily setup reproducibility.",
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Immobilization", ref="Requires immobilisation device",
                action="Populates from ebrt.simulationSets.immobilisation."))

        # 13. Simulation Protocol — simulation stage + ebrt sim imaging/technique.
        sim_type = _clean(simulation.get("simulationType")) or _clean(sim.get("imaging"))
        slice_mm = _clean(simulation.get("sliceThicknessMm"))
        contrast = _clean(simulation.get("contrastUsed"))
        special = _clean(sim.get("specialTech"))
        sim_date = _clean(simulation.get("simulationDate"))
        if sim_type or slice_mm or special:
            bits = []
            if sim_type:
                bits.append(f"{sim_type.upper()} sim")
            if slice_mm:
                bits.append(f"{slice_mm} mm slices")
            if contrast:
                bits.append(f"{contrast} contrast")
            if special:
                bits.append(special)
            rows.append(Row(
                param="Simulation Protocol",
                status=STATUS_OK, statusLabel="Complete",
                finding=", ".join(bits),
                ref="Simulation protocol appropriate for site",
                action=("Simulated "
                        + (_short_date(sim_date) if sim_date else "on record") + "."),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Simulation Protocol", ref="Requires simulation record",
                action="Populates from simulation stage / ebrt.simulationSets."))

        # 14. Planning Workflow Checklist — roll-up of the planning inputs above.
        checks = [
            ("Simulation", bool(sim_type or sim_date)),
            ("Prescription", rx["has_dose"]),
            ("Targets", bool(targets)),
            ("OARs", bool(oars)),
            ("Technique", bool(technique)),
            ("Beams", bool(beams)),
            ("Plan approvals",
             bool(approvals) and all(bool(approvals.get(k))
                                     for k in ("roSigned", "mpSigned", "rttSigned"))),
        ]
        done = [name for name, ok in checks if ok]
        missing = [name for name, ok in checks if not ok]
        total = len(checks)
        if done:
            rows.append(Row(
                param="Planning Workflow Checklist",
                status=STATUS_OK if not missing else STATUS_WATCH,
                statusLabel=f"{len(done)}/{total}",
                finding=f"{len(done)} of {total} planning steps complete",
                ref="All planning workflow steps complete",
                action=("All planning steps complete." if not missing
                        else "Pending: " + ", ".join(missing) + "."),
                source="derived",
            ))
        else:
            rows.append(Row.not_available(
                "Planning Workflow Checklist", ref="Requires planning steps",
                action="Populates as simulation, targets, technique and approvals are recorded."))

        # 15. Re-plan Trigger (weight/anatomy) — completion weight fields (empty here).
        completion = ebrt.get("completion") or {}
        w_start = _clean(completion.get("weightStart"))
        w_end = _clean(completion.get("weightCompletion"))
        if w_start or w_end:
            delta = ""
            try:
                if w_start and w_end:
                    pct = (float(w_start) - float(w_end)) / float(w_start) * 100.0
                    delta = f" ({pct:+.1f}% change)"
            except (ValueError, ZeroDivisionError):
                delta = ""
            significant = False
            try:
                if w_start and w_end:
                    significant = (float(w_start) - float(w_end)) / float(w_start) >= 0.05
            except (ValueError, ZeroDivisionError):
                significant = False
            rows.append(Row(
                param="Re-plan Trigger (weight/anatomy)",
                status=STATUS_WATCH if significant else STATUS_OK,
                statusLabel="Re-plan advised" if significant else "Stable",
                finding=f"Weight {w_start or '—'} → {w_end or '—'}{delta}",
                ref="≥5% weight loss / anatomy change triggers re-plan",
                action=("Significant weight change — consider re-simulation/re-plan."
                        if significant else "Weight change within tolerance."),
                source="db",
            ))
        else:
            rows.append(Row.not_available(
                "Re-plan Trigger (weight/anatomy)",
                ref="Requires on-treatment weight/anatomy tracking",
                action="Populates when treatment weights or anatomy changes are recorded.",
                source="gap"))

        return rows

    def build_prompt(self, ctx: Dict[str, Any], rows: List[Row]) -> Optional[str]:
        """
        Optional: synthesize a 1-2 sentence planning narrative (prose only), stored under
        meta.narrative. Row status/completeness above are already final and independent of
        this. Skips cleanly when GROQ_API_KEY is unset.
        """
        ebrt = ctx.get("ebrt") or {}
        intent = ctx.get("intent") or {}
        common = ctx.get("common") or {}
        rx = _resolve_plan_rx(common.get("treatment") or {}, ebrt,
                              ctx.get("brachy") or {}, ctx.get("treatment") or {})
        payload = {
            "modality": rx["modality"],
            "prescriptionGy": rx["total_gy"],
            "dosePerFractionGy": rx["per_gy"],
            "fractions": rx["n_fx"],
            "schedule": rx["schedule"],
            "technique": (ebrt.get("procedure") or {}).get("technique"),
            "targetVolumes": intent.get("targetVolumes"),
            "organsAtRisk": intent.get("organsAtRisk"),
            "adaptive": (ebrt.get("planning") or {}).get("adaptiveRadiation"),
        }
        return (
            "You are a radiation oncology planning assistant. Using ONLY the JSON below, "
            "write a concise 1-2 sentence treatment-planning summary. Do not invent data; "
            "if a field is missing, omit it. Return a JSON object with a single key "
            '"planning" whose value is the sentence.\n\n'
            f"DATA:\n{json.dumps(payload, default=str)}"
        )
